/* ИИ-агент — чистая логика панели чата. Без DOM, без сети и без state как
 * глобала: state приходит параметром, «сейчас» — тоже.
 *
 * Агент предлагает, человек подтверждает. Модель сидит за Edge Function
 * ai-chat (supabase/functions/ai-chat): ключ — только на сервере, данные
 * уходят модели только когда человек сам пишет агенту. Здесь — всё, что
 * проверяется без браузера и без модели:
 *
 *  - снимок данных для модели (aiSnapshot): короткий и без лишнего — ни
 *    почты, ни ставок, ни заметок, ни записей времени; названия, статусы и
 *    даты, не больше 200 открытых задач;
 *  - два инструмента, которые модель зовёт, а считает ядро: свободные окна в
 *    рабочих часах (aiFreeWindows) и потраченное время (aiTimeSpent). Занятое
 *    время — то же, что видит календарь: вхождения отрезков (slots.js,
 *    slotItems) и записи времени (agenda.js, sessionSegments), а не пересказ;
 *  - предложение: проверка (aiValidate), строки карточки (aiProposalRows),
 *    применение (aiApply) и отмена (aiUndo). Схема операций одна с сервером:
 *    описание для модели — в index.ts функции, имена сверяет
 *    tests/unit/ai.test.js;
 *  - поток: кадры SSE (aiParseSse), редьюсер событий Anthropic
 *    (aiStreamStep), ответ для истории (aiAssistantMessage) и правило «тратит
 *    ли вызов дневной лимит» (aiCountsAsMessage). Источник истины для лимита —
 *    сервер, здесь копия для подписи в панели;
 *  - вложения (18 октября 2026): тип по сигнатуре байтов, а не по расширению
 *    (aiSniffType), размеры и число (AI_ATTACH, aiCheckAttachment,
 *    aiCheckAttachments), блоки Messages API (aiAttachmentBlocks) и замена
 *    уже разобранных вложений строкой в истории (aiCompactHistory). Сервер
 *    проверяет то же ещё раз — своей копией правил в index.ts, совпадение
 *    сверяет tests/backend/ai-chat-function.test.js;
 *  - очистка текста для модели (aiCleanText): без управляющих, bidi и
 *    невидимых символов — ими прячут от человека текст, который модель
 *    прочтёт. Через неё идут все названия снимка, имена файлов и текстовые
 *    вложения;
 *  - список чатов: название из первого сообщения (aiChatTitle) и индекс
 *    (aiChatsNormalize); рабочие часы для свободных окон (aiWorkHours) и
 *    пересечения предлагаемых отрезков (aiSlotConflicts — предупреждение,
 *    не запрет: задача ставится на любое время).
 *
 * Даты для модели — местные, с поясом («2026-10-17T10:00:00+05:00»): модель
 * читает их как человек и не пересчитывает UTC в уме. В данные они ложатся,
 * как везде в приложении, в UTC (toISOString).
 *
 * Сутки — по календарю (A.addDaysMs), а не «плюс 24 часа»: см. agenda.js и
 * tests/unit/agenda-dst.test.js.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // Пути — строкой целиком: сборщик телефона (Metro) понимает только такие.
  const A = isNode ? require('./agenda.js') : global.Core;
  const S = isNode ? require('./slots.js') : global.Core;
  const R = isNode ? require('./repeat.js') : global.Core;
  const M = isNode ? require('./reminders.js') : global.Core;
  const ST = isNode ? require('./status.js') : global.Core;
  const C = isNode ? require('./catalog.js') : global.Core;
  const D = isNode ? require('./doc.js') : global.Core;
  const F = isNode ? require('./format.js') : global.Core;
  const TG = isNode ? require('./tags.js') : global.Core;
  const V = isNode ? require('./versions.js') : global.Core;

  const MIN = 60000;
  const QUARTER_MS = 15 * MIN;
  // Отрезок не длиннее суток — то же правило, что в slots.js (normalizeSlot).
  const MAX_SPAN_MIN = 1440;
  const TITLE_MAX = 80;
  const NAME_MAX = 200;
  const DESC_MAX = 2000;
  const NOTES_MAX = 20000;
  const OPEN_MAX = 200;
  const CLOSED_MAX = 30;
  const CLOSED_DAYS = 3;
  const WINDOWS_MAX = 40;
  const TOP_TASKS = 20;
  const SLOTS_MAX = 20;
  const REMINDERS_MAX = 10;
  // Срок без времени — «к концу дня», как у дедлайна в окне задачи (18:00).
  const DUE_DEFAULT_TIME = '18:00';

  /** Операции предложения — та же схема, что у инструмента propose_changes
   *  на сервере. Удалений, переноса задачи в другой проект и таймера нет. */
  const AI_OPS = ['create_project', 'create_version', 'create_tag', 'create_task', 'update_task'];

  /** Рабочие часы для свободных окон по умолчанию: будни 09:00–18:00 по
   *  местному времени; 0 — воскресенье, как у Date.getDay. Свои часы человек
   *  ставит в настройках (settings.workHours, aiWorkHours). Это только то, где
   *  агент ищет свободное время: задачу можно поставить на любой час и день. */
  const AI_WORK_HOURS = Object.freeze({ start: '09:00', end: '18:00', days: Object.freeze([1, 2, 3, 4, 5]) });

  const PATCH_KEYS = ['title', 'status', 'version', 'tags', 'dueAt', 'slots', 'repeat', 'reminders', 'done', 'notes'];

  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const iso = (ms) => new Date(ms).toISOString();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const p2 = (n) => String(n).padStart(2, '0');
  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  // ISO 8601: дата, дальше по желанию время и пояс. «Завтра» и «17 октября»
  // Date.parse где-то понимает, а где-то нет — для модели это кривая дата.
  const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const HEX = /^#[0-9a-f]{6}$/i;
  /** Отметка внутри проверки: поле разобрать не вышло, ошибка уже записана. */
  const BAD = Object.freeze({ bad: true });

  /** Момент числом: число, Date или строка ISO. Дата без времени — местная
   *  полночь (Date.parse прочёл бы её как полночь UTC). NaN — не разобрать. */
  function msOf(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v !== 'string' || !v.trim()) return NaN;
    const s = v.trim();
    const m = s.match(DATE_ONLY);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    return Date.parse(s);
  }

  /** «Сейчас» приходит параметром; без него — часы устройства. */
  const nowOf = (v) => {
    const ms = msOf(v);
    return Number.isFinite(ms) ? ms : Date.now();
  };

  /** Граница диапазона: у «до» дата без времени включает весь свой день. */
  function edgeOf(v, end) {
    const ms = msOf(v);
    if (!Number.isFinite(ms)) return NaN;
    return end && typeof v === 'string' && DATE_ONLY.test(v.trim()) ? A.addDaysMs(ms, 1) : ms;
  }

  /** Местное время с поясом: 2026-10-17T10:00:00+05:00. */
  function localIso(ms) {
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    const off = -d.getTimezoneOffset();
    const a = Math.abs(off);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
      + `${off >= 0 ? '+' : '-'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  }

  /** 'Ч:ММ' / 'ЧЧ:ММ' → 'ЧЧ:ММ'; не время суток — null. */
  function normClock(v) {
    const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return `${p2(Number(m[1]))}:${m[2]}`;
  }

  /** День dayMs в часы hh:mm — по циферблату, как atClock в reminders.js. */
  function atClock(dayMs, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(dayMs);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  /** Момент отрезка или «в своё время»: ISO; дата без времени — полночь. */
  const timeOf = (v) => (typeof v === 'string' && ISO_LIKE.test(v.trim()) ? msOf(v) : NaN);

  /** Срок задачи: ISO; дата без времени — 18:00 этого дня. */
  function dueMs(v) {
    if (typeof v !== 'string' || !ISO_LIKE.test(v.trim())) return NaN;
    const ms = msOf(v);
    return DATE_ONLY.test(v.trim()) && Number.isFinite(ms) ? atClock(ms, DUE_DEFAULT_TIME) : ms;
  }

  const hexOf = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

  // --- очистка текста -----------------------------------------------------------

  /** Что вычищается из текста, который прочтёт модель: управляющие символы
   *  (C0, DEL, C1 — кроме \t и \n), bidi-переопределения и изоляты
   *  (U+202A–202E, U+2066–2069, U+061C), символы нулевой ширины
   *  (U+200B–200F, U+2060–2064, U+180E, U+FEFF), невидимые «теги» Unicode
   *  (U+E0000–E007F) и дополнительные селекторы вариантов (U+E0100–E01EF) —
   *  двумя последними прячут целые фразы, которых человек не видит, а модель
   *  читает, — и одиночные половинки суррогатных пар. Флаг u: пара — один
   *  символ, одиночная половинка ловится диапазоном D800–DFFF. Та же строка —
   *  в index.ts функции (CLEAN), совпадение сверяет тест функции. */
  const CLEAN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\uD800-\uDFFF]/gu;

  /** Строка не длиннее n UTF-16 единиц, пара суррогатов не режется пополам. */
  function cutUnits(s, n) {
    if (s.length <= n) return s;
    let end = Math.max(0, n);
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
    return s.slice(0, end);
  }

  /** Текст для модели: \r\n и \r → \n, без управляющих (кроме \n и \t), bidi
   *  и невидимых символов (CLEAN), в NFC; max — обрезка без многоточия.
   *  Не строка — пустая строка. */
  function aiCleanText(s, max) {
    if (typeof s !== 'string') return '';
    let t = s.replace(/\r\n?/g, '\n').replace(CLEAN, '');
    try { t = t.normalize('NFC'); } catch (e) { /* без normalize — как есть */ }
    const n = Number(max);
    return max != null && Number.isFinite(n) && n >= 0 ? cutUnits(t, Math.floor(n)) : t;
  }

  /** Название в одну строку: очищено, пробелы схлопнуты, длиннее n — n-1
   *  знаков и «…». */
  function cleanName(v, n) {
    const t = aiCleanText(typeof v === 'string' ? v : (v == null ? '' : String(v))).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${cutUnits(t, n - 1).trimEnd()}…` : t;
  }
  const nameOf = (v) => cleanName(v, TITLE_MAX);

  // --- снимок -----------------------------------------------------------------

  const REPEAT_EN = {
    'repeat.desc_day': 'every day',
    'repeat.desc_day_n': 'every {n} days',
    'repeat.desc_week': 'every week',
    'repeat.desc_week_n': 'every {n} weeks',
    'repeat.desc_month': 'every month',
    'repeat.desc_month_n': 'every {n} months',
    'repeat.desc_year': 'every year',
    'repeat.desc_year_n': 'every {n} years',
    'repeat.desc_week_days': 'every week on {days}',
    'repeat.desc_week_days_n': 'every {n} weeks on {days}',
  };
  const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Повтор задачи словами для модели. Описание собирает describeRepeat
   *  (repeat.js) — ключ и подстановки; переводит их ядро само, по-английски:
   *  языка интерфейса модель не знает, а системный промпт у неё английский. */
  function repeatText(rule) {
    const r = R.normalizeRepeat(rule);
    const d = r && R.describeRepeat(r);
    if (!d) return null;
    const days = (d.vars.days || []).map((n) => DAY_EN[n]).join(', ');
    let text = (REPEAT_EN[d.key] || d.key).replace('{n}', String(d.vars.n)).replace('{days}', days);
    if (r.freq === 'month' && r.monthMode === 'weekday') text += ' (same weekday of the month)';
    if (r.ends.kind === 'after') text += `, ${r.ends.count} times (${r.done} done)`;
    if (r.ends.kind === 'on' && r.ends.at) text += `, until ${r.ends.at}`;
    return text;
  }

  /** Ближайшее, что у задачи стоит во времени: дедлайн или следующее
   *  вхождение отрезка (прошедший разовый отрезок — его начало). NaN — ничего. */
  function anchorOf(task, now) {
    let best = msOf(task.dueAt);
    const rule = S.slotRule(task);
    for (const slot of S.slotsOf(task)) {
      const next = S.slotOccurrences(slot, now, A.addDaysMs(now, 400), 1, rule)[0];
      const at = next ? next.start : msOf(slot.start);
      if (Number.isFinite(at) && !(at >= best)) best = at;
    }
    return best;
  }

  /** Снимок данных для модели — второй блок системного промпта.
   *
   *  Открытые задачи (не done и не cancelled) — до 200: сначала те, у кого
   *  ближе дедлайн или отрезок (просроченные — первыми), потом по свежести
   *  правки. Закрытые за последние 3 дня — до 30, свежие первыми: «что я
   *  успел» и «верни задачу» без них не ответить. Названия — до 80 знаков.
   *
   *  Ничего лишнего: ни почты, ни ставок и денег, ни заметок, ни записей
   *  времени — только их сумма минутами (spentMin).
   *
   *  Названия — через aiCleanText и в одну строку: невидимые символы и
   *  переводы строк в имени задачи — способ подсунуть модели «инструкцию»,
   *  которой человек на экране не видит.
   *
   *  @param {{now, tz, lang, focus: {view, projectId, taskId}}} opts */
  function aiSnapshot(state, opts) {
    const st = state || {};
    const o = opts || {};
    const now = nowOf(o.now);
    const statuses = st.statuses || [];
    const versions = st.versions || [];
    const projects = (st.projects || []).filter(Boolean).map((p) => ({
      id: p.id,
      name: nameOf(p.name),
      statuses: ST.orderedStatuses(statuses, p.id).map((s) => ({ id: s.id, name: nameOf(s.name), kind: s.kind })),
      versions: V.versionsOf(versions, p.id).map((v) => (v.releasedAt
        ? { id: v.id, name: nameOf(v.name), released: true }
        : { id: v.id, name: nameOf(v.name) })),
    }));
    const tags = (st.tags || []).filter(Boolean).map((tg) => ({ id: tg.id, name: nameOf(tg.name), project: tg.projectId || null }));

    const all = (st.tasks || []).filter(Boolean);
    const since = A.addDaysMs(now, -CLOSED_DAYS);
    const open = [];
    const closed = [];
    for (const task of all) {
      if (task.done || task.cancelled) {
        const at = msOf(task.doneAt) || msOf(task.updatedAt);
        if (at >= since) closed.push({ task, at });
      } else {
        open.push({ task, at: anchorOf(task, now), upd: msOf(task.updatedAt) || msOf(task.createdAt) || 0 });
      }
    }
    open.sort((a, b) => {
      const fa = Number.isFinite(a.at);
      const fb = Number.isFinite(b.at);
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && a.at !== b.at) return a.at - b.at;
      return b.upd - a.upd;
    });
    closed.sort((a, b) => b.at - a.at);

    const view = (task) => ({
      id: task.id,
      title: nameOf(task.title),
      project: task.projectId || null,
      status: task.statusId || null,
      version: task.versionId || null,
      tags: Array.isArray(task.tagIds) ? task.tagIds.slice() : [],
      dueAt: task.dueAt ? localIso(msOf(task.dueAt)) : null,
      slots: S.slotsOf(task).map((s) => ({ start: localIso(msOf(s.start)), end: localIso(msOf(s.end)) })),
      repeat: repeatText(task.repeat),
      done: !!task.done,
      cancelled: !!task.cancelled,
      spentMin: Math.round(F.taskElapsedMs(task, st.activeTimer, now) / MIN),
    });
    const shown = [...open.slice(0, OPEN_MAX), ...closed.slice(0, CLOSED_MAX)].map((x) => view(x.task));
    const f = isObj(o.focus) ? o.focus : {};
    const pick = (v) => (typeof v === 'string' && v ? v : null);
    return {
      now: localIso(now),
      tz: pick(o.tz),
      lang: pick(o.lang),
      weekStart: 1,
      focus: { view: pick(f.view), projectId: pick(f.projectId), taskId: pick(f.taskId) },
      projects,
      tags,
      tasks: shown,
      totals: { tasks: all.length, shown: shown.length },
    };
  }

  // --- инструменты модели -----------------------------------------------------

  /** Конец рабочих часов: как normClock, плюс '24:00' — до полуночи. */
  const normEnd = (v) => (typeof v === 'string' && v.trim() === '24:00' ? '24:00' : normClock(v));
  const daysOf = (v) => (Array.isArray(v)
    ? [...new Set(v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : null);

  /** Рабочие часы, в которых агент ищет свободное время: settings.workHours
   *  ({start, end, days}) — настройка устройства, — а чего в ней нет или что
   *  в ней не так (конец не позже начала, не время суток), — AI_WORK_HOURS.
   *  Пустой список дней — можно: человек сам так решил.
   *  @returns {start: 'HH:MM', end: 'HH:MM', days: [0..6]} — новый объект */
  function aiWorkHours(settings) {
    const w = isObj(settings) && isObj(settings.workHours) ? settings.workHours : {};
    const start = normClock(w.start);
    const end = normEnd(w.end);
    const pair = start && end && end > start;
    return {
      start: pair ? start : AI_WORK_HOURS.start,
      end: pair ? end : AI_WORK_HOURS.end,
      days: daysOf(w.days) || AI_WORK_HOURS.days.slice(),
    };
  }

  /** Часы для одного вызова free_windows: wh — часы человека (aiWorkHours),
   *  hours — то, что передала модель («вечером», «в выходные»): её поля
   *  заменяют поля wh. Конец не позже начала — окон нет. */
  function workHoursOf(wh, hours) {
    const base = aiWorkHours({ workHours: isObj(wh) ? wh : AI_WORK_HOURS });
    const h = isObj(hours) ? hours : {};
    return {
      start: normClock(h.start) || base.start,
      end: normEnd(h.end) || base.end,
      days: daysOf(h.days) || base.days,
    };
  }

  /** Склеивает пересекающиеся и соседние занятые отрезки: [[a, b], …] по порядку. */
  function mergeBusy(list) {
    const sorted = list.filter((x) => x[1] > x[0]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of sorted) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  }

  /** Свободные окна в рабочих часах — инструмент free_windows.
   *
   *  Занято то же, что на календаре: вхождения отрезков открытых задач
   *  (slotItems) и записи времени (sessionSegments). Окна — не раньше «сейчас»,
   *  округлённого вверх до 15 минут, внутри рабочего дня (поэтому и не
   *  длиннее него), не короче minMinutes, не больше 40 штук.
   *
   *  from / to — ISO; у to дата без времени включает весь день. workHours —
   *  часы человека (aiWorkHours(settings)), hours — вход модели: «вечером»,
   *  «в выходные» ({start, end, days}, любое поле можно опустить).
   *  @returns [{start, end, minutes}] — start и end местным ISO с поясом */
  function aiFreeWindows(state, opts) {
    const st = state || {};
    const o = opts || {};
    const now = nowOf(o.now);
    const wh = workHoursOf(o.workHours, o.hours);
    const minRaw = Number(o.minMinutes);
    const minMin = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 30;
    let from = edgeOf(o.from, false);
    let to = edgeOf(o.to, true);
    if (!Number.isFinite(from)) from = now;
    if (!Number.isFinite(to)) to = A.addDaysMs(A.startOfDayMs(from), 7);
    const lo = Math.max(from, Math.ceil(now / QUARTER_MS) * QUARTER_MS);
    if (!(to > lo) || wh.end <= wh.start) return [];

    const tasks = (st.tasks || []).filter(Boolean);
    const busy = mergeBusy([
      ...S.slotItems(tasks, lo, to).map((x) => [x.start, x.end]),
      ...A.sessionSegments(tasks, lo, to).map((x) => [x.start, x.end]),
    ]);
    const out = [];
    const push = (a, b) => {
      const minutes = Math.floor((b - a) / MIN);
      if (minutes >= minMin && out.length < WINDOWS_MAX) out.push({ start: localIso(a), end: localIso(b), minutes });
    };
    // Предохранитель — 400 дней: окон всё равно не больше 40.
    for (let day = A.startOfDayMs(lo), guard = 0; day < to && out.length < WINDOWS_MAX && guard < 400; day = A.addDaysMs(day, 1), guard += 1) {
      if (!wh.days.includes(new Date(day).getDay())) continue;
      let a = Math.max(atClock(day, wh.start), lo);
      const b = Math.min(atClock(day, wh.end), to);
      if (!(b > a)) continue;
      for (const [s, e] of busy) {
        if (e <= a) continue;
        if (s >= b) break;
        if (s > a) push(a, s);
        a = Math.max(a, e);
        if (a >= b) break;
      }
      if (b > a) push(a, b);
    }
    return out;
  }

  /** Сколько времени ушло — инструмент time_spent. Записи времени режутся
   *  границами диапазона (sessionSegments); идущий таймер считается до «сейчас».
   *  По умолчанию — с понедельника этой недели до «сейчас».
   *  @returns {from, to, totalMin, byProject: [{id, name, minutes}],
   *    byTask: [{id, title, minutes}] — 20 самых долгих} */
  function aiTimeSpent(state, opts) {
    const st = state || {};
    const o = opts || {};
    const now = nowOf(o.now);
    let to = edgeOf(o.to, true);
    if (!Number.isFinite(to)) to = now;
    let from = edgeOf(o.from, false);
    if (!Number.isFinite(from)) from = A.mondayOfMs(now);
    const projectId = typeof o.projectId === 'string' && o.projectId ? o.projectId : null;
    const timer = st.activeTimer;
    const tasks = (st.tasks || []).filter((t) => t && (!projectId || t.projectId === projectId)).map((t) => {
      if (!timer || timer.taskId !== t.id || !Number.isFinite(msOf(timer.startedAt))) return t;
      return { ...t, sessions: [...(t.sessions || []), { start: timer.startedAt, end: iso(now) }] };
    });
    const byProject = new Map();
    const byTask = new Map();
    let total = 0;
    const segs = to > from ? A.sessionSegments(tasks, from, to) : [];
    for (const seg of segs) {
      total += seg.ms;
      byProject.set(seg.projectId, (byProject.get(seg.projectId) || 0) + seg.ms);
      byTask.set(seg.taskId, (byTask.get(seg.taskId) || 0) + seg.ms);
    }
    const projects = st.projects || [];
    const all = st.tasks || [];
    const desc = (a, b) => b.minutes - a.minutes;
    return {
      from: localIso(from),
      to: localIso(to),
      totalMin: Math.round(total / MIN),
      byProject: [...byProject].map(([id, ms]) => {
        const p = projects.find((x) => x && x.id === id);
        return { id: id || null, name: p ? nameOf(p.name) : null, minutes: Math.round(ms / MIN) };
      }).sort(desc),
      byTask: [...byTask].map(([id, ms]) => {
        const t = all.find((x) => x && x.id === id);
        return { id, title: t ? nameOf(t.title) : null, minutes: Math.round(ms / MIN) };
      }).sort(desc).slice(0, TOP_TASKS),
    };
  }

  // --- предложение: проверка ---------------------------------------------------

  /** Проверка предложения propose_changes.
   *
   *  Ошибка — неизвестная операция, пустое название, неизвестный id, ref
   *  раньше объявления (или повтор ref), статус чужого проекта, кривая дата,
   *  отрезок с концом не позже начала или длиннее суток, повтор и напоминание,
   *  которые не принимает ядро. Сообщение — ключ перевода ('ai.err_unknown_id')
   *  и подстановки params ({field, value}, {op} или {ref}): переводит панель.
   *  'ai.invalid' с {field} — поле не того вида (не список, не объект, повтор
   *  или напоминание, которых ядро не принимает). index — номер операции в
   *  списке; -1 — сам список.
   *
   *  Ссылки в ops — настоящий id из state или ref, объявленный раньше в этом
   *  же списке. status — id статуса того же проекта или вид статуса
   *  (backlog, todo, progress, done, cancelled): у нового проекта id статусов
   *  ещё нет. Тег и версия с занятым именем заново не заводятся: их ref
   *  указывает на существующие (existing) — так требует и приложение.
   *
   *  @returns {ok, errors: [{index, message, params}], ops} — ops
   *    нормализованные (ссылки — {id} или {ref}, даты — ISO UTC) для aiApply;
   *    при ошибках — пустой список */
  function aiValidate(state, ops) {
    const st = state || {};
    const errors = [];
    const out = [];
    const fail = (index, message, params) => { errors.push(params ? { index, message, params } : { index, message }); };
    if (!Array.isArray(ops) || !ops.length) {
      fail(-1, 'ai.invalid', { field: 'ops' });
      return { ok: false, errors, ops: out };
    }
    const projects = new Set((st.projects || []).filter(Boolean).map((p) => p.id));
    const statuses = st.statuses || [];
    const versions = st.versions || [];
    const tags = st.tags || [];
    const taskById = new Map((st.tasks || []).filter(Boolean).map((t) => [t.id, t]));
    // Все ref списка заранее: «ссылка раньше объявления» и «такого нет» —
    // разные ошибки, и модели полезно знать, какую из двух она сделала.
    const later = new Set(ops.filter((x) => isObj(x) && typeof x.ref === 'string' && x.ref).map((x) => x.ref));
    // ref → {kind, project}: project — ключ проекта ('id:…' или 'ref:…'),
    // у тега null — общий.
    const refs = new Map();
    const missing = (s) => (s && later.has(s) && !refs.has(s) ? 'ai.err_ref' : 'ai.err_unknown_id');

    const projectRef = (index, v) => {
      const s = typeof v === 'string' ? v : '';
      const r = refs.get(s);
      if (r && r.kind === 'project') return { link: { ref: s }, key: `ref:${s}` };
      if (s && projects.has(s)) return { link: { id: s }, key: `id:${s}` };
      fail(index, missing(s), { field: 'project', value: s });
      return null;
    };
    const statusRef = (index, v, proj) => {
      if (v === undefined || v === null || v === '') return null;
      const s = String(v);
      const found = ST.getStatus(statuses, s);
      if (found) {
        if (proj.link.id && found.projectId === proj.link.id) return { id: s };
        fail(index, 'ai.err_status_project', { field: 'status', value: s });
        return BAD;
      }
      if (ST.STATUS_KINDS.includes(s)) return { kind: s };
      fail(index, 'ai.err_unknown_id', { field: 'status', value: s });
      return BAD;
    };
    const versionRef = (index, v, proj) => {
      if (v === undefined || v === null || v === '') return null;
      const s = String(v);
      const r = refs.get(s);
      if (r && r.kind === 'version') {
        if (r.project === proj.key) return { ref: s };
      } else {
        const found = versions.find((x) => x.id === s);
        if (found && proj.link.id && found.projectId === proj.link.id) return { id: s };
        if (!found) { fail(index, missing(s), { field: 'version', value: s }); return BAD; }
      }
      fail(index, 'ai.err_unknown_id', { field: 'version', value: s });
      return BAD;
    };
    const tagRefs = (index, v, proj) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) { fail(index, 'ai.invalid', { field: 'tags' }); return BAD; }
      const list = [];
      const seen = new Set();
      let bad = false;
      for (const item of v) {
        const s = typeof item === 'string' ? item : '';
        if (seen.has(s)) continue;
        seen.add(s);
        const r = refs.get(s);
        if (r && r.kind === 'tag') {
          if (r.project === null || r.project === proj.key) { list.push({ ref: s }); continue; }
        } else {
          const tg = tags.find((x) => x.id === s);
          if (tg && (!tg.projectId || (proj.link.id && tg.projectId === proj.link.id))) { list.push({ id: s }); continue; }
          if (!tg) { fail(index, missing(s), { field: 'tags', value: s }); bad = true; continue; }
        }
        fail(index, 'ai.err_unknown_id', { field: 'tags', value: s });
        bad = true;
      }
      return bad ? BAD : list;
    };
    const dueOf = (index, v) => {
      if (v === undefined || v === null || v === '') return null;
      const ms = dueMs(v);
      if (!Number.isFinite(ms)) { fail(index, 'ai.err_bad_date', { field: 'dueAt', value: String(v) }); return BAD; }
      return iso(ms);
    };
    const slotsOfOp = (index, v) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.length > SLOTS_MAX) { fail(index, 'ai.invalid', { field: 'slots' }); return BAD; }
      const list = [];
      let bad = false;
      v.forEach((s, i) => {
        const a = isObj(s) ? timeOf(s.start) : NaN;
        const b = isObj(s) ? timeOf(s.end) : NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          fail(index, 'ai.err_bad_date', { field: 'slots', value: isObj(s) ? String(Number.isFinite(a) ? s.end : s.start) : String(s) });
          bad = true;
          return;
        }
        if (b <= a || (b - a) / MIN > MAX_SPAN_MIN) {
          fail(index, 'ai.err_bad_slot', { field: 'slots', value: i + 1 });
          bad = true;
          return;
        }
        list.push({ start: iso(a), end: iso(b) });
      });
      return bad ? BAD : list;
    };
    const repeatOf = (index, v) => {
      if (v === undefined || v === null) return null;
      const ends = isObj(v) ? v.ends : undefined;
      const endsOk = ends === undefined || ends === null
        || (isObj(ends) && (ends.at === undefined || ends.at === null || (typeof ends.at === 'string' && DATE_ONLY.test(ends.at))));
      if (!isObj(v) || !R.REPEAT_FREQS.includes(v.freq) || !endsOk) { fail(index, 'ai.invalid', { field: 'repeat' }); return BAD; }
      return R.normalizeRepeat(v);
    };
    const remindersOfOp = (index, v) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.length > REMINDERS_MAX) { fail(index, 'ai.invalid', { field: 'reminders' }); return BAD; }
      const list = [];
      for (const r of v) {
        const kind = isObj(r) ? r.kind : null;
        let raw = null;
        if (kind === 'before') raw = { kind, anchor: r.anchor, offsetMin: r.offsetMin };
        else if (kind === 'at' && Number.isFinite(timeOf(r.at))) raw = { kind, at: iso(timeOf(r.at)) };
        // Вида «повторять» у модели нет: правило и время такого напоминания
        // ставит человек в окне задачи.
        const n = raw && M.normalizeReminder(raw);
        if (!n) { fail(index, 'ai.invalid', { field: 'reminders' }); return BAD; }
        list.push(n.kind === 'before' ? { kind: 'before', anchor: n.anchor, offsetMin: n.offsetMin } : { kind: 'at', at: n.at });
      }
      return list;
    };
    const notesOf = (index, v) => {
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string') { fail(index, 'ai.invalid', { field: 'notes' }); return BAD; }
      const s = v.trim();
      return s ? s.slice(0, NOTES_MAX) : null;
    };

    ops.forEach((raw, index) => {
      const before = errors.length;
      if (!isObj(raw) || !AI_OPS.includes(raw.op)) {
        fail(index, 'ai.err_unknown_op', { op: isObj(raw) && typeof raw.op === 'string' ? raw.op : '' });
        return;
      }
      const op = raw.op;
      let ref = null;
      if (op !== 'update_task') {
        // ref нужен, только чтобы сослаться дальше; без него — свой номер.
        ref = typeof raw.ref === 'string' && raw.ref ? raw.ref : `#${index + 1}`;
        if (refs.has(ref)) { fail(index, 'ai.err_ref', { ref }); return; }
      }

      if (op === 'create_project') {
        refs.set(ref, { kind: 'project', project: null });
        const name = str(raw.name);
        if (!name) { fail(index, 'ai.err_empty_title', { field: 'name' }); return; }
        out.push({ op, index, ref, name: name.slice(0, NAME_MAX), color: hexOf(raw.color), description: str(raw.description).slice(0, DESC_MAX) });
        return;
      }

      if (op === 'create_version') {
        const entry = { kind: 'version', project: null };
        refs.set(ref, entry);
        const proj = projectRef(index, raw.project);
        const name = str(raw.name);
        if (!name) fail(index, 'ai.err_empty_title', { field: 'name' });
        if (!proj || errors.length > before) return;
        entry.project = proj.key;
        // Версия с таким названием в проекте уже есть — вторую не заводим
        // (versionNameTaken), ref указывает на неё.
        const same = proj.link.id && V.versionNameTaken(versions, proj.link.id, name, null)
          ? V.versionsOf(versions, proj.link.id).find((x) => String(x.name || '').trim().toLowerCase() === name.toLowerCase())
          : null;
        out.push({ op, index, ref, project: proj.link, name: name.slice(0, NAME_MAX), ...(same ? { existing: same.id } : {}) });
        return;
      }

      if (op === 'create_tag') {
        const entry = { kind: 'tag', project: null };
        refs.set(ref, entry);
        const name = str(raw.name);
        if (!name) { fail(index, 'ai.err_empty_title', { field: 'name' }); return; }
        // Два тега с одним именем на глаз не различить (tags.js, nameTaken):
        // занятое имя — ссылка на тот, что есть.
        const same = TG.exactMatch(tags, name);
        if (same && same.projectId) entry.project = `id:${same.projectId}`;
        out.push({ op, index, ref, name: name.slice(0, NAME_MAX), color: hexOf(raw.color), ...(same ? { existing: same.id } : {}) });
        return;
      }

      if (op === 'create_task') {
        refs.set(ref, { kind: 'task', project: null });
        const proj = projectRef(index, raw.project);
        const title = str(raw.title);
        if (!title) fail(index, 'ai.err_empty_title', { field: 'title' });
        if (!proj) return;
        const status = statusRef(index, raw.status, proj);
        const version = versionRef(index, raw.version, proj);
        const tagList = tagRefs(index, raw.tags, proj);
        const dueAt = dueOf(index, raw.dueAt);
        const slots = slotsOfOp(index, raw.slots);
        const repeat = repeatOf(index, raw.repeat);
        const reminders = remindersOfOp(index, raw.reminders);
        const notes = notesOf(index, raw.notes);
        if (errors.length > before) return;
        out.push({ op, index, ref, project: proj.link, title: title.slice(0, NAME_MAX), status, version, tags: tagList, dueAt, slots, repeat, reminders, notes });
        return;
      }

      // update_task
      const task = typeof raw.id === 'string' ? taskById.get(raw.id) : null;
      if (!task) { fail(index, 'ai.err_unknown_id', { field: 'id', value: typeof raw.id === 'string' ? raw.id : '' }); return; }
      const p = raw.patch;
      if (!isObj(p) || !PATCH_KEYS.some((k) => own(p, k))) { fail(index, 'ai.invalid', { field: 'patch' }); return; }
      const proj = { link: { id: task.projectId }, key: `id:${task.projectId}` };
      const patch = {};
      if (own(p, 'title')) {
        const title = str(p.title);
        if (!title) fail(index, 'ai.err_empty_title', { field: 'title' });
        else patch.title = title.slice(0, NAME_MAX);
      }
      if (own(p, 'status')) {
        if (p.status === null || p.status === undefined || p.status === '') fail(index, 'ai.invalid', { field: 'status' });
        else patch.status = statusRef(index, p.status, proj);
      }
      if (own(p, 'version')) patch.version = versionRef(index, p.version, proj);
      if (own(p, 'tags')) patch.tags = tagRefs(index, p.tags, proj);
      if (own(p, 'dueAt')) patch.dueAt = dueOf(index, p.dueAt);
      if (own(p, 'slots')) patch.slots = slotsOfOp(index, p.slots);
      if (own(p, 'repeat')) patch.repeat = repeatOf(index, p.repeat);
      if (own(p, 'reminders')) patch.reminders = remindersOfOp(index, p.reminders);
      if (own(p, 'done')) {
        if (typeof p.done !== 'boolean') fail(index, 'ai.invalid', { field: 'done' });
        else patch.done = p.done;
      }
      if (own(p, 'notes')) patch.notes = notesOf(index, p.notes);
      if (errors.length > before) return;
      out.push({ op, index, id: task.id, patch });
    });

    return { ok: errors.length === 0, errors, ops: errors.length ? [] : out };
  }

  // --- предложение: применение и отмена ----------------------------------------

  /** Строки текста → абзацы документа (doc.js): строка — абзац, пустая —
   *  пустой абзац, пустые строки по краям отбрасываются. */
  function paragraphsOf(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    return lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }));
  }

  /** Заметки задачи из строки: новый документ или дописанный к прежнему. */
  function notesWith(prev, text) {
    const blocks = paragraphsOf(text);
    if (!blocks.length) return prev || null;
    const c = D.readNotes(prev || null);
    c.doc = { ...c.doc, content: D.isDocEmpty(c) ? blocks : [...c.doc.content, ...blocks] };
    return D.writeNotes(c);
  }

  /** Статус задачи — как setTaskStatus в app.js: done и cancelled следуют
   *  виду статуса, открытая задача перестаёт ждать дня возврата (planUntick). */
  function putStatus(statuses, task, statusId, at) {
    const s = ST.getStatus(statuses, statusId);
    if (!s) return;
    task.statusId = s.id;
    task.done = s.kind === 'done';
    task.cancelled = s.kind === 'cancelled';
    task.doneAt = task.done ? (task.doneAt || at) : null;
    if (!task.done) Object.assign(task, S.planUntick(task));
  }

  /** Применяет предложение к state на месте.
   *
   *  Сначала aiValidate: с ошибками не меняется ничего ({ok: false, errors}).
   *  Проект — как в окне проекта (app.js), с набором статусов по умолчанию
   *  (makeProjectStatuses) и цветом из палитры по кругу. Версия — в конец
   *  проекта. Тег — общий. Задача — ровно поля newTaskOnAgenda плюс отрезки
   *  со своими id; напоминания — через withReminders (зеркало старых полей).
   *  Заметки из строки — абзацами документа; в update_task они дописываются
   *  к прежним: модель заметок не видит и стирать их не должна.
   *  update_task: патч поверх задачи, updatedAt — now; done — по planTaskDone,
   *  как галочка; новый срок снимает notifiedAt, как правка срока руками.
   *
   *  Перекат повтора (planTaskRoll) здесь не делается: в closed — задачи,
   *  которые закрылись этим предложением, решать о них приложению.
   *
   *  undo (19 октября 2026) — по полям, а не копией задачи: для каждой
   *  изменённой задачи в undo.changes лежат только поля, которые поменяло
   *  предложение, — значение до (before) и сразу после (after); поле, которого
   *  у задачи не было, в before отсутствует. Записи времени (sessions,
   *  totalMs) предложение не трогает и в undo их нет. Для созданных задач —
   *  undo.made: [{id, after}], задача целиком сразу после применения: по ней
   *  aiUndo узнаёт, трогали ли задачу потом.
   *
   *  @param {{uid: () => string, now, statusName: (key) => string}} ctx
   *  @returns {ok, created: {projects, versions, tags, tasks}, updated,
   *    closed, undo} — списки id; undo — для aiUndo (JSON, можно хранить):
   *    {created: {projects, versions, tags, tasks, statuses},
   *     changes: [{id, before, after}], made: [{id, after}], done} */
  function aiApply(state, ops, ctx) {
    const none = () => ({ projects: [], versions: [], tags: [], tasks: [] });
    const check = aiValidate(state, ops);
    if (!check.ok) return { ok: false, errors: check.errors, created: none(), updated: [], closed: [], undo: null };
    const c = ctx || {};
    if (typeof c.uid !== 'function') throw new TypeError('aiApply: ctx.uid — функция, выдающая id');
    const at = iso(nowOf(c.now));
    const statusName = typeof c.statusName === 'function' ? c.statusName : (key) => key;
    for (const key of ['projects', 'statuses', 'versions', 'tags', 'tasks']) if (!Array.isArray(state[key])) state[key] = [];

    const made = new Map();
    const idOf = (link) => {
      if (!link) return null;
      return own(link, 'id') ? link.id : (made.get(link.ref) || null);
    };
    const statusOf = (link, projectId) => {
      if (!link) return ST.defaultStatusId(state.statuses, projectId, false);
      if (own(link, 'id')) return link.id;
      const pool = ST.statusesOfKind(state.statuses, projectId, link.kind);
      return pool[0] ? pool[0].id : ST.defaultStatusId(state.statuses, projectId, link.kind === 'done');
    };
    const created = none();
    const undo = { created: { ...none(), statuses: [] }, changes: [], made: [], done: false };
    const updated = [];
    const closed = [];
    const saved = new Map(); // id → задача до первой правки этим предложением

    for (const op of check.ops) {
      if (op.op === 'create_project') {
        const id = c.uid();
        state.projects.push({
          id, createdAt: at, pinnedAt: null, name: op.name, description: op.description,
          color: op.color || C.PALETTE[state.projects.length % C.PALETTE.length],
          tagIds: [], rate: null, currency: null,
        });
        const rows = ST.makeProjectStatuses(id, statusName);
        state.statuses.push(...rows);
        made.set(op.ref, id);
        created.projects.push(id);
        undo.created.statuses.push(...rows.map((r) => r.id));
      } else if (op.op === 'create_version') {
        if (op.existing) { made.set(op.ref, op.existing); continue; }
        const id = c.uid();
        const projectId = idOf(op.project);
        state.versions.push({ id, projectId, name: op.name, releasedAt: null, order: state.versions.filter((v) => v.projectId === projectId).length });
        made.set(op.ref, id);
        created.versions.push(id);
      } else if (op.op === 'create_tag') {
        if (op.existing) { made.set(op.ref, op.existing); continue; }
        const id = c.uid();
        state.tags.push({ id, name: op.name, color: op.color || C.PALETTE[state.tags.length % C.PALETTE.length], projectId: null });
        made.set(op.ref, id);
        created.tags.push(id);
      } else if (op.op === 'create_task') {
        const id = c.uid();
        const projectId = idOf(op.project);
        const task = {
          id, projectId, title: op.title, done: false, notes: op.notes ? notesWith(null, op.notes) : null,
          totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: at, updatedAt: at,
          statusId: statusOf(op.status, projectId), tagIds: op.tags.map(idOf), versionId: idOf(op.version),
          repeat: op.repeat, cancelled: false,
          dueAt: op.dueAt, reminders: [], remindOffsetMin: null, remindAt: null, notifiedAt: null,
          slots: op.slots.map((s) => S.normalizeSlot({ id: c.uid(), start: s.start, end: s.end })),
        };
        if (op.reminders.length) Object.assign(task, M.withReminders(task, op.reminders));
        const st = ST.getStatus(state.statuses, task.statusId);
        if (st && ST.CLOSING_KINDS.includes(st.kind)) putStatus(state.statuses, task, st.id, at);
        state.tasks.unshift(task);
        made.set(op.ref, id);
        created.tasks.push(id);
        if (task.done) closed.push(id);
      } else {
        const task = state.tasks.find((t) => t && t.id === op.id);
        if (!saved.has(task.id)) saved.set(task.id, clone(task));
        const wasDone = !!task.done;
        const p = op.patch;
        if (own(p, 'title')) task.title = p.title;
        if (own(p, 'status')) putStatus(state.statuses, task, statusOf(p.status, task.projectId), at);
        if (own(p, 'version')) task.versionId = idOf(p.version);
        if (own(p, 'tags')) task.tagIds = p.tags.map(idOf);
        if (own(p, 'dueAt') && (task.dueAt || null) !== p.dueAt) {
          task.dueAt = p.dueAt;
          task.notifiedAt = null;
        }
        if (own(p, 'slots')) task.slots = p.slots.map((s) => S.normalizeSlot({ id: c.uid(), start: s.start, end: s.end }));
        if (own(p, 'repeat')) task.repeat = p.repeat;
        if (own(p, 'reminders')) Object.assign(task, M.withReminders(task, p.reminders));
        if (own(p, 'notes') && p.notes) task.notes = notesWith(task.notes, p.notes);
        if (own(p, 'done')) {
          const plan = ST.planTaskDone(state.statuses, task, p.done);
          if (plan.moveTo) putStatus(state.statuses, task, plan.moveTo, at);
          else {
            task.done = plan.setDone;
            task.doneAt = plan.setDone ? (task.doneAt || at) : null;
            if (!plan.setDone) Object.assign(task, S.planUntick(task));
          }
        }
        task.updatedAt = at;
        if (!updated.includes(task.id)) updated.push(task.id);
        if (!wasDone && task.done && !closed.includes(task.id)) closed.push(task.id);
      }
    }
    Object.assign(undo.created, created);
    const taskOf = (id) => state.tasks.find((t) => t && t.id === id);
    for (const [id, prev] of saved) {
      const ch = fieldChanges(prev, taskOf(id));
      if (ch) undo.changes.push({ id, ...ch });
    }
    for (const id of created.tasks) undo.made.push({ id, after: clone(taskOf(id)) });
    return { ok: true, created, updated, closed, undo: clone(undo) };
  }

  // --- отмена по полям (19 октября 2026) ---------------------------------------
  //
  // Раньше aiUndo клал на место изменённой задачи её копию до применения — и
  // стирал всё, что с задачей сделали после: записи времени, переименование,
  // заметки. Теперь поле возвращается, только если оно всё ещё такое, каким
  // его оставило предложение.

  /** Записи времени: их отмена не трогает никогда. */
  const UNDO_TIME = new Set(['sessions', 'totalMs']);
  /** Служебные поля: их меняет само приложение (любая правка — updatedAt,
   *  сработавшее напоминание — notifiedAt). Возвращаются по тому же правилу,
   *  но причиной «не отменено» не считаются. */
  const UNDO_QUIET = new Set(['updatedAt', 'notifiedAt']);
  /** Поля, которые пишутся вместе (putStatus, planUntick, withReminders):
   *  возвращаются вместе или не возвращаются вовсе — иначе статус «в работе»
   *  при done: true. */
  const UNDO_GROUPS = [
    ['statusId', 'done', 'cancelled', 'doneAt', 'reopenAt', 'repeat'],
    ['reminders', 'remindOffsetMin', 'remindAt'],
  ];
  const undoGroupOf = (key) => {
    const g = UNDO_GROUPS.findIndex((list) => list.includes(key));
    return g >= 0 ? `g${g}` : `f:${key}`;
  };

  /** Глубокое равенство значений из JSON: порядок ключей не важен, ключ со
   *  значением undefined — то же, что его отсутствие. */
  function sameJson(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameJson(a[k], b[k]));
  }

  /** «Сейчас поле такое, каким его оставило предложение?» Отметка
   *  сработавшего напоминания (notifiedAt внутри reminders) — не правка. */
  function sameAsLeft(key, cur, after) {
    if (key !== 'reminders' || !Array.isArray(cur) || !Array.isArray(after)) return sameJson(cur, after);
    const bare = (list) => list.map((r) => (isObj(r) ? { ...r, notifiedAt: undefined } : r));
    return sameJson(bare(cur), bare(after));
  }

  const fieldOf = (o, key) => (own(o, key) ? o[key] : undefined);
  const keysOf = (...objs) => [...new Set(objs.flatMap((o) => (isObj(o) ? Object.keys(o) : [])))];

  /** Поля, которые поменялись между prev и next, кроме записей времени:
   *  {before, after} или null — не поменялось ничего. */
  function fieldChanges(prev, next) {
    if (!isObj(prev) || !isObj(next)) return null;
    const before = {};
    const after = {};
    for (const key of keysOf(prev, next)) {
      if (key === 'id' || UNDO_TIME.has(key) || sameJson(fieldOf(prev, key), fieldOf(next, key))) continue;
      if (own(prev, key) && prev[key] !== undefined) before[key] = clone(prev[key]);
      if (own(next, key) && next[key] !== undefined) after[key] = clone(next[key]);
    }
    return keysOf(before, after).length ? { before, after } : null;
  }

  /** Возвращает поля одной задачи по записи undo.changes. Группа полей
   *  возвращается, только если каждое её поле сейчас такое, каким его
   *  оставило предложение. @returns {reverted, left} — вернули ли что-то
   *  и осталось ли не возвращённым что-то кроме служебных полей */
  function revertFields(task, ch) {
    const before = isObj(ch.before) ? ch.before : {};
    const after = isObj(ch.after) ? ch.after : {};
    const groups = new Map();
    for (const key of keysOf(before, after)) {
      if (key === 'id' || UNDO_TIME.has(key)) continue;
      const g = undoGroupOf(key);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(key);
    }
    let reverted = false;
    let left = false;
    for (const keys of groups.values()) {
      if (keys.every((key) => sameAsLeft(key, fieldOf(task, key), fieldOf(after, key)))) {
        for (const key of keys) {
          if (own(before, key) && before[key] !== undefined) task[key] = clone(before[key]);
          else delete task[key];
        }
        if (keys.some((key) => !UNDO_QUIET.has(key))) reverted = true;
      } else if (keys.some((key) => !UNDO_QUIET.has(key))) left = true;
    }
    return { reverted, left };
  }

  /** Трогали ли созданную задачу после применения. after — из undo.made; у
   *  undo старого формата его нет, и тогда задача считается тронутой, если
   *  её updatedAt ушёл от createdAt (aiApply ставит их одинаковыми). */
  function touchedSince(task, after) {
    if (!isObj(after)) return fieldOf(task, 'updatedAt') !== fieldOf(task, 'createdAt');
    return keysOf(task, after).some((key) => !UNDO_TIME.has(key) && !UNDO_QUIET.has(key)
      && !sameAsLeft(key, fieldOf(task, key), fieldOf(after, key)));
  }

  /** По задаче есть время: записи, итог или идущий таймер. */
  const hasTime = (state, task) => (Array.isArray(task.sessions) && task.sessions.length > 0)
    || Number(task.totalMs) > 0
    || !!(isObj(state.activeTimer) && state.activeTimer.taskId === task.id);

  /** Отменяет применённое предложение — по полям (19 октября 2026).
   *
   *  Изменённая задача: поле из undo.changes возвращается к before, только
   *  если сейчас оно глубоко равно after — то есть его никто не менял после
   *  применения; иначе поле остаётся как есть. Поля, которые пишутся вместе
   *  (статус с done/doneAt, напоминания с зеркалом), возвращаются вместе.
   *  Записи времени (sessions, totalMs) отмена не трогает никогда.
   *
   *  Созданная задача уходит, только если после применения её не меняли и
   *  по ней нет времени (записей, итога, идущего таймера); иначе остаётся —
   *  а с ней её проект, версия и теги. Созданные версии и теги уходят (если
   *  ещё есть и их не держит оставшаяся задача агента): тег снимается со
   *  всего, куда его успели поставить, задачи версии уходят в «Без версии» —
   *  как при удалении руками. Созданный проект уходит со своими статусами и
   *  версиями, только если в нём не осталось задач: задачу, заведённую в нём
   *  уже руками, отмена не трогает.
   *
   *  Старый формат undo (копии задач целиком в before, без changes — был
   *  только в незакоммиченных сборках) задачи не трогает: каждая — в kept
   *  с 'changed'. undo помечается использованным — повторный вызов ничего
   *  не делает.
   *  @returns {removed: {projects, versions, tags, tasks}, restored: [id],
   *    kept: [{id, reason: 'changed' | 'time'}]} — restored: задачи, у
   *    которых что-то вернулось; kept: что не отменено и почему — клиент
   *    показывает тост ai.undo_kept, если kept не пуст */
  function aiUndo(state, undo) {
    const res = { removed: { projects: 0, versions: 0, tags: 0, tasks: 0 }, restored: [], kept: [] };
    if (!isObj(state) || !isObj(undo) || undo.done || !isObj(undo.created)) return res;
    undo.done = true;
    const ids = (key) => new Set(Array.isArray(undo.created[key]) ? undo.created[key] : []);
    const listOf = (key) => (Array.isArray(state[key]) ? state[key] : []);
    const taskOf = (id) => listOf('tasks').find((t) => t && t.id === id) || null;
    const keep = (id, reason) => { if (!res.kept.some((k) => k.id === id)) res.kept.push({ id, reason }); };
    const drop = (key, set) => {
      if (!set.size || !Array.isArray(state[key])) return 0;
      const n = state[key].length;
      state[key] = state[key].filter((x) => !(x && set.has(x.id)));
      return n - state[key].length;
    };

    if (Array.isArray(undo.changes)) {
      for (const ch of undo.changes) {
        const task = isObj(ch) ? taskOf(ch.id) : null;
        if (!task) continue;
        const { reverted, left } = revertFields(task, ch);
        if (reverted) res.restored.push(task.id);
        if (left) keep(task.id, 'changed');
      }
    } else {
      for (const copy of Array.isArray(undo.before) ? undo.before : []) {
        if (isObj(copy) && taskOf(copy.id)) keep(copy.id, 'changed');
      }
    }

    const madeAfter = new Map((Array.isArray(undo.made) ? undo.made : []).filter(isObj).map((m) => [m.id, m.after]));
    const goneTasks = new Set();
    const stay = []; // созданные задачи, которые остаются
    for (const id of ids('tasks')) {
      const task = taskOf(id);
      if (!task) continue;
      const reason = hasTime(state, task) ? 'time' : touchedSince(task, madeAfter.get(id)) ? 'changed' : null;
      if (reason) { keep(id, reason); stay.push(task); } else goneTasks.add(id);
    }
    res.removed.tasks = drop('tasks', goneTasks);
    const held = new Set(stay.flatMap((t) => [t.versionId, ...(Array.isArray(t.tagIds) ? t.tagIds : [])]));
    const unheld = (key) => new Set([...ids(key)].filter((id) => !held.has(id)));

    const tags = unheld('tags');
    res.removed.tags = drop('tags', tags);
    if (tags.size) {
      for (const x of [...listOf('tasks'), ...listOf('projects')]) {
        if (x && Array.isArray(x.tagIds) && x.tagIds.some((id) => tags.has(id))) x.tagIds = x.tagIds.filter((id) => !tags.has(id));
      }
    }

    const versions = unheld('versions');
    res.removed.versions = drop('versions', versions);
    for (const t of listOf('tasks')) if (t && versions.has(t.versionId)) t.versionId = null;

    const busy = new Set(listOf('tasks').map((t) => t && t.projectId));
    const gone = new Set([...ids('projects')].filter((id) => !busy.has(id)));
    if (gone.size) {
      res.removed.projects = drop('projects', gone);
      if (Array.isArray(state.statuses)) state.statuses = state.statuses.filter((s) => !(s && gone.has(s.projectId)));
      if (Array.isArray(state.versions)) state.versions = state.versions.filter((v) => !(v && gone.has(v.projectId)));
      for (const d of listOf('documents')) if (d && gone.has(d.projectId)) d.projectId = null;
    }
    return res;
  }

  /** Строки карточки предложения — по исходным ops, в том же порядке.
   *  Имена подставлены: из state или из create_* выше в этом же списке. Даты
   *  — ISO (дата без времени у срока — 18:00), форматирует панель. repeat —
   *  {key, vars} от describeRepeat; снятый повтор — {key: 'repeat.none'}.
   *  У тега, чьё имя уже занято, exists — id существующего: заводиться он
   *  не будет. Строки строятся и для неверных операций — ошибки к ним панель
   *  прикладывает по index.
   *  @param {{statusName?: (key) => string}} [opts] — имя статуса нового
   *    проекта, как у aiApply
   *  @returns [{index, kind, title, sub: {project, status, version, tags,
   *    dueAt, slots, repeat, done, notes}, ref | id, exists?}] */
  function aiProposalRows(state, ops, opts) {
    const st = state || {};
    const statusName = opts && typeof opts.statusName === 'function' ? opts.statusName : null;
    const declared = new Map();
    const nameIn = (kind, list, v) => {
      if (typeof v !== 'string' || !v) return null;
      const r = declared.get(v);
      if (r && r.kind === kind) return r.name;
      const x = (list || []).find((y) => y && y.id === v);
      return x ? x.name : null;
    };
    const statusLabel = (v, projectId) => {
      if (v === undefined || v === null || v === '') return null;
      const s = ST.getStatus(st.statuses || [], String(v));
      if (s) return s.name;
      if (!ST.STATUS_KINDS.includes(v)) return null;
      const pool = projectId ? ST.statusesOfKind(st.statuses || [], projectId, v) : [];
      if (pool[0]) return pool[0].name;
      const d = ST.DEFAULT_STATUSES.find((x) => x.kind === v);
      return d && statusName ? statusName(d.key) : v;
    };
    const dateOut = (v, due) => {
      if (typeof v !== 'string' || !v) return null;
      const ms = due ? dueMs(v) : timeOf(v);
      return Number.isFinite(ms) ? iso(ms) : v;
    };
    const slotsOut = (v) => (Array.isArray(v) ? v.filter(isObj).map((s) => ({ start: dateOut(s.start), end: dateOut(s.end) })) : []);
    const repeatOut = (v) => (v === null ? { key: 'repeat.none', vars: {} } : isObj(v) ? R.describeRepeat(v) : null);
    const tagsOut = (v) => (Array.isArray(v) ? v.map((x) => nameIn('tag', st.tags, x)).filter(Boolean) : []);
    const blank = () => ({ project: null, status: null, version: null, tags: [], dueAt: null, slots: [], repeat: null, done: null, notes: false });

    return (Array.isArray(ops) ? ops : []).map((raw, index) => {
      const o = isObj(raw) ? raw : {};
      const kind = typeof o.op === 'string' ? o.op : '';
      const row = { index, kind, title: '', sub: blank() };
      if (kind === 'update_task') {
        const task = (st.tasks || []).find((t) => t && t.id === o.id) || null;
        const p = isObj(o.patch) ? o.patch : {};
        const pid = task ? task.projectId : null;
        row.id = typeof o.id === 'string' ? o.id : null;
        row.title = str(p.title) || (task ? task.title || '' : '');
        row.sub.project = nameIn('project', st.projects, pid);
        if (own(p, 'status')) row.sub.status = statusLabel(p.status, pid);
        if (own(p, 'version')) row.sub.version = nameIn('version', st.versions, p.version);
        if (own(p, 'tags')) row.sub.tags = tagsOut(p.tags);
        if (own(p, 'dueAt')) row.sub.dueAt = dateOut(p.dueAt, true);
        if (own(p, 'slots')) row.sub.slots = slotsOut(p.slots);
        if (own(p, 'repeat')) row.sub.repeat = repeatOut(p.repeat);
        if (typeof p.done === 'boolean') row.sub.done = p.done;
        row.sub.notes = typeof p.notes === 'string' && !!p.notes.trim();
        return row;
      }
      row.ref = typeof o.ref === 'string' && o.ref ? o.ref : `#${index + 1}`;
      if (kind === 'create_project' || kind === 'create_version' || kind === 'create_tag') {
        row.title = str(o.name);
        if (kind === 'create_version') row.sub.project = nameIn('project', st.projects, o.project);
        if (kind === 'create_tag') {
          const same = row.title ? TG.exactMatch(st.tags || [], row.title) : null;
          if (same) row.exists = same.id;
        }
        declared.set(row.ref, { kind: kind.slice('create_'.length), name: row.title });
        return row;
      }
      if (kind === 'create_task') {
        const known = typeof o.project === 'string' && !declared.has(o.project) && (st.projects || []).some((x) => x && x.id === o.project);
        row.title = str(o.title);
        row.sub = {
          ...row.sub,
          project: nameIn('project', st.projects, o.project),
          status: statusLabel(o.status, known ? o.project : null),
          version: nameIn('version', st.versions, o.version),
          tags: tagsOut(o.tags),
          dueAt: dateOut(o.dueAt, true),
          slots: slotsOut(o.slots),
          repeat: o.repeat === null ? null : repeatOut(o.repeat),
          notes: typeof o.notes === 'string' && !!o.notes.trim(),
        };
        declared.set(row.ref, { kind: 'task', name: row.title });
      }
      return row;
    });
  }

  // --- поток ------------------------------------------------------------------

  /** Один кадр SSE → {event, data}; data — разобранный JSON или строка. */
  function parseFrame(frame) {
    let event = null;
    const data = [];
    for (const line of frame.split('\n')) {
      if (!line || line[0] === ':') continue;
      const at = line.indexOf(':');
      const field = at < 0 ? line : line.slice(0, at);
      let value = at < 0 ? '' : line.slice(at + 1);
      if (value[0] === ' ') value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (event === null && !data.length) return null;
    const text = data.join('\n');
    let parsed = text;
    try { parsed = JSON.parse(text); } catch (e) { /* не JSON — строкой */ }
    return { event: event || 'message', data: data.length ? parsed : null };
  }

  /** Режет накопленный текст потока на кадры SSE.
   *  @param {string} buffer — хвост прошлого вызова плюс новый кусок
   *  @returns {events: [{event, data}], rest} — rest вернуть в следующий
   *    вызов: последний кадр может быть ещё не дописан */
  function aiParseSse(buffer) {
    let text = typeof buffer === 'string' ? buffer : '';
    // \r в самом конце может оказаться половиной \r\n — ждём следующий кусок.
    let hold = '';
    if (text.endsWith('\r')) { hold = '\r'; text = text.slice(0, -1); }
    text = text.replace(/\r\n?/g, '\n');
    const events = [];
    let start = 0;
    let end = text.indexOf('\n\n', start);
    while (end >= 0) {
      const ev = parseFrame(text.slice(start, end));
      if (ev) events.push(ev);
      start = end + 2;
      end = text.indexOf('\n\n', start);
    }
    return { events, rest: text.slice(start) + hold };
  }

  const freshAcc = () => ({
    text: '', blocks: [], stopReason: null, stopDetails: null, usage: { input: 0, output: 0 },
    error: null, remaining: null, limit: null, model: null, done: false,
  });

  /** Чистый редьюсер потока Anthropic: acc и событие → новый acc, старый не
   *  меняется. Первый вызов — с acc = null.
   *
   *  acc = {text, blocks, stopReason, stopDetails, usage: {input, output},
   *         error, remaining, limit, model, done}
   *  blocks[index] — {type:'text', text} | {type:'tool_use', id, name, input,
   *    json} | {type:'thinking', thinking, signature} | любой другой блок как
   *    пришёл (redacted_thinking; fallback — место, где ответ продолжила
   *    другая модель).
   *  Вход tool_use разбирается на content_block_stop; не разобрался — error
   *  {type:'tool_json', index, message}, input остаётся {}.
   *  usage.input — весь промпт: свежие токены плюс записанные в кеш и
   *  прочитанные из него. Событие lancible — первый кадр функции ai-chat:
   *  remaining, limit, model. */
  function aiStreamStep(acc, ev) {
    const a = acc
      ? { ...acc, usage: { ...(acc.usage || { input: 0, output: 0 }) }, blocks: (acc.blocks || []).slice() }
      : freshAcc();
    if (!ev) return a;
    const d = isObj(ev.data) ? ev.data : {};
    const type = ev.event && ev.event !== 'message' ? ev.event : d.type;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    if (type === 'lancible') {
      if (typeof d.remaining === 'number') a.remaining = d.remaining;
      if (typeof d.limit === 'number') a.limit = d.limit;
      if (typeof d.model === 'string') a.model = d.model;
    } else if (type === 'message_start') {
      const m = isObj(d.message) ? d.message : {};
      const u = isObj(m.usage) ? m.usage : {};
      a.usage.input = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
      a.usage.output = num(u.output_tokens);
      if (typeof m.model === 'string') a.model = m.model;
    } else if (type === 'content_block_start') {
      const i = d.index;
      const cb = isObj(d.content_block) ? d.content_block : {};
      if (Number.isInteger(i) && i >= 0) {
        if (cb.type === 'text') a.blocks[i] = { type: 'text', text: typeof cb.text === 'string' ? cb.text : '' };
        else if (cb.type === 'tool_use') a.blocks[i] = { type: 'tool_use', id: cb.id, name: cb.name, input: {}, json: '' };
        else if (cb.type === 'thinking') a.blocks[i] = { type: 'thinking', thinking: cb.thinking || '', signature: cb.signature || '' };
        else a.blocks[i] = { ...cb };
        if (cb.type === 'text' && cb.text) a.text += cb.text;
      }
    } else if (type === 'content_block_delta') {
      const i = d.index;
      const b = a.blocks[i];
      const delta = isObj(d.delta) ? d.delta : {};
      if (b) {
        if (delta.type === 'text_delta' && b.type === 'text') {
          a.blocks[i] = { ...b, text: b.text + (delta.text || '') };
          a.text += delta.text || '';
        } else if (delta.type === 'input_json_delta' && b.type === 'tool_use') {
          a.blocks[i] = { ...b, json: b.json + (delta.partial_json || '') };
        } else if (delta.type === 'thinking_delta' && b.type === 'thinking') {
          a.blocks[i] = { ...b, thinking: b.thinking + (delta.thinking || '') };
        } else if (delta.type === 'signature_delta' && b.type === 'thinking') {
          a.blocks[i] = { ...b, signature: b.signature + (delta.signature || '') };
        }
      }
    } else if (type === 'content_block_stop') {
      const i = d.index;
      const b = a.blocks[i];
      if (b && b.type === 'tool_use') {
        let input = {};
        try {
          input = b.json.trim() ? JSON.parse(b.json) : {};
        } catch (e) {
          a.error = { type: 'tool_json', index: i, message: String(e && e.message) };
        }
        a.blocks[i] = { ...b, input: isObj(input) ? input : {} };
      }
    } else if (type === 'message_delta') {
      const delta = isObj(d.delta) ? d.delta : {};
      if (delta.stop_reason !== undefined) a.stopReason = delta.stop_reason;
      if (delta.stop_details !== undefined) a.stopDetails = delta.stop_details;
      if (isObj(d.usage) && typeof d.usage.output_tokens === 'number') a.usage.output = d.usage.output_tokens;
    } else if (type === 'message_stop') {
      a.done = true;
    } else if (type === 'error') {
      a.error = isObj(d.error) ? { ...d.error } : { type: 'error', message: typeof ev.data === 'string' ? ev.data : '' };
    }
    return a;
  }

  /** Ответ модели для истории — {role: 'assistant', content}.
   *
   *  Блоки — как пришли, в формате Messages API: текст (пустой — нет, API его
   *  не принимает), tool_use с разобранным входом, thinking с подписью и
   *  redacted_thinking — их модели надо возвращать неизменными. Если ответ на
   *  полпути продолжила другая модель (блок fallback), всё, кроме текста, что
   *  было до последнего такого блока, назад не идёт — так требует API; сам
   *  fallback — пометка, в историю не идёт. content бывает пустым (отказ до
   *  первого слова) — такой ответ в историю класть не нужно. */
  function aiAssistantMessage(acc) {
    const blocks = (acc && Array.isArray(acc.blocks) ? acc.blocks : []).filter(Boolean);
    let edge = -1;
    blocks.forEach((b, i) => { if (b.type === 'fallback') edge = i; });
    const content = [];
    blocks.forEach((b, i) => {
      if (b.type === 'text') {
        if (b.text) content.push({ type: 'text', text: b.text });
        return;
      }
      if (i < edge) return;
      if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: isObj(b.input) ? b.input : {} });
      else if (b.type === 'thinking' && b.signature) content.push({ type: 'thinking', thinking: b.thinking || '', signature: b.signature });
      else if (b.type === 'redacted_thinking' && b.data) content.push({ type: 'redacted_thinking', data: b.data });
    });
    return { role: 'assistant', content };
  }

  /** Тратит ли вызов дневной лимит: последнее сообщение — от человека, и в нём
   *  есть текст (строка или блок text) или вложение (image, document): файл
   *  без подписи — тоже сообщение. Последнее из одних tool_result — круг
   *  инструментов, он бесплатный. То же правило — в функции ai-chat; решает
   *  она, здесь — только для подписи в панели. */
  function aiCountsAsMessage(messages) {
    const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
    if (!isObj(last) || last.role !== 'user') return false;
    if (typeof last.content === 'string') return !!last.content.trim();
    return Array.isArray(last.content)
      && last.content.some((b) => isObj(b) && ((b.type === 'text' && typeof b.text === 'string' && !!b.text.trim()) || isAttachBlock(b)));
  }

  // --- пересечения отрезков ------------------------------------------------------


  /** Пересечения отрезков предложения — для предупреждения на карточке, а не
   *  для запрета: задача ставится на любое время, и пересекаться задачам
   *  можно (решение 18 октября 2026).
   *
   *  Отрезок create_task или update_task (patch.slots) сверяется с плановыми
   *  блоками остальных задач — с повторами, через Core.slotOverlaps
   *  (slots.js), — и с отрезками других операций этого же предложения.
   *  Задачи, чьи отрезки предложение заменяет или которые оно закрывает
   *  (done, статус вида «готово» и «отменено»), считаются уже без старых
   *  отрезков: «перенеси A на место B, а B — на завтра» пересечением не
   *  будет. Свой отрезок сверяется только по первому вхождению.
   *  С ошибками в предложении (aiValidate) — пустой список.
   *  @returns [{index, slot: {start, end}, taskId, title, start, end, ref?}]
   *    — index — номер операции, slot — её отрезок (ISO UTC); taskId, title,
   *    start, end — с чем пересекается; ref — у задачи из этого же
   *    предложения (taskId у новой — null) */
  function aiSlotConflicts(state, ops) {
    const st = state || {};
    const check = aiValidate(st, ops);
    if (!check.ok || typeof S.slotOverlaps !== 'function') return [];
    const statuses = st.statuses || [];
    const tasks = (st.tasks || []).filter(Boolean);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const closes = (link) => {
      if (!link) return false;
      if (own(link, 'kind')) return ST.CLOSING_KINDS.includes(link.kind);
      const s = ST.getStatus(statuses, link.id);
      return !!s && ST.CLOSING_KINDS.includes(s.kind);
    };
    const replaced = new Set();
    const mine = [];
    for (const op of check.ops) {
      if (op.op === 'create_task') {
        if (closes(op.status)) continue;
        for (const s of op.slots) mine.push({ index: op.index, slot: s, taskId: null, ref: op.ref, title: op.title, self: null });
      } else if (op.op === 'update_task') {
        const p = op.patch;
        const closed = p.done === true || (own(p, 'status') && closes(p.status));
        if (closed || own(p, 'slots')) replaced.add(op.id);
        if (closed || !own(p, 'slots')) continue;
        const task = byId.get(op.id);
        const title = p.title || (task && task.title) || '';
        for (const s of p.slots) mine.push({ index: op.index, slot: s, taskId: op.id, ref: null, title, self: op.id });
      }
    }
    const others = tasks.filter((t) => !replaced.has(t.id));
    const out = [];
    const seen = new Set();
    const push = (m, hit) => {
      const key = `${m.index}|${m.slot.start}|${m.slot.end}|${hit.taskId || hit.ref}|${hit.start}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ index: m.index, slot: { start: m.slot.start, end: m.slot.end }, ...hit });
    };
    for (const m of mine) {
      const span = { start: msOf(m.slot.start), end: msOf(m.slot.end) };
      const hits = S.slotOverlaps(others, span, m.self) || [];
      for (const h of hits) {
        const a = msOf(h.start);
        const b = msOf(h.end);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const t = byId.get(h.taskId);
        push(m, { taskId: h.taskId || null, title: typeof h.title === 'string' ? h.title : (t ? t.title || '' : ''), start: iso(a), end: iso(b) });
      }
    }
    mine.forEach((m, i) => {
      mine.forEach((o, j) => {
        if (i === j || m.index === o.index) return;
        if (msOf(m.slot.start) < msOf(o.slot.end) && msOf(o.slot.start) < msOf(m.slot.end)) {
          push(m, { taskId: o.taskId, ...(o.ref ? { ref: o.ref } : {}), title: o.title, start: o.slot.start, end: o.slot.end });
        }
      });
    });
    return out.sort((x, y) => x.index - y.index || (x.slot.start < y.slot.start ? -1 : x.slot.start > y.slot.start ? 1 : 0));
  }

  // --- вложения ------------------------------------------------------------------

  const KIB = 1024;
  const MIB = 1024 * KIB;

  /** Вложения агента (решение 18 октября 2026): изображения PNG, JPEG, WebP,
   *  GIF; PDF; текст TXT, MD, CSV. Word и Excel — нет: их разбор — своя
   *  работа и своя поверхность атаки.
   *
   *  maxCount — файлов в одном сообщении; imageBytes — изображение (до
   *  перекодировки и после); pdfBytes, textBytes — PDF и текстовый файл;
   *  textChars — сколько знаков текста уходит модели (дальше обрезается);
   *  totalBytes — всё сообщение после перекодировки, в байтах файлов: в
   *  base64 это ×4/3, 16 МиБ, — под этот размер поднят MAX_BODY функции.
   *  imageSide, imageQuality — перекодировка на устройстве: длинная сторона
   *  не больше 1568 px (столько модель и так оставила бы), JPEG 0,85;
   *  PNG с прозрачностью остаётся PNG. Перекодировка убирает метаданные
   *  (EXIF, GPS) и всё, что дописано в файл сверх картинки.
   *  extensions — какие расширения у какого вида: тип решают байты, а
   *  расширение, если оно есть, должно быть того же вида — «фото.jpg» с
   *  текстом внутри и PNG с именем .txt — подделка или ошибка, не вложение.
   *  Внутри вида расширения не различаются: PNG с именем .jpg — обычное
   *  дело, перекодировка всё равно сделает из него свой файл.
   *  accept — для поля выбора файла. Те же числа — в index.ts функции
   *  (ATTACH), совпадение сверяет её тест. */
  const AI_ATTACH = Object.freeze({
    maxCount: 4,
    imageBytes: 5 * MIB,
    pdfBytes: 8 * MIB,
    textBytes: 512 * KIB,
    textChars: 100000,
    totalBytes: 12 * MIB,
    imageSide: 1568,
    imageQuality: 0.85,
    types: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']),
    extensions: Object.freeze({
      image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif']),
      pdf: Object.freeze(['pdf']),
      text: Object.freeze(['txt', 'md', 'markdown', 'csv']),
    }),
    accept: '.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.markdown,.csv',
  });

  /** Пометка у документа: содержимое — от человека, не инструкция. Поле
   *  context API передаёт модели, но цитировать из него не даёт. */
  const UNTRUSTED = 'Untrusted attachment from the user';
  const FILE_NAME_MAX = 120;

  const kindOf = (mediaType) => (mediaType === 'application/pdf' ? 'pdf'
    : mediaType === 'text/plain' ? 'text'
      : typeof mediaType === 'string' && AI_ATTACH.types.includes(mediaType) ? 'image' : null);

  /** Байты: Uint8Array (и Buffer), ArrayBuffer или его вид; иначе null. */
  function bytesOf(v) {
    if (v instanceof Uint8Array) return v;
    if (typeof ArrayBuffer !== 'undefined') {
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      if (ArrayBuffer.isView && ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
    return null;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
  const B64_AT = (() => {
    const t = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64.length; i += 1) t[B64.charCodeAt(i)] = i;
    t[61] = 0; // '=' — добивка
    return t;
  })();

  /** Байты → base64. Своя, а не btoa: на телефоне (Hermes) её может не быть,
   *  а строка из байтов для btoa на 5 МБ — лишняя копия. */
  function b64Encode(bytes) {
    const n = bytes.length;
    const parts = [];
    const CHUNK = 3 * 8192;
    for (let at = 0; at < n; at += CHUNK) {
      const end = Math.min(n, at + CHUNK);
      let s = '';
      for (let i = at; i < end; i += 3) {
        const a = bytes[i];
        const b = i + 1 < end ? bytes[i + 1] : 0;
        const c = i + 2 < end ? bytes[i + 2] : 0;
        s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
          + (i + 1 < end ? B64[((b & 15) << 2) | (c >> 6)] : '=')
          + (i + 2 < end ? B64[c & 63] : '=');
      }
      parts.push(s);
    }
    return parts.join('');
  }

  /** base64 → байты; не base64 — null. */
  function b64Decode(s) {
    if (typeof s !== 'string' || s.length % 4 !== 0 || !B64_RE.test(s)) return null;
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    const out = new Uint8Array((s.length / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const v = (B64_AT[s.charCodeAt(i)] << 18) | (B64_AT[s.charCodeAt(i + 1)] << 12)
        | (B64_AT[s.charCodeAt(i + 2)] << 6) | B64_AT[s.charCodeAt(i + 3)];
      if (o < out.length) out[o++] = (v >> 16) & 255;
      if (o < out.length) out[o++] = (v >> 8) & 255;
      if (o < out.length) out[o++] = v & 255;
    }
    return out;
  }

  /** Сколько байтов за строкой base64 — без раскодирования. */
  const b64Size = (s) => (typeof s === 'string' && s.length ? Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0) : 0);

  /** Строгий UTF-8 → строка (BOM в начале снимается); не UTF-8 — null:
   *  лишние байты, недописанная последовательность, длинная запись,
   *  суррогаты и больше U+10FFFF. */
  function utf8Decode(bytes) {
    const n = bytes.length;
    let i = n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    const parts = [];
    let units = [];
    const flush = () => { parts.push(String.fromCharCode.apply(null, units)); units = []; };
    const cont = (k) => k < n && (bytes[k] & 0xc0) === 0x80;
    while (i < n) {
      const b = bytes[i];
      let cp;
      if (b < 0x80) { cp = b; i += 1; } else if (b >= 0xc2 && b <= 0xdf) {
        if (!cont(i + 1)) return null;
        cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        i += 2;
      } else if (b >= 0xe0 && b <= 0xef) {
        if (!cont(i + 1) || !cont(i + 2)) return null;
        const b1 = bytes[i + 1];
        if ((b === 0xe0 && b1 < 0xa0) || (b === 0xed && b1 > 0x9f)) return null;
        cp = ((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        i += 3;
      } else if (b >= 0xf0 && b <= 0xf4) {
        if (!cont(i + 1) || !cont(i + 2) || !cont(i + 3)) return null;
        const b1 = bytes[i + 1];
        if ((b === 0xf0 && b1 < 0x90) || (b === 0xf4 && b1 > 0x8f)) return null;
        cp = ((b & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
        i += 4;
      } else return null;
      if (cp > 0xffff) {
        const c = cp - 0x10000;
        units.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else units.push(cp);
      if (units.length >= 8192) flush();
    }
    flush();
    return parts.join('');
  }

  /** UTF-8 длина строки в байтах — без TextEncoder (на телефоне его может не быть). */
  function utf8Size(s) {
    let n = 0;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i += 1; } else n += 3;
    }
    return n;
  }

  const ascii = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
  const SIG = {
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ihdr: ascii('IHDR'),
    iend: ascii('IEND'),
    gif87: ascii('GIF87a'),
    gif89: ascii('GIF89a'),
    riff: ascii('RIFF'),
    webp: ascii('WEBP'),
    vp8: ascii('VP8'),
    pdf: ascii('%PDF-'),
    eof: ascii('%%EOF'),
    encrypt: ascii('/Encrypt'),
  };
  const hasAt = (b, at, sig) => at >= 0 && at + sig.length <= b.length && sig.every((x, k) => b[at + k] === x);
  function indexIn(b, sig, from, to) {
    const last = Math.min(b.length, to === undefined ? b.length : to) - sig.length;
    for (let i = Math.max(0, from); i <= last; i += 1) if (b[i] === sig[0] && hasAt(b, i, sig)) return i;
    return -1;
  }
  function lastIndexIn(b, sig, from) {
    for (let i = b.length - sig.length; i >= Math.max(0, from); i -= 1) if (b[i] === sig[0] && hasAt(b, i, sig)) return i;
    return -1;
  }

  /** Текст ли это: строгий UTF-8, без NUL, управляющих (кроме \t \n \r)
   *  меньше 1 % знаков, не пустой. */
  function looksLikeText(b) {
    const s = utf8Decode(b);
    if (s === null || !s.length) return false;
    let ctl = 0;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c === 0) return false;
      if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || (c >= 0x7f && c <= 0x9f)) ctl += 1;
    }
    return ctl * 100 < s.length;
  }

  /** Тип файла по содержимому — сигнатурам байтов, а не по имени.
   *
   *  PNG — подпись, заголовок IHDR и конец IEND; JPEG — FF D8 FF в начале и
   *  маркер конца FF D9; GIF — GIF87a / GIF89a; WebP — RIFF…WEBPVP8, и
   *  размер RIFF не больше файла; PDF — %PDF- в начале, %%EOF в последнем
   *  килобайте и без шифрования (/Encrypt: модель такой не прочтёт).
   *  Обрезанный файл не доходит до своего конца — null. Остальное — текст,
   *  если это строгий UTF-8 без NUL и управляющих меньше 1 %.
   *  @returns 'image/png'|'image/jpeg'|'image/webp'|'image/gif'
   *    |'application/pdf'|'text/plain'|null */
  function aiSniffType(bytes) {
    const b = bytesOf(bytes);
    if (!b || !b.length) return null;
    const n = b.length;
    if (hasAt(b, 0, SIG.png)) {
      return n >= 45 && hasAt(b, 12, SIG.ihdr) && lastIndexIn(b, SIG.iend, 33) >= 0 ? 'image/png' : null;
    }
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return n >= 4 && lastIndexIn(b, [0xff, 0xd9], 3) >= 0 ? 'image/jpeg' : null;
    }
    if (hasAt(b, 0, SIG.gif87) || hasAt(b, 0, SIG.gif89)) return n >= 14 ? 'image/gif' : null;
    if (hasAt(b, 0, SIG.riff) && hasAt(b, 8, SIG.webp)) {
      const size = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
      const chunk = n >= 16 && hasAt(b, 12, SIG.vp8) && (b[15] === 0x20 || b[15] === 0x4c || b[15] === 0x58);
      return chunk && n >= 20 && size + 8 <= n ? 'image/webp' : null;
    }
    if (hasAt(b, 0, SIG.pdf)) {
      const ok = indexIn(b, SIG.eof, n - 1024) >= 0 && indexIn(b, SIG.encrypt, 0) < 0;
      return ok ? 'application/pdf' : null;
    }
    return looksLikeText(b) ? 'text/plain' : null;
  }

  const extOf = (name) => {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  };
  const fileName = (v) => cleanName(v, FILE_NAME_MAX) || 'file';
  const mbOf = (bytes) => Math.round((bytes / MIB) * 10) / 10;
  const maxFor = (kind) => (kind === 'image' ? AI_ATTACH.imageBytes : kind === 'pdf' ? AI_ATTACH.pdfBytes : AI_ATTACH.textBytes);
  const fileErr = (error, params) => ({ ok: false, error, params });
  const sizeErr = (name, max) => fileErr('ai.err_file_size', { name, max, maxMb: mbOf(max) });

  /** Проверка одного вложения — по содержимому, а не только по имени.
   *
   *  file — {name, size, bytes} (bytes — Uint8Array или ArrayBuffer) или
   *  {name, size, data} (data — base64, как отдаёт перекодировка на
   *  телефоне). Размер считается по байтам; size нужен, когда байтов ещё
   *  нет: больше самого большого предела (PDF, 8 МиБ) — отказ сразу, файл
   *  можно не читать. Обрезанный файл ловит aiSniffType — у него нет конца.
   *  Тип решает aiSniffType; расширение, если есть, — того же вида
   *  (AI_ATTACH.extensions): PNG с именем .txt и «фото.jpg» с текстом
   *  внутри — 'ai.err_file_type'. В тексте после aiCleanText должно что-то
   *  остаться.
   *  @returns {ok: true, kind: 'image'|'pdf'|'text', mediaType, name, size}
   *    | {ok: false, error: 'ai.err_file_type'|'ai.err_file_size', params:
   *    {name} | {name, max, maxMb}} — name очищен (aiCleanText, до 120) */
  function aiCheckAttachment(file) {
    const f = isObj(file) ? file : {};
    const name = fileName(f.name);
    const top = Math.max(AI_ATTACH.imageBytes, AI_ATTACH.pdfBytes, AI_ATTACH.textBytes);
    const b = bytesOf(f.bytes) || (typeof f.data === 'string' ? b64Decode(f.data) : null);
    if (!b || !b.length) return Number(f.size) > top ? sizeErr(name, top) : fileErr('ai.err_file_type', { name });
    if (b.length > top) return sizeErr(name, top);
    const mediaType = aiSniffType(b);
    const kind = kindOf(mediaType);
    if (!kind) return fileErr('ai.err_file_type', { name });
    const ext = extOf(name);
    if (ext && !AI_ATTACH.extensions[kind].includes(ext)) return fileErr('ai.err_file_type', { name });
    if (b.length > maxFor(kind)) return sizeErr(name, maxFor(kind));
    if (kind === 'text' && !aiCleanText(utf8Decode(b)).trim()) return fileErr('ai.err_file_type', { name });
    return { ok: true, kind, mediaType, name, size: b.length };
  }

  /** Проверка вложений одного сообщения: каждое — aiCheckAttachment, плюс
   *  число (не больше maxCount) и сумма (не больше totalBytes). Звать с уже
   *  перекодированными файлами — сумма считается по тому, что уйдёт.
   *  Сумма — в байтах файлов (не в base64): «не больше 12 МБ» человек
   *  сверяет с размерами своих файлов.
   *  @returns {ok, items: [{...file, name, size, kind, mediaType, bytes}],
   *    error?, params?, index?} — items — прошедшие проверку (для
   *    aiAttachmentBlocks): поля исходного файла и поверх — очищенное имя,
   *    размер по байтам, вид и тип; index — номер файла с ошибкой, -1 —
   *    весь список (error 'ai.err_file_count', params {max});
   *    'ai.err_file_total' — params {max, maxMb} */
  function aiCheckAttachments(list) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length > AI_ATTACH.maxCount) {
      return { ok: false, items: [], error: 'ai.err_file_count', params: { max: AI_ATTACH.maxCount }, index: -1 };
    }
    const items = [];
    let total = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const r = aiCheckAttachment(arr[i]);
      if (!r.ok) return { ok: false, items, error: r.error, params: r.params, index: i };
      total += r.size;
      if (total > AI_ATTACH.totalBytes) {
        return { ok: false, items, error: 'ai.err_file_total', params: { max: AI_ATTACH.totalBytes, maxMb: mbOf(AI_ATTACH.totalBytes) }, index: i };
      }
      const f = arr[i];
      const bytes = bytesOf(f.bytes) || b64Decode(f.data);
      items.push({ ...f, name: r.name, size: r.size, kind: r.kind, mediaType: r.mediaType, bytes });
    }
    return { ok: true, items };
  }

  /** Вложения → блоки Messages API, в том порядке, в каком пришли:
   *    image → {type: 'image', source: {type: 'base64', media_type, data}}
   *    pdf   → {type: 'document', source: {type: 'base64', media_type:
   *            'application/pdf', data}, title, context}
   *    text  → {type: 'document', source: {type: 'text', media_type:
   *            'text/plain', data: aiCleanText(текст, textChars)}, title, context}
   *  title — имя файла (очищено), context — «Untrusted attachment from the
   *  user»: то, что внутри, — данные человека, а не инструкция (то же
   *  говорит раздел Security промпта). data берётся из item.data (base64),
   *  иначе кодируется из item.bytes; текст — item.text или байты как UTF-8.
   *  Ссылок (source url) ядро не строит, и сервер их не пропустит.
   *  items — из aiCheckAttachments; элемент без понятного вида пропускается. */
  function aiAttachmentBlocks(items) {
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!isObj(it)) continue;
      const kind = kindOf(it.mediaType);
      const bytes = bytesOf(it.bytes);
      if (kind === 'text') {
        const raw = typeof it.text === 'string' ? it.text : (bytes ? utf8Decode(bytes) : null);
        const data = aiCleanText(raw || '', AI_ATTACH.textChars);
        if (!data.trim()) continue;
        out.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data }, title: fileName(it.name), context: UNTRUSTED });
        continue;
      }
      if (!kind) continue;
      const data = typeof it.data === 'string' && it.data ? it.data : (bytes && bytes.length ? b64Encode(bytes) : '');
      if (!data) continue;
      if (kind === 'pdf') {
        out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: fileName(it.name), context: UNTRUSTED });
      } else {
        out.push({ type: 'image', source: { type: 'base64', media_type: it.mediaType, data } });
      }
    }
    return out;
  }

  const isAttachBlock = (b) => isObj(b) && (b.type === 'image' || b.type === 'document');
  const TYPE_LABEL = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'application/pdf': 'PDF', 'text/plain': 'текст' };

  /** Размер для строки истории: 512 Б, 340 КБ, 1,2 МБ. */
  function sizeLabel(bytes) {
    if (bytes < KIB) return `${bytes} Б`;
    if (bytes < MIB) return `${Math.round(bytes / KIB)} КБ`;
    return `${String(Math.round((bytes / MIB) * 10) / 10).replace('.', ',')} МБ`;
  }

  /** Строка вместо уже разобранного вложения. У изображения своего имени в
   *  блоке нет (API не берёт title у image) — «изображение». */
  function placeholderOf(b) {
    const src = isObj(b.source) ? b.source : {};
    const type = TYPE_LABEL[src.media_type] || (b.type === 'image' ? 'изображение' : 'файл');
    const size = src.type === 'text' ? utf8Size(typeof src.data === 'string' ? src.data : '') : b64Size(src.data);
    const name = b.type === 'image' ? 'изображение' : fileName(b.title);
    return `[вложение «${name}» (${type}, ${sizeLabel(size)}) — уже разобрано в этом разговоре]`;
  }

  /** Сообщение человека, с которого начинается ход: в нём есть что-то, кроме
   *  ответов на инструменты (текст или вложение). */
  function humanTurn(m) {
    if (!isObj(m) || m.role !== 'user') return false;
    if (typeof m.content === 'string') return true;
    return Array.isArray(m.content) && m.content.some((b) => isObj(b) && b.type !== 'tool_result');
  }

  /** История без байтов уже разобранных вложений.
   *
   *  Вложение уходит модели один раз — в том ходе, к которому приложено;
   *  дальше вместо его блока — строка «[вложение «имя» (тип, размер) — уже
   *  разобрано в этом разговоре]»: что было вложение, модель знает, а
   *  каждый следующий запрос не тащит мегабайты (и не упирается в предел
   *  тела функции). Ход — от сообщения человека до следующего такого же;
   *  текущий — последний, если история кончается сообщением человека (в
   *  том числе ответами на инструменты внутри этого хода): его вложения
   *  остаются. Кончается ответом модели — заменяются все: так история
   *  ложится в хранилище без байтов. Исходный список не меняется.
   *  @returns [{role, content}] */
  function aiCompactHistory(messages) {
    if (!Array.isArray(messages)) return [];
    const last = messages[messages.length - 1];
    let keep = messages.length;
    if (isObj(last) && last.role === 'user') {
      for (let i = messages.length - 1; i >= 0; i -= 1) if (humanTurn(messages[i])) { keep = i; break; }
    }
    return messages.map((m, i) => {
      if (i >= keep || !isObj(m) || !Array.isArray(m.content) || !m.content.some(isAttachBlock)) return m;
      return { ...m, content: m.content.map((b) => (isAttachBlock(b) ? { type: 'text', text: placeholderOf(b) } : b)) };
    });
  }

  // --- список чатов ------------------------------------------------------------------

  const CHAT_TITLE_MAX = 48;
  const CHAT_PREVIEW_MAX = 120;
  const CHATS_MAX = 100;
  /** id чата идёт в ключ хранилища (lancible:ai:<uid>:chat:<id>) — без
   *  двоеточий и прочего, что сделало бы из него чужой ключ. */
  const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

  /** Название чата из первого сообщения: строка или content из блоков (их
   *  текст), очищено, в одну строку, до 48 знаков — длиннее режется по
   *  слову с «…». Пусто (одни вложения) — '': подпись по умолчанию ставит
   *  панель. */
  function aiChatTitle(text) {
    const raw = typeof text === 'string' ? text
      : Array.isArray(text) ? text.filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ')
        : '';
    const t = cleanName(raw, Infinity);
    if (t.length <= CHAT_TITLE_MAX) return t;
    let head = cutUnits(t, CHAT_TITLE_MAX - 1);
    const space = head.lastIndexOf(' ');
    if (space >= CHAT_TITLE_MAX - 16) head = head.slice(0, space);
    return `${head.replace(/[\s,.;:!?—-]+$/, '')}…`;
  }

  const isoOrNull = (v) => {
    const ms = typeof v === 'string' || typeof v === 'number' ? msOf(v) : NaN;
    return Number.isFinite(ms) ? iso(ms) : null;
  };

  /** Индекс чатов из хранилища — в порядок, что бы там ни лежало.
   *
   *  index — список записей или объект {id: запись}. Запись без годного id
   *  (CHAT_ID) выбрасывается; повтор id — остаётся свежая. title и preview
   *  очищены (aiCleanText, одна строка; до 48 и 120 знаков), даты — ISO или
   *  null (createdAt без updatedAt и наоборот подставляют друг друга),
   *  count — целое не меньше нуля. Порядок — по updatedAt, свежие первыми
   *  (без даты — в конце), не больше 100.
   *  @returns [{id, title, createdAt, updatedAt, preview, count}] */
  function aiChatsNormalize(index) {
    const list = Array.isArray(index) ? index
      : isObj(index) ? Object.keys(index).map((k) => (isObj(index[k]) ? { id: k, ...index[k] } : null))
        : [];
    const byId = new Map();
    for (const raw of list) {
      if (!isObj(raw) || typeof raw.id !== 'string' || !CHAT_ID.test(raw.id)) continue;
      const createdAt = isoOrNull(raw.createdAt) || isoOrNull(raw.updatedAt);
      const updatedAt = isoOrNull(raw.updatedAt) || createdAt;
      const count = Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 0;
      const row = { id: raw.id, title: cleanName(raw.title, CHAT_TITLE_MAX), createdAt, updatedAt, preview: cleanName(raw.preview, CHAT_PREVIEW_MAX), count };
      const was = byId.get(raw.id);
      if (!was || (row.updatedAt || '') > (was.updatedAt || '')) byId.set(raw.id, row);
    }
    return [...byId.values()].sort((a, b) => {
      if (!a.updatedAt !== !b.updatedAt) return a.updatedAt ? -1 : 1;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }).slice(0, CHATS_MAX);
  }

  // --- главный экран чата: фраза над полем (19 октября 2026) ----------------------

  /** Сколько фраз-подталкиваний (ai.nudge_1…ai.nudge_16 в словарях). */
  const AI_NUDGES = 16;
  const GREET_NAME_MAX = 24;

  /** Часть суток по местному часу: утро 5–11, день 12–17, вечер 18–22,
   *  ночь 23–4. */
  function dayPartOf(hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'day';
    if (hour >= 18 && hour < 23) return 'evening';
    return 'night';
  }

  /** Фраза над полем на главном экране чата: приветствие по времени суток —
   *  с именем, если оно есть («Доброе утро, Туран!»), иначе без него (_anon),
   *  — чередуется с подталкиваниями («Пора бы создать задачки»). Решает
   *  ядро, слова — словари: веб и телефон показывают одно и то же.
   *  Детерминированно от seed — тот же seed даёт ту же фразу; seed — счётчик
   *  входов на экран (начало — любое, хоть случайное), каждый вход — +1:
   *  чётный — приветствие, нечётный — подталкивание, и подталкивания идут
   *  шагом 7 по кругу из 16 — все по разу, пока не пройдут круг, без повтора
   *  подряд. Имя — первое слово, очищено, до 24 знаков.
   *  @param {{ now: number|string|Date, name?: string, seed?: number }} opts
   *  @returns {{ key: string, vars: object }} — ключ ai.greet_<часть>[_anon]
   *    или ai.nudge_<1…16>, vars — подстановки ({ name } у приветствия с
   *    именем). */
  function aiGreeting(opts) {
    const o = isObj(opts) ? opts : {};
    const n = Math.floor(Math.abs(Number(o.seed) || 0)) % 4294967296;
    if (n % 2 === 1) return { key: `ai.nudge_${((Math.floor(n / 2) * 7) % AI_NUDGES) + 1}`, vars: {} };
    const part = dayPartOf(new Date(nowOf(o.now)).getHours());
    const name = cleanName(typeof o.name === 'string' ? o.name : '', Infinity).split(' ')[0] || '';
    if (!name) return { key: `ai.greet_${part}_anon`, vars: {} };
    return { key: `ai.greet_${part}`, vars: { name: cleanName(name, GREET_NAME_MAX) } };
  }

  // --- поиск по чатам -------------------------------------------------------------

  const CHAT_SNIPPET_MAX = 80;
  const CHAT_FOUND_MAX = 6;

  /** Чаты, где встретился запрос, — для поиска в шапке (веб) и на экране
   *  поиска (телефон). Чаты лежат только на устройстве, поэтому и ищутся
   *  только здесь: в названии и в тексте сообщений (своих и ответов).
   *  chats — [{ id, title, updatedAt, texts: [строки] }]; регистр не важен,
   *  запрос — от двух знаков.
   *  @returns [{ id, title, updatedAt, snippet }] — сначала совпавшие по
   *    названию, дальше по тексту; внутри — свежие выше; не больше limit
   *    (6). snippet — кусок текста вокруг первого совпадения одной строкой,
   *    до 80 знаков (с «…» по обрезанным краям); совпало название — ''. */
  function aiChatSearch(chats, query, opts) {
    const q = cleanName(typeof query === 'string' ? query : '', Infinity).toLowerCase();
    if (q.length < 2 || !Array.isArray(chats)) return [];
    const limit = isObj(opts) && Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : CHAT_FOUND_MAX;
    const found = [];
    for (const c of chats) {
      if (!isObj(c) || typeof c.id !== 'string') continue;
      const title = cleanName(c.title, CHAT_TITLE_MAX);
      const row = { id: c.id, title, updatedAt: isoOrNull(c.updatedAt), snippet: '' };
      if (title.toLowerCase().includes(q)) { found.push({ row, rank: 0 }); continue; }
      for (const raw of Array.isArray(c.texts) ? c.texts : []) {
        const text = cleanName(raw, Infinity);
        const at = text.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const room = Math.max(0, CHAT_SNIPPET_MAX - q.length);
        let from = Math.max(0, at - Math.floor(room / 3));
        const to = Math.min(text.length, from + CHAT_SNIPPET_MAX);
        from = Math.max(0, Math.min(from, to - CHAT_SNIPPET_MAX));
        row.snippet = `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
        found.push({ row, rank: 1 });
        break;
      }
    }
    return found.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const x = a.row.updatedAt || '';
      const y = b.row.updatedAt || '';
      return x === y ? 0 : x < y ? 1 : -1;
    }).slice(0, limit).map((f) => f.row);
  }

  const api = {
    AI_OPS,
    AI_WORK_HOURS,
    AI_ATTACH,
    aiSnapshot,
    aiWorkHours,
    aiFreeWindows,
    aiTimeSpent,
    aiValidate,
    aiApply,
    aiUndo,
    aiProposalRows,
    aiParseSse,
    aiStreamStep,
    aiAssistantMessage,
    aiCountsAsMessage,
    aiSlotConflicts,
    aiSniffType,
    aiCheckAttachment,
    aiCheckAttachments,
    aiCleanText,
    aiAttachmentBlocks,
    aiCompactHistory,
    aiChatTitle,
    aiChatsNormalize,
    AI_NUDGES,
    aiGreeting,
    aiChatSearch,
  };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

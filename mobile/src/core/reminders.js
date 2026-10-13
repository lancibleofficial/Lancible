/* Напоминания задачи: список, его старые поля и движок. Чистая логика, без
 * DOM и без state.
 *
 * До 11 октября 2026 у задачи было одно напоминание — за remindOffsetMin
 * минут до дедлайна или в своё время remindAt, — а у каждого отрезка
 * «времени работы» своё смещение. Теперь у задачи список:
 *
 *   task.reminders: [
 *     { id, kind: 'before', anchor: 'start' | 'due', offsetMin, unit, notifiedUpTo }
 *         — за offsetMin минут (0…60 суток) до начала КАЖДОГО вхождения
 *           каждого отрезка (start) или до дедлайна (due). unit — только для
 *           показа: 120 минут или 2 часа — как ввёл человек. notifiedUpTo у
 *           start — начало последнего вхождения, о котором напомнили (только
 *           растёт, как было у отрезка); у due — дедлайн, о котором напомнили:
 *           дедлайн переехал — напомнить заново.
 *     { id, kind: 'at', at, notifiedAt }
 *         — один раз, в своё время, независимо ни от чего.
 *     { id, kind: 'repeat', rule, time: 'ЧЧ:ММ', start, notifiedUpTo }
 *         — по правилу repeat.js в time; start — момент, от которого правило
 *           считается (день недели и число месяца берутся у него). Вхождения
 *           месяца — от первого, без сползания, как у отрезков. notifiedUpTo —
 *           последнее вхождение, о котором напомнили.
 *   ]
 *
 * Неизвестные ключи остаются (их могла записать более новая версия на другом
 * устройстве), мусор выбрасывается.
 *
 * Совместимость. Десктоп 0.4.3 и телефон 1.2.2 знают только remindOffsetMin,
 * remindAt и notifiedAt, а телефон к тому же принимает облако без миграции.
 * Поэтому:
 *   • список читается только через remindersOf. Поля нет — он выводится из
 *     старых полей; старые поля не совпадают с зеркалом списка — их поменял
 *     старый клиент, и его правка ложится в список. Отсюда же id: у выведенных
 *     они детерминированные ('legacy-due', 'legacy-at', 'legacy-start-N', 'rN'),
 *     и устройство без миграции насчитает те же, что миграция запишет;
 *   • правка списка — только через withReminders: патч идёт вместе с зеркалом
 *     (legacyMirror). Первое «до дедлайна» — в remindOffsetMin, иначе первое
 *     «в своё время» — в remindAt;
 *   • зеркальное напоминание, сработав, ставит и task.notifiedAt — старый
 *     клиент его не повторит. И наоборот: его отметку движок уважает.
 *
 * Выполненная, отменённая или ждущая возврата (done + reopenAt) задача не
 * напоминает. «Сейчас» всюду приходит параметром, как в repeat.js и due.js.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // Пути — строкой целиком: сборщик телефона (Metro) понимает только такие.
  const R = isNode ? require('./repeat.js') : global.Core;
  const S = isNode ? require('./slots.js') : global.Core;

  const MIN = 60000;
  /** Единицы смещения «до…» — сколько в них минут. */
  const REMIND_UNITS = { min: 1, hour: 60, day: 1440 };
  /** Предел смещения — 60 суток. */
  const REMIND_MAX_OFFSET_MIN = 86400;
  /** Быстрые варианты смещения в порядке показа: в момент начала (или
   *  дедлайна), за 5 и 15 минут, за час, за сутки. Остальное — своё число. */
  const REMIND_PRESETS = [0, 5, 15, 60, 1440];
  // Длительности, а не календарь. Разовое и повторяющееся напоминание старше
  // суток молча пропускается: показывать вчерашнее незачем. Отрезок не
  // длиннее суток (slots.js), так что вхождение, начатое раньше, уже кончилось.
  const STALE_MS = 86400000;
  const SPAN_MS = 86400000;
  // Горизонт телефона — 14 суток, как был у отрезков.
  const HORIZON_MS = 1209600000;
  // Запас окна у правила «повторять»: вхождение ставится на свои часы
  // заново, и в ночь перевода оно может съехать на час.
  const SLACK_MS = 7200000;

  const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  const toMs = (v) => (typeof v === 'string' && v ? Date.parse(v) : NaN);
  const iso = (ms) => new Date(ms).toISOString();
  const isoOrNull = (v) => {
    const ms = toMs(v);
    return Number.isFinite(ms) ? iso(ms) : null;
  };
  const nullish = (v) => (v === undefined ? null : v);

  // --- смещение и единицы ---------------------------------------------------

  /** Целое число минут в пределах [0, 60 суток]; не число — null. */
  function clampOffset(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.max(0, Math.min(REMIND_MAX_OFFSET_MIN, Math.round(v)));
  }

  /** Самая крупная единица, в которой смещение целое: 120 — часы, 90 — минуты. */
  function unitFor(off) {
    if (off > 0 && off % REMIND_UNITS.day === 0) return 'day';
    if (off > 0 && off % REMIND_UNITS.hour === 0) return 'hour';
    return 'min';
  }

  /** N единиц → минуты смещения. N — число или строка из поля ввода;
   *  отрицательное, не число или неизвестная единица — null. Больше 60 суток
   *  прижимается к пределу. */
  function toOffsetMin(n, unit) {
    const v = typeof n === 'string' && n.trim() ? Number(n.trim()) : n;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !own(REMIND_UNITS, unit)) return null;
    return Math.min(REMIND_MAX_OFFSET_MIN, Math.round(v * REMIND_UNITS[unit]));
  }

  /** Минуты смещения → {n, unit} для показа. Единица — та, что выбрал
   *  человек, если в ней число целое; иначе самая крупная подходящая. */
  function splitOffset(offsetMin, unit) {
    const off = clampOffset(offsetMin);
    if (off === null) return null;
    const u = own(REMIND_UNITS, unit) && off % REMIND_UNITS[unit] === 0 ? unit : unitFor(off);
    return { n: off / REMIND_UNITS[u], unit: u };
  }

  /** 'Ч:ММ' или 'ЧЧ:ММ' → 'ЧЧ:ММ'; не время суток — null. */
  function normTime(v) {
    const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
  }

  /** Момент ms с часами и минутами time. Часы ставятся каждому вхождению
   *  заново: в ночь перевода несуществующее 02:30 первого дня не должно
   *  унести все следующие на 03:30. */
  function atClock(ms, time) {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(ms);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  // --- модель ---------------------------------------------------------------

  /** Приводит напоминание к рабочему виду; null — разобрать нечего (не
   *  объект, неизвестный вид, нет якоря, смещения, времени или правила).
   *  Неизвестные ключи остаются. id — только непустая строка: недостающие
   *  выдаёт remindersOf. */
  function normalizeReminder(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (raw.kind === 'before') {
      const anchor = raw.anchor === 'start' || raw.anchor === 'due' ? raw.anchor : null;
      const off = clampOffset(raw.offsetMin);
      if (!anchor || off === null) return null;
      const unit = own(REMIND_UNITS, raw.unit) && off % REMIND_UNITS[raw.unit] === 0 ? raw.unit : unitFor(off);
      return { ...raw, id, kind: 'before', anchor, offsetMin: off, unit, notifiedUpTo: isoOrNull(raw.notifiedUpTo) };
    }
    if (raw.kind === 'at') {
      const at = toMs(raw.at);
      if (!Number.isFinite(at)) return null;
      return { ...raw, id, kind: 'at', at: iso(at), notifiedAt: isoOrNull(raw.notifiedAt) };
    }
    if (raw.kind === 'repeat') {
      const rule = R.normalizeRepeat(raw.rule);
      const time = normTime(raw.time);
      const start = toMs(raw.start);
      if (!rule || !time || !Number.isFinite(start)) return null;
      return { ...raw, id, kind: 'repeat', rule, time, start: iso(start), notifiedUpTo: isoOrNull(raw.notifiedUpTo) };
    }
    return null;
  }

  /** У каждого напоминания задачи — свой id: пустые и повторы получают
   *  ближайший свободный 'rN'. Детерминированно: тот же список даёт те же id
   *  на любом устройстве. reserved — id, которые занимать нельзя. */
  function withIds(list, reserved) {
    const taken = new Set([...list.map((r) => r.id).filter(Boolean), ...(reserved || [])]);
    const seen = new Set();
    let n = 0;
    return list.map((r) => {
      if (r.id && !seen.has(r.id)) {
        seen.add(r.id);
        return r;
      }
      let id;
      do { n += 1; id = `r${n}`; } while (taken.has(id));
      taken.add(id);
      seen.add(id);
      return { ...r, id };
    });
  }

  /** Старые поля задачи в приведённом виде. */
  function legacyOf(task) {
    return { remindOffsetMin: clampOffset(task.remindOffsetMin), remindAt: isoOrNull(task.remindAt) };
  }

  const sameLegacy = (a, b) => a.remindOffsetMin === b.remindOffsetMin && a.remindAt === b.remindAt;

  /** Напоминание, которое старые поля описывают, — ноль или одно. Как
   *  считал reminderTime: смещение сильнее своего времени. Отметка «уже
   *  напомнили» берётся у task.notifiedAt: старые клиенты снимают её на любой
   *  правке срока и напоминания. */
  function legacyItems(task, cur) {
    const seen = toMs(task.notifiedAt);
    if (cur.remindOffsetMin !== null) {
      const due = toMs(task.dueAt);
      return [{
        id: 'legacy-due', kind: 'before', anchor: 'due', offsetMin: cur.remindOffsetMin, unit: unitFor(cur.remindOffsetMin),
        notifiedUpTo: Number.isFinite(seen) && Number.isFinite(due) ? iso(due) : null,
      }];
    }
    if (cur.remindAt !== null) {
      return [{ id: 'legacy-at', kind: 'at', at: cur.remindAt, notifiedAt: Number.isFinite(seen) ? iso(seen) : null }];
    }
    return [];
  }

  /** Какое напоминание списка зеркалится в старые поля: первое «до
   *  дедлайна», иначе первое «в своё время»; -1 — никакое. */
  function mirrorIndex(list) {
    const due = list.findIndex((r) => r.kind === 'before' && r.anchor === 'due');
    return due >= 0 ? due : list.findIndex((r) => r.kind === 'at');
  }

  function mirrorOf(list) {
    const r = list[mirrorIndex(list)];
    if (!r) return { remindOffsetMin: null, remindAt: null };
    return r.kind === 'before' ? { remindOffsetMin: r.offsetMin, remindAt: null } : { remindOffsetMin: null, remindAt: r.at };
  }

  /** Старые поля, которые соответствуют списку: {remindOffsetMin, remindAt}.
   *  Их и пишет каждая правка списка, чтобы старый клиент видел то же. */
  function legacyMirror(list) {
    return mirrorOf((Array.isArray(list) ? list : []).map(normalizeReminder).filter(Boolean));
  }

  /** Одно и то же ли время срабатывания у двух версий напоминания. Подпись
   *  (unit) и отметки не в счёт. */
  function sameTiming(a, b) {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'before') return a.anchor === b.anchor && a.offsetMin === b.offsetMin;
    if (a.kind === 'at') return a.at === b.at;
    return a.time === b.time && a.start === b.start && JSON.stringify(a.rule) === JSON.stringify(b.rule);
  }

  /** Смещения напоминаний у отрезков (slot.remindOffsetMin) — только данные
   *  разработки: отрезки ещё не выпущены. Каждое смещение — одно «до начала»
   *  на все отрезки задачи, без повторов; отметка — самая поздняя из
   *  отрезков с этим смещением. */
  function foldSlotOffsets(list, task) {
    const seenBy = new Map();
    for (const slot of S.slotsOf(task)) {
      const off = clampOffset(slot.remindOffsetMin);
      if (off === null) continue;
      const seen = toMs(slot.notifiedUpTo);
      const prev = seenBy.has(off) ? seenBy.get(off) : -Infinity;
      seenBy.set(off, Number.isFinite(seen) ? Math.max(prev, seen) : prev);
    }
    const out = list.slice();
    for (const off of [...seenBy.keys()].sort((a, b) => a - b)) {
      if (out.some((r) => r.kind === 'before' && r.anchor === 'start' && r.offsetMin === off)) continue;
      const seen = seenBy.get(off);
      out.push({
        id: `legacy-start-${off}`, kind: 'before', anchor: 'start', offsetMin: off, unit: unitFor(off),
        notifiedUpTo: Number.isFinite(seen) ? iso(seen) : null,
      });
    }
    return out;
  }

  /** Напоминания задачи — единственный способ их прочитать.
   *
   *  Поля нет (старые данные, телефон без миграции) — список выводится из
   *  старых полей. Поле есть, но старые поля не совпадают с его зеркалом —
   *  их поменял старый клиент: зеркальное напоминание списка заменяется тем,
   *  что в старых полях (или убирается, если они пусты). Смещения у отрезков
   *  (данные разработки) добавляются «до начала». Детерминированно: тот же
   *  task даёт тот же список с теми же id. */
  function remindersOf(task) {
    if (!task || typeof task !== 'object') return [];
    const cur = legacyOf(task);
    let list;
    if (!Array.isArray(task.reminders)) {
      list = legacyItems(task, cur);
    } else {
      list = task.reminders.map(normalizeReminder).filter(Boolean);
      if (!sameLegacy(cur, mirrorOf(list))) {
        const i = mirrorIndex(list);
        const [next] = legacyItems(task, cur);
        // То же время, что у зеркального, — правки не было, только мусор
        // рядом (оба старых поля разом): напоминание и его отметка остаются.
        const same = i >= 0 && next && sameTiming(list[i], next);
        if (i >= 0 && !same) {
          const [old] = list.splice(i, 1);
          if (next) {
            // Своё время встаёт первым из «в своё время», чтобы зеркалом стало
            // именно оно, — если других «до дедлайна» в списке не осталось.
            const firstAt = list.findIndex((r) => r.kind === 'at');
            const pos = next.kind === 'at' && firstAt >= 0 && firstAt < i ? firstAt : i;
            list.splice(pos, 0, { ...next, id: old.id });
          }
        } else if (i < 0 && next) {
          list.push(next);
        }
      }
    }
    return withIds(foldSlotOffsets(list, task));
  }

  /** Привести хранимое к виду remindersOf — для миграции и для приёма
   *  облака. Пишет список (создаёт его из старых полей, принимает правку
   *  старого клиента), зеркало старых полей и убирает смещения у отрезков.
   *  @returns патч задачи или null, если всё уже на месте (повторный прогон
   *    ничего не меняет) */
  function reconcileReminders(task) {
    if (!task || typeof task !== 'object') return null;
    const list = remindersOf(task);
    const mir = mirrorOf(list);
    const patch = {};
    if (!Array.isArray(task.reminders) || JSON.stringify(task.reminders) !== JSON.stringify(list)) patch.reminders = list;
    if (nullish(task.remindOffsetMin) !== mir.remindOffsetMin || nullish(task.remindAt) !== mir.remindAt) {
      patch.remindOffsetMin = mir.remindOffsetMin;
      patch.remindAt = mir.remindAt;
    }
    const raw = Array.isArray(task.slots) ? task.slots : null;
    const hasOffset = (s) => !!s && typeof s === 'object' && 'remindOffsetMin' in s;
    if (raw && raw.some(hasOffset)) {
      patch.slots = raw.map((s) => {
        if (!hasOffset(s)) return s;
        const { remindOffsetMin, ...rest } = s;
        return rest;
      });
    }
    return Object.keys(patch).length ? patch : null;
  }

  /** Отметки «уже напомнили» напоминания вида kind — от src или чистые. */
  const marksOf = (kind, src) => (kind === 'at'
    ? { notifiedAt: src ? src.notifiedAt : null }
    : { notifiedUpTo: src ? src.notifiedUpTo : null });

  /** Правка списка — единственный вход для клиентов. Принимает новый список
   *  целиком и возвращает патч задачи {reminders, remindOffsetMin, remindAt}:
   *  список приведён, у новых — свои id, зеркало старых полей на месте.
   *
   *  Отметки «уже напомнили» решает ядро, а не экран: у напоминания, чьё
   *  время не менялось, они остаются прежними (подпись «120 мин» → «2 ч»
   *  повторно не напомнит); у изменённого и нового — чистые. Если зеркальное
   *  напоминание стало другим, патч снимает и task.notifiedAt — иначе старый
   *  клиент о нём промолчал бы. */
  function withReminders(task, list) {
    const prev = remindersOf(task);
    const byId = new Map(prev.map((r) => [r.id, r]));
    const items = (Array.isArray(list) ? list : []).map(normalizeReminder).filter(Boolean);
    const next = withIds(items, prev.map((r) => r.id)).map((r) => {
      const old = byId.get(r.id);
      return { ...r, ...marksOf(r.kind, old && sameTiming(old, r) ? old : null) };
    });
    const mir = mirrorOf(next);
    const patch = { reminders: next, remindOffsetMin: mir.remindOffsetMin, remindAt: mir.remindAt };
    if (!sameLegacy(mirrorOf(prev), mir)) patch.notifiedAt = null;
    return patch;
  }

  /** Структура для подписи напоминания — тексты собирают клиенты.
   *  before: {kind, anchor, offsetMin, n, unit} — n === 0 значит «в момент»;
   *  at: {kind, at} — числом; repeat: {kind, freq, every, weekdays, monthDay, time}. */
  function describeReminder(rem) {
    const r = normalizeReminder(rem);
    if (!r) return null;
    if (r.kind === 'before') return { kind: 'before', anchor: r.anchor, offsetMin: r.offsetMin, ...splitOffset(r.offsetMin, r.unit) };
    if (r.kind === 'at') return { kind: 'at', at: toMs(r.at) };
    return {
      kind: 'repeat',
      freq: r.rule.freq,
      every: r.rule.every,
      weekdays: r.rule.weekdays.slice(),
      monthDay: r.rule.freq === 'month' ? new Date(toMs(r.start)).getDate() : null,
      time: r.time,
    };
  }

  // --- движок ---------------------------------------------------------------

  const cmpId = (a, b) => {
    const x = a || '';
    const y = b || '';
    return x < y ? -1 : x > y ? 1 : 0;
  };

  /** Вхождения напоминания, чей момент at попадает в [from, to): по
   *  порядку, не больше max, одинаковые моменты — один раз.
   *  @returns [{at, start, end, slotId}] — start: начало вхождения отрезка
   *    (before/start), дедлайн (before/due) или сам момент (at, repeat);
   *    end и slotId — только у вхождений отрезков */
  function reminderOccurrences(task, rem, from, to, max) {
    const r = normalizeReminder(rem);
    if (!r || !(to > from)) return [];
    const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 50;
    const inWin = (at) => at >= from && at < to;
    let out = [];
    if (r.kind === 'at') {
      const at = toMs(r.at);
      if (inWin(at)) out.push({ at, start: at, end: null, slotId: null });
      return out;
    }
    if (r.kind === 'before' && r.anchor === 'due') {
      const due = toMs(task && task.dueAt);
      const at = due - r.offsetMin * MIN;
      if (Number.isFinite(due) && inWin(at)) out.push({ at, start: due, end: null, slotId: null });
      return out;
    }
    if (r.kind === 'before') {
      const off = r.offsetMin * MIN;
      // Отрезки повторяются по правилу задачи — своего у них нет.
      const rule = S.slotRule(task);
      for (const slot of S.slotsOf(task)) {
        // Вхождение, начатое до окна, но ещё идущее, тоже приходит — запас в
        // одно на отрезок.
        for (const occ of S.slotOccurrences(slot, from + off, to + off, limit + 1, rule)) {
          if (inWin(occ.start - off)) out.push({ at: occ.start - off, start: occ.start, end: occ.end, slotId: slot.id });
        }
      }
    } else {
      // «Повторять» — те же вхождения, что у отрезка с первым вхождением в
      // день start, повторяющегося по этому правилу; раньше самого start —
      // не в счёт: правило, заведённое в 15:00 «каждый день в 09:00»,
      // сегодня молчит.
      const startMs = toMs(r.start);
      const first = atClock(startMs, r.time);
      // Счёт выполненных у этого правила не ведётся: done — ноль.
      const probe = { start: iso(first), end: iso(first + MIN) };
      const rule = { ...r.rule, done: 0 };
      for (const occ of S.slotOccurrences(probe, Math.max(from, startMs) - SLACK_MS, to + SLACK_MS, limit + 2, rule)) {
        const at = atClock(occ.start, r.time);
        if (at >= startMs && inWin(at)) out.push({ at, start: at, end: null, slotId: null });
      }
    }
    out.sort((a, b) => a.at - b.at || cmpId(a.slotId, b.slotId));
    out = out.filter((o, i) => i === 0 || o.at !== out[i - 1].at);
    return out.slice(0, limit);
  }

  /** Сказано ли уже об этом вхождении. Зеркальное напоминание считается
   *  сказанным и по task.notifiedAt не раньше его момента — так помечает
   *  старый клиент. */
  function fired(task, r, occ, mirrored) {
    if (mirrored) {
      const told = toMs(task.notifiedAt);
      if (Number.isFinite(told) && told >= occ.at) return true;
    }
    if (r.kind === 'at') return !!r.notifiedAt;
    const seen = toMs(r.notifiedUpTo);
    if (!Number.isFinite(seen)) return false;
    if (r.kind === 'repeat') return occ.at <= seen;
    return r.anchor === 'due' ? occ.start === seen : occ.start <= seen;
  }

  const keyOf = (taskId, remId, at) => `rem-${taskId}-${remId}-${at}`;

  function entry(task, r, occ, legacy) {
    return {
      key: keyOf(task.id, r.id, occ.at),
      taskId: task.id,
      reminderId: r.id,
      kind: r.kind,
      anchor: r.kind === 'before' ? r.anchor : null,
      at: occ.at,
      start: occ.start,
      end: occ.end,
      slotId: occ.slotId,
      legacy,
    };
  }

  const quiet = (task) => !task || task.done || task.cancelled;
  const byAt = (a, b) => a.at - b.at || cmpId(a.key, b.key);

  /** Что пора показать сейчас (десктоп опрашивает раз в 30 с): момент
   *  наступил, о вхождении ещё не сказано. «До начала» — пока вхождение не
   *  кончилось; остальное — не старше суток, у «повторять» — только
   *  последнее вхождение. Прочее молча пропускается. Показав, вызывающий
   *  применяет markFired — второй раз вхождение не всплывёт.
   *  @returns [{key, taskId, reminderId, kind, anchor, at, start, end, slotId, legacy}] */
  function remindersDue(tasks, now) {
    const out = [];
    for (const task of tasks || []) {
      if (quiet(task)) continue;
      const list = remindersOf(task);
      const mirror = mirrorIndex(list);
      list.forEach((r, i) => {
        let occs;
        if (r.kind === 'before' && r.anchor === 'start') {
          occs = reminderOccurrences(task, r, now - SPAN_MS - r.offsetMin * MIN, now + 1, 50).filter((o) => o.end > now);
        } else {
          occs = reminderOccurrences(task, r, now - STALE_MS, now + 1, 50);
          if (r.kind === 'repeat') occs = occs.slice(-1);
        }
        for (const o of occs) if (!fired(task, r, o, i === mirror)) out.push(entry(task, r, o, i === mirror));
      });
    }
    return out.sort(byAt);
  }

  /** Отметить вхождение item (запись remindersDue) показанным.
   *  @returns патч задачи {reminders, notifiedAt?} или null — такого
   *    напоминания у задачи уже нет. notifiedAt — у зеркального: старый
   *    клиент тогда не повторит его. */
  function markFired(task, item) {
    if (!task || !item) return null;
    const list = remindersOf(task);
    const i = list.findIndex((r) => r.id === item.reminderId);
    if (i < 0) return null;
    const r = list[i];
    let mark;
    if (r.kind === 'at') mark = { notifiedAt: iso(item.at) };
    else if (r.kind === 'before' && r.anchor === 'due') mark = { notifiedUpTo: iso(item.start) };
    else {
      // Отметка только растёт: вхождения могут прийти не по порядку.
      const ref = r.kind === 'repeat' ? item.at : item.start;
      const seen = toMs(r.notifiedUpTo);
      mark = { notifiedUpTo: iso(Number.isFinite(seen) ? Math.max(seen, ref) : ref) };
    }
    const reminders = list.slice();
    reminders[i] = { ...r, ...mark };
    const patch = { reminders };
    if (i === mirrorIndex(list)) patch.notifiedAt = iso(item.at);
    return patch;
  }

  /** Что запланировать в системе телефона: будущие вхождения, ближайшие
   *  первыми, ключи `rem-<задача>-<напоминание>-<момент мс>`. «До начала» и
   *  «повторять» — не больше perReminder вхождений каждого в пределах
   *  горизонта; разовые («до дедлайна», «в своё время») — на любой срок
   *  вперёд, как телефон ставил их и раньше.
   *  @param {{horizonMs?: number, perReminder?: number, max?: number}} [opts]
   *  @returns записи как у remindersDue */
  function pendingReminders(tasks, now, opts) {
    const o = opts || {};
    const horizon = Number.isFinite(o.horizonMs) ? o.horizonMs : HORIZON_MS;
    const per = Number.isFinite(o.perReminder) ? o.perReminder : 5;
    const max = Number.isFinite(o.max) ? o.max : 48;
    const out = [];
    const keys = new Set();
    for (const task of tasks || []) {
      if (quiet(task)) continue;
      const list = remindersOf(task);
      const mirror = mirrorIndex(list);
      list.forEach((r, i) => {
        if (!(per > 0)) return;
        const recurring = r.kind === 'repeat' || (r.kind === 'before' && r.anchor === 'start');
        const to = recurring ? now + horizon + 1 : Infinity;
        for (const occ of reminderOccurrences(task, r, now + 1, to, per)) {
          if (fired(task, r, occ, i === mirror)) continue;
          const e = entry(task, r, occ, i === mirror);
          if (keys.has(e.key)) continue;
          keys.add(e.key);
          out.push(e);
        }
      });
    }
    return out.sort(byAt).slice(0, Math.max(0, max));
  }

  /** Напоминания задачи для ленты уведомлений — что из них «висит» сейчас,
   *  сработало оно или нет. «До начала» — пока вхождение идёт;
   *  «повторять» — последнее вхождение за сутки; разовые («до дедлайна»,
   *  «в своё время») — одна запись на задачу, самая свежая из наступивших,
   *  как была одна запись «напоминание» у прежней ленты. Как их оформить
   *  рядом с дедлайном — решает notificationFeed (due.js).
   *  @returns записи как у remindersDue */
  function reminderFeed(task, now) {
    if (quiet(task)) return [];
    const list = remindersOf(task);
    const mirror = mirrorIndex(list);
    const out = [];
    let shot = null;
    list.forEach((r, i) => {
      if (r.kind === 'before' && r.anchor === 'start') {
        for (const o of reminderOccurrences(task, r, now - SPAN_MS - r.offsetMin * MIN, now + 1, 50)) {
          if (o.end > now) out.push(entry(task, r, o, i === mirror));
        }
      } else if (r.kind === 'repeat') {
        const last = reminderOccurrences(task, r, now - STALE_MS, now + 1, 50).pop();
        if (last) out.push(entry(task, r, last, i === mirror));
      } else {
        for (const o of reminderOccurrences(task, r, -Infinity, now + 1, 1)) {
          if (!shot || o.at > shot.at) shot = entry(task, r, o, i === mirror);
        }
      }
    });
    if (shot) out.push(shot);
    const keys = new Set();
    return out.filter((e) => (keys.has(e.key) ? false : keys.add(e.key))).sort(byAt);
  }

  const api = {
    REMIND_PRESETS,
    REMIND_UNITS,
    REMIND_MAX_OFFSET_MIN,
    normalizeReminder,
    remindersOf,
    legacyMirror,
    withReminders,
    reconcileReminders,
    toOffsetMin,
    splitOffset,
    describeReminder,
    reminderOccurrences,
    remindersDue,
    markFired,
    pendingReminders,
    reminderFeed,
  };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

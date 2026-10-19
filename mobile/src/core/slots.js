/* «Время работы» — плановые отрезки задачи и всё, что от них зависит:
 * календарь, напоминания и повтор задачи без дедлайна. Чистая логика, без DOM
 * и без state.
 *
 * Дедлайн отвечает на вопрос «к какому сроку закрыть». Время работы — «когда
 * этим заниматься»: у задачи может быть несколько отрезков.
 *
 *   task.slots: [{
 *     id,                  — свой у каждого отрезка внутри задачи
 *     start, end,          — ISO: дата и часы («пт 12 окт, 10:00–12:00»),
 *                            не больше суток
 *   }]
 *   task.repeat            — правило повтора задачи (repeat.js), одно на всё:
 *                            есть — КАЖДЫЙ отрезок повторяется по нему от своей
 *                            даты, в своё время суток и со своей длительностью;
 *                            нет — отрезок разовый
 *   task.reopenAt          — ISO | null: когда вернётся повторяющаяся задача
 *                            без дат (закрыта и ждёт своего дня)
 *
 * Своего повтора у отрезка нет с 12 октября 2026 — как у события в Google
 * Календаре, у которого повторение одно. Нужен другой ритм — это другая
 * задача. Поле slot.repeat бывало только в данных разработки: normalizeSlot
 * его снимает, а миграция (foldSlotRepeat) отдаёт первое такое правило
 * задаче, если своего у неё нет.
 *
 * Напоминания у отрезка своего больше нет (с 11 октября 2026): «до начала» —
 * общий список задачи (core/reminders.js), срабатывает перед каждым
 * вхождением каждого отрезка. Поля slot.remindOffsetMin и slot.notifiedUpTo
 * бывали только в данных разработки: normalizeSlot их не трогает (как любой
 * чужой ключ), а миграция переносит смещение в список и убирает.
 *
 * Поле slots читается только через slotsOf: телефон 1.2.2 принимает облако без
 * миграции, и задача может прийти без поля или с мусором в нём.
 *
 * «Сейчас» всюду приходит параметром, как в repeat.js и due.js.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // Пути — строкой целиком: сборщик телефона (Metro) понимает только такие.
  const R = isNode ? require('./repeat.js') : global.Core;
  const A = isNode ? require('./agenda.js') : global.Core;

  const MIN = 60000;
  // Отрезок длиннее суток — это уже не «время работы», а отпуск: следующее
  // вхождение ежедневного отрезка наехало бы на предыдущее.
  const MAX_SPAN_MIN = 1440;

  /** День, когда появилось «время работы» и повтор без дедлайна. Закрытия
   *  раньше него planReopen не лечит: до этого дня старые клиенты закрывали
   *  повторяющуюся задачу без дедлайна насовсем (правило оставалось, дедлайна
   *  не было), и человек месяцами видит её выполненной. Вернуть её теперь
   *  значило бы воскресить давно сделанное. */
  const SLOTS_SINCE = '2026-10-11T00:00:00.000Z';
  const SINCE_MS = Date.parse(SLOTS_SINCE);

  const toMs = (v) => (typeof v === 'string' && v ? Date.parse(v) : NaN);
  const iso = (ms) => new Date(ms).toISOString();

  /** Дата dayMs со временем суток от srcMs. Как withTimeOf в repeat.js, но с
   *  миллисекундами: отрезок должен вставать ровно туда, где его поставили. */
  function atTimeOf(dayMs, srcMs) {
    const src = new Date(srcMs);
    const d = new Date(dayMs);
    d.setHours(src.getHours(), src.getMinutes(), src.getSeconds(), src.getMilliseconds());
    return d.getTime();
  }

  /** Приводит отрезок к рабочему виду; null — разобрать нечего (не объект,
   *  нет начала или конца, конец не позже начала). Неизвестные ключи остаются:
   *  их могла записать более новая версия приложения на другом устройстве.
   *  Так же, как чужой ключ, остаются и снятые remindOffsetMin и
   *  notifiedUpTo — их переносит в список напоминаний миграция.
   *
   *  Исключение — repeat: его снимаем явно. Правило теперь одно, у задачи, и
   *  повтор, оставшийся у отрезка в старых данных, не должен оживать. Отдать
   *  его задаче успевает миграция (foldSlotRepeat) — до normalizeSlot. */
  function normalizeSlot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const start = toMs(raw.start);
    let end = toMs(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    end = Math.min(end, start + MAX_SPAN_MIN * MIN);
    const out = {
      ...raw,
      id: typeof raw.id === 'string' && raw.id ? raw.id : null,
      start: iso(start),
      end: iso(end),
    };
    delete out.repeat;
    return out;
  }

  /** Отрезки задачи — единственный способ их прочитать: нет поля — пусто,
   *  битые выброшены. */
  function slotsOf(task) {
    return task && Array.isArray(task.slots) ? task.slots.map(normalizeSlot).filter(Boolean) : [];
  }

  /** Правило, по которому повторяются отрезки задачи: её собственное
   *  task.repeat, пока серия не кончилась. null — отрезки разовые. */
  function slotRule(task) {
    const rule = R.normalizeRepeat(task && task.repeat);
    return rule && !R.repeatFinished(rule) ? rule : null;
  }

  /** Повтор у отрезков в старых данных (до 12 октября 2026, только данные
   *  разработки). Первое правило целого отрезка (по порядку в списке)
   *  достаётся задаче, если своего у неё нет: from, keepHistory и done у
   *  отрезка не значили ничего, поэтому задача получает их по умолчанию.
   *  Остальные правила — и все, если правило у задачи уже есть, —
   *  отбрасываются: второго у задачи быть не может. Поле снимается со всех
   *  отрезков, битые не трогаются — их выбросит normalizeSlot.
   *  Идемпотентно: после неё у отрезков поля нет, и она молчит.
   *  @returns патч {slots, repeat?} или null — снимать нечего */
  function foldSlotRepeat(task) {
    if (!task || !Array.isArray(task.slots)) return null;
    const legacy = (s) => !!s && typeof s === 'object' && !Array.isArray(s) && Object.prototype.hasOwnProperty.call(s, 'repeat');
    if (!task.slots.some(legacy)) return null;
    let moved = null;
    const slots = task.slots.map((s) => {
      if (!legacy(s)) return s;
      if (!moved && normalizeSlot(s)) moved = R.normalizeRepeat(s.repeat);
      const rest = { ...s };
      delete rest.repeat;
      return rest;
    });
    const patch = { slots };
    if (moved && !R.normalizeRepeat(task.repeat)) {
      patch.repeat = { ...moved, from: 'schedule', keepHistory: false, done: 0 };
    }
    return patch;
  }

  /** Вхождения отрезка, задевающие [from, to): [{start, end}] по порядку.
   *
   *  Правило — задачи (task.repeat; slotRule), его передаёт вызывающий: у
   *  самого отрезка правила нет. С правилом отрезок повторяется по нему от
   *  своей даты, без него — одно вхождение. Счёт «после N раз» — с учётом
   *  уже выполненных (rule.done): каждый раз, когда задачу закрывают,
   *  отрезки уезжают на следующее вхождение (planTaskRoll), так что первое
   *  вхождение отрезка — это (done + 1)-й раз серии, как у дедлайна в
   *  upcomingDue. from, keepHistory и номер в серии для самих дат не значат
   *  ничего.
   *
   *  Ежедневные и еженедельные правила прыгают сразу к from: перебор шаг за
   *  шагом, как upcomingDue, упирается в 200 шагов, и ежедневный отрезок
   *  годичной давности до текущей недели не дошёл бы. Месяц и год
   *  перебираются: шагов у них мало. Серию «после N раз» тоже перебираем —
   *  для неё нужен номер вхождения, а N не больше 999.
   *
   *  k-е вхождение месяца и года считается от первого, а не от предыдущего:
   *  число (или «пятая пятница») берётся у первого вхождения и прижимается к
   *  длине месяца. Шаг от предыдущего уводил бы серию раз и навсегда:
   *  31 января → 28 февраля → 28 марта → 28 апреля…
   *
   *  Еженедельное правило с днями: первое вхождение считается, только если
   *  его день в списке; иначе №1 — ближайший подходящий день после него.
   *
   *  @param {number} max — предохранитель, сколько вхождений отдать
   *  @param {object|null} taskRule — правило задачи как есть (нормализуется
   *    внутри); null или кончившаяся серия — отрезок разовый */
  function slotOccurrences(slot, from, to, max, taskRule) {
    const s = normalizeSlot(slot);
    if (!s) return [];
    const base = toMs(s.start);
    const dur = toMs(s.end) - base;
    const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 200;
    const out = [];
    const take = (start) => { if (start + dur > from && start < to) out.push({ start, end: start + dur }); };

    const rule = R.normalizeRepeat(taskRule);
    if (!rule || R.repeatFinished(rule)) {
      take(base);
      return out;
    }
    // Конец серии считаем сами — по номеру вхождения и по дате, — а шаг
    // делает nextDue без конца. Время суток каждый раз берётся у первого
    // вхождения: шаг от предыдущего уносил бы его после несуществующего часа
    // в ночь перевода.
    const free = { ...rule, done: 0, ends: { kind: 'never', count: rule.ends.count, at: null } };
    const months = rule.freq === 'year' ? 12 * rule.every : rule.freq === 'month' ? rule.every : 0;
    const first = new Date(base);
    const ordinal = R.weekdayOrdinal(base);
    /** k-е вхождение месяца или года от первого (k = 0 — оно само). */
    const nthFromBase = (k) => {
      const target = new Date(first.getFullYear(), first.getMonth() + k * months, 1);
      const y = target.getFullYear();
      const m = target.getMonth();
      const day = rule.freq === 'month' && rule.monthMode === 'weekday'
        ? R.nthWeekdayOfMonth(y, m, first.getDay(), ordinal)
        : new Date(y, m, Math.min(first.getDate(), new Date(y, m + 1, 0).getDate())).getTime();
      return atTimeOf(day, base);
    };
    let k = 0;
    const step = (cur) => {
      if (months) { k += 1; return nthFromBase(k); }
      const next = R.nextDue(free, cur);
      return next == null ? null : atTimeOf(next, base);
    };
    const untilRaw = rule.ends.kind === 'on' && rule.ends.at ? new Date(`${rule.ends.at}T23:59:59`).getTime() : NaN;
    const until = Number.isFinite(untilRaw) ? untilRaw : Infinity;
    // Сколько раз серии ещё впереди, считая первое вхождение отрезка: не
    // меньше одного — кончившуюся серию отсеяли выше.
    const count = rule.ends.kind === 'after' ? rule.ends.count - rule.done : Infinity;
    const weekdays = rule.freq === 'week' ? rule.weekdays : [];
    const fits = (ms) => !weekdays.length || weekdays.includes(new Date(ms).getDay());

    let cur = fits(base) ? base : step(base);
    // Прыжок: на шаг раньше нужного, дальше — обычными шагами. Вхождение до
    // from не попадёт в ответ — его отсеет take.
    const target = from - dur;
    if (cur != null && cur < target && count === Infinity && (rule.freq === 'day' || rule.freq === 'week')) {
      if (!weekdays.length) {
        const every = rule.freq === 'week' ? rule.every * 7 : rule.every;
        const k = Math.floor(A.daysBetween(base, target) / every) - 1;
        if (k > 0) cur = atTimeOf(A.addDaysMs(base, k * every), base);
      } else {
        const monday = A.mondayOfMs(base);
        const k = Math.floor(A.daysBetween(monday, target) / (7 * rule.every)) - 1;
        if (k > 0) {
          const week = A.addDaysMs(monday, k * rule.every * 7);
          for (let i = 0; i < 7; i += 1) {
            const day = A.addDaysMs(week, i);
            if (fits(day)) { cur = atTimeOf(day, base); break; }
          }
        }
      }
    }

    let n = 1;
    let guard = 0;
    while (cur != null && cur < to && cur <= until && n <= count && out.length < limit && guard < 100000) {
      take(cur);
      cur = step(cur);
      n += 1;
      guard += 1;
    }
    return out;
  }

  /** Плановые блоки на календаре: вхождения отрезков открытых задач по
   *  правилу самой задачи, нарезанные по местной полуночи, как записи времени
   *  в sessionSegments. У закрытой задачи плановых блоков нет — ни прошлых,
   *  ни будущих. recurring — у задачи есть живое правило повтора.
   *  @returns [{taskId, projectId, slotId, start, end, dayIndex, recurring}] */
  function slotItems(tasks, from, to) {
    const out = [];
    for (const task of tasks) {
      if (!task || task.done || task.cancelled) continue;
      const rule = slotRule(task);
      for (const slot of slotsOf(task)) {
        for (const occ of slotOccurrences(slot, from, to, 400, rule)) {
          let cur = Math.max(occ.start, from);
          const stop = Math.min(occ.end, to);
          while (cur < stop) {
            const dayStart = A.startOfDayMs(cur);
            const dayEnd = A.addDaysMs(dayStart, 1);
            if (!(dayEnd > cur)) break;
            const segEnd = Math.min(stop, dayEnd);
            out.push({
              taskId: task.id,
              projectId: task.projectId,
              slotId: slot.id,
              start: cur,
              end: segEnd,
              dayIndex: A.daysBetween(from, dayStart),
              recurring: !!rule,
            });
            cur = segEnd;
          }
        }
      }
    }
    return out.sort((x, y) => x.start - y.start || x.end - y.end);
  }

  /** Метки «времени работы» для клеток месяца: по дню — первые limit кусков
   *  (по началу), сколько ещё не влезло и все куски дня — для подсказки.
   *  Те же куски, что у недели и дня (slotItems): у закрытой задачи меток
   *  нет. Дни идут от from (местная полночь), days штук.
   *  @returns [{ marks, more, all }] — по индексу дня */
  function slotDayMarks(tasks, from, days, limit) {
    const n = Math.max(0, Math.floor(days) || 0);
    const cap = Math.max(0, Math.floor(limit) || 0);
    const out = Array.from({ length: n }, () => ({ marks: [], more: 0, all: [] }));
    for (const it of slotItems(tasks, from, A.addDaysMs(from, n))) {
      const day = out[it.dayIndex];
      if (!day) continue;
      day.all.push(it);
      if (day.marks.length < cap) day.marks.push(it);
      else day.more += 1;
    }
    return out;
  }

  /** С чем пересекается отрезок span {start, end} (ISO или числа): вхождения
   *  плановых отрезков других задач — с повторами, по правилу каждой задачи,
   *  как на календаре (slotItems). Закрытые и отменённые задачи не считаются:
   *  на календаре их блоков нет. Касание краями — не пересечение: 10:00–11:00
   *  и 11:00–12:00 стоят друг за другом. Свою задачу (exceptTaskId)
   *  вызывающий исключает сам — её отрезки не мешают друг другу.
   *  Ничего не запрещает: время задачи — любое, вопрос задаёт клиент.
   *  @returns [{ taskId, title, start, end }] — вхождения целиком (ISO), не
   *    обрезанные по span и полуночи, по началу */
  function slotOverlaps(tasks, span, exceptTaskId) {
    const ms = (v) => (typeof v === 'number' ? v : toMs(v));
    const from = ms(span && span.start);
    const to = ms(span && span.end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return [];
    const out = [];
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (!task || task.done || task.cancelled) continue;
      if (exceptTaskId != null && task.id === exceptTaskId) continue;
      const rule = slotRule(task);
      for (const slot of slotsOf(task)) {
        for (const occ of slotOccurrences(slot, from, to, 400, rule)) {
          out.push({ taskId: task.id, title: typeof task.title === 'string' ? task.title : '', start: iso(occ.start), end: iso(occ.end) });
        }
      }
    }
    return out.sort((x, y) => toMs(x.start) - toMs(y.start) || toMs(x.end) - toMs(y.end));
  }

  // --- повтор задачи --------------------------------------------------------

  /** Якорь цикла повтора: дедлайн; без него — самый ранний отрезок; без них —
   *  ничего (ISO | null). Своего правила у отрезков нет, и для переката все
   *  они разовые: едут вместе с задачей. */
  function rollAnchor(task) {
    if (task && task.dueAt) return task.dueAt;
    const all = slotsOf(task).sort((a, b) => toMs(a.start) - toMs(b.start));
    return all.length ? all[0].start : null;
  }

  /** Отрезок на n календарных дней вперёд: время суток и длительность те же. */
  function shiftSlot(slot, days) {
    const start = toMs(slot.start);
    const dur = toMs(slot.end) - start;
    const moved = atTimeOf(A.addDaysMs(start, days), start);
    return { ...slot, start: iso(moved), end: iso(moved + dur) };
  }

  /** Что делать с повторяющейся задачей, когда её закрыли. Решение, а не
   *  применение: десктоп правит задачу на месте, телефон заменяет её в сторе.
   *
   *  (a) есть дедлайн — ровно planRepeatRoll; все отрезки едут на то же
   *      число календарных дней, что и дедлайн.
   *  (b) дедлайна нет, есть отрезок — тот же цикл с догоном от самого
   *      раннего из них; все отрезки едут на столько же дней.
   *  (c) ни того ни другого — отсчёт от момента закрытия, задача остаётся
   *      закрытой до полуночи дня следующего раза (reopenAt).
   *  Своего правила у отрезков нет (оно одно, у задачи), так что разовые для
   *  переката они все: следующие вхождения считаются уже от новой даты.
   *
   *  Напоминания (core/reminders.js) — так:
   *  • «в своё время» едут вместе с задачей: в (a) и (b) — на то же число
   *    календарных дней, в (c) — на день возврата (самое раннее, остальные —
   *    на столько же дней), в своё время суток. Иначе вчерашнее напоминание
   *    сработало бы снова, как только задача откроется, и лента держала бы
   *    его вечно;
   *  • «до дедлайна» и «до начала» едут сами за своим якорем. Дедлайн
   *    переехал — о нём напомнить заново. У «до начала» отметка общая на все
   *    отрезки и опускается ровно под самый ранний сдвинутый: о нём и о том,
   *    что после, — заново, а о том, что раньше и уже сказано, — нет;
   *  • «повторять» живёт своим правилом и на перекате не трогается; в (c)
   *    его отметку поднимает возврат (planReopen) — под свой момент.
   *  Есть напоминания — патч несёт список и зеркало старых полей
   *  (remindOffsetMin, remindAt).
   *
   *  @returns null — делать нечего;
   *    {finished: true, repeat} — серия кончилась, задача остаётся закрытой;
   *    {open, keepHistory, nextDue, patch} — patch положить в задачу как есть;
   *      open: true — открыть сейчас (статус по умолчанию, done: false,
   *      doneAt и notifiedAt — null; с keepHistory — прежде отложить
   *      historyCopy и очистить записи времени); open: false — задача
   *      остаётся закрытой, вернёт её planReopen. */
  function planTaskRoll(task, now) {
    const rule = R.normalizeRepeat(task && task.repeat);
    if (!rule || R.repeatFinished(rule)) return null;
    const anchor = rollAnchor(task);
    // Напоминания — в reminders.js, а он сам берёт отсюда отрезки. Поэтому
    // подключаем его здесь, при вызове, а не при загрузке файла: к этому
    // моменту оба модуля уже загружены, и кольца при загрузке нет.
    const M = isNode ? require('./reminders.js') : global.Core;
    const reminders = M.remindersOf(task);

    if (anchor) {
      const roll = R.planRepeatRoll(rule, anchor, now);
      if (!roll || roll.finished) return roll;
      const days = A.daysBetween(toMs(anchor), roll.nextDue);
      const slots = slotsOf(task).map((s) => shiftSlot(s, days));
      const firstSlot = Math.min(...slots.map((s) => toMs(s.start)));
      return {
        open: true,
        keepHistory: roll.keepHistory,
        nextDue: roll.nextDue,
        patch: {
          repeat: roll.repeat,
          dueAt: task.dueAt ? iso(roll.nextDue) : null,
          slots,
          reopenAt: null,
          ...rollReminders(M, reminders, days, firstSlot),
        },
      };
    }

    // Отсчёт — от момента закрытия, что бы ни стояло в from: срока, от
    // которого считать, у задачи нет. Само правило не трогаем — появится
    // дедлайн, и from снова будет значить своё.
    const next = R.nextDue(rule, now);
    const spent = { ...rule, done: rule.done + 1 };
    if (next == null) return { finished: true, repeat: spent };
    const back = A.startOfDayMs(next);
    const ats = reminders.filter((r) => r.kind === 'at').map((r) => toMs(r.at));
    return {
      open: false,
      keepHistory: rule.keepHistory,
      nextDue: next,
      patch: {
        repeat: spent,
        reopenAt: iso(back),
        ...rollReminders(M, reminders, ats.length ? A.daysBetween(Math.min(...ats), back) : 0, null),
      },
    };
  }

  /** Напоминания задачи на перекате (см. planTaskRoll): «в своё время» — на
   *  days календарных дней, в своё время суток, отметка снята. firstSlot —
   *  начало самого раннего сдвинутого отрезка (Infinity — отрезков нет);
   *  null — якоря не двигались (c), и «до…» не трогаются.
   *  @returns часть патча {reminders, remindOffsetMin, remindAt} или null */
  function rollReminders(M, list, days, firstSlot) {
    if (!list.length) return null;
    const next = list.map((r) => {
      if (r.kind === 'at') {
        const at = toMs(r.at);
        return { ...r, at: iso(atTimeOf(A.addDaysMs(at, days), at)), notifiedAt: null };
      }
      if (r.kind !== 'before' || firstSlot === null) return r;
      if (r.anchor === 'due') return { ...r, notifiedUpTo: null };
      const seen = toMs(r.notifiedUpTo);
      return Number.isFinite(seen) && firstSlot <= seen ? { ...r, notifiedUpTo: iso(firstSlot - 1) } : r;
    });
    return { reminders: next, ...M.legacyMirror(next) };
  }

  /** «Повторять» у задачи, что возвращается после ожидания (c): отметка
   *  поднимается под момент возврата back. Пока задача ждала, она молчала
   *  (done), а remindersDue смотрит на сутки назад — без этого вчерашнее
   *  вхождение прозвучало бы в полночь возврата. Вхождение ровно в момент
   *  возврата и позже — уже о живой задаче, оно звучит. Отметка только
   *  растёт.
   *  @param {Array} list — напоминания задачи в виде remindersOf
   *  @returns часть патча {reminders, remindOffsetMin, remindAt} или null —
   *    поднимать нечего */
  function quietRepeats(M, list, back) {
    const mark = back - 1;
    let raised = false;
    const next = list.map((r) => {
      if (r.kind !== 'repeat') return r;
      const seen = toMs(r.notifiedUpTo);
      if (Number.isFinite(seen) && seen >= mark) return r;
      raised = true;
      return { ...r, notifiedUpTo: iso(mark) };
    });
    return raised ? { reminders: next, ...M.legacyMirror(next) } : null;
  }

  /** Галочку сняли руками у задачи, что ждёт своего дня (c): закрытие
   *  отменено, и засчитанный им раз серии — тоже, иначе серия «после N раз»
   *  кончилась бы раньше. Без reopenAt снимать нечего: открытая задача (a, b)
   *  свой раз уже отработала.
   *  @returns patch для задачи или null */
  function planUntick(task) {
    if (!task || !task.reopenAt) return null;
    const rule = R.normalizeRepeat(task.repeat);
    if (!rule) return { reopenAt: null };
    return { reopenAt: null, repeat: { ...rule, done: Math.max(0, rule.done - 1) } };
  }

  /** Выполненная копия для истории («оставлять копии»): своё время и своя
   *  отметка о закрытии, без правила, отрезков и напоминаний — она уже
   *  ничего не ждёт. Общая для обоих клиентов: раньше десктоп оставлял копии
   *  своё напоминание, а телефон снимал. Список напоминаний пуст, и старые
   *  поля — его зеркало: пустые.
   *  @param {number} now — «сейчас» числом */
  function historyCopy(task, id, now) {
    const at = iso(now);
    return Object.assign(JSON.parse(JSON.stringify(task)), {
      id,
      done: true,
      doneAt: task.doneAt || at,
      repeat: null,
      slots: [],
      reopenAt: null,
      pinnedAt: null,
      reminders: [],
      remindOffsetMin: null,
      remindAt: null,
      notifiedAt: null,
      updatedAt: at,
    });
  }

  /** Какие закрытые задачи пора вернуть. Зовётся на старте, по таймеру и
   *  после приёма облака.
   *
   *  Пора — у задачи с живым повтором наступил reopenAt. Плюс лечение: задачу
   *  без дат, закрытую старым клиентом, тот оставил закрытой без reopenAt —
   *  для неё план считается так, будто её закрыли только что (в момент
   *  doneAt). Лечится только закрытие не раньше SLOTS_SINCE: закрытое до него
   *  человек видит сделанным, и так оно и остаётся; без doneAt не известно,
   *  когда её закрыли, — тоже не трогаем. Детерминированно и идемпотентно:
   *  применённый план убирает задачу из обоих условий.
   *
   *  Возврат поднимает отметку у «повторять» под свой момент (quietRepeats):
   *  о том, что было, пока задача ждала, напоминать незачем.
   *
   *  @returns [{taskId, open, keepHistory, patch, nextDue?}] — применять так же,
   *    как ответ planTaskRoll */
  function planReopen(tasks, now) {
    // Как в planTaskRoll: reminders.js подключается при вызове.
    const M = isNode ? require('./reminders.js') : global.Core;
    const out = [];
    for (const task of tasks) {
      if (!task || !task.done) continue;
      const rule = R.normalizeRepeat(task.repeat);
      if (!rule || R.repeatFinished(rule)) continue;
      const at = toMs(task.reopenAt);
      if (Number.isFinite(at)) {
        if (at <= now) {
          const patch = { reopenAt: null, ...quietRepeats(M, M.remindersOf(task), at) };
          out.push({ taskId: task.id, open: true, keepHistory: rule.keepHistory, patch });
        }
        continue;
      }
      if (task.dueAt) continue;
      const closed = toMs(task.doneAt);
      if (!(closed >= SINCE_MS)) continue;
      let plan = planTaskRoll(task, closed);
      // Серия кончилась — возвращать нечего; правило не трогаем, иначе
      // счётчик рос бы на каждом проходе.
      if (!plan || plan.finished) continue;
      const back = toMs(plan.patch.reopenAt);
      if (!plan.open && back <= now) {
        const list = plan.patch.reminders || M.remindersOf(task);
        plan = { ...plan, open: true, patch: { ...plan.patch, reopenAt: null, ...quietRepeats(M, list, back) } };
      }
      out.push({ taskId: task.id, ...plan });
    }
    return out;
  }

  const api = {
    SLOTS_SINCE,
    normalizeSlot,
    slotsOf,
    slotRule,
    foldSlotRepeat,
    slotOccurrences,
    slotItems,
    slotDayMarks,
    slotOverlaps,
    rollAnchor,
    planTaskRoll,
    planUntick,
    historyCopy,
    planReopen,
  };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

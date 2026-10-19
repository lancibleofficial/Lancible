// «Время работы»: отрезки задачи, их вхождения и повтор задачи без дедлайна.
// Напоминания — список задачи, их юниты в tests/unit/reminders.test.js.
// Запуск: npm run test:unit
//
// Даты — местные, в июне 2026: там нет перевода часов ни в одном из поясов,
// где гоняется набор. Сам перевод часов проверяется в agenda-dst.test.js —
// там пояс задаётся явно.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/renderer/core/slots.js');
const R = require('../../src/renderer/core/repeat.js');

const MIN = 60000;
const at = (m, d, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const iso = (ms) => new Date(ms).toISOString();
const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const slot = (start, end, extra) => ({ id: 's1', start: iso(start), end: iso(end), ...extra });
const starts = (occ) => occ.map((o) => stamp(o.start));
/** Вхождения отрезка по правилу задачи — своего правила у отрезка нет. */
const occOf = (s, from, to, rule, max) => L.slotOccurrences(s, from, to, max, rule);

// --- нормализация -------------------------------------------------------------

test('normalizeSlot: мусор — это отсутствие отрезка, а не поломка', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { start: 'вчера', end: 'сегодня' }, { start: iso(at(6, 10, 10)) }]) {
    assert.equal(L.normalizeSlot(bad), null, JSON.stringify(bad));
  }
});

test('normalizeSlot: конец не позже начала — отрезка нет', () => {
  assert.equal(L.normalizeSlot(slot(at(6, 10, 10), at(6, 10, 10))), null);
  assert.equal(L.normalizeSlot(slot(at(6, 10, 10), at(6, 10, 9))), null);
});

test('normalizeSlot: неизвестные ключи остаются, известные приводятся к виду', () => {
  const s = L.normalizeSlot({
    id: 7, start: iso(at(6, 10, 10)), end: iso(at(6, 10, 11)),
    remindOffsetMin: '15', notifiedUpTo: 'никогда', цвет: 'синий',
  });
  assert.equal(s.цвет, 'синий', 'чужой ключ уцелел');
  assert.equal(s.id, null, 'id — только строка; выдаст его миграция');
  // Напоминания у отрезка больше нет (список задачи, core/reminders.js):
  // снятые поля остаются как чужие ключи — их переносит и снимает миграция.
  assert.equal(s.remindOffsetMin, '15', 'снятое поле не приводится и не теряется');
  assert.equal(s.notifiedUpTo, 'никогда', 'и отметка тоже');
  const bare = L.normalizeSlot({ start: iso(at(6, 10, 10)), end: iso(at(6, 10, 11)) });
  assert.ok(!('remindOffsetMin' in bare), 'и не заводится');
  assert.ok(!('notifiedUpTo' in bare), 'и отметка тоже не заводится');
  assert.deepEqual(L.normalizeSlot(s), s, 'второй прогон ничего не меняет');
});

// Повтор у задачи один (как у события в Google Календаре): свой повтор у
// отрезка снимается, а не остаётся чужим ключом — иначе старые данные
// воскрешали бы его.
test('normalizeSlot: своего повтора у отрезка нет — поле снимается, а не остаётся чужим ключом', () => {
  const raw = { id: 's', start: iso(at(6, 10, 10)), end: iso(at(6, 10, 11)), repeat: { freq: 'day', every: 2 }, цвет: 'синий' };
  const s = L.normalizeSlot(raw);
  assert.ok(!('repeat' in s), 'правила у отрезка нет');
  assert.equal(s.цвет, 'синий', 'остальное чужое — на месте');
  assert.ok('repeat' in raw, 'исходник не тронут: перенести правило задаче успеет миграция');
  assert.ok(!('repeat' in L.normalizeSlot({ ...raw, repeat: null })), 'и пустое тоже');
  assert.deepEqual(L.slotsOf({ slots: [raw] }).map((x) => 'repeat' in x), [false], 'slotsOf читает без него');
  assert.deepEqual(starts(L.slotOccurrences(raw, at(6, 1), at(6, 30))), ['2026-06-10 10:00'],
    'без правила задачи старое правило отрезка не работает — одно вхождение');
});

test('normalizeSlot: отрезок длиннее суток прижимается к суткам', () => {
  const s = L.normalizeSlot(slot(at(6, 10, 10), at(6, 12, 10)));
  assert.equal(Date.parse(s.end) - Date.parse(s.start), 1440 * MIN);
});

test('slotsOf: нет поля — пусто, битые выброшены', () => {
  assert.deepEqual(L.slotsOf({}), []);
  assert.deepEqual(L.slotsOf({ slots: 'сломано' }), []);
  assert.deepEqual(L.slotsOf(null), []);
  const got = L.slotsOf({ slots: [null, slot(at(6, 10, 10), at(6, 10, 11)), { start: 'x' }] });
  assert.deepEqual(got.map((s) => s.id), ['s1']);
});

// --- вхождения ----------------------------------------------------------------

test('разовый отрезок: одно вхождение, если задевает окно', () => {
  const s = slot(at(6, 10, 23), at(6, 11, 1));
  assert.deepEqual(starts(L.slotOccurrences(s, at(6, 11), at(6, 12))), ['2026-06-10 23:00'], 'хвост после полуночи задевает следующий день');
  assert.deepEqual(L.slotOccurrences(s, at(6, 11, 1), at(6, 12)), [], 'кончился ровно на границе — не задевает');
  assert.deepEqual(L.slotOccurrences(s, at(6, 1), at(6, 10, 23)), [], 'начинается ровно на конце окна — не задевает');
});

test('без правила задачи — одно вхождение, с правилом — по нему от своей даты', () => {
  const s = slot(at(6, 10, 10), at(6, 10, 11));
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 30), null)), ['2026-06-10 10:00'], 'null — разово');
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 30), undefined)), ['2026-06-10 10:00'], 'правила не передали — разово');
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 30), 'мусор')), ['2026-06-10 10:00'], 'мусор — не правило');
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 13), { freq: 'day', every: 1 })), ['2026-06-10 10:00', '2026-06-11 10:00', '2026-06-12 10:00']);
  const done = { freq: 'day', every: 1, ends: { kind: 'after', count: 2 }, done: 2 };
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 30), done)), ['2026-06-10 10:00'], 'серия кончилась — отрезок разовый');
});

test('ежедневно: время суток и длительность первого вхождения', () => {
  const s = slot(at(6, 10, 10), at(6, 10, 11, 30));
  const occ = occOf(s, at(6, 9), at(6, 13), { freq: 'day', every: 1 });
  assert.deepEqual(starts(occ), ['2026-06-10 10:00', '2026-06-11 10:00', '2026-06-12 10:00']);
  assert.ok(occ.every((o) => o.end - o.start === 90 * MIN));
});

test('по дням недели: пн и ср', () => {
  // 8 июня 2026 — понедельник.
  const s = slot(at(6, 8, 9), at(6, 8, 10));
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 22), { freq: 'week', every: 1, weekdays: [1, 3] })), [
    '2026-06-08 09:00', '2026-06-10 09:00', '2026-06-15 09:00', '2026-06-17 09:00',
  ]);
});

test('по дням недели: первое вхождение не в списке — №1 следующий подходящий день', () => {
  // 9 июня — вторник, а правило — пн и ср.
  const s = slot(at(6, 9, 9), at(6, 9, 10));
  assert.deepEqual(starts(occOf(s, at(6, 1), at(6, 16), { freq: 'week', every: 1, weekdays: [1, 3] })), ['2026-06-10 09:00', '2026-06-15 09:00']);
});

test('«после N раз»: первое вхождение считается, если оно в списке', () => {
  const ends = { kind: 'after', count: 3 };
  const rule = { freq: 'week', every: 1, weekdays: [1, 3], ends };
  const fit = slot(at(6, 8, 9), at(6, 8, 10));
  assert.deepEqual(starts(occOf(fit, at(6, 1), at(7, 31), rule)), ['2026-06-08 09:00', '2026-06-10 09:00', '2026-06-15 09:00']);
  const miss = slot(at(6, 9, 9), at(6, 9, 10));
  assert.deepEqual(starts(occOf(miss, at(6, 1), at(7, 31), rule)), ['2026-06-10 09:00', '2026-06-15 09:00', '2026-06-17 09:00'],
    'вторник не в счёт — три раза считаются от среды');
  const once = slot(at(6, 9, 9), at(6, 9, 10));
  assert.deepEqual(starts(occOf(once, at(6, 1), at(7, 31), { freq: 'day', every: 1, ends: { kind: 'after', count: 1 } })), ['2026-06-09 09:00']);
});

// Правило — задачи, и его done — сколько раз её уже закрыли. Каждый раз
// отрезки уезжали на следующее вхождение (planTaskRoll), так что «после 3
// раз» с одним закрытым — это ещё два вхождения от нынешней даты отрезка, а
// не три: как у дедлайна в upcomingDue.
test('«после N раз» по правилу задачи: уже выполненные из счёта вычитаются', () => {
  const s = slot(at(6, 9, 9), at(6, 9, 10));
  const rule = (done) => ({ freq: 'day', every: 1, ends: { kind: 'after', count: 3 }, done });
  assert.deepEqual(starts(occOf(s, at(6, 1), at(7, 1), rule(0))), ['2026-06-09 09:00', '2026-06-10 09:00', '2026-06-11 09:00']);
  assert.deepEqual(starts(occOf(s, at(6, 1), at(7, 1), rule(1))), ['2026-06-09 09:00', '2026-06-10 09:00']);
  assert.deepEqual(starts(occOf(s, at(6, 1), at(7, 1), rule(2))), ['2026-06-09 09:00'], 'последний раз серии');
  // Перекат и вхождения сходятся: закрыли — отрезок уехал, и серия кончается
  // там же, где кончалась.
  const task = { id: 't', repeat: R.normalizeRepeat(rule(0)), slots: [s], done: true };
  const plan = L.planTaskRoll(task, at(6, 9, 12));
  const after = { ...task, ...plan.patch, done: false };
  assert.deepEqual(L.slotItems([after], at(6, 1), at(7, 1)).map((x) => stamp(x.start)), ['2026-06-10 09:00', '2026-06-11 09:00']);
});

test('«до даты»: последний день входит целиком', () => {
  const s = slot(at(6, 10, 9), at(6, 10, 10));
  assert.deepEqual(starts(occOf(s, at(6, 1), at(7, 1), { freq: 'day', every: 1, ends: { kind: 'on', at: '2026-06-12' } })),
    ['2026-06-10 09:00', '2026-06-11 09:00', '2026-06-12 09:00']);
});

test('ежемесячно и ежегодно перебираются по правилу repeat.js', () => {
  const m = slot(at(1, 31, 9), at(1, 31, 10));
  assert.deepEqual(starts(occOf(m, at(1, 1), at(4, 1), { freq: 'month', every: 1 })), ['2026-01-31 09:00', '2026-02-28 09:00', '2026-03-31 09:00'],
    '31-е прижимается к длине месяца, но считается от первого вхождения, а не от предыдущего');
  // 9 июня 2026 — второй вторник.
  const w = slot(at(6, 9, 9), at(6, 9, 10));
  assert.deepEqual(starts(occOf(w, at(6, 1), at(8, 31), { freq: 'month', every: 1, monthMode: 'weekday' })),
    ['2026-06-09 09:00', '2026-07-14 09:00', '2026-08-11 09:00']);
  const y = slot(at(6, 9, 9), at(6, 9, 10));
  assert.deepEqual(starts(occOf(y, at(1, 1), new Date(2030, 0, 1).getTime(), { freq: 'year', every: 1 })), [
    '2026-06-09 09:00', '2027-06-09 09:00', '2028-06-09 09:00', '2029-06-09 09:00',
  ]);
});

// Шаг от предыдущего вхождения уводил серию навсегда: 31 января → 28 февраля
// → 28 марта → 28 апреля…; «пятая пятница», прижатая к четвёртой, дальше
// оставалась четвёртой; 29 февраля после первого же обычного года — 28-м.
// k-е вхождение считается от первого.
const ymd = (y, m, d, h = 9) => new Date(y, m - 1, d, h).getTime();

test('ежемесячно 31-го: в коротком месяце — последний день, в длинном — снова 31-е', () => {
  const monthly = { freq: 'month', every: 1 };
  const s = slot(ymd(2026, 1, 31), ymd(2026, 1, 31, 10));
  assert.deepEqual(starts(occOf(s, ymd(2026, 2, 1, 0), ymd(2026, 6, 1, 0), monthly)), [
    '2026-02-28 09:00', '2026-03-31 09:00', '2026-04-30 09:00', '2026-05-31 09:00',
  ]);
  const leap = slot(ymd(2028, 1, 31), ymd(2028, 1, 31, 10));
  assert.deepEqual(starts(occOf(leap, ymd(2028, 2, 1, 0), ymd(2028, 4, 1, 0), monthly)), ['2028-02-29 09:00', '2028-03-31 09:00'],
    'в високосный год — 29 февраля');
  const every2 = slot(ymd(2026, 1, 31), ymd(2026, 1, 31, 10));
  assert.deepEqual(starts(occOf(every2, ymd(2026, 1, 1, 0), ymd(2026, 8, 1, 0), { freq: 'month', every: 2 })), [
    '2026-01-31 09:00', '2026-03-31 09:00', '2026-05-31 09:00', '2026-07-31 09:00',
  ], 'раз в два месяца — тоже от первого');
});

test('ежемесячно «пятая пятница»: где пятой нет — последняя, в следующем месяце с пятой — снова пятая', () => {
  // 30 января 2026 — пятая пятница. В феврале, марте и апреле их по четыре, в мае — пять.
  const rule = { freq: 'month', every: 1, monthMode: 'weekday' };
  const s = slot(ymd(2026, 1, 30), ymd(2026, 1, 30, 10));
  assert.deepEqual(starts(occOf(s, ymd(2026, 1, 1, 0), ymd(2026, 6, 1, 0), rule)), [
    '2026-01-30 09:00', '2026-02-27 09:00', '2026-03-27 09:00', '2026-04-24 09:00', '2026-05-29 09:00',
  ]);
  assert.ok(occOf(s, ymd(2026, 1, 1, 0), ymd(2026, 6, 1, 0), rule).every((o) => new Date(o.start).getDay() === 5), 'всегда пятница');
});

test('ежегодно 29 февраля: в обычный год — 28-е, в високосный — снова 29-е', () => {
  const s = slot(ymd(2028, 2, 29), ymd(2028, 2, 29, 10));
  assert.deepEqual(starts(occOf(s, ymd(2028, 1, 1, 0), ymd(2033, 1, 1, 0), { freq: 'year', every: 1 })), [
    '2028-02-29 09:00', '2029-02-28 09:00', '2030-02-28 09:00', '2031-02-28 09:00', '2032-02-29 09:00',
  ]);
});

test('ежемесячно: «после N раз» и «до даты» считаются как прежде', () => {
  const s = slot(ymd(2026, 1, 31), ymd(2026, 1, 31, 10));
  assert.deepEqual(starts(occOf(s, ymd(2026, 1, 1, 0), ymd(2027, 1, 1, 0), { freq: 'month', every: 1, ends: { kind: 'after', count: 3 } })),
    ['2026-01-31 09:00', '2026-02-28 09:00', '2026-03-31 09:00']);
  assert.deepEqual(starts(occOf(s, ymd(2026, 3, 1, 0), ymd(2027, 1, 1, 0), { freq: 'month', every: 1, ends: { kind: 'on', at: '2026-04-30' } })),
    ['2026-03-31 09:00', '2026-04-30 09:00']);
});

test('у двух отрезков одной задачи — одно правило, у каждого от своей даты', () => {
  // Пн 8 июня 09:00 и ср 10 июня 14:00, задача — каждую неделю.
  const task = {
    id: 't', projectId: 'p', repeat: R.normalizeRepeat({ freq: 'week', every: 1 }),
    slots: [slot(at(6, 8, 9), at(6, 8, 10), { id: 'mon' }), slot(at(6, 10, 14), at(6, 10, 15), { id: 'wed' })],
  };
  assert.deepEqual(L.slotItems([task], at(6, 1), at(6, 22)).map((x) => [x.slotId, stamp(x.start)]), [
    ['mon', '2026-06-08 09:00'], ['wed', '2026-06-10 14:00'],
    ['mon', '2026-06-15 09:00'], ['wed', '2026-06-17 14:00'],
  ]);
  // Старое правило у отрезка (данные разработки) ничего не значит.
  const legacy = { ...task, repeat: null, slots: task.slots.map((s) => ({ ...s, repeat: { freq: 'day', every: 1 } })) };
  assert.deepEqual(L.slotItems([legacy], at(6, 1), at(6, 22)).map((x) => [x.slotId, x.recurring]), [['mon', false], ['wed', false]]);
});

test('прыжок для дней и недель даёт то же, что перебор шаг за шагом, через два года', () => {
  // Перебор — тем же nextDue, без предела по шагам. upcomingDue упирается в
  // 200 шагов, и ежедневный отрезок двухлетней давности до окна не дошёл бы.
  const base = at(6, 10, 10);
  const brute = (s, from, to, repeat) => {
    const rule = R.normalizeRepeat(repeat);
    const free = { ...rule, ends: { kind: 'never' } };
    const fits = (ms) => !rule.weekdays.length || rule.weekdays.includes(new Date(ms).getDay());
    const dur = Date.parse(s.end) - Date.parse(s.start);
    const out = [];
    for (let cur = fits(base) ? base : R.nextDue(free, base); cur < to; cur = R.nextDue(free, cur)) {
      if (cur + dur > from) out.push(stamp(cur));
    }
    return out;
  };
  const rules = [
    { freq: 'day', every: 1 },
    { freq: 'day', every: 3 },
    { freq: 'week', every: 2 },
    { freq: 'week', every: 1, weekdays: [1, 3, 5] },
    { freq: 'week', every: 2, weekdays: [0, 6] },
    { freq: 'week', every: 3, weekdays: [2] },
  ];
  const from = new Date(2028, 5, 5).getTime();
  const to = new Date(2028, 6, 20).getTime();
  for (const repeat of rules) {
    const s = slot(base, base + 2 * 3_600_000);
    const got = starts(occOf(s, from, to, repeat, 500));
    assert.ok(got.length > 0, JSON.stringify(repeat));
    assert.deepEqual(got, brute(s, from, to, repeat), JSON.stringify(repeat));
  }
  assert.ok(R.upcomingDue({ freq: 'day', every: 1 }, base, to, 500).length <= 200, 'старый перебор правда упирается в предел');
});

test('предохранитель max ограничивает ответ', () => {
  const s = slot(at(6, 10, 10), at(6, 10, 11));
  assert.equal(occOf(s, at(6, 1), at(12, 31), { freq: 'day', every: 1 }, 5).length, 5);
});

// --- плановые блоки -------------------------------------------------------------

test('slotItems: отрезок через полночь режется на два куска', () => {
  const task = { id: 't', projectId: 'p', slots: [slot(at(6, 10, 23), at(6, 11, 1, 30))] };
  const got = L.slotItems([task], at(6, 10), at(6, 12));
  assert.deepEqual(got.map((x) => [stamp(x.start), stamp(x.end), x.dayIndex, x.recurring, x.slotId, x.projectId]), [
    ['2026-06-10 23:00', '2026-06-11 00:00', 0, false, 's1', 'p'],
    ['2026-06-11 00:00', '2026-06-11 01:30', 1, false, 's1', 'p'],
  ]);
});

test('slotDayMarks: метки месяца — по дню первые limit кусков по началу, остальные счётом', () => {
  // Месяц на вебе (17 октября 2026): в клетке дня — первая метка «времени
  // работы» и «+N»; подсказка называет все. Куски — те же, что у недели.
  const tasks = [
    { id: 'a', projectId: 'p', slots: [slot(at(6, 10, 14), at(6, 10, 15))] },
    { id: 'b', projectId: 'q', slots: [{ id: 's2', start: iso(at(6, 10, 9)), end: iso(at(6, 10, 10)) }, { id: 's3', start: iso(at(6, 12, 23)), end: iso(at(6, 13, 1)) }] },
    { id: 'c', projectId: 'p', done: true, slots: [slot(at(6, 11, 9), at(6, 11, 10))] },
  ];
  const days = L.slotDayMarks(tasks, at(6, 10), 5, 1);
  assert.equal(days.length, 5);
  assert.deepEqual(days[0].marks.map((m) => [m.taskId, stamp(m.start)]), [['b', '2026-06-10 09:00']], 'первой — ранняя');
  assert.equal(days[0].more, 1);
  assert.deepEqual(days[0].all.map((m) => m.taskId), ['b', 'a']);
  assert.deepEqual(days[1], { marks: [], more: 0, all: [] }, 'у закрытой задачи меток нет');
  assert.deepEqual(days[2].marks.map((m) => stamp(m.end)), ['2026-06-13 00:00'], 'через полночь — кусок до полуночи');
  assert.deepEqual(days[3].marks.map((m) => stamp(m.start)), ['2026-06-13 00:00'], 'и кусок после');
  assert.equal(L.slotDayMarks(tasks, at(6, 10), 1, 0)[0].more, 2, 'limit 0 — только счёт');
  assert.deepEqual(L.slotDayMarks(tasks, at(6, 10), 0, 3), []);
});

test('slotItems: закрытые и отменённые задачи плановых блоков не дают', () => {
  const s = [slot(at(6, 10, 9), at(6, 10, 10))];
  const repeat = { freq: 'day', every: 1 };
  const tasks = [
    { id: 'open', projectId: 'p', repeat, slots: s },
    { id: 'done', projectId: 'p', repeat, done: true, slots: s },
    { id: 'cancelled', projectId: 'p', repeat, cancelled: true, slots: s },
    { id: 'none', projectId: 'p', repeat },
  ];
  const got = L.slotItems(tasks, at(6, 10), at(6, 13));
  assert.deepEqual([...new Set(got.map((x) => x.taskId))], ['open']);
  assert.deepEqual(got.map((x) => x.dayIndex), [0, 1, 2]);
  assert.ok(got.every((x) => x.recurring));
});

test('slotItems: recurring — у задачи есть живое правило повтора', () => {
  const s = [slot(at(6, 10, 9), at(6, 10, 10))];
  const recurring = (repeat) => L.slotItems([{ id: 't', projectId: 'p', repeat, slots: s }], at(6, 10), at(6, 11)).map((x) => x.recurring);
  assert.deepEqual(recurring({ freq: 'week', every: 1 }), [true]);
  assert.deepEqual(recurring(null), [false]);
  assert.deepEqual(recurring({ freq: 'day', every: 1, ends: { kind: 'after', count: 1 }, done: 1 }), [false], 'серия кончилась');
  assert.equal(L.slotRule({ repeat: { freq: 'day' } }).freq, 'day');
  assert.equal(L.slotRule({ repeat: null }), null);
  assert.equal(L.slotRule(null), null);
});

// --- пересечения (18 октября 2026) ---------------------------------------------
// Время задачи ничем не ограничено: пересечение — повод спросить, а не запрет.

test('slotOverlaps: чужие вхождения, задевающие отрезок, — целиком и по началу', () => {
  const tasks = [
    { id: 'a', projectId: 'p', title: 'Вёрстка', slots: [slot(at(6, 10, 10), at(6, 10, 11))] },
    { id: 'b', projectId: 'p', title: 'Созвон', slots: [{ id: 'x', start: iso(at(6, 10, 9)), end: iso(at(6, 10, 10, 30)) }] },
    { id: 'c', projectId: 'p', title: 'Вечер', slots: [slot(at(6, 10, 18), at(6, 10, 19))] },
  ];
  const got = L.slotOverlaps(tasks, { start: iso(at(6, 10, 10, 15)), end: iso(at(6, 10, 12)) }, null);
  assert.deepEqual(got.map((x) => [x.taskId, x.title, stamp(Date.parse(x.start)), stamp(Date.parse(x.end))]), [
    ['b', 'Созвон', '2026-06-10 09:00', '2026-06-10 10:30'],
    ['a', 'Вёрстка', '2026-06-10 10:00', '2026-06-10 11:00'],
  ], 'вхождение целиком, не обрезанное по отрезку; «Вечер» не задет');
  assert.deepEqual(Object.keys(got[0]).sort(), ['end', 'start', 'taskId', 'title']);
  assert.equal(typeof got[0].start, 'string', 'ISO, как у отрезков');
});

test('slotOverlaps: касание краями — не пересечение', () => {
  const tasks = [{ id: 'a', projectId: 'p', title: 'А', slots: [slot(at(6, 10, 10), at(6, 10, 11))] }];
  assert.deepEqual(L.slotOverlaps(tasks, { start: iso(at(6, 10, 11)), end: iso(at(6, 10, 12)) }), [], 'сразу после');
  assert.deepEqual(L.slotOverlaps(tasks, { start: iso(at(6, 10, 9)), end: iso(at(6, 10, 10)) }), [], 'сразу до');
  assert.equal(L.slotOverlaps(tasks, { start: iso(at(6, 10, 10, 59)), end: iso(at(6, 10, 12)) }).length, 1, 'минута внахлёст — уже пересечение');
  assert.equal(L.slotOverlaps(tasks, { start: at(6, 10, 9), end: at(6, 10, 13) }).length, 1, 'числа тоже понимает; отрезок поверх целиком');
});

test('slotOverlaps: повторы задачи считаются — по её правилу, как на календаре', () => {
  // Отрезок среды 10 июня, задача повторяется по Пн и Ср: в среду 17 июня он
  // тоже стоит, а во вторник 16-го — нет.
  const tasks = [{ id: 'w', projectId: 'p', title: 'Планёрка', repeat: { freq: 'week', every: 1, weekdays: [1, 3] }, slots: [slot(at(6, 10, 10), at(6, 10, 11))] }];
  const on = (d) => L.slotOverlaps(tasks, { start: iso(at(6, d, 10, 30)), end: iso(at(6, d, 12)) }).map((x) => stamp(Date.parse(x.start)));
  assert.deepEqual(on(17), ['2026-06-17 10:00'], 'среда через неделю');
  assert.deepEqual(on(15), ['2026-06-15 10:00'], 'понедельник');
  assert.deepEqual(on(16), [], 'вторник — не день правила');
  assert.deepEqual(on(3), [], 'до первого вхождения отрезка повторов нет');
});

test('slotOverlaps: закрытые, отменённые и своя задача не считаются; мусор — пусто', () => {
  const s = [slot(at(6, 10, 10), at(6, 10, 11))];
  const tasks = [
    { id: 'own', projectId: 'p', title: 'Своя', slots: s },
    { id: 'done', projectId: 'p', title: 'Сделана', done: true, slots: s },
    { id: 'cancelled', projectId: 'p', title: 'Отменена', cancelled: true, slots: s },
    { id: 'none', projectId: 'p', title: 'Без отрезков' },
    null,
  ];
  const span = { start: iso(at(6, 10, 10)), end: iso(at(6, 10, 11)) };
  assert.deepEqual(L.slotOverlaps(tasks, span, 'own'), []);
  assert.deepEqual(L.slotOverlaps(tasks, span).map((x) => x.taskId), ['own'], 'без исключения своя тоже видна');
  assert.deepEqual(L.slotOverlaps(tasks, { start: span.end, end: span.start }), [], 'конец не позже начала — пусто');
  assert.deepEqual(L.slotOverlaps(tasks, null), []);
  assert.deepEqual(L.slotOverlaps(null, span), []);
  assert.deepEqual(L.slotOverlaps([{ id: 'n', slots: s }], span).map((x) => x.title), [''], 'без названия — пустая строка, подпись ставит клиент');
});

test('slotOverlaps: время ничем не ограничено — ночь субботы такой же отрезок', () => {
  // 13 июня 2026 — суббота. Рабочие часы агента (будни 09–18) ручного
  // создания не касаются: и пересечение, и его отсутствие считаются в любой час.
  const tasks = [{ id: 'a', projectId: 'p', title: 'Ночная', slots: [slot(at(6, 13, 23), at(6, 14, 0, 30))] }];
  assert.deepEqual(L.slotOverlaps(tasks, { start: iso(at(6, 14, 0)), end: iso(at(6, 14, 1)) }).map((x) => x.taskId), ['a'], 'через полночь — одно вхождение');
  assert.deepEqual(L.slotOverlaps(tasks, { start: iso(at(6, 13, 21)), end: iso(at(6, 13, 23)) }), []);
});

// --- повтор задачи --------------------------------------------------------------

const daily = (extra) => R.normalizeRepeat({ freq: 'day', every: 1, ...extra });

test('rollAnchor: дедлайн, иначе самый ранний отрезок, иначе ничего', () => {
  const late = slot(at(6, 12, 9), at(6, 12, 10), { id: 'b' });
  const early = slot(at(6, 11, 9), at(6, 11, 10), { id: 'a' });
  const legacy = slot(at(6, 1, 9), at(6, 1, 10), { id: 'r', repeat: { freq: 'day', every: 1 } });
  assert.equal(L.rollAnchor({ dueAt: '2026-06-20T10:00:00.000Z', slots: [early] }), '2026-06-20T10:00:00.000Z');
  assert.equal(L.rollAnchor({ slots: [late, early] }), early.start);
  assert.equal(L.rollAnchor({ slots: [late, early, legacy] }), legacy.start, 'старое правило отрезка якорем быть не мешает: своего правила нет');
  assert.equal(L.rollAnchor({ slots: [{ start: 'x' }] }), null, 'битые не в счёт');
  assert.equal(L.rollAnchor({}), null);
});

test('(a) дедлайн: все отрезки едут на столько же дней', () => {
  const due = at(6, 10, 18);
  const task = {
    id: 't', repeat: daily(), dueAt: iso(due), done: true,
    slots: [
      slot(at(6, 10, 9), at(6, 10, 10), { id: 'once', своё: 1 }),
      slot(at(6, 1, 9), at(6, 1, 10), { id: 'old', repeat: { freq: 'week', every: 1 } }),
    ],
  };
  const plan = L.planTaskRoll(task, at(6, 10, 20));
  const roll = R.planRepeatRoll(task.repeat, task.dueAt, at(6, 10, 20));
  assert.equal(plan.open, true);
  assert.equal(plan.nextDue, roll.nextDue);
  assert.equal(plan.patch.dueAt, iso(roll.nextDue));
  assert.deepEqual(plan.patch.repeat, roll.repeat);
  assert.equal(plan.patch.reopenAt, null);
  const [once, old] = plan.patch.slots;
  assert.equal(stamp(Date.parse(once.start)), '2026-06-11 09:00');
  assert.equal(stamp(Date.parse(once.end)), '2026-06-11 10:00');
  assert.equal(once.своё, 1);
  assert.equal(stamp(Date.parse(old.start)), '2026-06-02 09:00', 'и тот, у которого было своё правило, — тоже');
  assert.ok(!('repeat' in old), 'своё правило с отрезка снято');
});

test('(a) по дням недели: отрезки едут вместе с дедлайном на тот же следующий день правила', () => {
  // Пн 8 июня, правило — пн и ср: следующий раз — ср 10-го, через два дня.
  const task = {
    id: 't', repeat: R.normalizeRepeat({ freq: 'week', every: 1, weekdays: [1, 3] }), dueAt: iso(at(6, 8, 18)), done: true,
    slots: [slot(at(6, 8, 9), at(6, 8, 10), { id: 'a' }), slot(at(6, 8, 14), at(6, 8, 16), { id: 'b' })],
  };
  const plan = L.planTaskRoll(task, at(6, 8, 19));
  assert.equal(stamp(plan.nextDue), '2026-06-10 18:00');
  assert.deepEqual(plan.patch.slots.map((s) => [stamp(Date.parse(s.start)), stamp(Date.parse(s.end))]), [
    ['2026-06-10 09:00', '2026-06-10 10:00'], ['2026-06-10 14:00', '2026-06-10 16:00'],
  ]);
});

test('(b) без дедлайна, с разовым отрезком: догоняет и сдвигает все разовые', () => {
  const task = {
    id: 't', repeat: daily(), dueAt: null, done: true,
    slots: [
      slot(at(6, 2, 9), at(6, 2, 10), { id: 'a' }),
      slot(at(6, 3, 14), at(6, 3, 15), { id: 'b' }),
    ],
  };
  // Закрыли через неделю: один шаг оставил бы отрезок в прошлом.
  const plan = L.planTaskRoll(task, at(6, 10, 12));
  assert.equal(plan.open, true);
  assert.equal(plan.patch.dueAt, null, 'дедлайн не появляется');
  assert.equal(stamp(plan.nextDue), '2026-06-11 09:00');
  assert.deepEqual(plan.patch.slots.map((s) => stamp(Date.parse(s.start))), ['2026-06-11 09:00', '2026-06-12 14:00'],
    'оба едут на одно и то же число дней');
  assert.equal(plan.patch.repeat.done, 1, 'догон лимит не тратит');
});

test('(b) «от дня закрытия»: отсчёт от «сейчас»', () => {
  const task = { id: 't', repeat: daily({ from: 'done' }), done: true, slots: [slot(at(6, 2, 9), at(6, 2, 10))] };
  const plan = L.planTaskRoll(task, at(6, 10, 12));
  assert.equal(new Date(plan.nextDue).getDate(), 11);
  assert.equal(stamp(Date.parse(plan.patch.slots[0].start)), '2026-06-11 09:00', 'время суток — своё у отрезка');
});

test('(c) без дат: задача остаётся закрытой до полуночи дня следующего раза', () => {
  const rule = R.normalizeRepeat({ freq: 'week', every: 1, from: 'schedule' });
  const task = { id: 't', repeat: rule, done: true, slots: [{ start: 'битый' }] };
  const plan = L.planTaskRoll(task, at(6, 10, 15, 30));
  assert.equal(plan.open, false);
  assert.equal(plan.patch.reopenAt, iso(at(6, 17)), 'отсчёт — от момента закрытия, возврат — с начала дня');
  assert.equal(plan.patch.repeat.done, 1);
  assert.equal(plan.patch.repeat.from, 'schedule', 'само правило не переписывается');
  assert.equal(plan.patch.dueAt, undefined, 'дедлайн не появляется');
  assert.equal(plan.patch.slots, undefined, 'отрезков нет — и трогать нечего');
  // Отрезок со старым своим правилом — уже не (c): своего правила у него
  // нет, он разовый для переката и едет вместе с задачей, как в (b).
  const legacy = { ...task, slots: [slot(at(6, 1, 9), at(6, 1, 10), { repeat: { freq: 'day', every: 1 } })] };
  const b = L.planTaskRoll(legacy, at(6, 10, 15, 30));
  assert.equal(b.open, true);
  assert.equal(stamp(Date.parse(b.patch.slots[0].start)), '2026-06-15 09:00', 'неделя от 1 июня с догоном');
});

// Своё время напоминания (remindAt без remindOffsetMin) раньше оставалось
// вчерашним: клиенты снимают notifiedAt при возврате, и оно срабатывало
// сразу, а лента держала «напоминание» вечно.
test('своё время напоминания едет вместе с задачей: (a) и (b) — на те же дни, (c) — на день возврата', () => {
  const a = L.planTaskRoll({
    id: 'a', repeat: daily(), dueAt: iso(at(6, 10, 18)), remindOffsetMin: null, remindAt: iso(at(6, 10, 17, 30)), done: true,
  }, at(6, 10, 20));
  assert.equal(stamp(a.nextDue), '2026-06-11 18:00');
  assert.equal(stamp(Date.parse(a.patch.remindAt)), '2026-06-11 17:30', '(a) на столько же дней, что и дедлайн');

  // (b): закрыли через неделю — отрезок и напоминание догоняют на 9 дней.
  const b = L.planTaskRoll({
    id: 'b', repeat: daily(), remindAt: iso(at(6, 2, 8, 30)), done: true, slots: [slot(at(6, 2, 9), at(6, 2, 10))],
  }, at(6, 10, 12));
  assert.equal(stamp(Date.parse(b.patch.slots[0].start)), '2026-06-11 09:00');
  assert.equal(stamp(Date.parse(b.patch.remindAt)), '2026-06-11 08:30', '(b) вместе с разовым отрезком');

  // (c): вернётся 17 июня с полуночи — напоминание в тот же день, в своё время суток.
  const c = L.planTaskRoll({
    id: 'c', repeat: R.normalizeRepeat({ freq: 'week', every: 1 }), remindAt: iso(at(6, 10, 9, 15)), done: true,
  }, at(6, 10, 15, 30));
  assert.equal(c.patch.reopenAt, iso(at(6, 17)));
  assert.equal(stamp(Date.parse(c.patch.remindAt)), '2026-06-17 09:15');
});

test('напоминание от дедлайна едет за ним само; без напоминаний патч о них молчит', () => {
  const offset = L.planTaskRoll({
    id: 't', repeat: daily(), dueAt: iso(at(6, 10, 18)), remindOffsetMin: 60, remindAt: iso(at(6, 3, 9)), notifiedAt: iso(at(6, 10, 17)), done: true,
  }, at(6, 10, 20));
  assert.equal(offset.patch.remindOffsetMin, 60, 'смещение то же: время считается от дедлайна, а он и так уехал');
  assert.equal(offset.patch.remindAt, null, 'зеркало списка: при смещении своего времени нет');
  assert.deepEqual(offset.patch.reminders.map((r) => [r.kind, r.anchor, r.offsetMin, r.notifiedUpTo]), [['before', 'due', 60, null]],
    'о новом дедлайне напомнить заново');
  const none = L.planTaskRoll({ id: 't', repeat: daily(), remindAt: null, done: true }, at(6, 10, 12));
  assert.ok(!('remindAt' in none.patch));
  assert.ok(!('reminders' in none.patch));
  const junk = L.planTaskRoll({ id: 't', repeat: daily(), remindAt: 'завтра', done: true }, at(6, 10, 12));
  assert.ok(!('remindAt' in junk.patch), 'мусор — не время');
});

test('напоминания списком на перекате: «в своё время» едут, «повторять» стоит, отметка «до начала» опускается под сдвинутый отрезок', () => {
  const rule = { freq: 'day', every: 1 };
  const repeatRem = { id: 'rep', kind: 'repeat', rule, time: '08:00', start: iso(at(6, 1, 12)), notifiedUpTo: iso(at(6, 10, 8)) };
  const task = {
    id: 't', repeat: daily(), dueAt: iso(at(6, 10, 18)), done: true,
    slots: [
      slot(at(6, 10, 9), at(6, 10, 10), { id: 'am' }),
      slot(at(6, 10, 19), at(6, 10, 21), { id: 'pm' }),
    ],
    reminders: [
      { id: 'a', kind: 'at', at: iso(at(6, 10, 7, 30)), notifiedAt: iso(at(6, 10, 7, 30)) },
      { id: 'b', kind: 'at', at: iso(at(6, 12, 9)), notifiedAt: null },
      // Вечерний отрезок (19–21) идёт сейчас, о нём сказано.
      { id: 's', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min', notifiedUpTo: iso(at(6, 10, 19)) },
      repeatRem,
    ],
    remindOffsetMin: null, remindAt: iso(at(6, 10, 7, 30)),
  };
  const plan = L.planTaskRoll(task, at(6, 10, 20));
  const byId = Object.fromEntries(plan.patch.reminders.map((r) => [r.id, r]));
  assert.equal(stamp(Date.parse(byId.a.at)), '2026-06-11 07:30', 'на столько же дней, что и дедлайн');
  assert.equal(byId.a.notifiedAt, null, 'новый раз — напомнить заново');
  assert.equal(stamp(Date.parse(byId.b.at)), '2026-06-13 09:00');
  assert.deepEqual(byId.rep, { ...repeatRem, rule: R.normalizeRepeat(rule) }, '«повторять» живёт своим правилом');
  // Оба отрезка уехали на 11-е, позже отметки: о них напомнят и так, а
  // отметка не опускается — сказанное раньше второй раз не прозвучит.
  assert.deepEqual(plan.patch.slots.map((s) => stamp(Date.parse(s.start))), ['2026-06-11 09:00', '2026-06-11 19:00']);
  assert.equal(byId.s.notifiedUpTo, iso(at(6, 10, 19)));
  assert.equal(plan.patch.remindAt, byId.a.at, 'зеркало — первое «в своё время»');
  assert.equal(plan.patch.remindOffsetMin, null);

  // За сутки до начала: по ежедневному правилу задачи о вечернем вхождении
  // 11-го уже сказано, а утренний отрезок встал раньше него — отметка
  // опускается прямо под самый ранний сдвинутый.
  const day = { id: 's', kind: 'before', anchor: 'start', offsetMin: 1440, unit: 'day', notifiedUpTo: iso(at(6, 11, 19)) };
  const early = L.planTaskRoll({ ...task, remindAt: null, reminders: [day] }, at(6, 10, 20));
  assert.equal(early.patch.reminders[0].notifiedUpTo, iso(at(6, 11, 9) - 1));
  const M = require('../../src/renderer/core/reminders.js');
  const moved = { ...task, ...early.patch, done: false };
  // Отметка одна на все отрезки, и у этого есть цена: вечернее вхождение
  // 11-го, о котором уже сказали, лежит выше новой отметки и прозвучит ещё
  // раз. Лишнее напоминание лучше пропущенного.
  assert.deepEqual(M.remindersDue([moved], at(6, 10, 20)).map((r) => [r.slotId, stamp(r.start)]),
    [['am', '2026-06-11 09:00'], ['pm', '2026-06-11 19:00']], 'сдвинутые — снова в очереди');

  // (c): якорей нет — «до…» не трогаются, «в своё время» — на день возврата.
  const c = L.planTaskRoll({
    id: 'c', repeat: R.normalizeRepeat({ freq: 'week', every: 1 }), done: true,
    reminders: [
      { id: 'x', kind: 'at', at: iso(at(6, 10, 9, 15)), notifiedAt: iso(at(6, 10, 9, 15)) },
      { id: 'y', kind: 'at', at: iso(at(6, 12, 10)), notifiedAt: null },
      { id: 'd', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour', notifiedUpTo: iso(at(6, 1)) },
    ],
    remindOffsetMin: 60, remindAt: null,
  }, at(6, 10, 15, 30));
  assert.equal(c.open, false);
  assert.deepEqual(c.patch.reminders.map((r) => (r.kind === 'at' ? stamp(Date.parse(r.at)) : r.notifiedUpTo)),
    ['2026-06-17 09:15', '2026-06-19 10:00', iso(at(6, 1))], 'самое раннее — на день возврата, остальные — на столько же дней');
});

test('(c) последний раз серии закрывает её, а не ждёт возврата', () => {
  const task = { id: 't', repeat: daily({ ends: { kind: 'after', count: 2 }, done: 1 }), done: true };
  const plan = L.planTaskRoll(task, at(6, 10, 12));
  assert.equal(plan.finished, true);
  assert.equal(plan.repeat.done, 2);
});

test('плана нет: без правила и у кончившейся серии', () => {
  assert.equal(L.planTaskRoll({ id: 't', repeat: null, dueAt: iso(at(6, 10)) }, at(6, 10, 12)), null);
  assert.equal(L.planTaskRoll({ id: 't', repeat: daily({ ends: { kind: 'after', count: 2 }, done: 2 }) }, at(6, 10, 12)), null);
});

test('historyCopy: выполненная копия со временем, без правила и ожиданий', () => {
  const task = {
    id: 't', title: 'Отчёт', done: true, doneAt: iso(at(6, 10, 12)), repeat: daily(), reopenAt: iso(at(6, 11)),
    sessions: [{ start: iso(at(6, 10, 9)), end: iso(at(6, 10, 10)), ms: 3_600_000 }], totalMs: 3_600_000,
    slots: [slot(at(6, 10, 9), at(6, 10, 10))], pinnedAt: iso(at(6, 1)), remindAt: iso(at(6, 12)), notifiedAt: iso(at(6, 9)),
    remindOffsetMin: 60, reminders: [{ id: 'r', kind: 'before', anchor: 'due', offsetMin: 60 }],
  };
  const before = JSON.stringify(task);
  const copy = L.historyCopy(task, 'c1', at(6, 10, 13));
  assert.equal(JSON.stringify(task), before, 'оригинал не тронут');
  assert.equal(copy.id, 'c1');
  assert.equal(copy.done, true);
  assert.equal(copy.doneAt, task.doneAt);
  assert.equal(copy.title, 'Отчёт');
  for (const k of ['repeat', 'reopenAt', 'pinnedAt', 'remindOffsetMin', 'remindAt', 'notifiedAt']) assert.equal(copy[k], null, k);
  assert.deepEqual(copy.slots, []);
  assert.deepEqual(copy.reminders, [], 'напоминаний у копии нет, и старые поля — их зеркало');
  assert.deepEqual(copy.sessions, task.sessions, 'время уходит с копией');
  assert.notEqual(copy.sessions, task.sessions, 'и это копия, а не тот же массив');
  assert.equal(copy.updatedAt, iso(at(6, 10, 13)));
  assert.equal(L.historyCopy({ id: 't', done: true }, 'c', at(6, 10)).doneAt, iso(at(6, 10)), 'без отметки о закрытии — «сейчас»');
});

/** Применение плана так, как его применяют клиенты. */
function apply(tasks, entry, now) {
  const task = tasks.find((x) => x.id === entry.taskId);
  if (entry.open && entry.keepHistory) {
    tasks.push(L.historyCopy(task, `${task.id}-h`, now));
    task.sessions = [];
  }
  Object.assign(task, entry.patch);
  if (entry.open) Object.assign(task, { done: false, doneAt: null, notifiedAt: null });
}

test('planReopen: наступил reopenAt — задача открывается, раньше — ждёт', () => {
  const rule = daily({ keepHistory: true });
  const tasks = [
    { id: 'due', done: true, repeat: rule, reopenAt: iso(at(6, 11)) },
    { id: 'wait', done: true, repeat: rule, reopenAt: iso(at(6, 12)) },
    { id: 'gone', done: true, repeat: null, reopenAt: iso(at(6, 11)) },
    { id: 'open', done: false, repeat: rule, reopenAt: null },
  ];
  const plan = L.planReopen(tasks, at(6, 11, 8));
  assert.deepEqual(plan, [{ taskId: 'due', open: true, keepHistory: true, patch: { reopenAt: null } }]);
});

// Лечение — только закрытий не раньше SLOTS_SINCE, поэтому даты здесь — июнь
// 2027: перевода часов в нём тоже нет.
const at27 = (m, d, h = 0, min = 0) => new Date(2027, m - 1, d, h, min).getTime();

test('planReopen лечит задачу без дат, закрытую старым клиентом', () => {
  const rule = R.normalizeRepeat({ freq: 'week', every: 1 });
  // Закрыта 1 июня старым клиентом: done есть, reopenAt нет.
  const old = { id: 'old', done: true, doneAt: iso(at27(6, 1, 15)), repeat: rule };
  const fresh = { id: 'fresh', done: true, doneAt: iso(at27(6, 10, 15)), repeat: rule };
  const tasks = [old, fresh];
  const plan = L.planReopen(tasks, at27(6, 10, 16));
  assert.deepEqual(plan.map((p) => [p.taskId, p.open, p.patch.reopenAt]), [
    ['old', true, null], // неделя от 1 июня уже прошла — открывается сразу
    ['fresh', false, iso(at27(6, 17))],
  ]);
  assert.ok(plan.every((p) => p.patch.repeat.done === 1), 'закрытие засчитано один раз');
  for (const entry of plan) apply(tasks, entry, at27(6, 10, 16));
  assert.deepEqual(L.planReopen(tasks, at27(6, 10, 16)), [], 'второй проход ничего не делает');
  assert.equal(old.done, false);
  assert.equal(fresh.done, true);
});

test('planReopen лечит и задачу с разовым отрезком — как перекат (b)', () => {
  const task = { id: 't', done: true, doneAt: iso(at27(6, 10, 12)), repeat: daily(), slots: [slot(at27(6, 10, 9), at27(6, 10, 10))] };
  const [entry] = L.planReopen([task], at27(6, 10, 13));
  assert.equal(entry.open, true);
  assert.equal(stamp(Date.parse(entry.patch.slots[0].start)), '2027-06-11 09:00');
});

test('planReopen не трогает задачи, закрытые до «времени работы»: человек видит их сделанными', () => {
  // Старый клиент закрывал повторяющуюся задачу без дедлайна насовсем. Такие
  // задачи лежат в данных месяцами — воскрешать их нельзя.
  assert.equal(L.SLOTS_SINCE, '2026-10-11T00:00:00.000Z', 'день, когда появилось «время работы»');
  const since = Date.parse(L.SLOTS_SINCE);
  const rule = daily({ keepHistory: true, ends: { kind: 'after', count: 5 }, done: 2 });
  const tasks = [
    { id: 'may', done: true, doneAt: '2026-05-01T10:00:00.000Z', repeat: rule, sessions: [{ ms: 5 }] },
    { id: 'slot', done: true, doneAt: '2026-05-01T10:00:00.000Z', repeat: rule, slots: [slot(at(5, 1, 9), at(5, 1, 10))] },
    { id: 'edge', done: true, doneAt: iso(since - 1), repeat: rule },
    // Когда закрыли, не известно — тоже не трогаем.
    { id: 'blank', done: true, updatedAt: iso(since + 86_400_000), repeat: rule },
  ];
  const before = JSON.stringify(tasks);
  assert.deepEqual(L.planReopen(tasks, Date.parse('2026-12-01T12:00:00.000Z')), [], 'ни возврата, ни счёта, ни копии');
  assert.equal(JSON.stringify(tasks), before);

  // Закрытие в сам день и позже лечится, как прежде.
  const healed = L.planReopen([{ id: 'since', done: true, doneAt: L.SLOTS_SINCE, repeat: rule }], Date.parse('2026-12-01T12:00:00.000Z'));
  assert.deepEqual(healed.map((p) => [p.taskId, p.open, p.keepHistory, p.patch.repeat.done]), [['since', true, true, 3]]);
});

test('planReopen не трогает кончившиеся серии и задачи с дедлайном', () => {
  const tasks = [
    { id: 'finished', done: true, repeat: daily({ ends: { kind: 'after', count: 1 }, done: 1 }) },
    // Серия «до даты» кончилась: план — finished, а правило не трогаем,
    // иначе счётчик рос бы на каждом проходе.
    { id: 'until', done: true, doneAt: iso(at(6, 10, 12)), repeat: daily({ ends: { kind: 'on', at: '2026-06-10' } }) },
    { id: 'deadline', done: true, repeat: daily(), dueAt: iso(at(6, 1)) },
  ];
  assert.deepEqual(L.planReopen(tasks, at(6, 20)), []);
});

test('цикл (c) целиком: закрыли — ждёт — вернулась в свой день с копией', () => {
  const tasks = [{ id: 't', done: true, doneAt: iso(at(6, 10, 12)), repeat: daily({ keepHistory: true }), sessions: [{ ms: 5 }] }];
  const close = L.planTaskRoll(tasks[0], at(6, 10, 12));
  apply(tasks, { taskId: 't', ...close }, at(6, 10, 12));
  assert.equal(tasks.length, 1, 'копия — не при закрытии, а при возврате');
  assert.deepEqual(L.planReopen(tasks, at(6, 10, 23, 59)), []);
  const [back] = L.planReopen(tasks, at(6, 11, 0, 1));
  apply(tasks, back, at(6, 11, 0, 1));
  assert.equal(tasks[0].done, false);
  assert.equal(tasks[0].reopenAt, null);
  assert.deepEqual(tasks[0].sessions, []);
  assert.equal(tasks[1].done, true);
  assert.deepEqual(tasks[1].sessions, [{ ms: 5 }]);
});

test('возврат (c) не будит «повторять» тем, что прошло, пока задача ждала', () => {
  const M = require('../../src/renderer/core/reminders.js');
  // Раз в два дня, без дат; напоминание «каждый день в 09:00». Закрыли 14-го
  // в 10:00 — вернётся 16-го в полночь. 15-го в 09:00 задача молчала
  // (закрыта), и в полночь возврата это вхождение звучать не должно.
  const daily9 = { id: 'rep', kind: 'repeat', rule: { freq: 'day', every: 1 }, time: '09:00', start: iso(at(10, 1, 8)), notifiedUpTo: iso(at(10, 14, 9)) };
  const other = { id: 'once', kind: 'at', at: iso(at(10, 20, 12)), notifiedAt: null };
  const make = () => ({
    id: 't', done: true, doneAt: iso(at(10, 14, 10)), repeat: R.normalizeRepeat({ freq: 'day', every: 2 }),
    reminders: [daily9, other], remindOffsetMin: null, remindAt: other.at,
  });
  const due = (tasks, now) => M.remindersDue(tasks, now).map((e) => [e.reminderId, stamp(e.at)]);

  const tasks = [make()];
  const close = L.planTaskRoll(tasks[0], at(10, 14, 10));
  assert.equal(close.open, false);
  assert.equal(close.patch.reopenAt, iso(at(10, 16)), 'ждёт до полуночи 16-го');
  apply(tasks, { taskId: 't', ...close }, at(10, 14, 10));
  const waiting = tasks[0].reminders.find((r) => r.id === 'once');
  const [back] = L.planReopen(tasks, at(10, 16, 0, 0));
  apply(tasks, back, at(10, 16, 0, 0));
  assert.equal(tasks[0].done, false);
  assert.deepEqual(due(tasks, at(10, 16, 0, 0) + 30_000), [], 'вчерашние 09:00 молчат');
  assert.deepEqual(due(tasks, at(10, 16, 9, 0)), [['rep', '2026-10-16 09:00']], 'сегодняшние — звучат');
  assert.deepEqual(tasks[0].reminders.find((r) => r.id === 'once'), waiting, 'остальные напоминания не тронуты');
  assert.equal(tasks[0].remindAt, waiting.at, 'зеркало старых полей на месте');

  // Приложение не было открыто в полночь: возврат применяется утром, но
  // считается от своего момента — вхождение 16-го в 09:00 уже о живой задаче.
  const late = [make()];
  apply(late, { taskId: 't', ...L.planTaskRoll(late[0], at(10, 14, 10)) }, at(10, 14, 10));
  apply(late, L.planReopen(late, at(10, 16, 10))[0], at(10, 16, 10));
  assert.deepEqual(due(late, at(10, 16, 10)), [['rep', '2026-10-16 09:00']]);

  // Лечение (закрыта старым клиентом, reopenAt нет) — тот же возврат.
  const healed = [make()];
  const [heal] = L.planReopen(healed, at(10, 16, 0, 30));
  assert.equal(heal.open, true);
  apply(healed, heal, at(10, 16, 0, 30));
  assert.deepEqual(due(healed, at(10, 16, 0, 30)), [], 'и здесь вчерашнее молчит');

  // Отметка только растёт: сказанное позже момента возврата не опускается.
  const ahead = { ...make(), reopenAt: iso(at(10, 16)), reminders: [{ ...daily9, notifiedUpTo: iso(at(10, 16, 9)) }], remindAt: null };
  assert.deepEqual(L.planReopen([ahead], at(10, 16, 10))[0].patch, { reopenAt: null });
});

test('planUntick: сняли галочку у ждущей задачи — закрытие и его раз серии отменены', () => {
  const rule = daily({ ends: { kind: 'after', count: 3 }, done: 1 });
  const task = { id: 't', done: true, doneAt: iso(at(6, 10, 12)), repeat: rule };
  const close = L.planTaskRoll(task, at(6, 10, 12));
  apply([task], { taskId: 't', ...close }, at(6, 10, 12));
  assert.equal(task.repeat.done, 2);
  const before = JSON.stringify(task);
  const patch = L.planUntick(task);
  assert.equal(JSON.stringify(task), before, 'задачу не трогает');
  assert.deepEqual(patch, { reopenAt: null, repeat: { ...task.repeat, done: 1 } }, 'счётчик — как до закрытия');
  // Серия «после 3 раз» после этого живёт три полных раза, а не два.
  Object.assign(task, patch, { done: false, doneAt: null });
  assert.equal(R.repeatFinished(task.repeat), false);
});

test('planUntick: без reopenAt снимать нечего; счётчик ниже нуля не уходит', () => {
  assert.equal(L.planUntick({ id: 't', done: false, repeat: daily({ done: 3 }), reopenAt: null }), null, 'открытая (a, b) свой раз отработала');
  assert.equal(L.planUntick(null), null);
  assert.deepEqual(L.planUntick({ id: 't', repeat: daily({ done: 0 }), reopenAt: iso(at(6, 11)) }).repeat.done, 0);
  assert.deepEqual(L.planUntick({ id: 't', repeat: null, reopenAt: iso(at(6, 11)) }), { reopenAt: null }, 'правила нет — только ожидание');
});

test('slotOverlaps не трогает задачи', () => {
  const tasks = [{ id: 'a', projectId: 'p', title: 'А', repeat: { freq: 'day', every: 1 }, slots: [slot(at(6, 10, 10), at(6, 10, 11), { repeat: { freq: 'week' } })] }];
  const before = JSON.stringify(tasks);
  L.slotOverlaps(tasks, { start: iso(at(6, 11, 10)), end: iso(at(6, 11, 12)) }, null);
  assert.equal(JSON.stringify(tasks), before);
});

test('функции отрезков не трогают задачи', () => {
  const tasks = [{
    id: 't', done: true, doneAt: iso(at(6, 1)), repeat: daily(),
    slots: [slot(at(6, 1, 9), at(6, 1, 10), { remindOffsetMin: 15, repeat: { freq: 'day', every: 1 } })],
  }];
  const before = JSON.stringify(tasks);
  L.slotItems(tasks, at(6, 1), at(6, 30));
  L.planTaskRoll(tasks[0], at(6, 10));
  L.planReopen(tasks, at(6, 10));
  L.foldSlotRepeat(tasks[0]);
  assert.equal(JSON.stringify(tasks), before);
});

// --- старое правило у отрезка ---------------------------------------------------

test('foldSlotRepeat: первое правило отрезка достаётся задаче без своего, поле снимается со всех', () => {
  const task = {
    id: 't', repeat: null,
    slots: [
      slot(at(6, 8, 9), at(6, 8, 10), { id: 'a', repeat: null }),
      slot(at(6, 9, 9), at(6, 9, 10), { id: 'b', repeat: { freq: 'week', every: '2', weekdays: [3, 1], from: 'done', keepHistory: true, done: 7, ends: { kind: 'after', count: 5 } } }),
      slot(at(6, 10, 9), at(6, 10, 10), { id: 'c', repeat: { freq: 'day', every: 1 }, цвет: 'синий' }),
    ],
  };
  const patch = L.foldSlotRepeat(task);
  assert.deepEqual(patch.repeat, R.normalizeRepeat({ freq: 'week', every: 2, weekdays: [1, 3], ends: { kind: 'after', count: 5 } }),
    'правило первого отрезка с правилом; from, keepHistory и done у отрезка ничего не значили — по умолчанию');
  assert.deepEqual(patch.slots.map((s) => [s.id, 'repeat' in s]), [['a', false], ['b', false], ['c', false]], 'второе правило отброшено, поле снято у всех');
  assert.equal(patch.slots[2].цвет, 'синий', 'чужое на месте');
  const after = { ...task, ...patch };
  assert.equal(L.foldSlotRepeat(after), null, 'второй прогон молчит');
});

test('foldSlotRepeat: у задачи своё правило — правила отрезков отбрасываются', () => {
  const own = R.normalizeRepeat({ freq: 'month', every: 1 });
  const task = { id: 't', repeat: own, slots: [slot(at(6, 8, 9), at(6, 8, 10), { repeat: { freq: 'day', every: 1 } })] };
  const patch = L.foldSlotRepeat(task);
  assert.ok(!('repeat' in patch), 'правило задачи не трогается');
  assert.ok(!('repeat' in patch.slots[0]));
});

test('foldSlotRepeat: снимать нечего — null; битый отрезок правила не отдаёт', () => {
  assert.equal(L.foldSlotRepeat(null), null);
  assert.equal(L.foldSlotRepeat({ id: 't' }), null);
  assert.equal(L.foldSlotRepeat({ id: 't', slots: [slot(at(6, 8, 9), at(6, 8, 10))] }), null);
  const broken = { id: 't', repeat: null, slots: [{ start: 'x', end: 'y', repeat: { freq: 'day' } }, null] };
  const patch = L.foldSlotRepeat(broken);
  assert.ok(!('repeat' in patch), 'правило у битого отрезка не переносится');
  assert.deepEqual(patch.slots, [{ start: 'x', end: 'y' }, null], 'битые не выбрасываются здесь — это дело normalizeSlot');
});

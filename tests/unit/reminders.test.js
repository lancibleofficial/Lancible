// Напоминания списком: модель, старые поля и движок (core/reminders.js).
// Запуск: npm run test:unit
//
// Даты — местные, в июне 2026: там нет перевода часов ни в одном из поясов,
// где гоняется набор (1 июня 2026 — понедельник). Сам перевод часов — в
// agenda-dst.test.js, там пояс задаётся явно. «Сейчас» всюду параметром.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/renderer/core/reminders.js');
const R = require('../../src/renderer/core/repeat.js');

const MIN = 60000;
const HOUR = 60 * MIN;
const at = (m, d, h = 0, min = 0, y = 2026) => new Date(y, m - 1, d, h, min).getTime();
const iso = (ms) => new Date(ms).toISOString();
const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const stamps = (list) => list.map((e) => stamp(e.at));
const slot = (id, start, end, extra) => ({ id, start: iso(start), end: iso(end), ...extra });
const before = (id, anchor, offsetMin, extra) => ({ id, kind: 'before', anchor, offsetMin, ...extra });
const once = (id, ms, extra) => ({ id, kind: 'at', at: iso(ms), ...extra });
const rep = (id, rule, time, startMs, extra) => ({ id, kind: 'repeat', rule, time, start: iso(startMs), ...extra });
/** Задача со списком и зеркалом старых полей — так её пишет withReminders. */
const withList = (extra, reminders) => {
  const task = { id: 't', ...extra };
  return { ...task, ...M.withReminders(task, reminders) };
};
/** Применить патч так, как применяют клиенты. */
const apply = (task, patch) => ({ ...task, ...patch });

// --- модель -------------------------------------------------------------------

test('normalizeReminder: мусор — это отсутствие напоминания, а не поломка', () => {
  const bad = [
    null, undefined, 'x', 42, [], {}, { kind: 'потом' },
    { kind: 'before' }, { kind: 'before', anchor: 'start' }, { kind: 'before', anchor: 'край', offsetMin: 5 },
    { kind: 'before', anchor: 'due', offsetMin: '15' },
    { kind: 'at' }, { kind: 'at', at: 'вчера' },
    { kind: 'repeat', rule: null, time: '09:00', start: iso(at(6, 1)) },
    { kind: 'repeat', rule: { freq: 'day' }, time: '25:00', start: iso(at(6, 1)) },
    { kind: 'repeat', rule: { freq: 'day' }, time: '09:00' },
  ];
  for (const raw of bad) assert.equal(M.normalizeReminder(raw), null, JSON.stringify(raw));
});

test('normalizeReminder: единица — как ввёл человек, если число в ней целое; предел — 60 суток', () => {
  const unit = (offsetMin, u) => M.normalizeReminder(before('a', 'due', offsetMin, { unit: u })).unit;
  assert.equal(unit(120, 'hour'), 'hour');
  assert.equal(unit(120, 'min'), 'min', '120 минут, а не 2 часа — так ввели');
  assert.equal(unit(90, 'hour'), 'min', '1,5 часа не бывает — минуты');
  assert.equal(unit(1440, undefined), 'day', 'нет единицы — самая крупная подходящая');
  assert.equal(unit(60, '__proto__'), 'hour', 'чужое имя — не единица');
  assert.equal(unit(0, undefined), 'min');
  const off = (v) => M.normalizeReminder(before('a', 'start', v)).offsetMin;
  assert.equal(off(100000), 86400, '60 суток — предел');
  assert.equal(off(-5), 0);
  assert.equal(off(15.6), 16);
});

test('normalizeReminder: неизвестные ключи остаются, известные приводятся, второй прогон ничего не меняет', () => {
  const r = M.normalizeReminder({ id: 7, kind: 'repeat', rule: { freq: 'week', weekdays: [3, 1, 1], лишнее: 1 }, time: '9:05', start: '2026-06-01T06:00:00Z', notifiedUpTo: 'никогда', цвет: 'синий' });
  assert.equal(r.цвет, 'синий');
  assert.equal(r.id, null, 'id — только строка; выдаст его remindersOf');
  assert.deepEqual(r.rule, R.normalizeRepeat({ freq: 'week', weekdays: [1, 3] }));
  assert.equal(r.time, '09:05');
  assert.equal(r.start, '2026-06-01T06:00:00.000Z');
  assert.equal(r.notifiedUpTo, null);
  assert.deepEqual(M.normalizeReminder(r), r);
  const a = M.normalizeReminder({ id: 'a', kind: 'at', at: '2026-06-01T06:00:00Z', notifiedAt: 'да', своё: [1] });
  assert.deepEqual(a, { id: 'a', kind: 'at', at: '2026-06-01T06:00:00.000Z', notifiedAt: null, своё: [1] });
});

test('пресеты и перевод «N единиц» в минуты и обратно', () => {
  assert.deepEqual(M.REMIND_PRESETS, [0, 5, 15, 60, 1440]);
  assert.deepEqual(M.REMIND_UNITS, { min: 1, hour: 60, day: 1440 });
  assert.equal(M.toOffsetMin(2, 'hour'), 120);
  assert.equal(M.toOffsetMin(' 15 ', 'min'), 15, 'строка из поля ввода');
  assert.equal(M.toOffsetMin(1.5, 'hour'), 90);
  assert.equal(M.toOffsetMin(61, 'day'), M.REMIND_MAX_OFFSET_MIN);
  for (const [n, u] of [[-1, 'min'], ['abc', 'min'], ['', 'min'], [5, 'week'], [5, undefined], [NaN, 'min']]) {
    assert.equal(M.toOffsetMin(n, u), null, `${n} ${u}`);
  }
  assert.deepEqual(M.splitOffset(120), { n: 2, unit: 'hour' });
  assert.deepEqual(M.splitOffset(120, 'min'), { n: 120, unit: 'min' });
  assert.deepEqual(M.splitOffset(90, 'hour'), { n: 90, unit: 'min' });
  assert.deepEqual(M.splitOffset(2880, 'day'), { n: 2, unit: 'day' });
  assert.deepEqual(M.splitOffset(0), { n: 0, unit: 'min' });
  assert.equal(M.splitOffset('15'), null);
});

test('describeReminder: вид, N и единица, момент, дни, число месяца, время — без текста', () => {
  assert.deepEqual(M.describeReminder(before('a', 'due', 120, { unit: 'hour' })), { kind: 'before', anchor: 'due', offsetMin: 120, n: 2, unit: 'hour' });
  assert.deepEqual(M.describeReminder(before('a', 'start', 0)), { kind: 'before', anchor: 'start', offsetMin: 0, n: 0, unit: 'min' });
  assert.deepEqual(M.describeReminder(once('a', at(10, 12, 9))), { kind: 'at', at: at(10, 12, 9) });
  assert.deepEqual(M.describeReminder(rep('a', { freq: 'week', weekdays: [3, 1] }, '09:00', at(6, 1))),
    { kind: 'repeat', freq: 'week', every: 1, weekdays: [1, 3], monthDay: null, time: '09:00' });
  assert.equal(M.describeReminder(rep('a', { freq: 'month' }, '09:00', at(6, 5, 12))).monthDay, 5);
  assert.equal(M.describeReminder({ kind: 'мусор' }), null);
});

// --- старые поля --------------------------------------------------------------

test('remindersOf без списка: выводится из старых полей, как считал reminderTime', () => {
  const due = iso(at(6, 10, 18));
  assert.deepEqual(M.remindersOf({ dueAt: due, remindOffsetMin: 60 }), [
    { id: 'legacy-due', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour', notifiedUpTo: null },
  ]);
  assert.equal(M.remindersOf({ dueAt: due, remindOffsetMin: 60, notifiedAt: iso(at(6, 10, 17)) })[0].notifiedUpTo, due,
    'старый клиент уже напомнил — отметка «о том дедлайне»');
  assert.deepEqual(M.remindersOf({ remindAt: '2026-06-10T09:00:00Z', notifiedAt: iso(at(6, 10, 9)) }), [
    { id: 'legacy-at', kind: 'at', at: '2026-06-10T09:00:00.000Z', notifiedAt: iso(at(6, 10, 9)) },
  ]);
  assert.deepEqual(M.remindersOf({ dueAt: due, remindOffsetMin: 0, remindAt: iso(at(6, 1)) }).map((r) => r.id), ['legacy-due'],
    'смещение сильнее своего времени');
  assert.deepEqual(M.remindersOf({}), []);
  assert.deepEqual(M.remindersOf({ remindOffsetMin: 'час', remindAt: 'завтра' }), [], 'мусор — не напоминание');
  assert.deepEqual(M.remindersOf(null), []);
});

test('remindersOf: id детерминированные — телефон без миграции насчитает те же, что запишет миграция', () => {
  const task = {
    id: 't', dueAt: iso(at(6, 10, 18)), remindOffsetMin: 15,
    slots: [slot('s', at(6, 10, 9), at(6, 10, 10), { remindOffsetMin: 5 })],
    reminders: [{ kind: 'at', at: iso(at(6, 9)) }, before('r1', 'due', 15), { id: 'r1', kind: 'at', at: iso(at(6, 8)) }],
  };
  const a = M.remindersOf(task);
  assert.deepEqual(a.map((r) => r.id), ['r2', 'r1', 'r3', 'legacy-start-5'], 'пустые и повторы — ближайший свободный rN');
  assert.deepEqual(M.remindersOf(JSON.parse(JSON.stringify(task))), a);
  const stored = apply(task, M.reconcileReminders(task));
  assert.deepEqual(M.remindersOf(stored), a, 'после миграции — тот же список с теми же id');
  assert.equal(M.reconcileReminders(stored), null, 'второй прогон ничего не меняет');
  assert.ok(stored.slots.every((s) => !('remindOffsetMin' in s)));
});

test('зеркало: первое «до дедлайна», иначе первое «в своё время», иначе пусто', () => {
  const x = iso(at(6, 10, 9));
  assert.deepEqual(M.legacyMirror([]), { remindOffsetMin: null, remindAt: null });
  assert.deepEqual(M.legacyMirror([once('a', at(6, 10, 9)), before('b', 'due', 30), before('c', 'due', 60)]), { remindOffsetMin: 30, remindAt: null });
  assert.deepEqual(M.legacyMirror([before('s', 'start', 15), once('a', at(6, 10, 9)), once('b', at(6, 11))]), { remindOffsetMin: null, remindAt: x });
  assert.deepEqual(M.legacyMirror([before('s', 'start', 15), rep('r', { freq: 'day' }, '09:00', at(6, 1))]), { remindOffsetMin: null, remindAt: null },
    '«до начала» и «повторять» старые клиенты не понимают');
  assert.deepEqual(M.legacyMirror(null), { remindOffsetMin: null, remindAt: null });
});

test('withReminders: патч со списком и зеркалом, новые id, отметки решает ядро', () => {
  const task = withList({ dueAt: iso(at(6, 10, 18)) }, [
    before('due', 'due', 60, { unit: 'hour' }),
    once('at', at(6, 10, 9)),
  ]);
  assert.deepEqual(task.reminders.map((r) => r.id), ['due', 'at']);
  assert.equal(task.remindOffsetMin, 60);
  assert.equal(task.remindAt, null);
  // Оба сработали.
  const fired = { ...task, notifiedAt: iso(at(6, 10, 17)), reminders: [{ ...task.reminders[0], notifiedUpTo: task.dueAt }, { ...task.reminders[1], notifiedAt: iso(at(6, 10, 9)) }] };

  // Подпись сменили (60 мин → 1 ч), «в своё время» передвинули, добавили новое
  // — с отметкой, которую экран мог по ошибке скопировать.
  const patch = M.withReminders(fired, [
    { id: 'due', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'min' },
    { ...fired.reminders[1], at: iso(at(6, 10, 10)) },
    { kind: 'at', at: iso(at(6, 11, 9)), notifiedAt: iso(at(6, 11, 9)) },
    { kind: 'мусор' },
  ]);
  assert.deepEqual(patch.reminders.map((r) => [r.id, r.notifiedUpTo === undefined ? r.notifiedAt : r.notifiedUpTo]), [
    ['due', fired.dueAt], // время то же — отметка прежняя, хоть экран её и не прислал
    ['at', null], // время другое — напомнить заново
    ['r1', null], // новое — чистое
  ]);
  assert.equal(patch.reminders[0].unit, 'min');
  assert.deepEqual([patch.remindOffsetMin, patch.remindAt], [60, null]);
  assert.ok(!('notifiedAt' in patch), 'зеркальное не менялось — старый клиент правильно молчит');

  const changed = M.withReminders(fired, [before('due', 'due', 15)]);
  assert.equal(changed.notifiedAt, null, 'зеркальное стало другим — старому клиенту пора напомнить о новом');
  assert.equal(changed.remindOffsetMin, 15);
  const none = M.withReminders(fired, []);
  assert.deepEqual([none.reminders, none.remindOffsetMin, none.remindAt, none.notifiedAt], [[], null, null, null]);
});

test('withReminders: новому не достаётся id удалённого — и его отметка', () => {
  const task = withList({}, [once('r1', at(6, 10, 9), { notifiedAt: iso(at(6, 10, 9)) })]);
  const patch = M.withReminders(task, [{ kind: 'at', at: iso(at(6, 10, 9)) }]);
  assert.equal(patch.reminders[0].id, 'r2');
  assert.equal(patch.reminders[0].notifiedAt, null);
});

// --- движок: «до начала» --------------------------------------------------------

/** Задача «каждую неделю по Пн и Ср» с двумя отрезками — пн 10–11 и ср
 *  14–15, — за 15 минут до начала. Правило у задачи одно, и по нему
 *  повторяется каждый отрезок от своей даты. */
function workTask(extra) {
  return withList({
    repeat: { freq: 'week', every: 1, weekdays: [1, 3] },
    slots: [
      slot('w', at(6, 1, 10), at(6, 1, 11)),
      slot('o', at(6, 3, 14), at(6, 3, 15)),
    ],
    ...extra,
  }, [before('b', 'start', 15)]);
}

test('«до начала» срабатывает перед каждым вхождением каждого отрезка — по правилу задачи', () => {
  const task = workTask();
  const pending = M.pendingReminders([task], at(6, 2, 12));
  assert.deepEqual(pending.map((e) => [stamp(e.at), e.slotId, stamp(e.start), stamp(e.end)]), [
    ['2026-06-03 09:45', 'w', '2026-06-03 10:00', '2026-06-03 11:00'],
    ['2026-06-03 13:45', 'o', '2026-06-03 14:00', '2026-06-03 15:00'],
    ['2026-06-08 09:45', 'w', '2026-06-08 10:00', '2026-06-08 11:00'],
    ['2026-06-08 13:45', 'o', '2026-06-08 14:00', '2026-06-08 15:00'],
    ['2026-06-10 09:45', 'w', '2026-06-10 10:00', '2026-06-10 11:00'],
  ], 'оба отрезка по Пн и Ср, не больше пяти вхождений на напоминание');
  assert.equal(pending[0].key, `rem-t-b-${at(6, 3, 9, 45)}`);
  assert.deepEqual([pending[0].kind, pending[0].anchor, pending[0].reminderId, pending[0].legacy], ['before', 'start', 'b', false]);
  // Без правила у задачи отрезки разовые; старое правило у отрезка
  // (данные разработки) ничего не значит.
  const plain = workTask({ repeat: null });
  plain.slots[0] = { ...plain.slots[0], repeat: { freq: 'day', every: 1 } };
  assert.deepEqual(M.pendingReminders([plain], at(6, 2, 12)).map((e) => [stamp(e.at), e.slotId]), [['2026-06-03 13:45', 'o']],
    'пн 1 июня прошёл, ср 3-го — один раз');
  // Кончившаяся серия — тоже разово.
  const finished = workTask({ repeat: { freq: 'week', every: 1, weekdays: [1, 3], ends: { kind: 'after', count: 2 }, done: 2 } });
  assert.deepEqual(M.pendingReminders([finished], at(6, 2, 12)).map((e) => e.slotId), ['o']);
});

test('«до начала»: до момента — тишина, во время вхождения — один раз, кончилось — поздно', () => {
  let task = workTask();
  assert.deepEqual(M.remindersDue([task], at(6, 3, 9, 44)), []);
  const due = M.remindersDue([task], at(6, 3, 9, 45));
  assert.deepEqual(due.map((e) => [e.slotId, stamp(e.start)]), [['w', '2026-06-03 10:00']], 'прошлые вхождения не всплывают');
  task = apply(task, M.markFired(task, due[0]));
  assert.equal(task.reminders[0].notifiedUpTo, iso(at(6, 3, 10)));
  assert.ok(!('notifiedAt' in M.markFired(workTask(), due[0])), '«до начала» в старые поля не зеркалится');
  assert.deepEqual(M.remindersDue([task], at(6, 3, 10, 30)), [], 'второй раз — нет');
  assert.deepEqual(M.remindersDue([workTask()], at(6, 3, 11)), [], 'вхождение кончилось — напоминать поздно');
  assert.deepEqual(M.remindersDue([task], at(6, 3, 13, 50)).map((e) => e.slotId), ['o'], 'следующее — своим чередом');
});

test('два отрезка с одним началом — одно напоминание, один ключ', () => {
  const task = withList({ slots: [slot('a', at(6, 10, 10), at(6, 10, 11)), slot('b', at(6, 10, 10), at(6, 10, 12))] }, [before('b0', 'start', 0)]);
  assert.equal(M.pendingReminders([task], at(6, 10, 8)).length, 1);
  assert.equal(M.remindersDue([task], at(6, 10, 10, 5)).length, 1);
});

// --- движок: «до дедлайна» и «в своё время» -------------------------------------

test('«до дедлайна»: срабатывает один раз; дедлайн переехал — заново', () => {
  let task = withList({ dueAt: iso(at(6, 10, 18)) }, [before('d', 'due', 60)]);
  assert.deepEqual(M.remindersDue([task], at(6, 10, 16, 59)), []);
  const due = M.remindersDue([task], at(6, 10, 17));
  assert.deepEqual(due.map((e) => [stamp(e.at), stamp(e.start), e.legacy]), [['2026-06-10 17:00', '2026-06-10 18:00', true]]);
  const patch = M.markFired(task, due[0]);
  assert.equal(patch.notifiedAt, iso(at(6, 10, 17)), 'зеркальное ставит и notifiedAt — старый клиент не повторит');
  task = apply(task, patch);
  assert.deepEqual(M.remindersDue([task], at(6, 10, 17, 30)), []);
  // Дедлайн передвинули (клиенты снимают notifiedAt) — о новом напомнить.
  const moved = { ...task, dueAt: iso(at(6, 10, 19)), notifiedAt: null };
  assert.deepEqual(stamps(M.remindersDue([moved], at(6, 10, 18))), ['2026-06-10 18:00']);
  assert.deepEqual(M.remindersDue([{ ...task, dueAt: null }], at(6, 10, 17, 30)), [], 'без дедлайна — не от чего считать');
});

test('зеркальное, о котором напомнил старый клиент (только notifiedAt), второй раз не звучит', () => {
  const task = withList({ dueAt: iso(at(6, 10, 18)) }, [before('d', 'due', 60), before('e', 'due', 30)]);
  // Десктоп 0.4.3 видит только remindOffsetMin = 60: напомнил и поставил notifiedAt.
  const told = { ...task, notifiedAt: iso(at(6, 10, 17, 0) + 20000) };
  assert.deepEqual(M.remindersDue([told], at(6, 10, 17, 1)), []);
  // Второе «до дедлайна» он не видел — оно звучит своим чередом, но
  // старые поля не трогает.
  const second = M.remindersDue([told], at(6, 10, 17, 31));
  assert.deepEqual(second.map((e) => [e.reminderId, e.legacy]), [['e', false]]);
  assert.ok(!('notifiedAt' in M.markFired(told, second[0])));
  // Без списка (телефон 1.2.2 прислал задачу как есть) — то же самое.
  const legacy = { id: 'l', dueAt: iso(at(6, 10, 18)), remindOffsetMin: 60, notifiedAt: iso(at(6, 10, 17)) };
  assert.deepEqual(M.remindersDue([legacy], at(6, 10, 17, 1)), []);
  const fresh = M.remindersDue([{ ...legacy, notifiedAt: null }], at(6, 10, 17, 1));
  assert.deepEqual(fresh.map((e) => e.key), [`rem-l-legacy-due-${at(6, 10, 17)}`]);
  assert.equal(M.markFired({ ...legacy, notifiedAt: null }, fresh[0]).notifiedAt, iso(at(6, 10, 17)));
});

test('«в своё время»: срабатывает один раз, старше суток — молча пропускается', () => {
  let task = withList({}, [once('a', at(6, 10, 9))]);
  assert.deepEqual(M.remindersDue([task], at(6, 10, 8, 59)), []);
  const due = M.remindersDue([task], at(6, 10, 9));
  assert.deepEqual(due.map((e) => [e.kind, e.legacy, stamp(e.at)]), [['at', true, '2026-06-10 09:00']]);
  task = apply(task, M.markFired(task, due[0]));
  assert.equal(task.reminders[0].notifiedAt, iso(at(6, 10, 9)));
  assert.equal(task.notifiedAt, iso(at(6, 10, 9)));
  assert.deepEqual(M.remindersDue([task], at(6, 10, 10)), []);
  const old = withList({}, [once('a', at(6, 10, 9))]);
  assert.equal(M.remindersDue([old], at(6, 11, 8, 59)).length, 1, 'сутки без минуты — ещё можно');
  assert.deepEqual(M.remindersDue([old], at(6, 11, 9, 1)), [], 'старше суток — поздно');
});

// --- движок: «повторять» --------------------------------------------------------

const occ = (rem, from, to, max) => M.reminderOccurrences({ id: 't' }, rem, from, to, max).map((o) => stamp(o.at));

test('«повторять» каждый день: в своё время, и не раньше момента, когда его завели', () => {
  // Завели во вторник в 15:00 «каждый день в 09:00» — сегодняшнее 09:00 уже прошло и молчит.
  const r = rep('d', { freq: 'day', every: 1 }, '09:00', at(6, 2, 15));
  assert.deepEqual(occ(r, at(6, 1), at(6, 30), 4), ['2026-06-03 09:00', '2026-06-04 09:00', '2026-06-05 09:00', '2026-06-06 09:00']);
  assert.deepEqual(stamps(M.pendingReminders([withList({}, [r])], at(6, 2, 15))),
    ['2026-06-03 09:00', '2026-06-04 09:00', '2026-06-05 09:00', '2026-06-06 09:00', '2026-06-07 09:00']);
});

test('«повторять» по неделе: Пн и Ср; первое вхождение — ближайший подходящий день', () => {
  const r = rep('w', { freq: 'week', every: 1, weekdays: [1, 3] }, '18:30', at(6, 2, 8));
  assert.deepEqual(occ(r, at(6, 1), at(6, 30), 5),
    ['2026-06-03 18:30', '2026-06-08 18:30', '2026-06-10 18:30', '2026-06-15 18:30', '2026-06-17 18:30']);
});

test('«повторять» каждый месяц 31-го: в коротком месяце — последний день, потом снова 31-е, без сползания', () => {
  const r = rep('m', { freq: 'month', every: 1 }, '09:00', at(1, 31, 8, 0, 2027));
  assert.deepEqual(occ(r, at(1, 1, 0, 0, 2027), at(6, 1, 0, 0, 2027), 10),
    ['2027-01-31 09:00', '2027-02-28 09:00', '2027-03-31 09:00', '2027-04-30 09:00', '2027-05-31 09:00']);
});

test('«повторять»: только последнее вхождение за сутки, один раз; кончившееся правило молчит', () => {
  let task = withList({}, [rep('d', { freq: 'day', every: 1 }, '09:00', at(6, 1, 12))]);
  assert.deepEqual(M.remindersDue([task], at(6, 3, 8, 59)).map((e) => stamp(e.at)), ['2026-06-02 09:00'], 'вчерашнее ещё в пределах суток');
  const due = M.remindersDue([task], at(6, 3, 9, 5));
  assert.deepEqual(stamps(due), ['2026-06-03 09:00'], 'вчерашнее и сегодняшнее — звучит одно, последнее');
  assert.deepEqual([due[0].kind, due[0].anchor, due[0].legacy], ['repeat', null, false]);
  task = apply(task, M.markFired(task, due[0]));
  assert.equal(task.reminders[0].notifiedUpTo, iso(at(6, 3, 9)));
  assert.equal(task.notifiedAt, undefined, '«повторять» в старые поля не зеркалится');
  assert.deepEqual(M.remindersDue([task], at(6, 3, 12)), []);
  assert.deepEqual(stamps(M.remindersDue([task], at(6, 4, 9))), ['2026-06-04 09:00']);
  const ended = withList({}, [rep('d', { freq: 'day', every: 1, ends: { kind: 'on', at: '2026-06-05' } }, '09:00', at(6, 1, 12))]);
  assert.deepEqual(stamps(M.pendingReminders([ended], at(6, 3, 12))), ['2026-06-04 09:00', '2026-06-05 09:00']);
});

// --- кто не напоминает ------------------------------------------------------------

test('выполненная, отменённая и ждущая возврата задача не напоминает', () => {
  const list = [before('b', 'start', 15), before('d', 'due', 60), once('a', at(6, 10, 9)), rep('r', { freq: 'day' }, '09:00', at(6, 1))];
  const base = { dueAt: iso(at(6, 10, 10)), slots: [slot('s', at(6, 10, 10), at(6, 10, 11))] };
  const alive = withList(base, list);
  assert.ok(M.remindersDue([alive], at(6, 10, 9, 50)).length > 0, 'открытая — напоминает');
  assert.ok(M.pendingReminders([alive], at(6, 9, 12)).length > 0);
  for (const extra of [{ done: true }, { cancelled: true }, { done: true, reopenAt: iso(at(6, 11)) }]) {
    const task = { ...alive, ...extra };
    assert.deepEqual(M.remindersDue([task], at(6, 10, 9, 50)), [], JSON.stringify(extra));
    assert.deepEqual(M.pendingReminders([task], at(6, 9, 12)), [], JSON.stringify(extra));
    assert.deepEqual(M.reminderFeed(task, at(6, 10, 9, 50)), [], JSON.stringify(extra));
  }
});

// --- расписание телефона ------------------------------------------------------------

test('pendingReminders: пределы, горизонт, разовые — на любой срок вперёд', () => {
  const now = at(6, 10, 12);
  const task = withList({
    dueAt: iso(at(7, 30, 18)),
    repeat: { freq: 'day', every: 1 },
    slots: [slot('d', at(6, 1, 9), at(6, 1, 10))],
  }, [before('due', 'due', 60), before('b', 'start', 0), rep('r', { freq: 'day' }, '20:00', at(6, 1)), once('soon', at(6, 10, 13)), once('past', at(6, 10, 11))]);
  const got = M.pendingReminders([task], now);
  assert.equal(got.filter((e) => e.reminderId === 'b').length, 5, 'не больше пяти вхождений на напоминание');
  assert.equal(got.filter((e) => e.reminderId === 'r').length, 5);
  assert.ok(got.some((e) => e.reminderId === 'due' && e.at === at(7, 30, 17)), 'разовое за горизонтом — всё равно в списке');
  assert.ok(!got.some((e) => e.reminderId === 'past'), 'прошедшее не ставится');
  assert.equal(stamp(got[0].at), '2026-06-10 13:00', 'ближайшие первыми');
  for (let i = 1; i < got.length; i += 1) assert.ok(got[i - 1].at <= got[i].at);
  assert.equal(new Set(got.map((e) => e.key)).size, got.length, 'ключи не повторяются');
  assert.ok(got.every((e) => e.key === `rem-t-${e.reminderId}-${e.at}`));

  const tight = M.pendingReminders([task], now, { horizonMs: 3 * 86_400_000, perReminder: 50, max: 4 });
  assert.equal(tight.length, 4, 'общий предел');
  const wide = M.pendingReminders([task], now, { horizonMs: 3 * 86_400_000, perReminder: 50 });
  assert.deepEqual(stamps(wide.filter((e) => e.reminderId === 'b')), ['2026-06-11 09:00', '2026-06-12 09:00', '2026-06-13 09:00'],
    'горизонт обрезает вхождения');
  assert.deepEqual(M.pendingReminders([task], now, { perReminder: 0 }), []);
});

test('pendingReminders: всего не больше 48, ближайшие первыми', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    ...withList({ repeat: { freq: 'day', every: 1 }, slots: [slot('s', at(6, 10, 13, i), at(6, 10, 14, i))] }, [before('b', 'start', 0)]),
    id: `t${i}`,
  }));
  const got = M.pendingReminders(tasks, at(6, 10, 12));
  assert.equal(got.length, 48);
  assert.ok(got[47].at < at(6, 13, 13));
});

test('pendingReminders: прошедшее и уже сказанное не ставится, своё время без дедлайна — ставится', () => {
  const now = at(6, 10, 12);
  let told = withList({ id: 'told', slots: [slot('s', at(6, 11, 9), at(6, 11, 10))] }, [before('b', 'start', 0)]);
  told = apply(told, M.markFired(told, M.remindersDue([told], at(6, 11, 9, 30))[0]));
  const tasks = [
    withList({ id: 'past' }, [once('a', at(6, 10, 11))]),
    withList({ id: 'own' }, [once('a', at(6, 10, 18))]),
    told,
    withList({ id: 'cancelled', cancelled: true }, [once('a', at(6, 10, 18))]),
  ];
  assert.deepEqual(M.pendingReminders(tasks, now).map((e) => [e.taskId, e.kind, stamp(e.at)]), [['own', 'at', '2026-06-10 18:00']]);
});

// --- общее ----------------------------------------------------------------------

test('функции напоминаний не трогают задачи', () => {
  const tasks = [workTask({ dueAt: iso(at(6, 10, 18)) }), { id: 'l', dueAt: iso(at(6, 10, 18)), remindOffsetMin: 60 }];
  const before0 = JSON.stringify(tasks);
  M.remindersOf(tasks[1]);
  M.reconcileReminders(tasks[1]);
  M.withReminders(tasks[0], []);
  M.remindersDue(tasks, at(6, 3, 9, 50));
  M.pendingReminders(tasks, at(6, 3, 9));
  M.reminderFeed(tasks[0], at(6, 3, 9, 50));
  M.markFired(tasks[0], M.remindersDue(tasks, at(6, 3, 9, 50))[0]);
  assert.equal(JSON.stringify(tasks), before0);
});

test('markFired: напоминания уже нет — патча нет', () => {
  const task = workTask();
  assert.equal(M.markFired(task, { reminderId: 'нет', at: 0, start: 0 }), null);
  assert.equal(M.markFired(null, { reminderId: 'b' }), null);
});

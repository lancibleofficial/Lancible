// Сроки и напоминания. Запуск: npm run test:unit
//
// Три первых теста переехали сюда из money.test.js вместе с самими
// функциями: reminderTime и dueState лежали в core/money.js, к деньгам
// отношения не имели, и именно поэтому телефон их там не нашёл и завёл свои
// копии. Остальное — новое: раньше эти правила не были закрыты ничем.
//
// «Сейчас» всюду задаётся явно. Тест, который зовёт Date.now(), проверяет не
// правило, а день, в который его запустили.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/renderer/core/due.js');

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date(2026, 8, 19, 12).getTime(); // суббота, полдень

const dueIn = (ms, extra) => ({ dueAt: new Date(NOW + ms).toISOString(), ...extra });

// --- состояние срока --------------------------------------------------------

test('dueState различает просрочку, ближайшие сутки и потом', () => {
  assert.equal(D.dueState(dueIn(-HOUR), NOW), 'overdue');
  assert.equal(D.dueState(dueIn(5 * HOUR), NOW), 'soon');
  assert.equal(D.dueState(dueIn(48 * HOUR), NOW), 'later');
  assert.equal(D.dueState({}, NOW), null, 'без срока гореть нечему');
});

test('выполненная задача не горит, даже если срок прошёл', () => {
  assert.equal(D.dueState(dueIn(-HOUR, { done: true }), NOW), null);
});

test('граница «скоро» — ровно сутки', () => {
  // Ровно сутки ещё «скоро», сутки и миллисекунда — уже «потом». Без этого
  // теста граница сдвигается на единицу и никто не замечает.
  assert.equal(D.dueState(dueIn(DAY), NOW), 'soon');
  assert.equal(D.dueState(dueIn(DAY + 1), NOW), 'later');
});

// --- напоминания ------------------------------------------------------------

test('reminderTime считает смещение от срока', () => {
  const due = new Date(NOW).toISOString();
  assert.equal(
    D.reminderTime({ dueAt: due, remindOffsetMin: 15 }).toISOString(),
    new Date(NOW - 15 * 60000).toISOString(),
  );
  assert.equal(D.reminderTime({ dueAt: due, remindOffsetMin: 0 }).toISOString(), due, 'ноль — ровно в срок');
  assert.equal(D.reminderTime({}), null);
});

test('своё время напоминания берётся, только когда смещение снято', () => {
  const due = new Date(NOW).toISOString();
  const own = new Date(NOW - 5 * HOUR).toISOString();
  assert.equal(
    D.reminderTime({ dueAt: due, remindOffsetMin: null, remindAt: own }).toISOString(), own,
    'смещения нет — работает своё время',
  );
  assert.equal(
    D.reminderTime({ dueAt: due, remindOffsetMin: 60, remindAt: own }).toISOString(),
    new Date(NOW - HOUR).toISOString(),
    'смещение сильнее своего времени: при переносе срока напоминание едет следом',
  );
});

test('remindKey различает «не напоминать», пресет и своё время', () => {
  assert.equal(D.remindKey({}), 'null');
  assert.equal(D.remindKey({ remindOffsetMin: null }), 'null');
  assert.equal(D.remindKey({ remindOffsetMin: 0 }), '0', 'ноль — это пресет, а не отсутствие');
  assert.equal(D.remindKey({ remindOffsetMin: 60 }), '60');
  assert.equal(D.remindKey({ remindOffsetMin: null, remindAt: '2026-09-19T10:00:00.000Z' }), 'custom');
});

test('у каждого пресета есть подпись', () => {
  for (const p of D.REMIND_PRESETS) {
    assert.ok(D.REMIND_LABEL[String(p)], `нет подписи у пресета ${p}`);
  }
});

// --- короткая подпись -------------------------------------------------------

const t = (key, params) => (params ? `${key}:${params.n}` : key);
const fmtDateShort = (d) => `дата(${d.getDate()})`;
const short = (task) => D.dueShort(task, NOW, t, fmtDateShort);

test('dueShort называет ближайшие дни словами, дальние — датой', () => {
  assert.equal(short(dueIn(-HOUR)), 'due.overdue');
  assert.equal(short(dueIn(2 * HOUR)), 'due.today');
  assert.equal(short(dueIn(DAY)), 'due.tomorrow');
  assert.equal(short(dueIn(3 * DAY)), 'due.in_days:3');
  assert.equal(short(dueIn(10 * DAY)), 'дата(29)');
  assert.equal(short({}), '', 'без срока подписи нет');
});

test('«завтра» считается по календарю, а не по часам', () => {
  // До срока меньше суток, но это уже следующая дата — значит «завтра», а не
  // «сегодня». Вычитание миллисекунд дало бы здесь обратное.
  const lateToday = new Date(2026, 8, 19, 23, 0).getTime();
  const earlyTomorrow = new Date(2026, 8, 20, 1, 0).toISOString();
  assert.equal(D.dueShort({ dueAt: earlyTomorrow }, lateToday, t, fmtDateShort), 'due.tomorrow');
});

// --- лента уведомлений ------------------------------------------------------

const feed = (tasks, seen) => D.notificationFeed(tasks, seen, NOW);

test('в ленту попадают просроченные, ближайшие и сработавшие напоминания', () => {
  const overdue = { id: 'a', ...dueIn(-HOUR) };
  const soon = { id: 'b', ...dueIn(5 * HOUR) };
  const later = { id: 'c', ...dueIn(10 * DAY) };
  const reminded = { id: 'd', ...dueIn(10 * DAY), remindOffsetMin: 10 * 24 * 60 };
  const got = feed([later, reminded, soon, overdue], null);
  assert.deepEqual(got.map((n) => [n.task.id, n.kind]), [
    ['a', 'overdue'], ['b', 'soon'], ['d', 'reminder'],
  ], 'later без напоминания в ленту не идёт, порядок — по сроку');
});

test('выполненная задача и задача без срока в ленту не идут', () => {
  assert.deepEqual(feed([
    { id: 'a', ...dueIn(-HOUR), done: true },
    { id: 'b' },
  ], null), []);
});

test('непрочитанность считается по моменту события, а не по сроку', () => {
  // У «скоро» момент — сутки до срока, а не сам срок. Иначе задача со сроком
  // через неделю считалась бы непрочитанной всю неделю.
  const soon = { id: 'b', ...dueIn(5 * HOUR) };
  const at = NOW + 5 * HOUR - DAY;
  assert.equal(feed([soon], new Date(at - 1).toISOString())[0].unread, true);
  assert.equal(feed([soon], new Date(at + 1).toISOString())[0].unread, false);
  assert.equal(feed([soon], null)[0].unread, true, 'панель не открывали — всё непрочитано');
});

test('лента не трогает исходный список задач', () => {
  const tasks = [{ id: 'a', ...dueIn(-HOUR) }, { id: 'b', ...dueIn(-2 * HOUR) }];
  const copy = tasks.slice();
  feed(tasks, null);
  assert.deepEqual(tasks, copy);
});

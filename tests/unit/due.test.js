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

// Правила старых полей (смещение от срока сильнее своего времени) теперь
// читает remindersOf — их тесты в reminders.test.js.


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

// --- лента с «временем работы» (с 11 октября 2026) ----------------------------

/** Лента дедлайнов в том виде, в каком она была до «времени работы», —
 *  замороженная копия, слово в слово. Записи дедлайна новой ленты обязаны
 *  совпадать с ней поле в поле (кроме нового key). */
/** Момент напоминания по старым полям — как его считал reminderTime до
 *  списка напоминаний; нужен только замороженной ленте ниже. */
function legacyReminderTime(task) {
  if (task.remindOffsetMin !== null && task.remindOffsetMin !== undefined && task.dueAt) {
    return new Date(new Date(task.dueAt).getTime() - task.remindOffsetMin * 60000);
  }
  return task.remindAt ? new Date(task.remindAt) : null;
}

function frozenFeed(tasks, seenAtIso, now) {
  const seen = seenAtIso ? new Date(seenAtIso).getTime() : 0;
  const out = [];
  for (const task of tasks) {
    if (task.done || !task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    const rt = legacyReminderTime(task);
    const fired = !!rt && rt.getTime() <= now;
    let kind = null;
    let at = due;
    if (due < now) kind = 'overdue';
    else if (due - now <= DAY) { kind = 'soon'; at = due - DAY; }
    else if (fired) { kind = 'reminder'; at = rt.getTime(); }
    if (!kind) continue;
    out.push({ task, kind, at, due, unread: at > seen });
  }
  return out.sort((a, b) => a.due - b.due);
}

const slotOf = (startMs, extra) => ({
  id: 's1', start: new Date(startMs).toISOString(), end: new Date(startMs + HOUR).toISOString(),
  notifiedUpTo: null, ...extra,
});
/** «За 15 минут до начала» — общее на все отрезки задачи (core/reminders.js). */
const before15 = [{ id: 'r15', kind: 'before', anchor: 'start', offsetMin: 15 }];

/** Пёстрый набор: дедлайны всех видов, отменённая с дедлайном (её лента
 *  брала и раньше), задачи без дедлайна со своим временем и с отрезками. */
function mixed() {
  return [
    { id: 'a', ...dueIn(-HOUR) },
    { id: 'b', ...dueIn(5 * HOUR) },
    { id: 'c', ...dueIn(10 * DAY) },
    { id: 'd', ...dueIn(10 * DAY), remindOffsetMin: 10 * 24 * 60 },
    { id: 'e', ...dueIn(-2 * HOUR), done: true },
    { id: 'f', ...dueIn(3 * HOUR), cancelled: true },
    { id: 'g', ...dueIn(DAY), remindAt: new Date(NOW - HOUR).toISOString() },
    { id: 'h', ...dueIn(2 * DAY), slots: [slotOf(NOW + 5 * 60000)], reminders: before15 },
    { id: 'm', ...dueIn(3 * DAY), remindAt: new Date(NOW - 2 * HOUR).toISOString() },
    { id: 'own', remindAt: new Date(NOW - 30 * 60000).toISOString() },
    { id: 'later', remindAt: new Date(NOW + HOUR).toISOString() },
    { id: 'gone', remindAt: new Date(NOW - HOUR).toISOString(), cancelled: true },
    // Правило повтора — у задачи, одно на оба отрезка.
    { id: 'slots', repeat: { freq: 'day', every: 1 }, slots: [slotOf(NOW + 10 * 60000), slotOf(NOW - 30 * 60000, { id: 's2' })], reminders: before15 },
  ];
}

test('записи дедлайна — те же, что выдавала прежняя лента, поле в поле', () => {
  for (const seen of [null, new Date(NOW - DAY).toISOString(), new Date(NOW + HOUR).toISOString()]) {
    const tasks = mixed();
    const got = D.notificationFeed(tasks, seen, NOW)
      .filter((n) => n.kind === 'overdue' || n.kind === 'soon')
      .map(({ key, ...rest }) => rest);
    const want = frozenFeed(tasks, seen, NOW).filter((n) => n.kind !== 'reminder');
    assert.deepEqual(got, want, `seen = ${seen}`);
    assert.ok(got.length >= 3, 'есть что сравнивать');
  }
});

test('напоминание у задачи с дедлайном — то же, что выдавала прежняя лента, теперь из списка', () => {
  // Прежняя лента клала напоминание дедлайна (или своё время при дедлайне)
  // записью дедлайна. Теперь его даёт список задачи (core/reminders.js), а
  // момент, срок, прочитанность и правило «дедлайн в ленте — напоминания
  // нет» — те же. Ключ свой, rem-…: запись принадлежит напоминанию.
  for (const seen of [null, new Date(NOW - DAY).toISOString(), new Date(NOW - 90 * 60000).toISOString()]) {
    const tasks = mixed();
    const pick = (n) => [n.task.id, n.kind, n.at, n.due, n.unread];
    const got = D.notificationFeed(tasks, seen, NOW).filter((n) => n.task.dueAt && n.kind === 'reminder');
    const want = frozenFeed(tasks, seen, NOW).filter((n) => n.kind === 'reminder');
    assert.deepEqual(got.map(pick), want.map(pick), `seen = ${seen}`);
    assert.deepEqual(got.map((n) => n.task.id), ['m', 'd'], 'и своё время, и смещение от дедлайна');
    assert.ok(got.every((n) => n.key.startsWith(`rem-${n.task.id}-`) && n.reminderId));
  }
});

test('отрезок с напоминанием: запись slot, пока вхождение не кончилось', () => {
  const got = D.notificationFeed(mixed(), null, NOW).filter((n) => n.kind === 'slot');
  assert.deepEqual(got.map((n) => [n.task.id, n.slotId, n.at - n.due, n.end - n.due]), [
    ['slots', 's2', -15 * 60000, HOUR], // повторяющийся — идёт сейчас
    ['h', 's1', -15 * 60000, HOUR],
    ['slots', 's1', -15 * 60000, HOUR],
  ]);
  assert.ok(got.every((n) => n.unread));
  const after = D.notificationFeed(mixed(), null, NOW + 2 * HOUR).filter((n) => n.kind === 'slot' && n.slotId === 's1');
  assert.deepEqual(after, [], 'вхождение кончилось — из ленты ушло');
});

test('своё время без дедлайна: запись reminder с due: null', () => {
  const got = D.notificationFeed(mixed(), null, NOW).filter((n) => !n.task.dueAt && n.kind === 'reminder');
  assert.deepEqual(got.map((n) => [n.task.id, n.due, n.at]), [['own', null, NOW - 30 * 60000]],
    'будущее время ещё не сработало, отменённая задача не напоминает');
});

test('у каждой записи ленты свой key', () => {
  const got = D.notificationFeed(mixed(), null, NOW);
  assert.ok(got.every((n) => typeof n.key === 'string' && n.key));
  assert.equal(new Set(got.map((n) => n.key)).size, got.length);
  assert.equal(got.find((n) => n.task.id === 'a').key, 'due-a');
});

// --- лента и список напоминаний (core/reminders.js) ----------------------------

const iso = (ms) => new Date(ms).toISOString();

test('разовые напоминания — одна запись на задачу, самая свежая из наступивших', () => {
  const task = {
    id: 'x', ...dueIn(10 * DAY), remindOffsetMin: 10 * 24 * 60,
    reminders: [
      { id: 'week', kind: 'before', anchor: 'due', offsetMin: 10 * 24 * 60 },
      { id: 'own', kind: 'at', at: iso(NOW - HOUR) },
      { id: 'soon', kind: 'at', at: iso(NOW + HOUR) },
    ],
  };
  const got = feed([task], null);
  assert.deepEqual(got.map((n) => [n.kind, n.reminderId, n.at, n.due]), [['reminder', 'week', NOW, NOW + 10 * DAY]]);
  // Через час «в своё время» станет свежее — запись его, а не обе.
  const later = D.notificationFeed([task], null, NOW + HOUR);
  assert.deepEqual(later.map((n) => n.reminderId), ['soon']);
});

test('«повторять»: в ленте последнее вхождение за сутки, без срока', () => {
  const daily = { id: 'rep', kind: 'repeat', rule: { freq: 'day', every: 1 }, time: '09:00', start: iso(NOW - 30 * DAY) };
  const got = feed([{ id: 'r', reminders: [daily] }], null);
  assert.deepEqual(got.map((n) => [n.kind, n.due, new Date(n.at).getHours(), new Date(n.at).getDate()]), [['reminder', null, 9, 19]]);
  assert.match(got[0].key, /^rem-r-rep-\d+$/);
  // Дедлайн рядом не мешает: правило с ним не связано.
  assert.equal(feed([{ id: 'r', ...dueIn(HOUR), reminders: [daily] }], null).length, 2);
});

test('отменённая задача не напоминает; её дедлайн в ленте остаётся, как раньше', () => {
  const task = { id: 'x', cancelled: true, ...dueIn(10 * DAY), remindOffsetMin: 10 * 24 * 60, slots: [slotOf(NOW + 5 * 60000)], reminders: [...before15, { id: 'd', kind: 'before', anchor: 'due', offsetMin: 10 * 24 * 60 }] };
  assert.deepEqual(feed([task], null), []);
  assert.deepEqual(feed([{ ...task, ...dueIn(-HOUR) }], null).map((n) => n.kind), ['overdue']);
});

test('смещение у отрезка из данных разработки (без списка) — то же «до начала»', () => {
  const task = { id: 'dev', slots: [slotOf(NOW + 5 * 60000, { remindOffsetMin: 15 })] };
  assert.deepEqual(feed([task], null).map((n) => [n.kind, n.slotId, n.at - n.due]), [['slot', 's1', -15 * 60000]]);
});

// Деньги и сводки. Самый дорогой слой: ошибка здесь — это неверный счёт
// заказчику. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/renderer/core/money.js');

const HOUR = 3_600_000;

test('ставка задачи перебивает общую', () => {
  assert.equal(M.effectiveRate({ rate: 2000 }, 1000), 2000);
  assert.equal(M.effectiveRate({ rate: null }, 1000), 1000);
  assert.equal(M.effectiveRate({ rate: '' }, 1000), 1000, 'пустая строка — это «не задано»');
  assert.equal(M.effectiveRate({}, 1000), 1000);
});

test('нулевая ставка задачи — это ноль, а не «не задано»', () => {
  // Работа бывает бесплатной, и ноль надо уметь задать явно.
  assert.equal(M.effectiveRate({ rate: 0 }, 1000), 0);
});

test('без общей ставки всё считается по нулю, а не падает', () => {
  assert.equal(M.effectiveRate({}, undefined), 0);
  assert.equal(M.effectiveRate({}, null), 0);
});

test('запись времени помнит свою ставку', () => {
  // Ставку подняли уже после того, как время было записано. Пересчитывать
  // прошлое нельзя — иначе выставленный счёт разойдётся с приложением.
  const task = { rate: 2000 };
  assert.equal(M.sessionRate({ ms: HOUR, rate: 1000 }, task, 500), 1000);
  assert.equal(M.sessionRate({ ms: HOUR }, task, 500), 2000, 'без своей ставки — ставка задачи');
});

test('earnedOf складывает записи по их собственным ставкам', () => {
  const task = {
    id: 'a', rate: 2000, sessions: [
      { start: '2026-09-19T10:00:00', ms: HOUR },
      { start: '2026-09-19T12:00:00', ms: HOUR / 2, rate: 1000 },
    ],
  };
  assert.equal(M.earnedOf(task, 0, null, 0), 2500);
});

test('earnedOf добавляет идущий таймер по текущей ставке', () => {
  const now = 1_000_000;
  const task = { id: 'a', rate: 3600, sessions: [] };
  const timer = { taskId: 'a', startedAt: new Date(now - HOUR).toISOString() };
  assert.equal(M.earnedOf(task, 0, timer, now), 3600);

  const alien = { taskId: 'b', startedAt: new Date(now - HOUR).toISOString() };
  assert.equal(M.earnedOf(task, 0, alien, now), 0, 'чужой таймер денег не приносит');
});

test('задача без записей времени не приносит денег', () => {
  assert.equal(M.earnedOf({ id: 'a', rate: 5000 }, 1000, null, 0), 0);
  assert.equal(M.earnedOf({ id: 'a', rate: 5000, sessions: [] }, 1000, null, 0), 0);
});

test('aggregateDays раскладывает записи по дням местного времени', () => {
  const tasks = [{
    id: 'a', rate: 1000, sessions: [
      { start: new Date(2026, 8, 19, 10).toISOString(), ms: HOUR },
      { start: new Date(2026, 8, 19, 15).toISOString(), ms: HOUR },
      { start: new Date(2026, 8, 20, 10).toISOString(), ms: HOUR / 2 },
    ],
  }];
  const days = M.aggregateDays(tasks, 0);
  assert.equal(days.size, 2);
  assert.deepEqual(days.get('2026-09-19'), { ms: 2 * HOUR, money: 2000, count: 2 });
  assert.deepEqual(days.get('2026-09-20'), { ms: HOUR / 2, money: 500, count: 1 });
});

test('rangeAgg берёт границы включительно', () => {
  const tasks = [{
    id: 'a', rate: 1000, sessions: [
      { start: new Date(2026, 8, 18, 12).toISOString(), ms: HOUR },
      { start: new Date(2026, 8, 19, 12).toISOString(), ms: HOUR },
      { start: new Date(2026, 8, 20, 12).toISOString(), ms: HOUR },
    ],
  }];
  const r = M.rangeAgg(tasks, new Date(2026, 8, 18, 0), new Date(2026, 8, 19, 23, 59, 59), 0);
  assert.equal(r.ms, 2 * HOUR);
  assert.equal(r.money, 2000);
});

test('rangeAgg на пустом диапазоне даёт нули, а не пустоту', () => {
  const r = M.rangeAgg([], new Date(2026, 0, 1), new Date(2026, 0, 2), 1000);
  assert.deepEqual(r, { ms: 0, money: 0 });
});

test('tasksDoneOnDay не считает завершения без даты', () => {
  // У задач, закрытых до появления поля doneAt, его нет. Такие не попадают
  // ни в один день — это ожидаемо, а не потеря.
  const tasks = [
    { id: 'a', doneAt: new Date(2026, 8, 19, 10).toISOString() },
    { id: 'b', doneAt: null },
    { id: 'c' },
  ];
  assert.deepEqual(M.tasksDoneOnDay(tasks, '2026-09-19').map((t) => t.id), ['a']);
});

test('dueState различает просрочку, ближайшие сутки и потом', () => {
  const now = new Date(2026, 8, 19, 12).getTime();
  const at = (h) => ({ dueAt: new Date(now + h * HOUR).toISOString() });
  assert.equal(M.dueState(at(-1), now), 'overdue');
  assert.equal(M.dueState(at(5), now), 'soon');
  assert.equal(M.dueState(at(48), now), 'later');
  assert.equal(M.dueState({}, now), null, 'без срока гореть нечему');
});

test('выполненная задача не горит, даже если срок прошёл', () => {
  const now = Date.now();
  assert.equal(M.dueState({ dueAt: new Date(now - HOUR).toISOString(), done: true }, now), null);
});

test('reminderTime считает смещение от срока', () => {
  const due = new Date(2026, 8, 19, 12).toISOString();
  assert.equal(
    M.reminderTime({ dueAt: due, remindOffsetMin: 15 }).toISOString(),
    new Date(new Date(due).getTime() - 15 * 60000).toISOString(),
  );
  assert.equal(M.reminderTime({ dueAt: due, remindOffsetMin: 0 }).toISOString(), due, 'ноль — ровно в срок');
  assert.equal(M.reminderTime({}), null);
});

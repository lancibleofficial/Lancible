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

// --- правка записи времени --------------------------------------------------

const SPAN = {
  start: new Date(2026, 8, 19, 10),
  end: new Date(2026, 8, 19, 12),
  ms: 2 * HOUR,
};
const EDITED_AT = new Date(2026, 8, 20, 9).getTime();

test('новая запись прибавляется ко времени задачи', () => {
  const task = { rate: null, totalMs: HOUR, sessions: [] };
  const upd = M.planSessionEdit(task, null, SPAN, 500, EDITED_AT);
  assert.equal(upd.totalMs, 3 * HOUR);
  assert.equal(upd.sessions.length, 1);
  assert.equal(upd.sessions[0].rate, 500, 'у новой записи ставка задачи');
  assert.equal(upd.sessions[0].manual, true);
});

test('правка записи заменяет её время, а не прибавляет', () => {
  const task = { rate: null, totalMs: 5 * HOUR, sessions: [{ ms: 4 * HOUR, rate: 100 }] };
  const upd = M.planSessionEdit(task, 0, SPAN, 500, EDITED_AT);
  assert.equal(upd.totalMs, 3 * HOUR, '5 − 4 + 2');
  assert.equal(upd.sessions.length, 1);
});

test('своя ставка записи переживает правку', () => {
  // Ставку записи ставили осознанно. Пересчитать её по текущей ставке задачи
  // значило бы молча изменить уже заработанное.
  const task = { rate: 900, totalMs: 4 * HOUR, sessions: [{ ms: 4 * HOUR, rate: 123 }] };
  const upd = M.planSessionEdit(task, 0, SPAN, 500, EDITED_AT);
  assert.equal(upd.sessions[0].rate, 123);
});

test('время задачи не уходит в минус', () => {
  // Данные могли разъехаться при синхронизации: сумма меньше, чем запись,
  // которую из неё вычитают. Итог упирается в ноль — так вело себя и
  // исходное applySessionEdit, перенос это поведение сохранил.
  //
  // Строго говоря, честнее было бы оставить длительность самой записи (2
  // часа): ноль теряет и её тоже. Но это уже не перенос, а правка смысла, и
  // делать её заодно нельзя — тест фиксирует, как есть сейчас.
  const task = { rate: null, totalMs: HOUR, sessions: [{ ms: 10 * HOUR, rate: 0 }] };
  const upd = M.planSessionEdit(task, 0, SPAN, 0, EDITED_AT);
  assert.equal(upd.totalMs, 0);
});

test('план не трогает задачу на месте', () => {
  const task = { rate: null, totalMs: HOUR, sessions: [{ ms: HOUR, rate: 1 }] };
  M.planSessionEdit(task, 0, SPAN, 500, EDITED_AT);
  assert.equal(task.totalMs, HOUR);
  assert.equal(task.sessions.length, 1);
  assert.equal(task.sessions[0].ms, HOUR);
});

test('несуществующий номер записи означает новую, а не поломку', () => {
  const task = { rate: null, totalMs: 0, sessions: [] };
  const upd = M.planSessionEdit(task, 7, SPAN, 500, EDITED_AT);
  assert.equal(upd.sessions.length, 1);
  assert.equal(upd.totalMs, 2 * HOUR);
});

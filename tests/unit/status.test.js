// Статусы задач. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/renderer/core/status.js');

const statuses = [
  { id: 's3', projectId: 'p1', kind: 'done', order: 2, name: 'Готово' },
  { id: 's1', projectId: 'p1', kind: 'todo', order: 0, name: 'К выполнению' },
  { id: 's2', projectId: 'p1', kind: 'progress', order: 1, name: 'В работе' },
  { id: 'x1', projectId: 'p2', kind: 'todo', order: 0, name: 'Чужой' },
];

test('orderedStatuses отдаёт только свой проект и в заданном порядке', () => {
  assert.deepEqual(S.orderedStatuses(statuses, 'p1').map((s) => s.id), ['s1', 's2', 's3']);
  assert.deepEqual(S.orderedStatuses(statuses, 'p2').map((s) => s.id), ['x1']);
  assert.deepEqual(S.orderedStatuses(statuses, 'нет такого'), []);
});

test('getStatus возвращает null, а не падает, на неизвестном идентификаторе', () => {
  assert.equal(S.getStatus(statuses, 's1').name, 'К выполнению');
  assert.equal(S.getStatus(statuses, 'призрак'), null);
});

test('новая задача попадает в первый «к выполнению» своего проекта', () => {
  assert.equal(S.defaultStatusId(statuses, 'p1', false), 's1');
});

test('выполненная задача попадает в первый «готово» своего проекта', () => {
  assert.equal(S.defaultStatusId(statuses, 'p1', true), 's3');
});

test('когда подходящего вида нет, берётся край набора', () => {
  // Пользователь вправе удалить «к выполнению» — задачу всё равно нужно
  // куда-то положить, иначе она пропадёт с доски.
  const noTodo = [
    { id: 'a', projectId: 'p', kind: 'backlog', order: 0 },
    { id: 'b', projectId: 'p', kind: 'progress', order: 1 },
  ];
  assert.equal(S.defaultStatusId(noTodo, 'p', false), 'a', 'без «к выполнению» — первый столбец');
  assert.equal(S.defaultStatusId(noTodo, 'p', true), 'b', 'без «готово» — последний столбец');
});

test('у проекта без статусов статуса нет — и это не ошибка', () => {
  assert.equal(S.defaultStatusId(statuses, 'пустой', false), null);
});

test('выполненным считается только вид done, отменённое — нет', () => {
  // На этом держится честность счётчика «сделано 8 из 10»: отменённая задача
  // уходит из работы, но достижением не является.
  const set = [
    { id: 'd', projectId: 'p', kind: 'done', order: 0 },
    { id: 'c', projectId: 'p', kind: 'cancelled', order: 1 },
    { id: 'w', projectId: 'p', kind: 'progress', order: 2 },
  ];
  assert.equal(S.isDoneStatus(set, 'd'), true);
  assert.equal(S.isDoneStatus(set, 'c'), false);
  assert.equal(S.isClosedStatus(set, 'd'), true);
  assert.equal(S.isClosedStatus(set, 'c'), true, 'отменённая тоже уходит из работы');
  assert.equal(S.isClosedStatus(set, 'w'), false);
  assert.equal(S.isClosedStatus(set, 'призрак'), false, 'несуществующий статус ничего не закрывает');
});

test('набор по умолчанию: шесть статусов, оба закрывающих вида на месте', () => {
  let n = 0;
  const rows = S.makeProjectStatuses('p', (key) => 'имя:' + key, () => 'id' + (++n));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.kind), ['backlog', 'todo', 'progress', 'progress', 'done', 'cancelled']);
  assert.deepEqual(rows.map((r) => r.order), [0, 1, 2, 3, 4, 5]);
  assert.ok(rows.every((r) => r.projectId === 'p' && r.builtin === true));
  assert.equal(rows[0].name, 'имя:backlog', 'название берётся снаружи — оно зависит от языка');
});

test('все виды из набора по умолчанию — известные виды', () => {
  assert.ok(S.DEFAULT_STATUSES.every((s) => S.STATUS_KINDS.includes(s.kind)));
});

test('«Checking» — это ещё работа, а не закрытие', () => {
  // Задача на проверке открыта: её нельзя записать ни в сделанные, ни в
  // отменённые, пока проверка не закончилась.
  const checking = S.DEFAULT_STATUSES.find((s) => s.key === 'checking');
  assert.equal(checking.kind, 'progress');
});

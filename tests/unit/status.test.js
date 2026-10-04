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

test('удалить единственный статус проекта нельзя', () => {
  const one = [{ id: 'a', projectId: 'p', kind: 'todo', order: 0, name: 'Один' }];
  assert.equal(S.planStatusDelete(one, [], 'a').blocked, 'last');
});

test('удалить последний «готово» нельзя — задачу станет нечем закрыть', () => {
  assert.equal(S.planStatusDelete(statuses, [], 's3').blocked, 'last_done');
  // Второй «готово» снимает запрет с обоих.
  const two = statuses.concat({ id: 's4', projectId: 'p1', kind: 'done', order: 3, name: 'Сдано' });
  assert.equal(S.planStatusDelete(two, [], 's3').blocked, undefined);
  assert.equal(S.planStatusDelete(two, [], 's4').blocked, undefined);
});

test('несуществующий статус — не падение, а отказ', () => {
  assert.equal(S.planStatusDelete(statuses, [], 'призрак').blocked, 'missing');
});

test('задачи переезжают в статус того же вида, иначе в первый по порядку', () => {
  const set = [
    { id: 'a', projectId: 'p', kind: 'todo', order: 0, name: 'A' },
    { id: 'b', projectId: 'p', kind: 'progress', order: 1, name: 'B' },
    { id: 'c', projectId: 'p', kind: 'progress', order: 2, name: 'C' },
  ];
  assert.equal(S.planStatusDelete(set, [], 'b').target.id, 'c', 'вид совпадает — берём его');
  assert.equal(S.planStatusDelete(set, [], 'a').target.id, 'b', 'своего вида больше нет — первый по порядку');
});

test('переезжают только задачи удаляемого статуса', () => {
  const tasks = [
    { id: 't1', statusId: 's1' },
    { id: 't2', statusId: 's2' },
    { id: 't3', statusId: 's1' },
  ];
  const plan = S.planStatusDelete(statuses, tasks, 's1');
  assert.deepEqual(plan.moving.map((t) => t.id), ['t1', 't3']);
  assert.equal(plan.target.id, 's2', 'своего вида нет — первый оставшийся по порядку');
});

test('заблокированный план не называет, куда переезжать', () => {
  // Иначе вызывающий код мог бы спросить пользователя о переезде, которого
  // не будет.
  const plan = S.planStatusDelete(statuses, [{ id: 't', statusId: 's3' }], 's3');
  assert.equal(plan.target, undefined);
  assert.equal(plan.moving, undefined);
});

// --- Галочка «выполнено» ----------------------------------------------------
// Правило одно на обе платформы, применяют его по-разному. Расхождение здесь
// значит, что одна и та же галочка уводит задачу в разные статусы на телефоне
// и на десктопе — а заметно это только по жалобе.

const doneSet = [
  { id: "todo", projectId: "p", kind: "todo", order: 0 },
  { id: "work", projectId: "p", kind: "progress", order: 1 },
  { id: "done", projectId: "p", kind: "done", order: 2 },
  { id: "sent", projectId: "p", kind: "done", order: 3 },
];

test("галочка уводит в первый «готово», если задача ещё не закрыта", () => {
  const task = { projectId: "p", statusId: "work" };
  assert.deepEqual(S.planTaskDone(doneSet, task, true), { moveTo: "done" });
});

test("задача в «Сдано» при повторной отметке остаётся там же", () => {
  // Вид уже нужный — значит менять статус не на что, меняется только флаг.
  // Иначе несколько завершающих статусов схлопнулись бы в первый.
  const task = { projectId: "p", statusId: "sent" };
  assert.deepEqual(S.planTaskDone(doneSet, task, true), { setDone: true });
});

test("снятие галочки уводит в «к выполнению», а не туда, откуда пришла", () => {
  const task = { projectId: "p", statusId: "sent" };
  assert.deepEqual(S.planTaskDone(doneSet, task, false), { moveTo: "todo" });
});

test("у проекта без статусов переезжать некуда — меняется только флаг", () => {
  const task = { projectId: "пусто", statusId: null };
  assert.deepEqual(S.planTaskDone(doneSet, task, true), { setDone: true });
});

test("без задачи план не падает", () => {
  assert.deepEqual(S.planTaskDone(doneSet, null, true), { setDone: true });
  assert.deepEqual(S.planTaskDone(doneSet, undefined, false), { setDone: false });
});

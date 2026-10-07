// Экран проекта: группы списка задач и строки вкладки «Версии».
// Запуск: npm run test:unit
//
// С редизайна 6 октября 2026 список задач проекта сгруппирован по статусам
// в порядке столбцов доски (закреплённые — сверху), а у проекта появилась
// вкладка «Версии». Что куда попадает и что сколько стоит — решает ядро
// (core/views.js), его и проверяем.
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectListGroups, versionRows } = require('../../src/renderer/core/views.js');

const HOUR = 3_600_000;
const NOW = new Date(2026, 5, 10, 12).getTime();

const STATUSES = [
  { id: 'todo', projectId: 'p1', name: 'To do', color: '#9aa0ab', kind: 'todo', order: 0 },
  { id: 'prog', projectId: 'p1', name: 'In progress', color: '#f5c451', kind: 'progress', order: 1 },
  { id: 'done', projectId: 'p1', name: 'Done', color: '#87ff65', kind: 'done', order: 2 },
  { id: 'x', projectId: 'p2', name: 'Чужой', color: '#000', kind: 'todo', order: 0 },
];
const task = (id, over = {}) => ({
  id, projectId: 'p1', title: id, statusId: 'todo', done: false, pinnedAt: null,
  totalMs: 0, sessions: [], versionId: null, rate: null, ...over,
});
const ctx = (over = {}) => ({ statuses: STATUSES, projectId: 'p1', collapsed: [], activeTimer: null, now: NOW, ...over });
const keys = (groups) => groups.map((g) => g.key);
const ids = (g) => g.tasks.map((t) => t.id);

test('группы идут в порядке столбцов доски, пустых нет', () => {
  const groups = projectListGroups([
    task('a', { statusId: 'done', done: true }),
    task('b', { statusId: 'todo' }),
    task('c', { statusId: 'todo' }),
  ], ctx());
  assert.deepEqual(keys(groups), ['todo', 'done'], '«В работе» пустая — её нет');
  assert.deepEqual(ids(groups[0]), ['b', 'c'], 'внутри группы — прежний порядок');
  assert.deepEqual(groups[0].status, { name: 'To do', color: '#9aa0ab', kind: 'todo' });
});

test('закреплённые — своей группой сверху, в порядке закрепления', () => {
  const groups = projectListGroups([
    task('a', { pinnedAt: '2026-06-02T00:00:00Z' }),
    task('b'),
    task('c', { pinnedAt: '2026-06-01T00:00:00Z', statusId: 'prog' }),
  ], ctx());
  assert.deepEqual(keys(groups), ['pinned', 'todo']);
  assert.deepEqual(ids(groups[0]), ['c', 'a']);
  assert.equal(groups[0].status, null, 'у закреплённых нет цвета статуса');
});

test('задача с пропавшим статусом не теряется: она там, где её поставил бы проект', () => {
  const groups = projectListGroups([
    task('lost', { statusId: 'deleted' }),
    task('alien', { statusId: 'x' }),
    task('closed', { statusId: 'deleted', done: true }),
  ], ctx());
  assert.deepEqual(keys(groups), ['todo', 'done']);
  assert.deepEqual(ids(groups[0]), ['lost', 'alien']);
  assert.deepEqual(ids(groups[1]), ['closed'], 'выполненная — в первый «готово»');
});

test('у группы считается время, идущий таймер тоже', () => {
  const running = { taskId: 'b', startedAt: new Date(NOW - HOUR).toISOString() };
  const groups = projectListGroups([
    task('a', { totalMs: 2 * HOUR }),
    task('b', { totalMs: HOUR }),
  ], ctx({ activeTimer: running }));
  assert.equal(groups[0].ms, 4 * HOUR);
});

test('свёрнутая группа помечена, но задачи отдаёт — для счётчика', () => {
  const groups = projectListGroups([task('a'), task('b', { statusId: 'done', done: true })], ctx({ collapsed: ['done'] }));
  assert.equal(groups.find((g) => g.key === 'done').collapsed, true);
  assert.equal(groups.find((g) => g.key === 'todo').collapsed, false);
  assert.deepEqual(ids(groups.find((g) => g.key === 'done')), ['b']);
});

test('у проекта без статусов — одна общая группа', () => {
  const groups = projectListGroups([task('a', { projectId: 'p3', statusId: null })], ctx({ projectId: 'p3' }));
  assert.deepEqual(keys(groups), ['all']);
});

// --- вкладка «Версии» --------------------------------------------------------

const VERSIONS = [
  { id: 'v10', projectId: 'p1', name: '1.0', releasedAt: '2026-05-01T00:00:00.000Z', order: 0 },
  { id: 'v11', projectId: 'p1', name: '1.1', releasedAt: null, order: 1 },
  { id: 'vx', projectId: 'p2', name: 'чужая', releasedAt: null, order: 0 },
];
const vctx = { rates: 1000, activeTimer: null, now: NOW };

test('версии: сначала в работе, потом выпущенные — как дорожки доски', () => {
  const rows = versionRows([], VERSIONS, 'p1', vctx);
  assert.deepEqual(rows.map((r) => r.id), ['v11', 'v10']);
  assert.equal(rows[1].released, true);
  assert.equal(rows[1].releasedAt, '2026-05-01T00:00:00.000Z');
});

test('у версии: задачи, готовые, время и деньги', () => {
  const tasks = [
    task('a', { versionId: 'v11', totalMs: HOUR, sessions: [{ ms: HOUR }] }),
    task('b', { versionId: 'v11', done: true, totalMs: 2 * HOUR, sessions: [{ ms: 2 * HOUR }], rate: 3000 }),
    task('c', { versionId: 'v10' }),
  ];
  const v11 = versionRows(tasks, VERSIONS, 'p1', vctx).find((r) => r.id === 'v11');
  assert.equal(v11.total, 2);
  assert.equal(v11.done, 1);
  assert.equal(v11.ms, 3 * HOUR);
  assert.equal(v11.money, 1000 + 2 * 3000, 'своя ставка задачи сильнее общей');
});

test('задачи без версии — строкой в конце, и только если они есть', () => {
  const none = versionRows([task('a')], VERSIONS, 'p1', vctx);
  assert.deepEqual(none.map((r) => r.id), ['v11', 'v10', null]);
  assert.equal(none[2].total, 1);
  const all = versionRows([task('a', { versionId: 'v11' })], VERSIONS, 'p1', vctx);
  assert.equal(all.some((r) => r.id === null), false);
});

test('чужие задачи и версии в строки не попадают', () => {
  const rows = versionRows([task('a', { projectId: 'p2', versionId: 'vx' })], VERSIONS, 'p1', vctx);
  assert.deepEqual(rows.map((r) => r.id), ['v11', 'v10']);
  assert.equal(rows.every((r) => r.total === 0), true);
});

// Версии. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../src/renderer/core/versions.js');

const versions = [
  { id: 'v3', projectId: 'p1', name: 'v1.3', releasedAt: null, order: 2 },
  { id: 'v1', projectId: 'p1', name: 'v1.1', releasedAt: '2026-08-28', order: 0 },
  { id: 'v2', projectId: 'p1', name: 'v1.2', releasedAt: '2026-09-12', order: 1 },
  { id: 'v4', projectId: 'p1', name: 'v1.4', releasedAt: null, order: 3 },
  { id: 'x1', projectId: 'p2', name: 'v1.1', releasedAt: null, order: 0 },
];

const tasks = [
  { id: 't1', projectId: 'p1', versionId: 'v3' },
  { id: 't2', projectId: 'p1', versionId: 'v3' },
  { id: 't3', projectId: 'p1', versionId: 'v1' },
  { id: 't4', projectId: 'p1', versionId: null },
  { id: 't5', projectId: 'p1', versionId: 'призрак' },
];

test('версии проекта идут в своём порядке, чужие не попадают', () => {
  assert.deepEqual(V.versionsOf(versions, 'p1').map((v) => v.id), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(V.versionsOf(versions, 'p2').map((v) => v.id), ['x1']);
  assert.deepEqual(V.versionsOf(versions, 'нет такого'), []);
});

test('versionsOf не переставляет исходный массив', () => {
  // Иначе порядок в state менялся бы от одного лишь показа доски.
  const before = versions.map((v) => v.id);
  V.versionsOf(versions, 'p1');
  assert.deepEqual(versions.map((v) => v.id), before);
});

test('дорожки: сначала работа, потом выпущенное — свежее выше', () => {
  // Выпущенная версия закрыта: держать её сверху значит каждый раз
  // пролистывать мимо неё к живой работе.
  assert.deepEqual(V.laneVersions(versions, 'p1').map((v) => v.name), ['v1.3', 'v1.4', 'v1.2', 'v1.1']);
});

test('задачи разложены по дорожкам, «без версии» — последней', () => {
  const lanes = V.boardLanes(versions, tasks, 'p1');
  assert.deepEqual(lanes.map((l) => (l.version ? l.version.name : null)), ['v1.3', 'v1.4', 'v1.2', 'v1.1', null]);
  assert.deepEqual(lanes[0].tasks.map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(lanes[1].tasks, []);
});

test('задача со ссылкой на удалённую версию не пропадает с доски', () => {
  // Она уезжает в «без версии» вместе с теми, у кого версии нет вовсе.
  const lanes = V.boardLanes(versions, tasks, 'p1');
  const loose = lanes[lanes.length - 1];
  assert.equal(loose.version, null);
  assert.deepEqual(loose.tasks.map((t) => t.id), ['t4', 't5']);
});

test('пустая дорожка «без версии» не показывается', () => {
  const clean = tasks.filter((t) => t.versionId === 'v3');
  const lanes = V.boardLanes(versions, clean, 'p1');
  assert.ok(lanes.every((l) => l.version), 'лишней полосы «Без версии» быть не должно');
});

test('у проекта без версий дорожек нет вовсе', () => {
  assert.deepEqual(V.boardLanes(versions, [], 'p3'), []);
});

test('подсчёт задач в версии', () => {
  assert.equal(V.versionUsage(tasks, 'v3'), 2);
  assert.equal(V.versionUsage(tasks, 'v4'), 0);
});

test('одинаковые названия версий ловятся только внутри проекта', () => {
  assert.equal(V.versionNameTaken(versions, 'p1', 'v1.2'), true);
  assert.equal(V.versionNameTaken(versions, 'p1', '  V1.2 '), true, 'регистр и пробелы значения не имеют');
  assert.equal(V.versionNameTaken(versions, 'p1', 'v1.2', 'v2'), false, 'сама себя версия не занимает');
  // В разных проектах одинаковые названия — норма: они не пересекаются.
  assert.equal(V.versionNameTaken(versions, 'p2', 'v1.2'), false);
  assert.equal(V.versionNameTaken(versions, 'p1', '   '), false, 'пустое имя не считается занятым');
});

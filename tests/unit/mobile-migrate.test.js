// Миграция данных на телефоне. Запуск: npm run test:unit
//
// Прежняя сборка мобильного не заводила статусы вовсе: проекты, созданные на
// телефоне, чинил десктоп при первой загрузке. Под 0.3.0 телефон обязан
// чинить их сам — иначе доске не из чего строиться, а у задачи нет столбца.
//
// Своего тест-раннера у mobile/ нет, а файлы — ES-модули. Читаем их текстом и
// выполняем в песочнице, подставляя импорты: тащить сборщик ради двух файлов
// дороже, чем эта обвязка.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MOBILE = path.join(__dirname, '..', '..', 'mobile', 'src');

function sandbox(file, names, values, exports) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', ...names, `${src};module.exports = { ${exports} };`)(box, ...values);
  return box.exports;
}

// Словарю телефона теперь нужна машинка перевода из ядра: импорт песочница
// вырезает, значит подставляем настоящую.
const Lang = require('../../src/renderer/core/lang.js');
const i18n = sandbox(path.join(MOBILE, 'lib', 'i18n.js'), ['Lang'], [Lang], 'T, t');
// Миграция телефона — тонкий слой над ядром: правила в core/migrate.js,
// справочники в core/catalog.js. Подставляем настоящие модули, а не
// заглушки: тест должен проверять то, что поедет в приложение.
const Catalog = require('../../src/renderer/core/catalog.js');
const CoreMigrate = require('../../src/renderer/core/migrate.js');
const M = sandbox(
  path.join(MOBILE, 'lib', 'migrate.js'),
  ['T', 't', 'Catalog', 'Core'],
  [i18n.T, i18n.t, Catalog, CoreMigrate],
  'emptyState, migrate, uid',
);

/** Данные в том виде, в каком их оставляла прежняя сборка телефона: проект
 *  без статусов, задача без statusId и без полей 0.3.0. */
function oldPhoneData() {
  const state = M.emptyState();
  const now = new Date().toISOString();
  state.projects.push({ id: 'p1', name: 'Проект', color: '#87ff65', createdAt: now });
  state.tasks.push({ id: 't1', projectId: 'p1', title: 'Задача', done: false, totalMs: 0, sessions: [] });
  state.tasks.push({ id: 't2', projectId: 'p1', title: 'Сделано', done: true, totalMs: 0, sessions: [] });
  return state;
}

test('проект без статусов получает набор по умолчанию', () => {
  const state = M.migrate(oldPhoneData());
  const own = state.statuses.filter((s) => s.projectId === 'p1');
  assert.equal(own.length, 6);
  assert.deepEqual(own.map((s) => s.kind), ['backlog', 'todo', 'progress', 'progress', 'done', 'cancelled']);
  assert.deepEqual(own.map((s) => s.order), [0, 1, 2, 3, 4, 5]);
});

test('задача без статуса получает его по своему состоянию', () => {
  const state = M.migrate(oldPhoneData());
  const kindOf = (id) => state.statuses.find((s) => s.id === id).kind;
  assert.equal(kindOf(state.tasks.find((t) => t.id === 't1').statusId), 'todo');
  assert.equal(kindOf(state.tasks.find((t) => t.id === 't2').statusId), 'done');
});

test('поля 0.3.0 появляются пустыми, а не отсутствующими', () => {
  const state = M.migrate(oldPhoneData());
  for (const task of state.tasks) {
    assert.equal(task.versionId, null);
    assert.equal(task.repeat, null);
    assert.equal(task.cancelled, false);
  }
});

test('то, что пришло с десктопа, не переписывается', () => {
  // Телефон не должен «чинить» чужие статусы и версии: они правильные.
  const state = M.emptyState();
  const now = new Date().toISOString();
  state.projects.push({ id: 'p1', name: 'Проект', color: '#87ff65', createdAt: now });
  state.statuses.push({ id: 's1', projectId: 'p1', name: 'Свой', kind: 'todo', color: '#fff', order: 0 });
  state.versions.push({ id: 'v1', projectId: 'p1', name: '1.0', order: 0, releasedAt: null });
  state.tasks.push({
    id: 't1', projectId: 'p1', title: 'Задача', done: false, totalMs: 0, sessions: [],
    statusId: 's1', versionId: 'v1', repeat: { freq: 'week', every: 1 },
  });
  M.migrate(state);
  assert.equal(state.statuses.filter((s) => s.projectId === 'p1').length, 1, 'набор не подменён');
  assert.equal(state.tasks[0].statusId, 's1');
  assert.equal(state.tasks[0].versionId, 'v1');
  assert.deepEqual(state.tasks[0].repeat, { freq: 'week', every: 1 }, 'правило не тронуто');
});

test('ссылки на исчезнувшие статусы и версии чинятся, а не остаются висеть', () => {
  const state = M.migrate(oldPhoneData());
  state.tasks[0].statusId = 'нет-такого';
  state.tasks[0].versionId = 'и-такого-нет';
  M.migrate(state);
  const st = state.statuses.find((s) => s.id === state.tasks[0].statusId);
  assert.ok(st, 'статус подставлен');
  assert.equal(st.projectId, 'p1', 'и именно из своего проекта');
  assert.equal(state.tasks[0].versionId, null);
});

test('статусы и версии удалённого проекта не остаются висеть', () => {
  const state = M.migrate(oldPhoneData());
  state.versions.push({ id: 'v1', projectId: 'p1', name: '1.0', order: 0, releasedAt: null });
  state.projects.length = 0;
  state.tasks.length = 0;
  M.migrate(state);
  // Проект-спасатель миграция не заводит, когда нет и задач.
  assert.deepEqual(state.statuses, []);
  assert.deepEqual(state.versions, []);
});

test('повторный прогон ничего не меняет', () => {
  // То же главное свойство, что и у десктопной миграции: она чинит данные, а
  // не переписывает их каждый раз заново.
  const state = M.migrate(oldPhoneData());
  const before = JSON.stringify(state);
  M.migrate(state);
  assert.equal(JSON.stringify(state), before);
});

// --- телефон и ядро ---------------------------------------------------------

test('правила миграции у телефона не свои, а ядра', () => {
  // Проверка по тексту, а не по поведению: заново написанная копия вела бы
  // себя так же, и поведенческий тест её бы пропустил. Ровно так две
  // реализации однажды и разошлись — в обе стороны: телефон чинил время
  // задачи, а десктоп нет; десктоп чинил статусы, а телефон нет.
  const src = fs.readFileSync(path.join(MOBILE, 'lib', 'migrate.js'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  for (const mark of ['state.tasks.forEach', 'state.statuses.filter', 'keepTags', 'SYM2CODE[cur]']) {
    assert.ok(!src.includes(mark), `в миграции телефона снова своё правило: «${mark}»`);
  }
});

test('битое время задачи чинится, а не роняет подсчёт', () => {
  // Это правило пришло с телефона: десктоп его не знал, и задача с
  // sessions: null роняла бы первый же подсчёт — sessionsOf зовёт .filter.
  const state = M.migrate({
    projects: [{ id: 'p1', name: 'П', createdAt: '2026-06-10T12:00:00.000Z' }],
    tasks: [{ id: 't1', projectId: 'p1', sessions: null, totalMs: 'много' }],
  });
  assert.deepEqual(state.tasks[0].sessions, []);
  assert.equal(state.tasks[0].totalMs, 0);
});

// --- поля интерфейса телефона ------------------------------------------------

test('доска не смотрит на удалённый проект', () => {
  // Проект удалили на другом устройстве, а доска и быстрое добавление
  // по-прежнему на него ссылаются. Без починки экран открывается пустым и
  // молчит, почему.
  const state = M.migrate({
    projects: [{ id: 'p1', name: 'П', createdAt: '2026-06-10T12:00:00.000Z' }],
    ui: { boardProjectId: 'нет', quickAddProjectId: 'нет' },
  });
  assert.equal(state.ui.boardProjectId, 'p1');
  assert.equal(state.ui.quickAddProjectId, 'p1');
});

test('положение доски чистится от удалённых проектов и мусора', () => {
  const state = M.migrate({
    projects: [{ id: 'p1', name: 'П', createdAt: '2026-06-10T12:00:00.000Z' }],
    ui: {
      boardVersion: { p1: 'all', нет: 'v9' },
      boardCollapsed: { p1: 'сломано', нет: ['v1'] },
      homeSwipeHintShown: 'да',
    },
  });
  assert.deepEqual(state.ui.boardVersion, { p1: 'all' }, 'запись удалённого проекта выброшена');
  assert.deepEqual(state.ui.boardCollapsed, { p1: [] }, 'мусор вместо списка заменён пустым');
  assert.equal(state.ui.homeSwipeHintShown, true, 'флаг приведён к логическому');
});

test('поля интерфейса десктопа на телефон не заводятся', () => {
  // У каждой платформы свои экраны: свёрнутая боковая панель телефону
  // незачем, как и десктопу — положение мобильной доски.
  const state = M.migrate({});
  assert.equal(state.ui.navCollapsed, undefined);
  assert.equal(state.ui.notifSeenAt, undefined);
});

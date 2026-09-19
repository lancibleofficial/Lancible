// Миграция сохранённых данных — самая опасная функция в приложении: она
// трогает всё, что накопил пользователь, при каждом запуске, и её ошибку уже
// не откатить. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../../src/renderer/core/migrate.js');

const PALETTE = ['#111', '#222', '#333'];
const CURRENCIES = { RUB: '₽', USD: '$', EUR: '€' };
const SYM2CODE = { '₽': 'RUB', $: 'USD', '€': 'EUR' };

/** Свежий генератор идентификаторов на каждый прогон — иначе тесты начнут
 *  зависеть друг от друга через общий счётчик. */
function deps() {
  let n = 0;
  return {
    t: (key) => key,
    uid: () => 'u' + (++n),
    langs: ['ru', 'en', 'uk', 'kk'],
    palette: PALETTE,
    currencies: CURRENCIES,
    sym2code: SYM2CODE,
    defaultProjectNameKey: 'app.default_project_name',
  };
}

test('пустое состояние обрастает всеми полями', () => {
  const s = migrate({}, deps());
  assert.deepEqual(s.tasks, []);
  assert.deepEqual(s.projects, []);
  assert.deepEqual(s.statuses, []);
  assert.deepEqual(s.tags, []);
  assert.deepEqual(s.versions, []);
  assert.equal(s.settings.hourlyRate, 0);
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.settings.lang, 'ru');
  assert.equal(s.settings.currency, 'RUB');
  assert.equal(s.settings.syncEnabled, true);
  assert.equal(s.ui.navCollapsed, false);
});

test('мусор вместо массивов заменяется пустыми массивами, а не роняет запуск', () => {
  const s = migrate({ tasks: 'сломалось', projects: null, statuses: 42, settings: 'нет' }, deps());
  assert.deepEqual(s.tasks, []);
  assert.deepEqual(s.projects, []);
  assert.deepEqual(s.statuses, []);
  assert.equal(typeof s.settings, 'object');
});

test('валюта из символа переводится в код', () => {
  assert.equal(migrate({ settings: { currency: '₽' } }, deps()).settings.currency, 'RUB');
  assert.equal(migrate({ settings: { currency: '$' } }, deps()).settings.currency, 'USD');
  assert.equal(migrate({ settings: { currency: 'USD' } }, deps()).settings.currency, 'USD', 'код остаётся кодом');
  assert.equal(migrate({ settings: { currency: 'ВЫДУМКА' } }, deps()).settings.currency, 'RUB');
});

test('неизвестный язык откатывается на русский', () => {
  assert.equal(migrate({ settings: { lang: 'fr' } }, deps()).settings.lang, 'ru');
  assert.equal(migrate({ settings: { lang: 'kk' } }, deps()).settings.lang, 'kk');
});

test('проект без статусов получает набор по умолчанию', () => {
  const s = migrate({ projects: [{ id: 'p1', name: 'Проект' }] }, deps());
  assert.equal(s.statuses.length, 6);
  assert.ok(s.statuses.every((st) => st.projectId === 'p1'));
});

test('у каждого проекта свой набор статусов', () => {
  const s = migrate({ projects: [{ id: 'p1' }, { id: 'p2' }] }, deps());
  assert.equal(s.statuses.filter((st) => st.projectId === 'p1').length, 6);
  assert.equal(s.statuses.filter((st) => st.projectId === 'p2').length, 6);
  const ids = new Set(s.statuses.map((st) => st.id));
  assert.equal(ids.size, 12, 'идентификаторы не должны совпадать между проектами');
});

test('общие статусы старой версии разводятся по проектам вместе с задачами', () => {
  // Это главный переход в истории данных: раньше набор был один на всё
  // приложение. Если задача не переедет на копию статуса своего проекта, она
  // молча сбросится в «к выполнению» — и пользователь потеряет состояние
  // работы, ничего об этом не узнав.
  const s = migrate({
    projects: [{ id: 'p1' }, { id: 'p2' }],
    statuses: [
      { id: 'old-todo', kind: 'todo', order: 0, name: 'К выполнению', builtin: true },
      { id: 'old-done', kind: 'done', order: 1, name: 'Готово', builtin: true },
    ],
    tasks: [
      { id: 't1', projectId: 'p1', statusId: 'old-done', done: true },
      { id: 't2', projectId: 'p2', statusId: 'old-todo', done: false },
    ],
  }, deps());

  assert.ok(s.statuses.every((st) => st.projectId), 'общих статусов остаться не должно');
  assert.equal(s.statuses.length, 4, 'по две копии на каждый из двух проектов');

  const byId = new Map(s.statuses.map((st) => [st.id, st]));
  const t1 = s.tasks.find((t) => t.id === 't1');
  const t2 = s.tasks.find((t) => t.id === 't2');
  assert.equal(byId.get(t1.statusId).projectId, 'p1', 'задача перешла на статус своего проекта');
  assert.equal(byId.get(t1.statusId).kind, 'done', 'и сохранила состояние');
  assert.equal(byId.get(t2.statusId).projectId, 'p2');
  assert.equal(byId.get(t2.statusId).kind, 'todo');
});

test('задача с несуществующим статусом получает статус по умолчанию своего проекта', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    tasks: [{ id: 't1', projectId: 'p1', statusId: 'призрак', done: false }],
  }, deps());
  const st = s.statuses.find((x) => x.id === s.tasks[0].statusId);
  assert.ok(st, 'статус должен существовать');
  assert.equal(st.kind, 'todo');
  assert.equal(st.projectId, 'p1');
});

test('выполненная задача попадает в статус вида done', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    tasks: [{ id: 't1', projectId: 'p1', done: true }],
  }, deps());
  const st = s.statuses.find((x) => x.id === s.tasks[0].statusId);
  assert.equal(st.kind, 'done');
  assert.equal(s.tasks[0].cancelled, false, 'выполненная — не отменённая');
});

test('статус неизвестного вида чинится до «к выполнению»', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [{ id: 'a', projectId: 'p1', kind: 'выдумка', order: 0, name: 'Странный' }],
  }, deps());
  assert.equal(s.statuses[0].kind, 'todo');
});

test('статусы удалённого проекта не остаются висеть', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [
      { id: 'a', projectId: 'p1', kind: 'todo', order: 0 },
      { id: 'b', projectId: 'удалённый', kind: 'todo', order: 0 },
    ],
  }, deps());
  assert.ok(s.statuses.every((st) => st.projectId === 'p1'));
});

test('порядок статусов пересчитывается подряд, без дыр', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [
      { id: 'a', projectId: 'p1', kind: 'todo', order: 10 },
      { id: 'b', projectId: 'p1', kind: 'progress', order: 30 },
      { id: 'c', projectId: 'p1', kind: 'done', order: 20 },
    ],
  }, deps());
  const ordered = s.statuses.slice().sort((x, y) => x.order - y.order);
  assert.deepEqual(ordered.map((st) => st.id), ['a', 'c', 'b']);
  assert.deepEqual(ordered.map((st) => st.order), [0, 1, 2]);
});

test('ссылки на удалённые теги вычищаются', () => {
  const s = migrate({
    projects: [{ id: 'p1', tagIds: ['tag1', 'удалённый'] }],
    tasks: [{ id: 't1', projectId: 'p1', tagIds: ['удалённый'] }],
    tags: [{ id: 'tag1', name: 'Срочное' }],
  }, deps());
  assert.deepEqual(s.projects[0].tagIds, ['tag1']);
  assert.deepEqual(s.tasks[0].tagIds, []);
});

test('задача без проекта привязывается к первому, а не теряется', () => {
  const s = migrate({
    projects: [{ id: 'p1' }, { id: 'p2' }],
    tasks: [{ id: 't1', projectId: 'исчез' }, { id: 't2' }],
  }, deps());
  assert.ok(s.tasks.every((t) => t.projectId === 'p1'));
});

test('задачи без единого проекта получают проект, а не пропадают', () => {
  const s = migrate({ tasks: [{ id: 't1', projectId: 'нет' }] }, deps());
  assert.equal(s.projects.length, 1);
  assert.equal(s.tasks[0].projectId, s.projects[0].id);
});

// Найдено при написании этих тестов, не чинится до отдельного решения.
// Проект-спасатель создаётся в самом конце migrate, когда набор статусов уже
// роздан всем остальным, — и остаётся без единого столбца. Задача внутри него
// получает statusId: null, то есть не попадает ни в один столбец доски.
// Случай редкий (все проекты пропали, задачи остались), но данные при этом
// уже повреждены, и молча жить с этим неправильно.
test('задача в проекте-спасателе должна иметь статус', { todo: 'известная недоработка' }, () => {
  const s = migrate({ tasks: [{ id: 't1', projectId: 'нет', done: false }] }, deps());
  assert.ok(s.statuses.length > 0, 'у проекта-спасателя нет статусов');
  assert.ok(
    s.statuses.some((st) => st.id === s.tasks[0].statusId),
    'задача осталась со статусом, которого не существует',
  );
});

test('повторная миграция ничего не меняет', () => {
  // Миграция выполняется при каждом запуске. Если второй прогон что-то
  // меняет, значит данные «плывут» сами по себе — например, статусы
  // размножаются с каждым открытием приложения.
  const start = {
    projects: [{ id: 'p1', name: 'Проект' }, { id: 'p2' }],
    tasks: [
      { id: 't1', projectId: 'p1', done: true },
      { id: 't2', projectId: 'p2', done: false },
    ],
    tags: [{ id: 'tag1', name: 'Срочное' }],
    settings: { currency: '₽', lang: 'en', hourlyRate: 1500 },
  };
  const once = migrate(JSON.parse(JSON.stringify(start)), deps());
  const twice = migrate(JSON.parse(JSON.stringify(once)), deps());
  assert.deepEqual(twice, once);
});

test('миграция не придумывает данные на пустом месте', () => {
  const s = migrate({}, deps());
  assert.equal(s.projects.length, 0, 'без задач проект создавать незачем');
  assert.equal(s.statuses.length, 0);
});

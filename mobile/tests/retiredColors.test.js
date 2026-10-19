// Снятый цвет акцента на телефоне: загрузка и приём из облака. Запуск: npm run test:mobile
//
// Правило перекраски — в ядре (core/migrate.js: renewColors) и закрыто юнитами
// десктопа. Здесь — что телефон его применяет: при загрузке (обёртка
// lib/migrate.js) и при приёме из облака. Там всю миграцию телефон не гоняет,
// а старая версия приложения на другом устройстве всё ещё шлёт старый цвет.
//
// С журналом правок (17 октября 2026) перекраска уходит в журнал своими
// правками — один раз: дальше и журнал, и зеркало для старых клиентов
// (sync_state) несут новый цвет, и по кругу ничего не ходит. Сеть подменена
// (tests/fakeSupabase.js — сервер журнала), lib/sync.js и стор — настоящие.
jest.setTimeout(30000);

jest.mock('../src/lib/supabaseClient', () => {
  const { createWorld } = require('./fakeSupabase');
  if (!global.__oplogWorld) global.__oplogWorld = createWorld();
  return { sb: global.__oplogWorld.client, __world: global.__oplogWorld };
});

const { settle, until, phone } = require('./fakeSupabase');

const OLD = '#87ff65';
const NEW = '#69d345';

/** Что лежит в облаке у пользователя, чья последняя правка — со старой версии. */
const oldBlob = () => ({
  projects: [
    { id: 'p1', name: 'Сайт', color: OLD, tagIds: ['g1'], createdAt: '2026-10-07T10:00:00.000Z' },
    { id: 'p2', name: 'Блог', color: '#5ec8f2', tagIds: [], createdAt: '2026-10-07T10:00:00.000Z' },
  ],
  tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, statusId: 's1', sessions: [], totalMs: 0, tagIds: [], reminders: [], remindOffsetMin: null, remindAt: null }],
  statuses: [
    { id: 's1', projectId: 'p1', name: 'Готово', color: OLD, kind: 'done', order: 0, builtin: true },
    { id: 's2', projectId: 'p1', name: 'Моё', color: '#f5c451', kind: 'todo', order: 1, builtin: false },
  ],
  tags: [{ id: 'g1', name: 'Срочное', color: OLD, projectId: null }],
  versions: [],
  documents: [],
});

let m;
beforeEach(async () => {
  jest.resetModules();
  global.__oplogWorld = undefined;
  m = phone();
  await m.AsyncStorage.clear();
  m.world.db.syncState.u1 = { user_id: 'u1', data: oldBlob(), updated_at: '2026-10-11T10:00:00.000Z', updated_by: 'old-phone' };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  m.sync.setSyncUser(null);
  jest.restoreAllMocks();
});

/** Все цвета проектов, статусов и тегов в сторе. */
const colorsInStore = () => {
  const s = m.app();
  return [...s.projects, ...s.statuses, ...s.tags].map((x) => x.color);
};
const mine = () => m.world.db.changes.filter((r) => r.device_id === m.device.deviceId());

test('вход с пустого телефона: старый цвет из облака ложится в стор новым, чужие — как были', async () => {
  await m.signIn('u1');
  const s = m.app();
  expect(s.projects.map((p) => p.color)).toEqual([NEW, '#5ec8f2']);
  // Свои статусы p1 (у p2 их нет — миграция заводит ему набор по умолчанию).
  expect(s.statuses.filter((st) => st.projectId === 'p1').map((st) => st.color)).toEqual([NEW, '#f5c451']);
  expect(s.tags.map((tg) => tg.color)).toEqual([NEW]);
  expect(colorsInStore()).not.toContain(OLD);
});

test('перекраска уходит в журнал один раз, зеркало для старых — уже с новыми цветами; настоящая правка её не повторяет', async () => {
  await m.signIn('u1');
  await until(() => !m.app().oplog.pending.length && (m.world.db.syncState.u1.updated_by || '').startsWith('oplog:'));
  const colors = mine().filter((r) => r.field === 'color');
  expect(colors.map((r) => `${r.entity}:${r.entity_id}=${r.value}`).sort()).toEqual([`project:p1=${NEW}`, `status:s1=${NEW}`, `tag:g1=${NEW}`]);
  expect(JSON.stringify(m.world.db.syncState.u1.data).toLowerCase()).not.toContain(OLD);

  m.app().updateProject('p2', { name: 'Блог 2' });
  await settle(600);
  await until(() => !m.app().oplog.pending.length);
  expect(mine().filter((r) => r.field === 'color')).toHaveLength(3);
  expect(mine().some((r) => r.field === 'name' && r.value === 'Блог 2')).toBe(true);
});

test('запись старой версии после входа (мост): прежний цвет красится и не возвращается', async () => {
  await m.signIn('u1');
  await until(() => (m.world.db.syncState.u1.updated_by || '').startsWith('oplog:'));
  // Другое устройство со старой версией приложения правит и шлёт старый цвет.
  const blob = oldBlob();
  blob.projects[1].name = 'Блог (с другого устройства)';
  m.world.upsertSyncState({ user_id: 'u1', data: blob, updated_at: '2026-10-12T10:00:00.000Z', updated_by: 'old-phone' });
  await until(() => m.app().projects[1].name === 'Блог (с другого устройства)');
  await settle(300);
  expect(colorsInStore()).not.toContain(OLD);
  await until(() => (m.world.db.syncState.u1.updated_by || '').startsWith('oplog:'));
  expect(JSON.stringify(m.world.db.syncState.u1.data).toLowerCase()).not.toContain(OLD);
});

test('набор без тегов и статусов (старая версия) не ломает приём и не стирает свои', async () => {
  m.world.db.syncState.u1 = { user_id: 'u1', data: { projects: oldBlob().projects, tasks: [] }, updated_at: '2026-10-11T10:00:00.000Z', updated_by: 'old-phone' };
  // На телефоне в области аккаунта уже есть свой тег.
  await m.AsyncStorage.setItem('lancible-data:u1', JSON.stringify({ state: { tags: [{ id: 'g9', name: 'Мой', color: OLD, projectId: null }], settings: { lang: 'ru' } }, version: 0 }));
  await m.signIn('u1');
  const s = m.app();
  expect(s.projects[0].color).toBe(NEW);
  expect(s.tags.map((tg) => tg.id)).toEqual(['g9']);
});

test('загрузка: обёртка телефона перекрашивает сохранённое, повторный прогон ничего не меняет', () => {
  const { migrate, emptyState, PALETTE } = require('../src/lib/migrate');
  const saved = {
    ...emptyState(),
    projects: [{ id: 'p1', name: 'Сайт', color: OLD }, { id: 'p2', name: 'Блог', color: '#5ec8f2' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'Готово', color: OLD, kind: 'done', order: 0, builtin: true }],
    tags: [{ id: 'g1', name: 'Срочное', color: OLD, projectId: null }],
  };
  const once = migrate(JSON.parse(JSON.stringify(saved)));
  expect(PALETTE[0]).toBe(NEW);
  expect(once.projects.map((p) => p.color)).toEqual([NEW, '#5ec8f2']);
  expect(once.statuses.find((st) => st.id === 's1').color).toBe(NEW);
  expect(once.tags[0].color).toBe(NEW);
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  expect(twice).toEqual(once);
});

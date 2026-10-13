// Снятый цвет акцента на телефоне: загрузка и приём из облака. Запуск: npm run test:mobile
//
// Правило перекраски — в ядре (core/migrate.js: renewColors) и закрыто юнитами
// десктопа. Здесь — что телефон его применяет: при загрузке (обёртка
// lib/migrate.js) и при приёме из облака. Там всю миграцию телефон не гоняет,
// а старая версия приложения на другом устройстве всё ещё шлёт старый цвет. И
// что приём ничего не отправляет обратно — иначе два устройства
// перебрасывались бы одним и тем же по кругу. Сеть подменена
// (supabase-клиент), сам lib/sync.js и стор — настоящие.
import { useAppStore } from '../src/store/useAppStore';
import { setSyncUser, syncOnSignIn } from '../src/lib/sync';
import { migrate, emptyState, PALETTE } from '../src/lib/migrate';

const mockCloud = { row: null, realtime: null };
const mockUpsert = jest.fn(async () => ({ error: null }));

jest.mock('../src/lib/supabaseClient', () => {
  const channel = {
    on: (_event, _filter, handler) => { mockCloud.realtime = handler; return channel; },
    subscribe: () => channel,
  };
  return {
    sb: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockCloud.row, error: null }) }) }),
        upsert: (...args) => mockUpsert(...args),
      }),
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

const OLD = '#87ff65';
const NEW = '#69d345';

/** Что лежит в облаке у пользователя, чья последняя правка — со старой версии. */
const oldBlob = () => ({
  projects: [
    { id: 'p1', name: 'Сайт', color: OLD, tagIds: ['g1'], createdAt: '2026-10-07T10:00:00.000Z' },
    { id: 'p2', name: 'Блог', color: '#5ec8f2', tagIds: [], createdAt: '2026-10-07T10:00:00.000Z' },
  ],
  tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, statusId: 's1', sessions: [], totalMs: 0, tagIds: [] }],
  statuses: [
    { id: 's1', projectId: 'p1', name: 'Готово', color: OLD, kind: 'done', order: 0, builtin: true },
    { id: 's2', projectId: 'p1', name: 'Моё', color: '#f5c451', kind: 'todo', order: 1, builtin: false },
  ],
  tags: [{ id: 'g1', name: 'Срочное', color: OLD, projectId: null }],
  versions: [],
  documents: [],
});

beforeEach(() => {
  jest.useFakeTimers();
  mockUpsert.mockClear();
  mockCloud.row = { data: oldBlob(), updated_at: '2026-10-11T10:00:00.000Z' };
  mockCloud.realtime = null;
  useAppStore.setState({
    projects: [], tasks: [], statuses: [], tags: [], versions: [], documents: [], activeTimer: null,
    settings: { ...useAppStore.getState().settings, syncEnabled: true, syncResolvedFor: null, lang: 'ru' },
  });
});

afterEach(() => {
  setSyncUser(null);
  jest.useRealTimers();
});

/** Все цвета проектов, статусов и тегов в сторе. */
const colorsInStore = () => {
  const s = useAppStore.getState();
  return [...s.projects, ...s.statuses, ...s.tags].map((x) => x.color);
};

test('вход с пустого телефона: старый цвет из облака ложится в стор новым, чужие — как были', async () => {
  setSyncUser('u1');
  await syncOnSignIn('u1');
  const s = useAppStore.getState();
  expect(s.projects.map((p) => p.color)).toEqual([NEW, '#5ec8f2']);
  expect(s.statuses.map((st) => st.color)).toEqual([NEW, '#f5c451']);
  expect(s.tags.map((tg) => tg.color)).toEqual([NEW]);
  expect(colorsInStore()).not.toContain(OLD);
});

test('приём ничего не отправляет обратно, а ближайшая настоящая правка уносит в облако уже новые цвета', async () => {
  setSyncUser('u1');
  await syncOnSignIn('u1');
  // Дебаунс стора — 400 мс; отпечаток считан по перекрашенному, push молчит.
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockUpsert).not.toHaveBeenCalled();

  useAppStore.getState().updateProject('p2', { name: 'Блог 2' });
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  const sent = mockUpsert.mock.calls[0][0].data;
  expect(JSON.stringify(sent).toLowerCase()).not.toContain(OLD);
  expect(sent.projects.map((p) => p.color)).toEqual([NEW, '#5ec8f2']);
});

test('обновление из облака в реальном времени: прежний цвет от старой версии красится и не возвращается', async () => {
  setSyncUser('u1');
  await syncOnSignIn('u1');
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockCloud.realtime).toBeInstanceOf(Function);

  // Другое устройство со старой версией приложения правит и шлёт старый цвет.
  const blob = oldBlob();
  blob.projects[1].name = 'Блог (с другого устройства)';
  mockCloud.realtime({ new: { updated_by: 'другое-устройство', data: blob } });
  await jest.advanceTimersByTimeAsync(1000);

  const s = useAppStore.getState();
  expect(s.projects[1].name).toBe('Блог (с другого устройства)');
  expect(colorsInStore()).not.toContain(OLD);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('набор без тегов и статусов (старая версия) не ломает приём и не стирает свои', async () => {
  useAppStore.setState({ tags: [{ id: 'g9', name: 'Мой', color: OLD, projectId: null }] });
  mockCloud.row = { data: { projects: oldBlob().projects, tasks: [] }, updated_at: '2026-10-11T10:00:00.000Z' };
  setSyncUser('u1');
  await syncOnSignIn('u1');
  const s = useAppStore.getState();
  expect(s.projects[0].color).toBe(NEW);
  expect(s.tags.map((tg) => tg.id)).toEqual(['g9']);
});

test('загрузка: обёртка телефона перекрашивает сохранённое, повторный прогон ничего не меняет', () => {
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

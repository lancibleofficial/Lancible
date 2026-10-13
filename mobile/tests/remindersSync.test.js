// Напоминания при приёме из облака (lib/sync.js). Запуск: npm run test:mobile
//
// Облако пишут и новые версии (со списком task.reminders), и старые — десктоп
// 0.4.3 и телефон 1.2.2, которые знают только remindOffsetMin, remindAt и
// notifiedAt и список не трогают. Телефон принимает облако без полной миграции,
// поэтому приём сам приводит напоминания к списку (core/reminders.js:
// reconcileReminders): правка старого клиента ложится в список, у задач без
// списка он выводится из старых полей. Правила — в ядре и закрыты юнитами
// (tests/unit/reminders.test.js); здесь — что телефон их применяет и что приём
// ничего не отправляет обратно. Сеть подменена (supabase-клиент), сам
// lib/sync.js и стор — настоящие.
import { useAppStore } from '../src/store/useAppStore';
import { setSyncUser, syncOnSignIn } from '../src/lib/sync';
import Reminders from '../src/core/reminders.js';

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

const iso = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const base = { projectId: 'p1', title: 'Вёрстка', done: false, statusId: 's1', sessions: [], totalMs: 0, tagIds: [], dueAt: iso(20, 18) };

/** Что лежит в облаке: проект с одним статусом и задачи как их оставили разные версии. */
const blob = (tasks) => ({
  projects: [{ id: 'p1', name: 'Сайт', color: '#5ec8f2', tagIds: [], createdAt: '2026-10-07T10:00:00.000Z' }],
  tasks,
  statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0, builtin: false }],
  tags: [], versions: [], documents: [],
});

/** Задача новой версии: список и зеркало старых полей, как их пишет стор. */
const withList = (task, list) => ({ ...task, ...Reminders.withReminders(task, list) });
const dueRem = (offsetMin, unit = 'min') => ({ id: 'r1', kind: 'before', anchor: 'due', offsetMin, unit });

beforeEach(() => {
  jest.useFakeTimers();
  mockUpsert.mockClear();
  mockCloud.row = null;
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

const pull = async (tasks) => {
  mockCloud.row = { data: blob(tasks), updated_at: '2026-10-11T10:00:00.000Z' };
  setSyncUser('u1');
  await syncOnSignIn('u1');
};
const stored = (id = 't1') => useAppStore.getState().tasks.find((x) => x.id === id);

test('правка старого клиента: смещение поменяли в remindOffsetMin, а список остался прежним — в стор ложится список со сменённым смещением, id тот же', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  // Старый клиент поменял «за час» на «за 30 минут» и список не заметил.
  await pull([{ ...fresh, remindOffsetMin: 30 }]);
  expect(stored().reminders).toEqual([expect.objectContaining({ id: 'r1', kind: 'before', anchor: 'due', offsetMin: 30 })]);
  expect(stored().remindOffsetMin).toBe(30);
  expect(Reminders.remindersOf(stored()).map((r) => r.offsetMin)).toEqual([30]);
});

test('старый клиент снял напоминание у дедлайна — «до дедлайна» из списка уходит, остальные остаются', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour'), { id: 'r2', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' }]);
  await pull([{ ...fresh, remindOffsetMin: null }]);
  expect(stored().reminders.map((r) => r.id)).toEqual(['r2']);
  expect(stored().remindOffsetMin).toBeNull();
});

test('старый клиент поставил своё время — оно встаёт в список «один раз»', async () => {
  const fresh = withList({ ...base, id: 't1' }, [{ id: 'r2', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' }]);
  await pull([{ ...fresh, remindAt: iso(19, 9) }]);
  expect(stored().reminders.map((r) => r.kind)).toEqual(['before', 'at']);
  expect(stored().reminders[1]).toMatchObject({ kind: 'at', at: iso(19, 9) });
  expect(stored().remindAt).toBe(iso(19, 9));
});

test('задача без списка (всё облако от старого клиента): список выводится из старых полей, id — legacy-…', async () => {
  await pull([
    { ...base, id: 't1', remindOffsetMin: 60 },
    { ...base, id: 't2', dueAt: null, remindAt: iso(19, 9) },
    { ...base, id: 't3' },
  ]);
  expect(stored('t1').reminders).toEqual([expect.objectContaining({ id: 'legacy-due', anchor: 'due', offsetMin: 60 })]);
  expect(stored('t2').reminders).toEqual([expect.objectContaining({ id: 'legacy-at', kind: 'at', at: iso(19, 9) })]);
  expect(stored('t3').reminders).toEqual([]);
});

test('смещения у отрезков из данных разработки уходят в список «до начала» и с отрезков снимаются', async () => {
  await pull([{ ...base, id: 't1', slots: [{ id: 's1', start: iso(20, 10), end: iso(20, 12), repeat: null, remindOffsetMin: 15, notifiedUpTo: null }] }]);
  expect(stored().reminders).toEqual([expect.objectContaining({ kind: 'before', anchor: 'start', offsetMin: 15 })]);
  expect('remindOffsetMin' in stored().slots[0]).toBe(false);
});

test('уже согласованная задача принимается как есть — ничего не меняется', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  await pull([fresh]);
  expect(stored()).toEqual(fresh);
});

test('приём ничего не отправляет обратно, а ближайшая настоящая правка уносит в облако уже приведённый список', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  await pull([{ ...fresh, remindOffsetMin: 30 }]);
  // Дебаунс стора — 400 мс; отпечаток считан по приведённому, push молчит.
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockUpsert).not.toHaveBeenCalled();

  useAppStore.getState().updateTask('t1', { title: 'Вёрстка 2' });
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  const sent = mockUpsert.mock.calls[0][0].data.tasks[0];
  expect(sent.reminders[0]).toMatchObject({ id: 'r1', offsetMin: 30 });
  expect(sent.remindOffsetMin).toBe(30);
});

test('обновление из облака в реальном времени: правка старого клиента тоже приводится к списку', async () => {
  await pull([withList({ ...base, id: 't1' }, [dueRem(60, 'hour')])]);
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockCloud.realtime).toBeInstanceOf(Function);

  // Другое устройство со старой версией правит смещение и шлёт его в старом поле.
  const old = { ...withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]), remindOffsetMin: 15 };
  mockCloud.realtime({ new: { updated_by: 'другое-устройство', data: blob([old]) } });
  await jest.advanceTimersByTimeAsync(1000);

  expect(stored().reminders[0]).toMatchObject({ id: 'r1', offsetMin: 15 });
  expect(stored().remindOffsetMin).toBe(15);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('отметка «уже напомнили» из облака доезжает до стора: сработавшее напоминание повторно не ставится', async () => {
  // Новая версия отметила дедлайн, о котором напомнила, а старая ничего не меняла.
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  const fired = { ...fresh, reminders: fresh.reminders.map((r) => ({ ...r, notifiedUpTo: iso(20, 18) })) };
  await pull([fired]);
  expect(stored().reminders[0].notifiedUpTo).toBe(iso(20, 18));
  expect(Reminders.pendingReminders([stored()], new Date(2026, 9, 14, 12).getTime())).toEqual([]);
});

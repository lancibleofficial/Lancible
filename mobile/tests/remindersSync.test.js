// Напоминания при приёме из облака (lib/sync.js). Запуск: npm run test:mobile
//
// Облако пишут и новые версии (со списком task.reminders), и старые — десктоп
// 0.4.3 и телефон 1.2.2, которые знают только remindOffsetMin, remindAt и
// notifiedAt и список не трогают. Телефон принимает облако без полной миграции,
// поэтому приём сам приводит напоминания к списку (core/reminders.js:
// reconcileReminders): правка старого клиента ложится в список, у задач без
// списка он выводится из старых полей. Правила — в ядре и закрыты юнитами
// (tests/unit/reminders.test.js); здесь — что телефон их применяет.
//
// С журналом правок (17 октября 2026) облако старых клиентов — это sync_state:
// при первом входе он становится слепком журнала, а запись старого клиента
// потом приходит через мост (legacyBridgeOps). Приведение телефон отправляет
// своими правками — один раз: в журнале и в зеркале для старых клиентов
// дальше лежит уже приведённый список, и повторный приём ничего не шлёт.
// Сеть подменена (tests/fakeSupabase.js — сервер журнала), lib/sync.js, стор
// и ядро — настоящие.
jest.setTimeout(30000);

jest.mock('../src/lib/supabaseClient', () => {
  const { createWorld } = require('./fakeSupabase');
  if (!global.__oplogWorld) global.__oplogWorld = createWorld();
  return { sb: global.__oplogWorld.client, __world: global.__oplogWorld };
});

const { settle, until, phone } = require('./fakeSupabase');
const Reminders = require('../src/core/reminders.js');

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

let m;
beforeEach(async () => {
  jest.resetModules();
  global.__oplogWorld = undefined;
  m = phone();
  await m.AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  m.sync.setSyncUser(null);
  jest.restoreAllMocks();
});

/** Облако старого клиента — и первый вход телефона. */
const pull = async (tasks) => {
  m.world.db.syncState.u1 = { user_id: 'u1', data: blob(tasks), updated_at: '2026-10-11T10:00:00.000Z', updated_by: 'old-desktop' };
  await m.signIn('u1');
};
const stored = (id = 't1') => m.app().tasks.find((x) => x.id === id);
const mine = () => m.world.db.changes.filter((r) => r.device_id === m.device.deviceId());

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

test('уже согласованная задача: список напоминаний принимается как есть, своего приведения напоминаний не уходит', async () => {
  // Приём гоняет миграцию, как у веба: недостающие поля задачи (rate,
  // repeat…) она дописывает своими правками, а напоминаниям приводить нечего.
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  await pull([fresh]);
  expect(stored()).toMatchObject(fresh);
  await settle(600);
  expect(mine().filter((r) => ['reminders', 'remindOffsetMin', 'remindAt'].includes(r.field))).toEqual([]);
});

test('приведение уходит в журнал своими правками один раз; зеркало для старых — уже с приведённым; настоящая правка его не повторяет', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  await pull([{ ...fresh, remindOffsetMin: 30 }]);
  await until(() => !m.app().oplog.pending.length && (m.world.db.syncState.u1.updated_by || '').startsWith('oplog:'));
  const reminders = mine().filter((r) => r.field === 'reminders');
  expect(reminders).toHaveLength(1);
  expect(reminders[0].value[0]).toMatchObject({ id: 'r1', offsetMin: 30 });
  const sent = m.world.db.syncState.u1.data.tasks[0];
  expect(sent.reminders[0]).toMatchObject({ id: 'r1', offsetMin: 30 });
  expect(sent.remindOffsetMin).toBe(30);

  m.app().updateTask('t1', { title: 'Вёрстка 2' });
  await settle(600);
  await until(() => !m.app().oplog.pending.length);
  expect(mine().filter((r) => r.field === 'reminders')).toHaveLength(1);
  expect(mine().some((r) => r.field === 'title' && r.value === 'Вёрстка 2')).toBe(true);
});

test('запись старого клиента после входа (мост): правка смещения тоже приводится к списку', async () => {
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  await pull([fresh]);
  // Другое устройство со старой версией правит смещение и шлёт его в старом поле.
  const old = { ...fresh, remindOffsetMin: 15 };
  m.world.upsertSyncState({ user_id: 'u1', data: blob([old]), updated_at: '2026-10-12T10:00:00.000Z', updated_by: 'old-desktop' });
  await until(() => stored().remindOffsetMin === 15);
  await until(() => stored().reminders[0].offsetMin === 15);
  expect(stored().reminders[0]).toMatchObject({ id: 'r1', offsetMin: 15 });
});

test('отметка «уже напомнили» из облака доезжает до стора: сработавшее напоминание повторно не ставится', async () => {
  // Новая версия отметила дедлайн, о котором напомнила, а старая ничего не меняла.
  const fresh = withList({ ...base, id: 't1' }, [dueRem(60, 'hour')]);
  const fired = { ...fresh, reminders: fresh.reminders.map((r) => ({ ...r, notifiedUpTo: iso(20, 18) })) };
  await pull([fired]);
  expect(stored().reminders[0].notifiedUpTo).toBe(iso(20, 18));
  expect(Reminders.pendingReminders([stored()], new Date(2026, 9, 14, 12).getTime())).toEqual([]);
});

// Синхронизация телефона журналом правок (17 октября 2026). Запуск: npm run test:mobile
//
// Правила слияния — в ядре (core/oplog.js) и закрыты юнитами веба
// (tests/unit/oplog.test.js). Здесь — что телефон их применяет: правки стора
// уходят в журнал строками ядра (opToRow), подтверждение снимает их с
// очереди, очередь лежит в записи области и переживает перезапуск; чужие
// правки сливаются по полям, параллельная правка того же поля — конфликт,
// который показывает лист «Другая версия» и закрывает «Оставить эту»;
// удаление против правки — задача остаётся, последовательное — корзина и
// возврат; первый вход без журнала — sync_state как слепок; гостевое
// вливается без потерь; старый клиент — через мост, и зеркало пишется для
// него с updated_by 'oplog:'; напоминания пересобираются после приёма.
//
// Сеть подменена (tests/fakeSupabase.js — сервер с теми же правилами, что
// supabase/sync2.sql, и «второе устройство» на том же ядре). Стор,
// lib/sync.js, ядро и хранилище — настоящие. Каждый тест — свежие модули и
// пустое хранилище; «перезапуск» — снова свежие модули поверх того же
// хранилища и того же сервера.
jest.setTimeout(30000);

jest.mock('../src/lib/supabaseClient', () => {
  const { createWorld } = require('./fakeSupabase');
  if (!global.__oplogWorld) global.__oplogWorld = createWorld();
  return { sb: global.__oplogWorld.client, __world: global.__oplogWorld };
});
// Страница задачи тянет живой редактор — WebView с нативной частью.
// Подмена запоминает пропсы: тест редактора видит, с каким текстом он открыт,
// и сам «печатает» в него (onChange), как страница WebView.
jest.mock('../src/components/DocEditor', () => (props) => { global.__docEditor = props; return null; });

const T0 = '2026-10-17T08:00:00.000Z';
const iso = (ms) => new Date(ms).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
const task = (id, title, extra = {}) => ({
  id, projectId: 'p1', title, done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
  createdAt: T0, updatedAt: T0, dueAt: null, reminders: [], remindOffsetMin: null, remindAt: null, notifiedAt: null,
  tagIds: [], statusId: 's1', versionId: null, repeat: null, cancelled: false, ...extra,
});
const blob = () => ({
  projects: [{ id: 'p1', name: 'Сайт', color: '#5ec8f2', description: '', tagIds: [], pinnedAt: null, createdAt: T0 }],
  tasks: [task('t1', 'Вёрстка'), task('t2', 'Позвонить')],
  statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0, builtin: false }],
  tags: [], versions: [], documents: [],
});
const notes = (text) => ({ ops: [{ insert: `${text}\n` }], lancible: { v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] } });

/** Дать отработать обещаниям и таймерам (настоящие часы). */
const settle = async (ms = 150) => {
  const end = Date.now() + ms;
  while (Date.now() < end) await new Promise((r) => setImmediate(r));
};
/** Дождаться условия (не дольше ms). */
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await settle(10);
  }
  if (!cond()) throw new Error('не дождались');
}
const COMMIT = 600; // дебаунс сохранения в журнал — 400 мс

let m;
function load() {
  m = {
    AsyncStorage: require('@react-native-async-storage/async-storage'),
    ...require('../src/store/useAppStore'),
    sync: require('../src/lib/sync'),
    device: require('../src/lib/device'),
    world: require('../src/lib/supabaseClient').__world,
    t: require('../src/lib/i18n').t,
  };
  return m;
}
const app = () => m.useAppStore.getState();
const T = (id) => app().tasks.find((x) => x.id === id);
const db = () => m.world.db;
const rows = (pred = () => true) => db().changes.filter(pred);
const dev = () => m.device.deviceId();

/** Открыть область аккаунта и войти: первый вход — журнал или sync_state. */
async function signIn(uid = 'u1') {
  db().uid = uid;
  await m.openDataScope(uid);
  await settle(50);
  m.sync.setSyncUser(uid);
  await m.sync.syncOnSignIn(uid);
  await settle();
}

/** Перезапуск приложения: свежие модули, то же хранилище и тот же сервер.
 *  Подписки прежнего «процесса» умирают вместе с ним. */
async function restart() {
  const saved = {};
  for (const k of await m.AsyncStorage.getAllKeys()) saved[k] = await m.AsyncStorage.getItem(k);
  m.sync.setSyncUser(null);
  db().channels = [];
  jest.resetModules();
  load();
  for (const [k, v] of Object.entries(saved)) await m.AsyncStorage.setItem(k, v);
}

beforeEach(async () => {
  jest.resetModules();
  global.__oplogWorld = undefined;
  load();
  await m.AsyncStorage.clear();
  db().syncState.u1 = { user_id: 'u1', data: blob(), updated_at: '2026-10-17T07:00:00.000Z', updated_by: 'old-phone-1' };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (m && m.sync) m.sync.setSyncUser(null);
  jest.restoreAllMocks();
});

describe('свои правки', () => {
  test('правка стора уходит в журнал строками ядра; подтверждение снимает её с очереди', async () => {
    await signIn();
    const before = rows().length;
    app().updateTask('t1', { title: 'Вёрстка сайта' });
    await settle(COMMIT);
    await until(() => !app().oplog.pending.length && rows().length > before);
    const title = rows((r) => r.field === 'title');
    expect(title).toHaveLength(1);
    expect(title[0]).toMatchObject({ user_id: 'u1', entity: 'task', entity_id: 't1', value: 'Вёрстка сайта', device_id: dev() });
    expect(title[0].op_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(title[0].base_seq).toBe(0);
    // id установки — свой у телефона и лежит в lancible-device.
    expect(await m.AsyncStorage.getItem('lancible-device')).toBe(dev());
    expect(app().oplog.pending).toEqual([]);
    // Своя правка, вернувшаяся с сервера, не стала «чужой»: тоста нет, lastSeq — дошёл.
    await until(() => app().oplog.lastSeq === db().seq);
  });

  test('без сети правки копятся в очереди области и переживают перезапуск; появилась сеть — ушли', async () => {
    await signIn();
    db().offline = true;
    app().updateTask('t1', { title: 'Офлайн 1' });
    await settle(COMMIT);
    app().updateTask('t1', { title: 'Офлайн 2' });
    app().updateTask('t2', { notes: notes('заметка без сети') });
    await settle(COMMIT);
    const pending = app().oplog.pending;
    // Промежуточное название того же поля, не ушедшее в сеть, схлопнуто.
    expect(pending.filter((op) => op.field === 'title').map((op) => op.value)).toEqual(['Офлайн 2']);
    expect(pending.some((op) => op.entityId === 't2' && op.field === 'notes')).toBe(true);
    // Очередь — в той же записи области, что и данные.
    const stored = JSON.parse(await m.AsyncStorage.getItem('lancible-data:u1'));
    expect(stored.state.sync2).toMatchObject({ v: 1, uid: 'u1', linked: true });
    expect(stored.state.sync2.pending.map((op) => op.id)).toEqual(pending.map((op) => op.id));

    await restart();
    db().offline = true;
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(50);
    expect(app().oplog.pending.map((op) => op.id)).toEqual(expect.arrayContaining(pending.map((op) => op.id)));
    expect(T('t1').title).toBe('Офлайн 2');

    db().offline = false;
    m.sync.setSyncUser('u1');
    await m.sync.syncOnSignIn('u1');
    await until(() => !app().oplog.pending.length);
    expect(rows((r) => r.field === 'title').map((r) => r.value)).toEqual(['Офлайн 2']);
    expect(rows((r) => r.field === 'notes')).toHaveLength(1);
  });

  test('в записи области state пачки лежит, только пока правка ещё не в журнале (иначе запись была бы вдвое больше)', async () => {
    await signIn();
    await settle(COMMIT);
    const record = async () => { await settle(10); return JSON.parse(await m.AsyncStorage.getItem('lancible-data:u1')).state; };
    expect((await record()).sync2.state).toBeUndefined();
    db().offline = true;
    app().updateTask('t1', { title: 'Ещё не в журнале' });
    const dirty = await record();
    expect(dirty.tasks.find((x) => x.id === 't1').title).toBe('Ещё не в журнале');
    expect(dirty.sync2.state.tasks.find((x) => x.id === 't1').title).toBe('Вёрстка');
    await settle(COMMIT);
    const clean = await record();
    expect(clean.sync2.state).toBeUndefined();
    expect(clean.sync2.pending.some((op) => op.field === 'title' && op.value === 'Ещё не в журнале')).toBe(true);
  });

  test('приложение закрыли раньше, чем правка ушла в журнал: при открытии дифф возвращает её в очередь', async () => {
    await signIn();
    db().offline = true;
    app().updateTask('t1', { title: 'Сразу закрыли' });
    // Дебаунс не дождались: правка только в данных, state пачки записан прежним.
    await settle(20);
    expect(app().oplog.pending).toEqual([]);
    await restart();
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(80);
    expect(app().oplog.pending.some((op) => op.field === 'title' && op.value === 'Сразу закрыли')).toBe(true);
  });

  test('новые записи времени — сразу с id: стоп таймера и запись на сетке', async () => {
    await signIn();
    app().startTimer('t1');
    m.useAppStore.setState({ activeTimer: { ...app().activeTimer, startedAt: iso(Date.now() - 60000) } });
    app().stopTimer();
    app().addSessionSpan('t1', Date.now() - 3600000, Date.now() - 1800000);
    expect(T('t1').sessions).toHaveLength(2);
    expect(T('t1').sessions.every((s) => typeof s.id === 'string' && s.id.length > 0)).toBe(true);
    await settle(COMMIT);
    await until(() => !app().oplog.pending.length);
    expect(rows((r) => r.field === 'sessions+').map((r) => r.value.id).sort()).toEqual(T('t1').sessions.map((s) => s.id).sort());
  });
});

describe('чужие правки', () => {
  test('другое поле той же задачи — сливается молча, обе правки на месте', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    const due = '2026-10-20T15:00:00.000Z';
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't1').dueAt = due; });
    app().updateTask('t1', { title: 'С телефона' });
    laptop.push();
    await settle(COMMIT);
    await until(() => T('t1').dueAt === due && !app().oplog.pending.length);
    expect(T('t1').title).toBe('С телефона');
    expect(app().oplog.conflicts).toEqual([]);
    laptop.pull();
    expect(laptop.state.tasks.find((x) => x.id === 't1')).toMatchObject({ title: 'С телефона', dueAt: due });
  });

  test('то же поле параллельно — конфликт: страница задачи и лист показывают обе версии, «Оставить эту» закрывает его везде', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    db().offline = true;
    app().updateTask('t1', { title: 'Телефон' });
    await settle(COMMIT);
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't1').title = 'Ноутбук'; }, iso(Date.now() + 1000));
    laptop.push();
    db().offline = false;
    await m.sync.syncNow();
    await until(() => app().oplog.conflicts.length === 1 && !app().oplog.pending.length);
    const c = app().oplog.conflicts[0];
    expect(c).toMatchObject({ entity: 'task', entityId: 't1', field: 'title' });
    expect(c.versions.map((v) => v.value).sort()).toEqual(['Ноутбук', 'Телефон']);
    // Показана поздняя по времени — ноутбука; своя лежит рядом.
    expect(T('t1').title).toBe('Ноутбук');
    expect(app().toastMessage).toBe(m.t('ru', 'sync.conflict_toast', { name: 'Ноутбук' }));

    const { render, fireEvent, act, cleanup } = require('@testing-library/react-native/pure');
    const TaskDetailScreen = require('../src/screens/TaskDetailScreen').default;
    const BottomSheet = require('../src/components/BottomSheet').default;
    const TaskRow = require('../src/components/TaskRow').default;
    const nav = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) };
    const row = await render(<TaskRow task={T('t1')} onPress={() => {}} />);
    row.getByTestId('conflict-mark-t1');
    await cleanup();
    const q = await render(<><TaskDetailScreen navigation={nav} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
    expect(q.getByTestId('task-conflict-count').props.children).toBe(m.t('ru', 'sync.f_title'));
    await fireEvent.press(q.getByTestId('task-conflict-row'));
    // Одна сущность, один конфликт — лист сразу на нём.
    const mine = c.versions.find((v) => v.deviceId === dev());
    const theirs = c.versions.find((v) => v.deviceId === 'laptop');
    expect(q.getByTestId(`conflict-text-${mine.opId}`).props.children).toBe('Телефон');
    expect(q.getByTestId(`conflict-text-${theirs.opId}`).props.children).toBe('Ноутбук');
    expect(q.getByTestId(`conflict-who-${mine.opId}`).props.children).toMatch(new RegExp(`^${m.t('ru', 'sync.device_this')} · `));
    expect(q.getByTestId(`conflict-who-${theirs.opId}`).props.children).toMatch(new RegExp(`^${m.t('ru', 'sync.device_other')} · `));
    q.getByTestId(`conflict-shown-${theirs.opId}`);
    await fireEvent.press(q.getByTestId(`conflict-keep-${mine.opId}`));
    await act(async () => { await settle(); });
    expect(T('t1').title).toBe('Телефон');
    expect(app().oplog.conflicts).toEqual([]);
    expect(q.queryByTestId('task-conflict-row')).toBeNull();
    await until(() => !app().oplog.pending.length);
    expect(rows((r) => r.field === 'resolved' && r.device_id === dev())).toHaveLength(1);
    expect(rows((r) => r.field === 'title').pop()).toMatchObject({ value: 'Телефон', device_id: dev() });
    // Ноутбук принял выбор — у него конфликта тоже нет.
    laptop.pull();
    expect(laptop.state.tasks.find((x) => x.id === 't1').title).toBe('Телефон');
    expect(laptop.bundle.conflicts).toEqual([]);
    await cleanup();
  });

  test('заметки параллельно — обе версии текстом с прокруткой в листе «Конфликты» из «Данных»', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    db().offline = true;
    app().updateTask('t2', { notes: notes('Текст с телефона') });
    await settle(COMMIT);
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't2').notes = notes('Текст с ноутбука'); }, iso(Date.now() + 1000));
    laptop.push();
    db().offline = false;
    await m.sync.syncNow();
    await until(() => app().oplog.conflicts.length === 1);
    const { render, fireEvent, cleanup } = require('@testing-library/react-native/pure');
    const SettingsSectionScreen = require('../src/screens/SettingsSectionScreen').default;
    const BottomSheet = require('../src/components/BottomSheet').default;
    const q = await render(<><SettingsSectionScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} route={{ params: { section: 'data' } }} /><BottomSheet /></>);
    expect(q.getByTestId('settings-conflicts-count').props.children).toBe('1');
    await fireEvent.press(q.getByTestId('settings-conflicts'));
    // Список — строка на сущность: название, вид и поля; тап — её версии.
    expect(q.getByText(`${m.t('ru', 'sync.k_task')} · ${m.t('ru', 'sync.f_notes')}`)).toBeTruthy();
    await fireEvent.press(q.getByTestId('conflict-row-task-t2'));
    const c = app().oplog.conflicts[0];
    for (const v of c.versions) {
      const box = q.getByTestId(`conflict-text-${v.opId}`);
      expect(box.type).toBe('RCTScrollView');
    }
    q.getByText('Текст с телефона');
    q.getByText('Текст с ноутбука');
    await cleanup();
  });
});

describe('удаление и корзина', () => {
  test('удалили на другом устройстве, а здесь параллельно правили — задача осталась, тост', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    db().offline = true;
    app().updateTask('t2', { title: 'Позвонить в банк' });
    await settle(COMMIT);
    laptop.edit((s) => { s.tasks = s.tasks.filter((x) => x.id !== 't2'); });
    laptop.push();
    db().offline = false;
    await m.sync.syncNow();
    await until(() => !app().oplog.pending.length && app().oplog.lastSeq === db().seq);
    expect(T('t2')).toMatchObject({ title: 'Позвонить в банк' });
    expect(app().oplog.trash).toEqual([]);
    expect(app().toastMessage).toBe(m.t('ru', 'sync.restored_toast', { name: 'Позвонить в банк' }));
    laptop.pull();
    expect(laptop.state.tasks.find((x) => x.id === 't2')).toBeTruthy();
  });

  test('удалили, увидев все правки, — задача в корзине; «Восстановить» вернуло её и на другом устройстве', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    laptop.edit((s) => { s.tasks = s.tasks.filter((x) => x.id !== 't2'); });
    laptop.push();
    await until(() => !T('t2'));
    expect(app().oplog.trash.map((x) => `${x.entity}:${x.entityId}`)).toEqual(['task:t2']);

    const { render, fireEvent, act, cleanup } = require('@testing-library/react-native/pure');
    const SettingsSectionScreen = require('../src/screens/SettingsSectionScreen').default;
    const BottomSheet = require('../src/components/BottomSheet').default;
    const q = await render(<><SettingsSectionScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} route={{ params: { section: 'data' } }} /><BottomSheet /></>);
    expect(q.getByTestId('settings-trash-count').props.children).toBe('1');
    await fireEvent.press(q.getByTestId('settings-trash'));
    // Строка — что, какого вида и когда удалено; тап по «Восстановить» возвращает.
    await fireEvent.press(q.getByTestId('trash-row-t2'));
    await act(async () => { await settle(); });
    expect(T('t2')).toMatchObject({ title: 'Позвонить' });
    expect(app().oplog.trash).toEqual([]);
    expect(app().toastMessage).toBe(m.t('ru', 'sync.restored_one', { name: 'Позвонить' }));
    await until(() => !app().oplog.pending.length);
    laptop.pull();
    expect(laptop.state.tasks.find((x) => x.id === 't2')).toMatchObject({ title: 'Позвонить' });
    await cleanup();
  });

  test('удалённое на самом телефоне тоже ложится в корзину; старше 30 дней — уходит при открытии области', async () => {
    await signIn();
    app().deleteTask('t1');
    await settle(COMMIT);
    expect(app().oplog.trash.map((x) => x.entityId)).toEqual(['t1']);
    const old = app().oplog.trash.map((x) => ({ ...x, deletedAt: iso(Date.now() - 31 * 86400000) }));
    m.useAppStore.setState({ oplog: { ...app().oplog, trash: old } });
    await restart();
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(80);
    expect(app().oplog.trash).toEqual([]);
  });
});

describe('первый вход', () => {
  test('журнала нет — sync_state становится слепком seq 0 (и для следующих устройств), вопроса нет', async () => {
    await signIn();
    expect(app().tasks.map((x) => x.title).sort()).toEqual(['Вёрстка', 'Позвонить']);
    expect(app().oplog).toBeTruthy();
    expect(db().snapshots).toHaveLength(1);
    expect(db().snapshots[0]).toMatchObject({ user_id: 'u1', seq: 0 });
    expect(db().snapshots[0].data.tasks.map((x) => x.id)).toEqual(['t1', 't2']);
    // Ничего не спрашивали: лист пуст.
    expect(require('../src/store/useSheetStore').useSheetStore.getState().content).toBeNull();
    // Ноутбук, пришедший позже, читает тот же слепок.
    const laptop = m.world.peer('laptop', 'u1').pull();
    expect(laptop.state.tasks.map((x) => x.id)).toEqual(['t1', 't2']);
  });

  test('журнал есть — слепок и правки после него', async () => {
    const laptop = m.world.peer('laptop', 'u1');
    db().snapshots.push({ user_id: 'u1', seq: 0, data: blob() });
    laptop.pull();
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't1').title = 'Из журнала'; });
    laptop.push();
    // sync_state при этом — старое: журнал главнее.
    await signIn();
    expect(T('t1').title).toBe('Из журнала');
    expect(app().oplog.lastSeq).toBe(db().seq);
  });

  test('на телефоне уже были данные аккаунта (старая схема) — вливаются без потерь: своё новое уходит, расходящееся — конфликтом', async () => {
    // Копия аккаунта с телефона 1.2.3: t1 переименована здесь позже облака, t3 — только здесь.
    const local = blob();
    local.tasks[0] = task('t1', 'Своё на телефоне', { updatedAt: '2026-10-17T09:00:00.000Z' });
    local.tasks.push(task('t3', 'Только на телефоне'));
    await m.AsyncStorage.setItem('lancible-data:u1', JSON.stringify({ state: { ...local, settings: { lang: 'ru', syncEnabled: true } }, version: 0 }));
    await signIn();
    await until(() => !app().oplog.pending.length);
    expect(T('t3')).toMatchObject({ title: 'Только на телефоне' });
    expect(T('t1').title).toBe('Своё на телефоне');
    expect(T('t2').title).toBe('Позвонить');
    const c = app().oplog.conflicts.find((x) => x.id === 'task:t1:title');
    expect(c && c.versions.map((v) => v.value).sort()).toEqual(['Вёрстка', 'Своё на телефоне']);
    expect(rows((r) => r.field === '*' && r.entity_id === 't3')).toHaveLength(1);
  });

  test('гость с данными → «Перенести» → всё гостевое в аккаунте, аккаунт цел, гостевая область пуста', async () => {
    // Гость работал без входа.
    const guest = { projects: [{ id: 'pg', name: 'Личное', color: '#5ec8f2', tagIds: [], createdAt: T0 }], tasks: [task('tg', 'Купить хлеб', { projectId: 'pg', statusId: null })], statuses: [], tags: [], versions: [], documents: [] };
    await m.AsyncStorage.setItem('lancible-data', JSON.stringify({ state: { ...guest, settings: { lang: 'ru' } }, version: 0 }));
    await m.openDataScope(null);
    await settle(80);
    // Гость очередь не копит (как у веба): правки с baseSeq 0 построит из
    // состояния adoptGuestState при переносе.
    app().updateTask('tg', { title: 'Купить хлеб и молоко' });
    await settle(COMMIT);
    expect(app().oplog).toBeNull();
    expect(JSON.parse(await m.AsyncStorage.getItem('lancible-data')).state.sync2).toBeFalsy();
    // Вход в пустой на телефоне аккаунт и «Перенести» (useAuthStore.moveGuestData).
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(50);
    const { useAuthStore } = require('../src/store/useAuthStore');
    useAuthStore.setState({ current: 'u1' });
    expect(await useAuthStore.getState().moveGuestData()).toEqual({ ok: true });
    // Аккаунт ещё не связан с журналом — пока объединение, слияние сделает связь.
    expect(app().oplog).toBeNull();
    expect(app().tasks.map((x) => x.title)).toEqual(['Купить хлеб и молоко']);
    m.sync.setSyncUser('u1');
    await m.sync.syncOnSignIn('u1');
    await until(() => !!app().oplog && !app().oplog.pending.length);
    expect(app().tasks.map((x) => x.title).sort()).toEqual(['Вёрстка', 'Купить хлеб и молоко', 'Позвонить']);
    expect(rows((r) => r.field === '*' && r.entity_id === 'tg')).toHaveLength(1);
    expect(rows((r) => r.field === '*' && r.entity_id === 'pg')).toHaveLength(1);
    const guestNow = JSON.parse(await m.AsyncStorage.getItem('lancible-data'));
    expect(guestNow.state.tasks).toEqual([]);
  });
});

describe('старые клиенты', () => {
  test('зеркало для них — в sync_state с updated_by «oplog:» и mirror_seq журнала', async () => {
    await signIn();
    app().updateTask('t1', { title: 'Для старых' });
    await settle(COMMIT);
    await until(() => db().syncState.u1.updated_by === `oplog:${dev()}` && db().syncState.u1.data.tasks.some((x) => x.title === 'Для старых'));
    expect(db().syncState.u1.mirror_seq).toBe(app().oplog.lastSeq);
    expect(db().syncState.u1.data.tasks.map((x) => x.title).sort()).toEqual(['Для старых', 'Позвонить']);
    expect(Object.keys(db().syncState.u1.data).sort()).toEqual(['documents', 'projects', 'statuses', 'tags', 'tasks', 'versions']);
  });

  test('запись старого клиента в sync_state → мост даёт правки; своё, сделанное после зеркала, не затёрто', async () => {
    await signIn();
    app().updateTask('t1', { title: 'Перед зеркалом' });
    await settle(COMMIT);
    await until(() => db().syncState.u1.updated_by === `oplog:${dev()}` && !app().oplog.pending.length);
    // Старый телефон получил зеркало и стоит на нём.
    const seen = clone(db().syncState.u1.data);
    // Телефон правит заметки — уже после зеркала.
    app().updateTask('t1', { notes: notes('новое на телефоне') });
    // Старый телефон стоит на зеркале: переименовал t2 и завёл задачу.
    seen.tasks.find((x) => x.id === 't2').title = 'Старый: звонок';
    seen.tasks.unshift(task('t9', 'Со старого телефона'));
    m.world.upsertSyncState({ user_id: 'u1', data: seen, updated_at: '2026-10-17T10:00:00.000Z', updated_by: 'old-phone-1' });
    await until(() => !!T('t9') && T('t2').title === 'Старый: звонок');
    await settle(COMMIT);
    await until(() => !app().oplog.pending.length && db().syncState.u1.updated_by === `oplog:${dev()}`);
    expect(T('t1').notes).toEqual(notes('новое на телефоне'));
    expect(rows((r) => r.device_id === 'legacy').map((r) => `${r.entity_id}:${r.field}`).sort()).toEqual(['t2:title', 't9:*']);
    // Зеркало снова у новых: со своим и с правками старого.
    expect(db().syncState.u1.data.tasks.find((x) => x.id === 't1').notes).toEqual(notes('новое на телефоне'));
    expect(db().syncState.u1.data.tasks.some((x) => x.id === 't9')).toBe(true);
    expect(T('t1').title).toBe('Перед зеркалом');
    // Та же запись пришла повторно — её уже превращали в правки: ничего нового.
    m.world.upsertSyncState({ user_id: 'u1', data: seen, updated_at: '2026-10-17T10:00:00.000Z', updated_by: 'old-phone-1' });
    await settle(300);
    expect(rows((r) => r.device_id === 'legacy')).toHaveLength(2);
    expect(T('t1').notes).toEqual(notes('новое на телефоне'));
  });

  test('запись старого клиента, пропущенная, пока телефон молчал, превращается в правки при следующем запуске', async () => {
    await signIn();
    app().updateTask('t1', { title: 'Перед зеркалом' });
    await settle(COMMIT);
    await until(() => db().syncState.u1.updated_by === `oplog:${dev()}` && !app().oplog.pending.length);
    const seen = clone(db().syncState.u1.data);
    await restart();
    // Телефон выключен, старый клиент пишет.
    seen.tasks.find((x) => x.id === 't2').title = 'Пока телефон спал';
    m.world.upsertSyncState({ user_id: 'u1', data: seen, updated_at: '2026-10-17T11:00:00.000Z', updated_by: 'old-phone-1' });
    await signIn();
    await until(() => T('t2').title === 'Пока телефон спал');
    expect(T('t1').title).toBe('Перед зеркалом');
    expect(rows((r) => r.device_id === 'legacy').map((r) => `${r.entity_id}:${r.field}`)).toEqual(['t2:title']);
  });
});

describe('напоминания и аккаунт', () => {
  test('после приёма расписание уведомлений пересобирается по пришедшему', async () => {
    await signIn();
    const notifications = require('../src/lib/notifications');
    const Reminders = require('../src/core/reminders.js');
    const spy = jest.spyOn(notifications, 'rescheduleAll').mockImplementation(async () => {});
    const stop = require('../src/lib/reminderSync').startReminderSync();
    spy.mockClear();
    const laptop = m.world.peer('laptop', 'u1').pull();
    const due = new Date(Date.now() + 3 * 86400000).toISOString();
    laptop.edit((s) => {
      const x = s.tasks.find((y) => y.id === 't1');
      x.dueAt = due;
      // Новый клиент пишет список вместе с зеркалом старых полей (core/reminders.js).
      Object.assign(x, Reminders.withReminders(x, [{ id: 'r1', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }]));
    });
    laptop.push();
    await until(() => T('t1').dueAt === due);
    await until(() => spy.mock.calls.length > 0, 3000);
    const last = spy.mock.calls.pop()[0].find((x) => x.id === 't1');
    expect(last.dueAt).toBe(due);
    expect(last.reminders.map((r) => r.id)).toEqual(['r1']);
    stop();
  });

  test('ответ сети, пришедший после смены аккаунта, к новому не применяется', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't1').title = 'Чужое для u1'; });
    let release;
    db().hold = new Promise((r) => { release = r; });
    laptop.push();
    await settle(50);
    // Пока ответ в пути — открыт другой аккаунт.
    db().syncState.u2 = { user_id: 'u2', data: { ...blob(), tasks: [task('b1', 'У второго')] }, updated_at: T0, updated_by: 'old-phone-2' };
    m.sync.setSyncUser(null);
    db().hold = null;
    release();
    await m.openDataScope('u2');
    db().uid = 'u2';
    m.sync.setSyncUser('u2');
    await m.sync.syncOnSignIn('u2');
    await settle(300);
    expect(app().tasks.map((x) => x.title)).toEqual(['У второго']);
    expect(app().scopeUid).toBe('u2');
    expect(app().oplog).toBeTruthy();
    const first = JSON.parse(await m.AsyncStorage.getItem('lancible-data:u1'));
    expect(first.state.tasks.map((x) => x.id).sort()).toEqual(['t1', 't2']);
  });
});

describe('как у веба', () => {
  test('id установки — с приставкой платформы, окно конфликта называет устройство по ней', async () => {
    await signIn();
    expect(dev()).toMatch(/^(android|ios)-[0-9a-f]{8}-/);
    const { deviceLabel } = require('../src/lib/conflictText');
    const label = (id) => deviceLabel(id, dev(), 'ru');
    expect(label(dev())).toBe(m.t('ru', 'sync.device_this'));
    expect(label('web-1')).toBe(m.t('ru', 'sync.device_web'));
    expect(label('android-1')).toBe('Android');
    expect(label('ios-1')).toBe('iPhone');
    expect(label('mac-1')).toBe('macOS');
    expect(label('legacy')).toBe(m.t('ru', 'sync.device_legacy'));
    expect(label('что-то')).toBe(m.t('ru', 'sync.device_other'));
  });

  test('сбой сети — повтор сам, через 2 секунды, без возврата на экран', async () => {
    await signIn();
    db().offline = true;
    app().updateTask('t1', { title: 'Повтором' });
    await settle(COMMIT);
    expect(app().oplog.pending.some((op) => op.value === 'Повтором')).toBe(true);
    db().offline = false;
    await until(() => !app().oplog.pending.length, 6000);
    expect(rows((r) => r.field === 'title').map((r) => r.value)).toEqual(['Повтором']);
  });

  test('открытый редактор: своё несохранённое уходит в журнал раньше чужого, пришедший текст перечитывается', async () => {
    await signIn();
    const { render, act, cleanup } = require('@testing-library/react-native/pure');
    const TaskDetailScreen = require('../src/screens/TaskDetailScreen').default;
    const DocCore = require('../src/core/doc.js');
    const nav = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) };
    await render(<TaskDetailScreen navigation={nav} route={{ params: { taskId: 't1' } }} />);
    // В редакторе набрано, но в стор ещё не ушло (сохранение — через 300 мс).
    const typed = DocCore.readNotes(notes('набрано на телефоне'));
    await act(async () => { global.__docEditor.onChange(typed); });
    const laptop = m.world.peer('laptop', 'u1').pull();
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't2').title = 'С ноутбука'; });
    laptop.push();
    await act(async () => { await until(() => T('t2').title === 'С ноутбука'); });
    // Приём сначала забрал набранное из редактора — оно уже в журнале.
    await act(async () => { await until(() => rows((r) => r.field === 'notes' && r.entity_id === 't1').length === 1); });
    // Заметки поменяли на ноутбуке — редактор открыт заново с их текстом.
    laptop.pull();
    laptop.edit((s) => { s.tasks.find((x) => x.id === 't1').notes = notes('с ноутбука'); });
    laptop.push();
    await act(async () => { await until(() => DocCore.docPlainText(global.__docEditor.content.doc) === 'с ноутбука'); });
    await cleanup();
  });

  test('«Другая версия ›» у проекта — первой строкой его настроек, версии — страницей того же листа', async () => {
    await signIn();
    const laptop = m.world.peer('laptop', 'u1').pull();
    db().offline = true;
    app().updateProject('p1', { name: 'Сайт (телефон)' });
    await settle(COMMIT);
    laptop.edit((s) => { s.projects[0].name = 'Сайт (ноутбук)'; }, iso(Date.now() + 1000));
    laptop.push();
    db().offline = false;
    await m.sync.syncNow();
    await until(() => app().oplog.conflicts.some((c) => c.id === 'project:p1:name'));
    const { render, fireEvent, act, cleanup } = require('@testing-library/react-native/pure');
    const BottomSheet = require('../src/components/BottomSheet').default;
    const NewProjectSheet = require('../src/components/NewProjectSheet').default;
    const { openSheet } = require('../src/store/useSheetStore');
    const q = await render(<BottomSheet />);
    await act(async () => { openSheet(<NewProjectSheet project={app().projects[0]} />); });
    q.getByTestId('project-conflict-row');
    await fireEvent.press(q.getByTestId('project-conflict-row'));
    expect(q.getByTestId('conflict-entity').props.children).toBe(`${m.t('ru', 'sync.k_project')} · Сайт (ноутбук)`);
    q.getByText('Сайт (телефон)');
    const mine = app().oplog.conflicts[0].versions.find((v) => v.deviceId === dev());
    await fireEvent.press(q.getByTestId(`conflict-keep-${mine.opId}`));
    await act(async () => { await settle(); });
    expect(app().projects[0].name).toBe('Сайт (телефон)');
    expect(q.queryByTestId('project-conflict-row')).toBeNull();
    await cleanup();
  });

  test('запись старого клиента от незнакомого зеркала ждёт устройство, которое его писало', async () => {
    await signIn();
    app().updateTask('t1', { title: 'Перед зеркалом' });
    await settle(COMMIT);
    await until(() => db().syncState.u1.updated_by === `oplog:${dev()}` && !app().oplog.pending.length);
    const seen = clone(db().syncState.u1.data);
    seen.tasks.find((x) => x.id === 't2').title = 'От чужого зеркала';
    // mirror_seq, которого этот телефон не писал и не видел, и свежая запись.
    m.world.upsertSyncState({ user_id: 'u1', data: seen, updated_at: new Date().toISOString(), updated_by: 'old-phone-1', mirror_seq: 999 });
    await settle(500);
    expect(rows((r) => r.device_id === 'legacy')).toEqual([]);
    expect(T('t2').title).toBe('Позвонить');
  });
});

// Волна исправлений 19 октября 2026 (ревью телефона: находки 2 и 4).
describe('первая связь и повторы отправки', () => {
  const second = () => ({ user_id: 'u2', data: { ...blob(), tasks: [task('b1', 'У второго')] }, updated_at: T0, updated_by: 'old-phone-2' });
  const channel = (uid) => db().channels.some((c) => c.name === `sync2:${uid}`);

  test('медленная первая связь A не держит вход B: у B своя связь, подписка и обмен', async () => {
    db().syncState.u2 = second();
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(50);
    let release;
    db().hold = new Promise((r) => { release = r; });
    m.sync.setSyncUser('u1');
    const a = m.sync.syncOnSignIn('u1');
    await settle(50);
    // Связь A в пути — человек переключился на B, у его области журнала ещё нет.
    m.sync.setSyncUser('u2');
    db().uid = 'u2';
    await m.openDataScope('u2');
    await settle(50);
    const b = m.sync.syncOnSignIn('u2');
    await settle(50);
    db().hold = null;
    release();
    await Promise.all([a, b]);
    await until(() => !!app().oplog);
    expect(app().scopeUid).toBe('u2');
    expect(app().tasks.map((x) => x.title)).toEqual(['У второго']);
    expect(channel('u2')).toBe(true);
    expect(channel('u1')).toBe(false);
  });

  test('A → B → A, пока связь A в пути: вернувшийся A связывается заново, а не ждёт устаревшую', async () => {
    db().uid = 'u1';
    await m.openDataScope('u1');
    await settle(50);
    let release;
    db().hold = new Promise((r) => { release = r; });
    m.sync.setSyncUser('u1');
    const first = m.sync.syncOnSignIn('u1');
    await settle(50);
    m.sync.setSyncUser('u2');
    m.sync.setSyncUser('u1');
    const again = m.sync.syncOnSignIn('u1');
    await settle(50);
    db().hold = null;
    release();
    await Promise.all([first, again]);
    await until(() => !!app().oplog);
    expect(app().tasks.map((x) => x.id).sort()).toEqual(['t1', 't2']);
    expect(channel('u1')).toBe(true);
  });

  test('вставку, которую сервер отбивает (4xx), не шлют раз в 2 с: удачное чтение не обнуляет отступ', async () => {
    await signIn();
    db().refuse = { code: '23514', message: 'new row violates check constraint' };
    const tries = () => db().calls.filter((c) => c === 'upsert changes').length;
    const reads = () => db().calls.filter((c) => c === 'select changes').length;
    const before = tries();
    app().updateTask('t1', { title: 'Не примут' });
    await until(() => tries() === before + 1, 3000);
    const t0 = Date.now();
    const readsBefore = reads();
    // Первый повтор — через 2 с.
    await until(() => tries() === before + 2, 4000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    // Между попытками журнал читался — удачно; раньше это обнуляло счётчик, и
    // следующая попытка снова шла через 2 с. Теперь — через 5.
    expect(reads()).toBeGreaterThan(readsBefore);
    await settle(3500);
    expect(tries()).toBe(before + 2);
    expect(app().oplog.pending.some((op) => op.value === 'Не примут')).toBe(true);
    // Сервер снова принимает — очередной повтор отправляет.
    db().refuse = null;
    await until(() => !app().oplog.pending.length, 4000);
    expect(rows((r) => r.field === 'title').map((r) => r.value)).toEqual(['Не примут']);
  });

  test('\\u0000 в тексте (jsonb его не принимает) вычищается при отправке и не останавливает её', async () => {
    await signIn();
    // Правка, легшая в очередь до того, как ядро стало чистить \u0000: очередь
    // прошлой версии телефона.
    db().offline = true;
    app().updateTask('t1', { title: 'Офлайн' });
    await settle(COMMIT);
    const b = app().oplog;
    m.useAppStore.setState({ oplog: { ...b, pending: b.pending.map((op) => (op.field === 'title' ? { ...op, value: 'До\u0000после' } : op)) } });
    // И свежая — с ним же.
    app().updateTask('t2', { title: 'Строка\u0000с нулём' });
    await settle(COMMIT);
    db().offline = false;
    await until(() => !app().oplog.pending.length, 6000);
    expect(rows((r) => r.entity_id === 't1' && r.field === 'title').map((r) => r.value)).toEqual(['Допосле']);
    expect(rows((r) => r.entity_id === 't2' && r.field === 'title').map((r) => r.value)).toEqual(['Строкас нулём']);
    // JSON пишет нулевой символ шестью знаками \u0000.
    expect(JSON.stringify(db().changes)).not.toContain('\\u0000');
  });
});

describe('перенос «Без аккаунта» и таймер', () => {
  test('в аккаунте тоже идёт таймер — таймер гостя закрывается записью времени на своей задаче, а не пропадает', async () => {
    await signIn();
    const now = Date.now();
    const accountTimer = { taskId: 't1', startedAt: iso(now - 10 * 60000), heartbeatAt: iso(now) };
    m.useAppStore.setState({ activeTimer: accountTimer });
    const guest = {
      projects: [{ id: 'pg', name: 'Личное', color: '#5ec8f2', tagIds: [], createdAt: T0 }],
      tasks: [task('tg', 'Гостевое', { projectId: 'pg', statusId: null })],
      statuses: [], tags: [], versions: [], documents: [],
      activeTimer: { taskId: 'tg', startedAt: iso(now - 60 * 60000), heartbeatAt: iso(now) },
    };
    expect(m.sync.adoptGuestData(guest)).toBe(true);
    // Таймер аккаунта — как шёл.
    expect(app().activeTimer).toEqual(accountTimer);
    // Час гостя — записью на его задаче.
    const sessions = T('tg').sessions || [];
    expect(sessions).toHaveLength(1);
    const ms = Date.parse(sessions[0].end) - Date.parse(sessions[0].start);
    expect(ms).toBeGreaterThanOrEqual(59 * 60000);
    expect(ms).toBeLessThanOrEqual(61 * 60000);
    // И уходит в журнал вместе с задачей.
    await until(() => !app().oplog.pending.length);
    expect(JSON.stringify(rows((r) => r.entity_id === 'tg'))).toContain(sessions[0].start);
  });
});

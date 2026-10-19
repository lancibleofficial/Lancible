// Несколько аккаунтов на телефоне: области данных, список, переключение
// (17 октября 2026). Запуск: npm run test:mobile (из корня)
//
// Правила — в ядре (core/accounts.js: имена областей, слияние записей, кого
// открыть после «Выйти») и закрыты юнитами веба; здесь — что телефон их
// применяет: стор пересобирается с именем области (persist.setOptions +
// rehydrate), список и токены лежат в AsyncStorage lancible-accounts,
// гостевые данные остаются в lancible-data и никуда не переезжают,
// напоминания пересобираются по аккаунту, открытому после переключения.
//
// Сеть подменена целиком — supabase-клиент: сеансы, ротация refresh-токенов
// и отзыв при signOut, как у сервера (отзыв — проверка того, что
// переключение сеанс не снимает); таблицы — сервер журнала правок
// (tests/fakeSupabase.js, 17 октября 2026), облако аккаунта до журнала —
// его sync_state. Стор, lib/sync.js, lib/auth.js,
// lib/accounts.js и хранилище — настоящие. Каждый тест — свежие модули и
// пустое хранилище: так «холодный старт» — это действительно старт.

// Каждый тест поднимает стор, синхронизацию и вход заново (свежие модули) —
// под нагрузкой всего набора это дольше пяти секунд по умолчанию.
jest.setTimeout(30000);

const mockWorld = {
  users: {},
  stored: null, // живой сеанс supabase (то, что лежит в его хранилище)
  valid: new Set(), // живые refresh-токены
  listeners: [],
  // Таблицы — сервер журнала правок (tests/fakeSupabase.js: changes,
  // snapshots, sync_state, profiles, realtime); RLS — по живому сеансу.
  // cloud[uid] — данные sync_state (что видят старые клиенты): прочитать,
  // положить, стереть.
  server: null,
  cloud: {},
  calls: [],
  n: 0,
  // Нет сети — у отдельного клиента отзыва (isolatedClient).
  offline: false,
  reset() {
    this.users = {
      'u-ann': { email: 'ann@example.com', password: 'pw-ann', name: 'Аня' },
      'u-bob': { email: 'bob@example.com', password: 'pw-bob', name: null },
    };
    this.stored = null;
    this.valid = new Set();
    this.listeners = [];
    this.server = require('./fakeSupabase').createWorld();
    const w = this;
    Object.defineProperty(this.server.db, 'uid', { get: () => (w.stored ? w.stored.user.id : null), configurable: true });
    this.server.db.profiles = {
      'u-ann': { name: 'Аня', terms_version: '2099-01-01', age_confirmed: true },
      'u-bob': { name: null, terms_version: '2099-01-01', age_confirmed: true },
    };
    const db = this.server.db;
    this.cloud = new Proxy({}, {
      get: (_, uid) => (db.syncState[uid] ? db.syncState[uid].data : undefined),
      set: (_, uid, data) => {
        db.syncState[uid] = { user_id: uid, data, updated_at: '2026-10-17T10:00:00.000Z', updated_by: 'old-client' };
        return true;
      },
      deleteProperty: (_, uid) => {
        delete db.syncState[uid];
        db.changes = db.changes.filter((r) => r.user_id !== uid);
        db.snapshots = db.snapshots.filter((r) => r.user_id !== uid);
        return true;
      },
    });
    this.calls = [];
    this.n = 0;
    this.offline = false;
  },
  /** Правки журнала пользователя. */
  rows(uid) {
    return this.server.db.changes.filter((r) => r.user_id === uid);
  },
  issue(uid) {
    this.n += 1;
    const s = { access_token: `at-${uid}-${this.n}`, refresh_token: `rt-${uid}-${this.n}`, user: { id: uid, email: this.users[uid].email } };
    this.valid.add(s.refresh_token);
    return s;
  },
  async emit(event, session) {
    for (const cb of this.listeners.slice()) await cb(event, session);
  },
  /** Отозвать все сеансы пользователя — как /logout?scope=global. */
  revoke(uid) {
    for (const tok of [...this.valid]) if (tok.startsWith(`rt-${uid}-`)) this.valid.delete(tok);
  },
};

jest.mock('../src/lib/supabaseClient', () => {
  const w = mockWorld;
  const uidOf = (tok) => (/^rt-(.+)-\d+$/.exec(tok) || [])[1];
  const auth = {
    onAuthStateChange: (cb) => {
      w.listeners.push(cb);
      setTimeout(() => cb('INITIAL_SESSION', w.stored), 0);
      return { data: { subscription: { unsubscribe: () => { w.listeners = w.listeners.filter((x) => x !== cb); } } } };
    },
    getSession: async () => ({ data: { session: w.stored }, error: null }),
    getUser: async () => ({ data: { user: w.stored ? w.stored.user : null } }),
    signInWithPassword: async ({ email, password }) => {
      w.calls.push(`signIn ${email}`);
      const uid = Object.keys(w.users).find((id) => w.users[id].email === email && w.users[id].password === password);
      if (!uid) return { data: { session: null }, error: { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' } };
      w.stored = w.issue(uid);
      await w.emit('SIGNED_IN', w.stored);
      return { data: { session: w.stored }, error: null };
    },
    setSession: async ({ refresh_token: tok }) => {
      w.calls.push(`setSession ${tok}`);
      if (!w.valid.has(tok)) return { data: { session: null }, error: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Already Used' } };
      // Ротация: использованный refresh-токен больше не годится.
      w.valid.delete(tok);
      w.stored = w.issue(uidOf(tok));
      await w.emit('TOKEN_REFRESHED', w.stored);
      return { data: { session: w.stored }, error: null };
    },
    signOut: async (opts = {}) => {
      w.calls.push(`signOut ${opts.scope || 'global'}`);
      if (w.stored) w.revoke(w.stored.user.id);
      w.stored = null;
      await w.emit('SIGNED_OUT', null);
      return { error: null };
    },
    // Снять сеанс только в хранилище клиента — сервер о нём не узнаёт,
    // событий клиент не шлёт (supabase-js 2.116, приватный метод).
    _removeSession: async () => {
      w.calls.push('removeLocal');
      w.stored = null;
    },
  };
  // Отдельный клиент на один чужой сеанс (отзыв сеанса неоткрытого
  // аккаунта): свой сеанс в памяти, основной не трогает; signOut local
  // отзывает на «сервере» ровно этот сеанс.
  const isolatedClient = () => {
    let own = null;
    const offline = () => ({ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' });
    return {
      auth: {
        setSession: async ({ access_token: at, refresh_token: tok }) => {
          w.calls.push(`revoke:setSession ${tok}`);
          if (w.offline) return { data: { session: null }, error: offline() };
          if (!w.valid.has(tok)) return { data: { session: null }, error: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token' } };
          own = { access_token: at, refresh_token: tok };
          return { data: { session: own }, error: null };
        },
        refreshSession: async ({ refresh_token: tok }) => {
          w.calls.push(`revoke:refresh ${tok}`);
          return { data: { session: null }, error: offline() };
        },
        signOut: async (opts = {}) => {
          w.calls.push(`revoke:logout ${opts.scope || 'global'} ${own ? own.refresh_token : '-'}`);
          if (own) w.valid.delete(own.refresh_token);
          own = null;
          return { error: null };
        },
      },
    };
  };
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    isolatedClient,
    sb: {
      auth,
      from: (name) => w.server.client.from(name),
      channel: (name) => w.server.client.channel(name),
      removeChannel: (ch) => w.server.client.removeChannel(ch),
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) },
      // Серверная функция удаления: пользователя больше нет — ни облака, ни сеансов.
      functions: {
        invoke: async (name) => {
          const uid = w.stored && w.stored.user.id;
          w.calls.push(`invoke ${name} ${uid}`);
          delete w.cloud[uid];
          w.revoke(uid);
          return { data: null, error: null };
        },
      },
    },
  };
});

const project = (id, name) => ({ id, name, color: '#5ec8f2', tagIds: [], createdAt: '2026-10-07T10:00:00.000Z' });
const task = (id, title, projectId, extra = {}) => ({ id, projectId, title, statusId: null, done: false, sessions: [], totalMs: 0, tagIds: [], ...extra });
const blob = (name, title) => ({
  projects: [project(`p-${name}`, name)], tasks: [task(`t-${name}`, title, `p-${name}`)],
  statuses: [], tags: [], versions: [], documents: [],
});
const GUEST = { ...blob('Гостевой', 'Задача гостя'), settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru', syncEnabled: true, notifyEnabled: true, syncResolvedFor: null } };

/** Дать отработать обещаниям и таймерам нулевой длины (настоящие часы):
 *  ms миллисекунд крутим очередь через setImmediate — на Windows один
 *  setTimeout(0) стоит ~15 мс, и цепочка из десятка таких шла бы секундами. */
const settle = async (ms = 120) => {
  const end = Date.now() + ms;
  while (Date.now() < end) await new Promise((r) => setImmediate(r));
};

let m; // модули этого теста
function load() {
  // Прежний «процесс» (модули прошлого теста или до перезапуска) умирает:
  // его таймеры обмена не должны писать в облако следующего.
  if (m && m.sync) m.sync.setSyncUser(null);
  m = {
    sync: require('../src/lib/sync'),
    AsyncStorage: require('@react-native-async-storage/async-storage'),
    ...require('../src/store/useAuthStore'),
    ...require('../src/store/useAppStore'),
    notifications: require('../src/lib/notifications'),
    reminderSync: require('../src/lib/reminderSync'),
  };
  return m;
}
const auth = () => m.useAuthStore.getState();
/** Имя области, которую открыл стор (persist). */
const scopeName = () => m.useAppStore.persist.getOptions().name;
const app = () => m.useAppStore.getState();
const titles = () => app().tasks.map((x) => x.title);
/** Правка на телефоне — как её делает экран: новая задача в сторе. */
const addLocal = (id, title, projectId) => m.useAppStore.setState((st) => ({ tasks: [...st.tasks, task(id, title, projectId)] }));
async function stored(key) {
  const raw = await m.AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
const storedTitles = async (key) => {
  const v = await stored(key);
  return v ? v.state.tasks.map((x) => x.title) : null;
};
async function seed(key, state) {
  await m.AsyncStorage.setItem(key, JSON.stringify({ state, version: 0 }));
}
/** Открыт ли сейчас вопрос «Перенести данные?». */
function moveQuestion() {
  const content = require('../src/store/useSheetStore').useSheetStore.getState().content;
  const { t } = require('../src/lib/i18n');
  const lang = app().settings.lang;
  return content && content.props && content.props.title === t(lang, 'accounts.move_title') ? content : null;
}
/** Ответить на вопрос о переносе так, как это делает лист: он закрывается,
 *  потом зовётся действие нажатой кнопки. */
async function answerMove(choice) {
  const end = Date.now() + 3000;
  while (Date.now() < end && !moveQuestion()) await settle(10);
  const sheet = moveQuestion();
  if (!sheet) throw new Error('вопроса «Перенести данные?» нет');
  const { t } = require('../src/lib/i18n');
  const label = t(app().settings.lang, choice === 'move' ? 'accounts.move_ok' : 'accounts.move_keep');
  require('../src/store/useSheetStore').closeSheet();
  sheet.props.actions.find((a) => a.label === label).onPress();
  await settle();
}

/** Старт: ждём, пока вход разрешится и область откроется, — потом хвосты. */
async function boot() {
  auth().init();
  const end = Date.now() + 5000;
  while (Date.now() < end && (auth().status === 'loading' || auth().switching || !app().hasHydrated)) await settle(10);
  await settle();
}

beforeEach(async () => {
  jest.resetModules();
  mockWorld.reset();
  mockWorld.cloud['u-ann'] = blob('Облако Ани', 'Задача Ани');
  mockWorld.cloud['u-bob'] = blob('Облако Боба', 'Задача Боба');
  load();
  await m.AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('гость → аккаунт → гость', () => {
  test('вход открывает область аккаунта; гостевые данные остаются в lancible-data и в облако не уходят', async () => {
    await seed('lancible-data', GUEST);
    await boot();
    expect(scopeName()).toBe('lancible-data');
    expect(auth().current).toBeNull();
    expect(auth().status).toBe('signedOut');
    expect(titles()).toEqual(['Задача гостя']);
    expect(auth().guestHasData).toBe(true);

    const result = await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    expect(result.ok).toBe(true);
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(scopeName()).toBe('lancible-data:u-ann');
    // У гостя есть данные, область аккаунта пуста — вопрос о переносе; пока
    // не ответили, синхронизации нет.
    expect(moveQuestion()).toBeTruthy();
    expect(titles()).toEqual([]);
    await answerMove('keep');
    // Оставили отдельно — облако аккаунта приходит молча (pull).
    expect(titles()).toEqual(['Задача Ани']);
    expect(await storedTitles('lancible-data')).toEqual(['Задача гостя']);
    expect(await storedTitles('lancible-data:u-ann')).toEqual(['Задача Ани']);
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title)).toEqual(['Задача Ани']);
    expect(JSON.stringify(mockWorld.rows('u-ann'))).not.toContain('Задача гостя');
  });

  test('«Без аккаунта» и обратно: у каждого свои данные, сеанс не отзывается и поднимается без входа', async () => {
    await seed('lancible-data', GUEST);
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await answerMove('keep');
    // Правка в аккаунте — и сразу на гостя: правка ушла в облако и лежит в его области.
    addLocal('t-new', 'Новая у Ани', 'p-Облако Ани');
    await auth().switchAccount(null);
    await settle();
    expect(auth().current).toBeNull();
    expect(auth().status).toBe('signedOut');
    expect(scopeName()).toBe('lancible-data');
    expect(titles()).toEqual(['Задача гостя']);
    expect(await storedTitles('lancible-data:u-ann')).toEqual(expect.arrayContaining(['Задача Ани', 'Новая у Ани']));
    // Ушла в журнал аккаунта перед сменой (useAuthStore → flushSync).
    expect(mockWorld.rows('u-ann').some((r) => r.field === '*' && r.entity_id === 't-new')).toBe(true);
    // Правка гостя в облако аккаунта не уходит.
    const sent = mockWorld.server.db.changes.length;
    addLocal('t-more', 'Ещё гостя', 'p-Гостевой');
    await new Promise((r) => setTimeout(r, 500));
    expect(mockWorld.server.db.changes.length).toBe(sent);
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title)).not.toContain('Ещё гостя');
    // Сеанс снят только на телефоне: сервер его не отзывал.
    expect(mockWorld.calls.some((c) => c.startsWith('signOut'))).toBe(false);
    expect(mockWorld.calls).toContain('removeLocal');
    expect(mockWorld.stored).toBeNull();

    await auth().switchAccount('u-ann');
    await settle();
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(titles()).toEqual(expect.arrayContaining(['Задача Ани', 'Новая у Ани']));
    expect(titles()).not.toContain('Ещё гостя');
    expect(await storedTitles('lancible-data')).toEqual(['Задача гостя', 'Ещё гостя']);
  });

  test('настройки и журнал — в области: выключенная синхронизация и журнал правок у каждого свои; язык новый аккаунт берёт с телефона', async () => {
    await seed('lancible-data', { ...GUEST, settings: { ...GUEST.settings, lang: 'en', syncEnabled: false } });
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await answerMove('keep');
    expect(app().settings.lang).toBe('en');
    expect(app().settings.syncEnabled).toBe(true);
    expect(app().oplog).toBeTruthy();
    // Подпись области — в её настройках: по ней веб и десктоп назовут копию.
    expect(app().settings.account).toEqual({ email: 'ann@example.com', name: 'Аня' });
    await auth().switchAccount(null);
    await settle();
    expect(app().settings.syncEnabled).toBe(false);
    expect(app().oplog).toBeNull();
    expect(app().settings.account).toBeUndefined();
  });
});

describe('список аккаунтов и токены', () => {
  test('второй аккаунт добавляется, первый остаётся; переключение — setSession свежим токеном, без выхода', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-ann', 'u-bob']);
    expect(auth().current).toBe('u-bob');
    expect(titles()).toEqual(['Задача Боба']);
    const list = (await stored('lancible-accounts'));
    expect(list.current).toBe('u-bob');
    expect(list.list.find((e) => e.uid === 'u-ann')).toMatchObject({ email: 'ann@example.com', name: 'Аня', needsSignIn: false });
    expect(list.list.find((e) => e.uid === 'u-ann').refreshToken).toMatch(/^rt-u-ann-/);

    await auth().switchAccount('u-ann');
    await settle();
    expect(auth().status).toBe('signedIn');
    expect(auth().user).toMatchObject({ id: 'u-ann', name: 'Аня' });
    expect(titles()).toEqual(['Задача Ани']);
    // Токен Ани ротировался — в списке новый, живой.
    const ann = auth().accounts.list.find((e) => e.uid === 'u-ann');
    expect(mockWorld.valid.has(ann.refreshToken)).toBe(true);
    expect(mockWorld.stored.refresh_token).toBe(ann.refreshToken);

    // И обратно к Бобу — его токен тоже живой: переключение сеанс не отзывало.
    await auth().switchAccount('u-bob');
    await settle();
    expect(auth().status).toBe('signedIn');
    expect(titles()).toEqual(['Задача Боба']);
    expect(mockWorld.calls.some((c) => c.startsWith('signOut'))).toBe(false);
    // На тот же — ничего.
    const before = mockWorld.calls.length;
    expect(await auth().switchAccount('u-bob')).toMatchObject({ same: true });
    expect(mockWorld.calls.length).toBe(before);
  });

  test('обновление токена текущего (TOKEN_REFRESHED) переписывает его запись', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    const fresh = mockWorld.issue('u-ann');
    mockWorld.stored = fresh;
    await mockWorld.emit('TOKEN_REFRESHED', fresh);
    await settle();
    expect(auth().accounts.list[0].refreshToken).toBe(fresh.refresh_token);
    expect((await stored('lancible-accounts')).list[0].refreshToken).toBe(fresh.refresh_token);
  });

  test('отозванный токен — «нужно войти заново»: данные аккаунта открыты как есть, без синхронизации', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    mockWorld.revoke('u-ann');
    await auth().switchAccount('u-ann');
    await settle();
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedOut');
    expect(titles()).toEqual(['Задача Ани']);
    expect(auth().accounts.list.find((e) => e.uid === 'u-ann')).toMatchObject({ needsSignIn: true, refreshToken: '' });
    // Войти заново той же почтой — аккаунт снова живой, область та же.
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    expect(auth().status).toBe('signedIn');
    expect(auth().accounts.list.find((e) => e.uid === 'u-ann').needsSignIn).toBe(false);
    expect(scopeName()).toBe('lancible-data:u-ann');
  });

  test('нет сети при подъёме сеанса — запись не помечается «нужно войти заново», данные открыты', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    const { sb } = require('../src/lib/supabaseClient');
    const real = sb.auth.setSession;
    sb.auth.setSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' } });
    await auth().switchAccount('u-ann');
    await settle();
    sb.auth.setSession = real;
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedOut');
    expect(titles()).toEqual(['Задача Ани']);
    expect(auth().accounts.list.find((e) => e.uid === 'u-ann')).toMatchObject({ needsSignIn: false });
    expect(auth().accounts.list.find((e) => e.uid === 'u-ann').refreshToken).toMatch(/^rt-u-ann-/);
  });

  test('неверный пароль при добавлении — текущий аккаунт остаётся и синхронизируется дальше', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    const result = await auth().signIn('bob@example.com', 'не тот');
    await settle();
    expect(result.ok).toBe(false);
    expect(auth().authError).toBe('auth.error_generic');
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-ann']);
  });
});

describe('перенос данных без аккаунта', () => {
  test('добавляют второй аккаунт из открытого — не спрашиваем, даже если у гостя есть данные', async () => {
    await seed('lancible-data', GUEST);
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await answerMove('keep');
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    expect(moveQuestion()).toBeNull();
    expect(titles()).toEqual(['Задача Боба']);
  });

  test('область аккаунта на телефоне не пуста — не спрашиваем', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().switchAccount(null);
    await settle();
    // Гость набрал данные, потом снова вошёл в Аню — её копия на месте.
    m.useAppStore.setState({ projects: [project('p-g', 'Гостевой')], tasks: [task('t-g', 'Задача гостя', 'p-g')] });
    await settle();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    expect(moveQuestion()).toBeNull();
    expect(titles()).toEqual(['Задача Ани']);
  });

  test('строка «Данных»: перенос в открытый аккаунт — без дублей, гость пустой, облако получает перенесённое', async () => {
    await seed('lancible-data', GUEST);
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await answerMove('keep');
    expect(auth().guestHasData).toBe(true);
    // Оставили как есть — картинки гостя никому не отдаются.
    expect(app().assetAdopt).toBeNull();
    expect(await auth().moveGuestData()).toEqual({ ok: true });
    expect(titles().sort()).toEqual(['Задача Ани', 'Задача гостя']);
    // Перенесли — и картинки гостя в хранилище редактора ждут, чтобы
    // ближайшая страница редактора отдала их этому аккаунту (assets-adopt,
    // editorLive.test.js).
    expect(app().assetAdopt).toBe('u-ann');
    // Второй раз переносить нечего — дублей нет.
    expect(await auth().moveGuestData()).toEqual({ ok: false });
    expect(titles().sort()).toEqual(['Задача Ани', 'Задача гостя']);
    expect((await stored('lancible-data')).state.tasks).toEqual([]);
    // Зеркало для старых клиентов — через 1,5 с после обмена.
    const end = Date.now() + 4000;
    while (Date.now() < end && mockWorld.cloud['u-ann'].tasks.length < 2) await settle(20);
    expect(mockWorld.rows('u-ann').some((r) => r.field === '*' && r.entity_id === 't-Гостевой')).toBe(true);
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title).sort()).toEqual(['Задача Ани', 'Задача гостя']);
  });
});

describe('«Выйти» и «Удалить данные с устройства»', () => {
  test('«Выйти» убирает аккаунт из списка и снимает его сеанс; данные остаются; открывается следующий', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    await auth().signOut();
    await settle();
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-ann']);
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(titles()).toEqual(['Задача Ани']);
    expect(mockWorld.calls).toContain('signOut global');
    // Данные Боба на телефоне, подпись помнится — их можно стереть из «Данных».
    expect(await storedTitles('lancible-data:u-bob')).toEqual(['Задача Боба']);
    expect(auth().deviceScopes).toEqual(expect.arrayContaining(['u-ann', 'u-bob']));
    expect(auth().accounts.known['u-bob']).toEqual({ email: 'bob@example.com', name: '' });
    // Последний вышел — гость.
    await auth().signOut();
    await settle();
    expect(auth().accounts.list).toEqual([]);
    expect(auth().current).toBeNull();
    expect(scopeName()).toBe('lancible-data');
  });

  test('данные аккаунта, из которого вышли, стираются с телефона; облако не трогается', async () => {
    await boot();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    await auth().signOut();
    await settle();
    expect(auth().deviceScopes).toEqual(['u-bob']);
    await auth().forgetDeviceData('u-bob');
    expect(await stored('lancible-data:u-bob')).toBeNull();
    expect(auth().deviceScopes).toEqual([]);
    expect(auth().accounts.known['u-bob']).toBeUndefined();
    expect(mockWorld.cloud['u-bob'].tasks.map((x) => x.title)).toEqual(['Задача Боба']);
  });

  test('данные открытого аккаунта: стираются, аккаунт уходит из списка, его сеанс отзывается на сервере (как у веба), других аккаунтов нет — открывается гость', async () => {
    await seed('lancible-data', GUEST);
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await answerMove('keep');
    const annTok = mockWorld.stored.refresh_token;
    await auth().forgetDeviceData('u-ann');
    await settle();
    expect(auth().current).toBeNull();
    expect(titles()).toEqual(['Задача гостя']);
    expect(await stored('lancible-data:u-ann')).toBeNull();
    expect(auth().accounts.list).toEqual([]);
    expect(auth().accounts.known['u-ann']).toBeUndefined();
    // Ровно один logout — этим сеансом; на телефоне сеанса больше нет.
    expect(mockWorld.calls.filter((c) => c.startsWith('revoke:logout'))).toEqual([`revoke:logout local ${annTok}`]);
    expect(mockWorld.valid.has(annTok)).toBe(false);
    expect(mockWorld.stored).toBeNull();
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title)).toEqual(['Задача Ани']);
  });

  test('данные открытого аккаунта при другом в списке: сеанс отзывается, открывается следующий аккаунт со своим сеансом', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    const bobTok = mockWorld.stored.refresh_token;
    await auth().forgetDeviceData('u-bob');
    await settle();
    expect(mockWorld.calls.filter((c) => c.startsWith('revoke:logout'))).toEqual([`revoke:logout local ${bobTok}`]);
    expect(mockWorld.valid.has(bobTok)).toBe(false);
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(titles()).toEqual(['Задача Ани']);
    expect(mockWorld.stored.user.id).toBe('u-ann');
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-ann']);
    expect(await stored('lancible-data:u-bob')).toBeNull();
  });

  test('данные открытого аккаунта без сети: копия стирается всё равно, сеанс на телефоне снят, открывается гость', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    const annTok = mockWorld.stored.refresh_token;
    mockWorld.offline = true;
    expect(await auth().forgetDeviceData('u-ann')).toEqual({ ok: true });
    await settle();
    expect(mockWorld.calls).toContain(`revoke:setSession ${annTok}`);
    expect(mockWorld.calls.some((c) => c.startsWith('revoke:logout'))).toBe(false);
    expect(mockWorld.stored).toBeNull();
    expect(auth().current).toBeNull();
    expect(await stored('lancible-data:u-ann')).toBeNull();
    expect(auth().accounts.list).toEqual([]);
  });
});

test('удалили аккаунт на сервере — он уходит из списка, открывается следующий; копия на телефоне остаётся, её можно стереть из «Данных»', async () => {
  await boot();
  await auth().signIn('ann@example.com', 'pw-ann');
  await settle();
  await auth().signIn('bob@example.com', 'pw-bob');
  await settle();
  const result = await auth().deleteAccount();
  await settle();
  expect(result.ok).toBe(true);
  expect(mockWorld.calls).toContain('invoke delete-account u-bob');
  expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-ann']);
  expect(auth().current).toBe('u-ann');
  expect(auth().status).toBe('signedIn');
  expect(titles()).toEqual(['Задача Ани']);
  // Окно подтверждения и страница delete-account обещают: копия остаётся.
  expect(await storedTitles('lancible-data:u-bob')).toEqual(['Задача Боба']);
  expect(auth().deviceScopes).toContain('u-bob');
  expect(auth().accounts.known['u-bob']).toEqual({ email: 'bob@example.com', name: '' });
});

describe('старт', () => {
  test('текущий из списка открывается своей областью, сеанс поднимается сам', async () => {
    const s = mockWorld.issue('u-ann');
    mockWorld.stored = s;
    await m.AsyncStorage.setItem('lancible-accounts', JSON.stringify({
      list: [{ uid: 'u-ann', email: 'ann@example.com', name: 'Аня', accessToken: s.access_token, refreshToken: s.refresh_token, lastUsedAt: 1 }],
      current: 'u-ann',
    }));
    await seed('lancible-data:u-ann', { ...blob('Своё Ани', 'Местная Ани'), settings: { ...GUEST.settings, syncResolvedFor: { userId: 'u-ann' } } });
    await seed('lancible-data', GUEST);
    await boot();
    expect(scopeName()).toBe('lancible-data:u-ann');
    expect(auth().status).toBe('signedIn');
    expect(titles()).toContain('Местная Ани');
    expect(titles()).not.toContain('Задача гостя');
  });

  test('обновились до аккаунтов со входом: сеанс без списка — его аккаунт текущий; на вопрос «Перенести» прежние данные переезжают в аккаунт, гостевая область — пустая, но на месте', async () => {
    mockWorld.stored = mockWorld.issue('u-ann');
    delete mockWorld.cloud['u-ann'];
    await seed('lancible-data', GUEST);
    await boot();
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(scopeName()).toBe('lancible-data:u-ann');
    await answerMove('move');
    expect(titles()).toEqual(['Задача гостя']);
    expect(app().projects.map((x) => x.name)).toEqual(['Гостевой']);
    const guest = await stored('lancible-data');
    expect(guest.state.tasks).toEqual([]);
    expect(guest.state.projects).toEqual([]);
    expect(guest.state.settings).toEqual(GUEST.settings);
    expect(auth().guestHasData).toBe(false);
    // Перенос — до синхронизации: облако пустого аккаунта получает перенесённое.
    const end = Date.now() + 4000;
    while (Date.now() < end && !(mockWorld.cloud['u-ann'] && mockWorld.cloud['u-ann'].tasks.length)) await settle(20);
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title)).toEqual(['Задача гостя']);
    expect(mockWorld.rows('u-ann').some((r) => r.field === '*' && r.entity_id === 't-Гостевой')).toBe(true);
  });

  test('сеанс без списка, у гостя данных нет — без вопроса', async () => {
    mockWorld.stored = mockWorld.issue('u-ann');
    await boot();
    expect(auth().current).toBe('u-ann');
    expect(moveQuestion()).toBeNull();
    expect(titles()).toEqual(['Задача Ани']);
  });

  test('приложение закрыли посреди перехода к гостю (сеанс аккаунта ещё лежит): старт — гость, сеанс снят на телефоне; облако картинок — только у открытого аккаунта', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    const ann = mockWorld.stored;
    await auth().switchAccount(null);
    await settle();
    // Холодный старт: свежие модули, хранилище прежнее, а сеанс Ани — как
    // будто снять его не успели.
    const saved = {};
    for (const k of await m.AsyncStorage.getAllKeys()) saved[k] = await m.AsyncStorage.getItem(k);
    const session = ann;
    mockWorld.calls = [];
    jest.resetModules();
    mockWorld.listeners = [];
    load();
    for (const [k, v] of Object.entries(saved)) await m.AsyncStorage.setItem(k, v);
    mockWorld.stored = session;
    await boot();
    expect(auth().current).toBeNull();
    expect(auth().status).toBe('signedOut');
    expect(scopeName()).toBe('lancible-data');
    expect(mockWorld.calls).toContain('removeLocal');
    expect(mockWorld.stored).toBeNull();
    expect(mockWorld.calls.some((c) => c.startsWith('signOut'))).toBe(false);
    // Свежие модули: библиотека — без своих хуков beforeEach/afterEach (pure).
    const { renderHook, waitFor, cleanup } = require('@testing-library/react-native/pure');
    const { useEditorAuth } = require('../src/hooks/useEditorAuth');
    const { result } = await renderHook(() => useEditorAuth());
    await settle();
    expect(result.current).toBeNull();
    await auth().switchAccount('u-ann');
    await settle();
    await waitFor(() => expect(result.current && result.current.userId).toBe('u-ann'));
    await cleanup();
  });
});

describe('напоминания', () => {
  test('после переключения расписание собирается сразу по задачам открытого аккаунта', async () => {
    const due = new Date(Date.now() + 3 * 86400000).toISOString();
    const remind = [{ id: 'r1', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }];
    await seed('lancible-data', { ...GUEST, tasks: [task('t-g', 'Гостевое с дедлайном', 'p-Гостевой', { dueAt: due, reminders: remind })] });
    await boot();
    const spy = jest.spyOn(m.notifications, 'rescheduleAll').mockImplementation(async () => {});
    const stop = m.reminderSync.startReminderSync();
    expect(spy.mock.calls.pop()[0].map((x) => x.title)).toEqual(['Гостевое с дедлайном']);
    await auth().signIn('ann@example.com', 'pw-ann');
    // Без секунды тишины: область открылась — расписание этого аккаунта.
    await settle(40);
    const afterSwitch = spy.mock.calls.find((c) => !c[0].some((x) => x.title === 'Гостевое с дедлайном'));
    expect(afterSwitch).toBeTruthy();
    await settle();
    await answerMove('keep');
    await auth().switchAccount(null);
    await settle(40);
    expect(spy.mock.calls.pop()[0].map((x) => x.title)).toEqual(['Гостевое с дедлайном']);
    stop();
  });
});

describe('«Удалить данные аккаунта с устройства» у неоткрытого аккаунта — его сеанс отзывается на сервере (как у веба)', () => {
  // Отдельным клиентом без сохранения сеанса (lib/auth.js:
  // revokeAccountSession): setSession его токенами → signOut({ scope: 'local' }).
  // Основной клиент держит сеанс открытого аккаунта — его не трогаем;
  // копия стирается, не дожидаясь сети.
  async function twoAccounts() {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    const annTok = auth().accounts.list.find((e) => e.uid === 'u-ann').refreshToken;
    return { annTok, bobTok: mockWorld.stored.refresh_token };
  }

  test('ровно один logout — токеном этого аккаунта; сеанс открытого не тронут; копия стёрта', async () => {
    const { annTok, bobTok } = await twoAccounts();
    expect(await stored('lancible-data:u-ann')).not.toBeNull();
    expect(await auth().forgetDeviceData('u-ann')).toEqual({ ok: true });
    await settle();
    expect(mockWorld.calls.filter((c) => c.startsWith('revoke:logout'))).toEqual([`revoke:logout local ${annTok}`]);
    expect(mockWorld.valid.has(annTok)).toBe(false);
    // Открытый — Боб — как был: тот же сеанс, живой токен, основной клиент
    // ни разу не выходил.
    expect(mockWorld.stored.refresh_token).toBe(bobTok);
    expect(mockWorld.valid.has(bobTok)).toBe(true);
    expect(mockWorld.calls.some((c) => c.startsWith('signOut'))).toBe(false);
    expect(auth().current).toBe('u-bob');
    expect(auth().status).toBe('signedIn');
    expect(await stored('lancible-data:u-ann')).toBeNull();
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-bob']);
  });

  test('без сети копия стирается всё равно, ошибка наружу не выходит', async () => {
    const { annTok } = await twoAccounts();
    mockWorld.offline = true;
    expect(await auth().forgetDeviceData('u-ann')).toEqual({ ok: true });
    await settle();
    expect(mockWorld.calls).toContain(`revoke:setSession ${annTok}`);
    expect(mockWorld.calls.some((c) => c.startsWith('revoke:logout'))).toBe(false);
    expect(await stored('lancible-data:u-ann')).toBeNull();
    expect(auth().accounts.list.map((e) => e.uid)).toEqual(['u-bob']);
    expect(auth().current).toBe('u-bob');
  });
});

// --- волна исправлений 19 октября 2026 (ревью телефона: находки 1, 3, 5) -----

/** Чтение ключа отказывает (на Android у AsyncStorage — строка длиннее ~2 МБ). */
function failRead(key, err = new Error('Row too big to fit into CursorWindow')) {
  const orig = m.AsyncStorage.getItem;
  m.AsyncStorage.getItem = jest.fn((k, ...rest) => (k === key ? Promise.reject(err) : orig.call(m.AsyncStorage, k, ...rest)));
  return () => { m.AsyncStorage.getItem = orig; };
}

describe('область не прочиталась', () => {
  test('переключение: списки прежнего не ложатся под ключ нового и в его облако не уходят; «Повторить» читает снова и синхронизирует', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    expect(titles()).toEqual(['Задача Боба']);
    const annRaw = await m.AsyncStorage.getItem('lancible-data:u-ann');
    const restore = failRead('lancible-data:u-ann');
    await auth().switchAccount('u-ann');
    // Мост к старым клиентам пишет зеркало через 1,5 с после обмена — ждём дольше.
    await settle(2200);
    expect(auth().current).toBe('u-ann');
    // В памяти — не Боб: пусто, без его журнала.
    expect(titles()).toEqual([]);
    expect(app().oplog).toBeNull();
    expect(app().hasHydrated).toBe(false);
    expect(app().scopeError).toEqual({ uid: 'u-ann' });
    // Что бы ни менялось в сторе, запись закрыта.
    app().setSettings({ theme: 'dark' });
    await settle();
    // Облако Ани данных Боба не получило — ни правками, ни зеркалом.
    expect(JSON.stringify(mockWorld.rows('u-ann'))).not.toContain('Задача Боба');
    expect(mockWorld.cloud['u-ann'].tasks.map((x) => x.title)).toEqual(['Задача Ани']);
    expect(await storedTitles('lancible-data:u-bob')).toEqual(['Задача Боба']);

    restore();
    // Нечитаемая запись цела (смотрим, когда чтение снова работает).
    expect(await m.AsyncStorage.getItem('lancible-data:u-ann')).toBe(annRaw);
    expect(await auth().reopenScope()).toBe(true);
    await settle();
    expect(app().scopeError).toBeNull();
    expect(titles()).toEqual(['Задача Ани']);
    expect(auth().status).toBe('signedIn');
    const end = Date.now() + 4000;
    while (Date.now() < end && !app().oplog) await settle(20);
    expect(app().oplog).toBeTruthy();
  });

  test('старт: битая запись не перезаписывается пустым состоянием', async () => {
    const broken = '{"state":{"tasks":[{"id":"t-1","title":"Обрыв';
    await m.AsyncStorage.setItem('lancible-data', broken);
    auth().init();
    const end = Date.now() + 4000;
    while (Date.now() < end && !(app().scopeError && auth().status !== 'loading')) await settle(10);
    app().setSettings({ lang: 'en' });
    app().createProject({ name: 'Новый' });
    await settle();
    expect(await m.AsyncStorage.getItem('lancible-data')).toBe(broken);
    expect(app().hasHydrated).toBe(false);
    expect(app().scopeError).toEqual({ uid: null });
  });
});

describe('переключение не запускается дважды', () => {
  test('второе касание, пока уходят правки прежнего, — отказ без действий; строки ждут конца', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    // Правка Боба и сразу переключение: сначала она уходит в облако
    // (leaveCurrent → flushSync), а сеть медленная.
    let release;
    addLocal('t-slow', 'Медленная', 'p-Облако Боба');
    mockWorld.server.db.hold = new Promise((r) => { release = r; });
    const first = auth().switchAccount('u-ann');
    await settle(50);
    expect(auth().switchPending).toBe(true);
    expect(auth().switching).toBe(false); // «Переключаю…» ещё нет — строки на экране
    const calls = mockWorld.calls.length;
    expect(await auth().switchAccount('u-ann')).toEqual({ ok: false, busy: true });
    expect(await auth().switchAccount(null)).toEqual({ ok: false, busy: true });
    expect(mockWorld.calls.length).toBe(calls);
    mockWorld.server.db.hold = null;
    release();
    expect(await first).toEqual({ ok: true });
    await settle();
    expect(auth().switchPending).toBe(false);
    expect(auth().current).toBe('u-ann');
    expect(auth().status).toBe('signedIn');
    expect(titles()).toEqual(['Задача Ани']);
    expect(mockWorld.calls.filter((c) => c.startsWith('setSession rt-u-ann-'))).toHaveLength(1);
    expect(mockWorld.rows('u-bob').some((r) => r.entity_id === 't-slow')).toBe(true);
  });
});

describe('«Удалить данные аккаунта с устройства» — и переписку с агентом', () => {
  const { aiKey, aiChatsKey, aiChatKey } = require('../src/lib/aiKeys');
  const chat = (id) => ({ id, title: 'План', createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z', preview: 'Ответ', count: 2 });
  async function seedChats(uid) {
    await m.AsyncStorage.setItem(aiChatsKey(uid), JSON.stringify([chat('c1')]));
    await m.AsyncStorage.setItem(aiChatKey(uid, 'c1'), JSON.stringify({ messages: [], items: [{ id: 'i1', kind: 'msg', role: 'user', text: 'Секрет' }] }));
  }
  const keysOf = async (uid) => (await m.AsyncStorage.getAllKeys()).filter((k) => k === aiKey(uid) || k.startsWith(`${aiKey(uid)}:`)).sort();

  test('неоткрытый аккаунт: его чаты и прежняя история уходят; чужие — на месте (у «u-ann» не берётся «u-ann2»)', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    await seedChats('u-ann');
    await m.AsyncStorage.setItem(aiKey('u-ann'), JSON.stringify({ messages: [], items: [] }));
    await seedChats('u-ann2');
    await seedChats('u-bob');
    expect(await keysOf('u-ann')).toHaveLength(3);
    await auth().forgetDeviceData('u-ann');
    expect(await keysOf('u-ann')).toEqual([]);
    expect(await keysOf('u-ann2')).toEqual([aiChatKey('u-ann2', 'c1'), aiChatsKey('u-ann2')].sort());
    expect(await keysOf('u-bob')).toHaveLength(2);
  });

  test('открытый аккаунт: переписка уходит и из памяти — вход тем же аккаунтом её не вернёт', async () => {
    const ai = require('../src/lib/aiChat');
    await boot();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    await seedChats('u-bob');
    await ai.aiAccount('u-bob');
    await ai.aiOpenChat('c1');
    expect(ai.useAiChat.getState().chats.map((c) => c.id)).toEqual(['c1']);
    expect(ai.useAiChat.getState().items.map((it) => it.text)).toEqual(['Секрет']);
    await auth().forgetDeviceData('u-bob');
    await settle();
    expect(await keysOf('u-bob')).toEqual([]);
    expect(ai.useAiChat.getState()).toMatchObject({ uid: null, chats: [], chatId: null, items: [], messages: [] });
    // Снова вошли этим аккаунтом — чатов нет: ни на устройстве, ни в памяти.
    await ai.aiAccount('u-bob');
    expect(ai.useAiChat.getState().chats).toEqual([]);
    expect(await keysOf('u-bob')).toEqual([]);
  });
});

describe('«Удалить данные аккаунта с устройства» — и картинки редактора (очередь стирания картинок)', () => {
  const queue = async () => JSON.parse((await m.AsyncStorage.getItem('lancible-asset-forget')) || '[]');

  test('аккаунт встаёт в очередь стирания (её разберёт ближайший редактор); вошли им снова — снят с очереди', async () => {
    await boot();
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    await auth().signIn('bob@example.com', 'pw-bob');
    await settle();
    await auth().forgetDeviceData('u-ann');
    expect(await queue()).toEqual(['u-ann']);
    // Открытый тоже.
    await auth().forgetDeviceData('u-bob');
    await settle();
    expect(await queue()).toEqual(['u-ann', 'u-bob']);
    // Аня вернулась на телефон раньше, чем открылся редактор: её новые
    // картинки стирать нельзя.
    await auth().signIn('ann@example.com', 'pw-ann');
    await settle();
    expect(await queue()).toEqual(['u-bob']);
  });
});

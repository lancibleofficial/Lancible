// Синхронизация журналом правок на вебе. Запуск: npm run test:e2e
//
// Откуда тест (17 октября 2026): синхронизация больше не гоняет весь набор
// данных одним JSON (sync_state, «кто последним отправил, тот и прав»), а
// пишет журнал правок по полям — таблица changes (supabase/sync2.sql),
// правила слияния — core/oplog.js (их сценарии — tests/unit/oplog.test.js).
// Здесь — то, что делает клиент: какие строки уходят в журнал, как приходят
// чужие, что видит человек при настоящем конфликте, корзина, первая связь
// аккаунта с журналом, мост к старым версиям через sync_state.
//
// Настоящий Supabase не трогаем. Вход подменяется в клиенте до старта
// приложения (как в routes.spec.js), а REST базы — сервером в самом тесте:
// page.route на /rest/v1/changes, snapshots, sync_state и profiles. Сервер
// ведёт себя как sync2.sql: seq по порядку, повтор op_id отбивается молча
// (insert … on conflict do nothing), base_seq не больше последнего seq.
// Realtime не эмулируется: приём зовётся тем же pullChanges(), который в
// проде зовёт событие realtime, «online» и тихая сверка.
const { test, expect } = require('@playwright/test');

const A = { id: 'aaaaaaaa-0000-4000-8000-0000000000a1', email: 'anna@example.com', name: 'Анна', password: 'pass-anna' };
const OTHER = 'win-11111111-2222-4333-8444-555555555555';
let opN = 0;
const opId = () => `00000000-0000-4000-8000-${String(++opN).padStart(12, '0')}`;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

/** Сервер базы в тесте. */
function makeCloud() {
  const c = {
    seq: 0,
    changes: [],
    snapshots: [],
    syncState: null,
    failInsert: false,
    failMirror: false,
    log: [],
    top() { return c.changes.reduce((m, r) => Math.max(m, r.seq), 0); },
    /** Вставка как в sync2.sql: seq, created_at — сервера, base_seq не
     *  дальше конца журнала. Повтор op_id — ничего. */
    add(row) {
      if (c.changes.some((x) => x.op_id === row.op_id)) return null;
      const r = {
        user_id: A.id, value: null, ...row, seq: ++c.seq, created_at: iso(), base_seq: Math.min(Number(row.base_seq) || 0, c.top()),
      };
      c.changes.push(r);
      return r;
    },
    /** Правка другого устройства. */
    other(entity, entityId, field, value, { at = iso(), base = c.top(), device = OTHER } = {}) {
      return c.add({ op_id: opId(), device_id: device, entity, entity_id: entityId, field, value, at, base_seq: base });
    },
    inserted(field) { return c.changes.filter((r) => r.device_id !== OTHER && r.device_id !== 'legacy' && (!field || r.field === field)); },
  };
  return c;
}

async function serve(page, c) {
  // К настоящей базе тест не ходит ни одним запросом.
  await page.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split('/rest/v1/')[1];
    const q = Object.fromEntries(url.searchParams);
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (method === 'GET') {
      if (table === 'profiles') return json(200, [{ name: A.name, terms_version: '2099-01-01', age_confirmed: true }]);
      if (table === 'changes') {
        const after = Number(String(q.seq || 'gt.0').replace('gt.', '')) || 0;
        c.log.push({ method, table, after });
        // Тест может придержать ответ (следующая страница журнала грузится).
        if (c.beforeChanges) await c.beforeChanges(after);
        const rows = c.changes.filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, Number(q.limit) || 1000);
        return json(200, rows);
      }
      if (table === 'snapshots') return json(200, c.snapshots.slice().sort((a, b) => b.seq - a.seq).slice(0, Number(q.limit) || 1000).map(({ seq, data }) => ({ seq, data })));
      if (table === 'sync_state') return json(200, c.syncState ? [{ ...c.syncState }] : []);
      return json(200, []);
    }
    if (method === 'POST') {
      const body = req.postDataJSON();
      const prefer = req.headers().prefer || '';
      c.log.push({ method, table, body, prefer, query: q });
      if (table === 'changes') {
        if (c.failInsert) return json(503, { message: 'нет сети' });
        const out = (Array.isArray(body) ? body : [body]).map((r) => c.add(r)).filter(Boolean);
        return json(201, /return=representation/.test(prefer) ? out : undefined);
      }
      if (table === 'snapshots') {
        if (c.snapshots.some((s) => s.seq === body.seq)) return json(409, { code: '23505', message: 'duplicate key value' });
        c.snapshots.push({ seq: body.seq, data: body.data });
        return json(201);
      }
      if (table === 'sync_state') {
        if (c.failMirror) return json(503, { message: 'нет сети' });
        c.syncState = { ...(c.syncState || {}), ...body };
        return json(201);
      }
    }
    return json(404, { message: 'нет такого' });
  });
}

/** Вход подменяется до старта приложения: сеанс лежит в localStorage
 *  (__test_session), клиент отдаёт его как свой. Realtime — пустышка. */
const patchAuth = (page) => page.addInitScript(() => {
  let real;
  const read = () => { try { return JSON.parse(localStorage.getItem('__test_session') || 'null'); } catch { return null; } };
  const patch = (client) => {
    client.auth.getSession = async () => ({ data: { session: read() }, error: null });
    client.auth.getUser = async () => ({ data: { user: read() ? read().user : null } });
    client.auth.setSession = async () => (read() ? { data: { session: read(), user: read().user }, error: null }
      : { data: { session: null, user: null }, error: { name: 'AuthApiError', code: 'refresh_token_not_found', message: 'нет', status: 400 } });
    client.auth.refreshSession = client.auth.setSession;
    client.auth._removeSession = async () => {};
    client.auth.signOut = async () => { localStorage.removeItem('__test_session'); return { error: null }; };
    client.auth.signInWithPassword = async ({ email }) => {
      const s = { access_token: 'at-test', refresh_token: 'rt-test', user: { id: 'aaaaaaaa-0000-4000-8000-0000000000a1', email } };
      localStorage.setItem('__test_session', JSON.stringify(s));
      return { data: { user: s.user, session: s }, error: null };
    };
    client.channel = () => ({ on() { return this; }, subscribe() { return this; } });
    client.removeChannel = () => {};
    return client;
  };
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    set(v) { real = v; },
    get() {
      return real && new Proxy(real, {
        get: (target, key) => (key === 'createClient' ? (...args) => patch(target.createClient(...args)) : target[key]),
      });
    },
  });
});

const SESSION = { access_token: 'at-test', refresh_token: 'rt-test', user: { id: A.id, email: A.email } };

/** Пустой браузер; signedIn — сразу вошедший (сеанс на старте). */
async function start(page, c, { signedIn = true } = {}) {
  await serve(page, c);
  await patchAuth(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/index.html');
  await page.evaluate((s) => {
    localStorage.clear();
    if (s) localStorage.setItem('__test_session', JSON.stringify(s));
  }, signedIn ? SESSION : null);
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  if (signedIn) await linked(page);
}

/** Область связана с журналом, своё ушло. */
async function linked(page) {
  await expect.poll(() => page.evaluate(() => !!(currentUser && syncBundle))).toBe(true);
  await settled(page);
}
const settled = (page) => expect.poll(() => page.evaluate(() => (syncBundle ? syncBundle.pending.length : -1))).toBe(0);

const pending = (page) => page.evaluate(() => syncBundle.pending.map((o) => ({ entity: o.entity, entityId: o.entityId, field: o.field, value: o.value, baseSeq: o.baseSeq })));
const pull = (page) => page.evaluate(() => pullChanges());
const task = (page, id) => page.evaluate((x) => JSON.parse(JSON.stringify(getTask(x))), id);

/** Задача руками — и сразу на диск (сохранение сводит её в журнал). */
const addTask = (page, id, title) => page.evaluate(async ({ x, tt }) => {
  if (!state.projects.length) {
    state.projects.push({ id: 'p-1', name: 'Проект', color: PALETTE[0], createdAt: new Date().toISOString() });
    seedProjectStatuses('p-1');
  }
  state.tasks.unshift({ id: x, projectId: state.projects[0].id, title: tt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  migrate();
  render();
  savePending = true;
  await saveNow();
}, { x: id, tt: title });

const edit = (page, id, patch) => page.evaluate(async ({ x, p }) => {
  Object.assign(getTask(x), p, { updatedAt: new Date().toISOString() });
  render();
  savePending = true;
  await saveNow();
}, { x: id, p: patch });

test('своя правка уходит в журнал строками, ответ снимает её с очереди, очередь переживает перезапуск', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  const dev = await page.evaluate(() => deviceId);
  expect(dev, 'id установки — «web-» и uuid').toMatch(/^web-[0-9a-f-]{36}$/);
  expect(await page.evaluate(() => localStorage.getItem('lancible:device')), 'id лежит на устройстве, не в области').toBe(dev);

  await addTask(page, 't-1', 'Первая');
  await settled(page);
  const created = c.inserted('*').find((r) => r.entity === 'task' && r.entity_id === 't-1');
  expect(created, 'создание задачи ушло правкой «*»').toBeTruthy();
  expect(created.value.title).toBe('Первая');
  expect(created.device_id).toBe(dev);
  expect(created.op_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(created.base_seq, 'журнал был пуст').toBe(0);
  // Вставка — с игнором повторов по (user_id, op_id) и ответом строками.
  const post = c.log.find((x) => x.method === 'POST' && x.table === 'changes');
  expect(post.query.on_conflict).toBe('user_id,op_id');
  expect(post.prefer).toMatch(/resolution=ignore-duplicates/);
  expect(post.prefer).toMatch(/return=representation/);

  // Правка поля — одно поле, base_seq — докуда устройство прочитало журнал.
  const before = c.top();
  await expect.poll(() => page.evaluate(() => syncBundle.lastSeq)).toBe(before);
  await edit(page, 't-1', { title: 'Первая, правка' });
  await settled(page);
  const titled = c.inserted('title').pop();
  expect(titled).toMatchObject({ entity: 'task', entity_id: 't-1', value: 'Первая, правка', base_seq: before });
  expect(c.inserted('*').filter((r) => r.entity_id === 't-1'), 'задача целиком второй раз не уходит').toHaveLength(1);

  // Сети нет: правка ждёт в очереди — и в данных области на диске.
  c.failInsert = true;
  await edit(page, 't-1', { title: 'Без сети' });
  await expect.poll(async () => (await pending(page)).some((o) => o.field === 'title' && o.value === 'Без сети')).toBe(true);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).sync2, `lancible:data:${A.id}`);
  expect(stored.pending.some((o) => o.field === 'title' && o.value === 'Без сети'), 'очередь — в той же записи, что данные').toBe(true);
  expect(stored.state, 'копию состояния пачка не пишет: ею служат сами списки').toBeUndefined();

  // Перезапуск: очередь на месте и уходит, как только сеть вернулась.
  await page.reload();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  expect((await pending(page)).some((o) => o.field === 'title' && o.value === 'Без сети'), 'очередь пережила перезапуск').toBe(true);
  expect(await page.evaluate(() => deviceId), 'id установки тот же').toBe(dev);
  c.failInsert = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled(page);
  expect(c.inserted('title').pop().value).toBe('Без сети');
  expect((await task(page, 't-1')).title).toBe('Без сети');
});

test('чужая правка другого поля сливается молча, своё не трогает', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Моя');
  await settled(page);
  const due = new Date(2026, 10, 1, 18, 0).toISOString();
  c.other('task', 't-1', 'dueAt', due);
  await pull(page);
  const t1 = await task(page, 't-1');
  expect(t1.dueAt, 'чужая правка легла').toBe(due);
  expect(t1.title, 'своё поле цело').toBe('Моя');
  expect(await page.evaluate(() => syncBundle.conflicts.length), 'конфликта нет').toBe(0);
  await expect(page.locator('#toast')).toHaveText('Данные обновлены с другого устройства');
  // Приём ничего не отсылает обратно: чужое — не своя правка.
  await page.waitForTimeout(600);
  expect(c.inserted('dueAt')).toEqual([]);
});

test('одно поле параллельно: значок, «Другая версия» с обеими версиями, выбор уходит в журнал', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Общая');
  await settled(page);
  const seen = c.top();
  // Своя правка — без сети; чужая сделана, не видя её (base — тот же seq).
  c.failInsert = true;
  await edit(page, 't-1', { title: 'Наша', notes: { ops: [{ insert: 'Наш текст заметки\n' }] } });
  const theirs = c.other('task', 't-1', 'title', 'Их', { at: iso(60000), base: seen });
  c.other('task', 't-1', 'notes', { ops: [{ insert: 'Их текст заметки\n' }] }, { at: iso(60000), base: seen });
  c.failInsert = false;
  await page.evaluate(() => syncNow());
  await settled(page);

  // Показана более поздняя — наша; их версия лежит рядом.
  expect((await task(page, 't-1')).title).toBe('Наша');
  expect(await page.evaluate(() => syncBundle.conflicts.map((x) => x.field).sort())).toEqual(['notes', 'title']);
  await expect(page.locator('#toast')).toContainText('Пришла другая версия');

  // Значок — у строки задачи в карточке проекта, в списке и на доске.
  await page.evaluate(() => openView('projects'));
  await expect(page.locator('.ptile-task[data-id="t-1"] .conflict-mark')).toHaveCount(1);
  await page.evaluate(() => { openProject('p-1'); state.ui.projectTab = 'list'; render(); });
  await expect(page.locator('.task-item[data-id="t-1"] .conflict-mark')).toHaveCount(1);
  await page.evaluate(() => { state.ui.projectTab = 'board'; render(); });
  await expect(page.locator('.board-card[data-id="t-1"] .conflict-mark')).toHaveCount(1);
  const color = await page.locator('.board-card[data-id="t-1"] .conflict-mark').evaluate((n) => getComputedStyle(n).color);
  const ink = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--accent-ink)'; document.body.append(p); const v = getComputedStyle(p).color; p.remove(); return v; });
  expect(color, 'цвет значка — токен').toBe(ink);

  // Свойства задачи: «Другая версия · Название, Заметки ›».
  await page.evaluate(() => selectTask('t-1'));
  const row = page.locator('#task-conflicts-row');
  await expect(row).toBeVisible();
  await expect(row.locator('.srow-label')).toHaveText('Другая версия');
  await expect(row.locator('.srow-value')).toHaveText(/Название/);
  await expect(row.locator('.srow-value')).toHaveText(/Заметки/);
  await row.click();
  const dlg = page.locator('#syncdlg-backdrop');
  await expect(dlg).toBeVisible();
  const titleBlock = dlg.locator('.syncdlg-field', { has: page.locator('.sgroup-label', { hasText: 'Название' }) });
  await expect(titleBlock.locator('.syncdlg-version')).toHaveCount(2);
  await expect(titleBlock.locator('.syncdlg-version.shown .syncdlg-val')).toHaveText('Наша');
  await expect(titleBlock.locator('.syncdlg-version.shown .syncdlg-who')).toContainText('Это устройство');
  const other = titleBlock.locator(`.syncdlg-version[data-op="${theirs.op_id}"]`);
  await expect(other.locator('.syncdlg-val')).toHaveText('Их');
  await expect(other.locator('.syncdlg-who')).toContainText('Windows');
  // Заметки — обе версии текстом, своей прокруткой.
  const notesBlock = dlg.locator('.syncdlg-field', { has: page.locator('.sgroup-label', { hasText: 'Заметки' }) });
  await expect(notesBlock.locator('.syncdlg-text')).toHaveText(['Наш текст заметки', 'Их текст заметки']);
  expect(await notesBlock.locator('.syncdlg-text').first().evaluate((n) => getComputedStyle(n).overflowY)).toBe('auto');

  // «Оставить эту» у их названия: в живом — их, в журнал — правка поля и 'resolved'.
  await other.locator('.syncdlg-keep').click();
  await expect(page.locator('#toast')).toHaveText('Оставлена выбранная версия');
  expect((await task(page, 't-1')).title).toBe('Их');
  await settled(page);
  const resolved = c.inserted('resolved').pop();
  expect(resolved.value).toMatchObject({ field: 'title', keep: theirs.op_id });
  expect(c.inserted('title').pop().value).toBe('Их');
  // Конфликт названия закрыт, заметок — ещё открыт; закрыли и его — окно ушло.
  await expect(titleBlock).toHaveCount(0);
  await notesBlock.locator('.syncdlg-version.shown .syncdlg-keep').click();
  await expect(dlg).toBeHidden();
  await expect(row).toBeHidden();
  expect(await page.evaluate(() => syncBundle.conflicts.length)).toBe(0);
  await page.evaluate(() => { openProject('p-1'); state.ui.projectTab = 'board'; render(); });
  await expect(page.locator('.board-card[data-id="t-1"]')).toHaveCount(1);
  await expect(page.locator('.board-card[data-id="t-1"] .conflict-mark')).toHaveCount(0);
});

test('чужое удаление против своей правки — задача осталась; удаление по очереди — корзина и «Восстановить»', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Правлю');
  await addTask(page, 't-2', 'Удалят');
  await settled(page);

  // Параллельно: здесь правят (ещё не отправлено), там удалили, не видя правки.
  const seen = c.top();
  c.failInsert = true;
  await edit(page, 't-1', { title: 'Правлю дальше' });
  c.other('task', 't-1', 'deleted', iso(), { base: seen });
  await pull(page);
  expect(await task(page, 't-1'), 'задача осталась').toBeTruthy();
  await expect(page.locator('#toast')).toHaveText('«Правлю дальше» осталась: её удалили на одном устройстве и правили на другом');
  c.failInsert = false;
  await page.evaluate(() => syncNow());
  await settled(page);

  // По очереди: удалили, видя всё, — задача ушла в корзину.
  c.other('task', 't-2', 'deleted', iso());
  await pull(page);
  expect(await page.evaluate(() => getTask('t-2'))).toBeNull();
  await page.evaluate(() => openSettings('data'));
  await expect(page.locator('#settings-sync-data-label')).toHaveText('Синхронизация');
  await expect(page.locator('#settings-conflicts-row .srow-value')).toHaveText('0');
  await expect(page.locator('#settings-trash-row .srow-value')).toHaveText('1');
  await page.locator('#settings-trash-row').click();
  const dlg = page.locator('#syncdlg-backdrop');
  await expect(dlg.locator('#syncdlg-title')).toHaveText('Корзина');
  const row = dlg.locator('.trash-row[data-id="t-2"]');
  await expect(row.locator('.srow-label')).toHaveText('Удалят');
  await expect(row.locator('.srow-sub')).toContainText('удалено');
  await row.locator('.trash-restore').click();
  await expect(page.locator('#toast')).toHaveText('«Удалят» — восстановлено');
  expect((await task(page, 't-2')).title).toBe('Удалят');
  await settled(page);
  // Возврат — правками: 'deleted' = null и '*' со всей задачей.
  expect(c.inserted('deleted').filter((r) => r.entity_id === 't-2').pop().value).toBeNull();
  expect(c.inserted('*').filter((r) => r.entity_id === 't-2').length).toBe(2);
  await expect(dlg.locator('.empty-state-title')).toHaveText('Корзина пуста');
  await page.locator('#syncdlg-close').click();
  await expect(page.locator('#settings-trash-row .srow-value')).toHaveText('0');

  // Своё удаление — тоже в корзину, на 30 дней.
  await page.evaluate(async () => { state.tasks = state.tasks.filter((x) => x.id !== 't-1'); render(); savePending = true; await saveNow(); });
  await settled(page);
  expect(c.inserted('deleted').filter((r) => r.entity_id === 't-1')).toHaveLength(1);
  expect(await page.evaluate(() => trashRows().map((x) => x.entityId))).toEqual(['t-1']);
});

test('первый вход без журнала: sync_state — слепок seq 0; гость с данными → «Перенести» — всё в аккаунте без потерь', async ({ page }) => {
  const c = makeCloud();
  // Аккаунт жил на старой схеме: данные — одним JSON в sync_state.
  const now = iso(3600000);
  c.syncState = {
    user_id: A.id,
    updated_at: now,
    updated_by: 'old-desktop-client',
    data: {
      projects: [{ id: 'cp', name: 'Облачный', color: '#87ff65', createdAt: now }],
      tasks: [{ id: 'ct', projectId: 'cp', title: 'Облачная задача', createdAt: now, updatedAt: now, sessions: [], totalMs: 0 }],
      statuses: [], tags: [], versions: [], documents: [],
    },
  };
  await start(page, c, { signedIn: false });
  await addTask(page, 'g-1', 'Задача гостя');
  await page.locator('#account-btn').click();
  await expect(page.locator('#auth-email')).toBeFocused();
  await page.locator('#auth-email').fill(A.email);
  await page.locator('#auth-password').fill(A.password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#confirm-title')).toHaveText('Перенести данные?');
  await page.locator('#confirm-ok').click();
  await linked(page);

  // Слепок seq 0 — тот самый sync_state: следующие устройства начнут с него.
  expect(c.snapshots).toHaveLength(1);
  expect(c.snapshots[0].seq).toBe(0);
  expect(c.snapshots[0].data.tasks.map((x) => x.id)).toEqual(['ct']);
  // Всё в аккаунте: облачное и перенесённое; вопроса «какие данные оставить» нет.
  await expect.poll(() => page.evaluate(() => state.tasks.map((x) => x.title).sort())).toEqual(['Задача гостя', 'Облачная задача']);
  expect(await page.evaluate(() => getProject('cp').name)).toBe('Облачный');
  const guest = c.inserted('*').find((r) => r.entity === 'task' && r.entity_id === 'g-1');
  expect(guest, 'задача гостя ушла в журнал созданием').toBeTruthy();
  expect(guest.base_seq, 'гость ничего из аккаунта не видел').toBe(0);
  // Облачное обратно целиком не отправляется: только то, что дописала
  // миграция этого устройства (статус проекта и прочие пустые поля), —
  // правками полей, без конфликтов.
  const back = c.inserted().filter((r) => r.entity_id === 'ct');
  expect(back.some((r) => r.field === '*' || r.field === 'title'), 'облачная задача не пересоздана и не переименована').toBe(false);
  expect(await page.evaluate(() => syncBundle.conflicts.length)).toBe(0);
  // Гость пуст.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lancible:data')).tasks)).toEqual([]);
});

test('гость с общими сущностями: перенос в связанный аккаунт — по полям, расхождение — другой версией', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'В аккаунте');
  await settled(page);
  // В «Без аккаунта» лежит та же задача (то же id), переименованная позже.
  await page.evaluate((later) => {
    const t1 = JSON.parse(JSON.stringify(getTask('t-1')));
    const p = JSON.parse(JSON.stringify(state.projects[0]));
    const st = JSON.parse(JSON.stringify(state.statuses));
    localStorage.setItem('lancible:data', JSON.stringify({
      projects: [p], statuses: st, tags: [], versions: [], documents: [],
      tasks: [{ ...t1, title: 'У гостя', updatedAt: later }, { id: 'g-2', projectId: p.id, title: 'Новая у гостя', createdAt: later, updatedAt: later }],
      activeTimer: null, settings: {},
    }));
  }, iso(-60000));
  await page.evaluate(() => refreshDeviceScopes());
  expect(await page.evaluate(() => moveGuestData())).toBe(true);
  await settled(page);
  const t1 = await task(page, 't-1');
  expect(t1.title, 'свежее — гостевое').toBe('У гостя');
  expect((await task(page, 'g-2')).title).toBe('Новая у гостя');
  // Название аккаунта не пропало — лежит другой версией.
  const conflict = await page.evaluate(() => syncBundle.conflicts.find((x) => x.entityId === 't-1' && x.field === 'title'));
  expect(conflict.versions.map((v) => v.value).sort()).toEqual(['В аккаунте', 'У гостя']);
  expect(c.inserted('conflict').length, 'пометка о расхождении — в журнале').toBeGreaterThan(0);
});

test('перенос гостя в связанный аккаунт, таймер идёт у обоих: гостевой закрывается записью времени, свой идёт дальше', async ({ page }) => {
  // Таймер в области один. До 19 октября на пути с журналом правок
  // (adoptGuestState) таймер гостя пропадал вместе со своим временем.
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'В аккаунте');
  await settled(page);
  const mine = await page.evaluate(() => {
    const at = Date.now() - 5 * 60000;
    state.activeTimer = { taskId: 't-1', startedAt: at, heartbeatAt: at };
    return state.activeTimer;
  });
  const guestStart = Date.now() - 30 * 60000;
  await page.evaluate((at) => {
    const p = { id: 'gp', name: 'Гостевой', color: PALETTE[1], createdAt: new Date(at).toISOString() };
    localStorage.setItem('lancible:data', JSON.stringify({
      projects: [p], statuses: [], tags: [], versions: [], documents: [],
      tasks: [{ id: 'g-1', projectId: 'gp', title: 'Таймер гостя', sessions: [], totalMs: 0, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() }],
      activeTimer: { taskId: 'g-1', startedAt: at, heartbeatAt: at }, settings: {},
    }));
  }, guestStart);
  await page.evaluate(() => refreshDeviceScopes());
  expect(await page.evaluate(() => moveGuestData())).toBe(true);
  await settled(page);
  expect(await page.evaluate(() => state.activeTimer), 'свой таймер идёт дальше').toEqual(mine);
  const g1 = await task(page, 'g-1');
  expect(g1.sessions, 'время гостя — записью на его задаче').toHaveLength(1);
  expect(g1.totalMs).toBeGreaterThanOrEqual(30 * 60000 - 1000);
  expect(Date.parse(g1.sessions[0].start)).toBe(guestStart);
  // Запись уехала в журнал вместе с задачей.
  const sent = c.inserted().filter((r) => r.entity === 'task' && r.entity_id === 'g-1');
  expect(sent.some((r) => JSON.stringify(r.value || null).includes(new Date(guestStart).toISOString())), 'запись времени — в журнале').toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lancible:data')).activeTimer), 'у гостя таймера не осталось').toBeNull();
});

test('зеркало для старых версий: sync_state с updated_by oplog: и mirror_seq', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Для старых');
  await settled(page);
  await expect.poll(() => c.syncState && c.syncState.mirror_seq, { timeout: 8000 }).toBe(c.top());
  const dev = await page.evaluate(() => deviceId);
  expect(c.syncState.updated_by).toBe(`oplog:${dev}`);
  expect(c.syncState.user_id).toBe(A.id);
  expect(c.syncState.data.tasks.map((x) => x.title)).toEqual(['Для старых']);
  expect(Object.keys(c.syncState.data).sort(), 'тот же состав, что писали старые версии').toEqual(['documents', 'projects', 'statuses', 'tags', 'tasks', 'versions']);
});

test('старый клиент записал sync_state: мост переводит запись в правки и ничего не затирает', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Общая');
  await addTask(page, 't-2', 'Только наша правка');
  await settled(page);
  await expect.poll(() => c.syncState && c.syncState.mirror_seq, { timeout: 8000 }).toBe(c.top());
  const mirror = JSON.parse(JSON.stringify(c.syncState));
  // Пока старый клиент думает, здесь правят t-2 (зеркало не обновится).
  c.failMirror = true;
  await edit(page, 't-2', { title: 'Наша свежая' });
  await settled(page);

  // Старый клиент: от зеркала — своё название t-1 и новая задача. t-2 у
  // него прежняя: он нашей правки не видел и затереть её не должен.
  const data = JSON.parse(JSON.stringify(mirror.data));
  data.tasks.find((x) => x.id === 't-1').title = 'Со старого телефона';
  data.tasks.unshift({ id: 'old-1', projectId: 'p-1', title: 'Задача со старого', createdAt: iso(), updatedAt: iso() });
  c.syncState = { ...c.syncState, data, updated_at: iso(), updated_by: 'legacy-phone-1' };
  // Событие realtime об UPDATE sync_state зовёт этот же обработчик.
  await page.evaluate((row) => onSyncStateRow(row), c.syncState);
  await expect.poll(() => page.evaluate(() => (getTask('old-1') || {}).title)).toBe('Задача со старого');
  expect((await task(page, 't-1')).title).toBe('Со старого телефона');
  expect((await task(page, 't-2')).title, 'свежая правка не затёрта').toBe('Наша свежая');
  const legacy = c.changes.filter((r) => r.device_id === 'legacy');
  expect(legacy.map((r) => `${r.entity_id}:${r.field}`).sort()).toEqual(['old-1:*', 't-1:title']);
  expect(legacy.every((r) => r.base_seq === mirror.mirror_seq), 'старый клиент видел журнал до своего зеркала').toBe(true);
  // Повтор той же записи — тот же id правок: сервер отбивает, нового нет.
  await page.evaluate((row) => { syncExtra.bridged = null; return bridgeLegacy(row); }, c.syncState);
  expect(c.changes.filter((r) => r.device_id === 'legacy')).toHaveLength(2);
  // Зеркало дальше — уже с правками старого клиента.
  c.failMirror = false;
  await page.evaluate(() => writeMirror());
  await expect.poll(() => c.syncState.updated_by).toMatch(/^oplog:/);
  expect(c.syncState.data.tasks.map((x) => x.title).sort()).toEqual(['Задача со старого', 'Наша свежая', 'Со старого телефона']);
});

test('приём из нескольких страниц: правка, сделанная пока грузится следующая, не теряется и чужое не откатывает', async ({ page }) => {
  // Устройство долго было без сети: на сервере больше страницы (1000 строк)
  // чужих правок. Раньше страницы сливались по одной, а своё сводилось в
  // очередь только перед первой: правка между страницами затиралась в конце,
  // а сохранение между ними уходило правками, откатывающими чужое.
  const c = makeCloud();
  await start(page, c);
  await addTask(page, 't-1', 'Моя');
  await addTask(page, 't-2', 'Их');
  await settled(page);
  for (let i = 1; i <= 1000; i += 1) c.other('task', 't-2', 'title', `Их ${i}`);
  const due = new Date(2026, 10, 1, 18, 0).toISOString();
  c.other('task', 't-2', 'dueAt', due); // уже на второй странице
  const firstPage = c.top() - 1;
  let release;
  const held = new Promise((r) => { release = r; });
  let reached;
  const atSecond = new Promise((r) => { reached = r; });
  c.beforeChanges = async (after) => { if (after >= firstPage) { reached(); await held; } };

  await page.evaluate(() => { window.__pull = pullChanges(); });
  await atSecond;
  // Вторая страница ещё в пути. Одна правка сохранилась сразу (сохранение
  // сводит её в очередь), другая — нет: её ждёт таймер сохранения.
  await edit(page, 't-1', { title: 'Моя, правка' });
  await page.evaluate(() => { getTask('t-1').notes = { ops: [{ insert: 'Набрано между страницами\n' }] }; scheduleSave(); });
  c.beforeChanges = null;
  release();
  await page.evaluate(() => window.__pull);
  await settled(page);

  const t1 = await task(page, 't-1');
  const t2 = await task(page, 't-2');
  expect(t1.title, 'сохранённая правка цела').toBe('Моя, правка');
  expect(t1.notes, 'несохранённая правка цела').toEqual({ ops: [{ insert: 'Набрано между страницами\n' }] });
  expect(t2.title, 'чужое с первой страницы легло').toBe('Их 1000');
  expect(t2.dueAt, 'чужое со второй страницы легло').toBe(due);
  // В журнал ушли только свои правки — ни одной, откатывающей чужое.
  expect(c.inserted().filter((r) => r.entity_id === 't-2' && r.field !== '*'), 'чужое не откатывалось').toEqual([]);
  expect(c.inserted('title').filter((r) => r.entity_id === 't-1').map((r) => r.value)).toEqual(['Моя, правка']);
  expect(c.inserted('notes').filter((r) => r.entity_id === 't-1').map((r) => r.value)).toEqual([{ ops: [{ insert: 'Набрано между страницами\n' }] }]);
  // Прочитано всё: следующий приём начинает после последней строки.
  expect(await page.evaluate(() => syncBundle.lastSeq)).toBe(c.top());
});

test('строки журнала — на четырёх языках', async ({ page }) => {
  const c = makeCloud();
  await start(page, c);
  const S = {
    en: ['Sync', 'Conflicts', 'Trash'],
    uk: ['Синхронізація', 'Конфлікти', 'Кошик'],
    kk: ['Синхрондау', 'Қайшылықтар', 'Себет'],
    ru: ['Синхронизация', 'Конфликты', 'Корзина'],
  };
  for (const [lang, [group, conflicts, trash]] of Object.entries(S)) {
    await page.evaluate((l) => { state.settings.lang = l; applyStaticTranslations(); openSettings('data'); }, lang);
    await expect(page.locator('#settings-sync-data-label')).toHaveText(group);
    await expect(page.locator('#settings-conflicts-row .srow-label')).toHaveText(conflicts);
    await expect(page.locator('#settings-trash-row .srow-label')).toHaveText(trash);
  }
});

for (const width of [1280, 375]) {
  test(`${width}: окно «Другая версия» не уезжает за край`, async ({ page }) => {
    const c = makeCloud();
    await start(page, c);
    await addTask(page, 't-1', 'Общая');
    await settled(page);
    const seen = c.top();
    c.failInsert = true;
    await edit(page, 't-1', { notes: { ops: [{ insert: `${'Длинная строка заметки без пробелов_'.repeat(20)}\n`.repeat(30) }] } });
    c.other('task', 't-1', 'notes', { ops: [{ insert: 'Их\n' }] }, { at: iso(60000), base: seen });
    c.failInsert = false;
    await page.evaluate(() => syncNow());
    await settled(page);
    await page.setViewportSize({ width, height: 760 });
    await page.evaluate(() => openConflictDialog('task', 't-1'));
    // Окно въезжает с масштабом — меряем, когда встало.
    await expect.poll(async () => {
      const b = await page.locator('.syncdlg').boundingBox();
      return b && b.y >= 0 && b.y + b.height <= 760;
    }).toBe(true);
    const box = await page.locator('.syncdlg').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // Длинная заметка прокручивается внутри своей версии, а не растягивает окно.
    const text = await page.locator('.syncdlg-text').first().evaluate((n) => [n.scrollHeight > n.clientHeight, n.clientHeight]);
    expect(text[0]).toBe(true);
    expect(text[1]).toBeLessThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

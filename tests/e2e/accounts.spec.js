// Несколько аккаунтов на одном устройстве. Запуск: npm run test:e2e
//
// Откуда тест (17 октября 2026): пункт круга «добавить возможность добавлять
// несколько аккаунтов». У каждого аккаунта своя область данных (веб —
// lancible:data:<uid>, гость — прежний lancible:data), список аккаунтов с
// сеансами неактивных — lancible:accounts (core/accounts.js). Здесь — то,
// что видит человек, и то, что легло в хранилище: у каждого свои задачи,
// гость не пострадал, галочка у текущего, меню профиля переключает,
// refresh-токен ротируется и при возврате идёт свежий, отказ сеанса
// оставляет аккаунт с пометкой, «Выйти» убирает из списка и открывает
// следующего, «Удалить данные с устройства» стирает ключ, таймер — часть
// области.
//
// Настоящий Supabase не трогаем: методы клиента, которые зовёт приложение,
// подменяются в странице (как в auth.spec.js и delete-account.spec.js), сеть
// к базе обрывается целиком. Сеансы живут в window.__cloud: у каждого
// аккаунта свой действующий refresh-токен, setSession с уже использованным
// отвечает refresh_token_already_used — как GoTrue.
const { test, expect } = require('@playwright/test');

const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'anna@example.com', name: 'Анна', password: 'pass-anna' };
const B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'boris@example.com', name: 'Борис', password: 'pass-boris' };

/** Облако в странице: сеансы, профили, журнал вызовов. Подмена переживает
 *  только страницу — после перезагрузки её ставят заново. */
const fakeCloud = (page, users) => page.evaluate((list) => {
  const byEmail = Object.fromEntries(list.map((u) => [u.email, u]));
  const byId = Object.fromEntries(list.map((u) => [u.id, u]));
  const c = window.__cloud = window.__cloud || { session: null, valid: {}, n: 0, calls: [], fail: {} };
  const issue = (u) => {
    c.n += 1;
    const s = { access_token: `at-${u.id}-${c.n}`, refresh_token: `rt-${u.id}-${c.n}`, user: { id: u.id, email: u.email } };
    c.valid[u.id] = s.refresh_token;
    return s;
  };
  sb.auth.signInWithPassword = async ({ email, password }) => {
    c.calls.push(['signIn', email]);
    const u = byEmail[email];
    if (!u || u.password !== password) return { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } };
    c.session = issue(u);
    return { data: { user: c.session.user, session: c.session }, error: null };
  };
  sb.auth.getSession = async () => ({ data: { session: c.session }, error: null });
  sb.auth.getUser = async () => ({ data: { user: c.session ? c.session.user : null } });
  // Как GoTrue с ротацией: действует только последний выданный токен, а
  // поднятый сеанс выдаёт новый.
  sb.auth.setSession = async ({ access_token: at, refresh_token: rt }) => {
    const uid = Object.keys(c.valid).find((id) => c.valid[id] === rt);
    c.calls.push(['setSession', rt]);
    if (!uid || c.fail[uid]) return { data: { session: null, user: null }, error: { name: 'AuthApiError', code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used', status: 400 } };
    c.session = issue(byId[uid]);
    return { data: { session: c.session, user: c.session.user }, error: null };
  };
  sb.auth.refreshSession = async ({ refresh_token: rt }) => sb.auth.setSession({ access_token: '', refresh_token: rt });
  sb.auth._removeSession = async () => { c.calls.push(['dropLocal']); c.session = null; };
  sb.auth.signOut = async (opts) => {
    c.calls.push(['signOut', (opts && opts.scope) || 'global']);
    if (c.session) delete c.valid[c.session.user.id];
    c.session = null;
    return { error: null };
  };
  const consent = { terms_version: Core.TERMS_VERSION, age_confirmed: true };
  // Облако пустое: ни слепков, ни журнала правок (changes), ни sync_state.
  // Запрос — цепочка, как у supabase-js; ответ отдаёт await (then).
  // Вставка в журнал отвечает строками с seq — так приложение узнаёт, что
  // правки приняты.
  c.seq = c.seq || 0;
  sb.from = (table) => {
    const q = {
      select() { return q; },
      update() { return q; },
      eq(_k, v) { q.v = v; return q; },
      gt() { return q; },
      order() { return q; },
      limit() { return q; },
      async maybeSingle() {
        if (table === 'profiles') return { data: byId[q.v] ? { name: byId[q.v].name, ...consent } : null, error: null };
        return { data: null, error: null };
      },
      upsert(row) {
        c.calls.push(['upsert', table, Array.isArray(row) ? row.length : row.user_id || row.id]);
        q.rows = Array.isArray(row) ? row : null;
        return q;
      },
      insert(row) { c.calls.push(['insert', table, row.user_id]); return q; },
      then(resolve, reject) {
        const data = table === 'changes' && q.rows
          ? q.rows.map((r) => ({ ...r, seq: ++c.seq, created_at: new Date().toISOString() }))
          : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  sb.channel = () => ({ on() { return this; }, subscribe() { return this; } });
  sb.removeChannel = () => {};
}, users);

const cloudCalls = (page) => page.evaluate(() => window.__cloud.calls);
const accountsStored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lancible:accounts') || 'null'));
const titlesIn = (page, key) => page.evaluate((k) => {
  const d = JSON.parse(localStorage.getItem(k) || 'null');
  return d ? (d.tasks || []).map((x) => x.title).sort() : null;
}, key);
const liveTitles = (page) => page.evaluate(() => state.tasks.map((x) => x.title).sort());

/** Задача в открытой области — сразу на диск. */
const addTask = (page, title) => page.evaluate(async (tt) => {
  if (!state.projects.length) state.projects.push({ id: `p-${tt}`, name: `Проект ${tt}` });
  state.tasks.push({ id: `t-${tt}`, projectId: state.projects[0].id, title: tt });
  migrate();
  render();
  savePending = true;
  await saveNow();
}, title);

async function start(page) {
  // К настоящей базе тест не ходит ни одним запросом.
  await page.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await fakeCloud(page, [A, B]);
}

async function signInVia(page, who) {
  await expect(page.locator('#auth-email')).toBeFocused();
  await page.locator('#auth-email').fill(who.email);
  await page.locator('#auth-password').fill(who.password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-backdrop')).toBeHidden();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(who.id);
}

const openAccountSection = (page) => page.evaluate(() => openSettings('account'));

/** Гость с задачей, потом A, потом B — общее начало нескольких тестов. */
async function twoAccounts(page) {
  await start(page);
  await addTask(page, 'Задача гостя');
  await page.locator('#account-btn').click(); // аккаунтов нет — сразу вход
  await expect(page.locator('#auth-add-note'), 'гостю говорят, что его данные останутся').toHaveText('Данные без аккаунта останутся в записи «Без аккаунта».');
  await signInVia(page, A);
  // Первый вход после работы без аккаунта — вопрос о переносе; здесь —
  // «Оставить отдельно» (перенос — свои тесты ниже).
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-cancel').click();
  await addTask(page, 'Задача Анны');
  await openAccountSection(page);
  await page.locator('#settings-account-add').click();
  await expect(page.locator('#auth-title')).toHaveText('Добавить аккаунт');
  await expect(page.locator('#auth-add-note')).toHaveText('«Анна» останется в списке — вернуться можно в меню профиля.');
  await signInVia(page, B);
  await addTask(page, 'Задача Бориса');
}

test('два аккаунта: у каждого свои задачи и свой ключ, гость не пострадал', async ({ page }) => {
  await twoAccounts(page);
  expect(await liveTitles(page), 'у Бориса — только его задача').toEqual(['Задача Бориса']);
  expect(await titlesIn(page, 'lancible:data')).toEqual(['Задача гостя']);
  expect(await titlesIn(page, `lancible:data:${A.id}`)).toEqual(['Задача Анны']);
  expect(await titlesIn(page, `lancible:data:${B.id}`)).toEqual(['Задача Бориса']);
  const acc = await accountsStored(page);
  expect(acc.list.map((e) => e.uid)).toEqual([A.id, B.id]);
  expect(acc.current).toBe(B.id);
  expect(acc.list.map((e) => e.name)).toEqual(['Анна', 'Борис']);
  // Сеанс Анны лежит в списке — его последний действующий токен.
  const valid = await page.evaluate(() => window.__cloud.valid);
  expect(acc.list[0].refreshToken).toBe(valid[A.id]);
});

test('раздел «Аккаунт»: строка на аккаунт, галочка у текущего, «Без аккаунта», «Добавить аккаунт»', async ({ page }) => {
  await twoAccounts(page);
  await openAccountSection(page);
  const rows = page.locator('#settings-accounts > .srow');
  await expect(rows.locator('.srow-label')).toHaveText(['Анна', 'Борис', 'Без аккаунта', 'Добавить аккаунт']);
  await expect(page.locator('#settings-accounts .acc-row[aria-current="true"] .srow-label')).toHaveText('Борис');
  await expect(page.locator('#settings-accounts .acc-row[aria-current="true"] .srow-check')).toHaveCount(1);
  await expect(page.locator('#settings-accounts .srow-check'), 'галочка одна').toHaveCount(1);
  await expect(rows.nth(0).locator('.srow-value')).toHaveText(A.email);
  await expect(rows.nth(0).locator('.acc-avatar')).toHaveText('А');
  await expect(rows.nth(2).locator('.acc-avatar')).toHaveText('?');
  // Профиль, пароль, синхронизация и «Выйти» — для текущего, как и были.
  await expect(page.locator('#settings-account-card')).toBeVisible();
  await expect(page.locator('#settings-email-value')).toHaveText(B.email);
  await expect(page.locator('#settings-current-label')).toHaveText('Текущий аккаунт');
  // Цвет аватара — токеном палитры, а не строкой из кода.
  const bg = await rows.nth(0).locator('.acc-avatar').evaluate((n) => getComputedStyle(n).backgroundColor);
  const token = await page.evaluate((c) => {
    const probe = document.createElement('i');
    probe.style.background = `var(--avatar-c${c})`;
    document.body.append(probe);
    const v = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return v;
  }, await rows.nth(0).locator('.acc-avatar').getAttribute('data-c'));
  expect(bg).toBe(token);
});

test('меню профиля переключает, а при возврате идёт свежий refresh-токен', async ({ page }) => {
  await twoAccounts(page);
  await page.locator('#account-btn').click();
  const menu = page.locator('#ctx-menu');
  await expect(menu.locator('.ctx-item .ctx-label')).toHaveText(['Анна', 'Борис', 'Без аккаунта', 'Добавить аккаунт', 'Синхронизировать с аккаунтом', 'Выйти']);
  await expect(menu.locator('.ctx-item.sel .ctx-label').first()).toHaveText('Борис');
  const tokenA = (await accountsStored(page)).list[0].refreshToken;
  await menu.locator('.ctx-item', { hasText: 'Анна' }).click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  await expect(page.locator('#account-label')).toHaveText('Анна');
  const calls = await cloudCalls(page);
  expect(calls.filter((x) => x[0] === 'setSession').pop(), 'сеанс Анны поднят её токеном').toEqual(['setSession', tokenA]);
  expect(calls.some((x) => x[0] === 'signOut'), 'переключение не отзывает сеанс на сервере').toBe(false);
  // setSession выдал новый токен — он и записан, старый уже не годится.
  const rotated = (await accountsStored(page)).list[0].refreshToken;
  expect(rotated).not.toBe(tokenA);
  expect(rotated).toBe(await page.evaluate((id) => window.__cloud.valid[id], A.id));

  // Борис и обратно: Анна поднимается уже свежим токеном.
  await page.evaluate((id) => switchAccount(id), B.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(B.id);
  expect(await liveTitles(page)).toEqual(['Задача Бориса']);
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  expect((await cloudCalls(page)).filter((x) => x[0] === 'setSession').pop()).toEqual(['setSession', rotated]);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
});

test('«Без аккаунта» открывает данные гостя; переключение на того же — ничего', async ({ page }) => {
  await twoAccounts(page);
  const before = (await cloudCalls(page)).length;
  await page.evaluate((id) => switchAccount(id), B.id);
  expect((await cloudCalls(page)).length, 'тот же аккаунт — ни одного вызова').toBe(before);
  await openAccountSection(page);
  await page.locator('#settings-accounts .acc-row', { hasText: 'Без аккаунта' }).click();
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  expect(await page.evaluate(() => currentUser)).toBeNull();
  expect(await liveTitles(page)).toEqual(['Задача гостя']);
  await expect(page.locator('#account-label')).toHaveText('Войти');
  // Список на месте, текущим стал гость.
  const acc = await accountsStored(page);
  expect(acc.list.map((e) => e.uid)).toEqual([A.id, B.id]);
  expect(acc.current).toBeNull();
  await expect(page.locator('#settings-accounts .acc-row[aria-current="true"] .srow-label')).toHaveText('Без аккаунта');
});

test('сеанс не поднялся: аккаунт остаётся с пометкой, данные открыты без синхронизации', async ({ page }) => {
  await twoAccounts(page);
  await page.evaluate((id) => { window.__cloud.fail[id] = true; }, A.id);
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(A.id);
  expect(await page.evaluate(() => currentUser), 'сеанса нет — синхронизации нет').toBeNull();
  expect(await liveTitles(page), 'данные Анны открыты').toEqual(['Задача Анны']);
  await expect(page.locator('#toast')).toContainText('войдите заново');
  const entry = (await accountsStored(page)).list.find((e) => e.uid === A.id);
  expect(entry.needsSignIn).toBe(true);
  expect(entry.refreshToken, 'протухший токен не хранится').toBe('');
  await openAccountSection(page);
  await expect(page.locator('#settings-accounts .acc-row[aria-current="true"] .srow-sub')).toHaveText('Нужно войти заново');
  await expect(page.locator('#settings-relogin')).toBeVisible();
  await expect(page.locator('#settings-account-card')).toBeHidden();
  await expect(page.locator('#account-label')).toHaveText('Анна');
  // «Войти заново» — окно входа с почтой; вход тем же аккаунтом данные не трогает.
  await page.evaluate((id) => { delete window.__cloud.fail[id]; }, A.id);
  await page.locator('#settings-relogin-row').click();
  await expect(page.locator('#auth-email')).toHaveValue(A.email);
  await page.locator('#auth-password').fill(A.password);
  await page.locator('#auth-submit').click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  expect((await accountsStored(page)).list.find((e) => e.uid === A.id).needsSignIn).toBe(false);
});

test('«Выйти» убирает аккаунт из списка и открывает следующего; копия данных остаётся', async ({ page }) => {
  await twoAccounts(page);
  await openAccountSection(page);
  await page.locator('#settings-signout-row').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  const acc = await accountsStored(page);
  expect(acc.list.map((e) => e.uid)).toEqual([A.id]);
  expect(acc.current).toBe(A.id);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  expect(await titlesIn(page, `lancible:data:${B.id}`), 'копия Бориса на устройстве').toEqual(['Задача Бориса']);
  // Сеанс уходящего снят только на этом устройстве.
  expect((await cloudCalls(page)).filter((x) => x[0] === 'signOut')).toEqual([['signOut', 'local']]);
  await expect(page.locator('#settings-accounts .acc-row .srow-label')).toHaveText(['Анна', 'Без аккаунта']);

  // Последний аккаунт вышел — открыт гость.
  await page.locator('#settings-signout-row').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  expect(await liveTitles(page)).toEqual(['Задача гостя']);
  expect((await accountsStored(page)).list).toEqual([]);
});

test('«Удалить данные аккаунта с устройства» стирает ключ: вышедшего и текущего', async ({ page }) => {
  await twoAccounts(page);
  // Борис вышел — его копия осталась, подпись берётся из неё.
  await openAccountSection(page);
  await page.locator('#settings-signout-row').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);

  await page.evaluate(() => openSettings('data'));
  await expect(page.locator('#settings-device-label')).toHaveText('На этом устройстве');
  await page.locator('#settings-forget-row').click();
  const menu = page.locator('#ctx-menu');
  await expect(menu.locator('.ctx-label')).toHaveText(['Анна', 'Борис']);
  await expect(menu.locator('.ctx-item.sel .ctx-label')).toHaveText('Анна');
  await menu.locator('.ctx-item', { hasText: 'Борис' }).click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-text')).toContainText('Борис');
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${B.id}`)).toBeNull();
  expect(await page.evaluate(() => currentUser && currentUser.id), 'текущий не тронут').toBe(A.id);

  // Текущий: копия стёрта, аккаунт ушёл из списка, открыт гость.
  await page.locator('#settings-forget-row').click();
  await menu.locator('.ctx-item', { hasText: 'Анна' }).click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${A.id}`)).toBeNull();
  expect(await page.evaluate(() => currentUser)).toBeNull();
  expect((await accountsStored(page)).list).toEqual([]);
  expect(await liveTitles(page)).toEqual(['Задача гостя']);
  expect(await titlesIn(page, 'lancible:data'), 'гость цел').toEqual(['Задача гостя']);
  await expect(page.locator('#settings-device')).toBeHidden();
});

test('«Удалить данные с устройства» у текущего при втором аккаунте — открывается следующий, как после «Выйти»', async ({ page }) => {
  // Так же делает телефон (useAuthStore.forgetDeviceData): гость — только
  // если других аккаунтов с живым сеансом нет.
  await twoAccounts(page);
  const current = await page.evaluate(() => currentUser && currentUser.id);
  const other = current === A.id ? B : A;
  const currentName = current === A.id ? 'Анна' : 'Борис';
  await page.evaluate(() => openSettings('data'));
  await page.locator('#settings-forget-row').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: currentName }).click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(other.id);
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(other.id);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${current}`)).toBeNull();
  expect((await accountsStored(page)).list.map((e) => e.uid)).toEqual([other.id]);
});

test('удаление аккаунта на сервере: аккаунт уходит из списка, копия его данных на устройстве остаётся', async ({ page }) => {
  // Так обещает текст подтверждения (account.delete_confirm: «Копия на этом
  // устройстве останется») и landing/delete-account.html, так делает и
  // телефон. Стереть копию — отдельное действие в «Данных».
  await twoAccounts(page);
  await page.evaluate(() => {
    sb.storage.from = () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) });
    Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async () => ({ data: { deleted: true }, error: null }) } });
  });
  await page.evaluate(() => openSettings('data'));
  await page.locator('#settings-delete-row').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#toast')).toHaveText('Аккаунт удалён');
  expect((await accountsStored(page)).list.map((e) => e.uid)).toEqual([A.id]);
  // Открыт следующий — Анна, её данные на месте; гость не тронут.
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  expect(await titlesIn(page, 'lancible:data')).toEqual(['Задача гостя']);
  // Копия Бориса — на месте и видна в «Данных» как копия на устройстве.
  expect(await titlesIn(page, `lancible:data:${B.id}`), 'копия удалённого аккаунта осталась').toEqual(['Задача Бориса']);
  await page.evaluate(() => openSettings('data'));
  await expect(page.locator('#settings-forget-row')).toBeVisible();
  await page.locator('#settings-forget-row').click();
  await expect(page.locator('#ctx-menu .ctx-label')).toHaveText(['Анна', 'Борис']);
  // Стереть её — то самое отдельное действие.
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Борис' }).click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${B.id}`)).toBeNull();
});

test('таймер — часть данных аккаунта: переключение его не трогает', async ({ page }) => {
  await twoAccounts(page);
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  const startedAt = await page.evaluate(() => { startTimer(state.tasks[0].id); return state.activeTimer.startedAt; });
  await page.evaluate((id) => switchAccount(id), B.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(B.id);
  expect(await page.evaluate(() => state.activeTimer), 'у Бориса таймер не идёт').toBeNull();
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  const timer = await page.evaluate(() => state.activeTimer);
  expect(timer && timer.startedAt, 'таймер Анны идёт с той же минуты').toBe(startedAt);
  expect(await page.evaluate(() => state.tasks[0].sessions || []), 'и не записан как прерванный').toEqual([]);
});

test('старт: текущий аккаунт без сеанса — его данные открыты, строка просит войти заново', async ({ page }) => {
  await page.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await page.goto('/index.html');
  await page.evaluate(({ a }) => {
    // Прежняя страница при уходе сохраняет своё (beforeunload) — здесь это
    // пустой гость поверх заготовленного.
    scopeSwitching = true;
    localStorage.clear();
    // Токен, который клиент не разберёт: сеанс не поднимется без единого запроса.
    localStorage.setItem('lancible:accounts', JSON.stringify({ list: [{ uid: a.id, email: a.email, name: a.name, accessToken: 'битый', refreshToken: 'rt-old', lastUsedAt: 1 }], current: a.id }));
    localStorage.setItem(`lancible:data:${a.id}`, JSON.stringify({ projects: [{ id: 'p1', name: 'Проект Анны' }], tasks: [{ id: 't1', projectId: 'p1', title: 'Задача Анны' }], activeTimer: null }));
    localStorage.setItem('lancible:data', JSON.stringify({ projects: [{ id: 'pg', name: 'Гостевой' }], tasks: [{ id: 'tg', projectId: 'pg', title: 'Задача гостя' }], activeTimer: null }));
  }, { a: A });
  await page.reload();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  expect(await page.evaluate(() => scopeUid)).toBe(A.id);
  expect(await page.evaluate(() => currentUser)).toBeNull();
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  await expect(page.locator('#account-label')).toHaveText('Анна');
  const entry = (await accountsStored(page)).list[0];
  expect(entry.needsSignIn).toBe(true);
  expect(await titlesIn(page, 'lancible:data'), 'гостевые данные не тронуты').toEqual(['Задача гостя']);
});

test('гость → вход → «Перенести»: задачи в аккаунте, «Без аккаунта» пуст и исчез из списка', async ({ page }) => {
  await start(page);
  await addTask(page, 'Задача гостя');
  const guestProject = await page.evaluate(() => state.projects[0].id);
  const guestStatuses = await page.evaluate((pid) => state.statuses.filter((x) => x.projectId === pid).map((x) => x.id).sort(), guestProject);
  expect(guestStatuses.length, 'у проекта гостя свои статусы').toBeGreaterThan(0);
  await page.locator('#account-btn').click();
  await signInVia(page, A);
  await expect(page.locator('#confirm-title')).toHaveText('Перенести данные?');
  await expect(page.locator('#confirm-ok')).toHaveText('Перенести');
  await expect(page.locator('#confirm-cancel')).toHaveText('Оставить отдельно');
  await page.locator('#confirm-ok').click();
  await expect.poll(() => liveTitles(page)).toEqual(['Задача гостя']);
  // Перенос, а не копия: идентификаторы те же, статусы приехали с проектом.
  expect(await page.evaluate(() => state.tasks[0].id)).toBe('t-Задача гостя');
  expect(await page.evaluate((pid) => state.statuses.filter((x) => x.projectId === pid).map((x) => x.id).sort(), guestProject)).toEqual(guestStatuses);
  await expect.poll(() => titlesIn(page, `lancible:data:${A.id}`)).toEqual(['Задача гостя']);
  expect(await titlesIn(page, 'lancible:data'), 'у гостя пусто').toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lancible:data')).statuses)).toEqual([]);
  // Дальше — обычная синхронизация: облако пусто, объединённое ушло туда.
  await expect.poll(async () => (await cloudCalls(page)).some((x) => x[0] === 'upsert' && x[1] === 'sync_state' && x[2] === A.id)).toBe(true);
  await openAccountSection(page);
  await expect(page.locator('#settings-accounts > .srow .srow-label'), '«Без аккаунта» исчез').toHaveText(['Анна', 'Добавить аккаунт']);
  await page.evaluate(() => openSettings('data'));
  await expect(page.locator('#settings-move-guest-row')).toBeHidden();
});

test('«Оставить отдельно» — аккаунт пуст, данные гостя на месте; перенос потом — из «Данных»', async ({ page }) => {
  await start(page);
  await addTask(page, 'Задача гостя');
  await page.locator('#account-btn').click();
  await signInVia(page, A);
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#confirm-backdrop')).toBeHidden();
  expect(await liveTitles(page)).toEqual([]);
  expect(await titlesIn(page, 'lancible:data')).toEqual(['Задача гостя']);
  await addTask(page, 'Задача Анны');
  await openAccountSection(page);
  await expect(page.locator('#settings-accounts > .srow .srow-label')).toHaveText(['Анна', 'Без аккаунта', 'Добавить аккаунт']);

  // Вручную: строка в «Данных», то же подтверждение, объединение без дублей.
  await page.evaluate(() => openSettings('data'));
  const row = page.locator('#settings-move-guest-row');
  await expect(row).toBeVisible();
  await expect(row.locator('.srow-label')).toHaveText('Перенести данные без аккаунта в текущий аккаунт');
  await row.click();
  await expect(page.locator('#confirm-title')).toHaveText('Перенести данные?');
  await page.locator('#confirm-ok').click();
  await expect.poll(() => liveTitles(page)).toEqual(['Задача Анны', 'Задача гостя']);
  expect(await page.evaluate(() => new Set(state.tasks.map((x) => x.id)).size === state.tasks.length)).toBe(true);
  await expect(page.locator('#toast')).toHaveText('Данные перенесены в аккаунт');
  await expect(row).toBeHidden();
  expect(await titlesIn(page, 'lancible:data')).toEqual([]);
  await expect.poll(() => titlesIn(page, `lancible:data:${A.id}`)).toEqual(['Задача Анны', 'Задача гостя']);
});

test('переключение не шлёт /logout: ни через _removeSession, ни через резерв без него', async ({ page }) => {
  const logout = [];
  page.on('request', (r) => { if (/\/auth\/v1\/logout/.test(r.url())) logout.push(r.url()); });
  await twoAccounts(page);
  // Настоящий _removeSession клиента (подмена из fakeCloud снята).
  await page.evaluate(() => { delete sb.auth._removeSession; });
  expect(await page.evaluate(() => typeof sb.auth._removeSession)).toBe('function');
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  // Метода нет (другая версия supabase-js) — резерв стирает сеанс из
  // хранилища клиента его же ключом.
  const key = await page.evaluate(() => {
    sb.auth._removeSession = undefined;
    localStorage.setItem(sb.auth.storageKey, '{"access_token":"x"}');
    localStorage.setItem(`${sb.auth.storageKey}-user`, '{}');
    return sb.auth.storageKey;
  });
  expect(key).toMatch(/^sb-[a-z0-9]+-auth-token$/);
  await page.evaluate(() => switchAccount(null));
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  expect(await page.evaluate((k) => [localStorage.getItem(k), localStorage.getItem(`${k}-user`)], key)).toEqual([null, null]);
  await page.waitForTimeout(300);
  expect(logout, 'запросов /logout не было').toEqual([]);
  expect((await cloudCalls(page)).filter((x) => x[0] === 'signOut'), 'signOut не звали').toEqual([]);
  // Сторож зрячий: такой запрос он бы увидел.
  await page.evaluate(() => fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method: 'POST' }).catch(() => {}));
  await expect.poll(() => logout.length).toBe(1);
});

test('строки — на четырёх языках', async ({ page }) => {
  await twoAccounts(page);
  const S = {
    en: ['Accounts', 'No account', 'Add account', 'On this device', 'Delete account data from this device'],
    uk: ['Акаунти', 'Без акаунта', 'Додати акаунт', 'На цьому пристрої', 'Видалити дані акаунта з пристрою'],
    kk: ['Аккаунттар', 'Аккаунтсыз', 'Аккаунт қосу', 'Осы құрылғыда', 'Аккаунт деректерін құрылғыдан жою'],
    ru: ['Аккаунты', 'Без аккаунта', 'Добавить аккаунт', 'На этом устройстве', 'Удалить данные аккаунта с устройства'],
  };
  for (const [lang, s] of Object.entries(S)) {
    await page.evaluate((l) => { setLang(l); openSettings('account'); }, lang);
    await expect(page.locator('#settings-accounts-label')).toHaveText(s[0]);
    await expect(page.locator('#settings-accounts .acc-row').last().locator('.srow-label')).toHaveText(s[1]);
    await expect(page.locator('#settings-account-add .srow-label')).toHaveText(s[2]);
    await page.evaluate(() => openSettings('data'));
    await expect(page.locator('#settings-device-label')).toHaveText(s[3]);
    await expect(page.locator('#settings-forget-row .srow-label')).toHaveText(s[4]);
  }
});

for (const width of [1280, 375]) {
  test(`${width}: строки аккаунтов не шире группы, страница не уезжает вбок`, async ({ page }) => {
    await twoAccounts(page);
    await page.setViewportSize({ width, height: 860 });
    await page.evaluate(() => {
      accounts = Core.upsertAccount(accounts, { uid: 'cccccccc-0000-4000-8000-000000000003', email: 'very.long.address.for.testing@example.com', name: 'Очень длинное имя пользователя аккаунта', refreshToken: 'x' });
      openSettings('account');
    });
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#settings-accounts .srow')];
      return {
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        wide: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).map((r) => r.textContent),
      };
    });
    expect(m.docW).toBeLessThanOrEqual(m.winW);
    expect(m.wide).toEqual([]);
  });
}

// --- Круг 17 октября: сеанс неактивного, две вкладки, картинки гостя ----------

/** Токен доступа вида JWT: supabase-js читает из него срок (подпись не
 *  проверяет — это дело сервера, а сервера здесь нет). */
const fakeJwt = (sub, ttlSec) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + ttlSec })}.c2ln`;
};

/** Сеанс Анны в списке — с настоящим по виду токеном: отдельный клиент
 *  supabase-js поднимет его у «сервера» (GET /user) и отзовёт (POST /logout). */
async function annaWithLiveToken(page) {
  const jwt = fakeJwt(A.id, 3600);
  await page.evaluate(({ uid, at }) => {
    accounts = Core.upsertAccount(accounts, { uid, accessToken: at, refreshToken: 'rt-anna-live' });
    return saveAccounts();
  }, { uid: A.id, at: jwt });
  return jwt;
}

async function forgetVia(page, name) {
  await page.evaluate(() => openSettings('data'));
  await page.locator('#settings-forget-row').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: name }).click();
  await page.locator('#confirm-ok').click();
}

test('«Удалить данные с устройства» у неактивного: ровно один /logout его токеном, текущий сеанс не тронут', async ({ page }) => {
  await twoAccounts(page); // открыт Борис, Анна — в списке
  const jwt = await annaWithLiveToken(page);
  const seen = [];
  await page.route(/\/auth\/v1\/(user|logout|token)/, (route) => {
    const r = route.request();
    const u = new URL(r.url());
    seen.push({ path: u.pathname, scope: u.searchParams.get('scope'), method: r.method(), auth: r.headers().authorization || '' });
    if (u.pathname.endsWith('/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: A.id, aud: 'authenticated', role: 'authenticated', email: A.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const before = await page.evaluate(() => ({ session: window.__cloud.session, calls: window.__cloud.calls.length }));
  await forgetVia(page, 'Анна');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${A.id}`)).toBeNull();
  await expect.poll(() => seen.filter((x) => x.path.endsWith('/logout')).length).toBe(1);
  await page.waitForTimeout(300);
  const logout = seen.filter((x) => x.path.endsWith('/logout'));
  expect(logout, 'ровно один /logout').toHaveLength(1);
  expect(logout[0]).toMatchObject({ method: 'POST', scope: 'local', auth: `Bearer ${jwt}` });
  expect(seen.filter((x) => x.path.endsWith('/token')), 'токен жив — обновлять не пришлось').toEqual([]);
  // Сеанс Бориса — в основном клиенте — не тронут: ни signOut, ни снятия.
  const after = await page.evaluate(() => ({ session: window.__cloud.session, calls: window.__cloud.calls.slice(), user: currentUser && currentUser.id }));
  expect(after.session).toEqual(before.session);
  expect(after.calls.slice(before.calls).filter((c) => c[0] === 'signOut' || c[0] === 'dropLocal' || c[0] === 'setSession')).toEqual([]);
  expect(after.user).toBe(B.id);
  expect((await accountsStored(page)).list.map((e) => e.uid)).toEqual([B.id]);
  expect(await titlesIn(page, `lancible:data:${B.id}`)).toEqual(['Задача Бориса']);
});

test('«Удалить данные с устройства» у неактивного без сети: копия стёрта всё равно', async ({ page }) => {
  await twoAccounts(page);
  await annaWithLiveToken(page);
  let tried = 0;
  await page.route(/\/auth\/v1\//, (route) => { tried += 1; return route.abort(); });
  await forgetVia(page, 'Анна');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${A.id}`)).toBeNull();
  await expect(page.locator('#toast')).toHaveText('Данные удалены с устройства');
  await expect.poll(() => tried, 'отозвать пытались').toBeGreaterThan(0);
  expect((await accountsStored(page)).list.map((e) => e.uid)).toEqual([B.id]);
  expect(await page.evaluate(() => currentUser && currentUser.id)).toBe(B.id);
});

test('две вкладки: другая открыла другой аккаунт — тост «Обновить», в чужую область и в облако ничего не уходит', async ({ page }) => {
  await twoAccounts(page); // вкладка 1: Борис
  const tab2 = await page.context().newPage();
  await tab2.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await tab2.setViewportSize({ width: 1280, height: 860 });
  await tab2.goto('/index.html');
  await expect(tab2.locator('#shell')).toBeVisible();
  await expect(tab2.locator('#app-skeleton')).toHaveCount(0);
  await expect.poll(() => tab2.evaluate(() => scopeUid)).toBe(B.id);
  // Вторая вкладка открылась тем же Борисом и переписала список (пометка
  // сеанса) — текущий тот же, первой вкладке тревожиться не о чем.
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => scopeStale)).toBe(false);
  await expect(page.locator('#toast.has-action')).toHaveCount(0);

  // Во второй вкладке — Анна.
  await fakeCloud(tab2, [A, B]);
  await tab2.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => tab2.evaluate(() => scopeUid)).toBe(A.id);

  const toastEl = page.locator('#toast');
  await expect(toastEl).toBeVisible();
  await expect(toastEl.locator('.toast-text')).toHaveText('Аккаунт сменён в другой вкладке');
  await expect(toastEl.locator('button.toast-action')).toHaveText('Обновить');
  expect(await page.evaluate(() => scopeUid), 'область вкладки та же').toBe(B.id);

  // Правка здесь ложится в свою область (Бориса), не в Аннину; в облако — ни
  // одного запроса; список аккаунтов вкладка не переписывает.
  const calls0 = (await cloudCalls(page)).length;
  const annaBefore = await titlesIn(page, `lancible:data:${A.id}`);
  await addTask(page, 'После смены');
  await page.waitForTimeout(400);
  expect(await titlesIn(page, `lancible:data:${B.id}`)).toEqual(['Задача Бориса', 'После смены'].sort());
  expect(await titlesIn(page, `lancible:data:${A.id}`)).toEqual(annaBefore);
  expect((await cloudCalls(page)).slice(calls0), 'в облако — ничего').toEqual([]);
  expect((await accountsStored(page)).current, 'выбор другой вкладки цел').toBe(A.id);
  expect(await page.evaluate(() => syncLive())).toBe(false);
  // Переключение из отставшей вкладки не идёт: снова тост, сеанс не тронут.
  await page.evaluate(() => toast('другое'));
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect(toastEl.locator('.toast-text')).toHaveText('Аккаунт сменён в другой вкладке');
  expect(await page.evaluate(() => scopeUid)).toBe(B.id);
  expect((await cloudCalls(page)).slice(calls0).filter((c) => c[0] === 'setSession' || c[0] === 'dropLocal')).toEqual([]);
  // Обычный тост поверх висящего гаснет и уступает место ему снова.
  await page.evaluate(() => toast('Короткий'));
  await expect(toastEl).toHaveText('Короткий');
  await expect(toastEl.locator('.toast-text')).toHaveText('Аккаунт сменён в другой вкладке', { timeout: 6000 });

  // «Обновить» — перезагрузка: открыт тот, кто текущий в списке (Анна);
  // правка, сделанная до неё, лежит в области Бориса.
  await Promise.all([page.waitForEvent('load'), toastEl.locator('button.toast-action').click()]);
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(A.id);
  expect(await page.evaluate(() => scopeStale)).toBe(false);
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
  expect(await titlesIn(page, `lancible:data:${B.id}`)).toContain('После смены');
  await tab2.close();
});

test('перенос «Без аккаунта»: гостевые картинки заметок переходят аккаунту; «Оставить отдельно» — остаются гостевыми', async ({ page }) => {
  const ownerOf = (p, id) => p.evaluate((key) => new Promise((resolve) => {
    const req = indexedDB.open('lancible-assets', 1);
    req.onsuccess = () => {
      const get = req.result.transaction('blobs', 'readonly').objectStore('blobs').get(key);
      get.onsuccess = () => resolve(get.result ? (get.result.owner === undefined ? 'нет поля' : get.result.owner) : 'нет записи');
      get.onerror = () => resolve('ошибка');
    };
    req.onerror = () => resolve('ошибка');
  }), id);
  const putImage = (p) => p.evaluate(async () => (await editorAssets.put(new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))).slice(6));

  await start(page);
  await addTask(page, 'Задача гостя');
  const guestImg = await putImage(page);
  expect(await ownerOf(page, guestImg), 'вставлена без аккаунта').toBeNull();
  await page.locator('#account-btn').click();
  await signInVia(page, A);
  await page.locator('#confirm-ok').click(); // «Перенести»
  await expect.poll(() => liveTitles(page)).toEqual(['Задача гостя']);
  await expect.poll(() => ownerOf(page, guestImg)).toBe(A.id);
  // Новая картинка открытого аккаунта — сразу его.
  expect(await ownerOf(page, await putImage(page))).toBe(A.id);

  // Снова гость, потом Борис с «Оставить отдельно»: картинка гостя Борису не
  // достаётся.
  await page.evaluate(() => switchAccount(null));
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  await addTask(page, 'Ещё гость');
  const keptImg = await putImage(page);
  expect(await ownerOf(page, keptImg)).toBeNull();
  await openAccountSection(page);
  await page.locator('#settings-account-add').click();
  await signInVia(page, B);
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-cancel').click();
  await page.waitForTimeout(200);
  expect(await ownerOf(page, keptImg)).toBeNull();
});

// --- Круг 19 октября: чужой сеанс, «Удалить данные с устройства», очередь смен -

/** Счётчики действий от имени вошедшего: удаление (папка картинок и функция
 *  delete-account), пароль (updateUser), имя (update профиля), отзыв
 *  (insert в feedback уже пишет fakeCloud), агент (запросы к ai-chat). */
async function watchAccountActions(page) {
  const ai = [];
  await page.route('**/functions/v1/ai-chat', (route) => { ai.push(route.request().url()); return route.fulfill({ status: 500, body: '{}' }); });
  await page.evaluate(() => {
    const c = window.__cloud;
    sb.storage.from = (bucket) => ({
      list: async () => { c.calls.push(['list', bucket]); return { data: [], error: null }; },
      remove: async () => ({ data: [], error: null }),
      upload: async () => ({ data: {}, error: null }),
    });
    Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async (name) => { c.calls.push(['invoke', name]); return { data: { deleted: true }, error: null }; } } });
    sb.auth.updateUser = async () => { c.calls.push(['updateUser']); return { data: {}, error: null }; };
    const from = sb.from;
    sb.from = (table) => {
      const q = from(table);
      const up = q.update;
      q.update = (row) => { c.calls.push(['update', table, row && row.name]); return up.call(q, row); };
      return q;
    };
  });
  return ai;
}
const STALE = 'Аккаунт сменён в другой вкладке';
const actionsSince = async (page, n) => (await cloudCalls(page)).slice(n)
  .filter((c) => ['list', 'invoke', 'updateUser', 'update', 'signIn'].includes(c[0]) || (c[0] === 'insert' && c[1] === 'feedback'));

test('отставшая вкладка: удаление аккаунта, пароль, имя, вход, агент и отзыв — отказ с «Обновить», функция удаления не зовётся', async ({ page }) => {
  await twoAccounts(page); // вкладка 1: Борис
  const tab2 = await page.context().newPage();
  await tab2.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await tab2.setViewportSize({ width: 1280, height: 860 });
  await tab2.goto('/index.html');
  await expect(tab2.locator('#app-skeleton')).toHaveCount(0);
  await fakeCloud(tab2, [A, B]);
  await tab2.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => tab2.evaluate(() => scopeUid)).toBe(A.id);
  await expect.poll(() => page.evaluate(() => scopeStale)).toBe(true);
  // Сеанс в общем хранилище теперь Аннин — так он и выглядит из первой вкладки.
  await page.evaluate((a) => { window.__cloud.session = { access_token: 'at-anna', refresh_token: 'rt-anna', user: { id: a.id, email: a.email } }; }, A);
  const ai = await watchAccountActions(page);
  const n0 = (await cloudCalls(page)).length;
  const toastText = page.locator('#toast .toast-text');
  expect(await page.evaluate(() => currentUser && currentUser.id), 'на экране по-прежнему Борис').toBe(B.id);

  // «Удалить аккаунт»: строка видна (вкладка не знает, что её аккаунт не
  // текущий), но подтверждения нет — сразу тост.
  await page.evaluate(() => openSettings('data'));
  await page.evaluate(() => toast('—'));
  await page.locator('#settings-delete-row').click();
  await expect(toastText).toHaveText(STALE);
  await expect(page.locator('#confirm-backdrop')).toBeHidden();

  // «Пароль» и «Имя» — окно ввода не открывается.
  await page.evaluate(() => openSettings('account'));
  for (const row of ['#settings-password-row', '#settings-name-row']) {
    await page.evaluate(() => toast('—'));
    await page.locator(row).click();
    await expect(toastText).toHaveText(STALE);
    await expect(page.locator('#modal-backdrop')).toBeHidden();
  }

  // Вход: окно не открывается; окно, открытое раньше, не входит.
  await page.evaluate(() => toast('—'));
  await page.evaluate(() => openAuthModal('signin'));
  await expect(toastText).toHaveText(STALE);
  await expect(page.locator('#auth-backdrop')).toBeHidden();
  await page.evaluate((a) => {
    el.authBackdrop.hidden = false;
    setAuthMode('signin');
    el.authEmail.value = a.email;
    el.authPassword.value = a.password;
    return handleAuthSubmit();
  }, A);
  await page.evaluate(() => closeAuthModal());

  // Агент и отзыв.
  await page.evaluate(() => toast('—'));
  await page.evaluate(() => aiSend('Сколько я наработал?'));
  await expect(toastText).toHaveText(STALE);
  await page.evaluate(() => toast('—'));
  await page.evaluate(() => { el.fbText.value = 'Отзыв из отставшей вкладки'; return sendFeedback(); });
  await expect(toastText).toHaveText(STALE);
  expect(await page.evaluate(() => el.fbText.value), 'текст отзыва остался в поле').toBe('Отзыв из отставшей вкладки');

  await page.waitForTimeout(300);
  expect(await actionsSince(page, n0), 'ни одного действия от чужого сеанса').toEqual([]);
  expect(ai, 'агент не звался').toEqual([]);
  expect(await page.evaluate(() => currentUser && currentUser.id)).toBe(B.id);
  expect((await accountsStored(page)).current, 'выбор другой вкладки цел').toBe(A.id);
  await tab2.close();
});

test('сеанс в хранилище — не того, кто на экране: удаление, пароль, имя, агент и отзыв отказывают; свой сеанс — снова можно', async ({ page }) => {
  // Событие о списке не пришло (или его не было: вход в другой вкладке
  // подменяет сеанс, не трогая списка) — вкладка не отстала, но сеанс чужой.
  await twoAccounts(page); // открыт Борис
  const ai = await watchAccountActions(page);
  const own = await page.evaluate(() => window.__cloud.session);
  await page.evaluate((a) => { window.__cloud.session = { access_token: 'at-anna', refresh_token: 'rt-anna', user: { id: a.id, email: a.email } }; }, A);
  expect(await page.evaluate(() => scopeStale)).toBe(false);
  const n0 = (await cloudCalls(page)).length;
  const toastText = page.locator('#toast .toast-text');

  // Удаление: подтверждение есть, а после него — отказ, функция не зовётся.
  await page.evaluate(() => openSettings('data'));
  await page.locator('#settings-delete-row').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-ok').click();
  await expect(toastText).toHaveText(STALE);
  expect(await page.evaluate(() => currentUser && currentUser.id), 'аккаунт на экране не тронут').toBe(B.id);

  // Пароль и имя: ввели — отказ.
  await page.evaluate(() => openSettings('account'));
  await page.locator('#settings-password-row').click();
  await page.locator('#modal-input').fill('новый-пароль');
  await page.locator('#modal-input2').fill('новый-пароль');
  await page.evaluate(() => toast('—'));
  await page.locator('#modal-ok').click();
  await expect(toastText).toHaveText(STALE);
  await page.locator('#settings-name-row').click();
  await page.locator('#modal-input').fill('Не Борис');
  await page.evaluate(() => toast('—'));
  await page.locator('#modal-ok').click();
  await expect(toastText).toHaveText(STALE);
  expect(await page.evaluate(() => currentUser.name), 'имя не сменилось').toBe('Борис');

  // Агент: сообщение ушло в ленту, а вызов — нет; в ленте — почему.
  await page.locator('#ai-btn').click();
  await page.locator('#ai-input').fill('Привет');
  await page.evaluate(() => toast('—'));
  await page.locator('#ai-input').press('Enter');
  await expect(page.locator('.ai-error')).toContainText(STALE);
  await expect(toastText).toHaveText(STALE);

  // Отзыв.
  await page.evaluate(() => toast('—'));
  await page.evaluate(() => { el.fbText.value = 'Отзыв'; return sendFeedback(); });
  await expect(toastText).toHaveText(STALE);

  await page.waitForTimeout(300);
  expect(await actionsSince(page, n0), 'ни одного действия чужим сеансом').toEqual([]);
  expect(ai).toEqual([]);

  // Сеанс снова свой — имя меняется, как обычно.
  await page.evaluate((s) => { window.__cloud.session = s; }, own);
  await page.locator('#ai-close').click();
  await page.locator('#settings-name-row').click();
  await page.locator('#modal-input').fill('Борис Б.');
  await page.locator('#modal-ok').click();
  await expect(page.locator('#toast')).toHaveText('Имя обновлено');
  expect((await actionsSince(page, n0)).filter((c) => c[0] === 'update')).toEqual([['update', 'profiles', 'Борис Б.']]);
});

/** Записи хранилища картинок редактора напрямую: { id: owner }; 'old' —
 *  запись до 17 октября, без поля owner. */
const putAssets = (page, recs) => page.evaluate((list) => new Promise((resolve, reject) => {
  const req = indexedDB.open('lancible-assets', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('blobs');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const tx = req.result.transaction('blobs', 'readwrite');
    for (const [id, owner] of Object.entries(list)) {
      const rec = { blob: new Blob([id]), type: 'image/png', pending: owner !== 'old', name: `${id}.png` };
      if (owner !== 'old') rec.owner = owner;
      tx.objectStore('blobs').put(rec, id);
    }
    tx.oncomplete = () => { req.result.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}), recs);
const assetIds = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('lancible-assets', 1);
  req.onsuccess = () => {
    const get = req.result.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys();
    get.onsuccess = () => { req.result.close(); resolve(get.result.map(String).sort()); };
  };
}));
const aiKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lancible:ai:')).sort());

test('«Удалить данные с устройства» стирает и чаты агента, и картинки аккаунта; чужие и гостевые — на месте', async ({ page }) => {
  await twoAccounts(page); // открыт Борис, Анна — в списке
  await page.evaluate(({ a, b }) => {
    for (const id of [a, b]) {
      localStorage.setItem(`lancible:ai:${id}:chats`, JSON.stringify([{ id: `c-${id}`, title: 'План' }]));
      localStorage.setItem(`lancible:ai:${id}:chat:c-${id}`, JSON.stringify({ messages: [], items: [] }));
      localStorage.setItem(`lancible:ai:${id}:chat:orphan`, '{}');
      localStorage.setItem(`lancible:ai:${id}`, JSON.stringify({ messages: [] }));
    }
  }, { a: A.id, b: B.id });
  await putAssets(page, { 'img-anna': A.id, 'pdf-anna': A.id, 'img-guest': null, 'img-old': 'old' });
  // Картинка Бориса — вставлена в открытой области: лежит и в памяти
  // хранилища редактора, а не только в IndexedDB.
  const boris = await page.evaluate(async () => (await editorAssets.put(new File([new Uint8Array([7, 7, 7])], 'b.png', { type: 'image/png' }))).slice(6));
  // Что хранилище сейчас отдаёт — адрес для <img> (и кэш адресов вместе с ним).
  const shown = (ids) => page.evaluate((list) => Promise.all(list.map(async (id) => [id, !!(await editorAssets.resolve(`asset:${id}`)), !!(await editorAssets.blob(`asset:${id}`))])), ids);
  const all = ['img-anna', 'pdf-anna', boris, 'img-guest', 'img-old'];
  expect(await shown(all), 'до стирания хранилище отдаёт всё').toEqual(all.map((id) => [id, true, true]));
  const bKeys = await page.evaluate((b) => Object.keys(localStorage).filter((k) => k.startsWith(`lancible:ai:${b}`)).sort(), B.id);
  expect(bKeys.length, 'у Бориса — список, чат, его сирота и старая история').toBeGreaterThanOrEqual(4);

  // Неактивная Анна: её чаты и картинки ушли, Борисовы — на месте.
  await forgetVia(page, 'Анна');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `lancible:data:${A.id}`)).toBeNull();
  await expect.poll(() => aiKeys(page)).toEqual(bKeys);
  await expect.poll(() => assetIds(page)).toEqual([boris, 'img-guest', 'img-old'].sort());
  // Без перезагрузки: хранилище картинок Анны уже не отдаёт — ни адресом
  // из кэша, ни байтами.
  expect(await shown(all)).toEqual([['img-anna', false, false], ['pdf-anna', false, false], [boris, true, true], ['img-guest', true, true], ['img-old', true, true]]);

  // Текущий Борис: то же, и панель агента — уже гостя.
  await forgetVia(page, 'Борис');
  await expect.poll(() => page.evaluate(() => scopeUid)).toBe(null);
  await expect.poll(() => aiKeys(page)).toEqual([]);
  await expect.poll(() => assetIds(page), 'гостевые и записи до 17 октября не тронуты').toEqual(['img-guest', 'img-old']);
  expect(await shown([boris, 'img-guest', 'img-old']), 'картинки Бориса не живут и в памяти').toEqual([[boris, false, false], ['img-guest', true, true], ['img-old', true, true]]);
  expect(await page.evaluate(() => ai.uid)).toBeNull();
});

test('запасной путь без хранилища редактора: записи стираются в IndexedDB, а базы без картинок он не заводит', async ({ page }) => {
  await twoAccounts(page);
  const dbs = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(await dbs(), 'картинок не вставляли — базы нет').not.toContain('lancible-assets');
  expect(await page.evaluate((id) => forgetAssetsInDb(id), A.id)).toBe(0);
  expect(await dbs()).not.toContain('lancible-assets');
  // База есть — стирает записи аккаунта, остальные оставляет.
  await putAssets(page, { 'img-anna': A.id, 'img-guest': null });
  expect(await page.evaluate((id) => forgetAssetsInDb(id), A.id)).toBe(1);
  expect(await assetIds(page)).toEqual(['img-guest']);
  await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.deleteDatabase('lancible-assets'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); }));
  // Редактор потом заводит её как обычно — с хранилищем.
  await page.evaluate(() => editorAssets.put(new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })));
  expect(await assetIds(page)).toHaveLength(1);
});

test('ответ профиля, пришедший после переключения, не меняет вошедшего', async ({ page }) => {
  await twoAccounts(page); // открыт Борис
  // Тихий вход на старте ещё ждёт профиль Бориса — а человек уже ушёл в Анну.
  await page.evaluate(() => {
    const from = sb.from;
    window.__holdProfile = true;
    sb.from = (table) => {
      const q = from(table);
      if (table !== 'profiles' || !window.__holdProfile) return q;
      window.__holdProfile = false;
      const one = q.maybeSingle;
      q.maybeSingle = async () => { await new Promise((r) => { window.__releaseProfile = r; }); return one.call(q); };
      return q;
    };
    window.__late = afterSignedIn({ silent: true });
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseProfile)).toBe('function');
  await page.evaluate((id) => switchAccount(id), A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  await page.evaluate(async () => { window.__releaseProfile(); await window.__late; });
  expect(await page.evaluate(() => ({ user: currentUser && currentUser.id, scope: scopeUid })), 'опоздавший ответ про Бориса ничего не применил').toEqual({ user: A.id, scope: A.id });
  expect(await liveTitles(page)).toEqual(['Задача Анны']);
});

test('две смены области разом идут по очереди: данные и пачка журнала — той области, что открыта последней', async ({ page }) => {
  await twoAccounts(page); // открыт Борис
  const hadSync2 = await page.evaluate((k) => !!JSON.parse(localStorage.getItem(k)).sync2, `lancible:data:${B.id}`);
  const res = await page.evaluate(async ({ a, b }) => {
    // Первая загрузка отвечает медленно: без очереди вторая смена успела бы
    // открыть Бориса, а запоздавшие данные легли бы поверх с чужой пачкой.
    const load = window.api.load;
    let n = 0;
    window.api.load = async () => { const d = await load(); if (n++ === 0) await new Promise((r) => setTimeout(r, 200)); return d; };
    try { await Promise.all([openScope(a), openScope(b)]); } finally { window.api.load = load; }
    savePending = true;
    await saveNow();
    return { scope: scopeUid, titles: state.tasks.map((x) => x.title).sort(), bundle: !!syncBundle };
  }, { a: A.id, b: B.id });
  expect(res.scope).toBe(B.id);
  expect(res.titles).toEqual(['Задача Бориса']);
  expect(res.bundle, 'пачка журнала Бориса на месте').toBe(hadSync2);
  expect(await titlesIn(page, `lancible:data:${B.id}`)).toEqual(['Задача Бориса']);
  expect(await titlesIn(page, `lancible:data:${A.id}`)).toEqual(['Задача Анны']);
  expect(await page.evaluate((k) => !!JSON.parse(localStorage.getItem(k)).sync2, `lancible:data:${B.id}`), 'очередь, корзина и конфликты Бориса не потерялись').toBe(hadSync2);
});

test('соседняя вкладка стёрла аккаунт с устройства — эта не возвращает его в список', async ({ page }) => {
  await twoAccounts(page); // вкладка 1: Борис, Анна — в списке
  const tab2 = await page.context().newPage();
  await tab2.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await tab2.setViewportSize({ width: 1280, height: 860 });
  await tab2.goto('/index.html');
  await expect(tab2.locator('#app-skeleton')).toHaveCount(0);
  await expect.poll(() => tab2.evaluate(() => scopeUid)).toBe(B.id);
  await fakeCloud(tab2, [A, B]);
  await forgetVia(tab2, 'Анна');
  await expect.poll(() => tab2.evaluate((k) => localStorage.getItem(k), `lancible:data:${A.id}`)).toBeNull();
  // Первая вкладка подхватила список целиком, а не только «текущего».
  await expect.poll(() => page.evaluate(() => accounts.list.map((e) => e.uid))).toEqual([B.id]);
  expect(await page.evaluate(() => scopeStale), 'текущий тот же — вкладка не отстала').toBe(false);
  // Ближайшая запись отсюда (свежие токены) Анну не возвращает.
  await page.evaluate(() => saveAccounts());
  expect((await accountsStored(page)).list.map((e) => e.uid)).toEqual([B.id]);
  await page.evaluate(() => openSettings('account'));
  await expect(page.locator('#settings-accounts .acc-row .srow-label')).toHaveText(['Борис', 'Без аккаунта']);
  await tab2.close();
});

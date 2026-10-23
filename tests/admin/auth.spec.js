// Вход в админку: пароль, второй фактор, «не админ», нет сети, сеанс только
// во вкладке. Сеть подменена (mock.js): ни Supabase, ни функция admin
// настоящие здесь не нужны.
const { test, expect, SESSION_KEY, EMAIL, PASSWORD, GOOD_CODE, SECRET } = require('./mock');

async function login(page) {
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type="submit"]').click();
}

test('без сеанса — форма входа, разделы скрыты', async ({ page, open }) => {
  const backend = await open();
  await page.goto('/#/users');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  expect(backend.calls).toEqual([]);
});

test('неверный пароль — понятная строка, дальше не пускает', async ({ page, open }) => {
  await open();
  await page.goto('/');
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill('wrong');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('.auth-error')).toHaveText('Неверная почта или пароль.');
  await expect(page.locator('#app')).toBeHidden();
});

test('вход без второго фактора не пускает в разделы', async ({ page, open }) => {
  const backend = await open();
  await page.goto('/#/users');
  await login(page);
  // Фактор подключён — экран кода; разделы не видны, данных никто не просил.
  await expect(page.locator('#mfa-form')).toBeVisible();
  await expect(page.locator('#mfa-qr')).toHaveCount(0);
  await expect(page.locator('#app')).toBeHidden();
  expect(backend.calls.map((c) => c.action)).toEqual(['me']);
  // Адрес раздела ничего не меняет.
  await page.evaluate(() => { location.hash = '#/feedback'; });
  await expect(page.locator('#app')).toBeHidden();
  expect(backend.calls.map((c) => c.action)).toEqual(['me']);
  // Неверный код — остаёмся на экране кода.
  await page.locator('#mfa-code').fill('000000');
  await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page.locator('#mfa-form .auth-error')).toContainText('Код не подошёл');
  await expect(page.locator('#app')).toBeHidden();
  // Верный — пускает, и сразу в раздел из адреса.
  await page.locator('#mfa-code').fill(GOOD_CODE);
  await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.page-title')).toHaveText('Обратная связь');
  const verify = backend.authCalls.filter((c) => /\/verify$/.test(c.path));
  expect(verify.map((c) => c.body.code)).toEqual(['000000', GOOD_CODE]);
});

test('подключение TOTP: QR, секрет, код — и только потом разделы', async ({ page, open }) => {
  const backend = await open({
    // Брошенное прошлое подключение: снимается перед новым.
    factors: [{ id: 'factor-stale', factor_type: 'totp', status: 'unverified', friendly_name: 'Lancible Admin' }],
  });
  await page.goto('/');
  await login(page);
  await expect(page.locator('#mfa-qr')).toBeVisible();
  await expect(page.locator('#mfa-qr')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(page.locator('#mfa-secret')).toHaveText(SECRET);
  await expect(page.locator('#app')).toBeHidden();
  const del = backend.authCalls.find((c) => c.method === 'DELETE');
  expect(del && del.path).toBe('/factors/factor-stale');
  const enroll = backend.authCalls.find((c) => c.method === 'POST' && c.path === '/factors');
  expect(enroll.body).toMatchObject({ factor_type: 'totp' });

  await page.locator('#mfa-code').fill(GOOD_CODE);
  await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.page-title')).toHaveText('Обзор');
  await expect(page.locator('#rail-user')).toHaveText(EMAIL);
  const newId = backend.factors.find((f) => f.status === 'verified').id;
  expect(backend.authCalls.some((c) => c.path === `/factors/${newId}/challenge`)).toBe(true);
  expect(backend.authCalls.some((c) => c.path === `/factors/${newId}/verify`)).toBe(true);
});

test('не админ — «Этот аккаунт не админ», второй фактор не предлагается', async ({ page, open }) => {
  const backend = await open({ admin: false, factors: [] });
  await page.goto('/');
  await login(page);
  await expect(page.locator('.auth-title')).toHaveText('Этот аккаунт не админ');
  await expect(page.locator('#app')).toBeHidden();
  expect(backend.authCalls.some((c) => c.path === '/factors')).toBe(false);
  await page.locator('#forbidden-out').click();
  await expect(page.locator('#login-form')).toBeVisible();
});

test('функция ответила mfa посреди работы — экран второго фактора', async ({ page, open }) => {
  const backend = await open({ signedIn: 'aal2' });
  await page.goto('/#/overview');
  await expect(page.locator('.stats')).toBeVisible();
  backend.handlers.users = () => ({ __status: 403, body: { error: 'mfa' } });
  await page.locator('.rail-item[data-section="users"]').click();
  await expect(page.locator('#mfa-form')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});

test('нет сети — понятная строка и «Повторить»', async ({ page, open }) => {
  const backend = await open({ signedIn: 'aal2' });
  await page.goto('/#/overview');
  await expect(page.locator('.stats')).toBeVisible();
  backend.offline = true;
  await page.locator('.rail-item[data-section="users"]').click();
  const err = page.locator('.note.is-error');
  await expect(err).toContainText('Не удалось связаться с сервером');
  backend.offline = false;
  await err.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('#users-table')).toBeVisible();
});

test('сеанс — только в sessionStorage, выход его стирает', async ({ page, open }) => {
  const backend = await open();
  await page.goto('/');
  await login(page);
  await page.locator('#mfa-code').fill(GOOD_CODE);
  await page.locator('#mfa-form button[type="submit"]').click();
  await expect(page.locator('#app')).toBeVisible();
  const store = await page.evaluate((k) => ({
    session: !!sessionStorage.getItem(k),
    local: Object.keys(localStorage).filter((x) => x.startsWith('sb-')),
  }), SESSION_KEY);
  expect(store).toEqual({ session: true, local: [] });
  await page.locator('#signout-btn').click();
  await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY)).toBeNull();
  expect(backend.authCalls.some((c) => c.path === '/logout')).toBe(true);
});

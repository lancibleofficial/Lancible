// Согласие при входе, правовые ссылки и удаление аккаунта в настройках.
// Запуск: npm run test:e2e
//
// Войти в Supabase из теста нельзя, поэтому шаг после входа открывается
// напрямую — той же функцией, которую зовёт afterSignedIn. Проверяется то,
// что видит человек: без согласия дальше не пройти, обойти шаг щелчком мимо
// окна или Escape нельзя, а документы открываются на языке приложения.
const { test, expect } = require('@playwright/test');

const open = async (page) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  // Внешние ссылки в вебе открываются window.open — подменяем, чтобы видеть адрес.
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); }; });
};

const step = (page) => page.locator('#auth-step-onboarding');
const save = (page) => page.locator('#auth-onboarding-save');
const skip = (page) => page.locator('#auth-onboarding-skip');
const consent = (page) => page.locator('#auth-consent-check');

test('новый аккаунт: без согласия «Продолжить» и «Пропустить» неактивны', async ({ page }) => {
  await open(page);
  await page.evaluate(() => openOnboarding('full'));
  await expect(step(page)).toBeVisible();
  await expect(page.locator('#auth-profile-fields')).toBeVisible();
  await expect(consent(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(save(page)).toBeDisabled();
  await expect(skip(page)).toBeDisabled();

  await consent(page).click();
  await expect(consent(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(save(page)).toBeEnabled();
  await expect(skip(page)).toBeEnabled();

  // Подпись работает как <label>: щелчок по тексту снимает отметку.
  await page.locator('#auth-consent-text').click({ position: { x: 4, y: 6 } });
  await expect(consent(page)).toHaveAttribute('aria-pressed', 'false');
});

test('в подписи — возраст из ядра и ссылки на документы на языке приложения', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { state.settings.lang = 'kk'; openOnboarding('full'); });
  const text = page.locator('#auth-consent-text');
  await expect(text).toContainText('16');
  await expect(text.locator('a[data-legal="terms"]')).toHaveAttribute('href', 'https://lancible.vercel.app/terms?lang=kk');
  await expect(text.locator('a[data-legal="privacy"]')).toHaveAttribute('href', 'https://lancible.vercel.app/privacy?lang=kk');
  await text.locator('a[data-legal="privacy"]').click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://lancible.vercel.app/privacy?lang=kk']);
  // Ссылка не переключает согласие.
  await expect(consent(page)).toHaveAttribute('aria-pressed', 'false');
});

test('шаг согласия не закрывается щелчком мимо окна и Escape', async ({ page }) => {
  await open(page);
  await page.evaluate(() => openOnboarding('consent'));
  await page.mouse.click(5, 5);
  await expect(step(page)).toBeVisible();
  await consent(page).focus();
  await page.keyboard.press('Escape');
  await expect(step(page)).toBeVisible();
});

test('обновлённые условия: только согласие, без имени и «Пропустить»', async ({ page }) => {
  await open(page);
  await page.evaluate(() => openOnboarding('consent'));
  await expect(page.locator('#auth-profile-fields')).toBeHidden();
  await expect(skip(page)).toBeHidden();
  await expect(page.locator('#auth-consent-sub')).toBeVisible();
  await expect(page.locator('#auth-consent-decline')).toBeVisible();
  await expect(save(page)).toBeDisabled();
});

test('окно входа закрывается Escape — с клавиатуры', async ({ page }) => {
  await open(page);
  await page.evaluate(() => openAuthModal());
  await expect(page.locator('#auth-step-credentials')).toBeVisible();
  await page.locator('#auth-email').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#auth-backdrop')).toBeHidden();
});

test('в настройках — документы на языке приложения', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { state.settings.lang = 'en'; });
  await page.locator('.nav-item[data-view="settings"]').first().click();
  for (const [id, doc] of [['settings-legal-privacy', 'privacy'], ['settings-legal-terms', 'terms'], ['settings-legal-docs', 'legal']]) {
    await page.locator(`#${id}`).click();
    expect((await page.evaluate(() => window.__opened)).pop()).toBe(`https://lancible.vercel.app/${doc}?lang=en`);
  }
});

test('«Удалить аккаунт» есть только у вошедшего и спрашивает подтверждение', async ({ page }) => {
  await open(page);
  await page.locator('.nav-item[data-view="settings"]').first().click();
  await expect(page.locator('#settings-delete-row')).toBeHidden();

  // Вошедший — без сети: подменяем только то, что нужно строке настроек.
  await page.evaluate(() => {
    currentUser = { id: 'u1', email: 'test@example.com', name: null };
    window.__rpc = [];
    sb.rpc = async (name) => { window.__rpc.push(name); return { error: null }; };
    // Папка картинок пуста, функция delete-account отвечает 200; ответы и
    // старый путь — в delete-account.spec.js. sb.functions — геттер, поэтому
    // подменяется само свойство.
    sb.storage.from = () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) });
    Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async (name) => { window.__rpc.push(name); return { data: { deleted: true }, error: null }; } } });
    renderSettings();
  });
  await expect(page.locator('#settings-delete-row')).toBeVisible();
  await page.locator('#settings-delete-row').click();
  // Сначала — подтверждение, без него ничего не удаляется.
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  expect(await page.evaluate(() => window.__rpc)).toEqual([]);
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => window.__rpc)).toEqual(['delete-account']);
  await expect(page.locator('#settings-delete-row')).toBeHidden();
  expect(await page.evaluate(() => currentUser)).toBeNull();
});

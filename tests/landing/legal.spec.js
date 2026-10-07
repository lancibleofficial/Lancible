// Баннер согласия и правовые страницы — в браузере. Запуск: npm run test:landing
//
// Что здесь. tests/unit/consent.test.js проверяет логику баннера и то, что
// видно в исходнике; здесь — поведение: баннер встречает нового посетителя,
// отказ запоминается, «Настройки cookie» в подвале открывают выбор снова,
// а документы показывают ровно один перевод и помнят язык.
const { test, expect } = require('@playwright/test');

const KEY = 'lancible:consent';
const DOCS = ['privacy', 'terms', 'cookies', 'refund', 'legal', 'delete-account'];

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

test.beforeEach(async ({ page }) => {
  // Каждый тест — новый посетитель: хранилище адреса чистое.
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('новый посетитель видит баннер, «Принять» и «Отклонить» одного веса', async ({ page }) => {
  await page.goto('/index.html');
  const banner = page.locator('.consent');
  await expect(banner).toBeVisible();
  const look = await page.evaluate(() => {
    const pick = (act) => {
      const b = document.querySelector(`.consent [data-act="${act}"]`);
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return { font: cs.fontSize, weight: cs.fontWeight, bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, h: Math.round(r.height) };
    };
    return { accept: pick('accept'), reject: pick('reject') };
  });
  expect(look.reject).toEqual(look.accept);
});

test('отказ запоминается и баннер больше не показывается', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('.consent [data-act="reject"]').click();
  await expect(page.locator('.consent')).toHaveCount(0);
  expect((await stored(page)).analytics).toBe(false);
  await page.goto('/blog.html');
  await expect(page.locator('.consent')).toHaveCount(0);
  expect(await page.evaluate(() => window.LancibleConsent.allowed('analytics'))).toBe(false);
});

test('«Настройки cookie» в подвале открывают выбор снова, и его можно поменять', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('.consent [data-act="reject"]').click();
  await page.locator('footer [data-consent-open]').click();
  const box = page.locator('.consent');
  await expect(box).toBeVisible();
  const analytics = box.locator('[data-cat="analytics"]');
  await expect(analytics).not.toBeChecked();
  await expect(box.locator('input[disabled]')).toBeChecked(); // необходимые — всегда
  await analytics.check();
  await box.locator('[data-act="save"]').click();
  expect((await stored(page)).analytics).toBe(true);
  // И отозвать так же легко, как дать.
  await page.locator('footer [data-consent-open]').click();
  await page.locator('.consent [data-act="reject"]').click();
  expect((await stored(page)).analytics).toBe(false);
});

test('повторно открытое окно закрывается Escape и возвращает фокус', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('.consent [data-act="accept"]').click();
  const opener = page.locator('footer [data-consent-open]');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.consent')).toBeVisible();
  await expect(page.locator('.consent [data-cat="analytics"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.consent')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('с клавиатуры до баннера доходят первым же Tab', async ({ page }) => {
  await page.goto('/index.html');
  await page.keyboard.press('Tab');
  const inBanner = await page.evaluate(() => !!document.activeElement.closest('.consent'));
  expect(inBanner).toBe(true);
});

for (const width of [1280, 375]) {
  test(`баннер помещается в окно при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/index.html');
    const m = await page.evaluate(() => {
      const r = document.querySelector('.consent').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.consent button')].map((b) => b.getBoundingClientRect());
      return {
        left: r.left, right: r.right, vw: document.documentElement.clientWidth,
        btnsInside: btns.every((b) => b.left >= r.left && b.right <= r.right + 0.5),
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.vw);
    expect(m.btnsInside).toBe(true);
    expect(m.sideways).toBe(false);
  });
}

test('документы открываются красивым адресом', async ({ page }) => {
  for (const doc of DOCS) {
    const res = await page.goto(`/${doc}`);
    expect(res.status(), `/${doc}`).toBe(200);
    await expect(page.locator('article.legal-doc:visible')).toHaveCount(1);
  }
});

test('?lang= выбирает перевод, переключатель меняет его и запоминает', async ({ page }) => {
  await page.goto('/privacy?lang=en');
  await expect(page.locator('article.legal-doc:visible')).toHaveAttribute('data-lang', 'en');
  await expect(page.locator('h1')).toHaveText('Privacy Policy');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('.legal-nav a[data-doc="terms"]')).toHaveAttribute('href', 'terms.html?lang=en');

  await page.locator('.lang-switch button[data-lang="uk"]').click();
  await expect(page.locator('article.legal-doc:visible')).toHaveAttribute('data-lang', 'uk');
  expect(new URL(page.url()).searchParams.get('lang')).toBe('uk');
  // Баннер говорит на языке документа.
  await expect(page.locator('.consent .consent-title')).toHaveText('Ми дбаємо про ваші дані');

  await page.goto('/terms.html');
  await expect(page.locator('article.legal-doc:visible')).toHaveAttribute('data-lang', 'uk');
});

test('незаполненные реквизиты видны пометкой, а не пустым местом', async ({ page }) => {
  await page.goto('/legal?lang=ru');
  const cells = page.locator('article.legal-doc:visible [data-biz]');
  const n = await cells.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i += 1) {
    const text = (await cells.nth(i).textContent()).trim();
    expect(text.length, 'поле реквизитов пустое').toBeGreaterThan(0);
  }
});

test('ни один перевод ни одного документа не тянет страницу вбок на 375', async ({ page }) => {
  // Длинные слова вроде «конфиденційності» шрифтом Unbounded шире узкого
  // экрана — заголовок обязан переноситься. Проверяем все переводы: у
  // каждого языка свои длинные слова.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addInitScript(() => localStorage.setItem('lancible:consent', JSON.stringify({ v: 1, at: '2026-10-07T00:00:00.000Z', analytics: false })));
  const bad = [];
  for (const doc of DOCS) {
    for (const lang of ['ru', 'en', 'uk', 'kk']) {
      await page.goto(`/${doc}?lang=${lang}`);
      await page.evaluate(() => document.fonts.ready);
      const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (w > 0) bad.push(`${doc} ${lang}: +${w}px`);
    }
  }
  expect(bad).toEqual([]);
});

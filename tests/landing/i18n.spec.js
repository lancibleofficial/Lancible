// Лендинг: язык один на весь сайт. Запуск: npm run test:landing
//
// Зачем. Языков было два независимых: правовые документы помнили свой, лента
// блога — свой. Выбрав английский в блоге, человек получал русскую шапку, а
// сменив язык договора — русский блог. Плюс лента вообще не смотрела на язык
// браузера и всем показывала русский.
//
// Проверяется то, что видно только в браузере: что язык действительно
// определяется по локали, что выбор доходит до соседних страниц и что
// переключатель документа и переключатель сайта — это один и тот же выбор.
const { test, expect } = require('@playwright/test');

const KEY = 'lancible:lang';

/** Что видно на странице: язык документа и несколько подписей из разных мест. */
const seen = (page) => page.evaluate(() => ({
  lang: document.documentElement.lang,
  status: document.querySelector('.status-pill span:not(.status-dot)')?.textContent.trim(),
  tagline: document.querySelector('[data-i18n="chrome.tagline"]')?.textContent.trim(),
  pressed: [...document.querySelectorAll('footer .lang-switch button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.lang),
}));

test.describe('язык по умолчанию берётся у браузера', () => {
  for (const [locale, want, status] of [
    ['ru-RU', 'ru', 'В активной разработке'],
    ['en-US', 'en', 'In active development'],
    ['uk-UA', 'uk', 'В активній розробці'],
    // Локаль, которой у сайта нет: английский как язык по умолчанию, а не русский.
    ['de-DE', 'en', 'In active development'],
  ]) {
    test(`${locale} → ${want}`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ locale, baseURL });
      const page = await ctx.newPage();
      await page.goto('/index.html');
      const got = await seen(page);
      expect(got.lang, 'язык страницы').toBe(want);
      expect(got.status, 'подпись в шапке').toBe(status);
      await ctx.close();
    });
  }
});

test('выбор языка доходит до соседних страниц', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', baseURL });
  const page = await ctx.newPage();
  await page.goto('/index.html');
  expect((await seen(page)).lang).toBe('ru');

  await page.click('footer .lang-switch button[data-lang="en"]');
  await expect.poll(async () => (await seen(page)).lang).toBe('en');
  expect((await seen(page)).pressed).toEqual(['en']);

  // Блог и правовая страница открываются уже по-английски.
  for (const url of ['/blog.html', '/privacy.html']) {
    await page.goto(url);
    const got = await seen(page);
    expect(got.lang, `${url}: язык`).toBe('en');
    expect(got.tagline, `${url}: подпись в подвале`).toBe('Lancible — time tracking that stays out of your way');
  }
  await ctx.close();
});

test('язык документа и язык сайта — один и тот же выбор', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', baseURL });
  const page = await ctx.newPage();
  await page.goto('/terms.html');

  // Переключатель рядом с документом знает четыре языка, подвальный — два.
  await page.click('.page-hero .lang-switch button[data-lang="uk"]');
  await expect.poll(async () => (await seen(page)).lang).toBe('uk');
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('uk');

  // Тот же украинский на главной, хотя выбрали его на странице договора.
  await page.goto('/index.html');
  const got = await seen(page);
  expect(got.lang).toBe('uk');
  expect(got.status).toBe('В активній розробці');
  // Украинского в подвальном переключателе нет — кнопка появляется на месте,
  // чтобы выбор был виден и его можно было отменить.
  expect(got.pressed).toEqual(['uk']);
  await ctx.close();
});

test('?lang= в адресе старше сохранённого выбора', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', baseURL });
  const page = await ctx.newPage();
  await page.goto('/index.html');
  await page.click('footer .lang-switch button[data-lang="en"]');
  await expect.poll(async () => (await seen(page)).lang).toBe('en');

  await page.goto('/privacy.html?lang=kk');
  expect((await seen(page)).lang).toBe('kk');
  await ctx.close();
});

test('лента блога говорит на языке сайта', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: 'en-US', baseURL });
  const page = await ctx.newPage();
  await page.goto('/blog.html');
  const first = await page.evaluate(() => {
    const e = document.querySelector('.blog-entry');
    return { tag: e?.querySelector('.blog-tag')?.textContent.trim(), date: e?.querySelector('.blog-date')?.textContent.trim() };
  });
  // Английская подпись тега и английский формат даты — ни того, ни другого
  // лента раньше не показывала без ручного переключения.
  expect(['Release', 'New', 'Improved']).toContain(first.tag);
  expect(first.date).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  await ctx.close();
});

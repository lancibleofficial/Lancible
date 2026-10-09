// Скелетон загрузки. Запуск: npm run test:e2e
//
// Скелетон стоит, пока app.js не отработал init(). Чтобы его поймать, сам
// app.js не грузится (page.route → abort): страница остаётся ровно в том
// виде, в каком её видит человек первые мгновения.
//
// 9 октября 2026 скелетон пересобран под нынешний «Сегодня» — до этого он
// рисовал четыре карточки чисел и плитки, которых на экране давно нет. Его
// раскладка сверяется с настоящей: рейл и колонки должны стоять там же, где
// встанут настоящие, иначе на смене всё прыгает. И тема: выбранная руками
// встаёт ещё в <head> (theme-boot.js), а не после init().
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Прямоугольники настоящей раскладки и скелетона. */
const rects = (page, sels) => page.evaluate((s) => Object.fromEntries(Object.entries(s).map(([k, sel]) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return [k, { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }];
})), sels);

async function skeletonOnly(page) {
  await page.route('**/app.js', (r) => r.abort());
  await page.reload();
  await expect(page.locator('#app-skeleton')).toBeVisible();
}

for (const scheme of ['dark', 'light']) {
  test(`${scheme}: скелетон стоит там же, где встанет «Сегодня»`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 860 });
    await pinClock(page);
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#shell')).toBeVisible();
    await expect(page.locator('#app-skeleton'), 'после init() скелетона нет').toHaveCount(0);
    const real = await rects(page, { rail: '#navrail', main: '.home-main', side: '.home-side', search: '.tb-search' });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await skeletonOnly(page);
    const skel = await rects(page, { rail: '.skel-rail', main: '.skel-main > .skel-col', side: '.skel-side', search: '.skel-search' });
    for (const key of ['rail', 'main', 'side']) {
      for (const edge of ['left', 'top', 'right', 'bottom']) {
        expect(Math.abs(skel[key][edge] - real[key][edge]), `${key}.${edge}: скелетон ${skel[key][edge]}, на деле ${real[key][edge]}`).toBeLessThanOrEqual(2);
      }
    }
    expect(Math.abs(skel.search.left - real.search.left), 'поиск с того же места').toBeLessThanOrEqual(12);
    const look = await page.evaluate(() => ({
      bg: getComputedStyle(document.getElementById('app-skeleton')).backgroundColor,
      island: getComputedStyle(document.querySelector('.skel-island')).backgroundColor,
    }));
    expect(look.bg, 'земля скелетона — земля темы').toBe(bg);
    expect(look.island).not.toBe(look.bg);
  });
}

test('выбранная руками тема встаёт до init(): скелетон не мелькает системной', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  // Выбор светлой темы в настройках записывается и для следующего запуска.
  await page.evaluate(() => { state.settings.theme = 'light'; applyTheme(); });
  expect(await page.evaluate(() => localStorage.getItem('lancible.theme'))).toBe('light');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await skeletonOnly(page);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('app-skeleton')).backgroundColor)).toBe(lightBg);

  // «Как в системе» — атрибута нет, решает система.
  await page.unroute('**/app.js');
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => { state.settings.theme = 'system'; applyTheme(); });
  await skeletonOnly(page);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);
});

test('узкий веб: скелетон в одну колонку и без вылезания вбок', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pinClock(page);
  await page.goto('/index.html');
  await skeletonOnly(page);
  const m = await page.evaluate(() => ({
    rail: getComputedStyle(document.querySelector('.skel-rail')).display,
    side: getComputedStyle(document.querySelector('.skel-side')).display,
    wide: document.getElementById('app-skeleton').scrollWidth <= innerWidth,
  }));
  expect(m).toEqual({ rail: 'none', side: 'none', wide: true });
});

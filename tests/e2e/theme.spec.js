// Палитра и шрифты. Запуск: npm run test:e2e
//
// Светлая тема переделана: страница и шапка белые, серым помечена левая
// панель и поверхности внутри (карточки, поля). Проверяем цифрами, а не на
// глаз: на скриншоте «почти белый» и «белый» неразличимы, а разница как раз
// в том, что одно чуть темнее другого.
const { test, expect } = require('@playwright/test');

const open = async (page, theme) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((th) => { state.settings.theme = th; applyTheme(); render(); }, theme);
};

/** Яркость по восприятию: ею и меряем «светлее — темнее». */
const paint = (page) => page.evaluate(() => {
  const bg = (sel) => {
    const n = typeof sel === 'string' ? document.querySelector(sel) : sel;
    return getComputedStyle(n).backgroundColor;
  };
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).map(Number);
    return +((0.2126 * r) + (0.7152 * g) + (0.0722 * b)).toFixed(1);
  };
  const root = getComputedStyle(document.documentElement);
  return {
    page: bg(document.body),
    header: bg('#titlebar'),
    rail: bg('#navrail'),
    search: bg('.tb-search'),
    panel2: root.getPropertyValue('--panel-2').trim(),
    lum: {
      page: lum(bg(document.body)),
      rail: lum(bg('#navrail')),
      search: lum(bg('.tb-search')),
    },
  };
});

test('светлая тема: страница и шапка белые, левая панель — еле заметный серый', async ({ page }) => {
  await open(page, 'light');
  const p = await paint(page);
  expect(p.page, 'фон страницы').toBe('rgb(255, 255, 255)');
  expect(p.header, 'шапка того же цвета, что страница').toBe(p.page);
  expect(p.rail, 'левая панель не белая').not.toBe(p.page);
  expect(p.lum.rail, 'панель темнее страницы').toBeLessThan(p.lum.page);
  // «Приближённый к белому и еле виден»: разница есть, но маленькая.
  expect(p.lum.page - p.lum.rail).toBeGreaterThan(2);
  expect(p.lum.page - p.lum.rail).toBeLessThan(14);
});

test('поле поиска покрашено как остальные поля ввода', async ({ page }) => {
  await open(page, 'light');
  const same = await page.evaluate(() => {
    const search = getComputedStyle(document.querySelector('.tb-search')).backgroundColor;
    // Любое поле из модалки — они все на --panel-2.
    promptDialog({ label: 'Проверка' });
    const input = getComputedStyle(document.getElementById('modal-input')).backgroundColor;
    return { search, input };
  });
  expect(same.search).toBe(same.input);
});

test('тёмную тему не задели: фон по-прежнему темнее панели', async ({ page }) => {
  await open(page, 'dark');
  const p = await paint(page);
  expect(p.page).toBe('rgb(42, 43, 46)');
  expect(p.lum.rail, 'в тёмной панель наоборот светлее фона').toBeGreaterThan(p.lum.page);
});

test('текст набран Gravity, а лого и крупные числа — Basique Pro', async ({ page }) => {
  await open(page, 'light');
  const f = await page.evaluate(async () => {
    await document.fonts.ready;
    const fam = (sel) => getComputedStyle(document.querySelector(sel)).fontFamily.split(',')[0].replace(/['"]/g, '');
    return {
      body: fam('body'),
      nav: fam('.nav-item'),
      logo: fam('.tb-logo-text'),
      heading: fam('.home-head h1'),
      loaded: [...document.fonts].filter((x) => x.status === 'loaded').map((x) => `${x.family} ${x.weight}`),
    };
  });
  expect(f.body).toBe('Gravity');
  expect(f.nav, 'пункты меню — обычный текст').toBe('Gravity');
  expect(f.logo).toBe('Basique Pro');
  expect(f.heading, 'заголовок страницы — фирменный шрифт').toBe('Basique Pro');
  expect(f.loaded.some((x) => x.startsWith('Gravity')), `загружено: ${f.loaded}`).toBe(true);
  expect(f.loaded.some((x) => x.startsWith('Basique Pro')), `загружено: ${f.loaded}`).toBe(true);
});

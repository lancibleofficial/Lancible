// Палитра и шрифты. Запуск: npm run test:e2e
//
// Редизайн 6 октября 2026. Тёмная тема — глубокий графит, слои светлеют
// кверху: фон → панель → поле. Светлая «Чистая» — всё белое, части экрана
// разделены линиями, текст почти чёрный. Проверяем цифрами, а не на глаз:
// на скриншоте «почти белый» и «белый» неразличимы, а «бледно» — это
// контраст, и его можно посчитать.
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
  return {
    page: bg(document.body),
    header: bg('#titlebar'),
    rail: bg('#navrail'),
    railBorder: getComputedStyle(document.querySelector('#navrail')).borderRightColor,
    lum: {
      page: lum(bg(document.body)),
      rail: lum(bg('#navrail')),
      search: lum(bg('.tb-search')),
    },
  };
});

/**
 * Контраст по WCAG для пары токенов: цвета берутся вычисленными, через
 * пробный элемент, — так проверяется ровно то, что видит пользователь.
 */
const contrast = (page, pairs) => page.evaluate((list) => {
  const probe = document.createElement('div');
  document.body.append(probe);
  const rgb = (token) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
  };
  const rel = ([r, g, b]) => {
    const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return (0.2126 * ch(r)) + (0.7152 * ch(g)) + (0.0722 * ch(b));
  };
  const out = {};
  for (const [fg, bg] of list) {
    const [a, b] = [rel(rgb(fg)), rel(rgb(bg))].sort((x, y) => y - x);
    out[`${fg} на ${bg}`] = +((a + 0.05) / (b + 0.05)).toFixed(2);
  }
  probe.remove();
  return out;
}, pairs);

const TEXT = ['--text', '--text-dim', '--text-faint', '--accent-ink', '--danger'];
const SURFACES = ['--bg', '--panel', '--panel-2', '--board-col', '--board-card'];

test('светлая «Чистая»: страница, шапка и левая панель белые, панель отделена линией', async ({ page }) => {
  await open(page, 'light');
  const p = await paint(page);
  expect(p.page, 'фон страницы').toBe('rgb(255, 255, 255)');
  expect(p.header, 'шапка того же цвета, что страница').toBe(p.page);
  expect(p.rail, 'левая панель того же цвета, что страница').toBe(p.page);
  expect(p.railBorder, 'панель отделена линией').not.toBe(p.page);
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

test('тёмная тема — глубокий графит, панель светлее фона', async ({ page }) => {
  await open(page, 'dark');
  const p = await paint(page);
  expect(p.page).toBe('rgb(20, 21, 24)');
  expect(p.lum.rail, 'слой выше — светлее').toBeGreaterThan(p.lum.page);
  expect(p.lum.search, 'поле ещё светлее панели').toBeGreaterThan(p.lum.rail);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: каждая ступень текста читается на каждой поверхности — контраст не ниже 4.5:1`, async ({ page }) => {
    await open(page, theme);
    const got = await contrast(page, TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])));
    const weak = Object.entries(got).filter(([, v]) => v < 4.5);
    expect(weak, `ниже 4.5:1: ${JSON.stringify(weak)}`).toEqual([]);
  });
}

test('зелёный текстом на светлой теме тёмный, а заливкой остаётся ярким', async ({ page }) => {
  await open(page, 'light');
  const c = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { fill: root.getPropertyValue('--accent').trim(), ink: root.getPropertyValue('--accent-ink').trim() };
  });
  expect(c.ink).not.toBe(c.fill);
  const ratio = await contrast(page, [['--accent-ink', '--bg'], ['--accent-text', '--accent']]);
  expect(ratio['--accent-ink на --bg']).toBeGreaterThanOrEqual(4.5);
  expect(ratio['--accent-text на --accent'], 'надпись на зелёной кнопке').toBeGreaterThanOrEqual(4.5);
});

test('текст набран Onest, а лого и крупные числа — Basique Pro', async ({ page }) => {
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
  expect(f.body).toBe('Onest');
  expect(f.nav, 'пункты меню — обычный текст').toBe('Onest');
  expect(f.logo).toBe('Basique Pro');
  expect(f.heading, 'заголовок страницы — фирменный шрифт').toBe('Basique Pro');
  expect(f.loaded.some((x) => x.startsWith('Onest')), `загружено: ${f.loaded}`).toBe(true);
  expect(f.loaded.some((x) => x.startsWith('Basique Pro')), `загружено: ${f.loaded}`).toBe(true);
});

test('у Onest есть казахские буквы и цифры одинаковой ширины', async ({ page }) => {
  // Gravity, который стоял до Onest, рисовал пятнадцать из восемнадцати
  // казахских букв запасным шрифтом, а цифры у него разной ширины — таймер
  // дрожал. Проверяем оба свойства у шрифта, который реально загружен.
  await open(page, 'dark');
  const r = await page.evaluate(async () => {
    const kz = 'ӘәҒғҚқҢңӨөҰұҮүҺһІі';
    await document.fonts.load(`16px Onest`, kz);
    const c = document.createElement('canvas').getContext('2d');
    const missing = [...kz].filter((ch) => {
      c.font = '40px Onest, monospace'; const a = c.measureText(ch).width;
      c.font = '40px monospace'; return Math.abs(a - c.measureText(ch).width) < 0.01;
    });
    const s = document.createElement('span');
    s.style.cssText = 'font: 40px Onest; font-variant-numeric: tabular-nums; position: absolute';
    document.body.append(s);
    const w = (t) => { s.textContent = t; return s.getBoundingClientRect().width; };
    const widths = [w('1111'), w('0000')];
    s.remove();
    return { missing: missing.join(''), widths };
  });
  expect(r.missing, 'казахские буквы, которых нет в Onest').toBe('');
  expect(Math.abs(r.widths[0] - r.widths[1]), 'цифры одной ширины').toBeLessThan(0.5);
});

test('обычный текст в светлой теме на полступени плотнее', async ({ page }) => {
  // Тёмные буквы на белом читаются тоньше светлых на тёмном — отсюда 450
  // против 400. Onest переменный, такой вес у него настоящий.
  const weight = async (theme) => {
    await open(page, theme);
    return page.evaluate(() => getComputedStyle(document.body).fontWeight);
  };
  expect(await weight('light')).toBe('450');
  expect(await weight('dark')).toBe('400');
});

test('в светлой теме все панели — цвета страницы', async ({ page }) => {
  await open(page, 'light');
  const got = await page.evaluate(() => {
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    state.projects.push({
      id: uid(), name: 'П', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    state.ui.view = 'home';
    render();
    const home = bg('#home-side');
    state.ui.view = 'stats';
    render();
    return { page: bg('body'), rail: bg('#navrail'), home, stats: bg('.cal-day') };
  });
  expect(got.home, 'правая панель обзора').toBe(got.page);
  expect(got.stats, 'правая панель статистики').toBe(got.page);
  expect(got.rail, 'левая панель').toBe(got.page);
});

test('всплывающее меню поднято тенью над тем, из чего вызвано', async ({ page }) => {
  // Меню вызывается поверх окна того же цвета. На светлой теме одной рамки не
  // хватало: меню сливалось с окном, и выглядело это как «дропдаун не работает».
  for (const theme of ['light', 'dark']) {
    await open(page, theme);
    const shadow = await page.evaluate(() => {
      openMenu(document.querySelector('.nav-item'), [{ label: 'раз', onClick: () => {} }]);
      const m = getComputedStyle(document.getElementById('ctx-menu'));
      return { box: m.boxShadow, z: m.zIndex };
    });
    expect(shadow.box, `тема ${theme}: тень у меню`).not.toBe('none');
    expect(shadow.z, 'меню — верхний слой').toBe('140');
  }
});

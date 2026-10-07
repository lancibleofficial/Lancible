// Палитра и шрифты. Запуск: npm run test:e2e
//
// Редизайн 6 октября 2026. Тёмная тема — глубокий графит, слои светлеют
// кверху: фон → панель → поле. Светлая «Чистая» — с 7 октября во второй
// редакции: земля светло-серая, предметы на ней белые (первая была белой
// целиком, и «не хватало контраста между объектами»). Проверяем цифрами, а
// не на глаз: на скриншоте «почти белый» и «белый» неразличимы, а «бледно» —
// это контраст, и его можно посчитать.
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

test('светлая: серая земля, рейл и поиск — белые острова, без обводок', async ({ page }) => {
  // Острова (7 октября): предмет отличается от земли только цветом.
  await open(page, 'light');
  const p = await paint(page);
  expect(p.page, 'земля светло-серая, не белая').toBe('rgb(236, 238, 241)');
  expect(p.header, 'шапка того же цвета, что земля').toBe(p.page);
  expect(p.rail, 'рейл — белый остров').toBe('rgb(255, 255, 255)');
  const flat = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    return { railW: cs('#navrail').borderRightWidth, railR: cs('#navrail').borderRadius, searchW: cs('.tb-search').borderTopWidth, searchBg: cs('.tb-search').backgroundColor, shadow: cs('#navrail').boxShadow };
  });
  expect(flat.railW, 'линии справа у рейла нет').toBe('0px');
  expect(flat.railR, 'скругление острова').toBe('14px');
  expect(flat.searchW).toBe('0px');
  expect(flat.searchBg, 'поиск — остров').toBe(p.rail);
  expect(flat.shadow, 'тени у островов нет').toBe('none');
});

test('поля ввода — залитые, без обводки, акцентная рамка только в фокусе', async ({ page }) => {
  await open(page, 'light');
  const got = await page.evaluate(() => {
    promptDialog({ label: 'Проверка' });
    const input = document.getElementById('modal-input');
    const before = getComputedStyle(input);
    const out = { border: before.borderTopWidth, bg: before.backgroundColor, idle: before.boxShadow };
    input.focus();
    out.focus = getComputedStyle(input).boxShadow;
    return out;
  });
  expect(got.border).toBe('0px');
  expect(got.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(got.idle).toBe('none');
  expect(got.focus).not.toBe('none');
});

test('тёмная тема — глубокий графит, остров светлее земли', async ({ page }) => {
  await open(page, 'dark');
  const p = await paint(page);
  expect(p.page).toBe('rgb(17, 18, 21)');
  expect(p.lum.rail, 'остров светлее земли').toBeGreaterThan(p.lum.page);
  expect(p.lum.search, 'поиск — такой же остров').toBe(p.lum.rail);
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
      heading: fam('.day-title'),
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

test('капсула идущей задачи — в шапке на любом экране, со стопом внутри', async ({ page }) => {
  await open(page, 'light');
  await page.evaluate(() => {
    const p = { id: 'p1', name: 'П', color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] };
    state.projects.push(p);
    state.tasks.push({ id: 't1', projectId: 'p1', title: 'Идущая задача', notes: '', statusId: null, done: false, totalMs: 0, sessions: [], createdAt: new Date().toISOString(), tagIds: [], dueAt: null });
    migrate();
    render();
  });
  await expect(page.locator('#tb-timer')).toBeHidden();
  await page.evaluate(() => startTimer('t1'));
  await expect(page.locator('#tb-timer')).toBeVisible();
  await expect(page.locator('#tb-timer-name')).toHaveText('Идущая задача');
  // Капсула — пилюля того же цвета, что острова, и не меняется между экранами.
  const pill = await page.evaluate(() => getComputedStyle(document.getElementById('tb-timer')));
  expect(pill.borderRadius).toBe('999px');
  await page.evaluate(() => { state.ui.view = 'settings'; render(); });
  await expect(page.locator('#tb-timer')).toBeVisible();
  await page.locator('#tb-timer-stop').click();
  await expect(page.locator('#tb-timer')).toBeHidden();
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  expect(await page.evaluate(() => state.ui.view), 'стоп не уводит с экрана').toBe('settings');
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

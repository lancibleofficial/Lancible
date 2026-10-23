// Цвета админки — только токены admin.css, верные обеим темам.
// В браузере: вычисленные цвета деталей равны своим токенам в тёмной и
// светлой теме (по системе и по выбору). В исходниках: литералы цвета только
// в «Палитре», два светлых блока одинаковы, в JS цветов нет, системного
// <select> нет.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./mock');

const ADMIN = path.join(__dirname, '..', '..', 'admin');
const read = (f) => fs.readFileSync(path.join(ADMIN, f), 'utf8');

/** Пары «деталь — свойство — токен». Значение токена браузер переводит в
 *  rgb сам: временный узел с цветом var(--токен). */
const CHECKS = [
  ['body', 'background-color', '--bg'],
  ['body', 'color', '--text'],
  ['.rail', 'background-color', '--panel'],
  ['.stat', 'background-color', '--panel'],
  ['.stat-label', 'color', '--text-dim'],
  ['.stat-sub', 'color', '--text-faint'],
  ['.rail-item[aria-current="page"]', 'background-color', '--panel-2'],
  ['.segmented', 'background-color', '--panel-2'],
  ['.ch-bar', 'fill', '--chart'],
  ['.ch-label', 'fill', '--text-faint'],
  ['.ch-grid', 'stroke', '--line'],
  ['.bar-fill', 'background-color', '--chart'],
  ['.brand-mark', 'color', '--accent'],
];

async function compare(page) {
  // Смена темы запускает переходы цвета: мерить — когда они доиграли.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  return page.evaluate((checks) => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const tokenRgb = (t) => { probe.style.color = `var(${t})`; return getComputedStyle(probe).color; };
    const out = [];
    for (const [sel, prop, token] of checks) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, missing: true }); continue; }
      const got = getComputedStyle(el).getPropertyValue(prop);
      const want = tokenRgb(token);
      if (got !== want) out.push({ sel, prop, token, got, want });
    }
    probe.remove();
    return { bad: out, bg: getComputedStyle(document.body).backgroundColor };
  }, CHECKS);
}

test('тёмная тема: цвета деталей — из токенов', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/overview');
  await expect(page.locator('.ch-bar').first()).toBeAttached();
  const { bad, bg } = await compare(page);
  expect(bad).toEqual([]);
  expect(bg).toBe('rgb(17, 18, 21)'); // --bg тёмной
});

test('светлая по системе и тёмная по выбору поверх светлой системы', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/overview');
  await expect(page.locator('.ch-bar').first()).toBeAttached();
  let r = await compare(page);
  expect(r.bad).toEqual([]);
  expect(r.bg).toBe('rgb(236, 238, 241)'); // --bg светлой

  // Тема руками: системная → светлая → тёмная; выбор переживает перезагрузку.
  await page.locator('#theme-btn').click();
  await expect(page.locator('#theme-btn')).toHaveText('Тема: светлая');
  await page.locator('#theme-btn').click();
  await expect(page.locator('#theme-btn')).toHaveText('Тема: тёмная');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  r = await compare(page);
  expect(r.bad).toEqual([]);
  expect(r.bg).toBe('rgb(17, 18, 21)');
  await page.reload();
  await expect(page.locator('.ch-bar').first()).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('экран входа и пустые состояния — тоже токены', async ({ page, open }) => {
  await open({ handlers: {} });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('#login-form')).toBeVisible();
  const bad = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const tok = (t) => { probe.style.color = `var(${t})`; return getComputedStyle(probe).color; };
    const out = [];
    const card = getComputedStyle(document.querySelector('.auth-card')).backgroundColor;
    if (card !== tok('--panel')) out.push(['auth-card', card]);
    const field = getComputedStyle(document.querySelector('#login-email')).backgroundColor;
    if (field !== tok('--panel-2')) out.push(['field', field]);
    const btn = getComputedStyle(document.querySelector('.auth-submit'));
    if (btn.backgroundColor !== tok('--accent')) out.push(['btn bg', btn.backgroundColor]);
    if (btn.color !== tok('--accent-text')) out.push(['btn text', btn.color]);
    return out;
  });
  expect(bad).toEqual([]);
});

// ---------- исходники ----------

const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|green|blue|gray|grey)\b(?![-\w])/gi;

/** CSS без комментариев. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('admin.css: литералы цвета — только в «Палитре»', () => {
  const css = read('admin.css');
  const start = css.indexOf('/* ========== Палитра ========== */');
  const end = css.indexOf('/* ========== Основа ========== */');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const outside = stripComments(css.slice(0, start) + css.slice(end));
  const found = outside.match(COLOR) || [];
  expect(found, 'цвет мимо токена — заведите токен в «Палитре»').toEqual([]);
});

test('admin.css: два светлых блока одинаковы', () => {
  const css = stripComments(read('admin.css'));
  const sys = css.match(/:root:not\(\[data-theme="dark"\]\):not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
  const pick = css.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/);
  expect(sys && pick).toBeTruthy();
  const norm = (s) => s.split(';').map((x) => x.trim()).filter(Boolean).join(';');
  expect(norm(sys[1])).toBe(norm(pick[1]));
});

test('в JS админки нет цветов и системного <select>', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ADMIN, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|html)$/.test(e.name)) files.push(rel);
    }
  };
  walk('js');
  files.push('index.html', 'screens.js', 'theme-boot.js');
  const colors = [];
  const selects = [];
  for (const f of files) {
    // Без комментариев и без favicon (data:-картинка знака, как у лендинга).
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<link rel="icon"[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of text.match(COLOR) || []) colors.push(`${f}: ${m}`);
    if (/<select\b|createElement\(\s*['"]select['"]|h\(\s*['"]select['"]/.test(text)) selects.push(f);
  }
  expect(colors).toEqual([]);
  expect(selects).toEqual([]);
});

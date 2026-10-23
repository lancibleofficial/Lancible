// Файлы сайта админки: копии готового совпадают с оригиналами, список
// экранов — с клиентами, заголовки безопасности и запрет индексации на
// месте. Без браузера — только исходники.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// core.autocrlf у репозитория: копия может выгрузиться с CRLF, оригинал — с LF.
const text = (f) => read(f).replace(/\r\n/g, '\n');

test('vendor/supabase.js — копия supabase-js из node_modules', () => {
  const src = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
  test.skip(!fs.existsSync(path.join(ROOT, src)), 'нет node_modules — npm ci');
  expect(text('admin/vendor/supabase.js') === text(src), 'версия supabase-js сменилась — скопируйте сборку заново').toBe(true);
});

test('vendor/illustrations.js — копия сценок ядра', () => {
  expect(text('admin/vendor/illustrations.js') === text('src/renderer/core/illustrations.js'), 'сценки ядра изменились — скопируйте файл заново').toBe(true);
});

test('шрифт — копия assets/fonts, лицензия рядом', () => {
  const fonts = fs.readdirSync(path.join(ROOT, 'assets', 'fonts')).filter((f) => /^Onest-.*\.woff2$/.test(f));
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) {
    expect(fs.readFileSync(path.join(ROOT, 'admin', 'fonts', f)).equals(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', f))), f).toBe(true);
  }
  expect(fs.existsSync(path.join(ROOT, 'admin', 'fonts', 'Onest-OFL.txt'))).toBe(true);
});

test('screens.js совпадает со списками экранов клиентов', () => {
  const S = require('../../admin/screens.js');
  const ids = (p) => S.SCREENS[p].map((s) => s.id).sort();
  const RE = /^[a-z][a-z0-9_.-]{0,39}$/;
  for (const p of ['web', 'desktop', 'android', 'ios']) {
    for (const s of S.SCREENS[p]) {
      expect(s.id, `${p}: ${s.id} не пройдёт check базы`).toMatch(RE);
      expect(s.label, `${p}: ${s.id} без подписи`).not.toBe(s.id);
    }
  }
  // Веб и десктоп — USAGE_SCREENS из src/renderer/app.js.
  const app = read('src/renderer/app.js');
  const m = app.match(/const USAGE_SCREENS = \[([\s\S]*?)\];/);
  test.skip(!m, 'в app.js нет USAGE_SCREENS — счётчик веба ещё не влит');
  const web = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  expect(ids('web')).toEqual(web);
  expect(ids('desktop')).toEqual(web);
  // Телефон — ROUTE_SCREENS, SETTINGS_SCREENS и SHEET_SCREENS из
  // mobile/src/lib/screenStats.js (PHONE_SCREENS — их объединение).
  const statsFile = 'mobile/src/lib/screenStats.js';
  if (!fs.existsSync(path.join(ROOT, statsFile))) return;
  const phoneSrc = read(statsFile);
  const block = (name) => {
    const b = phoneSrc.match(new RegExp(`export const ${name} = [\\[{]([\\s\\S]*?)[\\]}];`));
    return b ? b[1] : '';
  };
  const routes = [...block('ROUTE_SCREENS').matchAll(/:\s*'([^']+)'/g)].map((x) => x[1]);
  const settings = [...block('SETTINGS_SCREENS').matchAll(/'([^']+)'/g)].map((x) => `settings.${x[1]}`);
  const sheets = [...block('SHEET_SCREENS').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const phone = [...new Set([...routes, ...settings, ...sheets])].sort();
  expect(phone.length).toBeGreaterThan(10);
  expect(ids('android')).toEqual(phone);
  expect(ids('ios')).toEqual(phone);
});

test('vercel.json: строгая политика скриптов и запрет индексации', () => {
  const cfg = JSON.parse(read('admin/vercel.json'));
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  const get = (k) => (all.headers.find((x) => x.key === k) || {}).value || '';
  const csp = get('Content-Security-Policy');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  expect(csp).toContain('connect-src \'self\' https://yiglgfkjjvwijukdzutw.supabase.co');
  expect(get('X-Robots-Tag')).toMatch(/noindex/);
  expect(get('X-Frame-Options')).toBe('DENY');
  expect(get('Referrer-Policy')).toBe('no-referrer');
  expect(get('X-Content-Type-Options')).toBe('nosniff');
  expect(read('admin/robots.txt')).toMatch(/^Disallow: \/$/m);
});

test('текст «Устройства» — кусок разметки без скриптов, стилей строкой и чужих загрузок', () => {
  // Политика сайта (vercel.json) не пустит ни встроенный скрипт, ни стиль
  // строкой: раздел показал бы их молча сломанными. Файл пересчитывает
  // npm run site:refresh — проверка ловит и его.
  const html = read('admin/content/architecture.html').replace(/<!--[\s\S]*?-->/g, '');
  expect(html).not.toMatch(/<(script|style|link|iframe|object|embed)\b/i);
  expect(html).not.toMatch(/\sstyle\s*=/i);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/<(img|source|video|audio)\b[^>]*\bsrc=["']?(https?:)?\/\//i);
  expect(html).not.toMatch(/<html|<body|<head/i);
});

test('vis-network для графа — своя копия рядом с лицензиями; у лендинга её больше нет', () => {
  for (const f of ['vis-network-9.1.6.min.js', 'vis-network-LICENSE-MIT.txt', 'vis-network-LICENSE-APACHE-2.0.txt']) {
    expect(fs.existsSync(path.join(ROOT, 'admin', 'vendor', f)), f).toBe(true);
  }
  expect(fs.existsSync(path.join(ROOT, 'landing', 'vendor'))).toBe(false);
});

test('index.html: без встроенных скриптов и без чужих адресов', () => {
  const html = read('admin/index.html');
  expect(html).toMatch(/<meta name="robots" content="noindex/);
  // Политика сайта запрещает встроенные скрипты: у каждого <script> — src.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    expect(m[1], 'встроенный скрипт').toMatch(/\bsrc="/);
    expect(m[2].trim()).toBe('');
  }
  // Свои файлы — без CDN.
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (m[1].startsWith('data:') || m[1].startsWith('#')) continue;
    expect(m[1], 'чужой адрес').not.toMatch(/^https?:|^\/\//);
  }
});

// Сайт не зовёт сторонние сервисы. Запуск: npm run test:unit
//
// Откуда тест. Политика cookie обещает, что о визите на lancible.vercel.app
// сторонние сервисы не узнают. 10 октября 2026 Legal Manager нашёл, что /graph
// грузит библиотеку графа vis-network с unpkg.com — то есть каждый, кто открыл
// граф, светил свой адрес чужому CDN. Библиотека переехала в landing/vendor
// (с 23 октября 2026 граф вместе с ней — в админке, admin/vendor), а здесь
// проверяется, что ни одна страница сайта снова не подтянет что-то снаружи:
// скрипт, стиль, шрифт, картинку, фрейм.
//
// Что считается загрузкой. Всё, что браузер запрашивает сам, без действия
// человека: <script src>, <link> с загружающим rel (stylesheet, preload,
// preconnect, icon, …), <img>, <source>, <iframe>, <video>, <audio>, <track>,
// <embed>, <object>, url() и @import в CSS. Ссылки <a href> — не загрузка:
// по ним человек уходит сам, и это видно.
//
// Чего тест не видит. Запросы к данным из скриптов — например, главная и блог
// читают посты из Supabase, нашего же бэкенда. Это не сторонний сервис, а
// место, где живут данные, и оно описано в политике конфиденциальности.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const LANDING = path.join(ROOT, 'landing');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Страницы сайта: весь лендинг и веб-версия, которая открывается с того же
// адреса (/app). Собранная копия веба в landing/app в git не лежит.
const PAGES = [
  ...fs.readdirSync(LANDING).filter((f) => f.endsWith('.html')).map((f) => `landing/${f}`),
  'web/index.html',
];
const STYLESHEETS = ['landing/landing.css', 'web/responsive.css'];

// Своё — это относительные пути, data: и наш единственный адрес.
const OWN_HOSTS = ['lancible.vercel.app'];

// Разрешённые сторонние загрузки: { page, url, why }. Сейчас пусто. Добавить
// строку можно только с причиной — и после того, как её примет Legal Manager:
// политика cookie должна назвать этот сервис.
const ALLOWED = [];

// Библиотека графа — своя копия. Отпечаток sha384 — тот же, что стоял в
// integrity у ссылки на unpkg: файл взят из пакета vis-network@9.1.6 и совпал
// с ним байт в байт. С 23 октября 2026 граф живёт в админке, копия — там же.
const VIS = {
  file: 'admin/vendor/vis-network-9.1.6.min.js',
  sha384: 'Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1',
  licenses: ['admin/vendor/vis-network-LICENSE-MIT.txt', 'admin/vendor/vis-network-LICENSE-APACHE-2.0.txt'],
};

const LOADING_REL = /\b(stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|icon|apple-touch-icon|mask-icon|manifest)\b/i;

function isExternal(url) {
  const m = String(url).trim().match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return !!m && !OWN_HOSTS.includes(m[1].toLowerCase());
}

/** Внешние загрузки в разметке: [{ what, url }]. */
function externalLoads(html) {
  const found = [];
  const add = (what, url) => { if (url && isExternal(url)) found.push({ what, url }); };
  // Блоки <script> с кодом и <style> разбираются отдельно, чтобы текст внутри
  // них не читался как разметка.
  const markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>');

  for (const m of markup.matchAll(/<script\b([^>]*)>/gi)) add('<script src>', attr(m[1], 'src'));
  for (const m of markup.matchAll(/<link\b([^>]*)>/gi)) {
    if (LOADING_REL.test(attr(m[1], 'rel') || '')) add(`<link rel="${attr(m[1], 'rel')}">`, attr(m[1], 'href'));
  }
  for (const m of markup.matchAll(/<(img|source|iframe|frame|video|audio|track|embed|input)\b([^>]*)>/gi)) {
    add(`<${m[1].toLowerCase()} src>`, attr(m[2], 'src'));
    add(`<${m[1].toLowerCase()} poster>`, attr(m[2], 'poster'));
    for (const part of (attr(m[2], 'srcset') || '').split(',')) add(`<${m[1].toLowerCase()} srcset>`, part.trim().split(/\s+/)[0]);
  }
  for (const m of markup.matchAll(/<object\b([^>]*)>/gi)) add('<object data>', attr(m[1], 'data'));
  for (const m of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) found.push(...cssLoads(m[1]));
  for (const m of markup.matchAll(/\bstyle="([^"]*)"/gi)) found.push(...cssLoads(m[1]));
  return found;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function cssLoads(css) {
  const found = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) if (isExternal(m[1])) found.push({ what: 'url() в CSS', url: m[1] });
  for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) if (isExternal(m[1])) found.push({ what: '@import в CSS', url: m[1] });
  return found;
}

const allowed = (page, url) => ALLOWED.some((a) => a.page === page && a.url === url);

test('у каждой разрешённой сторонней загрузки есть причина', () => {
  for (const a of ALLOWED) assert.ok(a.page && a.url && a.why, `в ALLOWED строка без страницы, адреса или причины: ${JSON.stringify(a)}`);
});

test('распознавание: внешнее отличается от своего', () => {
  // Сам детектор проверяется на заведомых примерах — иначе пустой результат
  // ниже ничего бы не доказывал.
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2">
    <link rel="canonical" href="https://example.com/">
    <script src="//cdn.example.com/x.js"></script><script src="vendor/x.js"></script>
    <script>const u = 'https://not-a-load.example.com';</script>
    <img srcset="a.png 1x, https://img.example.com/b.png 2x"><a href="https://github.com/">GitHub</a>
    <style>.x { background: url('https://bg.example.com/a.png') } .y { background: url(data:image/png;base64,AA) }</style>
    <iframe src="https://lancible.vercel.app/graph-view.html"></iframe>`;
  assert.deepEqual(externalLoads(html).map((f) => f.url), [
    '//cdn.example.com/x.js',
    'https://fonts.googleapis.com/css2',
    'https://img.example.com/b.png',
    'https://bg.example.com/a.png',
  ]);
});

test('страницы сайта ничего не грузят со сторонних адресов', () => {
  const bad = [];
  for (const page of PAGES) {
    for (const { what, url } of externalLoads(read(page))) if (!allowed(page, url)) bad.push(`${page}: ${what} ${url}`);
  }
  for (const sheet of STYLESHEETS) {
    for (const { what, url } of cssLoads(read(sheet))) if (!allowed(sheet, url)) bad.push(`${sheet}: ${what} ${url}`);
  }
  assert.deepEqual(bad, [], 'сторонняя загрузка: положите файл к себе (landing/vendor) или внесите её в ALLOWED с причиной');
});

test('граф кода в админке грузит библиотеку из своей копии, и копия — та самая', () => {
  // С 23 октября 2026 граф — раздел админки (admin/js/sections/graph.js), а
  // не страница лендинга; политика админки и так не пустит чужой адрес, но
  // копия должна быть именно той библиотекой.
  const section = read('admin/js/sections/graph.js');
  const src = (section.match(/export const VIS = '([^']*vis-network[^']*)'/) || [])[1];
  assert.equal(src, `vendor/${path.basename(VIS.file)}`, 'раздел графа должен брать vis-network из admin/vendor');
  assert.ok(!fs.existsSync(path.join(LANDING, 'vendor', path.basename(VIS.file))), 'копия библиотеки графа осталась на лендинге — графа там больше нет');
  // Отпечаток считается по тексту с LF: на Windows git выгружает файл с CRLF
  // (core.autocrlf), а в репозитории и на Vercel он с LF — тем самым, что
  // опубликован в пакете.
  const lf = read(VIS.file).replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha384').update(lf).digest('base64'), VIS.sha384, `${VIS.file} не совпадает с vis-network@9.1.6`);
  for (const l of VIS.licenses) assert.ok(fs.existsSync(path.join(ROOT, l)), `рядом с библиотекой нет лицензии ${l}`);
});

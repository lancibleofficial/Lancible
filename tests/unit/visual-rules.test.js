// Правила визуала: где что лежит. Запуск: npm run test:unit
//
// Карта и объяснения — DESIGN.md. Здесь — то, что из неё проверяется по
// исходникам, без браузера.
//
// Нынешние отступления от правил записаны списками, и списки работают как
// храповик: новое отступление — тест красный (заведите токен); старое
// исправлено, а из списка не вычеркнуто — тоже красный, чтобы список не врал
// о том, сколько осталось. То, что зависит от переезда — слой компонентов в
// styles.css и общий landing.css, — помечено { todo }: видно в отчёте, но
// сборку не красит, пока переезд не сделан.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules, declarations } = require('../css');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/** Найденное против списка — как мультимножества: одно и то же место может
 *  встречаться дважды, и вычеркнуть надо ровно столько, сколько исправлено. */
function ratchet(found, listed, what) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const f = count(found);
  const l = count(listed);
  const extra = [...f].filter(([k, n]) => n > (l.get(k) || 0)).map(([k]) => k);
  const gone = [...l].filter(([k, n]) => n > (f.get(k) || 0)).map(([k]) => k);
  assert.deepEqual(extra, [], `${what}: новые отступления. Нужен токен в источнике своей поверхности — см. DESIGN.md, «Правила»`);
  assert.deepEqual(gone, [], `${what}: это уже исправлено — вычеркните из списка в тесте`);
}

// --- десктоп и веб: цвета только из палитры ------------------------------------

/** Отступления в styles.css, которые предстоит заменить токенами. Пусто с
 *  6 октября: новое отступление сразу красит тест. */
const DESKTOP_TO_FIX = [];

test('styles.css: цвета берутся из палитры', () => {
  const found = [];
  for (const r of cssRules(read('src/renderer/styles.css'))) {
    for (const [prop, value] of Object.entries(declarations(r.body))) {
      if (prop.startsWith('--')) continue; // это и есть палитра
      if (value.match(COLOR)) found.push(`${r.sel} { ${prop}: ${value} }`);
    }
  }
  ratchet(found, DESKTOP_TO_FIX, 'styles.css');
});

// --- десктоп и веб: из JS только координаты, размеры и данные ---------------------

/** Свойства, которые app.js вправе задавать сам: положение и размер того, что
 *  он раскладывает, и перезапуск анимации. Фон — только из данных (цвет
 *  проекта или тега), не строкой. */
const JS_STYLE_ALLOWED = new Set([
  'top', 'left', 'right', 'bottom', 'width', 'height', 'maxHeight', 'maxWidth', 'minWidth', 'minHeight',
  'transform', 'animation', 'animationDelay', 'background', 'backgroundColor',
]);

const JS_TO_FIX = [];

test('app.js: из кода — только координаты, размеры и цвета пользователя', () => {
  const found = [];
  read('src/renderer/app.js').split('\n').forEach((line) => {
    const t = line.trim();
    for (const m of t.matchAll(/\.style\.([a-zA-Z]+)\s*=([^=].*)$/g)) {
      const [, prop, rhs] = m;
      const literalColor = /^\s*['"`][^'"`]*(#[0-9a-fA-F]{3,8}\b|rgba?\()/.test(rhs);
      if (prop === 'cssText' || !JS_STYLE_ALLOWED.has(prop) || literalColor) found.push(t);
    }
    // В разметке строкой: каждое значение должно приходить из данных (${…}).
    for (const m of t.matchAll(/style="([^"]*)"/g)) {
      const literal = m[1].split(';').filter(Boolean).some((d) => !d.includes('${'));
      if (literal) found.push(t);
    }
    // Переменные — только с данными, не с цветом палитры строкой.
    if (/setProperty\(\s*['"]--[\w-]+['"]\s*,\s*['"`](#|rgb)/.test(t)) found.push(t);
  });
  ratchet(found, JS_TO_FIX, 'app.js');
});

// --- телефон: цвета только из theme.js -------------------------------------------

/** Законные исключения — с причиной. Ключ: файл и сам цвет. */
const MOBILE_LEGIT = {
  // Логотип Google на кнопке входа — фирменные цвета, темой не меняются.
  'components/AuthSheet.js "#4285F4"': 1,
  'components/AuthSheet.js "#34A853"': 1,
  'components/AuthSheet.js "#FBBC05"': 1,
  'components/AuthSheet.js "#EA4335"': 1,
  // Красный экран внутри WebView — сигнал, что Quill не загрузился. Это
  // страница внутри WebView, темы приложения она не знает.
  "components/RichTextEditor.js '#c0392b'": 3,
  // Прозрачный фон самого WebView, чтобы просвечивала тема.
  "components/RichTextEditor.js '#0000'": 1,
  // Тень панели вкладок чёрная в обеих темах.
  "navigation/MainTabBar.js '#000'": 1,
  // Подложка тега считается из цвета, который выбрал пользователь.
  'lib/tags.js rgba(${r}, ${g}, ${b}, ${alpha})': 1,
};

/** Предстоит заменить токенами темы. Пусто с 6 октября. */
const MOBILE_TO_FIX = {};

const expand = (o) => Object.entries(o).flatMap(([k, n]) => Array(n).fill(k));

test('телефон: цвета берутся из theme.js', () => {
  const base = path.join(ROOT, 'mobile', 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const found = [];
  for (const file of walk(base)) {
    const rel = path.relative(base, file).split(path.sep).join('/');
    // theme.js — сам источник; core/ — общая логика без отрисовки.
    if (!rel.endsWith('.js') || rel === 'theme.js' || rel.startsWith('core/')) continue;
    const s = fs.readFileSync(file, 'utf8');
    for (const m of s.matchAll(/['"]#[0-9a-fA-F]{3,8}['"]|rgba?\([^)]*\)/g)) found.push(`${rel} ${m[0]}`);
  }
  ratchet(found, [...expand(MOBILE_LEGIT), ...expand(MOBILE_TO_FIX)], 'телефон');
});

// --- карта не отстаёт от списков ----------------------------------------------------

test('DESIGN.md называет те же числа, что списки в этом тесте', () => {
  // Вчерашний урок со схемой архитектуры: число, которое правят руками,
  // забывают править. Вычеркнули отступление — таблица в карте обязана это
  // знать.
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const doc = read('DESIGN.md');
  const rows = [
    `| Цвета мимо палитры в \`styles.css\` | ${DESKTOP_TO_FIX.length} в списке «исправить» |`,
    `| Цвета мимо темы на телефоне | ${sum(MOBILE_LEGIT)} законных, ${sum(MOBILE_TO_FIX)} в списке «исправить» |`,
    `| Цвета и раскладка строкой из \`app.js\` | ${JS_TO_FIX.length} в списке «исправить» |`,
  ];
  for (const row of rows) assert.ok(doc.includes(row), `в DESIGN.md нет строки: ${row}`);
});

// --- после переезда ----------------------------------------------------------------

const LAYERS = ['Шрифты', 'Палитра', 'Основа', 'Компоненты', 'Каркас', 'Экраны'];

/** Общие детали приложения и их части. Растёт, когда деталь появляется на
 *  втором экране. `.empty` и `.ghost` в разметке встречаются ещё и как
 *  модификаторы чужих блоков (пустая клетка календаря, «призрак» будущего
 *  повторения) — такие правила детали не принадлежат, см. owns ниже. */
const COMPONENTS = [
  'primary', 'ghost', 'danger', 'icon-btn', 'icon-btn-accent', 'dp-btn', 'dp-btn-wide',
  'switch', 'switch-track', 'switch-thumb',
  'modal', 'modal-lg', 'modal-buttons', 'modal-error', 'ctx-menu', 'ctx-item', 'ctx-sep', 'ctx-check',
];

test('styles.css: слои по порядку, общие детали — только в слое «Компоненты»', () => {
  const css = read('src/renderer/styles.css');
  const marks = [...css.matchAll(/^\/\* =+ Слой: (.+?) =+ \*\/$/gm)];
  assert.deepEqual(marks.map((m) => m[1]), LAYERS, 'слои styles.css не на месте или не по порядку');
  // Правило принадлежит детали, если её класс — первый в первой части
  // селектора: `.switch`, `button.ghost`, `.modal-buttons button`. А
  // `.settings-row.switch` (строка, которая ведёт себя как переключатель) и
  // `.settings-page .switch` — подстройка экрана, ей место в экране.
  const owns = (sel) => sel.split(',').some((part) => {
    const first = part.trim().split(/\s*[ >+~]\s*/)[0];
    const m = first.match(/\.([\w-]+)/);
    return !!m && COMPONENTS.includes(m[1]);
  });
  const stray = [];
  marks.forEach((m, i) => {
    if (m[1] === 'Компоненты') return;
    const chunk = css.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : css.length);
    for (const r of cssRules(chunk)) if (owns(r.sel)) stray.push(`${m[1]}: ${r.sel}`);
  });
  assert.deepEqual(stray, [], 'общие детали описаны вне слоя «Компоненты»');
});

const LANDING_PAGES = ['index.html', 'blog.html', 'logs.html', 'architecture.html', 'graph.html'];

test('лендинг: общее — в landing.css, у страниц только своё', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'landing', 'landing.css')), 'landing/landing.css нет');
  for (const page of LANDING_PAGES) {
    const html = read(`landing/${page}`);
    assert.ok(html.includes('href="landing.css"'), `${page}: не подключает landing.css`);
    const own = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const bad = cssRules(own).filter((r) => /(^|,)\s*(:root|header|footer)\b/.test(r.sel)).map((r) => r.sel);
    assert.deepEqual(bad, [], `${page}: токены, шапка или подвал описаны в самой странице`);
  }
});

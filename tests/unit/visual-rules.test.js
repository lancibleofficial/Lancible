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

test('блок «Дизайн» на /architecture называет те же числа', () => {
  // Тот же урок, вторая копия: таблица «что сторожит тест» есть и на
  // странице архитектуры.
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const page = read('landing/architecture.html');
  assert.ok(page.includes('<div class="arch-sec" id="design">'), 'на /architecture нет блока «Дизайн»');
  const cells = [
    `Цвета мимо палитры в <code>styles.css</code></td><td class="mono">${DESKTOP_TO_FIX.length} в списке «исправить»</td>`,
    `Цвета мимо темы на телефоне</td><td class="mono">${sum(MOBILE_LEGIT)} законных, ${sum(MOBILE_TO_FIX)} в списке «исправить»</td>`,
    `Цвета и раскладка строкой из <code>app.js</code></td><td class="mono">${JS_TO_FIX.length} в списке «исправить»</td>`,
  ];
  for (const cell of cells) assert.ok(page.includes(cell), `на /architecture нет строки: ${cell}`);
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
  'st-swatch', 'task-status', 'board-dot', 'task-version',
  'segmented', 'segmented-sm', 'segmented-rows', 'segmented-row', 'field', 'field-sm',
  'period-head', 'period-nav', 'period-title', 'island', 'settings-card',
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

/** Куски styles.css по слоям: [[имя слоя, текст], …]. */
function layersOf(css) {
  const marks = [...css.matchAll(/^\/\* =+ Слой: (.+?) =+ \*\/$/gm)];
  return marks.map((m, i) => [m[1], css.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : css.length)]);
}

test('переключатель и поле ввода оформлены только в компонентах', () => {
  // До 6 октября сегментный переключатель был сделан заново семь раз, поле
  // ввода — четыре, каждый раз с чуть другими отступами и скруглением.
  // Теперь вид у каждой детали один, и он в слое «Компоненты». Признак
  // самодельной копии вне его: выбранная кнопка с фоном --tab-active-bg или
  // поле ввода, которому задают и заливку, и рамку.
  const isField = (sel) => sel.split(',').some((part) => {
    const subject = part.trim().split(/\s*[ >+~]\s*/).pop() || '';
    return /^(input|textarea)(\[[^\]]*\]|\.[\w-]+|:[\w-]+)*$/.test(subject);
  });
  const stray = [];
  for (const [layer, chunk] of layersOf(read('src/renderer/styles.css'))) {
    if (layer === 'Компоненты' || layer === 'Палитра') continue;
    for (const r of cssRules(chunk)) {
      if (/var\(--tab-active-bg\)/.test(r.body)) stray.push(`${layer}: ${r.sel} — переключатель`);
      if (isField(r.sel) && /(^|;)\s*background(-color)?\s*:/.test(r.body) && /(^|;)\s*border\s*:/.test(r.body)) {
        stray.push(`${layer}: ${r.sel} — поле ввода`);
      }
    }
  }
  assert.deepEqual(stray, [], 'вид переключателя или поля задан вне компонента — возьмите .segmented или .field');
});

test('поля ввода и текстовые кнопки скруглены одинаково', () => {
  // Стоят рядом — в модалках, в параметрах задачи, — и разное скругление
  // видно сразу: так и было, кнопки 8, поля 7. Значение одно на всех.
  const rules = cssRules(read('src/renderer/styles.css'));
  const radiusOf = (startsWith) => {
    const r = rules.find((x) => x.sel.startsWith(startsWith) && /border-radius/.test(x.body));
    assert.ok(r, `нет правила со скруглением: ${startsWith}…`);
    return declarations(r.body)['border-radius'];
  };
  const got = {
    'поле ввода (.field)': radiusOf('.field, .field-sm'),
    'кнопка ghost/danger': radiusOf('button.danger, button.ghost'),
    'кнопка модалки': radiusOf('.modal-buttons button'),
    'вторичная кнопка (.btn-soft)': radiusOf('.btn-soft'),
  };
  assert.equal(new Set(Object.values(got)).size, 1, `скругления разные: ${JSON.stringify(got)}`);
});

// --- редизайн 6 октября: палитра, шрифт, мелкий текст ------------------------------

test('светлая тема задана двумя одинаковыми блоками', () => {
  // Блоков два — по системе (prefers-color-scheme) и по выбору
  // (data-theme="light"), — и правят их по очереди. Разошлись — и у того,
  // кто выбрал светлую тему руками, она не та, что у того, кто живёт по
  // системе.
  const css = read('src/renderer/styles.css');
  const bySystem = css.match(/:root:not\(\[data-theme="dark"\]\):not\(\[data-theme="light"\]\) \{([^}]*)\}/);
  const byChoice = css.match(/^:root\[data-theme="light"\] \{([^}]*)\}/m);
  assert.ok(bySystem && byChoice, 'не нашёл одного из блоков светлой темы');
  assert.deepEqual(declarations(bySystem[1]), declarations(byChoice[1]));
});

test('зелёный текстом — через --accent-ink, а не --accent', () => {
  // На белом неоновый зелёный буквами не читается (контраст 1.4:1), поэтому
  // у текста и иконок свой токен. Заливка — кнопка, бегунок, полоска —
  // остаётся на --accent.
  const desktop = [];
  for (const r of cssRules(read('src/renderer/styles.css'))) {
    // --accent-hover и --running — тоже заливочные оттенки зелёного; текстом на
    // белом они читаются не лучше. Точка «таймер идёт» — знак, а не текст.
    const c = declarations(r.body).color;
    if (['var(--accent)', 'var(--accent-hover)', 'var(--running)'].includes(c) && r.sel !== '.running-dot') desktop.push(r.sel);
  }
  assert.deepEqual(desktop, [], 'styles.css: color: var(--accent) — возьмите var(--accent-ink)');

  // На телефоне: colors.accent допустим только заливкой, рамкой, дорожкой
  // тумблера и запасным цветом проекта.
  const base = path.join(ROOT, 'mobile', 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const fill = /backgroundColor|borderColor|trackColor|\.color (:|\|\|) colors\.accent/;
  const mobile = [];
  for (const file of walk(base)) {
    if (!file.endsWith('.js')) continue;
    read(path.relative(ROOT, file)).split('\n').forEach((line, i) => {
      if (/colors\.accent(Hover)?(?![A-Za-z])/.test(line) && !fill.test(line)) {
        mobile.push(`${path.relative(base, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(mobile, [], 'телефон: зелёный текстом или иконкой — возьмите colors.accentInk');
});

/** Мельче 12px — только то, что не читают как текст. */
const SMALL_TEXT_ALLOWED = [
  '.notif-badge', // цифра в кружке на колокольчике: кружок 16px
  '.running-dot', // точка «таймер идёт» — знак, а не надпись
];

test('styles.css: текст не мельче 12px', () => {
  // До редизайна мельче 12px были 74 правила — даты, суммы, подписи полей.
  // Вместе с тонким начертанием это и давало «всё бледное».
  const small = [];
  for (const r of cssRules(read('src/renderer/styles.css'))) {
    const size = declarations(r.body)['font-size'];
    const px = size && size.match(/^(\d+(?:\.\d+)?)px$/);
    if (px && +px[1] < 12) small.push(r.sel);
  }
  ratchet(small, SMALL_TEXT_ALLOWED, 'мелкий текст');
});

test('телефон: каждое начертание, которое называет код, загружено и лежит файлом', () => {
  // Опечатка в имени семейства на телефоне не падает: Android молча берёт
  // системный шрифт. Поэтому сверяем: всё, что называют AppText, тема и
  // таббар, есть среди ключей useFonts в App.js, и за каждым ключом — файл.
  const app = read('mobile/App.js');
  const loaded = new Map([...app.matchAll(/'([\w-]+)': require\('\.\/(assets\/fonts\/[^']+)'\)/g)].map((m) => [m[1], m[2]]));
  assert.ok(loaded.size >= 9, `в App.js нашлось ${loaded.size} начертаний — разбор сломался?`);
  for (const [name, file] of loaded) {
    assert.ok(fs.existsSync(path.join(ROOT, 'mobile', file)), `нет файла ${file} для ${name}`);
  }
  const named = new Set();
  for (const src of ['mobile/src/components/AppText.js', 'mobile/src/theme.js', 'mobile/src/navigation/MainTabs.ios.js']) {
    for (const m of read(src).matchAll(/'((?:Onest|BasiquePro|Gravity)-[\w]+)'/g)) named.add(m[1]);
  }
  const missing = [...named].filter((n) => !loaded.has(n));
  assert.deepEqual(missing, [], 'эти начертания называет код, но App.js их не загружает');
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

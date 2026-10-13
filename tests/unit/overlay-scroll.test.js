// Накладные полосы прокрутки: правила, записанные в коде. Запуск: npm run test:unit
//
// Полоса не занимает места, а рисуется поверх содержимого (attachOverlayScroll
// в app.js, вид — раздел «Скроллбар» в styles.css). Работает это, пока у каждой
// прокручиваемой области нативная полоса скрыта и подключена своя, а в
// раскладке экранов нет ни отступов под полосу, ни scrollbar-gutter. Всё это
// видно в исходниках, браузер не нужен: поведение на странице меряет
// tests/e2e/scrollbar.spec.js.
//
// Накладная полоса только вертикальная. Вбок листаются три ленты — ряд
// карточек «Проектов», дорожки доски и переключатель режимов «Времени» на
// узкой ширине, — и полосы у них нет вовсе: край, за которым есть что
// листать, растворяется, а у края стоит стрелка («Край ленты» в styles.css,
// attachScrollEdges и список EDGE_AREAS в app.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules, declarations } = require('../css');

const ROOT = path.join(__dirname, '..', '..');
const js = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
const responsive = fs.readFileSync(path.join(ROOT, 'web', 'responsive.css'), 'utf8');
const rules = cssRules(css);

/** Селекторы из списка OVS_AREAS в app.js. */
const AREAS = (() => {
  const m = js.match(/const OVS_AREAS = \[([\s\S]*?)\]\.join/);
  assert.ok(m, 'в app.js нет списка OVS_AREAS');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();

/** Ленты, что листаются вбок: список EDGE_AREAS в app.js. */
const EDGE_SRC = (() => {
  const m = js.match(/const EDGE_AREAS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'в app.js нет списка EDGE_AREAS');
  return [...m[1].matchAll(/\{([^}]*)\}/g)].map((x) => ({
    box: (x[1].match(/box:\s*'([^']+)'/) || [])[1],
    arrows: /arrows:\s*true/.test(x[1]),
  }));
})();
const EDGES = EDGE_SRC.map((e) => e.box);

/** Простые селекторы последнего составного: «.a.b», «#c», «textarea». */
const tokens = (sel) => {
  const last = sel.trim().split(/[\s>+~]+/).pop();
  return last.match(/[#.]?[\w-]+/g) || [];
};

/** Область списка подходит, если все её простые селекторы есть у правила. */
const covered = (sel, list = [...AREAS, ...EDGES]) => {
  const have = new Set(tokens(sel));
  return list.some((a) => tokens(a).every((t) => have.has(t)));
};

test('любой overflow: auto/scroll из styles.css есть в списке накладных полос или краёв лент', () => {
  const missing = [];
  for (const r of rules) {
    // Телефонная ширина веба — страницы листаются пальцем, накладная там скрыта.
    if (r.at.includes('max-width: 560px')) continue;
    const d = declarations(r.body);
    const scrolls = ['overflow', 'overflow-x', 'overflow-y'].some((k) => /\b(auto|scroll)\b/.test(d[k] || ''));
    if (!scrolls) continue;
    for (const sel of r.sel.split(',').map((s) => s.trim())) {
      if (sel.includes('::')) continue;
      // Внутренности текста редактора и его подсказки — нативная полоса; страница документа (.led-scroll) — наша.
      if (/\.led-/.test(sel) && !/\.led-scroll\b/.test(sel)) continue;
      if (!covered(sel)) missing.push(sel);
    }
  }
  assert.deepEqual(missing, [], 'прокручиваемые области без накладной полосы: добавьте селектор в OVS_AREAS (вниз) или EDGE_AREAS (вбок) в app.js');
});

test('места под полосу нигде не резервируют: ни scrollbar-gutter, ни вычитания --sb из отступов', () => {
  const gutter = rules.filter((r) => /scrollbar-gutter/.test(r.body)).map((r) => r.sel);
  assert.deepEqual(gutter, [], 'scrollbar-gutter возвращает жёлоб под полосу');
  // --sb — зона дорожки накладной полосы (.ovs-*), и больше нигде.
  const stray = rules
    .filter((r) => /var\(--sb\)/.test(r.body) && !r.sel.split(',').every((s) => /\.ovs-/.test(s)))
    .map((r) => r.sel);
  assert.deepEqual(stray, [], '--sb в раскладке: отступ под полосу, которой в раскладке нет');
  assert.doesNotMatch(responsive, /scrollbar-gutter|var\(--sb\)|--sb\s*:/, 'и в responsive.css тоже');
});

test('нативная полоса у подключённых областей скрыта; цвет дорожки — токены', () => {
  const hide = rules.find((r) => r.sel === '[data-ovs]');
  assert.ok(hide, 'нет правила [data-ovs]');
  const d = declarations(hide.body);
  assert.equal(d['scrollbar-width'], 'none');
  assert.equal(d['overflow-x'], 'hidden', 'вбок область не едет, пока не сказано иное');
  const thumb = rules.find((r) => r.sel === '.ovs-thumb');
  assert.equal(declarations(thumb.body).background, 'var(--scrollbar)');
  const hot = rules.find((r) => r.sel.includes('.ovs-track:hover .ovs-thumb'));
  assert.equal(declarations(hot.body).background, 'var(--scrollbar-hover)');
  // Дорожка поверх всего приложения и не ловит мышь, пока не показана.
  const track = declarations(rules.find((r) => r.sel === '.ovs-track').body);
  assert.equal(track.position, 'fixed');
  assert.equal(track.visibility, 'hidden');
});

test('дорожка мышь не ловит, ловит только бегунок: щелчок по строке у правого края доходит до строки', () => {
  // Замечание ревью 11 октября 2026: видимая дорожка в 10 px у края гасила все
  // щелчки в правых 10 px строки списка и пункта длинного меню.
  const track = declarations(rules.find((r) => r.sel === '.ovs-track').body);
  assert.equal(track['pointer-events'], 'none');
  const thumb = declarations(rules.find((r) => r.sel === '.ovs-thumb').body);
  assert.equal(thumb['pointer-events'], 'auto');
  // Листания страницами щелчком по дорожке нет: дорожка до щелчка не доходит.
  assert.ok(!js.includes('(at < rect.top ? -1 : 1) * box.clientHeight'), 'в app.js осталось листание щелчком по дорожке');
});

test('под prefers-reduced-motion накладная полоса появляется без перехода', () => {
  const r = rules.find((x) => x.at.includes('prefers-reduced-motion') && x.sel.includes('.ovs-track'));
  assert.ok(r, 'нет правила для reduced-motion');
  assert.equal(declarations(r.body).transition, 'none');
});

test('на телефонной ширине веба накладной полосы нет', () => {
  const m = cssRules(responsive).find((r) => r.at.includes('max-width: 560px') && r.sel === '.ovs-track');
  assert.ok(m, 'в responsive.css нет правила .ovs-track для ≤560px');
  assert.equal(declarations(m.body).display, 'none');
});

test('старая полоса на классах (.scroll-hover, .is-scrolling) убрана целиком', () => {
  assert.doesNotMatch(js, /scroll-hover|is-scrolling/);
  assert.doesNotMatch(css, /scroll-hover|is-scrolling/);
});

test('накладная полоса только вертикальная: горизонтальной дорожки нет ни в коде, ни в стилях', () => {
  assert.doesNotMatch(js, /OVS_AXES|dataset\.axis|data-axis/, 'в app.js осталась ось дорожки');
  assert.doesNotMatch(css, /data-axis/, 'в styles.css осталось правило по оси дорожки');
  assert.doesNotMatch(js, /const OVS_AREAS = \[[^\]]*'\.projects-deck'/,'ряд карточек в накладной полосе: он листается вбок, а вниз не едет');
});

test('вбок листаются только ленты, подключённые к «краю ленты»', () => {
  // overflow-x: auto/scroll без оговорки — это лента, и у неё должна быть стрелка
  // и растворение края, а не полоса. Внутренности текста редактора — нативные.
  const loose = [];
  for (const r of rules) {
    if (r.at.includes('max-width: 560px')) continue;
    const d = declarations(r.body);
    if (!/\b(auto|scroll)\b/.test(d['overflow-x'] || '')) continue;
    for (const sel of r.sel.split(',').map((s) => s.trim())) {
      if (sel.includes('::') || /\.led-/.test(sel)) continue;
      if (!covered(sel, EDGES)) loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'лента, что листается вбок, не подключена к краю: добавьте её в EDGE_AREAS (app.js)');
  assert.ok(EDGES.length >= 3, 'лент мало: ряд карточек, доска, переключатель режимов');
});

test('ленты со стрелками лежат в обёртке .edge-host в обеих разметках, а в шапке «Проектов» стрелок нет', () => {
  const arrowed = EDGE_SRC.filter((e) => e.arrows).map((e) => e.box.slice(1));
  assert.ok(arrowed.length >= 2, 'стрелки есть у ряда карточек и у доски');
  for (const file of ['src/renderer/index.html', 'web/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const wrapped = [...html.matchAll(/<div class="edge-host[^"]*">\s*<div class="([^"]*)"/g)].map((m) => m[1].split(' '));
    for (const cls of arrowed) assert.ok(wrapped.some((c) => c.includes(cls)), `${file}: .${cls} не лежит в .edge-host`);
    assert.doesNotMatch(html, /deck-prev|deck-next/, `${file}: стрелок в шапке «Проектов» больше нет`);
  }
});

test('край ленты: маска на самой ленте, растворение — два плавных свойства, нативная полоса погашена', () => {
  for (const name of ['--edge-l', '--edge-r']) {
    assert.match(css, new RegExp(`@property ${name} \\{[^}]*syntax: '<length>'[^}]*inherits: false`), `нет @property ${name}: без него переход по длине не идёт`);
  }
  const scroll = rules.find((r) => r.sel === '.edge-scroll');
  assert.ok(scroll, 'нет правила .edge-scroll');
  assert.equal(declarations(scroll.body)['scrollbar-width'], 'none');
  assert.equal(declarations(rules.find((r) => r.sel === '.edge-scroll::-webkit-scrollbar').body).display, 'none');
  const mask = declarations(rules.find((r) => r.sel === '.edge-scroll[data-edge]').body);
  assert.match(mask['mask-image'], /^linear-gradient\(to right,.*var\(--edge-l\).*var\(--edge-r\)/, 'маска — градиент по краям ленты');
  assert.match(mask.transition, /--edge-l/);
  assert.match(mask.transition, /--edge-r/);
  // Какой край растворять, решает атрибут data-edge: «l», «r» или «l r».
  assert.ok(rules.some((r) => r.sel === '.edge-scroll[data-edge~="l"]' && /--edge-l: var\(--edge-size\)/.test(r.body)));
  assert.ok(rules.some((r) => r.sel === '.edge-scroll[data-edge~="r"]' && /--edge-r: var\(--edge-size\)/.test(r.body)));
});

test('стрелка края: подложка, тень и подпись — из токенов; в покое скрыта, показана — с .on', () => {
  const btn = declarations(rules.find((r) => r.sel === '.edge-btn').body);
  assert.match(btn.background, /var\(--raise\)/, 'подложка — токен --raise');
  assert.equal(btn['box-shadow'], 'var(--shadow-pop)');
  assert.equal(btn.color, 'var(--text-dim)');
  assert.equal(btn.visibility, 'hidden', 'без .on стрелка не видна и в фокус не попадает');
  assert.equal(declarations(rules.find((r) => r.sel === '.edge-btn.on').body).visibility, 'visible');
  assert.ok(rules.some((r) => r.sel === '.edge-btn:focus-visible' && /outline/.test(r.body)), 'у клавиатурного фокуса есть контур');
  const calm = rules.find((r) => r.at.includes('prefers-reduced-motion') && r.sel.includes('.edge-btn'));
  assert.ok(calm, 'нет правила для reduced-motion');
  assert.equal(declarations(calm.body).transition, 'none');
  // Узкий веб: стрелок нет (ленту листают пальцем), растворение уже.
  const phone = cssRules(responsive).filter((r) => r.at.includes('max-width: 560px'));
  assert.ok(phone.some((r) => r.sel.split(',').map((s) => s.trim()).includes('.edge-btn') && declarations(r.body).display === 'none'), 'в responsive.css нет .edge-btn { display: none } для ≤560px');
  assert.ok(phone.some((r) => r.sel === '.edge-scroll' && /--edge-size: 28px/.test(r.body)));
});

test('подписи стрелок края переведены на четыре языка', () => {
  const I = require('../../src/renderer/core/i18n.js');
  for (const l of Object.keys(I.T)) {
    for (const key of ['common.scroll_left', 'common.scroll_right']) {
      assert.ok(I.T[l][key] && I.T[l][key].length > 3, `${l}: нет ${key}`);
    }
    assert.notEqual(I.T[l]['common.scroll_left'], I.T[l]['common.scroll_right'], `${l}: подписи влево и вправо совпали`);
  }
  assert.equal(I.T.ru['common.scroll_left'], 'Прокрутить влево');
  assert.equal(I.T.ru['common.scroll_right'], 'Прокрутить вправо');
});

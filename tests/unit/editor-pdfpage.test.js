// Страница PDF со слоями и «Сохранить как PDF» (17 октября 2026): чистые
// помощники и сама запись файла. Запуск: npm run test:unit
//
// Откуда взялось. Решение пользователя по PDF в редакторе: «слои + „заменить
// текст“, две волны»; волна 1 — слои поверх страницы (узел pdfpage,
// src/editor/pdfpage.js) и выгрузка в PDF через pdf-lib (src/editor/
// pdfwrite.js, ленивая сборка editor-pdf.js). Здесь — то, что видно без
// браузера: геометрия слоёв (pt ↔ px, перетаскивание и размер с упором в
// край страницы), данные слоёв (приведение в порядок, порядок наложения),
// перенос текста, перевод координат в PDF и сам файл — pdf-lib пишет его и
// в Node. Как это выглядит и ведёт себя под мышью и пальцем —
// tests/e2e/editor-pdfpage.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'editor');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'sample-2p.pdf');

/** pdfgeom.js, pdfwrite.js (с pdf-lib и шрифтом) и схема — одним CommonJS. */
function load() {
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "export * as G from './pdfgeom.js';",
        "export * as W from './pdfwrite.js';",
        "export { COLOR_KEYS, schema } from './schema.js';",
        "export * as C from './commands.js';",
        "export { EditorState, NodeSelection } from 'prosemirror-state';",
        "export * as D from './blockdrag.js';",
        "export * as P from './press.js';",
        "export * as T from './pdftext.js';",
      ].join('\n'),
      resolveDir: SRC,
      sourcefile: 'editor-pdfpage-test.js',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // Цель — Node CI (22), а не esnext: шрифты (loader binary) без цели
    // esbuild пишет голым Uint8Array.fromBase64, которого в Node 22 нет, —
    // 20 октября 2026 весь test:unit в CI обрывался на этом файле. Сборка
    // для приложения (scripts/build-editor.js) задаёт цель сама и получает
    // запасной путь.
    target: 'node22',
    write: false,
    logLevel: 'error',
    loader: { '.ttf': 'binary' },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const { G, W, COLOR_KEYS, schema, C, EditorState, NodeSelection, D, P, T } = load();
const PAGE = { w: 595, h: 842 };

// --- геометрия ---------------------------------------------------------------------

test('масштаб и перевод pt ↔ px: страница A4 в блоке шириной 297,5 px — полпикселя на пункт', () => {
  const s = G.scaleOf(297.5, 595);
  assert.equal(s, 0.5);
  assert.equal(G.ptToPx(100, s), 50);
  assert.equal(G.pxToPt(50, s), 100);
  assert.equal(G.scaleOf(0, 595), 1, 'блок без ширины — без деления на ноль');
});

test('перетаскивание: слой едет на dx, dy и упирается в край страницы', () => {
  const o = { x: 100, y: 100, w: 50, h: 20 };
  assert.deepEqual(G.moveBox(o, 10, -5, PAGE), { x: 110, y: 95, w: 50, h: 20 });
  assert.deepEqual(G.moveBox(o, -500, -500, PAGE), { x: 0, y: 0, w: 50, h: 20 }, 'за левый верхний край — нет');
  assert.deepEqual(G.moveBox(o, 1000, 1000, PAGE), { x: 545, y: 822, w: 50, h: 20 }, 'за правый нижний — нет');
  // Стрелка с отрицательной высотой — упирается всей рамкой.
  const a = { x: 10, y: 50, w: 100, h: -40 };
  assert.deepEqual(G.moveBox(a, -20, -20, PAGE), { x: 0, y: 40, w: 100, h: -40 });
});

test('размер за ручку: противоположная сторона стоит, упор в край и в наименьший размер', () => {
  const b = { x: 100, y: 100, w: 100, h: 50 };
  assert.deepEqual(G.resizeBox(b, 'se', 20, 10, PAGE), { x: 100, y: 100, w: 120, h: 60 });
  assert.deepEqual(G.resizeBox(b, 'nw', 20, 10, PAGE), { x: 120, y: 110, w: 80, h: 40 });
  assert.deepEqual(G.resizeBox(b, 'e', 5000, 0, PAGE), { x: 100, y: 100, w: 495, h: 50 }, 'за край страницы — упор');
  assert.deepEqual(G.resizeBox(b, 'w', 500, 0, PAGE), { x: 200 - G.MIN_PT, y: 100, w: G.MIN_PT, h: 50 }, 'меньше MIN_PT — нет');
  assert.deepEqual(G.resizeBox(b, 'n', 0, -500, PAGE), { x: 100, y: 0, w: 100, h: 150 });
  for (const hd of G.HANDLES) {
    const r = G.resizeBox(b, hd, 37, -23, PAGE);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= PAGE.w && r.y + r.h <= PAGE.h, `${hd}: рамка на странице`);
    assert.ok(r.w >= G.MIN_PT && r.h >= G.MIN_PT, `${hd}: не меньше наименьшего`);
  }
});

test('картинка за угол держит пропорцию; за сторону — тянется', () => {
  const b = { x: 100, y: 100, w: 200, h: 100 };
  const r = G.resizeBox(b, 'se', 100, 0, PAGE, { ratio: true });
  assert.equal(r.w, 300);
  assert.equal(r.h, 150);
  const nw = G.resizeBox(b, 'nw', -100, 0, PAGE, { ratio: true });
  assert.deepEqual(nw, { x: 0, y: 50, w: 300, h: 150 }, 'нижний правый угол на месте');
  assert.deepEqual(G.resizeBox(b, 'e', 50, 0, PAGE, { ratio: true }), { x: 100, y: 100, w: 250, h: 100 });
});

test('концы стрелки — каждый за свою ручку, точки на странице', () => {
  const a = { x: 100, y: 100, w: 100, h: 0 };
  assert.deepEqual(G.moveArrowEnd(a, 'b', 0, 50, PAGE), { x: 100, y: 100, w: 100, h: 50 });
  assert.deepEqual(G.moveArrowEnd(a, 'a', -500, 0, PAGE), { x: 0, y: 100, w: 200, h: 0 });
  assert.deepEqual(G.moveArrowEnd(a, 'b', 900, 0, PAGE), { x: 100, y: 100, w: 495, h: 0 });
});

test('стрелки клавиатуры: 1 pt, с Shift — 10, у края — упор', () => {
  const o = { x: 5, y: 5, w: 10, h: 10 };
  assert.deepEqual(G.nudge(o, 'ArrowRight', false, PAGE), { x: 6, y: 5, w: 10, h: 10 });
  assert.deepEqual(G.nudge(o, 'ArrowDown', true, PAGE), { x: 5, y: 15, w: 10, h: 10 });
  assert.deepEqual(G.nudge(o, 'ArrowLeft', true, PAGE), { x: 0, y: 5, w: 10, h: 10 });
  assert.equal(G.nudge(o, 'Enter', false, PAGE), null);
});

// --- данные слоёв ------------------------------------------------------------------------

test('цвета слоёв — те же имена, что палитра редактора, и «ink»', () => {
  assert.deepEqual(G.HUES, COLOR_KEYS);
  assert.deepEqual(G.OV_COLORS, ['ink', ...COLOR_KEYS]);
});

test('слой приводится в порядок: мусор выброшен, рамка на странице, цвета из палитры', () => {
  const list = G.normalizeOverlays([
    null, 'x', { type: 'circle', x: 1 },
    { id: 'a', type: 'text', x: -20, y: 5, w: 100, h: 20, text: 'Привет\r\nмир', font: { size: 999, weight: 'heavy', color: '#f00' } },
    { id: 'a', type: 'rect', x: 10.04, y: 10.06, w: 50, h: 50, stroke: { color: 'blue', width: 0 } },
    { id: 'b', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'javascript:alert(1)' },
    { id: 'c', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'asset:abc' },
    { id: 'd', type: 'highlight', x: 0, y: 0, w: 1000, h: 10, fill: { color: 'ink', opacity: 7 } },
    { id: 'e', type: 'whiteout', x: 590, y: 800, w: 100, h: 100 },
    { id: 'f', type: 'arrow', x: 10, y: 10, w: -50, h: 900 },
  ], PAGE);
  assert.deepEqual(list.map((o) => o.type), ['text', 'rect', 'image', 'highlight', 'whiteout', 'arrow']);
  const [text, rect, image, hl, wo, arrow] = list;
  assert.deepEqual({ x: text.x, text: text.text, font: text.font }, { x: 0, text: 'Привет\nмир', font: { size: G.FONT_MAX, weight: 'normal', color: 'ink' } });
  assert.notEqual(rect.id, 'a', 'повторный номер заменён');
  assert.deepEqual({ x: rect.x, y: rect.y, stroke: rect.stroke }, { x: 10, y: 10.1, stroke: { color: 'blue', width: 0.5 } });
  assert.equal(image.src, 'asset:abc', 'картинка — только из хранилища или по адресу; javascript: — нет');
  assert.deepEqual({ w: hl.w, fill: hl.fill }, { w: 595, fill: { color: 'yellow', opacity: 1 } });
  assert.deepEqual({ x: wo.x, y: wo.y }, { x: 495, y: 742 }, 'замазка у края — внутрь страницы');
  assert.deepEqual({ x: arrow.x, y: arrow.y, w: arrow.w, h: arrow.h }, { x: 10, y: 10, w: -10, h: 832 }, 'концы стрелки — на странице');
  // Слой без номера получает номер по месту — тот же при каждом чтении:
  // вид перечитывает слои на каждую отрисовку.
  const bare = [{ type: 'rect', x: 1, y: 1, w: 10, h: 10 }, { type: 'rect', x: 1, y: 1, w: 10, h: 10 }];
  const ids = G.normalizeOverlays(bare, PAGE).map((o) => o.id);
  assert.deepEqual(G.normalizeOverlays(bare, PAGE).map((o) => o.id), ids);
  assert.equal(new Set(ids).size, 2);
});

test('приведение в порядок ничего не меняет второй раз и переживает JSON', () => {
  const raw = [
    G.newOverlay('text', PAGE, { attrs: { text: 'Слой' } }),
    G.newOverlay('rect', PAGE, { at: { x: 590, y: 5 } }),
    G.newOverlay('arrow', PAGE),
    G.newOverlay('highlight', PAGE),
    G.newOverlay('whiteout', PAGE),
    G.newOverlay('image', PAGE, { attrs: { src: 'asset:x' } }),
  ];
  const once = G.normalizeOverlays(raw, PAGE);
  assert.equal(once.length, 6);
  assert.deepEqual(G.normalizeOverlays(JSON.parse(JSON.stringify(once)), PAGE), once);
  const rect = once[1];
  assert.ok(rect.x + rect.w <= PAGE.w, 'новый слой у края — целиком на странице');
});

test('порядок наложения: на передний план — в конец, назад — в начало', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(G.toFront(list, 'a').map((o) => o.id), ['b', 'c', 'a']);
  assert.deepEqual(G.toBack(list, 'c').map((o) => o.id), ['c', 'a', 'b']);
  assert.deepEqual(G.toFront(list, 'zz').map((o) => o.id), ['a', 'b', 'c']);
  assert.deepEqual(G.removeOverlay(list, 'b').map((o) => o.id), ['a', 'c']);
  assert.deepEqual(list.map((o) => o.id), ['a', 'b', 'c'], 'исходный список не трогается');
});

test('перенос текста: по словам, длинное слово — по буквам, абзацы не слипаются', () => {
  const m = (s) => s.length; // одна буква — одна единица
  assert.deepEqual(G.wrapText('раз два три четыре', 8, m), ['раз два', 'три', 'четыре']);
  assert.deepEqual(G.wrapText('ааааааааааа', 4, m), ['аааа', 'аааа', 'ааа']);
  assert.deepEqual(G.wrapText('строка\n\nещё', 20, m), ['строка', '', 'ещё']);
  assert.deepEqual(G.wrapText('  отступ', 20, m), ['  отступ'], 'пробелы в начале абзаца остаются');
  assert.deepEqual(G.wrapText('', 20, m), ['']);
});

test('в PDF ось y вверх: рамка и точка переводятся от низа видимой области', () => {
  const box = { x: 0, y: 0, width: 595, height: 842 };
  assert.deepEqual(G.pdfRect({ x: 10, y: 20, w: 100, h: 30 }, box), { x: 10, y: 792, width: 100, height: 30 });
  assert.deepEqual(G.pdfRect({ x: 10, y: 20, w: 100, h: 30 }, { x: 5, y: 7, width: 595, height: 842 }), { x: 15, y: 799, width: 100, height: 30 });
  assert.deepEqual(G.pdfPoint(0, 0, box), { x: 0, y: 842 });
  // Поворот страницы: содержимое ложится на лист видимого размера.
  assert.deepEqual(G.rotatedPlacement(0, 595, 842), { x: 0, y: 0, rotate: 0 });
  assert.deepEqual(G.rotatedPlacement(90, 595, 842), { x: 0, y: 595, rotate: -90 });
  assert.deepEqual(G.rotatedPlacement(180, 595, 842), { x: 595, y: 842, rotate: 180 });
  assert.deepEqual(G.rotatedPlacement(270, 595, 842), { x: 842, y: 0, rotate: 90 });
});

test('цвет токена (#rgb, #rrggbb, rgb, rgba) → доли; мусор — null', () => {
  assert.deepEqual(G.parseCssColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(G.parseCssColor('#000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(G.parseCssColor('rgba(255, 0, 0, 0.5)'), { r: 1, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(G.parseCssColor('rgb(0 0 255 / 50%)'), { r: 0, g: 0, b: 1, a: 0.5 });
  assert.equal(G.parseCssColor('var(--x)'), null);
});

// --- узел и команды ----------------------------------------------------------------------

test('узел pdfpage: атрибуты по проекту, lines — на волну 2', () => {
  const spec = schema.nodes.pdfpage.spec;
  assert.deepEqual(Object.keys(spec.attrs), ['bid', 'src', 'page', 'w', 'h', 'preview', 'overlays', 'lines']);
  assert.equal(spec.atom, true);
  assert.equal(spec.group, 'block');
  const n = schema.nodeFromJSON({ type: 'pdfpage', attrs: { src: 'asset:p', page: 2, w: 595, h: 842, preview: 'asset:v', overlays: [{ id: 'a', type: 'whiteout', x: 1, y: 2, w: 3, h: 4 }] } });
  assert.deepEqual(schema.nodeFromJSON(n.toJSON()).toJSON(), n.toJSON());
  assert.equal(n.attrs.lines, null);
});

test('«Выше» и «Ниже»: блок верхнего уровня меняется местами с соседом, картинка остаётся выделенной', () => {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'один' }] },
    { type: 'image', attrs: { src: 'asset:i' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'два' }] },
  ] });
  let state = EditorState.create({ doc });
  const imgPos = doc.child(0).nodeSize;
  const run = (cmd) => cmd(state, (tr) => { state = state.apply(tr); });
  assert.equal(run(C.moveBlockAt(imgPos, -1)), true);
  assert.deepEqual(state.doc.content.content.map((n) => n.type.name), ['image', 'paragraph', 'paragraph']);
  assert.ok(state.selection instanceof NodeSelection && state.selection.node.type.name === 'image');
  assert.equal(run(C.moveBlockAt(0, -1)), false, 'выше первого — некуда');
  // Перенос за ручку: в промежуток после последнего блока.
  assert.equal(run(C.moveBlockTo(0, state.doc.content.size)), true);
  assert.deepEqual(state.doc.content.content.map((n) => n.type.name), ['paragraph', 'paragraph', 'image']);
  assert.equal(run(C.moveBlockTo(state.doc.content.size - state.doc.lastChild.nodeSize, state.doc.content.size)), false, 'на своё же место — ничего');
});

test('перенос пальцем: долгое нажатие 350 мс, допуск 8 px; у края окна — автопрокрутка', () => {
  assert.equal(P.LONG_PRESS_MS, 350);
  assert.equal(P.TOUCH_SLOP, 8);
  const [top, bottom] = [0, 640];
  assert.equal(D.autoScrollStep(320, top, bottom), 0, 'посередине — стоит');
  assert.equal(D.autoScrollStep(top + D.EDGE_PX + 1, top, bottom), 0);
  assert.equal(D.autoScrollStep(top, top, bottom), -D.SCROLL_MAX, 'у самого верха — вверх быстрее всего');
  assert.equal(D.autoScrollStep(bottom, top, bottom), D.SCROLL_MAX);
  const near = D.autoScrollStep(bottom - D.EDGE_PX / 2, top, bottom);
  assert.ok(near > 0 && near < D.SCROLL_MAX, 'ближе к краю — быстрее');
});

// --- «Заменить текст» (волна 2) --------------------------------------------------------

/** Элемент getTextContent: текст, кегль, база (x, y — в осях PDF, y вверх). */
const item = (str, x, y, size, width) => ({ str, transform: [size, 0, 0, size, x, y], width: width == null ? str.length * size * 0.5 : width, height: size });
const VIEWPORT = [1, 0, 0, -1, 0, 842]; // A4 без поворота: y видимой страницы = 842 − y PDF

test('строки страницы: по базе, в pt видимой страницы от верха; колонки — разные строки; наклонный текст — мимо', () => {
  const lines = T.pageLines([
    item('Договор поставки', 72, 770, 20, 180),
    item('Сторона один', 72, 700, 12, 80), item(' и два', 152, 700, 12, 36),
    item('Колонка справа', 400, 700, 12, 90),
    { str: 'Наклон', transform: [8, 8, -8, 8, 300, 300], width: 40 },
    { str: '   ', transform: [12, 0, 0, 12, 72, 650], width: 10 },
  ], VIEWPORT);
  assert.deepEqual(lines.map((l) => l.text), ['Договор поставки', 'Сторона один и два', 'Колонка справа']);
  const [h1, row] = lines;
  // База заголовка — 842 − 770 = 72 pt от верха; верх строки — на LINE_ASC кегля выше.
  assert.equal(T.LINE_ASC, G.LINE_ASC);
  assert.deepEqual(h1, { x: 72, y: 72 - T.LINE_ASC * 20, w: 180, h: (T.LINE_ASC + T.LINE_DESC) * 20, size: 20, text: 'Договор поставки' });
  assert.deepEqual({ x: row.x, w: row.w, size: row.size }, { x: 72, w: 116, size: 12 });
  assert.deepEqual(T.pageLines([], VIEWPORT), []);
});

test('строка под точкой — по координатам; мимо строк — null; из двух — чья середина ближе', () => {
  const lines = G.normalizeLines([
    { x: 72, y: 100, w: 200, h: 14, size: 12, text: 'Первая' },
    { x: 72, y: 115, w: 200, h: 14, size: 12, text: 'Вторая' },
    { x: 1, y: 1, w: 0, h: 5, size: 5, text: 'нулевая ширина' },
    { x: 1, y: 1, w: 5, h: 5, size: 5, text: '   ' },
  ], PAGE);
  assert.equal(lines.length, 2, 'мусор выброшен');
  assert.equal(G.lineAt(lines, 100, 105).text, 'Первая');
  assert.equal(G.lineAt(lines, 100, 124).text, 'Вторая');
  assert.equal(G.lineAt(lines, 100, 114.5, 2).text, 'Первая', 'между строк — ближняя по середине');
  assert.equal(G.lineAt(lines, 400, 105), null);
  assert.equal(G.lineAt(lines, 100, 300), null);
  assert.equal(G.normalizeLines(null, PAGE), null, 'строк ещё нет — null, а не пусто');
});

test('замена строки — замазка с запасом 1 pt и текст тем же кеглем на той же базе', () => {
  const line = { x: 72, y: 100, w: 180, h: 13.8, size: 12, text: 'Сумма: 1000 ₸' };
  const [white, text] = G.replaceOverlays(line, PAGE);
  assert.deepEqual({ type: white.type, x: white.x, y: white.y, w: white.w, h: white.h }, { type: 'whiteout', x: 71, y: 99, w: 182, h: 15.8 });
  assert.equal(text.type, 'text');
  assert.equal(text.text, 'Сумма: 1000 ₸');
  assert.deepEqual(text.font, { size: 12, weight: 'normal', color: 'ink' });
  // База текстового слоя (верх + TEXT_BASELINE кегля) — база строки (верх + LINE_ASC кегля).
  assert.ok(Math.abs(text.y + G.TEXT_BASELINE * 12 - (line.y + G.LINE_ASC * 12)) <= 0.1);
  assert.ok(text.w >= line.w, 'шире строки: Onest бывает шире исходного шрифта');
  assert.notEqual(white.id, text.id);
});

test('база текстового слоя — по метрикам самого Onest из TTF', () => {
  const fontkit = require('@pdf-lib/fontkit');
  for (const f of ['Onest-Regular.ttf', 'Onest-Bold.ttf']) {
    const font = fontkit.create(fs.readFileSync(path.join(SRC, 'fonts', f)));
    assert.equal(font.ascent / font.unitsPerEm, G.ONEST_ASC, f);
    assert.equal(font.descent / font.unitsPerEm, G.ONEST_DESC, f);
  }
  // Та же база у выгрузки: pdfwrite.js считает её от метрик шрифта.
  const m = { asc: G.ONEST_ASC, desc: G.ONEST_DESC };
  assert.ok(Math.abs(W.baselineAt(0, 0, 10, G.LINE_HEIGHT, m) - G.TEXT_BASELINE * 10) < 1e-9);
});

// --- файл ----------------------------------------------------------------------------------

const BLACK = { r: 0.11, g: 0.12, b: 0.13, a: 1 };
const COLORS = {
  ink: BLACK, paper: { r: 1, g: 1, b: 1, a: 1 },
  c: Object.fromEntries(COLOR_KEYS.map((k) => [k, { r: 0.8, g: 0.2, b: 0.1, a: 1 }])),
  hl: Object.fromEntries(COLOR_KEYS.map((k) => [k, { r: 1, g: 0.95, b: 0.6, a: 1 }])),
};
/** Картинка 2 × 2 PNG (красная) — слой-картинка и картинка в тексте. */
function tinyPng() {
  const zlib = require('node:zlib');
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 бит, RGB
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = tinyPng();

async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false, verbosity: 0, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    pages.push({ w: Math.round(vp.width), h: Math.round(vp.height), text: tc.items.map((it) => it.str).join(' ') });
  }
  await task.destroy();
  return pages;
}

test('файл: страницы PDF копиями исходника, слои поверх, остальное — на A4; текст слоя в содержимом', async () => {
  const src = fs.readFileSync(FIXTURE);
  const overlays = [
    { id: 'w', type: 'whiteout', x: 60, y: 60, w: 120, h: 30 },
    { id: 't', type: 'text', x: 72, y: 300, w: 300, h: 20, text: 'Слой ТЕКСТ қазақ ї', font: { size: 14, weight: 'bold', color: 'ink' } },
    { id: 'r', type: 'rect', x: 50, y: 400, w: 100, h: 60, stroke: { color: 'red', width: 2 } },
    { id: 'a', type: 'arrow', x: 200, y: 400, w: 100, h: 50, stroke: { color: 'blue', width: 3 } },
    { id: 'h', type: 'highlight', x: 70, y: 100, w: 200, h: 16, fill: { color: 'yellow', opacity: 1 } },
    { id: 'i', type: 'image', x: 400, y: 600, w: 60, h: 60, src: 'asset:png' },
  ];
  const plan = {
    title: 'Проверка', lang: 'ru', colors: COLORS,
    sources: { 'asset:pdf': new Uint8Array(src) },
    images: { 'asset:png': { bytes: new Uint8Array(PNG), type: 'png', w: 2, h: 2 } },
    sections: [
      { kind: 'pdf', src: 'asset:pdf', page: 1, w: 595, h: 842, overlays },
      { kind: 'pdf', src: 'asset:pdf', page: 2, w: 595, h: 842, overlays: [] },
      { kind: 'flow', blocks: [
        { t: 'h', level: 1, runs: [{ text: 'Заметки к договору' }] },
        { t: 'p', runs: [{ text: 'Обычный ' }, { text: 'жирный', bold: true }, { text: ' и наклонный', italic: true }] },
        { t: 'li', depth: 1, marker: '•', runs: [{ text: 'пункт списка' }] },
        { t: 'li', depth: 1, marker: 'check', checked: true, runs: [{ text: 'сделано' }] },
        { t: 'table', rows: [{ cells: ['Час', 'Сумма'], header: true }, { cells: ['2', '100'], header: false }] },
        { t: 'img', image: 'asset:png' },
        { t: 'hr' },
        { t: 'code', text: 'const x = 1;' },
      ] },
      { kind: 'flow', blocks: [{ t: 'p', runs: [{ text: '' }] }] },
    ],
  };
  const res = await W.writePdf(plan);
  assert.equal(res.pages, 3, 'две страницы PDF и одна страница текста; пустой хвост — без листа');
  assert.equal(res.rasterized, 0);
  const { PDFDocument } = require('pdf-lib');
  const back = await PDFDocument.load(res.bytes);
  assert.equal(back.getPageCount(), 3);
  assert.equal(back.getTitle(), 'Проверка');
  const pages = await pdfText(res.bytes);
  assert.deepEqual(pages.map((p) => [p.w, p.h]), [[595, 842], [595, 842], [595, 842]]);
  assert.match(pages[0].text, /Lancible PDF test/, 'исходная страница — копия, со своим текстом');
  assert.match(pages[0].text.replace(/\s+/g, ' '), /Слой ТЕКСТ қазақ ї/, 'текст слоя — в содержимом страницы, кириллицей');
  assert.match(pages[1].text, /Page two heading/);
  assert.match(pages[2].text, /Заметки к договору/);
  assert.match(pages[2].text.replace(/\s+/g, ' '), /Обычный жирный и наклонный/);
});

test('файл: повёрнутая страница — на лист своего видимого размера; нет исходника — из превью картинкой', async () => {
  const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
  const turned = await PDFDocument.create();
  const tp = turned.addPage([595, 842]);
  tp.drawText('Rotated source', { x: 72, y: 700, size: 18, font: await turned.embedFont(StandardFonts.Helvetica) });
  tp.setRotation(degrees(90));
  const bytes = await turned.save();
  const res = await W.writePdf({
    colors: COLORS,
    sources: { 'asset:t': bytes, 'asset:gone': null },
    images: { 'asset:prev': { bytes: new Uint8Array(PNG), type: 'png', w: 2, h: 2 } },
    sections: [
      { kind: 'pdf', src: 'asset:t', page: 1, w: 842, h: 595, overlays: [{ id: 't', type: 'text', x: 20, y: 20, w: 400, h: 20, text: 'Поверх повёрнутой', font: { size: 12, weight: 'normal', color: 'ink' } }] },
      { kind: 'pdf', src: 'asset:gone', page: 1, w: 595, h: 842, preview: 'asset:prev', overlays: [{ id: 'x', type: 'text', x: 20, y: 20, w: 400, h: 20, text: 'Поверх превью', font: { size: 12, weight: 'normal', color: 'ink' } }] },
    ],
  });
  assert.equal(res.pages, 2);
  assert.equal(res.rasterized, 1, 'страница без исходника — картинкой, редактор предупредит');
  const pages = await pdfText(res.bytes);
  assert.deepEqual(pages.map((p) => [p.w, p.h]), [[842, 595], [595, 842]]);
  assert.match(pages[0].text, /Rotated source/, 'содержимое повёрнутой страницы — на месте, вектором');
  assert.match(pages[0].text, /Поверх повёрнутой/);
  assert.match(pages[1].text, /Поверх превью/);
});

test('файл: перо — на странице PDF в её координатах, над текстом — на листе A4 своего блока; вектором', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  /** Пути (constructPath) на страницах: сколько заливок и обводок. */
  async function paths(bytes) {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false, verbosity: 0 });
    const doc = await task.promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const ops = (await (await doc.getPage(i)).getOperatorList()).fnArray;
      out.push(ops.filter((f) => f === pdfjs.OPS.constructPath).length);
    }
    await task.destroy();
    return out;
  }
  const src = new Uint8Array(fs.readFileSync(FIXTURE));
  const base = {
    colors: COLORS, sources: { s: src }, images: {}, inkScale: 0.75,
    sections: [
      { kind: 'pdf', src: 's', page: 1, w: 595, h: 842, overlays: [] },
      { kind: 'flow', blocks: [{ t: 'p', bid: 'b1', runs: [{ text: 'Абзац под пером' }] }] },
    ],
  };
  const without = await paths((await W.writePdf(base)).bytes);
  // Лист страницы на экране: левый верх (40, 10) px, 0,5 px на pt.
  const ink = [
    { d: 'M60,30Q80,60 120,90Q140,100 160,110Z', mode: 'fill', width: 3, color: { r: 0.8, g: 0.1, b: 0.1, a: 1 }, opacity: 1, target: { section: 0, ox: 40, oy: 10, k: 0.5 } },
    { d: 'M10,500L200,500', mode: 'stroke', width: 2, color: { r: 0.1, g: 0.1, b: 0.8, a: 1 }, opacity: 0.38, target: { bid: 'b1', oy: 480 } },
    { d: 'M0,0L1,1', mode: 'stroke', width: 2, color: null, opacity: 1, target: { bid: 'нет такого', oy: 0 } },
  ];
  const res = await W.writePdf(Object.assign({}, base, { ink }));
  assert.equal(res.pages, 2);
  const withInk = await paths(res.bytes);
  assert.deepEqual(withInk.map((n, i) => n - without[i]), [1, 1], 'по штриху на страницу PDF и на лист A4; штрих без блока — мимо');
});

// --- сборка, шрифт, лицензии, хранилище ---------------------------------------------------

test('pdf-lib, fontkit и шрифт — только в editor-pdf.js; Onest с лицензией рядом', () => {
  const { OUT_RENDERER, OUT_MOBILE, OUT_PDF, PDF_ONLY } = require('../../scripts/build-editor.js');
  assert.deepEqual(PDF_ONLY, ['pdfjs.js', 'pdfwrite.js']);
  for (const file of [OUT_RENDERER, OUT_MOBILE]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /registerFontkit|PDFDocument\.create/, `${path.basename(file)}: pdf-lib попал в сборку редактора`);
  }
  const pdf = fs.readFileSync(OUT_PDF, 'utf8');
  assert.match(pdf, /registerFontkit/, 'в editor-pdf.js нет pdf-lib');
  const head = pdf.slice(0, 1200);
  assert.match(head, /pdf-lib[^\n]*MIT/);
  assert.match(head, /fontkit[^\n]*MIT/);
  assert.match(head, /Onest[^\n]*SIL Open Font License 1\.1/);
  for (const f of ['Onest-Regular.ttf', 'Onest-Bold.ttf', 'Onest-OFL.txt']) assert.ok(fs.existsSync(path.join(SRC, 'fonts', f)), `нет src/editor/fonts/${f}`);
  assert.match(fs.readFileSync(path.join(SRC, 'fonts', 'Onest-OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i);
});

test('pdf-lib и fontkit названы на /legal на четырёх языках и в COMPLIANCE.md', () => {
  const legal = fs.readFileSync(path.join(ROOT, 'landing', 'legal.html'), 'utf8');
  const docs = legal.split('<article class="legal-doc"').slice(1);
  assert.equal(docs.length, 4);
  for (const d of docs) {
    assert.match(d, /pdf-lib/, 'на одном из языков нет pdf-lib');
    assert.match(d, /fontkit/, 'на одном из языков нет fontkit');
  }
  const comp = fs.readFileSync(path.join(ROOT, 'COMPLIANCE.md'), 'utf8');
  assert.match(comp, /pdf-lib/);
  assert.match(comp, /fontkit/);
});

test('корзина doc-assets принимает PDF до 20 МБ — SQL для неё лежит в supabase/storage-pdf.sql', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'storage-pdf.sql'), 'utf8');
  assert.match(sql, /update storage\.buckets/i);
  assert.match(sql, /'application\/pdf'/);
  assert.match(sql, /20971520/);
  assert.match(sql, /where id = 'doc-assets'/);
});

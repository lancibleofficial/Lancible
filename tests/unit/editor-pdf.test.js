// PDF в редакторе без браузера: текст страниц → абзацы и заголовки,
// размер картинки страницы, лицензия pdf.js. Запуск: npm run test:unit
//
// Откуда взялось (17 октября 2026). Пункт пользователя: «добавить редактору
// возможность загрузить PDF и редактировать его» — страницами-картинками или
// текстом, выбор при загрузке (src/editor/pdf.js, DESIGN.md «PDF в
// редакторе»). Текст pdf.js отдаёт кусками с координатами; как из них
// получаются строки, колонки, абзацы и заголовки, решает чистая функция
// src/editor/pdftext.js — её и проверяем здесь на фикстуре элементов того же
// вида, что getTextContent: { str, transform: [a, b, c, d, x, y], width, height }.
// Как это выглядит в настоящем браузере — tests/e2e/editor-pdf.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'editor');

/** pdftext.js и pdf.js одним CommonJS-модулем. Самого pdf.js (pdfjs-dist) в
 *  них нет: он отдельным файлом editor-pdf.js, его грузит loadPdfJs. */
const E = (() => {
  const entry = [
    "export * as T from './pdftext.js';",
    "export * as P from './pdf.js';",
    "export { schema } from './schema.js';",
  ].join('\n');
  const out = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: SRC, sourcefile: 'editor-pdf-test.js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();
const { T, P } = E;

/** Элемент getTextContent: текст, левый край, база строки, кегль. Ширина —
 *  по полкегля на знак, как у Helvetica в среднем. */
const it = (str, x, y, size = 12, width) => ({ str, transform: [size, 0, 0, size, x, y], width: width == null ? str.length * size * 0.5 : width, height: size });
/** Строки одной колонки сверху вниз с шагом step. */
const column = (x, top, step, lines, size = 12) => lines.map((s, i) => it(s, x, top - i * step, size));

const texts = (blocks) => blocks.map((b) => (b.type === 'heading' ? `h${b.level}: ${b.text}` : b.text));

test('строка: куски с одной базой склеиваются, пробел — по промежутку', () => {
  const page = [
    it('При', 72, 700, 12, 18), it('вет,', 90, 700.4, 12, 24), it('мир', 119, 699.7, 12, 18),
    // Надстрочный (сноска) выше базы на треть кегля — та же строка, вплотную.
    it('2', 137, 704, 7, 4),
    it('', 150, 700, 12, 0), it('   ', 150, 700, 12, 6),
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), ['Привет, мир2']);
});

test('абзацы: строки подряд — один абзац, пустой промежуток — новый', () => {
  const page = [
    ...column(72, 740, 14.4, ['Первая строка абзаца,', 'вторая строка абзаца.']),
    ...column(72, 690, 14.4, ['Второй абзац после пустой строки.']),
    ...column(72, 650, 14.4, ['Третий абзац,', 'тоже из двух строк.']),
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), [
    'Первая строка абзаца, вторая строка абзаца.',
    'Второй абзац после пустой строки.',
    'Третий абзац, тоже из двух строк.',
  ]);
});

test('заголовок: крупнее медианы в 1,3 раза; уровень — по тому, во сколько', () => {
  const body = column(72, 600, 14, ['Обычный текст страницы, самый частый кегль.', 'Ещё строка обычного текста.', 'И ещё одна строка текста.']);
  const page = [
    it('Большой', 72, 780, 26), // 26 / 12 > 2 — первый уровень
    it('Раздел', 72, 740, 20), // 1,67 — второй
    it('Подраздел', 72, 710, 16), // 1,33 — третий
    it('Чуть крупнее', 72, 680, 14), // 1,17 — не заголовок
    ...body,
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), [
    'h1: Большой', 'h2: Раздел', 'h3: Подраздел', 'Чуть крупнее',
    'Обычный текст страницы, самый частый кегль. Ещё строка обычного текста. И ещё одна строка текста.',
  ]);
});

test('заголовок в две строки — один заголовок; текст сразу под ним — отдельный абзац', () => {
  const page = [
    it('Длинный заголовок,', 72, 780, 24), it('во вторую строку', 72, 752, 24),
    ...column(72, 724, 14, ['Текст идёт вплотную под заголовком', 'и продолжается здесь.', 'Последняя строка текста.']),
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), [
    'h1: Длинный заголовок, во вторую строку',
    'Текст идёт вплотную под заголовком и продолжается здесь. Последняя строка текста.',
  ]);
});

test('две колонки: сначала левая сверху вниз, потом правая; заголовок во всю ширину — первым', () => {
  const left = ['Левая колонка, строка 1', 'левая колонка, строка 2', 'левая колонка, строка 3', 'левая колонка, строка 4'];
  const right = ['Правая колонка, строка 1', 'правая колонка, строка 2', 'правая колонка, строка 3', 'правая колонка, строка 4'];
  const page = [
    it('Заголовок во всю ширину страницы', 72, 760, 20, 450),
    ...column(72, 720, 14, left).map((x) => Object.assign(x, { width: 200 })),
    ...column(320, 720, 14, right).map((x) => Object.assign(x, { width: 200 })),
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), [
    'h2: Заголовок во всю ширину страницы',
    left.join(' '),
    right.join(' '),
  ]);
});

test('один широкий промежуток в строке — не колонка: строка остаётся строкой', () => {
  const page = [
    ...column(72, 740, 14, ['Обычный текст первой строки', 'и второй строки абзаца,', 'и третьей.']),
    it('Итого:', 72, 698), it('100', 400, 698),
  ];
  assert.deepEqual(texts(T.pdfTextBlocks([page])), ['Обычный текст первой строки и второй строки абзаца, и третьей. Итого: 100']);
});

test('перенос слова склеивается, номера страниц не переносятся, страница — граница абзаца', () => {
  const p1 = [
    ...column(72, 740, 14, ['Это пример текста с перено-', 'сом слова и дефисом из-', 'За границы строки.']),
    it('1', 290, 40, 10),
  ];
  const p2 = [it('— 2 —', 280, 800, 10), ...column(72, 740, 14, ['Вторая страница.'])];
  assert.deepEqual(texts(T.pdfTextBlocks([p1, p2])), [
    // «из-» + «За» — с заглавной: дефис настоящий, склейки нет.
    'Это пример текста с переносом слова и дефисом из- За границы строки.',
    'Вторая страница.',
  ]);
});

test('идемпотентно: тот же вход — тот же выход, вход не меняется, порядок кусков не важен', () => {
  const page = [
    it('Заголовок', 72, 780, 24),
    ...column(72, 740, 14, ['Строка один', 'строка два']),
    ...column(72, 700, 14, ['Новый абзац']),
  ];
  const before = JSON.stringify(page);
  const a = T.pdfTextBlocks([page]);
  const b = T.pdfTextBlocks([page]);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(page), before, 'вход изменился');
  const shuffled = [page[3], page[0], page[2], page[1]];
  assert.deepEqual(T.pdfTextBlocks([shuffled]), a);
  assert.deepEqual(texts(a), ['h1: Заголовок', 'Строка один строка два', 'Новый абзац']);
});

test('пусто и мусор: нет текста — нет блоков; метки разметки и управляющие знаки отбрасываются', () => {
  assert.deepEqual(T.pdfTextBlocks([]), []);
  assert.deepEqual(T.pdfTextBlocks([[], [{ type: 'beginMarkedContent' }]]), []);
  assert.deepEqual(texts(T.pdfTextBlocks([[it('Те\u0000кст\u0007', 72, 700)]])), ['Текст']);
  assert.deepEqual(T.textItems([{ type: 'beginMarkedContent' }, it(' ', 0, 0), it('a', 10, 20, 9)]), [{ str: 'a', x: 10, y: 20, w: 4.5, size: 9 }]);
});

test('блоки становятся узлами редактора: заголовок с уровнем и абзац', () => {
  const nodes = P.blocksToNodes([{ type: 'heading', level: 2, text: 'Раздел' }, { type: 'paragraph', text: 'Текст' }]);
  assert.deepEqual(nodes.map((n) => [n.type.name, n.attrs.level || null, n.textContent]), [['heading', 2, 'Раздел'], ['paragraph', null, 'Текст']]);
});

test('картинка страницы: масштаб 2, но не шире 2000 px; пределы файла — 20 МБ и 50 страниц', () => {
  assert.equal(P.pageScale(595), 2); // A4 → 1190 px
  assert.equal(Math.round(P.pageScale(1500) * 1500), 2000);
  assert.equal(P.PDF_MAX_MB, 20);
  assert.equal(P.PDF_MAX_PAGES, 50);
  assert.ok(P.isPdf({ type: 'application/pdf', name: 'a' }));
  assert.ok(P.isPdf({ type: '', name: 'Отчёт.PDF' }));
  assert.ok(!P.isPdf({ type: 'image/png', name: 'a.png' }));
});

test('pdf.js грузится файлом рядом с editor.js, а не от адреса страницы', () => {
  assert.equal(P.PDF_BUNDLE, 'editor-pdf.js');
  // Веб на сайте — в /app/, страница может быть /app/index.html#…
  assert.equal(P.pdfBundleUrl('https://lancible.vercel.app/app/editor.js'), 'https://lancible.vercel.app/app/editor-pdf.js');
  // Десктоп — file://, в установщике внутри app.asar.
  assert.equal(P.pdfBundleUrl('file:///C:/Program%20Files/Lancible/resources/app.asar/src/renderer/editor.js'),
    'file:///C:/Program%20Files/Lancible/resources/app.asar/src/renderer/editor-pdf.js');
});

// --- лицензия -------------------------------------------------------------------

test('pdf.js в сборке — лицензия Apache-2.0 названа на /legal (4 языка) и в COMPLIANCE.md', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  assert.ok(deps['pdfjs-dist'], 'pdfjs-dist пропал из package.json — тогда уберите и этот тест, и строки лицензии');
  const legal = fs.readFileSync(path.join(ROOT, 'landing', 'legal.html'), 'utf8');
  const articles = [...legal.matchAll(/<article class="legal-doc" data-lang="(\w+)"[\s\S]*?<\/article>/g)];
  assert.deepEqual(articles.map((m) => m[1]).sort(), ['en', 'kk', 'ru', 'uk']);
  for (const [body, lang] of articles) {
    const said = body.replace(/<[^>]+>/g, '').split(/(?<=\.)\s+/).find((s) => s.includes('pdf.js'));
    assert.ok(said && said.includes('Apache-2.0'), `legal.html ${lang}: нет pdf.js с лицензией Apache-2.0 в одном предложении`);
  }
  const compliance = fs.readFileSync(path.join(ROOT, 'COMPLIANCE.md'), 'utf8');
  assert.match(compliance, /pdf\.js[^|\n]*Apache-2\.0/, 'COMPLIANCE.md: нет строки о pdf.js и Apache-2.0');
});

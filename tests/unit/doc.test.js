// Документ редактора: переезд заметок Quill, обратный перевод для старых
// версий, счёт слов, Markdown, штрихи, графики. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/renderer/core/doc.js');
const S = require('../../src/renderer/core/sync.js');

const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });

// --- контейнер ------------------------------------------------------------------

test('пустые заметки — пустой документ с одним абзацем', () => {
  for (const v of [null, undefined, '', 0]) {
    const c = D.readNotes(v);
    assert.deepEqual(c.doc, { type: 'doc', content: [{ type: 'paragraph' }] });
    assert.deepEqual(c.comments, []);
    assert.deepEqual(c.ink, []);
  }
});

test('новое поле notes читается как есть, Delta рядом не мешает', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('новое')] }] };
  const notes = { ops: [{ insert: 'старое\n' }], lancible: { v: 1, doc, comments: [{ id: 'c1' }], ink: [] } };
  const c = D.readNotes(notes);
  assert.deepEqual(c.doc, doc);
  assert.equal(c.comments.length, 1);
});

test('writeNotes кладёт Delta для старых версий и сам контейнер', () => {
  const c = D.readNotes({ ops: [{ insert: 'Привет', attributes: { bold: true } }, { insert: '\n' }] });
  const w = D.writeNotes(c);
  assert.deepEqual(w.ops, [{ insert: 'Привет', attributes: { bold: true } }, { insert: '\n' }]);
  assert.deepEqual(w.lancible.doc, c.doc);
});

test('чтение старых заметок не меняет их и даёт один и тот же документ', () => {
  const ops = [
    { insert: 'Заголовок' }, { insert: '\n', attributes: { header: 2 } },
    { insert: 'раз' }, { insert: '\n', attributes: { list: 'bullet' } },
  ];
  const frozen = JSON.stringify(ops);
  const a = D.readNotes({ ops });
  const b = D.readNotes({ ops });
  assert.equal(JSON.stringify(ops), frozen, 'исходный Delta не тронут');
  assert.deepEqual(a, b);
  // И круг «прочитать → записать → прочитать» стоит на месте.
  assert.deepEqual(D.readNotes(D.writeNotes(a)), a);
});

test('isDocEmpty: пробелы — пусто, картинка или рисунок от руки — нет', () => {
  assert.equal(D.isDocEmpty(D.readNotes({ ops: [{ insert: '   \n' }] })), true);
  assert.equal(D.isDocEmpty({ doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] } }), false);
  assert.equal(D.isDocEmpty({ doc: D.emptyDoc(), ink: [{ id: 's' }] }), false);
});

// --- Delta → документ -------------------------------------------------------------

test('строчные форматы Quill становятся метками', () => {
  const doc = D.deltaToDoc([
    { insert: 'ж', attributes: { bold: true } },
    { insert: 'к', attributes: { italic: true, underline: true } },
    { insert: 'с', attributes: { link: 'https://a.b', color: '#ff0000', background: '#ffff00' } },
    { insert: '\n' },
  ]);
  const p = doc.content[0];
  assert.equal(p.type, 'paragraph');
  assert.deepEqual(p.content[0].marks, [{ type: 'strong' }]);
  assert.deepEqual(p.content[1].marks, [{ type: 'em' }, { type: 'underline' }]);
  assert.deepEqual(p.content[2].marks.map((m) => m.type), ['textColor', 'highlight', 'link']);
});

test('заголовки, выравнивание и пустая строка Quill в конце', () => {
  const doc = D.deltaToDoc([
    { insert: 'Глава' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'по центру' }, { insert: '\n', attributes: { align: 'center' } },
    { insert: '\n' },
  ]);
  assert.equal(doc.content.length, 2);
  assert.deepEqual(doc.content[0].attrs, { level: 1 });
  assert.deepEqual(doc.content[1].attrs, { align: 'center' });
});

test('списки: вложенность по indent, чек-лист — отдельный тип', () => {
  const doc = D.deltaToDoc([
    { insert: 'один' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'вложенный' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    { insert: 'два' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'сделано' }, { insert: '\n', attributes: { list: 'checked' } },
    { insert: 'не сделано' }, { insert: '\n', attributes: { list: 'unchecked' } },
  ]);
  assert.equal(doc.content.length, 2);
  const [ul, tl] = doc.content;
  assert.equal(ul.type, 'bullet_list');
  assert.equal(ul.content.length, 2);
  assert.equal(ul.content[0].content[1].type, 'bullet_list', 'вложенный список внутри первого пункта');
  assert.equal(tl.type, 'task_list');
  assert.deepEqual(tl.content.map((i) => i.attrs.checked), [true, false]);
});

test('цитата и код — подряд идущие строки в один блок', () => {
  const doc = D.deltaToDoc([
    { insert: 'а' }, { insert: '\n', attributes: { blockquote: true } },
    { insert: 'б' }, { insert: '\n', attributes: { blockquote: true } },
    { insert: 'x = 1' }, { insert: '\n', attributes: { 'code-block': 'plain' } },
    { insert: 'y = 2' }, { insert: '\n', attributes: { 'code-block': 'plain' } },
  ]);
  assert.equal(doc.content[0].type, 'blockquote');
  assert.equal(doc.content[0].content.length, 2);
  assert.equal(doc.content[1].type, 'code_block');
  assert.equal(doc.content[1].content[0].text, 'x = 1\ny = 2');
  assert.equal(doc.content[1].attrs.language, '');
});

test('таблица Quill: строки по id, заливка ячейки, прямоугольник', () => {
  const doc = D.deltaToDoc([
    { insert: 'A' }, { insert: '\n', attributes: { table: 'r1', cellBg: '#ff0000' } },
    { insert: 'B' }, { insert: '\n', attributes: { table: 'r1' } },
    { insert: 'C' }, { insert: '\n', attributes: { table: 'r2' } },
  ]);
  const t = doc.content[0];
  assert.equal(t.type, 'table');
  assert.equal(t.content.length, 2);
  assert.equal(t.content[1].content.length, 2, 'короткая строка добита до ширины');
  assert.deepEqual(t.content[0].content[0].attrs, { background: '#ff0000' });
});

test('картинка из строки Quill — отдельный блок', () => {
  const doc = D.deltaToDoc([{ insert: 'до' }, { insert: { image: 'https://x/y.png' } }, { insert: '\n' }]);
  assert.deepEqual(doc.content.map((n) => n.type), ['image', 'paragraph']);
});

// --- документ → Delta ----------------------------------------------------------------

test('обратный перевод: заголовок, список, чек-лист и вложенность', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Г')] },
      { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [text('a')] },
        { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [text('b')] }] }] }] }] },
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('c')] }] }] },
    ],
  };
  assert.deepEqual(D.docToDelta(doc), [
    { insert: 'Г' }, { insert: '\n', attributes: { header: 2 } },
    { insert: 'a' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'b' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    { insert: 'c' }, { insert: '\n', attributes: { list: 'checked' } },
  ]);
});

test('обратный перевод: то, чего Quill не умеет, остаётся видимой пометкой', () => {
  const ops = D.docToDelta({
    type: 'doc',
    content: [
      { type: 'chart', attrs: { chart: { title: 'Выручка' } } },
      { type: 'drawing', attrs: {} },
      { type: 'image', attrs: { src: 'asset:abc', alt: 'схема' } },
    ],
  });
  const t = ops.map((o) => o.insert).join('');
  assert.match(t, /Выручка/);
  assert.match(t, /✎/);
  assert.match(t, /схема/, 'картинку из своего хранилища старый Quill не покажет — остаётся подпись');
});

test('круг Delta → документ → Delta сохраняет простые заметки', () => {
  const ops = [
    { insert: 'Жирный', attributes: { bold: true } }, { insert: ' и обычный' }, { insert: '\n' },
    { insert: 'пункт' }, { insert: '\n', attributes: { list: 'ordered' } },
    { insert: 'цитата' }, { insert: '\n', attributes: { blockquote: true } },
  ];
  assert.deepEqual(D.docToDelta(D.deltaToDoc(ops)), ops);
});

// --- счёт, оглавление, заголовок -------------------------------------------------------

test('счёт слов: дефис и апостроф внутри слова, любые алфавиты', () => {
  const doc = D.deltaToDoc([{ insert: 'Из-за дождя — don\'t go. Сәлем әлем 2026\n' }]);
  const s = D.docStats(doc);
  assert.equal(s.words, 7);
  assert.equal(s.paragraphs, 1);
  assert.equal(s.readingMin, 1);
  assert.equal(D.docStats(D.emptyDoc()).readingMin, 0);
});

test('оглавление: только непустые заголовки, с номером блока', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Один')] },
      { type: 'paragraph', content: [text('текст')] },
      { type: 'heading', attrs: { level: 2 } },
      { type: 'heading', attrs: { level: 3 }, content: [text('Три')] },
    ],
  };
  assert.deepEqual(D.docOutline(doc), [{ level: 1, text: 'Один', index: 0 }, { level: 3, text: 'Три', index: 3 }]);
});

test('название по первой строке, длинное — с многоточием', () => {
  const doc = D.deltaToDoc([{ insert: '\n  Первая строка\nвторая\n' }]);
  assert.equal(D.docTitleGuess(doc), 'Первая строка');
  assert.equal(D.docTitleGuess(doc, 6), 'Перва…');
});

// --- Markdown ----------------------------------------------------------------------------

test('Markdown: заголовки, метки, списки, чек-лист, таблица, код', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('План')] },
      { type: 'paragraph', content: [text('жирно', [{ type: 'strong' }]), text(' и '), text('ссылка', [{ type: 'link', attrs: { href: 'https://a.b' } }])] },
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('готово')] }] }] },
      { type: 'ordered_list', attrs: { order: 1 }, content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [text('раз')] }] }] },
      { type: 'table', content: [
        { type: 'table_row', content: [{ type: 'table_header', content: [{ type: 'paragraph', content: [text('A')] }] }, { type: 'table_header', content: [{ type: 'paragraph', content: [text('B')] }] }] },
        { type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph', content: [text('1')] }] }, { type: 'table_cell', content: [{ type: 'paragraph', content: [text('2')] }] }] },
      ] },
      { type: 'code_block', attrs: { language: 'js' }, content: [text('a*b')] },
    ],
  };
  assert.equal(D.docToMarkdown(doc), [
    '# План',
    '**жирно** и [ссылка](https://a.b)',
    '- [x] готово',
    '1. раз',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    '```js\na*b\n```',
  ].join('\n\n') + '\n');
});

test('Markdown экранирует служебные знаки в обычном тексте', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('5 * 3 = #15')] }] };
  assert.equal(D.docToMarkdown(doc), '5 \\* 3 = \\#15\n');
});

// --- штрихи ----------------------------------------------------------------------------------

test('штрих: упаковка и распаковка с погрешностью меньше 0,05 px', () => {
  const pts = [[10.04, 20.06, 0.5], [10.5, 21, 0.62], [-3.33, 400.12, 1], [0, 0, 0]];
  const back = D.unpackPoints(D.packPoints(pts));
  assert.equal(back.length, pts.length);
  back.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - pts[i][0]) <= 0.05, `x ${i}`);
    assert.ok(Math.abs(p[1] - pts[i][1]) <= 0.05, `y ${i}`);
    assert.ok(Math.abs(p[2] - pts[i][2]) <= 0.005, `нажим ${i}`);
  });
});

test('штрих: упакованный короче JSON втрое и больше', () => {
  const pts = Array.from({ length: 300 }, (_, i) => [100 + i * 0.73, 200 + Math.sin(i / 9) * 40, 0.4 + (i % 7) / 20]);
  const packed = D.packPoints(pts);
  assert.ok(JSON.stringify(pts).length / packed.length > 3, `${JSON.stringify(pts).length} / ${packed.length}`);
  assert.deepEqual(D.unpackPoints(''), []);
});

// --- графики ---------------------------------------------------------------------------------

test('число из ячейки: пробелы-тысячи, запятая, проценты, валюта, минус', () => {
  assert.equal(D.parseCellNumber('1 234,5'), 1234.5);
  assert.equal(D.parseCellNumber('12%'), 12);
  assert.equal(D.parseCellNumber('$40.25'), 40.25);
  assert.equal(D.parseCellNumber('−3'), -3);
  assert.equal(D.parseCellNumber('1,234,567'), 1234567);
  assert.equal(D.parseCellNumber('1.234,5'), 1234.5);
  assert.equal(D.parseCellNumber('нет'), null);
  assert.equal(D.parseCellNumber(''), null);
});

test('график из таблицы: шапка — ряды, первый столбец — подписи', () => {
  const data = D.chartFromRows([
    ['Месяц', 'Часы', 'Заметка', 'Деньги'],
    ['Янв', '10', 'x', '1 000'],
    ['Фев', '12,5', '', '1 500'],
  ]);
  assert.deepEqual(data.labels, ['Янв', 'Фев']);
  assert.deepEqual(data.series, [{ name: 'Часы', values: [10, 12.5] }, { name: 'Деньги', values: [1000, 1500] }]);
  assert.equal(D.chartFromRows([['a', 'b']]), null, 'без строк данных графика нет');
  assert.equal(D.chartFromRows([['a', 'b'], ['x', 'y']]), null, 'без чисел графика нет');
});

test('шкала круглая и накрывает данные', () => {
  const s = D.chartScale([3, 97.3, 41]);
  assert.deepEqual([s.min, s.max, s.step], [0, 100, 20]);
  assert.deepEqual(s.ticks, [0, 20, 40, 60, 80, 100]);
  const neg = D.chartScale([-12, 30]);
  assert.ok(neg.min <= -12 && neg.max >= 30);
  assert.deepEqual(D.chartScale([]).ticks.length > 1, true);
});

test('доли круговой: отрицательное не сектор, сумма — единица', () => {
  const sh = D.chartShares([1, 3, -5, 0]);
  assert.deepEqual(sh, [0.25, 0.75, 0, 0]);
  assert.deepEqual(D.chartShares([0, 0]), [0, 0]);
});

// --- комментарии -------------------------------------------------------------------------------

test('ветка без отметки в тексте — потерянная, но не стёртая', () => {
  const c = {
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [text('x', [{ type: 'comment', attrs: { id: 'a' } }])] }] },
    comments: [{ id: 'a', text: 'живая' }, { id: 'b', text: 'текст удалили' }],
  };
  assert.deepEqual(D.commentThreads(c).map((t) => [t.id, t.orphan]), [['a', false], ['b', true]]);
});

// --- документы ---------------------------------------------------------------------------------

test('список документов: закреплённые сверху, дальше свежие', () => {
  const docs = [
    { id: 'old', updatedAt: '2026-01-01' },
    { id: 'new', updatedAt: '2026-05-01' },
    { id: 'pin', updatedAt: '2025-01-01', pinnedAt: '2026-02-01' },
  ];
  assert.deepEqual(D.sortDocuments(docs).map((d) => d.id), ['pin', 'new', 'old']);
});

test('поиск документов — по названию и по тексту', () => {
  const a = Object.assign(D.newDocument({ id: 'a', title: 'Договор', now: 'x' }));
  const b = D.newDocument({ id: 'b', title: 'Черновик', now: 'x' });
  b.body = D.readNotes({ ops: [{ insert: 'про договор аренды\n' }] });
  assert.deepEqual(D.searchDocuments([a, b], 'договор').map((d) => d.id), ['a', 'b']);
  assert.deepEqual(D.searchDocuments([a, b], 'аренд').map((d) => d.id), ['b']);
  assert.equal(D.searchDocuments([a, b], '').length, 2);
});

test('синхронизация: набор без поля documents своё не стирает', () => {
  const local = [{ id: 'd1' }];
  assert.deepEqual(S.pickDocuments(local, { projects: [] }), local, 'старая версия поля не знает');
  assert.deepEqual(S.pickDocuments(local, { documents: [] }), [], 'пустой массив — удалили все');
  assert.deepEqual(S.pickDocuments(local, { documents: [{ id: 'd2' }] }), [{ id: 'd2' }]);
  assert.deepEqual(S.pickDocuments(undefined, null), []);
  assert.equal(S.hasData({ documents: [{ id: 'd' }] }), true, 'аккаунт с одним документом — не пустой');
});

test('Markdown: график — его данные таблицей, с названием', () => {
  const doc = { type: 'doc', content: [{ type: 'chart', attrs: { chart: { title: 'Выручка', labels: ['Янв', 'Фев'], series: [{ name: 'Часы', values: [10, 14] }] } } }] };
  assert.equal(D.docToMarkdown(doc), '**Выручка**\n\n| | Часы |\n| --- | --- |\n| Янв | 10 |\n| Фев | 14 |\n');
});

test('ряд картинок: старые версии и Markdown получают картинки по одной', () => {
  const img = (src) => ({ type: 'image', attrs: { src, alt: src, caption: '', width: null, align: 'center' } });
  const doc = { type: 'doc', content: [{ type: 'gallery', content: [img('https://x/a.png'), img('https://x/b.png')] }] };
  const ops = D.docToDelta(doc);
  assert.deepEqual(ops.filter((o) => typeof o.insert === 'object').map((o) => o.insert.image), ['https://x/a.png', 'https://x/b.png']);
  assert.equal(D.docToMarkdown(doc), '![https://x/a.png](https://x/a.png)\n\n![https://x/b.png](https://x/b.png)\n');
  assert.equal(D.isDocEmpty({ doc }), false, 'ряд из картинок — не пустой документ');
});

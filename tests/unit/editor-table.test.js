// Команды ручек таблицы и данные графика для телефона — без браузера.
// Запуск: npm run test:unit
//
// Откуда взялось (волна 2, 17 октября 2026). Ручки строки и столбца
// (src/editor/tablehandles.js) умеют то, чего не было у острова таблицы:
// дублировать и переставлять строку и столбец, делать столбцом заголовков
// любой столбец, выравнивать текст во всём столбце. Это обычные команды
// ProseMirror (commands.js, table.*), и проверяются они на состоянии, без
// DOM: что делают и когда честно отказываются (объединённые ячейки).
// Здесь же — spec графика (chart.js: chartSpec, chartFromSpec): в каком виде
// график уходит в нижний лист телефона и как ответ ложится обратно в узел,
// не теряя того, чего лист не показывает.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', '..', 'src', 'editor');

const E = (() => {
  const entry = [
    "export * as C from './commands.js';",
    "export { chartSpec, chartFromSpec, defaultChart, CHART_TYPES } from './chart.js';",
    "export { schema } from './schema.js';",
    "export { EditorState, TextSelection } from 'prosemirror-state';",
    "export { CellSelection, TableMap } from 'prosemirror-tables';",
  ].join('\n');
  const out = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: SRC, sourcefile: 'editor-table-test.js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();

const { C, schema, EditorState, TextSelection, CellSelection, TableMap, chartSpec, chartFromSpec, defaultChart } = E;
const N = schema.nodes;

const para = (text, align) => N.paragraph.create(align ? { align } : null, text ? schema.text(text) : null);
/** Таблица из строк текста; header — первая строка из th; merge — ячейка (0-я строка тела, 0-й столбец) на две строки. */
function tableDoc(rows, opts) {
  const o = opts || {};
  const rowNodes = rows.map((cells, r) => N.table_row.create(null, cells.filter((x) => x !== null).map((text) => {
    const type = o.header && r === 0 ? N.table_header : N.table_cell;
    const attrs = o.rowspan && o.rowspan.r === r && o.rowspan.text === text ? { rowspan: 2 } : null;
    return type.create(attrs, para(text));
  })));
  return N.doc.create(null, [N.table.create(null, rowNodes), para('после')]);
}

/** Состояние с курсором в ячейке (r, c). */
function at(doc, r, c) {
  const table = doc.firstChild;
  const map = TableMap.get(table);
  const pos = 1 + map.map[r * map.width + c];
  let state = EditorState.create({ doc, schema });
  state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))));
  return state;
}

/** Выполнить команду и вернуть новое состояние (или null, если отказалась). */
function run(state, cmd) {
  let next = null;
  const ok = cmd(state, (tr) => { next = state.apply(tr); });
  return ok ? next : null;
}

/** Текст таблицы по строкам. */
const text = (state) => {
  const out = [];
  state.doc.firstChild.forEach((row) => { const cells = []; row.forEach((cell) => cells.push(cell.textContent)); out.push(cells); });
  return out;
};
const tags = (state) => {
  const out = [];
  state.doc.firstChild.forEach((row) => { let s = ''; row.forEach((cell) => { s += cell.type === N.table_header ? 'H' : 'D'; }); out.push(s); });
  return out;
};

const GRID = [['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']];

test('дублировать строку: копия сразу под ней', () => {
  const s = run(at(tableDoc(GRID), 1, 2), C.table.rowDup);
  assert.deepEqual(text(s), [['a', 'b', 'c'], ['d', 'e', 'f'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
});

test('дублировать столбец: копия справа, в каждой строке', () => {
  const s = run(at(tableDoc(GRID), 2, 0), C.table.colDup);
  assert.deepEqual(text(s), [['a', 'a', 'b', 'c'], ['d', 'd', 'e', 'f'], ['g', 'g', 'h', 'i']]);
});

test('через объединённую ячейку не дублируем — команда честно отказывается', () => {
  // «d» занимает две строки (1 и 2) первого столбца.
  const doc = tableDoc([['a', 'b'], ['d', 'e'], [null, 'h']], { rowspan: { r: 1, text: 'd' } });
  assert.equal(C.table.rowDup(at(doc, 1, 1)), false, 'строка 1 — начало объединения');
  assert.equal(C.table.rowDup(at(doc, 2, 1)), false, 'строка 2 — через неё проходит объединение');
  assert.equal(C.table.colDup(at(doc, 1, 0)), false, 'столбец с объединённой ячейкой');
  assert.equal(C.table.rowDup(at(doc, 0, 1)), true, 'строка без объединения — можно');
  assert.equal(C.table.colDup(at(doc, 0, 1)), true, 'столбец без объединения — можно');
});

test('переместить строку вверх и вниз; у края — некуда', () => {
  const s0 = at(tableDoc(GRID), 1, 1);
  assert.deepEqual(text(run(s0, C.table.rowUp)), [['d', 'e', 'f'], ['a', 'b', 'c'], ['g', 'h', 'i']]);
  assert.deepEqual(text(run(s0, C.table.rowDown)), [['a', 'b', 'c'], ['g', 'h', 'i'], ['d', 'e', 'f']]);
  assert.equal(C.table.rowUp(at(tableDoc(GRID), 0, 0)), false);
  assert.equal(C.table.rowDown(at(tableDoc(GRID), 2, 0)), false);
});

test('переместить столбец влево и вправо; у края — некуда', () => {
  const s0 = at(tableDoc(GRID), 0, 1);
  assert.deepEqual(text(run(s0, C.table.colMoveLeft)), [['b', 'a', 'c'], ['e', 'd', 'f'], ['h', 'g', 'i']]);
  assert.deepEqual(text(run(s0, C.table.colMoveRight)), [['a', 'c', 'b'], ['d', 'f', 'e'], ['g', 'i', 'h']]);
  assert.equal(C.table.colMoveLeft(at(tableDoc(GRID), 1, 0)), false);
  assert.equal(C.table.colMoveRight(at(tableDoc(GRID), 1, 2)), false);
});

test('столбец заголовков — любой столбец, строка заголовков остаётся', () => {
  const s0 = at(tableDoc(GRID, { header: true }), 1, 2);
  assert.equal(C.isHeaderColumn(s0), false);
  const s1 = run(s0, C.table.colHeader);
  assert.deepEqual(tags(s1), ['HHH', 'DDH', 'DDH']);
  assert.equal(C.isHeaderColumn(s1), true);
  const s2 = run(s1, C.table.colHeader);
  assert.deepEqual(tags(s2), ['HHH', 'DDD', 'DDD'], 'выключили — строка заголовков цела');
  // Без строки заголовков — весь столбец.
  assert.deepEqual(tags(run(at(tableDoc(GRID), 0, 0), C.table.colHeader)), ['HDD', 'HDD', 'HDD']);
});

test('выравнивание по выделенному столбцу задевает только его ячейки', () => {
  const s0 = at(tableDoc(GRID), 1, 1);
  const table = s0.doc.firstChild;
  const map = TableMap.get(table);
  const $cell = s0.doc.resolve(1 + map.map[map.width + 1]);
  const col = s0.apply(s0.tr.setSelection(CellSelection.colSelection($cell)));
  assert.equal(C.columnAlign(col), 'left');
  const s1 = run(col, C.setAlign('center'));
  const aligns = [];
  s1.doc.firstChild.forEach((row) => { const r = []; row.forEach((cell) => r.push(cell.firstChild.attrs.align || 'left')); aligns.push(r.join(' ')); });
  assert.deepEqual(aligns, ['left center left', 'left center left', 'left center left']);
  assert.equal(C.columnAlign(s1), 'center');
  // Обычный курсор в абзаце — как раньше.
  let p = EditorState.create({ doc: N.doc.create(null, [para('текст')]), schema });
  p = run(p, C.setAlign('right'));
  assert.equal(p.doc.firstChild.attrs.align, 'right');
});

// --- график для нижнего листа телефона -------------------------------------------

const t = (k, v) => ({ 'chart.sample_a': 'Янв', 'chart.sample_b': 'Фев', 'chart.sample_c': 'Мар', 'chart.sample_d': 'Апр', 'chart.series_n': `Ряд ${v && v.n}` }[k] || k);

test('chartSpec: вид, название и строки первого ряда', () => {
  assert.deepEqual(chartSpec(defaultChart(t)), {
    kind: 'bar', title: '',
    rows: [{ label: 'Янв', value: 4 }, { label: 'Фев', value: 7 }, { label: 'Мар', value: 5 }, { label: 'Апр', value: 9 }],
  });
  assert.deepEqual(chartSpec(null), { kind: 'bar', title: '', rows: [] }, 'пустой график — пустые строки, а не ошибка');
});

test('chartFromSpec: ответ листа ложится в узел, чего лист не видит — остаётся', () => {
  const base = {
    type: 'bar', title: 'Было', labels: ['Янв', 'Фев', 'Мар'], legend: false, values: true, stacked: true,
    series: [{ name: 'Часы', values: [1, 2, 3] }, { name: 'План', values: [10, 20, 30] }],
  };
  // Строку «Фев» удалили, «Мар» подняли наверх, добавили «Апр».
  const c = chartFromSpec({ kind: 'area', title: 'Стало', rows: [{ label: 'Мар', value: 7 }, { label: 'Янв', value: '1,5' }, { label: 'Апр', value: 'мусор' }] }, base);
  assert.deepEqual(c, {
    type: 'area', title: 'Стало', labels: ['Мар', 'Янв', 'Апр'], legend: false, values: true, stacked: true,
    series: [{ name: 'Часы', values: [7, 1.5, 0] }, { name: 'План', values: [30, 10, 0] }],
  });
  // Обратно — то, что прислали (числа уже числами).
  assert.deepEqual(chartSpec(c), { kind: 'area', title: 'Стало', rows: [{ label: 'Мар', value: 7 }, { label: 'Янв', value: 1.5 }, { label: 'Апр', value: 0 }] });
});

test('chartFromSpec: неизвестный вид и название не строкой — прежние; bars — это bar', () => {
  const base = defaultChart(t);
  assert.equal(chartFromSpec({ kind: 'bars', rows: [] }, Object.assign({}, base, { type: 'line' })).type, 'bar');
  const c = chartFromSpec({ kind: 'радар', title: 5, rows: [{ label: 'А', value: 1 }] }, Object.assign({}, base, { type: 'pie', title: 'Доли' }));
  assert.equal(c.type, 'pie');
  assert.equal(c.title, 'Доли');
  assert.deepEqual(c.series, [{ name: 'Ряд 1', values: [1] }]);
  assert.deepEqual(chartFromSpec(null, base).labels, [], 'без spec — пусто, но не ошибка');
});

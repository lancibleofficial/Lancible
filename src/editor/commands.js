// Команды редактора: всё, что меняет документ по кнопке, сочетанию или из
// меню «/». Каждая — обычная команда ProseMirror (state, dispatch) → bool:
// без dispatch она только отвечает, применима ли, и по этому кнопки знают,
// гасить ли себя.
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode } from 'prosemirror-commands';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import {
  addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, deleteTable,
  mergeCells, splitCell, toggleHeaderRow, toggleHeaderColumn, setCellAttr, isInTable, CellSelection, selectedRect,
} from 'prosemirror-tables';
import { schema } from './schema.js';

const N = schema.nodes;
const M = schema.marks;

const LISTS = [N.bullet_list, N.ordered_list, N.task_list];
const ITEMS = [N.list_item, N.task_item];

// --- запросы ------------------------------------------------------------------

export function markActive(state, type) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function markAttr(state, type, attr) {
  const { from, $from, to, empty } = state.selection;
  let found = null;
  if (empty) {
    const m = type.isInSet(state.storedMarks || $from.marks());
    return m ? m.attrs[attr] : null;
  }
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    const m = type.isInSet(node.marks);
    if (m) found = m.attrs[attr];
    return true;
  });
  return found;
}

/** Ближайший предок одного из типов: { node, pos, depth } или null. */
export function findParent(state, types, $pos) {
  const $p = $pos || state.selection.$from;
  for (let d = $p.depth; d > 0; d--) {
    const node = $p.node(d);
    if (types.includes(node.type)) return { node, pos: $p.before(d), depth: d };
  }
  return null;
}

/** Что сейчас под курсором — для подсветки кнопок и для телефона. */
export function formatState(state) {
  const { $from } = state.selection;
  const parent = $from.parent;
  let block = 'paragraph';
  if (parent.type === N.heading) block = `h${parent.attrs.level}`;
  else if (parent.type === N.code_block) block = 'code_block';
  const list = findParent(state, LISTS);
  const sel = state.selection;
  return {
    strong: markActive(state, M.strong),
    em: markActive(state, M.em),
    underline: markActive(state, M.underline),
    strike: markActive(state, M.strike),
    code: markActive(state, M.code),
    sub: markActive(state, M.sub),
    sup: markActive(state, M.sup),
    link: markAttr(state, M.link, 'href'),
    textColor: markAttr(state, M.textColor, 'color'),
    highlight: markAttr(state, M.highlight, 'color'),
    fontSize: markAttr(state, M.fontSize, 'size'),
    fontFamily: markAttr(state, M.fontFamily, 'family'),
    block,
    list: list ? list.node.type.name : null,
    quote: !!findParent(state, [N.blockquote]),
    callout: (findParent(state, [N.callout]) || { node: null }).node ? findParent(state, [N.callout]).node.attrs.tone : null,
    align: parent.attrs && parent.attrs.align ? parent.attrs.align : 'left',
    inTable: isInTable(state),
    cellSelection: sel instanceof CellSelection,
    selectedNode: sel instanceof NodeSelection ? sel.node.type.name : null,
    empty: sel.empty,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

// --- метки ----------------------------------------------------------------------

export const toggle = (name) => toggleMark(M[name]);

/** Цветная метка (цвет текста, маркер): null снимает. */
export function setColorMark(name, color) {
  return setValueMark(name, 'color', color);
}

/** Метка с одним значением (цвет, размер, гарнитура) на выделение или на
 *  курсор — для того, что наберут дальше. null снимает. */
export function setValueMark(name, attr, value) {
  const type = M[name];
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) {
      if (dispatch) dispatch(value ? state.tr.addStoredMark(type.create({ [attr]: value })) : state.tr.removeStoredMark(type));
      return true;
    }
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, type);
      if (value) tr.addMark(from, to, type.create({ [attr]: value }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Диапазон метки ссылки вокруг курсора — чтобы править ссылку, не выделяя её. */
export function markRange(state, type, pos) {
  const $pos = state.doc.resolve(pos == null ? state.selection.from : pos);
  const { parent, parentOffset } = $pos;
  const kids = [];
  parent.forEach((n, off) => kids.push({ n, off }));
  const at = kids.findIndex((k) => k.off <= parentOffset && parentOffset <= k.off + k.n.nodeSize && type.isInSet(k.n.marks));
  if (at < 0) return null;
  const mark = type.isInSet(kids[at].n.marks);
  let lo = at;
  let hi = at;
  while (lo > 0 && mark.isInSet(kids[lo - 1].n.marks)) lo--;
  while (hi < kids.length - 1 && mark.isInSet(kids[hi + 1].n.marks)) hi++;
  const base = $pos.start();
  return { from: base + kids[lo].off, to: base + kids[hi].off + kids[hi].n.nodeSize, mark };
}

export function setLink(href, text) {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    const range = state.selection.empty ? markRange(state, M.link) : null;
    if (range) { from = range.from; to = range.to; }
    if (!dispatch) return true;
    const tr = state.tr;
    if (!href) {
      tr.removeMark(from, to, M.link);
    } else if (from === to) {
      const t = text || href;
      tr.insertText(t, from);
      tr.addMark(from, from + t.length, M.link.create({ href }));
      tr.setSelection(TextSelection.create(tr.doc, from + t.length));
    } else {
      tr.removeMark(from, to, M.link).addMark(from, to, M.link.create({ href }));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Снять оформление: все строчные метки, кроме ссылок и комментариев, — они
 *  не «оформление», а содержание. И выравнивание. */
export function clearFormatting(state, dispatch) {
  const { from, to } = state.selection;
  if (dispatch) {
    const tr = state.tr;
    for (const name of ['strong', 'em', 'underline', 'strike', 'code', 'sub', 'sup', 'textColor', 'highlight', 'fontSize', 'fontFamily']) tr.removeMark(from, to, M[name]);
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && node.attrs.align) tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { align: null }));
    });
    tr.setStoredMarks([]);
    dispatch(tr);
  }
  return true;
}

// --- блоки ------------------------------------------------------------------------

export function setHeading(level) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type === N.heading && $from.parent.attrs.level === level) return setBlockType(N.paragraph)(state, dispatch);
    return setBlockType(N.heading, { level })(state, dispatch);
  };
}

export const setParagraph = (state, dispatch) => setBlockType(N.paragraph)(state, dispatch);

export function toggleCodeBlock(state, dispatch) {
  if (state.selection.$from.parent.type === N.code_block) return setBlockType(N.paragraph)(state, dispatch);
  return setBlockType(N.code_block)(state, dispatch);
}

function toggleWrapper(type, attrs) {
  return (state, dispatch) => {
    const found = findParent(state, [type]);
    if (found) {
      if (attrs && found.node.attrs.tone !== attrs.tone) {
        if (dispatch) dispatch(state.tr.setNodeMarkup(found.pos, null, Object.assign({}, found.node.attrs, attrs)));
        return true;
      }
      return lift(state, dispatch);
    }
    return wrapIn(type, attrs)(state, dispatch);
  };
}

export const toggleQuote = toggleWrapper(N.blockquote);
export const toggleCallout = (tone) => toggleWrapper(N.callout, { tone: tone || 'info' });

/** Список: тот же тип — снять; другой — перекрасить на месте; нет — обернуть. */
export function toggleList(name) {
  const target = N[name];
  const itemType = target === N.task_list ? N.task_item : N.list_item;
  return (state, dispatch) => {
    const found = findParent(state, LISTS);
    if (found && found.node.type === target) {
      const item = findParent(state, ITEMS);
      return liftListItem(item ? item.node.type : itemType)(state, dispatch);
    }
    if (found) {
      if (dispatch) {
        const { from, to } = state.selection;
        const items = [];
        found.node.forEach((it) => items.push(itemType.create(itemType === N.task_item ? { checked: !!it.attrs.checked } : null, it.content)));
        const attrs = target === N.ordered_list ? { bid: found.node.attrs.bid, order: 1 } : { bid: found.node.attrs.bid };
        const tr = state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, target.create(attrs, items));
        tr.setSelection(TextSelection.create(tr.doc, Math.min(from, tr.doc.content.size), Math.min(to, tr.doc.content.size)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return wrapInList(target)(state, dispatch);
  };
}

const currentItemType = (state) => {
  const item = findParent(state, ITEMS);
  return item ? item.node.type : null;
};

export function indent(state, dispatch) {
  const t = currentItemType(state);
  return t ? sinkListItem(t)(state, dispatch) : false;
}

export function outdent(state, dispatch) {
  const t = currentItemType(state);
  return t ? liftListItem(t)(state, dispatch) : false;
}

export function splitItem(state, dispatch) {
  const t = currentItemType(state);
  if (!t) return false;
  // Enter в новом пункте чек-листа — пункт не отмечен, даже если прошлый был.
  if (t === N.task_item) {
    return splitListItem(N.task_item, { checked: false })(state, dispatch);
  }
  return splitListItem(t)(state, dispatch);
}

export function setAlign(align) {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let any = false;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === N.paragraph || node.type === N.heading) {
        tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { align: align === 'left' ? null : align }));
        any = true;
      }
    });
    if (any && dispatch) dispatch(tr);
    return any;
  };
}

export const hardBreak = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView());
  return true;
});

// --- вставка ----------------------------------------------------------------------

/** Вставить блок на место курсора и встать за ним в новый абзац, если за
 *  ним ничего нет: иначе после картинки в конце документа некуда писать. */
export function insertBlock(node) {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const tr = state.tr;
    const { $from } = state.selection;
    const emptyPara = $from.parent.type === N.paragraph && $from.parent.content.size === 0 && $from.depth >= 1;
    if (emptyPara) {
      const start = $from.before();
      tr.replaceWith(start, start + $from.parent.nodeSize, node);
    } else {
      tr.replaceSelectionWith(node);
    }
    const after = tr.mapping.map(state.selection.to);
    const $after = tr.doc.resolve(Math.min(after, tr.doc.content.size));
    let pos = $after.pos;
    const nodeAfter = tr.doc.nodeAt(pos);
    if (!nodeAfter || !nodeAfter.isTextblock) {
      tr.insert(pos, N.paragraph.create());
      pos += 1;
    } else pos += 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export function insertTable(rows, cols, withHeader) {
  return (state, dispatch) => {
    const cell = () => N.table_cell.createAndFill();
    const head = () => N.table_header.createAndFill();
    const rowNodes = [];
    for (let r = 0; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < cols; c++) cells.push(withHeader && r === 0 ? head() : cell());
      rowNodes.push(N.table_row.create(null, cells));
    }
    const table = N.table.create(null, rowNodes);
    if (!dispatch) return true;
    insertBlock(table)(state, (tr) => {
      // Курсор — в первую ячейку: таблицу вставляют, чтобы сразу писать.
      const found = [];
      tr.doc.descendants((n, pos) => { if (n === table) found.push(pos); return !found.length; });
      if (found.length) tr.setSelection(TextSelection.near(tr.doc.resolve(found[0] + 3)));
      dispatch(tr);
    });
    return true;
  };
}

export const insertRule = (state, dispatch) => insertBlock(N.horizontal_rule.create())(state, dispatch);

export const insertImage = (attrs) => insertBlock(N.image.create(attrs));
export const insertChart = (chart) => insertBlock(N.chart.create({ chart }));
export const insertDrawing = (attrs) => insertBlock(N.drawing.create(attrs || {}));

// --- ряд картинок --------------------------------------------------------------------

/** Картинка по позиции и её ряд, если она в ряду. */
function imageAt(state, pos) {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type !== N.image) return null;
  const $p = state.doc.resolve(pos);
  const inRow = $p.parent.type === N.gallery;
  return { node, pos, inRow, rowPos: inRow ? $p.before() : null, row: inRow ? $p.parent : null, index: $p.index() };
}

/** Ещё картинка справа от данной: отдельная становится рядом из двух. */
export function addImageBeside(pos, attrs) {
  return (state, dispatch) => {
    const at = imageAt(state, pos);
    if (!at) return false;
    if (dispatch) {
      const added = N.image.create(Object.assign({ align: 'center' }, attrs));
      const tr = state.tr;
      if (at.inRow) tr.insert(pos + at.node.nodeSize, added);
      else {
        const first = N.image.create(Object.assign({}, at.node.attrs, { align: 'center', width: null, bid: null }));
        tr.replaceWith(pos, pos + at.node.nodeSize, N.gallery.create({ bid: at.node.attrs.bid }, [first, added]));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Поменять картинку местами с соседкой по ряду. */
export function moveInGallery(pos, dir) {
  return (state, dispatch) => {
    const at = imageAt(state, pos);
    if (!at || !at.inRow) return false;
    const to = at.index + dir;
    if (to < 0 || to >= at.row.childCount) return false;
    if (dispatch) {
      const kids = [];
      at.row.forEach((n) => kids.push(n));
      [kids[at.index], kids[to]] = [kids[to], kids[at.index]];
      dispatch(state.tr.replaceWith(at.rowPos, at.rowPos + at.row.nodeSize, N.gallery.create(at.row.attrs, kids)));
    }
    return true;
  };
}

/** Вынести картинку из ряда — отдельной строкой сразу под ним. */
export function takeOutOfGallery(pos) {
  return (state, dispatch) => {
    const at = imageAt(state, pos);
    if (!at || !at.inRow) return false;
    if (dispatch) {
      const alone = N.image.create(Object.assign({}, at.node.attrs, { width: null, bid: null }));
      const tr = state.tr.insert(at.rowPos + at.row.nodeSize, alone);
      tr.delete(pos, pos + at.node.nodeSize);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// --- таблицы -----------------------------------------------------------------------

export const table = {
  rowAbove: addRowBefore,
  rowBelow: addRowAfter,
  colLeft: addColumnBefore,
  colRight: addColumnAfter,
  rowDel: deleteRow,
  colDel: deleteColumn,
  tableDel: deleteTable,
  merge: mergeCells,
  split: splitCell,
  headerRow: toggleHeaderRow,
  headerCol: toggleHeaderColumn,
  fill: (color) => setCellAttr('background', color || null),
};

/** Строки таблицы под курсором текстом — для «график из таблицы». */
export function tableRowsAtCursor(state) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const rows = [];
  rect.table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

// --- блок целиком ---------------------------------------------------------------------

/** Блок верхнего уровня под курсором: { node, pos }. */
export function topBlock(state, pos) {
  const $p = state.doc.resolve(pos == null ? state.selection.from : pos);
  if ($p.depth === 0) {
    const node = state.doc.nodeAt(pos);
    return node ? { node, pos } : null;
  }
  return { node: $p.node(1), pos: $p.before(1) };
}

export function moveBlock(dir) {
  return (state, dispatch) => {
    const b = topBlock(state);
    if (!b) return false;
    const $b = state.doc.resolve(b.pos);
    const index = $b.index(0);
    const target = index + dir;
    if (target < 0 || target >= state.doc.childCount) return false;
    if (dispatch) {
      const other = state.doc.child(target);
      const tr = state.tr;
      const offset = state.selection.from - b.pos;
      if (dir < 0) {
        const otherPos = b.pos - other.nodeSize;
        tr.delete(b.pos, b.pos + b.node.nodeSize).insert(otherPos, b.node);
        tr.setSelection(TextSelection.near(tr.doc.resolve(otherPos + offset)));
      } else {
        const otherEnd = b.pos + b.node.nodeSize + other.nodeSize;
        tr.insert(otherEnd, b.node).delete(b.pos, b.pos + b.node.nodeSize);
        const newPos = b.pos + other.nodeSize;
        tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + offset)));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function duplicateBlock(state, dispatch) {
  const b = topBlock(state);
  if (!b) return false;
  if (dispatch) {
    const copy = b.node.type.create(Object.assign({}, b.node.attrs, { bid: null }), b.node.content, b.node.marks);
    dispatch(state.tr.insert(b.pos + b.node.nodeSize, copy).scrollIntoView());
  }
  return true;
}

export function deleteBlock(state, dispatch) {
  const b = topBlock(state);
  if (!b) return false;
  if (dispatch) {
    const tr = state.tr.delete(b.pos, b.pos + b.node.nodeSize);
    if (!tr.doc.childCount) tr.insert(0, N.paragraph.create());
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** «Превратить в» — для меню блока: тип текста меняется, содержание остаётся. */
export function turnInto(kind) {
  const map = {
    paragraph: setParagraph,
    h1: setBlockType(N.heading, { level: 1 }),
    h2: setBlockType(N.heading, { level: 2 }),
    h3: setBlockType(N.heading, { level: 3 }),
    h4: setBlockType(N.heading, { level: 4 }),
    bullet_list: toggleList('bullet_list'),
    ordered_list: toggleList('ordered_list'),
    task_list: toggleList('task_list'),
    quote: toggleQuote,
    code_block: toggleCodeBlock,
  };
  return map[kind] || (() => false);
}

export { undo, redo };

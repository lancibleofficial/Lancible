// Плагины без своего интерфейса: номера блоков, подсказка в пустом
// документе, markdown-сокращения, типографика, клавиши.
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import {
  inputRules, wrappingInputRule, textblockTypeInputRule, InputRule, ellipsis, undoInputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward,
} from 'prosemirror-commands';
import { goToNextCell, isInTable, addRowAfter } from 'prosemirror-tables';
import { findWrapping } from 'prosemirror-transform';
import { schema } from './schema.js';
import * as C from './commands.js';
import { shortId } from './util.js';

const N = schema.nodes;
const M = schema.marks;

// --- номера блоков ------------------------------------------------------------

/** У каждого блока верхнего уровня свой bid, и он не повторяется. Вставка
 *  копирует bid вместе с блоком — у второго экземпляра номер меняется, у
 *  первого остаётся: пометки от руки держатся за первый. */
export const blockIds = new Plugin({
  key: new PluginKey('led-bids'),
  appendTransaction(trs, _old, state) {
    if (!trs.some((tr) => tr.docChanged) && !trs.some((tr) => tr.getMeta('led-init'))) return null;
    const seen = new Set();
    let tr = null;
    state.doc.forEach((node, pos) => {
      if (!node.type.spec.attrs || !('bid' in node.type.spec.attrs)) return;
      let bid = node.attrs.bid;
      if (!bid || seen.has(bid)) {
        bid = shortId();
        tr = tr || state.tr;
        tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { bid }));
      }
      seen.add(bid);
    });
    if (tr) tr.setMeta('addToHistory', false);
    return tr;
  },
});

// --- ряд из одной картинки ------------------------------------------------------

/** Ряд, в котором осталась одна картинка (остальные удалили или вынесли), —
 *  уже не ряд: становится обычной картинкой по центру. */
export const galleryNormalize = new Plugin({
  key: new PluginKey('led-gallery'),
  appendTransaction(trs, _old, state) {
    if (!trs.some((tr) => tr.docChanged)) return null;
    let tr = null;
    const lonely = [];
    state.doc.descendants((node, pos) => {
      if (node.type === N.gallery && node.childCount === 1) lonely.push({ node, pos });
      return node.type !== N.gallery && node.isBlock && !node.isTextblock;
    });
    for (const { node, pos } of lonely.reverse()) {
      tr = tr || state.tr;
      const img = node.firstChild;
      tr.replaceWith(pos, pos + node.nodeSize, N.image.create(Object.assign({}, img.attrs, { width: null, align: 'center', bid: node.attrs.bid })));
    }
    return tr;
  },
});

// --- подсказка в пустом ---------------------------------------------------------

export function placeholder(getText, getLineText) {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc, selection } = state;
        const single = doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0;
        if (single) {
          return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild.nodeSize, { class: 'led-empty', 'data-ph': getText() })]);
        }
        // Пустая строка под курсором — подсказка «/ — вставить блок».
        const { $from } = selection;
        if (selection.empty && $from.parent.type === N.paragraph && $from.parent.content.size === 0 && $from.depth === 1) {
          const start = $from.before();
          return DecorationSet.create(doc, [Decoration.node(start, start + $from.parent.nodeSize, { class: 'led-empty-line', 'data-ph': getLineText() })]);
        }
        return null;
      },
    },
  });
}

// --- markdown-сокращения ------------------------------------------------------------

function markRule(re, make) {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[2];
    if (!inner || /^\s|\s$/.test(inner)) return null;
    const lead = match[1] || '';
    const mark = make();
    const tr = state.tr;
    const from = start + lead.length;
    tr.delete(from, end);
    tr.insertText(inner, from);
    tr.addMark(from, from + inner.length, mark);
    tr.removeStoredMark(mark.type);
    return tr;
  });
}

const hrRule = new InputRule(/^(?:---|___|\*\*\*)$/, (state, _m, start, end) => {
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== N.paragraph) return null;
  const tr = state.tr.delete(start, end);
  const pos = $s.before();
  tr.replaceWith(pos, pos + tr.doc.nodeAt(pos).nodeSize, [N.horizontal_rule.create(), N.paragraph.create()]);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
  return tr;
});

const taskRule = new InputRule(/^\s*(?:[-*]\s)?\[( |x|X)?\]\s$/, (state, match, start, end) => {
  const checked = !!(match[1] && match[1].trim());
  // Уже в чек-листе: «[x] » в начале пункта — просто отметить его.
  const $start = state.doc.resolve(start);
  for (let d = $start.depth; d > 0; d--) {
    if ($start.node(d).type === N.task_item) {
      return state.tr.delete(start, end).setNodeMarkup($start.before(d), null, { checked });
    }
  }
  const tr = state.tr.delete(start, end);
  const range = tr.doc.resolve(start).blockRange();
  const wrapping = range && findWrapping(range, N.task_list);
  if (!wrapping) return null;
  tr.wrap(range, wrapping);
  if (checked) {
    const $in = tr.doc.resolve(Math.min(start + 2, tr.doc.content.size));
    for (let d = $in.depth; d > 0; d--) {
      if ($in.node(d).type === N.task_item) { tr.setNodeMarkup($in.before(d), null, { checked: true }); break; }
    }
  }
  return tr;
});

/** Типографика: кавычки-«ёлочки» для кириллицы, “лапки” — для английского. */
function quoteRules(getLang) {
  const open = () => (getLang() === 'en' ? '“' : '«');
  const close = () => (getLang() === 'en' ? '”' : '»');
  return [
    // Набранная кавычка в документ ещё не попала: вставляем свою на её место.
    new InputRule(/(?:^|[\s{[(<'"‘“«])(")$/, (state, _m, _start, end) => state.tr.insertText(open(), end)),
    new InputRule(/"$/, (state, _m, _start, end) => state.tr.insertText(close(), end)),
    new InputRule(/--$/, '—'),
    new InputRule(/->$/, '→'),
    new InputRule(/<-$/, '←'),
    new InputRule(/\(c\)$/i, '©'),
    ellipsis,
  ];
}

export function buildInputRules(opts) {
  const rules = [
    textblockTypeInputRule(/^(#{1,4})\s$/, N.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, N.blockquote),
    taskRule,
    wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list),
    wrappingInputRule(/^\s*(\d+)\.\s$/, N.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
    textblockTypeInputRule(/^```([a-z0-9+#-]*)\s$/i, N.code_block, (m) => ({ language: m[1] || '' })),
    hrRule,
    markRule(/(^|[^*])\*\*([^*]+)\*\*$/, () => M.strong.create()),
    markRule(/(^|[^_\w])__([^_]+)__$/, () => M.strong.create()),
    markRule(/(^|[^*])\*([^*]+)\*$/, () => M.em.create()),
    markRule(/(^|[^_\w])_([^_]+)_$/, () => M.em.create()),
    markRule(/(^|[^~])~~([^~]+)~~$/, () => M.strike.create()),
    markRule(/(^|[^=])==([^=]+)==$/, () => M.highlight.create({ color: 'yellow' })),
    markRule(/(^|[^`])`([^`]+)`$/, () => M.code.create()),
  ];
  if (opts.smartTypography()) rules.push(...quoteRules(opts.getLang));
  return inputRules({ rules });
}

// --- клавиши ------------------------------------------------------------------------

export function buildKeymaps(actions) {
  const keys = {
    'Mod-z': C.undo,
    'Mod-y': C.redo,
    'Shift-Mod-z': C.redo,
    Backspace: chainCommands(undoInputRule, deleteSelection, joinBackward, selectNodeBackward),
    'Mod-b': C.toggle('strong'),
    'Mod-i': C.toggle('em'),
    'Mod-u': C.toggle('underline'),
    'Mod-Shift-x': C.toggle('strike'),
    'Mod-Shift-s': C.toggle('strike'),
    'Mod-e': C.toggle('code'),
    'Mod-Shift-h': (s, d) => C.setColorMark('highlight', C.formatState(s).highlight ? null : 'yellow')(s, d),
    'Mod-.': C.toggle('sup'),
    'Mod-,': C.toggle('sub'),
    'Mod-\\': C.clearFormatting,
    'Mod-Alt-0': C.setParagraph,
    'Mod-Alt-1': C.setHeading(1),
    'Mod-Alt-2': C.setHeading(2),
    'Mod-Alt-3': C.setHeading(3),
    'Mod-Alt-4': C.setHeading(4),
    'Mod-Shift-7': C.toggleList('ordered_list'),
    'Mod-Shift-8': C.toggleList('bullet_list'),
    'Mod-Shift-9': C.toggleList('task_list'),
    'Mod-Shift-b': C.toggleQuote,
    'Mod-Alt-c': C.toggleCodeBlock,
    'Mod-Shift-l': C.setAlign('left'),
    'Mod-Shift-e': C.setAlign('center'),
    'Mod-Shift-r': C.setAlign('right'),
    'Mod-Shift-j': C.setAlign('justify'),
    'Alt-Shift-ArrowUp': C.moveBlock(-1),
    'Alt-Shift-ArrowDown': C.moveBlock(1),
    'Mod-d': C.duplicateBlock,
    'Shift-Enter': C.hardBreak,
    'Mod-Enter': (s, d) => {
      // Ctrl+Enter в чек-листе — отметить пункт.
      const item = C.findParent(s, [N.task_item]);
      if (!item) return false;
      if (d) d(s.tr.setNodeMarkup(item.pos, null, { checked: !item.node.attrs.checked }));
      return true;
    },
    Enter: C.splitItem,
    Tab: chainCommands(goToNextCell(1), (s, d, view) => {
      // Tab в последней ячейке — новая строка и курсор в неё, а не уход
      // фокуса из таблицы на кнопки.
      if (!isInTable(s)) return false;
      if (!d || !view) return true;
      addRowAfter(s, d);
      goToNextCell(1)(view.state, view.dispatch);
      return true;
    }, C.indent, (s, d) => {
      // Табуляция в коде — два пробела, а не уход фокуса.
      if (s.selection.$from.parent.type !== N.code_block) return false;
      if (d) d(s.tr.insertText('  '));
      return true;
    }),
    'Shift-Tab': chainCommands(goToNextCell(-1), C.outdent),
  };
  Object.assign(keys, actions || {});
  return [keymap(keys), keymap(baseKeymap)];
}

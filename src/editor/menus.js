// Меню «/», панель над выделением и ручка блока слева.
import { Plugin, PluginKey, NodeSelection, TextSelection } from 'prosemirror-state';
import { h, icon, btn, placePopup, keyLabel } from './util.js';
import { menu, colorGrid, popup } from './ui.js';
import * as C from './commands.js';
import { schema } from './schema.js';

const N = schema.nodes;

// --- что можно вставить ---------------------------------------------------------

/** Блоки для меню «/» и кнопки «+». keys — для поиска на всех языках. */
export function blockItems(ed) {
  const t = ed.t;
  return [
    { id: 'paragraph', icon: 'text', label: t('block.paragraph'), keys: 'text paragraph текст абзац мәтін', run: C.setParagraph },
    { id: 'h1', icon: 'h1', label: t('block.h1'), keys: 'h1 heading title заголовок тақырып', kbd: 'Mod-Alt-1', run: C.setHeading(1) },
    { id: 'h2', icon: 'h2', label: t('block.h2'), keys: 'h2 heading subtitle заголовок подзаголовок', kbd: 'Mod-Alt-2', run: C.setHeading(2) },
    { id: 'h3', icon: 'h3', label: t('block.h3'), keys: 'h3 heading заголовок', kbd: 'Mod-Alt-3', run: C.setHeading(3) },
    { id: 'h4', icon: 'h4', label: t('block.h4'), keys: 'h4 heading заголовок', kbd: 'Mod-Alt-4', run: C.setHeading(4) },
    { id: 'bullet', icon: 'bullet', label: t('block.bullet'), keys: 'list bullet ul список маркированный тізім', kbd: 'Mod-Shift-8', run: C.toggleList('bullet_list') },
    { id: 'ordered', icon: 'ordered', label: t('block.ordered'), keys: 'list ordered numbered ol нумерованный список', kbd: 'Mod-Shift-7', run: C.toggleList('ordered_list') },
    { id: 'tasks', icon: 'tasks', label: t('block.tasks'), keys: 'todo task check checklist чек-лист задачи галочки', kbd: 'Mod-Shift-9', run: C.toggleList('task_list') },
    { id: 'quote', icon: 'quote', label: t('block.quote'), keys: 'quote blockquote цитата дәйексөз', kbd: 'Mod-Shift-b', run: C.toggleQuote },
    { id: 'callout', icon: 'info', label: t('block.callout'), keys: 'callout note info выноска заметка важно', run: C.toggleCallout('info') },
    { id: 'callout_warn', icon: 'warn', label: t('block.callout_warn'), keys: 'warning callout внимание предупреждение', run: C.toggleCallout('warn') },
    { id: 'callout_idea', icon: 'idea', label: t('block.callout_idea'), keys: 'idea tip идея совет', run: C.toggleCallout('idea') },
    { id: 'code', icon: 'codeblock', label: t('block.code'), keys: 'code pre snippet код программа', kbd: 'Mod-Alt-c', run: C.toggleCodeBlock },
    { id: 'hr', icon: 'hr', label: t('block.hr'), keys: 'hr divider line separator разделитель линия', run: C.insertRule },
    { id: 'table', icon: 'table', label: t('block.table'), keys: 'table grid таблица кесте', run: C.insertTable(3, 3, true) },
    { id: 'image', icon: 'image', label: t('block.image'), keys: 'image picture photo картинка изображение фото сурет', run: () => { ed.pickImage(); return true; } },
    { id: 'chart', icon: 'chart', label: t('block.chart'), keys: 'chart graph plot диаграмма график', run: () => { ed.insertChart(); return true; } },
    { id: 'drawing', icon: 'draw', label: t('block.drawing'), keys: 'draw sketch canvas pen рисунок рисовать холст сурет салу', run: () => { ed.insertDrawing(); return true; } },
  ];
}

// --- меню «/» --------------------------------------------------------------------

export const slashKey = new PluginKey('led-slash');

/** Плагин ловит «/» в начале строки или после пробела и держит запрос. */
export function slashPlugin(ed) {
  // Где меню закрыли Esc-ом: у этого «/» оно больше само не откроется.
  let closedAt = null;
  return new Plugin({
    key: slashKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(slashKey);
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parent.type === N.code_block) return null;
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, null, '\ufffc');
        const m = /(?:^|\s)\/([\p{L}\p{N}_-]{0,24})$/u.exec(before);
        if (!m) { closedAt = null; return null; }
        const from = $from.pos - m[1].length - 1;
        if (meta === 'close') { closedAt = from; return null; }
        if (closedAt === from) return null;
        // Открывается, когда «/» набрали, а не когда курсор встал за ним.
        if (!prev && !tr.docChanged) return null;
        return { query: m[1], from, to: $from.pos };
      },
    },
    props: {
      handleKeyDown(view, e) {
        const st = slashKey.getState(view.state);
        if (!st) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { ed.slash.move(e.key === 'ArrowDown' ? 1 : -1); return true; }
        if (e.key === 'Enter' || e.key === 'Tab') { ed.slash.choose(); return true; }
        if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(slashKey, 'close')); return true; }
        return false;
      },
    },
    view: () => ({ update: (view) => ed.slash.sync(view) }),
  });
}

export class SlashMenu {
  constructor(ed) {
    this.ed = ed;
    this.dom = h('div', { class: 'ctx-menu led-slash', role: 'listbox', hidden: true });
    this.items = [];
    this.index = 0;
  }

  filtered(query) {
    const q = (query || '').toLowerCase();
    const all = blockItems(this.ed);
    if (!q) return all;
    return all.filter((it) => it.label.toLowerCase().includes(q) || it.keys.includes(q) || it.id.includes(q));
  }

  sync(view) {
    const st = slashKey.getState(view.state);
    if (!st) { this.hide(); return; }
    this.items = this.filtered(st.query);
    if (!this.items.length) { this.hide(); return; }
    this.index = Math.min(this.index, this.items.length - 1);
    this.paint();
    if (!this.dom.isConnected) this.ed.root.append(this.dom);
    this.dom.hidden = false;
    const c = view.coordsAtPos(st.from);
    placePopup(this.dom, c.left, c.bottom + 6, { flipY: c.top });
  }

  paint() {
    this.dom.replaceChildren(...this.items.map((it, i) => h('button', {
      type: 'button', class: `ctx-item${i === this.index ? ' led-cur' : ''}`, role: 'option',
      onmousedown: (e) => e.preventDefault(),
      onmouseenter: () => { this.index = i; this.paint(); },
      onclick: () => { this.index = i; this.choose(); },
    }, h('span', { class: 'ctx-main' }, icon(it.icon, 16), h('span', {}, it.label)), it.kbd ? h('span', { class: 'led-kbd' }, keyLabel(it.kbd)) : null)));
    const cur = this.dom.children[this.index];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  move(d) {
    if (!this.items.length) return;
    this.index = (this.index + d + this.items.length) % this.items.length;
    this.paint();
  }

  choose() {
    const { view } = this.ed;
    const st = slashKey.getState(view.state);
    const it = this.items[this.index];
    if (!st || !it) return;
    view.dispatch(view.state.tr.delete(st.from, st.to).setMeta(slashKey, 'close'));
    it.run(view.state, view.dispatch, view);
    view.focus();
    this.index = 0;
  }

  hide() {
    this.dom.hidden = true;
    this.index = 0;
  }
}

// --- панель над выделением ----------------------------------------------------------

export class BubbleMenu {
  constructor(ed) {
    this.ed = ed;
    const t = ed.t;
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch, ed.view); ed.view.focus(); };
    this.buttons = {
      turn: h('button', {
        type: 'button', class: 'led-btn led-turn', title: t('block.turn_into'),
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => this.turnMenu(e.currentTarget),
      }, h('span', { class: 'led-turn-label' }), icon('chevronDown', 14)),
      strong: btn('bold', `${t('fmt.bold')} (${keyLabel('Mod-b')})`, run(C.toggle('strong'))),
      em: btn('italic', `${t('fmt.italic')} (${keyLabel('Mod-i')})`, run(C.toggle('em'))),
      underline: btn('underline', `${t('fmt.underline')} (${keyLabel('Mod-u')})`, run(C.toggle('underline'))),
      strike: btn('strike', `${t('fmt.strike')} (${keyLabel('Mod-Shift-x')})`, run(C.toggle('strike'))),
      code: btn('code', `${t('fmt.code')} (${keyLabel('Mod-e')})`, run(C.toggle('code'))),
      link: btn('link', `${t('fmt.link')} (${keyLabel('Mod-k')})`, () => ed.editLink(this.buttons.link)),
      color: btn('color', t('fmt.text_color'), () => this.colorMenu('tc', this.buttons.color)),
      highlight: btn('highlight', `${t('fmt.highlight')} (${keyLabel('Mod-Shift-h')})`, () => this.colorMenu('hl', this.buttons.highlight)),
      comment: btn('comment', `${t('comments.add')} (${keyLabel('Mod-Alt-m')})`, () => ed.addComment()),
    };
    this.dom = h('div', { class: 'led-bubble', role: 'toolbar', hidden: true }, ...Object.values(this.buttons));
    this.dom.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
  }

  colorMenu(kind, anchor) {
    const fs = C.formatState(this.ed.view.state);
    const cur = kind === 'tc' ? fs.textColor : fs.highlight;
    const p = popup(this.ed.root, anchor, colorGrid(kind, cur, (c) => {
      C.setColorMark(kind === 'tc' ? 'textColor' : 'highlight', c)(this.ed.view.state, this.ed.view.dispatch);
      p.close();
      this.ed.view.focus();
    }, this.ed.t));
  }

  turnMenu(anchor) {
    const { t } = this.ed;
    const fs = C.formatState(this.ed.view.state);
    const cur = fs.list || fs.block;
    const kinds = [['paragraph', 'text'], ['h1', 'h1'], ['h2', 'h2'], ['h3', 'h3'], ['h4', 'h4'], ['bullet_list', 'bullet'], ['ordered_list', 'ordered'], ['task_list', 'tasks'], ['quote', 'quote'], ['code_block', 'codeblock']];
    menu(this.ed.root, anchor, kinds.map(([k, ic]) => ({
      label: t(`turn.${k}`), icon: ic, active: cur === k || (k === 'quote' && fs.quote),
      run: () => { C.turnInto(k)(this.ed.view.state, this.ed.view.dispatch); this.ed.view.focus(); },
    })));
  }

  update(view, focused) {
    const { state } = view;
    const sel = state.selection;
    const show = focused && view.editable && !sel.empty && sel instanceof TextSelection && !this.ed.isMobile
      && state.selection.$from.parent.type !== N.code_block && !this.ed.dragging;
    if (!show) { this.dom.hidden = true; return; }
    const fs = C.formatState(state);
    for (const k of ['strong', 'em', 'underline', 'strike', 'code']) this.buttons[k].classList.toggle('on', !!fs[k]);
    this.buttons.link.classList.toggle('on', !!fs.link);
    this.buttons.color.classList.toggle('on', !!fs.textColor);
    this.buttons.highlight.classList.toggle('on', !!fs.highlight);
    const label = this.buttons.turn.querySelector('.led-turn-label');
    label.textContent = this.ed.t(`turn.${fs.list || (fs.quote ? 'quote' : fs.block)}`);
    if (!this.dom.isConnected) this.ed.root.append(this.dom);
    this.dom.hidden = false;
    const a = view.coordsAtPos(sel.from);
    const b = view.coordsAtPos(sel.to);
    const left = a.top === b.top ? (a.left + b.right) / 2 : a.left + 120;
    placePopup(this.dom, left, Math.min(a.top, b.top), { above: true, below: Math.max(a.bottom, b.bottom), center: true });
  }
}

// --- ручка блока -----------------------------------------------------------------------

export class BlockHandle {
  constructor(ed) {
    this.ed = ed;
    const t = ed.t;
    this.pos = null;
    this.plus = h('button', { type: 'button', class: 'led-handle-btn', title: t('block.add_below'), onmousedown: (e) => e.preventDefault(), onclick: () => this.addBelow() }, icon('plus', 16));
    this.grip = h('button', { type: 'button', class: 'led-handle-btn led-grip', title: t('block.drag_hint'), draggable: 'true', onclick: (e) => this.blockMenu(e.currentTarget) }, icon('grip', 16));
    this.dom = h('div', { class: 'led-handle', hidden: true }, this.plus, this.grip);
    this.grip.addEventListener('dragstart', (e) => this.dragStart(e));
    this.grip.addEventListener('dragend', () => { ed.dragging = false; });
  }

  /** Встать у блока под указателем. */
  track(e) {
    const { view } = this.ed;
    if (!view.editable || this.ed.isMobile) return;
    const box = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({ left: Math.max(box.left + 4, Math.min(e.clientX, box.right - 4)), top: e.clientY });
    if (!hit) return;
    let pos = hit.inside >= 0 ? hit.inside : hit.pos;
    const $p = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
    if ($p.depth === 0) {
      const node = view.state.doc.nodeAt(pos);
      if (!node) return;
    } else pos = $p.before(1);
    const dom = view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return;
    this.pos = pos;
    const r = dom.getBoundingClientRect();
    // Ручка лежит в полосе текста (.led-page-wrap) — от неё и считаем.
    const host = this.dom.parentElement;
    const hr = host.getBoundingClientRect();
    const style = getComputedStyle(dom);
    const lineTop = parseFloat(style.paddingTop) || 0;
    this.dom.hidden = false;
    this.dom.style.top = `${Math.round(r.top - hr.top + lineTop)}px`;
    this.dom.style.left = `${Math.round(box.left - hr.left - 52)}px`;
  }

  hide() { this.dom.hidden = true; }

  block() {
    if (this.pos == null) return null;
    const node = this.ed.view.state.doc.nodeAt(this.pos);
    return node ? { node, pos: this.pos } : null;
  }

  addBelow() {
    const b = this.block();
    if (!b) return;
    const { view } = this.ed;
    const at = b.pos + b.node.nodeSize;
    const tr = view.state.tr.insert(at, N.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    tr.insertText('/');
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  blockMenu(anchor) {
    const b = this.block();
    if (!b) return;
    const { view, t } = this.ed;
    // Курсор — в блок, чтобы команды знали, о каком блоке речь.
    const inside = b.node.isTextblock ? b.pos + 1 : (b.node.firstChild && b.node.firstChild.isTextblock ? b.pos + 2 : null);
    if (inside != null) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    else view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, b.pos)));
    const run = (cmd) => () => { cmd(view.state, view.dispatch); view.focus(); };
    const textual = b.node.isTextblock || ['bullet_list', 'ordered_list', 'task_list', 'blockquote'].includes(b.node.type.name);
    menu(this.ed.root, anchor, [
      ...(textual ? [{ heading: t('block.turn_into') },
        ...[['paragraph', 'text'], ['h1', 'h1'], ['h2', 'h2'], ['h3', 'h3'], ['bullet_list', 'bullet'], ['ordered_list', 'ordered'], ['task_list', 'tasks'], ['quote', 'quote'], ['code_block', 'codeblock']]
          .map(([k, ic]) => ({ label: t(`turn.${k}`), icon: ic, run: run(C.turnInto(k)) })), 'sep'] : []),
      { label: t('block.move_up'), icon: 'up', kbd: 'Alt-Shift-↑', run: run(C.moveBlock(-1)) },
      { label: t('block.move_down'), icon: 'down', kbd: 'Alt-Shift-↓', run: run(C.moveBlock(1)) },
      { label: t('block.duplicate'), icon: 'copy', kbd: 'Mod-d', run: run(C.duplicateBlock) },
      'sep',
      { label: t('block.delete'), icon: 'trash', danger: true, run: run(C.deleteBlock) },
    ]);
  }

  dragStart(e) {
    const b = this.block();
    if (!b) return;
    const { view } = this.ed;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, b.pos)));
    const slice = view.state.selection.content();
    const dom = view.nodeDOM(b.pos);
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/plain', b.node.textContent);
    e.dataTransfer.effectAllowed = 'copyMove';
    if (dom && dom.nodeType === 1) e.dataTransfer.setDragImage(dom, 0, 0);
    // Так ProseMirror понимает, что тащат его же блок, и переносит, а не копирует.
    view.dragging = { slice, move: true };
    this.ed.dragging = true;
  }
}

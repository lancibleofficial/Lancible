// Поиск и замена: Ctrl+F / Ctrl+H. Совпадения подсвечиваются в тексте,
// текущее — ярче; Enter — следующее, Shift+Enter — предыдущее.
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { h, icon } from './util.js';

export const findKey = new PluginKey('led-find');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Все совпадения в документе: [{from, to}]. Ищем внутри текстовых блоков —
 *  слово, разорванное меткой (полужирным посередине), всё равно находится. */
export function findMatches(doc, query, opts) {
  const out = [];
  if (!query) return out;
  const o = opts || {};
  let re;
  try {
    const src = o.regex ? query : escapeRe(query);
    re = new RegExp(o.whole ? `(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])` : src, `gu${o.caseSensitive ? '' : 'i'}`);
  } catch {
    return out;
  }
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Текст блока и карта «смещение в тексте → позиция в документе».
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex += 1; continue; }
      out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return out;
}

export const findPlugin = new Plugin({
  key: findKey,
  state: {
    init: () => ({ query: '', opts: {}, matches: [], index: -1 }),
    apply(tr, prev) {
      const meta = tr.getMeta(findKey);
      let next = prev;
      if (meta) next = Object.assign({}, prev, meta);
      if (meta || (tr.docChanged && next.query)) {
        const matches = findMatches(tr.doc, next.query, next.opts);
        let index = next.index;
        if (meta && meta.index == null && meta.query != null) {
          const at = tr.selection.from;
          index = matches.findIndex((m) => m.from >= at);
          if (index < 0) index = matches.length ? 0 : -1;
        }
        if (index >= matches.length) index = matches.length - 1;
        next = Object.assign({}, next, { matches, index });
      }
      return next;
    },
  },
  props: {
    decorations(state) {
      const st = findKey.getState(state);
      if (!st.query || !st.matches.length) return null;
      return DecorationSet.create(state.doc, st.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === st.index ? 'led-find-hit cur' : 'led-find-hit' })));
    },
  },
});

/** Полоса поиска над текстом. */
export class FindBar {
  constructor(ed) {
    this.ed = ed;
    const t = ed.t;
    this.opts = { caseSensitive: false, whole: false, regex: false };
    this.input = h('input', {
      class: 'field-sm led-find-in', placeholder: t('find.placeholder'), 'aria-label': t('find.placeholder'),
      oninput: () => this.search(),
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      },
    });
    this.replaceIn = h('input', {
      class: 'field-sm led-find-in', placeholder: t('find.replace_ph'), 'aria-label': t('find.replace_ph'),
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) this.replaceAll(); else this.replaceOne(); }
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      },
    });
    this.count = h('span', { class: 'led-find-count' });
    const flag = (key, label, title) => {
      const b = h('button', {
        type: 'button', class: 'led-flag', title, 'aria-pressed': 'false',
        onclick: () => { this.opts[key] = !this.opts[key]; b.setAttribute('aria-pressed', String(this.opts[key])); b.classList.toggle('on', this.opts[key]); this.search(); },
      }, label);
      return b;
    };
    this.replaceRow = h('div', { class: 'led-find-row', hidden: true },
      this.replaceIn,
      h('button', { type: 'button', class: 'btn-soft', onclick: () => this.replaceOne() }, t('find.replace')),
      h('button', { type: 'button', class: 'btn-soft', onclick: () => this.replaceAll() }, t('find.replace_all')));
    this.dom = h('div', { class: 'led-find', hidden: true, role: 'search' },
      h('div', { class: 'led-find-row' },
        h('button', {
          type: 'button', class: 'led-btn', title: t('find.toggle_replace'),
          onclick: () => { this.replaceRow.hidden = !this.replaceRow.hidden; if (!this.replaceRow.hidden) this.replaceIn.focus(); },
        }, icon('replace', 16)),
        this.input,
        flag('caseSensitive', 'Aa', t('find.case')),
        flag('whole', 'ab', t('find.whole')),
        flag('regex', '.*', t('find.regex')),
        this.count,
        h('button', { type: 'button', class: 'led-btn', title: t('find.prev'), onclick: () => this.step(-1) }, icon('up', 16)),
        h('button', { type: 'button', class: 'led-btn', title: t('find.next'), onclick: () => this.step(1) }, icon('down', 16)),
        h('button', { type: 'button', class: 'led-btn', title: t('common.close'), onclick: () => this.close() }, icon('x', 16))),
      this.replaceRow);
  }

  open(withReplace) {
    this.dom.hidden = false;
    if (withReplace) this.replaceRow.hidden = false;
    const { state } = this.ed.view;
    const sel = state.doc.textBetween(state.selection.from, state.selection.to, ' ');
    if (sel && sel.length < 80 && !sel.includes('\n')) this.input.value = sel;
    this.input.focus();
    this.input.select();
    this.search();
  }

  close() {
    this.dom.hidden = true;
    this.ed.view.dispatch(this.ed.view.state.tr.setMeta(findKey, { query: '' }));
    this.ed.view.focus();
  }

  state() { return findKey.getState(this.ed.view.state); }

  search() {
    this.ed.view.dispatch(this.ed.view.state.tr.setMeta(findKey, { query: this.input.value, opts: Object.assign({}, this.opts), index: null }));
    this.paint();
    this.reveal();
  }

  paint() {
    const st = this.state();
    this.count.textContent = st.query ? (st.matches.length ? `${st.index + 1} / ${st.matches.length}` : this.ed.t('find.none')) : '';
    this.count.classList.toggle('none', !!st.query && !st.matches.length);
  }

  reveal() {
    const st = this.state();
    const m = st.matches[st.index];
    if (!m) return;
    const { view } = this.ed;
    const dom = view.domAtPos(m.from);
    const node = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  step(dir) {
    const st = this.state();
    if (!st.matches.length) return;
    const index = (st.index + dir + st.matches.length) % st.matches.length;
    this.ed.view.dispatch(this.ed.view.state.tr.setMeta(findKey, { index }));
    this.paint();
    this.reveal();
  }

  replaceOne() {
    const st = this.state();
    const m = st.matches[st.index];
    if (!m) return;
    const { view } = this.ed;
    const tr = view.state.tr;
    const text = this.replaceIn.value;
    if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to);
    tr.setSelection(TextSelection.create(tr.doc, m.from + text.length));
    view.dispatch(tr);
    this.paint();
    this.reveal();
  }

  replaceAll() {
    const st = this.state();
    if (!st.matches.length) return;
    const { view } = this.ed;
    const tr = view.state.tr;
    const text = this.replaceIn.value;
    // С конца — чтобы позиции ещё не заменённых совпадений не съезжали.
    for (let i = st.matches.length - 1; i >= 0; i--) {
      const m = st.matches[i];
      if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to);
    }
    view.dispatch(tr);
    this.ed.toast(this.ed.t('find.replaced_n', { n: st.matches.length }));
    this.paint();
  }
}

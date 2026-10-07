// Виды узлов с живым содержимым: пункт чек-листа и блок кода.
import { h } from './util.js';
import { menu } from './ui.js';

/** Пункт чек-листа: галочка сбоку, текст — обычное содержимое. */
export class TaskItemView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.box = h('button', {
      type: 'button', class: 'led-task-box', contenteditable: 'false', role: 'checkbox',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => this.toggle(),
    });
    this.contentDOM = h('div', { class: 'led-task-text' });
    this.dom = h('li', { class: 'led-task' }, this.box, this.contentDOM);
    this.paint();
  }

  toggle() {
    if (!this.view.editable) return;
    const pos = this.getPos();
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { checked: !this.node.attrs.checked }));
  }

  paint() {
    const c = !!this.node.attrs.checked;
    this.dom.dataset.checked = String(c);
    this.box.setAttribute('aria-checked', String(c));
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    return true;
  }

  stopEvent(e) { return e.target === this.box; }

  ignoreMutation(m) { return m.type !== 'selection' && !this.contentDOM.contains(m.target); }
}

const LANGS = ['', 'js', 'ts', 'json', 'html', 'css', 'python', 'sql', 'bash', 'go', 'rust', 'java', 'kotlin', 'swift', 'php', 'ruby', 'c', 'cpp', 'csharp', 'yaml', 'markdown'];

/** Блок кода: подпись языка и копирование. */
export class CodeBlockView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    this.lang = h('button', {
      type: 'button', class: 'led-code-lang', contenteditable: 'false',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => this.pickLang(),
    });
    this.copy = h('button', {
      type: 'button', class: 'led-code-copy', contenteditable: 'false', title: ctx.t('code.copy'),
      onmousedown: (e) => e.preventDefault(),
      onclick: () => this.copyText(),
    }, ctx.t('code.copy'));
    this.contentDOM = h('code', { spellcheck: 'false' });
    this.dom = h('pre', { class: 'led-code' }, h('div', { class: 'led-code-head', contenteditable: 'false' }, this.lang, this.copy), this.contentDOM);
    this.paint();
  }

  paint() {
    this.lang.textContent = this.node.attrs.language || this.ctx.t('code.plain');
    this.dom.dataset.language = this.node.attrs.language || '';
  }

  pickLang() {
    if (!this.view.editable) return;
    menu(this.ctx.root, this.lang, LANGS.map((l) => ({
      label: l || this.ctx.t('code.plain'),
      active: (this.node.attrs.language || '') === l,
      run: () => {
        const pos = this.getPos();
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { language: l })));
      },
    })), { class: 'led-lang-menu' });
  }

  async copyText() {
    try {
      await navigator.clipboard.writeText(this.node.textContent);
      this.copy.textContent = this.ctx.t('code.copied');
      setTimeout(() => { this.copy.textContent = this.ctx.t('code.copy'); }, 1200);
    } catch { /* без доступа к буферу — молча */ }
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    return true;
  }

  stopEvent(e) { return e.target === this.lang || e.target === this.copy; }

  ignoreMutation(m) { return m.type !== 'selection' && !this.contentDOM.contains(m.target); }
}

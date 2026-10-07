// Редактор Lancible. Точка входа сборки: window.LancibleEditor.
//
//   const ed = LancibleEditor.create(el, {
//     content,                 // контейнер { v, doc, comments, ink } (core/doc.js)
//     onChange(container),     // после каждой правки (с задержкой 150 мс)
//     lang: () => 'ru',        // язык интерфейса
//     user: () => ({ id, name }),
//     settings: () => ({...}), onSettings(patch), // вид и рисование
//     assets,                  // createAssetStore(...) — картинки
//     placeholder, mobile, toast(msg),
//   });
//
// Всё, что меняет документ, — команды из commands.js; всё, что про
// интерфейс, — здесь и в соседних файлах.
import { EditorState, Plugin, PluginKey, TextSelection, NodeSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { DOMParser as PMDOMParser, DOMSerializer, Node as PMNode } from 'prosemirror-model';
import { history, closeHistory } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { tableEditing, columnResizing, isInTable } from 'prosemirror-tables';
import { keymap } from 'prosemirror-keymap';
import { MarkdownParser } from 'prosemirror-markdown';
import markdownit from 'markdown-it';
import Core from '../renderer/core/doc.js';
import { schema } from './schema.js';
import * as C from './commands.js';
import { blockIds, placeholder, buildInputRules, buildKeymaps, galleryNormalize } from './plugins.js';
import { commentsPlugin, CommentsPanel, commentsKey } from './comments.js';
import { findPlugin, FindBar } from './find.js';
import { slashPlugin, SlashMenu, BubbleMenu, BlockHandle } from './menus.js';
import { Toolbar } from './toolbar.js';
import { ImageView } from './image.js';
import { ChartView, editChart, defaultChart } from './chart.js';
import { DrawingView } from './drawing.js';
import { InkOverlay } from './overlay.js';
import { TaskItemView, CodeBlockView } from './views.js';
import { TableHandles } from './tablehandles.js';
import { normalizeInkSettings, defaultInkSettings, clearInkColorCache } from './ink.js';
import { createAssetStore } from './assets.js';
import { h, icon, debounce, downloadBlob, keyLabel } from './util.js';
import { popup, menu, modal, closePopup } from './ui.js';
import { translate } from './strings.js';

const N = schema.nodes;

export const DEFAULT_SETTINGS = {
  // Во всю ширину окна редактора (круг 2, 7 октября 2026); узкая полоса
  // для чтения — в меню «Вид».
  width: 'full',
  font: 'sans',
  size: 16,
  focus: false,
  typewriter: false,
  smart: true,
  spellcheck: true,
  stats: true,
  // Пометки от руки спрятаны: остаются в заметке, но не мешают читать.
  // Возвращаются кнопкой пометок или пунктом в меню «Вид».
  inkHidden: false,
  ink: defaultInkSettings(),
};

/** Документ в JSON без пометок: в контейнере они лежат отдельным полем. */
function docWithoutInk(doc) {
  const json = doc.toJSON();
  delete json.attrs;
  return json;
}

function normalizeSettings(s) {
  const o = Object.assign({}, DEFAULT_SETTINGS, s || {});
  o.ink = normalizeInkSettings(o.ink);
  return o;
}

// --- Markdown на вставке ---------------------------------------------------------

/** markdown-it размечает ячейку таблицы строкой, а у нас в ячейке абзацы;
 *  и чек-листов «- [ ]» он не знает. Чиним токены до ProseMirror. */
function ledTokensPlugin(md) {
  md.core.ruler.push('led_tokens', (state) => {
    const toks = state.tokens;
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if ((tok.type === 'th_open' || tok.type === 'td_open') && toks[i + 1] && toks[i + 1].type === 'inline') {
        out.push(tok, new state.Token('paragraph_open', 'p', 1), toks[i + 1], new state.Token('paragraph_close', 'p', -1));
        i += 1;
        continue;
      }
      out.push(tok);
    }
    // Чек-листы: пункт, текст которого начинается с [ ] или [x].
    const stack = [];
    for (let i = 0; i < out.length; i++) {
      const tok = out[i];
      if (tok.type === 'bullet_list_open') stack.push({ open: tok, items: [], all: true });
      if (tok.type === 'list_item_open' && stack.length) {
        const inline = out[i + 2];
        const m = inline && inline.type === 'inline' && /^\[( |x|X)\]\s+/.exec(inline.content);
        stack[stack.length - 1].items.push({ tok, inline, m, close: null });
        if (!m) stack[stack.length - 1].all = false;
      }
      if (tok.type === 'list_item_close' && stack.length) {
        const cur = stack[stack.length - 1];
        const it = cur.items.find((x) => !x.close);
        if (it) it.close = tok;
      }
      if (tok.type === 'bullet_list_close' && stack.length) {
        const cur = stack.pop();
        if (cur.all && cur.items.length) {
          cur.open.type = 'task_list_open';
          tok.type = 'task_list_close';
          for (const it of cur.items) {
            it.tok.type = 'task_item_open';
            it.tok.attrSet('checked', it.m[1].trim() ? 'true' : 'false');
            if (it.close) it.close.type = 'task_item_close';
            it.inline.content = it.inline.content.slice(it.m[0].length);
            if (it.inline.children && it.inline.children[0] && it.inline.children[0].type === 'text') {
              it.inline.children[0].content = it.inline.children[0].content.replace(/^\[( |x|X)\]\s+/, '');
            }
          }
        }
      }
    }
    state.tokens = out;
  });
}

const md = markdownit('commonmark', { html: false, linkify: true }).enable(['table', 'strikethrough']).use(ledTokensPlugin);

const mdParser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: { block: 'ordered_list', getAttrs: (tok) => ({ order: +tok.attrGet('start') || 1 }) },
  task_list: { block: 'task_list' },
  task_item: { block: 'task_item', getAttrs: (tok) => ({ checked: tok.attrGet('checked') === 'true' }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: Math.min(4, +tok.tag.slice(1)) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok) => ({ language: (tok.info || '').trim().split(/\s+/)[0] || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: { node: 'image', getAttrs: (tok) => ({ src: tok.attrGet('src'), alt: (tok.children[0] && tok.children[0].content) || '' }) },
  hardbreak: { node: 'hard_break' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) },
  code_inline: { mark: 'code', noCloseToken: true },
});

/** Похоже ли на Markdown: хотя бы одна строка с разметкой блока или пара
 *  строчных меток. Обычный текст с одной звёздочкой — не Markdown. */
export function looksLikeMarkdown(text) {
  if (!text || text.length < 3) return false;
  const lines = text.split('\n');
  const block = lines.filter((l) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.+\||- \[[ xX]\]\s)/.test(l.trim())).length;
  const inline = (text.match(/\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/g) || []).length;
  return block >= 1 || inline >= 2;
}

export function parseMarkdown(text) {
  try { return mdParser.parse(text); } catch { return null; }
}

// --- редактор -----------------------------------------------------------------------

const uiKey = new PluginKey('led-ui');

class Editor {
  constructor(mount, opts) {
    this.opts = opts || {};
    this.mount = mount;
    this.isMobile = !!this.opts.mobile;
    this.assets = this.opts.assets || createAssetStore({});
    this.comments = [];
    this.panel = null;
    this.annotating = false;
    this.fullscreen = false;
    this.dragging = false;
    this.activeDrawing = null;
    this.t = (key, vars) => translate(this.lang(), key, vars);
    this.emitChange = debounce(() => { if (this.opts.onChange) this.opts.onChange(this.getContent()); }, 150);

    this.buildDom();
    const content = Core.normalizeContainer(this.opts.content);
    this.comments = content.comments.slice();
    this.view = new EditorView({ mount: this.page }, {
      state: this.createState(content.doc, content.ink),
      nodeViews: this.nodeViews(),
      dispatchTransaction: (tr) => this.dispatch(tr),
      attributes: () => this.pmAttributes(),
      editable: () => this.editable !== false,
      handlePaste: (view, e) => this.onPaste(view, e),
      handleDrop: (view, e) => this.onDrop(view, e),
      handleDOMEvents: {
        mousemove: (view, e) => { this.handle.track(e); this.tableHandles.track(e); return false; },
        focus: () => { this.updateUi(); return false; },
        blur: () => { setTimeout(() => this.updateUi(), 0); return false; },
      },
      clipboardTextSerializer: (slice) => {
        const doc = schema.topNodeType.createAndFill(null, slice.content);
        return doc ? Core.docPlainText(doc.toJSON()) : slice.content.textBetween(0, slice.content.size, '\n\n');
      },
    });
    this.view.dispatch(this.view.state.tr.setMeta('led-init', true));
    this.overlay = new InkOverlay({
      root: this.root,
      t: this.t,
      toast: (m) => this.toast(m),
      inkSettings: () => this.settings().ink,
      setInkSettings: (p) => this.setInkSettings(p),
      getInk: () => this.ink,
      setInk: (list, opts) => this.setInk(list, opts),
      undo: () => C.undo(this.view.state, this.view.dispatch),
      redo: () => C.redo(this.view.state, this.view.dispatch),
      setAnnotate: (on) => this.setAnnotate(on),
      scroller: this.scroller,
      page: this.page,
      view: this.view,
      mobile: this.isMobile,
      hidden: () => !!this.settings().inkHidden,
      hide: () => this.hideInk(),
    });
    this.viewport.append(this.overlay.dom);
    // Телефон: панель пера встаёт на место панели редактора (та на время
    // пометок прячется). Плавающая снизу уезжала под нижнее меню приложения.
    if (this.isMobile) this.toolbar.dom.after(this.overlay.toolbar.dom);
    else this.root.append(this.overlay.toolbar.dom);
    this.applySettings();
    this.updateUi();
    this.renderStatus();
    requestAnimationFrame(() => this.overlay.render());
    this.onThemeChange = () => { clearInkColorCache(); this.overlay.render(); };
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.onThemeChange);
  }

  // --- разметка -------------------------------------------------------------

  buildDom() {
    this.root = h('div', { class: `led${this.isMobile ? ' led-mobile' : ''}` });
    this.toolbar = new Toolbar(this);
    this.find = new FindBar(this);
    this.commentsPanel = new CommentsPanel(this);
    this.outline = h('nav', { class: 'led-side led-outline', hidden: true, 'aria-label': this.t('outline.title') });
    this.page = h('div', { class: 'led-page' });
    this.handle = new BlockHandle(this);
    this.tableHandles = new TableHandles(this);
    this.pageWrap = h('div', { class: 'led-page-wrap' }, this.handle.dom, this.page, this.toolbar.tableBar);
    this.tableHandles.mount(this.pageWrap);
    this.scroller = h('div', { class: 'led-scroll' }, this.pageWrap);
    this.viewport = h('div', { class: 'led-viewport' }, this.scroller);
    this.status = h('div', { class: 'led-status' });
    this.fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => this.onFiles(e) });
    this.toastEl = h('div', { class: 'led-toast', hidden: true, role: 'status' });
    this.slash = new SlashMenu(this);
    this.bubble = new BubbleMenu(this);
    this.root.append(
      this.toolbar.dom,
      this.find.dom,
      h('div', { class: 'led-body' }, this.outline, this.viewport, this.commentsPanel.dom),
      this.status,
      this.fileInput,
      this.toastEl,
    );
    this.scroller.addEventListener('mouseleave', () => this.handle.hide());
    this.scroller.addEventListener('scroll', () => {
      this.bubble.update(this.view, this.view.hasFocus());
      if (!this.toolbar.tableBar.hidden) this.placeTableBar();
    }, { passive: true });
    this.scroller.addEventListener('mouseleave', () => this.tableHandles.scheduleHide());
    this.root.addEventListener('keydown', (e) => this.onRootKey(e));
    this.mount.append(this.root);
  }

  pmAttributes() {
    const s = this.settings();
    return {
      class: 'led-pm',
      spellcheck: String(!!s.spellcheck),
      'aria-label': this.opts.ariaLabel || this.t('editor'),
      'aria-multiline': 'true',
      role: 'textbox',
    };
  }

  createState(docJSON, ink) {
    let doc;
    try {
      doc = PMNode.fromJSON(schema, Object.assign({}, docJSON, { attrs: { ink: ink && ink.length ? ink : null } }));
      doc.check();
    } catch (e) {
      // Документ не прошёл схему (чужие данные, старая версия) — не теряем
      // текст: разбираем то, что разбирается, через HTML.
      console.error('[editor] документ не прошёл схему, читаю как текст', e);
      const div = document.createElement('div');
      div.textContent = Core.docPlainText(docJSON);
      doc = PMDOMParser.fromSchema(schema).parse(div);
    }
    if (ink && ink.length && !doc.attrs.ink) doc = schema.topNodeType.create({ ink }, doc.content);
    return EditorState.create({ doc, plugins: this.plugins() });
  }

  /** Пометки поверх текста — атрибут документа (schema.js, doc.attrs.ink). */
  get ink() { return (this.view && this.view.state.doc.attrs.ink) || []; }

  /** Новый список пометок — шагом документа: штрих попадает в историю
   *  отдельным пунктом и отменяется вместе с текстом в общем порядке. */
  setInk(list, opts) {
    const o = opts || {};
    const tr = this.view.state.tr.setDocAttribute('ink', list && list.length ? list : null);
    // Продолжение того же жеста (ластик ведут по штрихам) — в тот же пункт
    // истории: у prosemirror-history это общий ключ composition.
    if (o.gesture) tr.setMeta('composition', o.gesture);
    this.view.dispatch(o.continuing ? tr : closeHistory(tr));
  }

  plugins() {
    const ed = this;
    return [
      // Меню «/» — первым: его Enter и стрелки важнее клавиш списка.
      slashPlugin(this),
      buildInputRules({ smartTypography: () => this.settings().smart, getLang: () => this.lang() }),
      keymap({
        'Mod-k': () => { this.editLink(); return true; },
        'Mod-f': () => { this.find.open(false); return true; },
        'Mod-Alt-f': () => { this.find.open(true); return true; },
        'Mod-h': () => { this.find.open(true); return true; },
        'Mod-Alt-m': () => { this.addComment(); return true; },
        'Mod-/': () => { this.showShortcuts(); return true; },
        'Mod-Shift-Enter': () => { this.toggleFullscreen(); return true; },
        // Рисование ↔ текст: из текста — в пометки; обратно — overlay.js.
        'Mod-Shift-d': () => { this.setAnnotate(!this.annotating); return true; },
        'Mod-p': () => { this.print(); return true; },
      }),
      ...buildKeymaps(),
      history({ newGroupDelay: 600 }),
      dropCursor({ class: 'led-dropcursor', width: 2, color: false }),
      gapCursor(),
      columnResizing({ cellMinWidth: 48 }),
      tableEditing(),
      blockIds,
      galleryNormalize,
      placeholder(() => this.opts.placeholder || this.t('placeholder'), () => this.t('placeholder_line')),
      commentsPlugin({
        threads: () => this.comments,
        isResolved: (id) => !!(this.comments.find((th) => th.id === id) || {}).resolved,
        activate: (id, scroll) => this.activateThread(id, scroll),
      }),
      findPlugin,
      new Plugin({
        key: uiKey,
        props: {
          decorations(state) {
            if (!ed.settings().focus) return null;
            const { $from } = state.selection;
            if ($from.depth < 1) return null;
            const start = $from.before(1);
            const node = state.doc.nodeAt(start);
            return node ? DecorationSetFor(state.doc, start, node) : null;
          },
        },
      }),
    ];
  }

  nodeViews() {
    const ctx = this.nodeCtx();
    return {
      image: (n, v, g) => new ImageView(n, v, g, ctx),
      chart: (n, v, g) => new ChartView(n, v, g, ctx),
      drawing: (n, v, g) => {
        const dv = new DrawingView(n, v, g, ctx);
        if (this.activateNextDrawing) { this.activateNextDrawing = false; requestAnimationFrame(() => dv.activate()); }
        return dv;
      },
      task_item: (n, v, g) => new TaskItemView(n, v, g),
      code_block: (n, v, g) => new CodeBlockView(n, v, g, ctx),
    };
  }

  nodeCtx() {
    return {
      root: this.root,
      t: this.t,
      assets: this.assets,
      toast: (m) => this.toast(m),
      pickImage: (cb) => this.pickImage(cb),
      ask: (anchor, o, cb) => this.ask(anchor, o, cb),
      inkSettings: () => this.settings().ink,
      setInkSettings: (p) => this.setInkSettings(p),
      mobile: this.isMobile,
      onDrawingActive: (dv, on) => {
        this.activeDrawing = on ? dv : (this.activeDrawing === dv ? null : this.activeDrawing);
        this.root.classList.toggle('led-drawing-active', !!this.activeDrawing);
        if (this.opts.onDrawingActive) this.opts.onDrawingActive(!!this.activeDrawing);
      },
    };
  }

  // --- поток правок -----------------------------------------------------------

  dispatch(tr) {
    const state = this.view.state.apply(tr);
    this.view.updateState(state);
    if (tr.docChanged) this.changed();
    this.updateUi(tr);
  }

  changed() {
    this.emitChange();
  }

  updateUi(tr) {
    if (!this.view) return;
    const fs = C.formatState(this.view.state);
    this.toolbar.update(fs);
    this.bubble.update(this.view, this.view.hasFocus());
    // Без транзакции (фокус, потеря фокуса) панели не перерисовываем: иначе
    // поле ответа, в котором человек сейчас пишет, пересоздавалось бы.
    if (tr && (tr.docChanged || tr.getMeta(commentsKey))) {
      if (this.panel === 'comments') this.commentsPanel.render();
      if (this.panel === 'outline') this.renderOutline();
      this.renderStatus();
      // Без проверки «есть ли пометки»: отмена последнего штриха оставляет
      // список пустым, и холст надо стереть.
      if (this.overlay) requestAnimationFrame(() => this.overlay.render());
    } else if (tr && tr.selectionSet) this.renderStatus();
    if (tr && tr.selectionSet && this.settings().typewriter) this.typewriterScroll();
    if (this.opts.onFormat) this.opts.onFormat(fs);
  }

  renderStatus() {
    const s = this.settings();
    this.status.hidden = !s.stats;
    if (!s.stats) return;
    const st = Core.docStats(this.view.state.doc.toJSON());
    const { from, to, empty } = this.view.state.selection;
    const parts = [this.t('stats.words', { n: st.words }), this.t('stats.chars', { n: st.chars })];
    if (st.readingMin) parts.push(this.t('stats.reading', { n: st.readingMin }));
    if (!empty) {
      const text = this.view.state.doc.textBetween(from, to, '\n', ' ');
      const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
      if (words) parts.unshift(this.t('stats.selected', { n: words }));
    }
    this.status.textContent = parts.join(' · ');
  }

  typewriterScroll() {
    const { view } = this;
    try {
      const c = view.coordsAtPos(view.state.selection.head);
      const r = this.scroller.getBoundingClientRect();
      const target = r.top + r.height * 0.42;
      this.scroller.scrollTop += c.top - target;
    } catch { /* курсора нет на экране */ }
  }

  // --- содержимое -------------------------------------------------------------

  getContent() {
    return {
      v: Core.DOC_VERSION,
      doc: docWithoutInk(this.view.state.doc),
      comments: this.comments.filter((th) => !th.draft).map((th) => { const c = Object.assign({}, th); delete c.draft; return c; }),
      ink: this.ink,
    };
  }

  setContent(container) {
    const c = Core.normalizeContainer(container);
    this.emitChange.cancel();
    this.comments = c.comments.slice();
    if (this.annotating) this.setAnnotate(false);
    closePopup();
    this.view.updateState(this.createState(c.doc, c.ink));
    this.view.dispatch(this.view.state.tr.setMeta('led-init', true).setMeta('addToHistory', false));
    this.scroller.scrollTop = 0;
    this.updateUi();
    this.renderStatus();
    if (this.panel === 'comments') this.commentsPanel.render();
    if (this.panel === 'outline') this.renderOutline();
    this.overlay.render();
  }

  flush() { this.emitChange.flush(); }

  threads() { return this.comments; }

  setEditable(on) {
    this.editable = !!on;
    this.view.setProps({ editable: () => this.editable });
    this.root.classList.toggle('led-readonly', !this.editable);
    if (!this.editable && this.annotating) this.setAnnotate(false);
  }

  focus() { this.view.focus(); }

  lang() { return (this.opts.lang && this.opts.lang()) || 'ru'; }

  user() {
    const u = this.opts.user && this.opts.user();
    return u && u.id ? { id: u.id, name: u.name || this.t('comments.me') } : { id: 'local', name: this.t('comments.me') };
  }

  // --- настройки --------------------------------------------------------------

  settings() { return normalizeSettings(this.opts.settings ? this.opts.settings() : this.localSettings); }

  setSettings(patch) {
    const before = this.settings();
    if (this.opts.onSettings) this.opts.onSettings(patch);
    else this.localSettings = Object.assign({}, this.localSettings || {}, patch);
    this.applySettings(before);
  }

  setInkSettings(patch) {
    const cur = this.settings().ink;
    this.setSettings({ ink: Object.assign({}, cur, patch) });
  }

  applySettings(before) {
    const s = this.settings();
    const r = this.root;
    for (const w of ['narrow', 'normal', 'wide', 'full']) r.classList.toggle(`led-w-${w}`, s.width === w);
    for (const f of ['sans', 'serif', 'mono']) r.classList.toggle(`led-f-${f}`, s.font === f);
    r.style.setProperty('--led-size', `${s.size}px`);
    r.classList.toggle('led-focus-mode', !!s.focus);
    if (this.view) {
      if (before && (before.smart !== s.smart || before.focus !== s.focus)) {
        this.view.updateState(this.view.state.reconfigure({ plugins: this.plugins() }));
      }
      this.view.setProps({ attributes: () => this.pmAttributes() });
      this.updateUi();
    }
    if (this.overlay && before && before.inkHidden !== s.inkHidden) this.overlay.render();
  }

  // --- панели ---------------------------------------------------------------

  togglePanel(name, force) {
    const on = force != null ? force : this.panel !== name;
    this.panel = on ? name : (this.panel === name ? null : this.panel);
    this.commentsPanel.dom.hidden = this.panel !== 'comments';
    this.outline.hidden = this.panel !== 'outline';
    if (this.panel === 'comments') this.commentsPanel.render();
    if (this.panel === 'outline') this.renderOutline();
    this.root.classList.toggle('led-has-panel', !!this.panel);
    this.updateUi();
    requestAnimationFrame(() => this.overlay.render());
  }

  renderOutline() {
    const items = Core.docOutline(this.view.state.doc.toJSON());
    const head = h('div', { class: 'led-side-head' },
      h('span', { class: 'led-side-title' }, this.t('outline.title')),
      h('button', { type: 'button', class: 'led-btn', title: this.t('common.close'), onclick: () => this.togglePanel('outline', false) }, icon('x', 16)));
    const list = h('div', { class: 'led-outline-list' });
    if (!items.length) list.append(h('div', { class: 'led-cm-empty' }, this.t('outline.empty')));
    for (const it of items) {
      list.append(h('button', {
        type: 'button', class: `led-outline-item lvl-${it.level}`,
        onclick: () => {
          let pos = 0;
          this.view.state.doc.forEach((n, p, i) => { if (i === it.index) pos = p; });
          const dom = this.view.nodeDOM(pos);
          if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
          this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)));
          this.view.focus();
        },
      }, it.text));
    }
    this.outline.replaceChildren(head, list);
  }

  activateThread(id, scroll) {
    if (id) this.togglePanel('comments', true);
    this.view.dispatch(this.view.state.tr.setMeta(commentsKey, { active: id }));
    if (id && scroll !== false) this.commentsPanel.jump(id);
    const card = id && this.commentsPanel.list.querySelector(`[data-thread="${id}"]`);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  addComment() {
    if (!this.view.editable) return;
    this.commentsPanel.add();
  }

  setAnnotate(on) {
    if (on && !this.view.editable) return;
    // Открыли пометки — спрятанные показываются: рисовать вслепую нельзя.
    if (on && this.settings().inkHidden) this.setSettings({ inkHidden: false });
    this.annotating = !!on;
    this.root.classList.toggle('led-annotating', this.annotating);
    this.overlay.setOn(this.annotating);
    if (this.annotating && !this.settings().ink) this.setInkSettings({});
    this.updateUi();
    if (this.opts.onDrawingActive) this.opts.onDrawingActive(this.annotating);
  }

  /** Размер выделенного текста — ступенями от размера текста в «Виде».
   *  Подпись пункта набрана тем размером, который он ставит. */
  fontSizeMenu(anchor) {
    const cur = C.formatState(this.view.state).fontSize;
    const run = (v) => () => { C.setValueMark('fontSize', 'size', v)(this.view.state, this.view.dispatch); this.view.focus(); };
    const steps = ['xs', 's', null, 'l', 'xl', 'xxl'];
    menu(this.root, anchor, [
      { heading: this.t('fmt.font_size') },
      ...steps.map((v) => ({ label: h('span', { class: v ? `led-fs-${v}` : '' }, this.t(`fmt.size_${v || 'normal'}`)), active: (cur || null) === v, run: run(v) })),
    ], { class: 'led-font-menu' });
  }

  /** Гарнитура выделенного текста: без засечек, с засечками, моноширинная. */
  fontFamilyMenu(anchor) {
    const cur = C.formatState(this.view.state).fontFamily;
    const run = (v) => () => { C.setValueMark('fontFamily', 'family', v)(this.view.state, this.view.dispatch); this.view.focus(); };
    menu(this.root, anchor, [
      { heading: this.t('fmt.font_family') },
      { label: this.t('fmt.family_default'), active: !cur, run: run(null) },
      ...['sans', 'serif', 'mono'].map((v) => ({ label: h('span', { class: `led-ff-${v}` }, this.t(`view.font_${v}`)), active: cur === v, run: run(v) })),
    ], { class: 'led-font-menu' });
  }

  /** Спрятать пометки и выйти из режима пометок. */
  hideInk() {
    this.setSettings({ inkHidden: true });
    if (this.annotating) this.setAnnotate(false);
    this.overlay.render();
    this.toast(this.t('ink.hidden_toast'));
  }

  toggleFullscreen(force) {
    this.fullscreen = force != null ? !!force : !this.fullscreen;
    this.root.classList.toggle('led-fullscreen', this.fullscreen);
    this.toolbar.syncFullscreen();
    requestAnimationFrame(() => this.overlay.render());
    this.view.focus();
  }

  onRootKey(e) {
    if (e.key === 'Escape' && this.fullscreen && !e.defaultPrevented && !document.querySelector('#ledmodal-backdrop')) {
      this.toggleFullscreen(false);
    }
  }

  /** Остров таблицы — под таблицей с курсором. Таблица выше экрана —
   *  остров прилипает к нижнему краю видимой части, чтобы не искать его. */
  placeTableBar() {
    const bar = this.toolbar.tableBar;
    const found = C.findParent(this.view.state, [N.table]);
    const dom = found && this.view.nodeDOM(found.pos);
    if (!dom || !dom.getBoundingClientRect) return;
    const box = (dom.closest && dom.closest('.tableWrapper')) || dom;
    const t = box.getBoundingClientRect();
    const w = this.pageWrap.getBoundingClientRect();
    const sc = this.scroller.getBoundingClientRect();
    const hgt = bar.offsetHeight || 40;
    let top = t.bottom + 8;
    if (top + hgt > sc.bottom - 8 && t.top < sc.bottom - hgt - 16) top = sc.bottom - hgt - 8;
    bar.style.top = `${Math.round(top - w.top)}px`;
    bar.style.left = `${Math.round(Math.max(t.left, sc.left + 8) - w.left)}px`;
  }

  // --- ссылки, вопросы, тост -------------------------------------------------------

  ask(anchor, o, cb) {
    const input = h('input', { class: 'field-sm', value: o.value || '', placeholder: o.placeholder || '' });
    const done = () => { p.close(); cb(input.value); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    const p = popup(this.root, anchor, h('div', { class: 'led-ask' },
      h('label', { class: 'led-ask-label' }, o.label),
      input,
      h('div', { class: 'led-ask-row' }, h('button', { type: 'button', class: 'btn-soft', onclick: done }, this.t('common.ok')))));
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  editLink(anchorEl) {
    const { view } = this;
    if (!view.editable) return;
    const { state } = view;
    const range = state.selection.empty ? C.markRange(state, schema.marks.link) : null;
    const href = C.formatState(state).link || '';
    const coords = view.coordsAtPos(state.selection.from);
    const anchor = anchorEl || { left: coords.left, right: coords.left, top: coords.top, bottom: coords.bottom, width: 0, height: coords.bottom - coords.top };
    const url = h('input', { class: 'field-sm', value: href, placeholder: 'https://', 'aria-label': this.t('link.url') });
    const needText = state.selection.empty && !range;
    const text = needText ? h('input', { class: 'field-sm', placeholder: this.t('link.text'), 'aria-label': this.t('link.text') }) : null;
    const apply = () => {
      let v = url.value.trim();
      if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('#') && !v.startsWith('/')) v = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : `https://${v}`;
      p.close();
      C.setLink(v || null, text && text.value.trim())(view.state, view.dispatch);
      view.focus();
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
    url.addEventListener('keydown', onKey);
    if (text) text.addEventListener('keydown', onKey);
    const p = popup(this.root, anchor, h('div', { class: 'led-link-pop' },
      url, text,
      h('div', { class: 'led-ask-row' },
        href ? h('button', { type: 'button', class: 'led-btn', title: this.t('link.open'), onclick: () => this.openUrl(href) }, icon('maximize', 16)) : null,
        href ? h('button', { type: 'button', class: 'led-btn', title: this.t('link.remove'), onclick: () => { p.close(); C.setLink(null)(view.state, view.dispatch); view.focus(); } }, icon('unlink', 16)) : null,
        h('div', { class: 'led-spacer' }),
        h('button', { type: 'button', class: 'btn-soft', onclick: apply }, this.t('common.apply')))));
    setTimeout(() => url.focus(), 0);
  }

  openUrl(href) {
    if (this.opts.openUrl) this.opts.openUrl(href);
    else window.open(href, '_blank', 'noopener');
  }

  toast(msg) {
    if (this.opts.toast) { this.opts.toast(msg); return; }
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 2200);
  }

  // --- картинки --------------------------------------------------------------------

  pickImage(cb) {
    this.pickCb = cb || null;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  async onFiles(e) {
    const files = [...(e.target.files || [])];
    const cb = this.pickCb;
    this.pickCb = null;
    if (cb && files[0]) { cb(await this.assets.put(files[0])); return; }
    await this.insertFiles(files);
  }

  async insertFiles(files, pos) {
    const images = files.filter((f) => /^image\//.test(f.type));
    if (!images.length) return false;
    this.toast(this.t('image.adding'));
    for (const f of images) {
      const src = await this.assets.put(f);
      const node = N.image.create({ src, alt: (f.name || '').replace(/\.[a-z0-9]+$/i, '') });
      if (pos != null) {
        const tr = this.view.state.tr.insert(pos, node);
        this.view.dispatch(tr);
        pos += node.nodeSize;
      } else C.insertImage(node.attrs)(this.view.state, this.view.dispatch);
    }
    this.view.focus();
    return true;
  }

  imageFromUrl(anchor) {
    this.ask(anchor, { label: this.t('image.url_prompt'), placeholder: 'https://' }, (v) => {
      const src = v.trim();
      if (!/^https?:\/\//i.test(src)) return;
      C.insertImage({ src, alt: '' })(this.view.state, this.view.dispatch);
    });
  }

  onPaste(view, e) {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); this.insertFiles(files); return true; }
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!html && text && view.state.selection.$from.parent.type !== N.code_block && looksLikeMarkdown(text)) {
      const doc = parseMarkdown(text);
      if (doc) {
        e.preventDefault();
        const slice = doc.slice(0, doc.content.size);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      }
    }
    return false;
  }

  onDrop(view, e) {
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return false;
    e.preventDefault();
    const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    let pos = at ? at.pos : view.state.selection.from;
    const $p = view.state.doc.resolve(pos);
    if ($p.depth >= 1) pos = $p.after(1);
    this.insertFiles(files, pos);
    return true;
  }

  // --- графики и рисунки ------------------------------------------------------------

  insertChart(chart) {
    editChart(this.root, chart || defaultChart(this.t), this.t, (c) => {
      C.insertChart(c)(this.view.state, this.view.dispatch);
      this.view.focus();
    });
  }

  chartFromTable() {
    const { state } = this.view;
    const rows = C.tableRowsAtCursor(state);
    const data = rows && Core.chartFromRows(rows);
    if (!data) { this.toast(this.t('table.no_numbers')); return; }
    const found = C.findParent(state, [N.table]);
    editChart(this.root, Object.assign(defaultChart(this.t), data, { title: '' }), this.t, (c) => {
      const s = this.view.state;
      const at = found ? found.pos + found.node.nodeSize : s.selection.to;
      const tr = s.tr.insert(at, N.chart.create({ chart: c }));
      this.view.dispatch(tr.scrollIntoView());
    });
  }

  insertDrawing() {
    const width = Math.round(this.view.dom.clientWidth || 720);
    this.activateNextDrawing = true;
    C.insertDrawing({ width, height: 320, bg: this.settings().ink.bg || 'plain', strokes: [] })(this.view.state, this.view.dispatch);
  }

  // --- экспорт ---------------------------------------------------------------------

  docTitle() { return (this.opts.title && this.opts.title()) || Core.docTitleGuess(this.view.state.doc.toJSON()) || 'document'; }

  fileName(ext) { return `${this.docTitle().replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'document'}.${ext}`; }

  async exportHtml() {
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(this.view.state.doc.content);
    const box = document.createElement('div');
    box.append(fragment);
    // Картинки из хранилища — внутрь файла, иначе он откроется без них.
    for (const img of box.querySelectorAll('img[src^="asset:"]')) {
      const blob = await this.assets.blob(img.getAttribute('src'));
      if (blob) {
        img.src = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      }
    }
    // Графики и рисунки — картинками: в файле нет редактора, чтобы их нарисовать.
    const live = this.page.querySelectorAll('.led-chart-body svg');
    box.querySelectorAll('div.led-chart').forEach((el, i) => { if (live[i]) el.replaceWith(live[i].cloneNode(true)); });
    const canvases = this.page.querySelectorAll('.led-draw-canvas');
    box.querySelectorAll('div.led-drawing').forEach((el, i) => {
      const c = canvases[i];
      if (c) el.replaceWith(h('img', { src: c.toDataURL('image/png'), alt: '' }));
    });
    const title = this.docTitle();
    return `<!doctype html><html lang="${this.lang()}"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1d1f22}
img,svg{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #c9ccd1;padding:4px 8px}
pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #c9ccd1;margin-left:0;padding-left:14px;color:#555}
.led-callout{background:#f3f6ee;border-radius:8px;padding:10px 14px}
.led-gallery{display:flex;gap:10px;margin:16px 0}.led-gallery figure{flex:1 1 0;margin:0}
.align-wrap-left{float:left;width:40%;margin:4px 20px 8px 0}.align-wrap-right{float:right;width:40%;margin:4px 0 8px 20px}ul[data-type=tasks]{list-style:none;padding-left:4px}
li[data-checked=true]::before{content:"☑ "}li[data-checked=false]::before{content:"☐ "}figure{margin:16px 0}figcaption{color:#666;font-size:13px;text-align:center}
mark{padding:0 2px}.led-fs-xs{font-size:.75em}.led-fs-s{font-size:.875em}.led-fs-l{font-size:1.25em}.led-fs-xl{font-size:1.5em}.led-fs-xxl{font-size:2em}
.led-ff-serif{font-family:Georgia,serif}.led-ff-mono{font-family:ui-monospace,Menlo,Consolas,monospace}</style></head><body>${box.innerHTML}</body></html>`;
  }

  async exportAs(kind) {
    if (kind === 'md') {
      downloadBlob(new Blob([Core.docToMarkdown(this.view.state.doc.toJSON())], { type: 'text/markdown' }), this.fileName('md'));
    } else {
      downloadBlob(new Blob([await this.exportHtml()], { type: 'text/html' }), this.fileName('html'));
    }
  }

  async copyMarkdown() {
    try {
      await navigator.clipboard.writeText(Core.docToMarkdown(this.view.state.doc.toJSON()));
      this.toast(this.t('export.copied'));
    } catch {
      this.toast(this.t('export.copy_failed'));
    }
  }

  /** Печать — через невидимый фрейм: window.print() напечатал бы всё
   *  приложение вокруг документа. */
  async print() {
    const html = await this.exportHtml();
    const frame = h('iframe', { class: 'led-print-frame', 'aria-hidden': 'true' });
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* печать недоступна */ }
      setTimeout(() => frame.remove(), 1500);
    }, 250);
  }

  showShortcuts() {
    const rows = [
      ['fmt.bold', 'Mod-b'], ['fmt.italic', 'Mod-i'], ['fmt.underline', 'Mod-u'], ['fmt.strike', 'Mod-Shift-x'], ['fmt.code', 'Mod-e'],
      ['fmt.highlight', 'Mod-Shift-h'], ['fmt.link', 'Mod-k'], ['fmt.clear', 'Mod-\\'],
      ['turn.h1', 'Mod-Alt-1'], ['turn.h2', 'Mod-Alt-2'], ['turn.h3', 'Mod-Alt-3'], ['turn.paragraph', 'Mod-Alt-0'],
      ['block.bullet', 'Mod-Shift-8'], ['block.ordered', 'Mod-Shift-7'], ['block.tasks', 'Mod-Shift-9'], ['help.check_item', 'Mod-Enter'],
      ['block.quote', 'Mod-Shift-b'], ['block.code', 'Mod-Alt-c'], ['help.line_break', 'Shift-Enter'],
      ['block.move_up', 'Alt-Shift-ArrowUp'], ['block.move_down', 'Alt-Shift-ArrowDown'], ['block.duplicate', 'Mod-d'],
      ['find.title', 'Mod-f'], ['find.replace', 'Mod-Alt-f'], ['comments.add', 'Mod-Alt-m'], ['view.fullscreen', 'Mod-Shift-Enter'],
      ['ink.toggle_mode', 'Mod-Shift-d'],
      ['undo', 'Mod-z'], ['redo', 'Mod-Shift-z'],
    ];
    const md = [['# ', 'turn.h1'], ['## ', 'turn.h2'], ['- ', 'block.bullet'], ['1. ', 'block.ordered'], ['[] ', 'block.tasks'], ['> ', 'block.quote'], ['``` ', 'block.code'], ['---', 'block.hr'], ['**…**', 'fmt.bold'], ['*…*', 'fmt.italic'], ['`…`', 'fmt.code'], ['~~…~~', 'fmt.strike'], ['==…==', 'fmt.highlight'], ['/', 'help.slash']];
    const table = (list, fmt) => h('table', { class: 'led-keys' }, list.map((r) => h('tr', {}, h('td', {}, this.t(fmt ? r[1] : r[0])), h('td', {}, h('kbd', {}, fmt ? r[0] : keyLabel(r[1]).replace('ArrowUp', '↑').replace('ArrowDown', '↓'))))));
    modal(this.root, this.t('help.shortcuts'), h('div', { class: 'led-help' },
      h('div', {}, h('div', { class: 'led-menu-head' }, this.t('help.keys')), table(rows, false)),
      h('div', {}, h('div', { class: 'led-menu-head' }, this.t('help.markdown')), table(md, true),
        h('div', { class: 'led-menu-head' }, this.t('help.ink')), h('p', { class: 'led-hint' }, this.t('help.ink_text')))),
    [{ label: this.t('common.close'), primary: true, run: (close) => close() }], { class: 'modal-lg led-help-modal' });
  }

  // --- для хозяина и тестов --------------------------------------------------------------

  /** Команда по имени — для телефона (кнопки снаружи WebView) и тестов. */
  exec(name, arg) {
    const { view } = this;
    const run = (cmd) => cmd(view.state, view.dispatch, view);
    const table = {
      bold: () => run(C.toggle('strong')), italic: () => run(C.toggle('em')), underline: () => run(C.toggle('underline')),
      strike: () => run(C.toggle('strike')), code: () => run(C.toggle('code')), clear: () => run(C.clearFormatting),
      heading: () => run(arg ? C.setHeading(arg) : C.setParagraph), paragraph: () => run(C.setParagraph),
      bullet: () => run(C.toggleList('bullet_list')), ordered: () => run(C.toggleList('ordered_list')), tasks: () => run(C.toggleList('task_list')),
      indent: () => run(C.indent), outdent: () => run(C.outdent), quote: () => run(C.toggleQuote), codeblock: () => run(C.toggleCodeBlock),
      callout: () => run(C.toggleCallout(arg)), hr: () => run(C.insertRule), align: () => run(C.setAlign(arg || 'left')),
      color: () => run(C.setColorMark('textColor', arg || null)), highlight: () => run(C.setColorMark('highlight', arg === undefined ? 'yellow' : arg)),
      link: () => (arg === undefined ? this.editLink() : run(C.setLink(arg || null))),
      table: () => run(C.insertTable((arg && arg.rows) || 3, (arg && arg.cols) || 3, !arg || arg.header !== false)),
      image: () => this.pickImage(), chart: () => this.insertChart(), drawing: () => this.insertDrawing(),
      comment: () => this.addComment(), annotate: () => this.setAnnotate(arg == null ? !this.annotating : arg),
      find: () => this.find.open(!!arg), undo: () => run(C.undo), redo: () => run(C.redo),
      outline: () => this.togglePanel('outline'), comments: () => this.togglePanel('comments'),
      fullscreen: () => this.toggleFullscreen(arg),
    };
    const fn = table[name];
    if (!fn) return false;
    const r = fn();
    if (!this.view.hasFocus() && !['image', 'chart', 'drawing', 'find', 'annotate', 'outline', 'comments', 'link'].includes(name)) view.focus();
    return r;
  }

  destroy() {
    this.flush();
    closePopup();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.onThemeChange);
    this.overlay.destroy();
    this.view.destroy();
    this.root.remove();
  }
}

// Декорация режима фокуса — текущий блок верхнего уровня.
function DecorationSetFor(doc, start, node) {
  return DecorationSet.create(doc, [Decoration.node(start, start + node.nodeSize, { class: 'led-current' })]);
}

export function create(mount, opts) { return new Editor(mount, opts); }

export { createAssetStore, schema, Core, isInTable, NodeSelection };

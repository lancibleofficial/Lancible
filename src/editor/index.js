// Редактор Lancible. Точка входа сборки: window.LancibleEditor.
//
//   const ed = LancibleEditor.create(el, {
//     content,                 // контейнер { v, doc, comments, ink } (core/doc.js)
//     onChange(container),     // после каждой правки (с задержкой 150 мс; с nativeToolbar — сразу)
//     lang: () => 'ru',        // язык интерфейса
//     user: () => ({ id, name }),
//     settings: () => ({...}), onSettings(patch), // вид и рисование
//     assets,                  // createAssetStore(...) — картинки
//     placeholder, mobile, toast(msg),
//     // телефон (host.js, DESIGN.md «Редактор на телефоне: протокол»):
//     nativeToolbar,           // панель снаружи: веб-панели и панели пера нет
//     autoHeight,              // высота по тексту, сообщение height
//     post(msg),               // куда слать сообщения хозяину
//     zoom,                    // масштаб текста 0.8–2
//   });
//
// Всё, что меняет документ, — команды из commands.js; всё, что про
// интерфейс, — здесь и в соседних файлах.
import { EditorState, Plugin, PluginKey, Selection, TextSelection, NodeSelection } from 'prosemirror-state';
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
import { blockIds, placeholder, buildInputRules, buildKeymaps, galleryNormalize, linkOnPaste } from './plugins.js';
import { commentsPlugin, CommentsPanel, commentsKey } from './comments.js';
import { findPlugin, FindBar } from './find.js';
import { slashPlugin, SlashMenu, BubbleMenu, BlockHandle } from './menus.js';
import { Toolbar } from './toolbar.js';
import { ImageView, imageViewOf } from './image.js';
import { ChartView, editChart, defaultChart, chartSpec, chartFromSpec, CHART_TYPES } from './chart.js';
import { DrawingView, drawingViewOf } from './drawing.js';
import { InkOverlay, INK_ROOM } from './overlay.js';
import { TaskItemView, CodeBlockView } from './views.js';
import {
  HostBridge, commands, KEEP_FOCUS, toolbarState, clampZoom, normalizeHref, dataUrlToBlob, base64ToBytes, PROTOCOL, VIEWPORT, EXEC_NAMES, ZOOM_MIN, ZOOM_MAX,
  changeDelay,
} from './host.js';
import { TableHandles } from './tablehandles.js';
import { ContextMenu } from './contextmenu.js';
import { normalizeInkSettings, defaultInkSettings, clearInkColorCache } from './ink.js';
import { createAssetStore, assetIdsIn } from './assets.js';
import { importPdf, loadPdfModule, pdfModuleArrived, recognizeLines } from './pdf.js';
import { PdfPageView, pdfPageViewOf } from './pdfpage.js';
import { buildPdfPlan, rasterPage, bytesToBase64 } from './pdfexport.js';
import { startBlockDrag } from './blockdrag.js';
import { cancelPresses } from './press.js';
import { h, icon, debounce, downloadBlob, keyLabel, shortId } from './util.js';
import { popup, menu, modal, closePopup } from './ui.js';
import { translate } from './strings.js';

const N = schema.nodes;

/** Блоки, в конце которых можно писать дальше (focusEnd): после остальных
 *  — таблицы, картинки, графика, линии — встаёт новый абзац. */
const WRITE_ON = new Set(['paragraph', 'heading', 'code_block', 'blockquote', 'callout', 'bullet_list', 'ordered_list', 'task_list']);

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
    // Панель снаружи (телефон): кнопки — нативные, команды и состояние ходят
    // сообщениями (host.js). Хозяин тогда же спрашивает адрес ссылки,
    // выбирает фото и отдаёт файлы выгрузки.
    this.host = !!this.opts.nativeToolbar;
    const rn = typeof window !== 'undefined' && window.ReactNativeWebView;
    const post = this.opts.post || (this.host && rn ? (m) => rn.postMessage(JSON.stringify(m)) : null);
    this.bridge = new HostBridge(this, post);
    this.zoom = clampZoom(this.opts.zoom == null ? 1 : this.opts.zoom);
    this.assets = this.opts.assets || createAssetStore({});
    /** Долгая работа над открытым документом (импорт PDF): её прерывают
     *  setContent и destroy (docJob). */
    this.docJobs = new Set();
    this.comments = [];
    this.panel = null;
    this.annotating = false;
    this.fullscreen = false;
    this.onFullscreenKey = (e) => this.escapeFullscreen(e);
    this.dragging = false;
    this.activeDrawing = null;
    this.t = (key, vars) => translate(this.lang(), key, vars);
    // Телефону правка — сразу, десктопу и вебу — через 150 мс (host.js: changeDelay).
    this.emitChange = debounce(() => { if (this.opts.onChange) this.opts.onChange(this.getContent()); }, changeDelay(this.host));

    this.buildDom();
    const content = Core.normalizeContainer(this.opts.content);
    this.comments = content.comments.slice();
    this.view = new EditorView({ mount: this.page }, {
      state: this.createState(content.doc, content.ink),
      nodeViews: this.nodeViews(),
      dispatchTransaction: (tr) => this.dispatch(tr),
      attributes: () => this.pmAttributes(),
      // На телефоне в режиме пометок текст не правится: касание рисует, а
      // не ставит курсор и не зовёт клавиатуру. На десктопе из пометок
      // выходят с клавиатуры (Ctrl+Shift+D) — там текст остаётся в фокусе.
      editable: () => this.textEditable(),
      handlePaste: (view, e) => this.onPaste(view, e),
      handleDrop: (view, e) => this.onDrop(view, e),
      handleDOMEvents: {
        mousemove: (view, e) => { this.handle.track(e); return false; },
        focus: () => { this.updateUi(); return false; },
        blur: () => { setTimeout(() => this.updateUi(), 0); return false; },
      },
      clipboardTextSerializer: (slice) => {
        const doc = schema.topNodeType.createAndFill(null, slice.content);
        return doc ? Core.docPlainText(doc.toJSON()) : slice.content.textBetween(0, slice.content.size, '\n\n');
      },
    });
    this.view.dispatch(this.view.state.tr.setMeta('led-init', true));
    // Касание пустого места под текстом — писать дальше (onBlankDown).
    this.onBlank = (e) => this.onBlankDown(e);
    this.mount.addEventListener('mousedown', this.onBlank);
    // Правая кнопка — своё меню: вырезать, копировать, вставить (десктоп и веб).
    this.contextMenu = new ContextMenu(this);
    // Окно потеряло фокус или ушло в фон посреди перетаскивания — жест
    // кончается: хозяину не остаться с выключенной прокруткой.
    this.onWinBlur = () => { if (!document.hidden && document.hasFocus()) return; this.endGestures(); };
    window.addEventListener('blur', this.onWinBlur);
    document.addEventListener('visibilitychange', this.onWinBlur);
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
      // Можно ли править документ вообще — перу нужен именно этот признак:
      // view.editable в режиме пометок выключен (текст не правится).
      canEdit: () => this.editable !== false,
      mobile: this.isMobile,
      hidden: () => !!this.settings().inkHidden,
      hide: () => this.hideInk(),
      // Лассо выделило штрихи — нативной строке пера показать «копия» и «удалить».
      onSelection: () => { if (this.host) this.bridge.ink(); },
      // Высота по тексту: слой пометок — во всё окно, а штрихи ниже текста
      // растят редактор (contentHeight) — хозяин узнаёт это сообщением height.
      autoHeight: !!this.opts.autoHeight,
      onRender: () => { if (this.heightRo) this.bridge.height(this.contentHeight()); },
    });
    this.viewport.append(this.overlay.dom);
    // Телефон: панель пера встаёт на место панели редактора (та на время
    // пометок прячется). Плавающая снизу уезжала под нижнее меню приложения.
    // С нативной панелью строка пера тоже нативная — здесь её нет.
    if (this.host) this.overlay.toolbar.dom.remove();
    else if (this.isMobile) this.toolbar.dom.after(this.overlay.toolbar.dom);
    else this.root.append(this.overlay.toolbar.dom);
    this.applySettings();
    this.updateUi();
    this.renderStatus();
    // Строка панели — по ширине сразу, не дожидаясь кадра (toolbar.js).
    this.toolbar.relayout();
    requestAnimationFrame(() => this.overlay.render());
    this.onThemeChange = () => { clearInkColorCache(); this.overlay.render(); };
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.onThemeChange);
    // Высота по тексту: WebView на странице задачи растёт вместе с ним, а
    // прокручивает экран вокруг. Высоту хозяин узнаёт сообщением «height»;
    // поменялась высота — вместе с ней уходит и курсор заново (HostBridge.height):
    // картинка догрузилась выше него, а выделение то же.
    if (this.opts.autoHeight && typeof ResizeObserver === 'function') {
      this.heightRo = new ResizeObserver(() => this.bridge.height(this.contentHeight()));
      this.heightRo.observe(this.root);
      this.bridge.height(this.contentHeight());
    }
  }

  /** Высота редактора по содержимому — в CSS px, для хозяина. Пометки ниже
   *  текста — тоже содержимое: до самого нижнего штриха и запас под ним,
   *  иначе WebView обрезал бы штрих по краю текста. */
  contentHeight() {
    const r = this.root.getBoundingClientRect();
    let px = r.height;
    const ink = this.overlay ? this.overlay.inkBottom() : null;
    if (ink != null) px = Math.max(px, this.scroller.getBoundingClientRect().top - r.top + ink + INK_ROOM);
    return Math.ceil(px);
  }

  // --- разметка -------------------------------------------------------------

  buildDom() {
    const mode = `${this.isMobile ? ' led-mobile' : ''}${this.host ? ' led-native' : ''}${this.opts.autoHeight ? ' led-autoheight' : ''}`;
    this.root = h('div', { class: `led${mode}` });
    this.toolbar = new Toolbar(this);
    this.find = new FindBar(this);
    this.commentsPanel = new CommentsPanel(this);
    this.outline = h('nav', { class: 'led-side led-outline', hidden: true, 'aria-label': this.t('outline.title') });
    this.page = h('div', { class: 'led-page' });
    this.handle = new BlockHandle(this);
    this.tableHandles = new TableHandles(this);
    // Остров таблицы — веб и десктоп; на телефоне с нативной панелью его
    // действия — в контекстной панели хозяина (host.js, протокол 4).
    this.pageWrap = h('div', { class: 'led-page-wrap' }, this.handle.dom, this.page, this.host ? null : this.toolbar.tableBar);
    this.tableHandles.mount(this.pageWrap);
    this.scroller = h('div', { class: 'led-scroll' }, this.pageWrap);
    this.viewport = h('div', { class: 'led-viewport' }, this.scroller);
    this.status = h('div', { class: 'led-status' });
    this.fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => this.onFiles(e) });
    // PDF — только веб и десктоп: с нативной панелью (телефон) его нет.
    this.pdfInput = this.host ? null : h('input', {
      type: 'file', accept: 'application/pdf,.pdf', hidden: true, class: 'led-pdf-input',
      // Поле сразу пустеет: тот же файл, выбранный снова, — снова change.
      onchange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) this.importPdf(f); },
    });
    this.toastEl = h('div', { class: 'led-toast', hidden: true, role: 'status' });
    this.slash = new SlashMenu(this);
    this.bubble = new BubbleMenu(this);
    // С нативной панелью веб-строки нет совсем; объект панели остаётся —
    // у него остров таблицы и меню, которые exec открывает у курсора.
    if (!this.host) this.root.append(this.toolbar.dom);
    this.root.append(
      this.find.dom,
      h('div', { class: 'led-body' }, this.outline, this.viewport, this.commentsPanel.dom),
      this.status,
      this.fileInput,
      ...(this.pdfInput ? [this.pdfInput] : []),
      this.toastEl,
    );
    this.scroller.addEventListener('mouseleave', () => this.handle.hide());
    this.scroller.addEventListener('scroll', () => {
      this.bubble.update(this.view, this.view.hasFocus());
      if (!this.toolbar.tableBar.hidden) this.placeTableBar();
    }, { passive: true });
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
      pdfpage: (n, v, g) => new PdfPageView(n, v, g, ctx),
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
      // Телефон с нативной панелью: островов у блоков нет, их действия — в
      // контекстной панели хозяина; что выделено, уходит сообщением context.
      native: this.host,
      contextChanged: () => { if (this.host) this.bridge.schedule(); },
      // Можно ли править документ вообще (страница PDF и её слои).
      canEdit: () => this.editable !== false,
      // Строки старой страницы PDF — из исходника в хранилище (волна 2).
      recognizeLines: (attrs) => recognizeLines(this, attrs),
      selectNode: (pos) => this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))),
      // Перенос блока за ручку пальцем (картинка на телефоне, blockdrag.js).
      // Высота по тексту (телефон): своей прокрутки нет — прокручивает хозяин
      // (autoscroll), видимую часть он сообщает сам (viewport, host.js).
      blockDrag: (getPos, e, grip, source, onTap) => startBlockDrag({
        view: this.view, root: this.root, pageWrap: this.pageWrap, scroller: this.scroller,
        hostScroll: this.host && this.opts.autoHeight ? (dy) => this.bridge.send({ type: 'autoscroll', dy }) : null,
        viewport: () => this.hostViewport || null,
        gesture: (on) => this.gesture(on),
      }, getPos, e, grip, source, onTap),
      // Перетаскивание пальцем включилось и кончилось — хозяину (gesture).
      gesture: (on) => this.gesture(on),
      // Телефон с нативной панелью: график правит хозяин нижним листом (host.js).
      editChart: this.host ? (getPos) => this.editChartOnHost(getPos) : null,
      onDrawingActive: (dv, on) => {
        this.activeDrawing = on ? dv : (this.activeDrawing === dv ? null : this.activeDrawing);
        this.root.classList.toggle('led-drawing-active', !!this.activeDrawing);
        if (this.opts.onDrawingActive) this.opts.onDrawingActive(!!this.activeDrawing);
        if (this.host) this.bridge.schedule();
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
    // Ручки строки и столбца — к курсору (tablehandles.js).
    this.tableHandles.update();
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
    // Нативной панели — что включено и где курсор (с прореживанием).
    if (this.host) this.bridge.schedule();
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
    this.endGestures();
    this.abortDocJobs('content');
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

  /** Работа, привязанная к документу, который открыт сейчас (импорт PDF:
   *  страницы ложатся в нынешний view.state). onAbort(reason) — документ
   *  сменился ('content': setContent) или редактор закрыт ('destroy'):
   *  работа должна остановиться и больше ничего не вставлять. Вернуть —
   *  { release() }: работа кончилась сама. */
  docJob(onAbort) {
    const job = { aborted: null };
    const abort = (reason) => {
      if (job.aborted) return;
      job.aborted = reason;
      this.docJobs.delete(abort);
      try { onAbort(reason); } catch (e) { console.error('[editor] docJob', e); }
    };
    this.docJobs.add(abort);
    job.release = () => this.docJobs.delete(abort);
    return job;
  }

  abortDocJobs(reason) {
    for (const abort of [...this.docJobs]) abort(reason);
  }

  threads() { return this.comments; }

  setEditable(on) {
    this.editable = !!on;
    this.view.setProps({ editable: () => this.textEditable() });
    this.root.classList.toggle('led-readonly', !this.editable);
    if (!this.editable && this.annotating) this.setAnnotate(false);
  }

  focus() { this.view.focus(); }

  /** Касание пустого места под текстом — писать дальше: курсор в конец,
   *  фокус в текст (на телефоне — и клавиатура). Пустое место — сама
   *  страница и её обёртки ниже текста, а не кнопки, меню и картинки на ней.
   *  На странице задачи телефона поле заметок тянется до низа экрана, и
   *  пустота под коротким текстом — тоже место для письма (13 октября 2026).
   *  mousedown, а не click: фокус не успевает уйти из текста, и клавиатура
   *  на телефоне не мигает. */
  onBlankDown(e) {
    if (e.button !== 0 || !this.textEditable()) return;
    const blank = [this.mount, this.root, this.viewport, this.scroller, this.pageWrap, this.page];
    if (!blank.includes(e.target) && !(e.target.classList && e.target.classList.contains('led-body'))) return;
    if (e.clientY < this.view.dom.getBoundingClientRect().bottom) return;
    e.preventDefault();
    this.focusEnd();
  }

  /** Курсор в конец текста и фокус. Последний блок — не текст и не список
   *  (таблица, картинка, график, линия) — под ним встаёт пустой абзац:
   *  иначе писать пришлось бы в последнюю ячейку или вместо картинки. */
  focusEnd() {
    const { state } = this.view;
    const last = state.doc.lastChild;
    let tr = state.tr;
    if (!last || !WRITE_ON.has(last.type.name)) tr = tr.insert(state.doc.content.size, N.paragraph.create());
    this.view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView());
    this.view.focus();
  }

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
    if (this.host) this.bridge.ink();
  }

  applySettings(before) {
    const s = this.settings();
    const r = this.root;
    for (const w of ['narrow', 'normal', 'wide', 'full']) r.classList.toggle(`led-w-${w}`, s.width === w);
    for (const f of ['sans', 'serif', 'mono']) r.classList.toggle(`led-f-${f}`, s.font === f);
    r.style.setProperty('--led-size', `${s.size}px`);
    r.style.setProperty('--led-zoom', String(this.zoom));
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

  /** Можно ли сейчас править текст: документ не только для чтения и, на
   *  телефоне, не включены пометки пером. */
  textEditable() {
    return this.editable !== false && !(this.isMobile && this.annotating);
  }

  setAnnotate(on) {
    if (on && this.editable === false) return;
    // Открыли пометки — спрятанные показываются: рисовать вслепую нельзя.
    if (on && this.settings().inkHidden) this.setSettings({ inkHidden: false });
    this.annotating = !!on;
    this.root.classList.toggle('led-annotating', this.annotating);
    // Перечитать editable: в режиме пометок текст не правится, курсор и
    // клавиатура уходят.
    this.view.setProps({});
    if (this.annotating && this.isMobile) this.view.dom.blur();
    this.overlay.setOn(this.annotating);
    if (this.annotating && !this.settings().ink) this.setInkSettings({});
    this.updateUi();
    if (this.opts.onDrawingActive) this.opts.onDrawingActive(this.annotating);
    if (this.host) this.bridge.ink();
  }

  /** Масштаб текста (щипок на телефоне): растёт только текст — шрифт
   *  страницы через --led-zoom, — а галочки, панели и меню остаются своего
   *  размера. 0.8–2, лишнее обрезается. Возвращает поставленный масштаб. */
  setZoom(z) {
    const next = clampZoom(z);
    if (next === this.zoom) return next;
    this.zoom = next;
    this.root.style.setProperty('--led-zoom', String(next));
    // Пометки держатся за блоки, а блоки сдвинулись.
    requestAnimationFrame(() => this.overlay.render());
    if (this.host) this.bridge.schedule();
    return next;
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
    this.toolbar.relayout();
    // Esc слушаем на документе и ДО ProseMirror, и только пока редактор
    // развёрнут. После — нельзя: ProseMirror гасит Esc сам (captureKeyDown),
    // и событие доходило бы уже отменённым. На корне — тоже: после щелчка по
    // полю страницы фокус уходит на body и корень молчал бы.
    document.removeEventListener('keydown', this.onFullscreenKey, true);
    if (this.fullscreen) document.addEventListener('keydown', this.onFullscreenKey, true);
    // Хозяину — знать, что поверхность под кнопками окна сменилась (у десктопа
    // там подложка нативных кнопок, см. syncTitlebarOverlay в app.js).
    if (this.opts.onFullscreen) this.opts.onFullscreen(this.fullscreen);
    requestAnimationFrame(() => this.overlay.render());
    this.view.focus();
  }

  /** Esc выходит из полного экрана — если он не нужен кому-то ближе. Таких
   *  несколько, и все они видны заранее: открытое меню, окно или нижний лист
   *  (закроются сами), меню «/», рисунок в правке, поле ввода (поиск,
   *  комментарий, ссылка — у каждого свой Esc), а чужое окно приложения
   *  держит фокус на своих кнопках — до него редактор не дотягивается.
   *  Режим пометок отнимает Esc раньше нас и отменяет событие. */
  escapeFullscreen(e) {
    // Esc во время набора через IME (японский, китайский, корейский) отменяет
    // подсказку набора, а не просит выйти: иначе человек, сбросивший
    // кандидатов, оказывался бы вышедшим из полного экрана.
    if (e.isComposing) return;
    if (e.key !== 'Escape' || !this.fullscreen || e.defaultPrevented) return;
    if (document.querySelector('.led-pop, #ledmodal-backdrop, .led-sheet-backdrop, .led-slash:not([hidden])')) return;
    if (this.activeDrawing) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    const focus = document.activeElement;
    if (focus && focus !== document.body && !this.root.contains(focus)) return;
    this.toggleFullscreen(false);
  }

  /** Остров таблицы — под таблицей с курсором. Таблица выше экрана —
   *  остров прилипает к нижнему краю видимой части, чтобы не искать его. */
  placeTableBar() {
    if (this.host) return;
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

  /** Прямоугольник курсора — якорь для меню, которые exec открывает без кнопки. */
  caretAnchor() {
    try {
      const c = this.view.coordsAtPos(this.view.state.selection.from);
      return { left: c.left, right: c.left, top: c.top, bottom: c.bottom, width: 0, height: c.bottom - c.top };
    } catch {
      const r = this.page.getBoundingClientRect();
      return { left: r.left, right: r.left, top: r.top, bottom: r.top, width: 0, height: 0 };
    }
  }

  editLink(anchorEl) {
    const { view } = this;
    if (!view.editable) return;
    const { state } = view;
    const range = state.selection.empty ? C.markRange(state, schema.marks.link) : null;
    const href = C.formatState(state).link || '';
    const needText = state.selection.empty && !range;
    // Телефон с нативной панелью: адрес спрашивает хозяин своим окном и
    // отвечает сообщением setLink — поле в WebView прыгало бы под клавиатурой.
    if (this.host) {
      this.bridge.send({ type: 'link', href, needText });
      return;
    }
    const anchor = anchorEl || this.caretAnchor();
    const url = h('input', { class: 'field-sm', value: href, placeholder: 'https://', 'aria-label': this.t('link.url') });
    const text = needText ? h('input', { class: 'field-sm', placeholder: this.t('link.text'), 'aria-label': this.t('link.text') }) : null;
    const apply = () => {
      p.close();
      this.applyLink(url.value, text && text.value);
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

  /** Поставить ссылку на выделение (или слово с курсором); пустой адрес —
   *  снять. text — подпись, если выделения нет. */
  applyLink(href, text) {
    const { view } = this;
    const v = normalizeHref(href);
    C.setLink(v || null, text ? String(text).trim() : '')(view.state, view.dispatch);
    view.focus();
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

  /** Выбрать картинку: окно выбора файла, а на телефоне с нативной панелью —
   *  фото выбирает хозяин (сообщение image-pick) и присылает insertImage.
   *  cb — картинка не вставляется, а отдаётся (замена, «ещё рядом»). */
  pickImage(cb, opts) {
    this.pickCb = cb || null;
    if (this.host && !(opts && opts.input)) {
      this.bridge.send({ type: 'image-pick', purpose: cb ? 'replace' : 'insert' });
      return;
    }
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /** exec('image'): без arg — выбрать; 'input' — окно выбора файла в самой
   *  странице; адрес картинки (asset:…, https:, data:) — вставить его. */
  imageCommand(arg) {
    if (arg === undefined || arg === 'input') { this.pickImage(null, { input: arg === 'input' }); return; }
    this.insertHostImage(/^data:/.test(arg) ? { dataUrl: arg } : { src: arg });
  }

  /** Ответ хозяина на image-pick: { dataUrl, name } — байты фото (кладутся в
   *  хранилище картинок, asset:…), { src } — готовый адрес, { assetId } —
   *  картинка, уже лежащая в хранилище, { cancel: true } — передумали. */
  async insertHostImage(m) {
    const cb = this.pickCb;
    this.pickCb = null;
    if (!m || m.cancel) return;
    let src = m.src || (m.assetId ? (String(m.assetId).startsWith('asset:') ? String(m.assetId) : `asset:${m.assetId}`) : '');
    if (!src && m.dataUrl) {
      try {
        const blob = dataUrlToBlob(m.dataUrl);
        const file = new File([blob], m.name || 'photo', { type: blob.type || m.mime || 'image/jpeg' });
        if (!cb) { await this.insertFiles([file]); return; }
        src = await this.assets.put(file);
      } catch (e) {
        this.bridge.send({ type: 'error', message: `insertImage: ${e && e.message}` });
        return;
      }
    }
    if (!src) return;
    if (cb) cb(src);
    else {
      C.insertImage({ src, alt: m.name ? String(m.name).replace(/\.[a-z0-9]+$/i, '') : '' })(this.view.state, this.view.dispatch);
      this.view.focus();
    }
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

  // --- PDF (pdf.js) -------------------------------------------------------------------

  /** Выбрать PDF: страницы или текст (pdf.js). Веб и десктоп — окно выбора
   *  файла в странице; телефон (nativeToolbar, протокол 3) — файл выбирает
   *  хозяин: редактор шлёт { type: 'pdf-pick' }, ответ — pdf-file. */
  pickPdf() {
    if (this.host) { this.bridge.send({ type: 'pdf-pick' }); return true; }
    if (!this.pdfInput) return false;
    this.pdfInput.value = '';
    this.pdfInput.click();
    return true;
  }

  importPdf(file) { return importPdf(this, file); }

  /** Ответ хозяина на pdf-pick: { name, base64 } — байты PDF без префикса
   *  data:; { cancel: true } — передумали. Дальше — тот же путь, что у
   *  файла из окна выбора (размер, страницы, окно способа). */
  receivePdfFile(m) {
    if (!m || m.cancel || typeof m.base64 !== 'string') return false;
    let bytes;
    try { bytes = base64ToBytes(m.base64); } catch (e) {
      this.bridge.send({ type: 'error', message: `pdf-file: ${e && e.message}` });
      return false;
    }
    return this.importPdf(new File([bytes], m.name || 'document.pdf', { type: 'application/pdf' }));
  }

  /** Перетаскивание пальцем (press.js: картинка за ручку, слои и ручки
   *  страницы PDF) — хозяину { type: 'gesture', on } (протокол 3): на время
   *  жеста телефон выключает прокрутку страницы, иначе Android отдаёт
   *  движение внешнему ScrollView. Жестов может идти несколько — on уходит на
   *  первом, off — когда кончился последний; повторного on без off нет. */
  gesture(on) {
    this.gestures = Math.max(0, (this.gestures || 0) + (on ? 1 : -1));
    const now = this.gestures > 0;
    if (now === !!this.gestureSent) return;
    this.gestureSent = now;
    if (this.host) this.bridge.send({ type: 'gesture', on: now });
  }

  /** Прервать идущие жесты: смена документа, уход фокуса, закрытие. На
   *  каждое отправленное on — off, даже если жест не успел кончиться сам. */
  endGestures() {
    cancelPresses();
    if (this.gestures || this.gestureSent) {
      this.gestures = 0;
      if (this.gestureSent) { this.gestureSent = false; if (this.host) this.bridge.send({ type: 'gesture', on: false }); }
    }
  }

  /** Гостевые картинки (вставлены без аккаунта) — аккаунту userId: перенос
   *  «Без аккаунта» на телефоне (host.js: assets-adopt). which.ids — только
   *  эти записи; which.referenced — только те, на которые ссылается
   *  открытый документ (он — документ аккаунта userId, значит, и картинки в
   *  нём его); без них — все гостевые. Сразу и выгрузка — если облако этого
   *  аккаунта открыто. Возвращает, сколько записей перешло. */
  async adoptGuestAssets(userId, which) {
    if (!userId || !this.assets || !this.assets.adoptGuest) return 0;
    const w = which || {};
    let ids = null;
    if (w.referenced) ids = assetIdsIn(this.view.state.doc.toJSON());
    else if (Array.isArray(w.ids)) ids = w.ids.filter((x) => typeof x === 'string' && x);
    if (ids && !ids.length) return 0;
    const n = await this.assets.adoptGuest(String(userId), ids);
    if (n && this.assets.flush) await this.assets.flush();
    return n;
  }

  /** Стереть с устройства картинки аккаунта userId (host.js: assets-forget,
   *  протокол 5): аккаунт удалён или убран с телефона. Хозяину — ответ
   *  { type: 'assets-forgotten', userId, n }. Возвращает n. */
  async forgetAssets(userId) {
    let n = 0;
    try {
      if (userId && this.assets && this.assets.forget) n = await this.assets.forget(String(userId));
    } catch (e) {
      this.bridge.send({ type: 'error', message: `assets-forget: ${e && e.message}` });
    }
    this.bridge.send({ type: 'assets-forgotten', userId: userId == null ? null : String(userId), n });
    return n;
  }

  /** Ответ хозяина на pdf-module: код модуля впрыснут ({ error } — нет). */
  pdfModuleReady(m) { pdfModuleArrived(m && m.error); }

  imageFromUrl(anchor) {
    this.ask(anchor, { label: this.t('image.url_prompt'), placeholder: 'https://' }, (v) => {
      const src = v.trim();
      if (!/^https?:\/\//i.test(src)) return;
      C.insertImage({ src, alt: '' })(this.view.state, this.view.dispatch);
    });
  }

  /** Правила вставки — и для Ctrl+V, и для «Вставить» из меню по правой
   *  кнопке (contextmenu.js шлёт сюда то же событие с буфером): картинки —
   *  в хранилище, один адрес на выделенный текст — ссылкой на выделение,
   *  Markdown — разметкой. Остальное вставляет ProseMirror сам. */
  onPaste(view, e) {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); this.insertFiles(files); return true; }
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    // Адрес на выделенный текст — текст остаётся, ссылка ложится на него.
    if (text && linkOnPaste(text)(view.state, view.dispatch)) { e.preventDefault(); return true; }
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

  /** Новый график: окно правки, а на телефоне с нативной панелью — лист
   *  хозяина (сообщение chart, host.js). */
  insertChart(chart) {
    if (this.host) { this.chartToHost(null, chart || defaultChart(this.t)); return; }
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
    if (this.host) {
      this.chartToHost(null, Object.assign(defaultChart(this.t), data, { title: '' }), found ? found.node.attrs.bid : null);
      return;
    }
    editChart(this.root, Object.assign(defaultChart(this.t), data, { title: '' }), this.t, (c) => {
      const s = this.view.state;
      const at = found ? found.pos + found.node.nodeSize : s.selection.to;
      const tr = s.tr.insert(at, N.chart.create({ chart: c }));
      this.view.dispatch(tr.scrollIntoView());
    });
  }

  /** График — хозяину на правку: id — bid узла (null — новый), spec — его
   *  данные. afterBid — новый встанет под этим блоком (график из таблицы). */
  chartToHost(id, chart, afterBid) {
    this.pendingChart = { afterBid: afterBid || null };
    this.bridge.send({ type: 'chart', id, spec: chartSpec(chart) });
  }

  /** Касание графика на телефоне. Без bid (график вложен в список или
   *  цитату — blockIds метит только верхний уровень) — сначала метим, иначе
   *  ответ хозяина некуда было бы положить. */
  editChartOnHost(getPos) {
    const pos = getPos();
    const node = pos == null ? null : this.view.state.doc.nodeAt(pos);
    if (!node || node.type !== N.chart) return;
    let bid = node.attrs.bid;
    if (!bid) {
      bid = shortId();
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { bid })).setMeta('addToHistory', false));
    }
    this.chartToHost(bid, node.attrs.chart);
  }

  /** Ответ хозяина на chart: { id: null, spec } — вставить новый, { id, spec }
   *  — заменить данные графика, { cancel: true } — передумали. */
  receiveChart(m) {
    const pending = this.pendingChart;
    this.pendingChart = null;
    if (!m || m.cancel || !m.spec || typeof m.spec !== 'object') return;
    const { state } = this.view;
    const byBid = (bid, type) => {
      let found = null;
      if (bid == null) return null;
      state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.attrs && node.attrs.bid === bid && (!type || node.type === type)) { found = { node, pos }; return false; }
        return true;
      });
      return found;
    };
    if (m.id != null) {
      const found = byBid(m.id, N.chart);
      if (!found) { this.bridge.send({ type: 'error', message: `chart: нет графика ${m.id}` }); return; }
      const chart = chartFromSpec(m.spec, found.node.attrs.chart);
      this.view.dispatch(state.tr.setNodeMarkup(found.pos, null, Object.assign({}, found.node.attrs, { chart })));
      return;
    }
    const chart = chartFromSpec(m.spec, defaultChart(this.t));
    const after = pending && byBid(pending.afterBid);
    if (after) this.view.dispatch(state.tr.insert(after.pos + after.node.nodeSize, N.chart.create({ chart })).scrollIntoView());
    else C.insertChart(chart)(state, this.view.dispatch);
    this.view.focus();
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
    // Страницы PDF — картинкой со слоями поверх (pdfexport.js: rasterPage):
    // в печати по странице на лист — то же правило @media print, что у картинок.
    // Слой-картинку, которую нельзя нарисовать (чужой адрес без CORS),
    // rasterPage пропускает и считает — об этом тост.
    const pages = [];
    this.view.state.doc.descendants((n) => { if (n.type === N.pdfpage) pages.push(n); return true; });
    const divs = box.querySelectorAll('div.led-pdfpage');
    const report = { skipped: 0 };
    for (let i = 0; i < divs.length; i++) {
      const node = pages[i];
      const src = node ? await rasterPage(this, node, { report }) : null;
      divs[i].replaceWith(src
        ? h('figure', { class: 'led-pdfpage' }, h('img', { src, alt: this.t('pdf.page_alt', { n: node.attrs.page }) }))
        : h('p', {}, this.t('pdf.page_alt', { n: node ? node.attrs.page : i + 1 })));
    }
    if (report.skipped) this.toast(this.t('export.layers_skipped', { n: report.skipped }));
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
.led-ff-serif{font-family:Georgia,serif}.led-ff-mono{font-family:ui-monospace,Menlo,Consolas,monospace}
@media print{figure,img,svg{break-inside:avoid;page-break-inside:avoid}img{max-height:calc(100vh - 80px);width:auto}}</style></head><body>${box.innerHTML}</body></html>`;
  }

  /** HTML для «Скачать HTML» и печати; не вышло — тост, как у «Сохранить
   *  как PDF», и null. */
  async safeHtml() {
    try {
      return await this.exportHtml();
    } catch (e) {
      console.error('[editor] HTML', e);
      this.toast(this.t('export.html_failed'));
      return null;
    }
  }

  async exportAs(kind) {
    const md = kind === 'md';
    const text = md ? Core.docToMarkdown(this.view.state.doc.toJSON()) : await this.safeHtml();
    if (text == null) return false;
    // В WebView скачивания нет: файл отдаёт хозяин (поделиться, сохранить).
    if (this.host) {
      this.bridge.send({ type: 'export', kind, name: this.fileName(md ? 'md' : 'html'), mime: md ? 'text/markdown' : 'text/html', text });
      return true;
    }
    downloadBlob(new Blob([text], { type: md ? 'text/markdown' : 'text/html' }), this.fileName(md ? 'md' : 'html'));
    return true;
  }

  /** «Сохранить как PDF» (17 октября 2026): весь документ — страницы PDF
   *  копиями исходного файла со слоями поверх, остальное — набором на A4.
   *  Пишет pdf-lib из ленивого PDF-модуля (editor-pdf.js, pdfwrite.js), план
   *  собирает pdfexport.js. Веб и десктоп скачивают файл тем же путём, что
   *  Markdown и HTML (downloadBlob: в Electron — окно сохранения); хозяину с
   *  нативной панелью уходит export с kind 'pdf' и байтами в base64. Модуль
   *  телефону даёт хозяин по запросу pdf-module (pdf.js: loadPdfModule). */
  async exportPdf() {
    const t = this.t;
    let mod;
    this.toast(t('export.pdf_making'));
    try {
      mod = await loadPdfModule(this);
    } catch (e) {
      console.error('[editor] PDF-модуль', e);
      this.toast(t('pdf.module_failed'));
      return false;
    }
    try {
      const { plan } = await buildPdfPlan(this);
      const { bytes, rasterized } = await mod.writePdf(plan);
      const name = this.fileName('pdf');
      if (this.host) this.bridge.send({ type: 'export', kind: 'pdf', name, mime: 'application/pdf', base64: bytesToBase64(bytes) });
      else downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
      // Исходного PDF на этом устройстве нет — такие страницы ушли картинкой.
      if (rasterized) this.toast(t('export.pdf_raster', { n: rasterized }));
      return true;
    } catch (e) {
      console.error('[editor] PDF', e);
      this.toast(t('export.pdf_failed'));
      return false;
    }
  }

  async copyMarkdown() {
    // Буфер обмена из WebView без жеста не пишется — копирует хозяин.
    if (this.host) {
      this.bridge.send({ type: 'export', kind: 'copy', name: '', mime: 'text/plain', text: Core.docToMarkdown(this.view.state.doc.toJSON()) });
      return;
    }
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
    const html = await this.safeHtml();
    if (html == null) return false;
    if (this.host) {
      this.bridge.send({ type: 'export', kind: 'print', name: this.fileName('html'), mime: 'text/html', text: html });
      return;
    }
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

  // --- контекстная панель телефона (host.js, протокол 4) ----------------------------------
  //
  // Выделенный блок — картинка, график, рисунок, страница PDF и её слой — и
  // таблица под курсором. Команды не зовут view.focus(): выделен блок, а не
  // текст, и клавиатуре на телефоне открываться незачем (KEEP_FOCUS).

  /** Вид выделенного блока нужного типа — по NodeSelection. */
  selectedView(type, of) {
    const sel = this.view.state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type !== type) return null;
    return of(this.view.nodeDOM(sel.from));
  }

  /** Ширина картинки на экране в % полосы (в ряду — ряда) — для context. */
  imageWidthPct(pos) {
    const iv = imageViewOf(this.view.nodeDOM(pos));
    return iv ? iv.widthPct() : null;
  }

  /** Вид страницы PDF по позиции — для context (выделенный слой, режим). */
  pdfPageView(pos) { return pdfPageViewOf(this.view.nodeDOM(pos)); }

  /** «Назад» (exec deselect): снять выделение блока, курсор — за блок. Со
   *  слоя страницы PDF (и из «Заменить текст») — сначала на саму страницу.
   *  Рисунок в правке закрывается. Фокус не трогаем: клавиатура закрыта —
   *  так и остаётся. */
  deselect() {
    const dv = this.activeDrawing;
    if (dv) {
      const pos = dv.getPos();
      dv.deactivate();
      return pos == null ? true : C.leaveBlock(pos)(this.view.state, this.view.dispatch);
    }
    const pv = this.selectedView(N.pdfpage, pdfPageViewOf);
    if (pv && pv.release()) return true;
    return C.leaveBlock()(this.view.state, this.view.dispatch);
  }

  /** Удалить выделенный блок (exec deleteBlock): рисунок в правке — его. */
  deleteSelected() {
    if (this.activeDrawing) { this.activeDrawing.remove(); return true; }
    return C.deleteSelectedBlock(this.view.state, this.view.dispatch);
  }

  /** Действия острова картинки, которым нужен её вид: подпись и описание
   *  полем в странице, замена (image-pick), скачивание. */
  imageAction(what) {
    const iv = this.selectedView(N.image, imageViewOf);
    if (!iv) return false;
    if (what === 'caption') iv.editCaption();
    else if (what === 'alt') iv.editAlt();
    else if (what === 'replace') iv.replace();
    else if (what === 'download') this.downloadImage(iv);
    else return false;
    return true;
  }

  /** Скачать картинку. Веб и десктоп — как раньше (image.js: download);
   *  в WebView скачивания нет — байты хозяину (export kind 'image'), а
   *  картинку по адресу открывает браузер системы. */
  async downloadImage(iv) {
    if (!this.host) { iv.download(); return true; }
    const { src, alt } = iv.node.attrs;
    let blob = null;
    try {
      blob = /^data:/.test(src) ? dataUrlToBlob(src) : await this.assets.blob(src);
    } catch { blob = null; }
    if (!blob) {
      if (/^https?:/i.test(src)) { this.openUrl(src); return true; }
      this.bridge.send({ type: 'error', message: 'imageDownload: картинки нет на устройстве' });
      return false;
    }
    const mime = blob.type || 'image/png';
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[mime] || 'png';
    const name = `${String(alt || 'image').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'image'}.${ext}`;
    this.bridge.send({ type: 'export', kind: 'image', name, mime, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    return true;
  }

  /** Править выделенный график: на телефоне — лист хозяина (chart), на
   *  вебе и десктопе — окно правки. */
  editSelectedChart() {
    const sel = this.view.state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type !== N.chart || !this.view.editable) return false;
    const pos = sel.from;
    if (this.host) { this.editChartOnHost(() => pos); return true; }
    editChart(this.root, sel.node.attrs.chart, this.t, (chart) => {
      const node = this.view.state.doc.nodeAt(pos);
      if (node && node.type === N.chart) this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { chart })));
    });
    return true;
  }

  /** Открыть выделенный рисунок на правку (панель пера в самом блоке). */
  editSelectedDrawing() {
    const dv = this.activeDrawing || this.selectedView(N.drawing, drawingViewOf);
    if (!dv || !this.view.editable) return false;
    dv.activate();
    return true;
  }

  /** Команда выделенной страницы PDF: tool — добавить слой или режим
   *  «Заменить текст», остальное — про выделенный слой (pdfpage.js: command). */
  pdfCommand(name, arg) {
    const pv = this.selectedView(N.pdfpage, pdfPageViewOf);
    return pv ? pv.command(name, arg) : false;
  }

  // --- для хозяина и тестов --------------------------------------------------------------

  /** Команда по имени — для телефона (кнопки снаружи WebView), меню и
   *  тестов. Имена и arg — host.js: commands(); неизвестное имя — false. */
  exec(name, arg) {
    const fn = Object.prototype.hasOwnProperty.call(this.commands || (this.commands = commands(this)), name) ? this.commands[name] : null;
    if (!fn) return false;
    const r = fn(arg);
    if (!this.view.hasFocus() && !KEEP_FOCUS.has(name) && this.textEditable()) this.view.focus();
    return r;
  }

  /** Что включено под курсором — то же, что подсвечивает веб-панель, и
   *  состояние редактора (фокус, пометки, масштаб). Для нативной панели. */
  getToolbarState() { return toolbarState(this); }

  /** Убрать фокус из текста — на телефоне это закрывает клавиатуру. */
  blur() {
    if (this.view.hasFocus()) this.view.dom.blur();
  }

  /** Сообщение хозяина (exec, setZoom, setContent, focus, blur,
   *  insertImage, setLink, chart, pdf-file, pdf-module-ready, viewport,
   *  assets-adopt, assets-forget, getState). true — разобрано. */
  receive(msg) { return this.bridge.receive(msg); }

  destroy() {
    this.endGestures();
    this.abortDocJobs('destroy');
    if (this.onWinBlur) { window.removeEventListener('blur', this.onWinBlur); document.removeEventListener('visibilitychange', this.onWinBlur); }
    this.flush();
    this.bridge.destroy();
    if (this.heightRo) this.heightRo.disconnect();
    this.mount.removeEventListener('mousedown', this.onBlank);
    this.contextMenu.destroy();
    this.tableHandles.destroy();
    closePopup();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.onThemeChange);
    this.overlay.destroy();
    this.toolbar.destroy();
    this.view.destroy();
    this.root.remove();
    document.removeEventListener('keydown', this.onFullscreenKey, true);
    if (this.fullscreen) {
      this.fullscreen = false;
      if (this.opts.onFullscreen) this.opts.onFullscreen(false);
    }
  }
}

// Декорация режима фокуса — текущий блок верхнего уровня.
function DecorationSetFor(doc, start, node) {
  return DecorationSet.create(doc, [Decoration.node(start, start + node.nodeSize, { class: 'led-current' })]);
}

export function create(mount, opts) { return new Editor(mount, opts); }

// Протокол телефона (host.js): версия, окно WebView, имена команд, масштаб,
// данные графика для листа хозяина.
export { createAssetStore, schema, Core, isInTable, NodeSelection, PROTOCOL, VIEWPORT, EXEC_NAMES, ZOOM_MIN, ZOOM_MAX, chartSpec, chartFromSpec, CHART_TYPES };

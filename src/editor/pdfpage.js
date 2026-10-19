// Страница PDF со слоями поверх — вид узла pdfpage (17 октября 2026,
// DESIGN.md «Редактор PDF»). Решение пользователя: «слои + „заменить
// текст“, две волны»; это волна 1 — слои.
//
// Страница — превью (.led-pdf-preview, PNG из хранилища картинок), поверх —
// слой .led-pdf-overlays той же геометрии. Слои стоят в долях страницы (%),
// кегль и толщина — в pt через 100cqw / --pw (лист — контейнер), так что при
// любой ширине блока их не надо пересчитывать из JS. Порядок в списке —
// порядок наложения.
//
// Правка — транзакцией атрибута overlays (setNodeAttribute: узел не
// пересоздаётся, выделение и вид остаются), отмена — история редактора.
// Текстовый слой правится на месте (contenteditable внутри слоя, не в
// документе ProseMirror): ввод уходит в узел с задержкой и по уходу фокуса.
//
// Мышь: нажали на слой — выделен, повели — едет; ручки рамки — размер,
// у стрелки — концы. Двойной щелчок по тексту — правка. Клавиатура: Delete и
// Backspace — удалить слой, Esc — снять выделение, стрелки — на 1 pt (Shift
// — на 10). Палец: касание — выделить, долгое нажатие (350 мс, press.js) и
// повести — двигать, иначе страница прокручивается; ручки крупнее; двойное
// касание по тексту — правка.
//
// Остров .led-pdfbar (тот же вид, что .led-tablebar) — над страницей, пока
// она выделена: добавить текст, картинку, прямоугольник, стрелку, маркер,
// замазку; «Заменить текст» (волна 2); у выделенного слоя — цвет, кегль,
// жирность, толщина, на передний план или назад, удалить. На телефоне с
// нативной панелью (протокол 4, 18 октября 2026) острова нет: те же
// действия — в контекстной панели хозяина (command, context в host.js).
//
// «Заменить текст» (волна 2): строки страницы — attrs.lines (pdftext.js:
// pageLines, при импорте). В режиме замены строки обведены, строка под
// мышью (пальцем — после касания) подсвечена; щелчок (второе касание той же
// строки) ставит пару слоёв — замазку по строке и её текст тем же кеглем на
// той же базе (pdfgeom.js: replaceOverlays) — и сразу открывает текст на
// правку. У страницы, вставленной до волны 2, строк нет (null): кнопка их
// сначала распознаёт из исходного PDF в хранилище (pdf.js: recognizeLines). Перо поверх всего документа (overlay.js) — как
// было: когда рисуют, оно лежит над страницей и слоями.
import { NodeSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { h, svg, btn, debounce } from './util.js';
import { menu, popup, colorGrid } from './ui.js';
import * as G from './pdfgeom.js';
import { press, bindTouchGuard } from './press.js';

/** Инструменты острова: вид слоя, значок, строка подсказки. */
export const PDF_TOOLS = [
  ['text', 'type', 'pdfpage.add_text'],
  ['image', 'image', 'pdfpage.add_image'],
  ['rect', 'rect', 'pdfpage.add_rect'],
  ['arrow', 'arrow', 'pdfpage.add_arrow'],
  ['highlight', 'marker', 'pdfpage.add_highlight'],
  ['whiteout', 'eraser', 'pdfpage.add_whiteout'],
];

/** Двойное касание — два касания одного слоя за столько миллисекунд. */
const DOUBLE_TAP_MS = 350;
/** Ввод в текстовый слой уходит в документ с такой задержкой. */
const TEXT_COMMIT_MS = 400;

const pct = (v) => `${Math.round(v * 100000) / 1000}%`;

/** Текстовые слои, у которых уже висят ввод и уход фокуса. */
const BOUND = new WeakSet();

/** Вид страницы по её узлу на странице — контекстной панели телефона
 *  (index.js: pdfPageView, pdfCommand). */
const VIEWS = new WeakMap();
export const pdfPageViewOf = (dom) => (dom ? VIEWS.get(dom) || null : null);

export class PdfPageView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    this.sel = null;
    this.editing = null;
    this.els = new Map();
    this.lastTap = null;
    const t = ctx.t;
    this.img = h('img', { class: 'led-pdf-preview', alt: '', draggable: 'false' });
    this.status = h('div', { class: 'led-pdf-status' });
    this.layer = h('div', { class: 'led-pdf-overlays' });
    this.linesLayer = h('div', { class: 'led-pdf-lines', hidden: true });
    this.replacing = false;
    this.hoverIndex = null;
    this.frame = h('div', { class: 'led-pdf-frame' });
    this.handles = {};
    for (const k of [...G.HANDLES, ...G.ARROW_HANDLES]) this.handles[k] = h('span', { class: `led-pdf-h led-pdf-h-${k}`, dataset: { h: k }, draggable: 'false' });
    this.selLayer = h('div', { class: 'led-pdf-sel', hidden: true }, this.frame, ...Object.values(this.handles));
    this.sheet = h('div', { class: 'led-pdf-sheet', tabindex: '-1', role: 'group' }, this.img, this.status, this.layer, this.linesLayer, this.selLayer);
    this.bar = this.buildBar();
    this.barWrap = h('div', { class: 'led-pdfbar-wrap' }, this.bar);
    this.dom = h('div', { class: 'led-pdfpage', contenteditable: 'false' }, ctx.native ? null : this.barWrap, this.sheet);
    VIEWS.set(this.dom, this);
    bindTouchGuard(this.sheet);
    this.sheet.addEventListener('pointerdown', (e) => this.onDown(e));
    this.sheet.addEventListener('pointermove', (e) => this.onHover(e));
    this.sheet.addEventListener('dblclick', (e) => this.onDbl(e));
    this.sheet.addEventListener('keydown', (e) => this.onKey(e));
    // Долгое нажатие пальцем — перенос слоя, а не меню браузера.
    this.sheet.addEventListener('contextmenu', (e) => { if (!this.editing) e.preventDefault(); });
    this.commitText = debounce(() => this.saveText(false), TEXT_COMMIT_MS);
    this.paint();
    this.load();
  }

  // --- данные ------------------------------------------------------------------

  get page() { return { w: Number(this.node.attrs.w) || 595, h: Number(this.node.attrs.h) || 842 }; }

  overlays() { return G.normalizeOverlays(this.node.attrs.overlays, this.page); }

  find(id) { return G.findOverlay(this.overlays(), id); }

  canEdit() { return this.view.editable && this.ctx.canEdit(); }

  /** px на pt — по нынешней ширине листа. */
  scale() { return G.scaleOf(this.sheet.getBoundingClientRect().width, this.page.w); }

  /** Новый список слоёв — шагом документа (одна отмена). */
  commit(list) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'overlays', G.normalizeOverlays(list, this.page)));
  }

  // --- вид ---------------------------------------------------------------------

  async load() {
    const src = this.node.attrs.preview;
    if (this.loadedSrc === src) return;
    this.loadedSrc = src;
    this.status.textContent = this.ctx.t('image.loading');
    this.status.hidden = false;
    const url = src ? await this.ctx.assets.resolve(src) : null;
    if (this.loadedSrc !== src) return;
    if (!url) { this.status.textContent = this.ctx.t('pdfpage.missing'); return; }
    this.img.onload = () => { this.status.hidden = true; };
    this.img.onerror = () => { this.status.hidden = false; this.status.textContent = this.ctx.t('pdfpage.missing'); };
    this.img.src = url;
  }

  paint() {
    const a = this.node.attrs;
    const { w, h: hgt } = this.page;
    // Размер листа — пропорцией страницы; --pw — её ширина в pt для кегля
    // и толщины слоёв (100cqw / --pw — px на pt).
    this.sheet.style.aspectRatio = `${w} / ${hgt}`;
    this.sheet.style.setProperty('--pw', String(w));
    this.img.alt = this.ctx.t('pdf.page_alt', { n: a.page });
    this.sheet.setAttribute('aria-label', this.ctx.t('pdfpage.label', { n: a.page }));
    const list = this.overlays();
    const keep = new Set();
    list.forEach((o, i) => {
      let el = this.els.get(o.id);
      if (!el || el.dataset.type !== o.type) {
        if (el) el.remove();
        el = this.makeEl(o);
        this.els.set(o.id, el);
      }
      this.place(el, o);
      if (this.layer.children[i] !== el) this.layer.insertBefore(el, this.layer.children[i] || null);
      keep.add(o.id);
    });
    for (const [id, el] of this.els) if (!keep.has(id)) { el.remove(); this.els.delete(id); }
    if (this.sel && !keep.has(this.sel)) this.sel = null;
    if (this.editing && !keep.has(this.editing)) this.editing = null;
    this.paintSelection();
  }

  makeEl(o) {
    const base = { class: `led-pdf-ov led-pdf-${o.type}`, dataset: { id: o.id, type: o.type }, draggable: 'false' };
    if (o.type === 'arrow') {
      const hit = svg('line', { class: 'led-pdf-arrow-hit' });
      const line = svg('line', { class: 'led-pdf-arrow-line' });
      const head = svg('polygon', { class: 'led-pdf-arrow-head' });
      const el = svg('svg', { class: base.class, 'data-id': o.id, 'data-type': o.type, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, hit, line, head);
      return el;
    }
    if (o.type === 'image') return h('div', base, h('img', { alt: '', draggable: 'false' }));
    if (o.type === 'text') return h('div', Object.assign({ 'data-ph': this.ctx.t('pdfpage.text_ph'), spellcheck: 'false' }, base));
    return h('div', base);
  }

  place(el, o) {
    const { w: W, h: H } = this.page;
    el.classList.toggle('on', o.id === this.sel);
    if (o.type === 'arrow') {
      el.setAttribute('viewBox', `0 0 ${W} ${H}`);
      el.dataset.c = o.stroke.color;
      const x1 = o.x;
      const y1 = o.y;
      const x2 = o.x + o.w;
      const y2 = o.y + o.h;
      const [hit, line, head] = el.children;
      for (const l of [hit, line]) { l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); }
      line.setAttribute('stroke-width', o.stroke.width);
      const [p, q] = G.arrowHead(x1, y1, x2, y2, o.stroke.width);
      head.setAttribute('points', `${x2},${y2} ${p.x},${p.y} ${q.x},${q.y}`);
      return;
    }
    el.style.left = pct(o.x / W);
    el.style.top = pct(o.y / H);
    el.style.width = pct(o.w / W);
    if (o.type === 'text') {
      el.style.minHeight = pct(o.h / H);
      el.style.setProperty('--fs', String(o.font.size));
      el.dataset.c = o.font.color;
      el.classList.toggle('bold', o.font.weight === 'bold');
      if (this.editing !== o.id && el.textContent !== o.text) el.textContent = o.text;
    } else {
      el.style.height = pct(o.h / H);
    }
    if (o.type === 'rect') { el.dataset.c = o.stroke.color; el.style.setProperty('--sw', String(o.stroke.width)); }
    if (o.type === 'highlight') { el.dataset.c = o.fill.color; el.style.opacity = String(o.fill.opacity); }
    if (o.type === 'image' && el.dataset.src !== o.src) {
      el.dataset.src = o.src;
      const img = el.firstChild;
      this.ctx.assets.resolve(o.src).then((url) => { if (el.dataset.src === o.src && url) img.src = url; });
    }
  }

  /** Рамка и ручки выделенного слоя — поверх всех слоёв. */
  paintSelection(live) {
    const o = live || (this.sel && this.find(this.sel));
    this.selLayer.hidden = !o;
    this.dom.classList.toggle('led-pdf-has-sel', !!o);
    this.paintBar(o);
    // Выделенный слой сменился без правки документа — панели телефона.
    if (!live && this.ctx.contextChanged) this.ctx.contextChanged();
    if (!o) return;
    const { w: W, h: H } = this.page;
    const b = G.boundsOf(o);
    const f = this.frame.style;
    f.left = pct(b.x / W);
    f.top = pct(b.y / H);
    f.width = pct(b.w / W);
    f.height = pct(b.h / H);
    const arrow = o.type === 'arrow';
    this.frame.hidden = arrow;
    const at = {
      nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y], e: [b.x + b.w, b.y + b.h / 2],
      se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h], sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2],
      a: [o.x, o.y], b: [o.x + o.w, o.y + o.h],
    };
    // Текст растёт по набору: высоту тянуть незачем — только ширину.
    const shown = arrow ? G.ARROW_HANDLES : (o.type === 'text' ? ['e', 'w'] : G.HANDLES);
    for (const [k, el] of Object.entries(this.handles)) {
      el.hidden = !shown.includes(k) || this.editing === o.id;
      el.style.left = pct(at[k][0] / W);
      el.style.top = pct(at[k][1] / H);
    }
  }

  // --- остров ---------------------------------------------------------------------

  buildBar() {
    const t = this.ctx.t;
    const tool = (type, ic, key) => btn(ic, t(key), () => this.add(type), { 'data-pdf': type });
    this.tb = {
      color: btn('palette', t('pdfpage.color'), (e) => this.colorMenu(e.currentTarget), { 'data-pdf': 'color' }),
      size: btn('fontSize', t('pdfpage.size'), (e) => this.sizeMenu(e.currentTarget), { 'data-pdf': 'size' }),
      bold: btn('bold', t('pdfpage.bold'), () => this.toggleBold(), { 'data-pdf': 'bold' }),
      width: btn('line', t('pdfpage.width'), (e) => this.widthMenu(e.currentTarget), { 'data-pdf': 'width' }),
      front: btn('up', t('pdfpage.front'), () => this.order('front'), { 'data-pdf': 'front' }),
      back: btn('down', t('pdfpage.back'), () => this.order('back'), { 'data-pdf': 'back' }),
      del: btn('trash', t('pdfpage.delete'), () => this.removeSel(), { 'data-pdf': 'delete', class: 'led-btn danger' }),
    };
    this.selGroup = h('span', { class: 'led-node-group led-pdfbar-sel' },
      h('span', { class: 'led-bar-sep' }), ...Object.values(this.tb));
    this.replaceBtn = btn('replace', t('pdfpage.replace'), () => this.toggleReplace(), { 'data-pdf': 'replace' });
    return h('div', { class: 'led-pdfbar', role: 'toolbar', 'aria-label': t('pdfpage.tools') },
      h('span', { class: 'led-node-group' }, ...PDF_TOOLS.map(([type, ic, key]) => tool(type, ic, key)), this.replaceBtn),
      this.selGroup);
  }

  paintBar(o) {
    // «Заменить текст»: строк ещё нет — кнопка их распознает; на странице
    // нет текста (скан) — заменять нечего.
    const lines = this.lines();
    const t = this.ctx.t;
    const label = lines === null ? t('pdfpage.recognize') : (lines.length ? t('pdfpage.replace') : t('pdfpage.no_lines'));
    this.replaceBtn.title = label;
    this.replaceBtn.setAttribute('aria-label', label);
    this.replaceBtn.disabled = !!lines && !lines.length;
    this.replaceBtn.classList.toggle('on', this.replacing);
    this.selGroup.hidden = !o;
    if (!o) return;
    const text = o.type === 'text';
    this.tb.color.hidden = o.type === 'image' || o.type === 'whiteout';
    this.tb.size.hidden = !text;
    this.tb.bold.hidden = !text;
    this.tb.bold.classList.toggle('on', text && o.font.weight === 'bold');
    this.tb.width.hidden = !(o.type === 'rect' || o.type === 'arrow');
  }

  // --- выделение ---------------------------------------------------------------------

  selectNode() { this.dom.classList.add('sel'); }

  deselectNode() {
    this.dom.classList.remove('sel');
    if (this.replacing) this.toggleReplace(false);
    if (this.editing) this.finishEdit();
    if (this.sel) { this.sel = null; this.paint(); }
  }

  /** Выделить саму страницу (остров виден), если она ещё не выделена. */
  selectSelf() {
    const pos = this.getPos();
    if (pos == null) return;
    const { selection } = this.view.state;
    if (selection instanceof NodeSelection && selection.from === pos) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
  }

  /** Выделить слой (null — снять). С выделенным слоем клавиатура — у листа:
   *  Delete, стрелки, Esc — про слой, а не про документ. */
  selectOverlay(id) {
    this.selectSelf();
    this.sel = id;
    this.paint();
    if (id) this.sheet.focus({ preventScroll: true });
    else if (this.canEdit() && !this.ctx.native) this.view.focus();
  }

  // --- указатель ---------------------------------------------------------------------------

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.canEdit()) return;
    if (this.replacing) { this.onReplaceDown(e); return; }
    const handle = e.target.closest('.led-pdf-h');
    const ovEl = e.target.closest('.led-pdf-ov');
    if (this.editing && ovEl && ovEl.dataset.id === this.editing) return; // курсор в набираемом тексте
    if (this.editing) this.finishEdit();
    const mouse = e.pointerType === 'mouse';
    if (handle) { e.preventDefault(); this.startResize(e, handle.dataset.h); return; }
    if (ovEl) {
      if (mouse) { e.preventDefault(); this.selectOverlay(ovEl.dataset.id); }
      this.startMove(e, ovEl.dataset.id);
      return;
    }
    // Мимо слоёв — выделить страницу; пальцем — по касанию, иначе это прокрутка.
    if (mouse) { e.preventDefault(); this.selectOverlay(null); return; }
    press(e, { onTap: () => this.selectOverlay(null) }, this.sheet);
  }

  startMove(e, id) {
    const o0 = this.find(id);
    if (!o0) return;
    const el = this.els.get(id);
    const scale = this.scale();
    let box = null;
    const end = () => { this.dom.classList.remove('led-pdf-moving'); if (el) el.classList.remove('armed'); };
    // Жест прерван (pointercancel, уход фокуса, смена документа): на экране —
    // положение из документа, а не показанное на ходу.
    const back = () => { end(); if (box) this.paint(); };
    this.pressStop = press(e, {
      onArm: () => { this.selectOverlay(id); if (el) el.classList.add('armed'); },
      onStart: () => { if (this.sel !== id) this.selectOverlay(id); this.dom.classList.add('led-pdf-moving'); },
      onMove: (ev, dx, dy) => {
        box = G.roundBox(G.moveBox(o0, dx / scale, dy / scale, this.page));
        this.preview(id, box);
      },
      onEnd: (ev, moved) => {
        end();
        if (moved && box) this.commit(G.updateOverlay(this.overlays(), id, box, this.page));
      },
      onCancel: back,
      onTap: () => {
        end();
        this.selectOverlay(id);
        // Двойное касание текста — правка (мышь — dblclick).
        if (e.pointerType !== 'mouse') {
          const now = Date.now();
          if (o0.type === 'text' && this.lastTap && this.lastTap.id === id && now - this.lastTap.at < DOUBLE_TAP_MS) { this.lastTap = null; this.startEdit(id); return; }
          this.lastTap = { id, at: now };
        }
      },
      gesture: this.ctx.gesture,
    }, this.sheet);
  }

  startResize(e, handle) {
    const o0 = this.sel && this.find(this.sel);
    if (!o0) return;
    const id = o0.id;
    const scale = this.scale();
    let box = null;
    this.pressStop = press(e, {
      immediate: true,
      onStart: () => this.dom.classList.add('led-pdf-moving'),
      onMove: (ev, dx, dy) => {
        const d = [dx / scale, dy / scale];
        if (o0.type === 'arrow') box = G.moveArrowEnd(o0, handle, d[0], d[1], this.page);
        else box = G.resizeBox(o0, handle, d[0], d[1], this.page, { ratio: o0.type === 'image' });
        box = G.roundBox(box);
        this.preview(id, box);
      },
      onEnd: (ev, moved) => {
        this.dom.classList.remove('led-pdf-moving');
        if (moved && box) this.commit(G.updateOverlay(this.overlays(), id, box, this.page));
      },
      onCancel: () => { this.dom.classList.remove('led-pdf-moving'); if (box) this.paint(); },
      gesture: this.ctx.gesture,
    }, this.sheet);
  }

  /** Слой на ходу — только вид; в документ — по отпусканию. */
  preview(id, box) {
    const o = Object.assign({}, this.find(id), box);
    const el = this.els.get(id);
    if (el) this.place(el, o);
    this.paintSelection(o);
  }

  onDbl(e) {
    const ovEl = e.target.closest('.led-pdf-text');
    if (!ovEl || !this.canEdit() || this.editing === ovEl.dataset.id) return;
    e.preventDefault();
    this.startEdit(ovEl.dataset.id);
  }

  // --- клавиатура ----------------------------------------------------------------------------

  onKey(e) {
    if (this.replacing && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.toggleReplace(false); return; }
    if (this.editing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const id = this.editing; this.finishEdit(); this.selectOverlay(id); }
      // «Выделить всё» — только текст слоя: Chromium иначе выделяет весь
      // документ (внешний contenteditable) и уводит в него фокус.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const el = this.els.get(this.editing);
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      const back = e.key === 'z' && !e.shiftKey;
      (back ? undo : redo)(this.view.state, this.view.dispatch);
      return;
    }
    if (!this.sel || !this.canEdit()) return;
    const o = this.find(this.sel);
    if (!o) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeSel(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.selectOverlay(null); return; }
    if (e.key === 'Enter' && o.type === 'text') { e.preventDefault(); this.startEdit(o.id); return; }
    const moved = G.nudge(o, e.key, e.shiftKey, this.page);
    if (moved) { e.preventDefault(); this.commit(G.updateOverlay(this.overlays(), o.id, G.roundBox(moved), this.page)); }
  }

  // --- текст ---------------------------------------------------------------------------------

  startEdit(id) {
    const el = this.els.get(id);
    if (!el || !this.canEdit()) return;
    this.sel = id;
    this.editing = id;
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.classList.add('editing');
    if (!BOUND.has(el)) {
      BOUND.add(el);
      el.addEventListener('input', () => this.commitText());
      el.addEventListener('blur', () => { if (this.editing === el.dataset.id) this.finishEdit(); });
    }
    this.paintSelection();
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Набранное — в узел: текст и высота, которую он занял (pt). */
  saveText(final) {
    const id = this.editing;
    const el = id && this.els.get(id);
    const o = id && this.find(id);
    if (!el || !o) return;
    const text = (el.innerText || '').replace(/\n$/, '');
    if (final && !text.trim()) { this.commit(G.removeOverlay(this.overlays(), id)); return; }
    const hgt = G.round(Math.max(o.font.size * G.LINE_HEIGHT, G.pxToPt(el.getBoundingClientRect().height, this.scale())));
    if (text === o.text && Math.abs(hgt - o.h) < 0.2) return;
    this.commit(G.updateOverlay(this.overlays(), id, { text, h: hgt }, this.page));
  }

  finishEdit() {
    const id = this.editing;
    if (!id) return;
    this.commitText.cancel();
    this.saveText(true);
    this.editing = null;
    const el = this.els.get(id);
    if (el) { el.removeAttribute('contenteditable'); el.classList.remove('editing'); }
    if (!this.find(id)) this.sel = null;
    this.paint();
  }

  // --- «Заменить текст» (волна 2) -------------------------------------------------------------

  /** Строки страницы в pt (null — ещё не распознаны). */
  lines() { return G.normalizeLines(this.node.attrs.lines, this.page); }

  /** Точка события → pt страницы. */
  pointAt(e) {
    const r = this.sheet.getBoundingClientRect();
    const s = G.scaleOf(r.width, this.page.w);
    return { x: G.pxToPt(e.clientX - r.left, s), y: G.pxToPt(e.clientY - r.top, s), s };
  }

  /** Войти в режим замены (или выйти: on false). Строк нет — сначала
   *  распознать их из исходного PDF; его нет на устройстве — подсказка. */
  async toggleReplace(on) {
    const want = on == null ? !this.replacing : !!on;
    const t = this.ctx.t;
    if (!want) {
      this.replacing = false;
      this.hoverIndex = null;
      this.paintLines();
      this.paintBar(this.sel && this.find(this.sel));
      return;
    }
    if (!this.canEdit()) return;
    if (this.editing) this.finishEdit();
    let lines = this.lines();
    if (lines === null) {
      this.ctx.toast(t('pdfpage.recognizing'));
      let got = null;
      try { got = await this.ctx.recognizeLines(this.node.attrs); } catch (err) { console.error('[editor] строки PDF', err); }
      if (!got) { this.ctx.toast(t('pdfpage.no_source')); return; }
      const pos = this.getPos();
      if (pos == null) return;
      // Распознанные строки — данные страницы, а не правка: в историю не идут.
      this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'lines', got).setMeta('addToHistory', false));
      lines = this.lines();
    }
    if (!lines || !lines.length) { this.ctx.toast(t('pdfpage.no_lines')); return; }
    this.selectSelf();
    this.sel = null;
    this.replacing = true;
    this.hoverIndex = null;
    this.paint();
    this.paintLines();
    this.sheet.focus({ preventScroll: true });
    this.ctx.toast(t('pdfpage.replace_hint'));
  }

  /** Строки в режиме замены — обводкой; под указателем — подсветкой. */
  paintLines() {
    this.dom.classList.toggle('led-pdf-replacing', this.replacing);
    if (this.ctx.contextChanged) this.ctx.contextChanged();
    this.linesLayer.hidden = !this.replacing;
    if (!this.replacing) { this.linesLayer.replaceChildren(); return; }
    const { w: W, h: H } = this.page;
    this.linesLayer.replaceChildren(...(this.lines() || []).map((l, i) => {
      const el = h('div', { class: 'led-pdf-line', dataset: { i } });
      el.style.left = pct(l.x / W);
      el.style.top = pct(l.y / H);
      el.style.width = pct(l.w / W);
      el.style.height = pct(l.h / H);
      return el;
    }));
    this.paintHover();
  }

  paintHover() {
    [...this.linesLayer.children].forEach((el, i) => el.classList.toggle('on', i === this.hoverIndex));
  }

  /** Строка под точкой события; запас — 2 pt мышью, пальцем — 6 px. */
  lineFor(e) {
    const lines = this.lines() || [];
    const p = this.pointAt(e);
    const line = G.lineAt(lines, p.x, p.y, e.pointerType === 'mouse' ? 2 : G.pxToPt(6, p.s));
    return { line, index: line ? lines.indexOf(line) : null };
  }

  onHover(e) {
    if (!this.replacing || e.pointerType !== 'mouse') return;
    const { index } = this.lineFor(e);
    if (index !== this.hoverIndex) { this.hoverIndex = index; this.paintHover(); }
  }

  onReplaceDown(e) {
    const { line, index } = this.lineFor(e);
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      if (line) this.replaceLine(line);
      return;
    }
    // Палец: касание подсвечивает строку, второе касание той же — заменяет;
    // повёл — прокрутка.
    press(e, {
      onTap: () => {
        if (!line) return;
        if (this.hoverIndex === index) this.replaceLine(line);
        else { this.hoverIndex = index; this.paintHover(); }
      },
    }, this.sheet);
  }

  /** Заменить строку: замазка и её текст на той же базе — и сразу правка. */
  replaceLine(line) {
    const [white, text] = G.replaceOverlays(line, this.page);
    this.replacing = false;
    this.hoverIndex = null;
    this.paintLines();
    this.commit([...this.overlays(), white, text]);
    this.selectOverlay(text.id);
    this.startEdit(text.id);
  }

  // --- команды острова ------------------------------------------------------------------------

  /** Центр видимой части листа в pt — туда встаёт новый слой. Ещё слой на
   *  том же месте — чуть ниже и правее, чтобы не лёг ровно поверх. */
  dropPoint() {
    const r = this.sheet.getBoundingClientRect();
    const s = G.scaleOf(r.width, this.page.w);
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight || r.bottom);
    const cy = bottom > top ? (top + bottom) / 2 : r.top + r.height / 2;
    let at = { x: this.page.w / 2, y: G.pxToPt(cy - r.top, s) };
    const list = this.overlays().map((o) => G.boundsOf(o));
    const taken = (p) => list.some((b) => Math.abs(b.x + b.w / 2 - p.x) < 2 && Math.abs(b.y + b.h / 2 - p.y) < 2);
    for (let i = 0; i < 24 && taken(at); i++) at = { x: at.x + 12, y: at.y + 12 };
    return at;
  }

  add(type) {
    if (!this.canEdit()) return;
    if (this.editing) this.finishEdit();
    if (type === 'image') { this.addImage(); return; }
    const o = G.newOverlay(type, this.page, { at: this.dropPoint() });
    this.commit([...this.overlays(), o]);
    this.selectOverlay(o.id);
    if (type === 'text') this.startEdit(o.id);
  }

  /** Картинка слоем: тот же выбор, что у картинки в тексте (на телефоне —
   *  image-pick хозяину), размер — по её пропорции. */
  addImage() {
    const at = this.dropPoint();
    this.ctx.pickImage(async (src) => {
      let ratio = 0.75;
      try {
        const url = await this.ctx.assets.resolve(src);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        if (img.naturalWidth && img.naturalHeight) ratio = img.naturalHeight / img.naturalWidth;
      } catch { /* размер не узнали — 4:3 */ }
      const w = Math.min(200, this.page.w * 0.5);
      const o = G.newOverlay('image', this.page, { at, size: { w, h: Math.min(w * ratio, this.page.h * 0.8) }, attrs: { src } });
      if (!o) return;
      this.commit([...this.overlays(), o]);
      this.selectOverlay(o.id);
    });
  }

  patchSel(patch) {
    if (!this.sel) return;
    this.commit(G.updateOverlay(this.overlays(), this.sel, patch, this.page));
    this.keepFocus();
  }

  /** Фокус после кнопки острова: в набираемый текст, если его правят, иначе
   *  на лист — клавиши дальше про слой. */
  keepFocus() {
    const el = this.editing && this.els.get(this.editing);
    if (el) el.focus({ preventScroll: true });
    else this.sheet.focus({ preventScroll: true });
  }

  colorMenu(anchor) {
    const o = this.sel && this.find(this.sel);
    if (!o) return;
    const hl = o.type === 'highlight';
    const cur = o.type === 'text' ? o.font.color : (hl ? o.fill.color : o.stroke.color);
    const p = popup(this.ctx.root, anchor, colorGrid(hl ? 'hl' : 'tc', cur === 'ink' ? null : cur, (c) => {
      p.close();
      this.setColor(c);
    }, this.ctx.t), { class: 'led-pdf-colors' });
  }

  sizeMenu(anchor) {
    const o = this.sel && this.find(this.sel);
    if (!o || o.type !== 'text') return;
    menu(this.ctx.root, anchor, G.FONT_STEPS.map((s) => ({
      label: `${s} pt`, active: o.font.size === s,
      run: () => this.patchSel({ font: Object.assign({}, o.font, { size: s }) }),
    })), { class: 'led-pdf-size-menu' });
  }

  widthMenu(anchor) {
    const o = this.sel && this.find(this.sel);
    if (!o || !o.stroke) return;
    menu(this.ctx.root, anchor, G.STROKE_STEPS.map((s) => ({
      label: `${s} pt`, active: o.stroke.width === s,
      run: () => this.patchSel({ stroke: Object.assign({}, o.stroke, { width: s }) }),
    })), { class: 'led-pdf-width-menu' });
  }

  toggleBold() {
    const o = this.sel && this.find(this.sel);
    if (!o || o.type !== 'text') return;
    this.patchSel({ font: Object.assign({}, o.font, { weight: o.font.weight === 'bold' ? 'normal' : 'bold' }) });
  }

  order(where) {
    if (!this.sel) return;
    this.commit(where === 'front' ? G.toFront(this.overlays(), this.sel) : G.toBack(this.overlays(), this.sel));
    this.keepFocus();
  }

  removeSel() {
    if (!this.sel) return;
    const id = this.sel;
    this.sel = null;
    this.commit(G.removeOverlay(this.overlays(), id));
    // На телефоне — без клавиатуры: команда пришла из панели, не из текста.
    if (this.canEdit() && !this.ctx.native) this.view.focus();
  }

  // --- контекстная панель телефона (host.js, протокол 4) -----------------------------------

  /** Выделенный слой (для context) или null. */
  selectedLayer() { return this.sel ? this.find(this.sel) : null; }

  /** «Назад» с уровня слоя: закончить правку текста, выйти из «Заменить
   *  текст», снять выделение слоя — страница остаётся выделенной. Нечего
   *  снимать — false (тогда снимается выделение страницы). */
  release() {
    if (!this.editing && !this.replacing && !this.sel) return false;
    if (this.editing) this.finishEdit();
    if (this.replacing) this.toggleReplace(false);
    if (this.sel) { this.sel = null; this.paint(); }
    return true;
  }

  /** Команда панели: tool — добавить слой ('text' … 'whiteout'), 'replace' —
   *  режим «Заменить текст», null — выйти из него; color, size, bold, front,
   *  back, delete — про выделенный слой. true — сделано. */
  command(name, arg) {
    if (!this.canEdit()) return false;
    const o = this.selectedLayer();
    switch (name) {
      case 'tool':
        if (arg === 'replace') { this.toggleReplace(true); return true; }
        if (arg == null || arg === '') { if (this.replacing) this.toggleReplace(false); return true; }
        if (!PDF_TOOLS.some(([type]) => type === arg)) return false;
        this.add(arg);
        return true;
      case 'color': return this.setColor(arg);
      case 'size': return this.setSize(arg);
      case 'bold': if (!o || o.type !== 'text') return false; this.toggleBold(); return true;
      case 'front': case 'back': if (!o) return false; this.order(name); return true;
      case 'delete': if (!o) return false; this.removeSel(); return true;
      default: return false;
    }
  }

  /** Цвет выделенного слоя по имени (ink или оттенок палитры); null — по
   *  умолчанию: у маркера жёлтый, у остальных — как текст. У картинки и
   *  замазки цвета нет. */
  setColor(c) {
    const o = this.selectedLayer();
    if (!o) return false;
    const hl = o.type === 'highlight';
    const v = c || (hl ? 'yellow' : 'ink');
    if (o.type === 'text') this.patchSel({ font: Object.assign({}, o.font, { color: v }) });
    else if (hl) this.patchSel({ fill: Object.assign({}, o.fill, { color: v }) });
    else if (o.stroke) this.patchSel({ stroke: Object.assign({}, o.stroke, { color: v }) });
    else return false;
    return true;
  }

  /** Размер выделенного слоя в pt: кегль текста, толщина рамки и стрелки. */
  setSize(pt) {
    const o = this.selectedLayer();
    const n = Number(pt);
    if (!o || pt == null || pt === '' || !Number.isFinite(n) || n <= 0) return false;
    if (o.type === 'text') this.patchSel({ font: Object.assign({}, o.font, { size: n }) });
    else if (o.stroke) this.patchSel({ stroke: Object.assign({}, o.stroke, { width: n }) });
    else return false;
    return true;
  }

  // --- ProseMirror ---------------------------------------------------------------------------

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    this.load();
    return true;
  }

  /** Всё внутри страницы — наше: ProseMirror не ставит курсор и не ловит
   *  клавиши. Кроме перетаскивания файлов: картинку, брошенную на страницу,
   *  вставляет редактор, как везде. */
  stopEvent(e) {
    if (/^drag|^drop/.test(e.type)) return false;
    return this.dom.contains(e.target);
  }

  ignoreMutation() { return true; }

  destroy() {
    this.commitText.cancel();
    // Страница уходит посреди перетаскивания — жест кончается (gesture off).
    if (this.pressStop) this.pressStop();
  }
}


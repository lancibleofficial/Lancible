// Картинка: выравнивание, обтекание текстом, ряд из нескольких картинок,
// ширина перетаскиванием за край, подпись, замещающий текст. Байты — в
// хранилище (assets.js), в документе — src.
//
// Где картинка стоит, решает attrs.align:
//   left / center / right / full — отдельной строкой;
//   wrap-left / wrap-right — прижата к краю, текст обтекает её с другой
//   стороны (по умолчанию шириной 40% полосы).
// В ряду (узел gallery) align не действует: картинки делят ширину ряда, а
// attrs.width — доля ряда, если её задали ручкой.
//
// Ширина (18 октября 2026, жалоба: «рамка растёт, а картинка упирается»).
// Ширину держит коробка .led-img-box — рамка с картинкой и подпись под
// ней; картинка всегда во всю ширину коробки (width: 100%, высота — по
// пропорции), так что рамка и картинка одной ширины, и тянуть можно до
// ширины полосы, в том числе шире исходного размера. Без заданной ширины
// коробка — по картинке (fit-content), но не шире полосы. До этого ширину
// получала рамка, а у картинки было только max-width: 100% — маленький PNG
// стоял своим размером в широкой рамке. Подпись — по ширине картинки.
//
// Телефон с нативной панелью (протокол 4): острова над картинкой нет — его
// кнопки в контекстной панели хозяина (host.js); вместо ручки сбоку —
// значок масштаба .led-img-resize в правом нижнем углу выделенной картинки:
// тянется пальцем сразу (press.js, immediate), шлёт gesture on/off.
import { h, icon, clamp, downloadBlob } from './util.js';
import * as C from './commands.js';
import { bindTouchGuard, press } from './press.js';

const ALIGNS = [
  ['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight'], ['full', 'wide'],
  ['wrap-left', 'wrapLeft'], ['wrap-right', 'wrapRight'],
];
const WRAP_DEFAULT = C.IMAGE_WRAP_WIDTH;

export const isWrap = C.isWrapAlign;

/** Ширина содержимого элемента — без полей: от неё считаются проценты. */
function contentWidth(el) {
  const cs = getComputedStyle(el);
  return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

/** Вид картинки по её узлу на странице — меню по правой кнопке
 *  (contextmenu.js) зовёт те же действия, что кнопки над картинкой. */
const VIEWS = new WeakMap();
export const imageViewOf = (dom) => (dom ? VIEWS.get(dom) || null : null);

export class ImageView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    const t = ctx.t;
    this.img = h('img', { alt: node.attrs.alt || '', draggable: 'false' });
    this.status = h('div', { class: 'led-img-status' });
    // Ширину тянут: на вебе и десктопе — ручкой сбоку, на телефоне с
    // нативной панелью — значком в правом нижнем углу (startScale).
    this.handle = ctx.native ? null : h('span', { class: 'led-img-handle', title: t('image.resize') });
    this.resize = ctx.native ? h('button', {
      type: 'button', class: 'led-img-resize', title: t('image.resize'), 'aria-label': t('image.resize'), draggable: 'false',
    }, icon('maximize', 16)) : null;
    // Телефон (17 октября 2026): ручки блока слева там нет — картинку
    // переносят за свою ручку долгим нажатием (blockdrag.js), а на вебе в
    // телефоне ещё и кнопками «Выше» и «Ниже» на острове (в приложении —
    // blockUp и blockDown контекстной панели).
    this.grip = ctx.mobile ? h('button', {
      type: 'button', class: 'led-img-grip', title: t('image.drag'), 'aria-label': t('image.drag'), draggable: 'false',
      onmousedown: (e) => e.preventDefault(),
    }, icon('grip', 18)) : null;
    this.frame = h('div', { class: 'led-img-frame' }, this.img, this.status, this.handle, this.grip, this.resize);
    this.caption = h('input', {
      class: 'led-caption', placeholder: t('image.caption_ph'), value: node.attrs.caption || '',
      onchange: (e) => this.setAttrs({ caption: e.target.value }),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.view.focus(); } },
    });
    // Коробка: рамка с картинкой и подпись — одной ширины (см. шапку).
    this.box = h('div', { class: 'led-img-box' }, this.frame, this.caption);
    const b = (ic, title, run, extra) => h('button', Object.assign({ type: 'button', class: 'led-btn', title, onclick: run }, extra || {}), icon(ic, 16));
    this.alignBtns = ALIGNS.map(([a, ic]) => b(ic, t(`image.align_${a.replace('-', '_')}`), () => this.setAlign(a), { dataset: { align: a } }));
    this.alignGroup = h('span', { class: 'led-node-group' }, ...this.alignBtns);
    // В ряду вместо выравнивания — порядок и «вынести из ряда».
    this.rowGroup = h('span', { class: 'led-node-group' },
      b('arrowLeft', t('image.move_left'), () => this.moveInRow(-1)),
      b('arrowRight', t('image.move_right'), () => this.moveInRow(1)),
      b('unrow', t('image.unwrap_row'), () => this.unwrapRow()));
    this.moveGroup = ctx.mobile ? h('span', { class: 'led-node-group' },
      b('up', t('block.move_up'), () => this.moveBlock(-1), { dataset: { move: 'up' } }),
      b('down', t('block.move_down'), () => this.moveBlock(1), { dataset: { move: 'down' } }),
      h('span', { class: 'led-bar-sep' })) : null;
    // Нажатие на остров не трогает ни фокус, ни выделение браузера — как у
    // кнопок панели (toolbar.js) и плюса у ручки блока (20 октября 2026,
    // падение в CI: «во всю ширину» → «по центру»). Без этого кнопка внутри
    // выделенной фигуры для браузера — щелчок внутри выделения не по
    // тексту: на отпускании он снимал выделение целиком (rangeCount 0),
    // фокус оставался в тексте, а следующее движение мыши или клавиша
    // ставили курсор в начало заметки — ProseMirror читал его как новое
    // выделение, картинка его теряла, остров прятался.
    this.bar = h('div', { class: 'led-node-bar', onmousedown: (e) => e.preventDefault() },
      this.moveGroup,
      this.alignGroup,
      this.rowGroup,
      h('span', { class: 'led-bar-sep' }),
      b('imagePlus', t('image.add_beside'), () => this.addBeside()),
      b('type', t('image.alt'), () => this.editAlt()),
      b('image', t('image.replace'), () => this.replace()),
      b('download', t('image.download'), () => this.download()),
      b('trash', t('block.delete'), () => this.remove()));
    // С нативной панелью острова нет: его кнопки — в контекстной панели.
    this.dom = h('figure', { class: 'led-figure', contenteditable: 'false' }, ctx.native ? null : this.bar, this.box);
    VIEWS.set(this.dom, this);
    if (this.handle) this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
    if (this.resize) {
      bindTouchGuard(this.resize);
      this.resize.addEventListener('pointerdown', (e) => this.startScale(e));
    }
    if (this.grip) {
      bindTouchGuard(this.grip);
      this.grip.addEventListener('pointerdown', (e) => this.startDrag(e));
    }
    this.paint();
    // Родитель (ряд или нет) известен наверняка, когда вид уже в документе.
    requestAnimationFrame(() => this.paint());
    this.load();
  }

  /** Стоит ли картинка в ряду — по родителю в документе. */
  inRow() {
    const pos = this.getPos();
    if (pos == null) return false;
    try { return this.view.state.doc.resolve(pos).parent.type.name === 'gallery'; } catch { return false; }
  }

  paint() {
    const a = this.node.attrs;
    const row = this.inRow();
    // Телефон: картинку переносят ручкой (blockdrag.js), а не системным
    // переносом — его Android WebView начинает сам, если палец держат дольше
    // ~500 мс, и обрывает наш. ProseMirror ставит draggable узлу уже после
    // конструктора — снимаем здесь (paint зовётся и в следующем кадре).
    // Десктоп и веб с мышью — как было: блок тащат мышью.
    if (this.ctx.mobile) this.dom.draggable = false;
    const align = row ? 'row' : (a.align || 'center');
    this.dom.className = `led-figure align-${align}${this.dom.classList.contains('sel') ? ' sel' : ''}`;
    // Ширину держит: в ряду и при обтекании — сама фигура (рядом с ней
    // другое), отдельной строкой — коробка картинки внутри полосы. Без
    // заданной ширины коробка — по картинке (CSS: fit-content).
    if (row) {
      this.dom.style.flex = a.width ? `0 0 ${a.width}%` : '1 1 0';
      this.dom.style.width = '';
      this.box.style.width = '100%';
    } else if (isWrap(a.align)) {
      this.dom.style.flex = '';
      this.dom.style.width = `${a.width || WRAP_DEFAULT}%`;
      this.box.style.width = '100%';
    } else {
      this.dom.style.flex = '';
      this.dom.style.width = '';
      this.box.style.width = a.align === 'full' ? '100%' : (a.width ? `${a.width}%` : '');
    }
    this.img.alt = a.alt || '';
    if (document.activeElement !== this.caption) this.caption.value = a.caption || '';
    this.caption.hidden = !a.caption && !this.dom.classList.contains('sel');
    this.alignGroup.hidden = row;
    this.rowGroup.hidden = !row;
    this.alignBtns.forEach((btn) => btn.classList.toggle('on', btn.dataset.align === (a.align || 'center')));
  }

  async load() {
    const src = this.node.attrs.src;
    if (this.loadedSrc === src) return;
    this.loadedSrc = src;
    this.status.textContent = this.ctx.t('image.loading');
    this.status.hidden = false;
    const url = await this.ctx.assets.resolve(src);
    if (this.loadedSrc !== src) return;
    if (url) {
      this.img.src = url;
      // Ширина «как есть» известна, когда картинка загрузилась, — панели телефона.
      this.img.onload = () => { this.status.hidden = true; if (this.ctx.contextChanged) this.ctx.contextChanged(); };
      this.img.onerror = () => { this.status.textContent = this.ctx.t('image.missing'); };
    } else {
      this.status.textContent = this.ctx.t('image.missing');
    }
  }

  setAttrs(patch) {
    const pos = this.getPos();
    if (pos != null) C.setImageAttrs(patch, pos)(this.view.state, this.view.dispatch);
  }

  /** Выравнивание (commands.js: setImageAlign — та же команда у панели телефона). */
  setAlign(align) {
    const pos = this.getPos();
    if (pos != null) C.setImageAlign(align, pos)(this.view.state, this.view.dispatch);
  }

  /** Как тянуть ширину сейчас: что растёт (в ряду и при обтекании — фигура,
   *  иначе — коробка), от какой ширины считать проценты (полоса текста, в
   *  ряду — сам ряд), в какую сторону и с каким множителем: у картинки
   *  справа край — слева, по центру (и «во всю ширину», которая станет
   *  «по центру») растут обе стороны. */
  sizing() {
    const row = this.inRow();
    const { align } = this.node.attrs;
    const wrap = !row && isWrap(align);
    const sized = row || wrap ? this.dom : this.box;
    const base = row || wrap ? (this.dom.parentElement || this.dom) : this.dom;
    const dir = !row && (align === 'right' || align === 'wrap-right') ? -1 : 1;
    const both = !row && (align === 'center' || align === 'full' || !align) ? 2 : 1;
    return {
      row, align, sized, k: dir * both,
      parentW: contentWidth(base) || 1,
      startW: sized.getBoundingClientRect().width,
      lo: row ? 15 : 10, hi: row ? 85 : 100,
    };
  }

  /** Ширина в % после сдвига пальца или мыши на dx — и сразу на экран
   *  (в документ — по отпусканию, одной правкой). */
  showWidth(z, dx) {
    const pct = clamp(Math.round(((z.startW + dx * z.k) / z.parentW) * 100), z.lo, z.hi);
    if (z.row) z.sized.style.flex = `0 0 ${pct}%`;
    else z.sized.style.width = `${pct}%`;
    return pct;
  }

  commitWidth(z, pct) {
    this.setAttrs({ width: pct, align: z.align === 'full' ? 'center' : z.align });
  }

  /** Ширина картинки на экране в % полосы (в ряду — ряда) — для панели
   *  телефона, когда ширина «как есть». Не загрузилась — null. */
  widthPct() {
    if (!this.img.complete || !this.img.naturalWidth) return null;
    const z = this.sizing();
    const w = z.sized.getBoundingClientRect().width;
    return w > 0 ? clamp(Math.round((w / z.parentW) * 100), 1, 100) : null;
  }

  /** Ручка сбоку (веб и десктоп): мышью и пальцем, сразу. */
  startResize(e) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const z = this.sizing();
    const startX = e.clientX;
    let pct = null;
    const move = (ev) => { pct = this.showWidth(z, ev.clientX - startX); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (pct != null) this.commitWidth(z, pct);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Значок масштаба (телефон с нативной панелью): тянется пальцем сразу,
   *  без долгого нажатия; пока тянут, хозяин не прокручивает страницу
   *  (gesture on/off); ширина — в % полосы, высота — по пропорции; в
   *  документ — одной правкой на жест (один шаг отмены). */
  startScale(e) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const z = this.sizing();
    let pct = null;
    const end = () => { this.resize.classList.remove('on'); this.scaleStop = null; };
    this.scaleStop = press(e, {
      immediate: true,
      onStart: () => this.resize.classList.add('on'),
      onMove: (ev, dx) => { pct = this.showWidth(z, dx); },
      onEnd: () => { end(); if (pct != null) this.commitWidth(z, pct); else this.paint(); },
      onCancel: () => { end(); this.paint(); },
      gesture: this.ctx.gesture,
    }, this.resize);
  }

  /** Ещё картинка справа: отдельная — становится рядом из двух, в ряду —
   *  ряд становится длиннее. */
  addBeside() {
    this.ctx.pickImage((src) => {
      const pos = this.getPos();
      if (pos == null) return;
      C.addImageBeside(pos, { src, alt: '' })(this.view.state, this.view.dispatch);
    });
  }

  /** Блок с картинкой (или её рядом) — на место выше или ниже. */
  moveBlock(dir) {
    const pos = this.getPos();
    if (pos != null && this.view.editable) C.moveBlockAt(pos, dir)(this.view.state, this.view.dispatch);
  }

  /** Перенос за ручку: долгое нажатие пальцем, мышью — сразу (blockdrag.js). */
  startDrag(e) {
    if (!this.view.editable || !this.ctx.blockDrag) return;
    e.stopPropagation();
    this.dragStop = this.ctx.blockDrag(this.getPos, e, this.grip, this.img, () => this.select());
  }

  /** Вид уходит посреди переноса — жест кончается (хозяину — gesture off). */
  destroy() {
    if (this.dragStop) this.dragStop();
    if (this.scaleStop) this.scaleStop();
  }

  select() {
    const pos = this.getPos();
    if (pos != null) this.ctx.selectNode(pos);
  }

  moveInRow(dir) {
    const pos = this.getPos();
    if (pos != null) C.moveInGallery(pos, dir)(this.view.state, this.view.dispatch);
  }

  unwrapRow() {
    const pos = this.getPos();
    if (pos != null) C.takeOutOfGallery(pos)(this.view.state, this.view.dispatch);
  }

  editAlt() {
    // window.prompt в Electron не работает — своё поле во всплывающей панели;
    // острова на телефоне нет — поле у самой картинки.
    this.ctx.ask(this.ctx.native ? this.frame : this.bar, { label: this.ctx.t('image.alt_prompt'), value: this.node.attrs.alt || '' }, (v) => this.setAttrs({ alt: v.trim() }));
  }

  /** Подпись — в поле под картинкой (exec imageCaption без arg). */
  editCaption() {
    this.caption.hidden = false;
    this.caption.focus({ preventScroll: true });
    const n = this.caption.value.length;
    this.caption.setSelectionRange(n, n);
  }

  replace() {
    this.ctx.pickImage((src) => this.setAttrs({ src }));
  }

  /** Скачать картинку. Из хранилища — своим адресом blob:, который после
   *  клика освобождается (downloadBlob: через 2 с — скачивание уже взяло
   *  байты); по адресу https — как есть, в новой вкладке. */
  async download() {
    const name = this.node.attrs.alt || 'image';
    const blob = await this.ctx.assets.blob(this.node.attrs.src);
    if (blob) { downloadBlob(blob, name); return; }
    const a = h('a', { href: this.img.src, download: name, target: '_blank' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  remove() {
    const pos = this.getPos();
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    this.load();
    return true;
  }

  selectNode() { this.dom.classList.add('sel'); this.paint(); }

  deselectNode() { this.dom.classList.remove('sel'); this.paint(); }

  stopEvent(e) {
    const own = (el) => !!el && el.contains(e.target);
    return own(this.bar) || e.target === this.caption || own(this.handle) || own(this.grip) || own(this.resize);
  }

  ignoreMutation() { return true; }
}

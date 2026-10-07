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
import { h, icon, clamp } from './util.js';
import * as C from './commands.js';

const ALIGNS = [
  ['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight'], ['full', 'wide'],
  ['wrap-left', 'wrapLeft'], ['wrap-right', 'wrapRight'],
];
const WRAP_DEFAULT = 40;

export const isWrap = (align) => align === 'wrap-left' || align === 'wrap-right';

export class ImageView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    const t = ctx.t;
    this.img = h('img', { alt: node.attrs.alt || '', draggable: 'false' });
    this.status = h('div', { class: 'led-img-status' });
    this.handle = h('span', { class: 'led-img-handle', title: t('image.resize') });
    this.frame = h('div', { class: 'led-img-frame' }, this.img, this.status, this.handle);
    this.caption = h('input', {
      class: 'led-caption', placeholder: t('image.caption_ph'), value: node.attrs.caption || '',
      onchange: (e) => this.setAttrs({ caption: e.target.value }),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.view.focus(); } },
    });
    const b = (ic, title, run, extra) => h('button', Object.assign({ type: 'button', class: 'led-btn', title, onclick: run }, extra || {}), icon(ic, 16));
    this.alignBtns = ALIGNS.map(([a, ic]) => b(ic, t(`image.align_${a.replace('-', '_')}`), () => this.setAlign(a), { dataset: { align: a } }));
    this.alignGroup = h('span', { class: 'led-node-group' }, ...this.alignBtns);
    // В ряду вместо выравнивания — порядок и «вынести из ряда».
    this.rowGroup = h('span', { class: 'led-node-group' },
      b('arrowLeft', t('image.move_left'), () => this.moveInRow(-1)),
      b('arrowRight', t('image.move_right'), () => this.moveInRow(1)),
      b('unrow', t('image.unwrap_row'), () => this.unwrapRow()));
    this.bar = h('div', { class: 'led-node-bar' },
      this.alignGroup,
      this.rowGroup,
      h('span', { class: 'led-bar-sep' }),
      b('imagePlus', t('image.add_beside'), () => this.addBeside()),
      b('type', t('image.alt'), () => this.editAlt()),
      b('image', t('image.replace'), () => this.replace()),
      b('download', t('image.download'), () => this.download()),
      b('trash', t('block.delete'), () => this.remove()));
    this.dom = h('figure', { class: 'led-figure', contenteditable: 'false' }, this.bar, this.frame, this.caption);
    this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
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
    const align = row ? 'row' : (a.align || 'center');
    this.dom.className = `led-figure align-${align}${this.dom.classList.contains('sel') ? ' sel' : ''}`;
    // Ширину держит: в ряду и при обтекании — сама фигура (рядом с ней
    // другое), отдельной строкой — рамка картинки внутри полосы.
    if (row) {
      this.dom.style.flex = a.width ? `0 0 ${a.width}%` : '1 1 0';
      this.dom.style.width = '';
      this.frame.style.width = '100%';
    } else if (isWrap(a.align)) {
      this.dom.style.flex = '';
      this.dom.style.width = `${a.width || WRAP_DEFAULT}%`;
      this.frame.style.width = '100%';
    } else {
      this.dom.style.flex = '';
      this.dom.style.width = '';
      this.frame.style.width = a.align === 'full' ? '100%' : (a.width ? `${a.width}%` : '');
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
      this.img.onload = () => { this.status.hidden = true; };
      this.img.onerror = () => { this.status.textContent = this.ctx.t('image.missing'); };
    } else {
      this.status.textContent = this.ctx.t('image.missing');
    }
  }

  setAttrs(patch) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, patch)));
  }

  /** Обтекание и обычное выравнивание по-разному понимают ширину: у первого
   *  это доля полосы под картинку рядом с текстом, и «как есть» там нет. */
  setAlign(align) {
    const was = this.node.attrs;
    let { width } = was;
    if (align === 'full') width = null;
    else if (isWrap(align) && !isWrap(was.align)) width = WRAP_DEFAULT;
    else if (!isWrap(align) && isWrap(was.align)) width = null;
    this.setAttrs({ align, width });
  }

  startResize(e) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const row = this.inRow();
    const wrap = !row && isWrap(this.node.attrs.align);
    const sized = row || wrap ? this.dom : this.frame;
    // Доля от ширины родителя: полосы текста, а в ряду — самого ряда.
    const parentW = (this.dom.parentElement || this.dom).clientWidth || 1;
    const startX = e.clientX;
    const startW = sized.getBoundingClientRect().width;
    const align = this.node.attrs.align;
    const toLeft = !row && (align === 'right' || align === 'wrap-right');
    const centered = !row && align === 'center';
    const move = (ev) => {
      const dx = (ev.clientX - startX) * (toLeft ? -1 : 1) * (centered ? 2 : 1);
      const pct = clamp(Math.round(((startW + dx) / parentW) * 100), row ? 15 : 10, row ? 85 : 100);
      if (row) sized.style.flex = `0 0 ${pct}%`;
      else sized.style.width = `${pct}%`;
      this.pending = pct;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.pending) this.setAttrs({ width: this.pending, align: align === 'full' ? 'center' : align });
      this.pending = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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

  moveInRow(dir) {
    const pos = this.getPos();
    if (pos != null) C.moveInGallery(pos, dir)(this.view.state, this.view.dispatch);
  }

  unwrapRow() {
    const pos = this.getPos();
    if (pos != null) C.takeOutOfGallery(pos)(this.view.state, this.view.dispatch);
  }

  editAlt() {
    // window.prompt в Electron не работает — своё поле во всплывающей панели.
    this.ctx.ask(this.bar, { label: this.ctx.t('image.alt_prompt'), value: this.node.attrs.alt || '' }, (v) => this.setAttrs({ alt: v.trim() }));
  }

  replace() {
    this.ctx.pickImage((src) => this.setAttrs({ src }));
  }

  async download() {
    const blob = await this.ctx.assets.blob(this.node.attrs.src);
    const url = blob ? URL.createObjectURL(blob) : this.img.src;
    const a = h('a', { href: url, download: this.node.attrs.alt || 'image', target: '_blank' });
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
    return this.bar.contains(e.target) || e.target === this.caption || e.target === this.handle;
  }

  ignoreMutation() { return true; }
}

// Картинка: выравнивание, ширина перетаскиванием за край, подпись,
// замещающий текст. Байты — в хранилище (assets.js), в документе — src.
import { h, icon, clamp } from './util.js';

const ALIGNS = [['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight'], ['full', 'wide']];

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
    this.alignBtns = ALIGNS.map(([a, ic]) => h('button', {
      type: 'button', class: 'led-btn', title: t(`image.align_${a}`), dataset: { align: a },
      onclick: () => this.setAttrs({ align: a, width: a === 'full' ? null : this.node.attrs.width }),
    }, icon(ic, 16)));
    this.bar = h('div', { class: 'led-node-bar' },
      ...this.alignBtns,
      h('span', { class: 'led-bar-sep' }),
      h('button', { type: 'button', class: 'led-btn', title: t('image.alt'), onclick: () => this.editAlt() }, icon('type', 16)),
      h('button', { type: 'button', class: 'led-btn', title: t('image.replace'), onclick: () => this.replace() }, icon('image', 16)),
      h('button', { type: 'button', class: 'led-btn', title: t('image.download'), onclick: () => this.download() }, icon('download', 16)),
      h('button', { type: 'button', class: 'led-btn', title: t('block.delete'), onclick: () => this.remove() }, icon('trash', 16)));
    this.dom = h('figure', { class: 'led-figure', contenteditable: 'false' }, this.bar, this.frame, this.caption);
    this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
    this.paint();
    this.load();
  }

  paint() {
    const a = this.node.attrs;
    this.dom.className = `led-figure align-${a.align || 'center'}${this.dom.classList.contains('sel') ? ' sel' : ''}`;
    this.frame.style.width = a.align === 'full' ? '100%' : (a.width ? `${a.width}%` : '');
    this.img.alt = a.alt || '';
    if (document.activeElement !== this.caption) this.caption.value = a.caption || '';
    this.caption.hidden = !a.caption && !this.dom.classList.contains('sel');
    this.alignBtns.forEach((b) => b.classList.toggle('on', b.dataset.align === (a.align || 'center')));
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

  startResize(e) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const parentW = this.dom.clientWidth || 1;
    const startX = e.clientX;
    const startW = this.frame.getBoundingClientRect().width;
    const right = this.node.attrs.align !== 'right';
    const move = (ev) => {
      const dx = (ev.clientX - startX) * (right ? 1 : -1) * (this.node.attrs.align === 'center' ? 2 : 1);
      const pct = clamp(Math.round(((startW + dx) / parentW) * 100), 10, 100);
      this.frame.style.width = `${pct}%`;
      this.pending = pct;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.pending) this.setAttrs({ width: this.pending, align: this.node.attrs.align === 'full' ? 'center' : this.node.attrs.align });
      this.pending = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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

// Блок-холст: рисунок между абзацами.
//
// Как начинается рисование: пером — сразу, без лишних касаний; мышью и
// пальцем — после щелчка по холсту (иначе прокрутка страницы и выделение
// текста то и дело оставляли бы на холсте случайные линии). Esc или щелчок
// мимо — выйти.
//
// Координаты штрихов — в ширине, при которой холст создан (attrs.width).
// На другой ширине рисунок целиком масштабируется. Холст сам растёт вниз,
// когда рисуешь у нижнего края.
import { h, icon, debounce, downloadBlob } from './util.js';
import { InkSurface, InkToolbar, BACKGROUNDS, strokeBounds, strokesToPng, resolveInkColor, fingerDraws } from './ink.js';
import { menu } from './ui.js';

const GROW_MARGIN = 60;
const GROW_STEP = 240;

export class DrawingView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    this.t = ctx.t;
    this.strokes = (node.attrs.strokes || []).slice();
    this.height = node.attrs.height || 320;
    this.active = false;

    this.canvas = h('canvas', { class: 'led-draw-canvas' });
    this.hint = h('div', { class: 'led-draw-hint' }, this.t('draw.hint'));
    this.area = h('div', { class: 'led-draw-area', tabindex: '0', 'aria-label': this.t('draw.area') }, this.canvas, this.hint);
    this.grip = h('div', { class: 'led-draw-grip', title: this.t('draw.resize') });
    this.toolbar = new InkToolbar(ctx, {
      surface: () => this.surface,
      settings: () => ctx.inkSettings(),
      setSettings: (patch) => { ctx.setInkSettings(patch); this.syncCursor(); this.toolbar.render(); },
      rows: !!ctx.mobile,
      extra: (bar) => this.extraButtons(bar),
    });
    this.toolbar.dom.classList.add('led-draw-bar');
    this.dom = h('div', { class: 'led-drawing', contenteditable: 'false' }, this.toolbar.dom, this.area, this.grip);

    this.save = debounce(() => this.flush(), 300);
    this.surface = new InkSurface({
      canvas: this.canvas,
      input: this.area,
      settings: () => ctx.inkSettings(),
      strokes: () => this.strokes,
      commit: (next) => { this.strokes = next; this.autoGrow(); this.paintHint(); this.save(); },
      toLocal: (p) => { const s = this.scale(); return [p[0] / s, p[1] / s, p[2]]; },
      transform: () => [this.scale(), 0, 0],
      canDraw: (info) => {
        if (!this.view.editable) return false;
        if (info.type === 'pen') { if (!this.active) this.activate(); return true; }
        return this.active;
      },
      onSelection: () => this.toolbar.render(),
    });

    this.area.addEventListener('pointerdown', (e) => {
      if (!this.active && e.pointerType !== 'pen' && this.view.editable) { e.preventDefault(); this.activate(); }
    });
    this.area.addEventListener('keydown', (e) => this.onKey(e));
    this.grip.addEventListener('pointerdown', (e) => this.startResize(e));
    this.onOutside = (e) => {
      if (!this.active || this.dom.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.led-pop, .ctx-menu, .led-sheet-backdrop, #ledmodal-backdrop')) return;
      this.deactivate();
    };
    document.addEventListener('pointerdown', this.onOutside, true);

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.layout()) : null;
    if (this.ro) this.ro.observe(this.dom);
    this.paintBg();
    this.paintHint();
    this.syncCursor();
    requestAnimationFrame(() => this.layout());
  }

  scale() {
    const w = this.area.clientWidth || this.node.attrs.width || 720;
    return w / (this.node.attrs.width || 720);
  }

  layout() {
    const s = this.scale();
    const full = this.dom.classList.contains('full');
    const want = this.height * s;
    this.area.style.height = full ? '' : `${Math.round(want)}px`;
    this.surface.render();
  }

  autoGrow() {
    let maxY = 0;
    for (const st of this.strokes) maxY = Math.max(maxY, strokeBounds(st).y1);
    if (maxY > this.height - GROW_MARGIN) {
      this.height = Math.ceil((maxY + GROW_STEP) / 40) * 40;
      this.layout();
    }
  }

  paintBg() {
    for (const b of BACKGROUNDS) this.area.classList.toggle(`bg-${b}`, (this.node.attrs.bg || 'plain') === b);
  }

  paintHint() {
    this.hint.hidden = this.active || this.strokes.length > 0 || !this.view.editable;
  }

  syncCursor() {
    const s = this.ctx.inkSettings();
    this.area.dataset.tool = s.tool;
    // Пальцы прокручивают, пока холст не открыт или когда палец не рисует
    // (переключатель в панели); иначе касание — штрих, и прокрутку надо
    // выключить.
    this.area.dataset.touch = this.active && fingerDraws(s, this.surface && this.surface.input) ? 'draw' : 'scroll';
  }

  extraButtons(bar) {
    const t = this.t;
    // Панель собирается раньше самого блока — this.dom тогда ещё нет.
    const full = !!this.dom && this.dom.classList.contains('full');
    if (this.ctx.mobile) {
      // Телефон: фон, размер и настройки — в «ещё», чтобы ряд влез.
      const more = h('button', { type: 'button', class: 'led-btn', title: t('more'), 'aria-label': t('more'), onclick: () => this.moreMenu(more, bar) }, icon('more'));
      return [
        more,
        h('button', { type: 'button', class: 'led-btn led-draw-done led-ink-done', title: t('draw.done'), 'aria-label': t('draw.done'), onclick: () => this.deactivate() }, icon('check')),
      ];
    }
    return [
      h('span', { class: 'led-bar-sep' }),
      h('button', { type: 'button', class: 'led-btn', title: t('draw.background'), onclick: (e) => this.bgMenu(e.currentTarget) }, icon('rows')),
      h('button', { type: 'button', class: 'led-btn', title: t(full ? 'draw.exit_full' : 'draw.full'), onclick: () => this.toggleFull() }, icon(full ? 'minimize' : 'maximize')),
      h('button', { type: 'button', class: 'led-btn', title: t('more'), onclick: (e) => this.moreMenu(e.currentTarget) }, icon('more')),
      h('button', { type: 'button', class: 'led-btn led-draw-done', title: t('draw.done'), onclick: () => this.deactivate() }, icon('check')),
    ];
  }

  bgMenu(anchor) {
    menu(this.ctx.root, anchor, BACKGROUNDS.map((b) => ({
      label: this.t(`draw.bg_${b}`), active: (this.node.attrs.bg || 'plain') === b,
      run: () => { this.flush({ bg: b }); this.ctx.setInkSettings({ bg: b }); },
    })));
  }

  moreMenu(anchor, bar) {
    const full = this.dom.classList.contains('full');
    const phone = bar ? [
      { heading: this.t('draw.background') },
      ...BACKGROUNDS.map((b) => ({
        label: this.t(`draw.bg_${b}`), active: (this.node.attrs.bg || 'plain') === b,
        run: () => { this.flush({ bg: b }); this.ctx.setInkSettings({ bg: b }); },
      })),
      'sep',
      { label: this.t(full ? 'draw.exit_full' : 'draw.full'), icon: full ? 'minimize' : 'maximize', run: () => this.toggleFull() },
      { label: this.t('ink.settings'), icon: 'settings', run: () => bar.settingsPanel(anchor) },
    ] : [];
    menu(this.ctx.root, anchor, [
      ...phone,
      { label: this.t('draw.download'), icon: 'download', run: () => this.download() },
      { label: this.t('draw.clear'), icon: 'eraser', run: () => this.surface.clear() },
      'sep',
      { label: this.t('block.delete'), icon: 'trash', danger: true, run: () => this.remove() },
    ]);
  }

  async download() {
    const w = this.node.attrs.width || 720;
    const bg = getComputedStyle(this.area).backgroundColor;
    // Прозрачный фон (альфа 0) — берём цвет бумаги темы.
    const transparent = !bg || bg === 'transparent' || /,\s*0\)$/.test(bg);
    const blob = await strokesToPng(this.strokes, w, this.height, transparent ? resolveInkColor('paper', this.area) : bg);
    if (blob) downloadBlob(blob, 'drawing.png');
  }

  toggleFull() {
    const full = !this.dom.classList.contains('full');
    this.dom.classList.toggle('full', full);
    this.ctx.root.classList.toggle('led-has-full', full);
    if (full) this.activate();
    this.toolbar.render();
    requestAnimationFrame(() => this.layout());
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.dom.classList.add('active');
    this.syncCursor();
    this.paintHint();
    this.toolbar.render();
    this.area.focus({ preventScroll: true });
    this.ctx.onDrawingActive(this, true);
  }

  deactivate() {
    if (!this.active) return;
    if (this.dom.classList.contains('full')) this.toggleFull();
    this.active = false;
    this.surface.selected.clear();
    this.surface.render();
    this.dom.classList.remove('active');
    this.syncCursor();
    this.paintHint();
    this.flush();
    this.ctx.onDrawingActive(this, false);
  }

  onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    // Esc и Ctrl/⌘+Shift+D — назад к тексту (та же клавиша включает пометки).
    if (e.key === 'Escape' || (mod && e.shiftKey && e.key.toLowerCase() === 'd')) { e.preventDefault(); e.stopPropagation(); this.deactivate(); this.view.focus(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) this.surface.redo(); else this.surface.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); this.surface.redo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.surface.selected.size) { e.preventDefault(); e.stopPropagation(); this.surface.deleteSelected(); this.toolbar.render(); return; }
    const keys = { p: 'pen', b: 'pencil', m: 'marker', e: 'eraser', l: 'lasso', s: 'shape' };
    if (!mod && keys[e.key]) { e.preventDefault(); e.stopPropagation(); this.ctx.setInkSettings({ tool: keys[e.key] }); this.syncCursor(); this.toolbar.render(); }
  }

  startResize(e) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = this.height;
    const s = this.scale();
    const move = (ev) => { this.height = Math.max(120, Math.round(h0 + (ev.clientY - y0) / s)); this.layout(); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.flush();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Записать штрихи и высоту в документ. */
  flush(extra) {
    this.save.cancel();
    const pos = this.getPos();
    if (pos == null) return;
    // Блок уже удалён (destroy после удаления зовёт flush): по старому
    // месту лежит другое, и setNodeMarkup падал «No node at given
    // position» посреди удаления.
    if (this.view.state.doc.nodeAt(pos) !== this.node) return;
    const attrs = Object.assign({}, this.node.attrs, { strokes: this.strokes, height: this.height }, extra || {});
    const same = attrs.strokes === this.node.attrs.strokes && attrs.height === this.node.attrs.height && attrs.bg === this.node.attrs.bg;
    if (same) return;
    this.saving = true;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, attrs));
    this.saving = false;
  }

  remove() {
    this.deactivate();
    const pos = this.getPos();
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    const prev = this.node;
    this.node = node;
    // Пришло снаружи (отмена в тексте, синхронизация) — берём новое.
    if (!this.saving && node.attrs.strokes !== prev.attrs.strokes) this.strokes = (node.attrs.strokes || []).slice();
    if (!this.saving) this.height = node.attrs.height || 320;
    this.paintBg();
    this.paintHint();
    this.layout();
    return true;
  }

  selectNode() { this.dom.classList.add('sel'); }

  deselectNode() { this.dom.classList.remove('sel'); }

  stopEvent() { return true; }

  ignoreMutation() { return true; }

  destroy() {
    this.flush();
    this.surface.destroy();
    document.removeEventListener('pointerdown', this.onOutside, true);
    if (this.ro) this.ro.disconnect();
    if (this.active) this.ctx.onDrawingActive(this, false);
  }
}

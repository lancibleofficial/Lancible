// Пометки от руки поверх текста — как ручкой по распечатке.
//
// Штрих держится за блок, рядом с которым начат (attrs.bid абзаца,
// заголовка, таблицы…): y — от верха этого блока, x — от левого края полосы
// текста. Дописали абзац выше — пометка уехала вниз вместе со своим
// абзацем. Блок удалили — штрих остаётся там, где был (ay — верх блока в
// момент рисования).
//
// Холст размером с видимую часть, а не со весь документ: у холста высотой в
// двадцать экранов кончается память. Он лежит поверх прокрутки и
// перерисовывается при прокрутке.
import { h, icon } from './util.js';
import { menu, modal } from './ui.js';
import { InkSurface, InkToolbar } from './ink.js';

export class InkOverlay {
  /** ctx: { root, t, toast, inkSettings, setInkSettings, getInk(), setInk(list),
   *  scroller, page, view, mobile, hidden(), hide(), undo(), redo() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.canvas = h('canvas', { class: 'led-overlay-canvas' });
    this.dom = h('div', { class: 'led-overlay' }, this.canvas);
    this.offsets = new Map();
    this.cache = new WeakMap();
    this.toolbar = new InkToolbar(ctx, {
      surface: () => this.surface,
      settings: () => ctx.inkSettings(),
      setSettings: (patch) => { ctx.setInkSettings(patch); this.dom.dataset.tool = ctx.inkSettings().tool; this.toolbar.render(); },
      above: !ctx.mobile,
      rows: !!ctx.mobile,
      extra: (bar) => this.extraButtons(bar),
    });
    this.toolbar.dom.classList.add('led-overlay-bar');
    this.toolbar.dom.hidden = true;

    this.surface = new InkSurface({
      canvas: this.canvas,
      input: this.dom,
      settings: () => ctx.inkSettings(),
      // Поверхность работает в координатах страницы: ластик и лассо видят
      // штрихи там, где они нарисованы сейчас.
      strokes: () => this.placed(),
      commit: (next, opts) => this.commit(next, opts),
      toLocal: (p) => this.toPage(p),
      transform: () => [1, this.pageLeft(), -this.ctx.scroller.scrollTop + this.pageTopInScroller()],
      canDraw: () => this.on && (this.ctx.canEdit ? this.ctx.canEdit() : this.ctx.view.editable),
      // Отмена — общая с текстом: штрих лежит шагом в истории документа.
      history: { undo: () => this.ctx.undo(), redo: () => this.ctx.redo() },
      onSelection: () => this.toolbar.render(),
    });

    // Колесо и пальцы над холстом всё равно прокручивают текст.
    this.dom.addEventListener('wheel', (e) => { ctx.scroller.scrollBy({ top: e.deltaY, left: e.deltaX }); }, { passive: true });
    this.pan = null;
    this.dom.addEventListener('pointerdown', (e) => {
      if (!this.on || e.pointerType !== 'touch' || this.surface.input.pointer) return;
      this.pan = { id: e.pointerId, y: e.clientY, top: ctx.scroller.scrollTop };
    });
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.pan || e.pointerId !== this.pan.id) return;
      ctx.scroller.scrollTop = this.pan.top - (e.clientY - this.pan.y);
    });
    const endPan = (e) => { if (this.pan && e.pointerId === this.pan.id) this.pan = null; };
    this.dom.addEventListener('pointerup', endPan);
    this.dom.addEventListener('pointercancel', endPan);

    this.onScroll = () => this.render();
    ctx.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { this.measure(); this.render(); }) : null;
    if (this.ro) { this.ro.observe(ctx.scroller); this.ro.observe(ctx.page); }
    this.onKey = (e) => {
      if (!this.on) return;
      const mod = e.metaKey || e.ctrlKey;
      // Escape при открытом меню или окне закрывает их, а не режим пометок.
      if (e.key === 'Escape') { if (!document.querySelector('.led-pop, #ledmodal-backdrop, .led-sheet-backdrop')) { e.preventDefault(); ctx.setAnnotate(false); } }
      // Ctrl/⌘+Shift+D — назад к тексту, курсор туда, где был.
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); ctx.setAnnotate(false); ctx.view.focus(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) this.surface.redo(); else this.surface.undo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.surface.selected.size) { e.preventDefault(); this.surface.deleteSelected(); this.toolbar.render(); }
    };
    document.addEventListener('keydown', this.onKey, true);
  }

  strokes() { return this.ctx.getInk(); }

  /** Кнопки слоя в панели пера: скрыть пометки, стереть все, «Готово».
   *  На телефоне первые две и настройки — в меню «ещё», чтобы ряд влез. */
  extraButtons(bar) {
    const { t } = this.ctx;
    if (this.ctx.mobile) {
      const more = h('button', {
        type: 'button', class: 'led-btn', title: t('more'), 'aria-label': t('more'),
        onclick: () => menu(this.ctx.root, more, [
          { label: t('ink.hide'), icon: 'eyeOff', run: () => this.ctx.hide() },
          { label: t('ink.clear_all'), icon: 'eraser', danger: true, run: () => this.confirmClear() },
          'sep',
          { label: t('ink.settings'), icon: 'settings', run: () => bar.settingsPanel(more) },
        ]),
      }, icon('more'));
      return [
        more,
        h('button', { type: 'button', class: 'led-btn led-ink-done', title: t('draw.done'), 'aria-label': t('draw.done'), onclick: () => this.ctx.setAnnotate(false) }, icon('check')),
      ];
    }
    return [
      h('span', { class: 'led-bar-sep' }),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.hide'), onclick: () => this.ctx.hide() }, icon('eyeOff')),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.clear_all'), onclick: () => this.confirmClear() }, icon('eraser')),
      h('button', { type: 'button', class: 'btn-soft led-overlay-done', onclick: () => this.ctx.setAnnotate(false) }, t('draw.done')),
    ];
  }

  /** Стереть все пометки — с вопросом: одним касанием терять всё нельзя.
   *  Стёртое возвращается отменой, пока заметка открыта. */
  confirmClear() {
    const { t } = this.ctx;
    if (!this.strokes().length) { this.ctx.toast(t('ink.nothing_to_clear')); return; }
    modal(this.ctx.root, t('ink.clear_title'), h('p', { class: 'confirm-text' }, t('ink.clear_body')), [
      { label: t('common.cancel'), run: (close) => close() },
      { label: t('ink.clear_do'), danger: true, primary: true, run: (close) => { this.surface.clear(); this.toolbar.render(); close(); } },
    ]);
  }

  /** Штрихи в координатах страницы → обратно к своим блокам. Нетронутый
   *  штрих остаётся прежним объектом; новый или изменённый — заново
   *  привязывается к блоку под своим началом. */
  commit(next, opts) {
    this.measure();
    this.ctx.setInk(next.map((st) => {
      const cached = st._src && this.cache.get(st._src);
      if (cached && cached.placed === st) return st._src;
      const clean = Object.assign({}, st);
      delete clean._src;
      return this.anchor(clean);
    }), opts);
    this.render();
  }

  pageLeft() { return this.ctx.page.offsetLeft - this.ctx.scroller.scrollLeft + this.contentLeft(); }

  contentLeft() {
    const pm = this.ctx.view.dom;
    return pm.offsetLeft;
  }

  pageTopInScroller() { return this.ctx.page.offsetTop + this.ctx.view.dom.offsetTop; }

  /** Точка холста → координаты страницы (от левого верхнего угла текста). */
  toPage(p) {
    return [p[0] - this.pageLeft(), p[1] + this.ctx.scroller.scrollTop - this.pageTopInScroller(), p[2]];
  }

  /** Верх каждого блока по bid — от верха текста. */
  measure() {
    this.offsets.clear();
    const pm = this.ctx.view.dom;
    for (const el of pm.querySelectorAll(':scope > [data-bid]')) this.offsets.set(el.getAttribute('data-bid'), el.offsetTop);
  }

  /** Привязать штрих (в координатах страницы) к блоку, чья верхняя граница
   *  ближе всего сверху к началу штриха. */
  anchor(st) {
    const first = this.firstPoint(st);
    let best = ''; let bestTop = 0;
    for (const [bid, top] of this.offsets) if (top <= first[1] && top >= bestTop) { best = bid; bestTop = top; }
    return Object.assign({}, st, { pts: shiftPts(st.pts, 0, -bestTop), anchor: best, ay: bestTop });
  }

  firstPoint(st) {
    const raw = String(st.pts || '').split(';')[0].split(',');
    return [(parseInt(raw[0], 36) || 0) / 10, (parseInt(raw[1], 36) || 0) / 10];
  }

  /** Штрихи с текущим положением их блоков — для отрисовки и для ластика. */
  placed() {
    const list = this.strokes();
    return list.map((st) => {
      const top = this.offsets.has(st.anchor) ? this.offsets.get(st.anchor) : (st.ay || 0);
      // Кэш — в WeakMap, а не полем на штрихе: штрих уходит в данные и в
      // JSON, и ссылка на свою копию сделала бы его кольцевым.
      const c = this.cache.get(st);
      if (c && c.top === top) return c.placed;
      const placed = Object.assign({}, st, { pts: shiftPts(st.pts, 0, top), _src: st });
      this.cache.set(st, { top, placed });
      return placed;
    });
  }

  setOn(on) {
    this.on = on;
    this.dom.classList.toggle('on', on);
    this.dom.dataset.tool = this.ctx.inkSettings().tool;
    this.toolbar.dom.hidden = !on;
    if (!on) { this.surface.selected.clear(); this.surface.cancel(); }
    this.toolbar.render();
    this.measure();
    this.render();
  }

  render() {
    if (!this.dom.isConnected) return;
    // Холст — ровно по видимой части прокрутки.
    const sc = this.ctx.scroller;
    this.dom.style.top = `${sc.offsetTop}px`;
    this.dom.style.height = `${sc.clientHeight}px`;
    this.dom.style.width = `${sc.clientWidth}px`;
    this.dom.style.left = `${sc.offsetLeft}px`;
    // Скрытые пометки не рисуются, пока слой не открыт для рисования.
    if (!this.on && (!this.strokes().length || this.ctx.hidden())) {
      const c = this.canvas.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.measure();
    this.surface.render();
  }

  destroy() {
    this.ctx.scroller.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('keydown', this.onKey, true);
    if (this.ro) this.ro.disconnect();
    this.surface.destroy();
  }
}

/** Сдвиг упакованных точек: меняется только первая точка — дальше разности. */
function shiftPts(pts, dx, dy) {
  if (!pts) return pts;
  const i = pts.indexOf(';');
  const head = i < 0 ? pts : pts.slice(0, i);
  const rest = i < 0 ? '' : pts.slice(i);
  const [x, y, p] = head.split(',');
  const nx = (parseInt(x, 36) || 0) + Math.round(dx * 10);
  const ny = (parseInt(y, 36) || 0) + Math.round(dy * 10);
  return `${nx.toString(36)},${ny.toString(36)},${p}${rest}`;
}

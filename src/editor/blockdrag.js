// Перенос блока за ручку пальцем — картинка на телефоне (17 октября 2026,
// жалоба «двигать картинки в редакторе на телефоне очень неудобно»).
//
// Ручки блока слева на телефоне нет (.led-mobile .led-handle), а нативного
// перетаскивания ProseMirror в WebView нет вовсе. Поэтому у выделенной
// картинки своя ручка (image.js, .led-img-grip): долгое нажатие (press.js,
// 350 мс) — и блок едет за пальцем призраком (.led-drag-ghost), черта
// (.led-dropline) показывает промежуток между блоками верхнего уровня, куда
// он встанет, у края окна текст прокручивается сам. Отпустили — перенос
// одной транзакцией (commands.js: moveBlockTo), одна отмена.
//
// Высота по тексту (autoHeight, страница задачи телефона): WebView во всю
// высоту текста и сам не прокручивается — прокручивает внешний ScrollView
// хозяина. Тогда на каждом кадре у края уходит { type: 'autoscroll', dy }
// (host.js, протокол 3), а край — край видимой части WebView, которую
// хозяин сообщает сообщением viewport (без него — край самого WebView).
// Пока палец стоит, а текст под ним едет, точка под пальцем сдвигается на
// тот же dy — так черта места вставки идёт вместе с текстом.
//
// Бросок — в последнюю показанную точку (там стоит черта), а не в
// координаты события отпускания. Жест прерван (pointercancel, смена
// документа, уход фокуса — press.js: onCancel) — блок остаётся на месте,
// без транзакции (19 октября 2026).
import { h } from './util.js';
import { moveBlockTo, topBlock } from './commands.js';
import { press } from './press.js';

/** Зона у края окна, где текст прокручивается сам, и наибольший шаг за кадр. */
export const EDGE_PX = 56;
export const SCROLL_MAX = 18;

/** Шаг автопрокрутки: у самого края — SCROLL_MAX, у границы зоны — 0;
 *  вверх — со знаком минус. top, bottom — края видимой области. */
export function autoScrollStep(y, top, bottom) {
  if (y < top + EDGE_PX) return -Math.ceil(SCROLL_MAX * Math.min(1, (top + EDGE_PX - y) / EDGE_PX));
  if (y > bottom - EDGE_PX) return Math.ceil(SCROLL_MAX * Math.min(1, (y - (bottom - EDGE_PX)) / EDGE_PX));
  return 0;
}

/** Промежуток между блоками верхнего уровня под точкой y (clientY):
 *  { pos — позиция в документе, y — где провести черту }. Выше середины
 *  блока — промежуток перед ним, ниже последнего — в конце. */
export function dropGap(view, y) {
  const { doc } = view.state;
  let prevBottom = null;
  let found = null;
  doc.forEach((node, offset) => {
    if (found) return;
    const dom = view.nodeDOM(offset);
    if (!dom || !dom.getBoundingClientRect) return;
    const r = dom.getBoundingClientRect();
    if (y < r.top + r.height / 2) found = { pos: offset, y: prevBottom == null ? r.top - 4 : (prevBottom + r.top) / 2 };
    prevBottom = r.bottom;
  });
  return found || { pos: doc.content.size, y: (prevBottom == null ? view.dom.getBoundingClientRect().top : prevBottom) + 4 };
}

/** Что прокручивать: своя прокрутка редактора, если она есть, иначе окно
 *  (высота по тексту — тогда прокручивает хозяин, и окно стоит). */
function scrollTarget(scroller) {
  if (scroller && scroller.scrollHeight > scroller.clientHeight + 1 && getComputedStyle(scroller).overflowY !== 'visible') return scroller;
  return document.scrollingElement || document.documentElement;
}

/** Начать перенос с pointerdown e на ручке grip. ctx: { view, root, pageWrap,
 *  scroller, hostScroll, viewport, gesture }; getPos — позиция узла; source —
 *  что показать призраком; onTap — касание без переноса. Возвращает отмену. */
export function startBlockDrag(ctx, getPos, e, grip, source, onTap) {
  const { view } = ctx;
  let ghost = null;
  let line = null;
  let raf = 0;
  let last = { x: e.clientX, y: e.clientY };
  let gap = null;
  const from = () => { const p = getPos(); const b = p == null ? null : topBlock(view.state, p); return b; };

  const paint = () => {
    if (!ghost) return;
    ghost.style.left = `${Math.round(last.x - ghost.offsetWidth / 2)}px`;
    ghost.style.top = `${Math.round(last.y - ghost.offsetHeight / 2)}px`;
    gap = dropGap(view, last.y);
    const b = from();
    const same = !b || gap.pos === b.pos || gap.pos === b.pos + b.node.nodeSize;
    line.hidden = same;
    if (!same) {
      const host = ctx.pageWrap.getBoundingClientRect();
      const pm = view.dom.getBoundingClientRect();
      line.style.top = `${Math.round(gap.y - host.top - 1)}px`;
      line.style.left = `${Math.round(pm.left - host.left)}px`;
      line.style.width = `${Math.round(pm.width)}px`;
    }
  };
  let seen;
  let slice = null;
  const tickHost = () => {
    const vp = ctx.viewport ? ctx.viewport() : null;
    if (vp !== seen || !slice) { seen = vp; slice = vp ? { top: vp.top, height: vp.height } : { top: 0, height: window.innerHeight }; }
    const docH = Math.max(document.documentElement.scrollHeight, slice.top + slice.height);
    let step = autoScrollStep(last.y, slice.top, slice.top + slice.height);
    step = Math.max(-slice.top, Math.min(docH - slice.height - slice.top, step));
    if (!step) return;
    ctx.hostScroll(step);
    slice.top += step;
    last = { x: last.x, y: last.y + step };
    paint();
    raf = requestAnimationFrame(tick);
  };
  const tick = () => {
    raf = 0;
    if (!ghost) return;
    if (ctx.hostScroll) { tickHost(); return; }
    const target = scrollTarget(ctx.scroller);
    const win = target === document.scrollingElement || target === document.documentElement;
    const r = win ? { top: 0, bottom: window.innerHeight } : target.getBoundingClientRect();
    const step = autoScrollStep(last.y, Math.max(0, r.top), Math.min(window.innerHeight, r.bottom));
    if (step) {
      const before = target.scrollTop;
      target.scrollTop += step;
      if (target.scrollTop !== before) paint();
      raf = requestAnimationFrame(tick);
    }
  };
  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ghost) ghost.remove();
    if (line) line.remove();
    ghost = null;
    line = null;
    grip.classList.remove('on');
    ctx.root.classList.remove('led-block-dragging');
  };

  return press(e, {
    onArm: () => grip.classList.add('on'),
    onStart: () => {
      const r = source.getBoundingClientRect();
      const w = Math.min(r.width, 160);
      ghost = h('div', { class: 'led-drag-ghost', 'aria-hidden': 'true' }, source.cloneNode(true));
      ghost.style.width = `${Math.round(w)}px`;
      line = h('div', { class: 'led-dropline', hidden: true });
      ctx.root.append(ghost);
      ctx.pageWrap.append(line);
      ctx.root.classList.add('led-block-dragging');
      grip.classList.add('on');
      paint();
    },
    onMove: (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      paint();
      if (!raf) raf = requestAnimationFrame(tick);
    },
    onEnd: (ev, moved) => {
      if (moved && ghost) {
        paint();
        const b = from();
        if (b && gap) moveBlockTo(b.pos, gap.pos)(view.state, view.dispatch);
      }
      cleanup();
    },
    onCancel: cleanup,
    onTap: (ev) => { cleanup(); if (onTap) onTap(ev); },
    gesture: ctx.gesture,
  }, grip);
}

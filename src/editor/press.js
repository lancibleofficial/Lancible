// Нажатие и перетаскивание — мышью и пальцем одинаково (17 октября 2026).
//
// Мышь: нажали и повели дальше чем на MOUSE_SLOP — перетаскивание сразу.
// Палец: перетаскивание начинается только долгим нажатием (LONG_PRESS_MS):
// иначе любое движение пальцем по странице PDF или по картинке стало бы
// перетаскиванием, а не прокруткой. Сдвинулся раньше времени дальше чем на
// TOUCH_SLOP — это прокрутка, жест отдаём браузеру. Короткое касание без
// движения — onTap (выделить).
//
// Прокрутку после долгого нажатия гасит touchmove с preventDefault. Слушатель
// для этого вешается на сам элемент заранее (bindTouchGuard) и не пассивным:
// Chrome решает, ждать ли страницу, ещё на касании, и слушатель, повешенный
// потом, прокрутку уже не остановил бы.
//
// Хозяин (телефон, протокол 3). Внутри WebView этого мало: на Android
// внешний ScrollView страницы задачи забирает движение пальца после долгого
// нажатия, и в WebView приходит touchcancel. Поэтому жест, в котором палец
// может тащить (onStart или onMove), сообщает h.gesture(true), как только
// перетаскивание включилось — долгим нажатием, а у ручек (immediate) —
// сразу, — и h.gesture(false), когда он кончился чем угодно: отпустили,
// отмена браузера, отмена из кода (cancelPresses: смена документа, уход
// фокуса, закрытие редактора). На каждое true — ровно одно false.
//
// Долгое нажатие и системный перенос. Android WebView, если палец держат
// дольше ~500 мс, сам начинает HTML-перенос (dragstart) того, что под
// пальцем, и шлёт contextmenu, а следом pointercancel — наш перенос
// обрывался (замер на эмуляторе 17 октября 2026). Поэтому, пока палец
// держит жест, который может тащить, на документе висят захватывающие
// слушатели dragstart и contextmenu с preventDefault; снимаются с концом
// жеста. Мышь их не ставит: перенос блоков мышью — нативный перенос
// ProseMirror, а правая кнопка — меню редактора (contextmenu.js).
//
// Отмена браузера (pointercancel) — отмена жеста, а не бросок (19 октября
// 2026): палец увёл системный жест, внешний ScrollView, шторка, второй
// палец — перенос не довершается, зовётся onCancel. Координаты у такого
// события в Chromium нулевые: бросок по ним ронял картинку в начало
// документа.
//
// Тащить нечего (только onTap: фон страницы PDF, «Заменить текст») —
// долгое нажатие ничего не включает: прокрутку не гасим, палец поехал — это
// прокрутка, отпустили на месте — onTap.

export const LONG_PRESS_MS = 350;
export const TOUCH_SLOP = 8;
export const MOUSE_SLOP = 3;

const guards = new WeakMap();
/** Жесты, которые идут сейчас: их отмены — для cancelPresses. */
const running = new Set();

/** Повесить на элемент гаситель прокрутки: пока на нём идёт перетаскивание,
 *  палец не прокручивает страницу. Один раз на элемент. */
export function bindTouchGuard(el) {
  if (guards.has(el)) return;
  guards.set(el, { on: false });
  el.addEventListener('touchmove', (e) => { if (guards.get(el).on && e.cancelable) e.preventDefault(); }, { passive: false });
}

/** Прервать все идущие жесты (смена документа, уход фокуса, закрытие
 *  редактора): каждый закончится через onCancel или onEnd и gesture(false). */
export function cancelPresses() {
  for (const stop of [...running]) stop();
}

/** Начать жест с pointerdown e. h: { onStart(ev) — перетаскивание пошло,
 *  onMove(ev, dx, dy), onEnd(ev, moved) — отпустили, onTap(ev), onArm() —
 *  палец удержан (только если есть что тащить), onCancel() — жест прерван
 *  (прокрутка, pointercancel, cancelPresses), immediate — без ожидания и для
 *  пальца (ручки рамки),
 *  gesture(on) — хозяину: перетаскивание пальцем включилось (true) и
 *  кончилось (false) }. guard — элемент с bindTouchGuard. Возвращает отмену. */
export function press(e, h, guard) {
  const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
  const x0 = e.clientX;
  const y0 = e.clientY;
  const id = e.pointerId;
  let armed = !touch || !!h.immediate;
  let dragging = false;
  let finished = false;
  let timer = null;
  let gestureOn = false;
  const g = guard ? guards.get(guard) : null;
  const canDrag = !!(h.onStart || h.onMove);
  // Системный перенос и меню долгого касания — не во время нашего жеста.
  const block = (ev) => { if (ev.cancelable) ev.preventDefault(); };
  const blocking = touch && canDrag;
  if (blocking) {
    document.addEventListener('dragstart', block, true);
    document.addEventListener('contextmenu', block, true);
  }
  const gesture = (on) => {
    if (!touch || !canDrag || !h.gesture || on === gestureOn) return;
    gestureOn = on;
    try { h.gesture(on); } catch { /* хозяина нет — сообщать некому */ }
  };
  const done = () => {
    finished = true;
    clearTimeout(timer);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    running.delete(stop);
    if (g) g.on = false;
    if (blocking) {
      document.removeEventListener('dragstart', block, true);
      document.removeEventListener('contextmenu', block, true);
    }
    gesture(false);
  };
  const start = (ev) => {
    dragging = true;
    if (g) g.on = true;
    if (h.onStart) h.onStart(ev);
  };
  const move = (ev) => {
    if (ev.pointerId !== id) return;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!armed || !canDrag) {
      // Палец поехал раньше времени (или тащить нечего) — это прокрутка.
      if (Math.hypot(dx, dy) > (touch ? TOUCH_SLOP : MOUSE_SLOP)) { done(); if (h.onCancel) h.onCancel(); }
      return;
    }
    if (!dragging) {
      if (!touch && !h.immediate && Math.hypot(dx, dy) < MOUSE_SLOP) return;
      start(ev);
    }
    ev.preventDefault();
    if (h.onMove) h.onMove(ev, dx, dy);
  };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    // Не повели — касание (и долгое без движения): выделить.
    if (dragging) { if (h.onEnd) h.onEnd(ev, true); } else if (h.onTap) h.onTap(ev);
  };
  // Отмена браузера — жест не довершается: ни броска, ни касания.
  const cancel = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    if (h.onCancel) h.onCancel();
  };
  const stop = () => {
    if (finished) return;
    done();
    if (h.onCancel) h.onCancel();
  };
  if (touch && !armed && canDrag) {
    timer = setTimeout(() => {
      armed = true;
      if (g) g.on = true;
      gesture(true);
      if (h.onArm) h.onArm();
    }, LONG_PRESS_MS);
  } else if (touch && armed) gesture(true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  running.add(stop);
  return stop;
}

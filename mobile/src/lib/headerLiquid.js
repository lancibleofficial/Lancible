// Жидкое движение шапки — числа и формы (карта — DESIGN.md, «Телефон» →
// «Жидкое движение» → «Шапка»). Чистые функции — ворклеты, как в
// lib/liquid.js: их зовут стили Reanimated на UI-потоке, а тесты — как обычные.
// Отрисовка — components/HeaderLiquid.js.
//
// Шапка на Android и iOS ниже 26. На iOS 26+ она нативная, и систему
// анимировать поверх не нужно (liquidAllowed).
import { isValidElement } from 'react';
import { Easing } from 'react-native-reanimated';
import { DROP, liquidMorph } from './liquid';

/** Время и пружины шапки — короткие: ничто в ней не задерживает переход. */
export const HEADER_LIQUID = {
  // Нажатие: кнопка сплющивается, пока палец на ней.
  squash: { duration: 70, easing: Easing.out(Easing.cubic) },
  // Отпустили: одна пружина с толчком — подскок и возврат в ней же (правило
  // lib/liquid.js: одна пружина на одно движение). ζ = 0.5, к ~0,2 с стоит.
  release: { damping: 20, stiffness: 800, mass: 0.5 },
  // Название новой вкладки проявляется каплей.
  title: { duration: 200, easing: Easing.out(Easing.cubic) },
  // Кнопка уходит: быстрее плашки таймера (LIQUID.drain, 380 мс) — старые и
  // новые кнопки вкладки не должны долго стоять в шапке вместе.
  drain: { duration: 240, easing: Easing.out(Easing.cubic) },
};

/** Сплющенная кнопка под пальцем: чуть шире и ниже — капля, севшая на стол. */
export const PRESS_SQUASH = { x: 1.07, y: 0.9 };
/** Скорость толчка при отпускании: подскок до ~3 % в обратную сторону. */
export const PRESS_KICK = 4;

function clamp01(v) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Название вкладки проявляется каплей: плоское и узкое набухает до своей
 * формы, непрозрачность набирает первую половину пути.
 * @param q время 0 → 1
 * @returns {o, sx, sy} непрозрачность и масштаб по осям
 */
export function dropIn(q) {
  'worklet';
  const c = clamp01(q);
  return { o: clamp01(c / 0.5), sx: 0.86 + 0.14 * c, sy: 0.7 + 0.3 * c };
}

/**
 * Кнопка шапки между каплей и собой. Форма — та же `liquidMorph`, что у
 * плашки таймера: до DROP круглая капля набухает, дальше кнопка чуть
 * сплющивается и садится (на перехлёсте пружины p > 1 — отыгрывает назад).
 * Сама кнопка уже подложка, поэтому плашки отдельно нет: вся кнопка и есть
 * капля — масштабируется от центра.
 * @param p   0…1 (и чуть больше на перехлёсте) из пресенса
 * @param w   ширина кнопки; h — высота (меряет её слот)
 * @param gap зазор между кнопками: пока капля меньше своей высоты, зазор
 *            подбирается вместе с ней — соседи не прыгают
 * @returns {slotW, mr, dx, sx, sy, o} ширина места, отступ справа, сдвиг к
 *          центру места, масштаб по осям, непрозрачность
 */
export function buttonDrop(p, w, h, gap) {
  'worklet';
  const m = liquidMorph(p, w, h, h / 2);
  const slotW = Math.min(m.w, w);
  return {
    slotW,
    mr: -gap * (1 - Math.min(1, h > 0 ? m.w / h : 1)),
    dx: (slotW - w) / 2,
    sx: w > 0 ? m.w / w : 0,
    sy: h > 0 ? m.h / h : 0,
    o: p >= DROP ? 1 : p <= 0 ? 0 : p / DROP,
  };
}

/** Чем кнопка «та же самая» на соседних вкладках: тип, значок, подпись. */
export function slotSig(el) {
  const p = (isValidElement(el) && el.props) || {};
  return { type: el && el.type, icon: p.icon, label: p.label, a11y: p.accessibilityLabel, testID: p.testID };
}

const sameSig = (a, b) => a.type === b.type && a.icon === b.icon && a.label === b.label && a.a11y === b.a11y && a.testID === b.testID;

/**
 * Места кнопок в шапке при новом наборе. Место — {id, el, sig, visible,
 * entering}: id живёт, пока кнопка стоит (по нему React не пересоздаёт её,
 * колокольчик не теряет звон), visible=false — стекает в каплю, entering —
 * ещё должна набухнуть из капли.
 *
 * Внутри одной вкладки кнопки считаются по порядку: у кнопки «вид» сменился
 * значок — это та же кнопка. При смене вкладки (switched) «та же» — по типу,
 * значку и подписи: лупа и колокольчик «Задач» остаются на месте от «Проектов»,
 * остальные уходят и приходят.
 * @param prev     прежние места (в порядке показа, вместе со стекающими)
 * @param next     новый набор: [{el, sig}]
 * @param switched сменилась ли вкладка
 * @param makeId   () → новый id
 */
export function reconcileSlots(prev, next, switched, makeId) {
  const live = prev.filter((s) => s.visible);
  const taken = new Map(); // индекс в next → место, которое остаётся
  if (!switched) {
    next.forEach((n, i) => { if (live[i]) taken.set(i, live[i]); });
  } else {
    let from = 0;
    next.forEach((n, i) => {
      for (let k = from; k < live.length; k += 1) {
        if (sameSig(live[k].sig, n.sig)) { taken.set(i, live[k]); from = k + 1; break; }
      }
    });
  }
  const used = new Set([...taken.values()].map((s) => s.id));
  const out = next.map((n, i) => {
    const s = taken.get(i);
    return s ? { ...s, el: n.el, sig: n.sig, entering: false } : { id: makeId(), el: n.el, sig: n.sig, visible: true, entering: true };
  });
  // Уходящие встают туда, где стояли: рядом со своими соседями.
  prev.forEach((s, at) => {
    if (used.has(s.id)) return;
    out.splice(Math.min(at, out.length), 0, s.visible ? { ...s, visible: false, entering: false } : s);
  });
  return out;
}

// Появление строк чата (вкладка «Чат-бот», 18 октября 2026). Числа и формы —
// здесь, одни на всю ленту; рисует ими components/chat/ChatRow.js.
//
// - Сообщение человека въезжает справа снизу — оттуда, где поле ввода и
//   кнопка «Отправить»: сдвиг, лёгкое уменьшение и прозрачность, ease out.
// - Ответ агента — слева, короче: он рождается на месте трёх точек.
// - Карточка предложения поднимается снизу с лёгким масштабом, пружиной
//   с маленьким перехлёстом (LIQUID.swell, та же, что набухание капли).
// - Шаги инструментов, отказ и ошибка — тихо проявляются.
//
// Это entering у Animated.View строки: играет один раз, когда строка
// появилась. История при открытии, строки, уже стоявшие на экране, и
// «уменьшение движения» — без него (решает ChatRow). Текст по мере прихода
// не анимируется вовсе: растёт сама строка, а лента не двигает её соседей
// (layout-анимаций нет) — так ничего не дёргается.
import { Easing, withTiming, withSpring } from 'react-native-reanimated';
import { LIQUID } from '../../lib/liquid';

/** Ход сообщений: ease out, 0,28 с. */
export const CHAT_IN = { duration: 280, easing: Easing.out(Easing.cubic) };
/** Тихое проявление шагов и ошибок. */
export const CHAT_FADE = { duration: 200, easing: Easing.out(Easing.cubic) };
/** Подъём карточки — пружина с перехлёстом ~5 %. */
export const CARD_SPRING = LIQUID.swell;

/** Откуда въезжает строка: сдвиг по x и y и масштаб в начале. */
export const MINE_FROM = { x: 28, y: 16, scale: 0.94 };
export const REPLY_FROM = { x: -18, y: 8, scale: 0.98 };
export const CARD_FROM = { y: 22, scale: 0.94 };

/** Сообщение человека: справа снизу. */
export function mineIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateX: MINE_FROM.x }, { translateY: MINE_FROM.y }, { scale: MINE_FROM.scale }] },
    animations: {
      opacity: withTiming(1, CHAT_IN),
      transform: [{ translateX: withTiming(0, CHAT_IN) }, { translateY: withTiming(0, CHAT_IN) }, { scale: withTiming(1, CHAT_IN) }],
    },
  };
}

/** Ответ агента: слева. */
export function replyIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateX: REPLY_FROM.x }, { translateY: REPLY_FROM.y }, { scale: REPLY_FROM.scale }] },
    animations: {
      opacity: withTiming(1, CHAT_IN),
      transform: [{ translateX: withTiming(0, CHAT_IN) }, { translateY: withTiming(0, CHAT_IN) }, { scale: withTiming(1, CHAT_IN) }],
    },
  };
}

/** Карточка предложения: подъём с лёгким масштабом. */
export function cardIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: CARD_FROM.y }, { scale: CARD_FROM.scale }] },
    animations: {
      opacity: withTiming(1, CHAT_FADE),
      transform: [{ translateY: withSpring(0, CARD_SPRING) }, { scale: withSpring(1, CARD_SPRING) }],
    },
  };
}

/** Шаг инструмента, отказ, ошибка: проявление на месте. */
export function quietIn() {
  'worklet';
  return {
    initialValues: { opacity: 0 },
    animations: { opacity: withTiming(1, CHAT_FADE) },
  };
}

/** Сценка над полем главного экрана (круг 21): лёгкий вдох при появлении —
 *  чуть меньше и ниже, пружиной на место с маленьким перехлёстом
 *  (LIQUID.swell). Прозрачности нет: сценка не проявляется из нуля. */
export const ART_BREATH = { scale: 0.92, y: 6 };
export const ART_SPRING = LIQUID.swell;

/** Отправка с поля главного экрана — экран чата проявляется на месте, без
 *  хода стека: fade 150 мс (столько же длится системный fade на Android,
 *  rns_fade_in). Поле чата встаёт туда, где было поле главного, и едет к
 *  низу экрана. */
export const HANDOFF_FADE_MS = 150;
export const FIELD_MOVE = { duration: 340, easing: Easing.out(Easing.cubic) };

/** Сдвиг поля на ходу: от верха поля главного экрана (from) к своему месту
 *  (at, верх в окне сейчас — его двигает и клавиатура), p — доля хода 0…1. */
export function fieldShift(from, at, p) {
  'worklet';
  const k = Math.min(1, Math.max(0, p));
  return k >= 1 ? 0 : (from - at) * (1 - k);
}

/** Три точки «думает»: волна. Период и запаздывание соседней точки, мс. */
export const DOTS = { period: 1100, lag: 170, rise: 4 };

/** Положение точки i в волне: 0 — покой, 1 — вершина. t — доля периода
 *  (0…1), точка подпрыгивает в первые 40 % своего периода и стоит остальное
 *  время — так волна бежит слева направо и делает паузу. */
export function dotLift(t, i) {
  'worklet';
  const p = (((t - (i * DOTS.lag) / DOTS.period) % 1) + 1) % 1;
  return p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0;
}

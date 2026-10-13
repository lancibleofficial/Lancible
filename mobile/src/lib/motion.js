// Мелкие движения телефона, которые не жидкость: булавка закреплённой
// задачи и колокольчик уведомлений (DESIGN.md, «Телефон» → «Жидкое
// движение», «Булавка и колокольчик»). Здесь числа и формы — чистые ворклеты
// (их зовут стили Reanimated на UI-потоке, а тесты — как обычные функции) —
// и расписание звона. Рисуют: булавку — components/PinMark.js, колокольчик —
// NotificationsButton в components/TabHeader.js.
import { Easing } from 'react-native-reanimated';

function clamp01(v) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- Булавка ---------------------------------------------------------------

/** Булавка падает и втыкается: перехлёст ~25 % — вошла глубже и отыграла. */
export const PIN_SPRING = { damping: 12, stiffness: 320, mass: 0.7 };
/** Булавку выдернули: уходит вверх с разгоном и тает. */
export const PIN_OUT = { duration: 260, easing: Easing.in(Easing.cubic) };
/** Там, где булавка в строке не остаётся, она гаснет после втыкания. */
export const PIN_FADE = { duration: 200, easing: Easing.out(Easing.cubic) };
export const PIN_LINGER_MS = 650;
/** Строка с булавкой появилась на экране так скоро после закрепления —
 *  значит, её перерисовали заново посреди втыкания (переезд в другой раздел),
 *  и булавка втыкается с начала. */
export const PIN_FRESH_MS = 700;

/**
 * Булавка втыкается. p — пружина 0 → 1 (на перехлёсте до ~1,25): падает
 * сверху с поворотом, на перехлёсте уходит чуть глубже и сплющивается от
 * удара, потом отыгрывает в покой.
 * @returns {ty, rot, sy, o} сдвиг вниз, поворот в градусах, масштаб по высоте, видимость
 */
export function pinDrop(p) {
  'worklet';
  const over = p > 1 ? p - 1 : 0;
  return { ty: 14 * (p - 1), rot: 28 * (p - 1), sy: 1 - 0.6 * over, o: clamp01(p * 2.5) };
}

/** Булавку выдернули: q 0 → 1 — вверх, с поворотом в другую сторону, тает. */
export function pinLift(q) {
  'worklet';
  return { ty: -18 * q, rot: 22 * q, sy: 1, o: 1 - q };
}

/** Закреплена ли задача только что (на этой отрисовке — ещё втыкается). */
export function freshPin(pinnedAt, now = Date.now()) {
  if (!pinnedAt) return false;
  const at = Date.parse(pinnedAt);
  return Number.isFinite(at) && now - at >= 0 && now - at < PIN_FRESH_MS;
}

// --- Колокольчик -------------------------------------------------------------

/** Один звон — около секунды. */
export const BELL_RING = { duration: 1000, easing: Easing.linear };
/** Звон повторяется раз в 7 с, три раза, потом тишина до новых. */
export const BELL_EVERY_MS = 7000;
export const BELL_TIMES = 3;
/** Ось качания — верх колокольчика: на столько выше центра значка 18. */
export const BELL_PIVOT = 7;

/**
 * Угол колокольчика на звоне, t 0 → 1: качание вокруг верхней точки,
 * четыре с половиной размаха, амплитуда 16° затухает до нуля.
 */
export function bellAngle(t) {
  'worklet';
  if (t <= 0 || t >= 1) return 0;
  return 16 * Math.exp(-4.2 * t) * Math.sin(2 * Math.PI * 4.5 * t);
}

/** Бейдж-счётчик вздрагивает в начале звона: 1 → 1,28 → 1 за первые 0,22. */
export function badgeKick(t) {
  'worklet';
  if (t <= 0 || t >= 0.22) return 1;
  return 1 + 0.28 * Math.sin((Math.PI * t) / 0.22);
}

// Расписание звона — одно на приложение. Шапку вкладки хост перерисовывает
// при каждой смене вкладки, и у каждой отрисовки свой колокольчик: если бы
// считал каждый сам, новая вкладка звенила бы заново. Поэтому счёт ведёт
// модуль, а колокольчики только слушают «звени».
const bell = { count: 0, left: 0, nextAt: 0, timer: null, listeners: new Set() };

function clear() {
  if (bell.timer) clearTimeout(bell.timer);
  bell.timer = null;
}

/** Следующий звон — в момент at; таймер тикает, только пока есть кому звенеть. */
function plan(at) {
  clear();
  bell.nextAt = at;
  if (bell.listeners.size) bell.timer = setTimeout(ring, Math.max(0, at - Date.now()));
}

function ring() {
  bell.timer = null;
  if (bell.left <= 0) return;
  bell.left -= 1;
  bell.listeners.forEach((fn) => fn());
  if (bell.left > 0) plan(Date.now() + BELL_EVERY_MS);
}

/**
 * Сколько непрочитанных сейчас. Стало больше — три звона сначала, первый
 * сразу; меньше — запомнить (следующий рост снова зазвенит); ноль — тишина.
 */
export function bellUnread(count) {
  const grew = count > bell.count;
  bell.count = count;
  if (!count) {
    bell.left = 0;
    clear();
    return;
  }
  if (grew) {
    bell.left = BELL_TIMES;
    plan(Date.now());
  }
}

/** Слушать звон. Колокольчик пришёл посреди серии — она продолжается с
 *  того же места. Ушёл последний — таймер встаёт до следующего. */
export function onBellRing(fn) {
  bell.listeners.add(fn);
  if (bell.left > 0 && !bell.timer) plan(bell.nextAt);
  return () => {
    bell.listeners.delete(fn);
    if (!bell.listeners.size) clear();
  };
}

/** Для тестов: забыть счёт и серию. */
export function resetBell() {
  clear();
  bell.count = 0;
  bell.left = 0;
  bell.nextAt = 0;
}

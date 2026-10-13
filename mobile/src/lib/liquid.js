// Жидкое движение телефона — одна реализация на все места (DESIGN.md,
// «Телефон» → «Жидкое движение»). Здесь только числа и формы: пружины, путь
// подложки между вкладками и превращение капли в плашку. Чистые функции —
// ворклеты: их зовут стили Reanimated на UI-потоке, а тесты — как обычные.
// Компоненты, которые этим рисуют, — components/Liquid.js (подложка, капля,
// кнопка старта, галочка) и components/ProgressBar.js (шкалы).
//
// Правило, на котором обожглись (панель вкладок, 11 октября): одна пружина
// на одно движение. withSequence из двух пружин ждёт, пока первая успокоится
// по энергии (порог Reanimated 4 — 6e-9), а это ~1,4 с при видимых 0,5 с:
// второй шаг стартовал через секунду и читался как повтор анимации.
// «Толчок» поэтому — одна пружина из покоя с начальной скоростью: подскок и
// возврат в ней же.
import { Platform } from 'react-native';
import { Easing } from 'react-native-reanimated';

/** Пружины и время жидкости — токены движения. */
export const LIQUID = {
  // Подложка вкладок переезжает: к концу пути перехлёст ~4 %, упругая
  // остановка (ζ ≈ 0.65).
  glide: { damping: 17, stiffness: 190, mass: 0.9 },
  // Капля набухает в плашку: перехлёст ~5 %.
  swell: { damping: 15, stiffness: 150, mass: 0.9 },
  // Плашка стягивается в каплю и исчезает — без перехлёста.
  drain: { duration: 380, easing: Easing.inOut(Easing.cubic) },
  // Акцент наливается в кнопку снизу и стекает обратно.
  pour: { duration: 460, easing: Easing.out(Easing.cubic) },
  unpour: { duration: 380, easing: Easing.inOut(Easing.cubic) },
  // Желе: форма вздрагивает — толчок скоростью, затухает сама.
  jelly: { damping: 8, stiffness: 280, mass: 0.6 },
  // Значок выпрыгивает пружиной (у «■» — из точки, у вкладки — толчком).
  pop: { damping: 10, stiffness: 340, mass: 0.6 },
  // Шкала натекает к новому значению: перехлёст ~6 % пути, к ~0,55 с
  // успокоилась (ζ ≈ 0.65).
  flow: { damping: 16, stiffness: 150, mass: 1 },
  // Там, где жидкости нет (iOS 26+), шкала просто доползает.
  creep: { duration: 420, easing: Easing.out(Easing.cubic) },
  // Галочка задачи: акцент наливается быстрее, чем в кнопку старта, и
  // стекает ещё быстрее; капли разлетаются и тают.
  check: { duration: 260, easing: Easing.out(Easing.cubic) },
  uncheck: { duration: 200, easing: Easing.inOut(Easing.cubic) },
  // Крестик «отменено»: два штриха прорисовываются по очереди, а стираются
  // быстрее — тише налива галочки, без брызг.
  cross: { duration: 300, easing: Easing.out(Easing.cubic) },
  uncross: { duration: 200, easing: Easing.inOut(Easing.cubic) },
  // Брызги — ровное время: разлёт замедляется в dropAt, а таять капли
  // начинают с середины. С ease out капля таяла, едва вылетев (~80 мс видно).
  burst: { duration: 320, easing: Easing.linear },
};

/** Когда кнопка вздрагивает: акцент уже налит больше чем наполовину. */
export const JELLY_DELAY = 200;
/** Скорость толчка желе: ~8 % растяжения на пике. */
export const JELLY_KICK = 1.7;
/** Скорость толчка значка вкладки: подскок до ~1,06 (пружина pop). */
export const TAB_POP_KICK = 2.4;
/** Галочка: «поп» в конце налива — толчок до ~1,12 (та же пружина pop). */
export const CHECK_POP_KICK = 4.5;
/** Когда галочка делает «поп» и брызгает: акцент налит на ~⅘. */
export const CHECK_POP_DELAY = 190;
/** Сколько капель разлетается из галочки. */
export const CHECK_DROPS = 6;
/** Крестик: «поп» меньше галочкиного (до ~1,06) и когда второй штрих уже идёт. */
export const CROSS_POP_KICK = 2.4;
export const CROSS_POP_DELAY = 170;
/** Шкала дошла до 100 %: заливка вспухает по толщине — толчок той же пружины
 *  pop до ~1,7 (ProgressBar). */
export const BAR_POP_KICK = 24;
/** Когда: заливка доехала до конца шкалы (пружина flow первый раз пересекает
 *  единицу на ~0,25 с). */
export const BAR_POP_DELAY = 240;
/** Веер брызг у торца шкалы, рад: от «влево чуть вверх» до «вверх и вправо» —
 *  вниз не летят, вправо недалеко (торец у края карточки). */
export const BAR_DROPS_ARC = [-3, -0.9];
/** С какого размера «■» выпрыгивает и когда. */
export const POP_FROM = 0.35;
export const POP_DELAY = 140;

/**
 * Жидкость играет везде, кроме iOS 26+: там шапка и плашка идущей задачи
 * нативные, на жидком стекле, и система анимирует их сама — своё поверх не
 * добавляем, всё остаётся как было. Функция, а не константа: тест меняет
 * Platform на ходу.
 */
export function liquidAllowed() {
  if (Platform.OS !== 'ios') return true;
  return (parseInt(String(Platform.Version), 10) || 0) < 26;
}

function clamp01(v) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a, b, t) {
  'worklet';
  return a + (b - a) * t;
}

/**
 * Подложка выбранной вкладки по пути от одного места к другому. Ведущий
 * край (в сторону движения) идёт по p, хвост отстаёт (p²): на середине пути
 * подложка вытянута на четверть расстояния и догоняет хвост к концу. За
 * концом пути (пружина перехлестнула, p > 1) ведущий край стоит у цели, как
 * капля, упёршаяся в стенку, а хвост по инерции наезжает — подложка
 * поджимается и отыгрывает назад: упругая остановка, и за дорожку она не
 * вылезает. По высоте — обратно ширине, как у капли: вытянутая тоньше,
 * поджатая толще.
 * @param from {x, w} прежнее место (левый край, ширина)
 * @param to   {x, w} новое место
 * @param p    0…1 (на перехлёсте чуть больше 1)
 * @returns {x, w, sy} левый край, ширина и масштаб по высоте
 */
export function liquidSpan(from, to, p) {
  'worklet';
  const lead = p <= 1 ? p : 1;
  const trail = p <= 1 ? p * p : p;
  const fromR = from.x + from.w;
  const toR = to.x + to.w;
  let left;
  let right;
  if (to.x >= from.x) {
    right = mix(fromR, toR, lead);
    left = mix(from.x, to.x, trail);
  } else {
    left = mix(from.x, to.x, lead);
    right = mix(fromR, toR, trail);
  }
  const w = Math.max(right - left, 1);
  const calm = mix(from.w, to.w, clamp01(p));
  const stretch = (w - calm) / Math.max(to.w, 1);
  const sy = Math.min(1.08, Math.max(0.86, 1 - 0.2 * stretch));
  return { x: left, w, sy };
}

/** Доля пути, на которой капля стала круглой во всю высоту и начинает тянуться. */
export const DROP = 0.32;

/**
 * Капля → плашка. p: 0 — ничего; DROP — круглая капля высотой с плашку у
 * левого края; 1 — плашка во всю ширину со своим скруглением. Пока тянется —
 * тоньше (объём сохраняется), на перехлёсте пружины (p > 1) — чуть шире и
 * ниже и отыгрывает назад. Уходя (p от 1 к 0), содержимое гаснет первым,
 * плашка стягивается в каплю, капля сходит в точку.
 * @param p 0…1 (и чуть больше на перехлёсте)
 * @param w ширина плашки; h — высота; r — её скругление в покое
 * @returns {w, h, r, content} размер, скругление и видимость содержимого 0…1
 */
export function liquidMorph(p, w, h, r) {
  'worklet';
  if (p <= 0) return { w: 0, h: 0, r: 0, content: 0 };
  if (p < DROP) {
    const a = p / DROP;
    const d = h * a * (2 - a); // ease out: капля набухает быстро и садится
    return { w: d, h: d, r: d / 2, content: 0 };
  }
  const s = (p - DROP) / (1 - DROP);
  if (s >= 1) {
    if (s === 1) return { w, h, r, content: 1 };
    const over = s - 1;
    return { w: w + Math.min(h * 0.25, (w - h) * over * 0.5), h: h * (1 - Math.min(0.08, over * 0.8)), r, content: 1 };
  }
  const ww = Math.max(h, mix(h, w, s));
  const hh = h * (1 - 0.1 * Math.sin(Math.PI * s));
  const rr = Math.min(hh / 2, mix(h / 2, r, s));
  return { w: ww, h: hh, r: rr, content: clamp01((s - 0.55) / 0.45) };
}

/**
 * Налив кнопки старта: большой скруглённый квадрат акцента поднимается
 * снизу и поворачивается — край идёт волной. Сторона квадрата — FILL_SCALE
 * сторон кнопки: повёрнутый, он и в начале не заглядывает в кнопку, и в
 * конце накрывает её углы.
 */
export const FILL_SCALE = 1.9;

/**
 * @param p    0 — пусто, 1 — налито
 * @param size сторона кнопки
 * @returns {ty, rot} сдвиг квадрата вниз и поворот в градусах
 */
export function pourFill(p, size) {
  'worklet';
  const side = size * FILL_SCALE;
  const full = (size - side) / 2; // центр квадрата — в центре кнопки
  const empty = size * 1.1; // верх квадрата ниже кнопки
  return { ty: mix(empty, full, p), rot: 160 * p };
}

/**
 * Крестик «отменено»: ход p (0 — пусто, 1 — нарисован) делится на подложку и
 * два штриха. Серая подложка проступает в первой половине, первый штрих идёт
 * сразу, второй стартует с его трети и доходит к концу; при стирании те же
 * доли идут обратно — второй штрих гаснет первым.
 * @returns {fill, a, b} доли 0…1: подложка, первый штрих, второй штрих
 */
export function crossDraw(p) {
  'worklet';
  return { fill: clamp01(p / 0.45), a: clamp01(p / 0.6), b: clamp01((p - 0.35) / 0.65) };
}

/**
 * Шкала натекает от from к to (доли 0…1) по пружине p (0 → 1, на
 * перехлёсте чуть больше 1): заливка перелетает цель и отыгрывает назад —
 * упругая остановка. Передний край — капля: на ходу она толще шкалы и
 * вытянута вперёд, к концу пути садится в круглый торец шкалы. Короткий путь
 * (5 % шкалы) — капля поменьше, чтобы мелкая правка не дёргала шкалу.
 * @param h толщина шкалы
 * @returns {w, headW, headH} доля заливки (0…1), длина и толщина капли
 */
export function liquidBar(from, to, p, h) {
  'worklet';
  // В покое (p = 1) — ровно значение, без хвостов дробей.
  const w = clamp01(p === 1 ? to : mix(from, to, p));
  const s = Math.sin(Math.PI * clamp01(p));
  const k = Math.min(1, Math.abs(to - from) * 4);
  return { w, headW: h * (1 + 2.2 * s * k), headH: h * (1 + 0.7 * s * k) };
}

/**
 * Столбик графика поднимается от from к to (высоты) по той же пружине: на
 * ходу он тоньше (жидкость тянется), к концу — в свою ширину.
 * @returns {h, sx} высота и масштаб по ширине
 */
export function liquidColumn(from, to, p) {
  'worklet';
  const s = Math.sin(Math.PI * clamp01(p));
  const k = Math.min(1, Math.abs(to - from) / 24);
  return { h: Math.max(0, p === 1 ? to : mix(from, to, p)), sx: 1 - 0.14 * s * k };
}

/**
 * Капля i из n, брызнувшая из отмеченной галочки: летит от центра наружу
 * (чуть оседая вниз), уменьшается и тает. Углы — по кругу с небольшим
 * разбросом, дальность — тоже, чтобы брызги не стояли ровной звездой.
 * @param q    время 0 → 1 (ровное): 0 — в галочке, 1 — разлетелась и растаяла
 * @param size сторона галочки
 * @param arc  [от, до] в радианах — веер вместо полного круга (шкала брызгает
 *             вверх от своего торца); без него — по кругу
 * @returns {x, y, s, o} сдвиг от центра, масштаб и непрозрачность
 */
export function dropAt(i, n, q, size, arc) {
  'worklet';
  const wobble = i % 2 ? 0.22 : -0.12;
  const a = arc
    ? arc[0] + ((arc[1] - arc[0]) * (i + 0.5)) / n + wobble * 0.4
    : -Math.PI / 2 + (i * 2 * Math.PI) / n + wobble;
  const fly = 1 - (1 - q) * (1 - q) * (1 - q); // вылетает быстро, у конца тормозит
  const r = mix(size * 0.32, size * 0.5 + 10 + (i % 3) * 2.5, fly);
  // Проявилась за первую десятую, видна до середины, к концу растаяла.
  const o = q < 0.1 ? q / 0.1 : q < 0.5 ? 1 : 1 - (q - 0.5) / 0.5;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r + 4 * q * q, s: 1 - 0.45 * q, o: clamp01(o) };
}

// Кто и когда запустил задачу: строку могут перерисовать заново прямо во
// время налива (колода, разделы ленты), и новая кнопка подхватывает налив,
// а не встаёт сразу налитой. Ключ — id задачи.
const kicks = new Map();
/** Сколько после переключения свежая кнопка ещё играет налив. */
export const KICK_FRESH_MS = 400;

export function noteKick(id, on, now = Date.now()) {
  if (id != null) kicks.set(id, { on: !!on, at: now });
}

/** Переключали ли задачу только что в это же состояние. */
export function freshKick(id, on, now = Date.now()) {
  const k = id != null ? kicks.get(id) : null;
  return !!k && k.on === !!on && now - k.at < KICK_FRESH_MS;
}

/**
 * С чего начинается налив кнопки или галочки на первом кадре: обычно — с
 * того, что есть (on — налита); перерисованная посреди переключения (fresh) —
 * с противоположного, откуда налив или слив и пойдёт.
 */
export function fillFrom(fresh, on) {
  return (fresh ? !on : !!on) ? 1 : 0;
}

/** Для тестов: забыть все толчки. */
export function resetKicks() {
  kicks.clear();
}

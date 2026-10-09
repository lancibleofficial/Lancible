// Жесты телефона: порог свайпа строки, резинка и куда встаёт колода
// проектов после отпускания. Запуск: npm run test:mobile
//
// Сами жесты в Node не прогнать — проверяются решения, которые они
// принимают: сработает ли отпускание и на какую карточку вернётся колода.
import { swipeFires, rubberBand, SWIPE_TRIGGER } from '../src/components/SwipeRow';
import { deckTarget, dotsStart, dotsWidth, dotScale, PULL_TRIGGER, MAX_DOTS } from '../src/screens/ProjectsScreen';

test('свайп срабатывает только влево и только за порогом', () => {
  expect(swipeFires(-(SWIPE_TRIGGER - 1))).toBe(false);
  expect(swipeFires(-SWIPE_TRIGGER)).toBe(true);
  expect(swipeFires(SWIPE_TRIGGER * 2)).toBe(false);
});

test('резинка: до предела — как есть, дальше — всё медленнее, но растёт', () => {
  expect(rubberBand(50, 100)).toBe(50);
  const a = rubberBand(150, 100);
  const b = rubberBand(300, 100);
  expect(a).toBeGreaterThan(100);
  expect(a).toBeLessThan(150);
  expect(b).toBeGreaterThan(a);
  expect(b - 100).toBeLessThan((300 - 100) * 0.5);
});

test('колода встаёт на ближайшую карточку, но не дальше соседней и не за край', () => {
  const step = 300;
  // Чуть сдвинули и отпустили без скорости — назад на свою.
  expect(deckTarget(-2 * step - 40, 0, step, 2, 5)).toBe(2);
  // Больше половины — на соседнюю.
  expect(deckTarget(-2 * step - 200, 0, step, 2, 5)).toBe(3);
  // Быстрый бросок — на соседнюю даже с малым сдвигом.
  expect(deckTarget(-2 * step - 60, -2000, step, 2, 5)).toBe(3);
  // Сильный бросок не перескакивает через карточку.
  expect(deckTarget(-2 * step - 280, -9000, step, 2, 5)).toBe(3);
  // У краёв — в пределах колоды; вытянутый «+» возвращает на первую.
  expect(deckTarget(PULL_TRIGGER, 0, step, 0, 5)).toBe(0);
  expect(deckTarget(-4 * step - 200, -3000, step, 4, 5)).toBe(4);
});

test('точки пагинации: до шести — все и в полный рост, окно ровно по ним', () => {
  for (let i = 0; i < 5; i += 1) expect(dotScale(i, dotsStart(2, 5), 5)).toBe(1);
  expect(dotsStart(4, 5)).toBe(0);
  // Пять точек: четыре круглые по 7 с зазором 6 и одна пилюля 22.
  expect(dotsWidth(5)).toBe(4 * (7 + 6) + 22);
  expect(dotsWidth(40)).toBe(dotsWidth(MAX_DOTS));
});

test('точки пагинации: больше шести — окно из шести едет за текущей', () => {
  const n = 10;
  // В начале: окно с нуля, первая в полный рост, шестая меньше, седьмой не видно.
  expect(dotsStart(0, n)).toBe(0);
  expect(dotsStart(2, n)).toBe(0);
  expect(dotScale(0, 0, n)).toBe(1);
  expect(dotScale(MAX_DOTS - 1, 0, n)).toBeLessThan(1);
  expect(dotScale(MAX_DOTS, 0, n)).toBe(0);
  // Текущая стоит третьей: с четвёртой окно сдвигается на одну.
  expect(dotsStart(3, n)).toBe(1);
  expect(dotsStart(5, n)).toBe(3);
  // Пока окно едет (начало дробное), шестая растёт, седьмая появляется.
  expect(dotScale(MAX_DOTS - 1, 0.5, n)).toBeGreaterThan(dotScale(MAX_DOTS - 1, 0, n));
  expect(dotScale(MAX_DOTS, 0.5, n)).toBeGreaterThan(0);
  // В конце: окно упирается в край, последняя в полный рост.
  expect(dotsStart(n - 1, n)).toBe(n - MAX_DOTS);
  expect(dotScale(n - 1, n - MAX_DOTS, n)).toBe(1);
  expect(dotScale(n - MAX_DOTS, n - MAX_DOTS, n)).toBeLessThan(1);
  // Текущая никогда не уменьшается краем окна.
  for (let a = 0; a < n; a += 1) expect(dotScale(a, dotsStart(a, n), n)).toBe(1);
});

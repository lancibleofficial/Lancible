// Жесты телефона: порог свайпа строки, резинка и куда встаёт колода
// проектов после отпускания. Запуск: npm run test:mobile
//
// Сами жесты в Node не прогнать — проверяются решения, которые они
// принимают: сработает ли отпускание и на какую карточку вернётся колода.
import { swipeFires, rubberBand, SWIPE_TRIGGER } from '../src/components/SwipeRow';
import { deckTarget, PULL_TRIGGER } from '../src/screens/ProjectsScreen';

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

// Текстовая обёртка телефона. Запуск: npm run test:mobile (из корня)
//
// Почему именно этот компонент закрыт тестом первым. В нём собрано всё, на
// чём шрифты на телефоне уже ломались, и каждая поломка была тихой: текст
// просто набирался не тем шрифтом.
//
//   1. fontWeight рядом с кастомным fontFamily. Android пытается подобрать
//      начертание сам, не находит и откатывается на системный шрифт. Поэтому
//      вес из итогового стиля убирается целиком, а начертание выбирается
//      семейством.
//   2. Знаки валют ₽ ₸ ₴ ₺, которых нет в Basique Pro, а ею набираются
//      крупные суммы. Без явной подмены iOS подставляет случайный шрифт с
//      засечками. В Onest они есть — там подменять нечего, и текст
//      резаться не должен.
// render в этой версии библиотеки асинхронный — отсюда await в каждом тесте.
import { render } from '@testing-library/react-native';
import Text from '../src/components/AppText';

/** Плоский стиль первого текстового узла — то, что в итоге увидит платформа. */
function styleOf(node) {
  const flat = [];
  (function walk(style) {
    if (!style) return;
    if (Array.isArray(style)) { style.forEach(walk); return; }
    flat.push(style);
  }(node.props.style));
  return Object.assign({}, ...flat);
}

test('вес убирается, а начертание выбирается семейством', async () => {
  const { getByText } = await render(<Text style={{ fontWeight: '700' }}>жирный</Text>);
  const style = styleOf(getByText('жирный'));
  expect(style.fontFamily).toBe('Onest-SemiBold');
  expect(style.fontWeight).toBeUndefined();
});

test('без веса берётся обычное начертание', async () => {
  const { getByText } = await render(<Text>обычный</Text>);
  expect(styleOf(getByText('обычный')).fontFamily).toBe('Onest-Regular');
});

test('явный fontFamily сильнее веса', async () => {
  const { getByText } = await render(
    <Text style={{ fontFamily: 'BasiquePro-Black', fontWeight: '400' }}>лого</Text>,
  );
  const style = styleOf(getByText('лого'));
  expect(style.fontFamily).toBe('BasiquePro-Black');
  expect(style.fontWeight).toBeUndefined();
});

test('курсив переживает подмену веса', async () => {
  const { getByText } = await render(<Text style={{ fontStyle: 'italic' }}>наклонный</Text>);
  expect(styleOf(getByText('наклонный')).fontStyle).toBe('italic');
});

test('знак валюты в Basique Pro уходит в Onest того же веса', async () => {
  // Текст разрезается на куски, и отсутствующий глиф оборачивается во
  // вложенный Text с Onest. Значит, у суммы, набранной Basique Pro, знак
  // окажется отдельным узлом.
  const { getByText } = await render(<Text style={{ fontFamily: 'BasiquePro-Bold' }}>6 250 ₽</Text>);
  expect(styleOf(getByText('₽')).fontFamily).toBe('Onest-Bold');
});

test('в Onest знаки валют свои, и текст не режется', async () => {
  const { queryByText } = await render(<Text>1000 ₸ · 2500 ₽</Text>);
  expect(queryByText('₸')).toBeNull();
  expect(queryByText('₽')).toBeNull();
  expect(queryByText('1000 ₸ · 2500 ₽')).not.toBeNull();
});

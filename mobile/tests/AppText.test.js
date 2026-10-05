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
//   2. Глифы ₸ ₴ ₺, которых в Gravity нет. Без явной подмены iOS подставляет
//      случайный шрифт с засечками. Рубль ₽ в Gravity есть и подменяться не
//      должен — иначе самый частый символ в приложении поедет.
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
  expect(style.fontFamily).toBe('Gravity-Bold');
  expect(style.fontWeight).toBeUndefined();
});

test('без веса берётся обычное начертание', async () => {
  const { getByText } = await render(<Text>обычный</Text>);
  expect(styleOf(getByText('обычный')).fontFamily).toBe('Gravity-Book');
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

test('тенге уходит в запасной шрифт, а рубль остаётся в своём', async () => {
  // Текст разрезается на куски, и отсутствующий глиф оборачивается во
  // вложенный Text с системным шрифтом. Значит, у «1000 ₸» внутри появится
  // отдельный узел, а у «1000 ₽» — нет.
  const tenge = await render(<Text>1000 ₸</Text>);
  expect(tenge.queryByText('₸')).not.toBeNull();

  const rouble = await render(<Text>1000 ₽</Text>);
  expect(rouble.queryByText('₽')).toBeNull();
  expect(rouble.queryByText('1000 ₽')).not.toBeNull();
});

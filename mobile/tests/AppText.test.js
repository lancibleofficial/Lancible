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
//   2. Знаки валют ₽ ₸ ₴ ₺. Пока заголовки и суммы набирала Basique Pro,
//      в которой их нет, знак приходилось подменять отдельным узлом. Теперь
//      весь телефон — Onest, знаки в нём свои, и текст резаться не должен.
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
    <Text style={{ fontFamily: 'Onest-Bold', fontWeight: '400' }}>заголовок</Text>,
  );
  const style = styleOf(getByText('заголовок'));
  expect(style.fontFamily).toBe('Onest-Bold');
  expect(style.fontWeight).toBeUndefined();
});

test('курсив переживает подмену веса', async () => {
  const { getByText } = await render(<Text style={{ fontStyle: 'italic' }}>наклонный</Text>);
  expect(styleOf(getByText('наклонный')).fontStyle).toBe('italic');
});

test('крупная сумма заголовочным начертанием не режется на куски', async () => {
  const { queryByText } = await render(<Text style={{ fontFamily: 'Onest-Bold' }}>6 250 ₽</Text>);
  expect(queryByText('₽')).toBeNull();
  expect(queryByText('6 250 ₽')).not.toBeNull();
});

test('в Onest знаки валют свои, и текст не режется', async () => {
  const { queryByText } = await render(<Text>1000 ₸ · 2500 ₽</Text>);
  expect(queryByText('₸')).toBeNull();
  expect(queryByText('₽')).toBeNull();
  expect(queryByText('1000 ₸ · 2500 ₽')).not.toBeNull();
});

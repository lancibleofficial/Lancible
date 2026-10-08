// Поиск на iOS 26+ (screens/SearchScreen.js) — нативная шапка со стеклом.
// Запуск: npm run test:mobile
//
// Системная строка поиска прыгала: активная, она прятала шапку с «назад» и
// уезжала вверх, закрытая — обратно вниз. Теперь в шапке своё поле слева
// (стекло под ним рисует система) и круглая «закрыть» справа, которая
// уводит назад. Поле никуда не двигается, клавиатура — сразу.
import { render, fireEvent } from '@testing-library/react-native';
import SearchScreen, { nativeFieldWidth } from '../src/screens/SearchScreen';
import { useAppStore } from '../src/store/useAppStore';

jest.mock('../src/navigation/nativeHeader', () => ({
  ...jest.requireActual('../src/navigation/nativeHeader'),
  IOS_NATIVE_HEADER: true,
}));

const nav = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => () => {}),
});
const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(),
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task('t1', 'Главная страница'), task('t2', 'Логи')],
    activeTimer: null,
  });
});

test('в шапке — поле слева и «закрыть» справа, без системной строки поиска', async () => {
  const navigation = nav();
  const screen = await render(<SearchScreen navigation={navigation} />);
  const options = navigation.setOptions.mock.calls.at(-1)[0];
  expect(options.headerSearchBarOptions).toBeUndefined();
  expect(options.headerBackVisible).toBe(false);
  // Своей шапки на JS нет — только список.
  expect(screen.queryByPlaceholderText('Поиск задач и проектов')).toBeNull();

  const [close] = options.unstable_headerRightItems();
  expect(close.icon).toEqual({ type: 'sfSymbol', name: 'xmark' });
  close.onPress();
  expect(navigation.goBack).toHaveBeenCalled();

  const [field] = options.unstable_headerLeftItems();
  expect(field.type).toBe('custom');
  // Подложку-стекло рисует шапка: её не прячем.
  expect(field.hidesSharedBackground).toBeFalsy();
  const header = await render(field.element);
  const input = header.getByPlaceholderText('Поиск задач и проектов');
  expect(input.props.autoFocus).toBe(true);

  // Поле в шапке ищет по экрану.
  await fireEvent.changeText(input, 'глав');
  screen.getByText('Главная страница');
  expect(screen.queryByText('Логи')).toBeNull();
});

test('поле занимает шапку до кнопки «закрыть»', () => {
  expect(nativeFieldWidth(402)).toBe(402 - 16 * 2 - 44 - 12);
  expect(nativeFieldWidth(100)).toBe(160);
});

// Поиск на iOS 26+ (screens/SearchScreen.js) — нативная шапка со стеклом.
// Запуск: npm run test:mobile
//
// Системная строка поиска прыгала: активная, она прятала шапку с «назад» и
// уезжала вверх, закрытая — обратно вниз. Теперь шапку она не прячет и стоит
// на месте. Своё поле в шапку не годится: широкий элемент iOS сворачивает в
// «…» (снимок с iPhone, круг 12). Клавиатура — сразу, через ref строки.
import { render, act } from '@testing-library/react-native';
import SearchScreen from '../src/screens/SearchScreen';
import { useAppStore } from '../src/store/useAppStore';

jest.mock('../src/navigation/nativeHeader', () => ({
  ...jest.requireActual('../src/navigation/nativeHeader'),
  IOS_NATIVE_HEADER: true,
}));

const nav = () => {
  const listeners = {};
  return {
    listeners,
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => { delete listeners[name]; }; }),
  };
};
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

test('строка поиска не прячет шапку и не прыгает, «назад» остаётся', async () => {
  const navigation = nav();
  const screen = await render(<SearchScreen navigation={navigation} />);
  const options = navigation.setOptions.mock.calls.at(-1)[0];
  const bar = options.headerSearchBarOptions;
  expect(bar.hideNavigationBar).toBe(false);
  expect(bar.hideWhenScrolling).toBe(false);
  expect(bar.placement).toBe('stacked');
  // Системную «назад» не трогаем, своих элементов в шапке нет.
  expect(options.headerBackVisible).toBeUndefined();
  expect(options.unstable_headerLeftItems).toBeUndefined();
  // Своей шапки на JS нет — только список.
  expect(screen.queryByPlaceholderText('Поиск задач и проектов')).toBeNull();
  expect(bar.placeholder).toBe('Поиск задач и проектов');

  // Ввод в строке ищет по экрану.
  await act(() => bar.onChangeText({ nativeEvent: { text: 'глав' } }));
  screen.getByText('Главная страница');
  expect(screen.queryByText('Логи')).toBeNull();
});

test('клавиатура сразу: строка получает фокус, когда экран доехал', async () => {
  const navigation = nav();
  await render(<SearchScreen navigation={navigation} />);
  const bar = navigation.setOptions.mock.calls.at(-1)[0].headerSearchBarOptions;
  const focus = jest.fn();
  bar.ref.current = { focus };
  navigation.listeners.transitionEnd({ data: { closing: false } });
  expect(focus).toHaveBeenCalledTimes(1);
  navigation.listeners.transitionEnd({ data: { closing: true } });
  expect(focus).toHaveBeenCalledTimes(1);
});

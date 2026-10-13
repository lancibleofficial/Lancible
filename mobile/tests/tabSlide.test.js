// Пролистывание вкладок (navigation/tabSlide.js, components/TabSlide.js).
// Запуск: npm run test:mobile
//
// Android: навигатор вкладок сам двигает страницы — forSlide, во всю
// ширину. iOS: вкладки нативные и переключаются мгновенно, поэтому
// содержимое въезжает со стороны открытой вкладки. Шапка не двигается и не
// гаснет нигде: заголовок нативной шапки iOS 26 меняется вместе со вкладкой,
// сразу, без растворения.
import { Animated, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { TAB_ORDER, slideSide, forSlide, tabFocused, freshSide, subscribeTab, resetTabSlide } from '../src/navigation/tabSlide';
import * as TabSlide from '../src/components/TabSlide';
import { withTabPage } from '../src/components/TabSlide';
import TabHeader from '../src/components/TabHeader';

jest.mock('../src/navigation/nativeHeader', () => ({
  ...jest.requireActual('../src/navigation/nativeHeader'),
  IOS_NATIVE_HEADER: true,
}));
const mockNavigation = { setOptions: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

beforeEach(() => { resetTabSlide(); mockNavigation.setOptions.mockClear(); });

test('порядок вкладок — как на панели', () => {
  expect(TAB_ORDER).toEqual(['Projects', 'Tasks', 'Home', 'Stats', 'Menu']);
});

test('сторона въезда: правее — справа, левее — слева, та же или первая — без сдвига', () => {
  expect(slideSide('Projects', 'Stats')).toBe(1);
  expect(slideSide('Menu', 'Tasks')).toBe(-1);
  expect(slideSide('Home', 'Home')).toBe(0);
  expect(slideSide(null, 'Home')).toBe(0);
});

test('Android: страницы едут во всю ширину экрана', () => {
  const interp = forSlide(400);
  const at = (p) => interp({ current: { progress: new Animated.Value(p) } }).sceneStyle.transform[0].translateX.__getValue();
  expect(at(0)).toBe(0);
  expect(at(1)).toBe(400);
  expect(at(-1)).toBe(-400);
  expect(at(0.5)).toBe(200);
});

test('iOS: открытая вкладка доезжает на место, остальные встают туда, откуда въедут', () => {
  const tasks = [];
  const projects = [];
  const menu = [];
  subscribeTab('Tasks', (e) => tasks.push(e));
  subscribeTab('Projects', (e) => projects.push(e));
  subscribeTab('Menu', (e) => menu.push(e));

  tabFocused('Projects');
  expect(projects).toEqual([{ type: 'in', side: 0 }]);
  // Задачи и Меню правее — встают справа.
  expect(tasks).toEqual([{ type: 'park', side: 1 }]);
  expect(menu).toEqual([{ type: 'park', side: 1 }]);

  tabFocused('Tasks');
  expect(tasks.at(-1)).toEqual({ type: 'in', side: 1 });
  // Проекты теперь левее — встают слева; это та же сторона, с которой въедут.
  expect(projects.at(-1)).toEqual({ type: 'park', side: -1 });
  tabFocused('Projects');
  expect(projects.at(-1)).toEqual({ type: 'in', side: -1 });
  // Никаких «спрятаться»: страница всегда видна, только сдвинута.
  expect([...tasks, ...projects, ...menu].every((e) => e.type === 'in' || e.type === 'park')).toBe(true);
});

test('iOS: вкладка, открытая впервые, узнаёт сторону уже после события', () => {
  tabFocused('Projects', 1000);
  tabFocused('Stats', 2000);
  expect(freshSide('Stats', 2100)).toBe(1);
  // Давнее событие — не въезд, а просто показ.
  expect(freshSide('Stats', 5000)).toBe(0);
  expect(freshSide('Menu', 2100)).toBe(0);
});

test('iOS 26: корень вкладки отдаёт нативной шапке заголовок и число, а сам ничего не рисует', async () => {
  function Screen({ label }) {
    return (
      <>
        <TabHeader title="Задачи" count={3} />
        <Text>{label}</Text>
      </>
    );
  }
  const Page = withTabPage(Screen, 'Tasks');
  const { getByText } = await render(<Page label="список" />);
  getByText('список');
  const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
  expect(options.title).toBe('Задачи');
  const [title] = options.unstable_headerLeftItems();
  // Заголовок — строка с названием и числом, без обёртки, которая его проявляла бы.
  const row = await render(title.element);
  row.getByText('Задачи');
  row.getByText('3');
});

test('iOS 26: заголовок нативной шапки меняется вместе с вкладкой сразу — без растворения и сдвига', async () => {
  tabFocused('Projects');
  tabFocused('Stats');
  // Растворения в коде больше нет: ни обёртки заголовка, ни длительности.
  expect(TabSlide.TabTitleFade).toBeUndefined();
  expect(TabSlide.HEADER_FADE).toBeUndefined();
  // Только что открытая вкладка: заголовок виден сразу и стоит на месте.
  function Screen() { return <TabHeader title="Время" />; }
  const Page = withTabPage(Screen, 'Stats');
  await render(<Page />);
  const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
  const [title] = options.unstable_headerLeftItems();
  const row = StyleSheet.flatten((await render(title.element)).toJSON().props.style);
  expect(row.opacity).toBeUndefined();
  expect(row.transform).toBeUndefined();
});

// Пролистывание вкладок (navigation/tabSlide.js, components/TabSlide.js).
// Запуск: npm run test:mobile
//
// Android: навигатор вкладок сам двигает страницы — forSlide, во всю
// ширину. iOS: вкладки нативные и переключаются мгновенно, поэтому
// содержимое и заголовок шапки въезжают со стороны открытой вкладки.
import { Animated, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { TAB_ORDER, slideSide, forSlide, tabFocused, tabBlurred, freshSide, subscribeTab, resetTabSlide } from '../src/navigation/tabSlide';
import { withTabPage, TabTitleSlide } from '../src/components/TabSlide';
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

test('iOS: открытой вкладке — въезд с её стороны, закрытой — спрятаться', () => {
  const tasks = [];
  const projects = [];
  subscribeTab('Tasks', (e) => tasks.push(e));
  subscribeTab('Projects', (e) => projects.push(e));

  tabFocused('Projects');
  expect(projects).toEqual([{ type: 'in', side: 0 }]);
  tabBlurred('Projects');
  tabFocused('Tasks');
  expect(projects.at(-1)).toEqual({ type: 'out' });
  expect(tasks).toEqual([{ type: 'in', side: 1 }]);
  tabFocused('Projects');
  expect(projects.at(-1)).toEqual({ type: 'in', side: -1 });
});

test('iOS: вкладка, открытая впервые, узнаёт сторону уже после события', () => {
  tabFocused('Projects', 1000);
  tabFocused('Stats', 2000);
  expect(freshSide('Stats', 2100)).toBe(1);
  // Давнее событие — не въезд, а просто показ.
  expect(freshSide('Stats', 5000)).toBe(0);
  expect(freshSide('Menu', 2100)).toBe(0);
});

test('iOS 26: корень вкладки отдаёт её имя шапке, заголовок въезжает вместе со страницей', async () => {
  function Screen({ label }) {
    return (
      <>
        <TabHeader title="Задачи" />
        <Text>{label}</Text>
      </>
    );
  }
  const Page = withTabPage(Screen, 'Tasks');
  const { getByText } = await render(<Page label="список" />);
  getByText('список');
  const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
  const [title] = options.unstable_headerLeftItems();
  expect(title.element.type).toBe(TabTitleSlide);
  expect(title.element.props.tab).toBe('Tasks');
});

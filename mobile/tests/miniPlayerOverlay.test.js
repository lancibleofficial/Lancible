// Плашка идущей задачи лежит поверх страницы и не двигает её — ни на
// Android, ни на iOS. Запуск: npm run test:mobile
//
// Android: плашка — в панели вкладок (MainTabBar), и раньше панель
// вырастала на её высоту, а страница над ней сжималась. Теперь блок плашки
// уходит вверх отрицательным отступом: в раскладке остаётся только панель.
// iOS: колода проектов брала нижний запас вместе с плашкой и сжималась,
// когда таймер запускали; теперь запас — только под панель вкладок.
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import MainTabBar from '../src/navigation/MainTabBar';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import { MINI_PLAYER_HEIGHT } from '../src/components/TimerMiniPlayer';
import { useAppStore } from '../src/store/useAppStore';
import { spacing, tabBarClearance } from '../src/theme';

const routes = ['Projects', 'Tasks', 'Home', 'Stats', 'Menu'].map((name) => ({ key: name, name }));
const barProps = () => ({
  state: { index: 0, routes },
  descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: { tabBarLabel: r.name } }])),
  navigation: { navigate: jest.fn() },
});
const running = { taskId: 't1', startedAt: new Date().toISOString() };

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null, updatedAt: '2026-10-01T10:00:00.000Z' }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});

test('Android: с плашкой панель занимает в раскладке столько же, сколько без неё', async () => {
  const idle = await render(<MainTabBar {...barProps()} />);
  expect(StyleSheet.flatten(idle.toJSON().props.style).marginTop || 0).toBe(0);

  useAppStore.setState({ activeTimer: running });
  const busy = await render(<MainTabBar {...barProps()} />);
  busy.getByText('Вёрстка');
  // Блок плашки (она сама и зазор до панели) уходит вверх, поверх страницы.
  expect(StyleSheet.flatten(busy.toJSON().props.style).marginTop).toBe(-(MINI_PLAYER_HEIGHT + spacing.sm));
});

test('iOS: колода не сжимается, когда таймер запускают', async () => {
  const nav = { navigate: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) };
  const pad = (tree) => StyleSheet.flatten(tree.props.style).paddingBottom;
  const idle = await render(<ProjectsScreen navigation={nav} />);
  const before = pad(idle.toJSON());
  expect(before).toBe(tabBarClearance);

  useAppStore.setState({ activeTimer: running });
  const busy = await render(<ProjectsScreen navigation={nav} />);
  expect(pad(busy.toJSON())).toBe(before);
});

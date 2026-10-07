// «Сегодня» (screens/HomeScreen.js). Запуск: npm run test:mobile
//
// Проверяется не расчёт (он в lib/today.js и в ядре), а что экран его
// показывает: остров «Сейчас идёт» / «Таймер не идёт», недавние проекты,
// дедлайны и недавние задачи.
import { render } from '@testing-library/react-native';
import HomeScreen from '../src/screens/HomeScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [],
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null,
    }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});

test('без таймера — «Таймер не идёт» и «Продолжить» для последней задачи', async () => {
  const { getByText, getAllByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'home.now_idle'));
  getByText(t('ru', 'home.continue'));
  getByText(t('ru', 'home.recent_projects'));
  getByText(t('ru', 'home.due'));
  getByText(t('ru', 'notif.empty'));
  expect(getAllByText('Вёрстка').length).toBeGreaterThan(0);
});

test('с идущим таймером — «Сейчас идёт»', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
  const { getByText, queryByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'home.now_running'));
  expect(queryByText(t('ru', 'home.now_idle'))).toBeNull();
});

test('просроченный дедлайн виден в острове «Дедлайны» с пометкой', async () => {
  useAppStore.setState({
    tasks: [{ ...useAppStore.getState().tasks[0], dueAt: '2026-01-01T10:00:00.000Z' }],
  });
  const { getByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'home.overdue_n', { n: 1 }));
});

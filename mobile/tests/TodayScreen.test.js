// «Сегодня» (screens/HomeScreen.js). Запуск: npm run test:mobile
//
// Проверяется не расчёт (записи дня режет ядро Agenda.sessionSegments,
// неделя — aggregateDays), а что экран его показывает: остров недели,
// последняя задача с кнопкой «Старт», записи дня по проектам, идущая
// запись и остров «Сроки сегодня и завтра».
import { render, fireEvent } from '@testing-library/react-native';
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
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, updatedAt: at(10),
    }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});

test('без таймера — неделя, последняя задача и записи дня по проекту', async () => {
  const { getByText, getAllByText, queryByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.last_task'));
  getByText('Сайт');
  expect(getAllByText('Вёрстка').length).toBeGreaterThan(1);
  getByText('09:00–10:00');
  expect(queryByText(t('ru', 'today.no_entries'))).toBeNull();
  expect(queryByText(t('ru', 'today.deadlines'))).toBeNull();
});

test('«Старт» у последней задачи запускает её таймер', async () => {
  const { getAllByLabelText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  await fireEvent.press(getAllByLabelText(t('ru', 'timer.start'))[0]);
  expect(useAppStore.getState().activeTimer.taskId).toBe('t1');
});

test('идущая задача видна строкой «сейчас», а остров последней задачи прячется', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
  const { getByText, queryByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'tasks.now').toLowerCase());
  expect(queryByText(t('ru', 'today.last_task'))).toBeNull();
});

test('просроченный дедлайн виден в острове «Сроки сегодня и завтра»', async () => {
  useAppStore.setState({
    tasks: [{ ...useAppStore.getState().tasks[0], dueAt: '2026-01-01T10:00:00.000Z' }],
  });
  const { getByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.deadlines'));
  getByText(t('ru', 'due.overdue'), { exact: false });
});

test('без записей за день — «Записей нет»', async () => {
  useAppStore.setState({ tasks: [{ ...useAppStore.getState().tasks[0], sessions: [], totalMs: 0 }] });
  const { getByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.no_entries'));
});

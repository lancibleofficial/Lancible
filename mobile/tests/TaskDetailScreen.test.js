// Страница задачи (screens/TaskDetailScreen.js). Запуск: npm run test:mobile
//
// Шит снизу: таймер с заработком всегда виден, вкладки «Сведения» и
// «История» раскрывают его. Проверяется применение, а не правило: кнопка
// таймера зовёт startTimer/stopTimer, статус-чип — setTaskStatus, галочка
// в шапке — setTaskDone, вкладка «История» показывает записи и «Экспорт».
import { render, fireEvent } from '@testing-library/react-native';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

// Редактор — WebView, у него нативная часть; на странице задачи он только
// предпросмотр заметок, и здесь заметки пустые.
jest.mock('../src/components/DocEditor', () => () => null);

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000, currency: 'RUB' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [], notes: '',
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, repeat: null, rate: null, pinnedAt: null,
    }],
    activeTimer: null,
  });
});

const screen = () => render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);

test('заголовок, проект в крошке, таймер и вкладки на месте', async () => {
  const { getByDisplayValue, getByText, getAllByText } = await screen();
  getByDisplayValue('Вёрстка');
  expect(getAllByText('Сайт').length).toBeGreaterThan(0);
  getByText(t('ru', 'task.details'));
  getByText(t('ru', 'task.history_n', { n: 1 }));
  getByText('01:00:00');
  getByText(t('ru', 'editor.empty'));
});

test('кнопка таймера запускает и останавливает', async () => {
  const { getByLabelText } = await screen();
  await fireEvent.press(getByLabelText(t('ru', 'timer.start')));
  expect(useAppStore.getState().activeTimer.taskId).toBe('t1');
  await fireEvent.press(getByLabelText(t('ru', 'timer.stop')));
  expect(useAppStore.getState().activeTimer).toBeNull();
});

test('статус-чип меняет статус, галочка в шапке — выполнено', async () => {
  const { getByText, getByLabelText } = await screen();
  await fireEvent.press(getByText('Готово'));
  expect(useAppStore.getState().tasks[0].statusId).toBe('s2');
  await fireEvent.press(getByLabelText(t('ru', 'task.reopen')));
  expect(useAppStore.getState().tasks[0].done).toBe(false);
  expect(useAppStore.getState().tasks[0].statusId).toBe('s1');
});

test('вкладка «История»: записи по дням, «Запись вручную» и «Экспорт истории»', async () => {
  const { getByText, queryByText } = await screen();
  expect(queryByText(t('ru', 'task.export_history'))).toBeNull();
  await fireEvent.press(getByText(t('ru', 'task.history_n', { n: 1 })));
  getByText(t('ru', 'task.records_n', { n: 1 }));
  getByText('09:00 – 10:00');
  getByText(t('ru', 'task.add_manual'));
  getByText(t('ru', 'task.export_history'));
});

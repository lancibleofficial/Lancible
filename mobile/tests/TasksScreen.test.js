// «Задачи» — инбокс (screens/TasksScreen.js). Запуск: npm run test:mobile
//
// Группы считает lib/inbox.js (закрыто inbox.test.js); здесь — что экран
// их рисует и зовёт стор: заголовки групп, галочка «выполненные», строка
// быстрого добавления в выбранный проект.
import { render, fireEvent } from '@testing-library/react-native';
import TasksScreen from '../src/screens/TasksScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const DAY = 86_400_000;
const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(), ...extra,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }, { id: 'p2', name: 'Бот', color: '#5ec8f2' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p2', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
    ],
    tasks: [
      // Сроки привязаны к дню, а не к «сейчас + час»: после 23:00 час спустя
      // уже завтра, и тест падал бы по вечерам.
      task('t1', 'Вёрстка', { dueAt: new Date(new Date().setHours(23, 59, 0, 0)).toISOString() }),
      task('t2', 'Правки', { dueAt: new Date(new Date().setHours(12, 0, 0, 0) + DAY).toISOString() }),
      task('t3', 'Макет', { done: true }),
      task('t4', 'Логи'),
    ],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, quickAddProjectId: null },
  });
});

test('группы «Сегодня», «Завтра», «Без срока»; выполненные спрятаны до галочки', async () => {
  const { getByText, queryByText, getByRole } = await render(<TasksScreen navigation={nav()} />);
  getByText(t('ru', 'tasks.today'));
  getByText(t('ru', 'tasks.tomorrow'));
  getByText(t('ru', 'tasks.nodue'));
  getByText('Вёрстка');
  expect(queryByText('Макет')).toBeNull();
  expect(queryByText(t('ru', 'tasks.done_group'))).toBeNull();

  await fireEvent.press(getByRole('switch'));
  getByText(t('ru', 'tasks.done_group'));
  getByText('Макет');
});

test('идущая задача уходит в группу «Сейчас»', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't4', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() } });
  const { getByText, queryByText } = await render(<TasksScreen navigation={nav()} />);
  getByText(t('ru', 'tasks.now'));
  expect(queryByText(t('ru', 'tasks.nodue'))).toBeNull();
});

test('строка быстрого добавления заводит задачу в выбранный проект', async () => {
  useAppStore.setState({ ui: { ...useAppStore.getState().ui, quickAddProjectId: 'p2' } });
  const { getByLabelText } = await render(<TasksScreen navigation={nav()} />);
  const input = getByLabelText(t('ru', 'tasks.new_ph'));
  await fireEvent.changeText(input, 'Команды');
  await fireEvent(input, 'submitEditing');
  const added = useAppStore.getState().tasks.find((x) => x.title === 'Команды');
  expect(added.projectId).toBe('p2');
  expect(added.statusId).toBe('s2');
});

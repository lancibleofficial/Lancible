// «Задачи» — инбокс (screens/TasksScreen.js). Запуск: npm run test:mobile
//
// Разделы считает lib/inbox.js (закрыто inbox.test.js); здесь — что экран
// их рисует и зовёт стор: заголовки разделов, выполненные внизу под подписью,
// строка быстрого добавления в выбранный проект. Фильтры-чипы и переезд
// отмеченной задачи — в TasksFilters.test.js.
import { render, fireEvent, within } from '@testing-library/react-native';
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

test('разделы «Закреплённые» и «Незакреплённые»; выполненные — всегда, последним разделом под подписью', async () => {
  useAppStore.setState({ tasks: [...useAppStore.getState().tasks, task('t5', 'Релиз', { pinnedAt: new Date().toISOString() })] });
  const { getByText, queryByText, queryByRole, getByTestId, getAllByText } = await render(<TasksScreen navigation={nav()} />);
  // Заголовки — словом пользователя, а не срочностью.
  expect(t('ru', 'home.pinned')).toBe('Закреплённые');
  expect(t('ru', 'tasks.unpinned')).toBe('Незакреплённые');
  expect(t('ru', 'tasks.done_group')).toBe('Выполнено');
  getByText('Закреплённые');
  getByText('Незакреплённые');
  for (const gone of ['Завтра', 'На неделе', 'Позже']) expect(queryByText(gone)).toBeNull();
  // Выполненная задача в ленте без всякой галочки «показывать»; самой галочки больше нет.
  expect(queryByRole('switch')).toBeNull();
  getByText('Макет');
  // Подпись раздела — по своему testID: у выполненной строки слово «Выполнено» может оказаться и в мете.
  expect(within(getByTestId('tasks-group-done')).getByText('Выполнено')).toBeTruthy();
  // Порядок: закреплённые, незакреплённые, а выполненные — после всех активных.
  const seq = getAllByText(/^(Закреплённые|Незакреплённые|Релиз|Вёрстка|Правки|Логи|Макет)$/).map((n) => n.props.children);
  expect(seq).toEqual(['Закреплённые', 'Релиз', 'Незакреплённые', 'Вёрстка', 'Правки', 'Логи', 'Макет']);
});

test('нет закреплённых — нет и раздела «Закреплённые»', async () => {
  const { getByText, queryByText } = await render(<TasksScreen navigation={nav()} />);
  getByText('Незакреплённые');
  expect(queryByText('Закреплённые')).toBeNull();
});

test('в строке закреплённой задачи метки «закреплена» нет — раздел уже говорит', async () => {
  useAppStore.setState({ tasks: [...useAppStore.getState().tasks, task('t5', 'Релиз', { pinnedAt: new Date().toISOString() })] });
  const { getByText, queryByText } = await render(<TasksScreen navigation={nav()} />);
  getByText('Релиз');
  expect(queryByText(t('ru', 'tasks.pinned_mark'))).toBeNull();
});

test('идущая задача уходит в раздел «Сейчас»', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't4', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() } });
  const { getByText } = await render(<TasksScreen navigation={nav()} />);
  getByText(t('ru', 'tasks.now'));
  getByText('Незакреплённые'); // остальные открытые задачи остались в своём разделе
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

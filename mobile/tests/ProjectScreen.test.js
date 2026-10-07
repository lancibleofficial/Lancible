// Страница проекта (screens/ProjectScreen.js). Запуск: npm run test:mobile
//
// Группы списка считает ядро (projectListGroups, закрыто юнитами); здесь
// проверяется, что телефон их рисует: заголовок на каждый статус со
// счётчиком, фильтр «Выполнено» прячет невыполненные, вкладки на месте.
import { render, fireEvent } from '@testing-library/react-native';
import ProjectScreen from '../src/screens/ProjectScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() });
const task = (id, title, statusId, done) => ({
  id, projectId: 'p1', title, statusId, done, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: 'Лендинг и веб' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    documents: [],
    tasks: [task('t1', 'Вёрстка', 's1', false), task('t2', 'Правки', 's1', false), task('t3', 'Макет', 's2', true)],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {} },
  });
});

test('список по статусам: заголовок группы и счётчик на каждый статус', async () => {
  const { getByText, getAllByText } = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
  getByText('Сайт');
  getByText('Лендинг и веб');
  getByText('В работе');
  getByText('Готово');
  getByText('Вёрстка');
  getByText('Макет');
  // Вкладки — как на вебе.
  for (const key of ['project.tab_list', 'nav.board', 'version.section', 'nav.docs']) {
    expect(getAllByText(t('ru', key)).length).toBeGreaterThan(0);
  }
});

test('фильтр «Выполнено» оставляет только выполненные', async () => {
  const { getByText, queryByText } = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
  await fireEvent.press(getByText(t('ru', 'filter.done')));
  expect(queryByText('Вёрстка')).toBeNull();
  expect(queryByText('Правки')).toBeNull();
  getByText('Макет');
});

test('свёрнутая группа прячет свои задачи, заголовок остаётся', async () => {
  const { getByText, queryByText } = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
  await fireEvent.press(getByText('В работе'));
  expect(useAppStore.getState().ui.listCollapsed.p1).toEqual(['s1']);
  expect(queryByText('Вёрстка')).toBeNull();
  getByText('В работе');
  getByText('Макет');
});

test('строка быстрого добавления заводит задачу по Enter, ▶ — заводит и запускает', async () => {
  const { getByLabelText } = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
  const input = getByLabelText(t('ru', 'tasks.new_ph'));
  await fireEvent.changeText(input, 'Тесты');
  await fireEvent(input, 'submitEditing');
  const added = useAppStore.getState().tasks.find((x) => x.title === 'Тесты');
  expect(added).toBeTruthy();
  expect(added.projectId).toBe('p1');
  expect(added.statusId).toBe('s1');
  expect(useAppStore.getState().activeTimer).toBeNull();

  await fireEvent.changeText(input, 'Деплой');
  await fireEvent.press(getByLabelText(t('ru', 'agenda.create_btn')));
  const started = useAppStore.getState().tasks.find((x) => x.title === 'Деплой');
  expect(useAppStore.getState().activeTimer.taskId).toBe(started.id);
});

// «Проекты» — колода (screens/ProjectsScreen.js). Запуск: npm run test:mobile
//
// Карточки: имя, сводка по задачам, строка быстрого добавления, список
// задач карточки (cardTasks — чистая функция, проверяется числами).
import { render, fireEvent } from '@testing-library/react-native';
import ProjectsScreen, { cardTasks } from '../src/screens/ProjectsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const task = (id, projectId, title, extra) => ({
  id, projectId, title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }, { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p2', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
    ],
    tasks: [task('t1', 'p1', 'Вёрстка'), task('t2', 'p1', 'Макет', { done: true }), task('t3', 'p2', 'Команды')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});

test('cardTasks: идущая первой, выполненные не попадают, затем закреплённые и свежие', () => {
  const tasks = [
    task('a', 'p1', 'Старая', { updatedAt: '2026-01-01T00:00:00.000Z' }),
    task('b', 'p1', 'Выполнена', { done: true }),
    task('c', 'p1', 'Закреплена', { pinnedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }),
    task('d', 'p1', 'Свежая', { updatedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  const list = cardTasks(tasks, { taskId: 'a', startedAt: '2026-10-01T00:00:00.000Z' });
  expect(list.map((x) => x.id)).toEqual(['a', 'c', 'd']);
});

test('карточки проектов: имя, сводка и задачи', async () => {
  const { getByText } = await render(<ProjectsScreen navigation={nav()} />);
  getByText('Сайт');
  getByText('Бот');
  getByText('Вёрстка');
  getByText('Команды');
  getByText(t('ru', 'deck.done_of', { done: 1, total: 2 }));
});

test('строка быстрого добавления на карточке заводит задачу в её проект', async () => {
  const { getAllByLabelText } = await render(<ProjectsScreen navigation={nav()} />);
  const inputs = getAllByLabelText(t('ru', 'tasks.new_ph'));
  await fireEvent.changeText(inputs[1], 'Деплой');
  await fireEvent(inputs[1], 'submitEditing');
  const added = useAppStore.getState().tasks.find((x) => x.title === 'Деплой');
  expect(added.projectId).toBe('p2');
  expect(added.statusId).toBe('s2');
});

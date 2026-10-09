// Отметка задачи в карточке проекта (CardRow в screens/ProjectsScreen.js).
// Запуск: npm run test:mobile
//
// Галочка не убирает строку сразу: строка уменьшается и тает, и задача
// отмечается в колбэке конца анимации. На моке reanimated анимация
// заканчивается сразу — видно, что отметка идёт именно через неё, а строка
// при этом уже показывает галочку.
import { render, fireEvent } from '@testing-library/react-native';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import { useAppStore } from '../src/store/useAppStore';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: '2026-10-01T10:00:00.000Z',
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tags: [],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Макет')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});

test('галочка в карточке: строка уходит анимацией, задача отмечается по её окончании', async () => {
  const withTiming = jest.spyOn(require('react-native-reanimated'), 'withTiming');
  const toggleTaskDone = jest.fn();
  useAppStore.setState({ toggleTaskDone });
  const nav = { navigate: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) };
  const screen = await render(<ProjectsScreen navigation={nav} />);
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  // Уход — анимацией до нуля, с колбэком конца.
  expect(withTiming).toHaveBeenCalledWith(0, expect.anything(), expect.any(Function));
  expect(toggleTaskDone).toHaveBeenCalledWith('t1');
});

// Строка задачи на телефоне. Запуск: npm run test:mobile (из корня)
//
// Что показать в строке, решает ядро (taskRowView) — правило закрыто
// юнитами в tests/unit/views.test.js. Здесь проверяется другое: что
// телефон это решение рисует. Раньше он решал сам и не показывал ни версию,
// ни значок повторения, хотя десктоп показывал оба.
import { render } from '@testing-library/react-native';
import TaskListItem from '../src/components/TaskListItem';
import { useAppStore } from '../src/store/useAppStore';

const NOW = new Date().toISOString();

beforeEach(() => {
  useAppStore.setState({
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [
      { id: 'v1', projectId: 'p1', name: 'v1.3', releasedAt: null, order: 0 },
      { id: 'v2', projectId: 'p1', name: 'v1.2', releasedAt: NOW, order: 1 },
    ],
    activeTimer: null,
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
  });
});

const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1',
  totalMs: 0, sessions: [], done: false, ...over,
});

test('версия показывается в строке, как на десктопе', async () => {
  const { queryByText } = await render(<TaskListItem task={task({ versionId: 'v1' })} onPress={() => {}} />);
  expect(queryByText('v1.3')).not.toBeNull();
});

test('значок повторения показывается у задачи с правилом', async () => {
  const withRule = await render(<TaskListItem task={task({ repeat: { freq: 'day', every: 1 } })} onPress={() => {}} />);
  expect(withRule.queryByText('↻')).not.toBeNull();

  const without = await render(<TaskListItem task={task({ repeat: null })} onPress={() => {}} />);
  expect(without.queryByText('↻')).toBeNull();
});

test('без версии и правила лишнего не рисуется', async () => {
  const { queryByText } = await render(<TaskListItem task={task({})} onPress={() => {}} />);
  expect(queryByText('v1.3')).toBeNull();
  expect(queryByText('↻')).toBeNull();
  expect(queryByText('В работе')).not.toBeNull(); // статус на месте
  expect(queryByText('Вёрстка')).not.toBeNull();
});

test('задача без названия получает подпись из словаря на языке телефона', async () => {
  // Язык доходит до ядра через обёртку t: без неё вместо подписи был бы
  // сам ключ task.no_name.
  const ru = await render(<TaskListItem task={task({ title: '' })} onPress={() => {}} />);
  expect(ru.queryByText('Без названия')).not.toBeNull();

  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'en' } });
  const en = await render(<TaskListItem task={task({ title: '' })} onPress={() => {}} />);
  expect(en.queryByText('Untitled')).not.toBeNull();
});

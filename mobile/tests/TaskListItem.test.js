// Строка задачи на телефоне. Запуск: npm run test:mobile (из корня)
//
// Что показать в строке, решает ядро (taskRowView) — правило закрыто
// юнитами в tests/unit/views.test.js. Здесь проверяется другое: что
// телефон это решение рисует. Раньше он решал сам и не показывал ни версию,
// ни значок повторения, хотя десктоп показывал оба.
import { StyleSheet } from 'react-native';
import { render, within, fireEvent, act } from '@testing-library/react-native';
import TaskListItem from '../src/components/TaskListItem';
import { useAppStore } from '../src/store/useAppStore';
import { colors } from '../src/theme';

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

// Идёт таймер — в мете на месте статуса живые часы (RunningClock, свой тикер);
// отмеченная задача — серое «выполнено» вместо цветного статуса. Те же правила,
// что у строки ленты (TaskRow, tests/taskRowMeta.test.js): rowStatus в lib/statuses.js.
describe('мета: часы идущей задачи и серое «выполнено»', () => {
  const flat = (node) => StyleSheet.flatten(node.props.style) || {};
  const CLOCK = /^\d{2}:\d{2}:\d{2}$/;
  const DONE = { id: 's2', projectId: 'p1', name: 'Выполнено', color: '#69d345', kind: 'done', order: 1 };

  // colors из theme.js — тёмная палитра: тему тут приходится назначить, по
  // умолчанию она системная.
  beforeEach(() => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme: 'dark' } });
  });

  test('идёт таймер: часы на месте статуса, версия остаётся', async () => {
    useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - 65_000).toISOString(), heartbeatAt: new Date().toISOString() } });
    const s = await render(<TaskListItem task={task({ versionId: 'v1' })} onPress={() => {}} />);
    expect(s.getByTestId('task-clock-t1').props.children).toMatch(CLOCK);
    expect(s.getByTestId('task-clock-t1').props.children).toBe('00:01:05');
    expect(flat(s.getByTestId('task-clock-t1')).color).toBe(colors.accentInk);
    expect(s.queryByText('В работе')).toBeNull();
    expect(s.queryByTestId('task-dot-t1')).toBeNull();
    expect(s.queryByText('v1.3')).not.toBeNull();
  });

  test('идёт таймер в списке, сгруппированном по статусам (статус скрыт): часы всё равно видны', async () => {
    useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - 5_000).toISOString(), heartbeatAt: new Date().toISOString() } });
    const s = await render(<TaskListItem task={task()} showStatus={false} onPress={() => {}} />);
    expect(s.getByTestId('task-clock-t1').props.children).toMatch(CLOCK);
  });

  test('часы тикают без перерисовки строки', async () => {
    jest.useFakeTimers();
    try {
      useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - 65_000).toISOString(), heartbeatAt: new Date().toISOString() } });
      const s = await render(<TaskListItem task={task()} onPress={() => {}} />);
      expect(s.getByTestId('task-clock-t1').props.children).toBe('00:01:05');
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(s.getByTestId('task-clock-t1').props.children).toBe('00:01:07');
    } finally {
      jest.useRealTimers();
    }
  });

  test('галочка: статус сразу читает «Выполнено» серым — и текст, и точка', async () => {
    useAppStore.setState({ statuses: [...useAppStore.getState().statuses, DONE], tasks: [task()] });
    const s = await render(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
    expect(within(s.getByTestId('task-status-t1')).getByText('В работе')).toBeTruthy();
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe('#5ec8f2');

    await fireEvent.press(s.getByRole('checkbox'));
    expect(useAppStore.getState().tasks[0]).toMatchObject({ done: true, statusId: 's2' });
    await s.rerender(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);

    const label = within(s.getByTestId('task-status-t1')).getByText('Выполнено');
    expect(flat(label).color).toBe(colors.textFaint);
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe(colors.textFaint);
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).not.toBe(DONE.color);
  });

  test('нет статуса «готово» у проекта — подпись из словаря', async () => {
    const s = await render(<TaskListItem task={task({ done: true })} onPress={() => {}} />);
    expect(within(s.getByTestId('task-status-t1')).getByText('Выполнено')).toBeTruthy();
  });
});

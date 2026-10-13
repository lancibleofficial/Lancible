// Строка задачи (components/TaskRow.js — колода «Проекты», лента «Задачи»,
// «Сегодня»): под названием — статус и срок. Запуск: npm run test:mobile
//
// 12 октября из меты ушли «закреплена» (теперь булавка у названия и слово
// для чтения с экрана), версия и набранное время. Вместе с ними по ошибке ушёл
// и счётчик идущей задачи — просили убрать лишний текст, а не сами часы. Часы
// вернулись: пока таймер идёт, они стоят В МЕТЕ НА МЕСТЕ статуса, тикают
// (свой тикер, строка не перерисовывается), срок остаётся. Отмеченная задача
// (и только что отмеченная галочкой) показывает вместо цветного статуса серое
// «выполнено»: название — статуса «готово» проекта, иначе «Выполнено».
// Срок раскрашен как в списке проекта: просрочен — danger, в пределах суток —
// accentInk, дальше — тихий.
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, within, fireEvent, act } from '@testing-library/react-native';
import TaskRow, { taskRowMeta } from '../src/components/TaskRow';
import { useAppStore } from '../src/store/useAppStore';
import { colors } from '../src/theme';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const H = 3_600_000;
const inHours = (h) => new Date(Date.now() + h * H).toISOString();
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', versionId: 'v1', done: false, totalMs: 2 * H, tagIds: [],
  sessions: [{ start: inHours(-3), end: inHours(-1), ms: 2 * H }], dueAt: inHours(5), repeat: null, rate: null,
  pinnedAt: new Date(Date.now() - 60_000).toISOString(), notes: '', updatedAt: inHours(-1), ...over,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [{ id: 'v1', projectId: 'p1', name: 'v2.1', released: false }],
    tags: [],
    tasks: [task()],
    activeTimer: null,
  });
});

/** Подписи меты под названием, по порядку. */
const metaTexts = (s) => within(s.getByTestId('task-meta-t1')).queryAllByText(/./).map((n) => n.props.children).filter((x) => x !== '·');

test('стоит: только статус и срок — без «закреплена», версии и набранного времени', async () => {
  const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  const texts = metaTexts(s);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toBe('В работе');
  expect(texts[1]).toBe(taskRowMeta(useAppStore.getState().tasks[0], { statuses: useAppStore.getState().statuses, colors, lang: 'ru' })[1].text);
  expect(s.queryByText(t('ru', 'tasks.pinned_mark'))).toBeNull();
  expect(s.queryByText('v2.1')).toBeNull();
  expect(s.queryByText(/2\s?ч/)).toBeNull();
});

const CLOCK = /^\d{2}:\d{2}:\d{2}$/;
const runningTimer = (secondsAgo = 65) => ({ taskId: 't1', startedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(), heartbeatAt: new Date().toISOString() });

test('идёт таймер: в мете часы вместо статуса, срок остаётся; «стоп» на месте', async () => {
  useAppStore.setState({ activeTimer: runningTimer() });
  const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  const texts = metaTexts(s);
  // Часы (набранные 2 ч + идущие 1:05) и срок — а статуса нет ни текстом, ни точкой.
  expect(texts).toHaveLength(2);
  expect(texts[0]).toMatch(CLOCK);
  expect(texts[0]).toBe('02:01:05');
  expect(texts[1]).toBe(taskRowMeta(useAppStore.getState().tasks[0], { statuses: useAppStore.getState().statuses, colors, lang: 'ru' })[1].text);
  expect(s.queryByText('В работе')).toBeNull();
  expect(s.queryByTestId('task-dot-t1')).toBeNull();
  expect(s.queryByText(new RegExp(t('ru', 'task.running_now')))).toBeNull();
  expect(s.getByLabelText(t('ru', 'timer.stop'))).toBeTruthy();
  // Часы — акцентные (accentInk), полужирные (AppText ставит вес семейством), цифры одной ширины.
  expect(flat(s.getByTestId('task-clock-t1'))).toMatchObject({ color: colors.accentInk, fontFamily: 'Onest-SemiBold', fontVariant: ['tabular-nums'] });
});

test('часы идущей задачи тикают, а строка при этом не перерисовывается', async () => {
  jest.useFakeTimers();
  try {
    useAppStore.setState({ activeTimer: runningTimer() });
    const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
    expect(s.getByTestId('task-clock-t1').props.children).toBe('02:01:05');
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(s.getByTestId('task-clock-t1').props.children).toBe('02:01:08');
    // Остановили — часов нет, на их месте снова статус.
    await act(async () => { useAppStore.setState({ activeTimer: null }); });
    expect(s.queryByTestId('task-clock-t1')).toBeNull();
    expect(within(s.getByTestId('task-meta-t1')).queryByText('В работе')).not.toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('тикер — в часах, а не в строке: TaskRow сам useTicker не зовёт', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'TaskRow.js'), 'utf8');
  expect(src).not.toMatch(/useTicker/);
  expect(readFileSync(join(__dirname, '..', 'src', 'components', 'RunningClock.js'), 'utf8')).toMatch(/useTicker\(true\)/);
});

test('идёт таймер, лента: плашка проекта, часы, срок', async () => {
  useAppStore.setState({ activeTimer: runningTimer(5) });
  const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} showProject onPress={() => {}} />);
  const texts = metaTexts(s);
  expect(texts[0]).toBe('Сайт');
  expect(texts[1]).toMatch(CLOCK);
  expect(texts).toHaveLength(3);
});

describe('отмеченная задача: серое «выполнено»', () => {
  const DONE = { id: 's2', projectId: 'p1', name: 'Выполнено', color: '#69d345', kind: 'done', order: 1 };
  const withDone = () => useAppStore.setState({ statuses: [...useAppStore.getState().statuses, DONE] });

  test('галочка: мета сразу читает «Выполнено» серым — и текст, и точка, не зелёным «готово»', async () => {
    withDone();
    const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
    expect(metaTexts(s)[0]).toBe('В работе');
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe('#5ec8f2');

    await fireEvent.press(s.getByRole('checkbox'));
    expect(useAppStore.getState().tasks[0]).toMatchObject({ done: true, statusId: 's2' });
    await s.rerender(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);

    const texts = metaTexts(s);
    // Срока у выполненной нет; остался один статус.
    expect(texts).toEqual(['Выполнено']);
    const label = within(s.getByTestId('task-meta-t1')).getByText('Выполнено');
    expect(flat(label).color).toBe(colors.textFaint);
    expect(flat(label).color).not.toBe(DONE.color);
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe(colors.textFaint);
  });

  test('галочка нажата, а в сторе ещё нет (колода): «выполнено» уже в мете', async () => {
    withDone();
    const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} checked onPress={() => {}} />);
    expect(metaTexts(s)).toEqual(['Выполнено']);
    expect(flat(within(s.getByTestId('task-meta-t1')).getByText('Выполнено')).color).toBe(colors.textFaint);
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe(colors.textFaint);
  });

  test('отмеченная — всегда «Выполнено» из словаря, как бы ни звался завершающий статус', async () => {
    const noDone = await render(<TaskRow task={useAppStore.getState().tasks[0]} checked onPress={() => {}} />);
    expect(metaTexts(noDone)).toEqual([t('ru', 'tasks.done_group')]);
    expect(t('ru', 'tasks.done_group')).toBe('Выполнено');

    // Свой «готово» с другим именем (и английское «Done» по умолчанию) подпись не меняет.
    await act(async () => { useAppStore.setState({ statuses: [...useAppStore.getState().statuses, DONE, { ...DONE, id: 's3', name: 'Сдано', order: 2 }] }); });
    const own = await render(<TaskRow task={task({ statusId: 's3', done: true })} onPress={() => {}} />);
    expect(metaTexts(own)).toEqual(['Выполнено']);
    const first = await render(<TaskRow task={task({ statusId: 's1', done: true })} onPress={() => {}} />);
    expect(metaTexts(first)).toEqual(['Выполнено']);
  });

  test('правило одно на чистую функцию: серый токен, названия, срока нет', () => {
    withDone();
    const ctx = { statuses: useAppStore.getState().statuses, colors, lang: 'ru' };
    expect(taskRowMeta(task(), ctx).map((m) => [m.key, m.text, m.color])).toEqual([['status', 'В работе', colors.textDim], ['due', expect.any(String), colors.accentInk]]);
    expect(taskRowMeta(task(), { ...ctx, done: true })).toEqual([{ key: 'status', text: 'Выполнено', color: colors.textFaint, dot: colors.textFaint }]);
  });
});

test('в ленте: плашка проекта остаётся (по ней видно, чья задача), мета — те же два', async () => {
  const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} showProject onPress={() => {}} />);
  const texts = metaTexts(s);
  expect(texts).toEqual(['Сайт', 'В работе', texts[2]]);
  expect(texts).toHaveLength(3);
});

test('нет статуса и срока — меты нет совсем', async () => {
  const bare = task({ statusId: null, dueAt: null });
  const s = await render(<TaskRow task={bare} onPress={() => {}} />);
  expect(s.queryByTestId('task-meta-t1')).toBeNull();
});

test('срок раскрашен как в списке проекта: просрочен — danger, сутки — accentInk, дальше — тихий', () => {
  const ctx = { statuses: useAppStore.getState().statuses, colors, lang: 'ru' };
  const due = (dueAt) => taskRowMeta(task({ dueAt }), ctx).find((m) => m.key === 'due');
  expect(due(inHours(-2)).color).toBe(colors.danger);
  expect(due(inHours(5)).color).toBe(colors.accentInk);
  expect(due(inHours(24 * 5)).color).toBe(colors.textFaint);
  // Цвет всегда задан токеном (раньше «скоро» брал несуществующий colors.warn).
  for (const m of [due(inHours(-2)), due(inHours(5)), due(inHours(24 * 5))]) expect(m.color).toBeTruthy();
  // У выполненной срока нет.
  expect(taskRowMeta(task({ done: true }), ctx).map((m) => m.key)).toEqual(['status']);
});

test('цвет срока доходит до строки', async () => {
  useAppStore.setState({ tasks: [task({ dueAt: inHours(-2) })] });
  const s = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  const dueNode = within(s.getByTestId('task-meta-t1')).queryAllByText(/./).filter((n) => n.props.children !== '·').at(-1);
  expect(flat(dueNode).color).toBe(colors.danger);
});

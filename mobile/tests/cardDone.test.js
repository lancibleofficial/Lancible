// Выполненные задачи в карточке проекта (CardRow, ProjectCard в
// screens/ProjectsScreen.js). Запуск: npm run test:mobile
//
// Решение пользователя: выполненные видны и в карточках колоды — внизу, под
// активными, серые и зачёркнутые, как в ленте (вид даёт TaskRow); мета строки
// по-прежнему только статус и срок. У карточки нет предела по числу строк (у
// неё своя прокрутка), поэтому «активные первыми, выполненные в оставшемся
// месте» — это просто порядок: активные, потом выполненные.
//
// Галочка не переставляет строку сразу: налив с «попом» и брызгами (LiquidCheck)
// виден до конца (LIQUID.check), потом задача отмечается, и строка уезжает
// вниз к выполненным (layout списка колоды). Снятая отметка — строка сразу
// наверх. «Уменьшение движения» — отметка сразу.
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import ProjectsScreen, { cardDoneTasks, cardTasks, cardCancelledTasks } from '../src/screens/ProjectsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID } from '../src/lib/liquid';
import { t } from '../src/lib/i18n';
import { colors } from '../src/theme';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const task = (id, title, over = {}) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: '2026-10-01T10:00:00.000Z', ...over,
});
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) });
const order = (q) => q.getAllByText(/^(Вёрстка|Макет|Релиз|Старт|Отмена)$/).map((n) => n.props.children);
const checks = (q) => q.getAllByRole('checkbox').map((n) => n.props.accessibilityState.checked);

beforeEach(() => {
  jest.useFakeTimers();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#69d345', kind: 'done', order: 1 },
    ],
    tags: [],
    tasks: [
      // Свежая отметка у «Старт» нарочно старше, чем у «Релиз»: выполненные — по свежести.
      task('a', 'Вёрстка'),
      task('b', 'Макет', { updatedAt: '2026-10-01T09:00:00.000Z' }),
      task('d', 'Старт', { done: true, statusId: 's2', updatedAt: '2026-08-01T00:00:00.000Z' }),
      task('c', 'Релиз', { done: true, statusId: 's2', updatedAt: '2026-09-01T00:00:00.000Z', dueAt: '2026-01-01T10:00:00.000Z' }),
    ],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('cardDoneTasks: только выполненные, свежеотмеченные выше; cardTasks их по-прежнему не даёт', () => {
  const tasks = useAppStore.getState().tasks;
  expect(cardDoneTasks(tasks).map((x) => x.id)).toEqual(['c', 'd']);
  expect(cardTasks(tasks, null).map((x) => x.id)).toEqual(['a', 'b']);
});

test('выполненные — внизу карточки, под активными', async () => {
  const q = await render(<ProjectsScreen navigation={nav()} />);
  expect(order(q)).toEqual(['Вёрстка', 'Макет', 'Релиз', 'Старт']);
  // «2/4» в шапке считает те же выполненные.
  q.getByText('2/4');
});

test('выполненная серая и зачёркнутая, с галочкой; срока в мете нет', async () => {
  const q = await render(<ProjectsScreen navigation={nav()} />);
  expect(flat(q.getByText('Релиз')).textDecorationLine).toBe('line-through');
  expect(flat(q.getByText('Вёрстка')).textDecorationLine).not.toBe('line-through');
  expect(checks(q)).toEqual([false, false, true, true]);
  // Мета выполненной — серое «Выполнено», без срока (у «Релиз» он просрочен).
  expect(q.getAllByText(t('ru', 'tasks.done_group')).length).toBeGreaterThanOrEqual(2);
  expect(q.queryByText(t('ru', 'due.overdue'), { exact: false })).toBeNull();
});

test('галочка: задача отмечается в тот же миг — шкала, «3/4» и мета не ждут, — а строка стоит, пока налив играет, и потом уезжает вниз', async () => {
  const q = await render(<ProjectsScreen navigation={nav()} />);
  q.getByLabelText(`${t('ru', 'project.progress')} 50%`);
  await fireEvent.press(q.getAllByRole('checkbox')[0]);
  // В тот же миг: задача отмечена в сторе, цель шкалы и «3/4» уже новые, в
  // мете серое «Выполнено» (у трёх строк: две прежние и эта).
  expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
  q.getByText('3/4');
  q.getByLabelText(`${t('ru', 'project.progress')} 75%`);
  expect(q.getAllByText(t('ru', 'tasks.done_group'))).toHaveLength(3);
  // Строка — на старом месте, галочка налита, переезд к концу налива уже задан.
  expect(checks(q)[0]).toBe(true);
  expect(order(q)).toEqual(['Вёрстка', 'Макет', 'Релиз', 'Старт']);
  await act(async () => { jest.advanceTimersByTime(LIQUID.check.duration - 20); });
  expect(order(q)).toEqual(['Вёрстка', 'Макет', 'Релиз', 'Старт']);
  // Налив кончился: строка уезжает — только что отмеченная первая среди выполненных.
  await act(async () => { jest.advanceTimersByTime(40); });
  expect(order(q)).toEqual(['Макет', 'Вёрстка', 'Релиз', 'Старт']);
  expect(checks(q)).toEqual([false, true, true, true]);
  q.getByText('3/4');
});

test('второе нажатие, пока налив играет, ничего не меняет: задача отмечается один раз', async () => {
  const q = await render(<ProjectsScreen navigation={nav()} />);
  const check = () => q.getAllByRole('checkbox')[0];
  await fireEvent.press(check());
  await fireEvent.press(check());
  expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
  await act(async () => { jest.advanceTimersByTime(LIQUID.check.duration + 20); });
  expect(order(q)).toEqual(['Макет', 'Вёрстка', 'Релиз', 'Старт']);
  q.getByText('3/4');
});

describe('отменённые — самый низ карточки', () => {
  const CANCELLED = { id: 's3', projectId: 'p1', name: 'Cancelled', color: '#8a93a5', kind: 'cancelled', order: 2 };
  const withCancelled = () => useAppStore.setState({
    statuses: [...useAppStore.getState().statuses, CANCELLED],
    tasks: [...useAppStore.getState().tasks, task('e', 'Отмена', { statusId: 's3', cancelled: true, updatedAt: '2026-09-15T00:00:00.000Z' })],
  });
  const ALL = ['Вёрстка', 'Макет', 'Релиз', 'Старт', 'Отмена'];

  test('cardCancelledTasks: только отменённые, свежие выше; в активных и выполненных их нет', () => {
    withCancelled();
    const { tasks, statuses } = useAppStore.getState();
    const more = [...tasks, task('f', 'Позже', { statusId: 's3', cancelled: true, updatedAt: '2026-09-20T00:00:00.000Z' })];
    expect(cardCancelledTasks(more, statuses).map((x) => x.id)).toEqual(['f', 'e']);
    expect(cardTasks(more, null, statuses).map((x) => x.id)).toEqual(['a', 'b']);
    expect(cardDoneTasks(more).map((x) => x.id)).toEqual(['c', 'd']);
    // Без статусов отменённую узнают по флагу задачи.
    expect(cardCancelledTasks(more, []).map((x) => x.id)).toEqual(['f', 'e']);
  });

  test('после выполненных: серый крестик вместо галочки, название серое и не зачёркнутое, мета — «Отменено»', async () => {
    withCancelled();
    const q = await render(<ProjectsScreen navigation={nav()} />);
    expect(order(q)).toEqual(ALL);
    // Галочек четыре — у отменённой её нет; на её месте крестик-кнопка.
    expect(checks(q)).toEqual([false, false, true, true]);
    q.getByLabelText(t('ru', 'task.reopen'));
    expect(q.getAllByTestId('cross-layer')).toHaveLength(1);
    const title = flat(q.getByText('Отмена'));
    expect(title.color).toBe(colors.textFaint);
    expect(title.textDecorationLine).not.toBe('line-through');
    q.getByText(t('ru', 'status.kind_cancelled'));
    // «2/5» считает только выполненные.
    q.getByText('2/5');
  });

  test('крестик нажали — задача возвращается в работу и строка уезжает наверх, к активным', async () => {
    withCancelled();
    const q = await render(<ProjectsScreen navigation={nav()} />);
    await fireEvent.press(q.getByLabelText(t('ru', 'task.reopen')));
    expect(useAppStore.getState().tasks.find((x) => x.id === 'e')).toMatchObject({ statusId: 's1', done: false, cancelled: false });
    expect(order(q)).toEqual(['Отмена', 'Вёрстка', 'Макет', 'Релиз', 'Старт']);
    expect(checks(q)).toEqual([false, false, false, true, true]);
  });
});

test('снять отметку у выполненной — строка сразу наверх, к активным', async () => {
  const q = await render(<ProjectsScreen navigation={nav()} />);
  await fireEvent.press(q.getAllByRole('checkbox')[2]);
  expect(useAppStore.getState().tasks.find((x) => x.id === 'c').done).toBe(false);
  expect(order(q)).toEqual(['Релиз', 'Вёрстка', 'Макет', 'Старт']);
  q.getByText('1/4');
});

test('«уменьшение движения» — отметка сразу, без налива', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const q = await render(<ProjectsScreen navigation={nav()} />);
  await fireEvent.press(q.getAllByRole('checkbox')[0]);
  expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
  expect(order(q)).toEqual(['Макет', 'Вёрстка', 'Релиз', 'Старт']);
});

test('в проекте только выполненные — они видны, пустого экрана нет', async () => {
  useAppStore.setState({ tasks: useAppStore.getState().tasks.filter((x) => x.done) });
  const q = await render(<ProjectsScreen navigation={nav()} />);
  expect(order(q)).toEqual(['Релиз', 'Старт']);
  expect(q.queryByText(t('ru', 'deck.no_tasks'))).toBeNull();
});

// «Сегодня»: строки задач в «Сроках» и «Недавних» (TodayRow в
// screens/HomeScreen.js, lib/rowExit.js). Запуск: npm run test:mobile
//
// Просили: «на "Сегодня" нет анимации исчезновения задач». Задача, выпавшая из
// списка (её отметили), раньше пропадала в одном кадре, а соседи прыгали. Теперь:
//
// - у каждой строки есть layout (переезд соседей — MOVE, он стоит, пока он
//   нужен) и exiting (rowExit: уменьшается, тает и схлопывается по высоте);
// - галочка наливается с «попом» и брызгами (LiquidCheck), а задача
//   отмечается в тот же миг (hold.markNow): строка стоит на месте, пока играет
//   налив (LIQUID.check.duration), потом уходит, соседи подъезжают; layout
//   соседей стоит с нажатия;
// - порядок по-прежнему не прыгает, пока человек на странице: запуск таймера
//   его не двигает, отметка убирает только саму задачу;
// - «уменьшение движения» — ни layout, ни exiting, отметка сразу.
import { act, fireEvent, render, within } from '@testing-library/react-native';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import { MOVE } from '../src/hooks/useOrderHold';
import HomeScreen from '../src/screens/HomeScreen';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID } from '../src/lib/liquid';
import { rowExit, ROW_EXIT_MS } from '../src/lib/rowExit';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

const H = 3_600_000;
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const soon = () => new Date(Date.now() + 2 * H).toISOString();
const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), addListener: jest.fn(() => () => {}) });
const open = () => render(<HomeScreen navigation={nav()} route={{ params: {} }} />);

const task = (id, title, over = {}) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, tagIds: [], dueAt: null, sessions: [],
  pinnedAt: null, notes: '', updatedAt: at(8), ...over,
});
const rec = (from, to) => ({ start: at(from), end: at(to), ms: (to - from) * H });
const row = (q, id) => q.queryByTestId(`today-row-${id}`);
const box = (q, id) => row(q, id).props;
const doneOf = (id) => useAppStore.getState().tasks.find((x) => x.id === id).done;
const ids = (q, re) => q.queryAllByTestId(re).map((n) => n.props.testID.replace('today-row-', ''));

beforeEach(() => {
  jest.useFakeTimers();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#69d345', kind: 'done', order: 1 },
    ],
    tags: [],
    tasks: [
      // «Сроки»: две задачи со сроком в ближайшие часы.
      task('d1', 'Релиз', { dueAt: soon() }),
      task('d2', 'Отчёт', { dueAt: soon() }),
      // «Недавние»: свежая r3 — остров «последняя задача», r2 и r1 — строки списка.
      task('r1', 'Вёрстка', { sessions: [rec(8, 9)], totalMs: H, updatedAt: at(9) }),
      task('r2', 'Макет', { sessions: [rec(9, 10)], totalMs: H, updatedAt: at(10) }),
      task('r3', 'Тесты', { sessions: [rec(10, 11)], totalMs: H, updatedAt: at(11) }),
    ],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('rowExit: уменьшается, тает и схлопывается по высоте, а не исчезает в одном кадре', () => {
  const anim = rowExit({ currentHeight: 64 });
  expect(anim.initialValues).toMatchObject({ opacity: 1, height: 64 });
  expect(Object.keys(anim.animations)).toEqual(expect.arrayContaining(['opacity', 'height', 'transform']));
  expect(ROW_EXIT_MS).toBeGreaterThanOrEqual(180);
  expect(ROW_EXIT_MS).toBeLessThanOrEqual(300);
});

test('у строк «Сроков» и «Недавних» есть exiting; layout не стоит, пока он не нужен', async () => {
  const q = await open();
  for (const id of ['d1', 'd2', 'r1', 'r2']) {
    expect(row(q, id)).toBeTruthy();
    expect(box(q, id).exiting).toBe(rowExit);
    expect(box(q, id).layout).toBeUndefined();
  }
  // Остров «последняя задача» — r3, в списках её нет.
  expect(row(q, 'r3')).toBeNull();
});

test('галочка у срока: задача отмечается сразу, строка стоит до конца налива, потом уходит — соседи подъезжают', async () => {
  const q = await open();
  await fireEvent.press(within(row(q, 'd1')).getByRole('checkbox'));
  // В тот же миг: галочка налита, а задача уже отмечена в сторе; строка пока на месте,
  // и layout переезда у соседей стоит уже сейчас — к уходу строки он в фиксации.
  expect(within(row(q, 'd1')).getByRole('checkbox').props.accessibilityState.checked).toBe(true);
  expect(doneOf('d1')).toBe(true);
  expect(row(q, 'd1')).toBeTruthy();
  expect(box(q, 'd2').layout).toBe(MOVE);

  // Налив идёт — строка всё ещё на месте.
  await wait(LIQUID.check.duration - 20);
  expect(row(q, 'd1')).toBeTruthy();

  // Налив кончился: строка выпала из списка и уходит (exiting), соседняя осталась и едет (layout).
  await wait(40);
  expect(row(q, 'd1')).toBeNull();
  expect(box(q, 'd2').layout).toBe(MOVE);
  expect(box(q, 'd2').exiting).toBe(rowExit);
  // Переезд кончился — layout снят.
  await wait(1500);
  expect(box(q, 'd2').layout).toBeUndefined();
});

test('галочка у недавней: то же — уходит строка, остальные на местах', async () => {
  const q = await open();
  expect(ids(q, /^today-row-r/)).toEqual(['r2', 'r1']);
  await fireEvent.press(within(row(q, 'r2')).getByRole('checkbox'));
  expect(doneOf('r2')).toBe(true);
  expect(row(q, 'r2')).toBeTruthy();
  await wait(LIQUID.check.duration + 10);
  expect(row(q, 'r2')).toBeNull();
  expect(ids(q, /^today-row-r/)).toEqual(['r1']);
  expect(box(q, 'r1').layout).toBe(MOVE);
});

test('второе нажатие, пока идёт налив, ничего не ломает: задача отмечается один раз', async () => {
  const q = await open();
  const check = within(row(q, 'd1')).getByRole('checkbox');
  await fireEvent.press(check);
  await fireEvent.press(check);
  expect(doneOf('d1')).toBe(true);
  await wait(LIQUID.check.duration + 10);
  expect(doneOf('d1')).toBe(true);
  expect(row(q, 'd1')).toBeNull();
});

test('порядок не прыгает: запуск таймера и отметка двигают только отмеченную строку', async () => {
  const q = await open();
  expect(ids(q, /^today-row-r/)).toEqual(['r2', 'r1']);
  // Таймер пошёл на странице: идущая в «последних» стала бы первой, но строки стоят.
  await act(async () => {
    useAppStore.setState({ activeTimer: { taskId: 'r1', startedAt: new Date(Date.now() - 300_000).toISOString(), heartbeatAt: new Date().toISOString() } });
  });
  expect(ids(q, /^today-row-r/)).toEqual(['r2', 'r1']);
  expect(ids(q, /^today-row-d/)).toEqual(['d1', 'd2']);
  await fireEvent.press(within(row(q, 'd1')).getByRole('checkbox'));
  await wait(LIQUID.check.duration + 10);
  expect(doneOf('d1')).toBe(true);
  expect(ids(q, /^today-row-d/)).toEqual(['d2']);
  expect(ids(q, /^today-row-r/)).toEqual(['r2', 'r1']);
});

test('«уменьшение движения» — ни layout, ни exiting, отметка сразу', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const q = await open();
  for (const id of ['d1', 'd2', 'r1', 'r2']) {
    expect(box(q, id).exiting).toBeUndefined();
    expect(box(q, id).layout).toBeUndefined();
  }
  await fireEvent.press(within(row(q, 'd1')).getByRole('checkbox'));
  // Без налива и ожидания: задача отмечена, строки нет.
  expect(doneOf('d1')).toBe(true);
  expect(row(q, 'd1')).toBeNull();
  expect(box(q, 'd2').layout).toBeUndefined();
});

test('повторяющаяся задача после отметки остаётся в списке со следующим сроком — галочка стекает обратно', async () => {
  const early = new Date();
  early.setHours(0, 30, 0, 0);
  useAppStore.setState({
    tasks: useAppStore.getState().tasks.map((x) => (x.id === 'd1'
      ? { ...x, dueAt: early.toISOString(), repeat: { freq: 'day', every: 1 } }
      : x)),
  });
  const q = await open();
  await fireEvent.press(within(row(q, 'd1')).getByRole('checkbox'));
  // Отметка прошла сразу, и правило тут же вернуло задачу со следующим сроком; а
  // строка держится на месте с налитой галочкой до конца налива.
  expect(doneOf('d1')).toBe(false);
  expect(within(row(q, 'd1')).getByRole('checkbox').props.accessibilityState.checked).toBe(true);
  await wait(LIQUID.check.duration + 10);
  // Налив кончился: строка на месте, галочка стекает — не отмечена.
  expect(doneOf('d1')).toBe(false);
  expect(new Date(useAppStore.getState().tasks.find((x) => x.id === 'd1').dueAt).getTime()).toBeGreaterThan(Date.now());
  expect(row(q, 'd1')).toBeTruthy();
  expect(within(row(q, 'd1')).getByRole('checkbox').props.accessibilityState.checked).toBe(false);
});

describe('отменённые задачи на «Сегодня» не показываются', () => {
  const CANCELLED = { id: 's3', projectId: 'p1', name: 'Cancelled', color: '#8a93a5', kind: 'cancelled', order: 2 };
  const cancel = (id) => useAppStore.setState({
    statuses: useAppStore.getState().statuses.some((x) => x.id === 's3') ? useAppStore.getState().statuses : [...useAppStore.getState().statuses, CANCELLED],
    tasks: useAppStore.getState().tasks.map((x) => (x.id === id ? { ...x, statusId: 's3', cancelled: true } : x)),
  });

  test('ни в «Сроках», ни в «Недавних»: сроку и недавней нет строки', async () => {
    cancel('d1');
    cancel('r1');
    const q = await open();
    expect(ids(q, /^today-row-d/)).toEqual(['d2']);
    expect(ids(q, /^today-row-r/)).toEqual(['r2']);
  });

  test('задача стала отменённой, пока строка на виду, — она уходит, как выполненная', async () => {
    const q = await open();
    expect(row(q, 'd1')).toBeTruthy();
    await act(async () => { cancel('d1'); });
    expect(row(q, 'd1')).toBeNull();
    expect(box(q, 'd2').exiting).toBe(rowExit);
    expect(ids(q, /^today-row-d/)).toEqual(['d2']);
  });
});

// Порядок строк на телефоне (hooks/useOrderHold.js). Запуск: npm run test:mobile
//
// Просили: «включаешь задачу — она резко прыгает вверх списка». Правило то же,
// что на вебе (Core.holdOrder, закрыто tests/unit/views.test.js), а здесь
// проверяется, что экраны его применяют:
//
// - запуск таймера порядок не меняет — ни в колоде «Проекты», ни на
//   «Сегодня» (остров последней задачи и проекты дня), ни в ленте «Задачи»
//   (идущая не уходит в «Сейчас»); любая правка, пока таймер идёт, тоже ждёт
//   остановки;
// - остановка — строки встают по обычному правилу, а у списка есть layout
//   (itemLayoutAnimation у Animated.FlatList, layout у Animated.View): на моке
//   reanimated это сам MOVE, то есть переезд задан; закончился — снят;
// - уход с экрана (blur навигации): порядок пересчитан, а layout в этот момент
//   не задан — Reanimated берёт конфиг из предыдущей фиксации, и строки
//   встают на места без движения; возврат (focus) ничего не двигает;
// - «уменьшение движения» — layout нет вовсе, строки встают сразу;
// - страница проекта от таймера не зависит: порядок до запуска, после
//   запуска и после остановки один.
import { useRef } from 'react';
import { render, renderHook, fireEvent, act, within } from '@testing-library/react-native';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import { MOVE, MOVE_MS } from '../src/hooks/useOrderHold';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import HomeScreen from '../src/screens/HomeScreen';
import TasksScreen from '../src/screens/TasksScreen';
import ProjectScreen from '../src/screens/ProjectScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';
import { LIQUID } from '../src/lib/liquid';

// Заметки задачи — WebView с нативной частью; для порядка строк не нужны.
jest.mock('../src/components/DocEditor', () => () => null);

/** Навигация с событиями: emit('blur') / emit('focus') — как у навигатора. */
function makeNav() {
  const subs = {};
  return {
    navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), getState: () => ({ routes: [], index: 0 }),
    addListener: (name, fn) => { (subs[name] = subs[name] || new Set()).add(fn); return () => subs[name].delete(fn); },
    emit: (name) => act(async () => { for (const fn of [...(subs[name] || [])]) fn({}); }),
  };
}

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;
/** Таймер пошёл (пять минут назад: остановка запишет сессию и обновит задачу). */
const run = (taskId) => act(async () => {
  useAppStore.setState({ activeTimer: { taskId, startedAt: ago(5), heartbeatAt: ago(0) } });
});
const stop = () => act(async () => { useAppStore.getState().stopTimer(); });
const touch = (id) => act(async () => { useAppStore.getState().updateTask(id, { notes: 'правка' }); });
const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });

/** layout / itemLayoutAnimation каждого списка Animated.FlatList на экране. */
function listLayouts(screen) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.props && 'itemLayoutAnimation' in node.props) out.push(node.props.itemLayoutAnimation);
    walk(node.children);
  }(screen.toJSON()));
  return out;
}

beforeEach(() => {
  jest.useFakeTimers();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null, quickAddProjectId: null, boardVersion: {}, listCollapsed: {}, boardCollapsed: {} },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('переезд — 350–400 мс, спокойный ease out', () => {
  expect(MOVE_MS).toBeGreaterThanOrEqual(180);
  expect(MOVE_MS).toBeLessThanOrEqual(260);
  expect(MOVE).toBeTruthy();
});

// --- сам хук: когда конфиг переезда стоит, а когда строки переставлены --------

// Reanimated берёт layout из предыдущей фиксации: что задано при перестановке
// строк, играет; что задано только в этой же отрисовке, не успевает. Поэтому
// порядок хука определяется по отрисовкам подряд: перестановка с движением
// идёт только там, где layout стоял уже в прошлой отрисовке, а без движения —
// только там, где он снят уже в прошлой.
describe('хук: конфиг переезда и перестановка строк — разными отрисовками', () => {
  const { useOrderHold } = require('../src/hooks/useOrderHold');
  // Как «недавние»: пока таймер ни разу не шёл, «x» последняя; с запуском «x» —
  // идущая и первая по обычному правилу, и после остановки остаётся первой.
  function Probe({ navigation, log }) {
    const hold = useOrderHold(navigation);
    const ran = useRef(false);
    if (useAppStore((s) => !!s.activeTimer)) ran.current = true;
    const list = (ran.current ? ['x', 'a', 'b'] : ['a', 'b', 'x']).map((id) => ({ id }));
    log.push({ layout: hold.layout, ids: hold.rows('l', list).map((r) => r.id).join('') });
    return null;
  }
  /** Первая отрисовка с таким порядком, считая с from. */
  const first = (log, ids, from = 0) => log.findIndex((e, i) => i >= from && e.ids === ids);

  test('остановка: строки переставлены в отрисовке, где layout стоял и в предыдущей', async () => {
    const log = [];
    await render(<Probe navigation={makeNav()} log={log} />);
    await run('x');
    // Запуск строки не двинул, а конфиг переезда уже стоит — к остановке.
    expect(log.at(-1)).toEqual({ layout: MOVE, ids: 'abx' });
    await wait(1000);
    const before = log.length;
    await stop();
    const k = first(log, 'xab', before - 1);
    expect(k).toBeGreaterThan(0);
    expect(log[k].layout).toBe(MOVE);
    expect(log[k - 1].layout).toBe(MOVE);
  });

  test('уход с экрана: строки переставлены в отрисовке, где layout снят и в предыдущей', async () => {
    const nav = makeNav();
    const log = [];
    await render(<Probe navigation={nav} log={log} />);
    await run('x');
    expect(log.at(-1).ids).toBe('abx');
    await nav.emit('blur');
    const k = first(log, 'xab');
    expect(k).toBeGreaterThan(0);
    expect(log[k].layout).toBeUndefined();
    expect(log[k - 1].layout).toBeUndefined();
    // Возврат ничего не двигает, а к остановке конфиг уже стоит.
    const before = log.length;
    await nav.emit('focus');
    expect(log.slice(before - 1).every((e) => e.ids === 'xab')).toBe(true);
    expect(log.at(-1)).toEqual({ layout: MOVE, ids: 'xab' });
  });
});

// --- markNow: правка сразу, строка — на старом месте до конца налива -----------

// Просили: «шкала заполняется с задержкой». Раньше галочка сначала играла налив
// и только потом отмечала задачу, и шкала, статус и счётчики менялись на ~0,3 с
// позже нажатия. Теперь правка идёт в тот же миг, а на месте остаётся только
// сама строка: view(tasks) отдаёт задачу прежней, пока она держится.
describe('хук: markNow — правка сразу, строка на месте до конца налива', () => {
  const { useOrderHold, MARK_MS, ARM_MS } = require('../src/hooks/useOrderHold');
  const before = { id: 't1', title: 'Вёрстка', done: false };
  const stored = [{ ...before, done: true }, { id: 't2', title: 'Макет', done: false }];

  test('правка — сразу; view держит прежнюю задачу, layout стоит с нажатия; по концу — отпускает и «поверх»', async () => {
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(null));
    expect(result.current.layout).toBeUndefined();
    expect(result.current.view(stored)).toBe(stored); // ничего не держится — тот же массив
    await act(async () => { result.current.markNow(change, before); });

    expect(change).toHaveBeenCalledTimes(1);
    // Строка держится прежней, остальные — как в сторе.
    expect(result.current.holding).toBe(true);
    expect(result.current.marked('t1')).toBe(true);
    expect(result.current.view(stored)[0]).toBe(before);
    expect(result.current.view(stored)[1]).toBe(stored[1]);
    // Конфиг переезда уже стоит — к отпусканию он в предыдущей фиксации; «поверх» ещё нет.
    expect(result.current.layout).toBe(MOVE);
    expect(result.current.rising).toBeNull();

    await wait(MARK_MS - 10);
    expect(result.current.marked('t1')).toBe(true);
    await wait(20);
    expect(result.current.marked('t1')).toBe(false);
    expect(result.current.holding).toBe(false);
    expect(result.current.view(stored)).toBe(stored);
    expect(result.current.rising).toBe('t1');
    expect(result.current.layout).toBe(MOVE);

    // Переезд кончился — layout и «поверх» сняты.
    await wait(1500);
    expect(result.current.layout).toBeUndefined();
    expect(result.current.rising).toBeNull();
    // Налив — это LIQUID.check, а не свои числа; ARM_MS к нему отношения не имеет.
    expect(MARK_MS).toBe(LIQUID.check.duration);
    expect(ARM_MS).toBeLessThan(MARK_MS);
  });

  test('второе нажатие, пока строка держится, ничего не делает', async () => {
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(null));
    await act(async () => { result.current.markNow(change, before); });
    await act(async () => { result.current.markNow(change, before); });
    expect(change).toHaveBeenCalledTimes(1);
    await wait(MARK_MS + 10);
    // Отпущена — можно снова.
    await act(async () => { result.current.markNow(change, before); });
    expect(change).toHaveBeenCalledTimes(2);
  });

  test('своё время держания: markNow(change, task, ms)', async () => {
    const { result } = await renderHook(() => useOrderHold(null));
    await act(async () => { result.current.markNow(jest.fn(), before, 700); });
    await wait(MARK_MS + 100);
    expect(result.current.marked('t1')).toBe(true);
    await wait(700 - MARK_MS);
    expect(result.current.marked('t1')).toBe(false);
  });

  test('«уменьшение движения»: правка сразу, ничего не держится, layout нет', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(null));
    await act(async () => { result.current.markNow(change, before); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(result.current.holding).toBe(false);
    expect(result.current.layout).toBeUndefined();
  });

  test('не в фокусе: правка сразу, ничего не держится', async () => {
    const nav = makeNav();
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(nav));
    await nav.emit('blur');
    await act(async () => { result.current.markNow(change, before); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(result.current.holding).toBe(false);
  });

  test('ушли с экрана, пока строка держится: отпущена без движения', async () => {
    const nav = makeNav();
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(nav));
    await act(async () => { result.current.markNow(change, before); });
    expect(result.current.holding).toBe(true);
    await nav.emit('blur');
    expect(result.current.holding).toBe(false);
    expect(result.current.layout).toBeUndefined();
    expect(result.current.rising).toBeNull();
    // Отложенное отпускание потом ничего не поднимает.
    await wait(MARK_MS + 50);
    expect(result.current.rising).toBeNull();
  });
});

// --- moveSoon: правка через ARM_MS, второе нажатие её не удваивает ------------

describe('хук: moveSoon — второе нажатие, пока правка ждёт, ничего не делает', () => {
  const { useOrderHold, ARM_MS } = require('../src/hooks/useOrderHold');

  test('два нажатия за ARM_MS — одна правка; прошла — можно снова; другая строка не ждёт', async () => {
    // Закрепление свайпом: двойной тап закреплял и тут же откреплял строку.
    const change = jest.fn();
    const other = jest.fn();
    const { result } = await renderHook(() => useOrderHold(null));
    await act(async () => { result.current.moveSoon(change, 't1'); });
    await act(async () => { result.current.moveSoon(change, 't1'); });
    await act(async () => { result.current.moveSoon(other, 't2'); });
    expect(change).not.toHaveBeenCalled();
    await wait(ARM_MS);
    expect(change).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.moveSoon(change, 't1'); });
    await wait(ARM_MS);
    expect(change).toHaveBeenCalledTimes(2);
  });
});

// --- колода «Проекты» --------------------------------------------------------

describe('колода «Проекты»: задачи в карточке', () => {
  const task = (id, title, updatedAt) => ({
    id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null, updatedAt,
  });
  beforeEach(() => {
    useAppStore.setState({
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
      statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
      tags: [],
      tasks: [
        task('a', 'Старая', '2026-01-01T00:00:00.000Z'),
        task('b', 'Средняя', '2026-05-01T00:00:00.000Z'),
        task('c', 'Свежая', '2026-09-01T00:00:00.000Z'),
      ],
    });
  });
  const order = (q) => q.getAllByText(/^(Старая|Средняя|Свежая)$/).map((n) => n.props.children);
  const FRESH = ['Свежая', 'Средняя', 'Старая'];

  test('запуск порядок не меняет, даже если задачу тем временем правят; остановка — переезд', async () => {
    const q = await render(<ProjectsScreen navigation={makeNav()} />);
    expect(order(q)).toEqual(FRESH);
    await run('b');
    expect(order(q)).toEqual(FRESH);
    // Без заморозки правка подняла бы «Старую» наверх сразу.
    await touch('a');
    expect(order(q)).toEqual(FRESH);
    await wait(1000);
    await stop();
    expect(order(q)).toEqual(['Средняя', 'Старая', 'Свежая']);
    // Переезд задан: у списка карточки есть itemLayoutAnimation.
    expect(listLayouts(q)).toEqual([MOVE]);
  });

  test('у колоды переезд задан всегда, пока экран в фокусе: после галочки соседи подъезжают', async () => {
    const nav = makeNav();
    const q = await render(<ProjectsScreen navigation={nav} />);
    expect(listLayouts(q)).toEqual([MOVE]);
    await nav.emit('blur');
    expect(listLayouts(q)).toEqual([undefined]);
    await nav.emit('focus');
    expect(listLayouts(q)).toEqual([MOVE]);
  });

  test('уход с экрана и возврат: порядок заново, идущая первой, в тот момент переезда нет', async () => {
    const nav = makeNav();
    const q = await render(<ProjectsScreen navigation={nav} />);
    await run('b');
    await touch('a');
    expect(order(q)).toEqual(FRESH);
    await nav.emit('blur');
    // Заморозка снята, закрепление последовало за идущей — всё на местах до
    // возврата, и layout в этот момент снят: строки встали без движения.
    expect(order(q)).toEqual(['Средняя', 'Старая', 'Свежая']);
    expect(listLayouts(q)).toEqual([undefined]);
    await nav.emit('focus');
    expect(order(q)).toEqual(['Средняя', 'Старая', 'Свежая']);
  });

  test('«уменьшение движения»: переезда нет вовсе, порядок — тот же', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const q = await render(<ProjectsScreen navigation={makeNav()} />);
    expect(listLayouts(q)).toEqual([undefined]);
    await run('b');
    await touch('a');
    expect(order(q)).toEqual(FRESH);
    await wait(1000);
    await stop();
    expect(order(q)).toEqual(['Средняя', 'Старая', 'Свежая']);
    expect(listLayouts(q)).toEqual([undefined]);
  });
});

// --- «Сегодня» ---------------------------------------------------------------

describe('«Сегодня»: последняя задача и проекты дня', () => {
  const task = (id, projectId, title, sessions) => ({
    id, projectId, title, statusId: 's1', done: false, totalMs: sessions.reduce((a, s) => a + s.ms, 0), tagIds: [], dueAt: null,
    sessions, updatedAt: sessions.length ? sessions[sessions.length - 1].end : at(8),
  });
  const rec = (from, to) => ({ start: at(from), end: at(to), ms: (to - from) * H });
  const seed = (extra = []) => useAppStore.setState({
    projects: [
      { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' },
    ],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p2', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
    ],
    tags: [],
    tasks: [
      // Сайт — час за день, Бот — полчаса: Сайт выше. Последней шла «Команды».
      task('t1', 'p1', 'Вёрстка', [rec(8, 9)]),
      { ...task('t2', 'p2', 'Команды', [{ start: at(9), end: new Date(new Date(at(9)).getTime() + H / 2).toISOString(), ms: H / 2 }]), statusId: 's2' },
      ...extra,
    ],
  });
  /** Проекты дня сверху вниз — по заголовкам групп. */
  // Имя проекта — в его группе записей: плашка проекта в «Недавних» под него не подходит.
  const groups = (q) => q.getAllByTestId(/^day-group-/).map((g) => within(g).getAllByText(/^(Сайт|Бот)$/)[0].props.children);
  const island = (q) => q.queryByText(t('ru', 'today.last_task'));
  const open = (nav = makeNav()) => render(<HomeScreen navigation={nav} route={{ params: {} }} />);
  /** Задача «Команды» получила ещё два часа за день: Бот обгоняет Сайт. */
  const addTwoHours = () => act(async () => {
    useAppStore.setState({
      tasks: useAppStore.getState().tasks.map((x) => (x.id === 't2'
        ? { ...x, sessions: [...x.sessions, { start: at(13), end: at(15), ms: 2 * H }], totalMs: x.totalMs + 2 * H }
        : x)),
    });
  });
  beforeEach(() => seed());

  test('запуск с острова: задача остаётся, кнопка «стоп», проекты на местах; остановка — проект переезжает', async () => {
    const q = await open();
    expect(groups(q)).toEqual(['Сайт', 'Бот']);
    await fireEvent.press(q.getAllByLabelText(t('ru', 'timer.start'))[0]);
    expect(useAppStore.getState().activeTimer.taskId).toBe('t2');
    // Остров на месте — с той же задачей, а не со следующей («Вёрстка» — запись
    // дня и строка «Недавних»); кнопка стала «стоп».
    expect(island(q)).toBeTruthy();
    expect(q.getAllByText('Команды')).toHaveLength(3); // остров, запись дня, строка «сейчас»
    expect(q.getAllByText('Вёрстка')).toHaveLength(2);
    q.getByLabelText(t('ru', 'timer.stop'));
    expect(groups(q)).toEqual(['Сайт', 'Бот']);
    // Запись добавили, пока таймер идёт, — без заморозки Бот был бы уже первым.
    await addTwoHours();
    expect(groups(q)).toEqual(['Сайт', 'Бот']);
    await stop();
    expect(groups(q)).toEqual(['Бот', 'Сайт']);
    expect(q.getByTestId('day-group-p2').props.layout).toBe(MOVE);
    expect(q.getByTestId('day-group-p1').props.layout).toBe(MOVE);
    // Остров вернулся к обычному: последняя — «Команды», кнопка «старт»
    // (вторая — у «Вёрстки» в «Недавних»).
    expect(island(q)).toBeTruthy();
    expect(q.getAllByLabelText(t('ru', 'timer.start'))).toHaveLength(2);
    // Переезд кончился — layout снят.
    await wait(MOVE_MS + 400);
    expect(q.getByTestId('day-group-p2').props.layout).toBeUndefined();
  });

  test('уход с экрана и возврат: идущая уходит из острова, проекты — по новому порядку, без движения', async () => {
    const nav = makeNav();
    const q = await open(nav);
    await fireEvent.press(q.getAllByLabelText(t('ru', 'timer.start'))[0]);
    await addTwoHours();
    expect(groups(q)).toEqual(['Сайт', 'Бот']);
    await nav.emit('blur');
    expect(groups(q)).toEqual(['Бот', 'Сайт']);
    expect(q.getByTestId('day-group-p2').props.layout).toBeUndefined();
    // Идущая — строкой «сейчас» в записях дня и первой в «Недавних»; остров
    // показывает другую, и «стоп» у него нет — он один, в «Недавних».
    q.getByText(t('ru', 'tasks.now').toLowerCase());
    expect(q.getAllByLabelText(t('ru', 'timer.stop'))).toHaveLength(1);
    expect(within(q.getByTestId('recent-block')).getAllByLabelText(t('ru', 'timer.stop'))).toHaveLength(1);
    expect(q.getAllByText('Вёрстка')).toHaveLength(2); // запись дня и остров
    await nav.emit('focus');
    expect(groups(q)).toEqual(['Бот', 'Сайт']);
    // Идёт таймер — к остановке переезд уже задан.
    expect(q.getByTestId('day-group-p2').props.layout).toBe(MOVE);
  });

  test('«уменьшение движения»: ни переезда, ни заливки; порядок тот же', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const q = await open();
    await fireEvent.press(q.getAllByLabelText(t('ru', 'timer.start'))[0]);
    await addTwoHours();
    expect(groups(q)).toEqual(['Сайт', 'Бот']);
    expect(q.getByTestId('day-group-p2').props.layout).toBeUndefined();
    await stop();
    expect(groups(q)).toEqual(['Бот', 'Сайт']);
    expect(q.getByTestId('day-group-p2').props.layout).toBeUndefined();
  });

  test('вход с идущей задачей: остров её не показывает, как и раньше', async () => {
    useAppStore.setState({ activeTimer: { taskId: 't2', startedAt: at(11), heartbeatAt: at(11) } });
    const q = await open();
    expect(q.getAllByText(t('ru', 'today.last_task'))).toHaveLength(1); // остров показывает «Вёрстка»
    q.getByLabelText(t('ru', 'timer.start'));
    // «Стоп» — только у идущей строки в «Недавних», в острове его нет.
    expect(q.getAllByLabelText(t('ru', 'timer.stop'))).toHaveLength(1);
    expect(within(q.getByTestId('recent-block')).getAllByLabelText(t('ru', 'timer.stop'))).toHaveLength(1);
  });
});

// --- лента «Задачи» ----------------------------------------------------------

describe('лента «Задачи»', () => {
  const task = (id, title, updatedAt) => ({
    id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null, updatedAt,
  });
  beforeEach(() => {
    useAppStore.setState({
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
      statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
      tags: [],
      tasks: [
        task('a', 'Альфа', '2026-09-03T00:00:00.000Z'),
        task('b', 'Бета', '2026-09-02T00:00:00.000Z'),
        task('c', 'Гамма', '2026-09-01T00:00:00.000Z'),
      ],
    });
  });
  const order = (q) => q.getAllByText(/^(Альфа|Бета|Гамма)$/).map((n) => n.props.children);
  const NOW = t('ru', 'tasks.now');

  test('запуск: задача остаётся на месте, «Сейчас» не появляется; остановка — переезд наверх', async () => {
    const q = await render(<TasksScreen navigation={makeNav()} />);
    expect(order(q)).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(listLayouts(q)).toEqual([undefined]);
    await run('c');
    expect(order(q)).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(q.queryByText(NOW)).toBeNull();
    // Переезд к остановке уже задан.
    expect(listLayouts(q)).toEqual([MOVE]);
    // Правка, пока таймер идёт, порядок не двигает.
    await touch('b');
    expect(order(q)).toEqual(['Альфа', 'Бета', 'Гамма']);
    await wait(1000);
    await stop();
    expect(order(q)).toEqual(['Гамма', 'Бета', 'Альфа']);
    expect(listLayouts(q)).toEqual([MOVE]);
    // Переезд кончился — layout снят.
    await wait(MOVE_MS + 400);
    expect(listLayouts(q)).toEqual([undefined]);
  });

  test('уход с экрана и возврат: идущая — в «Сейчас», без движения; остановка — плавно в свой раздел', async () => {
    const nav = makeNav();
    const q = await render(<TasksScreen navigation={nav} />);
    await run('c');
    expect(q.queryByText(NOW)).toBeNull();
    await nav.emit('blur');
    // Порядок заново: «Сейчас» с идущей сверху; layout в этот момент не задан.
    q.getByText(NOW);
    expect(order(q)).toEqual(['Гамма', 'Альфа', 'Бета']);
    expect(listLayouts(q)).toEqual([undefined]);
    await nav.emit('focus');
    expect(order(q)).toEqual(['Гамма', 'Альфа', 'Бета']);
    expect(listLayouts(q)).toEqual([MOVE]);
    await stop();
    // Раздела «Сейчас» нет, задача вернулась в «Незакреплённые» — плавно.
    expect(q.queryByText(NOW)).toBeNull();
    expect(order(q)).toEqual(['Гамма', 'Альфа', 'Бета']);
    expect(listLayouts(q)).toEqual([MOVE]);
  });

  test('«уменьшение движения»: переезда нет вовсе, порядок — тот же', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const q = await render(<TasksScreen navigation={makeNav()} />);
    await run('c');
    expect(order(q)).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(listLayouts(q)).toEqual([undefined]);
    await wait(1000);
    await stop();
    expect(order(q)).toEqual(['Гамма', 'Альфа', 'Бета']);
    expect(listLayouts(q)).toEqual([undefined]);
  });

  test('экран открыт заново при идущем таймере: «Сейчас» сразу, как и раньше', async () => {
    useAppStore.setState({ activeTimer: { taskId: 'c', startedAt: ago(5), heartbeatAt: ago(0) } });
    const q = await render(<TasksScreen navigation={makeNav()} />);
    q.getByText(NOW);
    expect(order(q)).toEqual(['Гамма', 'Альфа', 'Бета']);
  });
});

// --- страница проекта --------------------------------------------------------

describe('страница проекта: от таймера порядок не зависит', () => {
  const task = (id, title, statusId, extra) => ({
    id, projectId: 'p1', title, statusId, done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, notes: '', ...extra,
  });
  beforeEach(() => {
    useAppStore.setState({
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', tagIds: [] }],
      tags: [],
      statuses: [
        { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
        { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
      ],
      versions: [],
      documents: [],
      tasks: [
        task('t1', 'Вёрстка', 's1', { updatedAt: '2026-09-01T00:00:00.000Z' }),
        task('t2', 'Правки', 's1', { updatedAt: '2026-09-02T00:00:00.000Z' }),
        task('t3', 'Макет', 's1', { updatedAt: '2026-09-03T00:00:00.000Z' }),
      ],
    });
  });
  const order = (q) => q.getAllByText(/^(Вёрстка|Правки|Макет)$/).map((n) => n.props.children);

  test('запуск, правка и остановка строк не двигают, переезда нет', async () => {
    const q = await render(<ProjectScreen navigation={makeNav()} route={{ params: { projectId: 'p1' } }} />);
    const before = order(q);
    expect(before).toHaveLength(3);
    await run('t3');
    expect(order(q)).toEqual(before);
    await touch('t1');
    expect(order(q)).toEqual(before);
    await wait(1000);
    await stop();
    expect(order(q)).toEqual(before);
    expect(listLayouts(q)).toEqual([]);
  });
});

// Булавка закреплённой задачи (components/PinMark.js, lib/motion.js) и
// переезд строки в «Закреплённые» (hooks/useOrderHold.js — moveSoon).
// Запуск: npm run test:mobile
//
// Закрепили — булавка падает сверху с поворотом и втыкается (пружина
// PIN_SPRING с перехлёстом: уходит глубже, сплющивается, отыгрывает);
// открепили — вылетает вверх и тает (PIN_OUT) и уходит из дерева. В колоде и
// на «Сегодня» булавка остаётся у названия; в ленте и списке проекта, где у
// закреплённых свой раздел, — втыкается и гаснет. Первая отрисовка — без
// движения, «уменьшение движения» — сразу. Строка в ленте переезжает в раздел
// плавно: сначала ставится layout переезда, правка — следующей фиксацией.
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import TaskRow from '../src/components/TaskRow';
import TaskListItem from '../src/components/TaskListItem';
import PinMark from '../src/components/PinMark';
import { useOrderHold, MOVE, ARM_MS } from '../src/hooks/useOrderHold';
import { useAppStore } from '../src/store/useAppStore';
import { PIN_SPRING, PIN_OUT, PIN_FADE, PIN_LINGER_MS, PIN_FRESH_MS, pinDrop, pinLift, freshPin } from '../src/lib/motion';
import { t } from '../src/lib/i18n';

jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = m.useSharedValue(init);
      return ref.current;
    },
    withSpring: jest.fn((to, cfg, cb) => m.withSpring(to, cfg, cb)),
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    withDelay: jest.fn((ms, next) => next),
  };
});
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const { withSpring, withTiming, withDelay } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const drops = () => withSpring.mock.calls.filter(([, cfg]) => cfg === PIN_SPRING);
const lifts = () => withTiming.mock.calls.filter(([, cfg]) => cfg === PIN_OUT);
const fades = () => withTiming.mock.calls.filter(([, cfg]) => cfg === PIN_FADE);
// Булавка скрыта от чтения с экрана — запросы её ищут и среди скрытых.
const pinOf = (s) => s.queryByTestId('pin-mark', { includeHiddenElements: true });
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [],
  dueAt: null, repeat: null, rate: null, pinnedAt: null, notes: '', updatedAt: '2026-10-11T08:00:00.000Z', ...over,
});

beforeEach(() => {
  mockReduced = false;
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task()],
    activeTimer: null,
  });
  withSpring.mockClear();
  withTiming.mockClear();
  withDelay.mockClear();
});

describe('формы: падает с поворотом, втыкается, вылетает', () => {
  test('сверху и повёрнута → в покое → на перехлёсте глубже и сплющена', () => {
    const top = pinDrop(0);
    expect(top.ty).toBeLessThan(-10);
    expect(Math.abs(top.rot)).toBeGreaterThan(15);
    expect(top.o).toBe(0);
    expect(pinDrop(1)).toEqual({ ty: 0, rot: 0, sy: 1, o: 1 });
    const hit = pinDrop(1.25);
    expect(hit.ty).toBeGreaterThan(0);
    expect(hit.sy).toBeLessThan(1);
    // Вылет: вверх, с поворотом в другую сторону, тает.
    const out = pinLift(1);
    expect(out.ty).toBeLessThan(-10);
    expect(Math.sign(out.rot)).toBe(-Math.sign(top.rot));
    expect(out.o).toBe(0);
  });

  test('пружина втыкания: перехлёст есть (отскок), к ~0,5 с булавка стоит', () => {
    const { damping: c, stiffness: k, mass: m } = PIN_SPRING;
    let x = 0; let v = 0; let peak = 0; let settled = null;
    const dt = 1 / 2000;
    for (let i = 1; i <= 2000; i++) {
      v += ((-k * (x - 1) - c * v) / m) * dt;
      x += v * dt;
      peak = Math.max(peak, x);
      if (settled === null && i * dt > 0.1 && Math.abs(x - 1) < 0.02 && Math.abs(v) < 0.3) settled = i * dt;
    }
    expect(peak).toBeGreaterThan(1.1);
    expect(peak).toBeLessThan(1.4);
    expect(settled).toBeLessThan(0.55);
  });

  test('«только что закрепили» — по pinnedAt', () => {
    expect(freshPin(ago(100))).toBe(true);
    expect(freshPin(ago(PIN_FRESH_MS + 50))).toBe(false);
    expect(freshPin(null)).toBe(false);
  });
});

describe('строка задачи (колода, «Сегодня»): булавка остаётся', () => {
  const row = () => <TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />;

  test('закреплена давно — булавка стоит у названия без движения; «закреплена» словами — только для чтения с экрана', async () => {
    useAppStore.setState({ tasks: [task({ pinnedAt: ago(60_000) })] });
    const s = await render(row());
    expect(pinOf(s)).toBeTruthy();
    expect(drops()).toHaveLength(0);
    expect(s.queryByText(t('ru', 'tasks.pinned_mark'))).toBeNull();
    expect(s.getAllByRole('button')[0].props.accessibilityValue).toEqual({ text: t('ru', 'tasks.pinned_mark') });
  });

  test('закрепили — булавка падает и втыкается; открепили — вылетает, тает и уходит', async () => {
    const s = await render(row());
    expect(pinOf(s)).toBeNull();
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(row());
    expect(drops()).toHaveLength(1);
    expect(drops()[0][0]).toBe(1);
    expect(pinOf(s)).toBeTruthy();
    expect(fades()).toHaveLength(0); // остаётся

    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(row());
    expect(lifts()).toHaveLength(1);
    expect(lifts()[0][0]).toBe(1);
    expect(pinOf(s)).toBeNull();
    expect((s.getAllByRole('button')[0].props.accessibilityValue || {}).text).toBeUndefined();
  });

  test('перерисовали заново сразу после закрепления (переезд) — втыкается с начала', async () => {
    useAppStore.setState({ tasks: [task({ pinnedAt: ago(50) })] });
    const s = await render(row());
    expect(drops()).toHaveLength(1);
    expect(pinOf(s)).toBeTruthy();
  });

  test('«уменьшение движения» — появляется и уходит сразу, без падения и вылета', async () => {
    mockReduced = true;
    const s = await render(row());
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(row());
    expect(pinOf(s)).toBeTruthy();
    await s.rerender(row());
    expect(flat(pinOf(s)).opacity).toBe(1);
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(row());
    expect(pinOf(s)).toBeNull();
    expect(drops()).toHaveLength(0);
    expect(lifts()).toHaveLength(0);
  });
});

describe('лента и список проекта (у закреплённых свой раздел): булавка втыкается и гаснет', () => {
  test('лента (hidePinned): втыкается, через PIN_LINGER_MS гаснет и уходит; давно закреплённой нет', async () => {
    const row = () => <TaskRow task={useAppStore.getState().tasks[0]} hidePinned onPress={() => {}} />;
    const s = await render(row());
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(row());
    expect(drops()).toHaveLength(1);
    expect(fades()).toHaveLength(1);
    expect(withDelay.mock.calls.map(([ms]) => ms)).toContain(PIN_LINGER_MS);
    expect(pinOf(s)).toBeNull();
    await s.unmount();

    useAppStore.setState({ tasks: [task({ pinnedAt: ago(60_000) })] });
    const old = await render(row());
    expect(pinOf(old)).toBeNull();
  });

  test('список проекта: то же; открепили — булавка показывается и вылетает', async () => {
    const item = () => <TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />;
    const s = await render(item());
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(item());
    expect(drops()).toHaveLength(1);
    expect(fades()).toHaveLength(1);
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    await s.rerender(item());
    expect(lifts()).toHaveLength(1);
    expect(pinOf(s)).toBeNull();
  });
});

test('PinMark сам по себе: значок pin, нажатий не ловит, для чтения с экрана скрыт', async () => {
  const s = await render(<PinMark pinnedAt={ago(60_000)} />);
  const pin = s.getByTestId('pin-mark', { includeHiddenElements: true });
  expect(pin.props.pointerEvents).toBe('none');
  expect(pin.props.accessibilityElementsHidden).toBe(true);
});

describe('переезд в «Закреплённые»: moveSoon', () => {
  test('сначала layout переезда и «поверх соседей», правка — через ARM_MS', async () => {
    jest.useFakeTimers();
    try {
      const change = jest.fn();
      const { result } = await renderHook(() => useOrderHold(null));
      expect(result.current.layout).toBeUndefined();
      await act(async () => { result.current.moveSoon(change, 't1'); });
      // Конфиг уже стоит, правки ещё нет: перестановка придёт следующей фиксацией.
      expect(result.current.layout).toBe(MOVE);
      expect(result.current.rising).toBe('t1');
      expect(change).not.toHaveBeenCalled();
      await act(async () => { jest.advanceTimersByTime(ARM_MS); });
      expect(change).toHaveBeenCalledTimes(1);
      // Хвост считается от правки, с запасом на запоздавшую отрисовку: через
      // 0,6 с после неё layout ещё стоит (на эмуляторе снятый раньше времени
      // layout оставлял строки замершими на старых местах).
      await act(async () => { jest.advanceTimersByTime(600); });
      expect(result.current.layout).toBe(MOVE);
      // Переезд кончился — layout и «поверх» сняты.
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(result.current.layout).toBeUndefined();
      expect(result.current.rising).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('«уменьшение движения» — правка сразу, без layout', async () => {
    mockReduced = true;
    const change = jest.fn();
    const { result } = await renderHook(() => useOrderHold(null));
    await act(async () => { result.current.moveSoon(change, 't1'); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(result.current.layout).toBeUndefined();
  });

  test('лента «Задачи»: свайп закрепления идёт через moveSoon', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'TasksScreen.js'), 'utf8');
    expect(src).toMatch(/onAction=\{\(\) => hold\.moveSoon\(\(\) => togglePinTask\(task\.id\), task\.id\)\}/);
  });
});

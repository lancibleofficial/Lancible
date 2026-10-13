// Галочка «выполнено» с наливом (components/Liquid.js — LiquidCheck,
// lib/liquid.js — dropAt; DESIGN.md «Телефон» → «Жидкое движение»).
// Запуск: npm run test:mobile
//
// Отметили — акцент наливается быстрее, чем в кнопку старта (LIQUID.check),
// на ⅘ налива квадрат делает «поп» (толчок пружины pop до ~1,12) и из него
// брызгают CHECK_DROPS капель, которые разлетаются и тают (LIQUID.burst) и
// потом уходят из дерева. Сняли — акцент стекает (LIQUID.uncheck), без
// «попа» и брызг. «Уменьшение движения» и iOS 26+ — сразу, без жидкости.
// Места: строка задачи (TaskRow — колода, лента, «Сегодня») и строка списка
// проекта (TaskListItem).
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import TaskRow from '../src/components/TaskRow';
import TaskListItem from '../src/components/TaskListItem';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID, CHECK_POP_KICK, CHECK_POP_DELAY, CHECK_DROPS, dropAt, fillFrom, resetKicks } from '../src/lib/liquid';
import { colors } from '../src/theme';

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
const pours = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.check);
const drains = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.uncheck);
const bursts = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.burst);
const popsOf = () => withSpring.mock.calls.filter(([, cfg]) => cfg && cfg.velocity === CHECK_POP_KICK && cfg.stiffness === LIQUID.pop.stiffness);

const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 0, tagIds: [],
  sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null, notes: '', updatedAt: '2026-10-11T08:00:00.000Z', ...over,
});

beforeEach(() => {
  mockReduced = false;
  resetKicks();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    // Есть и «Готово»: отметка переводит задачу в него, снятие — обратно.
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#69d345', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [],
    tasks: [task()],
    activeTimer: null,
  });
  withSpring.mockClear();
  withTiming.mockClear();
  withDelay.mockClear();
});

const row = () => <TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />;

describe('строка задачи: галочка наливается', () => {
  test('первая отрисовка — без движения: пусто, галочки не видно, брызг нет', async () => {
    const s = await render(row());
    expect(pours()).toHaveLength(0);
    expect(flat(s.getByTestId('check-fill')).opacity).toBe(0);
    expect(flat(s.getByTestId('check-icon')).opacity).toBe(0);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
  });

  test('отметили — налив, «поп» на ⅘ и капли разлетаются; в конце налито до края', async () => {
    const s = await render(row());
    await fireEvent.press(s.getByRole('checkbox'));
    expect(useAppStore.getState().tasks[0].done).toBe(true);
    await s.rerender(row());

    // Налив — быстрее, чем у кнопки старта.
    expect(pours()).toHaveLength(1);
    expect(pours()[0][0]).toBe(1);
    expect(LIQUID.check.duration).toBeLessThanOrEqual(300);
    expect(LIQUID.check.duration).toBeLessThan(LIQUID.pour.duration);

    // «Поп»: одна пружина-толчок, с задержкой — когда налито на ⅘.
    expect(popsOf()).toHaveLength(1);
    expect(withDelay.mock.calls.map(([ms]) => ms)).toContain(CHECK_POP_DELAY);
    expect(CHECK_POP_DELAY).toBeLessThan(LIQUID.check.duration);

    // Капли: ровно CHECK_DROPS, от 5 до 7, цвета акцента; разлёт ~300 мс.
    expect(CHECK_DROPS).toBeGreaterThanOrEqual(5);
    expect(CHECK_DROPS).toBeLessThanOrEqual(7);
    const drops = s.getAllByTestId('check-drop');
    expect(drops).toHaveLength(CHECK_DROPS);
    for (const d of drops) expect(flat(d).backgroundColor).toBe(colors.accent);
    expect(bursts()).toHaveLength(1);
    expect(LIQUID.burst.duration).toBeGreaterThanOrEqual(280);
    expect(LIQUID.burst.duration).toBeLessThanOrEqual(340);

    // Конечный вид: квадрат — сплошной акцент, галочка видна.
    expect(flat(s.getByTestId('check-shape')).backgroundColor).toBe(colors.accent);
    expect(flat(s.getByTestId('check-icon')).opacity).toBe(1);
  });

  test('капли уходят из дерева, когда растаяли', async () => {
    jest.useFakeTimers();
    try {
      const s = await render(row());
      await fireEvent.press(s.getByRole('checkbox'));
      await s.rerender(row());
      expect(s.getAllByTestId('check-drop')).toHaveLength(CHECK_DROPS);
      await act(async () => { jest.advanceTimersByTime(CHECK_POP_DELAY + LIQUID.burst.duration + 100); });
      expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('сняли отметку — акцент стекает: без «попа» и без капель', async () => {
    useAppStore.setState({ tasks: [task({ done: true, statusId: 's2' })] });
    const s = await render(row());
    expect(flat(s.getByTestId('check-shape')).backgroundColor).toBe(colors.accent);
    await fireEvent.press(s.getByRole('checkbox'));
    expect(useAppStore.getState().tasks[0].done).toBe(false);
    await s.rerender(row());
    await s.rerender(row()); // стили — по значениям, записанным в эффекте
    expect(drains()).toHaveLength(1);
    expect(drains()[0][0]).toBe(0);
    expect(pours()).toHaveLength(0);
    expect(popsOf()).toHaveLength(0);
    expect(bursts()).toHaveLength(0);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    expect(flat(s.getByTestId('check-fill')).opacity).toBe(0);
    expect(flat(s.getByTestId('check-icon')).opacity).toBe(0);
  });

  test('«уменьшение движения» — сразу налито, без налива, «попа» и капель', async () => {
    mockReduced = true;
    const s = await render(row());
    await fireEvent.press(s.getByRole('checkbox'));
    await s.rerender(row());
    await s.rerender(row()); // стили — по значениям, записанным в эффекте
    expect(pours()).toHaveLength(0);
    expect(popsOf()).toHaveLength(0);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    expect(flat(s.getByTestId('check-shape')).backgroundColor).toBe(colors.accent);
  });

  test('iOS 26+ — как у кнопки старта: без жидкости', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'ios');
    const d = Object.getOwnPropertyDescriptor(Platform, 'Version');
    const v = d && d.get ? jest.spyOn(Platform, 'Version', 'get').mockReturnValue(26) : jest.replaceProperty(Platform, 'Version', 26);
    try {
      const s = await render(row());
      await fireEvent.press(s.getByRole('checkbox'));
      await s.rerender(row());
      expect(pours()).toHaveLength(0);
      expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    } finally {
      os.restore();
      if (v.mockRestore) v.mockRestore(); else v.restore();
    }
  });

  test('колода: галочка до отметки в сторе (checked) — тот же налив', async () => {
    const s = await render(<TaskRow task={task()} onPress={() => {}} />);
    await s.rerender(<TaskRow task={task()} checked onPress={() => {}} />);
    expect(pours()).toHaveLength(1);
    expect(s.getAllByTestId('check-drop')).toHaveLength(CHECK_DROPS);
  });

  test('строку перерисовали заново сразу после отметки — налив с начала, а не сразу налитая', async () => {
    const s = await render(row());
    await fireEvent.press(s.getByRole('checkbox'));
    await s.unmount();
    withTiming.mockClear();
    const again = await render(row());
    expect(pours()).toHaveLength(1);
    expect(again.getAllByTestId('check-drop')).toHaveLength(CHECK_DROPS);
  });
});

test('строка списка проекта: та же галочка — налив, «поп», капли; снятие — без капель', async () => {
  const s = await render(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  await fireEvent.press(s.getByRole('checkbox'));
  await s.rerender(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  expect(pours()).toHaveLength(1);
  expect(popsOf()).toHaveLength(1);
  expect(s.getAllByTestId('check-drop')).toHaveLength(CHECK_DROPS);
  await s.unmount();

  resetKicks();
  withTiming.mockClear();
  const back = await render(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  await fireEvent.press(back.getByRole('checkbox'));
  await back.rerender(<TaskListItem task={useAppStore.getState().tasks[0]} onPress={() => {}} />);
  expect(drains()).toHaveLength(1);
  expect(back.queryAllByTestId('check-drop')).toHaveLength(0);
});

test('перерисованная посреди отметки — с первого кадра там, откуда налив пойдёт (не мелькает налитой)', () => {
  expect(fillFrom(false, true)).toBe(1);
  expect(fillFrom(false, false)).toBe(0);
  expect(fillFrom(true, true)).toBe(0);
  expect(fillFrom(true, false)).toBe(1);
  // Галочка и кнопка старта берут первый кадр отсюда.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'components', 'Liquid.js'), 'utf8');
  expect(src.match(/useSharedValue\(fillFrom\(fresh, (on|checked)\)\)/g)).toHaveLength(2);
});

test('капли: из галочки во все стороны, улетают за её край, мельчают и тают', () => {
  const size = 24;
  const start = Array.from({ length: CHECK_DROPS }, (_, i) => dropAt(i, CHECK_DROPS, 0, size));
  const end = Array.from({ length: CHECK_DROPS }, (_, i) => dropAt(i, CHECK_DROPS, 1, size));
  for (const d of start) {
    expect(Math.hypot(d.x, d.y)).toBeLessThan(size / 2);
    expect(d.o).toBe(0);
  }
  for (const d of end) {
    expect(Math.hypot(d.x, d.y)).toBeGreaterThan(size / 2 + 4);
    expect(d.o).toBe(0);
    expect(d.s).toBeLessThan(1);
  }
  // Время ровное, а таять капли начинают только с середины: до неё видны целиком.
  for (const q of [0.15, 0.3, 0.45]) expect(dropAt(0, CHECK_DROPS, q, size).o).toBe(1);
  expect(LIQUID.burst.easing(0.5)).toBeCloseTo(0.5, 6);
  // Во все стороны: есть капли слева и справа, сверху и снизу.
  const mid = Array.from({ length: CHECK_DROPS }, (_, i) => dropAt(i, CHECK_DROPS, 0.5, size));
  expect(mid.some((d) => d.x < -4)).toBe(true);
  expect(mid.some((d) => d.x > 4)).toBe(true);
  expect(mid.some((d) => d.y < -4)).toBe(true);
  expect(mid.some((d) => d.y > 4)).toBe(true);
});

test('«поп»: толчок пружины pop даёт ~1,12 на пике', () => {
  const { damping: c, stiffness: k, mass: m } = LIQUID.pop;
  let x = 0; let v = CHECK_POP_KICK; let peak = 0;
  const dt = 1 / 4000;
  for (let i = 0; i < 4000; i++) {
    v += ((-k * x - c * v) / m) * dt;
    x += v * dt;
    peak = Math.max(peak, x);
  }
  expect(1 + peak).toBeGreaterThan(1.1);
  expect(1 + peak).toBeLessThan(1.14);
});

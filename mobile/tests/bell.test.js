// Колокольчик звенит, пока есть непрочитанные (components/TabHeader.js —
// NotificationsButton; lib/motion.js — bellAngle, badgeKick, расписание).
// Запуск: npm run test:mobile
//
// Звон — качание вокруг верхней точки с затуханием (~1 с), бейдж-счётчик
// вздрагивает. Три звона раз в 7 с, потом тишина; снова — когда
// непрочитанных стало больше. Без непрочитанных и при «уменьшении движения»
// не двигается. Шапку вкладки хост перерисовывает при каждой смене вкладки —
// новая отрисовка серию не начинает заново. На iOS 26+ колокольчик — кнопка
// нативной шапки, качать её нечем (там звона нет — см. TabHeader.js).
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { NotificationsButton } from '../src/components/TabHeader';
import { useAppStore } from '../src/store/useAppStore';
import { BELL_RING, BELL_EVERY_MS, BELL_TIMES, BELL_PIVOT, bellAngle, badgeKick, resetBell } from '../src/lib/motion';

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
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
  };
});
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const { withTiming } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const rings = () => withTiming.mock.calls.filter(([, cfg]) => cfg === BELL_RING).length;
const nav = { navigate: jest.fn() };
const overdue = (id) => ({
  id, projectId: 'p1', title: id, statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [],
  dueAt: new Date(Date.now() - 3_600_000).toISOString(), pinnedAt: null,
});
const setUnread = (n) => useAppStore.setState({ tasks: Array.from({ length: n }, (_, i) => overdue(`t${i}`)) });
const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  resetBell();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
    tasks: [],
  });
  withTiming.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('формы звона', () => {
  test('качание: с нуля в ноль за секунду, несколько размахов в обе стороны, затухает', () => {
    expect(bellAngle(0)).toBe(0);
    expect(bellAngle(1)).toBe(0);
    const samples = Array.from({ length: 200 }, (_, i) => bellAngle(i / 200));
    const max = Math.max(...samples.map(Math.abs));
    expect(max).toBeGreaterThan(10);
    expect(max).toBeLessThanOrEqual(16);
    let flips = 0;
    for (let i = 1; i < samples.length; i++) if (Math.sign(samples[i]) !== Math.sign(samples[i - 1]) && samples[i] !== 0) flips++;
    expect(flips).toBeGreaterThanOrEqual(6);
    // Затухание: в последней пятой — меньше градуса.
    expect(Math.max(...samples.slice(160).map(Math.abs))).toBeLessThan(1);
    expect(BELL_RING.duration).toBe(1000);
  });

  test('бейдж вздрагивает в начале звона и стоит остальное время', () => {
    expect(badgeKick(0)).toBe(1);
    expect(badgeKick(0.11)).toBeCloseTo(1.28, 2);
    expect(badgeKick(0.3)).toBe(1);
    expect(badgeKick(1)).toBe(1);
  });
});

describe('NotificationsButton: звон при непрочитанных', () => {
  test('без непрочитанных — тишина', async () => {
    const s = await render(<NotificationsButton navigation={nav} />);
    await wait(30_000);
    expect(rings()).toBe(0);
    expect(s.queryByTestId('notif-bell-badge')).toBeNull();
  });

  test('есть непрочитанные — звенит сразу, потом раз в 7 с, три раза, и тишина', async () => {
    setUnread(2);
    await render(<NotificationsButton navigation={nav} />);
    await wait(0);
    expect(rings()).toBe(1);
    await wait(BELL_EVERY_MS - 1);
    expect(rings()).toBe(1);
    await wait(1);
    expect(rings()).toBe(2);
    await wait(BELL_EVERY_MS);
    expect(rings()).toBe(BELL_TIMES);
    await wait(BELL_EVERY_MS * 5);
    expect(rings()).toBe(BELL_TIMES);
  });

  test('непрочитанных стало больше — новая серия; меньше — тишина, а следующий рост снова звенит', async () => {
    setUnread(1);
    await render(<NotificationsButton navigation={nav} />);
    await wait(BELL_EVERY_MS * 4);
    expect(rings()).toBe(3);

    await act(async () => { setUnread(2); });
    await wait(0);
    expect(rings()).toBe(4);
    await wait(BELL_EVERY_MS * 4);
    expect(rings()).toBe(6);

    // Прочитали одно — меньше: не звенит.
    await act(async () => { setUnread(1); });
    await wait(BELL_EVERY_MS * 2);
    expect(rings()).toBe(6);
    // И снова больше — звенит.
    await act(async () => { setUnread(2); });
    await wait(0);
    expect(rings()).toBe(7);
  });

  test('открыли уведомления (прочитано) посреди серии — колокольчик замолкает', async () => {
    setUnread(3);
    await render(<NotificationsButton navigation={nav} />);
    await wait(0);
    expect(rings()).toBe(1);
    await act(async () => { useAppStore.setState({ ui: { ...useAppStore.getState().ui, notifSeenAt: new Date(Date.now() + 1000).toISOString() } }); });
    await wait(BELL_EVERY_MS * 3);
    expect(rings()).toBe(1);
  });

  test('шапку перерисовали (смена вкладки) посреди серии — серия идёт дальше, а не заново', async () => {
    setUnread(1);
    const first = await render(<NotificationsButton navigation={nav} />);
    await wait(0);
    expect(rings()).toBe(1);
    await wait(3000);
    await first.unmount();
    await render(<NotificationsButton navigation={nav} />);
    await wait(0);
    expect(rings()).toBe(1);
    await wait(BELL_EVERY_MS - 3000);
    expect(rings()).toBe(2);
  });

  test('качается вокруг верхней точки, бейдж-счётчик вздрагивает', async () => {
    setUnread(4);
    // Звон «замер» в самом начале: t = 0.05.
    withTiming.mockImplementationOnce(() => 0.05);
    const s = await render(<NotificationsButton navigation={nav} />);
    await wait(0);
    await s.rerender(<NotificationsButton navigation={nav} />);
    const icon = flat(s.getByTestId('notif-bell-icon')).transform;
    // Ось — над центром значка: сдвиг вверх, поворот, сдвиг обратно.
    expect(icon[0]).toEqual({ translateY: -BELL_PIVOT });
    expect(icon[2]).toEqual({ translateY: BELL_PIVOT });
    expect(parseFloat(icon[1].rotate)).toBeGreaterThan(8);
    const badge = s.getByTestId('notif-bell-badge');
    expect(flat(badge).transform[0].scale).toBeGreaterThan(1.1);
    expect(badge.children.length).toBeGreaterThan(0);
  });

  test('«уменьшение движения» — не качается', async () => {
    mockReduced = true;
    setUnread(2);
    const s = await render(<NotificationsButton navigation={nav} />);
    await wait(BELL_EVERY_MS * 3);
    expect(rings()).toBe(0);
    const icon = flat(s.getByTestId('notif-bell-icon')).transform;
    expect(parseFloat(icon[1].rotate)).toBe(0);
  });
});

// Плашка идущей задачи на iOS 26 (TimerAccessory в components/TimerMiniPlayer.js).
// Запуск: npm run test:mobile
//
// Стеклянную капсулу над панелью вкладок рисует система. Раньше в неё
// вставлялась обычная плашка со своим фоном, рамкой и высотой 56 — выше
// капсулы, и её обрезало снизу. Теперь своего фона нет, плашка заполняет
// капсулу: точка «идёт», название, время, «стоп» простой иконкой.
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import TimerMiniPlayer, { TimerAccessory } from '../src/components/TimerMiniPlayer';
import { useAppStore } from '../src/store/useAppStore';

const STARTED = Date.parse('2026-10-09T10:00:00.000Z');
const stopTimer = jest.fn();

beforeEach(() => {
  stopTimer.mockClear();
  jest.spyOn(Date, 'now').mockReturnValue(STARTED + 16_000);
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Тест', color: '#87ff65' }],
    tasks: [{ id: 't1', projectId: 'p1', title: '1', statusId: null, done: false, totalMs: 0, sessions: [], tagIds: [] }],
    activeTimer: { taskId: 't1', startedAt: new Date(STARTED).toISOString() },
    stopTimer,
  });
});
afterEach(() => jest.restoreAllMocks());

function styles(tree, out = []) {
  if (!tree) return out;
  if (Array.isArray(tree)) { tree.forEach((n) => styles(n, out)); return out; }
  if (typeof tree === 'object') {
    if (tree.props && tree.props.style) out.push(StyleSheet.flatten(tree.props.style));
    styles(tree.children, out);
  }
  return out;
}

test('над панелью: название, проект, время и «стоп», без своего фона и рамки', async () => {
  const onOpen = jest.fn();
  const screen = await render(<TimerAccessory placement="regular" onOpen={onOpen} />);
  screen.getByText('1');
  screen.getByText('Тест');
  screen.getByText('00:00:16');
  const all = styles(screen.toJSON());
  // Фон есть только у пульсирующей точки — 8×8; у самой плашки его нет.
  const filled = (s) => s.backgroundColor && s.backgroundColor !== 'transparent';
  expect(all.filter((s) => filled(s) && s.width !== 8)).toEqual([]);
  expect(all.some((s) => s.borderWidth > 0)).toBe(false);
  expect(all.some((s) => s.height === 56)).toBe(false);

  await fireEvent.press(screen.getByLabelText('Остановить таймер'));
  expect(stopTimer).toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('1'));
  expect(onOpen).toHaveBeenCalledWith('t1');
});

test('рядом со свёрнутой панелью: только время и «стоп»', async () => {
  const screen = await render(<TimerAccessory placement="inline" onOpen={() => {}} />);
  screen.getByText('00:00:16');
  screen.getByLabelText('Остановить таймер');
  expect(screen.queryByText('Тест')).toBeNull();
});

test('без идущей задачи — ничего', async () => {
  useAppStore.setState({ activeTimer: null });
  const screen = await render(<TimerAccessory placement="regular" onOpen={() => {}} />);
  expect(screen.toJSON()).toBeNull();
});

test('на Android и iOS ниже 26 плашка прежняя, со своей подложкой', async () => {
  const screen = await render(<TimerMiniPlayer onOpen={() => {}} />);
  screen.getByText('1');
  screen.getByText('00:00:16');
  expect(styles(screen.toJSON()).some((s) => s.height === 56 && s.backgroundColor)).toBe(true);
});

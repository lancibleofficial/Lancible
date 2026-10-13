// Нижний отступ прокрутки корневых вкладок — один на всех: useBottomClearance.
// Запуск: npm run test:mobile
//
// Просили: «Меню» докручивается до огромной пустоты снизу. Причина была не в
// самом экране, а в общем запасе: tabBarClearance (108) отдавался под панель
// вкладок на Android, где она стоит в раскладке под страницей и закрывать
// нечего — страница и так кончается над ней. Теперь запас под панель — только
// там, где она плавает над страницей (iOS), а на Android остаётся обычный
// нижний отступ, плюс место под плашку идущей задачи, пока таймер идёт.
//
// Проверки две. Отрисовка: прокрутка «Меню» и «Сегодня» берёт ровно значение
// хука. Исходники: у каждой корневой вкладки отступ содержимого — это
// `clearance` и ничего сверху, чтобы «Меню» не вернулось к своему особому.
import fs from 'fs';
import path from 'path';
import { Platform, StyleSheet } from 'react-native';
import { render, renderHook, act } from '@testing-library/react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import HomeScreen from '../src/screens/HomeScreen';
import { useBottomClearance, MINI_PLAYER_HEIGHT } from '../src/components/TimerMiniPlayer';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { spacing, tabBarClearance } from '../src/theme';

jest.mock('../src/lib/updateCheck', () => ({ checkForUpdate: jest.fn(() => Promise.resolve({ available: false })), downloadAndInstall: jest.fn() }));

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() });
const running = { taskId: 't1', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
const PLAYER = MINI_PLAYER_HEIGHT + spacing.sm;

beforeEach(() => {
  useAuthStore.setState({ status: 'signedOut', user: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [], dueAt: null, updatedAt: '2026-10-01T10:00:00.000Z' }],
    activeTimer: null,
  });
});
afterEach(() => jest.restoreAllMocks());

/** Нижний отступ содержимого прокрутки экрана. */
const padOf = (screen, testID) => StyleSheet.flatten(screen.getByTestId(testID).props.contentContainerStyle).paddingBottom;

describe('значение хука', () => {
  test('Android: панель в раскладке — обычный отступ страницы, а не 108 под панель', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { result } = await renderHook(() => useBottomClearance());
    expect(result.current).toBe(spacing.lg);
    expect(result.current).toBeLessThan(tabBarClearance);
  });

  test('Android: пока идёт таймер — ещё и место под плашку, которая лежит поверх страницы', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { result } = await renderHook(() => useBottomClearance());
    await act(() => useAppStore.setState({ activeTimer: running }));
    expect(result.current).toBe(spacing.lg + PLAYER);
  });

  test('iOS: панель плавает над страницей — запас под неё прежний', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(() => useBottomClearance());
    expect(result.current).toBe(tabBarClearance);
    await act(() => useAppStore.setState({ activeTimer: running }));
    expect(result.current).toBe(tabBarClearance + PLAYER);
  });
});

describe.each([['Android', 'android', spacing.lg], ['iOS', 'ios', tabBarClearance]])('%s: «Меню» — тот же отступ, что у «Сегодня»', (_name, os, base) => {
  test('прокрутка «Меню» и «Сегодня» кончается одним и тем же отступом, без своего особого', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    // Запросы читают последнюю отрисовку, поэтому каждый экран — до следующего render.
    const menu = await render(<SettingsScreen navigation={nav()} />);
    expect(padOf(menu, 'menu-scroll')).toBe(base);
    const home = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    expect(padOf(home, 'today-scroll')).toBe(base);
  });

  test('с идущей задачей оба прибавляют плашку и снова равны', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    useAppStore.setState({ activeTimer: running });
    const menu = await render(<SettingsScreen navigation={nav()} />);
    expect(padOf(menu, 'menu-scroll')).toBe(base + PLAYER);
    const home = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    expect(padOf(home, 'today-scroll')).toBe(base + PLAYER);
  });
});

describe('исходники: у корневых вкладок отступ содержимого — только clearance', () => {
  const SRC = path.join(__dirname, '..', 'src', 'screens');
  const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

  test.each(['HomeScreen.js', 'SettingsScreen.js', 'StatsScreen.js', 'TasksScreen.js'])('%s: content → paddingBottom: clearance', (file) => {
    const text = read(file);
    expect(text).toMatch(/useBottomClearance\(\)/);
    const line = text.split('\n').find((l) => /^\s*content: \{/.test(l));
    expect(line).toMatch(/paddingBottom: clearance\b(?!\s*[+\-*])/);
  });
});

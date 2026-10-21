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
// Проверки две. Отрисовка: прокрутка «Меню» и список «Чат-бота» берут ровно
// значение хука. Исходники: у каждой корневой вкладки отступ содержимого — это
// `clearance` и ничего сверху, чтобы «Меню» не вернулось к своему особому.
import fs from 'fs';
import path from 'path';
import { Platform, StyleSheet } from 'react-native';
import { render, renderHook, act, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import TasksScreen from '../src/screens/TasksScreen';
import ChatListScreen from '../src/screens/ChatListScreen';
import { useAiChat, aiStop } from '../src/lib/aiChat';
import { useBottomClearance, MINI_PLAYER_HEIGHT } from '../src/components/TimerMiniPlayer';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { spacing, tabBarClearance } from '../src/theme';
import { grantAi } from './support/aiAccess';

// Агент открыт аккаунту (RPC ai_has_access подменён — tests/support/aiAccess.js).
let aiRpc;
beforeEach(() => { aiRpc = grantAi(); });
afterEach(() => { aiRpc.mockRestore(); });

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
/** «Чат-бот» после входа — список чатов (с 18 октября 2026); у самого чата
 *  таббара нет, и под полем — безопасное поле (chatThread.test.js). */
const renderChat = async () => {
  aiStop();
  useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false });
  // «Меню» ещё на экране — вход меняет и его.
  await act(async () => { useAuthStore.setState({ status: 'signedIn', user: { id: 'u-clear', email: 'a@b.c' } }); });
  const s = await render(<ChatListScreen navigation={nav()} />);
  await waitFor(() => s.getByTestId('chat-list-empty'));
  return s;
};
const chatPad = (screen) => padOf(screen, 'chat-list-empty');

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

describe.each([['Android', 'android', spacing.lg], ['iOS', 'ios', tabBarClearance]])('%s: «Меню» — тот же отступ, что у «Чат-бота»', (_name, os, base) => {
  test('прокрутка «Меню» и список «Чат-бота» кончаются одним и тем же отступом, без своего особого', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    // Запросы читают последнюю отрисовку, поэтому каждый экран — до следующего render.
    const menu = await render(<SettingsScreen navigation={nav()} />);
    expect(padOf(menu, 'menu-scroll')).toBe(base);
    const chat = await renderChat();
    expect(chatPad(chat)).toBe(base);
  });

  test('с идущей задачей оба прибавляют плашку и снова равны', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    useAppStore.setState({ activeTimer: running });
    const menu = await render(<SettingsScreen navigation={nav()} />);
    expect(padOf(menu, 'menu-scroll')).toBe(base + PLAYER);
    const chat = await renderChat();
    expect(chatPad(chat)).toBe(base + PLAYER);
  });
});

describe('исходники: у корневых вкладок отступ содержимого — только clearance', () => {
  const SRC = path.join(__dirname, '..', 'src', 'screens');
  const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

  test.each(['SettingsScreen.js', 'StatsScreen.js', 'TasksScreen.js', 'ChatListScreen.js'])('%s: content → paddingBottom: clearance', (file) => {
    const text = read(file);
    expect(text).toMatch(/useBottomClearance\(\)/);
    const line = text.split('\n').find((l) => /^\s*content: \{/.test(l));
    expect(line).toMatch(/paddingBottom: clearance\b(?!\s*[+\-*])/);
  });
});

// Круг 21: «Задачи» — последние строки уходили под нижнюю навигацию. Отступ
// ленты был верный, но сама страница не была ограничена: корень ссылался на
// styles.container, которого в makeStyles уже не было (убран 13 октября), и
// без flex: 1 корень рос по содержимому — лента выходила за низ страницы под
// панель вкладок и не прокручивалась.
const manyTasks = (n) => Array.from({ length: n }, (_, i) => ({
  id: `t${i + 1}`, projectId: 'p1', title: `Задача ${i + 1}`, statusId: 's1', done: false, totalMs: 0,
  tagIds: [], sessions: [], dueAt: null, pinnedAt: null, updatedAt: '2026-10-01T10:00:00.000Z',
}));

describe.each([['Android', 'android', spacing.lg], ['iOS', 'ios', tabBarClearance]])('%s: «Задачи» — лента кончается над панелью вкладок', (_name, os, base) => {
  test('страница во всю высоту вкладки, а не по содержимому; у ленты — отступ хука', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    useAppStore.setState({ tasks: manyTasks(30) });
    const q = await render(<TasksScreen navigation={nav()} />);
    expect(StyleSheet.flatten(q.getByTestId('tasks-screen').props.style)).toMatchObject({ flex: 1 });
    expect(padOf(q, 'tasks-list')).toBe(base);
  });

  test('с идущей задачей — ещё и место под плашку', async () => {
    jest.replaceProperty(Platform, 'OS', os);
    useAppStore.setState({ tasks: manyTasks(30), activeTimer: running });
    const q = await render(<TasksScreen navigation={nav()} />);
    expect(StyleSheet.flatten(q.getByTestId('tasks-screen').props.style)).toMatchObject({ flex: 1 });
    expect(padOf(q, 'tasks-list')).toBe(base + PLAYER);
  });
});

describe('исходники: корневые вкладки не ссылаются на стили, которых нет', () => {
  const SRC = path.join(__dirname, '..', 'src', 'screens');
  const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

  // styles.<имя> без такого ключа в makeStyles — undefined: RN молча рисует
  // без стиля, и корень страницы теряет flex: 1 (так «Задачи» и уехали).
  test.each(['TasksScreen.js', 'SettingsScreen.js', 'StatsScreen.js', 'ProjectsScreen.js'])('%s: каждый styles.<имя> есть в makeStyles', (file) => {
    const text = read(file);
    const used = new Set([...text.matchAll(/\bstyles\.(\w+)/g)].map((m) => m[1]));
    const sheet = text.slice(text.indexOf('const makeStyles'));
    const defined = new Set([...sheet.matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]));
    expect(defined.size).toBeGreaterThan(3);
    expect([...used].filter((k) => !defined.has(k))).toEqual([]);
  });
});

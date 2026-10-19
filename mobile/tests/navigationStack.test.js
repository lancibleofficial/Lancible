// «Назад» — туда, откуда пришли (17 октября 2026: «страницы телепортируют не
// пойми куда, стрелки назад возвращают не на предыдущую страницу»).
// Запуск: npm run test:mobile (из корня)
//
// Правило (navigation/openTask.js): задача из любого места встаёт ПОВЕРХ
// текущего экрана, в стек той вкладки, где человек сейчас; стек не
// перестраивается — ни уходом в другую вкладку, ни подменой экрана под
// ногами. Тест гоняет настоящий навигатор Android (MainTabs.android.js,
// настоящие экраны и стор) и смотрит на состояние навигации: проверяется
// применение правила, а не его пересказ.
import { Platform } from 'react-native';
import { render, fireEvent, act, within, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import MainTabs from '../src/navigation/MainTabs.android';
import { useNotificationOpen } from '../src/navigation/useNotificationOpen';
import { placeOf, returnToPlace } from '../src/navigation/RootNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAiChat, aiStop, aiAccount, aiChatsKey } from '../src/lib/aiChat';
import { DETAIL_ROUTES } from '../src/navigation/detailScreens';
import { sb } from '../src/lib/supabaseClient';
import { t } from '../src/lib/i18n';

// Редактор заметок — WebView без нативной части в Node; к стеку отношения не имеет.
jest.mock('../src/components/DocEditor', () => () => null);
// Агент: ответ не приходит — здесь важен только стек.
jest.mock('expo/fetch', () => ({ fetch: jest.fn(() => new Promise(() => {})) }));
// Касание системного уведомления: слушатель запоминается, «последний ответ»
// (запуск приложения касанием) задаёт тест.
const mockEmitter = { listener: null, last: null, cleared: 0 };
jest.mock('expo-notifications/build/NotificationsEmitter', () => ({
  addNotificationResponseReceivedListener: (fn) => { mockEmitter.listener = fn; return { remove: () => { mockEmitter.listener = null; } }; },
  getLastNotificationResponse: () => mockEmitter.last,
  clearLastNotificationResponse: () => { mockEmitter.last = null; mockEmitter.cleared += 1; },
}));

const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(), ...extra,
});
const response = (taskId) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { request: { identifier: 'rem-x', content: { title: 'x', data: { taskId } } } },
});

let os;
beforeEach(() => {
  os = jest.replaceProperty(Platform, 'OS', 'android');
  mockEmitter.listener = null;
  mockEmitter.last = null;
  mockEmitter.cleared = 0;
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Правки')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});
afterEach(() => os.restore());

/** Слушатель касаний уведомлений — так же, как его включает RootNavigator. */
function NotificationOpen({ nav }) {
  useNotificationOpen(nav, true);
  return null;
}

async function openApp() {
  const nav = createNavigationContainerRef();
  const screen = await render(<NavigationContainer ref={nav}><MainTabs /><NotificationOpen nav={nav} /></NavigationContainer>);
  await waitFor(() => expect(nav.isReady()).toBe(true));
  return { screen, nav };
}

/** Где мы: вкладка и стек в ней — имена экранов снизу вверх. */
function where(nav) {
  const root = nav.getRootState();
  const tab = root.routes[root.index];
  const stack = tab.state ? tab.state.routes.map((r) => (r.name === 'TaskDetail' ? `TaskDetail:${r.params.taskId}` : r.name)) : [];
  return { tab: tab.name, stack };
}
/** Стек вкладки по имени (если он уже построен). */
function stackOf(nav, name) {
  const tab = nav.getRootState().routes.find((r) => r.name === name);
  return tab && tab.state ? tab.state.routes.map((r) => r.name) : null;
}
const tabButton = (screen, key) => screen.getByRole('button', { name: t('ru', key) });
/** Последний из найденных: экран, открытый сверху, отрисован позже. */
const lastOf = (list) => list[list.length - 1];
/** «Назад» — то, что делает стрелка в шапке (DetailHeader, AppHeader: goBack). */
const back = (nav) => act(async () => { nav.goBack(); });

test('колода → задача → назад = колода', async () => {
  const { screen, nav } = await openApp();
  await fireEvent.press(lastOf(await screen.findAllByText('Вёрстка')));
  expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain'] });
});

test('проект → задача → назад = проект', async () => {
  const { screen, nav } = await openApp();
  await fireEvent.press(lastOf(await screen.findAllByText(t('ru', 'deck.open'))));
  expect(where(nav).stack).toEqual(['ProjectsMain', 'Project']);
  await fireEvent.press(lastOf(await screen.findAllByText('Вёрстка')));
  expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain', 'Project', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain', 'Project'] });
});

test('уведомления (колокольчик) → задача → назад = уведомления', async () => {
  useAppStore.setState({ tasks: [task('t1', 'Вёрстка', { dueAt: new Date(Date.now() - 3_600_000).toISOString() }), task('t2', 'Правки')] });
  const { screen, nav } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  const header = screen.getByTestId('root-header');
  await fireEvent.press(await within(header).findByRole('button', { name: t('ru', 'notif.title') }));
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Notifications'] });
  await fireEvent.press(lastOf(await screen.findAllByText('Вёрстка')));
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Notifications', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Notifications'] });
});

test('касание системного уведомления → задача поверх текущего экрана → назад = экран, что был до', async () => {
  const { screen, nav } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  await fireEvent.press(lastOf(await screen.findAllByText('Правки')));
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'TaskDetail:t2'] });
  // Человек на странице задачи t2 — касается напоминания о t1.
  await act(async () => { mockEmitter.listener(response('t1')); });
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'TaskDetail:t2', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'TaskDetail:t2'] });
  // Ни в какую другую вкладку задача не попала.
  expect(stackOf(nav, 'Chat') || []).not.toContain('TaskDetail');
  // Задачу удалили, пока уведомление ждало, — касание никуда не ведёт.
  await act(async () => { mockEmitter.listener(response('нет-такой')); });
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'TaskDetail:t2'] });
});

test('приложение запустили касанием уведомления: задача над корнем вкладки, касание забыто', async () => {
  mockEmitter.last = response('t2');
  const { nav } = await openApp();
  await waitFor(() => expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain', 'TaskDetail:t2'] }));
  expect(mockEmitter.cleared).toBe(1);
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Projects', stack: ['ProjectsMain'] });
});

test('плашка таймера открывает задачу в своей вкладке, а не в чужой; «назад» — туда же', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - 60_000).toISOString() } });
  const { screen, nav } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain'] });
  // Плашка — кнопка с названием идущей задачи над таббаром.
  await fireEvent.press(lastOf(await screen.findAllByRole('button', { name: 'Вёрстка' })));
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain'] });
  // «Чат-бот» не тронут: до 18 октября задача становилась корнем стека
  // третьей вкладки («Сегодня»), и вкладка потом открывалась сразу задачей.
  expect(stackOf(nav, 'Chat') || ['ChatMain']).toEqual(['ChatMain']);
  await fireEvent.press(tabButton(screen, 'ai.tab'));
  expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
});

test('третья вкладка — «Чат-бот»: плашка таймера кладёт задачу в его стек, «назад» — в разговор', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - 60_000).toISOString() } });
  const { screen, nav } = await openApp();
  const tabs = nav.getRootState().routes.map((r) => r.name);
  expect(tabs).toEqual(['Projects', 'Tasks', 'Chat', 'Stats', 'Menu']);
  await fireEvent.press(tabButton(screen, 'ai.tab'));
  expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
  await fireEvent.press(lastOf(await screen.findAllByRole('button', { name: 'Вёрстка' })));
  expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain', 'TaskDetail:t1'] });
  await back(nav);
  expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
  // Касание уведомления в чате — тоже поверх чата.
  await act(async () => { mockEmitter.listener(response('t2')); });
  expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain', 'TaskDetail:t2'] });
});

// Круг 20 (18 октября 2026): вкладка «Чат-бот» открывается списком чатов, чат —
// экран её стека поверх списка; «назад» — к списку. Таббар на чате спрятан,
// как на всех экранах деталей.
describe('«Чат-бот»: список чатов и чат', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    aiStop();
    useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [], pending: [], needAuth: false });
    await AsyncStorage.setItem(aiChatsKey('u-nav'), JSON.stringify([
      { id: 'c-1', title: 'План недели', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), preview: 'Начнём с понедельника.', count: 2 },
    ]));
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u-nav', email: 'nav@example.com' } });
    session = jest.spyOn(sb.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok-nav' } }, error: null });
    // Чаты аккаунта прочитаны заранее: список встаёт сразу, без чтения хранилища после отрисовки.
    await aiAccount('u-nav');
  });
  let session;
  // Выход — пока экраны ещё на месте (общая уборка дерева идёт после).
  afterEach(async () => {
    await act(async () => { useAuthStore.setState({ status: 'signedOut', user: null }); });
    session.mockRestore();
  });

  test('список → чат → назад = список', async () => {
    const { screen, nav } = await openApp();
    await fireEvent.press(tabButton(screen, 'ai.tab'));
    expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
    await fireEvent.press(await screen.findByTestId('chat-item-c-1'));
    expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain', 'ChatThread'] });
    expect(nav.getCurrentRoute().params).toEqual({ chatId: 'c-1' });
    // Чат — экран деталей: таббар и общая шапка вкладки на нём прячутся.
    expect(DETAIL_ROUTES).toContain('ChatThread');
    await back(nav);
    expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
  });

  // Круг 21 (19 октября 2026): «+» в шапке больше нет — новый чат начинается
  // с поля главного экрана, и переход в него почти незаметен.
  test('из списка — прежним ходом стека; с поля главного — чат поверх него без хода стека, первое сообщение уже в ленте; «назад» — главный', async () => {
    const { screen, nav } = await openApp();
    await fireEvent.press(tabButton(screen, 'ai.tab'));
    expect(screen.queryByTestId('chat-new')).toBeNull();
    await fireEvent.press(await screen.findByTestId('chat-item-c-1'));
    expect(where(nav).stack).toEqual(['ChatMain', 'ChatThread']);
    expect(nav.getCurrentOptions().animation).toBe('ios_from_right');
    await back(nav);

    await fireEvent.changeText(await screen.findByTestId('chat-input'), 'Что у меня завтра?');
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain', 'ChatThread'] });
    const { chatId } = useAiChat.getState();
    expect(nav.getCurrentRoute().params).toMatchObject({ chatId, quiet: true });
    expect(nav.getCurrentOptions().animation).toBe('fade');
    // Первое сообщение отправил экран чата — оно в ленте, и второй раз не уйдёт.
    await waitFor(() => expect(useAiChat.getState().items[0]).toMatchObject({ kind: 'msg', role: 'user', text: 'Что у меня завтра?' }));
    expect(nav.getCurrentRoute().params.send).toBeUndefined();
    await back(nav);
    expect(where(nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
    expect(useAiChat.getState().chats.map((c) => c.id)).toContain(chatId);
  });

  test('поиск с вкладки «Задачи» находит чат и открывает его поверх поиска; «назад» — поиск', async () => {
    await AsyncStorage.setItem('lancible-ai:u-nav:chat:c-1', JSON.stringify({ messages: [], items: [
      { id: 'm1', kind: 'msg', role: 'user', text: 'План недели' },
      { id: 'm2', kind: 'msg', role: 'assistant', text: 'Начнём с понедельника.' },
    ] }));
    const { screen, nav } = await openApp();
    await fireEvent.press(tabButton(screen, 'nav.tasks'));
    const header = screen.getByTestId('root-header');
    await fireEvent.press(await within(header).findByRole('button', { name: t('ru', 'search.placeholder') }));
    expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Search'] });
    await fireEvent.changeText(lastOf(await screen.findAllByPlaceholderText(t('ru', 'search.placeholder'))), 'понедельник');
    await fireEvent.press(await screen.findByTestId('search-chat-c-1'));
    expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Search', 'ChatThread'] });
    expect(nav.getCurrentRoute().params).toEqual({ chatId: 'c-1' });
    await back(nav);
    expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'Search'] });
  });

  // 19 октября 2026 (ревью телефона, находка 7): вход из гостя открывает новую
  // область, вкладки уходят и приходят заново — человек возвращается в
  // «Чат-бот», а не в «Проекты» (RootNavigator: placeOf → returnToPlace).
  test('после смены области — туда же, откуда входили: главный «Чат-бота» и чат', async () => {
    const first = await openApp();
    await fireEvent.press(tabButton(first.screen, 'ai.tab'));
    const main = placeOf(first.nav);
    expect(main).toMatchObject({ name: 'ChatMain', tab: 'Chat' });
    await fireEvent.press(await first.screen.findByTestId('chat-item-c-1'));
    const thread = placeOf(first.nav);
    expect(thread).toMatchObject({ name: 'ChatThread', tab: 'Chat', params: { chatId: 'c-1' } });
    await first.screen.unmount();

    // Вкладки пришли заново — на первой; место возвращается.
    const again = await openApp();
    expect(where(again.nav).tab).toBe('Projects');
    await act(async () => { returnToPlace(again.nav, main); });
    expect(where(again.nav)).toEqual({ tab: 'Chat', stack: ['ChatMain'] });
    await again.screen.unmount();

    const third = await openApp();
    await act(async () => { returnToPlace(third.nav, { ...thread, params: { chatId: 'c-1', send: 'уже ушло', quiet: true, from: 400 } }); });
    expect(where(third.nav)).toEqual({ tab: 'Chat', stack: ['ChatMain', 'ChatThread'] });
    // Только свой id: первое сообщение и проявление на месте уже отыграли.
    expect(third.nav.getCurrentRoute().params).toEqual({ chatId: 'c-1' });
  });

  test('чат, открытый поиском в другой вкладке, возвращается в её стек', async () => {
    const { screen, nav } = await openApp();
    await act(async () => { returnToPlace(nav, { name: 'ChatThread', params: { chatId: 'c-1' }, tab: 'Tasks' }); });
    expect(where(nav)).toEqual({ tab: 'Tasks', stack: ['TasksMain', 'ChatThread'] });
    await screen.unmount();
  });
});

// 19 октября 2026 (ревью телефона, находка 8): напоминание другого аккаунта —
// его задачи в открытой области нет. Касание забывается, иначе после
// переключения на тот аккаунт ready снова станет true, и задача открылась бы
// сама, без касания.
test('касание напоминания, чьей задачи нет в открытой области, забывается: после переключения задача сама не открывается', async () => {
  function Gate({ nav, ready }) {
    useNotificationOpen(nav, ready);
    return null;
  }
  mockEmitter.last = response('t-other');
  const nav = createNavigationContainerRef();
  const tree = (ready) => <NavigationContainer ref={nav}><MainTabs /><Gate nav={nav} ready={ready} /></NavigationContainer>;
  const screen = await render(tree(true));
  await waitFor(() => expect(nav.isReady()).toBe(true));
  expect(mockEmitter.last).toBeNull();
  expect(mockEmitter.cleared).toBe(1);
  expect(where(nav).stack).toEqual(['ProjectsMain']);
  // Переключились на тот аккаунт: пока читалась область, ready ложно; его задача есть.
  await screen.rerender(tree(false));
  await act(async () => { useAppStore.setState({ tasks: [...useAppStore.getState().tasks, task('t-other', 'Чужая')] }); });
  await screen.rerender(tree(true));
  await act(async () => {});
  expect(where(nav).stack).toEqual(['ProjectsMain']);
});

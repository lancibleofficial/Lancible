// Счётчик экранов на телефоне (23 октября 2026, админ-панель).
// Запуск: npm run test:mobile
//
// Правило (lib/screenStats.js): открытие экрана — один вызов
// sb.rpc('track_screen', { p_screen, p_platform }) из одного места —
// слушателя навигации, который включает RootNavigator. Только вошедший с
// принятой текущей редакцией документов, только пока выключатель
// «Статистика экранов» (settings.usageStats) не выключен; тот же экран — не
// чаще раза в 2 с, перерисовка и setParams — не просмотр; ошибки — молча.
// Тест гоняет настоящий RootNavigator с настоящими вкладками Android и
// экранами; базы в Node нет — sb.rpc подменён.
import { Platform } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import RootNavigator from '../src/navigation/RootNavigator';
import { navigationRef } from '../src/navigation/navRef';
import SettingsSectionScreen, { SETTINGS_SECTIONS } from '../src/screens/SettingsSectionScreen';
import ConflictSheet from '../src/components/ConflictSheet';
import TrashSheet from '../src/components/TrashSheet';
import PickerSheet from '../src/components/PickerSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import { DETAIL_ROUTES } from '../src/navigation/detailScreens';
import {
  screenOf, resetScreenStats, screenClock, ROUTE_SCREENS, SETTINGS_SCREENS, SHEET_SCREENS, PHONE_SCREENS, SCREEN_ID_RE, SCREEN_GAP_MS,
} from '../src/lib/screenStats';
import { sb } from '../src/lib/supabaseClient';
import { useAiAccess } from '../src/lib/aiAccess';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

// На телефоне по умолчанию (jest-expo) — вкладки iOS; здесь — те же, что в
// tests/navigationStack.test.js: настоящий навигатор Android.
jest.mock('../src/navigation/MainTabs', () => require('../src/navigation/MainTabs.android'));
// Редактор заметок — WebView без нативной части в Node.
jest.mock('../src/components/DocEditor', () => () => null);
jest.mock('../src/lib/updateCheck', () => ({ checkForUpdate: jest.fn(async () => ({ available: false })), downloadAndInstall: jest.fn() }));
// Агент: ответ не приходит — здесь важна только вкладка.
jest.mock('expo/fetch', () => ({ fetch: jest.fn(() => new Promise(() => {})) }));
jest.mock('expo-notifications/build/NotificationsEmitter', () => ({
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => {},
}));

const LANGS = ['ru', 'en', 'uk', 'kk'];
const USER = { id: 'u1', email: 'ann@example.com', name: 'Аня' };
const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(),
});

// Часы счётчика — свои: предел «раз в 2 с» проверяется в заданную минуту.
let now;
const realClock = screenClock.now;
let rpc;
/** Что отвечает track_screen: функция на каждый вызов. */
let trackAnswer;
let os;

beforeEach(() => {
  now = 1_800_000_000_000;
  screenClock.now = () => now;
  resetScreenStats();
  useAiAccess.setState({ by: {}, sent: {} });
  trackAnswer = async () => ({ data: null, error: null });
  rpc = jest.spyOn(sb, 'rpc').mockImplementation((name, args) => {
    if (name === 'track_screen') return trackAnswer(args);
    if (name === 'ai_has_access') return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  os = jest.replaceProperty(Platform, 'OS', 'android');
  const settings = { ...useAppStore.getState().settings, lang: 'ru' };
  delete settings.usageStats;
  useAppStore.setState({
    hasHydrated: true,
    scopeError: null,
    settings,
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [], tags: [], documents: [], tasks: [task('t1', 'Вёрстка')], activeTimer: null,
  });
  useAuthStore.setState({ init: jest.fn(), switching: false, status: 'signedIn', user: USER, current: USER.id });
  useSheetStore.setState({ content: null, header: null, footer: null });
});

afterEach(async () => {
  await settle();
  await act(async () => { useAuthStore.setState({ status: 'signedOut', user: null, current: null }); });
  rpc.mockRestore();
  screenClock.now = realClock;
  os.restore();
});

/** Просмотры, ушедшие в базу: [экран, платформа]. */
const views = () => rpc.mock.calls.filter(([name]) => name === 'track_screen').map(([, a]) => [a.p_screen, a.p_platform]);
const screensSent = () => views().map(([s]) => s);
const tabButton = (screen, key) => screen.getByRole('button', { name: t('ru', key) });
const lastOf = (list) => list[list.length - 1];
const later = (ms = SCREEN_GAP_MS + 1) => { now += ms; };
/** Страница вкладки достраивается двумя кадрами (TabSlide) — дождаться их внутри act. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const go = async (fn) => { await act(async () => { fn(); }); await settle(); };
const tap = async (screen, key) => { await fireEvent.press(tabButton(screen, key)); await settle(); };

async function openApp() {
  const screen = await render(<NavigationContainer ref={navigationRef}><RootNavigator /></NavigationContainer>);
  // Ждём кадрами внутри act, а не waitFor: ход вкладок досчитывается
  // таймерами, и вне act они сыпали бы предупреждениями.
  const atProjects = () => navigationRef.isReady() && navigationRef.getCurrentRoute().name === 'ProjectsMain';
  for (let i = 0; i < 25 && !atProjects(); i += 1) await settle();
  expect(atProjects()).toBe(true);
  return screen;
}

describe('какие экраны и с какой платформой', () => {
  test('вкладки, детали и разделы настроек шлют свои идентификаторы, платформа — android', async () => {
    const screen = await openApp();
    expect(views()).toEqual([['projects', 'android']]);

    later(); await tap(screen, 'nav.tasks');
    later(); await tap(screen, 'ai.tab');
    later(); await tap(screen, 'nav.stats');
    later(); await tap(screen, 'nav.menu');
    later(); await go(() => navigationRef.navigate('Menu', { screen: 'SettingsSection', params: { section: 'data' } }));
    later(); await go(() => navigationRef.goBack());
    later(); await go(() => navigationRef.navigate('Menu', { screen: 'Feedback' }));
    // На экране деталей панели вкладок нет — во вкладку переходом.
    later(); await go(() => navigationRef.navigate('Projects'));
    later(); await fireEvent.press(lastOf(screen.getAllByText('Вёрстка')));
    later(); await go(() => navigationRef.navigate('Projects', { screen: 'Project', params: { projectId: 'p1' } }));
    later(); await go(() => navigationRef.navigate('Projects', { screen: 'Search' }));
    later(); await go(() => navigationRef.navigate('Projects', { screen: 'Notifications' }));

    expect(screensSent()).toEqual([
      'projects', 'tasks', 'agent', 'stats', 'menu', 'settings.data', 'menu', 'settings.feedback',
      'projects', 'task', 'project', 'search', 'notifications',
    ]);
    expect(new Set(views().map(([, p]) => p))).toEqual(new Set(['android']));
    // Счётчик шлёт только идентификатор и платформу — ни названий, ни id.
    for (const [, args] of rpc.mock.calls.filter(([name]) => name === 'track_screen')) {
      expect(Object.keys(args).sort()).toEqual(['p_platform', 'p_screen']);
    }
  });

  test('на iPhone платформа — ios', async () => {
    os.restore();
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    await openApp();
    expect(views()).toEqual([['projects', 'ios']]);
  });

  test('у каждого экрана навигации и раздела настроек есть идентификатор в формате базы', async () => {
    const screen = await openApp();
    // Все стеки вкладок построены — их routeNames и есть список экранов.
    for (const key of ['nav.tasks', 'ai.tab', 'nav.stats', 'nav.menu']) await tap(screen, key);
    const root = navigationRef.getRootState();
    const names = new Set(root.routeNames);
    for (const tab of root.routes) for (const name of tab.state.routeNames) names.add(name);
    for (const name of DETAIL_ROUTES) names.add(name);
    const missing = [...names].filter((name) => !screenOf({ name }));
    expect(missing).toEqual([]);
    // Разделы — тот же список, что у экрана (обратная связь — свой экран).
    expect(SETTINGS_SCREENS).toEqual(SETTINGS_SECTIONS.map((s) => s.key).filter((k) => k !== 'feedback'));
    for (const key of SETTINGS_SCREENS) expect(screenOf({ name: 'SettingsSection', params: { section: key } })).toBe(`settings.${key}`);
    expect(screenOf({ name: 'SettingsSection', params: { section: 'нет такого' } })).toBe('settings.main');
    for (const id of PHONE_SCREENS) expect(id).toMatch(SCREEN_ID_RE);
    expect(PHONE_SCREENS).toEqual(expect.arrayContaining([...new Set(Object.values(ROUTE_SCREENS)), ...SHEET_SCREENS]));
  });

  test('заметные листы — конфликты, корзина, выгрузка, новый проект и его настройки — считаются экранами, выбор из списка — нет', async () => {
    await openApp();
    const project = useAppStore.getState().projects[0];
    later(); await go(() => openSheet(<ConflictSheet />));
    later(); await go(() => openSheet(<TrashSheet />));
    later(); await go(() => openSheet(<ExportPeriodSheet lang="ru" />));
    later(); await go(() => openSheet(<NewProjectSheet onCancel={() => {}} onCreated={() => {}} />));
    later(); await go(() => openSheet(<NewProjectSheet project={project} onCancel={() => {}} />));
    later(); await go(() => openSheet(<PickerSheet title="x" options={[{ value: 'a', label: 'A' }]} value="a" onSelect={() => {}} />));
    expect(screensSent()).toEqual(['projects', 'conflicts', 'trash', 'export', 'project.new', 'project.settings']);
    // Те же имена, что у окон веба: админка сравнивает платформы по имени.
    expect(SHEET_SCREENS).toEqual(['conflicts', 'trash', 'export', 'project.new', 'project.settings']);
  });
});

describe('кому нельзя', () => {
  test('гость не шлёт ничего; вошёл — уходит экран, что открыт', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null, current: null });
    const screen = await openApp();
    later(); await tap(screen, 'nav.tasks');
    later(); await tap(screen, 'nav.menu');
    later(); await go(() => openSheet(<TrashSheet />));
    expect(views()).toEqual([]);
    later(); await act(async () => { useAuthStore.setState({ status: 'signedIn', user: USER, current: USER.id }); });
    expect(views()).toEqual([['menu', 'android']]);
  });

  test('выключатель выключен — не шлёт; включили — уходит экран, что открыт, и дальше как обычно', async () => {
    useAppStore.setState((s) => ({ settings: { ...s.settings, usageStats: false } }));
    const screen = await openApp();
    later(); await tap(screen, 'nav.tasks');
    later(); await go(() => openSheet(<ConflictSheet />));
    expect(views()).toEqual([]);
    later(); await act(async () => { useAppStore.getState().setSettings({ usageStats: true }); });
    expect(screensSent()).toEqual(['tasks']);
    later(); await tap(screen, 'nav.stats');
    expect(screensSent()).toEqual(['tasks', 'stats']);
    // Выключили посреди работы — снова тишина.
    later(); await act(async () => { useAppStore.getState().setSettings({ usageStats: false }); });
    later(); await tap(screen, 'nav.menu');
    expect(screensSent()).toEqual(['tasks', 'stats']);
  });

  test('текущая редакция документов не принята (шаг согласия) — не шлёт; новый аккаунт без профиля — тоже; приняли — уходит экран, что открыт', async () => {
    useAuthStore.setState({ status: 'needsConsent', user: USER });
    const screen = await openApp();
    later(); await tap(screen, 'nav.tasks');
    later(); await tap(screen, 'nav.menu');
    await act(async () => { useAuthStore.setState({ status: 'needsOnboarding' }); });
    later(); await tap(screen, 'nav.stats');
    expect(views()).toEqual([]);
    later(); await act(async () => { useAuthStore.setState({ status: 'signedIn' }); });
    expect(screensSent()).toEqual(['stats']);
  });
});

describe('без повторов', () => {
  test('перерисовка и setParams того же экрана — не просмотр', async () => {
    const screen = await openApp();
    later(); await tap(screen, 'nav.menu');
    later(); await go(() => navigationRef.navigate('Menu', { screen: 'SettingsSection', params: { section: 'main' } }));
    expect(screensSent()).toEqual(['projects', 'menu', 'settings.main']);
    later(); await screen.rerender(<NavigationContainer ref={navigationRef}><RootNavigator /></NavigationContainer>);
    later(); await act(async () => { useAppStore.getState().setSettings({ theme: 'light' }); });
    later(); await go(() => navigationRef.setParams({ section: 'main', extra: 1 }));
    expect(screensSent()).toEqual(['projects', 'menu', 'settings.main']);
    // Тот же маршрут, но другой раздел — уже другой экран.
    later(); await go(() => navigationRef.setParams({ section: 'about' }));
    expect(screensSent()).toEqual(['projects', 'menu', 'settings.main', 'settings.about']);
  });

  test('тот же экран — не чаще раза в 2 с', async () => {
    const screen = await openApp(); // projects в 0
    await tap(screen, 'nav.tasks'); // tasks в 0
    later(500); await tap(screen, 'nav.projects'); // projects в 500 — рано
    later(1499); await tap(screen, 'nav.tasks'); // tasks в 1999 — рано
    later(1); await tap(screen, 'nav.projects'); // projects в 2000 — можно
    later(1); await tap(screen, 'nav.tasks'); // tasks в 2001 — можно
    expect(screensSent()).toEqual(['projects', 'tasks', 'projects', 'tasks']);
  });
});

test('ошибки базы и сети — молча: экран открывается, приложение не падает', async () => {
  const screen = await openApp();
  trackAnswer = () => Promise.reject(new Error('offline'));
  later(); await tap(screen, 'nav.tasks');
  trackAnswer = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  later(); await tap(screen, 'nav.stats');
  trackAnswer = () => { throw new Error('sb.rpc упал сразу'); };
  later(); await tap(screen, 'nav.menu');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(screensSent()).toEqual(['projects', 'tasks', 'stats', 'menu']);
  expect(navigationRef.getCurrentRoute().name).toBe('MenuMain');
});

describe('выключатель «Статистика экранов» в «Данных»', () => {
  const section = () => render(<SettingsSectionScreen navigation={{ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }} route={{ params: { section: 'data' } }} />);
  const checked = (n) => (n.props.accessibilityState && 'checked' in n.props.accessibilityState ? n.props.accessibilityState.checked : n.props.value);

  test('слова — дословно из договорённости (ru)', () => {
    expect(t('ru', 'settings.usage_title')).toBe('Статистика экранов');
    expect(t('ru', 'settings.usage_hint')).toBe('Отправлять, какие экраны вы открываете, — без содержимого заметок и задач. Так мы видим, чем пользуются.');
  });

  test.each(LANGS)('%s: название и подсказка на месте, по умолчанию включён', async (lang) => {
    useAppStore.setState((s) => ({ settings: { ...s.settings, lang } }));
    const q = await section();
    const group = q.getByTestId('settings-usage-group');
    within(group).getByText(t(lang, 'settings.usage_title'));
    q.getByText(t(lang, 'settings.usage_hint'));
    expect(t(lang, 'settings.usage_title')).not.toBe('settings.usage_title');
    expect(checked(q.getByTestId('settings-usage'))).toBe(true);
  });

  test('выключение и включение сохраняются в настройках', async () => {
    const q = await section();
    await fireEvent(q.getByTestId('settings-usage'), 'valueChange', false);
    expect(useAppStore.getState().settings.usageStats).toBe(false);
    expect(checked(q.getByTestId('settings-usage'))).toBe(false);
    await fireEvent(q.getByTestId('settings-usage'), 'valueChange', true);
    expect(useAppStore.getState().settings.usageStats).toBe(true);
    expect(checked(q.getByTestId('settings-usage'))).toBe(true);
  });

  test('у гостя строки нет — гость и так ничего не шлёт; у аккаунта без сеанса — есть (настройка его области)', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null, current: null });
    let q = await section();
    q.getByTestId('settings-export');
    expect(q.queryByTestId('settings-usage')).toBeNull();
    useAuthStore.setState({ status: 'signedOut', user: null, current: USER.id });
    q = await section();
    q.getByTestId('settings-usage');
  });
});

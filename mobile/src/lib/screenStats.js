// Счётчик экранов (23 октября 2026, админ-панель): какие экраны открывают —
// без содержимого заметок и задач. Один просмотр — один вызов RPC
// track_screen(p_screen, p_platform) (supabase/admin.sql): база сама
// складывает просмотры по дням, клиент её не читает.
//
// Одно место на всё приложение: слушатель состояния контейнера навигации
// (startScreenStats зовёт RootNavigator со ссылкой navRef), а не правка
// каждого экрана. Экран — сфокусированный маршрут (getCurrentRoute), имя
// маршрута переводится в короткий латинский идентификатор (ROUTE_SCREENS,
// разделы настроек — settings.<раздел>). Заметные листы поверх экрана
// (конфликты, корзина, выгрузка, новый проект и его настройки) помечены у
// компонента полем screenId — строкой или функцией от пропсов листа; их ловит
// подписка на слот листа (store/useSheetStore.js). Где у веба то же самое,
// имя то же (USAGE_SCREENS в src/renderer/app.js): админка сравнивает
// платформы по одному имени.
//
// Слать можно только вошедшему с принятой текущей редакцией документов
// (useAuthStore: status 'signedIn' — needsConsent и needsOnboarding им не
// считаются) и пока выключатель «Статистика экранов» не выключен
// (settings.usageStats, нет значения — включён). Гость не шлёт ничего.
// Пока слать нельзя, учтённый экран не сдвигается: вошли, приняли редакцию
// или включили выключатель — уходит экран, что открыт сейчас.
// Тот же экран — не чаще раза в 2 с; перерисовка и правка параметров того же
// маршрута (setParams) — не новый просмотр. Ошибки сети и базы молча
// глотаются: счётчик не должен мешать работе.
import { Platform } from 'react-native';
import { sb } from './supabaseClient';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { useSheetStore } from '../store/useSheetStore';

/** Тот же экран — не чаще раза в столько миллисекунд. */
export const SCREEN_GAP_MS = 2000;

/** Формат идентификатора — тот же check, что у usage_daily.screen. */
export const SCREEN_ID_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

/** Имя маршрута навигации → идентификатор экрана. Вкладки — и сами
 *  (пока стек вкладки ещё не смонтирован, сфокусирован маршрут вкладки), и
 *  корнем своего стека. */
export const ROUTE_SCREENS = {
  Projects: 'projects',
  ProjectsMain: 'projects',
  Tasks: 'tasks',
  TasksMain: 'tasks',
  Chat: 'agent',
  ChatMain: 'agent',
  Stats: 'stats',
  StatsMain: 'stats',
  Menu: 'menu',
  MenuMain: 'menu',
  Project: 'project',
  TaskDetail: 'task',
  ProjectStatuses: 'project.statuses',
  Documents: 'docs',
  Editor: 'doc',
  Notifications: 'notifications',
  Search: 'search',
  Tags: 'tags',
  ChatThread: 'agent.chat',
  // Обратная связь — строка разделов «Меню», как у веба: settings.feedback.
  Feedback: 'settings.feedback',
};

/** Разделы настроек — экраны стека «Меню» (SettingsSection, params.section).
 *  Тот же список, что SETTINGS_SECTIONS экрана, без «Обратной связи» — у неё
 *  свой экран. Незнакомый раздел экран показывает «Основным» — и счётчик тоже. */
export const SETTINGS_SCREENS = ['main', 'work', 'account', 'data', 'about'];

/** Листы поверх экрана, которые считаются экранами (поле screenId компонента):
 *  ConflictSheet, TrashSheet, ExportPeriodSheet, NewProjectSheet (без
 *  project — новый, с project — настройки проекта). */
export const SHEET_SCREENS = ['conflicts', 'trash', 'export', 'project.new', 'project.settings'];

/** Все идентификаторы телефона — для сверки со списком админки. */
export const PHONE_SCREENS = [...new Set([
  ...Object.values(ROUTE_SCREENS),
  ...SETTINGS_SCREENS.map((s) => `settings.${s}`),
  ...SHEET_SCREENS,
])];

/** Идентификатор экрана по маршруту ({ name, params }); незнакомый — null. */
export function screenOf(route) {
  if (!route || typeof route.name !== 'string') return null;
  if (route.name === 'SettingsSection') {
    const section = route.params && route.params.section;
    return `settings.${SETTINGS_SCREENS.includes(section) ? section : 'main'}`;
  }
  return Object.prototype.hasOwnProperty.call(ROUTE_SCREENS, route.name) ? ROUTE_SCREENS[route.name] : null;
}

/** Платформа для базы: только 'android' или 'ios'. */
export const screenPlatform = () => (Platform.OS === 'ios' ? 'ios' : 'android');

/** Можно ли слать сейчас: вошёл, согласие с текущей редакцией есть,
 *  выключатель не выключен. */
export function screenStatsAllowed() {
  const { status, user } = useAuthStore.getState();
  if (status !== 'signedIn' || !user || !user.id) return false;
  const settings = useAppStore.getState().settings || {};
  return settings.usageStats !== false;
}

// Когда какой экран ушёл последний раз — для предела «раз в 2 с».
const sentAt = new Map();

/** Часы предела. Свои, а не подмена Date.now: остановленные общие часы
 *  остановили бы и анимации (тест задаёт минуту здесь). */
export const screenClock = { now: () => Date.now() };

/** Забыть, что уже уходило (тестам — с чистого листа). */
export function resetScreenStats() {
  sentAt.clear();
}

/** Отправить просмотр экрана. true — запрос ушёл. */
export function trackScreen(screen) {
  if (typeof screen !== 'string' || !SCREEN_ID_RE.test(screen)) return false;
  if (!screenStatsAllowed()) return false;
  const now = screenClock.now();
  const last = sentAt.get(screen);
  // Часы могли перевести назад: без abs экран молчал бы, пока время не догонит.
  if (last !== undefined && Math.abs(now - last) < SCREEN_GAP_MS) return false;
  sentAt.set(screen, now);
  try {
    const req = sb.rpc('track_screen', { p_screen: screen, p_platform: screenPlatform() });
    if (req && typeof req.then === 'function') req.then(() => {}, () => {});
  } catch {
    // молча: счётчик не мешает работе
  }
  return true;
}

/** Слушать смену экрана у контейнера навигации nav (ссылка navRef) и
 *  листы поверх. Возвращает отписку. */
export function startScreenStats(nav) {
  // Учтённый экран: аккаунт, маршрут и идентификатор.
  let last = null;
  const onState = () => {
    if (!nav.isReady()) {
      // Навигатора нет (запуск, «Переключаю…»): вернувшийся — новый показ.
      last = null;
      return;
    }
    // Пока слать нельзя (гость, шаг согласия, выключатель снят), учтённый
    // экран не сдвигается: вошли, приняли или включили — уходит тот, что на
    // экране (как у веба).
    if (!screenStatsAllowed()) return;
    const route = nav.getCurrentRoute();
    const uid = useAuthStore.getState().user.id;
    const key = `${uid}|${route ? route.key : ''}`;
    const screen = screenOf(route);
    // Тот же маршрут с тем же экраном — перерисовка или setParams, не показ.
    if (last && last.key === key && last.screen === screen) return;
    last = { key, screen };
    trackScreen(screen);
  };
  const offState = nav.addListener('state', onState);
  const offAuth = useAuthStore.subscribe((s, prev) => {
    if (s.status !== prev.status || s.user !== prev.user) onState();
  });
  const offSettings = useAppStore.subscribe((s, prev) => {
    const now = s.settings || {};
    const was = prev.settings || {};
    if (now !== was && (now.usageStats !== false) !== (was.usageStats !== false)) onState();
  });
  const offSheet = useSheetStore.subscribe((s, prev) => {
    if (!s.content || s.content === prev.content) return;
    const type = s.content.type;
    const id = type && type.screenId;
    trackScreen(typeof id === 'function' ? id(s.content.props || {}) : id);
  });
  onState();
  return () => {
    if (typeof offState === 'function') offState();
    offAuth();
    offSettings();
    offSheet();
  };
}

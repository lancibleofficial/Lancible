// Порт синхронизации из src/renderer/app.js:1196-1302. render()/scheduleSave()
// исчезли — persist-миддлвар useAppStore сам пишет в AsyncStorage при любом
// set(...), подписчики перерисовываются сами. confirmDialog(...) заменён
// нижним листом (ActionSheetContent) с тем же промис-контрактом — нативный
// Alert.alert нельзя стилизовать (ни тему, ни шрифт), см. lib/dialogs.js.
// toast(...) — useAppStore.getState().showToast(...).
//
// Сознательно НЕ импортирует useAuthStore (это дало бы цикл auth<->sync) —
// вместо этого useAuthStore сам зовёт setSyncUser(userId|null) при каждой
// смене статуса входа, а этот модуль держит текущий userId в закрытой
// переменной. activeTimer/settings/ui, как и на десктопе, не
// синхронизируются — это данные конкретного устройства.
import { AppState } from 'react-native';
import { sb } from './supabaseClient';
import { useAppStore } from '../store/useAppStore';
import { openSheet } from '../store/useSheetStore';
import ActionSheetContent from '../components/ActionSheetContent';
import { uid } from './migrate';
import { t } from './i18n';

const SYNC_CLIENT_ID = uid(); // отличает собственные правки от чужих в realtime-подписке
let syncChannel = null;
let syncDirty = false;
let syncRetryTimer = null;
let currentUserId = null;
// JSON последнего состояния, точно совпадающего с сервером — pushSyncState
// сверяется с ним, чтобы не отправлять обратно то же самое, что и так
// только что пришло (иначе два устройства бесконечно перекидывались бы
// идентичными обновлениями по кругу).
let lastSyncedJSON = null;

function syncPayload() {
  const { projects, tasks } = useAppStore.getState();
  return { projects, tasks };
}

export async function pushSyncState() {
  if (!currentUserId || useAppStore.getState().settings.syncEnabled === false) return;
  const payload = syncPayload();
  const json = JSON.stringify(payload);
  if (json === lastSyncedJSON) return;
  try {
    const { error } = await sb.from('sync_state').upsert({
      user_id: currentUserId,
      data: payload,
      updated_at: new Date().toISOString(),
      updated_by: SYNC_CLIENT_ID,
    });
    if (error) throw error;
    lastSyncedJSON = json;
    syncDirty = false;
    // Держим "отпечаток" свежим при каждом обычном пуше, пока пользователь
    // не выходил из аккаунта — иначе создание задачи, пока уже залогинен,
    // само по себе устарило бы отпечаток и на следующем холодном старте
    // диалог "какие данные оставить" всплыл бы просто из-за обычной, уже
    // синхронизированной правки, а не из-за настоящего расхождения.
    rememberSyncResolution(currentUserId);
  } catch (err) {
    console.error('Не удалось синхронизировать данные:', err);
    syncDirty = true;
    scheduleSyncRetry();
  }
}

function scheduleSyncRetry() {
  clearTimeout(syncRetryTimer);
  syncRetryTimer = setTimeout(() => { if (syncDirty && currentUserId) pushSyncState(); }, 15000);
}

function applyRemoteData(data) {
  const projects = Array.isArray(data && data.projects) ? data.projects : [];
  const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  useAppStore.setState((s) => {
    const knownProjectIds = new Set(projects.map((p) => p.id));
    const ui = s.ui.projectId && !knownProjectIds.has(s.ui.projectId) ? { view: 'home', projectId: null } : s.ui;
    return { projects, tasks, ui };
  });
  lastSyncedJSON = JSON.stringify({ projects, tasks });
}

function confirmDialog(message, { title, okLabel, cancelLabel }) {
  return new Promise((resolve) => {
    openSheet(
      <ActionSheetContent
        title={title}
        message={message}
        actions={[
          { label: okLabel, onPress: () => resolve(true) },
          { label: cancelLabel, cancel: true, onPress: () => resolve(false) },
        ]}
      />,
    );
  });
}

// "Отпечаток" локальных данных на момент разрешения конфликта — не спрашиваем
// "какие данные оставить" повторно при каждом входе/холодном старте, если с
// прошлого раза ничего не изменилось (раньше диалог всплывал при КАЖДОМ
// восстановлении сессии — useAuthStore.init() зовёт applyAuthResult на любое
// событие onAuthStateChange, включая просто перезапуск приложения с уже
// действующей сессией, а не только на осознанный вход). Отпечаток сам
// перестаёт совпадать, если пользователь поработал локально (в том числе
// выйдя из аккаунта) — тогда при следующем входе диалог закономерно
// появится снова.
function localSyncFingerprint() {
  return JSON.stringify(syncPayload());
}
function isSyncAlreadyResolved(userId) {
  const r = useAppStore.getState().settings.syncResolvedFor;
  return !!(r && r.userId === userId && r.hash === localSyncFingerprint());
}
function rememberSyncResolution(userId) {
  useAppStore.getState().setSettings({ syncResolvedFor: { userId, hash: localSyncFingerprint() } });
}

// useAuthStore зовёт syncOnSignIn и напрямую (сразу после успешного
// signIn/signUp/onboarding) И косвенно (тот же вход тут же порождает событие
// onAuthStateChange, которое тоже ведёт к syncOnSignIn) — без этой защиты
// оба почти одновременных вызова могли бы каждый открыть свой диалог
// конфликта (второй просто заменил бы первый в единственном слоте
// useSheetStore, оставив первый promise никогда не разрешённым).
let syncInFlightFor = null;

export async function syncOnSignIn(userId) {
  if (!userId || syncInFlightFor === userId) return;
  if (useAppStore.getState().settings.syncEnabled === false) return;
  syncInFlightFor = userId;
  try {
    let row = null;
    try {
      const { data, error } = await sb.from('sync_state').select('data, updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      row = data;
    } catch (err) {
      console.error('Не удалось прочитать синхронизированные данные:', err);
      return;
    }
    const { projects, tasks, settings } = useAppStore.getState();
    const localHasData = projects.length > 0 || tasks.length > 0;
    const remoteHasData = !!(row && row.data && ((row.data.projects || []).length > 0 || (row.data.tasks || []).length > 0));
    if (!remoteHasData) {
      if (localHasData) await pushSyncState();
    } else if (!localHasData) {
      applyRemoteData(row.data);
    } else if (!isSyncAlreadyResolved(userId)) {
      const useServer = await confirmDialog(t(settings.lang, 'sync.conflict_text'), {
        title: t(settings.lang, 'sync.conflict_title'),
        okLabel: t(settings.lang, 'sync.use_server'),
        cancelLabel: t(settings.lang, 'sync.use_local'),
      });
      if (useServer) applyRemoteData(row.data);
      else await pushSyncState();
    }
    rememberSyncResolution(userId);
  } finally {
    syncInFlightFor = null;
  }
}

export function subscribeSyncRealtime(userId) {
  unsubscribeSyncRealtime();
  if (!userId || useAppStore.getState().settings.syncEnabled === false) return;
  syncChannel = sb
    .channel(`sync_state:${userId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_state', filter: `user_id=eq.${userId}` }, (payload) => {
      const row = payload.new;
      if (!row || row.updated_by === SYNC_CLIENT_ID) return; // эхо нашей же записи
      applyRemoteData(row.data);
      rememberSyncResolution(userId); // см. комментарий в pushSyncState
      const lang = useAppStore.getState().settings.lang;
      useAppStore.getState().showToast(t(lang, 'sync.updated_toast'));
    })
    .subscribe();
}

export function unsubscribeSyncRealtime() {
  if (syncChannel) { sb.removeChannel(syncChannel); syncChannel = null; }
}

/** Настройки — источник данных: пользователь может полностью отключить
 * облачную синхронизацию для этого устройства (данные остаются только
 * локально, даже будучи залогиненным), не выходя из аккаунта. */
export function setSyncEnabled(enabled) {
  const { setSettings, showToast, settings } = useAppStore.getState();
  setSettings({ syncEnabled: enabled });
  if (enabled) {
    if (currentUserId) syncOnSignIn(currentUserId);
  } else {
    unsubscribeSyncRealtime();
  }
  showToast(t(settings.lang, enabled ? 'sync.enabled_toast' : 'sync.disabled_toast'));
}

/** Вызывается из useAuthStore при каждой смене статуса входа. */
export function setSyncUser(userId) {
  currentUserId = userId || null;
  if (currentUserId) {
    subscribeSyncRealtime(currentUserId);
    if (syncDirty) pushSyncState();
  } else {
    unsubscribeSyncRealtime();
  }
}

// Локальные изменения данных пушим на сервер с дебаунсом — вместо явного
// pushSyncState() в каждом CRUD/таймер-экшене useAppStore (что раздуло бы
// стор лишними знаниями о синхронизации).
let pushDebounceTimer = null;
useAppStore.subscribe((state, prevState) => {
  if (state.projects === prevState.projects && state.tasks === prevState.tasks) return;
  if (!currentUserId) return;
  clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(pushSyncState, 400);
});

// Долгий уход приложения в фон может протухнуть realtime-сокет так, как это
// не грозит вкладке браузера/окну Electron — переподписываемся при возврате.
AppState.addEventListener('change', (state) => {
  if (state === 'active' && currentUserId) subscribeSyncRealtime(currentUserId);
});

// Касание системного напоминания открывает его задачу (17 октября 2026) —
// поверх того экрана, где человек был, в стеке открытой вкладки: «назад»
// возвращает туда же (navigation/openTask.js). Раньше касание только
// поднимало приложение, задачу приходилось искать руками.
//
// Задачу уведомление несёт в data.taskId (lib/notifications.js). Касание,
// которым приложение запустили, приходит не событием, а «последним ответом»
// — его берём, когда навигация готова, и сразу забываем: иначе перезапуск JS
// открыл бы задачу ещё раз.
//
// Импорт — из подмодуля, а не из `expo-notifications` целиком: см. шапку
// lib/notifications.js (баррель роняет Expo Go на Android).
import { useEffect } from 'react';
import {
  addNotificationResponseReceivedListener,
  getLastNotificationResponse,
  clearLastNotificationResponse,
} from 'expo-notifications/build/NotificationsEmitter';
import { useAppStore, getTask } from '../store/useAppStore';
import { openTaskOnTop } from './openTask';

/** id задачи из ответа на уведомление или null. */
export function taskIdOf(response) {
  const content = response && response.notification && response.notification.request && response.notification.request.content;
  const id = content && content.data && content.data.taskId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * @param {object} navRef — ref контейнера (navigation/navRef.js)
 * @param {boolean} ready — основной интерфейс на экране (RootNavigator)
 */
export function useNotificationOpen(navRef, ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const forget = () => {
      try { clearLastNotificationResponse(); } catch { /* нечего забывать */ }
    };
    const open = (response) => {
      const id = taskIdOf(response);
      if (!id) return;
      // Задачи нет в открытой области: её удалили, пока уведомление ждало в
      // шторке, или это напоминание другого аккаунта (расписание прежней
      // области ещё лежало в системе). Касание забывается и тогда: иначе
      // после переключения на тот аккаунт ready снова станет true, и задача
      // открылась бы сама, без касания.
      if (!getTask(useAppStore.getState().tasks, id)) { forget(); return; }
      if (!navRef.isReady()) return;
      openTaskOnTop(navRef, id);
      forget();
    };
    try {
      const last = getLastNotificationResponse();
      if (last) open(last);
    } catch { /* модуля уведомлений нет — и касаний нет */ }
    let sub = null;
    try { sub = addNotificationResponseReceivedListener(open); } catch { /* то же */ }
    return () => { if (sub) sub.remove(); };
  }, [ready]);
}

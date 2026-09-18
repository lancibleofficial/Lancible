// Локальные уведомления о дедлайнах.
//
// В отличие от десктопа/веба, где приложение само раз в полминуты проверяет,
// не пора ли напомнить, здесь уведомление ПЛАНИРУЕТСЯ в системе заранее:
// приложение большую часть времени выгружено из памяти, и опрашивать что-либо
// изнутри просто некому. Поэтому на каждое изменение дедлайна мы отменяем
// старое уведомление задачи и ставим новое.
//
// Локальные уведомления работают в Expo Go (в отличие от push, которых там
// нет с SDK 53) — дев-билд ради этого не нужен.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reminderTime } from './due';
import { t } from './i18n';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Идентификатор уведомления привязан к задаче, чтобы отменять точечно. */
const idFor = (taskId) => `due-${taskId}`;

let permissionChecked = false;

export async function ensurePermission() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return !!asked.granted;
  } catch (err) {
    console.warn('Не удалось запросить разрешение на уведомления:', err);
    return false;
  } finally {
    permissionChecked = true;
  }
}

export async function permissionStatus() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'ask' : 'denied';
  } catch {
    return 'denied';
  }
}

/** На Android уведомления без канала не показываются вовсе. */
export async function prepareAndroidChannel(langCode) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('deadlines', {
      name: t(langCode, 'notif.title'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch (err) {
    console.warn('Не удалось создать канал уведомлений:', err);
  }
}

export async function cancelTaskReminder(taskId) {
  try {
    await Notifications.cancelScheduledNotificationAsync(idFor(taskId));
  } catch {
    // Уведомления с таким id могло и не быть — это нормальный путь, а не сбой.
  }
}

/** Переставляет уведомление задачи. Возвращает true, если оно запланировано. */
export async function scheduleTaskReminder(task, langCode, enabled) {
  await cancelTaskReminder(task.id);
  if (!enabled || task.done) return false;
  const at = reminderTime(task);
  if (!at || at.getTime() <= Date.now()) return false;
  if (!permissionChecked) await ensurePermission();
  const status = await permissionStatus();
  if (status !== 'granted') return false;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: idFor(task.id),
      content: {
        title: t(langCode, 'notif.reminder'),
        body: task.title || t(langCode, 'task.no_name'),
        ...(Platform.OS === 'android' ? { channelId: 'deadlines' } : null),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    return true;
  } catch (err) {
    console.warn('Не удалось запланировать уведомление:', err);
    return false;
  }
}

/** Полная пересборка расписания — на старте и при переключении тумблера:
 *  система хранит своё расписание отдельно от нашего state, и после
 *  синхронизации с другого устройства оно может разойтись. */
export async function rescheduleAll(tasks, langCode, enabled) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn('Не удалось очистить расписание уведомлений:', err);
  }
  if (!enabled) return;
  for (const task of tasks) {
    if (task.dueAt) await scheduleTaskReminder(task, langCode, true);
  }
}

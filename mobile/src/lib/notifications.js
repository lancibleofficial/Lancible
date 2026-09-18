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
// Импорты намеренно идут в конкретные подмодули, а не в `expo-notifications`
// целиком. Баррель реэкспортирует DevicePushTokenAutoRegistration.fx, а тот
// на уровне модуля зовёт addPushTokenListener → warnOfExpoGoPushUsage, и на
// Android в Expo Go эта функция не предупреждает, а БРОСАЕТ исключение
// («push notifications removed from Expo Go since SDK 53»). То есть один
// только импорт барреля роняет приложение на Android, хотя локальные
// уведомления, которыми мы и пользуемся, работают прекрасно. Перечисленные
// ниже модули проверены — ни один из них не тянет TokenEmitter или .fx.
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications/build/cancelAllScheduledNotificationsAsync';
import { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
import { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { reminderTime } from './due';
import { t } from './i18n';

setNotificationHandler({
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
    const current = await getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await requestPermissionsAsync();
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
    const current = await getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'ask' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Свой канал на Android — чтобы уведомления назывались «Уведомления», а не
 *  «Miscellaneous», и чтобы их можно было настроить отдельно в системе.
 *
 *  В Expo Go его создать нельзя: нативный провайдер каналов там не подключён,
 *  и setNotificationChannelAsync падает с NullPointerException
 *  (`null cannot be cast to ... NotificationsChannelsProvider`). Это ровно то
 *  же ограничение Expo Go, что и с push. Поэтому там канал не создаём вовсе и
 *  шлём уведомления в канал по умолчанию — они всё равно показываются. В
 *  дев-сборке и в релизном APK канал создаётся нормально. */
let androidChannelReady = false;

export async function prepareAndroidChannel(langCode) {
  if (Platform.OS !== 'android' || isRunningInExpoGo()) return;
  try {
    await setNotificationChannelAsync('deadlines', {
      name: t(langCode, 'notif.title'),
      importance: AndroidImportance.DEFAULT,
    });
    androidChannelReady = true;
  } catch (err) {
    console.warn('Не удалось создать канал уведомлений:', err);
  }
}

export async function cancelTaskReminder(taskId) {
  try {
    await cancelScheduledNotificationAsync(idFor(taskId));
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
    await scheduleNotificationAsync({
      identifier: idFor(task.id),
      content: {
        title: t(langCode, 'notif.reminder'),
        body: task.title || t(langCode, 'task.no_name'),
        ...(Platform.OS === 'android' && androidChannelReady ? { channelId: 'deadlines' } : null),
      },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: at },
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
    await cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn('Не удалось очистить расписание уведомлений:', err);
  }
  if (!enabled) return;
  for (const task of tasks) {
    if (task.dueAt) await scheduleTaskReminder(task, langCode, true);
  }
}

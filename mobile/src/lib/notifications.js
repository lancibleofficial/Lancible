// Локальные уведомления: список напоминаний задачи — «до начала», «до
// дедлайна», «один раз» и «повторять».
//
// В отличие от десктопа/веба, где приложение само раз в полминуты проверяет,
// не пора ли напомнить, здесь уведомление ПЛАНИРУЕТСЯ в системе заранее:
// приложение большую часть времени выгружено из памяти, и опрашивать что-либо
// изнутри просто некому. Поэтому расписание собирается заново целиком —
// rescheduleAll: отменить всё, поставить то, что отдаёт ядро
// (core/reminders.js, pendingReminders). Зовёт его lib/reminderSync.js: на
// каждое изменение задач (в том числе приём из облака) и на возвращение в
// приложение.
//
// Идентификаторы — ключи ядра: `rem-${taskId}-${reminderId}-${atMs}`. Система
// держит до 64 запланированных уведомлений (iOS), поэтому ядру отдаётся
// предел 48, горизонт «до начала» и «повторять» — 14 суток, не больше 14
// вхождений каждого напоминания: ежедневное покрывает весь горизонт (до
// 13 октября 2026 было 5, и оно замолкало на шестой день). Ближайшие
// первыми, поэтому общий предел срезает самые дальние. Тексты —
// lib/reminderText.js.
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
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications/build/cancelAllScheduledNotificationsAsync';
import { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
import { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import Reminders from '../core/reminders.js';
import { t } from './i18n';
import { notificationContent } from './reminderText';

setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Пределы расписания: iOS держит 64 уведомления, берём с запасом. */
export const REMINDER_LIMITS = { horizonMs: 14 * 86400000, perReminder: 14, max: 48 };

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

/** Одно расписание за раз: два перепланирования подряд не должны
 *  переплестись (одно отменит то, что только что поставило другое). */
let chain = Promise.resolve();

async function rebuild(tasks, langCode, enabled) {
  try {
    await cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn('Не удалось очистить расписание уведомлений:', err);
  }
  if (!enabled) return;
  const pending = Reminders.pendingReminders(tasks, Date.now(), REMINDER_LIMITS);
  if (!pending.length) return;
  if (!permissionChecked) await ensurePermission();
  if ((await permissionStatus()) !== 'granted') return;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const entry of pending) {
    const task = byId.get(entry.taskId);
    if (!task) continue;
    try {
      await scheduleNotificationAsync({
        identifier: entry.key,
        content: {
          ...notificationContent(entry, task, langCode),
          // Касание открывает эту задачу (navigation/useNotificationOpen.js).
          data: { taskId: task.id },
          ...(Platform.OS === 'android' && androidChannelReady ? { channelId: 'deadlines' } : null),
        },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(entry.at) },
      });
    } catch (err) {
      console.warn('Не удалось запланировать уведомление:', err);
    }
  }
}

/** Полная пересборка расписания: система хранит своё расписание отдельно от
 *  нашего state, и после синхронизации с другого устройства, перевода часов
 *  или просто со временем (горизонт отрезков едет вперёд) оно расходится.
 *  Возвращает промис, который закончится, когда расписание собрано. */
export function rescheduleAll(tasks, langCode, enabled) {
  const run = chain.then(() => rebuild(tasks, langCode, enabled));
  chain = run.catch(() => {});
  return run;
}

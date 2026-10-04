// Подмены нативных модулей для прогона тестов.
//
// Правило отбора: подменяем только то, у чего в Node нет нативной части —
// хранилище и уведомления. Всё остальное (ядро, стор, компоненты) гоняется
// настоящее, иначе тест проверяет подделку.

// Хранилище. Библиотека везёт свою подмену — своя была бы хуже: эта ведёт
// себя как настоящая (возвращает промисы, помнит записанное).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Уведомления. Планировать их в Node негде, а стор дёргает планировщик на
// каждое изменение задачи. Подменяются ровно те подмодули, в которые ходит
// src/lib/notifications.js — поимённо, а не баррель: баррель на Android в
// Expo Go роняет приложение, и в приложении его намеренно нет.
jest.mock('expo-notifications/build/NotificationsHandler', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('expo-notifications/build/NotificationPermissions', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
}));
jest.mock('expo-notifications/build/setNotificationChannelAsync', () => ({ setNotificationChannelAsync: jest.fn(async () => null) }));
jest.mock('expo-notifications/build/scheduleNotificationAsync', () => ({ scheduleNotificationAsync: jest.fn(async () => 'id') }));
jest.mock('expo-notifications/build/cancelScheduledNotificationAsync', () => ({ cancelScheduledNotificationAsync: jest.fn(async () => undefined) }));
jest.mock('expo-notifications/build/cancelAllScheduledNotificationsAsync', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined) }));

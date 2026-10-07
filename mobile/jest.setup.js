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

// Жесты, анимации и безопасные поля. У всех трёх в Node нет нативной части,
// и без подмен экран с жестом (список проекта, сетка «Времени») не
// отрисуется вовсе. Подмены — те, что везут сами библиотеки.
require('react-native-gesture-handler/jestSetup');
// Reanimated 4 стоит на react-native-worklets, и его собственная подмена
// (reanimated/mock) всё равно поднимает worklets — а у тех в Node нет
// нативного модуля (loadUnpackers). Поэтому первыми подменяются worklets,
// их подменой из той же библиотеки; reanimated тогда грузится сам.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// Безопасные поля — нули: своя подмена, потому что библиотечная (jest/mock)
// не отдаёт useSafeAreaInsets функцией.
jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' } }));

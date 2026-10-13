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

// Уведомления. Планировать их в Node негде, а расписание пересобирается на
// каждое изменение задач (lib/reminderSync.js → lib/notifications.js).
// Подменяются ровно те подмодули, в которые ходит src/lib/notifications.js —
// поимённо, а не баррель: баррель на Android в Expo Go роняет приложение, и в
// приложении его намеренно нет. Вызовы подмен видны тестам
// (tests/notifications.test.js).
jest.mock('expo-notifications/build/NotificationsHandler', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('expo-notifications/build/NotificationPermissions', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
}));
jest.mock('expo-notifications/build/setNotificationChannelAsync', () => ({ setNotificationChannelAsync: jest.fn(async () => null) }));
jest.mock('expo-notifications/build/scheduleNotificationAsync', () => ({ scheduleNotificationAsync: jest.fn(async () => 'id') }));
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
// не отдаёт useSafeAreaInsets функцией. Контексты нужны настоящему навигатору
// вкладок (его панель и экраны читают поля через них).
jest.mock('react-native-safe-area-context', () => {
  const { createContext } = require('react');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    SafeAreaInsetsContext: createContext(insets),
    SafeAreaFrameContext: createContext(frame),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});
// Клавиатура по кадрам (react-native-keyboard-controller): в Node её нативной
// части нет. Подмена — та, что везёт сама библиотека; высоты в ней — общие
// объекты (shared value и Animated.Value), и тест листа выставляет их сам,
// как это сделала бы клавиатура (tests/sheetKeyboard.test.js).
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' } }));

// Нативный переключатель Material 3 (modules/lancible-material-switch). Его
// вида в Node нет, как и в Expo Go: модуль отдаёт null, и Switch.js рисует
// переключатель сам. Тест переключателя подставляет на место null хост-элемент
// (jest.replaceProperty) и проверяет, что уходит нативному виду.
jest.mock('./modules/lancible-material-switch', () => ({ MaterialSwitchView: null }));

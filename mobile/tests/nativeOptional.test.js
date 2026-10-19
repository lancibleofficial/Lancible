// Приложение без необязательных нативных модулей. Запуск: npm run test:mobile (из корня)
//
// Expo Go везёт не все нативные модули, и не всегда те, что обещает
// документация: 20 октября 2026 на iPhone не оказалось ExpoDocumentPicker
// (по документации SDK 57 он «Included in Expo Go»), и импорт верхнего уровня
// ронял весь запуск — «Cannot find native module 'ExpoDocumentPicker'». Выбор
// файла с тех пор — File.pickFileAsync (lib/filePicker.js), а модули, без
// которых приложение живёт, грузятся там, где нужны, — внутри действия.
//
// Здесь каждый такой модуль бросает уже на импорте — так ведёт себя
// requireNativeModule без нативной части. Проверяется, что приложение
// целиком (App и все экраны) при этом загружается, а отказывает только само
// действие — и тем путём, который его вызывающий уже показывает человеку.
// Список модулей сверяет со всеми исходниками tests/unit/mobile-native-modules.test.js.
import { File } from 'expo-file-system';

jest.mock('expo-clipboard', () => { throw new Error("Cannot find native module 'ExpoClipboard'"); });
jest.mock('expo-image-manipulator', () => { throw new Error("Cannot find native module 'ExpoImageManipulator'"); });
jest.mock('expo-web-browser', () => { throw new Error("Cannot find native module 'ExpoWebBrowser'"); });
jest.mock('expo-linking', () => { throw new Error("Cannot find native module 'ExpoLinking'"); });
// WebView — обязательный и в Expo Go есть, но в Node его нативной части нет
// (другие тесты подменяют его так же или DocEditor целиком).
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
/** Маленький JPEG: SOI, APP0, … EOI. */
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

afterEach(() => jest.restoreAllMocks());

test('без них приложение загружается целиком: App, навигатор и все экраны', () => {
  expect(() => require('../App')).not.toThrow();
  expect(() => require('../src/navigation/RootNavigator')).not.toThrow();
});

test('буфер обмена: нет модуля — отказ копирования (тост «не вышло»), а не запуска', async () => {
  const { copyText } = require('../src/hooks/useEditorSession');
  await expect(copyText('текст')).rejects.toThrow(/ExpoClipboard/);
});

test('фото редактора: выбор открывается, нет перекодировщика — отказ выбора фото', async () => {
  const { pickPhoto } = require('../src/lib/photoPicker');
  const file = { uri: 'file:///tmp/Inbox/IMG_1.jpg', name: 'IMG_1.jpg', type: 'image/jpeg', size: 22, base64: async () => b64(jpeg()) };
  jest.spyOn(File, 'pickFileAsync').mockResolvedValueOnce({ canceled: false, result: file });
  await expect(pickPhoto()).rejects.toThrow(/ExpoImageManipulator/);
});

test('фото агенту: нет перекодировщика — отказ «не прочитался» с именем файла', async () => {
  const { prepareAttachment } = require('../src/lib/aiAttach');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const raw = { uri: 'file:///tmp/Inbox/IMG_1.jpg', name: 'IMG_1.jpg', size: jpeg().length, read: async () => b64(jpeg()), temp: null };
  await expect(prepareAttachment(raw)).rejects.toMatchObject({ code: 'ai.err_file_read', params: { name: 'IMG_1.jpg' } });
  expect(warn).toHaveBeenCalled();
});

test('вход через Google: нет браузера или ссылок — отказ входа, а не запуска', async () => {
  const { signInWithGoogle } = require('../src/lib/auth');
  const { sb } = require('../src/lib/supabaseClient');
  const oauth = jest.spyOn(sb.auth, 'signInWithOAuth');
  expect(await signInWithGoogle()).toEqual({ ok: false, errorKey: 'auth.error_generic' });
  expect(oauth).not.toHaveBeenCalled();
});

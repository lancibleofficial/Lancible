// Встроенное обновление APK. Запуск: npm run test:mobile (из корня)
//
// Откуда взялось. С 1.1.1 по 1.2.0 кнопка «Обновить» не работала ни у кого:
// updateCheck.js звал deleteAsync, createDownloadResumable и
// getContentUriAsync из корня expo-file-system, а с SDK 54 они там только
// бросают ошибку. Ошибка глоталась, и экран молча открывал страницу релиза.
//
// Поэтому expo-file-system здесь НЕ подменён: работает его настоящий JS, тот
// же, что на телефоне, — старый код упал бы тут так же, как там. Подменена
// только нативная часть, и её уже подменяет jest-expo (файлы в памяти). Сверх
// неё — «сервер» (что отвечает загрузка) и системный установщик: в Node нет
// ни сети, ни Android.
import path from 'path';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { checkForUpdate, downloadAndInstall } from '../src/lib/updateCheck';

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(() => Promise.resolve({ resultCode: 0 })) }));

// Тот самый файл, который jest-expo отдаёт expo-file-system вместо нативного
// модуля: тот же экземпляр, та же память. Через requireNativeModule отсюда его
// не достать — jest-expo ищет подмену в пакете, откуда пришёл вызов.
const Native = jest.requireActual(path.join(path.dirname(require.resolve('expo-file-system/package.json')), 'mocks', 'FileSystem'));
const APK_URL = 'https://github.com/lancibleofficial/Lancible/releases/download/mobile-v9.9.9/Lancible-9.9.9.apk';
const update = (extra) => ({ available: true, version: '9.9.9', url: 'https://example.com/release', apk: APK_URL, canInstall: true, ...extra });
const apk = (n) => new Uint8Array(n).fill(7);

// Что ответит сервер на загрузку: { status, body, contentLength }.
let server;

beforeEach(() => {
  Native.__resetMockFileSystem();
  Platform.OS = 'android';
  IntentLauncher.startActivityAsync.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  server = { status: 200, body: apk(1000), contentLength: 1000 };

  // Загрузка так, как её ведёт Android: ответ не 2xx — отказ с кодом, иначе
  // тело в файл и прогресс с Content-Length (-1, если сервер его не прислал).
  jest.spyOn(Native.FileSystemDownloadTask.prototype, 'start').mockImplementation(function start(url, to) {
    if (server.status < 200 || server.status > 299) return Promise.reject(new Error(`HTTP ${server.status}`));
    const file = new File(to.uri);
    file.create({ intermediates: true, overwrite: true });
    file.write(server.body);
    this.emit('progress', { bytesWritten: server.body.length, totalBytes: server.contentLength });
    return Promise.resolve(file.uri);
  });
  // content:// выдаёт FileProvider приложения; подмена jest-expo отдаёт ''.
  jest.spyOn(Native.FileSystemFile.prototype, 'contentUri', 'get').mockImplementation(function contentUri() {
    return `content://com.lancible.app.FileSystemFileProvider/cache/${this.uri.split('/').pop()}`;
  });
});

afterEach(() => jest.restoreAllMocks());

const target = () => new File(Paths.cache, 'Lancible-9.9.9.apk');

test('качает APK в кэш и отдаёт установщику content://, а не file://', async () => {
  const progress = [];
  const res = await downloadAndInstall(update(), (p) => progress.push(p));
  expect(res).toEqual({ ok: true });
  expect(target().size).toBe(1000);
  expect(progress[progress.length - 1]).toBe(1);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith('android.intent.action.INSTALL_PACKAGE', {
    data: 'content://com.lancible.app.FileSystemFileProvider/cache/Lancible-9.9.9.apk',
    flags: 1,
  });
});

test('остаток прошлой попытки не мешает: файл качается заново', async () => {
  const old = target();
  old.create({ intermediates: true });
  old.write(apk(10));
  expect(await downloadAndInstall(update())).toEqual({ ok: true });
  expect(target().size).toBe(1000);
});

test('ответ не 2xx — отказ «download», установщик не открывается', async () => {
  server = { status: 404, body: apk(0), contentLength: 0 };
  expect(await downloadAndInstall(update())).toEqual({ ok: false, reason: 'download' });
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
});

test('файл короче, чем обещал сервер, — отказ «size», недокачанное удалено', async () => {
  server = { status: 200, body: apk(600), contentLength: 1000 };
  expect(await downloadAndInstall(update())).toEqual({ ok: false, reason: 'size' });
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(target().exists).toBe(false);
});

test('размер из манифеста главнее: не совпал — отказ «size»', async () => {
  // Сервер не прислал Content-Length — сверять можно только с манифестом.
  server = { status: 200, body: apk(1000), contentLength: -1 };
  expect(await downloadAndInstall(update({ size: 1200 }))).toEqual({ ok: false, reason: 'size' });
  expect(await downloadAndInstall(update({ size: 1000 }))).toEqual({ ok: true });
});

test('пустой файл не отдаётся установщику, даже если сверять не с чем', async () => {
  server = { status: 200, body: apk(0), contentLength: -1 };
  expect(await downloadAndInstall(update())).toEqual({ ok: false, reason: 'size' });
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
});

test('установщик не открылся — отказ «install»', async () => {
  IntentLauncher.startActivityAsync.mockRejectedValueOnce(new Error('No Activity found'));
  expect(await downloadAndInstall(update())).toEqual({ ok: false, reason: 'install' });
});

test('не Android — ставить нечем', async () => {
  Platform.OS = 'ios';
  expect(await downloadAndInstall(update())).toEqual({ ok: false, reason: 'unsupported' });
});

test('манифест: новая версия видна, размер из него доходит до загрузки', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ android: { version: '9.9.9', url: 'https://example.com/r', apk: APK_URL, size: 1000 } }),
  }));
  expect(await checkForUpdate()).toEqual({
    available: true, version: '9.9.9', url: 'https://example.com/r', apk: APK_URL, size: 1000, canInstall: true,
  });
});

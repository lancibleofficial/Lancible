// Фото для редактора (src/lib/photoPicker.js). Запуск: npm run test:mobile (из корня)
//
// Своего окна выбора у страницы редактора на телефоне нет: <input type="file">
// по команде с нативной панели Chromium не открывает. Фото выбирает телефон
// системным выбором файла и отдаёт странице байтами (data URL).
//
// 13 октября 2026: файл шёл через мост целиком, как есть — снимок камеры в
// десяток мегабайт строкой base64, а HEIC с iPhone ложился в документ, и
// ни десктоп, ни Android его не показывали. Теперь фото уменьшается до 1600
// точек по длинной стороне и пересжимается в JPEG (expo-image-manipulator),
// PNG остаётся PNG (прозрачность), GIF — как есть (анимация); больше 2 МБ и
// после этого — отказ с тостом (его показывает useEditorSession, тест —
// editorLive). Нативный модуль подменён: проверяется, что у него просят.
import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import { pickPhoto, PHOTO_MAX_SIDE, PHOTO_QUALITY, PHOTO_MAX_BYTES, PHOTO_TOO_BIG, base64Bytes } from '../src/lib/photoPicker';

jest.mock('expo-file-system', () => ({ File: { pickFileAsync: jest.fn() } }));

// Картинка «на диске» — mockImage; что сохранить строкой — mockOut(формат, ширина, высота).
const mockImage = { width: 0, height: 0 };
let mockOut = () => 'QUJD';
const mockLog = [];
jest.mock('expo-image-manipulator', () => {
  const ref = (w, h) => ({
    width: w,
    height: h,
    saveAsync: jest.fn(async (opts) => {
      mockLog.push({ save: opts, width: w, height: h });
      return { uri: 'file:///cache/out', width: w, height: h, base64: mockOut(opts.format, w, h) };
    }),
    release: jest.fn(),
  });
  return {
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    ImageManipulator: {
      manipulate: jest.fn((source) => {
        const base = typeof source === 'string' ? mockImage : source;
        let size = { w: base.width, h: base.height };
        const ctx = {
          resize: jest.fn(({ width, height }) => {
            mockLog.push({ resize: { width, height } });
            size = width ? { w: width, h: Math.round((size.h * width) / size.w) } : { w: Math.round((size.w * height) / size.h), h: height };
            return ctx;
          }),
          renderAsync: jest.fn(async () => ref(size.w, size.h)),
          release: jest.fn(),
        };
        return ctx;
      }),
    },
  };
});

const picked = (file) => File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: file });
const fileOf = (extra) => ({ uri: 'content://media/1', type: 'image/jpeg', name: 'IMG_1.jpg', size: 5_000_000, base64: jest.fn(async () => 'RAW'), ...extra });
const image = (width, height) => Object.assign(mockImage, { width, height });
const saves = () => mockLog.filter((x) => x.save);
const resizes = () => mockLog.filter((x) => x.resize).map((x) => x.resize);
/** Строка base64 на столько байт. */
const b64Of = (bytes) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

beforeEach(() => {
  mockLog.length = 0;
  mockOut = () => 'QUJD';
  ImageManipulator.manipulate.mockClear();
});

test('пределы: 1600 точек по длинной стороне, JPEG 0.85, не больше 2 МБ', () => {
  expect(PHOTO_MAX_SIDE).toBe(1600);
  expect(PHOTO_QUALITY).toBe(0.85);
  expect(PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024);
  expect(base64Bytes('QUJD')).toBe(3);
  expect(base64Bytes('QUI=')).toBe(2);
  expect(base64Bytes(b64Of(300))).toBe(300);
});

test('выбор только картинок; передумали — null', async () => {
  File.pickFileAsync.mockResolvedValueOnce({ canceled: true, result: null });
  expect(await pickPhoto()).toBeNull();
  expect(File.pickFileAsync).toHaveBeenLastCalledWith({ mimeTypes: 'image/*' });
  expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
});

test('снимок с iPhone (HEIC, 4032×3024) — 1600 по ширине, JPEG 0.85; файл целиком через мост не идёт', async () => {
  image(4032, 3024);
  const file = fileOf({ type: 'image/heic', name: 'IMG_0042.HEIC', uri: 'file:///photos/IMG_0042.HEIC' });
  picked(file);
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/jpeg;base64,QUJD', name: 'IMG_0042.jpg' });
  expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///photos/IMG_0042.HEIC');
  expect(resizes()).toEqual([{ width: 1600, height: undefined }]);
  expect(saves()).toEqual([{ save: { format: 'jpeg', compress: 0.85, base64: true }, width: 1600, height: 1200 }]);
  expect(file.base64).not.toHaveBeenCalled();
});

test('портрет — 1600 по высоте; маленькое фото не растягивается, но тоже пересжимается в JPEG', async () => {
  image(3000, 4000);
  picked(fileOf());
  await pickPhoto();
  expect(resizes()).toEqual([{ width: undefined, height: 1600 }]);
  expect(saves()[0]).toMatchObject({ width: 1200, height: 1600 });

  mockLog.length = 0;
  image(800, 600);
  picked(fileOf({ type: 'image/webp', name: 'pic.webp' }));
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/jpeg;base64,QUJD', name: 'pic.jpg' });
  expect(resizes()).toEqual([]);
  expect(saves()).toEqual([{ save: { format: 'jpeg', compress: 0.85, base64: true }, width: 800, height: 600 }]);
});

test('тип и имя не известны — JPEG и «photo»; прежняя форма ответа (сам файл) тоже понятна', async () => {
  image(100, 100);
  File.pickFileAsync.mockResolvedValueOnce(fileOf({ type: '', name: '' }));
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/jpeg;base64,QUJD', name: 'photo.jpg' });
});

test('PNG остаётся PNG (прозрачность); вышел больше 2 МБ — пересжимается в JPEG', async () => {
  image(2000, 1000);
  picked(fileOf({ type: 'image/png', name: 'shot.png' }));
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/png;base64,QUJD', name: 'shot.png' });
  expect(saves()).toEqual([{ save: { format: 'png', base64: true }, width: 1600, height: 800 }]);

  mockLog.length = 0;
  mockOut = (format) => (format === 'png' ? b64Of(PHOTO_MAX_BYTES + 1) : 'SlBH');
  picked(fileOf({ type: 'image/png', name: 'shot.png' }));
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/jpeg;base64,SlBH', name: 'shot.jpg' });
  expect(saves().map((x) => x.save.format)).toEqual(['png', 'jpeg']);
});

test('GIF — как есть (анимация), если не больше 2 МБ; больше — отказ, не читая файл', async () => {
  const gif = fileOf({ type: 'image/gif', name: 'cat.gif', size: 300_000, base64: jest.fn(async () => 'R0lG') });
  picked(gif);
  expect(await pickPhoto()).toEqual({ dataUrl: 'data:image/gif;base64,R0lG', name: 'cat.gif' });
  expect(ImageManipulator.manipulate).not.toHaveBeenCalled();

  const big = fileOf({ type: 'image/gif', name: 'big.gif', size: PHOTO_MAX_BYTES + 1 });
  picked(big);
  await expect(pickPhoto()).rejects.toMatchObject({ code: PHOTO_TOO_BIG });
  expect(big.base64).not.toHaveBeenCalled();
});

// 19 октября 2026: форма обратной связи брала GIF как есть, бакет feedback
// принимает только PNG, JPEG и WebP — и сообщение со снимком не уходило вовсе.
test('still: GIF — неподвижной картинкой: первым кадром в PNG, имя .png; как есть не читается', async () => {
  image(2400, 1200);
  const gif = fileOf({ type: 'image/gif', name: 'cat.gif', uri: 'file:///dl/cat.gif', size: 300_000, base64: jest.fn(async () => 'R0lG') });
  picked(gif);
  expect(await pickPhoto({ still: true })).toEqual({ dataUrl: 'data:image/png;base64,QUJD', name: 'cat.png' });
  expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///dl/cat.gif');
  expect(resizes()).toEqual([{ width: 1600, height: undefined }]);
  expect(saves()).toEqual([{ save: { format: 'png', base64: true }, width: 1600, height: 800 }]);
  expect(gif.base64).not.toHaveBeenCalled();

  // PNG из кадра не влез в 2 МБ — JPEG, как у PNG.
  mockLog.length = 0;
  mockOut = (format) => (format === 'png' ? b64Of(PHOTO_MAX_BYTES + 1) : 'SlBH');
  picked(fileOf({ type: 'image/gif', name: 'big.gif', size: 300_000 }));
  expect(await pickPhoto({ still: true })).toEqual({ dataUrl: 'data:image/jpeg;base64,SlBH', name: 'big.jpg' });

  // Большой GIF файлом (больше 2 МБ) неподвижной картинке не помеха: решает размер после сжатия.
  mockLog.length = 0;
  mockOut = () => 'QUJD';
  picked(fileOf({ type: 'image/gif', name: 'huge.gif', size: PHOTO_MAX_BYTES * 3 }));
  expect(await pickPhoto({ still: true })).toEqual({ dataUrl: 'data:image/png;base64,QUJD', name: 'huge.png' });
});

test('и после сжатия больше 2 МБ — отказ с кодом PHOTO_TOO_BIG (тост покажет редактор)', async () => {
  image(1600, 1200);
  mockOut = () => b64Of(PHOTO_MAX_BYTES + 10);
  picked(fileOf());
  await expect(pickPhoto()).rejects.toMatchObject({ code: PHOTO_TOO_BIG, bytes: PHOTO_MAX_BYTES + 10 });
});

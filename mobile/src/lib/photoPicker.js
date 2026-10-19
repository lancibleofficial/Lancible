// Фото для редактора текста: системный выбор файла (expo-file-system,
// File.pickFileAsync — галерея, загрузки, облака) и байты строкой data URL —
// в таком виде их ждёт страница редактора (insertImage, lib/editorBridge.js).
//
// Своего окна выбора у страницы WebView здесь нет: <input type="file">,
// открытый не касанием внутри страницы, а командой с нативной панели,
// Chromium молча не показывает (нужно «действие пользователя» в самой
// странице) — проверено на эмуляторе 12 октября 2026.
//
// Перед мостом фото уменьшается и пересжимается (expo-image-manipulator,
// 13 октября 2026). Раньше файл шёл строкой base64 целиком — снимок камеры в
// десяток мегабайт, — а HEIC с iPhone ложился в документ как есть, и ни
// десктоп, ни Android его не показывали. Теперь: не больше PHOTO_MAX_SIDE
// точек по длинной стороне, JPEG с качеством PHOTO_QUALITY; PNG остаётся PNG
// (прозрачность — страница сама переведёт его в WebP, src/editor/assets.js),
// GIF — как есть (анимация). Вышло больше PHOTO_MAX_BYTES — отказ с кодом
// PHOTO_TOO_BIG: тост показывает useEditorSession.
//
// still: true (19 октября 2026) — нужна неподвижная картинка: GIF тоже
// пересжимается, первым кадром в PNG (как PNG — JPEG, если не влез). Так
// выбирает форма обратной связи: бакет feedback принимает только PNG, JPEG
// и WebP, и GIF как есть не уходил вовсе.
//
// expo-image-manipulator (20 октября 2026) — по требованию, а не импортом
// верхнего уровня: этот файл грузится на старте, и без нативной части модуля
// (в Expo Go на iPhone так не оказалось expo-document-picker — lib/filePicker.js)
// падал бы весь запуск. Теперь нет модуля — не выходит только перекодировка
// фото, а отказ ловит тот, кто выбирал.
import { pickFile } from './filePicker';

/** expo-image-manipulator: ImageManipulator и SaveFormat. Нет нативной
 *  части — бросает, и это отказ выбора фото, а не запуска. */
function manipulator() {
  // eslint-disable-next-line global-require
  return require('expo-image-manipulator');
}

/** Длинная сторона фото в документе — не больше стольких точек. */
export const PHOTO_MAX_SIDE = 1600;
/** Качество JPEG при пересжатии. */
export const PHOTO_QUALITY = 0.85;
/** Готовое фото — не больше 2 МБ. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** Код отказа: фото и после сжатия больше PHOTO_MAX_BYTES. */
export const PHOTO_TOO_BIG = 'photo_too_big';

/** Сколько байт в строке base64. */
export function base64Bytes(b64) {
  const s = String(b64 || '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

const tooBig = (bytes) => Object.assign(new Error('photo too big'), { code: PHOTO_TOO_BIG, bytes });
const release = (obj) => { try { if (obj && obj.release) obj.release(); } catch { /* уже освобождён */ } };
const withExt = (name, ext) => `${String(name).replace(/\.[a-z0-9]+$/i, '') || 'photo'}.${ext}`;

/** Картинка, уменьшенная до maxSide точек по длинной стороне (меньшая — как
 *  есть). fn(img, SaveFormat) сохраняет её как нужно (saveAsync); всё, что
 *  держит память нативной стороны, освобождается после. Тот же путь — у
 *  вложений агента (lib/aiAttach.js), со своими пределами. */
export async function withScaledImage(uri, maxSide, fn) {
  const { ImageManipulator, SaveFormat } = manipulator();
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  try {
    let img = await own(ImageManipulator.manipulate(uri)).renderAsync();
    own(img);
    const side = Math.max(img.width, img.height);
    if (side > maxSide) {
      const size = img.width >= img.height ? { width: maxSide } : { height: maxSide };
      img = own(await own(ImageManipulator.manipulate(img)).resize(size).renderAsync());
    }
    return await fn(img, SaveFormat);
  } finally {
    owned.forEach(release);
  }
}

/** Уменьшить и пересжать. png — сначала попробовать PNG.
 *  @returns {Promise<{ mime: string, ext: string, base64: string }>} */
function shrink(uri, png) {
  return withScaledImage(uri, PHOTO_MAX_SIDE, async (img, SaveFormat) => {
    if (png) {
      const out = await img.saveAsync({ format: SaveFormat.PNG, base64: true });
      if (base64Bytes(out.base64) <= PHOTO_MAX_BYTES) return { mime: 'image/png', ext: 'png', base64: out.base64 };
    }
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: true });
    const bytes = base64Bytes(out.base64);
    if (bytes > PHOTO_MAX_BYTES) throw tooBig(bytes);
    return { mime: 'image/jpeg', ext: 'jpg', base64: out.base64 };
  });
}

/** Системный выбор одной картинки (галерея, загрузки, облака) — общий выбор
 *  файла (lib/filePicker.js). null — человек передумал; иначе сам файл
 *  expo-file-system: uri, name, type, size, base64(). Тот же выбор — у
 *  вложений агента (lib/aiAttach.js). */
export function pickImageFile() {
  return pickFile('image/*');
}

/** Выбрать картинку. null — человек передумал. Фото больше PHOTO_MAX_BYTES и
 *  после сжатия — отказ (Error с code === PHOTO_TOO_BIG).
 *  @param {{ still?: boolean }} [opts] still — без анимации: GIF пересжимается
 *    первым кадром, как PNG (форма обратной связи).
 *  @returns {Promise<{ dataUrl: string, name: string } | null>} */
export async function pickPhoto({ still = false } = {}) {
  const file = await pickImageFile();
  if (!file) return null;
  const type = String(file.type || '').toLowerCase();
  const name = file.name || 'photo';
  // GIF — как есть: пересжатие оставило бы от анимации один кадр. Нужна
  // неподвижная картинка — один кадр и нужен, ниже он пойдёт как PNG.
  if (type === 'image/gif' && !still) {
    if (file.size > PHOTO_MAX_BYTES) throw tooBig(file.size);
    return { dataUrl: `data:image/gif;base64,${await file.base64()}`, name };
  }
  const out = await shrink(file.uri, type === 'image/png' || type === 'image/gif');
  return { dataUrl: `data:${out.mime};base64,${out.base64}`, name: withExt(name, out.ext) };
}

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
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

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

/** Уменьшить и пересжать. png — сначала попробовать PNG.
 *  @returns {Promise<{ mime: string, ext: string, base64: string }>} */
async function shrink(uri, png) {
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  try {
    let img = await own(ImageManipulator.manipulate(uri)).renderAsync();
    own(img);
    const side = Math.max(img.width, img.height);
    if (side > PHOTO_MAX_SIDE) {
      const size = img.width >= img.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE };
      img = own(await own(ImageManipulator.manipulate(img)).resize(size).renderAsync());
    }
    if (png) {
      const out = await img.saveAsync({ format: SaveFormat.PNG, base64: true });
      if (base64Bytes(out.base64) <= PHOTO_MAX_BYTES) return { mime: 'image/png', ext: 'png', base64: out.base64 };
    }
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: true });
    const bytes = base64Bytes(out.base64);
    if (bytes > PHOTO_MAX_BYTES) throw tooBig(bytes);
    return { mime: 'image/jpeg', ext: 'jpg', base64: out.base64 };
  } finally {
    owned.forEach(release);
  }
}

/** Выбрать картинку. null — человек передумал. Фото больше PHOTO_MAX_BYTES и
 *  после сжатия — отказ (Error с code === PHOTO_TOO_BIG).
 *  @returns {Promise<{ dataUrl: string, name: string } | null>} */
export async function pickPhoto() {
  const res = await File.pickFileAsync({ mimeTypes: 'image/*' });
  if (!res || res.canceled) return null;
  // Прежняя форма ответа — сам файл (или их список), новая — { result, canceled }.
  const picked = res.result !== undefined ? res.result : res;
  const file = Array.isArray(picked) ? picked[0] : picked;
  if (!file) return null;
  const type = String(file.type || '').toLowerCase();
  const name = file.name || 'photo';
  // GIF — как есть: пересжатие оставило бы от анимации один кадр.
  if (type === 'image/gif') {
    if (file.size > PHOTO_MAX_BYTES) throw tooBig(file.size);
    return { dataUrl: `data:image/gif;base64,${await file.base64()}`, name };
  }
  const out = await shrink(file.uri, type === 'image/png');
  return { dataUrl: `data:${out.mime};base64,${out.base64}`, name: withExt(name, out.ext) };
}

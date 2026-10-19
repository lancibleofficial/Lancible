// Вложения сообщения агенту на телефоне (круг 20, 18 октября 2026). Скрепка у
// поля чата открывает лист: «Фото» — тот же системный выбор картинки, что у
// редактора (lib/photoPicker.js: pickImageFile), «Файл» — тот же системный
// выбор файла (lib/filePicker.js, File.pickFileAsync; с 20 октября 2026 —
// вместо expo-document-picker): PDF и текст — TXT, MD, CSV. Word и Excel
// агент не берёт: их разбор — отдельная работа и отдельная поверхность атаки.
//
// Правила — ядро (core/ai.js), те же, что у веба и у функции ai-chat:
// - тип — по содержимому, а не по расширению: файл читается строкой base64,
//   раскладывается в байты (Uint8Array), и их смотрит aiCheckAttachment;
// - фото перекодируется на устройстве (expo-image-manipulator): длинная
//   сторона не больше AI_ATTACH.imageSide, JPEG с качеством
//   AI_ATTACH.imageQuality (числа ядра, те же у веба), PNG — только если
//   исходник PNG с прозрачностью. Перекодировка снимает EXIF,
//   место съёмки и всё, что было приклеено к файлу: уходит только
//   перекодированное;
//   HEIC с камеры iPhone в белом списке нет — его телефон сначала
//   перекодирует в JPEG и проверяет уже результат;
// - текст декодируется как UTF-8 строго (fatal): битый — отказ;
// - сколько их и сколько весят вместе — aiCheckAttachments, после
//   перекодировки; в сообщение ложатся блоками aiAttachmentBlocks прошедшие
//   эту проверку (её items).
//
// Вложение нигде не хранится: байты живут в памяти, пока сообщение не ушло;
// миниатюра в поле — из перекодированного файла в кеше, и он удаляется сразу
// после отправки или когда вложение убрали (dropFile). В истории чата
// остаётся только карточка «имя · тип · размер» (fileCard) — без байтов и без
// миниатюры.
import { File } from 'expo-file-system';
import Ai from '../core/ai.js';
import { pickImageFile, withScaledImage } from './photoPicker';
import { pickFile, pickedCopy } from './filePicker';
import { uid as newId } from './migrate';
import { t, LOCALE_MAP } from './i18n';

/** Что предлагает выбор «Файл»: PDF и текст (TXT, MD, CSV). Тип всё равно
 *  решают байты, а не то, что о файле говорит система. */
export const ATTACH_FILE_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv', 'text/comma-separated-values'];

/** Отказ с ключом строки (ai.err_file_*) и подстановками для неё. */
const refusal = (key, params) => Object.assign(new Error(key), { code: key, params: params || {} });

/** Строка base64 → байты. */
export function bytesOf(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Есть ли у PNG прозрачность: канал альфа (цвет 4 или 6 в IHDR) или кусок
 *  tRNS до первых данных картинки. */
export function pngHasAlpha(bytes) {
  if (!bytes || bytes.length < 33) return false;
  const color = bytes[25];
  if (color === 4 || color === 6) return true;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (name === 'tRNS') return true;
    if (name === 'IDAT' || name === 'IEND') return false;
    at += 12 + len;
  }
  return false;
}

/** Самый большой файл, который вообще есть смысл читать: больше — отказ по
 *  размеру сразу, не читая (строка base64 на сотню мегабайт уронила бы
 *  приложение раньше всякой проверки). */
const readLimit = () => Math.max(Ai.AI_ATTACH.imageBytes, Ai.AI_ATTACH.pdfBytes, Ai.AI_ATTACH.textBytes);

/** Удалить файл, если он есть (копия выбора в кеше, перекодированное фото). */
function drop(uri) {
  if (!uri) return;
  try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* кеш почистит система */ }
}

/** Системный выбор: 'photo' или 'file'. null — человек передумал.
 *  @returns {Promise<{ uri, name, size, read: () => Promise<string>, temp: string|null } | null>} */
export async function pickAttachment(kind) {
  if (kind === 'photo') {
    const f = await pickImageFile();
    if (!f) return null;
    return { uri: f.uri, name: f.name || 'photo', size: Number(f.size) || 0, read: () => f.base64(), temp: null };
  }
  const file = await pickFile(ATTACH_FILE_TYPES);
  if (!file) return null;
  return {
    uri: file.uri,
    name: file.name || 'file',
    size: Number(file.size) || 0,
    read: () => file.base64(),
    // Копия выбора (iOS) — удалить после чтения; на Android адрес ведёт на сам
    // файл человека, и трогать его нельзя (lib/filePicker.js: pickedCopy).
    temp: pickedCopy(file),
  };
}

/** HEIC и HEIF (камера iPhone) — в белом списке ядра их нет, но телефон их
 *  открывает: такое фото сначала перекодируется в JPEG и только потом идёт
 *  в проверку. Узнаётся по коробке ftyp в начале файла. */
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
export function isHeif(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') return false;
  return HEIF_BRANDS.includes(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]));
}

/** Имя под то, что получилось: у перекодированного фото расширение должно
 *  совпадать с видом байтов (ядро сверяет). Картинка с расширением картинки
 *  остаётся со своим именем — как на вебе. */
function nameFor(name, mediaType) {
  const ext = (/\.([A-Za-z0-9]{1,10})$/.exec(name) || [])[1];
  if (!ext || Ai.AI_ATTACH.extensions.image.includes(ext.toLowerCase())) return name;
  return `${name.replace(/\.[A-Za-z0-9]{1,10}$/, '')}.${mediaType === 'image/png' ? 'png' : 'jpg'}`;
}

/** Перекодировать фото: PNG — если исходник PNG с прозрачностью, иначе JPEG.
 *  Уходит только то, что вернул manipulator: метаданные исходника (EXIF,
 *  место съёмки) и всё дописанное в файл остаются в нём. */
async function reencode(uri, png) {
  const { imageSide, imageQuality } = Ai.AI_ATTACH;
  const out = await withScaledImage(uri, imageSide, (img, SaveFormat) => img.saveAsync(png
    ? { format: SaveFormat.PNG, base64: true }
    : { format: SaveFormat.JPEG, compress: imageQuality, base64: true }));
  return { uri: out.uri, base64: out.base64, mediaType: png ? 'image/png' : 'image/jpeg' };
}

/** Фото: перекодировка и проверка того, что вышло. */
async function photoOf(raw, name, bytes, png) {
  let out;
  try { out = await reencode(raw.uri, png); } catch (err) {
    console.warn('Фото не перекодировалось:', err);
    throw refusal('ai.err_file_read', { name });
  }
  const sent = bytesOf(out.base64);
  const file = nameFor(name, out.mediaType);
  const again = Ai.aiCheckAttachment({ name: file, size: sent.length, bytes: sent });
  if (!again || !again.ok) { drop(out.uri); throw refusal((again && again.error) || 'ai.err_file_type', (again && again.params) || { name }); }
  return { id: newId(), name: again.name || file, kind: 'image', mediaType: again.mediaType, size: sent.length, bytes: sent, data: out.base64, uri: out.uri };
}

/** Выбранный файл → вложение, готовое к отправке, или отказ (Error с code —
 *  ключом ai.err_file_* и params ядра). Байты проверяет ядро по содержимому.
 *  @returns {Promise<{ id, name, kind, mediaType, size, bytes, data?, uri? }>} —
 *    data — base64 того, что уйдёт (у фото — перекодированного), uri — файл
 *    миниатюры в кеше (только у фото) */
export async function prepareAttachment(raw) {
  try {
    if (raw.size > readLimit()) {
      // Ядро само скажет «слишком большой» — с пределом в подстановках.
      const r = Ai.aiCheckAttachment({ name: raw.name, size: raw.size });
      throw refusal(r.error, r.params);
    }
    let b64;
    try { b64 = await raw.read(); } catch (err) {
      console.warn('Файл не прочитался:', err);
      throw refusal('ai.err_file_read', { name: raw.name });
    }
    const bytes = bytesOf(b64);
    // HEIC — сначала в JPEG (тот же предел, что у картинки до перекодировки).
    if (isHeif(bytes)) {
      if (bytes.length > Ai.AI_ATTACH.imageBytes) throw refusal('ai.err_file_size', { name: raw.name });
      return await photoOf(raw, raw.name, bytes, false);
    }
    const check = Ai.aiCheckAttachment({ name: raw.name, size: bytes.length, bytes });
    if (!check || !check.ok) throw refusal((check && check.error) || 'ai.err_file_type', (check && check.params) || { name: raw.name });
    const name = check.name || raw.name;
    if (check.kind === 'image') return await photoOf(raw, name, bytes, check.mediaType === 'image/png' && pngHasAlpha(bytes));
    if (check.kind === 'text') {
      // Второй замок поверх ядра: строгий UTF-8 — битый байт не «чинится»
      // знаком замены, а отказывает.
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw refusal('ai.err_file_type', { name }); }
      return { id: newId(), name, kind: 'text', mediaType: 'text/plain', size: bytes.length, bytes };
    }
    return { id: newId(), name, kind: 'pdf', mediaType: check.mediaType, size: bytes.length, bytes, data: b64 };
  } finally {
    drop(raw.temp);
  }
}

/** То, что ядро проверяет, — без лишнего (миниатюры, id). */
const checkInput = (it) => ({ name: it.name, size: it.size, bytes: it.bytes, ...(it.data ? { data: it.data } : {}) });

/** Каждое вложение, число и сумма — ядро, после перекодировки.
 *  @returns {{ ok, items, error?, params? }} — items идут в aiAttachmentBlocks */
export function checkAll(list) {
  return Ai.aiCheckAttachments(list.map(checkInput));
}

/** Блоки сообщения Messages API из прошедших проверку — ядро
 *  (aiAttachmentBlocks). Не прошла — ключ отказа и подстановки.
 *  @returns {{ blocks } | { error, params }} */
export function attachmentBlocks(list) {
  const check = checkAll(list);
  if (!check || !check.ok) return { error: (check && check.error) || 'ai.err_file_type', params: (check && check.params) || {} };
  return { blocks: Ai.aiAttachmentBlocks(check.items) };
}

/** Карточка вложения для истории: имя, вид, тип, размер — без байтов. */
export const fileCard = (it) => ({ name: it.name, kind: it.kind, mediaType: it.mediaType, size: it.size });

/** Убрать перекодированный файл из кеша (миниатюра в поле больше не нужна). */
export function dropFile(it) {
  if (it && it.uri) drop(it.uri);
}

/** Тип словом для карточки: JPEG, PNG, PDF; у текста — расширение (TXT, MD,
 *  CSV). То же правило, что у веба. */
export function fileType(card) {
  if (!card) return '';
  if (card.kind === 'text') {
    const ext = (String(card.name || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1];
    return ext && /^(txt|md|markdown|csv)$/i.test(ext) ? ext.toUpperCase().replace('MARKDOWN', 'MD') : 'TXT';
  }
  return (String(card.mediaType || '').split('/')[1] || '').toUpperCase();
}

/** «512 Б», «240 КБ», «4,2 МБ» — размер по языку, как у веба. */
export function fileSize(bytes, lang) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return t(lang, 'ai.size_b', { n });
  if (n < 1024 * 1024) return t(lang, 'ai.size_kb', { n: Math.max(1, Math.round(n / 1024)) });
  const mb = n / (1024 * 1024);
  return t(lang, 'ai.size_mb', { n: mb.toLocaleString(LOCALE_MAP[lang] || 'ru-RU', { maximumFractionDigits: mb < 10 ? 1 : 0 }) });
}

/** «отчёт.pdf · PDF · 340 КБ». */
export const fileLine = (card, lang) => [card.name, fileType(card), fileSize(card.size, lang)].filter(Boolean).join(' · ');

/** Отказ вложения строкой. Ключи — ядра (ai.err_file_*), пределы в тексте —
 *  из AI_ATTACH, размером для людей; те же подстановки, что у веба. */
export function attachErrorText(err, lang) {
  if (!err) return '';
  const lim = Ai.AI_ATTACH;
  const p = err.params || {};
  return t(lang, err.key, {
    name: p.name || '',
    max: err.key === 'ai.err_file_count' ? lim.maxCount : fileSize(lim.totalBytes, lang),
    image: fileSize(lim.imageBytes, lang),
    pdf: fileSize(lim.pdfBytes, lang),
    text: fileSize(lim.textBytes, lang),
  });
}

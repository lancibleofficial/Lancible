// Обратная связь с телефона (17 октября 2026): та же запись, что шлют веб и
// десктоп, — строка в таблице feedback и, если приложили, картинка в
// приватном бакете feedback (supabase/feedback.sql). Дальше строку
// пересылает в Telegram вебхук базы — телефон об этом не знает.
//
// Тело одно на все поверхности: kind ('bug' | 'idea' | 'other'), text (до
// 4000), platform ('android' | 'ios'), app_version (из app.json), lang,
// device (модель словами), screenshot_path (<uuid>.<png|jpg|webp> или null)
// и user_id — только у вошедшего: гость шлёт без него, так велит политика.
// id строки заводит телефон, как веб: одна запись на попытку и её повторы.
//
// С 19 октября 2026 — сначала строка, потом снимок (путь — <id строки>.<ext>):
// бакет примет только файл, названный в screenshot_path строки не старше
// 15 минут, а частоту строк держит база (5 за 10 минут и 20 за сутки с
// аккаунта, 30 в час на всех гостей; отказ — 'feedback rate', код P0001).
// Дошедшая строка второй раз не уходит: отказала только загрузка — повтор
// догружает снимок.
//
// Черновик живёт в памяти до отправки: ушли с экрана и вернулись, сеть
// упала — текст и вид на месте (draft / saveDraft).
import { Platform } from 'react-native';
import appJson from '../../app.json';
import { sb } from './supabaseClient';

export const FEEDBACK_MAX = 4000;
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'];
export const FEEDBACK_BUCKET = 'feedback';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

let draftCache = { kind: 'bug', text: '' };
/** Черновик формы: { kind, text }. */
export const draft = () => draftCache;
export const saveDraft = (next) => { draftCache = { ...draftCache, ...next }; };
export const clearDraft = () => { draftCache = { kind: 'bug', text: '' }; };

/** 'android' | 'ios' — так их называет таблица. */
export function feedbackPlatform(os = Platform.OS) {
  return os === 'ios' ? 'ios' : 'android';
}

/** Версия приложения — из app.json, как в сборке. */
export function appVersion() {
  return String((appJson && appJson.expo && appJson.expo.version) || '').slice(0, 40) || null;
}

/** Модель словами: «Google Pixel 8 · Android 15», «iOS 26.0». Не больше 200
 *  знаков. Без своего модуля (expo-device) — что знает сам React Native. */
export function deviceName(os = Platform.OS, c = Platform.constants || {}) {
  const parts = os === 'android'
    ? [[c.Brand, c.Model].filter(Boolean).join(' '), c.Release ? `Android ${c.Release}` : null]
    : [c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone', [c.systemName || 'iOS', c.osVersion].filter(Boolean).join(' ')];
  const s = parts.filter(Boolean).join(' · ');
  return s ? s.slice(0, 200) : null;
}

/** uuid v4 для id строки и имени картинки: выбирает клиент, чужое совпасть не может. */
export function uuid4() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 → байты (atob в Hermes есть не везде, а строка картинки большая). */
export function base64ToBytes(b64) {
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12)
      | ((i + 2 < s.length ? B64.indexOf(s[i + 2]) : 0) << 6) | (i + 3 < s.length ? B64.indexOf(s[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < s.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** data URL картинки → { mime, ext, bytes }; не картинка из разрешённых — null. */
export function parseImage(dataUrl) {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(dataUrl || ''));
  if (!m || !EXT[m[1]]) return null;
  return { mime: m[1], ext: EXT[m[1]], bytes: base64ToBytes(m[2]) };
}

/** Строка таблицы feedback. userId нет — поля user_id нет совсем; id нет — его
 *  заведёт база (так строку зовут только тесты). */
export function feedbackRow({ id, kind, text, lang, userId, screenshotPath, os = Platform.OS, constants }) {
  const row = {
    ...(id ? { id } : {}),
    kind: FEEDBACK_KINDS.includes(kind) ? kind : 'other',
    text: String(text || '').trim().slice(0, FEEDBACK_MAX),
    platform: feedbackPlatform(os),
    app_version: appVersion(),
    lang: lang ? String(lang).slice(0, 8) : null,
    device: deviceName(os, constants || Platform.constants || {}),
    screenshot_path: screenshotPath || null,
  };
  if (userId) row.user_id = userId;
  return row;
}

/** Отказ базы «слишком много подряд» (триггер feedback_rate в feedback.sql). */
export function isRateLimited(error) {
  return !!error && error.code === 'P0001' && /feedback rate/i.test(String(error.message || ''));
}

/** Картинку — в бакет по пути, который назвала строка. Ошибка — бросает; файл
 *  с этим именем уже лежит — это наш, от прошлой попытки, ошибки нет. */
export async function uploadShot(img, path) {
  const { error } = await sb.storage.from(FEEDBACK_BUCKET).upload(path, img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.byteLength), {
    contentType: img.mime,
    upsert: false,
  });
  if (error && !/exist|duplicate/i.test(`${error.message || ''} ${error.error || ''}`)) throw error;
}

/**
 * Отправить: сначала строка, потом снимок.
 * @param shot { dataUrl } или null
 * @param attempt — прошлая попытка ({ id, path, sent, uploaded }) или null:
 *   строка с её id дошла — второй раз не уходит, только догружается снимок.
 * @returns { ok: true, attempt } или { ok: false, stage: 'row' | 'shot',
 *   rate, error, attempt } — rate: база отказала по частоте; stage 'shot':
 *   сообщение дошло без снимка. attempt — передать в повтор.
 */
export async function sendFeedback({ kind, text, lang, userId, shot, attempt }) {
  const a = attempt && attempt.id ? { ...attempt } : { id: uuid4(), path: null, sent: false, uploaded: false };
  const img = shot ? parseImage(shot.dataUrl) : null;
  // Не та картинка (GIF из галереи) — бакет её не примет; строку не шлём.
  if (shot && !img) return { ok: false, stage: 'row', rate: false, error: new Error('feedback: не картинка'), attempt: a };
  if (!a.sent) {
    a.path = img ? `${a.id}.${img.ext}` : null;
    try {
      const { error } = await sb.from('feedback').insert(feedbackRow({ id: a.id, kind, text, lang, userId, screenshotPath: a.path }));
      // 23505 — строка с этим id уже есть: прошлая попытка дошла, а ответ нет.
      if (error && error.code !== '23505') throw error;
      a.sent = true;
    } catch (error) {
      return { ok: false, stage: 'row', rate: isRateLimited(error), error, attempt: a };
    }
  }
  if (a.path && img && !a.uploaded) {
    try {
      await uploadShot(img, a.path);
      a.uploaded = true;
    } catch (error) {
      return { ok: false, stage: 'shot', rate: false, error, attempt: a };
    }
  }
  return { ok: true, attempt: a };
}

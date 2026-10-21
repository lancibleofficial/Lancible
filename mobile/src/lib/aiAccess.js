// Доступ к ИИ-агенту по приглашению (21 октября 2026). Агент открыт только
// аккаунтам, чья почта есть в таблице ai_access (supabase/ai-access.sql);
// выдаёт доступ владелец в Table Editor. Сторож — функция ai-chat: без
// доступа она отвечает 403 { error: 'no access' }. Клиент лишь спрашивает
// заранее — RPC ai_has_access(), — чтобы показать вместо поля экран «закрытый
// тест» (components/chat/ChatLocked.js), а не ошибку после первого сообщения.
//
// Ответ помнится по аккаунту в памяти (by: uid → true | false): открыли
// вкладку снова, вернулись в аккаунт — прежнее известное стоит сразу, а
// проверка идёт заново в фоне; поле ввода не мигает. Не знаем ещё ничего —
// экраны рисуют скелет. Не узнали (нет сети, функции ещё нет в базе) —
// прежнее известное остаётся, а если его не было — открыто: решает функция,
// и её 403 закроет экран (lib/aiChat.js: aiLockAccess).
//
// «Запросить доступ» — строка обратной связи (kind 'other') тем же кодом, что
// экран «Обратная связь» (lib/feedback.js: sendFeedback), с почтой аккаунта в
// тексте: по ней владелец и выдаст доступ. Ушёл — помнится по аккаунту на
// устройстве (lib/aiKeys.js: aiRequestKey), кнопка больше не нажимается.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { sb } from './supabaseClient';
import { sendFeedback } from './feedback';
import { aiRequestKey } from './aiKeys';
import { onScopeRemoved } from './accounts';

/** by — доступ по аккаунтам: uid → true (есть) | false (закрытый тест), ключа
 *  нет — ещё не знаем. sent — uid → true: запрос доступа с устройства ушёл. */
export const useAiAccess = create(() => ({ by: {}, sent: {} }));

const put = (fn) => useAiAccess.setState(fn);

/** 'open' | 'locked' | 'unknown'; гость — null. */
export function accessOf(uid, by = useAiAccess.getState().by) {
  if (!uid) return null;
  if (by[uid] === true) return 'open';
  if (by[uid] === false) return 'locked';
  return 'unknown';
}

/** Доступ аккаунта для экрана: 'open' | 'locked' | 'unknown' | null. */
export const useAccess = (uid) => useAiAccess((st) => accessOf(uid, st.by));

function setAccess(uid, value) {
  put((st) => (st.by[uid] === value ? st : { by: { ...st.by, [uid]: value } }));
}

/** Функция ответила 403 no access — закрытый тест, сразу. */
export function aiLockAccess(uid) {
  if (uid) setAccess(uid, false);
}

// Проверка, которая уже идёт: второй экран, открывшийся следом, ждёт её же.
const flight = new Map();

/** Спросить базу, открыт ли агент этому аккаунту (RPC ai_has_access).
 *  @returns промис 'open' | 'locked' (null — гость) */
export function aiCheckAccess(uid) {
  if (!uid) return Promise.resolve(null);
  if (flight.has(uid)) return flight.get(uid);
  const p = (async () => {
    let res;
    try {
      res = typeof sb.rpc === 'function' ? await sb.rpc('ai_has_access') : { data: null, error: new Error('rpc недоступен') };
    } catch (error) {
      res = { data: null, error };
    }
    const { data, error } = res || {};
    if (!error && typeof data === 'boolean') setAccess(uid, data);
    else {
      console.warn('Доступ к агенту не проверился:', error || data);
      if (!(uid in useAiAccess.getState().by)) setAccess(uid, true);
    }
    return accessOf(uid);
  })().finally(() => { flight.delete(uid); });
  flight.set(uid, p);
  return p;
}

/** Текст строки обратной связи — для владельца, всегда по-русски. */
export const accessRequestText = (email) => `Запрос доступа к ИИ-агенту: ${String(email || '').trim()}`;

/** Прочитать с устройства, уходил ли запрос этого аккаунта. */
export async function aiLoadRequest(uid) {
  if (!uid || useAiAccess.getState().sent[uid]) return;
  let raw = null;
  try { raw = await AsyncStorage.getItem(aiRequestKey(uid)); } catch (err) { console.warn('Запрос доступа не прочитался:', err); }
  if (raw) put((st) => ({ sent: { ...st.sent, [uid]: true } }));
}

// Прошлая попытка по аккаунту (lib/feedback.js): строка с её id дошла, а
// ответ нет, — повтор второй строки не заведёт.
const attempts = new Map();

/** «Запросить доступ»: строка feedback с почтой аккаунта.
 *  @returns { ok: true } или { ok: false, rate } — rate: база отказала по частоте */
export async function aiRequestAccess({ uid, email, lang }) {
  if (!uid) return { ok: false, rate: false };
  const res = await sendFeedback({
    kind: 'other', text: accessRequestText(email), lang, userId: uid, shot: null, attempt: attempts.get(uid) || null,
  });
  if (!res.ok) {
    attempts.set(uid, res.attempt);
    console.error('Запрос доступа к агенту не ушёл:', res.error);
    return { ok: false, rate: !!res.rate };
  }
  attempts.delete(uid);
  put((st) => ({ sent: { ...st.sent, [uid]: true } }));
  try {
    await AsyncStorage.setItem(aiRequestKey(uid), JSON.stringify({ at: new Date().toISOString() }));
  } catch (err) { console.warn('Запрос доступа не запомнился:', err); }
  return { ok: true };
}

// Данные аккаунта стёрли с устройства (lib/accounts.js: removeScope) — ключ
// запроса ушёл вместе с перепиской, и отметка в памяти тоже.
onScopeRemoved((uid) => {
  if (!uid || !useAiAccess.getState().sent[uid]) return;
  put((st) => {
    const sent = { ...st.sent };
    delete sent[uid];
    return { sent };
  });
});

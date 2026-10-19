// Список аккаунтов телефона и области их данных (17 октября 2026).
//
// Правила — в ядре (core/accounts.js, общее с вебом и десктопом): какое имя у
// области данных, как сливаются записи, кого открыть после «Выйти». Здесь —
// только хранилище телефона:
//
//   lancible-accounts      { list: [{ uid, email, name, accessToken,
//                            refreshToken, lastUsedAt, needsSignIn }],
//                            current: uid | null,
//                            known: { uid: { email, name } } }
//   lancible-data          данные без аккаунта (гость) — как было до аккаунтов
//   lancible-data:<uid>    данные аккаунта
//   lancible-ai:<uid>…     переписка с агентом (lib/aiKeys.js) — стирается
//                          вместе с данными аккаунта (removeScope)
//
// Токены неактивных аккаунтов лежат там же, где supabase-js держит сеанс
// текущего (AsyncStorage, sb-…-auth-token), — не в новом классе хранилища.
// known — подписи аккаунтов, чьи данные остались на телефоне после «Выйти»:
// запись из списка ушла, а удалить её данные с устройства («Данные» →
// «Удалить данные аккаунта с устройства») всё ещё можно, и строке нужно имя.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Accounts from '../core/accounts.js';
import CoreSync from '../core/sync.js';
import { PALETTE } from './migrate';
import { t } from './i18n';
import { isAiKeyOf } from './aiKeys';
import ActionSheetContent from '../components/ActionSheetContent';
import { openSheet, useSheetStore } from '../store/useSheetStore';

export const ACCOUNTS_KEY = 'lancible-accounts';
// Префикс областей аккаунтов — тот же, что у Accounts.mobileDataName(uid).
const ACCOUNT_DATA_PREFIX = 'lancible-data:';

/** Имя области данных в AsyncStorage: гость — lancible-data, аккаунт — lancible-data:<uid>. */
export const dataName = (uid) => Accounts.mobileDataName(uid);

const asText = (v) => (typeof v === 'string' ? v : '');

function cleanKnown(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const uid of Object.keys(raw)) {
    if (!Accounts.isValidUid(uid)) continue;
    const e = raw[uid] || {};
    out[uid] = { email: asText(e.email), name: asText(e.name) };
  }
  return out;
}

/** Список из хранилища — к виду ядра ({ list, current }) плюс known. */
export function parseAccounts(raw) {
  const base = Accounts.normalizeAccounts(raw);
  return { list: base.list, current: base.current, known: cleanKnown(raw && raw.known) };
}

// Правки списка. Ядро отдаёт { list, current } — known идёт следом своим
// полем: подпись запоминается при каждой правке записи, а забывается, только
// когда данных аккаунта на телефоне больше нет (forgetLabel).

function carryKnown(next, prev) {
  return { list: next.list, current: next.current, known: (prev && prev.known) || {} };
}

/** Завести или обновить запись (токены, почта, имя, время) и запомнить её подпись. */
export function upsertEntry(acc, entry) {
  const updated = Accounts.upsertAccount(acc, entry);
  const next = carryKnown(updated, acc);
  const saved = next.list.find((e) => e.uid === entry.uid);
  if (!saved) return next;
  return { ...next, known: { ...next.known, [saved.uid]: { email: saved.email, name: saved.name } } };
}

/** Сделать текущим (null — гость). */
export const setCurrent = (acc, uid) => carryKnown(Accounts.setCurrentAccount(acc, uid), acc);

/** Сеанс не поднялся — «нужно войти заново». */
export const markStale = (acc, uid) => carryKnown(Accounts.markNeedsSignIn(acc, uid), acc);

/** Убрать из списка («Выйти»). Подпись остаётся: данные — тоже. */
export const removeEntry = (acc, uid) => carryKnown(Accounts.removeAccount(acc, uid), acc);

/** Забыть подпись: данных аккаунта на телефоне больше нет. */
export function forgetLabel(acc, uid) {
  if (!acc.known || !acc.known[uid]) return acc;
  const known = { ...acc.known };
  delete known[uid];
  return { ...acc, known };
}

/** Запись, по которой подписать аккаунт: из списка, иначе из known. */
export function labelEntry(acc, uid) {
  const entry = acc.list.find((e) => e.uid === uid);
  if (entry) return entry;
  const k = acc.known && acc.known[uid];
  return { uid, email: k ? k.email : '', name: k ? k.name : '' };
}

export async function loadAccounts() {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    return parseAccounts(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.error('Не удалось прочитать список аккаунтов:', err);
    return parseAccounts(null);
  }
}

// Записи идут по очереди: последняя записанная — последняя по времени правка.
let writing = Promise.resolve();
export function saveAccounts(acc) {
  const json = JSON.stringify({ list: acc.list, current: acc.current, known: acc.known || {} });
  writing = writing
    .then(() => AsyncStorage.setItem(ACCOUNTS_KEY, json))
    .catch((err) => console.error('Не удалось сохранить список аккаунтов:', err));
  return writing;
}

/** Есть ли в области данные — проекты, задачи или документы (core/sync.js: hasData). */
export async function scopeHasData(uid) {
  try {
    const raw = await AsyncStorage.getItem(dataName(uid));
    const parsed = raw ? JSON.parse(raw) : null;
    return CoreSync.hasData(parsed && parsed.state);
  } catch {
    return false;
  }
}

/** uid аккаунтов, чьи области лежат на телефоне. Гость сюда не входит. */
export async function storedScopes() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .filter((k) => k.startsWith(ACCOUNT_DATA_PREFIX))
      .map((k) => k.slice(ACCOUNT_DATA_PREFIX.length))
      .filter(Accounts.isValidUid);
  } catch {
    return [];
  }
}

// Кто держит данные аккаунта в памяти (чат агента: lib/aiChat.js) — узнаёт
// о стирании до того, как стираются ключи: иначе идущий ответ записал бы
// переписку обратно, а открытый чат вернулся бы при следующем входе.
const scopeRemoved = new Set();
/** @returns снять подписку */
export function onScopeRemoved(fn) {
  scopeRemoved.add(fn);
  return () => scopeRemoved.delete(fn);
}

/** Стереть область аккаунта с телефона — данные и переписку с агентом
 *  (lib/aiKeys.js: индекс чатов, их сообщения, прежняя одиночная история):
 *  она тоже живёт только на устройстве и обещана к стиранию вместе с копией
 *  данных. Область гостя так не стирается. Картинки редактора лежат в
 *  IndexedDB страницы WebView — отсюда до них не дотянуться: их стирает
 *  ближайший открытый редактор по очереди lib/assetForget.js (её ставит
 *  useAuthStore.forgetDeviceData). */
export async function removeScope(uid) {
  if (!Accounts.isValidUid(uid)) return;
  for (const fn of [...scopeRemoved]) {
    try { fn(uid); } catch (err) { console.error('Не удалось забыть данные аккаунта в памяти:', err); }
  }
  let keys = [];
  try { keys = await AsyncStorage.getAllKeys(); } catch (err) { console.error('Не удалось прочитать ключи хранилища:', err); }
  await AsyncStorage.multiRemove([dataName(uid), ...keys.filter((k) => isAiKeyOf(k, uid))]);
}

/** Запись списка из сеанса supabase: свежие токены и почта. */
export const sessionEntry = (session) => ({
  uid: session.user.id,
  email: asText(session.user.email),
  accessToken: asText(session.access_token),
  refreshToken: asText(session.refresh_token),
});

/** Цвет аккаунта — из палитры проектов, по uid (core/accounts.js:
 *  accountColorIndex): переименовался — цвет остался. */
export const accountColor = (uid) => PALETTE[Accounts.accountColorIndex(uid, PALETTE.length)];

/** Вопрос «Перенести данные?» (17 октября 2026, как на вебе): у гостя есть
 *  данные, а аккаунт, в который вошли, на телефоне пуст. 'move' — «Перенести»,
 *  'keep' — «Оставить отдельно»; закрыли, ничего не выбрав, — тоже 'keep':
 *  перенести можно позже строкой в «Данных». Лист закрывается до onPress
 *  (ActionSheetContent), поэтому «закрыли без выбора» решается микрозадачей
 *  позже — нажатие успевает раньше. */
export function askMoveGuest(lang) {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe = () => {};
    const finish = (choice) => {
      if (done) return;
      done = true;
      unsubscribe();
      resolve(choice);
    };
    const sheet = (
      <ActionSheetContent
        title={t(lang, 'accounts.move_title')}
        message={t(lang, 'accounts.move_text')}
        actions={[
          { label: t(lang, 'accounts.move_ok'), onPress: () => finish('move') },
          { label: t(lang, 'accounts.move_keep'), cancel: true, onPress: () => finish('keep') },
        ]}
      />
    );
    openSheet(sheet);
    unsubscribe = useSheetStore.subscribe((st) => {
      if (st.content !== sheet) Promise.resolve().then(() => finish('keep'));
    });
  });
}

/** Гостевая область как она лежит: { state, version } или null. */
export async function readGuestScope() {
  try {
    const raw = await AsyncStorage.getItem(dataName(null));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Переписать гостевую область (не удалять: настройки гостя остаются). */
export async function writeGuestScope(stored) {
  await AsyncStorage.setItem(dataName(null), JSON.stringify(stored));
}

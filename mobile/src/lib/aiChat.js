// ИИ-агент на телефоне — вкладка «Чат-бот» (18 октября 2026). Тот же агент,
// что панель веба и десктопа (src/renderer/app.js, раздел «ИИ-агент»): тот
// же протокол функции ai-chat (supabase/functions/ai-chat), то же ядро
// (core/ai.js — побайтная копия): снимок данных, свободные окна и записанное
// время, проверка, применение и отмена предложения, разбор потока. Здесь —
// только сами разговоры: список чатов, история каждого, вложения, вызов
// функции, круг инструментов и решения по карточкам. Рисуют их
// screens/ChatListScreen.js (список) и screens/ChatThreadScreen.js (чат);
// поиск (screens/SearchScreen.js) находит чаты тоже отсюда — aiChatTexts,
// findChats (правило — ядро, Core.aiChatSearch).
//
// Агент предлагает, человек подтверждает. Предложение ложится в данные
// действием стора (useAppStore: applyAiProposal / undoAiProposal) — одной
// правкой, с миграцией, как приём синхронизации.
//
// Поток — `fetch` из 'expo/fetch': в SDK 57 он отдаёт тело ReadableStream
// (body.getReader()), кусок за куском, как браузер. Куски режет на кадры SSE
// ядро (aiParseSse), кадры собирает его же редьюсер (aiStreamStep).
//
// Переписка живёт только на этом устройстве, своя у каждого аккаунта, в
// данные и синхронизацию не попадает — так обещает политика. С вебом она не
// сходится, и это решение, а не долг. С круга 20 (18 октября 2026) чатов
// много: индекс `lancible-ai:<uid>:chats` (название, превью последнего
// ответа, время, число сообщений — Core.aiChatsNormalize) и сообщения каждого
// под `lancible-ai:<uid>:chat:<id>`. Прежняя одиночная история
// `lancible-ai:<uid>` при первом чтении становится первым чатом и удаляется.
// Вложения (lib/aiAttach.js) в хранилище не попадают никогда: после ответа их
// блоки в истории заменяет текст (Core.aiCompactHistory), а запись на
// устройство сжимает и ход, на который ответа ещё нет.
//
// С 21 октября 2026 агент — по приглашению (lib/aiAccess.js): вход и смена
// аккаунта спрашивают базу, открыт ли он, а ответ функции 403 no access
// закрывает его сразу. Без доступа сообщение не уходит, чаты на устройстве
// остаются.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { fetch as expoFetch } from 'expo/fetch';
import Ai from '../core/ai.js';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import { uid as newId } from './migrate';
import { t } from './i18n';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { flushEditors } from './sync';
import { navigationRef } from '../navigation/navRef';
import { pickAttachment, prepareAttachment, checkAll, attachmentBlocks, fileCard, dropFile } from './aiAttach';
import { aiKey, aiChatsKey, aiChatKey } from './aiKeys';
import { onScopeRemoved } from './accounts';
import { aiCheckAccess, aiLockAccess, accessOf } from './aiAccess';

export const AI_URL = `${SUPABASE_URL}/functions/v1/ai-chat`;
/** Кругов инструментов подряд после одного сообщения человека. */
export const AI_MAX_ROUNDS = 4;
/** Сообщений в истории (формат Anthropic) и строк ленты. */
export const AI_HISTORY_MAX = 40;
export const AI_ITEMS_MAX = 120;
/** Инструменты, которые считает ядро на месте: имя → суффикс строк шага. */
export const AI_STEPS = { free_windows: 'windows', time_spent: 'spent' };
export const AI_EXAMPLES = ['ai.example_1', 'ai.example_2', 'ai.example_3'];

// Ключи хранилища — lib/aiKeys.js (их знает и стирание данных аккаунта).
export { aiKey, aiChatsKey, aiChatKey };

/**
 * Разговор. Строки ленты (items) — {id, kind, …}:
 *  - msg: {role: 'user' | 'assistant', text, files?} — files у своего
 *    сообщения: карточки вложений {name, kind, mediaType, size}, без байтов
 *  - step: {tool, done, failed, from, to, minutes} — шаг инструмента
 *  - notice: {key} — отказ модели
 *  - card: {summary, ops, state: 'open' | 'applied' | 'declined' | 'undone',
 *    sent, failed, undo, links} — предложение; id — id вызова инструмента
 *  - error: {key, retry} — в историю не идёт
 * messages — сообщения Messages API, как их ждёт функция.
 * chats — индекс чатов аккаунта ({id, title, createdAt, updatedAt, preview,
 * count}, свежие первыми); messages и items — открытого (chatId).
 * pending — вложения, прикреплённые к ещё не отправленному сообщению.
 */
export const useAiChat = create(() => ({
  uid: null,        // чья история загружена
  loaded: false,    // индекс чатов прочитан
  chats: [],
  chatId: null,     // открытый чат
  opened: false,    // его история прочитана — можно писать
  messages: [],
  items: [],
  pending: [],
  attaching: false, // выбор и проверка вложения
  attachError: null, // {key, params} — отказ последнего вложения
  busy: false,      // идёт ответ — поле и кнопка недоступны
  waiting: false,   // ждём слов ответа — три точки
  liveId: null,     // строка ленты, в которую сейчас пишет поток
  needAuth: false,  // функция ответила 401 — показать вход
  remaining: null,
  limit: null,
  limitUntil: 0,
}));

const S = () => useAiChat.getState();
const put = (patch) => useAiChat.setState(patch);
const lang = () => useAppStore.getState().settings.lang;

// Номер разговора: aiStop() обрывает всё, что было до него. Вызов, поток и
// круг инструментов сверяют свой номер после каждого ожидания.
let run = 0;
let ctrl = null;
let loadSeq = 0;
let openSeq = 0;
// Строки, пришедшие из истории: их лента показывает без появления.
const restored = new Set();

/** Строка пришла из сохранённой истории (а не появилась в этом разговоре). */
export const isRestored = (id) => restored.has(id);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const blocksOf = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);
const hasText = (m) => blocksOf(m.content).some((b) => b && b.type === 'text' && String(b.text || '').trim());
const isAttachment = (b) => !!b && (b.type === 'image' || b.type === 'document');
const hasAttachment = (m) => !!m && blocksOf(m.content).some(isAttachment);
const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
const timeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

/** Вошёл ли человек — агент работает только после входа. */
export function aiSignedIn() {
  const auth = useAuthStore.getState();
  return auth.status === 'signedIn' && !!auth.user && !S().needAuth;
}

const pushItem = (it) => put({ items: [...S().items, it] });
const patchItem = (id, patch) => put({ items: S().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
const findItem = (id) => S().items.find((it) => it.id === id) || null;

/** Ошибка строкой в ленте. params — подстановки строки; waitMs — через
 *  сколько «Повторить» можно нажать (частота сообщений, 429 rate): до того
 *  строки ссылки нет (retryAt — когда она появится). */
function aiError(key, retry, params, waitMs) {
  const it = { id: newId(), kind: 'error', key, retry: !!retry };
  if (params) it.params = params;
  if (waitMs > 0) it.retryAt = Date.now() + waitMs;
  pushItem(it);
}

// --- история -----------------------------------------------------------------

/** История не длиннее AI_HISTORY_MAX сообщений. Начинается она всегда с
 *  сообщения человека с текстом и без tool_result: ответ на инструмент, чей
 *  вызов срезан, модель не примет. Правило — то же, что у веба (aiTrim). */
export function trimHistory(messages, items) {
  let m = messages;
  let start = Math.max(0, m.length - AI_HISTORY_MAX);
  while (start < m.length - 1 && !(m[start].role === 'user' && hasText(m[start]))) start += 1;
  if (start > 0) {
    m = m.slice(start);
    const first = m[0];
    if (first.role === 'user') m = [{ ...first, content: blocksOf(first.content).filter((b) => b && b.type !== 'tool_result') }, ...m.slice(1)];
  }
  return { messages: m, items: items.length > AI_ITEMS_MAX ? items.slice(-AI_ITEMS_MAX) : items };
}

/** Сообщения для хранилища: без единого байта вложений. Завершённые ходы
 *  сжимает ядро (aiCompactHistory); ход, на который ответа ещё нет (вызов не
 *  дошёл), — тем же правилом, как если бы ответ уже был: в памяти его
 *  вложения ждут «Повторить», а на устройство не ложатся. */
export function storableHistory(messages) {
  let m = Ai.aiCompactHistory(messages);
  if (m.some(hasAttachment)) m = Ai.aiCompactHistory([...m, { role: 'assistant', content: [{ type: 'text', text: '.' }] }]).slice(0, -1);
  return m;
}

/** Текст строки ленты в одну строку: без звёздочек выделения и маркеров
 *  списка — как в ленте (ChatText), только сплошным текстом. */
const flat = (text) => String(text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*- /gm, '').replace(/\s+/g, ' ').trim();

/** Строка индекса чата: название — из первого сообщения человека (ядро),
 *  превью — последний ответ агента (нет ответа — последнее своё), число
 *  сообщений — обеих сторон. */
export function chatEntry(id, items, { createdAt, updatedAt }) {
  const msgs = items.filter((it) => it.kind === 'msg');
  const first = msgs.find((it) => it.role === 'user');
  const last = [...msgs].reverse().find((it) => it.role === 'assistant') || msgs[msgs.length - 1];
  return {
    id,
    title: Ai.aiChatTitle(first ? first.text : ''),
    createdAt,
    updatedAt,
    preview: last ? flat(last.text) : '', // очистит и обрежет ядро (aiChatsNormalize)
    count: msgs.length,
  };
}

/** Записать индекс чатов. Ядро упорядочит и обрежет (aiChatsNormalize); чаты,
 *  которые за предел не прошли, уходят с устройства вместе с сообщениями. */
function writeIndex(uid, chats) {
  const next = Ai.aiChatsNormalize(chats);
  const gone = chats.filter((c) => c && c.id && !next.some((x) => x.id === c.id)).map((c) => aiChatKey(uid, c.id));
  return { next, write: Promise.all([AsyncStorage.setItem(aiChatsKey(uid), JSON.stringify(next)), ...gone.map((k) => AsyncStorage.removeItem(k))]) };
}

/** Записать открытый чат и его строку индекса. Ошибки в историю не идут.
 *  Пустой чат — ни ключа, ни строки в списке: «Новый чат», из которого
 *  ушли, ничего не написав, список не засоряет. @returns промис записи */
export function aiSave() {
  const s = S();
  if (!s.uid || !s.chatId) return Promise.resolve();
  const { messages, items } = trimHistory(s.messages, s.items);
  if (messages !== s.messages || items !== s.items) put({ messages, items });
  const keep = items.filter((it) => it.kind !== 'error');
  const { uid, chatId } = s;
  const others = s.chats.filter((c) => c.id !== chatId);
  let writes;
  let chats;
  if (!messages.length && !keep.length) {
    const ix = writeIndex(uid, others);
    chats = ix.next;
    writes = [AsyncStorage.removeItem(aiChatKey(uid, chatId)), ix.write];
  } else {
    const now = new Date().toISOString();
    const prev = s.chats.find((c) => c.id === chatId);
    const entry = chatEntry(chatId, keep, { createdAt: (prev && prev.createdAt) || now, updatedAt: now });
    const ix = writeIndex(uid, [entry, ...others]);
    chats = ix.next;
    writes = [AsyncStorage.setItem(aiChatKey(uid, chatId), JSON.stringify({ messages: storableHistory(messages), items: keep, updatedAt: now })), ix.write];
  }
  put({ chats });
  return Promise.all(writes).catch((err) => { console.warn('История агента не сохранилась:', err); });
}

/** Индекс чатов аккаунта. Индекса ещё нет, а прежняя одиночная история
 *  есть — она становится первым чатом (сначала записан новый, потом удалён
 *  старый ключ: оборвись запись посередине, история не пропадёт). */
async function readChats(uid) {
  const index = parse(await AsyncStorage.getItem(aiChatsKey(uid)));
  if (Array.isArray(index)) return Ai.aiChatsNormalize(index);
  const old = parse(await AsyncStorage.getItem(aiKey(uid)));
  if (!old) return [];
  const messages = Array.isArray(old.messages) ? old.messages : [];
  const items = (Array.isArray(old.items) ? old.items : []).filter((it) => isObj(it) && it.kind !== 'error').map((it) => (it.id ? it : { ...it, id: newId() }));
  let chats = [];
  if (messages.length || items.length) {
    const id = newId();
    const at = Number.isFinite(Date.parse(old.updatedAt)) ? old.updatedAt : new Date().toISOString();
    await AsyncStorage.setItem(aiChatKey(uid, id), JSON.stringify({ messages: storableHistory(messages), items, updatedAt: at }));
    const ix = writeIndex(uid, [chatEntry(id, items, { createdAt: at, updatedAt: at })]);
    await ix.write;
    chats = ix.next;
  }
  await AsyncStorage.removeItem(aiKey(uid));
  return chats;
}

/** Вход, выход, другой аккаунт. Другой аккаунт — свои чаты; выход их не
 *  стирает, экран просто встаёт в состояние входа. Тот же аккаунт — только
 *  снимается «нужен вход» (после 401 человек вошёл заново). Вход и другой
 *  аккаунт заодно спрашивают, открыт ли ему агент (lib/aiAccess.js): промис
 *  кончается, когда прочитаны чаты и пришёл ответ. */
export async function aiAccount(id) {
  const uidNow = id || null;
  if (uidNow === S().uid) {
    if (S().needAuth) {
      put({ needAuth: false });
      await aiCheckAccess(uidNow);
    }
    return;
  }
  aiStop();
  aiDropPending();
  const seq = (loadSeq += 1);
  openSeq += 1;
  put({
    uid: uidNow, loaded: !uidNow, chats: [], chatId: null, opened: false, messages: [], items: [],
    needAuth: false, remaining: null, limit: null, limitUntil: 0,
  });
  if (!uidNow) return;
  const access = aiCheckAccess(uidNow);
  let chats = [];
  try { chats = await readChats(uidNow); } catch (err) { console.warn('Чаты агента не прочитались:', err); }
  if (seq === loadSeq) put({ chats, loaded: true });
  await access;
}

/** «Удалить данные аккаунта с устройства» (lib/accounts.js: removeScope):
 *  переписка этого аккаунта уходит и из памяти — ответ, который идёт,
 *  обрывается (иначе дописал бы чат обратно на устройство), лента пустеет,
 *  а следующий вход этим аккаунтом прочитает чаты заново — их уже нет. */
export function aiForget(id) {
  if (!id) return;
  for (const key of [...textCache.keys()]) if (key.startsWith(`${id}:`)) textCache.delete(key);
  if (S().uid !== id) return;
  aiStop();
  aiDropPending();
  loadSeq += 1;
  openSeq += 1;
  put({
    uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [],
    needAuth: false, remaining: null, limit: null, limitUntil: 0,
  });
}
onScopeRemoved(aiForget);

/** Открыть чат из списка: его история — в ленту. Тот же, уже открытый, —
 *  как есть (ответ, который идёт, продолжает идти). Ответ, который шёл в
 *  другом чате, обрывается (лента одна), и тот чат об этом скажет: история,
 *  где последнее слово за человеком, а ответа нет, открывается со строкой
 *  «Ответ прервался» и «Повторить» — так же после закрытого посреди ответа
 *  приложения. */
export async function aiOpenChat(chatId) {
  const s = S();
  if (!s.uid || !chatId || s.chatId === chatId) return;
  aiStop();
  aiDropPending();
  const seq = (openSeq += 1);
  const { uid } = s;
  put({ chatId, opened: false, messages: [], items: [] });
  let h = null;
  try { h = parse(await AsyncStorage.getItem(aiChatKey(uid, chatId))); } catch (err) { console.warn('История чата не прочиталась:', err); }
  if (seq !== openSeq || S().chatId !== chatId) return;
  const messages = h && Array.isArray(h.messages) ? h.messages : [];
  const items = (h && Array.isArray(h.items) ? h.items : [])
    .filter((it) => isObj(it) && it.kind !== 'error')
    .map((it) => (it.id ? it : { ...it, id: newId() }));
  for (const it of items) restored.add(it.id);
  const last = messages[messages.length - 1];
  const cut = last && last.role === 'user' ? [{ id: newId(), kind: 'error', key: 'ai.interrupted', retry: true }] : [];
  put({ messages, items: [...items, ...cut], opened: true });
}

// --- поиск по чатам (круг 21, 19 октября 2026) -----------------------------------

// Тексты сообщений чата для поиска: `uid:id` → { at: updatedAt, msgs }. Тот же
// чат с тем же updatedAt второй раз с устройства не читается.
const textCache = new Map();

/** Тексты чатов аккаунта для поиска (screens/SearchScreen.js): id → тексты
 *  сообщений обеих сторон сплошной строкой каждое. Переписка только на этом
 *  устройстве — отсюда и читается; открытый чат — из памяти, он свежее.
 *  @returns промис { [chatId]: string[] } */
export async function aiChatTexts() {
  const s = S();
  const { uid, chats } = s;
  if (!uid || !chats.length) return {};
  const msgsOf = (items) => items.filter((it) => isObj(it) && it.kind === 'msg').map((it) => flat(it.text)).filter(Boolean);
  const out = {};
  const need = [];
  for (const c of chats) {
    if (c.id === s.chatId && s.opened) { out[c.id] = msgsOf(s.items); continue; }
    const hit = textCache.get(`${uid}:${c.id}`);
    if (hit && hit.at === c.updatedAt) out[c.id] = hit.msgs;
    else need.push(c);
  }
  if (need.length) {
    let pairs = [];
    try { pairs = await AsyncStorage.multiGet(need.map((c) => aiChatKey(uid, c.id))); } catch (err) { console.warn('Чаты для поиска не прочитались:', err); }
    need.forEach((c, i) => {
      const h = parse(pairs[i] && pairs[i][1]);
      const msgs = msgsOf(h && Array.isArray(h.items) ? h.items : []);
      textCache.set(`${uid}:${c.id}`, { at: c.updatedAt, msgs });
      out[c.id] = msgs;
    });
  }
  return out;
}

/** Чаты с запросом — правило ядра (Core.aiChatSearch: сначала совпавшие по
 *  названию, потом по тексту сообщений, свежие выше, не больше шести; кусок
 *  текста вокруг совпадения — до 80 знаков). texts — из aiChatTexts.
 *  Совпало название — куска нет, под ним превью чата.
 *  @returns [{ chat, snippet }] */
export function findChats(chats, texts, query) {
  const list = Array.isArray(chats) ? chats : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const rows = Ai.aiChatSearch(list.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, texts: (texts && texts[c.id]) || [] })), query);
  return rows.map((r) => {
    const chat = byId.get(r.id) || r;
    return { chat, snippet: r.snippet || chat.preview || '' };
  });
}

/** Оборвать текущий ответ: вызов, поток и круг инструментов. */
export function aiStop() {
  run += 1;
  if (ctrl) { try { ctrl.abort(); } catch { /* уже оборван */ } }
  ctrl = null;
  const s = S();
  put({ items: s.liveId ? s.items.filter((it) => it.id !== s.liveId) : s.items, liveId: null, waiting: false, busy: false });
}

/** «Новый чат»: пустая лента под новым id. В список он попадёт с первым
 *  сообщением. @returns id чата */
export function aiNewChat() {
  aiStop();
  aiDropPending();
  openSeq += 1;
  const chatId = newId();
  put({ chatId, opened: true, messages: [], items: [] });
  return chatId;
}

/** Удалить чат: сообщения и строку индекса. Открытый — ответ обрывается,
 *  лента пустеет. @returns промис записи */
export function aiDeleteChat(chatId) {
  const s = S();
  if (!s.uid || !chatId) return Promise.resolve();
  if (s.chatId === chatId) {
    aiStop();
    aiDropPending();
    openSeq += 1;
    put({ chatId: null, opened: false, messages: [], items: [] });
  }
  const ix = writeIndex(s.uid, S().chats.filter((c) => c.id !== chatId));
  put({ chats: ix.next });
  return Promise.all([AsyncStorage.removeItem(aiChatKey(s.uid, chatId)), ix.write])
    .catch((err) => { console.warn('Чат агента не удалился:', err); });
}

// --- вложения ------------------------------------------------------------------

/** Убрать все вложения поля: их перекодированные файлы — из кеша. С chatId —
 *  только если поле сейчас у этого чата: экран чата X, уходя, не стирает
 *  вложения, которые тем временем прикрепили в чате Y (поле одно на все). */
export function aiDropPending(chatId) {
  if (chatId !== undefined && S().chatId !== chatId) return;
  const { pending, attachError } = S();
  if (!pending.length && !attachError) return;
  pending.forEach(dropFile);
  put({ pending: [], attachError: null });
}

/** Убрать одно вложение (крестик на плашке). */
export function aiDetach(id) {
  const it = S().pending.find((x) => x.id === id);
  if (!it) return;
  dropFile(it);
  put({ pending: S().pending.filter((x) => x.id !== id), attachError: null });
}

/** Отказ вложения — строкой над полем. */
const refuse = (key, params) => put({ attachError: { key: /^ai\./.test(String(key || '')) ? key : 'ai.err_file_type', params: params || {} } });

/** Прикрепить фото ('photo') или файл ('file'): выбор, проверка ядра по
 *  байтам, перекодировка фото, проверка числа и суммы. Пятое — отказ сразу,
 *  выбор даже не открывается. @returns прикрепилось ли */
export async function aiAttach(kind) {
  const s = S();
  if (s.busy || s.attaching || !s.opened) return false;
  const max = (Ai.AI_ATTACH && Ai.AI_ATTACH.maxCount) || 4;
  if (s.pending.length >= max) { refuse('ai.err_file_count', { max }); return false; }
  const { chatId } = s;
  put({ attaching: true, attachError: null });
  let item = null;
  try {
    const raw = await pickAttachment(kind);
    if (!raw) return false;
    item = await prepareAttachment(raw);
    if (S().chatId !== chatId) { dropFile(item); return false; }
    const next = [...S().pending, item];
    const check = checkAll(next);
    if (!check || !check.ok) {
      dropFile(item);
      refuse(check && check.error, check && check.params);
      return false;
    }
    put({ pending: next });
    return true;
  } catch (err) {
    if (item) dropFile(item);
    if (err && err.code) refuse(err.code, err.params);
    else { console.warn('Вложение не прочиталось:', err); refuse('ai.err_file_read', {}); }
    return false;
  } finally {
    put({ attaching: false });
  }
}

// --- карточка предложения ------------------------------------------------------

/** Созданные id по порядку операций: ядро отдаёт их списками по видам. */
export function aiLinks(ops, created) {
  const queue = {
    create_task: [...((created && created.tasks) || [])],
    create_project: [...((created && created.projects) || [])],
  };
  return ops.map((op) => {
    if (!op) return null;
    if (op.op === 'create_task') return { kind: 'task', id: queue.create_task.shift() || null };
    if (op.op === 'create_project') return { kind: 'project', id: queue.create_project.shift() || null };
    if (op.op === 'update_task') return { kind: 'task', id: op.id || null };
    return null;
  });
}

/** Последняя применённая карточка — «Отменить» только у неё. */
export function lastApplied(items) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind === 'card' && it.state === 'applied' && it.undo) return it;
  }
  return null;
}

/** Имя статуса нового проекта — как у веба и как при создании проекта. */
export const statusName = (key) => t(lang(), `status.default_${key}`);

/** «Применить»: предложение — в данные одной правкой стора. Проверка — до
 *  применения: неверное «Применить» не нажмёшь, а если данные успели
 *  измениться между отрисовкой и нажатием, карточка скажет «не вышло».
 *
 *  Сначала несохранённый текст открытого редактора (заметки задачи, которую
 *  человек оставил в другой вкладке) — в стор: предложение может править те
 *  же заметки, а недописанное сохранение редактора сработало бы после и
 *  затёрло правку агента. Тот же сброс, что перед приёмом синхронизации. */
export function aiApplyCard(id) {
  const card = findItem(id);
  if (!card || card.kind !== 'card' || card.state !== 'open') return null;
  flushEditors();
  const app = useAppStore.getState();
  let check;
  try { check = Ai.aiValidate(app, card.ops); } catch (err) { console.error('Предложение не проверилось:', err); check = { ok: false }; }
  if (!check.ok) return null;
  let res = null;
  try { res = app.applyAiProposal(card.ops); } catch (err) { console.error('Предложение агента не применилось:', err); }
  if (!res || res.ok === false) {
    patchItem(id, { failed: true });
    return res;
  }
  patchItem(id, { state: 'applied', failed: false, undo: res.undo || null, links: aiLinks(card.ops, res.created) });
  app.showToast(t(lang(), 'ai.applied', { n: card.ops.length }));
  aiSave();
  return res;
}

export function aiDeclineCard(id) {
  const card = findItem(id);
  if (!card || card.kind !== 'card' || card.state !== 'open') return;
  patchItem(id, { state: 'declined' });
  aiSave();
}

/** «Отменить» у последней применённой: данные — как были до неё. Отмена —
 *  по полям (Core.aiUndo): поле, которое после применения уже поменяли, и
 *  задача, по которой записано время, остаются как есть — ядро называет их
 *  в kept, и тост говорит, что отменилось не всё. */
export function aiUndoCard(id) {
  const card = findItem(id);
  if (!card || card.kind !== 'card' || card.state !== 'applied' || !card.undo) return;
  flushEditors(); // как перед «Применить»: недописанное сохранение редактора не должно лечь поверх отмены
  const app = useAppStore.getState();
  let res;
  try { res = app.undoAiProposal(card.undo); } catch (err) { console.error('Предложение агента не отменилось:', err); return; }
  patchItem(id, { state: 'undone', undo: null });
  const kept = res && Array.isArray(res.kept) && res.kept.length > 0;
  app.showToast(t(lang(), kept ? 'ai.undo_kept' : 'ai.undone'));
  aiSave();
}

// --- инструменты ---------------------------------------------------------------

function addCard(block) {
  if (S().items.some((it) => it.kind === 'card' && it.id === block.id)) return;
  const input = block.input || {};
  pushItem({
    id: block.id, kind: 'card', summary: String(input.summary || ''),
    ops: Array.isArray(input.ops) ? input.ops : [], state: 'open', sent: false,
  });
}

function addStep(block) {
  if (S().items.some((it) => it.kind === 'step' && it.id === block.id)) return;
  pushItem({ id: block.id, kind: 'step', tool: block.name, done: false });
}

/** Часы, в которых искать окна: названные человеком («вечером», «в
 *  выходные» — hours во входе модели) поверх рабочих часов из настроек
 *  (Core.aiWorkHours: settings.workHours или AI_WORK_HOURS). */
function hoursFor(input, settings) {
  const base = Ai.aiWorkHours(settings);
  const h = input.hours;
  if (!isObj(h)) return base;
  return {
    start: typeof h.start === 'string' ? h.start : base.start,
    end: typeof h.end === 'string' ? h.end : base.end,
    days: Array.isArray(h.days) ? h.days : base.days,
  };
}

/** Инструмент, который считает ядро: свободные окна или записанное время.
 *  now — «сейчас» того же круга, что ушёл модели. */
function runTool(block, now) {
  addStep(block);
  const input = block.input || {};
  const app = useAppStore.getState();
  try {
    let out;
    if (block.name === 'free_windows') {
      const workHours = hoursFor(input, app.settings);
      out = {
        windows: Ai.aiFreeWindows(app, { from: input.from, to: input.to, minMinutes: input.minMinutes, workHours, now }),
        workHours,
      };
      patchItem(block.id, { done: true, from: input.from || null, to: input.to || null });
    } else {
      out = Ai.aiTimeSpent(app, { from: input.from, to: input.to, projectId: input.projectId, now });
      patchItem(block.id, { done: true, minutes: Math.round(Number(out && out.totalMin) || 0) });
    }
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) };
  } catch (err) {
    console.error('Инструмент агента не посчитался:', err);
    patchItem(block.id, { done: true, failed: true });
    return { type: 'tool_result', tool_use_id: block.id, content: String((err && err.message) || err), is_error: true };
  }
}

/** Ответ на propose_changes — решение человека; нет решения — pending, и
 *  карточка остаётся с кнопками («Ждёт решения»). */
function cardResult(id) {
  const card = findItem(id);
  if (card) patchItem(id, { sent: true });
  const status = !card || card.state === 'open' ? 'pending' : card.state === 'applied' ? 'applied' : 'declined';
  return { type: 'tool_result', tool_use_id: id, content: status };
}

function resultFor(block, now) {
  if (block.name === 'propose_changes') return cardResult(block.id);
  if (AI_STEPS[block.name]) return runTool(block, now || new Date().toISOString());
  return { type: 'tool_result', tool_use_id: block.id, content: `unknown tool: ${block.name}`, is_error: true };
}

/** Ответы на инструменты из последнего ответа модели, которые ещё не ушли. */
function openResults() {
  const m = S().messages;
  const last = m[m.length - 1];
  if (!last || last.role !== 'assistant') return [];
  return blocksOf(last.content).filter((b) => b && b.type === 'tool_use').map((b) => resultFor(b));
}

// --- вызов функции -------------------------------------------------------------

/** Текст ответа по мере прихода: текстовые блоки через пустую строку. */
function accText(acc) {
  const parts = ((acc && acc.blocks) || []).filter((b) => b && b.type === 'text' && b.text).map((b) => b.text);
  return parts.length ? parts.join('\n\n') : String((acc && acc.text) || '');
}

function liveText(acc) {
  const text = accText(acc);
  if (!text) return;
  const id = S().liveId;
  if (!id) {
    const it = { id: newId(), kind: 'msg', role: 'assistant', text };
    put({ items: [...S().items, it], liveId: it.id, waiting: false });
    return;
  }
  put({ items: S().items.map((it) => (it.id === id ? { ...it, text } : it)), waiting: false });
}

function onEvent(ev, acc) {
  const d = ev && isObj(ev.data) ? ev.data : {};
  const type = (ev && ev.event) === 'lancible' ? 'lancible' : d.type || (ev && ev.event);
  if (type === 'lancible') {
    const remaining = acc && Number.isFinite(acc.remaining) ? acc.remaining : d.remaining;
    const limit = acc && Number.isFinite(acc.limit) ? acc.limit : d.limit;
    if (Number.isFinite(remaining) && Number.isFinite(limit)) put({ remaining, limit });
    return;
  }
  if (type === 'content_block_start' && d.content_block && d.content_block.type === 'tool_use') {
    if (AI_STEPS[d.content_block.name]) addStep(d.content_block);
    put({ waiting: true });
    return;
  }
  if (type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') liveText(acc);
}

/** Ответ оборвался — недописанный текст уходит: «Повторить» спросит заново. */
function dropLive() {
  const s = S();
  if (s.liveId) put({ items: s.items.filter((it) => it.id !== s.liveId), liveId: null });
}

/** Открытый проект — страница проекта сверху стека вкладки, где человек был
 *  последним (история вкладок навигатора, свежие первыми). У самой вкладки
 *  чата своего проекта нет, а ui.projectId стора помнит последний открытый
 *  когда-либо и назад не сбрасывается. @param root — getRootState() вкладок */
export function openProjectId(root) {
  if (!root || !Array.isArray(root.routes)) return null;
  const keys = Array.isArray(root.history) && root.history.length
    ? root.history.map((h) => h && h.key).filter(Boolean).reverse()
    : root.routes.map((r) => r.key);
  for (const key of keys) {
    const stack = (root.routes.find((r) => r.key === key) || {}).state;
    if (!stack || !Array.isArray(stack.routes) || !stack.routes.length) continue;
    const top = stack.routes[Number.isInteger(stack.index) ? stack.index : stack.routes.length - 1];
    if (top && top.name === 'Project' && top.params && top.params.projectId) return top.params.projectId;
  }
  return null;
}

/** Снимок данных и «сейчас» на один круг: все вызовы круга инструментов
 *  уходят с тем же context и now, что первый. Фокус — открытый проект, если
 *  он есть (openProjectId). */
function frameNow() {
  const app = useAppStore.getState();
  const now = new Date().toISOString();
  const tz = timeZone();
  const l = app.settings.lang;
  let projectId = null;
  try { projectId = navigationRef.isReady() ? openProjectId(navigationRef.getRootState()) : null; } catch { projectId = null; }
  if (projectId && !(app.projects || []).some((p) => p && p.id === projectId)) projectId = null;
  const context = Ai.aiSnapshot(app, { now, tz, lang: l, focus: { view: projectId ? 'project' : null, projectId, taskId: null } });
  return { now, tz, lang: l, context };
}

/** Вложения последнего (ещё без ответа) сообщения человека — вон: функция
 *  их не пропустила. Сообщение без текста уходит целиком.
 *  @returns остался ли текст — есть что повторить */
function dropTurnAttachments() {
  const m = S().messages;
  const last = m[m.length - 1];
  if (!last || last.role !== 'user') return false;
  const content = blocksOf(last.content).filter((b) => !isAttachment(b));
  const next = { ...last, content };
  put({ messages: content.length ? [...m.slice(0, -1), next] : m.slice(0, -1) });
  return hasText(next);
}

/** Один вызов функции: поток ответа, ошибки. Возвращает собранный ответ
 *  (acc ядра) или null — тогда ошибка уже в ленте. */
async function call(myRun, frame) {
  put({ liveId: null, waiting: true });
  let token = null;
  try {
    const { data } = await sb.auth.getSession();
    token = data && data.session && data.session.access_token;
  } catch (err) { console.error('Нет сессии для агента:', err); }
  if (myRun !== run) return null;
  if (!token) { put({ needAuth: true }); return null; }
  if (S().limitUntil > Date.now() && Ai.aiCountsAsMessage(S().messages)) { aiError('ai.limit_reached'); return null; }

  let res;
  const c = typeof AbortController === 'function' ? new AbortController() : null;
  ctrl = c;
  try {
    res = await expoFetch(AI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json', Accept: 'text/event-stream',
      },
      body: JSON.stringify({ messages: S().messages, context: frame.context, lang: frame.lang, tz: frame.tz, now: frame.now }),
      signal: c ? c.signal : undefined,
    });
  } catch (err) {
    if (myRun === run) { console.warn('Агент недоступен по сети:', err); aiError('ai.error_network', true); }
    return null;
  }
  if (myRun !== run) return null;
  if (!res.ok) {
    if (res.status === 401) { put({ needAuth: true }); return null; }
    if (res.status === 403) {
      const j = await res.json().catch(() => ({}));
      if (myRun !== run) return null;
      // Агент не открыт этому аккаунту (21 октября 2026): экран встаёт в
      // «закрытый тест». Вопрос остаётся в чате — откроют доступ, и строка
      // «Ответ прервался» даст его повторить.
      if (j && j.error === 'no access') {
        aiLockAccess(S().uid);
        aiError('ai.interrupted', true);
        return null;
      }
    }
    if (res.status === 404) { aiError('ai.unavailable'); return null; }
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      if (myRun !== run) return null;
      // Частота: не больше нескольких сообщений в минуту — «Подождите N с» и
      // «Повторить», когда время выйдет. Суточный лимит — ниже.
      if (j && j.error === 'rate') {
        const header = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('retry-after')) : NaN;
        const sec = Math.max(1, Math.ceil(Number(j.retryAfter) || header || 10));
        aiError('ai.rate_wait', true, { n: sec }, sec * 1000);
        return null;
      }
      // Суточный бюджет по цене (19 октября 2026): до полуночи UTC повтор
      // упадёт так же — без «Повторить»; счётчик сообщений не трогаем.
      if (j && j.error === 'budget') {
        aiError('ai.budget');
        return null;
      }
      put({
        remaining: 0,
        limit: Number.isFinite(j && j.limit) ? j.limit : S().limit,
        limitUntil: Date.parse(j && j.resetAt) || 0,
      });
      aiError('ai.limit_reached');
      return null;
    }
    if (res.status === 400 || res.status === 413) {
      const j = await res.json().catch(() => ({}));
      if (myRun !== run) return null;
      if (res.status === 400 && j && j.error === 'too long') {
        // Переписка вышла за общий предел текста функции (19 октября 2026):
        // тот же вопрос ушёл бы с той же историей и получил бы тот же отказ —
        // «Повторить» не предлагаем, только новый чат.
        aiError('ai.too_long');
        return null;
      }
      if (res.status === 413 || (j && j.error === 'bad attachment')) {
        // Функция не пропустила вложение (её проверка — та же, что ядра, на
        // сервере ещё раз) или тело оказалось больше её предела. Модель его не
        // видела: оно уходит из сообщения, строка — у сообщения. Текст
        // остался — «Повторить» отправит его без вложений.
        console.warn('Вложение не прошло проверку функции:', j && j.detail);
        aiError('ai.err_attach_server', dropTurnAttachments());
        aiSave();
        return null;
      }
    }
    aiError('ai.error_network', true);
    return null;
  }

  let acc = Ai.aiStreamStep(null, null); // чистый acc ядра
  let stopped = false;
  let buf = '';
  const feed = (chunk, end) => {
    buf += chunk;
    // Последний кадр без пустой строки после него — тоже кадр.
    const { events, rest } = Ai.aiParseSse(end ? `${buf}\n\n` : buf);
    buf = end ? '' : rest;
    for (const ev of events) {
      acc = Ai.aiStreamStep(acc, ev);
      if (acc.done || ev.event === 'message_stop') stopped = true;
      onEvent(ev, acc);
    }
  };
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (myRun !== run) { Promise.resolve(reader.cancel()).catch(() => {}); return null; }
        if (done) { feed(dec.decode(), true); break; }
        feed(typeof value === 'string' ? value : dec.decode(value, { stream: true }), false);
      }
    } else {
      feed(await res.text(), true);
    }
  } catch (err) {
    if (myRun === run) { console.warn('Поток агента оборвался:', err); dropLive(); aiError('ai.error_network', true); }
    return null;
  }
  if (myRun !== run) return null;
  ctrl = null;
  if (acc.error || !stopped) {
    if (acc.error) console.warn('Агент ответил ошибкой:', acc.error);
    dropLive();
    aiError('ai.error_network', true);
    return null;
  }
  const liveId = S().liveId;
  if (liveId) patchItem(liveId, { text: accText(acc) });
  put({ liveId: null });
  return acc;
}

/** Ответ модели и круг инструментов: свободные окна и записанное время
 *  считаются на месте и сразу уходят следующим вызовом — не больше
 *  AI_MAX_ROUNDS кругов подряд; предложение ждёт решения человека. */
export async function aiRun() {
  if (S().busy) return;
  const myRun = run;
  put({ busy: true });
  try {
    let frame;
    try { frame = frameNow(); } catch (err) { console.error('Снимок для агента не собрался:', err); aiError('ai.unavailable'); return; }
    for (let round = 0; ; round += 1) {
      const acc = await call(myRun, frame);
      if (!acc || myRun !== run) return;
      // Блоки — как отдало ядро, thinking с подписью тоже: модели их надо
      // вернуть неизменными. Пустой ответ в историю не кладётся.
      const msg = Ai.aiAssistantMessage(acc);
      const content = blocksOf(msg && msg.content);
      if (acc.stopReason === 'refusal') {
        // Отказ модели. Без слов — вопрос человека уходит из истории: иначе
        // он ушёл бы снова со следующим сообщением и получил бы тот же отказ.
        const m = S().messages;
        let messages = m;
        if (content.length) messages = [...m, msg];
        else if (m.length && m[m.length - 1].role === 'user') messages = m.slice(0, -1);
        put({ messages, items: [...S().items, { id: newId(), kind: 'notice', key: 'ai.refused' }] });
        aiSave();
        return;
      }
      if (!content.length) { aiSave(); return; }
      put({ messages: [...S().messages, msg] });
      const uses = content.filter((b) => b && b.type === 'tool_use');
      for (const b of uses) if (b.name === 'propose_changes') addCard(b);
      const more = uses.some((b) => b.name !== 'propose_changes');
      if (!more || round >= AI_MAX_ROUNDS) { aiSave(); return; }
      const results = uses.map((b) => resultFor(b, frame.now));
      put({ messages: [...S().messages, { role: 'user', content: results }] });
      aiSave();
    }
  } finally {
    // Ответ на ход пришёл — его вложения в истории становятся строкой
    // «уже разобрано» (ядро): следующий вызов байтов уже не везёт.
    if (myRun === run) put({ busy: false, waiting: false, messages: Ai.aiCompactHistory(S().messages) });
  }
}

/** Отправить сообщение человека — с вложениями поля, если они есть: блоки
 *  ядра (aiAttachmentBlocks) перед текстом, в ленте — карточки «имя · тип ·
 *  размер». Перекодированные файлы миниатюр удаляются сразу. Текст нужен и
 *  с вложениями: сообщение без текста лимит бы не тратило.
 *  @returns ушло ли оно */
export function aiSend(raw) {
  const text = String(raw || '').trim();
  const s = S();
  if (!text || s.busy || s.attaching || !s.opened || !aiSignedIn() || accessOf(s.uid) === 'locked') return false;
  const { pending } = s;
  let blocks = [];
  if (pending.length) {
    const r = attachmentBlocks(pending);
    if (r.error) { refuse(r.error, r.params); return false; }
    blocks = r.blocks;
  }
  const add = [...blocks, { type: 'text', text }];
  const before = s.messages;
  const last = before[before.length - 1];
  let messages;
  // Прошлый вызов не дошёл — сообщение человека уже в истории: новое
  // дописывается к нему, роли должны чередоваться.
  if (last && last.role === 'user') messages = [...before.slice(0, -1), { ...last, content: [...blocksOf(last.content), ...add] }];
  else messages = [...before, { role: 'user', content: [...openResults(), ...add] }];
  const items = S().items.filter((it) => it.kind !== 'error');
  const mine = { id: newId(), kind: 'msg', role: 'user', text };
  if (pending.length) mine.files = pending.map(fileCard);
  put({ messages, items: [...items, mine], pending: [], attachError: null });
  pending.forEach(dropFile);
  aiSave();
  aiRun();
  return true;
}

/** «Повторить»: тот же вопрос ещё раз. */
export function aiRetry() {
  if (S().busy) return;
  put({ items: S().items.filter((it) => it.kind !== 'error') });
  const m = S().messages;
  const last = m[m.length - 1];
  if (!last || last.role !== 'user') return;
  aiRun();
}

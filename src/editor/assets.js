// Картинки документа.
//
// В тексте документа картинка — ссылка вида asset:<id>, а не сами байты.
// Причина — синхронизация: данные пользователя уходят на сервер одним
// куском на каждое сохранение (sync_state), и пара фотографий в base64
// сделала бы каждое нажатие клавиши мегабайтным запросом.
//
// Байты лежат в двух местах:
//  - на устройстве — IndexedDB, есть и в Electron, и в браузере, и в WebView
//    телефона. Работает без аккаунта и без сети;
//  - в облаке — Supabase Storage, корзина doc-assets, папка = id
//    пользователя (правила доступа — supabase/storage.sql). Туда картинка
//    уходит, когда человек вошёл в аккаунт; на другом устройстве она
//    скачивается при первом показе и дальше живёт уже локально.
//
// Чья запись (17 октября 2026, несколько аккаунтов на устройстве). У записи
// в очереди выгрузки — owner: id аккаунта, который её вставил (null —
// вставлена без аккаунта). flush выгружает только записи того, кто сейчас
// вошёл: переключились на другой аккаунт — чужие картинки ждут своего и в
// чужую папку не уходят. Гостевые (owner null) сами не уходят никому: на
// общем устройстве «первый вошедший» не обязательно их автор. Их забирает
// аккаунт явно — adoptGuest(userId), когда человек переносит данные «Без
// аккаунта» в аккаунт (или adoptGuest(userId, ids) — только названные).
// Аккаунт удалён или убран с устройства — forget(userId) стирает его записи
// с устройства (на телефоне — сообщение assets-forget, host.js). Записи
// без поля owner (до 17 октября) — как раньше: их забирает первый вошедший,
// и с этого раза они — его.
//
// Отказ облака (19 октября 2026). Корзина может не принимать файл: тип или
// размер вне её правил (исходный PDF до 20 МБ, пока не выполнен
// supabase/storage-pdf.sql), правила доступа. Такой ответ (4xx, кроме 401,
// 408 и 429) помечает запись, и flush её больше не шлёт — до перезапуска
// приложения (новое хранилище) или явного requeue. Сбой сети и 5xx —
// повтор с растущим отступом (retryDelay): первый — со следующим flush,
// дальше 30 с, 1 мин, 2 мин… до 30 мин; хранилище само зовёт flush, когда
// отступ вышел. 401 (токен истёк) — снова со следующим flush: его зовёт
// новый сеанс. Одна запись выгружается одним запросом за раз.
//
// Адреса для <img> (URL.createObjectURL) — не больше URL_CACHE_MAX: сверх
// него освобождается самый давний, который не показан ни одной картинкой
// на странице и не из последних URL_KEEP_RECENT (его могли только что
// отдать и ещё не поставить в src).

const DB_NAME = 'lancible-assets';
const STORE = 'blobs';
const BUCKET = 'doc-assets';
const MAX_SIDE = 2400;

export const URL_CACHE_MAX = 48;
export const URL_KEEP_RECENT = 8;
export const RETRY_BASE_MS = 30000;
export const RETRY_MAX_MS = 30 * 60000;

/** Отступ перед повтором выгрузки после tries неудачных попыток подряд. */
export const retryDelay = (tries) => (tries <= 1 ? 0 : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (tries - 2)));

/** Ответ облака на выгрузку → 'ok' | 'retry' (сеть, 5xx, 408, 429) |
 *  'auth' (401) | 'rejected' (остальные 4xx: тип, размер, правила). */
export function uploadVerdict(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'auth';
  if (!status || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'rejected';
}

/** То же по самому ответу: Storage кладёт настоящий код и в тело
 *  ({ statusCode }), а истёкший токен бывает и с кодом 400. */
async function verdictOf(res) {
  if (res.ok) return 'ok';
  let status = res.status;
  let text = '';
  try { text = String(await res.text()); } catch { /* тела нет */ }
  try {
    const s = Number((JSON.parse(text) || {}).statusCode);
    if (s >= 400 && s < 600) status = s;
  } catch { /* не JSON */ }
  if (/jwt|expired/i.test(text)) return 'auth';
  return uploadVerdict(status);
}

/** id картинок, на которые ссылается документ (JSON узла или документа):
 *  любые строки asset:… в атрибутах — картинки, страницы PDF, их слои. */
export function assetIdsIn(json) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (v.startsWith('asset:') && v.length > 6) out.add(v.slice(6)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(json);
  return [...out];
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idb(mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result == null ? null : req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const memory = new Map(); // на случай, если IndexedDB нет (приватное окно)
/** id → адрес blob: для <img>; порядок — от давнего к недавнему (LRU). */
const urls = new Map();

/** Адреса, которые сейчас стоят у картинок на странице. */
function shownUrls() {
  try { return new Set([...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))); } catch { return new Set(); }
}

function cachedUrl(id) {
  const url = urls.get(id);
  if (url == null) return null;
  urls.delete(id);
  urls.set(id, url);
  return url;
}

function rememberUrl(id, url) {
  urls.delete(id);
  urls.set(id, url);
  if (urls.size <= URL_CACHE_MAX) return;
  const shown = shownUrls();
  const old = [...urls.keys()].slice(0, Math.max(0, urls.size - URL_KEEP_RECENT));
  for (const k of old) {
    if (urls.size <= URL_CACHE_MAX) break;
    const u = urls.get(k);
    if (shown.has(u)) continue;
    urls.delete(k);
    try { URL.revokeObjectURL(u); } catch { /* уже освобождён */ }
  }
}

function dropUrl(id) {
  const u = urls.get(id);
  if (u == null) return;
  urls.delete(id);
  try { URL.revokeObjectURL(u); } catch { /* уже освобождён */ }
}


const getLocal = async (id) => (await idb('readonly', (s) => s.get(id))) || memory.get(id) || null;

async function putLocal(id, rec) {
  memory.set(id, rec);
  await idb('readwrite', (s) => s.put(rec, id));
}

async function deleteLocal(id) {
  memory.delete(id);
  await idb('readwrite', (s) => s.delete(id));
}

/** Все id картинок на устройстве: из IndexedDB и из памяти. */
async function allLocalIds() {
  const keys = (await idb('readonly', (s) => s.getAllKeys())) || [];
  return [...new Set([...keys.map(String), ...memory.keys()])];
}

/** Уменьшить фото до разумного: 2400 px по длинной стороне. Сжимаем в
 *  WebP, если браузер умеет, иначе JPEG; картинку с прозрачностью — PNG. */
export async function downscale(file) {
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type) || /gif/i.test(file.type)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 900 * 1024) { bmp.close && bmp.close(); return file; }
  const w = Math.round(bmp.width * scale);
  const hgt = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close && bmp.close();
  const alpha = /png/i.test(file.type);
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  let out = await toBlob(alpha ? 'image/webp' : 'image/webp', 0.86);
  if (!out || out.type !== 'image/webp') out = await toBlob(alpha ? 'image/png' : 'image/jpeg', 0.86);
  return out && out.size < file.size ? out : file;
}

/** Хранилище. remote() возвращает { url, anonKey, accessToken, userId } или
 *  null — тогда картинки живут только на этом устройстве. now — часы (для
 *  тестов отступа повтора). */
export function createAssetStore(opts) {
  const o = opts || {};
  const remote = () => (o.remote ? o.remote() : null);
  const now = () => (o.now ? o.now() : Date.now());
  // Кто вставляет: owner() хозяина (вошёл, даже если облако сейчас
  // выключено), иначе — тот, чьё облако открыто.
  const ownerNow = () => {
    if (o.owner) return o.owner() || null;
    const cfg = remote();
    return cfg && cfg.userId ? cfg.userId : null;
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const objectUrl = (cfg, id) => `${cfg.url}/storage/v1/object/${BUCKET}/${cfg.userId}/${id}`;
  const headers = (cfg, extra) => Object.assign({ apikey: cfg.anonKey, Authorization: `Bearer ${cfg.accessToken}` }, extra || {});

  /** Выгрузка, которая идёт сейчас: id → Promise<boolean> (ушла ли). */
  const inflight = new Map();
  /** Неудачи: id → { rejected } (облако отказало — до перезапуска) или
   *  { tries, until } (сеть, 5xx — не раньше until). */
  const held = new Map();
  /** Выброшенные (discard): их не выгружать, даже если запрос уже в пути. */
  const gone = new Set();
  let retryTimer = null;
  let api = null;

  /** Повтор после сбоя — когда выйдет ближайший отступ. */
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = null;
    let next = Infinity;
    for (const v of held.values()) if (!v.rejected && v.until > now()) next = Math.min(next, v.until);
    if (next === Infinity) return;
    retryTimer = setTimeout(() => { retryTimer = null; api.flush(); }, Math.max(0, next - now()) + 50);
    if (retryTimer && retryTimer.unref) retryTimer.unref();
  }

  const waiting = (id) => {
    const v = held.get(id);
    return !!v && (v.rejected || v.until > now());
  };

  async function sendOnce(id, rec) {
    const cfg = remote();
    if (!cfg || gone.has(id)) return false;
    // Чужое и гостевое — не в эту папку (см. шапку).
    if (rec.owner !== cfg.userId) return false;
    let verdict;
    try {
      const res = await fetch(objectUrl(cfg, id), {
        method: 'POST',
        headers: headers(cfg, { 'Content-Type': rec.type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '31536000' }),
        body: rec.blob,
      });
      verdict = await verdictOf(res);
    } catch {
      verdict = 'retry';
    }
    if (verdict === 'ok') {
      if (held.delete(id)) scheduleRetry();
      if (!gone.has(id)) await putLocal(id, Object.assign({}, rec, { pending: false }));
      return true;
    }
    if (verdict === 'rejected') held.set(id, { rejected: true });
    else if (verdict === 'retry') {
      const tries = ((held.get(id) || {}).tries || 0) + 1;
      held.set(id, { tries, until: now() + retryDelay(tries) });
      scheduleRetry();
    }
    return false;
  }

  function upload(id, rec) {
    if (inflight.has(id)) return inflight.get(id);
    const p = sendOnce(id, rec).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  async function download(id) {
    const cfg = remote();
    if (!cfg) return null;
    try {
      const res = await fetch(`${cfg.url}/storage/v1/object/authenticated/${BUCKET}/${cfg.userId}/${id}`, { headers: headers(cfg) });
      if (!res.ok) return null;
      const blob = await res.blob();
      const rec = { blob, type: blob.type, pending: false, owner: cfg.userId };
      await putLocal(id, rec);
      return rec;
    } catch {
      return null;
    }
  }

  api = {
    /** Файл → src для документа. */
    async put(file) {
      const blob = await downscale(file);
      const id = newId();
      const rec = { blob, type: blob.type, pending: true, name: file.name || '', owner: ownerNow() };
      await putLocal(id, rec);
      upload(id, rec);
      return `asset:${id}`;
    },
    /** src → адрес для <img>. Внешние адреса — как есть. */
    async resolve(src) {
      if (!src || !src.startsWith('asset:')) return src;
      const id = src.slice(6);
      const cached = cachedUrl(id);
      if (cached) return cached;
      const rec = (await getLocal(id)) || (await download(id));
      if (!rec) return null;
      // Пока читали, адрес мог появиться у соседнего вызова — один на id.
      const again = cachedUrl(id);
      if (again) return again;
      const url = URL.createObjectURL(rec.blob);
      rememberUrl(id, url);
      return url;
    },
    async blob(src) {
      if (!src || !src.startsWith('asset:')) return null;
      const id = src.slice(6);
      const rec = (await getLocal(id)) || (await download(id));
      return rec ? rec.blob : null;
    },
    /** Снова поставить в очередь на выгрузку картинки, которые есть на этом
     *  устройстве, — когда их копии в облаке пропали, а аккаунт остался:
     *  например, удаление аккаунта стёрло папку и не довершилось. ids — то,
     *  что после asset:; без ids — все картинки на устройстве. Выгрузит их
     *  следующий flush(). Возвращает, сколько картинок встало в очередь. */
    async requeue(ids) {
      const list = ids ? ids.slice() : await allLocalIds();
      let n = 0;
      for (const id of list) {
        const rec = await getLocal(id);
        if (!rec) continue;
        // Явная просьба — и отказ, и отступ забываются.
        held.delete(id);
        if (!rec.pending) await putLocal(id, Object.assign({}, rec, { pending: true }));
        n += 1;
      }
      return n;
    },
    /** Гостевые записи (вставлены без аккаунта) — аккаунту userId: перенос
     *  данных «Без аккаунта» в аккаунт. ids (то, что после asset:, можно и
     *  с ним) — только эти записи, если они гостевые; без ids — все
     *  гостевые. Выгрузит их следующий flush(). Возвращает, сколько записей
     *  перешло. */
    async adoptGuest(userId, ids) {
      if (!userId) return 0;
      const list = ids ? [...new Set(ids.map((x) => String(x).replace(/^asset:/, '')))] : await allLocalIds();
      let n = 0;
      for (const id of list) {
        const rec = await getLocal(id);
        if (!rec || rec.owner !== null) continue;
        await putLocal(id, Object.assign({}, rec, { owner: userId }));
        n += 1;
      }
      return n;
    },
    /** Догнать облако: то, что вставили без сети или пока облако молчало, —
     *  только записи того, кто сейчас вошёл (см. шапку). */
    async flush() {
      const cfg = remote();
      if (!cfg) return 0;
      const db = await openDb();
      const pending = [];
      if (db) {
        await new Promise((resolve) => {
          try {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
            req.onsuccess = () => {
              const cur = req.result;
              if (!cur) { resolve(); return; }
              if (cur.value && cur.value.pending) pending.push([cur.key, cur.value]);
              cur.continue();
            };
            req.onerror = () => resolve();
          } catch { resolve(); }
        });
      } else {
        for (const [k, v] of memory) if (v.pending) pending.push([k, v]);
      }
      let n = 0;
      for (const [id, rec0] of pending) {
        // Отказ облака или отступ после сбоя (см. шапку); выброшенное — нет.
        if (gone.has(id) || waiting(id)) continue;
        let rec = rec0;
        // Запись до 17 октября без owner — первому вошедшему, как раньше.
        if (!('owner' in rec)) { rec = Object.assign({}, rec, { owner: cfg.userId }); await putLocal(id, rec); }
        if (rec.owner === cfg.userId && await upload(id, rec)) n += 1;
      }
      return n;
    },
    /** Выбросить запись, на которую в документе ничего не ссылается (импорт
     *  PDF прерван раньше, чем страница встала): с устройства, из очереди и,
     *  если она уже ушла, из облака. Запрос выгрузки в пути — сначала его
     *  дождаться, потом убрать и копию. */
    async discard(src) {
      if (!src || !src.startsWith('asset:')) return false;
      const id = src.slice(6);
      gone.add(id);
      held.delete(id);
      const sent = inflight.has(id) ? await inflight.get(id) : false;
      const rec = await getLocal(id);
      await deleteLocal(id);
      dropUrl(id);
      const cfg = remote();
      if (cfg && rec && rec.owner === cfg.userId && (sent || rec.pending === false)) {
        try { await fetch(objectUrl(cfg, id), { method: 'DELETE', headers: headers(cfg) }); } catch { /* копия в облаке останется — не беда */ }
      }
      return true;
    },
    /** Стереть с устройства все картинки аккаунта userId (owner === userId):
     *  аккаунт удалён или убран с устройства. Облако не трогает — его
     *  чистит сервер; гостевые и чужие записи остаются. Адреса blob:
     *  освобождаются, выгрузки в пути до устройства уже не допишут.
     *  Возвращает, сколько записей стёрто. */
    async forget(userId) {
      if (!userId) return 0;
      const uid = String(userId);
      let n = 0;
      for (const id of await allLocalIds()) {
        const rec = await getLocal(id);
        if (!rec || rec.owner !== uid) continue;
        gone.add(id);
        held.delete(id);
        await deleteLocal(id);
        dropUrl(id);
        n += 1;
      }
      if (n) scheduleRetry();
      return n;
    },
  };
  return api;
}

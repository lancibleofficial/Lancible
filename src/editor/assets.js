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

const DB_NAME = 'lancible-assets';
const STORE = 'blobs';
const BUCKET = 'doc-assets';
const MAX_SIDE = 2400;

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
const urls = new Map();

const getLocal = async (id) => (await idb('readonly', (s) => s.get(id))) || memory.get(id) || null;

async function putLocal(id, rec) {
  memory.set(id, rec);
  await idb('readwrite', (s) => s.put(rec, id));
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
 *  null — тогда картинки живут только на этом устройстве. */
export function createAssetStore(opts) {
  const o = opts || {};
  const remote = () => (o.remote ? o.remote() : null);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const objectUrl = (cfg, id) => `${cfg.url}/storage/v1/object/${BUCKET}/${cfg.userId}/${id}`;
  const headers = (cfg, extra) => Object.assign({ apikey: cfg.anonKey, Authorization: `Bearer ${cfg.accessToken}` }, extra || {});

  async function upload(id, rec) {
    const cfg = remote();
    if (!cfg) return false;
    try {
      const res = await fetch(objectUrl(cfg, id), {
        method: 'POST',
        headers: headers(cfg, { 'Content-Type': rec.type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '31536000' }),
        body: rec.blob,
      });
      if (!res.ok) return false;
      await putLocal(id, Object.assign({}, rec, { pending: false }));
      return true;
    } catch {
      return false;
    }
  }

  async function download(id) {
    const cfg = remote();
    if (!cfg) return null;
    try {
      const res = await fetch(`${cfg.url}/storage/v1/object/authenticated/${BUCKET}/${cfg.userId}/${id}`, { headers: headers(cfg) });
      if (!res.ok) return null;
      const blob = await res.blob();
      const rec = { blob, type: blob.type, pending: false };
      await putLocal(id, rec);
      return rec;
    } catch {
      return null;
    }
  }

  return {
    /** Файл → src для документа. */
    async put(file) {
      const blob = await downscale(file);
      const id = newId();
      const rec = { blob, type: blob.type, pending: true, name: file.name || '' };
      await putLocal(id, rec);
      upload(id, rec);
      return `asset:${id}`;
    },
    /** src → адрес для <img>. Внешние адреса — как есть. */
    async resolve(src) {
      if (!src || !src.startsWith('asset:')) return src;
      const id = src.slice(6);
      if (urls.has(id)) return urls.get(id);
      const rec = (await getLocal(id)) || (await download(id));
      if (!rec) return null;
      const url = URL.createObjectURL(rec.blob);
      urls.set(id, url);
      return url;
    },
    async blob(src) {
      if (!src || !src.startsWith('asset:')) return null;
      const id = src.slice(6);
      const rec = (await getLocal(id)) || (await download(id));
      return rec ? rec.blob : null;
    },
    /** Догнать облако: то, что вставили без сети или без аккаунта. */
    async flush() {
      if (!remote()) return 0;
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
      for (const [id, rec] of pending) if (await upload(id, rec)) n += 1;
      return n;
    },
  };
}

// Очередь выгрузки картинок редактора — по аккаунтам (17 октября 2026).
// Запуск: npm run test:unit
//
// Откуда взялось. На устройстве бывает несколько аккаунтов (переключение
// без выхода) и запись «Без аккаунта». Очередь выгрузки картинок в облако
// (src/editor/assets.js) раньше уходила тому, кто вошёл сейчас, — и
// картинка, вставленная в одном аккаунте, после переключения уезжала в папку
// другого. Теперь у записи — owner, и уходят только записи вошедшего;
// гостевые — только явным переносом «Без аккаунта» (adoptGuest).
//
// IndexedDB в Node нет — хранилище живёт в памяти, как в приватном окне; сеть
// — подменённый fetch, который записывает, куда что ушло.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

function load() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'src', 'editor', 'assets.js')],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

/** Облако: сколько раз и в чью папку что ушло; online — принимает ли. */
function cloud() {
  const c = { online: false, uploads: [] };
  global.fetch = async (url, init) => {
    if (init && init.method === 'POST') {
      if (!c.online) return { ok: false, status: 503 };
      const m = /doc-assets\/([^/]+)\/([^/?]+)$/.exec(url);
      c.uploads.push({ folder: m[1], id: m[2] });
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 404 };
  };
  return c;
}

const file = (name) => new File([`байты ${name}`], name, { type: 'text/plain' });

test('картинка уходит только в папку того, кто её вставил: после переключения чужое ждёт своего', async () => {
  const { createAssetStore } = load();
  const net = cloud();
  let user = 'A';
  const store = createAssetStore({ remote: () => (user ? { url: 'https://x.supabase.co', anonKey: 'k', accessToken: 't', userId: user } : null) });
  const src = await store.put(file('a.png'));
  const id = src.slice(6);
  assert.deepEqual(net.uploads, [], 'облако молчало — запись в очереди');

  net.online = true;
  user = 'B';
  assert.equal(await store.flush(), 0, 'B вошёл — чужое не уходит');
  assert.deepEqual(net.uploads, []);

  user = 'A';
  assert.equal(await store.flush(), 1);
  assert.deepEqual(net.uploads, [{ folder: 'A', id }]);
  assert.equal(await store.flush(), 0, 'выгруженное второй раз не уходит');
});

test('вставленное без аккаунта не уходит первому вошедшему — только переносом «Без аккаунта»', async () => {
  const { createAssetStore } = load();
  const net = cloud();
  net.online = true;
  let user = null;
  const store = createAssetStore({ remote: () => (user ? { url: 'https://x.supabase.co', anonKey: 'k', accessToken: 't', userId: user } : null) });
  const src = await store.put(file('guest.png'));
  user = 'B';
  assert.equal(await store.flush(), 0, 'гостевая запись — не первому вошедшему');
  assert.deepEqual(net.uploads, []);
  assert.equal(await store.adoptGuest('B'), 1, 'перенос «Без аккаунта» в B забирает её');
  assert.equal(await store.flush(), 1);
  assert.deepEqual(net.uploads, [{ folder: 'B', id: src.slice(6) }]);
  assert.equal(await store.adoptGuest('C'), 0, 'забранное другим не переходит');
});

test('вошёл, но облако выключено: хозяин называет автора сам (owner), запись — его', async () => {
  const { createAssetStore } = load();
  const net = cloud();
  net.online = true;
  let sync = false;
  const store = createAssetStore({
    remote: () => (sync ? { url: 'https://x.supabase.co', anonKey: 'k', accessToken: 't', userId: 'A' } : null),
    owner: () => 'A',
  });
  const src = await store.put(file('a.png'));
  assert.deepEqual(net.uploads, []);
  sync = true;
  assert.equal(await store.flush(), 1, 'облако включили — своя запись ушла');
  assert.deepEqual(net.uploads, [{ folder: 'A', id: src.slice(6) }]);
});

// --- отказ облака и повтор (19 октября 2026) ---------------------------------------
//
// Исходный PDF до 20 МБ, пока корзина его не принимает (не выполнен
// supabase/storage-pdf.sql), уходил заново на каждый flush — а flush зовёт
// каждое событие сеанса. Теперь отказ (4xx) помечает запись до перезапуска,
// сеть и 5xx — повтор с растущим отступом.

/** Облако с ответом по запросу: answer(init) → { status, body }; posts —
 *  сколько раз что слали. */
function scriptedCloud(answer) {
  const c = { posts: [], deletes: [] };
  global.fetch = async (url, init) => {
    const m = /doc-assets\/([^/]+)\/([^/?]+)$/.exec(url);
    if (init && init.method === 'DELETE') { c.deletes.push(m[2]); return { ok: true, status: 200, text: async () => '' }; }
    if (init && init.method === 'POST') {
      c.posts.push(m[2]);
      const a = answer(init, c.posts.length);
      if (a === 'offline') throw new TypeError('Failed to fetch');
      return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.body || '' };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return c;
}

const cfgA = { url: 'https://x.supabase.co', anonKey: 'k', accessToken: 't', userId: 'A' };
const pdf = () => new File(['%PDF-1.7 байты'], 'договор.pdf', { type: 'application/pdf' });
const settle = () => new Promise((r) => setImmediate(r));

test('ответ облака: 4xx — отказ, 401 — сеанс, сеть, 5xx, 408 и 429 — повтор; отступ растёт до 30 мин', () => {
  const { uploadVerdict, retryDelay, RETRY_BASE_MS, RETRY_MAX_MS } = load();
  assert.equal(uploadVerdict(200), 'ok');
  for (const s of [400, 403, 404, 413, 415, 422]) assert.equal(uploadVerdict(s), 'rejected', String(s));
  assert.equal(uploadVerdict(401), 'auth');
  for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(uploadVerdict(s), 'retry', String(s));
  assert.equal(retryDelay(1), 0, 'первый повтор — со следующим flush');
  assert.equal(retryDelay(2), RETRY_BASE_MS);
  assert.equal(retryDelay(3), RETRY_BASE_MS * 2);
  assert.ok(retryDelay(4) > retryDelay(3));
  assert.equal(retryDelay(30), RETRY_MAX_MS, 'не реже раза в 30 минут');
});

test('корзина не принимает PDF (415): файл ушёл один раз, flush его больше не шлёт — до перезапуска', async () => {
  const { createAssetStore } = load();
  const net = scriptedCloud((init) => (init.headers['Content-Type'] === 'application/pdf'
    ? { status: 400, body: '{"statusCode":"415","error":"invalid_mime_type","message":"mime type application/pdf is not supported"}' }
    : { status: 200 }));
  const store = createAssetStore({ remote: () => cfgA });
  const src = await store.put(pdf());
  await settle();
  assert.equal(net.posts.length, 1);
  for (let i = 0; i < 5; i++) assert.equal(await store.flush(), 0);
  assert.equal(net.posts.length, 1, 'пять flush — ни одной повторной выгрузки 20 МБ');
  // Картинка рядом уходит как обычно.
  await store.put(new File(['png'], 'p.png', { type: 'image/png' }));
  await settle();
  assert.equal(net.posts.length, 2);

  // Перезапуск приложения — новое хранилище (записи на устройстве те же): ещё раз.
  const again = createAssetStore({ remote: () => cfgA });
  assert.equal(await again.flush(), 0);
  assert.equal(net.posts.length, 3, 'после перезапуска — одна новая попытка');
  assert.equal(await again.flush(), 0);
  assert.equal(net.posts.length, 3);
  // Явный requeue (удаление аккаунта стёрло облако) отказ забывает.
  await again.requeue([src.slice(6)]);
  await again.flush();
  assert.equal(net.posts.length, 4);
});

test('сеть и 5xx: повтор с растущим отступом, по таймеру хранилища; истёкший токен — со следующим flush', async () => {
  const { createAssetStore, RETRY_BASE_MS } = load();
  let mode = 'offline';
  const net = scriptedCloud(() => (mode === 'offline' ? 'offline' : mode === '503' ? { status: 503 } : mode === 'jwt' ? { status: 400, body: '{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}' } : { status: 200 }));
  let clock = 1_000_000;
  const store = createAssetStore({ remote: () => cfgA, now: () => clock });
  const src = await store.put(pdf());
  await settle();
  assert.equal(net.posts.length, 1, 'нет сети');
  mode = '503';
  // Таймер повтора — подменой setTimeout: какой отступ и что он зовёт.
  const timers = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSetTimeout(() => {}, 0); };
  try {
    assert.equal(await store.flush(), 0);
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.equal(net.posts.length, 2, 'первый повтор — сразу со следующим flush');
  assert.equal(timers.length, 1, 'после второй неудачи хранилище ставит повтор само');
  assert.ok(Math.abs(timers[0].ms - RETRY_BASE_MS) <= 100, String(timers[0].ms));
  await store.flush();
  await store.flush();
  assert.equal(net.posts.length, 2, 'внутри отступа — ни одной попытки');
  clock += RETRY_BASE_MS + 1;
  timers[0].fn();
  for (let i = 0; i < 20; i++) await settle();
  assert.equal(net.posts.length, 3, 'отступ вышел — таймер позвал flush');
  clock += RETRY_BASE_MS + 1;
  await store.flush();
  assert.equal(net.posts.length, 3, 'второй отступ вдвое длиннее');
  clock += RETRY_BASE_MS;
  mode = 'ok';
  assert.equal(await store.flush(), 1);
  assert.equal(net.posts.length, 4);
  assert.equal(await store.flush(), 0, 'выгруженное — не шлётся');

  // Истёкший токен (Storage отвечает 400 с «jwt expired») — не отказ: следующий flush (новый сеанс) шлёт снова.
  mode = 'jwt';
  const src2 = await store.put(pdf());
  await settle();
  mode = 'ok';
  assert.equal(await store.flush(), 1);
});

test('одна запись — один запрос за раз: два flush подряд не шлют её дважды', async () => {
  const { createAssetStore } = load();
  let release;
  const gate = new Promise((r) => { release = r; });
  const posts = [];
  global.fetch = async (url, init) => { posts.push(url); await gate; return { ok: true, status: 200, text: async () => '' }; };
  let cfg = null;
  const store = createAssetStore({ remote: () => cfg, owner: () => 'A' });
  await store.put(pdf());
  cfg = cfgA;
  const both = Promise.all([store.flush(), store.flush()]);
  await settle();
  release();
  await both;
  assert.equal(posts.length, 1);
});

test('discard: запись, которая в документ не встала, уходит с устройства и из облака; запрос в пути — после него', async () => {
  const { createAssetStore } = load();
  let release;
  const gate = new Promise((r) => { release = r; });
  const net = { posts: [], deletes: [] };
  global.fetch = async (url, init) => {
    const id = url.split('/').pop();
    if (init && init.method === 'DELETE') { net.deletes.push(id); return { ok: true, status: 200, text: async () => '' }; }
    if (!init || init.method !== 'POST') return { ok: false, status: 404, text: async () => '' };
    net.posts.push(id);
    await gate;
    return { ok: true, status: 200, text: async () => '' };
  };
  const store = createAssetStore({ remote: () => cfgA });
  const src = await store.put(pdf());
  const id = src.slice(6);
  const done = store.discard(src);
  await settle();
  assert.deepEqual(net.deletes, [], 'пока выгрузка в пути — не удаляем');
  release();
  assert.equal(await done, true);
  assert.deepEqual(net.posts, [id]);
  assert.deepEqual(net.deletes, [id], 'ушедшая копия удалена из облака');
  assert.equal(await store.blob(src), null, 'на устройстве записи нет');
  assert.equal(await store.flush(), 0);
  assert.deepEqual(net.posts, [id], 'flush её не шлёт');

  // Не успела уйти (облако закрыто) — облако не трогаем.
  const offline = createAssetStore({ remote: () => null });
  const src2 = await offline.put(pdf());
  await offline.discard(src2);
  assert.equal(await offline.blob(src2), null);
  assert.deepEqual(net.deletes, [id]);
});

test('assets-adopt по списку: аккаунту — только названные гостевые записи', async () => {
  const { createAssetStore, assetIdsIn } = load();
  const net = cloud();
  net.online = true;
  let user = null;
  const store = createAssetStore({ remote: () => (user ? { url: 'https://x.supabase.co', anonKey: 'k', accessToken: 't', userId: user } : null) });
  const inDoc = await store.put(file('doc.png'));
  const other = await store.put(file('other.png'));
  const doc = { type: 'doc', content: [
    { type: 'image', attrs: { src: inDoc, alt: '' } },
    { type: 'pdfpage', attrs: { src: 'asset:pdf-1', preview: 'asset:prev-1', overlays: [{ type: 'image', src: 'asset:ov-1' }] } },
    { type: 'image', attrs: { src: 'https://example.com/a.png' } },
  ] };
  assert.deepEqual(assetIdsIn(doc).sort(), [inDoc.slice(6), 'ov-1', 'pdf-1', 'prev-1'].sort(), 'картинки, страница PDF, превью, слои');
  assert.equal(await store.adoptGuest('U1', assetIdsIn(doc)), 1, 'из документа на устройстве — одна гостевая');
  user = 'U1';
  assert.equal(await store.flush(), 1);
  assert.deepEqual(net.uploads, [{ folder: 'U1', id: inDoc.slice(6) }], 'вторая гостевая осталась гостевой');
  assert.equal(await store.adoptGuest('U1', [other]), 1, 'с asset: тоже можно');
  assert.equal(await store.flush(), 1);
});

test('forget: стирает с устройства только записи аккаунта, освобождает их адреса; облако не трогает', async () => {
  const { createAssetStore } = load();
  const net = cloud();
  let user = null;
  const store = createAssetStore({ remote: () => null, owner: () => user });
  const revoked = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); realRevoke(u); };
  try {
    user = 'A';
    const a1 = await store.put(file('a1.png'));
    const a2 = await store.put(file('a2.png'));
    user = 'B';
    const b1 = await store.put(file('b1.png'));
    user = null;
    const g1 = await store.put(file('g1.png'));
    const url = await store.resolve(a1);
    assert.equal(await store.forget('A'), 2);
    assert.equal(await store.blob(a1), null);
    assert.equal(await store.blob(a2), null);
    assert.ok(await store.blob(b1), 'чужая запись осталась');
    assert.ok(await store.blob(g1), 'гостевая осталась');
    assert.ok(revoked.includes(url), 'адрес стёртой освобождён');
    assert.equal(await store.forget('A'), 0, 'второй раз — нечего');
    assert.equal(await store.forget(''), 0);
    assert.equal(await store.forget(null), 0);
    assert.deepEqual(net.uploads, [], 'облако не трогали');
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
});

test('адреса картинок: не больше URL_CACHE_MAX, вытесненные освобождаются, последние — никогда', async () => {
  const { createAssetStore, URL_CACHE_MAX, URL_KEEP_RECENT } = load();
  global.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
  const revoked = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); realRevoke(u); };
  try {
    const store = createAssetStore({});
    const srcs = [];
    for (let i = 0; i < URL_CACHE_MAX + 20; i++) srcs.push(await store.put(file(`p${i}.png`)));
    const got = [];
    for (const s of srcs) got.push(await store.resolve(s));
    assert.equal(got.length - revoked.length, URL_CACHE_MAX, 'живых адресов — URL_CACHE_MAX');
    assert.equal(revoked.length, 20, 'двадцать самых давних освобождены');
    assert.deepEqual(revoked, got.slice(0, 20));
    // Тот же id — тот же адрес, пока он в кэше; давний — новый адрес.
    assert.equal(await store.resolve(srcs[srcs.length - 1]), got[got.length - 1]);
    const fresh = await store.resolve(srcs[0]);
    assert.notEqual(fresh, got[0]);
    assert.ok(URL_KEEP_RECENT > 0 && URL_KEEP_RECENT < URL_CACHE_MAX);
    // discard освобождает свой адрес сразу.
    await store.discard(srcs[srcs.length - 1]);
    assert.ok(revoked.includes(got[got.length - 1]));
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
});

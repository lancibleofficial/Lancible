/* Обратная связь → Telegram — Edge Function feedback-notify
 * (supabase/functions/feedback-notify). Запуск: npm run test:backend
 *
 * Две части.
 *
 * 1. Без сети. Сама функция (index.ts, типы снимает esbuild) гоняется в Node
 *    на подменах: Deno.serve, база и хранилище (supabase-js), fetch к Bot API
 *    и ожидание между попытками взять снимок. Проверяется то, чего снаружи
 *    не видно: строка захватывается один раз (повтор вебхука не шлёт
 *    второго сообщения); из тела берётся только id (подделанный текст в
 *    сообщение не попадает); экранирование HTML и предел Telegram 4096;
 *    снимок ответом на сообщение — со второй попытки, а не появился —
 *    строка «снимок не загрузился»; без секретов — 500 и строка не
 *    захвачена; ошибка Telegram снимает захват; уборка стирает только
 *    старше 12 месяцев и снимки — через Storage API; токен бота и текст
 *    отзыва не попадают в логи; ответ уходит до отправки (EdgeRuntime), а
 *    без EdgeRuntime отправка идёт до ответа.
 * 2. Выложенная функция: без ключа — 401 («Verify JWT»), GET — 405, id,
 *    которого нет, — 200 skipped (или 500 no telegram, пока секретов нет).
 *    Ничего не отправляет. Пока функции нет (404) — todo.
 *
 * Живой отправки в Telegram тест не делает: проверка руками — пробный отзыв
 * из приложения (supabase/functions/README.md, «feedback-notify: настройка»).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'feedback-notify', 'index.ts');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
const realFetch = globalThis.fetch;

// --- 1. без сети: функция на подменах ------------------------------------------

const TOKEN = '7012345678:AAF-not-a-real-token_0000000000xyz';
const CHAT = '-1001234567890';
const NOW = new Date('2026-10-19T03:15:00.000Z');
const ID = '0b6f3c9e-1d2a-4f5b-8c7d-9e0f1a2b3c4d';
const ID2 = '7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d';
const USER = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const SHOT = `${ID}.png`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const monthsAgo = (n) => { const d = new Date(NOW); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString(); };

const row = (extra) => ({
  id: ID, user_id: null, kind: 'bug', text: 'Кнопка «Старт» не нажимается', platform: 'web', app_version: '0.4.4',
  lang: 'ru', device: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', screenshot_path: null,
  created_at: '2026-10-19T10:42:07.123456+00:00', notified_at: null, ...extra,
});

const pick = (r, cols) => (cols ? Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, r[c]])) : { ...r });

/** База и хранилище на подмене. rows — строки feedback; objects — файлы
 *  бакета feedback: { имя: { created_at, appearsAt } } — appearsAt: с какой
 *  попытки скачивания файл «появился» (клиент грузит его после строки).
 *  calls — что и в каком порядке позвала функция. */
function fakeAdmin({ rows = [], objects = {}, folders = [], fail = {} } = {}) {
  const db = { rows: rows.map((r) => ({ ...r })), objects: new Map(Object.entries(objects)), calls: [], downloads: 0 };
  db.client = {
    from(table) {
      assert.equal(table, 'feedback', 'функция ходит только в feedback');
      const q = { op: 'select', values: null, filters: [], desc: [], cols: null, order: null, limit: null, single: false };
      const run = () => {
        const match = (r) => q.filters.every((f) => f(r));
        db.calls.push([`${q.op} feedback`, q.desc.join(' '), q.values]);
        if (q.op === 'update') {
          const claim = q.values.notified_at !== null;
          if (claim && fail.claim) return { data: null, error: fail.claim };
          if (!claim && fail.release) return { data: null, error: fail.release };
          const hit = db.rows.filter(match);
          for (const r of hit) Object.assign(r, q.values);
          const data = q.cols ? hit.map((r) => pick(r, q.cols)) : null;
          return { data: q.single ? (data && data[0]) || null : data, error: null };
        }
        if (q.op === 'delete') {
          db.rows = db.rows.filter((r) => !match(r));
          return { data: null, error: null };
        }
        let list = db.rows.filter(match);
        if (q.order) list = list.slice().sort((a, b) => (Date.parse(a[q.order]) - Date.parse(b[q.order])));
        if (q.limit != null) list = list.slice(0, q.limit);
        return { data: list.map((r) => pick(r, q.cols)), error: null };
      };
      const b = {
        select(cols) { q.cols = cols; return b; },
        update(v) { q.op = 'update'; q.values = v; return b; },
        delete() { q.op = 'delete'; return b; },
        eq(k, v) { q.desc.push(`${k}=${v}`); q.filters.push((r) => r[k] === v); return b; },
        is(k, v) { assert.equal(v, null); q.desc.push(`${k} is null`); q.filters.push((r) => r[k] === null); return b; },
        lt(k, v) { q.desc.push(`${k}<${v}`); q.filters.push((r) => Date.parse(r[k]) < Date.parse(v)); return b; },
        in(k, vs) { q.desc.push(`${k} in ${vs.length}`); q.filters.push((r) => vs.includes(r[k])); return b; },
        order(k, o) { assert.notEqual(o && o.ascending, false); q.order = k; return b; },
        limit(n) { q.limit = n; return b; },
        maybeSingle() { q.single = true; return b; },
        then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); },
      };
      return b;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'feedback', 'функция ходит только в бакет feedback');
        return {
          download: async (p) => {
            db.downloads += 1;
            db.calls.push(['download', p]);
            const o = db.objects.get(p);
            if (!o || db.downloads < (o.appearsAt || 1)) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
            return { data: new Blob([PNG], { type: 'image/png' }), error: null };
          },
          remove: async (paths) => {
            db.calls.push(['remove', paths.slice()]);
            if (fail.remove) return { data: null, error: { message: 'remove failed' } };
            const gone = paths.filter((p) => db.objects.delete(p));
            return { data: gone.map((name) => ({ name })), error: null };
          },
          list: async (prefix, opts) => {
            db.calls.push(['list', prefix, opts.offset]);
            assert.equal(prefix, '');
            assert.deepEqual(opts.sortBy, { column: 'created_at', order: 'asc' });
            const files = [...db.objects.entries()]
              .map(([name, o]) => ({ id: `obj-${name}`, name, created_at: o.created_at }))
              .sort((a, c) => Date.parse(a.created_at) - Date.parse(c.created_at));
            // Папки — в конце (у них нет created_at; nulls last).
            const all = [...files, ...folders.map((name) => ({ id: null, name, created_at: null }))];
            return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
          },
        };
      },
    },
  };
  return db;
}

/** Bot API на подмене. fail[метод] — ответ с ошибкой (или 'throw' — сеть);
 *  массив — по вызовам этого метода. hold — fetch ждёт release(). */
function fakeTelegram({ fail = {}, hold = false } = {}) {
  const tg = { sent: [], n: 0, count: {} };
  let release;
  tg.gate = hold ? new Promise((r) => { release = r; }) : null;
  tg.release = () => release && release();
  tg.fetch = async (url, init) => {
    const u = String(url);
    const m = u.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
    assert.ok(m, `запрос не к Bot API: ${u.replace(TOKEN, '<token>')}`);
    const [, token, method] = m;
    const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()]) : JSON.parse(init.body);
    tg.sent.push({ token, method, body });
    if (tg.gate) await tg.gate;
    const k = (tg.count[method] = (tg.count[method] || 0) + 1) - 1;
    const f = Array.isArray(fail[method]) ? fail[method][k] : fail[method];
    if (f === 'throw') throw new TypeError(`error sending request for url (${u}): client error (Connect): connection refused`);
    if (f) {
      return new Response(JSON.stringify({ ok: false, error_code: f.status || 400, description: f.description || 'Bad Request', parameters: f.parameters }), { status: f.status || 400 });
    }
    tg.n += 1;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 500 + tg.n } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return tg;
}

let loaded = null;
/** index.ts → JS без типов → модуль из data: URL; Deno.serve отдаёт обработчик. */
async function loadFunction() {
  if (loaded) return loaded;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { return null; }
  const { code } = await esbuild.transform(fs.readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const js = code.replace(/import\s*\{\s*createClient\s*\}\s*from\s*["']jsr:@supabase\/supabase-js@2["'];?/, 'const { createClient } = globalThis.__feedbackNotify.supabase;');
  assert.notEqual(js, code, 'импорт supabase-js в index.ts поменялся — поправить подмену');
  const box = { env: {}, db: null, handler: null, mod: null };
  globalThis.__feedbackNotify = { supabase: { createClient: () => box.db.client } };
  globalThis.Deno = { env: { get: (k) => box.env[k] }, serve: (h) => { box.handler = h; } };
  box.mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.equal(typeof box.handler, 'function', 'функция не позвала Deno.serve');
  box.timing = { ...box.mod.TIMING };
  loaded = box;
  return box;
}

/** Один вызов функции: свежая подмена, ожидание снимка без пауз, фон
 *  дождан. Каждый вызов заодно проверяет, что токена бота нет ни в одной
 *  строке лога и ни в ответе. */
async function invoke(t, { method = 'POST', body, raw, env, db, tg, edge = true, awaitBackground = true } = {}) {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild — npm install'); return null; }
  fn.env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, ...env };
  fn.db = db || fakeAdmin();
  const bot = tg || fakeTelegram();
  const waits = [];
  if (edge) globalThis.EdgeRuntime = { waitUntil: (p) => { waits.push(p); } };
  else delete globalThis.EdgeRuntime;
  const sleeps = [];
  Object.assign(fn.mod.TIMING, fn.timing, { sleep: async (ms) => { sleeps.push(ms); }, now: () => new Date(NOW) });
  const logs = [];
  const real = { error: console.error, log: console.log, warn: console.warn };
  for (const k of Object.keys(real)) console[k] = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  globalThis.fetch = bot.fetch;
  try {
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET') init.body = raw !== undefined ? raw : JSON.stringify(body);
    const res = await fn.handler(new Request('https://example.supabase.co/functions/v1/feedback-notify', init));
    const text = await res.text();
    const atResponse = bot.sent.length;
    if (awaitBackground) await Promise.all(waits);
    for (const line of logs) assert.ok(!line.includes(TOKEN) && !line.includes(TOKEN.split(':')[1]), `токен бота в логе: ${line.replace(TOKEN, '<token>')}`);
    assert.ok(!text.includes(TOKEN), 'токен бота в ответе');
    return { status: res.status, json: JSON.parse(text), sent: bot.sent, db: fn.db, logs, sleeps, waits, atResponse, bot };
  } finally {
    Object.assign(console, real);
    globalThis.fetch = realFetch;
  }
}

const webhook = (record) => ({ type: 'INSERT', table: 'feedback', schema: 'public', record, old_record: null });

test('feedback-notify без сети: строка захватывается один раз — повтор вебхука второго сообщения не шлёт', async (t) => {
  const db = fakeAdmin({ rows: [row()] });
  const first = await invoke(t, { db, body: webhook({ id: ID }) });
  if (!first) return;
  assert.equal(first.status, 202);
  assert.deepEqual(first.json, { queued: true });
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0].method, 'sendMessage');
  assert.equal(first.sent[0].token, TOKEN);
  assert.equal(first.sent[0].body.chat_id, CHAT);
  assert.equal(db.rows[0].notified_at, NOW.toISOString(), 'строка помечена отправленной');
  const claim = db.calls.find((c) => c[0] === 'update feedback');
  assert.deepEqual(claim.slice(0, 2), ['update feedback', `id=${ID} notified_at is null`], 'захват — update по id и только неотправленной строки');

  for (const body of [webhook({ id: ID }), { id: ID }, { id: ID.toUpperCase() }]) {
    const again = await invoke(t, { db, body });
    assert.equal(again.status, 200);
    assert.deepEqual(again.json, { skipped: true });
    assert.equal(again.sent.length, 0, 'уже отправленная строка второй раз не уходит');
  }

  // Две копии вебхука одновременно — сообщение одно: захват — один update.
  const fn = loaded;
  fn.db = fakeAdmin({ rows: [row()] });
  const tg = fakeTelegram();
  const waits = [];
  globalThis.EdgeRuntime = { waitUntil: (p) => { waits.push(p); } };
  globalThis.fetch = tg.fetch;
  try {
    const req = () => new Request('https://example.supabase.co/functions/v1/feedback-notify', { method: 'POST', body: JSON.stringify({ id: ID }) });
    const both = await Promise.all([fn.handler(req()), fn.handler(req())]);
    await Promise.all(waits);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 202]);
    assert.equal(tg.sent.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('feedback-notify без сети: из тела берётся только id — подделанный текст, вид и платформа в сообщение не попадают', async (t) => {
  const db = fakeAdmin({ rows: [row({ user_id: USER })] });
  const forged = webhook({
    id: ID, user_id: null, kind: 'idea', text: 'FORGED <a href="https://evil.example">нажми</a>', platform: 'ios',
    device: 'FORGED-DEVICE', screenshot_path: `${ID2}.png`, created_at: '1999-01-01T00:00:00Z',
  });
  const r = await invoke(t, { db, body: forged });
  if (!r) return;
  assert.equal(r.status, 202);
  const text = r.sent[0].body.text;
  for (const bad of ['FORGED', 'evil.example', '1999', 'iOS', 'Идея', ID2]) assert.ok(!text.includes(bad), `в сообщении «${bad}» из тела запроса`);
  assert.ok(text.includes('Кнопка «Старт» не нажимается'), 'текст — из базы');
  assert.match(text, /🐞 <b>Ошибка<\/b>/);
  assert.match(text, /Платформа: веб 0\.4\.4/);
  assert.match(text, /Время: 2026-10-19 10:42 UTC/);
  assert.match(text, /Отправитель: аккаунт/);
  assert.ok(!text.includes(USER), 'id пользователя в сообщение не идёт');
  assert.ok(text.includes(`<code>${ID.slice(0, 8)}</code>`), 'короткий id отзыва');
  assert.equal(r.sent.length, 1, 'снимка у строки нет — подделанный путь не скачивается');
  assert.equal(r.db.calls.filter((c) => c[0] === 'download').length, 0);

  // id, которого нет, — ничего не шлётся и не меняется.
  const none = await invoke(t, { db: fakeAdmin({ rows: [row()] }), body: { id: ID2, text: 'FORGED' } });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json, { skipped: true });
  assert.equal(none.sent.length, 0);
  assert.equal(none.db.rows[0].notified_at, null);
});

test('feedback-notify без сети: сообщение — HTML с экранированием, без предпросмотра ссылок, не длиннее 4096 знаков', async (t) => {
  const evil = 'Кнопка <b>жирная</b> & <script>alert("x")</script> <a href="https://x.example">ссылка</a>';
  const r = await invoke(t, { db: fakeAdmin({ rows: [row({ text: evil, device: '<i>dev</i> & "q"', app_version: '<1>' })] }), body: { id: ID } });
  if (!r) return;
  const msg = r.sent[0].body;
  assert.equal(msg.parse_mode, 'HTML');
  assert.deepEqual(msg.link_preview_options, { is_disabled: true });
  assert.ok(msg.text.includes('Кнопка &lt;b&gt;жирная&lt;/b&gt; &amp; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &lt;a href=&quot;https://x.example&quot;&gt;ссылка&lt;/a&gt;'));
  assert.ok(msg.text.includes('Устройство: &lt;i&gt;dev&lt;/i&gt; &amp; &quot;q&quot;'));
  assert.ok(msg.text.includes('веб &lt;1&gt;'));
  // Теги в сообщении — только свои: <b>, <code>, <i>.
  const tags = [...msg.text.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);
  assert.ok(tags.every((x) => ['b', 'code', 'i'].includes(x)), `чужие теги: ${tags}`);
  assert.match(msg.text, /Отправитель: гость/);

  const { fitText, messageText, TG_MAX } = loaded.mod;
  assert.equal(TG_MAX, 4096);
  // 4000 амперсандов — 20 000 знаков после экранирования.
  const long = messageText(row({ text: '&'.repeat(4000), device: 'd'.repeat(200) }));
  assert.ok(long.length <= 4096, `длина ${long.length}`);
  assert.match(long, /… обрезано: показано \d+ из 4000 знаков/);
  assert.doesNotMatch(long.replace(/&(amp|lt|gt|quot);/g, ''), /&/, 'сущность не разрезана');
  // Эмодзи — пара суррогатов: не разрезается.
  const emoji = fitText('x\n\n', '😀'.repeat(3000));
  assert.ok(emoji.length <= 4096);
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'одинокий суррогат');
  assert.match(emoji, /показано \d+ из 3000 знаков/);
  // Влезающее не трогается.
  assert.equal(fitText('h\n\n', 'коротко'), 'h\n\nкоротко');
  const exact = fitText('', 'я'.repeat(4096));
  assert.equal(exact, 'я'.repeat(4096), 'ровно 4096 — без обрезки');
  assert.ok(fitText('', 'я'.repeat(4097)).length <= 4096);
});

test('feedback-notify без сети: снимок появился со второй попытки — sendPhoto ответом на сообщение', async (t) => {
  const db = fakeAdmin({ rows: [row({ screenshot_path: SHOT })], objects: { [SHOT]: { created_at: '2026-10-19T10:42:09Z', appearsAt: 2 } } });
  const r = await invoke(t, { db, body: { id: ID } });
  if (!r) return;
  assert.equal(r.status, 202);
  assert.deepEqual(r.sent.map((s) => s.method), ['sendMessage', 'sendPhoto']);
  assert.match(r.sent[0].body.text, /Снимок: ответом ниже/);
  const photo = r.sent[1].body;
  assert.equal(photo.chat_id, CHAT);
  assert.ok(photo.photo instanceof Blob, 'снимок уходит файлом (multipart)');
  assert.equal(photo.photo.size, PNG.length);
  assert.deepEqual(JSON.parse(photo.reply_parameters), { message_id: 501, allow_sending_without_reply: true }, 'ответом на сообщение отзыва');
  assert.deepEqual(r.sleeps, [5000], 'вторая попытка — через 5 с');
  assert.equal(db.calls.filter((c) => c[0] === 'download').length, 2);

  // Фото Telegram не принял (размеры) — тот же файл документом.
  const db2 = fakeAdmin({ rows: [row({ screenshot_path: SHOT })], objects: { [SHOT]: { created_at: '2026-10-19T10:42:09Z' } } });
  const r2 = await invoke(t, { db: db2, body: { id: ID }, tg: fakeTelegram({ fail: { sendPhoto: { description: 'Bad Request: PHOTO_INVALID_DIMENSIONS' } } }) });
  assert.deepEqual(r2.sent.map((s) => s.method), ['sendMessage', 'sendPhoto', 'sendDocument']);
  assert.ok(r2.sent[2].body.document instanceof Blob);
  assert.deepEqual(JSON.parse(r2.sent[2].body.reply_parameters).message_id, 501);
  assert.equal(db2.rows[0].notified_at, NOW.toISOString(), 'текст ушёл — захват остаётся');
});

// 20 октября 2026: рабочий чат — группа с темами, отзывы идут в свой топик.
test('feedback-notify без сети: TELEGRAM_THREAD_ID — топик у сообщения, снимка и строки-ответа; 1 («General»), пусто и не число — без топика', async (t) => {
  const db = fakeAdmin({ rows: [row({ screenshot_path: SHOT })], objects: { [SHOT]: { created_at: '2026-10-19T10:42:09Z' } } });
  const r = await invoke(t, { db, body: { id: ID }, env: { TELEGRAM_THREAD_ID: '2' } });
  if (!r) return;
  assert.deepEqual(r.sent.map((s) => s.method), ['sendMessage', 'sendPhoto']);
  assert.equal(r.sent[0].body.message_thread_id, 2, 'сообщение — в топик');
  assert.equal(String(r.sent[1].body.message_thread_id), '2', 'снимок — в тот же топик');

  // Снимок не появился — строка-ответ тоже в топике.
  const lost = await invoke(t, { db: fakeAdmin({ rows: [row({ screenshot_path: SHOT })] }), body: { id: ID }, env: { TELEGRAM_THREAD_ID: '2' } });
  assert.deepEqual(lost.sent.map((s) => s.method), ['sendMessage', 'sendMessage']);
  assert.equal(lost.sent[1].body.message_thread_id, 2);

  for (const [thread, logged] of [['1', false], ['', false], [undefined, false], ['general', true], ['-5', true]]) {
    const x = await invoke(t, { db: fakeAdmin({ rows: [row()] }), body: { id: ID }, env: { TELEGRAM_THREAD_ID: thread } });
    assert.equal(x.status, 202, `топик ${thread}: отзыв всё равно уходит`);
    assert.ok(!('message_thread_id' in x.sent[0].body), `топик ${thread}: без номера топика`);
    assert.equal(x.logs.some((l) => /TELEGRAM_THREAD_ID/.test(l)), logged, `топик ${thread}: заметка в логе`);
  }
});

test('feedback-notify без сети: снимок не появился за минуту — ответ строкой «снимок не загрузился»', async (t) => {
  const db = fakeAdmin({ rows: [row({ screenshot_path: SHOT })] });
  const r = await invoke(t, { db, body: { id: ID } });
  if (!r) return;
  assert.deepEqual(r.sent.map((s) => s.method), ['sendMessage', 'sendMessage']);
  const note = r.sent[1].body;
  assert.match(note.text, /снимок не загрузился/i);
  assert.ok(note.text.includes(SHOT), 'имя файла — чтобы найти его в Storage, если догрузится');
  assert.deepEqual(note.reply_parameters, { message_id: 501, allow_sending_without_reply: true });
  assert.equal(db.calls.filter((c) => c[0] === 'download').length, 6, 'шесть попыток');
  assert.deepEqual(r.sleeps, [5000, 5000, 10000, 10000, 30000], 'сразу, через 5, 10, 20, 30 и 60 с');
  assert.equal(r.sleeps.reduce((a, b) => a + b, 0), 60000);
  assert.equal(db.rows[0].notified_at, NOW.toISOString());

  // Путь не того вида (строка до check формата) — не скачивается вовсе.
  const odd = await invoke(t, { db: fakeAdmin({ rows: [row({ screenshot_path: '../doc-assets/u2/b.png' })] }), body: { id: ID } });
  assert.match(odd.sent[1].body.text, /снимок не загрузился/i);
  assert.equal(odd.db.calls.filter((c) => c[0] === 'download').length, 0);
});

test('feedback-notify без сети: нет секретов бота — 500 no telegram, строка не захвачена и дошлётся после настройки', async (t) => {
  for (const env of [{ TELEGRAM_BOT_TOKEN: '' }, { TELEGRAM_CHAT_ID: '' }, { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }]) {
    const db = fakeAdmin({ rows: [row()] });
    const r = await invoke(t, { db, env, body: { id: ID } });
    if (!r) return;
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'no telegram' });
    assert.equal(r.sent.length, 0);
    assert.equal(db.rows[0].notified_at, null, 'строка не захвачена');
    assert.equal(db.calls.length, 0, 'база не тронута');
    const later = await invoke(t, { db, body: { id: ID } });
    assert.equal(later.status, 202, 'после настройки строка досылается');
    assert.equal(later.sent.length, 1);
  }
});

test('feedback-notify без сети: ошибка Telegram снимает захват, в логе — без токена и без текста отзыва', async (t) => {
  const secret = 'Секретный текст отзыва <tag>';
  const db = fakeAdmin({ rows: [row({ text: secret })] });
  const fail = { sendMessage: { status: 400, description: 'Bad Request: can\'t parse entities: Unsupported start tag "tag" at byte offset 300; text "Секретный текст отзыва"' } };
  const r = await invoke(t, { db, body: { id: ID }, tg: fakeTelegram({ fail }) });
  if (!r) return;
  assert.equal(r.status, 202, 'ответ ушёл до отправки');
  assert.equal(db.rows[0].notified_at, null, 'захват снят — повтор дошлёт');
  assert.ok(r.logs.some((l) => /feedback-notify: telegram sendMessage 400/.test(l)), `ошибка в логе: ${r.logs}`);
  for (const l of r.logs) assert.ok(!l.includes('Секретный') && !l.includes('"tag"'), `текст отзыва в логе: ${l}`);
  const again = await invoke(t, { db, body: { id: ID } });
  assert.equal(again.status, 202);
  assert.equal(again.sent.length, 1);
  assert.equal(db.rows[0].notified_at, NOW.toISOString());

  // Сеть до Telegram не ответила — в тексте ошибки Deno есть адрес с токеном.
  const db2 = fakeAdmin({ rows: [row()] });
  const net = await invoke(t, { db: db2, body: { id: ID }, tg: fakeTelegram({ fail: { sendMessage: 'throw' } }) });
  assert.equal(db2.rows[0].notified_at, null);
  assert.ok(net.logs.some((l) => l.includes('bot***') || l.includes('***')), `сетевая ошибка в логе с вычищенным токеном: ${net.logs}`);
  const { redact } = loaded.mod;
  assert.equal(redact(`url (https://api.telegram.org/bot${TOKEN}/sendMessage)`).includes(TOKEN.split(':')[1]), false);
  assert.ok(!redact('bot123:abc_DEF-9 и bot7:x').includes('abc_DEF'), 'и чужой токен вида bot<id>:<…> тоже');
  assert.ok(!redact(`token=${TOKEN};`).includes(TOKEN.split(':')[1]), 'токен и без «bot» перед ним');

  // Флуд-контроль: 429 с retry_after — одна повторная попытка.
  const db3 = fakeAdmin({ rows: [row()] });
  const flood = await invoke(t, { db: db3, body: { id: ID }, tg: fakeTelegram({ fail: { sendMessage: [{ status: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } }] } }) });
  assert.equal(flood.sent.length, 2);
  assert.deepEqual(flood.sleeps, [3000]);
  assert.equal(db3.rows[0].notified_at, NOW.toISOString());
});

// timeout: функция, которая ждёт отправку до ответа, повисла бы на закрытом
// шлюзе навсегда — пусть лучше упадёт.
test('feedback-notify без сети: ответ уходит до отправки (EdgeRuntime.waitUntil), без EdgeRuntime — отправка до ответа', { timeout: 10000 }, async (t) => {
  const tg = fakeTelegram({ hold: true });
  const pending = invoke(t, { db: fakeAdmin({ rows: [row()] }), body: { id: ID }, tg, awaitBackground: false });
  const r = await pending;
  if (!r) return;
  assert.equal(r.status, 202);
  assert.equal(r.waits.length, 1, 'отправка отдана EdgeRuntime.waitUntil');
  assert.equal(tg.n, 0, 'к ответу Telegram ещё не ответил');
  tg.release();
  await Promise.all(r.waits);
  assert.equal(tg.n, 1);

  const inline = await invoke(t, { db: fakeAdmin({ rows: [row()] }), body: { id: ID }, edge: false, awaitBackground: false });
  assert.equal(inline.status, 202);
  assert.equal(inline.waits.length, 0);
  assert.equal(inline.atResponse, 1, 'запасной путь: сообщение ушло до ответа');
});

test('feedback-notify без сети: не POST — 405; чужой вебхук, не JSON, другой action, id не uuid — 400; ничего не тронуто', async (t) => {
  const get = await invoke(t, { method: 'GET' });
  if (!get) return;
  assert.equal(get.status, 405);
  const bad = [
    ['не JSON', { raw: '{' }],
    ['массив', { body: [ID] }],
    ['обновление, а не вставка', { body: { ...webhook({ id: ID }), type: 'UPDATE' } }],
    ['другая таблица', { body: { ...webhook({ id: ID }), table: 'ai_calls' } }],
    ['другая схема', { body: { ...webhook({ id: ID }), schema: 'auth' } }],
    ['вебхук без record', { body: { type: 'INSERT', table: 'feedback' } }],
    ['другой action', { body: { action: 'drop' } }],
    ['id не uuid', { body: { id: "x' or 1=1 --" } }],
    ['id числом', { body: { id: 1 } }],
    ['пустое тело', { body: {} }],
  ];
  for (const [name, opts] of bad) {
    const db = fakeAdmin({ rows: [row()] });
    const r = await invoke(t, { ...opts, db });
    assert.equal(r.status, 400, name);
    assert.equal(r.sent.length, 0, `${name}: в Telegram ничего`);
    assert.equal(db.calls.length, 0, `${name}: база не тронута`);
  }
  const big = await invoke(t, { raw: JSON.stringify({ id: ID, pad: 'x'.repeat(300 * 1024) }), db: fakeAdmin({ rows: [row()] }) });
  assert.equal(big.status, 413);
});

test('feedback-notify без сети: sweep стирает только старше 12 месяцев — строки, их снимки и файлы без строки, снимки — через Storage API', async (t) => {
  const old = (i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const rows = [
    row({ id: old(1), screenshot_path: `${old(1)}.png`, created_at: monthsAgo(13) }),
    row({ id: old(2), screenshot_path: null, created_at: '2025-10-19T03:14:00.000Z', user_id: USER }), // на минуту старше срока
    row({ id: old(3), screenshot_path: '../doc-assets/u/x.png', created_at: monthsAgo(24) }),
    row({ id: ID, screenshot_path: SHOT, created_at: monthsAgo(11) }),
    row({ id: ID2, screenshot_path: null, created_at: '2025-10-19T03:16:00.000Z' }), // на минуту моложе срока
  ];
  const objects = {
    [`${old(1)}.png`]: { created_at: monthsAgo(13) },
    [SHOT]: { created_at: monthsAgo(11) },
    [`${old(9)}.webp`]: { created_at: monthsAgo(14) }, // строки нет — сирота
    [`${old(8)}.jpg`]: { created_at: monthsAgo(1) }, // строки нет, но молод
  };
  // Сирот больше страницы — листается.
  for (let i = 100; i < 330; i++) objects[`${old(i)}.png`] = { created_at: new Date(Date.parse(monthsAgo(20)) + i * 1000).toISOString() };
  // Старый файл, у которого строка есть (молодая) — не трогаем.
  objects[`${ID2}.png`] = { created_at: monthsAgo(15) };
  rows.push(row({ id: '11111111-1111-4111-8111-111111111111', screenshot_path: `${ID2}.png`, created_at: monthsAgo(2) }));
  const db = fakeAdmin({ rows, objects, folders: ['u2'] });
  const r = await invoke(t, { db, body: { action: 'sweep' }, env: { TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' } });
  if (!r) return;
  assert.equal(r.status, 202);
  assert.deepEqual(r.json, { sweep: 'started' });
  assert.equal(r.sent.length, 0, 'уборке Telegram не нужен');
  assert.deepEqual(db.rows.map((x) => x.id).sort(), [ID, ID2, '11111111-1111-4111-8111-111111111111'].sort(), 'остались только моложе 12 месяцев');
  const left = [...db.objects.keys()].sort();
  assert.deepEqual(left, [SHOT, `${old(8)}.jpg`, `${ID2}.png`].sort(), 'файлы: молодые и тот, у которого есть строка');
  const removed = db.calls.filter((c) => c[0] === 'remove').flatMap((c) => c[1]);
  assert.ok(!removed.includes('../doc-assets/u/x.png'), 'путь не того вида в Storage API не уходит');
  assert.ok(db.calls.filter((c) => c[0] === 'remove').every((c) => c[1].length <= 100), 'пачками до 100');
  assert.ok(db.calls.filter((c) => c[0] === 'list').length >= 3, 'файлы листаются страницами');
  const order = db.calls.map((c) => c[0]);
  assert.ok(order.indexOf('remove') < order.indexOf('delete feedback'), 'сначала снимки, потом строки: не стёрся файл — строка останется до следующей уборки');
  assert.ok(r.logs.some((l) => /feedback-notify: sweep \{"rows":3,"shots":1,"orphans":231\}/.test(l)), `итог уборки в логе: ${r.logs}`);

  // Снимки не стёрлись — строки остаются.
  const db2 = fakeAdmin({ rows: [row({ id: old(1), screenshot_path: `${old(1)}.png`, created_at: monthsAgo(13) })], objects: { [`${old(1)}.png`]: { created_at: monthsAgo(13) } }, fail: { remove: true } });
  const r2 = await invoke(t, { db: db2, body: { action: 'sweep' } });
  assert.equal(db2.rows.length, 1, 'файл не стёрся — строка ждёт следующей уборки');
  assert.ok(r2.logs.some((l) => /"error":"remove failed"/.test(l)));

  const { cutoff } = loaded.mod;
  assert.equal(cutoff(new Date('2026-10-19T03:15:00.000Z')).toISOString(), '2025-10-19T03:15:00.000Z');
});

// --- 2. выложенная функция ----------------------------------------------------

test('feedback-notify выложена: без ключа — 401, GET — 405, несуществующий id — ничего не шлёт', async (t) => {
  const call = (method, { key, body } = {}) => realFetch(`${SUPABASE_URL}/functions/v1/feedback-notify`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
  let probe;
  try { probe = await call('POST', { key: ANON, body: {} }); } catch (e) { t.todo(`нет сети до Supabase: ${e.message}`); return; }
  if (probe.status === 404) { t.todo('функция feedback-notify не выложена — supabase/functions/README.md, «feedback-notify: настройка»'); return; }
  assert.equal(probe.status, 400, `пустое тело — 400 bad id, получили ${probe.status}: ${probe.text.slice(0, 200)}`);
  const noKey = await call('POST', { body: {} });
  assert.equal(noKey.status, 401, `без ключа ждали 401 («Verify JWT» включён), получили ${noKey.status}`);
  assert.equal((await call('GET', { key: ANON })).status, 405);
  // Такого id нет и быть не может: захватывать нечего.
  const none = await call('POST', { key: ANON, body: { id: '00000000-0000-4000-8000-00000000f00d' } });
  if (none.status === 500 && /no telegram/.test(none.text)) { t.todo('секретов TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID ещё нет'); return; }
  assert.equal(none.status, 200, `${none.status}: ${none.text.slice(0, 200)}`);
  assert.deepEqual(JSON.parse(none.text), { skipped: true });
});

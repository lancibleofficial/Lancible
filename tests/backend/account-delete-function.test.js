/* Удаление аккаунта на сервере — Edge Function delete-account
 * (supabase/functions/delete-account). Запуск: npm run test:backend
 *
 * Функция одним вызовом стирает doc-assets/<uid>/ вызывающего и удаляет его
 * аккаунт. Тест проверяет:
 *   - без входа (ключ anon) — 401, никого не удаляет;
 *   - вызывающий удаляется вместе с картинками, его токен больше не годится;
 *   - второго пользователя и его картинки это не задевает.
 *
 * Без сети (19 октября 2026): сама функция (index.ts, типы снимает esbuild) на
 * подменах базы и хранилища — снимки экрана из обратной связи стираются до
 * удаления пользователя, только свои и только по имени <uuid>.<тип>, а сбой
 * их стирания удаление не держит, но виден в ответе и в логе. С 21 октября
 * 2026 — так же строка ai_access (доступ к агенту по приглашению,
 * supabase/ai-access.sql): стирается по почте в нижнем регистре до удаления,
 * сбой не держит, в логе — код без почты и uid; живая часть с ключом из
 * .env.local проверяет, что строка уходит вместе с аккаунтом.
 *
 * Пока функция не выложена (404), тест — todo. Живая часть заводит двух
 * настоящих пользователей — только по LANCIBLE_ACCOUNT_TEST=1 (в GitHub —
 * ручной запуск). Пустоту папки удалённого проверяет служебный ключ из
 * .env.local, если он есть; в CI его нет — там пустоту подтверждает то, что
 * функция стирает папку до удаления, а без этого страж storage.sql отказал бы.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
const BUCKET = 'doc-assets';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

async function call(method, urlPath, { token, body, type = 'application/json' } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token || ANON}` };
  if (body !== undefined) headers['Content-Type'] = type;
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method, headers, body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, ok: res.ok, text, json };
}

const deleteAccount = (token) => call('POST', '/functions/v1/delete-account', { token, body: {} });

/** Служебный ключ — только локально, из .env.local; в CI его нет. */
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const m = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8').match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

// --- без сети: функция на подменах ------------------------------------------

const SRC = path.join(__dirname, '..', '..', 'supabase', 'functions', 'delete-account', 'index.ts');

/** База и хранилище на подмене. objects — пути по корзинам; feedback — строки
 *  таблицы; access — почты в ai_access (null — таблицы нет); email — почта
 *  пользователя u1, как её отдаёт вход; fail — какие шаги ответят ошибкой
 *  (fail.access — объект ошибки или 'throw'). calls — что и в каком порядке
 *  позвала функция. */
function fakeAdmin({ objects = {}, feedback = [], access = ['u1@example.com', 'u2@example.com'], email = 'U1@Example.com', fail = {} } = {}) {
  const store = Object.fromEntries(Object.entries(objects).map(([b, list]) => [b, new Set(list)]));
  const calls = [];
  const accessRows = access && new Set(access);
  const client = {
    auth: {
      getUser: async (jwt) => (jwt === 'user-token'
        ? { data: { user: { id: 'u1', email, email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }),
      admin: {
        deleteUser: async (id) => { calls.push(['deleteUser', id]); return { error: null }; },
      },
    },
    storage: {
      from(bucket) {
        const set = store[bucket] || (store[bucket] = new Set());
        return {
          list: async (prefix) => {
            calls.push(['list', bucket, prefix]);
            if (fail.list) return { data: null, error: { message: 'list failed' } };
            return { data: [...set].filter((p) => p.startsWith(`${prefix}/`)).map((p) => ({ id: p, name: p.slice(prefix.length + 1) })), error: null };
          },
          remove: async (paths) => {
            calls.push(['remove', bucket, paths.slice()]);
            if (fail.remove === bucket) return { data: null, error: { message: `remove from ${bucket} failed` } };
            if (fail.throwRemove === bucket) throw new TypeError('fetch failed');
            const gone = paths.filter((p) => set.delete(p));
            return { data: gone.map((name) => ({ name })), error: null };
          },
        };
      },
    },
    from(table) {
      if (table === 'ai_access') {
        // Только delete по email — ничего другого функции с таблицей не нужно.
        let email = null;
        const d = {
          delete() { return d; },
          eq(k, v) { assert.equal(k, 'email'); email = v; return d; },
          then(ok, bad) {
            return Promise.resolve().then(() => {
              calls.push(['delete ai_access', email]);
              if (fail.access === 'throw') throw new TypeError('error sending request for url (https://example.supabase.co/rest/v1/ai_access?email=eq.u1%40example.com)');
              if (fail.access) return { data: null, error: fail.access };
              if (!accessRows) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.ai_access' in the schema cache" } };
              accessRows.delete(email);
              return { data: null, error: null };
            }).then(ok, bad);
          },
        };
        return d;
      }
      assert.equal(table, 'feedback');
      const q = { filters: [], range: null, cols: null };
      const b = {
        select(cols) { q.cols = cols; return b; },
        eq(k, v) { q.filters.push((r) => r[k] === v); return b; },
        not(k, op, v) { assert.deepEqual([op, v], ['is', null]); q.filters.push((r) => r[k] !== null); return b; },
        range(from, to) { q.range = [from, to]; return b; },
        then(ok, bad) {
          return Promise.resolve().then(() => {
            calls.push(['select feedback', q.cols]);
            if (fail.feedback) return { data: null, error: fail.feedback };
            const rows = feedback.filter((r) => q.filters.every((f) => f(r))).slice(q.range[0], q.range[1] + 1);
            return { data: rows.map((r) => ({ screenshot_path: r.screenshot_path })), error: null };
          }).then(ok, bad);
        },
      };
      return b;
    },
  };
  return { client, store, calls, access: accessRows };
}

let loaded = null;
/** index.ts → JS без типов → модуль из data: URL; Deno.serve отдаёт обработчик. */
async function loadFunction() {
  if (loaded) return loaded;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { return null; }
  const { code } = await esbuild.transform(fs.readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const js = code.replace(/import\s*\{\s*createClient\s*\}\s*from\s*["']jsr:@supabase\/supabase-js@2["'];?/, 'const { createClient } = globalThis.__deleteAccount.supabase;');
  assert.notEqual(js, code, 'импорт supabase-js в index.ts поменялся — поправить подмену');
  const box = { db: null, handler: null };
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  globalThis.__deleteAccount = { supabase: { createClient: () => box.db.client } };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { box.handler = h; } };
  box.mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.equal(typeof box.handler, 'function', 'функция не позвала Deno.serve');
  loaded = box;
  return box;
}

/** Один вызов функции на свежей подмене; console.error — в errors. */
async function invokeOffline(t, db, token = 'user-token') {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild — npm install'); return null; }
  fn.db = db;
  const errors = [];
  const realError = console.error;
  console.error = (...a) => { errors.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try {
    const res = await fn.handler(new Request('https://example.supabase.co/functions/v1/delete-account', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    }));
    return { status: res.status, json: await res.json(), errors };
  } finally {
    console.error = realError;
  }
}

const SHOT = '0b6f3c9e-1d2a-4f5b-8c7d-9e0f1a2b3c4d.png';
const OTHER = '7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d.jpg';
const people = () => ({
  objects: { 'doc-assets': ['u1/a.png', 'u2/b.png'], feedback: [SHOT, OTHER, 'u2/secret.png'] },
  feedback: [
    { user_id: 'u1', screenshot_path: SHOT },
    { user_id: 'u1', screenshot_path: null },
    { user_id: 'u1', screenshot_path: '../doc-assets/u2/b.png' },
    { user_id: 'u1', screenshot_path: 'u2/secret.png' },
    { user_id: 'u2', screenshot_path: OTHER },
  ],
});

test('delete-account без сети: снимки обратной связи стираются до удаления — только свои и только по имени <uuid>.<тип>', async (t) => {
  const db = fakeAdmin(people());
  const r = await invokeOffline(t, db);
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { deleted: true });
  assert.deepEqual([...db.store.feedback].sort(), [OTHER, 'u2/secret.png'].sort(), 'свой снимок стёрт, чужие на месте');
  assert.deepEqual([...db.store['doc-assets']], ['u2/b.png'], 'картинки — как раньше, только своя папка');
  const shots = db.calls.filter((c) => c[0] === 'remove' && c[1] === 'feedback');
  assert.deepEqual(shots, [['remove', 'feedback', [SHOT]]], 'путь «../…» и чужая папка из своей же строки в стирание не попали');
  const order = db.calls.map((c) => c[0]);
  assert.ok(order.indexOf('select feedback') < order.indexOf('deleteUser'), 'пути берутся до удаления: потом строк уже нет (cascade)');
  assert.deepEqual(db.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']]);
  assert.deepEqual(r.errors, []);
});

test('delete-account без сети: снимки не стёрлись — аккаунт всё равно удалён, сбой — в ответе и в логе', async (t) => {
  const db = fakeAdmin({ ...people(), fail: { remove: 'feedback' } });
  const r = await invokeOffline(t, db);
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { deleted: true, screenshots: 'remain', detail: 'remove from feedback failed' });
  assert.deepEqual(db.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /feedback screenshots remain/);
  assert.ok(r.errors[0].includes(SHOT), 'в логе — какие пути остались, чтобы стереть руками');
  assert.ok(!r.errors[0].includes('u1'), 'uid в лог не пишется');

  // Строки не прочитались — то же самое.
  const db2 = fakeAdmin({ ...people(), fail: { feedback: { code: '57014', message: 'canceling statement due to statement timeout' } } });
  const r2 = await invokeOffline(t, db2);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.screenshots, 'remain');
  assert.deepEqual(db2.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']]);

  // Хранилище не ответило вовсе (исключение, а не ошибка в ответе) — тоже.
  const db3 = fakeAdmin({ ...people(), fail: { throwRemove: 'feedback' } });
  const r3 = await invokeOffline(t, db3);
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.json, { deleted: true, screenshots: 'remain', detail: 'fetch failed' });
  assert.deepEqual(db3.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']]);
});

test('delete-account без сети: removeScreenshots листает строки страницами по 1000 и не стирает одно имя дважды', async (t) => {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild'); return; }
  const { removeScreenshots } = fn.mod;
  const names = Array.from({ length: 2300 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000.webp`);
  const db = fakeAdmin({
    objects: { feedback: names },
    feedback: [...names, names[0], names[1]].map((p) => ({ user_id: 'u1', screenshot_path: p })),
  });
  assert.equal(await removeScreenshots(db.client, 'u1'), null);
  assert.equal(db.store.feedback.size, 0, 'стёрты все 2300');
  assert.equal(db.calls.filter((c) => c[0] === 'select feedback').length, 3, 'строки — тремя страницами');
  const removed = db.calls.filter((c) => c[0] === 'remove').flatMap((c) => c[2]);
  assert.equal(removed.length, 2300, 'повтор имени в двух строках — одно стирание');
  assert.ok(db.calls.filter((c) => c[0] === 'remove').every((c) => c[2].length <= 1000), 'стирание — пачками по 1000');
});

test('delete-account без сети: таблицы feedback ещё нет — удаление как раньше; картинки не стёрлись — 409, снимки и аккаунт целы', async (t) => {
  const db = fakeAdmin({ ...people(), fail: { feedback: { code: 'PGRST205', message: "Could not find the table 'public.feedback' in the schema cache" } } });
  const r = await invokeOffline(t, db);
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { deleted: true }, 'feedback.sql не выполнен — стирать нечего, это не сбой');
  assert.deepEqual(r.errors, []);

  const db2 = fakeAdmin({ ...people(), fail: { list: true } });
  const r2 = await invokeOffline(t, db2);
  assert.equal(r2.status, 409);
  assert.equal(r2.json.error, 'assets remain');
  assert.ok(db2.store.feedback.has(SHOT), 'аккаунт остаётся — и снимок вместе с ним');
  assert.equal(db2.calls.filter((c) => c[0] === 'deleteUser').length, 0);

  const anon = await invokeOffline(t, fakeAdmin(people()), 'not-a-user');
  assert.equal(anon.status, 401);
});

// 21 октября 2026: агент — по приглашению (supabase/ai-access.sql). Строка
// ai_access — почта и пометка — ссылки на auth.users не имеет и каскадом не
// уходит; её стирает функция.
test('delete-account без сети: строка ai_access с почтой удаляемого стирается до удаления — по нижнему регистру, чужие на месте', async (t) => {
  const db = fakeAdmin(people());
  const r = await invokeOffline(t, db);
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { deleted: true });
  assert.deepEqual(db.calls.filter((c) => c[0] === 'delete ai_access'), [['delete ai_access', 'u1@example.com']], 'почта входа «U1@Example.com» — в нижнем регистре, как в таблице');
  assert.deepEqual([...db.access], ['u2@example.com'], 'своя строка стёрта, чужая на месте');
  const order = db.calls.map((c) => c[0]);
  assert.ok(order.indexOf('delete ai_access') < order.indexOf('deleteUser'), 'строка стирается до удаления пользователя');
  assert.deepEqual(r.errors, []);

  // Доступа не было — стирать нечего, это не сбой.
  const none = fakeAdmin({ ...people(), access: ['u2@example.com'] });
  const r2 = await invokeOffline(t, none);
  assert.deepEqual(r2.json, { deleted: true });
  assert.deepEqual(r2.errors, []);
});

test('delete-account без сети: таблицы ai_access нет — удаление как раньше; сбой стирания удаление не держит, в логе — код без почты и uid', async (t) => {
  const db = fakeAdmin({ ...people(), access: null });
  const r = await invokeOffline(t, db);
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { deleted: true }, 'ai-access.sql не выполнен — стирать нечего');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(db.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']]);

  for (const [name, fail, code] of [
    ['таймаут', { code: '57014', message: 'canceling statement due to statement timeout for u1@example.com' }, '57014'],
    ['сеть — исключение с адресом запроса', 'throw', 'TypeError'],
  ]) {
    const bad = fakeAdmin({ ...people(), fail: { access: fail } });
    const rb = await invokeOffline(t, bad);
    assert.equal(rb.status, 200, name);
    assert.deepEqual(rb.json, { deleted: true, access: 'remain' }, `${name}: аккаунт удалён, сбой — в ответе`);
    assert.deepEqual(bad.calls.filter((c) => c[0] === 'deleteUser'), [['deleteUser', 'u1']], `${name}: удаление не задержано`);
    assert.equal(rb.errors.length, 1, name);
    assert.match(rb.errors[0], new RegExp(`ai_access row remains.*${code}`), name);
    assert.doesNotMatch(rb.errors[0], /u1@example\.com|u1%40|\bu1\b/i, `${name}: в логе нет почты и uid`);
  }

  // Снимки и доступ не стёрлись оба — оба в ответе.
  const both = fakeAdmin({ ...people(), fail: { remove: 'feedback', access: { code: '57014', message: 'timeout' } } });
  const rboth = await invokeOffline(t, both);
  assert.deepEqual(rboth.json, { deleted: true, screenshots: 'remain', detail: 'remove from feedback failed', access: 'remain' });
});

// --- выложенная функция ------------------------------------------------------

const created = [];

test.after(async () => {
  // Кого не удалила функция — старым путём (папка, потом delete_my_account).
  for (const u of created.filter((x) => x.alive)) {
    const list = await call('POST', `/storage/v1/object/list/${BUCKET}`, { token: u.token, body: { prefix: u.id, limit: 1000 } });
    const paths = (list.json || []).filter((o) => o.id).map((o) => `${u.id}/${o.name}`);
    if (paths.length) await call('DELETE', `/storage/v1/object/${BUCKET}`, { token: u.token, body: { prefixes: paths } });
    const r = await call('POST', '/rest/v1/rpc/delete_my_account', { token: u.token, body: {} });
    if (!r.ok) console.error(`не удалось убрать тестового пользователя ${u.id}: ${r.status} ${r.text.slice(0, 200)}`);
  }
});

test('delete-account удаляет вызывающего вместе с картинками и только его', async (t) => {
  const probe = await deleteAccount(null);
  if (probe.status === 404) {
    t.todo('функция delete-account не выложена — supabase/functions/README.md');
    return;
  }
  assert.equal(probe.status, 401, `без входа ждали 401, получили ${probe.status}: ${probe.text.slice(0, 200)}`);

  if (process.env.LANCIBLE_ACCOUNT_TEST !== '1') {
    t.todo('живая часть заводит настоящих пользователей — запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend');
    return;
  }

  const signUp = async (tag) => {
    const email = `lancible-test-${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const r = await call('POST', '/auth/v1/signup', { body: { email, password: `T-${Math.random().toString(36)}-9z!` } });
    assert.ok(r.ok && r.json && r.json.access_token, `регистрация не удалась: ${r.status} ${r.text.slice(0, 200)}`);
    const u = { token: r.json.access_token, id: r.json.user.id, email, alive: true };
    created.push(u);
    return u;
  };
  const upload = (u, name) => call('POST', `/storage/v1/object/${BUCKET}/${u.id}/${name}`, { token: u.token, body: PNG, type: 'image/png' });
  const listOwn = async (u) => {
    const r = await call('POST', `/storage/v1/object/list/${BUCKET}`, { token: u.token, body: { prefix: u.id, limit: 1000 } });
    assert.ok(r.ok, `список не прочитался: ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.filter((o) => o.id).length;
  };

  const a = await signUp('a');
  const b = await signUp('b');
  for (const u of [a, b]) {
    for (const name of ['one.png', 'two.png']) assert.ok((await upload(u, name)).ok, 'загрузка в свою папку не прошла');
    assert.equal(await listOwn(u), 2);
  }

  // Доступ к агенту обоим (ai_access, служебным ключом): строка A уходит с
  // аккаунтом — функцией или триггером ai_access_forget, — строка B остаётся.
  // Нет ключа или таблицы (ai-access.sql не выполнен) — эта часть молчит.
  const key = serviceKey();
  const admin = key && { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const accessRows = async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_access?select=email&email=in.(${[a, b].map((u) => `"${u.email}"`).join(',')})`, { headers: admin });
    return r.ok ? (await r.json()).map((x) => x.email).sort() : null;
  };
  let granted = false;
  if (admin) {
    const g = await fetch(`${SUPABASE_URL}/rest/v1/ai_access`, { method: 'POST', headers: { ...admin, Prefer: 'return=minimal' }, body: JSON.stringify([a, b].map((u) => ({ email: u.email, note: 'временный пользователь account-delete-function.test.js' }))) });
    granted = g.ok;
  }

  try {
    const done = await deleteAccount(a.token);
    assert.equal(done.status, 200, `удаление не прошло: ${done.status} ${done.text.slice(0, 200)}`);
    assert.deepEqual(done.json, { deleted: true });
    a.alive = false;

    assert.equal((await deleteAccount(a.token)).status, 401, 'токен удалённого пользователя всё ещё годится');
    assert.equal(await listOwn(b), 2, 'удаление A задело картинки B');
    if (granted) assert.deepEqual(await accessRows(), [b.email], 'строка доступа A не ушла вместе с аккаунтом, или задета строка B');
  } finally {
    if (granted) await fetch(`${SUPABASE_URL}/rest/v1/ai_access?email=in.(${[a, b].map((u) => `"${u.email}"`).join(',')})`, { method: 'DELETE', headers: admin });
  }

  if (key) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: a.id, limit: 1000 }),
    });
    assert.deepEqual((await r.json()).filter((o) => o.id), [], 'в папке удалённого A остались картинки');
  }
});

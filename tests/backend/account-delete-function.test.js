/* Удаление аккаунта на сервере — Edge Function delete-account
 * (supabase/functions/delete-account). Запуск: npm run test:backend
 *
 * Функция одним вызовом стирает doc-assets/<uid>/ вызывающего и удаляет его
 * аккаунт. Тест проверяет:
 *   - без входа (ключ anon) — 401, никого не удаляет;
 *   - вызывающий удаляется вместе с картинками, его токен больше не годится;
 *   - второго пользователя и его картинки это не задевает.
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
    const u = { token: r.json.access_token, id: r.json.user.id, alive: true };
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

  const done = await deleteAccount(a.token);
  assert.equal(done.status, 200, `удаление не прошло: ${done.status} ${done.text.slice(0, 200)}`);
  assert.deepEqual(done.json, { deleted: true });
  a.alive = false;

  assert.equal((await deleteAccount(a.token)).status, 401, 'токен удалённого пользователя всё ещё годится');
  assert.equal(await listOwn(b), 2, 'удаление A задело картинки B');

  const key = serviceKey();
  if (key) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: a.id, limit: 1000 }),
    });
    assert.deepEqual((await r.json()).filter((o) => o.id), [], 'в папке удалённого A остались картинки');
  }
});

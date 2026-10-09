/* Удаление аккаунта стирает его картинки. Запуск: npm run test:backend
 *
 * Обещание Политики (§6, /delete-account): удаляем всё и сразу. Строки в
 * таблицах уходят каскадом, а байты картинок лежат в хранилище doc-assets,
 * и стереть их может только Storage API. Порядок (supabase/storage.sql):
 * клиент стирает свою папку <uid>/, потом зовёт delete_my_account(); страж
 * в базе не даёт удалить аккаунт, пока в папке что-то лежит.
 *
 * Тест проходит этот путь как клиент: заводит двух временных пользователей
 * (регистрация подтверждается сама, письма не нужны), кладёт каждому по
 * файлу и проверяет:
 *   - чужую папку стереть нельзя;
 *   - аккаунт с файлами не удаляется;
 *   - после стирания своей папки аккаунт удаляется, и в папке ничего нет.
 * Кого не удалил сам тест, удаляет after() тем же путём.
 *
 * Пока страж не выполнен в базе (нет функции my_asset_count), тест не создаёт
 * никого и помечается todo: без стража удаление аккаунта с файлом оставило бы
 * в боевом хранилище сироту.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
const BUCKET = 'doc-assets';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const headers = (token, extra) => ({ apikey: ANON, Authorization: `Bearer ${token || ANON}`, ...extra });

async function call(method, path, { token, body, type = 'application/json' } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: headers(token, body !== undefined ? { 'Content-Type': type } : {}),
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, ok: res.ok, text, json };
}

const rpc = (name, token) => call('POST', `/rest/v1/rpc/${name}`, { token, body: {} });

async function signUp(tag) {
  const email = `lancible-test-${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const r = await call('POST', '/auth/v1/signup', { body: { email, password: `T-${Math.random().toString(36)}-9z!` } });
  assert.ok(r.ok && r.json && r.json.access_token, `регистрация не удалась: ${r.status} ${r.text.slice(0, 200)}`);
  return { token: r.json.access_token, id: r.json.user.id, alive: true };
}

const upload = (u, folder, name) => call('POST', `/storage/v1/object/${BUCKET}/${folder}/${name}`,
  { token: u.token, body: PNG, type: 'image/png' });

async function list(u, folder) {
  const r = await call('POST', `/storage/v1/object/list/${BUCKET}`, { token: u.token, body: { prefix: folder, limit: 1000 } });
  assert.ok(r.ok, `список не прочитался: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.filter((o) => o.id).map((o) => `${folder}/${o.name}`);
}

const removeObjects = (u, paths) => call('DELETE', `/storage/v1/object/${BUCKET}`, { token: u.token, body: { prefixes: paths } });

/** Шаг 1 контракта: стереть всё в своей папке, пока список не опустеет. */
async function purgeOwn(u) {
  for (;;) {
    const paths = await list(u, u.id);
    if (!paths.length) return;
    const r = await removeObjects(u, paths);
    assert.ok(r.ok, `стереть свою папку не вышло: ${r.status} ${r.text.slice(0, 200)}`);
  }
}

async function count(u) {
  const r = await rpc('my_asset_count', u.token);
  assert.equal(r.status, 200, `my_asset_count: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
}

const created = [];

test.after(async () => {
  for (const u of created.filter((x) => x.alive)) {
    try {
      await purgeOwn(u);
      const r = await rpc('delete_my_account', u.token);
      if (r.ok) u.alive = false;
      else console.error(`не удалось убрать тестового пользователя ${u.id}: ${r.status} ${r.text.slice(0, 200)}`);
    } catch (err) {
      console.error(`не удалось убрать тестового пользователя ${u.id}: ${err.message}`);
    }
  }
});

test('удаление аккаунта стирает его картинки, чужую папку стереть нельзя', async (t) => {
  // Есть ли страж в базе. Аноним получает 42501, если функция есть, и
  // PGRST202, если storage.sql с ней ещё не выполнен.
  const probe = await rpc('my_asset_count');
  if (probe.json && probe.json.code === 'PGRST202') {
    t.todo('страж удаления не выполнен в базе: выполните supabase/storage.sql целиком в SQL Editor');
    return;
  }
  assert.equal(probe.json && probe.json.code, '42501', `аноним не должен звать my_asset_count: ${probe.status} ${probe.text.slice(0, 200)}`);

  const a = await signUp('a');
  created.push(a);
  const b = await signUp('b');
  created.push(b);

  for (const u of [a, b]) {
    const r = await upload(u, u.id, 'probe.png');
    assert.ok(r.ok, `загрузка в свою папку не прошла: ${r.status} ${r.text.slice(0, 200)}`);
    assert.equal(await count(u), 1);
  }

  // Чужую папку стереть нельзя: запрос не падает, но политика его не пускает.
  await removeObjects(a, [`${b.id}/probe.png`]);
  assert.equal(await count(b), 1, 'A стёр файл из папки B');
  assert.equal((await upload(a, b.id, 'intruder.png')).ok, false, 'A положил файл в папку B');

  // Аккаунт с файлами не удаляется — громкий отказ, а не сирота в хранилище.
  const refused = await rpc('delete_my_account', a.token);
  assert.equal(refused.ok, false, 'аккаунт с файлами удалился — страж не сработал');
  assert.match(refused.text, /account assets remain/);
  assert.equal(await count(a), 1, 'после отказа аккаунт и файл на месте');

  // Контракт клиента: стереть свою папку, потом удалить аккаунт.
  await purgeOwn(a);
  assert.equal(await count(a), 0, 'в папке A что-то осталось после стирания');
  const done = await rpc('delete_my_account', a.token);
  assert.ok(done.ok, `аккаунт без файлов не удалился: ${done.status} ${done.text.slice(0, 200)}`);
  a.alive = false;

  // B не задело: его файл на месте.
  assert.equal(await count(b), 1, 'удаление A задело файлы B');
});

/* Редакция условий в профиле не откатывается назад (supabase/consent.sql).
 * Запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend
 *
 * Старые установленные клиенты (десктоп 0.4.0, телефон 1.2.1) знают только
 * редакцию 2026-10-07 и переписывают ею профиль того, кто уже принял
 * 2026-10-10 в другом клиенте. Тест повторяет оба пути записи согласия —
 * upsert (онбординг) и update (повторное согласие) — на временном
 * пользователе и проверяет, что более новая редакция и время её принятия
 * сохраняются, а ещё более новая записывается как обычно.
 *
 * Живая часть заводит настоящего пользователя в боевой базе — только по
 * явному запросу (LANCIBLE_ACCOUNT_TEST=1; в GitHub — ручной запуск), как и
 * account-assets.test.js. Пользователя тест удаляет за собой.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';

async function call(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token || ANON}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, ok: res.ok, text, json };
}

const NEW = { terms_version: '2026-10-10', terms_accepted_at: '2026-10-10T09:00:00.000Z', age_confirmed: true };
const OLD = { terms_version: '2026-10-07', terms_accepted_at: '2026-10-10T12:00:00.000Z', age_confirmed: true };
const NEWER = { terms_version: '2026-11-01', terms_accepted_at: '2026-11-01T09:00:00.000Z', age_confirmed: true };

let user = null;

test.after(async () => {
  if (!user) return;
  const r = await call('POST', '/rest/v1/rpc/delete_my_account', { token: user.token, body: {} });
  if (!r.ok) console.error(`не удалось убрать тестового пользователя ${user.id}: ${r.status} ${r.text.slice(0, 200)}`);
});

test('редакция в профиле не уменьшается, новая — записывается', async (t) => {
  if (process.env.LANCIBLE_ACCOUNT_TEST !== '1') {
    t.todo('живая часть заводит настоящего пользователя — запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend');
    return;
  }

  const email = `lancible-test-${Date.now()}-consent-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const s = await call('POST', '/auth/v1/signup', { body: { email, password: `T-${Math.random().toString(36)}-9z!` } });
  assert.ok(s.ok && s.json && s.json.access_token, `регистрация не удалась: ${s.status} ${s.text.slice(0, 200)}`);
  user = { token: s.json.access_token, id: s.json.user.id };

  const read = async () => {
    const r = await call('GET', `/rest/v1/profiles?select=terms_version,terms_accepted_at&id=eq.${user.id}`, { token: user.token });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    return { version: r.json[0].terms_version, at: new Date(r.json[0].terms_accepted_at).toISOString() };
  };
  const upsert = (fields) => call('POST', '/rest/v1/profiles', {
    token: user.token, body: [{ id: user.id, ...fields }], prefer: 'resolution=merge-duplicates,return=minimal',
  });
  const update = (fields) => call('PATCH', `/rest/v1/profiles?id=eq.${user.id}`, { token: user.token, body: fields, prefer: 'return=minimal' });

  assert.ok((await upsert(NEW)).ok, 'онбординг с новой редакцией не записался');
  assert.deepEqual(await read(), { version: NEW.terms_version, at: NEW.terms_accepted_at });

  // Старый клиент переспросил и пишет свою редакцию — обоими путями.
  const hint = 'редакция откатилась — выполните supabase/consent.sql в SQL Editor';
  assert.ok((await update(OLD)).ok);
  assert.deepEqual(await read(), { version: NEW.terms_version, at: NEW.terms_accepted_at }, `update: ${hint}`);
  assert.ok((await upsert(OLD)).ok);
  assert.deepEqual(await read(), { version: NEW.terms_version, at: NEW.terms_accepted_at }, `upsert: ${hint}`);

  // Ещё более новая редакция записывается как обычно.
  assert.ok((await update(NEWER)).ok);
  assert.deepEqual(await read(), { version: NEWER.terms_version, at: NEWER.terms_accepted_at });

  // Мусор поверх даты не проходит: «zzzz» строкой больше любой даты.
  assert.ok((await update({ ...OLD, terms_version: 'zzzz' })).ok);
  assert.deepEqual(await read(), { version: NEWER.terms_version, at: NEWER.terms_accepted_at }, 'мусор перезаписал редакцию');
});

test('записанный мусор защиты не получает — его исправляет любая дата', async (t) => {
  if (process.env.LANCIBLE_ACCOUNT_TEST !== '1' || !user) {
    t.todo('идёт после первого теста, по LANCIBLE_ACCOUNT_TEST=1');
    return;
  }
  // Поверх даты мусор не записать (это проверено выше), поэтому профиль
  // заводится заново: вставка триггер не зовёт, и мусор ложится как есть —
  // так он мог оказаться в профиле до стража.
  const patch = (fields) => call('PATCH', `/rest/v1/profiles?id=eq.${user.id}`, { token: user.token, body: fields, prefer: 'return=minimal' });
  const get = async () => (await call('GET', `/rest/v1/profiles?select=terms_version&id=eq.${user.id}`, { token: user.token })).json[0].terms_version;
  await call('DELETE', `/rest/v1/profiles?id=eq.${user.id}`, { token: user.token });
  assert.ok((await call('POST', '/rest/v1/profiles', { token: user.token, body: [{ id: user.id, terms_version: 'v2' }], prefer: 'return=minimal' })).ok);
  assert.equal(await get(), 'v2');
  // ...и записанный мусор исправляется даже более старой датой.
  assert.ok((await patch(OLD)).ok);
  assert.equal(await get(), OLD.terms_version, 'записанный мусор держится — клиент переспрашивал бы по кругу');
});

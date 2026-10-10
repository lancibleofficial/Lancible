/* Редакция условий в профиле не откатывается, время ставит сервер
 * (supabase/consent.sql). Запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend
 *
 * Старые установленные клиенты (десктоп 0.4.0, телефон 1.2.1) знают только
 * редакцию 2026-10-07 и переписывают ею профиль того, кто уже принял
 * 2026-10-10 в другом клиенте. Тест повторяет оба пути записи согласия —
 * upsert (онбординг) и update (повторное согласие) — на временном
 * пользователе и проверяет:
 *   - более новая редакция и время её принятия не откатываются;
 *   - время принятия ставит сервер, а не присланные часы устройства;
 *   - мусор и будущая дата поверх редакции не проходят;
 *   - записанный мусор или будущая дата исправляются любой редакцией.
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

// Редакции только в прошлом: будущая дата редакцией не считается.
const OLDER = '2026-01-01';
const NEW = '2026-02-01';
const NEWER = '2026-03-01';
const FAKE_AT = '2000-01-01T00:00:00.000Z'; // «часы устройства» — сервер их не берёт
const HINT = 'выполните supabase/consent.sql в SQL Editor';

let user = null;

test.after(async () => {
  if (!user) return;
  const r = await call('POST', '/rest/v1/rpc/delete_my_account', { token: user.token, body: {} });
  if (!r.ok) console.error(`не удалось убрать тестового пользователя ${user.id}: ${r.status} ${r.text.slice(0, 200)}`);
});

test('редакция не откатывается, время ставит сервер, мусор не проходит', async (t) => {
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
    return { version: r.json[0].terms_version, at: r.json[0].terms_accepted_at && Date.parse(r.json[0].terms_accepted_at) };
  };
  const consent = (version) => ({ terms_version: version, terms_accepted_at: FAKE_AT, age_confirmed: true });
  const upsert = (fields) => call('POST', '/rest/v1/profiles', {
    token: user.token, body: [{ id: user.id, ...fields }], prefer: 'resolution=merge-duplicates,return=minimal',
  });
  const update = (fields) => call('PATCH', `/rest/v1/profiles?id=eq.${user.id}`, { token: user.token, body: fields, prefer: 'return=minimal' });
  const serverNow = (at, from) => at >= from - 60000 && at <= Date.now() + 60000; // минута на расхождение часов

  // Онбординг (вставка): время — серверное, не присланное.
  let from = Date.now();
  assert.ok((await upsert(consent(NEW))).ok, 'онбординг не записался');
  const first = await read();
  assert.equal(first.version, NEW);
  assert.ok(serverNow(first.at, from), `время принятия взято с устройства — ${HINT}`);

  // Старый клиент переспросил и пишет свою редакцию — обоими путями.
  for (const [how, write] of [['update', update], ['upsert', upsert]]) {
    assert.ok((await write(consent(OLDER))).ok);
    assert.deepEqual(await read(), first, `${how}: редакция откатилась — ${HINT}`);
  }

  // Повторное согласие с той же редакцией не сдвигает время первого.
  assert.ok((await update(consent(NEW))).ok);
  assert.deepEqual(await read(), first, 'та же редакция сдвинула время принятия');

  // Мусор и будущая дата поверх редакции не проходят.
  for (const junk of ['zzzz', '9999-12-31', null]) {
    assert.ok((await update(consent(junk))).ok);
    assert.deepEqual(await read(), first, `«${junk}» перезаписал редакцию`);
  }

  // Более новая редакция записывается, время — снова серверное.
  from = Date.now();
  assert.ok((await update(consent(NEWER))).ok);
  const next = await read();
  assert.equal(next.version, NEWER);
  assert.ok(serverNow(next.at, from), 'время новой редакции взято с устройства');

  // Часовой пояс: сервер считает по UTC, а редакцию датируем по своему дню.
  // Завтра по UTC — ещё редакция (выпущена до полуночи UTC), послезавтра — нет.
  const utcDay = (shift) => new Date(Date.now() + shift * 86400000).toISOString().slice(0, 10);
  assert.ok((await update(consent(utcDay(1)))).ok);
  const tomorrow = await read();
  assert.equal(tomorrow.version, utcDay(1), 'редакция «завтра по UTC» отброшена — допуск на часовой пояс не работает');
  assert.ok((await update(consent(utcDay(3)))).ok);
  assert.deepEqual(await read(), tomorrow, 'дата через три дня принята за редакцию');

  // Записанные до стража мусор или будущая дата защиты не получают.
  // Поверх редакции их не записать (проверено выше), поэтому профиль
  // заводится заново — так они могли оказаться в нём до стража.
  for (const junk of ['v2', '9999-12-31']) {
    await call('DELETE', `/rest/v1/profiles?id=eq.${user.id}`, { token: user.token });
    assert.ok((await upsert({ terms_version: junk, terms_accepted_at: FAKE_AT })).ok);
    assert.equal((await read()).at, null, `при «${junk}» осталось время принятия без принятой редакции`);
    assert.ok((await update(consent(OLDER))).ok);
    assert.equal((await read()).version, OLDER, `записанный «${junk}» держится — клиент переспрашивал бы по кругу`);
  }
});

/* Права доступа к журналу правок — таблицы changes и snapshots
 * (supabase/sync2.sql). Запуск: npm run test:backend
 *
 * Журнал — то, на чём держится «синхронизация без потерь»: сервер только
 * дописывает, ничего не меняет и не стирает. Ключ anon открыт, своего
 * сервера у нас нет, поэтому проверяется ровно то, что обещают политики и
 * триггеры:
 *   - чужое не читается и не пишется (42501 — отказ политики, а не 23503:
 *     внешний ключ не должен быть первой линией защиты);
 *   - своё дописывается, но не меняется и не удаляется (42501);
 *   - повтор op_id отбивается (23505), а с ignore-duplicates — молча:
 *     так клиент повторяет отправку после обрыва;
 *   - будущее время режется до now() + 5 минут, base_seq — до последнего
 *     своего seq, seq и created_at ставит сервер;
 *   - слепок не забегает вперёд журнала (23514).
 *
 * Пока supabase/sync2.sql не выполнен, таблиц нет (PGRST205 / 42P01, ответ
 * 404) — тесты помечаются todo, как у feedback и ai-chat: проверять ещё нечего.
 *
 * Части без входа (аноним) хватает ключа anon. Части «свои строки» нужен
 * настоящий пользователь в боевой базе — только по явному запросу
 * (LANCIBLE_ACCOUNT_TEST=1), как consent-guard.test.js. Временные строки
 * убираются в конце служебным ключом из .env.local (значение не
 * печатается), пользователи — delete_my_account (строки уходят каскадом).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
const NOWHERE_UUID = '00000000-0000-4000-8000-000000000001'; // такого пользователя нет и быть не может
const PROBE_DEVICE = 'zz-rls-probe';
const HINT = 'выполните supabase/sync2.sql в SQL Editor';
const MIN = 60000;

/** Служебный ключ — только локально, из .env.local; в CI его нет. */
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') || null : null;
  } catch { return null; }
}

async function call(method, urlPath, { token, key, body, prefer } = {}) {
  const auth = key || token || ANON;
  const headers = { apikey: key || ANON, Authorization: `Bearer ${auth}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* пусто или не JSON */ }
  return { status: res.status, ok: res.ok, text, json, code: json && json.code };
}

/** Строка журнала, как её шлёт клиент (core/oplog.js, opToRow). */
const row = (extra) => Object.assign({
  op_id: crypto.randomUUID(),
  device_id: PROBE_DEVICE,
  entity: 'task',
  entity_id: 'zz-probe-task',
  field: 'title',
  value: 'проверка прав',
  at: new Date().toISOString(),
  base_seq: 0,
}, extra);

/** Есть ли таблицы: null — нет сети; false — sync2.sql ещё не выполнен. */
let probe = null;
async function ready(t) {
  if (!probe) {
    probe = Promise.all([
      call('GET', '/rest/v1/changes?select=seq&limit=1'),
      call('GET', '/rest/v1/snapshots?select=seq&limit=1'),
    ]).then((rs) => ({ net: true, ready: rs.every((r) => !(r.status === 404 || r.code === 'PGRST205' || r.code === '42P01')) }))
      .catch((e) => ({ net: false, error: e }));
  }
  const p = await probe;
  if (!p.net) { t.todo(`нет сети до Supabase: ${p.error.message}`); return false; }
  if (!p.ready) { t.todo(`таблиц changes и snapshots нет — ${HINT}`); return false; }
  return true;
}

/** Отказ: 42501 или «ноль строк» (права есть, строк роли не видно). */
function refused(r, what) {
  if (r.code === '42501') return;
  assert.ok(r.ok, `${what}: ${r.status} ${r.code} ${r.text.slice(0, 200)}`);
  assert.deepEqual(r.json, [], `${what}: изменены строки журнала — ${r.text.slice(0, 200)}`);
}

const users = []; // { id, token } — временные пользователи

test.after(async () => {
  const key = serviceKey();
  if (key && users.length) {
    // Сначала строки журнала — служебным ключом, потом сами пользователи.
    const ids = users.map((u) => u.id).join(',');
    for (const table of ['changes', 'snapshots']) {
      const r = await call('DELETE', `/rest/v1/${table}?user_id=in.(${ids})`, { key });
      if (!r.ok) console.error(`не удалось убрать проверочные строки ${table}: ${r.status}`);
    }
  } else if (users.length) {
    console.error('служебного ключа нет — строки журнала уйдут каскадом вместе с пользователями');
  }
  for (const u of users) {
    const r = await call('POST', '/rest/v1/rpc/delete_my_account', { token: u.token, body: {} });
    if (!r.ok) console.error(`не удалось убрать тестового пользователя ${u.id}: ${r.status} ${r.text.slice(0, 200)}`);
  }
});

// ---------------------------------------------------------------------------
// Аноним
// ---------------------------------------------------------------------------

test('аноним не видит чужой журнал и чужие слепки', async (t) => {
  if (!(await ready(t))) return;
  for (const table of ['changes', 'snapshots']) {
    const r = await call('GET', `/rest/v1/${table}?select=user_id&limit=5`);
    if (r.code === '42501') continue; // прав на чтение нет вовсе — тоже закрыто
    assert.equal(r.status, 200, `${table}: ${r.status} ${r.text.slice(0, 200)}`);
    assert.deepEqual(r.json, [], `аноним получил строки ${table}`);
  }
});

test('аноним не может дописать в чужой журнал и положить чужой слепок', async (t) => {
  if (!(await ready(t))) return;
  const a = await call('POST', '/rest/v1/changes', { body: [row({ user_id: NOWHERE_UUID })], prefer: 'return=minimal' });
  assert.notEqual(a.code, '23503', 'политика пропустила запись — дело дошло до внешнего ключа');
  assert.equal(a.code, '42501', `changes: ждали отказ политики, получили ${a.status} ${a.code}: ${a.text.slice(0, 200)}`);
  const s = await call('POST', '/rest/v1/snapshots', { body: [{ user_id: NOWHERE_UUID, seq: 0, data: {} }], prefer: 'return=minimal' });
  assert.notEqual(s.code, '23503', 'политика пропустила слепок — дело дошло до внешнего ключа');
  assert.equal(s.code, '42501', `snapshots: ждали отказ политики, получили ${s.status} ${s.code}: ${s.text.slice(0, 200)}`);
});

test('аноним не может менять и удалять журнал', async (t) => {
  if (!(await ready(t))) return;
  refused(await call('PATCH', '/rest/v1/changes?entity=eq.task', { body: { value: 'подменено' }, prefer: 'return=representation' }), 'update');
  refused(await call('DELETE', '/rest/v1/changes?entity=eq.task', { prefer: 'return=representation' }), 'delete');
  refused(await call('DELETE', '/rest/v1/snapshots?seq=gte.0', { prefer: 'return=representation' }), 'delete слепков');
});

test('у sync_state есть mirror_seq — мост к старым клиентам', async (t) => {
  if (!(await ready(t))) return;
  const r = await call('GET', '/rest/v1/sync_state?select=mirror_seq&limit=1');
  assert.equal(r.status, 200, `колонки mirror_seq нет: ${r.status} ${r.code} — ${HINT}`);
});

// ---------------------------------------------------------------------------
// Свои строки — на временном пользователе
// ---------------------------------------------------------------------------

async function signUp(tag) {
  const email = `lancible-test-${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const s = await call('POST', '/auth/v1/signup', { body: { email, password: `T-${Math.random().toString(36)}-9z!` } });
  assert.ok(s.ok && s.json && s.json.access_token, `регистрация не удалась: ${s.status} ${s.text.slice(0, 200)}`);
  const u = { token: s.json.access_token, id: s.json.user.id };
  users.push(u);
  return u;
}

const insert = (u, rows, prefer, query) => call('POST', `/rest/v1/changes${query || ''}`, { token: u.token, body: rows, prefer: prefer || 'return=representation' });

test('свой журнал: дописывается, сервер ставит seq и время, повтор отбит, менять и удалять нельзя', async (t) => {
  if (!(await ready(t))) return;
  if (process.env.LANCIBLE_ACCOUNT_TEST !== '1') {
    t.todo('живая часть заводит настоящего пользователя — запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend');
    return;
  }
  const me = await signUp('sync2');
  const from = Date.now();

  // Своя строка — без user_id (default auth.uid()) и с ним.
  const first = row({ at: '2000-01-01T00:00:00.000Z', base_seq: 0 });
  const r1 = await insert(me, [first]);
  assert.equal(r1.status, 201, `своя строка не легла: ${r1.status} ${r1.code} ${r1.text.slice(0, 200)}`);
  const got1 = r1.json[0];
  assert.equal(got1.user_id, me.id);
  assert.ok(Number(got1.seq) > 0, 'seq не выдан');
  assert.ok(Date.parse(got1.created_at) >= from - MIN, 'created_at — не время сервера');
  assert.equal(Date.parse(got1.at), Date.parse(first.at), 'прошлое время правки тронуто');

  // Будущее — режется; base_seq впереди журнала — тоже; seq клиента не берётся.
  const future = row({ user_id: me.id, at: new Date(Date.now() + 3 * 86400000).toISOString(), base_seq: 999999999999, seq: 1 });
  const r2 = await insert(me, [future]);
  assert.equal(r2.status, 201, r2.text.slice(0, 200));
  const got2 = r2.json[0];
  assert.ok(Date.parse(got2.at) <= Date.now() + 6 * MIN, `будущее время не обрезано: ${got2.at} — ${HINT}`);
  assert.ok(Number(got2.base_seq) <= Number(got1.seq), `base_seq впереди журнала: ${got2.base_seq}`);
  assert.ok(Number(got2.seq) > Number(got1.seq), 'seq не вырос или взят у клиента');

  // Повтор op_id: прямо — 23505; с ignore-duplicates — молча, без строки.
  const dup = await insert(me, [Object.assign({}, first, { value: 'повтор' })]);
  assert.equal(dup.code, '23505', `повтор op_id прошёл: ${dup.status} ${dup.code} ${dup.text.slice(0, 200)}`);
  const quiet = await insert(me, [Object.assign({}, first, { value: 'повтор' })], 'resolution=ignore-duplicates,return=representation', '?on_conflict=user_id,op_id');
  assert.ok(quiet.ok, `повтор с ignore-duplicates упал: ${quiet.status} ${quiet.code} ${quiet.text.slice(0, 200)}`);
  assert.deepEqual(quiet.json, [], 'повтор с ignore-duplicates записал строку');

  // Чтение по протоколу клиента — своё, по порядку seq.
  const read = await call('GET', `/rest/v1/changes?select=seq,op_id,value&seq=gt.0&order=seq`, { token: me.token });
  assert.deepEqual(read.json.map((x) => x.op_id), [first.op_id, future.op_id]);
  assert.equal(read.json[0].value, 'проверка прав', 'повтор подменил значение');

  // Журнал только дописывается.
  for (const [what, r] of [
    ['update своей', await call('PATCH', `/rest/v1/changes?op_id=eq.${first.op_id}`, { token: me.token, body: { value: 'подменено' }, prefer: 'return=representation' })],
    ['delete своей', await call('DELETE', `/rest/v1/changes?op_id=eq.${first.op_id}`, { token: me.token, prefer: 'return=representation' })],
    ['upsert поверх', await insert(me, [Object.assign({}, first, { value: 'подменено' })], 'resolution=merge-duplicates,return=representation', '?on_conflict=user_id,op_id')],
  ]) {
    assert.equal(r.code, '42501', `${what}: ждали 42501, получили ${r.status} ${r.code} ${r.text.slice(0, 200)}`);
  }
  const after = await call('GET', `/rest/v1/changes?select=value&op_id=eq.${first.op_id}`, { token: me.token });
  assert.deepEqual(after.json, [{ value: 'проверка прав' }], 'строка журнала изменилась');

  // Слепок: не впереди журнала; на тот же seq второй раз — 23505.
  const top = Number(got2.seq);
  const ahead = await call('POST', '/rest/v1/snapshots', { token: me.token, body: [{ seq: top + 1000, data: {} }], prefer: 'return=minimal' });
  assert.equal(ahead.code, '23514', `слепок впереди журнала принят: ${ahead.status} ${ahead.code} — ${HINT}`);
  const snap = await call('POST', '/rest/v1/snapshots', { token: me.token, body: [{ seq: top, data: { tasks: [] } }], prefer: 'return=minimal' });
  assert.equal(snap.status, 201, `свой слепок не лёг: ${snap.status} ${snap.code} ${snap.text.slice(0, 200)}`);
  const twice = await call('POST', '/rest/v1/snapshots', { token: me.token, body: [{ seq: top, data: {} }], prefer: 'return=minimal' });
  assert.equal(twice.code, '23505', `второй слепок на тот же seq: ${twice.status} ${twice.code}`);
  refused(await call('PATCH', `/rest/v1/snapshots?seq=eq.${top}`, { token: me.token, body: { data: {} }, prefer: 'return=representation' }), 'update слепка');
});

test('чужой журнал: другой пользователь не читает и не пишет от чужого имени', async (t) => {
  if (!(await ready(t))) return;
  if (process.env.LANCIBLE_ACCOUNT_TEST !== '1') {
    t.todo('живая часть заводит настоящих пользователей — запуск: LANCIBLE_ACCOUNT_TEST=1 npm run test:backend');
    return;
  }
  const owner = await signUp('sync2-owner');
  const other = await signUp('sync2-other');
  const mine = row();
  assert.equal((await insert(owner, [mine])).status, 201);
  assert.ok((await call('POST', '/rest/v1/snapshots', { token: owner.token, body: [{ seq: 0, data: {} }], prefer: 'return=minimal' })).ok);

  for (const table of ['changes', 'snapshots']) {
    const r = await call('GET', `/rest/v1/${table}?select=user_id&user_id=eq.${owner.id}`, { token: other.token });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.deepEqual(r.json, [], `чужой пользователь прочитал ${table}`);
  }
  const forged = await insert(other, [row({ user_id: owner.id })], 'return=minimal');
  assert.equal(forged.code, '42501', `запись от чужого имени: ${forged.status} ${forged.code} ${forged.text.slice(0, 200)}`);
  refused(await call('DELETE', `/rest/v1/changes?user_id=eq.${owner.id}`, { token: other.token, prefer: 'return=representation' }), 'delete чужих');
});

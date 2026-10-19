/* Права доступа к отзывам — таблица feedback и бакет feedback
 * (supabase/feedback.sql). Запуск: npm run test:backend
 *
 * Форма «Обратная связь» (веб, десктоп, телефон) пишет в базу напрямую ключом
 * anon, и гость шлёт без входа. Поэтому открыто ровно одно: вставить строку
 * без user_id (или со своим, если вошёл) и следом — снимок, который эта
 * строка назвала. Всё остальное закрыто: вставить от чужого имени, прочитать
 * чужое (и даже своё гостевое), поменять, удалить, положить в бакет файл, о
 * котором не знает ни одна строка.
 *
 * Пока supabase/feedback.sql не выполнен, таблицы нет (PGRST205 / 42P01,
 * ответ 404) — тесты помечаются todo, как у ai-chat: проверять ещё нечего.
 * Ограничения 19 октября (снимок только к своей строке, формат пути, частота)
 * узнаются по функции feedback_shot_expected: её нет — файл ещё не выполнен
 * заново, и проверки этих ограничений тоже todo.
 *
 * Каждая настоящая строка уходит вебхуком в Telegram. Поэтому без флага тест
 * только пробует запрещённое — вставки, которые база должна отбить, и
 * загрузку снимка без строки, — и ничего не оставляет. Проверки, которым
 * нужна настоящая строка (гость вставляет; поменять и удалить её нельзя;
 * снимок к своей строке ложится), — только по явному запросу:
 *   LANCIBLE_FEEDBACK_TEST=1 npm run test:backend
 * Такие строки помечены текстом «zz-rls-probe» и удаляются в конце служебным
 * ключом из .env.local (значение не печатается). Нет ключа — строки
 * остаются, и тест называет их id.
 *
 * Отказ политики — код 42501. Update и delete без политик PostgREST может
 * отработать и как «ноль строк» (права на таблицу у роли есть, а строк ей не
 * видно): это тоже отказ, и тогда служебный ключ проверяет, что строка цела.
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
const PROBE = 'zz-rls-probe: проверка прав доступа, строку можно удалить';
// Самый маленький PNG: 1×1, прозрачный.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const LIVE_HINT = 'живая часть вставляет настоящие строки, а каждая уходит в Telegram — запуск: LANCIBLE_FEEDBACK_TEST=1 npm run test:backend';

/** Служебный ключ — только локально, из .env.local; в CI его нет. */
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') || null : null;
  } catch { return null; }
}

const headers = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

async function call(method, urlPath, { key = ANON, body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: headers(key, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* пусто или не JSON */ }
  return { status: res.status, ok: res.ok, text, json, code: json && json.code };
}

/** Загрузка снимка в бакет feedback ключом anon, как у клиентов (без перезаписи). */
async function upload(name, { upsert = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/feedback/${name}`, {
    method: upsert ? 'PUT' : 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'image/png', ...(upsert ? { 'x-upsert': 'true' } : {}) },
    body: PNG,
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** Строка, которую вставил бы гость с формы. */
const guestRow = (extra) => ({
  id: crypto.randomUUID(), kind: 'bug', text: PROBE, platform: 'web', app_version: 'test', lang: 'ru',
  device: 'node feedback-rls.test.js', screenshot_path: null, ...extra,
});

const created = []; // id строк, которые тест вставил
const uploaded = []; // пути файлов в бакете

/** Есть ли таблица: null — нет сети; false — feedback.sql ещё не выполнен. */
let probe = null;
async function tableReady(t) {
  if (!probe) {
    probe = call('GET', '/rest/v1/feedback?select=id&limit=1')
      .then((r) => ({ net: true, ready: !(r.status === 404 || r.code === 'PGRST205' || r.code === '42P01'), r }))
      .catch((e) => ({ net: false, error: e }));
  }
  const p = await probe;
  if (!p.net) { t.todo(`нет сети до Supabase: ${p.error.message}`); return false; }
  if (!p.ready) { t.todo('таблицы feedback нет — выполните supabase/feedback.sql в SQL Editor'); return false; }
  return true;
}

/** Выполнен ли feedback.sql от 19 октября (ограничения): есть ли feedback_shot_expected. */
let limitsProbe = null;
async function limitsReady(t) {
  if (!(await tableReady(t))) return false;
  if (!limitsProbe) {
    limitsProbe = call('POST', '/rest/v1/rpc/feedback_shot_expected', { body: { object_name: `${crypto.randomUUID()}.png` } })
      .then((r) => ({ net: true, r }))
      .catch((e) => ({ net: false, error: e }));
  }
  const p = await limitsProbe;
  if (!p.net) { t.todo(`нет сети до Supabase: ${p.error.message}`); return false; }
  if (p.r.status === 404 || p.r.code === 'PGRST202' || p.r.code === '42883') {
    t.todo('ограничений 19 октября в базе ещё нет — выполните supabase/feedback.sql заново');
    return false;
  }
  // Функция есть: гостю она отвечает, но про файл без строки — «не ждём».
  assert.equal(p.r.status, 200, `feedback_shot_expected: ${p.r.status} ${p.r.code} ${p.r.text.slice(0, 200)}`);
  assert.equal(p.r.json, false, 'файл без строки функция считает ожидаемым');
  return true;
}

/** Настоящие строки — только по LANCIBLE_FEEDBACK_TEST=1. */
function liveInserts(t) {
  if (process.env.LANCIBLE_FEEDBACK_TEST === '1') return true;
  t.todo(LIVE_HINT);
  return false;
}

test.after(async () => {
  const key = serviceKey();
  if (!key) {
    if (created.length) console.error(`служебного ключа нет — в feedback остались проверочные строки: ${created.join(', ')}`);
    if (uploaded.length) console.error(`служебного ключа нет — в бакете feedback остались файлы: ${uploaded.join(', ')}`);
    return;
  }
  if (created.length) {
    const r = await call('DELETE', `/rest/v1/feedback?id=in.(${created.join(',')})`, { key });
    if (!r.ok) console.error(`не удалось убрать проверочные строки ${created.join(', ')}: ${r.status}`);
  }
  for (const p of uploaded) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/feedback/${p}`, { method: 'DELETE', headers: headers(key) });
    if (!r.ok) console.error(`не удалось убрать файл ${p}: ${r.status}`);
  }
});

test('гость не может вставить отзыв от чужого имени', async (t) => {
  if (!(await tableReady(t))) return;
  const row = guestRow({ user_id: NOWHERE_UUID });
  const r = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
  if (r.status === 201) created.push(row.id);
  assert.notEqual(r.code, '23503', 'политика пропустила запись — дело дошло до внешнего ключа');
  assert.equal(r.code, '42501', `ожидали отказ политики, получили ${r.status} ${r.code}: ${r.text.slice(0, 200)}`);
});

test('ограничения таблицы держат форму: незнакомый вид и пустой текст не проходят', async (t) => {
  if (!(await tableReady(t))) return;
  for (const extra of [{ kind: 'spam' }, { text: '' }, { platform: 'tv' }, { text: 'x'.repeat(4001) }]) {
    const row = guestRow(extra);
    const r = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
    if (r.status === 201) created.push(row.id);
    assert.equal(r.code, '23514', `${JSON.stringify(extra).slice(0, 40)}: ждали нарушение check, получили ${r.status} ${r.code}`);
  }
});

test('путь снимка — только <uuid>.<png|jpg|webp>: папки, «../» и чужие типы не проходят', async (t) => {
  if (!(await limitsReady(t))) return;
  const id = crypto.randomUUID();
  for (const shot of ['../evil.png', `folder/${id}.png`, `${id}.gif`, `${id}.png.exe`, 'x'.repeat(36) + '.png']) {
    const row = guestRow({ screenshot_path: shot });
    const r = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
    if (r.status === 201) created.push(row.id);
    assert.equal(r.code, '23514', `${shot}: ждали нарушение check, получили ${r.status} ${r.code}`);
  }
});

test('бакет feedback: снимок, которого не назвала ни одна строка, гость положить не может', async (t) => {
  if (!(await limitsReady(t))) return;
  const name = `${crypto.randomUUID()}.png`;
  const up = await upload(name);
  if (up.ok) uploaded.push(name);
  assert.ok(!up.ok, `аноним положил файл без строки: ${up.status} ${up.text.slice(0, 200)}`);
  // Отказ именно политики, а не «нет бакета» или сбой.
  assert.match(up.text, /row-level security|unauthorized/i, `${up.status} ${up.text.slice(0, 200)}`);
  // И прочитать чужое имя нечем.
  for (const url of [`/storage/v1/object/authenticated/feedback/${name}`, `/storage/v1/object/public/feedback/${name}`]) {
    const r = await fetch(`${SUPABASE_URL}${url}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    assert.ok(!r.ok, `${url}: аноним прочитал снимок (${r.status})`);
  }
});

test('гость вставляет отзыв без user_id — и прочитать его anon-ключом не может', async (t) => {
  if (!(await tableReady(t)) || !liveInserts(t)) return;
  const row = guestRow();
  const r = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
  if (r.status === 201) created.push(row.id);
  assert.equal(r.status, 201, `гость не смог отправить отзыв: ${r.status} ${r.code} ${r.text.slice(0, 200)}`);

  const read = await call('GET', `/rest/v1/feedback?select=id,text&id=eq.${row.id}`);
  assert.equal(read.status, 200, read.text.slice(0, 200));
  assert.deepEqual(read.json, [], 'аноним прочитал отзыв — политика select пропускает гостей');
  const all = await call('GET', '/rest/v1/feedback?select=id&limit=5');
  assert.deepEqual(all.json, [], 'аноним видит чужие отзывы');

  // Сама строка на месте — это видно только служебным ключом.
  const key = serviceKey();
  if (key) {
    const own = await call('GET', `/rest/v1/feedback?select=id,user_id,kind,platform&id=eq.${row.id}`, { key });
    assert.deepEqual(own.json, [{ id: row.id, user_id: null, kind: 'bug', platform: 'web' }]);
  }
});

test('гость не может поменять или удалить отзыв — свой и чужой', async (t) => {
  if (!(await tableReady(t)) || !liveInserts(t)) return;
  const row = guestRow();
  const ins = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
  if (ins.status === 201) created.push(row.id);
  assert.equal(ins.status, 201, ins.text.slice(0, 200));

  const refused = (r, what) => {
    if (r.code === '42501') return;
    // Права на таблицу у роли есть, строк ей не видно: «ноль строк».
    assert.ok(r.ok, `${what}: ${r.status} ${r.code} ${r.text.slice(0, 200)}`);
    assert.deepEqual(r.json, [], `${what}: аноним изменил строки — ${r.text.slice(0, 200)}`);
  };
  refused(await call('PATCH', `/rest/v1/feedback?id=eq.${row.id}`, { body: { text: 'подменено' }, prefer: 'return=representation' }), 'update');
  refused(await call('PATCH', '/rest/v1/feedback?kind=eq.bug', { body: { kind: 'other' }, prefer: 'return=representation' }), 'update всех');
  refused(await call('DELETE', `/rest/v1/feedback?id=eq.${row.id}`, { prefer: 'return=representation' }), 'delete');
  refused(await call('DELETE', '/rest/v1/feedback?kind=eq.bug', { prefer: 'return=representation' }), 'delete всех');

  const key = serviceKey();
  if (!key) { t.diagnostic('служебного ключа нет — цела ли строка, не проверено'); return; }
  const after = await call('GET', `/rest/v1/feedback?select=text,kind&id=eq.${row.id}`, { key });
  assert.deepEqual(after.json, [{ text: PROBE, kind: 'bug' }], 'строка изменилась или пропала');
});

test('сначала строка, потом снимок: файл, названный строкой, ложится — один раз, без перезаписи, прочитать нельзя', async (t) => {
  if (!(await limitsReady(t)) || !liveInserts(t)) return;
  if (!serviceKey()) { t.todo('без служебного ключа загруженный файл некому убрать — запуск с .env.local'); return; }
  const id = crypto.randomUUID();
  const name = `${id}.png`;
  // Время из прошлого база не берёт: created_at ставит триггер.
  const row = guestRow({ id, screenshot_path: name, created_at: '2000-01-01T00:00:00Z' });
  const ins = await call('POST', '/rest/v1/feedback', { body: row, prefer: 'return=minimal' });
  if (ins.status === 201) created.push(id);
  assert.equal(ins.status, 201, `${ins.status} ${ins.code} ${ins.text.slice(0, 200)}`);
  const stored = await call('GET', `/rest/v1/feedback?select=created_at&id=eq.${id}`, { key: serviceKey() });
  const age = Date.now() - Date.parse(stored.json[0].created_at);
  assert.ok(Math.abs(age) < 5 * 60 * 1000, `created_at взят у клиента: ${stored.json[0].created_at}`);

  const up = await upload(name);
  if (up.ok) uploaded.push(name);
  assert.ok(up.ok, `снимок к своей строке не лёг: ${up.status} ${up.text.slice(0, 200)}`);
  const again = await upload(name);
  assert.ok(!again.ok, `тот же файл лёг второй раз (${again.status})`);
  const over = await upload(name, { upsert: true });
  assert.ok(!over.ok, `аноним перезаписал снимок (${over.status})`);
  for (const url of [`/storage/v1/object/authenticated/feedback/${name}`, `/storage/v1/object/public/feedback/${name}`]) {
    const r = await fetch(`${SUPABASE_URL}${url}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    assert.ok(!r.ok, `${url}: аноним прочитал снимок (${r.status})`);
  }
  // Строка названа — но другой файл рядом с ней не ляжет.
  const other = `${crypto.randomUUID()}.png`;
  const stray = await upload(other);
  if (stray.ok) uploaded.push(other);
  assert.ok(!stray.ok, `рядом со строкой лёг чужой файл (${stray.status})`);
});

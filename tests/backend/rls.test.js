/* Права доступа к базе. Запуск: npm run test:backend
 *
 * Своего сервера у приложения нет: браузер и телефон ходят в Supabase
 * напрямую, а ключ anon зашит в них открытым текстом — его видно в исходниках
 * любой страницы. Единственное, что отделяет данные одного пользователя от
 * другого, — политики Row Level Security. Поэтому это самый ценный тест во
 * всём проекте: он проверяет не поведение, а то, что чужое нельзя прочитать.
 *
 * Как устроена проверка записи. Просто «попробовать вставить строку» опасно:
 * если защита вдруг не сработает, тест сам насорит в боевой базе. Поэтому
 * вставляется строка, которая нарушает внешний ключ и не может быть принята
 * ни при каких условиях, а смотрим мы на КОД ошибки:
 *   42501 — запись отклонена политикой. Так и должно быть.
 *   23503 — запись дошла до проверки внешнего ключа, то есть политика её
 *           пропустила. Это провал защиты.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';

const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const NOWHERE_UUID = '00000000-0000-4000-8000-000000000001'; // такого пользователя нет и быть не может

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  const body = await res.text();
  return { status: res.status, body, json: (() => { try { return JSON.parse(body); } catch { return null; } })() };
}

async function insert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify([row]),
  });
  const body = await res.text();
  let code = null;
  try { code = JSON.parse(body).code; } catch { /* не JSON — оставим null */ }
  return { status: res.status, code, body };
}

test('чужие данные синхронизации анониму не видны', async () => {
  // Политика на sync_state — auth.uid() = user_id. У анонимного запроса
  // auth.uid() пуст, поэтому под фильтр не попадает ни одна строка.
  const r = await get('sync_state?select=user_id&limit=5');
  assert.equal(r.status, 200, `ожидали 200, получили ${r.status}: ${r.body.slice(0, 200)}`);
  assert.deepEqual(r.json, [], 'аноним получил чужие строки синхронизации');
});

test('чужие профили анониму не видны', async () => {
  const r = await get('profiles?select=id,email&limit=5');
  assert.equal(r.status, 200, `ожидали 200, получили ${r.status}: ${r.body.slice(0, 200)}`);
  assert.deepEqual(r.json, [], 'аноним получил чужие профили');
});

test('аноним не может записать чужую синхронизацию', async () => {
  const r = await insert('sync_state', { user_id: NOWHERE_UUID, data: { проверка: true } });
  assert.notEqual(r.code, '23503', 'политика пропустила запись — дело дошло до внешнего ключа');
  assert.equal(r.code, '42501', `ожидали отказ политики, получили ${r.status} ${r.code}: ${r.body.slice(0, 200)}`);
});

test('аноним не может создать чужой профиль', async () => {
  const r = await insert('profiles', { id: NOWHERE_UUID, email: 'проверка@example.com' });
  assert.notEqual(r.code, '23503', 'политика пропустила запись — дело дошло до внешнего ключа');
  assert.equal(r.code, '42501', `ожидали отказ политики, получили ${r.status} ${r.code}: ${r.body.slice(0, 200)}`);
});

test('журнал работы читается анонимом — на этом держится страница /logs', async () => {
  const r = await get('work_log_tasks?select=id,title,status&limit=5');
  assert.equal(r.status, 200, `ожидали 200, получили ${r.status}: ${r.body.slice(0, 200)}`);
  assert.ok(Array.isArray(r.json), 'ожидали список задач журнала');
});

test('события журнала читаются вместе с задачами', async () => {
  const r = await get('work_log_tasks?select=id,work_log_events(kind,title)&limit=1');
  assert.equal(r.status, 200, `связь между таблицами не настроена: ${r.body.slice(0, 200)}`);
});

test('аноним не может писать в журнал работы', async () => {
  // У журнала политик на запись нет вовсе — писать может только служебный
  // ключ, который в браузер не попадает. Иначе любой, кто откроет исходник
  // страницы /logs, смог бы дописать туда что угодно.
  const r = await insert('work_log_tasks', { id: 'zz-rls-probe', title: 'Проверка защиты' });
  assert.equal(
    r.code, '42501',
    `аноним смог писать в журнал (${r.status} ${r.code}). Если строка zz-rls-probe появилась — её надо удалить.`,
  );
});

test('аноним не может дописывать события в журнал', async () => {
  const r = await insert('work_log_events', { task_id: 'zz-rls-probe', kind: 'change', title: 'Проверка' });
  assert.notEqual(r.code, '23503', 'политика пропустила запись — дело дошло до внешнего ключа');
  assert.equal(r.code, '42501', `ожидали отказ политики, получили ${r.status} ${r.code}: ${r.body.slice(0, 200)}`);
});

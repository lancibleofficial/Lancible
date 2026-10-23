/* Админ-панель на сервере — Edge Function admin (supabase/functions/admin).
 * Запуск: npm run test:backend
 *
 * Без сети. Сама функция (index.ts, типы снимает esbuild) гоняется в Node на
 * подменах: Deno.serve, база и хранилище (supabase-js — таблицы в памяти,
 * RPC — заготовленные ответы) и fetch к Resend и GitHub. Проверяется то, чего
 * снаружи не видно: кого пускают (не админ — 403 forbidden, без второго
 * фактора — 403 mfa, не админу про mfa не говорят), CORS только для адреса
 * админки и локального сервера, форма ответа каждого действия, письмо-ответ
 * (без ключа Resend — not_configured, у гостя — no email, ушло — отзыв
 * answered), белые списки настроек агента (совпадают с ai-chat), выпуск без
 * токена — 400, и что в логах нет ни ключей, ни почт. Плюс локальный сервер
 * scripts/serve-admin.js: собирает ту же функцию и отвечает на /functions/v1/admin.
 *
 * Живой части нет: функция зовёт базу служебным ключом, а админ — один,
 * аккаунт владельца с TOTP. Проверка руками — supabase/functions/README.md,
 * «Админ-панель».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'admin', 'index.ts');
const realFetch = globalThis.fetch;

const ADMIN_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const USER_ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const FB_ACCOUNT = '0b6f3c9e-1d2a-4f5b-8c7d-9e0f1a2b3c4d';
const FB_GUEST = '7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d';
const ADMIN_EMAIL = 'owner.secret@example.com';
const USER_EMAIL = 'person.private@example.org';
const SERVICE = 'service-role-NOT-A-REAL-KEY-000000';
const RESEND = 're_NOT_A_REAL_KEY_1234567890abcdef';
const GITHUB = 'github_pat_NOT_A_REAL_TOKEN_1234567890';
const ORIGIN = 'https://lancible-admin.vercel.app';

/** JWT без подписи (её проверяет getUser — здесь подмена). */
const jwt = (claims) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const TOKENS = {
  admin2: jwt({ sub: ADMIN_ID, aal: 'aal2', role: 'authenticated' }),
  admin1: jwt({ sub: ADMIN_ID, aal: 'aal1', role: 'authenticated' }),
  user2: jwt({ sub: USER_ID, aal: 'aal2', role: 'authenticated' }),
  user1: jwt({ sub: USER_ID, aal: 'aal1', role: 'authenticated' }),
  forged: jwt({ sub: USER_ID, aal: 'aal2', role: 'authenticated' }).replace(/\.sig$/, '.forged'),
};

// --- подмена supabase-js ---------------------------------------------------------

const clone = (v) => JSON.parse(JSON.stringify(v));

function seed() {
  return {
    admin_users: [{ user_id: ADMIN_ID, created_at: '2026-10-23T00:00:00Z' }],
    feedback: [
      { id: FB_ACCOUNT, user_id: USER_ID, kind: 'bug', text: 'Кнопка «Старт» не нажимается\nвторая строка', platform: 'web', app_version: '0.5.1', lang: 'uk', device: 'Chrome', screenshot_path: `${FB_ACCOUNT}.png`, created_at: '2026-10-22T10:00:00Z', status: 'new' },
      { id: FB_GUEST, user_id: null, kind: 'idea', text: 'Тёмная тема для гостя', platform: 'android', app_version: '1.3.1', lang: 'ru', device: 'Pixel', screenshot_path: null, created_at: '2026-10-21T10:00:00Z', status: 'new' },
    ],
    feedback_replies: [],
    app_settings: [],
    ai_access: [{ email: USER_EMAIL, note: 'тест', granted_at: '2026-10-21T00:00:00Z' }],
    blog_posts: [
      { id: '11111111-2222-3333-8444-555555555555', date: '2026-10-21', tag: 'improvement', version: '0.5.1', title: { ru: 'Пост', en: 'Post' }, body: { ru: ['а'], en: ['a'] }, published: true, created_at: '2026-10-21T12:00:00Z', updated_at: '2026-10-21T12:00:00Z' },
    ],
    ai_calls: [{ user_id: USER_ID, created_at: '2026-10-22T09:00:00Z', model: 'claude-sonnet-5-5', counted: true, input_tokens: 100, output_tokens: 20, cost_units: 200, stop_reason: 'end_turn', ms: 900 }],
    usage_daily: [
      { day: new Date().toISOString().slice(0, 10), user_id: USER_ID, screen: 'projects', platform: 'web', views: 3 },
      { day: new Date().toISOString().slice(0, 10), user_id: USER_ID, screen: 'task', platform: 'android', views: 2 },
    ],
    // Журнал работы (supabase/logs.sql): три задачи, у одной событий нет.
    work_log_tasks: [
      { id: '2026-10-20-a', title: 'Задача А', summary: 'Сводка А', status: 'deployed', round: 2, started_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-21T10:00:00Z' },
      { id: '2026-10-22-b', title: 'Задача Б', summary: null, status: 'review', round: 1, started_at: '2026-10-22T08:00:00Z', updated_at: '2026-10-22T12:00:00Z' },
      { id: '2026-10-23-c', title: 'Задача В', summary: null, status: 'in_progress', round: 1, started_at: '2026-10-23T09:00:00Z', updated_at: '2026-10-23T09:00:00Z' },
    ],
    work_log_events: [
      { id: 1, task_id: '2026-10-20-a', kind: 'request', title: 'Попросили', detail: null, round: 1, at: '2026-10-20T08:00:00Z' },
      { id: 2, task_id: '2026-10-20-a', kind: 'error', title: 'Сломалось', detail: 'Почему', round: 1, at: '2026-10-20T09:00:00Z' },
      { id: 3, task_id: '2026-10-20-a', kind: 'fix', title: 'Починено', detail: null, round: 2, at: '2026-10-21T09:00:00Z' },
      { id: 4, task_id: '2026-10-20-a', kind: 'deploy', title: 'Уехало', detail: null, round: 2, at: '2026-10-21T10:00:00Z' },
      { id: 5, task_id: '2026-10-22-b', kind: 'check', title: 'Проверено', detail: 'замер', round: 1, at: '2026-10-22T12:00:00Z' },
      { id: 6, task_id: '2026-10-22-b', kind: 'change', title: 'Сделано', detail: null, round: 1, at: '2026-10-22T08:30:00Z' },
      { id: 7, task_id: '2026-10-22-b', kind: 'error', title: 'Опять', detail: null, round: 1, at: '2026-10-22T10:00:00Z' },
    ],
  };
}

const USERS_ROW = (id, email) => ({ id, email, createdAt: '2026-10-01T00:00:00+00:00', lastSignInAt: '2026-10-22T00:00:00+00:00', provider: 'email', aiAccess: true, projects: 2, tasks: 7, lastActiveDay: '2026-10-22', feedback: 1, aiCalls7: 1 });

/** RPC на подмене: что вернёт база; calls — с какими аргументами звали. */
function rpcs(db) {
  return {
    admin_overview: ({ p_days }) => ({ data: {
      days: p_days,
      users: { total: 5, new7: 1, new30: 5, series: [{ day: '2026-10-23', n: 1 }] },
      logins: { day: 1, week: 3, month: 9, source: 'sessions', series: [{ day: '2026-10-23', n: 1 }] },
      active: { dau: 1, wau: 2, mau: 3, series: [{ day: '2026-10-23', n: 1 }] },
      projects: { total: 5, series: [] }, tasks: { total: 30, series: [] },
      feedback: { new: 2, total: 2 }, ai: { calls7: 1, users7: 1, unitsToday: 0 },
      platforms: { web: 1, desktop: 0, android: 1, ios: 0 },
    }, error: null }),
    admin_screens: () => ({ data: [{ screen: 'projects', platform: 'web', views: '3', users: '1' }, { screen: 'task', platform: 'android', views: 2, users: 1 }], error: null }),
    // Как SQL: p_q — часть почты без учёта регистра, p_access — 'yes'/'no' по ai_access.
    admin_users_list: ({ p_id, p_q, p_access }) => {
      const granted = (email) => db.tables.ai_access.some((a) => a.email === email.toLowerCase());
      let rows = [USERS_ROW(USER_ID, USER_EMAIL), USERS_ROW(ADMIN_ID, ADMIN_EMAIL)].map((r) => ({ ...r, aiAccess: granted(r.email) }));
      if (p_id) rows = rows.filter((r) => r.id === p_id);
      if (p_q) rows = rows.filter((r) => r.email.toLowerCase().includes(String(p_q).toLowerCase()));
      if (p_access) rows = rows.filter((r) => r.aiAccess === (p_access === 'yes'));
      return { data: { total: rows.length, rows }, error: null };
    },
    admin_user_emails: ({ p_ids }) => ({ data: p_ids.map((id) => db.auth[id]).filter(Boolean).map((u) => ({ id: u.id, email: u.email })), error: null }),
    admin_access_list: () => ({ data: db.tables.ai_access.map((a) => ({ ...a, user_id: Object.values(db.auth).find((u) => u.email === a.email)?.id || null })), error: null }),
  };
}

function fakeSupabase({ tables = seed(), fail = {}, missing = [] } = {}) {
  const db = {
    tables: clone(tables),
    auth: {
      [ADMIN_ID]: { id: ADMIN_ID, email: ADMIN_EMAIL, email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'email' }], factors: [{ status: 'verified', factor_type: 'totp' }] },
      [USER_ID]: { id: USER_ID, email: USER_EMAIL, email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'email' }, { provider: 'google' }], factors: [] },
    },
    calls: [],
    signed: [],
  };
  const rpc = rpcs(db);
  db.client = {
    auth: {
      getUser: async (token) => {
        const claims = Object.entries(TOKENS).find(([, v]) => v === token);
        if (!claims || claims[0] === 'forged') return { data: { user: null }, error: { message: 'invalid JWT' } };
        const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
        return { data: { user: db.auth[sub] }, error: null };
      },
      admin: { getUserById: async (id) => ({ data: { user: db.auth[id] || null }, error: db.auth[id] ? null : { message: 'User not found' } }) },
    },
    rpc: async (name, args) => {
      db.calls.push(['rpc', name, args]);
      if (fail[name]) return { data: null, error: fail[name] };
      if (!rpc[name]) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      return rpc[name](args || {});
    },
    from: (table) => query(db, table, fail, missing),
    storage: {
      from(bucket) {
        assert.equal(bucket, 'feedback', 'снимки — только из бакета feedback');
        return {
          createSignedUrls: async (paths, ttl) => {
            db.signed.push({ paths, ttl });
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://example.supabase.co/storage/v1/object/sign/feedback/${p}?token=signed`, error: null })), error: null };
          },
        };
      },
    },
  };
  return db;
}

/** Построитель запроса PostgREST поверх массивов в памяти. */
function query(db, table, fail, missing) {
  const q = { op: 'select', cols: '*', values: null, filters: [], desc: [], order: [], range: null, limit: null, single: null, count: false, conflict: null, returning: false };
  const pick = (r) => {
    if (!q.cols || q.cols.trim() === '*') return { ...r };
    return Object.fromEntries(q.cols.split(',').map((c) => c.trim()).map((c) => [c, r[c] === undefined ? null : r[c]]));
  };
  const run = () => {
    db.calls.push([q.op, table, q.desc.join(' '), q.values]);
    if (missing.includes(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
    if (fail[table]) return { data: null, error: fail[table] };
    const rows = db.tables[table];
    assert.ok(Array.isArray(rows), `функция ходит в неизвестную таблицу ${table}`);
    const match = (r) => q.filters.every((f) => f(r));
    let out;
    if (q.op === 'insert') {
      const list = (Array.isArray(q.values) ? q.values : [q.values]).map((v) => ({
        id: v.id || `9${String(rows.length + 1).padStart(7, '0')}-0000-4000-8000-000000000000`,
        created_at: '2026-10-23T08:00:00Z', updated_at: '2026-10-23T08:00:00Z', sent_at: null, email_status: null, ...v,
      }));
      rows.push(...list);
      out = list;
    } else if (q.op === 'upsert') {
      const key = q.conflict;
      out = [];
      for (const v of Array.isArray(q.values) ? q.values : [q.values]) {
        const hit = rows.find((r) => r[key] === v[key]);
        if (hit) Object.assign(hit, v);
        else rows.push({ granted_at: '2026-10-23T08:00:00Z', ...v });
        out.push(hit || v);
      }
    } else if (q.op === 'update') {
      out = rows.filter(match);
      for (const r of out) Object.assign(r, q.values);
    } else if (q.op === 'delete') {
      out = rows.filter(match);
      db.tables[table] = rows.filter((r) => !match(r));
    } else {
      out = rows.filter(match);
      for (const [k, asc] of q.order.slice().reverse()) out = out.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
    }
    const total = out.length;
    if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) out = out.slice(0, q.limit);
    // Как PostgREST у Supabase (max_rows): больше 1000 строк за раз не отдаёт.
    if (q.op === 'select') out = out.slice(0, 1000);
    const data = q.op === 'select' || q.returning ? out.map(pick) : null;
    if (q.single === 'maybe') return { data: data && data.length ? data[0] : null, error: null };
    if (q.single === 'one') return data && data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } };
    return { data, error: null, count: q.count ? total : null };
  };
  const b = {
    select(cols, opts) { if (q.op === 'select') { q.cols = cols; q.count = !!(opts && opts.count); } else { q.returning = true; q.cols = cols; } return b; },
    insert(v) { q.op = 'insert'; q.values = v; return b; },
    upsert(v, opts) { q.op = 'upsert'; q.values = v; q.conflict = opts && opts.onConflict; assert.ok(q.conflict, 'upsert — с onConflict'); return b; },
    update(v) { q.op = 'update'; q.values = v; return b; },
    delete() { q.op = 'delete'; return b; },
    eq(k, v) { q.desc.push(`${k}=${v}`); q.filters.push((r) => r[k] === v); return b; },
    in(k, vs) { q.desc.push(`${k} in ${vs.length}`); q.filters.push((r) => vs.includes(r[k])); return b; },
    gte(k, v) { q.desc.push(`${k}>=${v}`); q.filters.push((r) => r[k] >= v); return b; },
    order(k, o) { q.order.push([k, !(o && o.ascending === false)]); return b; },
    range(a, z) { q.range = [a, z]; return b; },
    limit(n) { q.limit = n; return b; },
    maybeSingle() { q.single = 'maybe'; return b; },
    single() { q.single = 'one'; return b; },
    then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); },
  };
  return b;
}

// --- загрузка функции и вызов -------------------------------------------------------

let loaded = null;
async function loadFunction() {
  if (loaded) return loaded;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { return null; }
  const { code } = await esbuild.transform(fs.readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const js = code.replace(/import\s*\{\s*createClient\s*\}\s*from\s*["']jsr:@supabase\/supabase-js@2["'];?/, 'const { createClient } = globalThis.__adminFn.supabase;');
  assert.notEqual(js, code, 'импорт supabase-js в index.ts поменялся — поправить подмену');
  const box = { env: {}, db: null, handler: null, mod: null, created: [] };
  globalThis.__adminFn = { supabase: { createClient: (url, key) => { box.created.push({ url, key }); return box.db.client; } } };
  globalThis.Deno = { env: { get: (k) => box.env[k] }, serve: (h) => { box.handler = h; } };
  box.mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.equal(typeof box.handler, 'function', 'функция не позвала Deno.serve');
  loaded = box;
  return box;
}

/** Весь вывод функции в консоль за прогон — для проверки «ни ключей, ни почт». */
const LOGS = [];

/** Внешний мир на подмене: fetch к Resend, GitHub, raw, Supabase Storage, лендингу. */
function fakeNet(routes = {}) {
  const sent = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    sent.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (u.startsWith(prefix)) return handler(u, init);
    }
    return new Response('not found', { status: 404 });
  };
  return { sent, fetch: fetchFn };
}

async function invoke(t, { action, params = {}, token = TOKENS.admin2, origin, method = 'POST', raw, env = {}, db, routes } = {}) {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild — npm install'); return null; }
  fn.env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, ...env };
  fn.db = db || fakeSupabase();
  fn.created = [];
  const netbox = fakeNet(routes);
  globalThis.fetch = netbox.fetch;
  const logs = [];
  const real = { error: console.error, log: console.log, warn: console.warn };
  for (const k of Object.keys(real)) console[k] = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    const init = { method, headers };
    if (method !== 'GET' && method !== 'OPTIONS') init.body = raw !== undefined ? raw : JSON.stringify({ action, ...params });
    const res = await fn.handler(new Request('https://example.supabase.co/functions/v1/admin', init));
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* пусто */ }
    LOGS.push(...logs);
    return { status: res.status, headers: res.headers, text, json, db: fn.db, sent: netbox.sent, logs };
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, real);
  }
}

// --- кто пускается -----------------------------------------------------------------

test('admin: без токена и с чужим токеном — 401; не админ — 403 forbidden даже без второго фактора; админ без aal2 — 403 mfa', async (t) => {
  const none = await invoke(t, { action: 'me', token: null });
  if (!none) return;
  assert.equal(none.status, 401);
  assert.deepEqual(none.json, { error: 'not signed in' });
  for (const token of [TOKENS.forged, 'not-a-jwt']) {
    const r = await invoke(t, { action: 'me', token });
    assert.equal(r.status, 401, token.slice(0, 10));
  }
  for (const token of [TOKENS.user2, TOKENS.user1]) {
    const r = await invoke(t, { action: 'overview', token });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: 'forbidden' }, 'не админу про второй фактор не говорят');
    assert.ok(!r.db.calls.some((c) => c[0] === 'rpc'), 'до счётчиков не дошло');
  }
  const mfa = await invoke(t, { action: 'overview', token: TOKENS.admin1 });
  assert.equal(mfa.status, 403);
  assert.deepEqual(mfa.json, { error: 'mfa' });
  assert.ok(!mfa.db.calls.some((c) => c[0] === 'rpc'));
  // Токен на другого пользователя, чем ответил getUser, — 401.
  const db = fakeSupabase();
  db.client.auth.getUser = async () => ({ data: { user: db.auth[ADMIN_ID] }, error: null });
  const swapped = await invoke(t, { action: 'me', token: TOKENS.user2, db });
  assert.equal(swapped.status, 401);
  // Нет таблицы admin_users (admin.sql не выполнен) — закрыто, в логе подсказка без почты.
  const noTable = await invoke(t, { action: 'me', db: fakeSupabase({ missing: ['admin_users'] }) });
  assert.equal(noTable.status, 403);
  assert.deepEqual(noTable.json, { error: 'forbidden' });
  assert.deepEqual(noTable.logs, ['admin: no admin_users table — supabase/admin.sql PGRST205']);
  // Служебный ключ — из секрета функции, клиенту его не видно.
  const me = await invoke(t, { action: 'me' });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json, { ok: true, email: ADMIN_EMAIL, aal: 'aal2' });
  assert.ok(!me.text.includes(SERVICE));
});

test('admin: не POST — 405, не JSON — 400, неизвестное действие — 400, тело больше 512 КБ — 413', async (t) => {
  const get = await invoke(t, { method: 'GET' });
  if (!get) return;
  assert.equal(get.status, 405);
  assert.equal((await invoke(t, { raw: '{' })).json.error, 'bad json');
  for (const action of ['drop', 'constructor', '__proto__', 'toString']) {
    const r = await invoke(t, { action });
    assert.equal(r.status, 400, action);
    assert.deepEqual(r.json, { error: 'unknown action' }, action);
  }
  assert.equal((await invoke(t, { raw: JSON.stringify({ nope: 1 }) })).json.detail, 'action');
  const big = await invoke(t, { action: 'me', params: { pad: 'я'.repeat(300 * 1024) } });
  assert.equal(big.status, 413);
  // Не админ с огромным телом — сначала 413 (тело не разбирается), с нормальным — 403.
  assert.equal((await invoke(t, { action: 'nope', token: TOKENS.user2 })).status, 403, 'неизвестное действие не админу — 403, список действий не раскрывается');
});

test('admin: CORS — только адрес админки и localhost:5175; чужой Origin — 403 без Access-Control-Allow-Origin', async (t) => {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild'); return; }
  assert.deepEqual(fn.mod.ORIGINS, ['https://lancible-admin.vercel.app', 'http://localhost:5175']);
  for (const origin of fn.mod.ORIGINS) {
    const pre = await invoke(t, { method: 'OPTIONS', origin });
    assert.equal(pre.status, 204, origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    assert.equal(pre.headers.get('vary'), 'Origin');
    const r = await invoke(t, { action: 'me', origin });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    const denied = await invoke(t, { action: 'me', origin, token: TOKENS.user2 });
    assert.equal(denied.headers.get('access-control-allow-origin'), origin, 'и у отказа — чтобы админка прочитала ошибку');
  }
  for (const origin of ['https://evil.example', 'http://localhost:5173', 'https://lancible.vercel.app', 'null']) {
    const pre = await invoke(t, { method: 'OPTIONS', origin });
    assert.equal(pre.status, 403, origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), null, origin);
    const r = await invoke(t, { action: 'me', origin });
    assert.equal(r.status, 403, origin);
    assert.deepEqual(r.json, { error: 'origin' });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.db.calls.length, 0, `${origin}: до базы не дошло`);
  }
  // Без Origin (не браузер) — пускает токен; заголовка CORS нет.
  const plain = await invoke(t, { action: 'me' });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('access-control-allow-origin'), null);
});

// --- обзор, экраны, пользователи -------------------------------------------------------

test('admin: overview и screens — счётчики из admin_overview/admin_screens; days — только 7, 30 или 90', async (t) => {
  const r = await invoke(t, { action: 'overview' });
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.db.calls.filter((c) => c[0] === 'rpc'), [['rpc', 'admin_overview', { p_days: 30 }]]);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.days, 30);
  for (const k of ['users', 'logins', 'active', 'projects', 'tasks', 'feedback', 'ai', 'platforms']) assert.ok(r.json[k], `в обзоре есть ${k}`);
  assert.deepEqual(Object.keys(r.json.users).sort(), ['new30', 'new7', 'series', 'total']);
  assert.deepEqual(Object.keys(r.json.logins).sort(), ['day', 'month', 'series', 'source', 'week']);
  assert.deepEqual(Object.keys(r.json.active).sort(), ['dau', 'mau', 'series', 'wau']);
  assert.deepEqual(r.json.users.series[0], { day: '2026-10-23', n: 1 });
  const week = await invoke(t, { action: 'overview', params: { days: 7 } });
  assert.deepEqual(week.db.calls.find((c) => c[0] === 'rpc')[2], { p_days: 7 });
  for (const days of [5, '30', 365, -1]) {
    const bad = await invoke(t, { action: 'overview', params: { days } });
    assert.equal(bad.status, 400, String(days));
  }
  const s = await invoke(t, { action: 'screens', params: { days: 90 } });
  assert.deepEqual(s.json, { ok: true, days: 90, rows: [{ screen: 'projects', platform: 'web', views: 3, users: 1 }, { screen: 'task', platform: 'android', views: 2, users: 1 }] });
  // admin.sql не выполнен — 500 setup с кодом, без текста ошибки.
  const setup = await invoke(t, { action: 'overview', db: fakeSupabase({ fail: { admin_overview: { code: 'PGRST202', message: 'Could not find the function public.admin_overview' } } }) });
  assert.equal(setup.status, 500);
  assert.deepEqual(setup.json, { error: 'setup', code: 'PGRST202' });
  const db = await invoke(t, { action: 'screens', db: fakeSupabase({ fail: { admin_screens: { code: '57014', message: 'timeout' } } }) });
  assert.deepEqual(db.json, { error: 'db', code: '57014' });
});

test('admin: users — поиск, страницы и размер; user — карточка с отзывами, вызовами агента и экранами, без переписки', async (t) => {
  const r = await invoke(t, { action: 'users', params: { q: '  person ', page: 2, per: 10 } });
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.db.calls.find((c) => c[0] === 'rpc'), ['rpc', 'admin_users_list', { p_q: 'person', p_limit: 10, p_offset: 10, p_id: null, p_access: null }]);
  assert.equal(r.json.total, 1, 'поиск по части почты');
  assert.deepEqual([r.json.page, r.json.per], [2, 10]);
  assert.deepEqual(Object.keys(r.json.rows[0]).sort(), ['aiAccess', 'aiCalls7', 'createdAt', 'email', 'feedback', 'id', 'lastActiveDay', 'lastSignInAt', 'projects', 'provider', 'tasks']);
  const plain = await invoke(t, { action: 'users' });
  assert.deepEqual(plain.db.calls.find((c) => c[0] === 'rpc')[2], { p_q: null, p_limit: 50, p_offset: 0, p_id: null, p_access: null }, 'без фильтра p_access пуст — база отдаёт всех');
  assert.deepEqual(plain.json.rows.map((u) => [u.email, u.aiAccess]), [[USER_EMAIL, true], [ADMIN_EMAIL, false]]);
  for (const params of [{ per: 0 }, { per: 101 }, { page: 0 }, { page: 1.5 }, { q: 5 }, { q: 'x'.repeat(101) }, { access: 'maybe' }, { access: true }, { access: 1 }]) {
    assert.equal((await invoke(t, { action: 'users', params })).status, 400, JSON.stringify(params));
  }
  // Фильтр по доступу к агенту: уходит в базу как p_access, total и строки — отобранные.
  const yes = await invoke(t, { action: 'users', params: { access: 'yes' } });
  assert.deepEqual(yes.db.calls.find((c) => c[0] === 'rpc')[2], { p_q: null, p_limit: 50, p_offset: 0, p_id: null, p_access: 'yes' });
  assert.deepEqual([yes.json.total, yes.json.rows.map((u) => u.email)], [1, [USER_EMAIL]]);
  const no = await invoke(t, { action: 'users', params: { access: 'no', q: 'owner' } });
  assert.deepEqual(no.db.calls.find((c) => c[0] === 'rpc')[2], { p_q: 'owner', p_limit: 50, p_offset: 0, p_id: null, p_access: 'no' });
  assert.deepEqual([no.json.total, no.json.rows.map((u) => u.email)], [1, [ADMIN_EMAIL]]);
  for (const access of ['all', null]) {
    const all = await invoke(t, { action: 'users', params: { access } });
    assert.equal(all.status, 200, String(access));
    assert.equal(all.db.calls.find((c) => c[0] === 'rpc')[2].p_access, null, `${access} — это «все», фильтра в базе нет`);
    assert.equal(all.json.total, 2);
  }

  const u = await invoke(t, { action: 'user', params: { id: USER_ID.toUpperCase() } });
  assert.equal(u.status, 200, u.text.slice(0, 200));
  assert.equal(u.json.user.id, USER_ID);
  assert.deepEqual(u.json.user.providers, ['email', 'google']);
  assert.equal(u.json.user.mfaFactors, 0);
  assert.equal(u.json.user.emailConfirmedAt, '2026-10-01T00:00:00Z');
  assert.deepEqual(u.json.feedback.map((f) => f.id), [FB_ACCOUNT]);
  assert.deepEqual(Object.keys(u.json.aiCalls[0]).sort(), ['counted', 'createdAt', 'inputTokens', 'model', 'ms', 'outputTokens', 'stopReason', 'units']);
  assert.deepEqual(u.json.screens.map((s) => [s.screen, s.platform, s.views]), [['projects', 'web', 3], ['task', 'android', 2]]);
  assert.equal((await invoke(t, { action: 'user', params: { id: '00000000-0000-4000-8000-000000000000' } })).status, 404);
  assert.equal((await invoke(t, { action: 'user', params: { id: 'u1' } })).status, 400);
});

// --- обратная связь -----------------------------------------------------------------

test('admin: feedback.list — почта у аккаунта и null у гостя, снимок по подписанной ссылке на 10 минут, ответы; фильтр по статусу', async (t) => {
  const db = fakeSupabase();
  db.tables.feedback_replies.push({ id: 'r1', feedback_id: FB_ACCOUNT, body: 'Уже чиним', sent_at: '2026-10-22T11:00:00Z', email_status: 'sent', created_at: '2026-10-22T11:00:00Z' });
  const r = await invoke(t, { action: 'feedback.list', db });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.total, 2);
  const [acc, guest] = r.json.rows;
  assert.deepEqual(Object.keys(acc).sort(), ['appVersion', 'createdAt', 'device', 'email', 'id', 'kind', 'lang', 'platform', 'replies', 'screenshotUrl', 'status', 'text', 'userId']);
  assert.equal(acc.email, USER_EMAIL);
  assert.equal(guest.email, null);
  assert.match(acc.screenshotUrl, /\/storage\/v1\/object\/sign\/feedback\/.+\.png\?token=/);
  assert.equal(guest.screenshotUrl, null);
  assert.deepEqual(db.signed, [{ paths: [`${FB_ACCOUNT}.png`], ttl: 600 }], 'подписанная ссылка — 600 с');
  assert.deepEqual(acc.replies, [{ id: 'r1', body: 'Уже чиним', sentAt: '2026-10-22T11:00:00Z', emailStatus: 'sent', createdAt: '2026-10-22T11:00:00Z' }]);
  const fn = await loadFunction();
  assert.equal(fn.mod.SIGNED_URL_TTL, 600);

  db.tables.feedback[1].status = 'closed';
  const onlyNew = await invoke(t, { action: 'feedback.list', params: { status: 'new' }, db });
  assert.deepEqual(onlyNew.json.rows.map((x) => x.id), [FB_ACCOUNT]);
  assert.ok(onlyNew.db.calls.some((c) => c[0] === 'select' && c[1] === 'feedback' && c[2].includes('status=new')));
  assert.equal((await invoke(t, { action: 'feedback.list', params: { status: 'spam' } })).status, 400);
  // Колонки status ещё нет — setup.
  const setup = await invoke(t, { action: 'feedback.list', db: fakeSupabase({ fail: { feedback: { code: '42703', message: 'column feedback.status does not exist' } } }) });
  assert.deepEqual(setup.json, { error: 'setup', code: '42703' });
});

test('admin: feedback.reply без ключа Resend — not_configured, ответ сохранён, отзыв остаётся new; у гостя — 400 no email', async (t) => {
  const r = await invoke(t, { action: 'feedback.reply', params: { id: FB_ACCOUNT, body: '  Спасибо, починили в 0.5.2.\r\n' } });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.emailStatus, 'not_configured');
  assert.equal(r.json.status, 'new');
  assert.equal(r.json.reply.body, 'Спасибо, починили в 0.5.2.');
  assert.equal(r.json.reply.emailStatus, 'not_configured');
  assert.equal(r.json.reply.sentAt, null);
  assert.equal(r.sent.length, 0, 'письмо не уходило');
  assert.deepEqual(r.db.tables.feedback_replies.map((x) => [x.feedback_id, x.body, x.email_status]), [[FB_ACCOUNT, 'Спасибо, починили в 0.5.2.', 'not_configured']]);
  assert.equal(r.db.tables.feedback.find((f) => f.id === FB_ACCOUNT).status, 'new', 'не ушло — не answered');
  // Только один ключ из двух — тоже не настроено.
  const half = await invoke(t, { action: 'feedback.reply', params: { id: FB_ACCOUNT, body: 'x' }, env: { RESEND_API_KEY: RESEND } });
  assert.equal(half.json.emailStatus, 'not_configured');
  assert.equal(half.sent.length, 0);

  const guest = await invoke(t, { action: 'feedback.reply', params: { id: FB_GUEST, body: 'Ответ гостю' }, env: { RESEND_API_KEY: RESEND, FEEDBACK_FROM: 'Lancible <hello@lancible.app>' } });
  assert.equal(guest.status, 400);
  assert.deepEqual(guest.json, { error: 'no email' });
  assert.equal(guest.db.tables.feedback_replies.length, 0, 'гостю ответ не сохраняется: отправить некуда');
  assert.equal(guest.sent.length, 0);
  for (const params of [{ id: FB_ACCOUNT, body: '   ' }, { id: FB_ACCOUNT, body: 'я'.repeat(4001) }, { id: 'x', body: 'a' }, { id: FB_ACCOUNT }]) {
    assert.equal((await invoke(t, { action: 'feedback.reply', params })).status, 400, JSON.stringify(params).slice(0, 60));
  }
  assert.equal((await invoke(t, { action: 'feedback.reply', params: { id: '00000000-0000-4000-8000-000000000000', body: 'a' } })).status, 404);
});

test('admin: feedback.reply с Resend — письмо на языке отзыва с цитатой, ушло — sent и отзыв answered; сбой — failed', async (t) => {
  const env = { RESEND_API_KEY: RESEND, FEEDBACK_FROM: 'Lancible <hello@lancible.app>' };
  const ok = await invoke(t, {
    action: 'feedback.reply', params: { id: FB_ACCOUNT, body: 'Дякуємо! <b>Виправили</b>.' }, env,
    routes: { 'https://api.resend.com/emails': () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }) },
  });
  if (!ok) return;
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  assert.equal(ok.json.emailStatus, 'sent');
  assert.equal(ok.json.status, 'answered', 'отзыв — answered, админка обновит строку без перечитывания');
  assert.ok(ok.json.reply.sentAt);
  assert.equal(ok.sent.length, 1);
  const [mail] = ok.sent;
  assert.equal(mail.url, 'https://api.resend.com/emails');
  assert.equal(mail.method, 'POST');
  assert.equal(mail.headers.Authorization, `Bearer ${RESEND}`);
  assert.match(mail.headers['Idempotency-Key'], /^feedback-reply-/);
  assert.equal(mail.body.from, env.FEEDBACK_FROM);
  assert.deepEqual(mail.body.to, [USER_EMAIL]);
  assert.equal(mail.body.subject, 'Відповідь на ваше звернення в Lancible', 'язык письма — по feedback.lang (uk)');
  assert.match(mail.body.text, /^Вітаємо!\n\nДякуємо! <b>Виправили<\/b>\.\n\nВаше повідомлення від 2026-10-22:\n> Кнопка «Старт» не нажимается\n> вторая строка\n\n— Команда Lancible\n$/);
  assert.ok(mail.body.html.includes('&lt;b&gt;Виправили&lt;/b&gt;'), 'в HTML текст экранирован');
  assert.ok(mail.body.html.includes('<blockquote'), 'исходный отзыв — цитатой');
  assert.equal(ok.db.tables.feedback.find((f) => f.id === FB_ACCOUNT).status, 'answered');
  assert.equal(ok.db.tables.feedback_replies[0].email_status, 'sent');
  assert.deepEqual(ok.logs, []);

  const failed = await invoke(t, {
    action: 'feedback.reply', params: { id: FB_ACCOUNT, body: 'Ещё раз' }, env,
    routes: { 'https://api.resend.com/emails': () => new Response(JSON.stringify({ name: 'validation_error', message: `Invalid \`to\` field: ${USER_EMAIL} (key ${RESEND})` }), { status: 422 }) },
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.json.emailStatus, 'failed');
  assert.equal(failed.json.status, 'new');
  assert.equal(failed.json.reply.sentAt, null);
  assert.equal(failed.db.tables.feedback.find((f) => f.id === FB_ACCOUNT).status, 'new');
  assert.deepEqual(failed.logs, ['admin: resend 422 validation_error'], 'в логе — код и имя ошибки, без почты и ключа');
  const down = await invoke(t, {
    action: 'feedback.reply', params: { id: FB_ACCOUNT, body: 'Сеть' }, env,
    routes: { 'https://api.resend.com/emails': () => { throw new TypeError(`error sending request for url (https://api.resend.com/emails) ${USER_EMAIL}`); } },
  });
  assert.equal(down.json.emailStatus, 'failed');
  assert.deepEqual(down.logs, ['admin: resend network TypeError']);

  const fn = await loadFunction();
  for (const [lang, subject] of [['ru', 'Ответ на ваше обращение в Lancible'], ['en', 'Reply to your Lancible feedback'], ['kk', 'Lancible-ге жолдаған хабарламаңызға жауап'], ['ru-RU', 'Ответ на ваше обращение в Lancible'], ['de', 'Reply to your Lancible feedback'], [null, 'Reply to your Lancible feedback']]) {
    assert.equal(fn.mod.replyMail(lang, 'a', { text: 'b', created_at: '2026-10-22T10:00:00Z' }).subject, subject, String(lang));
  }
});

test('admin: feedback.status — new, answered, closed; чужое — 400, нет такого — 404', async (t) => {
  const r = await invoke(t, { action: 'feedback.status', params: { id: FB_GUEST, status: 'closed' } });
  if (!r) return;
  assert.deepEqual(r.json, { ok: true, id: FB_GUEST, status: 'closed' });
  assert.equal(r.db.tables.feedback.find((f) => f.id === FB_GUEST).status, 'closed');
  assert.equal((await invoke(t, { action: 'feedback.status', params: { id: FB_GUEST, status: 'deleted' } })).status, 400);
  assert.equal((await invoke(t, { action: 'feedback.status', params: { id: '00000000-0000-4000-8000-000000000000', status: 'new' } })).status, 404);
});

// --- настройки агента и доступ --------------------------------------------------------

test('admin: settings.get — действующие значения и откуда они; секреты — только «задан / не задан»', async (t) => {
  const db = fakeSupabase();
  db.tables.app_settings.push({ key: 'ai.model', value: 'claude-opus-5-5', updated_at: '2026-10-23T07:00:00Z' }, { key: 'ai.effort', value: 'turbo', updated_at: '2026-10-23T07:00:00Z' });
  const env = { AI_DAILY_LIMIT: '40', ANTHROPIC_API_KEY: 'sk-ant-NOT-A-REAL-KEY-0000', TELEGRAM_BOT_TOKEN: '7012345678:AAF-not-real', GITHUB_RELEASE_TOKEN: GITHUB };
  const r = await invoke(t, { action: 'settings.get', db, env });
  if (!r) return;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.ai, { model: 'claude-opus-5-5', effort: 'medium', dailyLimit: 40, dailyUnits: 4000000 });
  assert.deepEqual(r.json.source, { model: 'settings', effort: 'default', dailyLimit: 'secret', dailyUnits: 'default' }, 'чужое значение в таблице — как будто его нет');
  assert.deepEqual(r.json.options.models, ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
  assert.deepEqual(r.json.options.efforts, ['low', 'medium', 'high']);
  assert.equal(r.json.secrets.ANTHROPIC_API_KEY, true);
  assert.equal(r.json.secrets.RESEND_API_KEY, false);
  assert.equal(r.json.secrets.GITHUB_RELEASE_TOKEN, true);
  assert.ok(Object.values(r.json.secrets).every((v) => typeof v === 'boolean'));
  for (const v of Object.values(env)) if (!/^\d+$/.test(v)) assert.ok(!r.text.includes(v), 'значения секретов в ответ не попадают');
  assert.ok(!r.text.includes(SERVICE));
});

test('admin: settings.set — белый список: модель из списка ai-chat, усилие low/medium/high, целые в пределах; чужое — 400 и ничего не пишется', async (t) => {
  const r = await invoke(t, { action: 'settings.set', params: { ai: { model: 'claude-haiku-5-5', effort: 'low', dailyLimit: 20, dailyUnits: 2_000_000 } } });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.deepEqual(r.json.ai, { model: 'claude-haiku-5-5', effort: 'low', dailyLimit: 20, dailyUnits: 2000000 });
  assert.deepEqual(r.db.tables.app_settings.map((x) => [x.key, x.value]).sort(), [['ai.daily_limit', 20], ['ai.daily_units', 2000000], ['ai.effort', 'low'], ['ai.model', 'claude-haiku-5-5']]);
  // null — вернуть к секрету или умолчанию.
  const db = r.db;
  const reset = await invoke(t, { action: 'settings.set', params: { ai: { model: null } }, db });
  assert.equal(reset.json.ai.model, 'claude-sonnet-5-5');
  assert.equal(reset.json.source.model, 'default');
  assert.ok(!db.tables.app_settings.some((x) => x.key === 'ai.model'));
  const bad = [
    [{ model: 'gpt-5' }, 'model'], [{ model: 'claude-sonnet-5-5 ' }, 'model'], [{ effort: 'max' }, 'effort'], [{ effort: 'LOW' }, 'effort'],
    [{ dailyLimit: 0 }, 'dailyLimit'], [{ dailyLimit: 1001 }, 'dailyLimit'], [{ dailyLimit: 1.5 }, 'dailyLimit'], [{ dailyLimit: '50' }, 'dailyLimit'],
    [{ dailyUnits: 9999 }, 'dailyUnits'], [{ dailyUnits: 1e9 }, 'dailyUnits'], [{ temperature: 1 }, 'temperature'],
    [{ effort: 'high', model: 'o3' }, 'model'],
  ];
  for (const [ai, field] of bad) {
    const before = JSON.stringify(db.tables.app_settings);
    const x = await invoke(t, { action: 'settings.set', params: { ai }, db });
    assert.equal(x.status, 400, JSON.stringify(ai));
    assert.deepEqual(x.json, { error: 'bad value', field }, JSON.stringify(ai));
    assert.equal(JSON.stringify(db.tables.app_settings), before, `${JSON.stringify(ai)}: ничего не записано`);
  }
  for (const params of [{}, { ai: {} }, { ai: 'claude' }]) assert.equal((await invoke(t, { action: 'settings.set', params })).status, 400);
});

test('admin: белые списки настроек — те же, что у ai-chat (MODELS, EFFORTS, SETTING_LIMITS)', async (t) => {
  const fn = await loadFunction();
  if (!fn) { t.skip('нет esbuild'); return; }
  const chat = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'ai-chat', 'index.ts'), 'utf8');
  const list = (re) => JSON.parse(chat.match(re)[1].replace(/'/g, '"').replace(/_/g, ''));
  assert.deepEqual(fn.mod.AI_MODELS, list(/export const MODELS = (\[[^\]]*\])/));
  assert.deepEqual(fn.mod.AI_EFFORTS, list(/const EFFORTS = new Set\((\[[^\]]*\])\)/));
  const limits = chat.match(/export const SETTING_LIMITS = \{ dailyLimit: (\[[^\]]*\]), dailyUnits: (\[[^\]]*\]) \}/);
  assert.ok(limits, 'SETTING_LIMITS в ai-chat — поправить разбор в тесте');
  assert.deepEqual(fn.mod.AI_RANGES, { dailyLimit: JSON.parse(limits[1].replace(/_/g, '')), dailyUnits: JSON.parse(limits[2].replace(/_/g, '')) });
  assert.match(chat, /const DEFAULT_MODEL = 'claude-sonnet-5-5';/, 'умолчание ai-chat — то же, что у админки');
  assert.ok(fn.mod.AI_MODELS.includes('claude-sonnet-5-5'));
});

test('admin: access.list/add/remove — ai_access; почта в нижний регистр, кривая — 400', async (t) => {
  const r = await invoke(t, { action: 'access.list' });
  if (!r) return;
  assert.deepEqual(r.json, { ok: true, rows: [{ email: USER_EMAIL, note: 'тест', grantedAt: '2026-10-21T00:00:00Z', userId: USER_ID }] });
  const add = await invoke(t, { action: 'access.add', params: { email: '  New.Person@Example.COM ', note: 'друг' } });
  assert.equal(add.status, 200);
  assert.ok(add.db.tables.ai_access.some((a) => a.email === 'new.person@example.com' && a.note === 'друг'));
  assert.equal(add.json.rows.length, 2);
  assert.equal(add.json.account, false, 'аккаунта с такой почтой нет — в ответе account: false');
  const again = await invoke(t, { action: 'access.add', params: { email: USER_EMAIL, note: 'другая пометка' }, db: add.db });
  assert.equal(again.status, 200, 'повторная выдача — не ошибка');
  assert.equal(again.json.account, true, 'аккаунт есть — account: true');
  assert.equal(again.db.tables.ai_access.filter((a) => a.email === USER_EMAIL).length, 1, 'повтор — без копии');
  assert.equal(again.db.tables.ai_access.find((a) => a.email === USER_EMAIL).granted_at, '2026-10-21T00:00:00Z', 'время выдачи не меняется');
  assert.equal(again.db.tables.ai_access.find((a) => a.email === USER_EMAIL).note, 'другая пометка', 'пометка обновляется');
  // Почта в другом регистре и с пробелами — та же запись, а не вторая.
  const mixed = await invoke(t, { action: 'access.add', params: { email: `  ${USER_EMAIL.toUpperCase()} ` }, db: again.db });
  assert.equal(mixed.db.tables.ai_access.filter((a) => a.email === USER_EMAIL).length, 1);
  assert.equal(mixed.json.account, true);
  const rm = await invoke(t, { action: 'access.remove', params: { email: USER_EMAIL.toUpperCase() }, db: again.db });
  assert.deepEqual(rm.json.rows.map((x) => x.email), ['new.person@example.com']);
  for (const email of ['', 'no-at', 'a@b', 'a b@c.d', 5, `${'a'.repeat(250)}@b.cd`]) {
    assert.equal((await invoke(t, { action: 'access.add', params: { email } })).status, 400, String(email).slice(0, 20));
  }
  assert.equal((await invoke(t, { action: 'access.add', params: { email: 'a@b.cd', note: 5 } })).status, 400);
});

test('admin: access.add с requireAccount — без аккаунта 409 и ничего не пишется, с аккаунтом выдаёт; не boolean — 400', async (t) => {
  const none = await invoke(t, { action: 'access.add', params: { email: ' Nobody@Example.COM ', note: 'x', requireAccount: true } });
  if (!none) return;
  assert.equal(none.status, 409);
  assert.deepEqual(none.json, { error: 'no account' });
  assert.ok(!none.db.tables.ai_access.some((a) => a.email === 'nobody@example.com'), 'запись не появилась');
  assert.ok(!none.db.calls.some((c) => c[0] === 'upsert'), 'в базу не писали');
  // Точное совпадение, а не часть почты: поиск по части найдёт person.private@example.org, но эта почта — другая.
  const part = await invoke(t, { action: 'access.add', params: { email: 'person.private@example.o', requireAccount: true } });
  assert.equal(part.status, 409);
  // Аккаунт есть (админ без доступа) — выдаёт, регистр не важен.
  const yes = await invoke(t, { action: 'access.add', params: { email: ADMIN_EMAIL.toUpperCase(), note: 'из списка', requireAccount: true } });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.account, true);
  assert.ok(yes.db.tables.ai_access.some((a) => a.email === ADMIN_EMAIL && a.note === 'из списка'));
  assert.deepEqual(yes.db.calls.find((c) => c[0] === 'rpc' && c[1] === 'admin_users_list')[2], { p_q: ADMIN_EMAIL, p_limit: 100, p_offset: 0, p_id: null });
  // Без флага — как раньше: выдаёт и без аккаунта.
  const open = await invoke(t, { action: 'access.add', params: { email: 'nobody@example.com', requireAccount: false } });
  assert.equal(open.status, 200);
  assert.equal(open.json.account, false);
  for (const requireAccount of ['true', 1, null, {}]) {
    assert.equal((await invoke(t, { action: 'access.add', params: { email: ADMIN_EMAIL, requireAccount } })).status, 400, String(requireAccount));
  }
  // Сбой базы при проверке — 500 с кодом, без записи.
  const down = await invoke(t, { action: 'access.add', params: { email: ADMIN_EMAIL, requireAccount: true }, db: fakeSupabase({ fail: { admin_users_list: { code: '57014', message: 'timeout' } } }) });
  assert.deepEqual(down.json, { error: 'db', code: '57014' });
  assert.ok(!down.db.calls.some((c) => c[0] === 'upsert'));
});

// --- посты и выпуск ----------------------------------------------------------------------

const POST = { date: '2026-10-23', tag: 'feature', version: '0.6.0', title: { ru: 'Админка', en: 'Admin' }, body: { ru: ['Абзац'], en: ['Paragraph'] }, published: true };

test('admin: posts.list/save/delete — свежие первыми; новый — вставкой, с id — правкой; чужое — 400', async (t) => {
  const r = await invoke(t, { action: 'posts.save', params: { post: POST } });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.deepEqual(Object.keys(r.json.post).sort(), ['body', 'createdAt', 'date', 'id', 'published', 'tag', 'title', 'updatedAt', 'version']);
  assert.equal(r.json.post.published, true);
  const db = r.db;
  const list = await invoke(t, { action: 'posts.list', db });
  assert.deepEqual(list.json.rows.map((p) => p.date), ['2026-10-23', '2026-10-21']);
  const id = r.json.post.id;
  const edit = await invoke(t, { action: 'posts.save', params: { post: { ...POST, id, published: false, title: { ru: '  Админ   панель ', en: 'Admin panel' } } }, db });
  assert.equal(edit.json.post.published, false);
  assert.deepEqual(edit.json.post.title, { ru: 'Админ панель', en: 'Admin panel' });
  assert.equal(db.tables.blog_posts.length, 2, 'правка — без новой строки');
  const bad = [
    [{ ...POST, tag: 'news' }, 'post.tag'], [{ ...POST, date: '2026-02-30' }, 'post.date'], [{ ...POST, date: '23.10.2026' }, 'post.date'],
    [{ ...POST, title: { ru: 'Только ru' } }, 'post.title.en'], [{ ...POST, body: { ru: [], en: ['a'] } }, 'post.body.ru'],
    [{ ...POST, body: { ru: ['a', ''], en: ['a'] } }, 'post.body.ru'], [{ ...POST, version: 'v'.repeat(61) }, 'post.version'],
    [{ ...POST, published: 'yes' }, 'post.published'], [{ ...POST, id: 'p1' }, 'post.id'], ['пост', 'post'],
  ];
  for (const [post, detail] of bad) {
    const x = await invoke(t, { action: 'posts.save', params: { post }, db });
    assert.equal(x.status, 400, detail);
    assert.equal(x.json.detail, detail);
  }
  assert.equal((await invoke(t, { action: 'posts.save', params: { post: { ...POST, id: '00000000-0000-4000-8000-000000000000' } }, db })).status, 404);
  const del = await invoke(t, { action: 'posts.delete', params: { id }, db });
  assert.deepEqual(del.json, { ok: true, id });
  assert.equal(db.tables.blog_posts.length, 1);
  assert.equal((await invoke(t, { action: 'posts.delete', params: { id }, db })).status, 404);
});

/** Публичный мир для releases.status. */
const RELEASE_ROUTES = {
  'https://raw.githubusercontent.com/lancibleofficial/Lancible/main/package.json': () => new Response(JSON.stringify({ version: '0.5.1' })),
  'https://raw.githubusercontent.com/lancibleofficial/Lancible/main/mobile/app.json': () => new Response(JSON.stringify({ expo: { version: '1.3.1', android: { versionCode: 10 } } })),
  'https://api.github.com/repos/lancibleofficial/Lancible/releases': () => new Response(JSON.stringify([{ tag_name: 'v0.5.1', name: '0.5.1', published_at: '2026-10-21T10:00:00Z', draft: false, prerelease: false, html_url: 'https://github.com/x', assets: [{ name: 'Lancible.Setup.0.5.1.exe' }] }])),
  'https://api.github.com/repos/lancibleofficial/Lancible/actions/workflows/publish.yml/runs': () => new Response('{"message":"Not Found"}', { status: 404 }),
  'https://example.supabase.co/storage/v1/object/public/releases/latest.yml': () => new Response("version: 0.5.1\nfiles:\n  - url: https://r2/x.exe\nreleaseDate: '2026-10-21T10:00:00.000Z'\n"),
  'https://example.supabase.co/storage/v1/object/public/releases/latest-mac.yml': () => new Response('version: 0.5.0\nreleaseDate: "2026-10-20T10:00:00.000Z"\n'),
  'https://raw.githubusercontent.com/lancibleofficial/lancible-updates/main/latest.json': () => new Response(JSON.stringify({ android: { version: '1.3.1', url: 'https://r2/a.apk', size: 96000000 }, ios: { version: '1.0.0' } })),
  'https://lancible.vercel.app/': () => new Response('<a href="https://pub.r2.dev/v0.5.1/Lancible.Setup.0.5.1.exe">x</a><a href="https://pub.r2.dev/v0.5.1/Lancible-0.5.1-universal.dmg">y</a><a href="https://pub.r2.dev/mobile-v1.3.1/Lancible-1.3.1.apk">z</a>'),
};

test('admin: releases.status — версии в main, релизы, манифесты, latest.json, кнопки лендинга; токен — только в GitHub API', async (t) => {
  const r = await invoke(t, { action: 'releases.status', env: { GITHUB_RELEASE_TOKEN: GITHUB }, routes: RELEASE_ROUTES });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.deepEqual(r.json.main, { desktop: '0.5.1', mobile: '1.3.1', versionCode: 10 });
  assert.equal(r.json.releases[0].tag, 'v0.5.1');
  assert.deepEqual(r.json.releases[0].assets, ['Lancible.Setup.0.5.1.exe']);
  assert.deepEqual(r.json.manifests, {
    'latest.yml': { version: '0.5.1', releaseDate: '2026-10-21T10:00:00.000Z' },
    'latest-mac.yml': { version: '0.5.0', releaseDate: '2026-10-20T10:00:00.000Z' },
    'latest.json': { version: '1.3.1', url: 'https://r2/a.apk', size: 96000000, ios: { version: '1.0.0', url: null, size: null } },
  });
  assert.deepEqual(r.json.landing, { desktop: '0.5.1', mobile: '1.3.1', exe: '0.5.1', dmg: '0.5.1', apk: '1.3.1' });
  assert.deepEqual(r.json.runs, [], 'workflow ещё не заведён — пустой список');
  assert.deepEqual(r.json.errors, { runs: 'http 404' });
  assert.equal(r.json.token, true);
  assert.equal(r.json.workflow, 'publish.yml');
  for (const s of r.sent) {
    const auth = s.headers.Authorization;
    if (s.url.startsWith('https://api.github.com/')) assert.equal(auth, `Bearer ${GITHUB}`, s.url);
    else assert.equal(auth, undefined, `токен не уходит на ${s.url}`);
  }
  assert.ok(!r.text.includes(GITHUB));
  // Запуски publish.yml: у свежих — работы и шаги, у упавшей работы — шаг, на котором упало.
  const runs = (u) => (u.includes('/actions/workflows/publish.yml/runs')
    ? new Response(JSON.stringify({ workflow_runs: [
      { id: 501, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', display_title: 'Выпуск', created_at: '2026-10-23T09:00:00Z', html_url: 'https://github.com/r/501' },
      { id: 400, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', display_title: 'Выпуск', created_at: '2026-10-20T09:00:00Z', html_url: 'https://github.com/r/400' },
    ] }))
    : u.includes('/actions/runs/501/jobs')
      ? new Response(JSON.stringify({ jobs: [
        { name: 'Тесты (Linux)', status: 'completed', conclusion: 'success', html_url: 'https://github.com/j/1', steps: [{ number: 1, name: 'npm test', status: 'completed', conclusion: 'success' }] },
        { name: 'Тесты (Windows, со снимками)', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/j/2', steps: [
          { number: 1, name: 'Подготовка (setup-worktree)', status: 'completed', conclusion: 'success' },
          { number: 2, name: 'Полный набор со снимками (npm test)', status: 'completed', conclusion: 'failure' },
          { number: 3, name: 'Отчёт', status: 'completed', conclusion: 'skipped' },
        ] },
        { name: 'Версии и теги', status: 'completed', conclusion: 'skipped', steps: [] },
      ] }))
      : new Response('{"message":"Server Error"}', { status: 500 }));
  const withRuns = await invoke(t, { action: 'releases.status', env: { GITHUB_RELEASE_TOKEN: GITHUB }, routes: { 'https://api.github.com/repos/lancibleofficial/Lancible/actions/': runs, ...RELEASE_ROUTES } });
  assert.equal(withRuns.json.runs.length, 2);
  const [last, prev] = withRuns.json.runs;
  assert.deepEqual([last.id, last.conclusion], [501, 'failure']);
  assert.deepEqual(last.jobs.map((j) => [j.name, j.conclusion, j.failedStep]), [
    ['Тесты (Linux)', 'success', null], ['Тесты (Windows, со снимками)', 'failure', 'Полный набор со снимками (npm test)'], ['Версии и теги', 'skipped', null],
  ]);
  assert.equal(last.jobs[1].steps.length, 3);
  assert.equal(prev.jobsError, 'http 500', 'работы не прочитались — причина, а не 500 всего ответа');
  assert.equal(withRuns.json.errors.runs, undefined);
  assert.ok(withRuns.sent.some((s) => s.url.startsWith('https://api.github.com/repos/lancibleofficial/Lancible/actions/runs/501/jobs')));
  // Без токена — те же запросы без Authorization; сеть упала — errors, а не 500.
  const bare = await invoke(t, { action: 'releases.status', routes: { ...RELEASE_ROUTES, 'https://lancible.vercel.app/': () => { throw new TypeError('network'); } } });
  assert.equal(bare.status, 200);
  assert.equal(bare.json.token, false);
  assert.equal(bare.json.landing, null);
  assert.equal(bare.json.errors.landing, 'network');
  assert.ok(bare.sent.every((s) => s.headers.Authorization === undefined));
});

test('admin: releases.start без токена — 400 no github token; с токеном — workflow_dispatch publish.yml в main с desktop_version/mobile_version', async (t) => {
  const none = await invoke(t, { action: 'releases.start', params: { desktop: '0.5.2' } });
  if (!none) return;
  assert.equal(none.status, 400);
  assert.deepEqual(none.json, { error: 'no github token' });
  assert.equal(none.sent.length, 0);
  const env = { GITHUB_RELEASE_TOKEN: GITHUB };
  const dispatch = 'https://api.github.com/repos/lancibleofficial/Lancible/actions/workflows/publish.yml/dispatches';
  const r = await invoke(t, { action: 'releases.start', params: { desktop: '0.5.2', mobile: '1.3.2' }, env, routes: { [dispatch]: () => new Response(null, { status: 204 }) } });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.deepEqual(r.json, { ok: true, url: 'https://github.com/lancibleofficial/Lancible/actions/workflows/publish.yml', inputs: { desktop_version: '0.5.2', mobile_version: '1.3.2' } });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, dispatch);
  assert.equal(r.sent[0].method, 'POST');
  assert.equal(r.sent[0].headers.Authorization, `Bearer ${GITHUB}`);
  assert.deepEqual(r.sent[0].body, { ref: 'main', inputs: { desktop_version: '0.5.2', mobile_version: '1.3.2' } });
  const mobileOnly = await invoke(t, { action: 'releases.start', params: { mobile: '1.3.2' }, env, routes: { [dispatch]: () => new Response(null, { status: 204 }) } });
  assert.deepEqual(mobileOnly.sent[0].body.inputs, { mobile_version: '1.3.2' });
  for (const [params, field] of [[{ desktop: 'v0.5.2' }, 'desktop'], [{ mobile: '1.3' }, 'mobile'], [{ desktop: '0.5.2; rm -rf' }, 'desktop'], [{ desktop: 52 }, 'desktop']]) {
    const x = await invoke(t, { action: 'releases.start', params, env });
    assert.deepEqual(x.json, { error: 'bad version', field }, JSON.stringify(params));
    assert.equal(x.sent.length, 0);
  }
  assert.equal((await invoke(t, { action: 'releases.start', params: {}, env })).status, 400, 'ни одной версии — 400');
  const gh = await invoke(t, { action: 'releases.start', params: { desktop: '0.5.2' }, env, routes: { [dispatch]: () => new Response('{"message":"Unexpected inputs provided"}', { status: 422 }) } });
  assert.equal(gh.status, 502);
  assert.deepEqual(gh.json, { error: 'github', status: 422 });
  assert.deepEqual(gh.logs, ['admin: github dispatch 422']);
});

// --- журнал работы -------------------------------------------------------------------

test('admin: logs.list — журнал только админу со вторым фактором; не админ и без aal2 до таблиц журнала не доходят', async (t) => {
  const user = await invoke(t, { action: 'logs.list', token: TOKENS.user2 });
  if (!user) return;
  assert.equal(user.status, 403);
  assert.deepEqual(user.json, { error: 'forbidden' });
  const mfa = await invoke(t, { action: 'logs.list', token: TOKENS.admin1 });
  assert.equal(mfa.status, 403);
  assert.deepEqual(mfa.json, { error: 'mfa' });
  const none = await invoke(t, { action: 'logs.list', token: null });
  assert.equal(none.status, 401);
  for (const r of [user, mfa, none]) {
    assert.ok(!r.db.calls.some((c) => /^work_log_/.test(String(c[1]))), 'до журнала не дошло');
  }
});

test('admin: logs.list — задачи свежими первыми, события по времени, счётчики статусов и видов; фильтры и страницы', async (t) => {
  const r = await invoke(t, { action: 'logs.list' });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.deepEqual([r.json.total, r.json.page, r.json.per, r.json.status, r.json.kind], [3, 1, 20, 'all', 'all']);
  assert.deepEqual(r.json.rows.map((x) => x.id), ['2026-10-23-c', '2026-10-22-b', '2026-10-20-a'], 'свежие первыми, задача без событий — тоже');
  assert.deepEqual(r.json.counts.statuses, { all: 3, in_progress: 1, review: 1, accepted: 0, deployed: 1 });
  assert.deepEqual(r.json.counts.kinds, { all: 7, request: 1, change: 1, error: 2, fix: 1, check: 1, deploy: 1 });
  const a = r.json.rows[2];
  assert.deepEqual(Object.keys(a).sort(), ['events', 'eventsTotal', 'id', 'round', 'startedAt', 'status', 'summary', 'title', 'updatedAt']);
  assert.deepEqual([a.title, a.summary, a.status, a.round, a.startedAt, a.updatedAt, a.eventsTotal], ['Задача А', 'Сводка А', 'deployed', 2, '2026-10-20T08:00:00Z', '2026-10-21T10:00:00Z', 4]);
  assert.deepEqual(a.events[1], { kind: 'error', title: 'Сломалось', detail: 'Почему', round: 1, at: '2026-10-20T09:00:00Z' }, 'у события — только вид, текст, круг и время');
  assert.deepEqual(r.json.rows[1].events.map((e) => e.kind), ['change', 'error', 'check'], 'события — по времени, а не по порядку записи');
  assert.deepEqual(r.json.rows[0].events, []);

  // Вид события: задачи, где он есть, и только эти события; счётчики — прежние.
  const err = await invoke(t, { action: 'logs.list', params: { kind: 'error' } });
  assert.equal(err.json.total, 2);
  assert.deepEqual(err.json.rows.map((x) => [x.id, x.events.map((e) => e.kind), x.eventsTotal]), [['2026-10-22-b', ['error'], 3], ['2026-10-20-a', ['error'], 4]]);
  assert.equal(err.json.counts.kinds.all, 7);
  // Статус задачи: счётчики видов — по задачам этого статуса.
  const dep = await invoke(t, { action: 'logs.list', params: { status: 'deployed' } });
  assert.deepEqual(dep.json.rows.map((x) => x.id), ['2026-10-20-a']);
  assert.deepEqual(dep.json.counts.kinds, { all: 4, request: 1, change: 0, error: 1, fix: 1, check: 0, deploy: 1 });
  assert.equal(dep.json.counts.statuses.all, 3, 'счётчики статусов — по всему журналу');
  assert.equal((await invoke(t, { action: 'logs.list', params: { status: 'all', kind: 'all' } })).json.total, 3, 'all — то же, что без фильтра');
  // Страницы: подробности событий — только задачам страницы.
  const p2 = await invoke(t, { action: 'logs.list', params: { page: 2, per: 1 } });
  assert.deepEqual([p2.json.total, p2.json.rows.map((x) => x.id)], [3, ['2026-10-22-b']]);
  const full = p2.db.calls.filter((c) => c[0] === 'select' && c[1] === 'work_log_events' && /task_id in/.test(c[2]));
  assert.deepEqual(full.map((c) => c[2]), ['task_id in 1'], 'подробности — одним запросом на задачи страницы');
  for (const params of [{ status: 'done' }, { kind: 'bug' }, { status: 5 }, { page: 0 }, { per: 101 }, { per: 2.5 }]) {
    assert.equal((await invoke(t, { action: 'logs.list', params })).status, 400, JSON.stringify(params));
  }
});

test('admin: logs.list — журнал длиннее 1000 строк читается страницами (у PostgREST предел ответа); нет таблиц — 500 setup', async (t) => {
  const tables = seed();
  for (let i = 0; i < 1205; i += 1) tables.work_log_events.push({ id: 100 + i, task_id: '2026-10-23-c', kind: 'change', title: `шаг ${i}`, detail: null, round: 1, at: `2026-10-23T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` });
  const db = fakeSupabase({ tables });
  // Подмена держит предел PostgREST: без .range() запрос отдал бы всё разом.
  const r = await invoke(t, { action: 'logs.list', params: { status: 'in_progress' }, db });
  if (!r) return;
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.counts.kinds.all, 1205);
  assert.equal(r.json.rows[0].events.length, 1205, 'все события задачи, а не первые 1000');
  const light = r.db.calls.filter((c) => c[0] === 'select' && c[1] === 'work_log_events' && !/task_id in/.test(c[2]));
  assert.equal(light.length, 2, 'лёгкий проход — двумя страницами');
  const missing = await invoke(t, { action: 'logs.list', db: fakeSupabase({ missing: ['work_log_tasks'] }) });
  assert.equal(missing.status, 500);
  assert.deepEqual(missing.json, { error: 'setup', code: 'PGRST205' });
});

test('admin: в логах за весь прогон нет ни ключей и токенов, ни почт', () => {
  assert.ok(LOGS.length > 0, 'логи собраны');
  for (const line of LOGS) {
    for (const secret of [SERVICE, RESEND, GITHUB, 'sk-ant-NOT-A-REAL-KEY', 'AAF-not-real']) assert.ok(!line.includes(secret), `ключ в логе: ${line}`);
    assert.doesNotMatch(line, /@[\w-]+\.[a-z]/i, `почта в логе: ${line}`);
    assert.ok(!line.includes(USER_ID) && !line.includes(ADMIN_ID), `id аккаунта в логе: ${line}`);
    assert.ok(!line.includes('Кнопка') && !line.includes('Спасибо'), `текст отзыва или ответа в логе: ${line}`);
  }
});

// --- локальный сервер ----------------------------------------------------------------

/** Свободный порт на 127.0.0.1. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Поднять scripts/serve-admin.js и дождаться строки с адресом. */
async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-admin.js'), String(port)], {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve-admin не поднялся: ${out}`)), 20000);
    const onData = (d) => { out += d; if (out.includes(`http://localhost:${port}`)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`serve-admin вышел с ${code}: ${out}`)); });
  });
  return { port, child, output: () => out };
}

test('serve-admin: собирает функцию admin и отвечает на POST /functions/v1/admin; ключа в выводе нет; ADMIN_LOCAL_API=0 — только статика', async (t) => {
  try { require.resolve('esbuild'); } catch { t.skip('нет esbuild'); return; }
  const key = 'local-service-NOT-A-REAL-KEY-12345';
  const srv = await startServer({ SUPABASE_SERVICE_ROLE_KEY: key, ADMIN_LOCAL_API: '1' });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    // Без токена функция отвечает 401 сама, до сети: значит, собрана и подключена.
    const r = await realFetch(`${base}/functions/v1/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${srv.port}` }, body: '{"action":"me"}' });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'not signed in' });
    const evil = await realFetch(`${base}/functions/v1/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"action":"me"}' });
    assert.equal(evil.status, 403, 'чужой Origin и локально — отказ');
    const traversal = await realFetch(`${base}/..%2f.env.local`);
    assert.notEqual(traversal.status, 200, '.env.local наружу не отдаётся');
    assert.ok(!(await traversal.text()).includes(key));
    assert.match(srv.output(), /служебн/i, 'в выводе — предупреждение про служебный ключ');
    assert.ok(!srv.output().includes(key), 'самого ключа в выводе нет');
  } finally {
    srv.child.kill();
  }
  const stat = await startServer({ SUPABASE_SERVICE_ROLE_KEY: key, ADMIN_LOCAL_API: '0' });
  try {
    const r = await realFetch(`http://127.0.0.1:${stat.port}/functions/v1/admin`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 404, 'без локального API функция не отвечает');
    assert.ok(!stat.output().includes(key));
  } finally {
    stat.child.kill();
  }
});

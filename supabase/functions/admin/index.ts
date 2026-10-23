// Админ-панель Lancible — Supabase Edge Function (23 октября 2026).
//
//   POST <проект>.supabase.co/functions/v1/admin
//   Authorization: Bearer <токен входа админа, aal2>
//   { action, ...параметры }
//
// Решение пользователя: только веб, один админ — аккаунт владельца, отдельный
// адрес (lancible-admin.vercel.app, корень admin/). Сайт админки статический и
// ключей не держит: всё, что требует служебного ключа, делает эта функция.
// Таблицы и счётчики — supabase/admin.sql.
//
// Кто пускается: токен входа валиден (auth.getUser), аккаунт есть в
// admin_users, и токен выдан после второго фактора — aal = 'aal2' в самом
// JWT (его подпись и сессию только что проверил getUser). Порядок ответов:
//   401 { error: 'not signed in' } — нет токена, токен не пользователя
//   403 { error: 'forbidden' }     — не админ (или нет таблицы admin_users)
//   403 { error: 'mfa' }           — админ, но без второго фактора
// Не админу «mfa» не говорится: чужой не узнаёт, что аккаунт — админский.
//
// CORS — только адрес админки и локальный сервер (scripts/serve-admin.js):
// ORIGINS. Запрос с другим Origin — 403 { error: 'origin' }, ответ на
// предзапрос — без Access-Control-Allow-Origin. Без Origin (не браузер) —
// как обычно: пускает токен, а не адрес.
//
// Ответ — JSON { ok: true, ... } или { error, ... }. Действия:
//   me                           { email, aal }
//   overview      days 7|30|90   { days, users, logins, active, projects,
//                                  tasks, feedback, ai, platforms } — admin_overview()
//   screens       days           { days, rows: [{ screen, platform, views, users }] }
//   users         q, page, per, access?  { total, page, per, rows: [{ id, email,
//                                  createdAt, lastSignInAt, provider, aiAccess, projects,
//                                  tasks, lastActiveDay, feedback, aiCalls7 }] };
//                                  access 'yes' | 'no' — только с доступом к агенту
//                                  или только без него (поиск, страницы и total —
//                                  уже по отфильтрованным), 'all' или без поля — все
//   user          id             { user: {…, emailConfirmedAt, providers, mfaFactors},
//                                  feedback: [...], aiCalls: [...], screens: [...] }
//                                  — без текста переписки (его нигде нет)
//   feedback.list status, page, per  { total, page, per, rows: [{ id, kind, text,
//                                  platform, appVersion, lang, device, createdAt,
//                                  status, userId, email|null, screenshotUrl|null,
//                                  replies: [...] }] } — ссылка на снимок
//                                  подписана на 10 минут
//   feedback.reply id, body      { emailStatus: 'sent'|'failed'|'not_configured',
//                                  status (отзыва), reply } — письмо через
//                                  Resend; ответ сохраняется всегда; гость —
//                                  400 { error: 'no email' }; ушло — статус
//                                  отзыва 'answered'
//   feedback.status id, status   { id, status }
//   settings.get                 { ai: { model, effort, dailyLimit, dailyUnits },
//                                  source: { …: 'settings'|'secret'|'default' },
//                                  options, secrets: { ИМЯ: true|false } }
//   settings.set  ai             то же, что settings.get; чужое значение —
//                                  400 { error: 'bad value', field }, ничего не пишется
//   access.list / access.add / access.remove  email, note, requireAccount?
//                                { rows: [{ email, note, grantedAt, userId|null }] };
//                                access.add — ещё account: есть ли аккаунт с этой
//                                почтой. Почта — в нижний регистр, повторная выдача
//                                не ошибка (пометка обновляется, время выдачи — нет).
//                                requireAccount: true и аккаунта нет — 409 'no
//                                account', ничего не пишется: почта без аккаунта
//                                откроет агента тому, кто первым на неё зарегистрируется
//   posts.list / posts.save / posts.delete  post, id
//                                { rows } / { post } / { id }
//   logs.list     status, kind, page, per  журнал работы (supabase/logs.sql;
//                                клиентам с 23 октября 2026 закрыт): { total,
//                                page, per, status, kind, counts: { statuses:
//                                { all, in_progress, … }, kinds: { all,
//                                request, … } }, rows: [{ id, title, summary,
//                                status, round, startedAt, updatedAt,
//                                eventsTotal, events: [{ kind, title, detail,
//                                round, at }] }] } — задачи свежими первыми,
//                                события по времени; kind оставляет задачи с
//                                событиями этого вида и только их события;
//                                счётчики видов — по задачам выбранного статуса
//   releases.status             { main: { desktop, mobile, versionCode },
//                                  releases, runs, manifests: { 'latest.yml',
//                                  'latest-mac.yml', 'latest.json' }, landing:
//                                  { desktop, mobile, exe, dmg, apk }, token,
//                                  errors } — публичные данные; у трёх
//                                  свежих запусков publish.yml — jobs: [{ name,
//                                  status, conclusion, failedStep, currentStep,
//                                  steps, url }] (сводку запуска REST API не
//                                  отдаёт — работы и шаги вместо неё)
//   releases.start desktop?, mobile?  { url } — workflow_dispatch publish.yml;
//                                  без токена — 400 { error: 'no github token' }
// Прочее: не POST — 405; тело больше 512 КБ — 413; не JSON — 400 'bad json';
// неизвестное действие — 400 'unknown action'; параметры не того вида — 400
// 'bad request' с detail; запись не найдена — 404 'not found'; база ответила
// ошибкой — 500 'db' (или 'setup', когда нет таблицы, колонки или функции —
// не выполнен supabase/admin.sql) с кодом; сеть до GitHub — 502 'github'.
//
// Логи — только действие и коды: ни ключей и токенов, ни почт, ни текста
// отзывов и ответов. Это проверяет tests/backend/admin-function.test.js.
//
// Секреты (Dashboard → Edge Functions → Secrets): RESEND_API_KEY и
// FEEDBACK_FROM — письмо-ответ на отзыв (без них — 'not_configured');
// GITHUB_RELEASE_TOKEN — запуск выпуска и запросы к GitHub API. Значения
// ключей админка видит только как «задан / не задан». SUPABASE_URL и
// SUPABASE_SERVICE_ROLE_KEY у функций есть по умолчанию. Выкладка —
// supabase/functions/README.md, «Админ-панель». Локально та же функция
// работает в Node: npm run serve:admin (scripts/serve-admin.js).

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Json = Record<string, unknown>;
type Admin = ReturnType<typeof createClient>;
type Ctx = { admin: Admin; uid: string; email: string; aal: string };
type Out = { status?: number; body: Json };

/** Откуда пускает браузер: адрес админки и локальный сервер. */
export const ORIGINS = ['https://lancible-admin.vercel.app', 'http://localhost:5175'];
const REPO = 'lancibleofficial/Lancible';
const UPDATES_REPO = 'lancibleofficial/lancible-updates';
export const WORKFLOW = 'publish.yml';
const LANDING_URL = 'https://lancible.vercel.app/';
const DEFAULT_SUPABASE_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
const FEEDBACK_BUCKET = 'feedback';
/** Подписанная ссылка на снимок отзыва живёт 10 минут. */
export const SIGNED_URL_TTL = 600;
const MAX_BODY = 512 * 1024;
const RESEND_URL = 'https://api.resend.com/emails';
/** У скольких свежих запусков publish.yml читать работы и шаги. */
const RUNS_WITH_JOBS = 3;
const NET_TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS = new Set([7, 30, 90]);
const STATUSES = ['new', 'answered', 'closed'];
const TAGS = ['release', 'feature', 'improvement'];

/** Настройки агента — тот же белый список, что у ai-chat (MODELS,
 *  SETTING_LIMITS в supabase/functions/ai-chat/index.ts); совпадение сверяет
 *  тест. Модели — те, что умеют адаптивное рассуждение и effort. */
export const AI_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
export const AI_EFFORTS = ['low', 'medium', 'high'];
export const AI_RANGES = { dailyLimit: [1, 1000], dailyUnits: [10_000, 100_000_000] };
const AI_DEFAULTS = { model: 'claude-sonnet-5-5', effort: 'medium', dailyLimit: 50, dailyUnits: 4_000_000 };
const AI_KEYS: Record<string, string> = { model: 'ai.model', effort: 'ai.effort', dailyLimit: 'ai.daily_limit', dailyUnits: 'ai.daily_units' };
/** Секреты, о которых админка знает «задан / не задан». */
export const SECRET_NAMES = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID', 'AI_MODEL', 'AI_EFFORT', 'AI_DAILY_LIMIT', 'AI_DAILY_UNITS',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_THREAD_ID', 'RESEND_API_KEY', 'FEEDBACK_FROM', 'GITHUB_RELEASE_TOKEN',
];
/** Коды «нет таблицы, колонки или функции»: не выполнен supabase/admin.sql. */
const SETUP_CODES = new Set(['42P01', 'PGRST205', '42703', 'PGRST204', '42883', 'PGRST202']);

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const env = (k: string) => (Deno.env.get(k) || '').trim();

// --- ответ и CORS ------------------------------------------------------------------

/** Заголовки CORS для разрешённого Origin; чужой — null, без Origin — {}. */
export function corsFor(origin: string | null): Record<string, string> | null {
  if (!origin) return {};
  if (!ORIGINS.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function respond(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const ok = (extra: Json = {}): Out => ({ body: { ok: true, ...extra } });
const fail = (status: number, error: string, extra: Json = {}): Out => ({ status, body: { error, ...extra } });
const bad = (detail: string): Out => fail(400, 'bad request', { detail });

/** Ошибка базы: в лог и в ответ — только код. */
function dbFail(where: string, error: { code?: unknown } | null | undefined): Out {
  const code = String(error?.code || 'error').slice(0, 16);
  console.error('admin: db', where, code);
  return fail(500, SETUP_CODES.has(code) ? 'setup' : 'db', { code });
}

/** Из строки ошибки — почты и всё, похожее на ключ или токен. */
export function redact(s: unknown): string {
  let out = String(s ?? '');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'GITHUB_RELEASE_TOKEN', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN']) {
    const v = env(k);
    if (v) out = out.split(v).join('***');
  }
  return out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b(re|sk|ghp|gho|github_pat|eyJ)[A-Za-z0-9_.-]{12,}/g, '***')
    .slice(0, 200);
}

// --- вход ------------------------------------------------------------------------

/** Тело запроса не больше MAX_BODY; больше — null. */
async function readBody(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > MAX_BODY ? null : text;
}

/** Утверждения JWT (без проверки подписи — её сделал getUser). */
export function jwtClaims(jwt: string): Json | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return isObj(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** Кто зовёт: админ с aal2 — контекст, иначе ответ-отказ. */
async function whoIs(admin: Admin, jwt: string): Promise<{ ctx: Ctx } | { out: Out }> {
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user?.id) return { out: fail(401, 'not signed in') };
  const claims = jwtClaims(jwt);
  if (!claims || claims.sub !== user.id) return { out: fail(401, 'not signed in') };
  const { data: row, error: rowErr } = await admin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  if (rowErr) {
    const code = String(rowErr.code || 'error').slice(0, 16);
    console.error(SETUP_CODES.has(code) ? 'admin: no admin_users table — supabase/admin.sql' : 'admin: admin check failed', code);
    return { out: fail(403, 'forbidden') };
  }
  if (!row) return { out: fail(403, 'forbidden') };
  if (claims.aal !== 'aal2') return { out: fail(403, 'mfa') };
  return { ctx: { admin, uid: user.id, email: String(user.email || ''), aal: 'aal2' } };
}

// --- обработчик --------------------------------------------------------------------

Deno.serve(handle);

/** Обработчик запроса — отдельной функцией: так его видит граф кода. */
export async function handle(req: Request): Promise<Response> {
  const cors = corsFor(req.headers.get('Origin'));
  if (!cors) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 403 });
    return respond(403, { error: 'origin' }, {});
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respond(405, { error: 'POST only' }, cors);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return respond(401, { error: 'not signed in' }, cors);
  const raw = await readBody(req);
  if (raw === null) return respond(413, { error: 'too large' }, cors);

  const admin = createClient(env('SUPABASE_URL') || DEFAULT_SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const who = await whoIs(admin, jwt);
  if ('out' in who) return respond(who.out.status || 200, who.out.body, cors);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return respond(400, { error: 'bad json' }, cors); }
  if (!isObj(body) || typeof body.action !== 'string') return respond(400, { error: 'bad request', detail: 'action' }, cors);
  const run = ACTIONS[body.action];
  if (!run || !Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) return respond(400, { error: 'unknown action' }, cors);
  try {
    const out = await run(who.ctx, body);
    return respond(out.status || 200, out.body, cors);
  } catch (e) {
    console.error('admin: failed', body.action, e instanceof Error ? e.name : 'error', redact(e instanceof Error ? e.message : e));
    return respond(500, { error: 'internal' }, cors);
  }
}

// --- параметры ---------------------------------------------------------------------

function daysOf(v: unknown): number | null {
  if (v === undefined || v === null) return 30;
  return typeof v === 'number' && DAYS.has(v) ? v : null;
}

function intIn(v: unknown, def: number, min: number, max: number): number | null {
  if (v === undefined || v === null) return def;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** Текст из админки: переводы строк — LF, управляющие (кроме \n и \t) убраны. */
function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim() : '';
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

// --- действия: обзор и пользователи ---------------------------------------------------

async function actMe(c: Ctx): Promise<Out> {
  return ok({ email: c.email, aal: c.aal });
}

async function actOverview(c: Ctx, b: Json): Promise<Out> {
  const days = daysOf(b.days);
  if (days === null) return bad('days: 7, 30 or 90');
  const { data, error } = await c.admin.rpc('admin_overview', { p_days: days });
  if (error) return dbFail('overview', error);
  return ok({ ...(isObj(data) ? data : {}), days });
}

async function actScreens(c: Ctx, b: Json): Promise<Out> {
  const days = daysOf(b.days);
  if (days === null) return bad('days: 7, 30 or 90');
  const { data, error } = await c.admin.rpc('admin_screens', { p_days: days });
  if (error) return dbFail('screens', error);
  const rows = (Array.isArray(data) ? data : []).map((r: Json) => ({
    screen: String(r.screen), platform: String(r.platform), views: num(r.views), users: num(r.users),
  }));
  return ok({ days, rows });
}

async function actUsers(c: Ctx, b: Json): Promise<Out> {
  const q = b.q === undefined || b.q === null ? '' : typeof b.q === 'string' ? b.q.trim() : null;
  if (q === null || q.length > 100) return bad('q');
  const page = intIn(b.page, 1, 1, 100_000);
  const per = intIn(b.per, 50, 1, 100);
  if (page === null) return bad('page');
  if (per === null) return bad('per');
  const filter = b.access === undefined || b.access === null || b.access === 'all' ? null : b.access === 'yes' || b.access === 'no' ? b.access : false;
  if (filter === false) return bad('access');
  // p_access — из пятого аргумента admin_users_list: до перевыполнения admin.sql
  // базы его нет, и список отвечает 500 'setup' («выполните admin.sql»).
  const { data, error } = await c.admin.rpc('admin_users_list', { p_q: q || null, p_limit: per, p_offset: (page - 1) * per, p_id: null, p_access: filter });
  if (error) return dbFail('users', error);
  const d = isObj(data) ? data : {};
  return ok({ total: num(d.total), page, per, rows: Array.isArray(d.rows) ? d.rows : [] });
}

async function actUser(c: Ctx, b: Json): Promise<Out> {
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return bad('id');
  const id = b.id.toLowerCase();
  const { data, error } = await c.admin.rpc('admin_users_list', { p_q: null, p_limit: 1, p_offset: 0, p_id: id });
  if (error) return dbFail('user', error);
  const row = isObj(data) && Array.isArray(data.rows) ? data.rows[0] : null;
  if (!row) return fail(404, 'not found');
  const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const [auth, fb, calls, screens] = await Promise.all([
    c.admin.auth.admin.getUserById(id),
    c.admin.from('feedback').select('id, kind, text, platform, app_version, lang, created_at, status')
      .eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    c.admin.from('ai_calls').select('created_at, model, counted, input_tokens, output_tokens, cost_units, stop_reason, ms')
      .eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    c.admin.from('usage_daily').select('day, screen, platform, views').eq('user_id', id).gte('day', since).limit(2000),
  ]);
  if (fb.error) return dbFail('user.feedback', fb.error);
  if (calls.error) return dbFail('user.ai_calls', calls.error);
  if (screens.error) return dbFail('user.screens', screens.error);
  const u = auth.data?.user as Json | undefined;
  const factors = Array.isArray(u?.factors) ? (u!.factors as Json[]) : [];
  const identities = Array.isArray(u?.identities) ? (u!.identities as Json[]) : [];
  const byScreen = new Map<string, { screen: string; platform: string; views: number; days: number }>();
  for (const r of (screens.data || []) as Json[]) {
    const k = `${r.screen}|${r.platform}`;
    const s = byScreen.get(k) || { screen: String(r.screen), platform: String(r.platform), views: 0, days: 0 };
    s.views += num(r.views);
    s.days += 1;
    byScreen.set(k, s);
  }
  return ok({
    user: {
      ...row,
      emailConfirmedAt: u?.email_confirmed_at ?? null,
      providers: [...new Set(identities.map((x) => String(x.provider || '')).filter(Boolean))],
      mfaFactors: factors.filter((f) => f.status === 'verified').length,
    },
    feedback: ((fb.data || []) as Json[]).map((r) => ({
      id: r.id, kind: r.kind, text: r.text, platform: r.platform, appVersion: r.app_version ?? null, lang: r.lang ?? null, createdAt: r.created_at, status: r.status,
    })),
    aiCalls: ((calls.data || []) as Json[]).map((r) => ({
      createdAt: r.created_at, model: r.model, counted: r.counted, inputTokens: r.input_tokens ?? null, outputTokens: r.output_tokens ?? null,
      units: r.cost_units ?? null, stopReason: r.stop_reason ?? null, ms: r.ms ?? null,
    })),
    screens: [...byScreen.values()].sort((x, y) => y.views - x.views),
  });
}

// --- действия: обратная связь -----------------------------------------------------------

type FeedbackRow = { id: string; user_id: string | null; kind: string; text: string; platform: string; app_version: string | null; lang: string | null; device: string | null; screenshot_path: string | null; created_at: string; status: string };
type ReplyRow = { id: string; feedback_id: string; body: string; sent_at: string | null; email_status: string | null; created_at: string };

const replyOut = (r: ReplyRow) => ({ id: r.id, body: r.body, sentAt: r.sent_at, emailStatus: r.email_status, createdAt: r.created_at });

/** Почты аккаунтов по id (security definer admin_user_emails). */
async function emailsOf(c: Ctx, ids: string[]): Promise<Map<string, string> | { error: { code?: unknown } }> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data, error } = await c.admin.rpc('admin_user_emails', { p_ids: ids });
  if (error) return { error };
  for (const r of (Array.isArray(data) ? data : []) as Json[]) if (typeof r.email === 'string' && r.email) map.set(String(r.id), r.email);
  return map;
}

async function actFeedbackList(c: Ctx, b: Json): Promise<Out> {
  const status = b.status === undefined || b.status === null || b.status === 'all' ? null : b.status;
  if (status !== null && !STATUSES.includes(status as string)) return bad('status');
  const page = intIn(b.page, 1, 1, 100_000);
  const per = intIn(b.per, 30, 1, 100);
  if (page === null) return bad('page');
  if (per === null) return bad('per');
  let q = c.admin.from('feedback')
    .select('id, user_id, kind, text, platform, app_version, lang, device, screenshot_path, created_at, status', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * per, page * per - 1);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) return dbFail('feedback.list', error);
  const rows = (data || []) as FeedbackRow[];
  const ids = rows.map((r) => r.id);
  const emails = await emailsOf(c, [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))]);
  if ('error' in emails) return dbFail('feedback.emails', emails.error);
  const replies = new Map<string, ReplyRow[]>();
  if (ids.length) {
    const { data: rd, error: re } = await c.admin.from('feedback_replies')
      .select('id, feedback_id, body, sent_at, email_status, created_at').in('feedback_id', ids).order('created_at', { ascending: true });
    if (re) return dbFail('feedback.replies', re);
    for (const r of (rd || []) as ReplyRow[]) {
      const list = replies.get(r.feedback_id) || [];
      list.push(r);
      replies.set(r.feedback_id, list);
    }
  }
  const shots = new Map<string, string>();
  const paths = rows.map((r) => r.screenshot_path).filter((p): p is string => typeof p === 'string' && !!p);
  if (paths.length) {
    const { data: signed, error: se } = await c.admin.storage.from(FEEDBACK_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    if (se) console.error('admin: signed urls', String((se as Json).statusCode || (se as Json).name || 'error').slice(0, 16));
    for (const s of (signed || []) as Json[]) if (s && typeof s.path === 'string' && typeof s.signedUrl === 'string' && !s.error) shots.set(s.path, s.signedUrl);
  }
  return ok({
    total: typeof count === 'number' ? count : rows.length,
    page,
    per,
    rows: rows.map((r) => ({
      id: r.id, kind: r.kind, text: r.text, platform: r.platform, appVersion: r.app_version, lang: r.lang, device: r.device,
      createdAt: r.created_at, status: r.status, userId: r.user_id,
      email: (r.user_id && emails.get(r.user_id)) || null,
      screenshotUrl: (r.screenshot_path && shots.get(r.screenshot_path)) || null,
      replies: (replies.get(r.id) || []).map(replyOut),
    })),
  });
}

// Письмо-ответ: короткий шаблон на языке отзыва (ru, en, uk, kk; иначе en).
const MAIL: Record<string, { subject: string; hello: string; quote: (d: string) => string; sign: string }> = {
  ru: { subject: 'Ответ на ваше обращение в Lancible', hello: 'Здравствуйте!', quote: (d) => `Ваше сообщение от ${d}:`, sign: '— Команда Lancible' },
  en: { subject: 'Reply to your Lancible feedback', hello: 'Hello,', quote: (d) => `Your message of ${d}:`, sign: '— The Lancible team' },
  uk: { subject: 'Відповідь на ваше звернення в Lancible', hello: 'Вітаємо!', quote: (d) => `Ваше повідомлення від ${d}:`, sign: '— Команда Lancible' },
  kk: { subject: 'Lancible-ге жолдаған хабарламаңызға жауап', hello: 'Сәлеметсіз бе!', quote: (d) => `${d} күнгі хабарламаңыз:`, sign: '— Lancible командасы' },
};

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Письмо: обращение, текст ответа, исходный отзыв цитатой, подпись. */
export function replyMail(lang: unknown, answer: string, original: { text: string; created_at: string }) {
  const code = typeof lang === 'string' ? lang.slice(0, 2).toLowerCase() : '';
  const t = MAIL[code] || MAIL.en;
  const day = Number.isNaN(Date.parse(original.created_at)) ? '' : new Date(original.created_at).toISOString().slice(0, 10);
  const quoted = String(original.text || '').split('\n').map((l) => `> ${l}`).join('\n');
  const text = `${t.hello}\n\n${answer}\n\n${t.quote(day)}\n${quoted}\n\n${t.sign}\n`;
  const paras = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5">`
    + `<p>${escHtml(t.hello)}</p>${paras(answer)}`
    + `<p style="margin-top:24px">${escHtml(t.quote(day))}</p>`
    + `<blockquote style="margin:0;padding-left:12px;border-left:3px solid #ccc;color:#555">${paras(String(original.text || ''))}</blockquote>`
    + `<p style="margin-top:24px">${escHtml(t.sign)}</p></div>`;
  return { subject: t.subject, text, html, lang: MAIL[code] ? code : 'en' };
}

async function actFeedbackReply(c: Ctx, b: Json): Promise<Out> {
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return bad('id');
  const text = cleanText(b.body);
  if (!text || text.length > 4000) return bad('body: 1–4000 characters');
  const id = b.id.toLowerCase();
  const { data: fb, error } = await c.admin.from('feedback').select('id, user_id, text, lang, created_at, status').eq('id', id).maybeSingle();
  if (error) return dbFail('feedback.reply', error);
  if (!fb) return fail(404, 'not found');
  const row = fb as { id: string; user_id: string | null; text: string; lang: string | null; created_at: string; status: string };
  if (!row.user_id) return fail(400, 'no email');
  const emails = await emailsOf(c, [row.user_id]);
  if ('error' in emails) return dbFail('feedback.reply.email', emails.error);
  const to = emails.get(row.user_id);
  if (!to) return fail(400, 'no email');

  // Сначала строка ответа, потом письмо: упади отправка на полпути — ответ
  // всё равно сохранён, а статус письма покажет, что случилось.
  const { data: ins, error: insErr } = await c.admin.from('feedback_replies')
    .insert({ feedback_id: id, body: text }).select('id, feedback_id, body, sent_at, email_status, created_at').single();
  if (insErr || !ins) return dbFail('feedback.reply.insert', insErr);
  const reply = ins as ReplyRow;

  const key = env('RESEND_API_KEY');
  const from = env('FEEDBACK_FROM');
  let status: 'sent' | 'failed' | 'not_configured' = 'not_configured';
  if (key && from) {
    const mail = replyMail(row.lang, text, row);
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `feedback-reply-${reply.id}` },
        body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(NET_TIMEOUT_MS),
      });
      if (res.ok) status = 'sent';
      else {
        status = 'failed';
        let name = '';
        try { const j = await res.json(); name = isObj(j) ? String(j.name || '') : ''; } catch { /* не JSON */ }
        console.error('admin: resend', res.status, redact(name).slice(0, 40));
      }
    } catch (e) {
      status = 'failed';
      console.error('admin: resend network', e instanceof Error ? e.name : 'error');
    }
  }
  const patch = { email_status: status, sent_at: status === 'sent' ? new Date().toISOString() : null };
  const { error: upErr } = await c.admin.from('feedback_replies').update(patch).eq('id', reply.id);
  if (upErr) console.error('admin: db', 'feedback.reply.update', String(upErr.code || 'error').slice(0, 16));
  let fbStatus = row.status;
  if (status === 'sent') {
    const { error: stErr } = await c.admin.from('feedback').update({ status: 'answered' }).eq('id', id);
    if (stErr) console.error('admin: db', 'feedback.reply.status', String(stErr.code || 'error').slice(0, 16));
    else fbStatus = 'answered';
  }
  return ok({ emailStatus: status, status: fbStatus, reply: replyOut({ ...reply, ...patch }) });
}

async function actFeedbackStatus(c: Ctx, b: Json): Promise<Out> {
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return bad('id');
  if (!STATUSES.includes(b.status as string)) return bad('status');
  const { data, error } = await c.admin.from('feedback').update({ status: b.status }).eq('id', b.id.toLowerCase()).select('id, status').maybeSingle();
  if (error) return dbFail('feedback.status', error);
  if (!data) return fail(404, 'not found');
  return ok({ id: (data as Json).id, status: (data as Json).status });
}

// --- действия: настройки агента ----------------------------------------------------------

type Ai = { model: string; effort: string; dailyLimit: number; dailyUnits: number };

/** Значение настройки по белому списку; не прошло — undefined. */
export function aiValue(field: string, v: unknown): string | number | undefined {
  if (field === 'model') return typeof v === 'string' && AI_MODELS.includes(v) ? v : undefined;
  if (field === 'effort') return typeof v === 'string' && AI_EFFORTS.includes(v) ? v : undefined;
  const range = (AI_RANGES as Record<string, number[]>)[field];
  if (!range) return undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= range[0] && v <= range[1] ? v : undefined;
}

/** То же чтение секретов, что у ai-chat: AI_MODEL как есть, лимит —
 *  parseInt, бюджет — целое ≥ 1 (можно 4_000_000), усилие — из списка. */
function aiFromSecrets(): Partial<Ai> {
  const out: Partial<Ai> = {};
  if (env('AI_MODEL')) out.model = env('AI_MODEL');
  if (AI_EFFORTS.includes(env('AI_EFFORT'))) out.effort = env('AI_EFFORT');
  const limit = Number.parseInt(env('AI_DAILY_LIMIT'), 10);
  if (limit >= 1) out.dailyLimit = limit;
  const units = Number(env('AI_DAILY_UNITS').replace(/[\s_]/g, ''));
  if (env('AI_DAILY_UNITS') && Number.isFinite(units) && units >= 1) out.dailyUnits = Math.floor(units);
  return out;
}

async function settingsOut(c: Ctx): Promise<Out> {
  const { data, error } = await c.admin.from('app_settings').select('key, value, updated_at');
  if (error) return dbFail('settings', error);
  const stored: Partial<Ai> = {};
  let updatedAt: string | null = null;
  for (const r of (data || []) as Json[]) {
    const field = Object.keys(AI_KEYS).find((k) => AI_KEYS[k] === r.key);
    if (!field) continue;
    const v = aiValue(field, r.value);
    if (v === undefined) continue;
    (stored as Json)[field] = v;
    if (typeof r.updated_at === 'string' && (!updatedAt || r.updated_at > updatedAt)) updatedAt = r.updated_at;
  }
  const secrets = aiFromSecrets();
  const ai = {} as Json;
  const source = {} as Json;
  for (const k of Object.keys(AI_DEFAULTS) as (keyof Ai)[]) {
    if (stored[k] !== undefined) { ai[k] = stored[k]; source[k] = 'settings'; } else if (secrets[k] !== undefined) { ai[k] = secrets[k]; source[k] = 'secret'; } else { ai[k] = AI_DEFAULTS[k]; source[k] = 'default'; }
  }
  return ok({
    ai,
    source,
    updatedAt,
    options: {
      models: AI_MODELS,
      efforts: AI_EFFORTS,
      dailyLimit: { min: AI_RANGES.dailyLimit[0], max: AI_RANGES.dailyLimit[1] },
      dailyUnits: { min: AI_RANGES.dailyUnits[0], max: AI_RANGES.dailyUnits[1] },
    },
    secrets: Object.fromEntries(SECRET_NAMES.map((k) => [k, !!env(k)])),
  });
}

async function actSettingsGet(c: Ctx): Promise<Out> {
  return settingsOut(c);
}

/** ai: { model?, effort?, dailyLimit?, dailyUnits? } — null возвращает к
 *  секрету или умолчанию. Хоть одно чужое значение — ничего не пишется. */
async function actSettingsSet(c: Ctx, b: Json): Promise<Out> {
  if (!isObj(b.ai) || !Object.keys(b.ai).length) return bad('ai');
  const upsert: { key: string; value: unknown; updated_at: string }[] = [];
  const remove: string[] = [];
  const at = new Date().toISOString();
  for (const [field, v] of Object.entries(b.ai)) {
    if (!(field in AI_KEYS)) return fail(400, 'bad value', { field });
    if (v === null) { remove.push(AI_KEYS[field]); continue; }
    const value = aiValue(field, v);
    if (value === undefined) return fail(400, 'bad value', { field });
    upsert.push({ key: AI_KEYS[field], value, updated_at: at });
  }
  if (upsert.length) {
    const { error } = await c.admin.from('app_settings').upsert(upsert, { onConflict: 'key' });
    if (error) return dbFail('settings.set', error);
  }
  if (remove.length) {
    const { error } = await c.admin.from('app_settings').delete().in('key', remove);
    if (error) return dbFail('settings.reset', error);
  }
  return settingsOut(c);
}

// --- действия: доступ к агенту ------------------------------------------------------------

/** forEmail — для access.add: ещё и account, есть ли аккаунт у этой почты. */
async function accessOut(c: Ctx, forEmail?: string): Promise<Out> {
  const { data, error } = await c.admin.rpc('admin_access_list');
  if (error) return dbFail('access', error);
  const rows = ((Array.isArray(data) ? data : []) as Json[]).map((r) => ({ email: r.email, note: r.note ?? null, grantedAt: r.granted_at, userId: r.user_id ?? null }));
  return ok(forEmail ? { rows, account: rows.some((r) => r.email === forEmail && !!r.userId) } : { rows });
}

/** Есть ли аккаунт с такой почтой. admin_users_list ищет по части почты, поэтому
 *  из выдачи берётся точное совпадение (без учёта регистра). */
async function hasAccount(c: Ctx, email: string): Promise<boolean | Out> {
  const { data, error } = await c.admin.rpc('admin_users_list', { p_q: email, p_limit: 100, p_offset: 0, p_id: null });
  if (error) return dbFail('access.account', error);
  const rows = isObj(data) && Array.isArray(data.rows) ? (data.rows as Json[]) : [];
  return rows.some((r) => typeof r.email === 'string' && r.email.toLowerCase() === email);
}

function emailOf(v: unknown): string | null {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return e && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

async function actAccessList(c: Ctx): Promise<Out> {
  return accessOut(c);
}

async function actAccessAdd(c: Ctx, b: Json): Promise<Out> {
  const email = emailOf(b.email);
  if (!email) return bad('email');
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return bad('note');
  if (b.requireAccount !== undefined && typeof b.requireAccount !== 'boolean') return bad('requireAccount');
  const note = cleanText(b.note).slice(0, 200) || null;
  if (b.requireAccount) {
    const has = await hasAccount(c, email);
    if (typeof has !== 'boolean') return has;
    if (!has) return fail(409, 'no account');
  }
  const { error } = await c.admin.from('ai_access').upsert({ email, note }, { onConflict: 'email' });
  if (error) return dbFail('access.add', error);
  return accessOut(c, email);
}

async function actAccessRemove(c: Ctx, b: Json): Promise<Out> {
  const email = emailOf(b.email);
  if (!email) return bad('email');
  const { error } = await c.admin.from('ai_access').delete().eq('email', email);
  if (error) return dbFail('access.remove', error);
  return accessOut(c);
}

// --- действия: посты лендинга -------------------------------------------------------------

const POST_COLS = 'id, date, tag, version, title, body, published, created_at, updated_at';
const postOut = (r: Json) => ({
  id: r.id, date: r.date, tag: r.tag, version: r.version ?? null, title: r.title, body: r.body,
  published: r.published === true, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Пост из админки → поля таблицы или причина отказа (те же правила, что у
 *  check в admin.sql и у scripts/blog-to-sql.js). */
export function postFields(p: unknown): Json | string {
  if (!isObj(p)) return 'post';
  const date = typeof p.date === 'string' ? p.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return 'date';
  if (!TAGS.includes(p.tag as string)) return 'tag';
  let version: string | null = null;
  if (p.version !== undefined && p.version !== null && p.version !== '') {
    version = typeof p.version === 'string' ? cleanText(p.version).replace(/\s+/g, ' ') : '';
    if (!version || version.length > 60) return 'version';
  }
  if (!isObj(p.title) || !isObj(p.body)) return 'title';
  const title: Json = {};
  const body: Json = {};
  for (const lang of ['ru', 'en']) {
    const t = cleanText(p.title[lang]).replace(/\s+/g, ' ');
    if (!t || t.length > 200) return `title.${lang}`;
    title[lang] = t;
    const list = p.body[lang];
    if (!Array.isArray(list) || !list.length || list.length > 40) return `body.${lang}`;
    const paras = list.map(cleanText);
    if (paras.some((x) => !x || x.length > 5000)) return `body.${lang}`;
    body[lang] = paras;
  }
  if (p.published !== undefined && typeof p.published !== 'boolean') return 'published';
  return { date, tag: p.tag, version, title, body, published: p.published === true };
}

async function actPostsList(c: Ctx): Promise<Out> {
  const { data, error } = await c.admin.from('blog_posts').select(POST_COLS)
    .order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) return dbFail('posts.list', error);
  return ok({ rows: ((data || []) as Json[]).map(postOut) });
}

async function actPostsSave(c: Ctx, b: Json): Promise<Out> {
  const fields = postFields(b.post);
  if (typeof fields === 'string') return bad(`post.${fields}`.replace('post.post', 'post'));
  const id = isObj(b.post) ? b.post.id : undefined;
  if (id !== undefined && id !== null && (typeof id !== 'string' || !UUID_RE.test(id))) return bad('post.id');
  if (typeof id === 'string') {
    const { data, error } = await c.admin.from('blog_posts').update(fields).eq('id', id.toLowerCase()).select(POST_COLS).maybeSingle();
    if (error) return dbFail('posts.save', error);
    if (!data) return fail(404, 'not found');
    return ok({ post: postOut(data as Json) });
  }
  const { data, error } = await c.admin.from('blog_posts').insert(fields).select(POST_COLS).single();
  if (error || !data) return dbFail('posts.save', error);
  return ok({ post: postOut(data as Json) });
}

async function actPostsDelete(c: Ctx, b: Json): Promise<Out> {
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return bad('id');
  const { data, error } = await c.admin.from('blog_posts').delete().eq('id', b.id.toLowerCase()).select('id');
  if (error) return dbFail('posts.delete', error);
  if (!Array.isArray(data) || !data.length) return fail(404, 'not found');
  return ok({ id: b.id.toLowerCase() });
}

// --- действия: журнал работы ---------------------------------------------------------------
//
// Журнал (work_log_tasks, work_log_events) пишет scripts/worklog.js служебным
// ключом; до 23 октября 2026 его читала публичная страница /logs, теперь —
// только этот раздел админки. Разбор — здесь, а не в базе: журнал маленький
// (сотни задач, тысячи событий), а фильтры те же, что были у /logs.

export const LOG_KINDS = ['request', 'change', 'error', 'fix', 'check', 'deploy'];
export const LOG_STATUSES = ['in_progress', 'review', 'accepted', 'deployed'];
/** PostgREST отдаёт не больше 1000 строк за запрос (max_rows у Supabase) —
 *  журнал читается страницами; предел страниц — чтобы сбой не крутил цикл. */
const LOG_PAGE_ROWS = 1000;
const LOG_MAX_PAGES = 200;

type LogTask = { id: string; title: string; summary: string | null; status: string; round: number; started_at: string; updated_at: string };
type LogEvent = { id?: number; task_id: string; kind: string; title?: string; detail?: string | null; round?: number; at?: string };
type DbErr = { code?: unknown } | null;

/** Все строки запроса страницами по LOG_PAGE_ROWS: build(с, по) — запрос
 *  с .range(с, по) и устойчивым порядком. */
async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbErr }>): Promise<{ rows: T[]; error: DbErr }> {
  const rows: T[] = [];
  for (let i = 0; i < LOG_MAX_PAGES; i += 1) {
    const { data, error } = await build(i * LOG_PAGE_ROWS, (i + 1) * LOG_PAGE_ROWS - 1);
    if (error) return { rows, error };
    const list = (Array.isArray(data) ? data : []) as T[];
    rows.push(...list);
    if (list.length < LOG_PAGE_ROWS) break;
  }
  return { rows, error: null };
}

function choiceOf(v: unknown, list: string[]): string | null | undefined {
  if (v === undefined || v === null || v === 'all') return null;
  return typeof v === 'string' && list.includes(v) ? v : undefined;
}

async function actLogsList(c: Ctx, b: Json): Promise<Out> {
  const status = choiceOf(b.status, LOG_STATUSES);
  if (status === undefined) return bad('status');
  const kind = choiceOf(b.kind, LOG_KINDS);
  if (kind === undefined) return bad('kind');
  const page = intIn(b.page, 1, 1, 100_000);
  const per = intIn(b.per, 20, 1, 100);
  if (page === null) return bad('page');
  if (per === null) return bad('per');

  const tasks = await allRows<LogTask>((from, to) => c.admin.from('work_log_tasks')
    .select('id, title, summary, status, round, started_at, updated_at').order('id', { ascending: true }).range(from, to));
  if (tasks.error) return dbFail('logs.tasks', tasks.error);
  // Сначала — только вид и задача у каждого события: на счётчики и фильтр
  // хватает их, а подробности нужны лишь задачам этой страницы.
  const light = await allRows<LogEvent>((from, to) => c.admin.from('work_log_events')
    .select('task_id, kind').order('id', { ascending: true }).range(from, to));
  if (light.error) return dbFail('logs.events', light.error);

  const statuses: Record<string, number> = { all: tasks.rows.length };
  for (const s of LOG_STATUSES) statuses[s] = 0;
  for (const t of tasks.rows) if (statuses[t.status] !== undefined && t.status !== 'all') statuses[t.status] += 1;

  const inStatus = status ? tasks.rows.filter((t) => t.status === status) : tasks.rows;
  const ids = new Set(inStatus.map((t) => t.id));
  const kinds: Record<string, number> = { all: 0 };
  for (const k of LOG_KINDS) kinds[k] = 0;
  const perTask = new Map<string, { total: number; hit: number }>();
  for (const e of light.rows) {
    if (!ids.has(e.task_id)) continue;
    kinds.all += 1;
    if (kinds[e.kind] !== undefined && e.kind !== 'all') kinds[e.kind] += 1;
    const n = perTask.get(e.task_id) || { total: 0, hit: 0 };
    n.total += 1;
    if (!kind || e.kind === kind) n.hit += 1;
    perTask.set(e.task_id, n);
  }

  const shown = inStatus
    .filter((t) => !kind || (perTask.get(t.id)?.hit || 0) > 0)
    .sort((x, y) => (x.updated_at < y.updated_at ? 1 : x.updated_at > y.updated_at ? -1 : x.id < y.id ? -1 : 1));
  const slice = shown.slice((page - 1) * per, page * per);
  const byTask = new Map<string, LogEvent[]>();
  if (slice.length) {
    const full = await allRows<LogEvent>((from, to) => c.admin.from('work_log_events')
      .select('id, task_id, kind, title, detail, round, at').in('task_id', slice.map((t) => t.id))
      .order('at', { ascending: true }).order('id', { ascending: true }).range(from, to));
    if (full.error) return dbFail('logs.events', full.error);
    for (const e of full.rows) {
      if (kind && e.kind !== kind) continue;
      const list = byTask.get(e.task_id) || [];
      list.push(e);
      byTask.set(e.task_id, list);
    }
  }
  return ok({
    total: shown.length,
    page,
    per,
    status: status || 'all',
    kind: kind || 'all',
    counts: { statuses, kinds },
    rows: slice.map((t) => ({
      id: t.id, title: t.title, summary: t.summary ?? null, status: t.status, round: num(t.round) || 1,
      startedAt: t.started_at, updatedAt: t.updated_at, eventsTotal: perTask.get(t.id)?.total || 0,
      events: (byTask.get(t.id) || []).map((e) => ({ kind: e.kind, title: e.title ?? '', detail: e.detail ?? null, round: num(e.round) || 1, at: e.at ?? null })),
    })),
  });
}

// --- действия: выпуск -----------------------------------------------------------------------

/** Заголовки GitHub API; токен — только если задан и только сюда. */
function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lancible-admin',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Запрос наружу с пределом времени: { status, text } или { error }. */
async function getText(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string } | { error: string }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    const text = await res.text();
    return res.ok ? { status: res.status, text } : { error: `http ${res.status}` };
  } catch (e) {
    return { error: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

/** Поле верхнего уровня манифеста electron-updater (latest.yml). */
export function ymlField(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, 'm'));
  return m ? m[1] : null;
}

/** Версия из ссылки кнопки лендинга: первое X.Y.Z в имени файла. */
export function landingVersions(html: string): { exe: string | null; dmg: string | null; apk: string | null } {
  const out = { exe: null as string | null, dmg: null as string | null, apk: null as string | null };
  for (const [, href] of html.matchAll(/href="([^"]+\.(?:exe|dmg|apk))"/g)) {
    const ext = href.slice(href.lastIndexOf('.') + 1) as 'exe' | 'dmg' | 'apk';
    const file = decodeURIComponent(href.slice(href.lastIndexOf('/') + 1));
    const v = file.match(/(\d+\.\d+\.\d+)/);
    if (v && !out[ext]) out[ext] = v[1];
  }
  return out;
}

/** Работы и шаги запуска для админки: статус, итог, шаг, на котором упало
 *  (первый с failure, timed_out или cancelled), и шаг, который идёт сейчас. */
export function runJobs(body: unknown): Json[] {
  const list = isObj(body) && Array.isArray(body.jobs) ? (body.jobs as unknown[]).filter(isObj) : [];
  const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
  return list.map((j) => {
    const steps = (Array.isArray(j.steps) ? (j.steps as unknown[]).filter(isObj) : []).map((s) => ({
      number: s.number ?? null, name: String(s.name ?? ''), status: s.status ?? null, conclusion: s.conclusion ?? null,
    }));
    const failed = steps.find((s) => BAD.has(String(s.conclusion)));
    const running = steps.find((s) => s.status === 'in_progress');
    return {
      name: String(j.name ?? ''), status: j.status ?? null, conclusion: j.conclusion ?? null,
      startedAt: j.started_at ?? null, completedAt: j.completed_at ?? null, url: j.html_url ?? null,
      failedStep: failed ? failed.name : null, currentStep: running ? running.name : null, steps,
    };
  });
}

async function actReleasesStatus(): Promise<Out> {
  const token = env('GITHUB_RELEASE_TOKEN');
  const gh = githubHeaders(token);
  const feedBase = `${env('SUPABASE_URL') || DEFAULT_SUPABASE_URL}/storage/v1/object/public/releases`;
  const [pkg, app, rel, runs, win, mac, mobile, landing] = await Promise.all([
    getText(`https://raw.githubusercontent.com/${REPO}/main/package.json`),
    getText(`https://raw.githubusercontent.com/${REPO}/main/mobile/app.json`),
    getText(`https://api.github.com/repos/${REPO}/releases?per_page=8`, gh),
    getText(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`, gh),
    getText(`${feedBase}/latest.yml`),
    getText(`${feedBase}/latest-mac.yml`),
    getText(`https://raw.githubusercontent.com/${UPDATES_REPO}/main/latest.json`),
    getText(LANDING_URL),
  ]);
  const errors: Json = {};
  const parse = (name: string, r: { text: string } | { error: string }): unknown => {
    if ('error' in r) { errors[name] = r.error; return null; }
    try { return JSON.parse(r.text); } catch { errors[name] = 'not json'; return null; }
  };
  const pj = parse('main.package', pkg) as Json | null;
  const aj = parse('main.app', app) as Json | null;
  const expo = aj && isObj(aj.expo) ? aj.expo : null;
  const rj = parse('releases', rel);
  const wj = parse('runs', runs) as Json | null;
  const mj = parse('latest.json', mobile) as Json | null;
  const landingOut = (v: { exe: string | null; dmg: string | null; apk: string | null }) => ({ desktop: v.exe || v.dmg, mobile: v.apk, ...v });
  const feed = (name: string, r: { text: string } | { error: string }) => {
    if ('error' in r) { errors[name] = r.error; return null; }
    return { version: ymlField(r.text, 'version'), releaseDate: ymlField(r.text, 'releaseDate') };
  };
  const pick = (o: unknown) => (isObj(o) ? { version: o.version ?? null, url: o.url ?? o.apk ?? null, size: o.size ?? null } : null);
  if ('error' in landing) errors.landing = landing.error;
  // Сводку запуска (summary) REST API не отдаёт — работы и шаги свежих
  // запусков читаются отдельно: имена у них говорящие («Тесты (Windows, со
  // снимками)» → «Полный набор со снимками (npm test)»).
  const runList = (wj && Array.isArray(wj.workflow_runs) ? wj.workflow_runs as Json[] : []).filter(isObj);
  const jobs = await Promise.all(runList.slice(0, RUNS_WITH_JOBS).map((r) =>
    getText(`https://api.github.com/repos/${REPO}/actions/runs/${Number(r.id)}/jobs?per_page=100`, gh)));
  return ok({
    main: {
      desktop: pj && typeof pj.version === 'string' ? pj.version : null,
      mobile: expo && typeof expo.version === 'string' ? expo.version : null,
      versionCode: expo && isObj(expo.android) && typeof expo.android.versionCode === 'number' ? expo.android.versionCode : null,
    },
    releases: (Array.isArray(rj) ? rj : []).filter(isObj).map((r) => ({
      tag: r.tag_name, name: r.name, publishedAt: r.published_at, draft: r.draft === true, prerelease: r.prerelease === true, url: r.html_url,
      assets: Array.isArray(r.assets) ? (r.assets as Json[]).map((a) => a.name) : [],
    })),
    runs: runList.map((r, i) => {
      const run: Json = {
        id: r.id, status: r.status, conclusion: r.conclusion ?? null, event: r.event, title: r.display_title ?? r.name ?? null,
        createdAt: r.created_at, url: r.html_url,
      };
      if (i < jobs.length) {
        const jr = jobs[i];
        if ('error' in jr) run.jobsError = jr.error;
        else {
          try { run.jobs = runJobs(JSON.parse(jr.text)); } catch { run.jobsError = 'not json'; }
        }
      }
      return run;
    }),
    manifests: {
      'latest.yml': feed('latest.yml', win),
      'latest-mac.yml': feed('latest-mac.yml', mac),
      // Версия телефона — блок android (по нему узнают о новой версии копии
      // Android); ios — рядом, как есть.
      'latest.json': mj ? { ...pick(mj.android), ios: pick(mj.ios) } : null,
    },
    landing: 'error' in landing ? null : landingOut(landingVersions(landing.text)),
    workflow: WORKFLOW,
    token: !!token,
    errors,
  });
}

/** Выпуск кнопкой: workflow_dispatch publish.yml в main. Тесты, сборки и
 *  публикацию делает сам workflow; упал — ничего не публикуется. */
async function actReleasesStart(_c: Ctx, b: Json): Promise<Out> {
  const token = env('GITHUB_RELEASE_TOKEN');
  if (!token) return fail(400, 'no github token');
  const inputs: Record<string, string> = {};
  for (const [field, input] of [['desktop', 'desktop_version'], ['mobile', 'mobile_version']]) {
    const v = b[field];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !VERSION_RE.test(v)) return fail(400, 'bad version', { field });
    inputs[input] = v;
  }
  if (!Object.keys(inputs).length) return bad('desktop or mobile: X.Y.Z');
  const page = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs }),
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('admin: github dispatch network', e instanceof Error ? e.name : 'error');
    return fail(502, 'github', { status: 0 });
  }
  if (res.status === 204) return ok({ url: page, inputs });
  if (res.status === 200) {
    let j: unknown = null;
    try { j = await res.json(); } catch { /* пусто */ }
    const url = isObj(j) && typeof j.html_url === 'string' ? j.html_url : isObj(j) && typeof j.run_url === 'string' ? j.run_url : page;
    return ok({ url, inputs });
  }
  console.error('admin: github dispatch', res.status);
  return fail(502, 'github', { status: res.status });
}

// --- таблица действий -------------------------------------------------------------------

const ACTIONS: Record<string, (c: Ctx, b: Json) => Promise<Out>> = {
  me: actMe,
  overview: actOverview,
  screens: actScreens,
  users: actUsers,
  user: actUser,
  'feedback.list': actFeedbackList,
  'feedback.reply': actFeedbackReply,
  'feedback.status': actFeedbackStatus,
  'settings.get': actSettingsGet,
  'settings.set': actSettingsSet,
  'access.list': actAccessList,
  'access.add': actAccessAdd,
  'access.remove': actAccessRemove,
  'posts.list': actPostsList,
  'posts.save': actPostsSave,
  'posts.delete': actPostsDelete,
  'logs.list': actLogsList,
  'releases.status': actReleasesStatus,
  'releases.start': actReleasesStart,
};

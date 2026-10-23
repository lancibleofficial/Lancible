// Подменённая сеть админки: вход Supabase (пароль, второй фактор) и функция
// admin. Ни один запрос из тестов наружу не уходит: всё, что не localhost и
// не подменено, обрывается и попадает в backend.unexpected — тест это видит.
//
// Использование:
//   const backend = await Backend.attach(page, { signedIn: 'aal2' });
//   backend.handlers.overview = () => ({ users: { total: 3 } });
//   await page.goto('/#/overview');
//   backend.calls — что ушло в функцию: [{ action, ...params }]
//
// { csp: true } — страница получает ту же политику безопасности, что на сайте
// (Content-Security-Policy из admin/vercel.json): локальный сервер её не
// ставит, а нарушение — строка в консоли, то есть провал теста.
const fs = require('node:fs');
const path = require('node:path');
const { TASKS: LOG_TASKS, logsList } = require('./logs-fixture');

const SUPA = 'https://yiglgfkjjvwijukdzutw.supabase.co';
const SESSION_KEY = 'sb-yiglgfkjjvwijukdzutw-auth-token';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'owner@example.test';
const PASSWORD = 'correct horse battery';
const GOOD_CODE = '123456';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${Buffer.from('test-signature').toString('base64url')}`;
const decode = (token) => {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
};

const verifiedFactor = () => ({
  id: 'factor-verified', factor_type: 'totp', status: 'verified', friendly_name: 'Lancible Admin',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});

function makeUser(factors) {
  return {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
    email_confirmed_at: '2026-09-01T00:00:00Z', phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [], factors, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  };
}

function makeSession(aal, factors) {
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: 'password', timestamp: now }];
  if (aal === 'aal2') amr.unshift({ method: 'totp', timestamp: now });
  return {
    access_token: jwt({ sub: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, aal, amr, session_id: 'sess-1', iat: now, exp: now + 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${aal}`,
    user: makeUser(factors),
  };
}

const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="7" height="7"/><rect x="14" width="7" height="7"/><rect y="14" width="7" height="7"/></svg>';
const SECRET = 'JBSWY3DPEHPK3PXP';

class Backend {
  constructor(page, opts = {}) {
    this.page = page;
    this.admin = opts.admin !== false;
    this.factors = opts.factors !== undefined ? opts.factors : [verifiedFactor()];
    this.aal = opts.signedIn || null;
    this.offline = false;
    this.calls = [];
    this.authCalls = [];
    this.unexpected = [];
    this.errors = [];
    this.handlers = { ...defaultHandlers(), ...(opts.handlers || {}) };
  }

  static async attach(page, opts = {}) {
    const b = new Backend(page, opts);
    await b.install(opts);
    return b;
  }

  /** Вызовы функции с данным действием. */
  callsOf(action) { return this.calls.filter((c) => c.action === action); }

  async install(opts) {
    const page = this.page;
    // Ошибки страницы — тоже провал: раздел, упавший в консоль, мог
    // нарисовать половину. Оборванные подменой запросы — не ошибки кода.
    page.on('pageerror', (e) => this.errors.push(String(e && e.stack || e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) this.errors.push(m.text()); });
    // Сначала — всё подряд: localhost идёт к настоящему серверу статики,
    // остальное обрывается. Подмены ниже зарегистрированы позже и потому
    // срабатывают раньше этой.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) || url.startsWith('data:')) return route.fallback();
      this.unexpected.push(url);
      return route.abort('blockedbyclient');
    });
    await page.route(`${SUPA}/auth/v1/**`, (route) => this.onAuth(route));
    await page.route('**/functions/v1/admin', (route) => this.onFunction(route));
    if (opts.csp) {
      const csp = sitePolicy();
      await page.route(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/(index\.html)?(\?[^#]*)?$/, async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
      });
    }
    if (opts.signedIn) {
      const value = JSON.stringify(makeSession(opts.signedIn, this.factors));
      await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [SESSION_KEY, value]);
    }
  }

  json(route, status, body) {
    return route.fulfill({ status, contentType: 'application/json', body: body == null ? '' : JSON.stringify(body) });
  }

  async onAuth(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/auth\/v1/, '');
    const method = req.method();
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    this.authCalls.push({ method, path: p, query: url.search, body });
    if (this.offline) return route.abort('internetdisconnected');

    if (method === 'POST' && p === '/token' && url.searchParams.get('grant_type') === 'password') {
      if (!body || body.email !== EMAIL || body.password !== PASSWORD) {
        return this.json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      this.aal = 'aal1';
      return this.json(route, 200, makeSession('aal1', this.factors));
    }
    if (method === 'POST' && p === '/token') return this.json(route, 200, makeSession(this.aal || 'aal1', this.factors));
    if (method === 'GET' && p === '/user') return this.json(route, 200, makeUser(this.factors));
    if (method === 'POST' && p === '/factors') {
      const f = { id: `factor-new-${this.factors.length + 1}`, factor_type: 'totp', status: 'unverified', friendly_name: body && body.friendly_name, created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z' };
      this.factors.push(f);
      return this.json(route, 200, { id: f.id, type: 'totp', friendly_name: f.friendly_name, totp: { qr_code: QR_SVG, secret: SECRET, uri: `otpauth://totp/Lancible%20Admin:${EMAIL}?secret=${SECRET}` } });
    }
    let m = p.match(/^\/factors\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      this.factors = this.factors.filter((f) => f.id !== m[1]);
      return this.json(route, 200, { id: m[1] });
    }
    m = p.match(/^\/factors\/([^/]+)\/challenge$/);
    if (method === 'POST' && m) return this.json(route, 200, { id: 'challenge-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    m = p.match(/^\/factors\/([^/]+)\/verify$/);
    if (method === 'POST' && m) {
      if (!body || body.code !== GOOD_CODE) return this.json(route, 422, { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
      const f = this.factors.find((x) => x.id === m[1]);
      if (f) f.status = 'verified';
      this.aal = 'aal2';
      return this.json(route, 200, makeSession('aal2', this.factors));
    }
    if (method === 'POST' && p === '/logout') return route.fulfill({ status: 204, body: '' });
    return this.json(route, 404, { msg: `not mocked: ${method} ${p}` });
  }

  async onFunction(route) {
    const req = route.request();
    if (req.method() !== 'POST') return this.json(route, 405, { error: 'method' });
    let body = {};
    try { body = req.postDataJSON() || {}; } catch { body = {}; }
    const token = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
    this.calls.push(body);
    if (this.offline) return route.abort('internetdisconnected');
    const claims = decode(token);
    if (!claims) return this.json(route, 401, { error: 'unauthorized' });
    if (!this.admin) return this.json(route, 403, { error: 'forbidden' });
    if (claims.aal !== 'aal2') return this.json(route, 403, { error: 'mfa' });
    const fn = this.handlers[body.action];
    if (!fn) return this.json(route, 400, { error: 'unknown action' });
    const out = await fn(body, this);
    if (out && out.__status) return this.json(route, out.__status, out.body);
    if (Array.isArray(out)) return this.json(route, 200, out);
    return this.json(route, 200, { ok: true, ...(out || {}) });
  }
}

/** Content-Security-Policy админки — та, что ставит Vercel (admin/vercel.json). */
function sitePolicy() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'vercel.json'), 'utf8'));
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  const csp = all && all.headers.find((x) => x.key === 'Content-Security-Policy');
  if (!csp) throw new Error('в admin/vercel.json нет Content-Security-Policy');
  return csp.value;
}

/** Работы publish.yml по порядку — имена из .github/workflows/publish.yml. */
const JOBS = ['Входы и ключи', 'Тесты (Linux)', 'Тесты (Windows, со снимками)', 'Версии и теги', 'Сборка десктопа', 'Сборка телефона', 'Проверка файлов и манифестов', 'latest.json телефона', 'Кнопки лендинга', 'Итог'];

/** Данные по умолчанию: у каждого раздела что показать. */
function defaultHandlers() {
  // Состояние — своё у каждого Backend: настройки и список доступа меняются.
  const settings = { model: 'claude-sonnet-5-5', effort: 'medium', dailyLimit: 50, dailyUnits: 4000000 };
  const settingsSource = { model: 'default', effort: 'default', dailyLimit: 'secret', dailyUnits: 'default' };
  const settingsOut = () => ({
    ai: { ...settings }, source: { ...settingsSource }, updatedAt: null,
    options: { models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], efforts: ['low', 'medium', 'high'], dailyLimit: { min: 1, max: 1000 }, dailyUnits: { min: 10000, max: 100000000 } },
    secrets: { ANTHROPIC_API_KEY: true, ANTHROPIC_WORKSPACE_ID: false, AI_MODEL: false, AI_EFFORT: false, AI_DAILY_LIMIT: true, AI_DAILY_UNITS: false, TELEGRAM_BOT_TOKEN: true, TELEGRAM_CHAT_ID: true, TELEGRAM_THREAD_ID: false, RESEND_API_KEY: false, FEEDBACK_FROM: false, GITHUB_RELEASE_TOKEN: true },
  });
  const today = new Date().toISOString().slice(0, 10);
  const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  // Аккаунты и список доступа — одно состояние: «Пользователи» берут aiAccess из списка,
  // как admin_users_list в базе, а у выданной почты userId — id аккаунта, если он есть.
  let access = [{ email: 'anna@example.test', note: 'бета', grantedAt: '2026-10-21T10:00:00Z', userId: 'u-1' }];
  const accounts = [
    { id: 'u-1', email: 'anna@example.test', createdAt: '2026-09-02T10:00:00Z', lastSignInAt: '2026-10-22T08:00:00Z', provider: 'google', projects: 12, tasks: 340, lastActiveDay: dayAgo(1), feedback: 2, aiCalls7: 31 },
    { id: 'u-2', email: 'boris@example.test', createdAt: '2026-09-15T10:00:00Z', lastSignInAt: '2026-10-01T08:00:00Z', provider: 'email', projects: 3, tasks: 17, lastActiveDay: dayAgo(20), feedback: 0, aiCalls7: 0 },
  ];
  const withAccess = (a) => ({ ...a, aiAccess: access.some((r) => r.email === a.email) });
  return {
    me: () => ({ email: EMAIL, aal: 'aal2' }),
    overview: ({ days }) => ({
      users: { total: 1287, new7: 41, new30: 160, series: [{ day: dayAgo(2), n: 5 }, { day: dayAgo(1), n: 9 }, { day: today, n: 3 }] },
      logins: { day: 77, week: 402, month: 1310, series: [{ day: dayAgo(1), n: 60 }, { day: today, n: 77 }] },
      active: { dau: 64, wau: 300, mau: 911, series: [{ day: today, n: 64 }] },
      projects: { total: 5320, series: [{ day: today, n: 12 }] },
      tasks: { total: 48211, series: [{ day: today, n: 230 }] },
      feedback: { new: 7, total: 93 },
      ai: { calls7: 512, users7: 18, unitsToday: 210000 },
      platforms: { web: 400, desktop: 350, android: 420, ios: 117 },
      days,
    }),
    screens: ({ days }) => ({ days, rows: [
      { screen: 'today', platform: 'web', views: 900, users: 300 },
      { screen: 'projects', platform: 'web', views: 640, users: 280 },
      { screen: 'stats.week', platform: 'web', views: 210, users: 120 },
      { screen: 'settings.about', platform: 'web', views: 4, users: 2 },
      { screen: 'mystery', platform: 'web', views: 3, users: 1 },
      { screen: 'tasks', platform: 'android', views: 700, users: 210 },
    ] }),
    // access: 'yes' | 'no' — фильтр по доступу к агенту (как p_access у admin_users_list).
    users: ({ q, page = 1, per = 50, access: only }) => {
      let rows = accounts.map(withAccess);
      if (q) rows = rows.filter((u) => u.email.includes(q));
      if (only === 'yes' || only === 'no') rows = rows.filter((u) => u.aiAccess === (only === 'yes'));
      return { total: rows.length, page, per, rows };
    },
    user: ({ id }) => ({
      user: { ...withAccess(accounts.find((a) => a.id === id) || accounts[0]), id, emailConfirmedAt: '2026-09-02T10:01:00Z', providers: ['google', 'email'], mfaFactors: 0 },
      feedback: [{ id: 'f-1', kind: 'bug', text: 'Таймер сбивается после сна', platform: 'desktop', appVersion: '0.5.1', lang: 'ru', createdAt: '2026-10-20T10:00:00Z', status: 'new' }],
      aiCalls: [{ createdAt: '2026-10-22T09:00:00Z', model: 'claude-sonnet-5-5', counted: true, inputTokens: 1200, outputTokens: 120, units: 1834, stopReason: 'end_turn', ms: 2300 }],
      screens: [{ screen: 'today', platform: 'web', views: 41, days: 12 }, { screen: 'tasks', platform: 'android', views: 17, days: 6 }],
    }),
    'feedback.list': ({ page = 1, per = 30 }) => ({ total: 2, page, per, rows: [
      { id: 'f-1', kind: 'bug', text: 'Таймер сбивается после сна', platform: 'desktop', appVersion: '0.5.1', lang: 'ru', device: 'Windows 11', createdAt: '2026-10-20T10:00:00Z', status: 'new', userId: 'u-1', email: 'anna@example.test', screenshotUrl: `${SUPA}/storage/v1/object/sign/feedback/shot.png?token=t`, replies: [] },
      { id: 'f-2', kind: 'idea', text: 'Хочу тёмную тему в PDF', platform: 'web', appVersion: '0.5.1', lang: 'en', device: 'Chrome', createdAt: '2026-10-21T10:00:00Z', status: 'new', userId: null, email: null, screenshotUrl: null, replies: [] },
    ] }),
    'feedback.reply': ({ body }) => ({ emailStatus: 'sent', status: 'answered', reply: { id: 'r-1', body, sentAt: '2026-10-23T10:00:00Z', emailStatus: 'sent', createdAt: '2026-10-23T10:00:00Z' } }),
    'feedback.status': ({ id, status }) => ({ id, status }),
    'settings.get': () => settingsOut(),
    'settings.set': ({ ai }) => { Object.assign(settings, ai); for (const k of Object.keys(ai)) settingsSource[k] = 'settings'; return settingsOut(); },
    'access.list': () => ({ rows: access }),
    // requireAccount без аккаунта — 409 'no account' и ничего не пишется (как у функции).
    'access.add': ({ email, note, requireAccount }) => {
      const userId = (accounts.find((a) => a.email === email) || {}).id || null;
      if (requireAccount && !userId) return { __status: 409, body: { error: 'no account' } };
      access = [{ email, note: note || null, grantedAt: '2026-10-23T10:00:00Z', userId }, ...access.filter((r) => r.email !== email)];
      return { rows: access, account: !!userId };
    },
    'access.remove': ({ email }) => { access = access.filter((r) => r.email !== email); return { rows: access }; },
    'posts.list': () => ({ rows: [
      { id: 'p-1', date: '2026-10-21', tag: 'improvement', version: '0.5.1 · mobile 1.3.1', title: { ru: 'ИИ-агент — в закрытом тесте', en: 'The AI agent goes into closed testing' }, body: { ru: ['Первый абзац.', 'Второй абзац.'], en: ['First paragraph.', 'Second paragraph.'] }, published: true, createdAt: '2026-10-21T10:00:00Z', updatedAt: '2026-10-21T10:00:00Z' },
    ] }),
    'posts.save': ({ post }) => ({ post: { ...post, id: post.id || 'p-new', createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z' } }),
    'posts.delete': ({ id }) => ({ id }),
    // Форма — как у функции admin (supabase/functions/admin, actReleasesStatus).
    'releases.status': () => ({
      main: { desktop: '0.5.1', mobile: '1.3.1', versionCode: 10 },
      releases: [
        { tag: 'v0.5.1', name: 'Lancible 0.5.1', publishedAt: '2026-10-21T12:00:00Z', draft: false, prerelease: false, url: 'https://github.com/lancibleofficial/Lancible/releases/tag/v0.5.1', assets: ['Lancible-Setup-0.5.1.exe'] },
        { tag: 'mobile-v1.3.1', name: 'Lancible mobile 1.3.1', publishedAt: '2026-10-21T12:30:00Z', draft: false, prerelease: false, url: 'https://github.com/lancibleofficial/Lancible/releases/tag/mobile-v1.3.1', assets: ['lancible-1.3.1.apk'] },
      ],
      manifests: {
        'latest.yml': { version: '0.5.1', releaseDate: '2026-10-21T12:00:00Z' },
        'latest-mac.yml': { version: '0.5.1', releaseDate: '2026-10-21T12:00:00Z' },
        'latest.json': { version: '1.3.0', url: null, size: null, ios: null },
      },
      landing: { desktop: '0.5.1', mobile: '1.3.1', exe: '0.5.1', dmg: '0.5.1', apk: '1.3.1' },
      // Запуски publish.yml с работами: у каждой статус и итог, у упавшей —
      // шаг. Последний упал после «Версий и тегов» — на сборке телефона.
      runs: [
        { id: 102, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', title: 'Выпуск 0.5.2 · mobile 1.3.2', createdAt: '2026-10-22T11:00:00Z', url: 'https://github.com/lancibleofficial/Lancible/actions/runs/102',
          jobs: JOBS.map((name, i) => job(name, i < 5 ? 'success' : i === 5 ? 'failure' : 'skipped', i === 5 ? 'Сборка APK (EAS)' : null)) },
        { id: 101, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', title: 'Выпуск 0.5.1 · mobile 1.3.1', createdAt: '2026-10-21T11:00:00Z', url: 'https://github.com/lancibleofficial/Lancible/actions/runs/101',
          jobs: JOBS.map((name) => job(name, 'success')) },
      ],
      workflow: 'publish.yml',
      token: true,
      errors: {},
    }),
    'releases.start': ({ desktop, mobile }) => ({ url: 'https://github.com/lancibleofficial/Lancible/actions/runs/103', inputs: { ...(desktop ? { desktop_version: desktop } : {}), ...(mobile ? { mobile_version: mobile } : {}) } }),
    // Журнал работы — та же выборка, что у функции (tests/admin/logs-fixture.js).
    'logs.list': (params) => logsList(LOG_TASKS, params),
  };
}

/** Работа запуска в форме функции admin (runJobs). */
function job(name, conclusion, failedStep = null) {
  return { name, status: 'completed', conclusion, startedAt: null, completedAt: null, url: null, failedStep, currentStep: null, steps: [] };
}

/** test с приспособлением open(opts) → Backend; в конце теста — проверка,
 *  что мимо подмены ничего не ушло и страница не падала в консоль. */
const base = require('@playwright/test');
const test = base.test.extend({
  open: async ({ page }, use) => {
    let backend = null;
    await use(async (opts) => { backend = await Backend.attach(page, opts); return backend; });
    if (backend) {
      base.expect(backend.unexpected, 'запросы мимо подмены').toEqual([]);
      base.expect(backend.errors, 'ошибки страницы').toEqual([]);
    }
  },
});

module.exports = { test, expect: base.expect, JOBS, Backend, makeSession, decode, sitePolicy, LOG_TASKS, SUPA, SESSION_KEY, EMAIL, PASSWORD, GOOD_CODE, SECRET, USER_ID };

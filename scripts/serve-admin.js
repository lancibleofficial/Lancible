#!/usr/bin/env node
/* Админ-панель локально: npm run serve:admin [-- <порт>] (по умолчанию 5175).
 *
 * Отдаёт admin/ статикой и по POST /functions/v1/admin исполняет ту же
 * функцию, что выкладывается в Supabase (supabase/functions/admin/index.ts),
 * — в Node, без выкладки. Сборка — как в тестах функций (tests/backend/):
 * esbuild снимает типы, импорт jsr:@supabase/supabase-js@2 подменяется
 * настоящим @supabase/supabase-js из node_modules, Deno.env читает окружение
 * и .env.local, Deno.serve отдаёт обработчик. Поэтому локальная админка
 * работает с настоящей базой проекта — служебным ключом
 * SUPABASE_SERVICE_ROLE_KEY из .env.local (значение не печатается).
 *
 * Сервер слушает только этот компьютер (127.0.0.1 и ::1): с ним — служебный
 * ключ. Запрос со своего же адреса — тот же источник, CORS ему не нужен,
 * поэтому Origin http://localhost:<порт> функция не видит; любой другой Origin
 * проходит к ней как есть и получает её отказ.
 *
 * ADMIN_LOCAL_API=0 — только статика, /functions/v1/admin отвечает 404 (для
 * e2e админки: там ответы функции подставляет сам тест).
 *
 * Секреты функции локально — только из окружения и .env.local
 * (RESEND_API_KEY, FEEDBACK_FROM, GITHUB_RELEASE_TOKEN…): заданные в Supabase
 * здесь не видны, и админка покажет их «не заданы».
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STATIC = path.join(ROOT, 'admin');
const FN_SRC = path.join(ROOT, 'supabase', 'functions', 'admin', 'index.ts');
const DEFAULT_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
const MAX_BODY = 1024 * 1024;

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a))) || Number(process.env.PORT) || 5175;
const localApi = process.env.ADMIN_LOCAL_API !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** .env.local → { KEY: value }; комментарии и пустые строки — мимо. */
function readEnvLocal() {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Функция admin как модуль Node: { handle(Request) → Response }. */
async function loadFunction(env) {
  const esbuild = require('esbuild');
  const { code } = await esbuild.transform(fs.readFileSync(FN_SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const js = code.replace(/import\s*\{\s*createClient\s*\}\s*from\s*["']jsr:@supabase\/supabase-js@2["'];?/,
    'const { createClient } = globalThis.__lancibleAdminLocal.supabase;');
  if (js === code) throw new Error('импорт supabase-js в supabase/functions/admin/index.ts поменялся — поправить scripts/serve-admin.js');
  let handler = null;
  // Deno — константой модуля, а не глобалом: supabase-js по глобальному Deno
  // решил бы, что он в Deno.
  globalThis.__lancibleAdminLocal = {
    supabase: require('@supabase/supabase-js'),
    deno: { env: { get: (k) => (process.env[k] !== undefined ? process.env[k] : env[k]) }, serve: (h) => { handler = h; } },
  };
  const src = `const Deno = globalThis.__lancibleAdminLocal.deno;\n${js}`;
  await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  if (typeof handler !== 'function') throw new Error('функция admin не позвала Deno.serve');
  return handler;
}

/** Тело запроса до MAX_BODY; больше — null. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** Запрос Node → Request функции → ответ Node. */
async function callFunction(handler, req, res) {
  const body = req.method === 'POST' ? await readBody(req) : null;
  if (body === null && req.method === 'POST') { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"error":"too large"}'); return; }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  // Свой адрес — тот же источник: CORS ему не нужен.
  const own = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  if (own.has(headers.get('origin'))) headers.delete('origin');
  const request = new Request(`http://localhost:${port}/functions/v1/admin`, {
    method: req.method, headers, body: body && body.length ? body : undefined,
  });
  let action = '';
  try { action = String(JSON.parse(body.toString('utf8')).action || '').slice(0, 40); } catch { /* не JSON — функция ответит сама */ }
  const response = await handler(request);
  const out = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(out);
  console.log(`[serve-admin] ${req.method} admin${action ? ` ${action}` : ''} → ${response.status}`);
}

/** Файл из admin/; за пределы папки — нельзя. */
function serveStatic(req, res) {
  let reqPath;
  try { reqPath = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (reqPath.endsWith('/')) reqPath += 'index.html';
  if (!path.extname(reqPath) && fs.existsSync(path.join(STATIC, `${reqPath}.html`))) reqPath += '.html';
  const filePath = path.resolve(STATIC, `.${reqPath}`);
  const rel = path.relative(STATIC, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`Not found: ${reqPath}`); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

async function main() {
  const env = readEnvLocal();
  let handler = null;
  // Функция собирается заново, если её файл правили после запуска: иначе
  // запущенный сервер не знал новых действий и отвечал «unknown action»
  // (23 октября 2026, раздел «Журнал» и logs.list).
  let loadedMtime = 0;
  const freshHandler = async () => {
    const mtime = fs.statSync(FN_SRC).mtimeMs;
    if (!handler || mtime !== loadedMtime) {
      const reload = !!handler;
      handler = await loadFunction(env);
      loadedMtime = mtime;
      if (reload) console.log('[serve-admin] функция admin пересобрана после правки');
    }
    return handler;
  };
  if (localApi) {
    if (!env.SUPABASE_URL && !process.env.SUPABASE_URL) env.SUPABASE_URL = DEFAULT_URL;
    await freshHandler();
  }
  const hasKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  const app = (req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/functions/v1/admin') {
      if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"local api off"}'); return; }
      freshHandler().then((h) => callFunction(h, req, res)).catch((e) => {
        console.error(`[serve-admin] ошибка функции: ${e && e.name ? e.name : 'error'}`);
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"internal"}'); }
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    serveStatic(req, res);
  };
  const v4 = http.createServer(app);
  v4.on('error', (e) => { console.error(`[serve-admin] порт ${port}: ${e.code || e.message}`); process.exit(1); });
  v4.listen(port, '127.0.0.1', () => {
    console.log(`[serve-admin] http://localhost:${port} — admin/${fs.existsSync(STATIC) ? '' : ' (папки ещё нет)'}`);
    if (!localApi) console.log('[serve-admin] ADMIN_LOCAL_API=0: только статика, /functions/v1/admin — 404');
    else if (hasKey) console.log('[serve-admin] функция admin работает здесь со служебным ключом SUPABASE_SERVICE_ROLE_KEY из .env.local — настоящая база проекта; сервер слушает только этот компьютер, порт наружу не открывать');
    else console.log('[serve-admin] нет служебного ключа (SUPABASE_SERVICE_ROLE_KEY в .env.local или окружении) — функция ответит отказом');
  });
  // localhost у браузера бывает и ::1; нет IPv6 — не беда.
  const v6 = http.createServer(app);
  v6.on('error', () => {});
  v6.listen(port, '::1');
}

main().catch((e) => {
  console.error(`[serve-admin] не поднялся: ${e && e.message ? e.message : e}`);
  process.exit(1);
});

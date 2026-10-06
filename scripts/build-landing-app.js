// Веб-версия — внутрь лендинга, по адресу lancible.vercel.app/app.
// Запуск: npm run site:app (на Vercel — buildCommand в landing/vercel.json).
//
// Почему так. До 6 октября 2026 веб жил отдельным проектом Vercel со своим
// адресом, а лендинг проксировал на него /app.
// Адрес у продукта должен быть один — lancible.vercel.app, — и всё остальное
// открывается от него. Поэтому веб больше не выкатывается отдельно: проект
// лендинга при сборке сам собирает веб и кладёт его в landing/app/.
//
// Что делается:
//   1. web/ собирается как раньше — scripts/sync-web-assets.js копирует общий
//      с десктопом код, ядро, Quill, Supabase и шрифты (пакеты веба к этому
//      моменту стоят в web/node_modules: на Vercel их ставит installCommand);
//   2. всё, что нужно браузеру, копируется в landing/app/ — кроме служебного
//      (EXCLUDE ниже);
//   3. рядом кладётся build.json с коммитом: по нему после выката видно, что
//      /app отдаёт сам лендинг, а не прокси на старый адрес.
//
// landing/app/ — результат сборки, в git не попадает.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'landing', 'app');

/** Что из web/ браузеру не нужно: зависимости, их описание и настройки Vercel. */
const EXCLUDE = new Set(['node_modules', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.vercel']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(a, b);
    else { fs.copyFileSync(a, b); n += 1; }
  }
  return n;
}

function build() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-web-assets.js')], { stdio: 'inherit' });
  fs.rmSync(OUT, { recursive: true, force: true });
  const n = copyDir(WEB, OUT);
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
  fs.writeFileSync(path.join(OUT, 'build.json'), `${JSON.stringify({ commit, builtAt: new Date().toISOString() })}\n`);
  console.log(`[build-landing-app] веб собран в landing/app: файлов ${n}${commit ? `, коммит ${commit.slice(0, 7)}` : ''}`);
}

if (require.main === module) {
  try { build(); } catch (e) { console.error(`[build-landing-app] ${e.message}`); process.exit(1); }
}

module.exports = { EXCLUDE };

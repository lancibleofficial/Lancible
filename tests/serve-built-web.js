// Сервер веба для браузерных прогонов: сначала собирает web/, потом поднимает.
// Запускает его Playwright (webServer в playwright.config.js):
//   node tests/serve-built-web.js <порт>
//
// Зачем. web/ — сборка: app.js, styles.css, core/ и vendor/ копируются туда
// из src/renderer скриптом build:web. В CI он стоит отдельным шагом, а
// локально его никто не звал, и прогон проверял web/ какой был — от прошлой
// сборки или пустой. 10 октября 2026 это дало 33 падения ровно на новых
// возможностях (код был свежий, а web/ — старый), а в свежей копии
// репозитория — десятки падений: без web/node_modules сборка не положила
// vendor/supabase.js, и app.js не стартовал.
//
// Поэтому перед подъёмом сервера:
//   1. нет web/node_modules — ставим их тем же способом, что CI;
//   2. собираем web/;
//   3. проверяем, что сборка полная, и громко падаем, если нет.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

/** Без этих файлов веб не стартует или стартует не тем кодом. */
const REQUIRED = ['index.html', 'app.js', 'styles.css', 'editor.js', 'core/i18n.js', 'vendor/supabase.js'];

/** Чего не хватает в собранном web/ (пусто — всё на месте). */
function missingBuildFiles(webDir) {
  return REQUIRED.filter((f) => !fs.existsSync(path.join(webDir, f)));
}

/** Собранный файл совпадает с исходником — сборка свежая, а не прошлая. */
function staleBuildFiles(rootDir) {
  const pairs = [['src/renderer/app.js', 'web/app.js'], ['src/renderer/styles.css', 'web/styles.css']];
  return pairs
    .filter(([src, out]) => !fs.existsSync(path.join(rootDir, out))
      || !fs.readFileSync(path.join(rootDir, src)).equals(fs.readFileSync(path.join(rootDir, out))))
    .map(([, out]) => out);
}

function run(cmd, args, what) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`[serve-built-web] ${what} не удалось (код ${res.status}) — веб не поднят.`);
    process.exit(1);
  }
}

function prepare() {
  if (!fs.existsSync(path.join(WEB, 'node_modules', '@supabase', 'supabase-js'))) {
    console.log('[serve-built-web] нет web/node_modules — ставлю, как в CI');
    run('npm', ['ci', '--prefix', 'web', '--ignore-scripts'], 'npm ci --prefix web');
  }
  run('node', [path.join('scripts', 'sync-web-assets.js')], 'build:web');
  const missing = missingBuildFiles(WEB);
  if (missing.length) {
    console.error(`[serve-built-web] сборка web/ неполная, нет: ${missing.join(', ')} — веб не поднят.`);
    process.exit(1);
  }
  const stale = staleBuildFiles(ROOT);
  if (stale.length) {
    console.error(`[serve-built-web] после сборки ${stale.join(', ')} не совпадает с исходником — веб не поднят.`);
    process.exit(1);
  }
}

module.exports = { REQUIRED, missingBuildFiles, staleBuildFiles };

if (require.main === module) {
  const port = process.argv[2];
  if (!/^\d+$/.test(port || '')) {
    console.error('[serve-built-web] нужен порт: node tests/serve-built-web.js <порт>');
    process.exit(1);
  }
  prepare();
  // Сервер — тот же, что у npm run serve:web, в этом же процессе: Playwright
  // гасит ровно тот процесс, который запустил.
  process.argv = [process.argv[0], path.join(ROOT, 'scripts', 'serve-web.js'), port];
  require('../scripts/serve-web.js');
}

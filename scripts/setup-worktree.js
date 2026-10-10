#!/usr/bin/env node
/* Завести свою копию репозитория так, чтобы всё работало с первого раза.
 *
 *   node scripts/setup-worktree.js            # мобильные зависимости — по роли ветки
 *   node scripts/setup-worktree.js --mobile   # поставить и их
 *   node scripts/setup-worktree.js --no-mobile
 *
 * Регламент — CLAUDE.md → «Команда агентов» → «Где кто работает». Скрипт
 * делает и проверяет то, что раньше держалось на внимании, и падает громко,
 * если что-то не встало:
 *
 *   1. npm ci в корне.
 *   2. Двоичный Electron. Его кладёт установочный скрипт пакета electron, и
 *      он молча не дорабатывает: под Node 26 extract-zip 2.0.1 (yauzl 2.10)
 *      повисает после первого файла архива, Node видит пустой цикл событий и
 *      выходит с кодом 0. В dist/ остаётся LICENSES.chromium.html, path.txt
 *      нет, а npm ci доволен. allowScripts тут ни при чём: скрипт запускается.
 *      Поэтому проверяем результат сами и, если его нет, берём архив тем же
 *      @electron/get (из кэша или скачав) и распаковываем системным tar
 *      (bsdtar в Windows 10+ и macOS понимает zip; GNU tar из Git Bash — нет).
 *   3. npm ci --prefix web --ignore-scripts. Без него сборка веба молча не
 *      кладёт web/vendor/supabase.js (scripts/sync-web-assets.js берёт его из
 *      web/node_modules).
 *   4. npm ci --prefix mobile — ролям, которые трогают телефон: mobile/,
 *      qa-mobile/, core/ (копии ядра и зависимости телефона).
 *   5. .env.local — из основной копии (ключ журнала), если его ещё нет.
 *      Значение не печатается.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const MOBILE_ROLES = ['mobile', 'qa-mobile', 'core'];

/** Путь к исполняемому файлу внутри dist/ — то же, что пишет electron/install.js. */
function platformPath(platform = process.platform) {
  if (platform === 'darwin' || platform === 'mas') return 'Electron.app/Contents/MacOS/Electron';
  if (platform === 'win32') return 'electron.exe';
  return 'electron';
}

/** Нужны ли зависимости телефона: флаг сильнее, иначе — по префиксу ветки. */
function needsMobile(branch, argv = []) {
  if (argv.includes('--mobile')) return true;
  if (argv.includes('--no-mobile')) return false;
  const prefix = (branch || '').split('/')[0];
  return MOBILE_ROLES.includes(prefix);
}

/** Чем распаковывать zip: только bsdtar понимает его. */
function zipTool(platform = process.platform) {
  if (platform === 'win32') return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (platform === 'darwin') return '/usr/bin/tar';
  return null; // Linux: unzip
}

function fail(message) {
  console.error(`\n[setup-worktree] НЕ ГОТОВО: ${message}`);
  process.exit(1);
}

function step(title, cmd, args, opts = {}) {
  console.log(`\n[setup-worktree] ${title}: ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) fail(`${title} — команда вышла с кодом ${r.status}`);
}

function electronReady() {
  const dir = path.join(ROOT, 'node_modules', 'electron');
  const pathTxt = path.join(dir, 'path.txt');
  if (!fs.existsSync(pathTxt)) return false;
  return fs.existsSync(path.join(dir, 'dist', fs.readFileSync(pathTxt, 'utf8').trim()));
}

async function ensureElectron() {
  if (electronReady()) return console.log('[setup-worktree] Electron на месте');
  console.log('[setup-worktree] Electron не распакован установочным скриптом — распаковываю сам');

  const dir = path.join(ROOT, 'node_modules', 'electron');
  const { version } = require(path.join(dir, 'package.json'));
  const { downloadArtifact } = require(path.join(ROOT, 'node_modules', '@electron', 'get'));
  const zip = await downloadArtifact({
    // Те же параметры, что у electron/install.js, — значит, и тот же кэш.
    version, artifactName: 'electron', platform: process.platform, arch: process.env.npm_config_arch || process.arch,
    cacheRoot: process.env.electron_config_cache,
    checksums: require(path.join(dir, 'checksums.json')),
  });

  const dist = path.join(dir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const tool = zipTool();
  const r = tool
    ? spawnSync(tool, ['-xf', zip, '-C', dist], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', zip, '-d', dist], { stdio: 'inherit' });
  if (r.status !== 0) fail(`распаковать ${zip} не вышло (${tool || 'unzip'}, код ${r.status})`);
  fs.writeFileSync(path.join(dir, 'path.txt'), platformPath());
  if (!electronReady()) fail('Electron распакован, но исполняемого файла по path.txt нет');
  console.log(`[setup-worktree] Electron ${version} распакован`);
}

function ensureEnvLocal() {
  const target = path.join(ROOT, '.env.local');
  if (fs.existsSync(target)) return console.log('[setup-worktree] .env.local на месте');
  // Первая строка git worktree list — основная копия.
  const main = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
  const source = main && path.join(main, '.env.local');
  if (!source || !fs.existsSync(source) || path.resolve(source) === path.resolve(target)) {
    return console.warn('[setup-worktree] .env.local нет и взять негде — журнал будет копить записи в очередь');
  }
  fs.copyFileSync(source, target);
  console.log('[setup-worktree] .env.local скопирован из основной копии');
}

async function main() {
  const argv = process.argv.slice(2);
  let branch = '';
  try { branch = execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* detached */ }

  step('зависимости', 'npm', ['ci']);
  await ensureElectron();

  step('зависимости веба', 'npm', ['ci', '--prefix', 'web', '--ignore-scripts']);
  const umd = path.join(ROOT, 'web', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  if (!fs.existsSync(umd)) fail(`после npm ci --prefix web нет ${path.relative(ROOT, umd)}`);

  if (needsMobile(branch, argv)) step('зависимости телефона', 'npm', ['ci', '--prefix', 'mobile']);
  else console.log(`\n[setup-worktree] телефон пропущен (ветка ${branch || 'без имени'}; поставить: --mobile)`);

  ensureEnvLocal();
  console.log(`\n[setup-worktree] готово: ${ROOT} (${os.platform()}, Node ${process.version})`);
}

module.exports = { platformPath, needsMobile, zipTool };

if (require.main === module) main().catch((err) => fail(err.stack || err.message));

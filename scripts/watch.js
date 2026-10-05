// Сторож: следит за файлами и сам гоняет то, что задето правкой.
// Запуск: npm run watch  (остановить — Ctrl+C)
//
// Зачем он есть. Прогоны и так запускаются сами — крюком перед коммитом и в
// GitHub на каждый push. Но между правкой и крюком проходит время, и всё это
// время неизвестно, цел ли код. Сторож закрывает этот промежуток: сохранил
// файл — через секунду знаешь.
//
// Чего он не делает. Не чинит, не коммитит, не трогает граф — только гоняет
// и показывает. И не гоняет всё подряд: правка словаря телефона не требует
// браузера, правка лендинга не требует прогона веб-версии.
//
// Как решается, что гонять: по пути изменившегося файла, см. ROUTES. Слои
// идут от быстрых к медленным, чтобы первое «сломано» пришло как можно
// раньше.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FAST_ONLY = process.argv.includes('--fast');

// --- что чем проверяется ----------------------------------------------------

// Порядок важен: слои гоняются сверху вниз, и наверху самое быстрое.
//
// Зовётся сразу node, а не npm. Причины две. Первая — на Windows npm это
// .cmd, и Node с версии 20.12 отказывается запускать такой файл без shell
// (защита от подстановки аргументов), а с shell ругается уже на массив
// аргументов. Вторая — так быстрее: каждый npm run это ещё один процесс
// оболочки поверх настоящей работы.
const PLAYWRIGHT = 'node_modules/@playwright/test/cli.js';
// Своя папка следов, и обязательно РЯДОМ с test-results/, а не внутри:
// Playwright вычищает свою выходную папку целиком в начале прогона, так что
// ручной npm test сносил бы следы сторожа прямо посреди его работы. Внутренний
// test-results/watch именно так и падал — browserContext.close: ENOENT на
// файле трассы, которого уже нет.
const PW_OUT = '--output=test-results-watch';

const LAYERS = [
  { id: 'unit', title: 'юниты', args: ['--test', 'tests/unit/*.test.js'], fast: true },
  { id: 'xlsx', title: 'таблицы', args: ['scripts/xlsx-check.js'], fast: true },
  { id: 'mobile', title: 'телефон', args: ['node_modules/jest/bin/jest.js'], cwd: 'mobile', fast: true },
  { id: 'web', title: 'браузер: веб', args: [PLAYWRIGHT, 'test', '--project=web', PW_OUT], fast: false, build: true },
  { id: 'landing', title: 'браузер: лендинг', args: [PLAYWRIGHT, 'test', '--project=landing', PW_OUT], fast: false },
  { id: 'visual', title: 'снимки', args: [PLAYWRIGHT, 'test', '--project=visual', PW_OUT], fast: false },
];

// Сборка web/ из src/ — её же делает npm run build:web.
const BUILD_WEB = ['scripts/sync-web-assets.js'];

// Путь → слои, которые он задевает. Проверяется по порядку, срабатывают все
// подходящие правила.
const ROUTES = [
  // Ядро общее у всех трёх поверхностей — задевает и телефон, и браузер.
  [/^src[\\/]renderer[\\/]core[\\/]/, ['unit', 'mobile', 'web']],
  [/^src[\\/]xlsx\.js$/, ['unit', 'xlsx', 'web']],
  [/^src[\\/]renderer[\\/]/, ['unit', 'web', 'visual']],
  [/^web[\\/]index\.html$/, ['unit', 'web', 'visual']],
  [/^mobile[\\/]/, ['unit', 'mobile']],
  [/^landing[\\/]/, ['unit', 'landing', 'visual']],
  [/^tests[\\/]unit[\\/]/, ['unit']],
  [/^tests[\\/]e2e[\\/]/, ['web']],
  [/^tests[\\/]landing[\\/]/, ['landing']],
  [/^tests[\\/]visual[\\/]/, ['visual']],
  [/^tests[\\/](css|ports)\.js$/, ['unit', 'web', 'landing', 'visual']],
  [/^scripts[\\/]xlsx-check\.js$/, ['xlsx']],
  // Скрипты сборки и синхронизации ядра: их ломает тот же юнит-набор.
  [/^scripts[\\/]/, ['unit']],
  [/^playwright\.config\.js$/, ['web', 'landing', 'visual']],
];

// Куда не смотреть вовсе. web/ почти целиком собирается из src/ — если
// следить за ним, сборка перед прогоном сама себя и перезапустит.
const IGNORE = [
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.git([\\/]|$)/,
  /^graphify-out[\\/]/,
  /^test-results[\\/]/,
  /^playwright-report[\\/]/,
  /^dist[\\/]/,
  /^web[\\/](?!index\.html$)/,
  /-snapshots[\\/].*\.png$/,
  /\.(log|tmp|swp)$/,
  /~$/,
];

const WATCH_DIRS = ['src', 'web', 'mobile/src', 'mobile/tests', 'landing', 'tests', 'scripts'];

// --- вывод ------------------------------------------------------------------

const ts = () => new Date().toTimeString().slice(0, 8);
const say = (text) => process.stdout.write(`[${ts()}] ${text}\n`);

function layersFor(rel) {
  const out = new Set();
  for (const [re, ids] of ROUTES) if (re.test(rel)) ids.forEach((id) => out.add(id));
  return out;
}

// --- прогон -----------------------------------------------------------------

/** Прогон одной команды через node. Вывод копится целиком: при успехе из
 *  него берётся счёт тестов, при падении он показывается как есть. */
function run(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: cwd ? path.join(ROOT, cwd) : ROOT,
      // Своя пара портов для браузерных прогонов: иначе сторож и ручной
      // npm test делят сервер, который Playwright гасит, закончив, — прямо
      // из-под соседа. См. tests/ports.js.
      env: { ...process.env, LANCIBLE_TEST_PORTS: 'watch' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** Из вывода прогона — одна строка о том, чем всё кончилось. Падение
 *  показывается целиком: смысл сторожа в том, чтобы не ходить смотреть. */
function summary(layer, { code, output }) {
  if (code === 0) {
    // Три разных прогона — три формата сводки.
    //   node --test:  «ℹ pass 213» / «ℹ skipped 1»
    //   jest:         «Tests: 9 passed, 9 total»
    //   playwright:   «  10 passed (44.7s)» / «  2 skipped»
    const node = output.match(/^\u2139\s*pass (\d+)/m);
    const jest = output.match(/^Tests:\s+(\d+) passed/m);
    const pw = output.match(/^\s+(\d+) passed/m);
    const skipped = output.match(/^(?:\u2139\s*|\s+)(\d+) skipped/m);
    const n = (node || jest || pw || [])[1];
    const tail = skipped ? `, пропущено ${skipped[1]}` : '';
    return `✓ ${layer.title}${n ? ` — ${n}${tail}` : ''}`;
  }
  return `✗ ${layer.title}\n${output.trimEnd()}\n`;
}

let running = false;
const pending = new Set();

async function flush() {
  if (running || pending.size === 0) return;
  running = true;
  const todo = LAYERS.filter((l) => pending.has(l.id) && (!FAST_ONLY || l.fast));
  const skippedSlow = FAST_ONLY && LAYERS.some((l) => pending.has(l.id) && !l.fast);
  pending.clear();

  if (todo.length === 0) {
    if (skippedSlow) say('медленные слои пропущены (--fast)');
    running = false;
    return;
  }

  say(`гоню: ${todo.map((l) => l.title).join(', ')}`);
  let broke = false;
  for (const layer of todo) {
    if (layer.build) {
      const built = await run(BUILD_WEB);
      if (built.code !== 0) {
        say(`✗ сборка web/\n${built.output.trimEnd()}\n`);
        broke = true;
        break;
      }
    }
    const res = await run(layer.args, layer.cwd);
    say(summary(layer, res));
    if (res.code !== 0) { broke = true; break; }
  }
  if (!broke) say('всё цело');
  running = false;
  // Пока гоняли, могли прийти новые правки.
  if (pending.size) setTimeout(flush, 0);
}

let timer = null;
function touched(rel) {
  if (IGNORE.some((re) => re.test(rel))) return;
  const ids = layersFor(rel);
  if (ids.size === 0) return;
  ids.forEach((id) => pending.add(id));
  say(`${rel}`);
  clearTimeout(timer);
  // Редакторы сохраняют файл в несколько приёмов, а правка почти никогда не
  // бывает одна. Полсекунды тишины — и только тогда прогон.
  timer = setTimeout(flush, 500);
}

// --- запуск -----------------------------------------------------------------

for (const dir of WATCH_DIRS) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, { recursive: true }, (_event, name) => {
    if (!name) return;
    touched(path.join(dir, name));
  });
}

say(`сторож смотрит за: ${WATCH_DIRS.join(', ')}`);
say(FAST_ONLY ? 'режим --fast: только юниты, таблицы и телефон' : 'браузерные слои включены (быстрее — npm run watch -- --fast)');
say('остановить — Ctrl+C');

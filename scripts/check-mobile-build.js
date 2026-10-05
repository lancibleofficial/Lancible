// Сборка телефона: Metro собирает бандл Android.
// Запуск: npm run check:mobile-build  (в GitHub — работа «Сборка телефона»)
//
// Откуда взялось. 6 октября 2026 сборка APK падала: mobile/src/core/views.js
// подключал соседей через require с вычисляемым путём, а Metro такого не
// понимает. Тесты при этом были зелёными — и jest, и юниты гоняют код в Node,
// где такой require работает. До пользователей не дошло только потому, что
// APK собирается по тегу mobile-v*. Частный случай стережёт
// tests/unit/mobile-core.test.js; этот скрипт ловит весь класс разом: бандл
// собирает сам Metro — тот же, что собирает его в APK, — и с теми же
// настройками выпуска: без __DEV__, с байткодом Hermes.
//
// Падает, если expo export вернул ошибку или если ошибки нет, а бандла нет.
// Бандл кладётся во временную папку и после проверки удаляется.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MOBILE = path.join(__dirname, '..', 'mobile');
const PLATFORM = 'android';

/** Что не так с выгрузкой в dir; null — бандл на месте. Сверяется не по
 *  имени файла (в нём хеш), а по metadata.json, который пишет expo export. */
function checkExport(dir, platform = PLATFORM) {
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return `нет ${metaPath}`;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (e) {
    return `metadata.json не читается: ${e.message}`;
  }
  const rel = meta && meta.fileMetadata && meta.fileMetadata[platform] && meta.fileMetadata[platform].bundle;
  if (!rel) return `в metadata.json нет бандла для ${platform}`;
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return `бандл ${rel} указан в metadata.json, но файла нет`;
  if (fs.statSync(file).size === 0) return `бандл ${rel} пустой`;
  return null;
}

function main() {
  // Зовём CLI expo через node, а не npx: на Windows npx — это .cmd, и Node
  // без shell его не запустит (см. scripts/watch.js).
  let cli;
  try {
    cli = require.resolve('expo/bin/cli', { paths: [MOBILE] });
  } catch {
    console.error('В mobile/ не стоят зависимости: сначала npm ci в mobile/.');
    return 1;
  }

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-mobile-export-'));
  try {
    const res = spawnSync(process.execPath, [cli, 'export', '--platform', PLATFORM, '--output-dir', out], {
      cwd: MOBILE,
      stdio: 'inherit',
      // CI=1 — без вопросов: обязательный вопрос роняет команду, а не вешает.
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    });
    if (res.error) {
      console.error(`expo export не запустился: ${res.error.message}`);
      return 1;
    }
    if (res.status !== 0) {
      console.error(`Metro не собрал бандл ${PLATFORM}: expo export вернул ${res.status}.`);
      return 1;
    }
    const problem = checkExport(out);
    if (problem) {
      console.error(`expo export закончился без ошибки, но бандла нет: ${problem}.`);
      return 1;
    }
    console.log(`Бандл ${PLATFORM} собран.`);
    return 0;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { checkExport };

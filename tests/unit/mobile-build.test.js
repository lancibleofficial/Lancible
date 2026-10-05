// Сборка телефона: проверка, что Metro собрал бандл, сама не врёт и
// действительно гоняется в GitHub.
// Запуск: npm run test:unit
//
// Сама сборка здесь не запускается — это двадцать секунд и зависимости
// телефона, а юниты должны укладываться в доли секунды. Её гоняет
// npm run check:mobile-build: сторож, npm test и работа «Сборка телефона».
// Здесь — то, что видно без неё: как скрипт решает «бандл есть» и что
// работа в test.yml на месте.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkExport } = require('../../scripts/check-mobile-build.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// --- как решается «бандл есть» ------------------------------------------------

/** Папка как после expo export: metadata.json и, если дан, файл бандла. */
function fakeExport({ meta, bundle }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-fake-export-'));
  if (meta !== undefined) {
    fs.writeFileSync(path.join(dir, 'metadata.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  if (bundle) {
    const file = path.join(dir, bundle.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle.content);
  }
  return dir;
}

const BUNDLE = '_expo/static/js/android/index-0123.hbc';
const META = { version: 0, bundler: 'metro', fileMetadata: { android: { bundle: BUNDLE, assets: [] } } };

test('выгрузка с бандлом проходит', (t) => {
  const dir = fakeExport({ meta: META, bundle: { path: BUNDLE, content: 'HBC' } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(checkExport(dir), null);
});

test('выгрузка без бандла не проходит — по каждой из причин', (t) => {
  const cases = [
    ['пустая папка', {}, /нет .*metadata\.json/],
    ['битый metadata.json', { meta: '{' }, /не читается/],
    ['нет бандла для android', { meta: { fileMetadata: { ios: { bundle: BUNDLE } } } }, /нет бандла для android/],
    ['бандл указан, файла нет', { meta: META }, /файла нет/],
    ['бандл пустой', { meta: META, bundle: { path: BUNDLE, content: '' } }, /пустой/],
  ];
  for (const [name, setup, why] of cases) {
    const dir = fakeExport(setup);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.match(checkExport(dir) || '', why, name);
  }
});

// --- что это гоняется ---------------------------------------------------------

test('npm run check:mobile-build зовёт скрипт проверки сборки', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['check:mobile-build'], 'node scripts/check-mobile-build.js');
  assert.match(scripts.test, /npm run check:mobile-build/, 'npm test — «всё целиком», и сборка телефона в нём тоже');
});

test('сторож собирает бандл на правку того, что в бандл попадает', () => {
  const { layersFor } = require('../../scripts/watch.js');
  const builds = (rel) => layersFor(rel).has('mobile-build');
  for (const rel of ['mobile/src/core/views.js', 'mobile/src/screens/SettingsScreen.js', 'mobile/App.js', 'mobile/app.json', 'scripts/check-mobile-build.js']) {
    assert.ok(builds(rel), `правка ${rel} не запускает сборку телефона`);
  }
  // Тесты в бандл не попадают, а лендинг к телефону отношения не имеет.
  for (const rel of ['mobile/tests/Icon.test.js', 'landing/index.html']) {
    assert.ok(!builds(rel), `правка ${rel} зря запускает сборку телефона`);
  }
});

test('в test.yml есть работа, которая ставит зависимости телефона и собирает бандл', () => {
  const yml = read('.github/workflows/test.yml');
  // Работы — ключи второго уровня под jobs:, у каждой свой кусок до следующей.
  const jobs = yml.slice(yml.search(/^jobs:$/m)).split(/^(?= {2}[\w-]+:\s*$)/m).slice(1);
  const build = jobs.find((j) => j.includes('npm run check:mobile-build'));
  assert.ok(build, 'ни одна работа в test.yml не зовёт npm run check:mobile-build');
  assert.match(build, /npm ci[^\n]*\n\s+working-directory: mobile/, 'зависимости телефона не ставятся');
  assert.match(build, /cache-dependency-path: mobile\/package-lock\.json/, 'кэш npm не привязан к замку телефона');
});

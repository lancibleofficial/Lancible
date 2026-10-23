// Админка подключена к общей инфраструктуре проверок. Запуск: npm run test:unit
//
// Сами тесты админки — tests/admin/ (Playwright) и правила цвета в
// visual-rules.test.js. Здесь другое: что их вообще гоняют. Тест, который
// никто не зовёт, зелёным ничего не доказывает, а забыть позвать — самая
// тихая из поломок: «npm test» зелёный, и в нём нет ни одной проверки админки.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

test('npm run test:admin гоняет проект admin, а npm test — после лендинга и до снимков', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['test:admin'], 'playwright test --project=admin');
  assert.match(scripts.test, /npm run test:landing && npm run test:admin && npm run test:visual/,
    'npm test — «всё целиком», и админка в нём стоит между лендингом и снимками');
});

test('в test.yml админку гоняет та же работа, что веб и лендинг, после установки Chromium', () => {
  const yml = read('.github/workflows/test.yml');
  const jobs = yml.slice(yml.search(/^jobs:$/m)).split(/^(?= {2}[\w-]+:\s*$)/m).slice(1);
  const browser = jobs.find((j) => j.includes('npm run test:landing'));
  assert.ok(browser, 'ни одна работа в test.yml не гоняет лендинг');
  assert.ok(browser.includes('npm run test:e2e'), 'лендинг и веб гоняет не одна работа — сверьте test.yml');
  const install = browser.indexOf('playwright install');
  const admin = browser.indexOf('npm run test:admin');
  assert.ok(admin !== -1, 'работа с браузерными тестами не гоняет npm run test:admin');
  assert.ok(install !== -1 && install < admin, 'Chromium ставится после прогона админки (или не ставится)');
  // Админка не завела отдельную работу: число работ называют документы
  // (architecture.test.js), и сбой установки браузера не должен размножаться.
  assert.ok(!jobs.some((j) => j !== browser && j.includes('npm run test:admin')), 'админку гоняет ещё и другая работа');
});

test('сторож гоняет админку на правку admin/, её тестов, её сервера и общих конфигов', () => {
  const { layersFor } = require('../../scripts/watch.js');
  const has = (rel) => layersFor(rel).has('admin');
  for (const rel of [
    'admin/admin.css', 'admin/index.html', 'admin/js/app.js', 'admin/js/sections/blog.js', 'admin/screens.js',
    'scripts/serve-admin.js', 'tests/admin/auth.spec.js', 'tests/admin/mock.js', 'tests/admin/port.js',
    'playwright.config.js', 'tests/ports.js', 'tests/css.js',
  ]) {
    assert.ok(has(rel), `правка ${rel} не запускает браузерные тесты админки`);
  }
  // Правка админки задевает ещё и юниты (там сторож её цветов); правка тестов — нет.
  assert.ok(layersFor('admin/admin.css').has('unit'), 'правка admin.css не запускает юниты — а в них правила цвета');
  assert.ok(layersFor('admin/js/ui.js').has('unit'));
  assert.ok(!layersFor('tests/admin/auth.spec.js').has('unit'));
  // И наоборот: веб, лендинг, телефон админку не трогают.
  for (const rel of ['src/renderer/app.js', 'landing/index.html', 'tests/e2e/layout.spec.js', 'tests/landing/header.spec.js', 'mobile/src/theme.js']) {
    assert.ok(!has(rel), `правка ${rel} зря запускает тесты админки`);
  }
  const watch = read('scripts/watch.js');
  assert.match(watch, /id: 'admin'[^\n]*--project=admin/, 'у слоя admin в scripts/watch.js нет прогона проекта admin');
  assert.match(watch, /WATCH_DIRS = \[[^\]]*'admin'/, 'сторож не следит за папкой admin/');
});

test('граф не разбирает сторонние библиотеки админки', () => {
  const lines = read('.graphifyignore').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('admin/vendor/'), 'в .graphifyignore нет admin/vendor/ — чужой минифицированный код дал бы в графе сотни безымянных узлов');
  // Своё — admin/js и admin/screens.js — граф видеть обязан: по нему работает
  // проверка на мёртвый код.
  assert.ok(!lines.some((l) => /^admin\/(js|screens)/.test(l)), 'собственный код админки спрятан от графа');
});

// 23 октября 2026: запущенный локальный сервер админки не знал действий,
// добавленных в функцию после его запуска («unknown action» в «Журнале»).
// Теперь он пересобирает функцию, если её файл правили.
test('serve-admin пересобирает функцию admin после правки её файла', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'serve-admin.js'), 'utf8');
  assert.match(src, /statSync\(FN_SRC\)\.mtimeMs/, 'сервер смотрит время изменения файла функции');
  assert.match(src, /freshHandler\(\)\.then\(\(h\) => callFunction\(h, req, res\)\)/, 'каждый запрос идёт через свежий обработчик');
});

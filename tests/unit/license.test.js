// Лицензия: open source не планируется (решение пользователя, 10 октября
// 2026). Ни один наш пакет не должен заявлять открытую лицензию — иначе
// это обещание, которого мы не давали. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

test('корневой пакет — UNLICENSED и private, в lock-файле то же', () => {
  const pkg = read('package.json');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.private, true, 'private: true не даёт случайно опубликовать пакет в npm');
  assert.equal(read('package-lock.json').packages[''].license, 'UNLICENSED');
});

test('ни один package.json репозитория не заявляет другую лицензию', () => {
  const files = execFileSync('git', ['ls-files', '*package.json'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    const { license } = read(f);
    assert.ok(license === undefined || license === 'UNLICENSED', `${f}: license = ${license}`);
  }
});

test('в репозитории нет файлов лицензии MIT на наш код', { todo: 'mobile/LICENSE — MIT шаблона Expo (650 Industries), убирает Mobile' }, () => {
  const files = execFileSync('git', ['ls-files', 'LICENSE', '*/LICENSE', 'LICENSE.*', '*/LICENSE.*'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(files, []);
});

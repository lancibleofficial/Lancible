// Копии ядра в мобильном. Запуск: npm run test:unit
//
// mobile/src/core — побайтные копии файлов из src/renderer/core: у мобильного
// свой Metro, который не видит файлы выше папки mobile/, а собирает его EAS,
// где корневые скрипты не выполняются. Значит копии лежат в репозитории — и
// значит они могут разойтись с оригиналом молча.
//
// Разойдутся — и телефон начнёт считать повторения по своему, устаревшему
// правилу, а заметит это только пользователь. Поэтому сверяем побайтно.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CORE = path.join(ROOT, 'src', 'renderer', 'core');
const MOBILE = path.join(ROOT, 'mobile', 'src', 'core');

const files = fs.existsSync(MOBILE)
  ? fs.readdirSync(MOBILE).filter((f) => f.endsWith('.js'))
  : [];

test('мобильный забрал себе часть ядра', () => {
  assert.ok(files.length >= 3, `файлов в mobile/src/core: ${files.length} — запустите node scripts/sync-mobile-core.js`);
});

test('копии совпадают с оригиналом побайтно', () => {
  const drifted = [];
  for (const name of files) {
    const original = path.join(CORE, name);
    assert.ok(fs.existsSync(original), `${name} есть в mobile/src/core, но нет в src/renderer/core`);
    if (!fs.readFileSync(original).equals(fs.readFileSync(path.join(MOBILE, name)))) drifted.push(name);
  }
  assert.deepEqual(drifted, [], `копии разошлись: ${drifted.join(', ')} — запустите node scripts/sync-mobile-core.js`);
});

test('копии грузятся как обычный CommonJS и отдают то же, что оригинал', () => {
  // Metro читает их как CommonJS. Если шим когда-нибудь переделают под
  // только-браузер, мобильное молча получит пустой объект.
  for (const name of files) {
    const mine = require(path.join(MOBILE, name));
    const theirs = require(path.join(CORE, name));
    assert.ok(Object.keys(mine).length > 0, `${name} ничего не экспортирует при require`);
    assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort(), `${name}: разный набор имён`);
  }
});

test('светлая и тёмная палитры телефона объявляют один и тот же набор токенов', () => {
  // Добавил токен в одну тему и забыл во второй — приложение не падает, а
  // молча рисует undefined: в React Native это «цвета нет», то есть чёрный
  // текст на чёрном фоне или прозрачная подложка.
  const file = path.join(ROOT, 'mobile', 'src', 'theme.js');
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', `${src};module.exports = { dark, light };`)(box);
  const { dark, light } = box.exports;

  const a = Object.keys(dark).sort();
  const b = Object.keys(light).sort();
  assert.deepEqual(b.filter((k) => !a.includes(k)), [], 'в тёмной не хватает токенов');
  assert.deepEqual(a.filter((k) => !b.includes(k)), [], 'в светлой не хватает токенов');
  for (const key of a) {
    assert.ok(dark[key] && light[key], `${key}: пустое значение в одной из тем`);
  }
});

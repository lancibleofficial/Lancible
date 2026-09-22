// Общее пространство имён Core. Запуск: npm run test:unit
//
// В браузере файлы из core/ не импортируются, а сваливаются в один объект
// Core через Object.assign. Значит два файла с одинаковым именем функции
// молча затирают друг друга — и побеждает тот, чей <script> ниже.
//
// Так уже случилось: versions.js экспортировал nameTaken, tags.js тоже, и
// проверка занятых имён тегов внезапно стала проверять версии. Ни одна
// ошибка при этом не всплыла — отвалился только тест на диалог тегов.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CORE = path.join(__dirname, '..', '..', 'src', 'renderer', 'core');
const files = fs.readdirSync(CORE).filter((f) => f.endsWith('.js'));

test('в core/ есть что проверять', () => {
  assert.ok(files.length >= 5, `файлов в core/: ${files.length}`);
});

test('имена во всех файлах core/ не пересекаются', () => {
  const owner = new Map();
  const clashes = [];
  for (const file of files) {
    const api = require(path.join(CORE, file));
    for (const name of Object.keys(api)) {
      if (owner.has(name)) clashes.push(`${name}: ${owner.get(name)} и ${file}`);
      else owner.set(name, file);
    }
  }
  assert.deepEqual(clashes, [], `в Core одно имя на двоих:\n  ${clashes.join('\n  ')}`);
});

test('каждый файл core/ действительно что-то экспортирует', () => {
  // Пустой экспорт значит, что файл забыли подключить к общему объекту, и
  // в браузере его функции просто не появятся.
  for (const file of files) {
    const api = require(path.join(CORE, file));
    assert.ok(Object.keys(api).length > 0, `${file} ничего не экспортирует`);
  }
});

test('оба index.html подключают все файлы core/', () => {
  // Файлы из core/ копируются в web/ целиком на сборке, а вот <script> в
  // разметке надо дописывать руками — и об этом легко забыть.
  const pages = [
    path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'),
    path.join(__dirname, '..', '..', 'web', 'index.html'),
  ];
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    for (const file of files) {
      assert.ok(
        html.includes(`core/${file}`),
        `${path.basename(path.dirname(page))}/index.html не подключает core/${file}`,
      );
    }
  }
});

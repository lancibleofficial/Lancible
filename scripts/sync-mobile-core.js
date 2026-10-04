// Копирует чистую логику из src/renderer/core в mobile/src/core.
//
// Почему копией, а не импортом через границу папки: у мобильного свой
// package.json и свой Metro, который по умолчанию не видит файлы выше
// mobile/. Настроить watchFolders можно, но тогда сборка на EAS начинает
// зависеть от расположения репозитория — а копия лежит рядом с кодом и
// приезжает вместе с ним.
//
// Почему копии закоммичены, в отличие от web/: веб собирает Vercel, он
// запускает наш скрипт. Мобильное собирает EAS из папки mobile/, корневые
// скрипты там не выполняются, и файлы должны уже лежать в репозитории.
//
// Чтобы копии не разошлись с оригиналом, есть tests/unit/mobile-core.test.js:
// он сверяет их побайтно и падает, если забыли пересинхронизировать.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'src', 'renderer', 'core');
const to = path.join(root, 'mobile', 'src', 'core');

// Только то, что мобильному действительно нужно. Остальное (format, money,
// tags, migrate) у него своё: там логика переписана под явную передачу языка
// и валюты вместо глобального state.
const FILES = ['repeat.js', 'versions.js', 'agenda.js', 'status.js', 'reports.js', 'tags.js', 'sync.js', 'format.js', 'money.js'];

fs.mkdirSync(to, { recursive: true });
let changed = 0;
for (const name of FILES) {
  const src = fs.readFileSync(path.join(from, name));
  const dest = path.join(to, name);
  const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(src);
  if (!same) { fs.writeFileSync(dest, src); changed += 1; }
  console.log(`${same ? '=' : '→'} ${name}`);
}
console.log(changed ? `[sync-mobile-core] обновлено файлов: ${changed}` : '[sync-mobile-core] всё уже совпадает');

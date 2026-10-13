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
//
// illustrations.js — сценки пустых экранов: формы без цвета, классами-ролями.
// Телефон разбирает ту же разметку и рисует её react-native-svg, красит из
// theme.js (components/ArtScene.js) — сценки на всех поверхностях одни.
//
// export.js — выбор выгрузки в Excel: период, проекты, сводка «будет
// выгружено». Лист экспорта телефона (components/ExportPeriodSheet.js) —
// то же окно, что на вебе, и сводка должна совпадать с файлом так же.
//
// slots.js — «время работы»: вхождения отрезков, перекат повтора без
// дедлайна. Его зовут due.js, views.js и migrate.js, так что без копии не
// собрался бы и бандл телефона.
//
// reminders.js — напоминания задачи списком: модель, зеркало старых полей
// и движок (что пора показать, что запланировать). Его зовут due.js,
// slots.js и migrate.js.
const FILES = ['repeat.js', 'versions.js', 'agenda.js', 'status.js', 'reports.js', 'tags.js', 'sync.js', 'format.js', 'money.js', 'due.js', 'slots.js', 'reminders.js', 'lang.js', 'catalog.js', 'migrate.js', 'views.js', 'legal.js', 'doc.js', 'icons.js', 'illustrations.js', 'export.js'];

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

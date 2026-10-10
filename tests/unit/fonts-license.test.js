// Шрифты в репозитории — только с лицензией рядом. Запуск: npm run test:unit
//
// Откуда тест. 10 октября 2026 выяснилось, что логотип десктопа и веба
// набирался Basique Pro, а лицензии на него нет: файл лежал в assets/fonts,
// попадал в установщик и открыто отдавался вебом. Логотип перевели на Onest,
// файл удалили. Проверка на лицензию была только у шрифтов лендинга
// (legal-pages.test.js), а assets/fonts и mobile/assets/fonts не проверял
// никто. Здесь — все три папки: у каждого файла шрифта рядом лежит
// лицензия его семейства, «<Семейство>-OFL.txt» или «<Семейство>-LICENSE.txt».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const FONT_DIRS = ['assets/fonts', 'landing/fonts', 'mobile/assets/fonts'];
const FONT_FILE = /\.(woff2?|ttf|otf|eot)$/i;

test('у каждого файла шрифта рядом лежит лицензия его семейства', () => {
  let checked = 0;
  for (const dir of FONT_DIRS) {
    const names = fs.readdirSync(path.join(ROOT, dir));
    for (const name of names.filter((n) => FONT_FILE.test(n))) {
      const family = name.split('-')[0];
      const licensed = [`${family}-OFL.txt`, `${family}-LICENSE.txt`].some((l) => names.includes(l));
      assert.ok(licensed, `${dir}/${name}: рядом нет ${family}-OFL.txt или ${family}-LICENSE.txt`);
      checked += 1;
    }
  }
  assert.ok(checked >= 15, `нашлось ${checked} файлов шрифтов — папки переехали?`);
});

test('Basique Pro в поставке больше нет', () => {
  // Лицензии нет (решение 10 октября 2026): файл не должен вернуться ни в
  // одну папку, откуда шрифты уходят в установщик, веб или телефон.
  for (const dir of FONT_DIRS) {
    const found = fs.readdirSync(path.join(ROOT, dir)).filter((n) => /basique/i.test(n));
    assert.deepEqual(found, [], `${dir}: Basique Pro без лицензии`);
  }
});

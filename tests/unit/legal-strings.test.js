// Правовые строки одинаковы на десктопе и на телефоне. Запуск: npm run test:unit
//
// Зачем. Словари у десктопа (src/renderer/core/i18n.js) и у телефона
// (mobile/src/lib/i18n.js) свои: у телефона строки короче, экран уже. Но
// правовой текст — согласие при входе, предупреждение перед удалением
// аккаунта, названия документов — должен звучать одинаково везде: человек
// соглашается с одной и той же формулировкой, на чём бы он ни вошёл. Legal
// Manager правит его в одном словаре, и второй молча отстаёт.
//
// Ключи берутся по префиксам, а не списком: новый правовой ключ попадает
// под проверку сам.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CoreLang = require('../../src/renderer/core/lang.js');
const DESKTOP = require('../../src/renderer/core/i18n.js').T;

/** Словарь телефона — ES-модуль; читаем так же, как tests/unit/wording.test.js. */
const MOBILE = (() => {
  const file = path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'i18n.js');
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', 'Lang', `${src};module.exports = { T };`)(box, CoreLang);
  return box.exports.T;
})();

const LANGS = ['ru', 'en', 'uk', 'kk'];
const PREFIXES = ['auth.consent_', 'account.delete', 'about.privacy', 'about.terms', 'about.legal'];
const isLegal = (key) => PREFIXES.some((p) => key.startsWith(p));

/** Правовые ключи словаря — по всем языкам сразу. */
const legalKeys = (dict) => [...new Set(LANGS.flatMap((l) => Object.keys(dict[l] || {}).filter(isLegal)))].sort();

test('в словаре десктопа все правовые ключи на месте', () => {
  // 14 на 10 октября 2026: шесть про согласие, пять про удаление аккаунта,
  // три названия документов. Меньше — значит, ключ потерялся.
  assert.ok(legalKeys(DESKTOP).length >= 14, `правовых ключей на десктопе ${legalKeys(DESKTOP).length}, ожидалось не меньше 14`);
});

test('у телефона и десктопа один и тот же набор правовых ключей', () => {
  assert.deepEqual(legalKeys(MOBILE), legalKeys(DESKTOP));
});

for (const lang of LANGS) {
  test(`правовые строки совпадают побайтно — ${lang}`, () => {
    const differ = [];
    for (const key of legalKeys(DESKTOP)) {
      const d = DESKTOP[lang] && DESKTOP[lang][key];
      const m = MOBILE[lang] && MOBILE[lang][key];
      assert.ok(d && d.trim(), `десктоп, ${lang}: ${key} пуст или его нет`);
      assert.ok(m && m.trim(), `телефон, ${lang}: ${key} пуст или его нет`);
      if (Buffer.compare(Buffer.from(d, 'utf8'), Buffer.from(m, 'utf8')) !== 0) {
        differ.push(`${key}\n    десктоп: ${d}\n    телефон: ${m}`);
      }
    }
    assert.deepEqual(differ, [], `разошлись (${lang}):\n  ${differ.join('\n  ')}`);
  });
}

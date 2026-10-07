// Строки редактора (src/editor/strings.js). Запуск: npm run test:unit
//
// У редактора свой словарь: он один на десктоп, веб и WebView телефона, а у
// телефона свой i18n. Правила те же, что у словарей приложения: набор ключей
// во всех языках один, подстановки совпадают, обращение — на «вы»
// (tests/unit/wording.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** strings.js — ES-модуль; читаем его так же, как словарь телефона. */
const STRINGS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'editor', 'strings.js'), 'utf8').replace(/^export /gm, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', `${src};module.exports = { STRINGS, translate };`)(box);
  return box.exports;
})();

const LANGS = ['ru', 'en', 'uk', 'kk'];

test('у редактора те же четыре языка, что у приложения', () => {
  assert.deepEqual(Object.keys(STRINGS.STRINGS).sort(), [...LANGS].sort());
});

test('во всех языках редактора один набор ключей', () => {
  const base = Object.keys(STRINGS.STRINGS.ru).sort();
  for (const lang of LANGS) {
    const keys = Object.keys(STRINGS.STRINGS[lang]).sort();
    assert.deepEqual(keys.filter((k) => !base.includes(k)), [], `${lang}: лишние ключи`);
    assert.deepEqual(base.filter((k) => !keys.includes(k)), [], `${lang}: нет ключей`);
  }
});

test('подстановки {имя} совпадают во всех языках редактора', () => {
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const [key, ru] of Object.entries(STRINGS.STRINGS.ru)) {
    for (const lang of LANGS) assert.equal(vars(STRINGS.STRINGS[lang][key]), vars(ru), `${lang} / ${key}`);
  }
});

test('ни одной пустой строки', () => {
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(STRINGS.STRINGS[lang])) assert.ok(String(v).trim(), `${lang} / ${k}`);
  }
});

test('каждый ключ, который называет код редактора, есть в словаре', () => {
  const dir = path.join(ROOT, 'src', 'editor');
  const used = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'strings.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z_]+(?:\.[a-z_0-9]+)?)'/g)) used.add(m[1]);
    // Ключи в тернарниках: t(x ? 'a.b' : 'c.d').
    for (const m of src.matchAll(/\bt\([^)]*?\?\s*'([a-z_.0-9]+)'\s*:\s*'([a-z_.0-9]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  const missing = [...used].filter((k) => !(k in STRINGS.STRINGS.ru));
  assert.deepEqual(missing, [], 'ключи без строки — на экране будет сам ключ');
  assert.ok(used.size > 150, `нашлось ${used.size} ключей — разбор сломался?`);
});

test('редактор обращается на «вы», а не на «ты»', () => {
  // Те же признаки «ты», что в wording.test.js: повелительное на -й/-и без -те.
  const bad = /(^|[^а-яё])(нажми|выдели|напиши|потяни|рисуй|щёлкни|задержи|выбери|поставь)([^а-яё]|$)/i;
  for (const lang of ['ru', 'uk']) {
    for (const [k, v] of Object.entries(STRINGS.STRINGS[lang])) assert.ok(!bad.test(v), `${lang} / ${k}: ${v}`);
  }
});

test('translate подставляет значения и откатывается на русский', () => {
  assert.equal(STRINGS.translate('en', 'stats.words', { n: 5 }), '5 words');
  assert.equal(STRINGS.translate('xx', 'common.save'), 'Сохранить');
  assert.equal(STRINGS.translate('ru', 'нет.такого'), 'нет.такого');
});

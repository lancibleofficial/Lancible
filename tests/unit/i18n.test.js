// Переводы. Главное здесь — не функции, а сам словарь: пропущенный перевод
// не роняет приложение, он молча показывает русскую строку посреди
// английского интерфейса, и поймать это руками почти невозможно.
// Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../../src/renderer/core/i18n.js');

const LANGS = Object.keys(I.T);

test('языков четыре и у каждого есть название и локаль', () => {
  assert.deepEqual(LANGS.sort(), ['en', 'kk', 'ru', 'uk']);
  for (const l of LANGS) {
    assert.ok(I.LANG_NAMES[l], `нет названия языка ${l}`);
    assert.ok(I.LOCALE_MAP[l], `нет локали для ${l}`);
  }
});

test('во всех языках один и тот же набор ключей', () => {
  const base = Object.keys(I.T.ru).sort();
  for (const l of LANGS) {
    if (l === 'ru') continue;
    const keys = Object.keys(I.T[l]).sort();
    const missing = base.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !base.includes(k));
    assert.deepEqual(missing, [], `в ${l} не хватает ключей`);
    assert.deepEqual(extra, [], `в ${l} есть ключи, которых нет в ru`);
  }
});

test('ни одна строка перевода не пустая', () => {
  for (const l of LANGS) {
    for (const [key, value] of Object.entries(I.T[l])) {
      if (Array.isArray(value)) {
        assert.ok(value.every((v) => typeof v === 'string' && v.trim()), `${l}/${key}: пустая форма`);
      } else {
        assert.ok(typeof value === 'string' && value.trim(), `${l}/${key}: пустая строка`);
      }
    }
  }
});

test('подстановки {имя} совпадают во всех языках', () => {
  // Если в русской строке есть {n}, а в английской нет, число просто не
  // покажется — текст останется осмысленным, и ошибку никто не заметит.
  const vars = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
  for (const [key, ruValue] of Object.entries(I.T.ru)) {
    if (Array.isArray(ruValue)) continue;
    for (const l of LANGS) {
      if (l === 'ru') continue;
      const value = I.T[l][key];
      if (typeof value !== 'string') continue;
      assert.deepEqual(vars(value), vars(ruValue), `${l}/${key}: другой набор подстановок`);
    }
  }
});

test('формы слов заданы как массивы одинаковой длины во всех языках', () => {
  const pluralKeys = Object.keys(I.T.ru).filter((k) => Array.isArray(I.T.ru[k]));
  assert.ok(pluralKeys.length > 0, 'хотя бы один ключ со склонениями должен быть');
  for (const key of pluralKeys) {
    for (const l of LANGS) {
      assert.ok(Array.isArray(I.T[l][key]), `${l}/${key}: должен быть массивом форм`);
      assert.equal(I.T[l][key].length, I.T.ru[key].length, `${l}/${key}: другое число форм`);
    }
  }
});

test('translate подставляет значения и откатывается на русский', () => {
  const T = { ru: { hi: 'Привет, {name}', only: 'Только тут' }, en: { hi: 'Hello, {name}' } };
  assert.equal(I.translate(T, 'en', 'hi', { name: 'Иван' }), 'Hello, Иван');
  assert.equal(I.translate(T, 'en', 'only'), 'Только тут', 'нет перевода — берётся русский');
  assert.equal(I.translate(T, 'fr', 'hi', { name: 'Иван' }), 'Привет, Иван', 'неизвестный язык — русский');
});

test('translate показывает сам ключ, если строки нет нигде', () => {
  // Показать ключ лучше, чем пустое место: по нему видно, чего не хватает.
  assert.equal(I.translate({ ru: {} }, 'ru', 'нет.такого'), 'нет.такого');
});

test('translate подставляет значение во все вхождения', () => {
  const T = { ru: { x: '{n} из {n}' } };
  assert.equal(I.translate(T, 'ru', 'x', { n: 3 }), '3 из 3');
});

test('склонения русского языка', () => {
  const форма = (n) => I.pluralForm(I.T, 'ru', n, 'plural.task');
  assert.equal(форма(1), 'задача');
  assert.equal(форма(2), 'задачи');
  assert.equal(форма(5), 'задач');
  assert.equal(форма(11), 'задач', '11 — исключение, не «задача»');
  assert.equal(форма(21), 'задача');
  assert.equal(форма(22), 'задачи');
  assert.equal(форма(25), 'задач');
  assert.equal(форма(111), 'задач');
  assert.equal(форма(0), 'задач');
});

test('склонения английского: только единственное и множественное', () => {
  const form = (n) => I.pluralForm(I.T, 'en', n, 'plural.task');
  assert.equal(form(1), I.T.en['plural.task'][0]);
  assert.equal(form(0), I.T.en['plural.task'][1]);
  assert.equal(form(21), I.T.en['plural.task'][1], 'в английском 21 — тоже множественное');
});

test('склонения казахского: форма всегда одна', () => {
  const form = (n) => I.pluralForm(I.T, 'kk', n, 'plural.task');
  const one = I.T.kk['plural.task'][0];
  assert.equal(form(1), one);
  assert.equal(form(5), one);
  assert.equal(form(21), one);
});

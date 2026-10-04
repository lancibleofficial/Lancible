// Словарь мобильного приложения. Запуск: npm run test:unit
//
// У телефона свой словарь: там формулировки короче — экран уже. Но набор
// ключей обязан совпадать между языками, иначе пропущенный перевод не роняет
// приложение, а молча показывает русскую строку посреди английского.
//
// Своего тест-раннера у mobile/ нет, а файл — ES-модуль. Поэтому читаем его
// как текст и выполняем в песочнице: тащить в проект сборщик ради одного
// словаря было бы дороже, чем эти четыре строки.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'i18n.js');

function loadMobileDict() {
  const src = fs.readFileSync(FILE, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', `${src};module.exports = { T, LOCALE_MAP, LANG_NAMES };`)(box);
  return box.exports;
}

const { T, LOCALE_MAP, LANG_NAMES } = loadMobileDict();
const LANGS = Object.keys(T);

test('языков четыре, у каждого есть название и локаль', () => {
  assert.deepEqual(LANGS.slice().sort(), ['en', 'kk', 'ru', 'uk']);
  for (const l of LANGS) {
    assert.ok(LANG_NAMES[l], `нет названия языка ${l}`);
    assert.ok(LOCALE_MAP[l], `нет локали для ${l}`);
  }
});

test('во всех языках один и тот же набор ключей', () => {
  const base = Object.keys(T.ru).sort();
  assert.ok(base.length > 300, `ключей подозрительно мало: ${base.length}`);
  for (const l of LANGS) {
    if (l === 'ru') continue;
    const keys = Object.keys(T[l]).sort();
    assert.deepEqual(base.filter((k) => !keys.includes(k)), [], `в ${l} не хватает ключей`);
    assert.deepEqual(keys.filter((k) => !base.includes(k)), [], `в ${l} есть лишние ключи`);
  }
});

test('ни одна строка перевода не пустая', () => {
  for (const l of LANGS) {
    for (const [key, value] of Object.entries(T[l])) {
      if (Array.isArray(value)) {
        assert.ok(value.every((v) => typeof v === 'string' && v.trim()), `${l}/${key}: пустая форма`);
      } else {
        assert.ok(typeof value === 'string' && value.trim(), `${l}/${key}: пустая строка`);
      }
    }
  }
});

test('подстановки {имя} совпадают во всех языках', () => {
  const holes = (v) => (Array.isArray(v) ? v.join(' ') : String(v)).match(/\{[a-z]+\}/g) || [];
  for (const key of Object.keys(T.ru)) {
    const base = holes(T.ru[key]).sort();
    for (const l of LANGS) {
      if (l === 'ru') continue;
      assert.deepEqual(holes(T[l][key]).sort(), base, `${l}/${key}: подстановки разошлись`);
    }
  }
});

test('то, что взято у десктопа, взято дословно', () => {
  // Статусы, версии, повторения и календарь перенесены из общего словаря
  // скриптом, а не набраны заново: одно и то же не должно называться
  // по-разному на телефоне и на компьютере.
  const desktop = require('../../src/renderer/core/i18n.js').T;
  const shared = ['status.', 'version.', 'repeat.', 'agenda.'];
  const differ = [];
  for (const l of LANGS) {
    for (const key of Object.keys(T[l])) {
      if (!shared.some((p) => key.startsWith(p))) continue;
      if (!(key in desktop[l])) continue;
      const a = JSON.stringify(T[l][key]);
      const b = JSON.stringify(desktop[l][key]);
      if (a !== b) differ.push(`${l}/${key}: «${T[l][key]}» против «${desktop[l][key]}»`);
    }
  }
  assert.deepEqual(differ, [], `формулировки разошлись:\n  ${differ.join('\n  ')}`);
});

test('каждый ключ, который экраны просят у словаря, в нём есть', () => {
  // Пропущенный ключ не роняет приложение: t() возвращает сам ключ, и на
  // экране появляется «task.status_label» вместо «Статус». Поймать это
  // руками можно только открыв ровно тот экран на ровно том языке.
  const dirs = ['screens', 'components', 'lib'];
  const missing = [];
  for (const dir of dirs) {
    const base = path.join(__dirname, '..', '..', 'mobile', 'src', dir);
    const walk = (p) => {
      for (const name of fs.readdirSync(p)) {
        const full = path.join(p, name);
        if (fs.statSync(full).isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.js')) continue;
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/\bt\(\s*(?:lang|LANG|langCode)\s*,\s*'([a-z0-9_.]+)'/g)) {
          if (T.ru[m[1]] === undefined) missing.push(`${dir}/${name}: ${m[1]}`);
        }
      }
    };
    walk(base);
  }
  assert.deepEqual([...new Set(missing)], [], `ключей нет в словаре:\n  ${[...new Set(missing)].join('\n  ')}`);
});

test('в словаре нет ключей, которых никто не просит', () => {
  // Обратная сторона предыдущего теста. Лишний ключ ничего не ломает, поэтому
  // копится незаметно: словарь телефона был списан с десктопного, и к моменту
  // первой проверки 117 ключей из 431 не использовались нигде.
  //
  // Часть ключей собирается на месте — `status.default_${kind}`,
  // `repeat.desc_${unit}` и подобное, — поэтому кроме буквальных вхождений
  // собираются префиксы шаблонов: если в коде есть `plural.${...}`, все ключи
  // на «plural.» считаются живыми. Сверх того каждый кандидат ищется в коде
  // как простой текст: лучше оставить лишний ключ, чем удалить нужный.
  const MOBILE = path.join(__dirname, '..', '..', 'mobile', 'src');
  let code = '';
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      if (full.replace(/\\/g, '/').endsWith('lib/i18n.js')) continue;
      code += fs.readFileSync(full, 'utf8') + '\n';
    }
  }(MOBILE));

  const literal = new Set();
  for (const m of code.matchAll(/['"`]([a-z0-9_]+(?:\.[a-z0-9_]+)+)['"`]/gi)) literal.add(m[1]);
  const prefixes = [];
  for (const m of code.matchAll(/`([a-z0-9_.]*[a-z0-9_.])\$\{/gi)) prefixes.push(m[1]);
  for (const m of code.matchAll(/['"]([a-z0-9_.]*[._])['"]\s*\+/gi)) prefixes.push(m[1]);
  const built = [...new Set(prefixes)].filter((p) => p && p.includes('.'));

  const unused = Object.keys(T.ru).filter((k) => !literal.has(k)
    && !built.some((p) => k.startsWith(p))
    && !code.includes(k));

  assert.deepEqual(unused, [], `ключи без единого обращения:\n  ${unused.join('\n  ')}`);
});

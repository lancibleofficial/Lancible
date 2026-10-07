// Словарь телефона. Запуск: npm run test:mobile (из корня)
//
// Экраны зовут t(lang, 'ключ'); ключа нет — на экране виден сам ключ, и
// заметить это можно только глазами на нужном языке. Поэтому все ключи,
// упомянутые в исходниках буквально, должны быть во всех четырёх языках.
// Ключи, собранные из шаблона (`filter.${key}`), сюда не попадают — они
// проверяются там, где перечислены их части.
const fs = require('fs');
const path = require('path');
const { t, T } = require('../src/lib/i18n');

const LANGS = ['ru', 'en', 'uk', 'kk'];
const SRC = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (name !== 'core' && name !== 'editor') walk(p, out); }
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const usedKeys = () => {
  const keys = new Set();
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*[A-Za-z_.]+\s*,\s*'([a-z0-9_.]+)'/g)) keys.add(m[1]);
  }
  return [...keys].sort();
};

test('каждый ключ из исходников есть во всех четырёх языках', () => {
  const missing = [];
  for (const key of usedKeys()) {
    for (const lang of LANGS) {
      if (!(T[lang] && Object.prototype.hasOwnProperty.call(T[lang], key))) missing.push(`${lang}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test('ключи, собранные из частей, тоже на месте', () => {
  const parts = {
    'filter.': ['all', 'active', 'done'],
    'calendar.': ['day', 'week', 'month', 'today'],
    'weekday.': ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    'repeat.': ['daily', 'weekly', 'monthly', 'yearly', 'weekdays_preset', 'custom'],
    'notif.perm_': ['granted', 'denied', 'ask'],
  };
  const missing = [];
  for (const [prefix, list] of Object.entries(parts)) {
    for (const suffix of list) for (const lang of LANGS) if (!T[lang][prefix + suffix]) missing.push(`${lang}: ${prefix}${suffix}`);
  }
  expect(missing).toEqual([]);
});

test('пять вкладок подписаны как на вебе', () => {
  expect(t('ru', 'nav.home')).toBe('Сегодня');
  expect(t('en', 'nav.home')).toBe('Today');
  for (const lang of LANGS) {
    for (const key of ['nav.home', 'nav.projects', 'nav.time', 'nav.notifications', 'nav.menu']) {
      expect(typeof t(lang, key)).toBe('string');
      expect(t(lang, key)).not.toBe(key);
    }
  }
});

// Правовое ядро: адреса документов и согласие. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../src/renderer/core/legal.js');

const LANDING = path.join(__dirname, '..', '..', 'landing');

test('адрес документа несёт язык приложения', () => {
  assert.equal(L.legalUrl('https://lancible.vercel.app', 'privacy', 'kk'), 'https://lancible.vercel.app/privacy?lang=kk');
  assert.equal(L.legalUrl('https://lancible.vercel.app/', 'terms', 'en'), 'https://lancible.vercel.app/terms?lang=en');
  // Незнакомый язык не передаём: страница выберет сама.
  assert.equal(L.legalUrl('https://x.app', 'cookies', 'de'), 'https://x.app/cookies');
  assert.throws(() => L.legalUrl('https://x.app', 'nope', 'ru'));
});

test('каждый документ из ядра лежит на лендинге и открывается красивым адресом', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(LANDING, 'vercel.json'), 'utf8'));
  const rewrites = new Map(cfg.rewrites.map((r) => [r.source, r.destination]));
  for (const doc of L.LEGAL_DOCS) {
    assert.ok(fs.existsSync(path.join(LANDING, `${doc}.html`)), `нет landing/${doc}.html`);
    assert.equal(rewrites.get(`/${doc}`), `/${doc}.html`, `нет rewrite /${doc} → /${doc}.html`);
  }
});

test('согласие нужно без профиля, со старой версией и без подтверждённого возраста', () => {
  assert.equal(L.needsConsent(null), true);
  assert.equal(L.needsConsent({ name: 'А' }), true, 'профиль до появления согласий');
  assert.equal(L.needsConsent({ terms_version: '2020-01-01', age_confirmed: true }), true);
  assert.equal(L.needsConsent({ terms_version: L.TERMS_VERSION, age_confirmed: false }), true);
  assert.equal(L.needsConsent({ terms_version: L.TERMS_VERSION, age_confirmed: true }), false);
});

test('принятое согласие записывает версию, время и возраст — и снимает вопрос', () => {
  const f = L.consentFields(Date.UTC(2026, 9, 7, 12, 0));
  assert.deepEqual(f, { terms_version: L.TERMS_VERSION, terms_accepted_at: '2026-10-07T12:00:00.000Z', age_confirmed: true });
  assert.equal(L.needsConsent(f), false);
});

test('версия согласия совпадает с датой редакции на страницах Условий и Политики', () => {
  // Поменяли текст и забыли поднять версию — люди продолжат жить по
  // согласию со старым текстом. Поэтому дата редакции на страницах и версия
  // в ядре сверяются здесь.
  for (const doc of ['terms', 'privacy']) {
    const html = fs.readFileSync(path.join(LANDING, `${doc}.html`), 'utf8');
    const dates = [...html.matchAll(/<time datetime="([\d-]+)"/g)].map((m) => m[1]);
    assert.ok(dates.length >= 4, `${doc}.html: дата редакции должна стоять в каждом из четырёх переводов`);
    for (const d of dates) assert.equal(d, L.TERMS_VERSION, `${doc}.html: редакция ${d}, а в ядре ${L.TERMS_VERSION}`);
  }
});

test('минимальный возраст на страницах тот же, что в ядре', () => {
  for (const doc of ['terms', 'privacy']) {
    const html = fs.readFileSync(path.join(LANDING, `${doc}.html`), 'utf8');
    const ages = [...html.matchAll(/data-min-age>(\d+)</g)].map((m) => Number(m[1]));
    assert.ok(ages.length >= 4, `${doc}.html: возраст должен быть помечен data-min-age в каждом переводе`);
    for (const a of ages) assert.equal(a, L.MIN_AGE, `${doc}.html: возраст ${a}, а в ядре ${L.MIN_AGE}`);
  }
});

// Баннер согласия на cookie: логика и честность. Запуск: npm run test:unit
//
// Поведение в браузере — что баннер появляется, отказ запоминается, кнопка
// в подвале открывает его снова — проверяет tests/landing/legal.spec.js.
// Здесь то, что видно без браузера.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../landing/consent.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'landing', 'consent.js'), 'utf8');
const NOW = Date.UTC(2026, 9, 7, 12, 0);

test('необязательные категории по умолчанию выключены', () => {
  const none = C.decide('none', NOW);
  for (const c of C.OPTIONAL) assert.equal(none[c], false, `${c} включена без согласия`);
  // Пустой выбор из окна настроек — тоже отказ, а не согласие.
  for (const c of C.OPTIONAL) assert.equal(C.decide({}, NOW)[c], false);
});

test('«Принять все» включает всё, выборочно — ровно отмеченное', () => {
  for (const c of C.OPTIONAL) assert.equal(C.decide('all', NOW)[c], true);
  assert.equal(C.decide({ analytics: true }, NOW).analytics, true);
});

test('сохранённый выбор читается обратно, битый и старый — нет', () => {
  const saved = JSON.stringify(C.decide('all', NOW));
  assert.deepEqual(C.parse(saved), C.decide('all', NOW));
  assert.equal(C.parse(null), null);
  assert.equal(C.parse('{не json'), null);
  // Сменилась версия (новая категория) — прежний ответ не в счёт, спросим снова.
  assert.equal(C.parse(JSON.stringify({ ...C.decide('all', NOW), v: C.VERSION - 1 })), null);
  // Лишнее «true» в чужом поле не превращается в согласие.
  assert.equal(C.parse(JSON.stringify({ v: C.VERSION, at: 'x', analytics: 'yes' })).analytics, false);
});

test('язык баннера: адрес, затем выбор документов, затем страница', () => {
  assert.equal(C.pickLang('?lang=kk', 'en', 'ru'), 'kk');
  assert.equal(C.pickLang('', 'uk', 'ru'), 'uk');
  assert.equal(C.pickLang('', null, 'en-GB'), 'en');
  assert.equal(C.pickLang('?lang=de', null, 'fr'), 'ru');
});

test('тексты баннера есть на всех языках и с одинаковым набором строк', () => {
  const keys = Object.keys(C.TEXT.ru).sort();
  assert.deepEqual(Object.keys(C.TEXT).sort(), C.LANGS.slice().sort());
  for (const l of C.LANGS) {
    assert.deepEqual(Object.keys(C.TEXT[l]).sort(), keys, `${l}: набор строк разошёлся с русским`);
    for (const k of keys) assert.ok(C.TEXT[l][k].trim(), `${l}.${k} пустая`);
  }
});

test('отказ не мельче согласия: у «Принять» и «Отклонить» один вид', () => {
  const cls = (act) => {
    const m = SRC.match(new RegExp(`class="([^"]+)" data-act="${act}"`));
    assert.ok(m, `кнопки ${act} в разметке баннера нет`);
    return m[1];
  };
  assert.equal(cls('reject'), cls('accept'), 'кнопки согласия и отказа оформлены по-разному');
  // Отказ стоит в первом ряду, а не прячется за «Настроить».
  assert.ok(SRC.indexOf('data-act="reject"') < SRC.indexOf('data-act="settings"'), 'отказ должен идти раньше «Настроить»');
});

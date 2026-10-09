// Язык лендинга: инварианты, которые видно в самих файлах.
// Запуск: npm run test:unit
//
// Зачем. Языков на лендинге было два независимых — свой у правовых
// документов и свой у ленты блога, — и выбор в одном месте не доходил до
// другого. Теперь ключ один (landing/i18n.js), а тексты лежат одним словарём
// (landing/strings.js). Разъехаться это может тихо: страница просто покажет
// пустое место вместо подписи или дёрнется при загрузке, подменив русский
// текст на тот же русский из словаря.
//
// Поэтому здесь три проверки: словарь полон на всех языках, русские значения
// совпадают с тем, что написано в разметке, и каждая страница подключает
// словарь раньше движка, а движок — раньше своих скриптов.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LANDING = path.join(__dirname, '..', '..', 'landing');
const PAGES = ['index.html', 'blog.html', 'logs.html', 'architecture.html', 'graph.html',
  'privacy.html', 'terms.html', 'cookies.html', 'refund.html', 'legal.html', 'delete-account.html'];
const LANGS = ['ru', 'en', 'uk', 'kk'];

const read = (name) => fs.readFileSync(path.join(LANDING, name), 'utf8');

/** Словарь из landing/strings.js — он просто присваивает window.LANCIBLE_STRINGS. */
function strings() {
  const sandbox = { window: {} };
  new Function('window', read('strings.js'))(sandbox.window);
  return sandbox.window.LANCIBLE_STRINGS;
}

test('словарь знает одни и те же ключи на всех языках', () => {
  const S = strings();
  assert.deepEqual(Object.keys(S).sort(), [...LANGS].sort(), 'набор языков словаря');
  const base = Object.keys(S.ru).sort();
  assert.ok(base.length > 50, `ключей всего ${base.length} — словарь подозрительно пуст`);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(S[lang]).sort(), base, `${lang}: набор ключей разошёлся с ru`);
    for (const key of base) {
      assert.ok(String(S[lang][key]).trim(), `${lang}: ключ ${key} пуст`);
    }
  }
});

test('русские значения словаря совпадают с текстом в разметке', () => {
  // Без скрипта страница показывает русский. Если словарь говорит иначе,
  // при загрузке текст подменится на другой — это видно глазом как рывок.
  const S = strings();
  const bad = [];
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
      const [, key, text] = m;
      const want = S.ru[key];
      assert.ok(want !== undefined, `${page}: ключа ${key} нет в словаре`);
      if (text.trim() !== String(want).trim()) bad.push(`${page} ${key}: разметка «${text.trim()}» ≠ ru «${want}»`);
    }
  }
  assert.deepEqual(bad, []);
});

test('каждая страница подключает словарь, затем движок, затем свои скрипты', () => {
  for (const page of PAGES) {
    const html = read(page);
    const strings = html.indexOf('<script src="strings.js"></script>');
    const engine = html.indexOf('<script src="i18n.js"></script>');
    assert.ok(strings !== -1, `${page}: не подключает strings.js`);
    assert.ok(engine !== -1, `${page}: не подключает i18n.js`);
    assert.ok(strings < engine, `${page}: strings.js должен идти раньше i18n.js`);
    // Движок раздаёт язык остальным (legal.js, consent.js, лента блога) —
    // значит, он обязан отработать первым.
    for (const other of ['blog-posts.js', 'business.js', 'legal.js', 'consent.js']) {
      const at = html.indexOf(`<script src="${other}"></script>`);
      if (at !== -1) assert.ok(engine < at, `${page}: i18n.js должен идти раньше ${other}`);
    }
  }
});

test('переключатель языка сайта есть в подвале каждой страницы', () => {
  for (const page of PAGES) {
    const foot = read(page).match(/<footer>[\s\S]*<\/footer>/)[0];
    const langs = [...foot.matchAll(/<button type="button" data-lang="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(langs, ['ru', 'en'], `${page}: в подвале не тот переключатель языка`);
  }
});

test('старых отдельных ключей языка в лендинге не осталось', () => {
  // lancible:blog-lang и lancible:legal-lang — те самые два независимых
  // выбора, ради которых всё и затевалось. Читает их только i18n.js, и
  // только чтобы перенести прошлый выбор в общий ключ.
  for (const file of [...PAGES, 'legal.js', 'consent.js', 'strings.js']) {
    const src = read(file);
    for (const old of ['lancible:blog-lang', 'lancible:legal-lang']) {
      assert.ok(!src.includes(old), `${file}: остался старый ключ ${old}`);
    }
  }
  assert.ok(read('i18n.js').includes('lancible:legal-lang'), 'i18n.js должен переносить прошлый выбор');
});

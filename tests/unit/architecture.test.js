// Страница архитектуры и граф кода: то, что сайт говорит о коде, правда.
// Запуск: npm run test:unit
//
// Откуда взялось. Схема на /architecture устарела незаметно: на ней было
// «одиннадцать» файлов ядра и «9 из 11 побайтно», хотя их давно стало
// пятнадцать и четырнадцать. Числа на странице писались руками и правились
// руками — и их забывали.
//
// Числа делятся на два сорта, и стерегутся по-разному:
//   • редкие — сколько файлов в ядре и сколько из них у телефона — проверяются
//     здесь: добавил файл в ядро и не поправил страницу — коммит не пройдёт;
//   • частые — строки и функции app.js, размер графа — пересчитывает
//     npm run site:refresh перед выкатом. Проверять их тестом нельзя: он
//     краснел бы на каждой правке app.js. Здесь проверяется только, что места
//     под них размечены и заполнены.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanForSecrets, plural } = require('../../scripts/publish-site.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read('landing/architecture.html');
const DOC = read('ARCHITECTURE.md');
const GRAPH_PAGE = read('landing/graph.html');

// --- сколько файлов в ядре на самом деле ---------------------------------------

const TOTAL = fs.readdirSync(path.join(ROOT, 'src', 'renderer', 'core')).filter((f) => f.endsWith('.js')).length;
const SYNCED = (() => {
  const m = read('scripts/sync-mobile-core.js').match(/const FILES = \[([^\]]*)\]/);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).length;
})();

// Числительные: на странице и в документе числа ядра написаны словами.
const NOM = {
  10: 'десять', 11: 'одиннадцать', 12: 'двенадцать', 13: 'тринадцать', 14: 'четырнадцать',
  15: 'пятнадцать', 16: 'шестнадцать', 17: 'семнадцать', 18: 'восемнадцать', 19: 'девятнадцать', 20: 'двадцать',
};
const GEN = {
  10: 'десяти', 11: 'одиннадцати', 12: 'двенадцати', 13: 'тринадцати', 14: 'четырнадцати',
  15: 'пятнадцати', 16: 'шестнадцати', 17: 'семнадцати', 18: 'восемнадцати', 19: 'девятнадцати', 20: 'двадцати',
};
const word = (table, n) => {
  assert.ok(table[n], `для числа ${n} нет слова — допиши его в таблицу в начале теста`);
  return table[n];
};

test('копии ядра у телефона — ровно те файлы, что в списке синхронизации', () => {
  const mobile = fs.readdirSync(path.join(ROOT, 'mobile', 'src', 'core')).filter((f) => f.endsWith('.js')).length;
  assert.equal(mobile, SYNCED, 'в mobile/src/core лежит не столько файлов, сколько в sync-mobile-core.js');
});

test('схема на странице называет правильное число файлов ядра', () => {
  const expected = [
    // узел «core/» на схеме
    `<text class="dg-s" x="24" y="196">${word(NOM, TOTAL)}</text>`,
    // подпись под ним
    `${SYNCED} из ${TOTAL} побайтно`,
    // плашка в шапке страницы
    `<b>${SYNCED} / ${TOTAL}</b>`,
    // подпись к рисунку
    `${word(NOM, SYNCED)} файлов ядра из ${word(GEN, TOTAL)}`,
    // подзаголовок таблицы шва
    `Из ${word(GEN, TOTAL)} файлов ядра на телефон копируются побайтно ${word(NOM, SYNCED)}`,
  ];
  for (const phrase of expected) {
    assert.ok(PAGE.includes(phrase), `на /architecture нет «${phrase}» — ядро: ${TOTAL} файлов, у телефона ${SYNCED}`);
  }
});

test('документ архитектуры называет правильное число файлов ядра', () => {
  const expected = [
    // узел ядра на схеме
    `src/renderer/core/<br/>${word(NOM, TOTAL)} файлов`,
    // стрелка от ядра к телефону — она устарела вместе со схемой на странице,
    // а тест её тогда не проверял
    `|"${word(NOM, SYNCED)} из ${word(GEN, TOTAL)}<br/>побайтно"|`,
    `В \`src/renderer/core/\` ${word(NOM, TOTAL)} файлов чистой логики`,
    `**${word(NOM, SYNCED)}** из них побайтно`,
  ];
  // Абзацы в документе перенесены по ширине, и фраза может разорваться
  // переводом строки — сверяем по тексту, где переводы заменены пробелами.
  const flat = DOC.replace(/\n/g, ' ');
  for (const phrase of expected) {
    assert.ok(flat.includes(phrase), `в ARCHITECTURE.md нет «${phrase}» — ядро: ${TOTAL} файлов, у телефона ${SYNCED}`);
  }
});

test('в таблице шва на странице есть строка на каждый общий файл ядра', () => {
  // Таблица перечисляет области; каждая копируемая на телефон область
  // должна в ней быть, иначе файл ядра есть, а на странице его не видно.
  const files = read('scripts/sync-mobile-core.js').match(/const FILES = \[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const f of files) {
    assert.ok(PAGE.includes(`core/${f}`), `в таблице шва на /architecture нет core/${f}`);
  }
});

// --- сколько работ гоняет GitHub ------------------------------------------------

// Тот же сорт, что число файлов ядра: меняется редко и забывается. Когда в
// test.yml добавилась сборка телефона, «четырьмя работами» осталось в трёх
// местах сразу.
const JOBS = (() => {
  const yml = read('.github/workflows/test.yml');
  return (yml.slice(yml.search(/^jobs:$/m)).match(/^ {2}[\w-]+:\s*$/gm) || []).length;
})();
const INS = { 3: 'тремя', 4: 'четырьмя', 5: 'пятью', 6: 'шестью', 7: 'семью', 8: 'восемью' };

test('документы называют правильное число работ в test.yml', () => {
  const phrase = `${word(INS, JOBS)} параллельными работами`;
  const flat = (text) => text.replace(/\s+/g, ' ');
  for (const [where, text] of [['CLAUDE.md', read('CLAUDE.md')], ['ARCHITECTURE.md', DOC], ['/architecture', PAGE]]) {
    assert.ok(flat(text).includes(phrase), `в ${where} нет «${phrase}» — работ в test.yml: ${JOBS}`);
  }
});

// --- частые числа: места размечены и заполнены --------------------------------

const marks = (html) => [...html.matchAll(/<!--m:([\w.]+)-->([\s\S]*?)<!--\/m-->/g)]
  .map((m) => ({ name: m[1], value: m[2] }));

test('частые числа на /architecture размечены под пересчёт', () => {
  const names = marks(PAGE).map((m) => m.name).sort();
  assert.deepEqual(names, ['app.functions', 'app.lines', 'app.linesPhrase', 'app.noDom']);
  for (const m of marks(PAGE)) assert.match(m.value, /^\d+( строк[аи]?)?$/, `метка ${m.name}: «${m.value}» — не число`);
});

test('на /graph числа графа заполнены, а не оставлены заглушками', () => {
  const got = Object.fromEntries(marks(GRAPH_PAGE).map((m) => [m.name, m.value]));
  for (const k of ['graph.nodes', 'graph.edges', 'graph.communities']) {
    assert.match(got[k] || '', /^\d+$/, `${k}: «${got[k]}»`);
    assert.ok(Number(got[k]) > 0, `${k} не заполнен — запусти npm run site:refresh`);
  }
  assert.match(got['graph.date'] || '', /^\d\d\.\d\d\.\d{4}$/, 'дата построения не заполнена');
});

// --- граф на сайте -----------------------------------------------------------

test('граф на сайте выложен и закрыт от поисковиков сам по себе', () => {
  const p = path.join(ROOT, 'landing', 'graph-view.html');
  assert.ok(fs.existsSync(p), 'landing/graph-view.html нет — запусти npm run site:refresh');
  const html = fs.readFileSync(p, 'utf8');
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'), 'у страницы графа нет noindex');
  assert.ok(html.includes('<title>Граф кода Lancible</title>'), 'заголовок graphify раскрывает путь на машине разработчика');
});

test('в выложенном графе нет секретов', () => {
  // Та же проверка, что останавливает публикацию, — на случай, если файл
  // положили на лендинг в обход npm run site:refresh.
  const html = fs.readFileSync(path.join(ROOT, 'landing', 'graph-view.html'), 'utf8');
  assert.deepEqual(scanForSecrets(html), []);
});

test('проверка на секреты ловит то, что должна', () => {
  // Без этого теста проверка могла бы молча ничего не находить — и публикация
  // считалась бы безопасной.
  const samples = {
    'ключ Supabase': 'const k = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZSJ9.abc";',
    'служебный ключ': 'SUPABASE_SERVICE_ROLE_KEY=что-то',
    'ключ Anthropic': 'sk-ant-abcdefghijklmnopqrstuvwxyz0123',
    'токен GitHub': 'ghp_abcdefghijklmnopqrstuvwxyz012345',
    'закрытый ключ': '-----BEGIN RSA PRIVATE KEY-----',
    'пароль': "password: 'hunter22'",
    'почта': 'пишите на someone@example.com',
  };
  for (const [what, text] of Object.entries(samples)) {
    assert.ok(scanForSecrets(text).length > 0, `не поймано: ${what}`);
  }
  assert.deepEqual(scanForSecrets('function taskRowView(task, ctx) { return ctx; }'), [], 'обычный код — не секрет');
});

test('склонение у числа строк', () => {
  const f = (n) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;
  assert.equal(f(1), '1 строка');
  assert.equal(f(5821), '5821 строка');
  assert.equal(f(5834), '5834 строки');
  assert.equal(f(5829), '5829 строк');
  assert.equal(f(5811), '5811 строк', 'одиннадцать — исключение');
  assert.equal(f(5812), '5812 строк', 'двенадцать — тоже');
});

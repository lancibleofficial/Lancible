// «Устройство» и граф кода в админке: то, что они говорят о коде, правда.
// Запуск: npm run test:unit
//
// До 23 октября 2026 это были служебные страницы лендинга /architecture и
// /graph; теперь — разделы админки: текст — admin/content/architecture.html,
// данные графа — admin/graph/graph.json (их кладёт npm run site:refresh).
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
//
// Браузерная половина — схема рисуется без наездов подписей, граф рисуется и
// грузится только в своём разделе — в tests/admin/code-sections.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanForSecrets, plural, GRAPH_DATA, ARCHITECTURE } = require('../../scripts/publish-site.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read(`admin/${ARCHITECTURE}`);
const DOC = read('ARCHITECTURE.md');
const GRAPH_FILE = `admin/${GRAPH_DATA}`;

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
  21: 'двадцать один', 22: 'двадцать два', 23: 'двадцать три', 24: 'двадцать четыре', 25: 'двадцать пять', 26: 'двадцать шесть', 27: 'двадцать семь', 28: 'двадцать восемь',
};
const GEN = {
  10: 'десяти', 11: 'одиннадцати', 12: 'двенадцати', 13: 'тринадцати', 14: 'четырнадцати',
  15: 'пятнадцати', 16: 'шестнадцати', 17: 'семнадцати', 18: 'восемнадцати', 19: 'девятнадцати', 20: 'двадцати',
  21: 'двадцати одного', 22: 'двадцати двух', 23: 'двадцати трёх', 24: 'двадцати четырёх', 25: 'двадцати пяти', 26: 'двадцати шести', 27: 'двадцати семи', 28: 'двадцати восьми',
};
const word = (table, n) => {
  assert.ok(table[n], `для числа ${n} нет слова — допиши его в таблицу в начале теста`);
  return table[n];
};
// «файл» за числительным: двадцать один файл, двадцать два файла, двадцать пять
// файлов — а после родительного («из двадцати одного») единственное число
// только у «одного», остальные остаются во множественном.
const filesNom = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'файл' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'файла' : 'файлов');
const filesGen = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'файла' : 'файлов');

test('копии ядра у телефона — ровно те файлы, что в списке синхронизации', () => {
  const mobile = fs.readdirSync(path.join(ROOT, 'mobile', 'src', 'core')).filter((f) => f.endsWith('.js')).length;
  assert.equal(mobile, SYNCED, 'в mobile/src/core лежит не столько файлов, сколько в sync-mobile-core.js');
});

test('схема в «Устройстве» называет правильное число файлов ядра', () => {
  const expected = [
    // узел «core/» на схеме
    `<text class="dg-s" x="24" y="196">${word(NOM, TOTAL)}</text>`,
    // подпись под ним
    `${SYNCED} из ${TOTAL} побайтно`,
    // плашка в шапке страницы
    `>${SYNCED} / ${TOTAL}</b>`,
    // подпись к рисунку: «двадцать один файл», «двадцать два файла»
    `${word(NOM, SYNCED)} ${filesNom(SYNCED)} ядра из ${word(GEN, TOTAL)}`,
    // подзаголовок таблицы шва
    `Из ${word(GEN, TOTAL)} ${filesGen(TOTAL)} ядра на телефон копируются побайтно ${word(NOM, SYNCED)}`,
  ];
  for (const phrase of expected) {
    assert.ok(PAGE.includes(phrase), `в «Устройстве» (${ARCHITECTURE}) нет «${phrase}» — ядро: ${TOTAL} файлов, у телефона ${SYNCED}`);
  }
});

test('документ архитектуры называет правильное число файлов ядра', () => {
  const expected = [
    // узел ядра на схеме
    `src/renderer/core/<br/>${word(NOM, TOTAL)} ${filesNom(TOTAL)}`,
    // стрелка от ядра к телефону — она устарела вместе со схемой на странице,
    // а тест её тогда не проверял
    `|"${word(NOM, SYNCED)} из ${word(GEN, TOTAL)}<br/>побайтно"|`,
    `В \`src/renderer/core/\` ${word(NOM, TOTAL)} ${filesNom(TOTAL)} чистой логики`,
    `**${word(NOM, SYNCED)}** из них побайтно`,
  ];
  // Абзацы в документе перенесены по ширине, и фраза может разорваться
  // переводом строки — сверяем по тексту, где переводы заменены пробелами.
  const flat = DOC.replace(/\n/g, ' ');
  for (const phrase of expected) {
    assert.ok(flat.includes(phrase), `в ARCHITECTURE.md нет «${phrase}» — ядро: ${TOTAL} файлов, у телефона ${SYNCED}`);
  }
});

test('в таблице шва в «Устройстве» есть строка на каждый общий файл ядра', () => {
  // Таблица перечисляет области; каждая копируемая на телефон область
  // должна в ней быть, иначе файл ядра есть, а на странице его не видно.
  const files = read('scripts/sync-mobile-core.js').match(/const FILES = \[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const f of files) {
    assert.ok(PAGE.includes(`core/${f}`), `в таблице шва в «Устройстве» нет core/${f}`);
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
  for (const [where, text] of [['CLAUDE.md', read('CLAUDE.md')], ['ARCHITECTURE.md', DOC], ['«Устройство»', PAGE]]) {
    assert.ok(flat(text).includes(phrase), `в ${where} нет «${phrase}» — работ в test.yml: ${JOBS}`);
  }
});

// --- частые числа: места размечены и заполнены --------------------------------

const marks = (html) => [...html.matchAll(/<!--m:([\w.]+)-->([\s\S]*?)<!--\/m-->/g)]
  .map((m) => ({ name: m[1], value: m[2] }));

test('частые числа в «Устройстве» размечены под пересчёт', () => {
  const names = marks(PAGE).map((m) => m.name).sort();
  assert.deepEqual(names, ['app.functions', 'app.lines', 'app.linesPhrase', 'app.noDom']);
  for (const m of marks(PAGE)) assert.match(m.value, /^\d+( строк[аи]?)?$/, `метка ${m.name}: «${m.value}» — не число`);
});

// --- граф в админке -----------------------------------------------------------

const graphData = () => {
  const p = path.join(ROOT, GRAPH_FILE);
  assert.ok(fs.existsSync(p), `${GRAPH_FILE} нет — запусти npm run site:refresh`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

test('числа графа заполнены, а не оставлены заглушками', () => {
  const { meta } = graphData();
  for (const k of ['nodes', 'edges', 'communities']) {
    assert.ok(Number.isInteger(meta[k]) && meta[k] > 0, `meta.${k} не заполнен — запусти npm run site:refresh`);
  }
  assert.match(meta.date || '', /^\d\d\.\d\d\.\d{4}$/, 'дата построения не заполнена');
  assert.ok(meta.shown && meta.shown.nodes > 0 && meta.shown.edges >= 0, 'не сказано, сколько точек и связей на рисунке');
});

test('данные графа — того вида, что рисует раздел: узлы, связи, легенда', () => {
  const g = graphData();
  for (const k of ['nodes', 'edges', 'legend', 'hyperedges']) assert.ok(Array.isArray(g[k]), `в графе нет ${k}`);
  assert.equal(g.nodes.length, g.meta.shown.nodes);
  assert.equal(g.edges.length, g.meta.shown.edges);
  const ids = new Set(g.nodes.map((n) => String(n.id)));
  for (const n of g.nodes) assert.ok(n.id != null && typeof n.label === 'string', 'узел без id или подписи');
  for (const e of g.edges) assert.ok(ids.has(String(e.from)) && ids.has(String(e.to)), `связь ${e.from} → ${e.to} ведёт мимо узлов`);
});

test('в выложенном графе нет секретов', () => {
  // Та же проверка, что останавливает публикацию, — на случай, если файл
  // положили в админку в обход npm run site:refresh. Статика админки открыта
  // по адресу без входа, поэтому граф проверяется так же строго, как раньше
  // на лендинге.
  assert.deepEqual(scanForSecrets(fs.readFileSync(path.join(ROOT, GRAPH_FILE), 'utf8')), []);
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

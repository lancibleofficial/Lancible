// Правила подсчёта «сирот» графа. Запуск: npm run test:unit
//
// tests/graph.js → orphans() решает, какие узлы считать никем не зовущимися.
// Им пользуются и tests/unit/graph-dead-code.test.js, и npm run
// graph:baseline, и разбор npm run graph:orphans. Здесь правила проверяются
// на подставном графе, без собранного graphify: так тест работает и в CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { orphans, isTestFile } = require('../graph');

/** Узел-функция так, как его пишет graphify. */
const fn = (id, label, file, line) => ({
  id, label, source_file: file, source_location: `L${line}`, _callable: true, file_type: 'code',
});

const FILES = {
  'tests/unit/sample.test.js': [
    "const test = require('node:test');",
    'const helper = (x) => x * 2;',               // L2 — объявление
    'function unused() { return 1; }',            // L3 — нигде не зовут
    '// commented() упоминается только в комментарии',
    'function commented() { return 2; }',          // L5
    "test('что-то', () => {",
    '  helper(2);',                                // вызов из колбэка test()
    '});',
  ],
  'src/renderer/core/thing.js': [
    'function prodHelper() { return 1; }',         // L1
    'function caller() { return prodHelper(); }',  // зовут, но это рабочий код
  ],
};
const read = (file) => FILES[file] || null;

const GRAPH = {
  nodes: [
    fn('h', 'helper()', 'tests/unit/sample.test.js', 2),
    fn('u', 'unused()', 'tests/unit/sample.test.js', 3),
    fn('c', 'commented()', 'tests/unit/sample.test.js', 5),
    fn('p', 'prodHelper()', 'src/renderer/core/thing.js', 1),
  ],
  links: [],
};

const labels = () => orphans(GRAPH, read).map((n) => n.label).sort();

test('хелпер, вызванный только из test(), не попадает в сироты', () => {
  assert.ok(!labels().includes('helper()'), 'helper() зовут внутри test() — это не сирота');
});

test('хелпер теста, которого не зовут нигде, остаётся сиротой', () => {
  assert.ok(labels().includes('unused()'));
});

test('упоминание в комментарии вызовом не считается', () => {
  assert.ok(labels().includes('commented()'));
});

test('рабочий код правилом не прикрывается — для него решает только граф', () => {
  // prodHelper() текстом упомянут в своём же файле, но это не тест: если
  // граф не видит ребра, пусть это решает человек, а не правило.
  assert.ok(labels().includes('prodHelper()'));
});

test('ребро использования из графа по-прежнему снимает узел', () => {
  const withEdge = { ...GRAPH, links: [{ relation: 'calls', source: 'x', target: 'u' }] };
  assert.ok(!orphans(withEdge, read).some((n) => n.label === 'unused()'));
});

test('тестовые файлы — это tests/** и *.test.js / *.spec.js', () => {
  assert.ok(isTestFile('tests/serve-built-web.js'));
  assert.ok(isTestFile('mobile/tests/OnboardingScreen.test.js'));
  assert.ok(!isTestFile('scripts/smoke.js'));
  assert.ok(!isTestFile('src/renderer/app.js'));
});

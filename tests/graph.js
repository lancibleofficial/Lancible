// Чтение графа кода graphify для тестов.
//
// Граф лежит в graphify-out/ и в репозиторий не коммитится: это производный
// артефакт на 4 МБ, который пересобирается за шесть секунд. Поэтому всё, что
// отсюда читается, может отсутствовать — на свежем клоне, у того, кто не
// ставил graphify, и в GitHub. Тесты в таком случае пропускаются с причиной,
// а не падают.
const fs = require('node:fs');
const path = require('node:path');

const GRAPH = path.join(__dirname, '..', 'graphify-out', 'graph.json');

/** Рёбра, означающие «этим пользуются». `contains` сюда не входит: оно
 *  связывает файл с его символами, и такое ребро есть у каждого символа —
 *  по нему ничего не узнать. */
const USE = new Set([
  'calls', 'indirect_call', 'references',
  'imports', 'imports_from', 're_exports', 'dynamic_import',
]);

const exists = () => fs.existsSync(GRAPH);

function load() {
  return JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
}

const ROOT = path.join(__dirname, '..');

const isTestFile = (file) => /^tests\//.test(file) || /\.(test|spec)\.js$/.test(file);

function readLines(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/); } catch { return null; }
}

/** Помощник теста, которого зовут в этом же файле.
 *
 *  Разбор графа не видит вызов хелпера изнутри колбэка test(...), и каждый
 *  новый тест с хелпером попадал в «сироты» — 10 октября 2026 снимок
 *  переснимали из-за этого трижды за день. Для тестовых файлов поэтому
 *  смотрим сами: имя упоминается в файле где-то кроме строки объявления и
 *  не в комментарии — значит, хелпером пользуются. Хелпер, которого не зовут
 *  нигде, по-прежнему остаётся в сиротах. */
function usedInOwnTestFile(node, read) {
  if (!isTestFile(node.file)) return false;
  const name = String(node.label).replace(/\(\)$/, '');
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false;
  const lines = read(node.file);
  if (!lines) return false;
  const decl = (Number(String(node.at).replace(/^L/, '')) || 0) - 1;
  const re = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
  return lines.some((line, i) => i !== decl && !/^\s*(\/\/|\*|\/\*)/.test(line) && re.test(line));
}

/** Узлы кода, в которые не ведёт ни одно ребро использования.
 *
 *  Это не список мёртвого кода, а список кандидатов. Точка входа тоже не
 *  имеет входящих рёбер; обработчик, переданный в JSX как `onPress={onAdd}`,
 *  разбору по именам тоже часто не виден. Поэтому смысл не в самом списке, а
 *  в его изменении: появился новый — иди посмотри, что это.
 *
 *  Граф и чтение файлов можно подставить — так правило проверяется без
 *  собранного graphify (tests/unit/graph-orphans-rules.test.js). */
function orphans(g = load(), read = readLines) {
  const used = new Set();
  for (const link of g.links) if (USE.has(link.relation)) used.add(link.target);
  return g.nodes
    .filter((n) => n._callable && n.file_type === 'code' && !used.has(n.id))
    .map((n) => ({ id: n.id, label: n.label, file: n.source_file || '', at: n.source_location || '' }))
    .filter((n) => !usedInOwnTestFile(n, read))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

module.exports = { GRAPH, exists, load, orphans, isTestFile };

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

/** Узлы кода, в которые не ведёт ни одно ребро использования.
 *
 *  Это не список мёртвого кода, а список кандидатов. Точка входа тоже не
 *  имеет входящих рёбер; обработчик, переданный в JSX как `onPress={onAdd}`,
 *  разбору по именам тоже часто не виден. Поэтому смысл не в самом списке, а
 *  в его изменении: появился новый — иди посмотри, что это. */
function orphans() {
  const g = load();
  const used = new Set();
  for (const link of g.links) if (USE.has(link.relation)) used.add(link.target);
  return g.nodes
    .filter((n) => n._callable && n.file_type === 'code' && !used.has(n.id))
    .map((n) => ({ id: n.id, label: n.label, file: n.source_file || '', at: n.source_location || '' }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

module.exports = { GRAPH, exists, load, orphans };

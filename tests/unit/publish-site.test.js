// Граф кода в админку: scripts/publish-site.js (npm run site:refresh).
// Запуск: npm run test:unit
//
// С 23 октября 2026 граф — раздел админки, и выгрузку graphify мы не
// выкладываем: она держится на встроенных скриптах и стилях строкой, а
// политика сайта админки их не пускает (admin/vercel.json). Скрипт вынимает из
// выгрузки данные — узлы, связи, легенду — и кладёт их в admin/graph/graph.json.
// Здесь — что разбор берёт данные из того вида, что graphify отдаёт на самом
// деле, и громко останавливается, если шаблон сменился: вид строк, версия
// vis-network, узел без подписи.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractGraph, graphNumbers, buildGraphData, scanForSecrets, VIS, GRAPH_DATA } = require('../../scripts/publish-site.js');

const ROOT = path.join(__dirname, '..', '..');

/** Выгрузка graphify в том виде, в каком она лежит в graphify-out/graph.html:
 *  тег библиотеки в три строки и данные строками «const X = […];». */
const page = ({ nodes = [{ id: '0', label: 'app.js', color: { background: '#4E79A7' }, community: 0 }], vis = '9.1.6', extra = '' } = {}) => [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  `<script src="https://unpkg.com/vis-network@${vis}/standalone/umd/vis-network.min.js"\r`,
  '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\r',
  '        crossorigin="anonymous"></script>',
  '</head><body><div id="graph"></div>',
  '<script>',
  `const RAW_NODES = ${JSON.stringify(nodes)};`,
  'const RAW_EDGES = [{"from": "0", "to": "0", "title": "1 cross-community edges [AGGREGATED]", "dashes": true, "width": 1, "color": {"opacity": 0.35}}];',
  'const LEGEND = [{"cid": 0, "color": "#4E79A7", "label": "app.js", "count": 183}];',
  extra,
  '</script>',
  '<script>',
  '// Render hyperedges as shaded regions',
  'const hyperedges = [];',
  '</script></body></html>',
].join('\n');

test('данные вынимаются из выгрузки graphify как есть', () => {
  const data = extractGraph(page());
  assert.deepEqual(Object.keys(data), ['nodes', 'edges', 'legend', 'hyperedges']);
  assert.equal(data.nodes[0].label, 'app.js');
  assert.equal(data.edges[0].color.opacity, 0.35);
  assert.equal(data.legend[0].count, 183);
  assert.deepEqual(data.hyperedges, []);
});

test('сменился шаблон graphify — публикация останавливается, а не кладёт пустое', () => {
  assert.throws(() => extractGraph(page({ vis: '9.2.0' })), /vis-network 9\.1\.6/, 'другая версия библиотеки');
  assert.throws(() => extractGraph(page().replace('const LEGEND = ', 'let LEGEND = ')), /const LEGEND/, 'другой вид строки');
  assert.throws(() => extractGraph(page({ nodes: [] })), /ни одного узла/);
  assert.throws(() => extractGraph(page({ nodes: [{ id: '0' }] })), /без id или подписи/);
});

test('graph.json: числа графа целиком и сколько точек на рисунке', () => {
  const data = extractGraph(page());
  const numbers = graphNumbers({ nodes: [{ community: 0 }, { community: 1 }, { community: 1 }], links: [{}, {}] }, new Date(2026, 9, 3));
  assert.deepEqual(numbers, { nodes: 3, edges: 2, communities: 2, date: '03.10.2026' });
  const out = JSON.parse(buildGraphData(data, numbers));
  assert.deepEqual(out.meta, { ...numbers, shown: { nodes: 1, edges: 1 } });
  assert.deepEqual(out.nodes, data.nodes);
});

test('секрет в подписи узла ловится на готовом graph.json', () => {
  // Публикация проверяет на секреты то, что ляжет в админку, — текст
  // graph.json, а не только выгрузку.
  const leak = extractGraph(page({ nodes: [{ id: '0', label: 'пишите на someone@example.com' }] }));
  assert.ok(scanForSecrets(buildGraphData(leak, { nodes: 1, edges: 0, communities: 1, date: '01.01.2026' })).length > 0);
});

test('выложенный граф лежит в админке, а библиотека рядом — в admin/vendor', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', GRAPH_DATA)), `нет admin/${GRAPH_DATA} — npm run site:refresh`);
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'vendor', VIS)), `нет admin/vendor/${VIS}`);
  for (const f of ['graph.html', 'graph-view.html']) assert.ok(!fs.existsSync(path.join(ROOT, 'landing', f)), `landing/${f} вернулся — граф живёт в админке`);
});

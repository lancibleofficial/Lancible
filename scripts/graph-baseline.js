// Снимок узлов графа без входящих рёбер — список, от которого отсчитываются
// новые. Запуск: npm run graph:baseline
//
// Зачем снимок, а не «ноль мёртвых узлов». Нулём этот список не бывает: точка
// входа не имеет входящих рёбер по определению, а разбор по именам не видит
// обработчик, переданный в JSX как onPress={onAdd}. Требовать нуля — значит
// требовать невозможного и получить тест, который все обходят.
//
// Поэтому фиксируется текущее положение дел, а тест следит за изменением:
// появился новый узел без входящих — иди посмотри, что это. Удалил код —
// перезапиши снимок этой командой и увидь в diff, что именно ушло.
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../tests/graph');

const OUT = path.join(__dirname, '..', 'tests', 'unit', 'graph-orphans.baseline.json');

if (!graph.exists()) {
  console.error('Графа нет. Собрать: graphify update .');
  process.exit(1);
}

const found = graph.orphans();
const before = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { nodes: [] };
const was = new Set(before.nodes.map((n) => n.id));
const now = new Set(found.map((n) => n.id));

fs.writeFileSync(OUT, `${JSON.stringify({
  // Снимок переписывается командой, а не руками: порядок и форма тут
  // машинные, и ручная правка их сломает.
  _: 'Узлы без входящих рёбер на момент снимка. Пересоздать: npm run graph:baseline',
  nodes: found,
}, null, 2)}\n`);

const added = found.filter((n) => !was.has(n.id));
const gone = before.nodes.filter((n) => !now.has(n.id));
console.log(`узлов без входящих: ${found.length} (было ${before.nodes.length})`);
if (added.length) console.log(`  прибавилось ${added.length}: ${added.slice(0, 8).map((n) => n.label).join(', ')}${added.length > 8 ? ' …' : ''}`);
if (gone.length) console.log(`  убыло ${gone.length}: ${gone.slice(0, 8).map((n) => n.label).join(', ')}${gone.length > 8 ? ' …' : ''}`);

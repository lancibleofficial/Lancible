// Мёртвый код по графу. Запуск: npm run test:unit
//
// Откуда взялось. В списке работ (ARCHITECTURE.md, «Что необходимо сделать»)
// узлы графа без входящих рёбер названы следующим источником мёртвого кода.
// Искать их глазами — занятие на один раз: нашёл, вычистил, через месяц
// накопилось снова. Здесь это становится сторожем.
//
// Почему сравнение со снимком, а не «ноль мёртвых узлов». Нулём этот список
// не бывает никогда: точка входа не имеет входящих рёбер по определению, а
// разбор по именам не видит обработчик, переданный в JSX как
// `onPress={onAdd}`. Тест, требующий невозможного, живёт до первого
// --no-verify. Поэтому зафиксировано текущее положение, а тест следит за
// приростом: появился новый узел — иди посмотри, что это.
//
// Снимок обновляется командой: npm run graph:baseline
//
// Когда граф не собран (свежий клон, GitHub, машина без graphify) — тест
// пропускается с причиной, а не выдумывает результат.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../graph');

const BASELINE = path.join(__dirname, 'graph-orphans.baseline.json');

const skip = !graph.exists()
  ? `графа нет (${graph.GRAPH}). Собрать: graphify update .`
  : false;

test('новых узлов без входящих рёбер не появилось', { skip }, () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const known = new Set(base.nodes.map((n) => n.id));
  const added = graph.orphans().filter((n) => !known.has(n.id));

  assert.deepEqual(
    added.map((n) => `${n.label} — ${n.file}:${n.at}`),
    [],
    'в графе появились символы, которых никто не зовёт. Либо это мёртвый код '
    + 'и его надо убрать, либо он нужен и разбор его просто не видит — тогда '
    + 'обнови снимок: npm run graph:baseline',
  );
});

// Исчезнувшие узлы — это хорошая новость (код вычистили), но снимок после
// этого врёт. Падать из-за хорошей новости нельзя, молчать — тоже: снимок
// зарастёт. Отсюда пометка «известная недоработка»: видно в отчёте, сборку
// не красит.
const stale = (() => {
  if (skip) return [];
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const now = new Set(graph.orphans().map((n) => n.id));
  return base.nodes.filter((n) => !now.has(n.id));
})();

test('снимок не зарос: в нём нет того, чего уже нет в коде',
  { skip, todo: stale.length > 0 ? `из снимка пора убрать ${stale.length}: npm run graph:baseline` : false },
  () => {
    assert.deepEqual(stale.map((n) => `${n.label} — ${n.file}`), []);
  });

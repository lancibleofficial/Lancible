// Разбор узлов графа без входящих рёбер. Запуск: npm run graph:orphans
//
// Зачем это отдельная команда. `tests/unit/graph-dead-code.test.js` стережёт
// появление НОВЫХ таких узлов, но не говорит, мёртвые они или нет — и не
// должен: тест обязан быть быстрым. Разбор самого списка — работа редкая и
// медленная, и делать её надо не глазами по двум сотням имён, а так.
//
// Почему нельзя верить графу напрямую. Он строит рёбра по именам и умеет не
// всё: обработчик, переданный в JSX как `onPress={onAdd}`, помощник внутри
// `test()`, вызов через строку — для него «никто не зовёт». Из 212 узлов
// в первом же разборе 179 оказались живыми, 32 — помощниками тестов, и лишь
// один мёртвым по-настоящему.
//
// Поэтому решение принимается по тексту всего репозитория, и упоминания
// делятся по весу:
//
//   внутри собственного тела        — рекурсия, зовущим не считается
//   в комментарии                   — не вызов
//   только в .md                    — описание, а не код
//   в разметке (<script>, onclick=) — точка входа
//   в тестах                        — живёт только ради тестов
//   в рабочем коде                  — живой
//
// Кандидат на удаление — тот, у кого нет ни одного упоминания в рабочем коде
// и в разметке. Проверять его всё равно надо руками: граф не знает про
// динамические вызовы, которых в разметке может не быть видно.
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../tests/graph');

const ROOT = path.join(__dirname, '..');

const SKIP = new Set([
  'node_modules', '.git', 'graphify-out', 'dist',
  'test-results', 'test-results-watch', 'playwright-report', 'vendor',
]);
const EXT = new Set(['.js', '.jsx', '.html', '.json', '.md', '.yml', '.sh']);

// Снимок мёртвого кода перечисляет ровно эти имена: считать его упоминанием
// значит объявить живым весь список разом.
const SELF_REFERENTIAL = new Set(['tests/unit/graph-orphans.baseline.json']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walk(full, out); continue; }
    if (EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/** Границы тела функции по балансу скобок — чтобы рекурсия не считалась
 *  вызовом извне. Строки и комментарии вычёркиваются: скобка в литерале
 *  собьёт счёт. */
function bodyRange(lines, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i += 1) {
    const clean = lines[i].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""').replace(/\/\/.*$/, '');
    for (const ch of clean) {
      if (ch === '{') { depth += 1; seen = true; }
      else if (ch === '}') depth -= 1;
    }
    if (seen && depth <= 0) return [start, i];
  }
  return [start, start];
}

const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l.trim());
const isTest = (f) => f.startsWith('tests/') || f.includes('/tests/') || /\.(test|spec)\.js$/.test(f);
const isDoc = (f) => f.endsWith('.md');
const isMarkup = (f) => f.endsWith('.html');

function main() {
  if (!graph.exists()) {
    console.error('Графа нет. Собрать: graphify update .');
    process.exit(1);
  }

  const texts = new Map();
  for (const f of walk(ROOT)) {
    const r = rel(f);
    if (SELF_REFERENTIAL.has(r)) continue;
    texts.set(r, fs.readFileSync(f, 'utf8').split('\n'));
  }

  const rows = [];
  for (const o of graph.orphans()) {
    const bare = o.label.replace(/\(\)$/, '');
    const declLine = (Number(String(o.at).replace(/^L/, '')) || 1) - 1;
    const home = texts.get(o.file);
    const [bFrom, bTo] = home ? bodyRange(home, declLine) : [declLine, declLine];
    const re = new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const where = { code: [], test: [], doc: [], markup: [], comment: [], self: [] };

    for (const [f, lines] of texts) {
      for (let i = 0; i < lines.length; i += 1) {
        if (!re.test(lines[i])) continue;
        const hit = `${f}:${i + 1}`;
        if (f === o.file && i >= bFrom && i <= bTo) { where.self.push(hit); continue; }
        if (isComment(lines[i])) { where.comment.push(hit); continue; }
        if (isDoc(f)) { where.doc.push(hit); continue; }
        if (isMarkup(f)) { where.markup.push(hit); continue; }
        if (isTest(f)) { where.test.push(hit); continue; }
        where.code.push(hit);
      }
    }
    rows.push({ ...o, bare, where });
  }

  const unused = rows.filter((r) => r.where.code.length === 0 && r.where.markup.length === 0);
  const onlyTests = unused.filter((r) => r.where.test.length > 0);
  const silent = unused.filter((r) => r.where.test.length === 0);
  const live = rows.length - unused.length;

  console.log(`узлов без входящих рёбер: ${rows.length}`);
  console.log(`  зовутся в рабочем коде или разметке: ${live}`);
  console.log(`  только из тестов: ${onlyTests.length}`);
  console.log(`  не зовутся нигде: ${silent.length}`);

  if (silent.length) {
    console.log('\n=== НЕ ЗОВУТСЯ НИГДЕ — смотреть руками ===');
    for (const r of silent) {
      const doc = r.where.doc.length ? `  [упомянут в документах: ${r.where.doc.join(', ')}]` : '';
      console.log(`  ${r.file}:${r.at}  ${r.label}${doc}`);
    }
  } else {
    console.log('\nНи одного узла, который не зовут вообще. Список держится на тех,');
    console.log('кого разбор по именам не видит, — это не мёртвый код.');
  }

  if (process.argv.includes('--tests')) {
    console.log('\n=== ТОЛЬКО ИЗ ТЕСТОВ ===');
    for (const r of onlyTests) console.log(`  ${r.file}:${r.at}  ${r.label}`);
  } else if (onlyTests.length) {
    console.log(`\n(ещё ${onlyTests.length} живут только ради тестов — показать: npm run graph:orphans -- --tests)`);
  }
}

main();

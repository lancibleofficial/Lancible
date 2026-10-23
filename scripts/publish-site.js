// Освежить то, что админка показывает о коде. Запуск: npm run site:refresh
//
// С 23 октября 2026 граф кода и описание устройства — разделы админки
// («Граф кода», «Устройство»), а не служебные страницы лендинга /graph и
// /architecture: их больше нет. Скрипт кладёт свежее в admin/.
//
// Зовётся перед выкатом (пушем в main), и вот почему не чаще. Данные графа
// весят сотни килобайт, а числа о коде меняются с каждой правкой: если
// обновлять их на каждый коммит, каждый коммит тащил бы за собой правку
// файлов, к которым он отношения не имеет. А сайт всё равно обновляется
// только выкатом — значит, и показывать он должен код на момент выката.
//
// Что делается:
//   1. граф пересобирается по исходникам;
//   2. из выгрузки graphify (graphify-out/graph.html) вынимаются данные —
//      узлы, связи, легенда — и проверяются на секреты; при находке НЕ
//      публикуются;
//   3. ложатся в admin/graph/graph.json вместе с числами графа (сколько
//      узлов, связей, сообществ и когда построен);
//   4. числа app.js в admin/content/architecture.html пересчитываются.
//
// Числа, которые меняются редко (сколько файлов в ядре и сколько из них
// копируется на телефон), здесь не трогаются: их сторожит
// tests/unit/architecture.test.js, и разойтись с разделом им не даст крюк
// перед коммитом.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'graphify-out', 'graph.html');
const GRAPH_JSON = path.join(ROOT, 'graphify-out', 'graph.json');
const ADMIN = path.join(ROOT, 'admin');
/** Куда ложатся данные графа и текст «Устройства» — пути внутри admin/. */
const GRAPH_DATA = 'graph/graph.json';
const ARCHITECTURE = 'content/architecture.html';

const say = (s) => console.log(`[site] ${s}`);

// --- 1. граф -------------------------------------------------------------------

function rebuildGraph() {
  say('пересобираю граф…');
  try {
    // --force: граф в админке должен совпадать с кодом. Без флага graphify
    // отказывается уменьшать граф, и после удаления кода туда уехал бы
    // прежний, с уже несуществующими функциями.
    // Без shell: graphify ставится через uv как обычный исполняемый файл
    // (на Windows — graphify.exe), и оболочка ему не нужна. С ней Node ещё и
    // ругается, что аргументы склеиваются, а не экранируются (DEP0190).
    execFileSync('graphify', ['update', '.', '--force'], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) {
    throw new Error('graphify не отработал. Установлен ли он? uv tool install graphifyy');
  }
}

// --- 2. проверка на секреты --------------------------------------------------------
//
// Граф строится по всему репозиторию. Сейчас в графе только имена функций,
// файлов и заголовки документов, но стоит однажды закоммитить файл с ключом —
// и он уедет на сайт админки, а её статика открыта по адресу без входа.
// Поэтому каждая публикация проверяется и при любой находке останавливается.

const SECRETS = [
  ['JWT-токен (ключи Supabase выглядят так)', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['служебный ключ Supabase', /service_role|SUPABASE_SERVICE/i],
  ['ключ OpenAI/Anthropic', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ['токен GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['ключ AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['закрытый ключ', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['пароль в коде', /password\s*[:=]\s*['"][^'"]{4,}['"]/i],
  ['адрес почты', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

function scanForSecrets(text) {
  const found = [];
  for (const [what, re] of SECRETS) {
    const m = text.match(re);
    if (m) found.push(`${what}: «${m[0].slice(0, 24)}…»`);
  }
  return found;
}

// --- 3. данные графа в админку --------------------------------------------------------
//
// Выгрузка graphify — страница со встроенными скриптами и стилями строкой, а
// политика сайта админки (admin/vercel.json) такого не пускает. Поэтому
// страницу мы не выкладываем, а вынимаем из неё данные: строки
// «const RAW_NODES = […];», «const RAW_EDGES = […];», «const LEGEND = […];» и
// «const hyperedges = […];». Рисует их раздел админки (admin/js/sections/
// graph.js) своей копией vis-network (admin/vendor). Шаблон graphify сменил
// вид или версию библиотеки — публикация останавливается, а не кладёт в
// админку то, что раздел не прочтёт.

const VIS = 'vis-network-9.1.6.min.js';
const VIS_VERSION = /vis-network@9\.1\.6\//;

/** Данные графа из выгрузки graphify: { nodes, edges, legend, hyperedges }. */
function extractGraph(html) {
  if (!VIS_VERSION.test(html)) {
    throw new Error('шаблон graphify больше не на vis-network 9.1.6 — сверьте вид данных, положите новую копию '
      + `в admin/vendor и поправьте VIS в scripts/publish-site.js`);
  }
  const grab = (name) => {
    const m = html.match(new RegExp(`^const ${name} = (\\[.*\\]);\\s*$`, 'm'));
    if (!m) throw new Error(`в выгрузке graphify нет строки «const ${name} = […];» — шаблон сменился, поправьте extractGraph`);
    try { return JSON.parse(m[1]); } catch { throw new Error(`«const ${name}» в выгрузке graphify — не JSON`); }
  };
  const data = { nodes: grab('RAW_NODES'), edges: grab('RAW_EDGES'), legend: grab('LEGEND'), hyperedges: grab('hyperedges') };
  if (!data.nodes.length) throw new Error('в выгрузке graphify ни одного узла');
  for (const n of data.nodes) {
    if (n == null || n.id == null || typeof n.label !== 'string') throw new Error('узел графа без id или подписи — шаблон graphify сменился');
  }
  return data;
}

/** Числа графа целиком (по graph.json, а не по рисунку: на большом графе
 *  graphify рисует сообщества, а не узлы). */
function graphNumbers(g, now = new Date()) {
  const communities = new Set(g.nodes.map((n) => n.community).filter((c) => c !== undefined)).size;
  const date = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  return { nodes: g.nodes.length, edges: g.links.length, communities, date };
}

/** Текст admin/graph/graph.json: числа и данные рисунка. */
function buildGraphData(data, numbers) {
  const out = {
    meta: { ...numbers, shown: { nodes: data.nodes.length, edges: data.edges.length } },
    nodes: data.nodes,
    edges: data.edges,
    legend: data.legend,
    hyperedges: data.hyperedges,
  };
  return `${JSON.stringify(out)}\n`;
}

function publishGraph() {
  if (!fs.existsSync(path.join(ADMIN, 'vendor', VIS))) {
    throw new Error(`нет admin/vendor/${VIS} — без неё граф в админке не нарисуется`);
  }
  const html = fs.readFileSync(OUT, 'utf8');
  const data = extractGraph(html);
  const numbers = graphNumbers(JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8')));
  const text = buildGraphData(data, numbers);
  const leaks = scanForSecrets(text);
  if (leaks.length) {
    throw new Error(`в графе нашлось то, что нельзя выкладывать — публикация остановлена:\n  ${leaks.join('\n  ')}`);
  }
  fs.mkdirSync(path.dirname(path.join(ADMIN, GRAPH_DATA)), { recursive: true });
  fs.writeFileSync(path.join(ADMIN, GRAPH_DATA), text);
  say(`граф выложен: admin/${GRAPH_DATA} (${(text.length / 1048576).toFixed(2)} МБ), секретов не найдено`);
  say(`граф: узлов ${numbers.nodes}, связей ${numbers.edges}, сообществ ${numbers.communities}, построен ${numbers.date}`);
}

// --- 4. числа в «Устройстве» ----------------------------------------------------------
//
// Места для чисел помечены в разметке так: <!--m:имя-->значение<!--/m-->.
// Значение между метками заменяется, разметка вокруг не трогается.

function setMarks(file, values) {
  const p = path.join(ADMIN, file);
  let s = fs.readFileSync(p, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<!--m:${safe}-->)[\\s\\S]*?(<!--/m-->)`, 'g');
    const n = (s.match(re) || []).length;
    if (n === 0) throw new Error(`${file}: нет метки ${name}`);
    s = s.replace(re, `$1${value}$2`);
  }
  fs.writeFileSync(p, s);
}

/** Русское склонение: 1 строка, 2 строки, 5 строк. */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Замер app.js — тем же способом, что описан в ARCHITECTURE.md: длина по
 *  балансу скобок, «без DOM» — по отсутствию обращений к документу и
 *  редактору. */
function measureApp() {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const total = lines.length - (text.endsWith('\n') ? 1 : 0);
  const DOM = /\b(document|window|el\.|querySelector|innerHTML|addEventListener|createElement|classList|getComputedStyle|getBoundingClientRect|quill)\b/;
  const decl = /^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;

  const bodyEnd = (start) => {
    let depth = 0;
    let seen = false;
    for (let i = start; i < lines.length; i += 1) {
      const clean = lines[i].replace(/\\./g, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""').replace(/\/\/.*$/, '');
      for (const ch of clean) {
        if (ch === '{') { depth += 1; seen = true; } else if (ch === '}') depth -= 1;
      }
      if (seen && depth <= 0) return i;
    }
    return start;
  };

  let functions = 0;
  let noDom = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = decl.exec(lines[i]);
    if (!m) continue;
    functions += 1;
    const end = m[1] ? bodyEnd(i) : i;
    if (!DOM.test(lines.slice(i, end + 1).join('\n'))) noDom += 1;
  }
  return { total, functions, noDom };
}

function refreshNumbers() {
  const app = measureApp();
  setMarks(ARCHITECTURE, {
    'app.lines': app.total,
    'app.linesPhrase': `${app.total} ${plural(app.total, 'строка', 'строки', 'строк')}`,
    'app.functions': app.functions,
    'app.noDom': app.noDom,
  });
  say(`«Устройство»: app.js ${app.total} строк, функций ${app.functions}, без DOM ${app.noDom}`);
}

// --- запуск ----------------------------------------------------------------------------

// Тесты подключают этот файл ради scanForSecrets, plural, extractGraph и
// buildGraphData — и не должны при этом пересобирать граф и переписывать файлы.
if (require.main === module) {
  try {
    rebuildGraph();
    publishGraph();
    refreshNumbers();
    say('готово — закоммитьте admin/graph и admin/content и выкатывайте');
  } catch (e) {
    console.error(`[site] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { scanForSecrets, plural, extractGraph, graphNumbers, buildGraphData, VIS, GRAPH_DATA, ARCHITECTURE };

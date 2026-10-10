// Освежить то, что сайт показывает о коде. Запуск: npm run site:refresh
//
// Зовётся перед выкатом (пушем в main), и вот почему не чаще. Граф весит
// почти два мегабайта, а числа о коде меняются с каждой правкой: если
// обновлять их на каждый коммит, каждый коммит тащил бы за собой мегабайты и
// правку страницы, к которой он отношения не имеет. А сайт всё равно
// обновляется только выкатом — значит, и показывать он должен код на момент
// выката.
//
// Что делается:
//   1. граф пересобирается по исходникам;
//   2. проверяется на секреты — и при находке НЕ публикуется;
//   3. ложится на лендинг как graph-view.html;
//   4. числа на /graph и /architecture пересчитываются.
//
// Числа, которые меняются редко (сколько файлов в ядре и сколько из них
// копируется на телефон), здесь не трогаются: их сторожит
// tests/unit/architecture.test.js, и разойтись со страницей им не даст крюк
// перед коммитом.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'graphify-out', 'graph.html');
const GRAPH_JSON = path.join(ROOT, 'graphify-out', 'graph.json');
const LANDING = path.join(ROOT, 'landing');

const say = (s) => console.log(`[site] ${s}`);

// --- 1. граф -------------------------------------------------------------------

function rebuildGraph() {
  say('пересобираю граф…');
  try {
    // --force: граф на сайте должен совпадать с кодом. Без флага graphify
    // отказывается уменьшать граф, и после удаления кода на сайт уехал бы
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
// Граф строится по всему репозиторию, а репозиторий закрытый. Сейчас в графе
// только имена функций, файлов и заголовки документов, но стоит однажды
// закоммитить файл с ключом — и он уедет на открытый адрес. Поэтому каждая
// публикация проверяется, и при любой находке остановится.

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

// --- 3. граф на лендинг --------------------------------------------------------------
//
// Библиотеку рисования шаблон graphify берёт с unpkg, а Политика cookie
// обещает, что сторонние сервисы о визите не узнают. Поэтому ссылка
// подменяется копией с нашего адреса (landing/vendor), а любая другая
// внешняя загрузка останавливает публикацию: graphify, сменивший версию
// библиотеки, не должен молча увезти на сайт чужой адрес. Атрибут integrity
// своей копии не нужен — она приходит с того же адреса, что и страница.

const VIS = 'vis-network-9.1.6.min.js';
const VIS_CDN = /<script\s+src="https:\/\/unpkg\.com\/vis-network@9\.1\.6\/standalone\/umd\/vis-network\.min\.js"[^>]*><\/script>/;
const EXTERNAL = /<(script|link|img|iframe)\b[^>]*\s(src|href)\s*=\s*["']?(https?:)?\/\//i;

function localizeVendor(html) {
  const out = html.replace(VIS_CDN, `<script src="vendor/${VIS}"></script>`);
  const ext = out.match(EXTERNAL);
  if (ext) {
    throw new Error(`в графе осталась внешняя загрузка «${ext[0].slice(0, 80)}…» — graphify сменил библиотеку? `
      + 'Положите её копию в landing/vendor и поправьте VIS в scripts/publish-site.js');
  }
  return out;
}

function publishGraph() {
  if (!fs.existsSync(path.join(LANDING, 'vendor', VIS))) {
    throw new Error(`нет landing/vendor/${VIS} — без неё граф на /graph не нарисуется`);
  }
  let html = fs.readFileSync(OUT, 'utf8');
  const leaks = scanForSecrets(html);
  if (leaks.length) {
    throw new Error(`в графе нашлось то, что нельзя выкладывать — публикация остановлена:\n  ${leaks.join('\n  ')}`);
  }
  // Заголовок graphify раскрывает путь к файлу на машине разработчика, а
  // запрета индексации у него нет — заголовок от Vercel его закрывает, но
  // страница должна быть закрыта и сама по себе, как остальные служебные.
  html = html
    .replace(/<title>[^<]*<\/title>/, '<title>Граф кода Lancible</title>')
    .replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');
  if (!html.includes('noindex')) throw new Error('не вышло поставить noindex в страницу графа');
  html = localizeVendor(html);
  fs.writeFileSync(path.join(LANDING, 'graph-view.html'), html);
  say(`граф выложен: landing/graph-view.html (${(html.length / 1048576).toFixed(1)} МБ), секретов не найдено`);
}

// --- 4. числа на страницах ----------------------------------------------------------
//
// Места для чисел помечены в разметке так: <!--m:имя-->значение<!--/m-->.
// Значение между метками заменяется, разметка вокруг не трогается.

function setMarks(file, values) {
  const p = path.join(LANDING, file);
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
  const g = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
  const communities = new Set(g.nodes.map((n) => n.community).filter((c) => c !== undefined)).size;
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  setMarks('graph.html', {
    'graph.nodes': g.nodes.length,
    'graph.edges': g.links.length,
    'graph.communities': communities,
    'graph.date': date,
  });
  say(`/graph: узлов ${g.nodes.length}, связей ${g.links.length}, сообществ ${communities}, построен ${date}`);

  const app = measureApp();
  setMarks('architecture.html', {
    'app.lines': app.total,
    'app.linesPhrase': `${app.total} ${plural(app.total, 'строка', 'строки', 'строк')}`,
    'app.functions': app.functions,
    'app.noDom': app.noDom,
  });
  say(`/architecture: app.js ${app.total} строк, функций ${app.functions}, без DOM ${app.noDom}`);
}

// --- запуск ----------------------------------------------------------------------------

// Тесты подключают этот файл ради scanForSecrets, plural и localizeVendor — и
// не должны при этом пересобирать граф и переписывать страницы.
if (require.main === module) {
  try {
    rebuildGraph();
    publishGraph();
    refreshNumbers();
    say('готово — закоммитьте landing/ и выкатывайте');
  } catch (e) {
    console.error(`[site] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { scanForSecrets, plural, localizeVendor, VIS };

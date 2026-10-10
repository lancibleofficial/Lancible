#!/usr/bin/env node
/* Зоны ролей — кто какие файлы правит (CLAUDE.md → «Команда агентов»).
 *
 * Единственная копия таблицы в коде. Её читают крюк перед коммитом
 * (.githooks/pre-commit зовёт `node scripts/zones.js`) и тест
 * tests/unit/zones.test.js, который заодно сверяет её с таблицей в CLAUDE.md.
 *
 * Как определяется владелец файла: из всех шаблонов, под которые файл
 * подходит, выигрывает самый узкий. Точный путь уже любого шаблона, а из
 * шаблонов уже тот, у кого длиннее постоянная часть до первой звёздочки. Так
 * src/renderer/core/icons.js отходит Icons and Graphics, хотя лежит и в
 * src/renderer/core/** (Core), и в src/renderer/** (Web/Desktop).
 *
 * Что пропускает крюк на ветке <префикс>/…:
 *   - файлы зоны этого префикса;
 *   - DESIGN.md и ARCHITECTURE.md — каждый правит свой раздел;
 *   - тесты к своей правке (tests/**, mobile/tests/**) — веткам разработчиков.
 * Ветка main — без ограничений: там сливает Publish. Ветка с незнакомым
 * префиксом (например, claude/… облачных сессий) или вовсе без «/» — отказ.
 */

const ZONES = {
  web: {
    role: 'Web/Desktop',
    paths: [
      'src/main.js', 'src/preload.js', 'src/xlsx.js', 'src/renderer/**', 'src/editor/**',
      'mobile/src/editor/editorBundle.js', 'web/**', 'landing/**',
      // В регламенте не названы, но обслуживают только веб, лендинг и десктоп.
      'scripts/build-editor.js', 'scripts/build-landing-app.js', 'scripts/serve-web.js',
      'scripts/sync-web-assets.js', 'scripts/shot.js', 'scripts/xlsx-check.js',
    ],
  },
  mobile: {
    role: 'Mobile (Android/IOS)',
    paths: ['mobile/**', 'scripts/check-mobile-build.js'],
  },
  core: {
    role: 'Core/Backend',
    paths: [
      'src/renderer/core/**', 'mobile/src/core/**', 'supabase/**',
      'scripts/worklog.js', 'scripts/sync-mobile-core.js', 'scripts/setup-hooks.js', 'scripts/zones.js', 'scripts/setup-worktree.js',
      'scripts/copy-vendor.js', 'scripts/graph-baseline.js', 'scripts/graph-orphans.js', '.githooks/**',
      'package*.json', 'mobile/package*.json',
      '.github/workflows/test.yml', '.gitignore', '.gitattributes', '.graphifyignore',
      // Очередь журнала; из git её убирает ветка core/logs-untrack.
      'logs/**',
    ],
  },
  gfx: {
    role: 'Icons and Graphics',
    paths: [
      'scripts/make-solar-icons.js', 'scripts/make-ios-icons.js', 'scripts/make-icon.js',
      'scripts/make-mobile-icons.js', 'src/renderer/core/icons.js', 'mobile/assets/**', 'build/**', 'assets/**',
      // Шрифты — тоже графика, где бы ни лежали. @font-face — в стилях поверхности.
      'landing/fonts/**',
    ],
  },
  'qa-web': {
    role: 'Testing (Web/Desktop)',
    paths: ['tests/**', 'playwright.config.js', 'scripts/watch.js', 'scripts/smoke.js', 'scripts/visual-update.js'],
  },
  'qa-mobile': {
    role: 'Testing Mobile (Android/IOS)',
    paths: ['mobile/tests/**', 'mobile/jest.setup.js', 'tests/unit/mobile-*'],
  },
  legal: {
    role: 'Legal Manager',
    paths: [
      'landing/privacy.html', 'landing/terms.html', 'landing/legal.html', 'landing/refund.html',
      'landing/cookies.html', 'landing/delete-account.html', 'landing/business.js',
      'src/renderer/core/legal.js', 'COMPLIANCE.md', 'supabase/legal.sql',
    ],
  },
  // Без префикса ветки: правится только в main.
  publish: {
    role: 'Publish Agent',
    branchless: true,
    paths: [
      'landing/blog-posts.js', 'landing/graph*.html', 'tests/unit/graph-orphans.baseline.json',
      '.github/workflows/release.yml', '.github/workflows/mobile-release.yml',
      'scripts/publish-site.js', 'scripts/publish-release.js', 'README.md',
    ],
  },
  user: {
    role: 'пользователь',
    branchless: true,
    // Регламент и настройки сессий меняются только по слову пользователя.
    paths: ['CLAUDE.md', '.claude/**', '.mcp.json'],
  },
};

// Общие документы: каждый правит свой раздел, по разделам не проверяем.
// Снимок сирот графа — тоже: владеет им Publish и при слиянии пересобирает
// (CLAUDE.md → «Файлы-магниты»), но крюк гоняет graph-dead-code.test.js на
// любой ветке. Добавил узел, которого разбор не видит (onPress={onAdd}), —
// без `npm run graph:baseline` в коммите тест упадёт, и выход остался бы один:
// --no-verify, а он отключает и test:fast. Прирост виден Publish в диффе ветки.
const SHARED = ['DESIGN.md', 'ARCHITECTURE.md', 'tests/unit/graph-orphans.baseline.json'];
// Тесты к своей правке пишет её автор.
const TESTS = ['tests/**', 'mobile/tests/**'];
const DEVELOPERS = ['web', 'mobile', 'core', 'gfx', 'legal'];
const FREE_BRANCHES = ['main'];

function toRegExp(pattern) {
  const body = pattern.split('**').map((part) => part.split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`);
}

function specificity(pattern) {
  const star = pattern.indexOf('*');
  return star === -1 ? 10000 + pattern.length : star;
}

const RULES = Object.entries(ZONES).flatMap(([zone, { paths }]) =>
  paths.map((pattern) => ({ zone, pattern, re: toRegExp(pattern), weight: specificity(pattern) })));

// Правовые строки живут в двух словарях — у десктопа и у телефона — и
// tests/unit/legal-strings.test.js требует, чтобы они совпадали побайтно в
// одном коммите. Словари в разных зонах (Core и Mobile), поэтому новая
// правовая строка упиралась в крюк с обеих сторон: 10 октября 2026 её
// пришлось коммитить с --no-verify. Теперь владелец одного словаря может
// положить ту же правовую строку и в другой — см. legalMirrorOk.
const DICTS = {
  'src/renderer/core/i18n.js': 'mobile/src/lib/i18n.js',
  'mobile/src/lib/i18n.js': 'src/renderer/core/i18n.js',
};
// Те же префиксы, что в legal-strings.test.js; расхождение ловит zones.test.js.
const LEGAL_PREFIXES = ['auth.consent_', 'account.delete', 'about.privacy', 'about.terms', 'about.legal'];
const isLegalKey = (key) => LEGAL_PREFIXES.some((p) => key.startsWith(p));
const LEGAL_LINE = new RegExp(`'(?:${LEGAL_PREFIXES.map((p) => p.replace(/\./g, '\\.')).join('|')})[^']*'\\s*:`);

/**
 * Правка чужого словаря — только правовые строки, равные своим.
 *
 *   diffLines — изменённые строки диффа чужого словаря (+/-);
 *   before / after — его словарь T до и после коммита;
 *   own — свой словарь T в этом же коммите.
 *
 * Пропускаем, если каждая изменённая строка диффа несёт правовой ключ
 * (иначе в коммит мог бы уехать и посторонний код), по смыслу менялись
 * только правовые ключи, и каждое новое значение побайтно равно своему.
 */
// Значения словаря бывают и функциями (формы множественного числа): при
// каждой загрузке это новый объект, поэтому сравниваем по содержимому.
const sameValue = (x, y) => x === y
  || (typeof x === 'function' && typeof y === 'function' && String(x) === String(y))
  || (typeof x === 'object' && x !== null && JSON.stringify(x) === JSON.stringify(y));

function legalMirrorOk({ diffLines, before, after, own }) {
  if (!diffLines.length || !diffLines.every((l) => LEGAL_LINE.test(l))) return false;
  const langs = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  let changed = 0;
  for (const lang of langs) {
    const b = (before && before[lang]) || {};
    const a = (after && after[lang]) || {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (sameValue(b[key], a[key])) continue;
      if (!isLegalKey(key)) return false;
      if (a[key] !== undefined && a[key] !== ((own && own[lang]) || {})[key]) return false;
      changed += 1;
    }
  }
  return changed > 0;
}

/** Оригинал копии ядра: mobile/src/core/x.js → src/renderer/core/x.js. */
function mirrorOriginal(file) {
  const m = file.match(/^mobile\/src\/core\/(.+)$/);
  return m ? `src/renderer/core/${m[1]}` : null;
}

function matches(file, patterns) {
  return patterns.some((p) => toRegExp(p).test(file));
}

/** Зона-владелец файла или null, если файл не назван ни в одной. */
function ownerOf(file) {
  let best = null;
  for (const rule of RULES) {
    if (rule.re.test(file) && (!best || rule.weight > best.weight)) best = rule;
  }
  return best ? best.zone : null;
}

function describeOwner(zone) {
  if (!zone) return 'владелец не назначен — напишите PM, Core добавит файл в scripts/zones.js';
  const z = ZONES[zone];
  return z.branchless ? `${z.role}, правится только в main` : `${z.role}, ветки ${zone}/…`;
}

/**
 * Проверка коммита. Возвращает { ok, free, prefix, refused: [{ file, owner }] }.
 * free — ветка без ограничений: main или detached HEAD (пустое имя).
 *
 * sameAsOriginal(copy, original) — совпадает ли копия ядра в индексе с
 * оригиналом побайтно. Копии в mobile/src/core/ — зона Core, но копию
 * чужого оригинала (legal.js у Legal, icons.js у gfx) коммитит владелец
 * оригинала: sync-mobile-core.js копирует механически, а тест
 * mobile-core.test.js требует копию в том же коммите. Пропускаем только
 * побайтную копию — правка «руками» в копии так не пройдёт.
 */
function checkCommit(branch, files, sameAsOriginal = () => false, legalMirror = () => false) {
  if (!branch || FREE_BRANCHES.includes(branch)) {
    return { ok: true, free: true, refused: [] };
  }
  // Ветка без «/» (fix, test) — такой же отказ, как незнакомый префикс:
  // иначе любое имя без префикса обходило бы проверку целиком.
  const prefix = branch.includes('/') ? branch.slice(0, branch.indexOf('/')) : null;
  const zone = prefix && ZONES[prefix];
  if (!zone || zone.branchless) {
    return { ok: false, unknownPrefix: true, prefix, refused: files.map((file) => ({ file, owner: ownerOf(file) })) };
  }
  const refused = [];
  for (const file of files) {
    const owner = ownerOf(file);
    if (owner === prefix) continue;
    if (matches(file, SHARED)) continue;
    // Тесты к своей правке — но не пересобираемые Publish файлы внутри tests/.
    if (DEVELOPERS.includes(prefix) && matches(file, TESTS) && !(owner && ZONES[owner].branchless)) continue;
    const original = mirrorOriginal(file);
    if (original && ownerOf(original) === prefix && sameAsOriginal(file, original)) continue;
    // Чужой словарь — только владельцу парного словаря и только правовые строки.
    if (DICTS[file] && ownerOf(DICTS[file]) === prefix && legalMirror(file, DICTS[file])) continue;
    refused.push({ file, owner });
  }
  return { ok: refused.length === 0, prefix, refused };
}

function formatRefusal(branch, result) {
  const lines = [];
  if (result.unknownPrefix) {
    lines.push(result.prefix
      ? `Коммит остановлен: у ветки ${branch} незнакомый префикс «${result.prefix}/».`
      : `Коммит остановлен: у ветки ${branch} нет префикса роли. Без ограничений коммитится только main.`);
    lines.push('Префиксы ролей: ' + Object.keys(ZONES).filter((z) => !ZONES[z].branchless).map((z) => `${z}/`).join(', ') +
      '. Таблица зон — CLAUDE.md → «Команда агентов», в коде — scripts/zones.js.');
    return lines.join('\n');
  }
  const z = ZONES[result.prefix];
  lines.push(`Коммит остановлен: ветка ${branch} (${z.role}) правит только свою зону.`);
  lines.push('Эти файлы — чужая зона, правку нужно передать владельцу:');
  for (const { file, owner } of result.refused) lines.push(`  ${file} — ${describeOwner(owner)}`);
  lines.push('Таблица зон — CLAUDE.md → «Команда агентов», в коде — scripts/zones.js.');
  return lines.join('\n');
}

module.exports = { ZONES, SHARED, TESTS, DEVELOPERS, LEGAL_PREFIXES, DICTS, ownerOf, checkCommit, formatRefusal, legalMirrorOk };

if (require.main === module) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

  // Слияние приносит чужие файлы законно — это не правка, а подтягивание.
  const gitDir = git('rev-parse', '--git-dir').trim();
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) process.exit(0);

  let branch = '';
  try { branch = git('symbolic-ref', '--short', '-q', 'HEAD').trim(); } catch { process.exit(0); } // detached HEAD
  const files = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
  // Сравниваем то, что уйдёт в коммит: id объектов в индексе.
  const blob = (file) => { try { return git('rev-parse', `:${file}`).trim(); } catch { return null; } };
  const sameAsOriginal = (copy, original) => { const a = blob(copy); return !!a && a === blob(original); };

  // Словарь T из версии файла (':' — индекс, 'HEAD:' — до коммита).
  const show = (spec) => { try { return git('show', spec); } catch { return null; } };
  const loadDict = (file, rev) => {
    const src = show(`${rev}${file}`);
    if (src === null) return null;
    if (file === 'mobile/src/lib/i18n.js') {
      // ES-модуль телефона — так же, как его читает legal-strings.test.js.
      const body = src.replace(/^import[\s\S]*?from '[^']+';$/gm, '').replace(/^export /gm, '');
      const box = {};
      new Function('module', 'Lang', `${body};module.exports = { T };`)(box, require('../src/renderer/core/lang.js'));
      return box.exports.T;
    }
    const mod = { exports: {} };
    new Function('module', 'exports', 'globalThis', src)(mod, mod.exports, {});
    return mod.exports.T;
  };
  const legalMirror = (file, own) => {
    try {
      const diffLines = git('diff', '--cached', '-U0', '--', file).split('\n')
        .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      return legalMirrorOk({ diffLines, before: loadDict(file, 'HEAD:'), after: loadDict(file, ':'), own: loadDict(own, ':') });
    } catch {
      return false; // не разобрали словарь — пусть решает человек, а не крюк
    }
  };
  const result = checkCommit(branch, files, sameAsOriginal, legalMirror);
  if (result.ok) process.exit(0);
  console.error(formatRefusal(branch, result));
  console.error('Разово обойти: git commit --no-verify');
  process.exit(1);
}

#!/usr/bin/env node
/* Области репозитория и что проверить в каждой при ревью
 * (CLAUDE.md → «Как устроена работа» → «Области и чек-лист ревью»).
 *
 * До 10 октября 2026 это была таблица владения: у каждой роли своя зона, и
 * крюк перед коммитом отказывал ветке, задевшей чужую. Роли упразднены —
 * одна фича, один исполнитель, — и таблица стала чек-листом: крюк не
 * останавливает коммит, а напоминает, какие области задеты и что в них
 * проверить. Молчит, когда правка в одной обычной области: напоминание на
 * каждый коммит перестали бы читать.
 *
 * Единственная копия таблицы в коде. Её читают крюк (.githooks/pre-commit
 * зовёт `node scripts/zones.js`) и тест tests/unit/zones.test.js, который
 * сверяет её с таблицей в CLAUDE.md.
 *
 * Область файла — самый узкий подходящий шаблон: точный путь уже любого
 * шаблона, а из шаблонов уже тот, у кого длиннее постоянная часть до первой
 * звёздочки. Так src/renderer/core/icons.js — графика, хотя лежит и в
 * src/renderer/core/** (ядро), и в src/renderer/** (веб).
 */

const ZONES = {
  web: {
    area: 'Веб, десктоп, лендинг',
    check: 'e2e и тесты лендинга; web/index.html — вслед за src/renderer/index.html; после правки редактора — npm run build:editor',
    paths: [
      'src/main.js', 'src/preload.js', 'src/xlsx.js', 'src/renderer/**', 'src/editor/**',
      'mobile/src/editor/editorBundle.js', 'web/**', 'landing/**',
      'scripts/build-editor.js', 'scripts/build-landing-app.js', 'scripts/serve-web.js',
      'scripts/sync-web-assets.js', 'scripts/shot.js', 'scripts/xlsx-check.js',
    ],
  },
  mobile: {
    area: 'Телефон',
    check: 'npm run test:mobile и check:mobile-build; expo export для iOS',
    paths: ['mobile/**', 'scripts/check-mobile-build.js'],
  },
  core: {
    area: 'Ядро, база, инфраструктура',
    check: 'копии в mobile/src/core — только sync-mobile-core.js, побайтно; права доступа — test:backend; зависимости — оба lock-файла (корень и mobile/)',
    paths: [
      'src/renderer/core/**', 'mobile/src/core/**', 'supabase/**',
      'scripts/worklog.js', 'scripts/sync-mobile-core.js', 'scripts/setup-hooks.js', 'scripts/zones.js', 'scripts/setup-worktree.js',
      'scripts/copy-vendor.js', 'scripts/graph-baseline.js', 'scripts/graph-orphans.js', '.githooks/**',
      'package*.json', 'mobile/package*.json',
      '.github/workflows/test.yml', '.gitignore', '.gitattributes', '.graphifyignore',
      'logs/**',
    ],
  },
  gfx: {
    area: 'Иконки и графика',
    check: 'иконки — только через scripts/make-solar-icons.js (сторож tests/unit/icons.test.js); PNG для iOS — make-ios-icons.js',
    paths: [
      'scripts/make-solar-icons.js', 'scripts/make-ios-icons.js', 'scripts/make-icon.js',
      'scripts/make-mobile-icons.js', 'src/renderer/core/icons.js', 'mobile/assets/**', 'build/**', 'assets/**',
      'landing/fonts/**',
    ],
  },
  tests: {
    area: 'Тесты и их инфраструктура',
    check: 'тест к правке — в том же коммите; эталоны снимков — только npm run test:visual:update и только на Windows',
    paths: [
      'tests/**', 'playwright.config.js', 'scripts/watch.js', 'scripts/smoke.js', 'scripts/visual-update.js',
      'mobile/tests/**', 'mobile/jest.setup.js',
    ],
  },
  legal: {
    area: 'Правовые тексты',
    check: 'четыре языка; правовые строки в обоих словарях; к релизу — сверка по COMPLIANCE.md; новая TERMS_VERSION — тексты сливать до тегов',
    sensitive: true,
    paths: [
      'landing/privacy.html', 'landing/terms.html', 'landing/legal.html', 'landing/refund.html',
      'landing/cookies.html', 'landing/delete-account.html', 'landing/business.js',
      'src/renderer/core/legal.js', 'COMPLIANCE.md', 'supabase/legal.sql',
    ],
  },
  release: {
    area: 'Выкат и пересобираемое',
    check: 'граф, /graph и числа /architecture не править руками — npm run graph:baseline и site:refresh; блог и кнопки загрузок — при выкате',
    sensitive: true,
    paths: [
      'landing/blog-posts.js', 'landing/graph*.html',
      '.github/workflows/release.yml', '.github/workflows/mirror-release.yml', '.github/workflows/mobile-release.yml',
      'scripts/publish-site.js', 'scripts/publish-release.js', 'README.md',
    ],
  },
  process: {
    area: 'Регламент и настройки сессий',
    check: 'меняется только по слову пользователя',
    sensitive: true,
    paths: ['CLAUDE.md', '.claude/**', '.mcp.json'],
  },
};

// Общие документы и снимок сирот графа: правятся вместе с любой правкой,
// областью не считаются. Снимок переснимает тот, кто добавил узел без
// входящих рёбер (иначе крюк красный), а при слиянии — пересборка.
const SHARED = ['DESIGN.md', 'ARCHITECTURE.md', 'tests/unit/graph-orphans.baseline.json'];

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

const isShared = (file) => SHARED.some((p) => toRegExp(p).test(file));

/** Область файла или null, если файл не назван ни в одной. */
function ownerOf(file) {
  let best = null;
  for (const rule of RULES) {
    if (rule.re.test(file) && (!best || rule.weight > best.weight)) best = rule;
  }
  return best ? best.zone : null;
}

/**
 * Что напомнить по набору файлов коммита: [{ zone, area, check, files }] —
 * по одной строке на задетую область, в порядке таблицы; файлы вне таблицы —
 * отдельной строкой с zone: null. Пусто, если напоминать нечего: правка в
 * одной обычной области (или только общие документы).
 */
function reviewNotes(files) {
  const byZone = new Map();
  for (const file of files) {
    if (isShared(file)) continue;
    const zone = ownerOf(file);
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push(file);
  }
  const zones = [...byZone.keys()];
  const quiet = zones.length <= 1 && zones.every((z) => z && !ZONES[z].sensitive);
  if (quiet) return [];
  const order = [...Object.keys(ZONES), null];
  return zones.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((zone) => (zone
    ? { zone, area: ZONES[zone].area, check: ZONES[zone].check, files: byZone.get(zone) }
    : { zone: null, area: 'Вне таблицы', check: 'назначь область в scripts/zones.js', files: byZone.get(zone) }));
}

function formatNotes(notes) {
  if (!notes.length) return '';
  const lines = ['Чек-лист ревью — задеты области:'];
  for (const n of notes) {
    lines.push(`  ${n.area} (${n.files.length}): ${n.check}`);
  }
  lines.push('Таблица — CLAUDE.md → «Области и чек-лист ревью», в коде — scripts/zones.js. Коммит не останавливается.');
  return lines.join('\n');
}

module.exports = { ZONES, SHARED, ownerOf, reviewNotes, formatNotes };

if (require.main === module) {
  // Крюк только напоминает: выход всегда 0. Слияние не напоминаем — это
  // подтягивание чужих правок, а не своя.
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  try {
    const gitDir = git('rev-parse', '--git-dir').trim();
    if (!fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
      const files = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
      const text = formatNotes(reviewNotes(files));
      if (text) console.log(text);
    }
  } catch (err) {
    console.log(`[zones] напоминание пропущено: ${err.message}`);
  }
  process.exit(0);
}

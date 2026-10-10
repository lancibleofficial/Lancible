// Зоны ролей: кто какие файлы правит и что пропускает крюк перед коммитом.
// Таблица — scripts/zones.js, регламент — CLAUDE.md → «Команда агентов».
// Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ZONES, ownerOf, checkCommit, formatRefusal } = require('../../scripts/zones.js');

const ROOT = path.resolve(__dirname, '../..');

test('владелец файла — самый узкий подходящий шаблон', () => {
  const cases = {
    'src/renderer/app.js': 'web',
    'src/renderer/core/status.js': 'core',
    'src/renderer/core/icons.js': 'gfx',
    'src/renderer/core/legal.js': 'legal',
    'mobile/App.js': 'mobile',
    'mobile/src/core/status.js': 'core',
    'mobile/src/editor/editorBundle.js': 'web',
    'mobile/assets/icon.png': 'gfx',
    'mobile/tests/home.test.js': 'qa-mobile',
    'mobile/package.json': 'core',
    'tests/e2e/layout.spec.js': 'qa-web',
    'tests/unit/mobile-parity.test.js': 'qa-mobile',
    'tests/unit/graph-orphans.baseline.json': 'publish',
    'landing/index.html': 'web',
    'landing/privacy.html': 'legal',
    'landing/blog-posts.js': 'publish',
    'landing/graph.html': 'publish',
    'landing/fonts/Sora-latin.woff2': 'gfx',
    'landing/fonts/Sora-OFL.txt': 'gfx',
    'landing/landing.css': 'web',
    'supabase/schema.sql': 'core',
    'supabase/legal.sql': 'legal',
    'CLAUDE.md': 'user',
  };
  for (const [file, zone] of Object.entries(cases)) assert.equal(ownerOf(file), zone, file);
  assert.equal(ownerOf('somewhere/new.txt'), null);
});

test('ветка роли коммитит свою зону, общие документы и тесты к правке', () => {
  assert.ok(checkCommit('core/x', ['src/renderer/core/status.js', 'tests/unit/status.test.js', 'DESIGN.md']).ok);
  assert.ok(checkCommit('web/x', ['src/renderer/app.js', 'tests/e2e/a.spec.js', 'mobile/tests/a.test.js']).ok);
  assert.ok(checkCommit('legal/x', ['landing/terms.html', 'tests/unit/legal.test.js']).ok, 'legal тоже пишет тесты к правке');
  assert.ok(checkCommit('gfx/x', ['src/renderer/core/icons.js', 'tests/unit/icons.test.js', 'ARCHITECTURE.md']).ok);

  const r = checkCommit('web/x', ['src/renderer/app.js', 'src/renderer/core/status.js', 'package.json']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.refused.map((x) => [x.file, x.owner]), [
    ['src/renderer/core/status.js', 'core'], ['package.json', 'core'],
  ]);
});

test('тестировщики — каждый в своей зоне', () => {
  assert.ok(checkCommit('qa-web/x', ['tests/e2e/a.spec.js', 'playwright.config.js']).ok);
  assert.equal(checkCommit('qa-web/x', ['mobile/tests/a.test.js']).ok, false);
  assert.equal(checkCommit('qa-web/x', ['tests/unit/mobile-parity.test.js']).ok, false);
  assert.ok(checkCommit('qa-mobile/x', ['mobile/tests/a.test.js', 'tests/unit/mobile-parity.test.js']).ok);
  assert.equal(checkCommit('qa-mobile/x', ['tests/e2e/a.spec.js']).ok, false);
  assert.equal(checkCommit('qa-web/x', ['src/renderer/app.js']).ok, false, 'тестировщик не правит продуктовый код');
});

test('пересобираемое Publish и регламент — только в main', () => {
  assert.equal(checkCommit('core/x', ['landing/graph.html']).ok, false);
  assert.equal(checkCommit('web/x', ['landing/blog-posts.js']).ok, false);
  assert.equal(checkCommit('core/x', ['CLAUDE.md']).ok, false);
  assert.ok(checkCommit('main', ['CLAUDE.md', 'landing/blog-posts.js', 'src/renderer/app.js']).ok);
  assert.ok(checkCommit('', ['x']).ok, 'detached HEAD — без ограничений');
});

test('незнакомый префикс — отказ с подсказкой про таблицу зон', () => {
  const r = checkCommit('claude/fix-thing', ['src/renderer/app.js']);
  assert.equal(r.ok, false);
  assert.ok(r.unknownPrefix);
  const text = formatRefusal('claude/fix-thing', r);
  assert.match(text, /незнакомый префикс «claude\/»/);
  assert.match(text, /scripts\/zones\.js/);
  assert.equal(checkCommit('publish/x', ['README.md']).ok, false, 'у Publish нет веток с префиксом');
});

// Иначе крюк загонял бы в --no-verify: он гоняет graph-dead-code.test.js, и
// новый узел без входящих рёбер требует переснять снимок в том же коммите.
test('снимок сирот графа коммитится с любой ветки роли, хоть и принадлежит Publish', () => {
  assert.equal(ownerOf('tests/unit/graph-orphans.baseline.json'), 'publish');
  for (const branch of ['web/x', 'mobile/x', 'core/x', 'gfx/x', 'legal/x', 'qa-web/x', 'qa-mobile/x']) {
    assert.ok(checkCommit(branch, ['tests/unit/graph-orphans.baseline.json']).ok, branch);
  }
  assert.equal(checkCommit('claude/x', ['tests/unit/graph-orphans.baseline.json']).ok, false);
});

// Legal поднимает версию в core/legal.js, а mobile-core.test.js требует
// побайтную копию в mobile/src/core/ в том же коммите.
test('копию ядра коммитит владелец оригинала, только побайтную', () => {
  const same = () => true;
  const differs = () => false;
  assert.ok(checkCommit('legal/x', ['src/renderer/core/legal.js', 'mobile/src/core/legal.js'], same).ok);
  assert.ok(checkCommit('gfx/x', ['src/renderer/core/icons.js', 'mobile/src/core/icons.js'], same).ok);
  assert.equal(checkCommit('legal/x', ['mobile/src/core/legal.js'], differs).ok, false, 'правка копии руками');
  assert.equal(checkCommit('legal/x', ['mobile/src/core/status.js'], same).ok, false, 'чужой оригинал');
  assert.equal(checkCommit('web/x', ['mobile/src/core/legal.js'], same).ok, false);
  assert.equal(checkCommit('legal/x', ['mobile/src/core/legal.js']).ok, false, 'без проверки — не пропускаем');
  assert.ok(checkCommit('core/x', ['mobile/src/core/status.js']).ok, 'копии — по-прежнему зона Core');
});

test('ветка без «/» — отказ: без ограничений только main', () => {
  for (const branch of ['fix', 'test', 'hotfix']) {
    const r = checkCommit(branch, ['src/renderer/core/status.js']);
    assert.equal(r.ok, false, branch);
    assert.match(formatRefusal(branch, r), new RegExp(`у ветки ${branch} нет префикса роли`));
  }
});

test('отказ называет файл, ветку и владельца', () => {
  const r = checkCommit('mobile/x', ['src/renderer/core/status.js', 'somewhere/new.txt']);
  const text = formatRefusal('mobile/x', r);
  assert.match(text, /ветка mobile\/x \(Mobile \(Android\/IOS\)\)/);
  assert.match(text, /src\/renderer\/core\/status\.js — Core\/Backend, ветки core\/…/);
  assert.match(text, /somewhere\/new\.txt — владелец не назначен/);
});

test('у каждого файла репозитория есть владелец', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const orphans = files.filter((f) => !ownerOf(f) && !['DESIGN.md', 'ARCHITECTURE.md'].includes(f));
  assert.deepEqual(orphans, [], 'назначьте владельца в scripts/zones.js');
});

// Сверка с таблицей в CLAUDE.md: каждый путь из колонки «Своя зона» (без
// оговорок «кроме …») должен принадлежать этой роли и в scripts/zones.js.
test('scripts/zones.js не расходится с таблицей в CLAUDE.md', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const section = md.slice(md.indexOf('### Роли и зоны'), md.indexOf('Общие правила для всех ролей'));
  const rows = section.split('\n').filter((l) => l.startsWith('| **'));
  assert.ok(rows.length >= 8, 'таблица ролей в CLAUDE.md не найдена');

  const zoneByRole = Object.fromEntries(Object.entries(ZONES).map(([z, { role }]) => [role, z]));
  // Пути, которые в регламенте записаны коротко.
  const ALIASES = {
    'make-ios-icons.js': 'scripts/make-ios-icons.js', 'make-icon.js': 'scripts/make-icon.js',
    'make-mobile-icons.js': 'scripts/make-mobile-icons.js',
    'release.yml': '.github/workflows/release.yml', 'mobile-release.yml': '.github/workflows/mobile-release.yml',
  };
  // Не файлы этого репозитория, слишком общие слова или уточнения к соседнему
  // пути («`package*.json` в корне и в `mobile/`» — это не вся папка mobile/).
  const SKIP = new Set(['main', 'latest.json', 'scripts/', 'mobile/']);

  let checked = 0;
  for (const row of rows) {
    const [, roleCell, zoneCell] = row.split('|').map((c) => c.trim());
    const role = roleCell.replace(/\*/g, '');
    if (role === 'Product Manager') continue;
    const zone = zoneByRole[role];
    assert.ok(zone, `роль «${role}» из CLAUDE.md не найдена в scripts/zones.js`);
    const own = zoneCell.replace(/\([^)]*кроме[^)]*\)/g, '').split(/,\s*кроме\s/)[0];
    for (const [, raw] of own.matchAll(/`([^`]+)`/g)) {
      if (SKIP.has(raw) || raw.startsWith('/')) continue; // /graph, /architecture — адреса сайта, не файлы
      const brace = raw.match(/^(.*)\{([^}]+)\}(.*)$/);
      const pats = brace ? brace[2].split(',').map((x) => brace[1] + x + brace[3]) : [ALIASES[raw] || raw];
      for (const pat of pats) {
        const sample = pat.replace(/\/$/, '/x').replace(/\*\*/g, 'x/y.js').replace(/\*/g, 'x');
        assert.equal(ownerOf(sample), zone, `CLAUDE.md: ${raw} у роли ${role}, а scripts/zones.js отдаёт ${sample} зоне ${ownerOf(sample)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 30, `сверено путей: ${checked}`);
});

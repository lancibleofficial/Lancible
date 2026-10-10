// Области репозитория и чек-лист ревью: что напоминает крюк перед коммитом.
// Таблица — scripts/zones.js, регламент — CLAUDE.md → «Области и чек-лист ревью».
// Запуск: npm run test:unit
//
// С 10 октября 2026 крюк коммит не останавливает (роли упразднены, одна
// фича — один исполнитель), а напоминает, какие области задеты и что в них
// проверить. Здесь проверяется: у каждого файла есть область, напоминание
// появляется ровно тогда, когда нужно, крюк выходит с нулём, а таблица не
// расходится с регламентом.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { ZONES, ownerOf, reviewNotes, formatNotes } = require('../../scripts/zones.js');

const ROOT = path.resolve(__dirname, '../..');

test('область файла — самый узкий подходящий шаблон', () => {
  const cases = {
    'src/renderer/app.js': 'web',
    'src/renderer/core/status.js': 'core',
    'src/renderer/core/icons.js': 'gfx',
    'src/renderer/core/legal.js': 'legal',
    'mobile/App.js': 'mobile',
    'mobile/src/core/status.js': 'core',
    'mobile/src/editor/editorBundle.js': 'web',
    'mobile/assets/icon.png': 'gfx',
    'mobile/tests/home.test.js': 'tests',
    'mobile/package.json': 'core',
    'tests/e2e/layout.spec.js': 'tests',
    'landing/index.html': 'web',
    'landing/privacy.html': 'legal',
    'landing/blog-posts.js': 'release',
    'landing/graph.html': 'release',
    'landing/fonts/Sora-latin.woff2': 'gfx',
    'landing/landing.css': 'web',
    'supabase/schema.sql': 'core',
    'supabase/legal.sql': 'legal',
    'CLAUDE.md': 'process',
  };
  for (const [file, zone] of Object.entries(cases)) assert.equal(ownerOf(file), zone, file);
  assert.equal(ownerOf('somewhere/new.txt'), null);
});

test('правка в одной обычной области — молча', () => {
  assert.deepEqual(reviewNotes(['src/renderer/app.js', 'web/index.html', 'landing/landing.css']), []);
  assert.deepEqual(reviewNotes(['mobile/App.js']), []);
  // Общие документы и снимок сирот графа областью не считаются.
  assert.deepEqual(reviewNotes(['src/renderer/app.js', 'DESIGN.md', 'tests/unit/graph-orphans.baseline.json']), []);
  assert.deepEqual(reviewNotes([]), []);
});

test('несколько областей — напоминание по каждой, в порядке таблицы', () => {
  const notes = reviewNotes(['package.json', 'src/renderer/app.js', 'tests/e2e/a.spec.js']);
  assert.deepEqual(notes.map((n) => n.zone), ['web', 'core', 'tests']);
  assert.deepEqual(notes.find((n) => n.zone === 'core').files, ['package.json']);
  const text = formatNotes(notes);
  assert.match(text, /Веб, десктоп, лендинг \(1\): e2e/);
  assert.match(text, /Коммит не останавливается/);
});

test('правовые тексты, выкат и регламент напоминаются даже поодиночке', () => {
  for (const [file, zone] of [['landing/terms.html', 'legal'], ['landing/blog-posts.js', 'release'], ['CLAUDE.md', 'process']]) {
    const notes = reviewNotes([file]);
    assert.deepEqual(notes.map((n) => n.zone), [zone], file);
  }
  assert.match(formatNotes(reviewNotes(['CLAUDE.md'])), /только по слову пользователя/);
});

test('файл вне таблицы — отдельной строкой с подсказкой', () => {
  const notes = reviewNotes(['somewhere/new.txt']);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].zone, null);
  assert.match(formatNotes(notes), /назначь область в scripts\/zones\.js/);
});

test('крюк не останавливает коммит: выход с нулём', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'zones.js')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('у каждого файла репозитория есть область', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const orphans = files.filter((f) => !ownerOf(f) && !['DESIGN.md', 'ARCHITECTURE.md'].includes(f));
  assert.deepEqual(orphans, [], 'назначьте область в scripts/zones.js');
});

// Сверка с таблицей в CLAUDE.md: каждый путь из колонки «Что входит» должен
// попадать в ту же область и в scripts/zones.js.
test('scripts/zones.js не расходится с таблицей в CLAUDE.md', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const start = md.indexOf('### Области и чек-лист ревью');
  assert.ok(start >= 0, 'в CLAUDE.md нет раздела «Области и чек-лист ревью»');
  const section = md.slice(start, md.indexOf('\n### ', start + 10));
  const rows = section.split('\n').filter((l) => l.startsWith('| **'));
  assert.equal(rows.length, Object.keys(ZONES).length, 'строк в таблице CLAUDE.md столько же, сколько областей');

  const zoneByArea = Object.fromEntries(Object.entries(ZONES).map(([z, { area }]) => [area, z]));
  let checked = 0;
  for (const row of rows) {
    const [, areaCell, pathsCell] = row.split('|').map((c) => c.trim());
    const area = areaCell.replace(/\*/g, '');
    const zone = zoneByArea[area];
    assert.ok(zone, `область «${area}» из CLAUDE.md не найдена в scripts/zones.js`);
    for (const [, raw] of pathsCell.matchAll(/`([^`]+)`/g)) {
      const brace = raw.match(/^(.*)\{([^}]+)\}(.*)$/);
      const pats = brace ? brace[2].split(',').map((x) => brace[1] + x + brace[3]) : [raw];
      for (const pat of pats) {
        const sample = pat.replace(/\/$/, '/x').replace(/\*\*/g, 'x/y.js').replace(/\*/g, 'x');
        assert.equal(ownerOf(sample), zone, `CLAUDE.md: ${raw} в области «${area}», а scripts/zones.js отдаёт ${sample} области ${ownerOf(sample)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 25, `сверено путей: ${checked}`);
});

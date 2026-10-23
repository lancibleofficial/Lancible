// Шаги выпуска кнопкой, вынесенные из publish.yml в scripts/release-steps.js:
// версии, размеры установщиков, проверка после сборок, latest.json телефона и
// итог запуска. Запуск: npm run test:unit
//
// Без сети: настоящие файлы проекта копируются во временную папку, фид и R2
// подменяются функцией fetch. Порядок шагов в самом workflow сверяет
// tests/unit/publish-workflow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const S = require('../../scripts/release-steps.js');
const { rewriteManifest, androidManifestBlock } = require('../../scripts/publish-release.js');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release-steps.js');
const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-steps-'));

/** Копия package.json, package-lock.json и mobile/app.json. */
function copyVersions() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'mobile'));
  for (const f of ['package.json', 'package-lock.json', 'mobile/app.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  return { dir, read, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const kv = (stdout) => Object.fromEntries(stdout.trim().split(/\r?\n/).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const bump = (v) => v.replace(/\d+$/, (n) => String(Number(n) + 1));

// --- версии ----------------------------------------------------------------------

test('newer: сравнение X.Y.Z по числам, а не по строкам', () => {
  assert.equal(S.newer('0.5.10', '0.5.9'), true);
  assert.equal(S.newer('1.0.0', '0.99.99'), true);
  assert.equal(S.newer('0.5.1', '0.5.1'), false);
  assert.equal(S.newer('0.4.9', '0.5.0'), false);
});

test('versions --write: package.json, оба version в lock, app.json и versionCode +1 — и больше ничего', () => {
  const c = copyVersions();
  try {
    const before = { pkg: c.read('package.json'), lock: c.read('package-lock.json'), app: c.read('mobile/app.json') };
    const desktop = bump(JSON.parse(before.pkg).version);
    const { expo } = JSON.parse(before.app);
    const mobile = bump(expo.version);
    const r = run(['versions', '--root', c.dir, '--desktop', desktop, '--mobile', mobile, '--write']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(kv(r.stdout), {
      desktop, mobile, desktop_tag: `v${desktop}`, mobile_tag: `mobile-v${mobile}`,
      message: `Версии: десктоп ${desktop}, телефон ${mobile} (versionCode ${expo.android.versionCode + 1})`,
    });

    const pkg = JSON.parse(c.read('package.json'));
    const lock = JSON.parse(c.read('package-lock.json'));
    const app = JSON.parse(c.read('mobile/app.json'));
    assert.equal(pkg.version, desktop);
    assert.equal(lock.version, desktop);
    assert.equal(lock.packages[''].version, desktop);
    assert.equal(app.expo.version, mobile);
    assert.equal(app.expo.android.versionCode, expo.android.versionCode + 1);
    assert.equal(app.expo.ios.buildNumber, expo.ios.buildNumber, 'iOS этим путём не выпускается');

    // Как в ручном коммите версий: 1 + 2 + 2 строки, перевод строки прежний.
    const diff = (a, b) => a.split('\n').filter((l, i) => l !== b.split('\n')[i]).length;
    assert.equal(diff(before.pkg, c.read('package.json')), 1);
    assert.equal(diff(before.lock, c.read('package-lock.json')), 2);
    assert.equal(diff(before.app, c.read('mobile/app.json')), 2);
    assert.equal(c.read('package-lock.json').includes('\r\n'), before.lock.includes('\r\n'));
  } finally {
    c.done();
  }
});

test('versions без --write только проверяет; одна платформа — вторая не тронута', () => {
  const c = copyVersions();
  try {
    const before = { pkg: c.read('package.json'), app: c.read('mobile/app.json') };
    const desktop = bump(JSON.parse(before.pkg).version);
    const dry = run(['versions', '--root', c.dir, '--desktop', desktop, '--mobile', '']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(kv(dry.stdout), { desktop, mobile: '', desktop_tag: `v${desktop}`, mobile_tag: '', message: `Версии: десктоп ${desktop}` });
    assert.equal(c.read('package.json'), before.pkg, 'без --write файлы не меняются');

    assert.equal(run(['versions', '--root', c.dir, '--desktop', desktop, '--write']).status, 0);
    assert.equal(c.read('mobile/app.json'), before.app, 'телефон не выпускался — app.json тот же');
  } finally {
    c.done();
  }
});

test('versions: не новее, не X.Y.Z, ничего не задано — ошибка, и ни один файл не записан', () => {
  const c = copyVersions();
  try {
    const before = { pkg: c.read('package.json'), lock: c.read('package-lock.json'), app: c.read('mobile/app.json') };
    const current = JSON.parse(before.pkg).version;
    const good = bump(current);
    for (const [args, re] of [
      [['--desktop', current], /не новее/],
      [['--desktop', '0.0.1'], /не новее/],
      [['--desktop', '1.0'], /не X\.Y\.Z/],
      [['--desktop', 'v1.0.0'], /не X\.Y\.Z/],
      [['--desktop', '1.0.0; rm -rf /'], /не X\.Y\.Z/],
      [['--desktop', '', '--mobile', ''], /хотя бы одна версия/],
      // Десктоп верный, телефон нет: не пишется и десктоп.
      [['--desktop', good, '--mobile', '0.0.1'], /телефон 0\.0\.1 не новее/],
    ]) {
      const r = run(['versions', '--root', c.dir, ...args, '--write']);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, re, args.join(' '));
    }
    assert.equal(c.read('package.json'), before.pkg);
    assert.equal(c.read('package-lock.json'), before.lock);
    assert.equal(c.read('mobile/app.json'), before.app);
  } finally {
    c.done();
  }
});

test('bumpPackage: версии зависимостей в lock не задеваются', () => {
  const pkg = '{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": { "a": "^1.0.0" }\n}\n';
  const lock = JSON.stringify({
    name: 'x', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'x', version: '1.0.0' }, 'node_modules/a': { version: '1.0.0' } },
  }, null, 2);
  const out = S.bumpPackage(pkg, lock, '1.0.1');
  assert.equal(JSON.parse(out.lock).packages['node_modules/a'].version, '1.0.0');
  assert.equal(JSON.parse(out.lock).packages[''].version, '1.0.1');
  assert.throws(() => S.bumpPackage(pkg.replace('"version"', '"ver"'), lock, '1.0.1'), /package\.json: ждали одно вхождение/);
});

// --- размеры установщиков --------------------------------------------------------

const LATEST = `version: 0.5.1
files:
  - url: Lancible Setup 0.5.1.exe
    sha512: abc
    size: 83385271
path: Lancible Setup 0.5.1.exe
sha512: abc
releaseDate: '2026-10-21T19:23:30.995Z'
`;
const LATEST_MAC = `version: 0.5.1
files:
  - url: Lancible-0.5.1-universal-mac.zip
    sha512: def
    size: 183954862
  - url: Lancible-0.5.1-universal.dmg
    sha512: ghi
    size: 184177856
path: Lancible-0.5.1-universal-mac.zip
sha512: def
releaseDate: '2026-10-21T19:24:04.476Z'
`;

test('sizes: .exe из latest.yml и .dmg из latest-mac.yml — как раскладывает download-artifact', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'windows-installer'));
    fs.mkdirSync(path.join(dir, 'mac-installer'));
    fs.writeFileSync(path.join(dir, 'windows-installer', 'latest.yml'), LATEST);
    fs.writeFileSync(path.join(dir, 'mac-installer', 'latest-mac.yml'), LATEST_MAC);
    const r = run(['sizes', dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(kv(r.stdout), { win_bytes: '83385271', mac_bytes: '184177856' });

    fs.rmSync(path.join(dir, 'mac-installer', 'latest-mac.yml'));
    const missing = run(['sizes', dir]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /нет latest\.yml или latest-mac\.yml/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- проверка после сборок ------------------------------------------------------------

const PUBLIC = 'https://pub-0123456789abcdef.r2.dev';
const FEED = 'https://feed.example/storage/v1/object/public/releases';
const quick = { attempts: 2, delayMs: 0 };

/** Фид и R2 в памяти: манифесты со ссылками на R2, HEAD отдаёт заданную длину. */
function world({ version = '0.5.1', base = `${PUBLIC}/v0.5.1`, lengths = {}, status = {} } = {}) {
  const feed = {
    'latest.yml': rewriteManifest(LATEST, base).replace(/^version: .*$/m, `version: ${version}`),
    'latest-mac.yml': rewriteManifest(LATEST_MAC, base).replace(/^version: .*$/m, `version: ${version}`),
  };
  const sizes = { 'Lancible.Setup.0.5.1.exe': 83385271, 'Lancible-0.5.1-universal-mac.zip': 183954862, 'Lancible-0.5.1-universal.dmg': 184177856, 'Lancible-1.3.1.apk': 104878534 };
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    seen.push(`${method} ${url}`);
    if (method === 'GET') {
      const name = url.slice(FEED.length + 1).replace(/\?.*$/, '');
      assert.match(url, /\?publish=\d+$/, 'манифест берётся мимо кэша');
      return { ok: name in feed, status: name in feed ? 200 : 404, text: async () => feed[name] };
    }
    const file = url.split('/').pop();
    const code = status[file] || 200;
    const len = file in lengths ? lengths[file] : sizes[file];
    return { ok: code === 200, status: code, headers: { get: () => (len == null ? null : String(len)) } };
  };
  return { fetchImpl, seen };
}
const desktopOpts = { 'public-url': PUBLIC, 'feed-url': FEED, desktop: '0.5.1', 'win-bytes': '83385271', 'mac-bytes': '184177856' };
const mobileOpts = { 'public-url': PUBLIC, mobile: '1.3.1', 'apk-bytes': '104878534' };
const quiet = () => {};

test('verify: фид на новой версии, все ссылки в R2 отвечают своим размером — проходит', async () => {
  const w = world();
  const lines = await S.verify({ ...desktopOpts, ...mobileOpts }, { fetchImpl: w.fetchImpl, checkOptions: quick, log: quiet });
  assert.equal(lines.length, 3);
  const heads = w.seen.filter((s) => s.startsWith('HEAD')).map((s) => s.slice(5));
  assert.deepEqual(heads, [
    `${PUBLIC}/v0.5.1/Lancible.Setup.0.5.1.exe`,
    `${PUBLIC}/v0.5.1/Lancible-0.5.1-universal-mac.zip`,
    `${PUBLIC}/v0.5.1/Lancible-0.5.1-universal.dmg`,
    `${PUBLIC}/mobile-v1.3.1/Lancible-1.3.1.apk`,
  ]);
});

test('verify: старая версия в фиде, ссылки мимо R2, чужой размер, 404, сервер без длины — ошибка', async () => {
  const cases = [
    [world({ version: '0.5.0' }), desktopOpts, /в latest\.yml версия 0\.5\.0, а выпускали 0\.5\.1/],
    [world({ base: 'https://github.com/x/releases/download/v0.5.1' }), desktopOpts, /ссылается не в R2\/v0\.5\.1/],
    [world(), { ...desktopOpts, 'win-bytes': '1' }, /размером 83385271, а собрали 1/],
    [world({ lengths: { 'Lancible-0.5.1-universal.dmg': 5 } }), desktopOpts, /размер 5, а в манифесте 184177856/],
    [world({ status: { 'Lancible-0.5.1-universal-mac.zip': 404 } }), desktopOpts, /universal-mac\.zip: 404/],
    [world({ lengths: { 'Lancible-1.3.1.apk': null } }), mobileOpts, /не назвал размер/],
    [world({ lengths: { 'Lancible-1.3.1.apk': 7 } }), mobileOpts, /размер 7, а в манифесте 104878534/],
    [world(), { ...mobileOpts, 'apk-bytes': '' }, /нет размера APK/],
    [world(), { ...desktopOpts, 'mac-bytes': undefined }, /нет размера установщика для latest-mac\.yml/],
    [world(), { 'public-url': PUBLIC }, /нечего проверять/],
    [world(), { desktop: '0.5.1' }, /нужен --public-url/],
  ];
  for (const [w, opts, re] of cases) {
    await assert.rejects(S.verify(opts, { fetchImpl: w.fetchImpl, checkOptions: quick, log: quiet }), re, String(re));
  }
});

test('verify: адреса кнопок — те же, что соберёт release-landing.js', () => {
  const { render, parseArgs } = require('../../scripts/release-landing.js');
  const html = fs.readFileSync(path.join(ROOT, 'landing', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'landing', 'strings.js'), 'utf8');
  const out = render({ html, js }, parseArgs(['--public-url', PUBLIC, '--desktop', '0.9.0', '--win-bytes', '1048576', '--mac-bytes', '1048576', '--mobile', '1.9.0', '--apk-bytes', '1048576'])).html;
  const urls = S.desktopUrls(PUBLIC, '0.9.0');
  for (const href of [urls.exe, urls.dmg, S.apkUrl(PUBLIC, '1.9.0')]) assert.ok(out.includes(`href="${href}"`), href);
});

// --- latest.json телефона ---------------------------------------------------------------

test('latest-json: блок android — как печатает publish-release.js, ios не тронут, повтор ничего не меняет', () => {
  const doc = '{\n  "android": {\n    "version": "1.3.1",\n    "url": "x",\n    "apk": "x",\n    "size": 1\n  },\n  "ios": {\n    "version": "1.1.0",\n    "url": "https://testflight.apple.com/join/abc"\n  }\n}\n';
  const opts = { mobile: '1.4.0', publicUrl: `${PUBLIC}/`, apkBytes: '104878534' };
  const once = S.latestJson(doc, opts);
  assert.equal(once.changed, true);
  const url = `${PUBLIC}/mobile-v1.4.0/Lancible-1.4.0.apk`;
  const parsed = JSON.parse(once.text);
  assert.deepEqual(parsed.android, { version: '1.4.0', url, apk: url, size: 104878534 });
  assert.deepEqual(parsed.ios, JSON.parse(doc).ios);
  assert.ok(once.text.includes(androidManifestBlock({ version: '1.4.0', url, size: 104878534 }).replace(/\n/g, '\n  ')), 'тот же вид, что блок из лога mobile-release.yml');
  assert.ok(once.text.endsWith('}\n'));
  assert.deepEqual(S.latestJson(once.text, opts), { text: once.text, changed: false });

  assert.throws(() => S.latestJson(doc, { ...opts, mobile: '1.4' }), /не X\.Y\.Z/);
  assert.throws(() => S.latestJson(doc, { ...opts, apkBytes: '0' }), /нет размера APK/);
  assert.throws(() => S.latestJson('[]', opts), /не объект/);
  assert.throws(() => S.latestJson('{', opts), /JSON/);
});

test('latest-json из командной строки: пишет файл и говорит changed=true, повтор — changed=false', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'latest.json');
    fs.writeFileSync(file, '{\n  "android": {\n    "version": "1.3.1"\n  }\n}\n');
    const args = ['latest-json', file, '--mobile', '1.4.0', '--public-url', PUBLIC, '--apk-bytes', '5'];
    const first = run(args);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(kv(first.stdout), { changed: 'true' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).android.size, 5);
    const again = run(args);
    assert.deepEqual(kv(again.stdout), { changed: 'false' });
    assert.match(again.stderr, /ничего не поменялось/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- итог запуска --------------------------------------------------------------------------

test('summary: три исхода — выпущено, остановлено до публикации, начато и не доведено', () => {
  const all = (result) => Object.fromEntries(Object.keys(S.JOB_NAMES).map((id) => [id, { result }]));
  const ok = S.summary(all('success'), { desktop: '0.5.2', mobile: '' });
  assert.equal(ok.failed, false);
  assert.match(ok.text, /Выпуск десктоп 0\.5\.2 завершён/);
  assert.match(ok.text, /\| Тесты \(Windows, со снимками\) \| готово \|/);

  const early = S.summary({ ...all('skipped'), plan: { result: 'success' }, tests: { result: 'success' }, 'tests-windows': { result: 'failure' } }, { desktop: '0.5.2', mobile: '1.3.2' });
  assert.equal(early.failed, true);
  assert.match(early.text, /остановлен до публикации: версии, теги и файлы не тронуты/);
  assert.match(early.text, /\| Тесты \(Windows, со снимками\) \| упало \|/);

  const late = S.summary({ ...all('success'), updates: { result: 'failure' }, landing: { result: 'skipped' } }, { desktop: '', mobile: '1.3.2' });
  assert.match(late.text, /начат, но не дошёл до конца: версии и теги уже в main/);

  const dir = tmp();
  try {
    const file = path.join(dir, 'summary.md');
    const r = run(['summary'], { NEEDS: JSON.stringify(all('success')), DESKTOP: '0.5.2', MOBILE: '1.3.2', GITHUB_STEP_SUMMARY: file });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(file, 'utf8'), /Выпуск десктоп 0\.5\.2, телефон 1\.3\.2 завершён/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('неизвестный режим и неизвестный флаг — ошибка с подсказкой', () => {
  const r = run(['deploy']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /режим: versions \| sizes \| verify \| latest-json \| summary/);
  const f = run(['versions', '--desktop', '9.9.9', '--force', 'yes']);
  assert.equal(f.status, 1);
  assert.match(f.stderr, /неизвестный аргумент --force/);
});

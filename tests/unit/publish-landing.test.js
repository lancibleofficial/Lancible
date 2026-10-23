// Кнопки скачивания на лендинге после выпуска: scripts/release-landing.js.
// Запуск: npm run test:unit
//
// Откуда тест. До выпуска кнопкой (publish.yml, 23 октября 2026) версии,
// ссылки на R2 и подписи размеров на лендинге правились руками при каждом
// выкате — в index.html и в strings.js на четырёх языках. Теперь их правит
// скрипт последним шагом выпуска, и проверяется он здесь на копиях настоящих
// файлов во временной папке: настоящий лендинг тест не трогает.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mib, relabel, render, parseArgs } = require('../../scripts/release-landing.js');
const { mobileRelease } = require('../../scripts/publish-release.js');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release-landing.js');
const R2 = /^https:\/\/pub-[0-9a-f]+\.r2\.dev$/;

/** Копия landing/index.html и landing/strings.js во временной папке. */
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-landing-'));
  fs.mkdirSync(path.join(dir, 'landing'));
  for (const f of ['index.html', 'strings.js']) fs.copyFileSync(path.join(ROOT, 'landing', f), path.join(dir, 'landing', f));
  const read = (f) => fs.readFileSync(path.join(dir, 'landing', f), 'utf8');
  return { dir, read, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

/** Карточки как их читает tests/unit/landing.test.js: версия над кнопкой и ссылка. */
function cards(html) {
  return [...html.matchAll(/<span>v(\d+\.\d+\.\d+)<\/span><span class="dot"><\/span><span data-i18n="([^"]+)">([^<]*)<\/span><\/div>\s*<a class="platform-cta" href="([^"]+)"/g)]
    .map(([, version, key, label, href]) => ({ version, key, label, href }));
}
const card = (html, key) => cards(html).find((c) => c.key === key);
const sizes = (js, key) => [...js.matchAll(new RegExp(`'${key.replace('.', '\\.')}':\\s*'([^']*)'`, 'g'))].map((m) => m[1]);

/** Строки, которыми отличаются два текста (построчно, одинаковой длины). */
function changedLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, 'число строк поменялось');
  return x.filter((line, i) => line !== y[i]).length;
}

test('МиБ округляются до целого — так подписи считались руками', () => {
  // 0.5.1 и 1.3.1: размеры из latest.yml, latest-mac.yml и latest.json.
  assert.equal(mib(83385271), 80);
  assert.equal(mib(184177856), 176);
  assert.equal(mib(104878534), 100);
  // 0.4.2: «~78 МБ» и «~174 МБ».
  assert.equal(mib(82014245), 78);
  assert.equal(mib(182524474), 174);
  for (const bad of [0, -1, 1.5, 'abc', '', null]) assert.throws(() => mib(bad), /не целое число байт/, String(bad));
});

test('подпись меняет только число: тильда и единица языка остаются', () => {
  assert.equal(relabel('~80 МБ', 91), '~91 МБ');
  assert.equal(relabel('~80 MB', 91), '~91 MB');
  assert.throws(() => relabel('восемьдесят', 91), /не похожа/);
});

test('обе платформы: версии, ссылки в R2 и размеры на четырёх языках', () => {
  const c = copy();
  try {
    const before = { html: c.read('index.html'), js: c.read('strings.js') };
    // Нарочно другие размеры, чтобы подписи точно поменялись: 90, 180 и 101 МиБ.
    const r = run(['--root', c.dir, '--desktop', '0.6.0', '--win-bytes', String(90 * 1048576), '--mac-bytes', String(180 * 1048576 + 1),
      '--mobile', '1.4.0', '--apk-bytes', String(101 * 1048576 - 1)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /изменены: landing\/index\.html, landing\/strings\.js/);
    const html = c.read('index.html');
    const js = c.read('strings.js');

    const base = card(before.html, 'home.win_size').href.replace(/\/v\d+\.\d+\.\d+\/[^/]+$/, '');
    assert.match(base, R2, 'адрес бакета взят из прежней кнопки');
    assert.deepEqual(card(html, 'home.win_size'), { version: '0.6.0', key: 'home.win_size', label: '~90 МБ', href: `${base}/v0.6.0/Lancible.Setup.0.6.0.exe` });
    assert.deepEqual(card(html, 'home.mac_size'), { version: '0.6.0', key: 'home.mac_size', label: '~180 МБ', href: `${base}/v0.6.0/Lancible-0.6.0-universal.dmg` });
    assert.deepEqual(card(html, 'home.android_size'), { version: '1.4.0', key: 'home.android_size', label: '~101 МБ', href: `${base}/${mobileRelease('mobile-v1.4.0').key}` });

    // ru, en, uk, kk — у английского своя единица.
    assert.deepEqual(sizes(js, 'home.win_size'), ['~90 МБ', '~90 MB', '~90 МБ', '~90 МБ']);
    assert.deepEqual(sizes(js, 'home.mac_size'), ['~180 МБ', '~180 MB', '~180 МБ', '~180 МБ']);
    assert.deepEqual(sizes(js, 'home.android_size'), ['~101 МБ', '~101 MB', '~101 МБ', '~101 МБ']);

    // Больше ничего не тронуто: в index.html — по две строки на карточку, в strings.js — 12 подписей.
    assert.equal(changedLines(before.html, html), 6);
    assert.equal(changedLines(before.js, js), 12);
    // Перевод строки остался тем, что был (на Windows копия с CRLF).
    assert.equal(js.includes('\r\n'), before.js.includes('\r\n'));
  } finally {
    c.done();
  }
});

test('повтор с теми же числами — «ничего не поменялось», код выхода 0, файлы те же', () => {
  const c = copy();
  try {
    const args = ['--root', c.dir, '--desktop', '0.6.0', '--win-bytes', '94371840', '--mac-bytes', '188743681', '--mobile', '1.4.0', '--apk-bytes', '105906175'];
    assert.equal(run(args).status, 0);
    const once = { html: c.read('index.html'), js: c.read('strings.js') };
    const again = run(args);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /ничего не поменялось/);
    assert.equal(c.read('index.html'), once.html);
    assert.equal(c.read('strings.js'), once.js);
  } finally {
    c.done();
  }
});

test('только десктоп: карточка телефона и его подписи не тронуты; пустая версия — «не выпускалась»', () => {
  const c = copy();
  try {
    const before = { html: c.read('index.html'), js: c.read('strings.js') };
    // Так зовёт publish.yml, когда телефон не выпускается: пустые значения.
    const r = run(['--root', c.dir, '--desktop', '0.6.0', '--win-bytes', '94371840', '--mac-bytes', '188743680', '--mobile', '', '--apk-bytes', '']);
    assert.equal(r.status, 0, r.stderr);
    const html = c.read('index.html');
    assert.deepEqual(card(html, 'home.android_size'), card(before.html, 'home.android_size'));
    assert.deepEqual(sizes(c.read('strings.js'), 'home.android_size'), sizes(before.js, 'home.android_size'));
    assert.equal(card(html, 'home.win_size').version, '0.6.0');
  } finally {
    c.done();
  }
});

test('--public-url меняет адрес бакета у кнопок выпущенной платформы', () => {
  const c = copy();
  try {
    const r = run(['--root', c.dir, '--public-url', 'https://dl.example.com/', '--mobile', '1.4.0', '--apk-bytes', '105906175']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(card(c.read('index.html'), 'home.android_size').href, 'https://dl.example.com/mobile-v1.4.0/Lancible-1.4.0.apk');
  } finally {
    c.done();
  }
});

test('кривые аргументы — ошибка, файлы не тронуты', () => {
  const c = copy();
  try {
    const before = { html: c.read('index.html'), js: c.read('strings.js') };
    for (const [args, re] of [
      [[], /хотя бы одна версия/],
      [['--desktop', '0.6', '--win-bytes', '1', '--mac-bytes', '1'], /не X\.Y\.Z/],
      [['--desktop', '0.6.0', '--win-bytes', '1'], /--mac-bytes/],
      [['--mobile', '1.4.0'], /--apk-bytes/],
      [['--apk-bytes', '5'], /хотя бы одна версия/],
      [['--desktop', '0.6.0', '--win-bytes', '1', '--mac-bytes', '1', '--apk-bytes', '5'], /только вместе с --mobile/],
      [['--mobile', '1.4.0', '--apk-bytes', '-5'], /не целое число байт/],
      [['--mobile', '1.4.0', '--apk-bytes', '5', '--colour', 'red'], /неизвестный аргумент/],
      [['--mobile', '1.4.0', '--apk-bytes', '5', '--public-url', 'not a url'], /не адрес/],
    ]) {
      const r = run(['--root', c.dir, ...args]);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, re, args.join(' '));
    }
    assert.equal(c.read('index.html'), before.html);
    assert.equal(c.read('strings.js'), before.js);
  } finally {
    c.done();
  }
});

test('разметка не та, что ждали, — ошибка, а не тихая правка не того', () => {
  const html = fs.readFileSync(path.join(ROOT, 'landing', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'landing', 'strings.js'), 'utf8');
  const opts = parseArgs(['--mobile', '1.4.0', '--apk-bytes', '5']);
  const block = html.match(/<div class="platform-meta">[^\n]*home\.android_size[\s\S]*?<\/a>/)[0];
  assert.throws(() => render({ html: html.replace(block, `${block}\n${block}`), js }, opts), /найдена 2 раз/);
  assert.throws(() => render({ html: html.replace(block, ''), js }, opts), /найдена 0 раз/);
  assert.throws(() => render({ html, js: js.replace(/'home\.android_size'/g, "'home.other'") }, opts), /нет ключа home\.android_size/);
});

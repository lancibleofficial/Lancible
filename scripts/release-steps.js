#!/usr/bin/env node
// Шаги выпуска кнопкой (.github/workflows/publish.yml), которые проще и
// надёжнее проверить тестом, чем держать строчками bash в YAML. Каждый режим —
// отдельный вызов; строки вида ключ=значение идут в stdout (их workflow
// дописывает в $GITHUB_OUTPUT), пояснения — в stderr.
//
//   versions --desktop X.Y.Z --mobile X.Y.Z [--write] [--root <папка>]
//       Проверить версии: формат X.Y.Z, хотя бы одна, каждая новее той, что
//       сейчас в package.json / mobile/app.json. С --write — поднять их так же,
//       как это делалось руками одним коммитом: package.json и оба поля version
//       в package-lock.json; mobile/app.json — version и android.versionCode +1.
//       Остальное в файлах не трогается (сверяется разбором до и после).
//   sizes <папка артефактов>
//       Размеры установщиков из latest.yml (.exe) и latest-mac.yml (.dmg),
//       которые собрал electron-builder: win_bytes=…, mac_bytes=….
//   verify --public-url <R2> [--feed-url <бакет releases>] [--desktop X.Y.Z
//          --win-bytes N --mac-bytes N] [--mobile X.Y.Z --apk-bytes N]
//       Проверка после сборок, до latest.json и лендинга: фид десктопа в
//       Supabase называет новую версию, все его ссылки ведут в R2/v<версия>/ и
//       отвечают на HEAD 200 ровно своего размера (как --check-urls у
//       publish-release.js), установщики для кнопок — того размера, что собрали;
//       APK отвечает 200 и того размера, что собрал EAS.
//   latest-json <файл> --mobile X.Y.Z --public-url <R2> --apk-bytes N
//       Заменить блок "android" в latest.json репозитория lancible-updates
//       (раньше — руками по блоку из лога mobile-release.yml). Остальные блоки
//       ("ios") не трогаются. Повтор с теми же числами — «ничего не поменялось».
//   summary
//       Итог запуска для страницы выполнения: таблица работ из NEEDS
//       (toJSON(needs)) и версий из DESKTOP / MOBILE.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { githubAssetName, manifestFiles, checkUrls, mobileRelease } = require('./publish-release.js');

const VERSION = /^\d+\.\d+\.\d+$/;
const FEED_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co/storage/v1/object/public/releases';

/** a > b для X.Y.Z. */
function newer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// --- версии --------------------------------------------------------------------

/** Заменить ровно одно вхождение, иначе — ошибка с понятным именем файла. */
function replaceOnce(text, re, to, what) {
  const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  if (!hits || hits.length !== 1) throw new Error(`${what}: ждали одно вхождение, нашли ${hits ? hits.length : 0}`);
  return text.replace(re, to);
}

/** Сверка: после правки в JSON поменялись ровно те поля, что ждали. */
function assertOnly(beforeText, afterText, mutate, what) {
  const expected = JSON.parse(beforeText);
  mutate(expected);
  const got = JSON.parse(afterText);
  if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`${what}: правка задела больше, чем версию`);
}

function bumpPackage(pkgText, lockText, version) {
  const pkg = replaceOnce(pkgText, /^(  "version": ")[^"]+(")/m, `$1${version}$2`, 'package.json');
  assertOnly(pkgText, pkg, (j) => { j.version = version; }, 'package.json');
  // В lock версия корня стоит дважды: наверху и в packages[""].
  let lock = replaceOnce(lockText, /^(  "version": ")[^"]+(")/m, `$1${version}$2`, 'package-lock.json');
  lock = replaceOnce(lock, /("packages": \{\s*"": \{[^{}]*?"version": ")[^"]+(")/, `$1${version}$2`, 'package-lock.json, packages[""]');
  assertOnly(lockText, lock, (j) => { j.version = version; j.packages[''].version = version; }, 'package-lock.json');
  return { pkg, lock };
}

function bumpApp(appText, version) {
  const before = JSON.parse(appText);
  const code = before.expo.android.versionCode;
  if (!Number.isSafeInteger(code)) throw new Error('mobile/app.json: нет expo.android.versionCode');
  let app = replaceOnce(appText, /^(    "version": ")[^"]+(")/m, `$1${version}$2`, 'mobile/app.json, expo.version');
  app = replaceOnce(app, /("versionCode": )\d+/, `$1${code + 1}`, 'mobile/app.json, versionCode');
  assertOnly(appText, app, (j) => { j.expo.version = version; j.expo.android.versionCode = code + 1; }, 'mobile/app.json');
  return { app, versionCode: code + 1 };
}

function versions({ desktop, mobile, write = false, root }) {
  if (!desktop && !mobile) throw new Error('нужна хотя бы одна версия: десктоп и/или телефон');
  const files = {
    pkg: path.join(root, 'package.json'),
    lock: path.join(root, 'package-lock.json'),
    app: path.join(root, 'mobile', 'app.json'),
  };
  const out = { desktop: '', mobile: '', desktop_tag: '', mobile_tag: '' };
  const parts = [];
  const writes = [];
  if (desktop) {
    if (!VERSION.test(desktop)) throw new Error(`версия десктопа «${desktop}» — не X.Y.Z`);
    const pkgText = fs.readFileSync(files.pkg, 'utf8');
    const current = JSON.parse(pkgText).version;
    if (!newer(desktop, current)) throw new Error(`десктоп ${desktop} не новее ${current} из package.json`);
    out.desktop = desktop;
    out.desktop_tag = `v${desktop}`;
    parts.push(`десктоп ${desktop}`);
    if (write) {
      const { pkg, lock } = bumpPackage(pkgText, fs.readFileSync(files.lock, 'utf8'), desktop);
      writes.push([files.pkg, pkg], [files.lock, lock]);
    }
  }
  if (mobile) {
    if (!VERSION.test(mobile)) throw new Error(`версия телефона «${mobile}» — не X.Y.Z`);
    const appText = fs.readFileSync(files.app, 'utf8');
    const { expo } = JSON.parse(appText);
    if (!newer(mobile, expo.version)) throw new Error(`телефон ${mobile} не новее ${expo.version} из mobile/app.json`);
    out.mobile = mobile;
    out.mobile_tag = `mobile-v${mobile}`;
    const { app, versionCode } = bumpApp(appText, mobile);
    parts.push(`телефон ${mobile} (versionCode ${versionCode})`);
    if (write) writes.push([files.app, app]);
  }
  // Пишется только после того, как обе правки собраны без ошибок.
  for (const [file, text] of writes) fs.writeFileSync(file, text);
  out.message = `Версии: ${parts.join(', ')}`;
  return out;
}

// --- размеры установщиков --------------------------------------------------------

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; } else if (entry.name === name) return full;
  }
  return null;
}

function sizeOf(manifestText, ext, what) {
  const hits = manifestFiles(manifestText).filter((f) => f.url.endsWith(ext));
  if (hits.length !== 1 || !Number.isSafeInteger(hits[0].size)) throw new Error(`${what}: ждали один файл ${ext} с размером, нашли ${hits.length}`);
  return hits[0].size;
}

function sizes(dir) {
  const win = findFile(dir, 'latest.yml');
  const mac = findFile(dir, 'latest-mac.yml');
  if (!win || !mac) throw new Error(`в ${dir} нет latest.yml или latest-mac.yml`);
  return {
    win_bytes: sizeOf(fs.readFileSync(win, 'utf8'), '.exe', 'latest.yml'),
    mac_bytes: sizeOf(fs.readFileSync(mac, 'utf8'), '.dmg', 'latest-mac.yml'),
  };
}

// --- проверка после сборок ---------------------------------------------------------

/** Адреса файлов кнопок лендинга — те же, что соберёт release-landing.js. */
function desktopUrls(publicUrl, version) {
  const base = `${publicUrl.replace(/\/+$/, '')}/v${version}`;
  return {
    base,
    exe: `${base}/${githubAssetName(`Lancible Setup ${version}.exe`)}`,
    dmg: `${base}/Lancible-${version}-universal.dmg`,
  };
}

function apkUrl(publicUrl, version) {
  return `${publicUrl.replace(/\/+$/, '')}/${mobileRelease(`mobile-v${version}`).key}`;
}

async function verify(opts, { fetchImpl = fetch, checkOptions = {}, log = (s) => process.stderr.write(`${s}\n`) } = {}) {
  const { desktop, mobile } = opts;
  const publicUrl = opts['public-url'];
  if (!publicUrl) throw new Error('нужен --public-url (R2_PUBLIC_URL)');
  if (!desktop && !mobile) throw new Error('нечего проверять: нет ни --desktop, ни --mobile');
  const check = (files) => checkUrls(files, { fetchImpl, requireLength: true, log: (_, url) => log(`доступен: ${url}`), ...checkOptions });
  const lines = [];
  if (desktop) {
    const feed = (opts['feed-url'] || FEED_URL).replace(/\/+$/, '');
    const want = desktopUrls(publicUrl, desktop);
    const expected = { 'latest.yml': [want.exe, Number(opts['win-bytes'])], 'latest-mac.yml': [want.dmg, Number(opts['mac-bytes'])] };
    for (const [name, [url, size]] of Object.entries(expected)) {
      if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`нет размера установщика для ${name} (--win-bytes / --mac-bytes)`);
      // Запрос с меткой, чтобы CDN бакета не отдал манифест прошлой версии.
      const res = await fetchImpl(`${feed}/${name}?publish=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`фид: ${name} отвечает ${res.status}`);
      const text = await res.text();
      const version = (/^version:[ \t]*(\S+)/m.exec(text) || [])[1];
      if (version !== desktop) throw new Error(`фид: в ${name} версия ${version || '—'}, а выпускали ${desktop}`);
      const files = manifestFiles(text);
      const stray = files.filter((f) => !f.url.startsWith(`${want.base}/`));
      if (!files.length || stray.length) throw new Error(`фид: ${name} ссылается не в R2/v${desktop}/: ${stray.map((f) => f.url).join(', ') || 'файлов нет'}`);
      const button = files.find((f) => f.url === url);
      if (!button) throw new Error(`фид: в ${name} нет файла кнопки ${url}`);
      if (button.size !== size) throw new Error(`фид: ${url} в ${name} размером ${button.size}, а собрали ${size}`);
      await check(files);
      lines.push(`${name}: версия ${desktop}, файлов ${files.length}, все отвечают в R2`);
    }
  }
  if (mobile) {
    const size = Number(opts['apk-bytes']);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('нет размера APK (--apk-bytes)');
    await check([{ url: apkUrl(publicUrl, mobile), size }]);
    lines.push(`APK ${mobile}: отвечает в R2, ${size} байт`);
  }
  return lines;
}

// --- latest.json телефона -----------------------------------------------------------

function latestJson(text, { mobile, publicUrl, apkBytes }) {
  if (!VERSION.test(mobile || '')) throw new Error(`--mobile «${mobile}» — не X.Y.Z`);
  const size = Number(apkBytes);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('нет размера APK (--apk-bytes)');
  if (!publicUrl) throw new Error('нужен --public-url (R2_PUBLIC_URL)');
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('latest.json — не объект');
  const url = apkUrl(publicUrl, mobile);
  // Порядок полей — как в блоке, который печатает publish-release.js --mobile-apk.
  doc.android = { version: mobile, url, apk: url, size };
  const next = `${JSON.stringify(doc, null, 2)}\n`;
  return { text: next, changed: next !== text };
}

// --- итог запуска ---------------------------------------------------------------------

const JOB_NAMES = {
  plan: 'Входы и ключи',
  tests: 'Тесты (Linux, CI)',
  'tests-windows': 'Тесты (Windows, со снимками)',
  versions: 'Версии и теги в main',
  desktop: 'Сборка десктопа',
  mobile: 'Сборка телефона',
  verify: 'Проверка файлов и манифестов',
  updates: 'latest.json телефона',
  landing: 'Кнопки лендинга',
};
const RESULT = { success: 'готово', failure: 'упало', cancelled: 'отменено', skipped: 'пропущено' };

function summary(needs, { desktop, mobile }) {
  const rows = Object.entries(JOB_NAMES).map(([id, name]) => {
    const result = needs[id] ? needs[id].result : 'skipped';
    return `| ${name} | ${RESULT[result] || result} |`;
  });
  const failed = Object.values(needs).some((j) => j.result === 'failure' || j.result === 'cancelled');
  const published = needs.versions && needs.versions.result === 'success';
  const what = [desktop && `десктоп ${desktop}`, mobile && `телефон ${mobile}`].filter(Boolean).join(', ') || '—';
  const verdict = !failed
    ? `Выпуск ${what} завершён.`
    : published
      ? `Выпуск ${what} начат, но не дошёл до конца: версии и теги уже в main — смотри упавшую работу и перезапусти её (Re-run failed jobs).`
      : `Выпуск ${what} остановлен до публикации: версии, теги и файлы не тронуты.`;
  return { failed, text: ['## Выпуск', '', verdict, '', '| Шаг | Итог |', '|---|---|', ...rows, ''].join('\n') };
}

// --- CLI ---------------------------------------------------------------------------------

function parseFlags(argv, known, flags = []) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const name = a.slice(2);
    if (flags.includes(name)) { opts[name] = true; continue; }
    if (!known.includes(name)) throw new Error(`неизвестный аргумент ${a}`);
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) throw new Error(`${a} указан без значения`);
    opts[name] = v;
    i++;
  }
  return opts;
}

const kv = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');

function appendSummary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

async function main(argv) {
  const [mode, ...rest] = argv;
  const root = path.join(__dirname, '..');
  if (mode === 'versions') {
    const o = parseFlags(rest, ['desktop', 'mobile', 'root'], ['write']);
    const out = versions({ desktop: o.desktop || '', mobile: o.mobile || '', write: !!o.write, root: path.resolve(o.root || root) });
    console.log(kv(out));
    return;
  }
  if (mode === 'sizes') {
    const o = parseFlags(rest, []);
    if (o._.length !== 1) throw new Error('sizes <папка артефактов>');
    console.log(kv(sizes(path.resolve(o._[0]))));
    return;
  }
  if (mode === 'verify') {
    const o = parseFlags(rest, ['desktop', 'mobile', 'public-url', 'feed-url', 'win-bytes', 'mac-bytes', 'apk-bytes']);
    for (const k of ['desktop', 'mobile']) if (o[k] === '') delete o[k];
    const lines = await verify(o);
    for (const l of lines) console.error(l);
    appendSummary(['### Проверка файлов и манифестов', '', ...lines.map((l) => `- ${l}`)].join('\n'));
    return;
  }
  if (mode === 'latest-json') {
    const o = parseFlags(rest, ['mobile', 'public-url', 'apk-bytes']);
    if (o._.length !== 1) throw new Error('latest-json <файл> --mobile X.Y.Z --public-url <R2> --apk-bytes N');
    const file = path.resolve(o._[0]);
    const { text, changed } = latestJson(fs.readFileSync(file, 'utf8'), { mobile: o.mobile, publicUrl: o['public-url'], apkBytes: o['apk-bytes'] });
    if (changed) fs.writeFileSync(file, text);
    console.error(changed ? `latest.json: android → ${o.mobile}` : 'latest.json: ничего не поменялось');
    console.log(kv({ changed }));
    return;
  }
  if (mode === 'summary') {
    const needs = JSON.parse(process.env.NEEDS || '{}');
    const { text } = summary(needs, { desktop: process.env.DESKTOP || '', mobile: process.env.MOBILE || '' });
    appendSummary(text);
    console.error(text);
    return;
  }
  throw new Error('режим: versions | sizes | verify | latest-json | summary (см. шапку файла)');
}

module.exports = { newer, bumpPackage, bumpApp, versions, sizes, desktopUrls, apkUrl, verify, latestJson, summary, JOB_NAMES, FEED_URL };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`release-steps: ${err.message}`);
    process.exit(1);
  });
}

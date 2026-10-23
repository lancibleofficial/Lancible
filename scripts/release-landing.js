#!/usr/bin/env node
// Кнопки скачивания на лендинге после выпуска: версия над кнопкой, адрес файла
// в Cloudflare R2 и подпись с размером.
//
//   node scripts/release-landing.js --desktop 0.5.2 --win-bytes 83385271 --mac-bytes 184177856
//   node scripts/release-landing.js --mobile 1.3.2 --apk-bytes 104878534
//   (обе платформы — одним вызовом; --public-url <R2_PUBLIC_URL> — сменить адрес
//   бакета, иначе берётся тот, что уже стоит в кнопке; --root <папка> — где
//   лежит landing/, по умолчанию корень репозитория)
//
// Раньше это правили руками при каждом выкате: landing/index.html (версия,
// ссылка и запасная подпись размера — её видно до того, как подгрузится
// словарь) и landing/strings.js (подпись размера на четырёх языках). Теперь
// это последний шаг .github/workflows/publish.yml — после того, как файлы в R2
// проверены запросом HEAD и манифесты обновлены, чтобы кнопка не указала в
// пустоту.
//
// Размер — в МиБ (байты / 1048576), округлённый до целого: так подписи
// считались и руками (0.5.1: 83 385 271 Б → «~80 МБ», 184 177 856 Б → «~176 МБ»,
// APK 104 878 534 Б → «~100 МБ»). Единица у каждого языка своя (МБ, MB) и
// остаётся как есть: меняется только число.
//
// Повторный вызов с теми же числами ничего не меняет и выходит с нулём.
// Разметка не та, что ждали (карточка не нашлась или нашлась дважды), —
// ошибка и ни один файл не тронут.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { githubAssetName, mobileRelease } = require('./publish-release.js');

const MIB = 1048576;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Целые МиБ, как в подписях: 83385271 → 80. */
function mib(bytes) {
  const n = Number(bytes);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`размер «${bytes}» — не целое число байт больше нуля`);
  return Math.round(n / MIB);
}

/** Карточки лендинга: ключ подписи размера и куда ведёт кнопка. */
const CARDS = {
  win: { key: 'home.win_size', tag: (v) => `v${v}`, file: (v) => githubAssetName(`Lancible Setup ${v}.exe`) },
  mac: { key: 'home.mac_size', tag: (v) => `v${v}`, file: (v) => `Lancible-${v}-universal.dmg` },
  apk: { key: 'home.android_size', tag: (v) => `mobile-v${v}`, file: (v) => mobileRelease(`mobile-v${v}`).apkName },
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «~80 МБ» → «~N МБ»: число меняется, тильда и единица языка остаются. */
function relabel(label, size) {
  const m = /^(\s*~?\s*)\d+(?:[.,]\d+)?(\s*\S.*)$/.exec(label);
  if (!m) throw new Error(`подпись размера «${label}» не похожа на «~80 МБ»`);
  return `${m[1]}${size}${m[2]}`;
}

/**
 * Одна карточка в index.html: версия над кнопкой, запасная подпись размера и
 * ссылка. Адрес бакета — publicUrl или тот, что уже стоит в кнопке.
 */
function updateCard(html, card, { version, size, publicUrl }) {
  const re = new RegExp(
    '(<div class="platform-meta"><span>v)(\\d+\\.\\d+\\.\\d+)(</span><span class="dot"></span><span data-i18n="'
    + escape(card.key) + '">)([^<]*)(</span></div>\\s*<a class="platform-cta" href=")([^"]+)(")',
    'g',
  );
  const found = [...html.matchAll(re)];
  if (found.length !== 1) throw new Error(`landing/index.html: карточка ${card.key} найдена ${found.length} раз, ждали один`);
  const [, , , , label, , href] = found[0];
  let base = publicUrl ? publicUrl.replace(/\/+$/, '') : null;
  if (!base) {
    const m = /^(https?:\/\/.+?)\/(?:mobile-)?v\d+\.\d+\.\d+\/[^/]+$/.exec(href);
    if (!m) throw new Error(`landing/index.html: в ссылке ${href} нет <тег>/<файл> — укажи --public-url`);
    base = m[1];
  }
  const url = `${base}/${card.tag(version)}/${card.file(version)}`;
  return html.replace(re, (all, a, _v, b, _label, c, _href, d) => `${a}${version}${b}${relabel(label, size)}${c}${url}${d}`);
}

/** Подпись размера во всех языках strings.js. Возвращает текст и число замен. */
function updateStrings(js, key, size) {
  const re = new RegExp(`('${escape(key)}'\\s*:\\s*')([^']*)(')`, 'g');
  let count = 0;
  const text = js.replace(re, (all, a, label, b) => { count++; return `${a}${relabel(label, size)}${b}`; });
  if (!count) throw new Error(`landing/strings.js: нет ключа ${key}`);
  return { text, count };
}

/** Разбор аргументов: что выпущено и какого размера. Ошибка — исключение. */
function parseArgs(argv) {
  const known = ['--desktop', '--mobile', '--win-bytes', '--mac-bytes', '--apk-bytes', '--public-url', '--root'];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!known.includes(name)) throw new Error(`неизвестный аргумент ${name}`);
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${name} указан без значения`);
    opts[name.slice(2)] = value;
    i++;
  }
  // Пустое значение — «эта платформа не выпускалась»: так его передаёт publish.yml.
  for (const k of Object.keys(opts)) if (opts[k] === '') delete opts[k];
  const { desktop, mobile } = opts;
  if (!desktop && !mobile) throw new Error('нужна хотя бы одна версия: --desktop X.Y.Z и/или --mobile X.Y.Z');
  for (const [k, v] of [['desktop', desktop], ['mobile', mobile]]) {
    if (v && !VERSION.test(v)) throw new Error(`--${k} «${v}» — не X.Y.Z`);
  }
  if (desktop && (!opts['win-bytes'] || !opts['mac-bytes'])) throw new Error('к --desktop нужны --win-bytes и --mac-bytes');
  if (mobile && !opts['apk-bytes']) throw new Error('к --mobile нужен --apk-bytes');
  if (!desktop && (opts['win-bytes'] || opts['mac-bytes'])) throw new Error('--win-bytes и --mac-bytes — только вместе с --desktop');
  if (!mobile && opts['apk-bytes']) throw new Error('--apk-bytes — только вместе с --mobile');
  if (opts['public-url'] && !/^https?:\/\/\S+$/.test(opts['public-url'])) throw new Error(`--public-url «${opts['public-url']}» — не адрес`);
  return opts;
}

/** Новый текст обоих файлов. Ничего не пишет. */
function render({ html, js }, opts) {
  const publicUrl = opts['public-url'];
  const jobs = [];
  if (opts.desktop) {
    jobs.push(['win', opts.desktop, mib(opts['win-bytes'])], ['mac', opts.desktop, mib(opts['mac-bytes'])]);
  }
  if (opts.mobile) jobs.push(['apk', opts.mobile, mib(opts['apk-bytes'])]);
  const notes = [];
  for (const [id, version, size] of jobs) {
    const card = CARDS[id];
    html = updateCard(html, card, { version, size, publicUrl });
    const r = updateStrings(js, card.key, size);
    js = r.text;
    notes.push(`${card.key}: v${version}, ~${size} (языков: ${r.count})`);
  }
  return { html, js, notes };
}

function run(argv, { log = console.log } = {}) {
  const opts = parseArgs(argv);
  const root = path.resolve(opts.root || path.join(__dirname, '..'));
  const files = { html: path.join(root, 'landing', 'index.html'), js: path.join(root, 'landing', 'strings.js') };
  const before = { html: fs.readFileSync(files.html, 'utf8'), js: fs.readFileSync(files.js, 'utf8') };
  const after = render(before, opts);
  const changed = ['html', 'js'].filter((k) => after[k] !== before[k]);
  for (const k of changed) fs.writeFileSync(files[k], after[k]);
  for (const note of after.notes) log(note);
  log(changed.length
    ? `изменены: ${changed.map((k) => path.relative(root, files[k]).replace(/\\/g, '/')).join(', ')}`
    : 'ничего не поменялось');
  return { changed: changed.map((k) => files[k]) };
}

module.exports = { mib, relabel, updateCard, updateStrings, parseArgs, render, run, CARDS };

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (err) {
    console.error(`release-landing: ${err.message}`);
    process.exit(1);
  }
}

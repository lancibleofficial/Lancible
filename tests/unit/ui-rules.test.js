// Правила оформления, записанные в коде. Запуск: npm run test:unit
//
// В CLAUDE.md есть список частных случаев, на которых уже обжигались:
// выпадающие списки — только свой стиль, никаких системных <select>; модалки
// центруются общим механизмом, а не отдельными правилами. Пока это только
// слова в файле, их приходится помнить. Здесь они становятся проверками,
// которые гоняются в крюке перед каждым коммитом.
//
// Почему без браузера. Оба правила видны в исходниках: системный <select> —
// это тег в разметке или createElement в коде, а «общий механизм» — один
// селектор в styles.css, в котором перечислены все подложки. Браузер тут
// ничего не добавит, а секунда в крюке дорога.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules, declarations } = require('../css');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const WEB = path.join(__dirname, '..', '..', 'web');

const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
const webHtml = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(RENDERER, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');

/** Код без комментариев: нас интересует, что исполняется, а не что написано
 *  рядом. В комментариях <select> как раз упоминается — и правильно. */
const code = js
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/^\s*(\/\/|\*).*$/, ''))
  .join('\n');

// --- выпадающие списки ------------------------------------------------------

test('системных <select> нет ни в разметке, ни в коде', () => {
  // Системный список нельзя оформить: он рисуется операционной системой, и в
  // тёмной теме приложение получает светлое окно Windows. Свой стиль —
  // .ctx-menu, он один на все случаи.
  const places = [
    ['src/renderer/index.html', html],
    ['web/index.html', webHtml],
    ['src/renderer/app.js', code],
  ];
  const found = [];
  for (const [name, text] of places) {
    for (const m of text.matchAll(/<select\b|createElement\(\s*['"]select['"]/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push(`${name}:${line}`);
    }
  }
  assert.deepEqual(found, [], 'системный <select> — только .ctx-menu');
});

// --- модалки ----------------------------------------------------------------

/** Подложки модалок: <div id="что-то-backdrop">. */
const backdrops = [...new Set(
  [...html.matchAll(/id="([a-z0-9-]*backdrop)"/gi)].map((m) => m[1]),
)].sort();

const rules = cssRules(css);

test('подложки модалок вообще нашлись', () => {
  // Если разметку перепишут и подложки станут называться иначе, тесты ниже
  // станут проверять пустоту и останутся зелёными. Эта проверка — замок.
  assert.ok(backdrops.length >= 8, `подложек найдено ${backdrops.length}`);
});

test('все модалки центруются одним общим правилом', () => {
  // «Общий механизм» — это один селектор, в котором перечислены все подложки.
  // Он задаёт position/inset/display, остальное каждая модалка добавляет
  // себе сама.
  const centring = rules.filter((r) => {
    const d = declarations(r.body);
    return !r.at && d.position === 'fixed' && r.sel.includes('backdrop');
  });
  assert.equal(centring.length, 1,
    `правил, раскладывающих подложки, должно быть одно, найдено ${centring.length}:\n`
    + centring.map((r) => `  ${r.sel}`).join('\n'));

  const listed = new Set(
    centring[0].sel.split(',').map((s) => s.trim().replace(/^#/, '')),
  );
  const missing = backdrops.filter((id) => !listed.has(id));
  assert.deepEqual(missing, [],
    'подложки, которые не попали в общее правило — они встанут не по центру');
});

test('ни одна модалка не раскладывает себя сама', () => {
  // Своё правило положения у отдельной подложки — ровно тот случай, из-за
  // которого в CLAUDE.md появилась строчка про общий механизм.
  const own = [];
  for (const r of rules) {
    const sels = r.sel.split(',').map((s) => s.trim());
    // Общее правило перечисляет все подложки сразу — оно законное.
    if (sels.length > 1) continue;
    const id = (sels[0].match(/^#([a-z0-9-]*backdrop)$/i) || [])[1];
    if (!id) continue;
    const d = declarations(r.body);
    for (const prop of ['position', 'inset', 'top', 'left', 'display', 'place-items', 'align-items']) {
      if (d[prop]) own.push(`${r.at ? `${r.at} ` : ''}#${id} { ${prop}: ${d[prop]} }`);
    }
  }
  assert.deepEqual(own, [], 'модалки со своими правилами раскладки');
});

// --- перетаскивание окна ------------------------------------------------------

/** Значение -webkit-app-region у селектора — из правил без @media. */
function appRegionOf(selector) {
  const values = rules
    .filter((r) => !r.at && r.sel.split(',').map((s) => s.trim()).includes(selector))
    .map((r) => declarations(r.body)['-webkit-app-region'])
    .filter(Boolean);
  return values[values.length - 1];
}

test('слои поверх шапки — no-drag: зона перетаскивания под ними мышь не отдаёт', () => {
  // #titlebar — drag, и Chromium собирает зону из разметки, а не из того, что
  // видно: полноэкранный редактор, лёгший на шапку, оставляет под собой живую
  // зону окна. В Electron на Windows она перехватывает настоящие щелчки по
  // кнопкам панели (программный .click() при этом проходит и ничего не
  // замечает). Значение в настоящем окне меряет scripts/smoke.js; здесь —
  // что оно записано в стилях за каждым слоем, который может лечь на шапку.
  assert.equal(appRegionOf('#titlebar'), 'drag', 'шапка тянет окно');
  const layers = ['.led.led-fullscreen', '.ctx-menu', '#notif-panel', '.tag-pop', '.tp-pop', '.dp-pop', '.color-pop', '.modal'];
  const wrong = layers.filter((sel) => appRegionOf(sel) !== 'no-drag');
  assert.deepEqual(wrong, [], 'слои без no-drag: щелчок по ним уйдёт окну, если они лягут на шапку');
});

test('drag есть только у частей шапки', () => {
  // Новая зона перетаскивания где-то ещё превратила бы кусок страницы в
  // «заголовок окна», на котором ничего не нажимается.
  const header = new Set(['#titlebar', 'body.platform-mac .tb-nav-strip', '.tb-logo']);
  const found = rules
    .filter((r) => declarations(r.body)['-webkit-app-region'] === 'drag')
    .flatMap((r) => r.sel.split(',').map((s) => s.trim()))
    .filter((sel) => !header.has(sel));
  assert.deepEqual(found, [], 'drag вне шапки');
});

// --- данные в атрибутах разметки ---------------------------------------------

test('данные в style="…" разметки — только через escapeHtml', () => {
  // Цвет проекта, тега и статуса приходит из облака, а пишет его любое
  // устройство аккаунта. Подставленный в атрибут как есть, он закрывает
  // кавычку и вставляет свою разметку. Без escapeHtml допустимы только числа.
  const NUMERIC = /^(pct|r\.total \? Math\.round\(.*\) : 0)$/;
  const raw = [];
  for (const [, attr] of code.matchAll(/style="([^"]*)"/g)) {
    for (const [, expr] of attr.matchAll(/\$\{([^}]*)\}/g)) {
      if (!expr.startsWith('escapeHtml(') && !NUMERIC.test(expr)) raw.push(expr);
    }
  }
  assert.deepEqual(raw, [], 'подстановки в style="…" без escapeHtml');
});

test('чужой цвет проекта не вставляет разметку в точку проекта', () => {
  const { escapeHtml } = require('../../src/renderer/core/format.js');
  const m = code.match(/const projHtml = (`[^`]*`);/);
  assert.ok(m, 'в app.js нет точки проекта (renderNowIsland)');
  const hostile = { color: '"><img src=x onerror="alert(1)"><i x="', name: 'P' };
  const out = new Function('p', 'PALETTE', 'escapeHtml', `return ${m[1]};`)(hostile, ['#000'], escapeHtml);
  assert.doesNotMatch(out, /<img/, 'цвет закрыл атрибут и вставил тег');
  assert.equal(out.match(/</g).length, 2, 'только своя точка: <i …></i>');
});

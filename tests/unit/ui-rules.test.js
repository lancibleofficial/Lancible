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

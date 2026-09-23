// Переменные темы. Запуск: npm run test:unit
//
// var(--чего-нет) не ошибка, а тишина: браузер признаёт свойство
// недействительным и откатывает его к начальному значению. Для цвета это
// почти незаметно (текст наследует цвет родителя), а для границы —
// border-style: none, то есть линии нет совсем.
//
// Так и вышло с сеткой календаря: .ag-line, .ag-col и .ag-allday-cell
// рисовали границы цветом --border-soft, которого в палитре не было, и
// сетка не появлялась ни в одной теме. Заодно --text-faint молча
// превращался в обычный цвет текста в двадцати пяти местах.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/** Токены, объявленные в самом CSS. */
const declared = new Set();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);

/** Токены, которые ставит на элемент код: style.setProperty и style="--x:…". */
const fromJs = new Set();
for (const m of js.matchAll(/setProperty\(\s*'(--[a-z0-9-]+)'/g)) fromJs.add(m[1]);
for (const m of js.matchAll(/style="(--[a-z0-9-]+):/g)) fromJs.add(m[1]);

test('палитра не пустая', () => {
  assert.ok(declared.size >= 25, `объявлено токенов: ${declared.size}`);
});

test('каждый var(--x) без запасного значения где-то объявлен', () => {
  const missing = new Map();
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
    if (m[2] !== ')') continue; // var(--x, запасное) переживёт отсутствие токена
    const name = m[1];
    if (declared.has(name) || fromJs.has(name)) continue;
    missing.set(name, (missing.get(name) || 0) + 1);
  }
  const lines = [...missing].map(([n, c]) => `${n} — ${c} раз`);
  assert.deepEqual(lines, [], `используются, но нигде не объявлены:\n  ${lines.join('\n  ')}`);
});

test('светлая тема переопределяет ровно то же, что объявляет тёмная', () => {
  // Два блока светлой темы (медиазапрос и data-theme) должны совпадать между
  // собой, иначе явный выбор темы и системная разойдутся — а разницу видно
  // только на чужой машине.
  const names = (block) => [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
  const grab = (head) => {
    const at = css.indexOf(head);
    assert.notEqual(at, -1, `блок не найден: ${head}`);
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('\n}', open));
  };
  const media = names(grab(':root:not([data-theme="dark"]):not([data-theme="light"])'));
  const explicit = names(grab(':root[data-theme="light"]'));
  assert.deepEqual(media, explicit, 'блоки светлой темы разошлись');
});

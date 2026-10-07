// Контраст текста на подложках в палитре десктопа и веба. Запуск: npm run test:unit
//
// Страница /architecture обещает: «контраст каждой ступени текста на каждой
// поверхности считает тест — не ниже 4.5:1». До 7 октября 2026 обещание
// держалось на одном разовом замере в консоли; теперь — здесь. Считается по
// WCAG 2 для каждой пары «текст × подложка», которая встречается на экране:
// три ступени текста, зелёный, ссылка и опасный — на фоне, панели и поле.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'styles.css'), 'utf8');

/** Токены одного блока палитры: { '--bg': '#141518', ... }. Только hex. */
function tokens(head) {
  const at = css.indexOf(head);
  assert.notEqual(at, -1, `блок не найден: ${head}`);
  const open = css.indexOf('{', at);
  const body = css.slice(open, css.indexOf('\n}', open));
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Что на чём лежит. Фон — земля под всем; панель — карточка, список, окно;
// поле — кнопка даты, чип, строка списка под курсором, подложка сегмента.
const SURFACES = ['--bg', '--panel', '--panel-2', '--board-col', '--board-card'];
const INKS = ['--text', '--text-dim', '--text-faint', '--accent-ink', '--link', '--danger', '--icon'];

const THEMES = {
  'тёмная': ':root {',
  'светлая': ':root[data-theme="light"] {',
};

for (const [name, head] of Object.entries(THEMES)) {
  test(`${name} тема: каждая ступень текста читается на каждой подложке`, () => {
    const t = tokens(head);
    const weak = [];
    for (const ink of INKS) {
      for (const bg of SURFACES) {
        assert.ok(t[ink] && t[bg], `в блоке нет ${ink} или ${bg}`);
        const r = ratio(t[ink], t[bg]);
        if (r < 4.5) weak.push(`${ink} на ${bg}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(weak, [], `ниже 4.5:1:\n  ${weak.join('\n  ')}`);
  });

  test(`${name} тема: надпись на зелёной кнопке читается`, () => {
    const t = tokens(head);
    const r = ratio(t['--accent-text'], t['--accent']);
    assert.ok(r >= 4.5, `--accent-text на --accent: ${r.toFixed(2)}`);
  });

  test(`${name} тема: предметы отделены от земли, а не только линией`, () => {
    // Карточка на фоне и столбец доски на фоне должны различаться хотя бы
    // чуть-чуть: первая светлая тема была белой целиком, и всё держалось
    // на рамке толщиной в пиксель.
    const t = tokens(head);
    for (const [a, b] of [['--panel', '--bg'], ['--board-col', '--bg'], ['--board-card', '--board-col'], ['--panel-2', '--panel']]) {
      assert.notEqual(t[a], t[b], `${a} и ${b} — один цвет`);
    }
  });
}

test('блоки светлой темы дают одинаковые токены', () => {
  // css-tokens.test.js сверяет имена; здесь — значения, раз уж они разобраны.
  assert.deepEqual(
    tokens(':root[data-theme="light"] {'),
    tokens('  :root:not([data-theme="dark"]):not([data-theme="light"]) {'),
  );
});

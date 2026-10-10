// Смоук десктопа не виснет и не врёт. Запуск: npm run test:unit
//
// scripts/smoke.js гоняет настоящий Electron — в юнитах его не запустить.
// Но то, из-за чего он до 10 октября 2026 висел вечно, видно по исходнику:
// проверка трогала элемент, которого после редизайна не стало, исключение
// внутри окна никто не ловил, и app.quit() не вызывался. А итог «ok» смотрел
// только на ошибки консоли, так что проверка, вернувшая false, прогон не
// роняла. Здесь сторожим, чтобы эти дыры не вернулись.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'smoke.js'), 'utf8').replace(/\r\n/g, '\n');

test('в окно ходят только через inPage — он ловит ошибку и называет шаг', () => {
  const calls = SRC.match(/executeJavaScript\(/g) || [];
  assert.equal(calls.length, 1, 'executeJavaScript вызывается в обход inPage: ошибка внутри окна потеряется');
  assert.match(SRC, /async function inPage\(win, name, code\)/);
  assert.match(SRC, /__smokeError/, 'inPage не возвращает ошибку страницы наружу');
});

test('элементы, с которыми что-то делают, берутся через need — пропавший называется селектором', () => {
  // Опасно то, что сразу трогает результат поиска: щелчок, стиль, свойство.
  // Проверки присутствия (!!document.querySelector) безопасны и остаются.
  const risky = [
    ...SRC.matchAll(/document\.(?:querySelector|getElementById)\([^)]*\)\s*\.(?:click|textContent|hidden|value|classList|dispatchEvent|focus)\b/g),
    ...SRC.matchAll(/getComputedStyle\(\s*document\./g),
  ].map((m) => m[0]);
  assert.deepEqual(risky, [], 'эти места повесят прогон, если элемента не станет — замените на need(…)');
  assert.match(SRC, /const need = \(s\) => \{ const e = document\.querySelector\(s\); if \(!e\) throw new Error\('нет элемента ' \+ s\)/);
});

test('у прогона есть сторож времени, и он гасит Electron с кодом 1', () => {
  assert.match(SRC, /const DEADLINE_MS = \d/);
  assert.match(SRC, /setTimeout\(\s*\(\) => fail\(/, 'нет сторожа: зависший прогон не закончится никогда');
  assert.match(SRC, /app\.exit\(result\.ok \? 0 : 1\)/, 'код выхода не зависит от итога');
  assert.match(SRC, /catch \(err\) \{\s*fail\(err\.message\);/, 'исключение в run() не доходит до итога');
});

test('итог «ok» учитывает каждую проверку, а не только ошибки консоли', () => {
  assert.match(SRC, /falseChecks\('probe', probe\)/);
  assert.match(SRC, /falseChecks\('flow', flow\)/);
  assert.match(SRC, /result\.ok = errors\.length === 0 && result\.failed\.length === 0/);
});

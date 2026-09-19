// Форматирование и разбор ввода. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/renderer/core/format.js');

test('fmtClock переводит миллисекунды в ЧЧ:ММ:СС', () => {
  assert.equal(F.fmtClock(0), '00:00:00');
  assert.equal(F.fmtClock(1000), '00:00:01');
  assert.equal(F.fmtClock(3_661_000), '01:01:01');
  assert.equal(F.fmtClock(360_000_000), '100:00:00', 'сотни часов не должны обрезаться');
});

test('fmtClock не показывает отрицательное время', () => {
  // Отрицательная длительность означала бы, что таймер шёл назад: показывать
  // «-00:00:05» бессмысленно, это всегда следствие сбоя часов.
  assert.equal(F.fmtClock(-5000), '00:00:00');
});

test('fmtShort округляет до минут и ставит прочерк на мелочи', () => {
  assert.equal(F.fmtShort(0, 'ru'), '—');
  assert.equal(F.fmtShort(29_000, 'ru'), '—', 'меньше половины минуты — прочерк');
  assert.equal(F.fmtShort(30_000, 'ru'), '1м', 'половина минуты округляется вверх');
  assert.equal(F.fmtShort(3_600_000, 'ru'), '1ч');
  assert.equal(F.fmtShort(5_400_000, 'ru'), '1ч 30м');
});

test('fmtShort знает единицы всех четырёх языков', () => {
  assert.equal(F.fmtShort(3_600_000, 'en'), '1h');
  assert.equal(F.fmtShort(3_600_000, 'uk'), '1г');
  assert.equal(F.fmtShort(3_600_000, 'kk'), '1сағ');
  assert.equal(F.fmtShort(3_600_000, 'несуществующий'), '1ч', 'неизвестный язык откатывается на русский');
});

test('fmtDur вместо прочерка даёт честный ноль', () => {
  // В колонке с числами прочерк читается как «нет данных», а ноль — как ноль.
  assert.equal(F.fmtDur(0, 'ru'), '0м');
  assert.equal(F.fmtDur(3_600_000, 'ru'), '1ч');
});

test('parseNum принимает запятую и пробелы-разделители', () => {
  assert.equal(F.parseNum('1234'), 1234);
  assert.equal(F.parseNum('1 234,5'), 1234.5);
  assert.equal(F.parseNum('1234.5'), 1234.5);
});

test('parseNum превращает мусор и неположительные числа в ноль', () => {
  // Ставка — это деньги: пустой ввод или минус не должны просочиться в расчёт.
  assert.equal(F.parseNum(''), 0);
  assert.equal(F.parseNum('абв'), 0);
  assert.equal(F.parseNum('-100'), 0);
  assert.equal(F.parseNum('0'), 0);
  assert.equal(F.parseNum(null), 0);
  assert.equal(F.parseNum(undefined), 0);
});

test('dayKey берёт местную дату, а не UTC', () => {
  // Смена суток должна совпадать с той, что видит человек за окном.
  const local = new Date(2026, 8, 19, 23, 30);
  assert.equal(F.dayKey(local), '2026-09-19');
  assert.equal(F.dayKey(new Date(2026, 0, 5)), '2026-01-05', 'месяц и день дополняются нулём');
});

test('keyToDate возвращает ключ обратно в дату', () => {
  assert.equal(F.dayKey(F.keyToDate('2026-09-19')), '2026-09-19');
});

test('taskElapsedMs прибавляет идущий таймер и только свой', () => {
  const now = 1_000_000;
  const task = { id: 'a', totalMs: 5000 };
  assert.equal(F.taskElapsedMs(task, null, now), 5000, 'без таймера — только накопленное');

  const mine = { taskId: 'a', startedAt: new Date(now - 2000).toISOString() };
  assert.equal(F.taskElapsedMs(task, mine, now), 7000);

  const other = { taskId: 'b', startedAt: new Date(now - 2000).toISOString() };
  assert.equal(F.taskElapsedMs(task, other, now), 5000, 'чужой таймер задачу не касается');
});

test('escapeHtml закрывает всё, чем можно вырваться из разметки', () => {
  assert.equal(F.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(F.escapeHtml('a & b'), 'a &amp; b');
  assert.equal(F.escapeHtml(`"'`), '&quot;&#39;');
});

test('hoursOf переводит миллисекунды в часы', () => {
  assert.equal(F.hoursOf(3_600_000), 1);
  assert.equal(F.hoursOf(1_800_000), 0.5);
});


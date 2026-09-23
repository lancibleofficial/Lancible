// Повторение задач. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/renderer/core/repeat.js');

const at = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
const show = (ms) => {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('мусор вместо правила — это отсутствие правила, а не поломка', () => {
  assert.equal(R.normalizeRepeat(null), null);
  assert.equal(R.normalizeRepeat('каждый день'), null);
  assert.equal(R.nextDue(null, at(2026, 9, 23)), null);
});

test('неизвестные значения заменяются умолчаниями', () => {
  // Правило приезжает по синхронизации и могло быть записано другой версией.
  const r = R.normalizeRepeat({ freq: 'столетие', every: 0, weekdays: 'пн', from: 'луна', ends: { kind: '?', count: -5 } });
  assert.equal(r.freq, 'week');
  assert.equal(r.every, 1);
  assert.deepEqual(r.weekdays, []);
  assert.equal(r.from, 'schedule');
  assert.equal(r.ends.kind, 'never');
  assert.equal(r.ends.count, 1);
});

test('дни недели чистятся от повторов и сортируются', () => {
  const r = R.normalizeRepeat({ freq: 'week', weekdays: [5, 1, 5, 9, -2] });
  assert.deepEqual(r.weekdays, [0, 1, 5, 6]);
});

test('ежедневно: шаг в днях, время суток сохраняется', () => {
  const rule = { freq: 'day', every: 1 };
  assert.equal(show(R.nextDue(rule, at(2026, 9, 23, 18, 30))), '2026-09-24 18:30');
  assert.equal(show(R.nextDue({ freq: 'day', every: 3 }, at(2026, 9, 23))), '2026-09-26 09:00');
});

test('еженедельно без выбранных дней — просто через неделю', () => {
  assert.equal(show(R.nextDue({ freq: 'week', every: 1 }, at(2026, 9, 23))), '2026-09-30 09:00');
  assert.equal(show(R.nextDue({ freq: 'week', every: 2 }, at(2026, 9, 23))), '2026-10-07 09:00');
});

test('еженедельно по дням недели: берётся ближайший из выбранных', () => {
  // 23 сентября 2026 — среда. Выбраны пн, ср, пт.
  const rule = { freq: 'week', every: 1, weekdays: [1, 3, 5] };
  assert.equal(show(R.nextDue(rule, at(2026, 9, 23))), '2026-09-25 09:00', 'со среды на пятницу');
  assert.equal(show(R.nextDue(rule, at(2026, 9, 25))), '2026-09-28 09:00', 'с пятницы на понедельник');
});

test('еженедельно через неделю: после конца недели прыгаем через интервал', () => {
  // Пятница 25-го, дни пн и пт, каждые 2 недели: следующий — понедельник
  // не через три дня, а через две недели.
  const rule = { freq: 'week', every: 2, weekdays: [1, 5] };
  assert.equal(show(R.nextDue(rule, at(2026, 9, 25))), '2026-10-05 09:00');
  // А внутри той же недели интервал не мешает: со среды на пятницу.
  assert.equal(show(R.nextDue({ freq: 'week', every: 2, weekdays: [3, 5] }, at(2026, 9, 23))), '2026-09-25 09:00');
});

test('ежемесячно по числу: 31-е прижимается к длине месяца', () => {
  // Иначе 31 января + месяц уехало бы на 3 марта, и дальше всё сползало бы.
  const rule = { freq: 'month', every: 1, monthMode: 'day' };
  assert.equal(show(R.nextDue(rule, at(2026, 1, 31))), '2026-02-28 09:00');
  assert.equal(show(R.nextDue(rule, at(2026, 3, 31))), '2026-04-30 09:00');
  assert.equal(show(R.nextDue(rule, at(2026, 9, 15))), '2026-10-15 09:00');
});

test('ежемесячно по дню недели: «третий вторник»', () => {
  // 15 сентября 2026 — третий вторник месяца.
  const rule = { freq: 'month', every: 1, monthMode: 'weekday' };
  assert.equal(R.weekdayOrdinal(at(2026, 9, 15)), 3);
  assert.equal(show(R.nextDue(rule, at(2026, 9, 15))), '2026-10-20 09:00', 'третий вторник октября');
});

test('пятый такой-то день: если его нет, берётся последний', () => {
  // Пропускать месяц значило бы молча потерять повторение.
  const rule = { freq: 'month', every: 1, monthMode: 'weekday' };
  const fifthWed = at(2026, 9, 30); // пятая среда сентября
  assert.equal(R.weekdayOrdinal(fifthWed), 5);
  const next = R.nextDue(rule, fifthWed);
  const d = new Date(next);
  assert.equal(d.getDay(), 3, 'снова среда');
  assert.equal(d.getMonth(), 9, 'октябрь');
  assert.ok(d.getDate() + 7 > 31, `должна быть последняя среда месяца, а не ${show(next)}`);
});

test('ежегодно: 29 февраля прижимается к 28-му в невисокосный год', () => {
  assert.equal(show(R.nextDue({ freq: 'year', every: 1 }, at(2024, 2, 29))), '2025-02-28 09:00');
  assert.equal(show(R.nextDue({ freq: 'year', every: 1 }, at(2026, 9, 23))), '2027-09-23 09:00');
});

test('окончание «после N раз» обрывает серию', () => {
  const rule = { freq: 'day', every: 1, ends: { kind: 'after', count: 3 } };
  assert.ok(R.nextDue({ ...rule, done: 0 }, at(2026, 9, 23)), 'первое повторение есть');
  assert.ok(R.nextDue({ ...rule, done: 1 }, at(2026, 9, 24)), 'второе тоже');
  assert.equal(R.nextDue({ ...rule, done: 2 }, at(2026, 9, 25)), null, 'третьего быть не должно');
  assert.equal(R.repeatFinished({ ...rule, done: 3 }), true);
  assert.equal(R.repeatFinished({ ...rule, done: 1 }), false);
});

test('окончание по дате обрывает серию', () => {
  const rule = { freq: 'day', every: 1, ends: { kind: 'on', at: '2026-09-25' } };
  assert.equal(show(R.nextDue(rule, at(2026, 9, 24))), '2026-09-25 09:00', 'в последний день ещё можно');
  assert.equal(R.nextDue(rule, at(2026, 9, 25)), null, 'за границу не уходим');
});

test('ближайшие сроки вперёд считаются подряд и не выходят за предел', () => {
  const rule = { freq: 'week', every: 1, weekdays: [1] };
  const list = R.upcomingDue(rule, at(2026, 9, 23), at(2026, 10, 20), 30);
  assert.deepEqual(list.map(show), [
    '2026-09-28 09:00', '2026-10-05 09:00', '2026-10-12 09:00', '2026-10-19 09:00',
  ]);
});

test('ближайшие сроки не уходят в бесконечность при большом пределе', () => {
  const rule = { freq: 'day', every: 1 };
  const list = R.upcomingDue(rule, at(2026, 9, 23), at(2030, 1, 1), 5);
  assert.equal(list.length, 5, 'предохранитель держит');
});

test('ближайшие сроки учитывают конец серии', () => {
  const rule = { freq: 'day', every: 1, ends: { kind: 'after', count: 3 }, done: 0 };
  const list = R.upcomingDue(rule, at(2026, 9, 23), at(2026, 12, 1), 30);
  assert.equal(list.length, 2, `серия из трёх, одно уже сделано: ${list.map(show)}`);
});

test('описание правила отдаёт ключ и подстановки, а не готовый текст', () => {
  // Ядро не знает про язык — перевод делает вызывающий.
  assert.deepEqual(R.describeRepeat({ freq: 'day', every: 1 }), { key: 'repeat.desc_day', vars: { n: 1 } });
  assert.deepEqual(R.describeRepeat({ freq: 'month', every: 3 }), { key: 'repeat.desc_month_n', vars: { n: 3 } });
  const wk = R.describeRepeat({ freq: 'week', every: 1, weekdays: [1, 3] });
  assert.equal(wk.key, 'repeat.desc_week_days');
  assert.deepEqual(wk.vars.days, [1, 3]);
  assert.equal(R.describeRepeat(null), null);
});

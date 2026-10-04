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

// --- Перекат закрытой задачи ------------------------------------------------
// До выноса в ядро это были две реализации, и они разошлись по четырём местам:
// телефон сравнивал from с несуществующим 'completion', не догонял просроченный
// срок, увеличивал счётчик до расчёта следующей даты и проверял конец серии
// после увеличения, а не до. Поэтому тут проверяется каждое из четырёх.

const DAY = 86400000;
const AT = (iso) => new Date(iso).getTime();

test('от срока: следующий срок считается от прежнего, а не от дня закрытия', () => {
  const rule = R.normalizeRepeat({ freq: 'day', every: 1, from: 'schedule' });
  const plan = R.planRepeatRoll(rule, '2026-06-10T09:00:00Z', AT('2026-06-10T20:00:00Z'));
  assert.equal(new Date(plan.nextDue).toISOString(), '2026-06-11T09:00:00.000Z');
});

test('от дня закрытия: отсчёт идёт от «сейчас»', () => {
  // Значение ровно одно — 'done'. Сравнение с чем-то другим молча превращает
  // этот режим в обычный отсчёт от срока.
  const rule = R.normalizeRepeat({ freq: 'day', every: 1, from: 'done' });
  const plan = R.planRepeatRoll(rule, '2026-06-01T09:00:00Z', AT('2026-06-10T20:00:00Z'));
  assert.ok(plan.nextDue > AT('2026-06-10T20:00:00Z'), 'срок должен уехать вперёд от «сейчас»');
  assert.ok(plan.nextDue - AT('2026-06-10T20:00:00Z') <= DAY, 'и не дальше чем на шаг');
});

test('просроченный срок догоняется до будущего, а не сдвигается на один шаг', () => {
  // Задачу не трогали три недели: один шаг оставил бы срок в прошлом.
  const rule = R.normalizeRepeat({ freq: 'day', every: 1, from: 'schedule' });
  const now = AT('2026-06-30T12:00:00Z');
  const plan = R.planRepeatRoll(rule, '2026-06-10T09:00:00Z', now);
  assert.ok(plan.nextDue > now, 'срок в будущем');
  assert.equal(plan.repeat.done, 1, 'догон не тратит лимит повторений');
});

test('кончившаяся серия не перекатывается вовсе', () => {
  // Серия из двух, обе использованы: repeatFinished обрывает на done >= count.
  const rule = R.normalizeRepeat({ freq: 'day', every: 1, ends: { kind: 'after', count: 2 } });
  const spent = { ...rule, done: 2 };
  assert.equal(R.planRepeatRoll(spent, '2026-06-10T09:00:00Z', AT('2026-06-10T20:00:00Z')), null);
});

test('последнее повторение закрывает серию, а не уезжает вперёд', () => {
  // Одна из двух использована: сам перекат ещё случается, но следующего
  // срока уже нет — nextDue обрывает серию на done + 1 >= count.
  const rule = R.normalizeRepeat({ freq: 'day', every: 1, ends: { kind: 'after', count: 2 } });
  const one = { ...rule, done: 1 };
  const plan = R.planRepeatRoll(one, '2026-06-10T09:00:00Z', AT('2026-06-10T20:00:00Z'));
  assert.equal(plan.finished, true);
  assert.equal(plan.repeat.done, 2, 'счётчик всё равно растёт — серия использована до конца');
  assert.equal(plan.nextDue, undefined);
});

test('без правила и без срока плана нет', () => {
  assert.equal(R.planRepeatRoll(null, '2026-06-10T09:00:00Z', Date.now()), null);
  assert.equal(R.planRepeatRoll(R.normalizeRepeat({ freq: 'day', every: 1 }), null, Date.now()), null);
});

test('keepHistory доезжает до вызывающего', () => {
  const on = R.normalizeRepeat({ freq: 'day', every: 1, keepHistory: true });
  const off = R.normalizeRepeat({ freq: 'day', every: 1 });
  const now = AT('2026-06-10T20:00:00Z');
  assert.equal(R.planRepeatRoll(on, '2026-06-10T09:00:00Z', now).keepHistory, true);
  assert.equal(R.planRepeatRoll(off, '2026-06-10T09:00:00Z', now).keepHistory, false);
});

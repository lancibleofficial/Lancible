// Календарь-расписание. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../src/renderer/core/agenda.js');

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const session = (a, b) => ({ start: iso(a), end: iso(b), ms: b - a });

// 23 сентября 2026 — среда.
const WED = at(2026, 9, 23);

test('неделя начинается с понедельника, какой бы день ни был опорным', () => {
  const r = A.agendaRange('week', WED);
  assert.equal(new Date(r.from).getDay(), 1, 'начало — понедельник');
  assert.equal(r.days, 7);
  assert.equal(r.to - r.from, 7 * A.DAY);
  // Со вторника и с воскресенья той же недели границы те же.
  assert.equal(A.agendaRange('week', at(2026, 9, 22)).from, r.from);
  assert.equal(A.agendaRange('week', at(2026, 9, 27)).from, r.from);
});

test('день и «4 дня» начинаются с опорной даты', () => {
  assert.deepEqual(
    [A.agendaRange('day', WED).days, A.agendaRange('days4', WED).days],
    [1, 4],
  );
  assert.equal(A.agendaRange('days4', WED).from, WED);
});

test('месяц округляется до целых недель — сетка должна быть прямоугольной', () => {
  const r = A.agendaRange('month', WED);
  assert.equal(new Date(r.from).getDay(), 1, 'начинается с понедельника');
  assert.equal(r.days % 7, 0, `дней в сетке ${r.days}, не кратно неделе`);
  assert.ok(r.from <= at(2026, 9, 1), 'первое число внутри отрезка');
  assert.ok(r.to > at(2026, 9, 30), 'последнее число внутри отрезка');
});

test('шаг вперёд и назад возвращает туда же', () => {
  for (const mode of ['day', 'days4', 'week', 'month', 'agenda']) {
    const fwd = A.shiftAnchor(mode, WED, 1);
    const back = A.shiftAnchor(mode, fwd, -1);
    assert.ok(back <= WED && WED < A.shiftAnchor(mode, back, 1), `${mode}: шаг туда-обратно увёл в другой отрезок`);
  }
});

test('запись через полночь показывается куском в каждом дне', () => {
  // Иначе ночная работа целиком приписывалась бы дню, в котором началась.
  const tasks = [{ id: 't1', projectId: 'p1', sessions: [session(at(2026, 9, 23, 23, 0), at(2026, 9, 24, 1, 30))] }];
  const segs = A.sessionSegments(tasks, WED, WED + 2 * A.DAY);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.dayIndex), [0, 1]);
  assert.equal(segs[0].ms, 60 * 60000, 'первый кусок — час до полуночи');
  assert.equal(segs[1].ms, 90 * 60000, 'второй — полтора часа после');
  assert.ok(segs.every((s) => s.crossesDay), 'оба куска помечены как переходящие');
});

test('записи вне отрезка не попадают, края включительно', () => {
  const tasks = [{
    id: 't1',
    projectId: 'p1',
    sessions: [
      session(at(2026, 9, 22, 10), at(2026, 9, 22, 11)), // день до
      session(at(2026, 9, 23, 10), at(2026, 9, 23, 11)), // внутри
      session(at(2026, 9, 24, 10), at(2026, 9, 24, 11)), // день после
    ],
  }];
  const segs = A.sessionSegments(tasks, WED, WED + A.DAY);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].index, 1);
});

test('кривые записи пропускаются, а не роняют сетку', () => {
  const tasks = [{
    id: 't1',
    projectId: 'p1',
    sessions: [
      { start: 'не дата', end: iso(at(2026, 9, 23, 11)), ms: 0 },
      { start: iso(at(2026, 9, 23, 12)), end: iso(at(2026, 9, 23, 11)), ms: 0 }, // конец раньше начала
      { start: iso(at(2026, 9, 23, 14)), end: null, ms: 3600000 },               // идёт сейчас
    ],
  }];
  const segs = A.sessionSegments(tasks, WED, WED + A.DAY);
  assert.equal(segs.length, 1, 'остаётся только та, что без конца, но с длительностью');
  assert.equal(segs[0].index, 2);
});

test('дедлайны отбираются по отрезку и раскладываются по дням', () => {
  const tasks = [
    { id: 't1', projectId: 'p1', dueAt: iso(at(2026, 9, 23, 18)) },
    { id: 't2', projectId: 'p1', dueAt: iso(at(2026, 9, 25, 9)) },
    { id: 't3', projectId: 'p1', dueAt: iso(at(2026, 10, 5, 9)) },
    { id: 't4', projectId: 'p1', dueAt: null },
  ];
  const items = A.deadlineItems(tasks, WED, WED + 7 * A.DAY);
  assert.deepEqual(items.map((d) => d.taskId), ['t1', 't2']);
  assert.deepEqual(items.map((d) => d.dayIndex), [0, 2]);
});

test('непересекающиеся записи занимают всю ширину', () => {
  const ev = [
    { start: at(2026, 9, 23, 9), end: at(2026, 9, 23, 10) },
    { start: at(2026, 9, 23, 11), end: at(2026, 9, 23, 12) },
  ];
  const out = A.layoutOverlaps(ev);
  assert.deepEqual(out.map((e) => e.cols), [1, 1]);
  assert.deepEqual(out.map((e) => e.col), [0, 0]);
});

test('пересекающиеся записи делят ширину и встают рядом', () => {
  const ev = [
    { start: at(2026, 9, 23, 9), end: at(2026, 9, 23, 12) },
    { start: at(2026, 9, 23, 10), end: at(2026, 9, 23, 11) },
    { start: at(2026, 9, 23, 10, 30), end: at(2026, 9, 23, 13) },
  ];
  const out = A.layoutOverlaps(ev);
  assert.deepEqual(out.map((e) => e.cols), [3, 3, 3], 'ширина у группы общая');
  assert.equal(new Set(out.map((e) => e.col)).size, 3, 'каждая в своей колонке');
});

test('освободившаяся колонка переиспользуется', () => {
  // 9–10 и 10–11 не пересекаются, поэтому обе встают в первую колонку,
  // а перекрывающая их 9–11 — во вторую.
  const ev = [
    { start: at(2026, 9, 23, 9), end: at(2026, 9, 23, 10) },
    { start: at(2026, 9, 23, 9), end: at(2026, 9, 23, 11) },
    { start: at(2026, 9, 23, 10), end: at(2026, 9, 23, 11) },
  ];
  const out = A.layoutOverlaps(ev);
  assert.deepEqual(out.map((e) => e.cols), [2, 2, 2]);
  assert.equal(out[0].col, 0);
  assert.equal(out[1].col, 1);
  assert.equal(out[2].col, 0, 'третья возвращается в освободившуюся колонку');
});

test('раскладка не трогает исходный массив', () => {
  const ev = [{ start: 2, end: 3 }, { start: 1, end: 5 }];
  const before = ev.map((e) => e.start);
  A.layoutOverlaps(ev);
  assert.deepEqual(ev.map((e) => e.start), before);
  assert.ok(!('col' in ev[0]), 'исходным объектам колонки не дописываются');
});

test('прилипание округляет к ближайшему шагу', () => {
  const t = at(2026, 9, 23, 10, 7);
  assert.equal(A.snapMinutes(t, 15), at(2026, 9, 23, 10, 0));
  assert.equal(A.snapMinutes(at(2026, 9, 23, 10, 8), 15), at(2026, 9, 23, 10, 15));
  assert.equal(A.snapMinutes(t, 0), t, 'нулевой шаг ничего не меняет');
});

test('запись не выходит за сутки и не схлопывается в ноль', () => {
  // Сутки передаются явно: при перетаскивании начало выезжает за край того
  // дня, в котором тянут, и по нему день определился бы неверно.
  const day = at(2026, 9, 23);
  const a = A.clampSpan(day, day - 3600000, day + 3600000, 15);
  assert.equal(a.start, day, 'начало не раньше полуночи');

  const b = A.clampSpan(day, at(2026, 9, 23, 23, 30), at(2026, 9, 24, 2), 15);
  assert.equal(b.end, day + A.DAY, 'конец не позже конца суток');

  const c = A.clampSpan(day, at(2026, 9, 23, 10), at(2026, 9, 23, 10), 15);
  assert.equal(c.end - c.start, 15 * 60000, 'нулевая длина растягивается до минимума');

  const d = A.clampSpan(day, at(2026, 9, 23, 23, 55), at(2026, 9, 23, 23, 58), 15);
  assert.equal(d.end, day + A.DAY, 'у самого конца суток запись упирается в полночь');
  assert.equal(d.end - d.start, 15 * 60000, 'и всё равно не короче минимума');
});

test('доля суток считается от местной полуночи', () => {
  assert.equal(A.dayFraction(at(2026, 9, 23, 0, 0)), 0);
  assert.equal(A.dayFraction(at(2026, 9, 23, 12, 0)), 0.5);
  assert.ok(Math.abs(A.dayFraction(at(2026, 9, 23, 18, 0)) - 0.75) < 1e-9);
});

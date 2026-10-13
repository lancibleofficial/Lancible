// Лента «Задачи»: Сейчас · Закреплённые · Незакреплённые (src/lib/inbox.js).
// Запуск: npm run test:mobile
import { inboxGroups, inboxGroupOf, matchesDue, statusKindOf, filterInbox, DUE_FILTERS } from '../src/lib/inbox';

const NOW = new Date(2026, 9, 7, 15, 0).getTime(); // ср, 7 октября 2026, 15:00
const at = (daysFromNow, hour = 18) => {
  const d = new Date(2026, 9, 7 + daysFromNow, hour, 0);
  return d.toISOString();
};
const task = (id, over) => ({ id, projectId: 'p1', title: id, done: false, dueAt: null, pinnedAt: null, updatedAt: at(0, 10), ...over });
const ctx = { now: NOW, activeTimer: null };
const idsByKey = (groups) => Object.fromEntries(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]));

test('разделы: идущая, закреплённые, незакреплённые; срочность разделов не делит', () => {
  const tasks = [
    task('run', { dueAt: at(5) }),
    task('pin-overdue', { pinnedAt: at(-1), dueAt: at(-2) }),
    task('pin-nodue', { pinnedAt: at(-1) }),
    task('open-overdue', { dueAt: at(-2) }),
    task('open-today', { dueAt: at(0, 18) }),
    task('open-later', { dueAt: at(40) }),
    task('open-nodue'),
    task('done', { done: true, dueAt: at(0) }),
  ];
  const groups = inboxGroups(tasks, { ...ctx, activeTimer: { taskId: 'run' } });
  expect(groups.map((g) => g.key)).toEqual(['now', 'pinned', 'unpinned']);
  const byKey = idsByKey(groups);
  expect(byKey.now).toEqual(['run']);
  // Закреплённая с просроченным дедлайном — в «Закреплённых», без срока — в конце.
  expect(byKey.pinned).toEqual(['pin-overdue', 'pin-nodue']);
  // Просроченная без закрепления — в «Незакреплённых», вверху; без срока — в конце.
  expect(byKey.unpinned).toEqual(['open-overdue', 'open-today', 'open-later', 'open-nodue']);
  expect(byKey.done).toBeUndefined();
});

test('внутри раздела: дедлайн, при равном дедлайне — свежая правка выше', () => {
  const tasks = [
    task('old', { dueAt: at(1), updatedAt: at(-3, 9) }),
    task('fresh', { dueAt: at(1), updatedAt: at(0, 9) }),
    task('soon', { dueAt: at(0, 20) }),
    task('nodue-old', { updatedAt: at(-3, 9) }),
    task('nodue-fresh', { updatedAt: at(0, 9) }),
    task('broken', { dueAt: 'не дата', updatedAt: at(-9, 9) }),
  ];
  expect(idsByKey(inboxGroups(tasks, ctx)).unpinned)
    .toEqual(['soon', 'fresh', 'old', 'nodue-fresh', 'nodue-old', 'broken']);
});

test('выполненные — отдельный раздел только по просьбе, закрепление их из него не вытаскивает', () => {
  const tasks = [task('a', { done: true }), task('p', { done: true, pinnedAt: at(-1) }), task('b')];
  expect(inboxGroups(tasks, ctx).map((g) => g.key)).toEqual(['unpinned']);
  const withDone = inboxGroups(tasks, { ...ctx, showDone: true });
  expect(withDone.map((g) => g.key)).toEqual(['unpinned', 'done']);
  expect(idsByKey(withDone).done.sort()).toEqual(['a', 'p']);
});

test('пустых разделов нет, порядок фиксированный', () => {
  expect(inboxGroups([task('x', { dueAt: at(1) })], ctx).map((g) => g.key)).toEqual(['unpinned']);
  expect(inboxGroups([task('y', { pinnedAt: at(-1) })], ctx).map((g) => g.key)).toEqual(['pinned']);
  expect(inboxGroups([task('y', { pinnedAt: at(-1) }), task('x')], ctx).map((g) => g.key)).toEqual(['pinned', 'unpinned']);
  expect(inboxGroups([], ctx)).toEqual([]);
});

test('идущая закреплённая задача — в «Сейчас», а не в «Закреплённых»', () => {
  const pinnedRunning = task('r', { pinnedAt: at(-1) });
  expect(inboxGroupOf(pinnedRunning, { ...ctx, activeTimer: { taskId: 'r' } })).toBe('now');
  expect(inboxGroupOf(pinnedRunning, { ...ctx, activeTimer: { taskId: 'other' } })).toBe('pinned');
});

test('выполненные внутри раздела — свежеотмеченные сверху, дедлайн им не важен', () => {
  const tasks = [
    task('old', { done: true, doneAt: at(-3), dueAt: at(-9) }),
    task('fresh', { done: true, doneAt: at(0, 9), dueAt: at(9) }),
    task('nodone-at', { done: true, doneAt: null, updatedAt: at(-1, 9) }),
  ];
  expect(idsByKey(inboxGroups(tasks, { ...ctx, showDone: true })).done).toEqual(['fresh', 'nodone-at', 'old']);
});

// --- фильтры ленты: проекты, срок, вид статуса -----------------------------------
// «Сегодня» и «просрочено» считает ядро (dueState, daysBetween), здесь — что
// лента зовёт его, а не свою арифметику дат.

describe('matchesDue: срок', () => {
  // NOW — среда, 7 октября 2026, 15:00.
  test('«любой» берёт всё, «без дедлайна» — только задачи без срока (нечитаемый срок — тоже без срока)', () => {
    const withDue = task('d', { dueAt: at(2) });
    const broken = task('b', { dueAt: 'не дата' });
    const none = task('n');
    for (const x of [withDue, broken, none]) expect(matchesDue(x, 'any', NOW)).toBe(true);
    expect(matchesDue(withDue, 'none', NOW)).toBe(false);
    expect(matchesDue(broken, 'none', NOW)).toBe(true);
    expect(matchesDue(none, 'none', NOW)).toBe(true);
    expect(DUE_FILTERS).toEqual(['any', 'overdue', 'today', 'week', 'none']);
  });

  test('«просрочено» — срок прошёл и задача не выполнена (так решает ядро)', () => {
    expect(matchesDue(task('a', { dueAt: at(-1) }), 'overdue', NOW)).toBe(true);
    expect(matchesDue(task('a', { dueAt: at(0, 14) }), 'overdue', NOW)).toBe(true); // сегодня, но час назад
    expect(matchesDue(task('a', { dueAt: at(0, 18) }), 'overdue', NOW)).toBe(false);
    expect(matchesDue(task('a', { dueAt: at(-1), done: true }), 'overdue', NOW)).toBe(false);
    expect(matchesDue(task('a'), 'overdue', NOW)).toBe(false);
  });

  test('«сегодня» — календарный день, а не «ближайшие 24 часа»', () => {
    expect(matchesDue(task('a', { dueAt: at(0, 23) }), 'today', NOW)).toBe(true);
    expect(matchesDue(task('a', { dueAt: at(0, 8) }), 'today', NOW)).toBe(true);
    // Через 20 часов, но уже завтра.
    expect(matchesDue(task('a', { dueAt: at(1, 11) }), 'today', NOW)).toBe(false);
    expect(matchesDue(task('a', { dueAt: at(-1, 23) }), 'today', NOW)).toBe(false);
    expect(matchesDue(task('a'), 'today', NOW)).toBe(false);
  });

  test('«на этой неделе» — семь календарных дней, считая сегодня; прошлое и дальше — нет', () => {
    expect(matchesDue(task('a', { dueAt: at(0) }), 'week', NOW)).toBe(true);
    expect(matchesDue(task('a', { dueAt: at(6, 23) }), 'week', NOW)).toBe(true);
    expect(matchesDue(task('a', { dueAt: at(7, 9) }), 'week', NOW)).toBe(false);
    expect(matchesDue(task('a', { dueAt: at(-1) }), 'week', NOW)).toBe(false);
    expect(matchesDue(task('a'), 'week', NOW)).toBe(false);
  });
});

describe('statusKindOf: вид статуса задачи', () => {
  const statuses = [
    { id: 's1', projectId: 'p1', name: 'Backlog', kind: 'backlog', order: 0 },
    { id: 's2', projectId: 'p1', name: 'In progress', kind: 'progress', order: 1 },
    { id: 's3', projectId: 'p1', name: 'Cancelled', kind: 'cancelled', order: 2 },
  ];
  test('берётся из статуса задачи; выполненная — всегда «done»; без статуса — «todo»', () => {
    expect(statusKindOf(task('a', { statusId: 's1' }), statuses)).toBe('backlog');
    expect(statusKindOf(task('a', { statusId: 's3' }), statuses)).toBe('cancelled');
    expect(statusKindOf(task('a', { statusId: 's2', done: true }), statuses)).toBe('done');
    expect(statusKindOf(task('a'), statuses)).toBe('todo');
    expect(statusKindOf(task('a', { statusId: 'нет-такого' }), statuses)).toBe('todo');
  });
});

describe('filterInbox: фильтры сходятся по «и»', () => {
  const statuses = [
    { id: 'a1', projectId: 'p1', name: 'To do', kind: 'todo', order: 0 },
    { id: 'a2', projectId: 'p1', name: 'In progress', kind: 'progress', order: 1 },
    { id: 'b1', projectId: 'p2', name: 'In progress', kind: 'progress', order: 0 },
  ];
  const tasks = [
    task('x1', { statusId: 'a1', dueAt: at(-1) }),
    task('x2', { statusId: 'a2', dueAt: at(0, 18) }),
    task('y1', { projectId: 'p2', statusId: 'b1', dueAt: at(0, 20) }),
    task('y2', { projectId: 'p2', statusId: 'b1', done: true }),
  ];
  const ids = (opts) => filterInbox(tasks, { statuses, now: NOW, ...opts }).map((x) => x.id);

  test('без отбора — всё; пустые наборы значат «без отбора»', () => {
    expect(ids({})).toEqual(['x1', 'x2', 'y1', 'y2']);
    expect(ids({ projectIds: [], due: 'any', kinds: [] })).toEqual(['x1', 'x2', 'y1', 'y2']);
  });

  test('по одному признаку', () => {
    expect(ids({ projectIds: ['p2'] })).toEqual(['y1', 'y2']);
    expect(ids({ projectIds: ['p1', 'p2'] })).toEqual(['x1', 'x2', 'y1', 'y2']);
    expect(ids({ due: 'overdue' })).toEqual(['x1']);
    expect(ids({ due: 'today' })).toEqual(['x2', 'y1']);
    expect(ids({ due: 'none' })).toEqual(['y2']);
    expect(ids({ kinds: ['progress'] })).toEqual(['x2', 'y1']); // y2 выполнена — её вид «done»
    expect(ids({ kinds: ['done'] })).toEqual(['y2']);
    expect(ids({ kinds: ['todo', 'done'] })).toEqual(['x1', 'y2']);
  });

  test('вместе — пересечение', () => {
    expect(ids({ projectIds: ['p1'], due: 'today' })).toEqual(['x2']);
    expect(ids({ projectIds: ['p2'], due: 'today', kinds: ['progress'] })).toEqual(['y1']);
    expect(ids({ projectIds: ['p1'], kinds: ['done'] })).toEqual([]);
  });
});

// --- отменённые: самый низ ленты -------------------------------------------------

const STATUSES = [
  { id: 'sp', projectId: 'p1', name: 'In progress', kind: 'progress', order: 0 },
  { id: 'sd', projectId: 'p1', name: 'Done', kind: 'done', order: 1 },
  { id: 'sc', projectId: 'p1', name: '\u041d\u0435 \u0431\u0443\u0434\u0443', kind: 'cancelled', order: 2 },
];

test('отменённые — раздел после выполненных, самый последний; закреплённость их из него не вытаскивает', () => {
  const tasks = [
    task('c-old', { statusId: 'sc', updatedAt: at(-3, 9) }),
    task('c-pin', { statusId: 'sc', pinnedAt: at(-1), updatedAt: at(-1, 9) }),
    task('d', { statusId: 'sd', done: true }),
    task('open', { statusId: 'sp' }),
    task('pin', { statusId: 'sp', pinnedAt: at(-1) }),
  ];
  const groups = inboxGroups(tasks, { ...ctx, showDone: true, statuses: STATUSES });
  expect(groups.map((g) => g.key)).toEqual(['pinned', 'unpinned', 'done', 'cancelled']);
  // Свежие сверху, срок им не важен.
  expect(idsByKey(groups).cancelled).toEqual(['c-pin', 'c-old']);
});

test('отменённую узнают по виду статуса; без статусов — по флагу задачи', () => {
  const byStatus = task('a', { statusId: 'sc' });
  const byFlag = task('b', { statusId: 'gone', cancelled: true });
  expect(inboxGroupOf(byStatus, { ...ctx, statuses: STATUSES })).toBe('cancelled');
  expect(inboxGroupOf(byFlag, { ...ctx, statuses: STATUSES })).toBe('cancelled');
  expect(inboxGroupOf(byFlag, ctx)).toBe('cancelled');
  // Выполненная отменённой не бывает, а идущая — в «Сейчас».
  expect(inboxGroupOf(task('c', { statusId: 'sd', done: true, cancelled: true }), { ...ctx, statuses: STATUSES })).toBe('done');
  expect(inboxGroupOf(byStatus, { ...ctx, statuses: STATUSES, activeTimer: { taskId: 'a' } })).toBe('now');
});

test('без просьбы показать закрытые отменённых в ленте нет, как и выполненных', () => {
  const tasks = [task('a', { statusId: 'sc' }), task('b', { statusId: 'sp' })];
  expect(inboxGroups(tasks, { ...ctx, statuses: STATUSES }).map((g) => g.key)).toEqual(['unpinned']);
  expect(inboxGroups(tasks, { ...ctx, statuses: STATUSES, showDone: true }).map((g) => g.key)).toEqual(['unpinned', 'cancelled']);
});

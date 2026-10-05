// Что показать в строке задачи. Запуск: npm run test:unit
//
// Решения отрисовки вынесены в ядро (core/views.js, taskRowView) и общие у
// десктопа и телефона. Раньше они жили внутри сборки DOM, и проверить их
// можно было только глазами — так строки на двух платформах и разошлись:
// телефон не показывал ни версию, ни значок повторения.
//
// Снимки с эталоном сторожат пиксели десктопа, но тестовая задача на них —
// без версии, повторения и дедлайна. Эти ветки закрыты здесь.
const test = require('node:test');
const assert = require('node:assert/strict');
const { taskRowView } = require('../../src/renderer/core/views.js');

const NOW = new Date(2026, 5, 10, 12).getTime();
const HOUR = 3_600_000;

const STATUSES = [
  { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
];
const VERSIONS = [
  { id: 'v1', projectId: 'p1', name: 'v1.3', releasedAt: null, order: 0 },
  { id: 'v2', projectId: 'p1', name: '', releasedAt: '2026-06-01T00:00:00.000Z', order: 1 },
];

const ctx = (over = {}) => ({
  statuses: STATUSES,
  versions: VERSIONS,
  selectedId: null,
  activeTimer: null,
  now: NOW,
  lang: 'ru',
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  fmtDateShort: (d) => `дата(${new Date(d).getDate()})`,
  repeatLabel: (rule) => `каждые ${rule.every}`,
  ...over,
});

const base = { id: 't1', projectId: 'p1', title: 'Вёрстка', totalMs: 90 * 60000, sessions: [] };

test('голая задача: только название и время', () => {
  const v = taskRowView(base, ctx());
  assert.equal(v.title, 'Вёрстка');
  assert.equal(v.status, null);
  assert.equal(v.version, null);
  assert.equal(v.repeat, null);
  assert.equal(v.due, null);
  assert.equal(v.running, false);
  assert.equal(typeof v.time, 'string');
  assert.ok(v.time.length > 0, 'время показывается всегда');
});

test('задача без названия получает подпись, а не пустую строку', () => {
  assert.equal(taskRowView({ ...base, title: '' }, ctx()).title, 'task.no_name');
});

test('статус показывается своим именем и цветом', () => {
  const v = taskRowView({ ...base, statusId: 's1' }, ctx());
  assert.deepEqual(v.status, { name: 'В работе', color: '#5ec8f2' });
});

test('ссылка на исчезнувший статус не роняет строку', () => {
  assert.equal(taskRowView({ ...base, statusId: 'нет' }, ctx()).status, null);
});

test('версия: имя и признак выпуска', () => {
  assert.deepEqual(taskRowView({ ...base, versionId: 'v1' }, ctx()).version, { name: 'v1.3', released: false });
  assert.deepEqual(
    taskRowView({ ...base, versionId: 'v2' }, ctx()).version,
    { name: 'task.no_name', released: true },
    'выпущенная версия без имени получает подпись',
  );
  assert.equal(taskRowView({ ...base, versionId: 'нет' }, ctx()).version, null);
});

test('значок повторения — только у задачи с правилом, подпись по желанию платформы', () => {
  const rule = { freq: 'day', every: 2 };
  assert.deepEqual(taskRowView({ ...base, repeat: rule }, ctx()).repeat, { title: 'каждые 2' });
  // У телефона подсказок по наведению нет — подпись ему не нужна, а значок нужен.
  assert.deepEqual(taskRowView({ ...base, repeat: rule }, ctx({ repeatLabel: undefined })).repeat, { title: null });
  assert.equal(taskRowView({ ...base, repeat: 'мусор' }, ctx()).repeat, null, 'мусор вместо правила — это не правило');
});

test('дедлайн: состояние и подпись', () => {
  const overdue = taskRowView({ ...base, dueAt: new Date(NOW - HOUR).toISOString() }, ctx());
  assert.deepEqual(overdue.due, { state: 'overdue', text: 'due.overdue' });
  const soon = taskRowView({ ...base, dueAt: new Date(NOW + 2 * HOUR).toISOString() }, ctx());
  assert.equal(soon.due.state, 'soon');
  assert.equal(soon.due.text, 'due.today');
  assert.equal(taskRowView({ ...base, dueAt: new Date(NOW - HOUR).toISOString(), done: true }, ctx()).due, null,
    'у выполненной задачи дедлайн уже не горит');
});

test('таймер: точка и время с учётом идущей записи', () => {
  const running = { taskId: 't1', startedAt: new Date(NOW - 30 * 60000).toISOString() };
  const idle = taskRowView(base, ctx());
  const live = taskRowView(base, ctx({ activeTimer: running }));
  assert.equal(live.running, true);
  assert.notEqual(live.time, idle.time, 'идущие полчаса прибавлены к времени');
  assert.equal(taskRowView(base, ctx({ activeTimer: { taskId: 'другая', startedAt: new Date(NOW).toISOString() } })).running, false,
    'чужой таймер — не наш');
});

test('выделение, выполнение и закрепление', () => {
  const v = taskRowView({ ...base, done: true, pinnedAt: new Date(NOW).toISOString() }, ctx({ selectedId: 't1' }));
  assert.equal(v.selected, true);
  assert.equal(v.done, true);
  assert.equal(v.pinned, true);
  assert.equal(v.pinTitle, 'task.unpin_short', 'у закреплённой — «открепить»');
  assert.equal(taskRowView(base, ctx()).pinTitle, 'task.pin_short');
});

test('правило не трогает задачу', () => {
  const task = { ...base, statusId: 's1', versionId: 'v1', repeat: { freq: 'day', every: 1 } };
  const before = JSON.stringify(task);
  taskRowView(task, ctx());
  assert.equal(JSON.stringify(task), before);
});

// --- календарь ---------------------------------------------------------------

const { agendaMonthView, agendaTimeView, agendaDays } = require('../../src/renderer/core/views.js');

// Июнь 2026: сетка месяца начинается с понедельника 1 июня и занимает 5 недель.
const JUNE_FROM = new Date(2026, 5, 1).getTime();
const TODAY = new Date(2026, 5, 10, 12).getTime(); // среда, 10-е
const at = (day, h, min = 0) => new Date(2026, 5, day, h, min).getTime();
const ses = (day, h) => ({ start: new Date(at(day, h)).toISOString(), end: new Date(at(day, h) + 1_800_000).toISOString(), ms: 1_800_000 });

const calCtx = (over = {}) => ({
  from: JUNE_FROM,
  days: 35,
  anchor: TODAY,
  now: TODAY,
  t: (key) => key,
  fmtTime: (iso) => new Date(iso).toTimeString().slice(0, 8),
  locale: 'ru-RU',
  projectColor: (id) => (id === 'p1' ? '#87ff65' : '#5ec8f2'),
  ...over,
});

test('месяц: сетка из целых недель, сегодня и дни чужого месяца', () => {
  const v = agendaMonthView([], calCtx());
  assert.equal(v.weeks, 5);
  assert.equal(v.cells.length, 35);
  assert.deepEqual(v.weekdays, ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun']);
  assert.deepEqual(v.cells.filter((c) => c.today).map((c) => c.date), [10]);
  assert.deepEqual(v.cells.filter((c) => c.out).map((c) => c.date), [1, 2, 3, 4, 5], 'хвост — уже июль');
});

test('месяц: в клетку влезают три записи, остальное уходит в «+N»', () => {
  const busy = {
    id: 'b', projectId: 'p1', title: 'Плотный день',
    sessions: [ses(11, 9), ses(11, 11), ses(11, 14), ses(11, 17)],
  };
  const cell = agendaMonthView([busy], calCtx()).cells.find((c) => c.date === 11 && !c.out);
  assert.equal(cell.sessions.length, 3);
  assert.equal(cell.more, 1);
  assert.deepEqual(cell.sessions.map((s) => s.time), ['09:00', '11:00', '14:00'], 'время — часы и минуты, по порядку');
  assert.equal(cell.sessions[0].color, '#87ff65', 'цвет — по проекту');
  const quiet = agendaMonthView([busy], calCtx()).cells.find((c) => c.date === 12 && !c.out);
  assert.equal(quiet.more, 0);
});

test('дедлайны: выполненный, открытый и призраки повторения', () => {
  const tasks = [
    { id: 'd1', projectId: 'p2', title: 'Сдать макет', dueAt: new Date(at(12, 18)).toISOString(), sessions: [] },
    { id: 'd2', projectId: 'p2', title: 'Созвон', done: true, dueAt: new Date(at(9, 10)).toISOString(), sessions: [] },
    { id: 'r', projectId: 'p1', title: 'Отчёт', dueAt: new Date(at(10, 16)).toISOString(), sessions: [],
      repeat: { freq: 'week', every: 1, weekdays: [], from: 'due', ends: { kind: 'never' } } },
  ];
  const cells = agendaMonthView(tasks, calCtx()).cells.filter((c) => !c.out);
  const on = (day) => cells.find((c) => c.date === day).deadlines;
  assert.deepEqual(on(12).map((d) => [d.title, d.done, d.ghost]), [['Сдать макет', false, false]]);
  assert.deepEqual(on(9).map((d) => [d.title, d.done]), [['Созвон', true]]);
  assert.equal(on(10)[0].ghost, false, 'сам срок — не призрак');
  assert.equal(on(17)[0].ghost, true, 'следующий срок повторения — призрак');
  assert.equal(on(24)[0].ghost, true);
});

test('задача без названия подписывается, а не исчезает', () => {
  const tasks = [{ id: 'x', projectId: 'p1', title: '', dueAt: new Date(at(15, 9)).toISOString(), sessions: [] }];
  const cell = agendaMonthView(tasks, calCtx()).cells.find((c) => c.date === 15 && !c.out);
  assert.equal(cell.deadlines[0].title, 'task.no_name');
});

test('часовая сетка: подписи часов, полчасовые линии и день недели', () => {
  const v = agendaTimeView([], calCtx({ from: new Date(2026, 5, 8).getTime(), days: 7 }));
  assert.equal(v.days.length, 7);
  assert.equal(v.hours.length, 24);
  assert.equal(v.hours[0], '', 'полночь без подписи — иначе читалась бы подписью ко всей сетке');
  assert.equal(v.hours[9], '09:00');
  assert.equal(v.lines.length, 47);
  assert.deepEqual(v.lines[0], { top: (1 / 48) * 100, half: true });
  assert.deepEqual(v.lines[1], { top: (2 / 48) * 100, half: false }, 'каждая вторая — часовая');
  assert.deepEqual(v.days.filter((d) => d.today).map((d) => d.date), [10]);
  assert.equal(v.days[0].weekday, new Date(2026, 5, 8).toLocaleDateString('ru-RU', { weekday: 'short' }));
});

test('часовая сетка: призрак помечен ↻, у дедлайна подсказка со временем', () => {
  const tasks = [{
    id: 'r', projectId: 'p1', title: 'Отчёт', dueAt: new Date(at(10, 16)).toISOString(), sessions: [],
    repeat: { freq: 'day', every: 1, weekdays: [], from: 'due', ends: { kind: 'never' } },
  }];
  const v = agendaTimeView(tasks, calCtx({ from: new Date(2026, 5, 8).getTime(), days: 7 }));
  const wed = v.days.find((d) => d.date === 10).deadlines[0];
  const thu = v.days.find((d) => d.date === 11).deadlines[0];
  assert.equal(wed.label, 'Отчёт');
  assert.equal(thu.label, '↻ Отчёт');
  assert.equal(wed.tooltip, 'agenda.deadline · 16:00:00');
});

test('часовая сетка: пересекающиеся записи раскладываются по колонкам', () => {
  const a = { id: 'a', projectId: 'p1', title: 'А', sessions: [ses(10, 10)] };
  const b = { id: 'b', projectId: 'p2', title: 'Б', sessions: [ses(10, 10)] };
  const day = agendaTimeView([a, b], calCtx({ from: new Date(2026, 5, 8).getTime(), days: 7 }))
    .days.find((d) => d.date === 10);
  assert.equal(day.blocks.length, 2);
  assert.deepEqual(day.blocks.map((x) => x.cols), [2, 2], 'обе делят ширину надвое');
  assert.deepEqual(day.blocks.map((x) => x.col).sort(), [0, 1]);
});

test('дни календаря не трогают задачи', () => {
  const tasks = [{ id: 'a', projectId: 'p1', title: 'А', sessions: [ses(10, 10)], dueAt: new Date(at(10, 18)).toISOString() }];
  const before = JSON.stringify(tasks);
  agendaDays(tasks, calCtx());
  assert.equal(JSON.stringify(tasks), before);
});

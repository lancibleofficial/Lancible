// Форма Excel-отчётов. Запуск: npm run test:unit
//
// До выноса в ядро этот код жил в двух копиях — в app.js и в
// mobile/src/lib/xlsxReports.js — и не проверялся ничем: scripts/xlsx-check.js
// смотрит на генератор src/xlsx.js, а не на то, что в файл кладут.
//
// Главное, что здесь стережётся, — адреса в формулах. Итоговая строка ссылается
// на диапазон данных номерами строк, и стоит шапке вырасти на одну строку
// (появилось описание проекта, появилась «Версия»), как SUM начинает считать
// не то. Глазами это не видно: файл открывается, числа просто неверные.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeReports } = require('../../src/renderer/core/reports.js');

// Подписи и форматирование у платформ свои, поэтому здесь они нарочно
// примитивные: тест про форму отчёта, а не про перевод.
const deps = {
  t: (key, params) => (params ? `${key}:${params.cur}` : key),
  cur: '₽',
  fmtClock: (ms) => `clock(${ms})`,
  fmtDate: () => 'DATE',
  fmtTime: () => 'TIME',
  hoursOf: (ms) => ms / 3600000,
  effectiveRate: (task) => task.rate || 100,
  sessionRate: (s) => s.rate || 100,
  sessionMoney: (s) => (s.ms / 3600000) * (s.rate || 100),
};
const R = makeReports(deps);

const HOUR = 3600000;
const ses = (iso, hours, extra) => ({ start: iso, end: iso, ms: hours * HOUR, ...extra });
const task = (title, sessions, extra) => ({
  title,
  sessions,
  totalMs: sessions.reduce((a, s) => a + s.ms, 0),
  ...extra,
});

/** Номер строки и диапазон из формулы SUM(X{a}:X{b}). */
const sumRange = (cell) => {
  const m = String(cell.f).match(/SUM\([A-Z](\d+):[A-Z](\d+)\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

test('лист задачи: шапка, сессии и итог считают одно и то же', () => {
  const t1 = task('Вёрстка', [ses('2026-06-10T10:00:00Z', 2), ses('2026-06-10T14:00:00Z', 1)]);
  const [sheet] = R.buildTaskSheets(t1, { name: 'Клиент' });

  assert.equal(sheet.name, 'Вёрстка');
  assert.equal(sheet.cols.length, 9, 'девять колонок');
  assert.equal(sheet.rows[0][1], 'Вёрстка');
  assert.equal(sheet.rows[1][1], 'Клиент');
  assert.equal(sheet.rows[3][1], 2, 'сессий две');

  const total = sheet.rows[sheet.rows.length - 1];
  assert.deepEqual(sumRange(total[5]), [10, 11], 'часы суммируются по строкам сессий');
  assert.equal(total[5].n, 3, 'три часа');
  assert.equal(total[7].n, 300, 'три часа по сотне');
});

test('задача без сессий не ломает формулу, а отдаёт ноль', () => {
  const [sheet] = R.buildTaskSheets(task('Пусто', []), null);
  const total = sheet.rows[sheet.rows.length - 1];
  assert.equal(total[5].f, undefined, 'формулы нет — суммировать нечего');
  assert.equal(total[5].n, 0);
  assert.equal(sheet.rows[1][1], 'xlsx.no_project', 'проекта нет — так и написано');
});

test('задача без названия берёт запасное имя листа', () => {
  const [sheet] = R.buildTaskSheets(task('', []), null);
  assert.equal(sheet.name, 'xlsx.default_task_sheet');
});

test('лист проекта: формула держится за данные, а не за фиксированный номер', () => {
  const tasks = [task('A', [ses('2026-06-10T10:00:00Z', 1)]), task('B', [ses('2026-06-11T10:00:00Z', 2)])];
  const bare = R.buildProjectSheets({ name: 'Клиент' }, tasks)[0];
  const withDesc = R.buildProjectSheets({ name: 'Клиент', description: 'про него' }, tasks)[0];
  const withMeta = R.buildProjectSheets(
    { name: 'Клиент', description: 'про него' },
    tasks,
    { meta: [[{ t: 'Версия', s: 1 }, 'v1.0']] },
  )[0];

  const rangeOf = (sheet) => sumRange(sheet.rows[sheet.rows.length - 1][4]);
  assert.deepEqual(rangeOf(bare), [6, 7]);
  assert.deepEqual(rangeOf(withDesc), [6, 7], 'пустая строка описания уже учтена');
  assert.deepEqual(rangeOf(withMeta), [7, 8], 'лишняя строка шапки сдвигает диапазон');

  // Сами числа от шапки не зависят.
  for (const sheet of [bare, withDesc, withMeta]) {
    assert.equal(sheet.rows[sheet.rows.length - 1][4].n, 3, 'три часа во всех случаях');
  }
});

test('без периода время задачи берётся из totalMs, а не из суммы сессий', () => {
  // Расходятся они, например, когда идёт таймер: totalMs уже вырос, а сессия
  // ещё не закрыта. Остальное приложение живёт по totalMs, и отчёт тоже.
  const t1 = task('A', [ses('2026-06-10T10:00:00Z', 1)]);
  t1.totalMs = 5 * HOUR;
  const [sheet] = R.buildProjectSheets({ name: 'П' }, [t1]);
  assert.equal(sheet.rows[5][3], `clock(${5 * HOUR})`);
});

test('период отбирает сессии, но не выбрасывает задачи', () => {
  const t1 = task('A', [
    ses('2026-06-10T10:00:00Z', 1),
    ses('2026-07-20T10:00:00Z', 4),
  ]);
  const t2 = task('B', [ses('2026-07-20T10:00:00Z', 8)]);
  const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') };
  const [sheet] = R.buildProjectSheets({ name: 'П' }, [t1, t2], { range });

  assert.equal(sheet.rows[5][1], 'A');
  assert.equal(sheet.rows[6][1], 'B', 'задача без сессий в периоде всё равно в отчёте');
  assert.equal(sheet.rows[5][3], `clock(${1 * HOUR})`, 'только июньский час');
  assert.equal(sheet.rows[6][3], 'clock(0)', 'у второй в периоде ничего');
  assert.equal(sheet.rows[sheet.rows.length - 1][4].n, 1, 'итог тоже за период');
});

test('лист сессий проекта собирает их из всех задач по времени', () => {
  const t1 = task('Поздняя', [ses('2026-06-12T10:00:00Z', 1)]);
  const t2 = task('Ранняя', [ses('2026-06-10T10:00:00Z', 1)]);
  const sheets = R.buildProjectSheets({ name: 'П' }, [t1, t2]);
  assert.equal(sheets.length, 2, 'листа два: задачи и сессии');
  assert.equal(sheets[1].rows[1][1], 'Ранняя', 'сортировка по началу, а не по порядку задач');
  assert.equal(sheets[1].rows[2][1], 'Поздняя');
});

test('пометки сессии переводятся, обычная остаётся пустой', () => {
  const t1 = task('A', [
    ses('2026-06-10T10:00:00Z', 1, { recovered: true }),
    ses('2026-06-11T10:00:00Z', 1, { manual: true }),
    ses('2026-06-12T10:00:00Z', 1),
  ]);
  const [sheet] = R.buildTaskSheets(t1, null);
  // Девять строк шапки — значит сессии с девятого индекса.
  assert.equal(sheet.rows[9][8], 'xlsx.recovered');
  assert.equal(sheet.rows[10][8], 'xlsx.manual');
  assert.equal(sheet.rows[11][8], '');
});

test('сводка по проектам: имена листов не повторяются и влезают в 31 символ', () => {
  const long = 'Очень длинное название проекта, которое не влезает';
  const projects = [{ id: 'p1', name: long }, { id: 'p2', name: long }, { id: 'p3', name: 'Клиент/Про[ект]' }];
  const sheets = R.buildAllProjectsSheets(projects, () => [task('A', [ses('2026-06-10T10:00:00Z', 1)])]);

  assert.equal(sheets.length, 4, 'сводный лист плюс по листу на проект');
  const names = sheets.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'имена не повторяются');
  for (const n of names) assert.ok(n.length <= 31, `имя влезает в 31: ${n}`);
  assert.ok(names[2].endsWith(' 2'), 'одноимённый проект разведён номером');
  assert.ok(!/[[\]:*?/\\]/.test(names[3]), 'запрещённых символов в имени нет');
});

test('сводка складывает проекты и держит формулу на своих строках', () => {
  const projects = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
  const byId = { p1: [task('x', [ses('2026-06-10T10:00:00Z', 2)])], p2: [task('y', [ses('2026-06-10T10:00:00Z', 3)])] };
  const [summary] = R.buildAllProjectsSheets(projects, (id) => byId[id]);
  const total = summary.rows[summary.rows.length - 1];
  assert.deepEqual(sumRange(total[3]), [4, 5]);
  assert.equal(total[3].n, 5, 'пять часов на двоих');
  assert.equal(total[5], 2, 'и две сессии');
});

test('лист периода добавляет колонку проекта и отбирает по датам', () => {
  const tasks = [
    task('A', [ses('2026-06-10T10:00:00Z', 1)], { projectId: 'p1' }),
    task('B', [ses('2026-07-10T10:00:00Z', 9)], { projectId: 'p2' }),
  ];
  const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') };
  const [sheet] = R.buildPeriodSheets(tasks, (id) => ({ p1: { name: 'Клиент' } }[id]), range);

  assert.equal(sheet.rows.length, 3, 'шапка, одна сессия и итог');
  assert.equal(sheet.rows[1][2], 'Клиент', 'колонка проекта на месте');
  assert.equal(sheet.rows[2][7].n, 1, 'июльская сессия в итог не попала');
});

test('лист периода не падает на задаче из удалённого проекта', () => {
  const tasks = [task('A', [ses('2026-06-10T10:00:00Z', 1)], { projectId: 'нет такого' })];
  const [sheet] = R.buildPeriodSheets(tasks, () => null);
  assert.equal(sheet.rows[1][2], 'xlsx.no_project');
});

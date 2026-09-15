// Порт формирования данных для Excel-выгрузки из src/renderer/app.js:2672-2789
// (buildTaskSheets/buildProjectSheets) — те же строки/колонки/формулы, что и
// на десктопе. buildWorkbook() сам (mobile/src/lib/xlsx.js) — байт-в-байт
// копия src/xlsx.js, менять было нечего.
//
// В отличие от десктопа — необязательный `range` ({from, to}: Date) в
// buildProjectSheets: фильтрует, какие СЕССИИ считаются (в т.ч. в списке
// задач — их время/деньги за период, а не за всё время), а не то, какие
// задачи попадают в отчёт. Нужен для выбора периода при экспорте на
// мобильном (месяц/неделя/день/свой).
import { fmtClock, fmtDate, fmtTime, hoursOf, effectiveRate, sessionRate, sessionMoney, CURRENCY_SYMBOLS } from './format';
import { t } from './i18n';

const cellBold = (txt) => ({ t: txt, s: 1 });
const cellHours = (n) => ({ n, s: 2 });
const sortByStart = (a, b) => new Date(a.start || a.s.start) - new Date(b.start || b.s.start);
const inRange = (iso, range) => !range || (new Date(iso) >= range.from && new Date(iso) <= range.to);

export function buildTaskSheets(task, project, langCode, currencyCode, hourlyRate) {
  const cur = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  const sessions = [...(task.sessions || [])].sort(sortByStart);
  const totalMs = task.totalMs || 0;
  const totalMoney = sessions.reduce((a, s) => a + sessionMoney(s, task, hourlyRate), 0);
  const rows = [
    [cellBold(t(langCode, 'xlsx.task')), task.title || t(langCode, 'xlsx.no_title')],
    [cellBold(t(langCode, 'xlsx.project')), project ? project.name : t(langCode, 'xlsx.no_project')],
    [cellBold(t(langCode, 'xlsx.total_time')), fmtClock(totalMs), cellHours(hoursOf(totalMs))],
    [cellBold(t(langCode, 'xlsx.sessions')), sessions.length],
    [cellBold(t(langCode, 'xlsx.rate_now', { cur })), cellHours(effectiveRate(task, hourlyRate))],
    [cellBold(t(langCode, 'xlsx.earned', { cur })), cellHours(totalMoney)],
    [cellBold(t(langCode, 'xlsx.exported')), `${fmtDate(Date.now())} ${fmtTime(Date.now(), langCode)}`],
    [],
    [t(langCode, 'xlsx.num'), t(langCode, 'xlsx.date'), t(langCode, 'xlsx.start'), t(langCode, 'xlsx.end'), t(langCode, 'xlsx.duration'), t(langCode, 'xlsx.hours'),
      t(langCode, 'xlsx.rate', { cur }), t(langCode, 'xlsx.sum', { cur }), t(langCode, 'xlsx.note')].map(cellBold),
  ];
  const firstRow = rows.length + 1;
  sessions.forEach((s, i) => {
    rows.push([
      i + 1, fmtDate(s.start), fmtTime(s.start, langCode), s.end ? fmtTime(s.end, langCode) : '',
      fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, task, hourlyRate)),
      cellHours(sessionMoney(s, task, hourlyRate)), s.recovered ? t(langCode, 'xlsx.recovered') : s.manual ? t(langCode, 'xlsx.manual') : '',
    ]);
  });
  const lastRow = firstRow + sessions.length - 1;
  rows.push([
    cellBold(t(langCode, 'xlsx.total')), '', '', '', fmtClock(sessions.reduce((a, s) => a + s.ms, 0)),
    sessions.length ? { f: `SUM(F${firstRow}:F${lastRow})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
    sessions.length ? { f: `SUM(H${firstRow}:H${lastRow})`, n: totalMoney, s: 2 } : cellHours(0),
  ]);
  return [{ name: (task.title || t(langCode, 'xlsx.default_task_sheet')).slice(0, 31), cols: [6, 12, 10, 10, 14, 9, 12, 12, 14].map((width) => ({ width })), rows }];
}

export function buildProjectSheets(project, tasks, langCode, currencyCode, hourlyRate, range) {
  const cur = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  const sessionsOf = (task) => (task.sessions || []).filter((s) => inRange(s.start, range));
  const taskMoney = (task) => sessionsOf(task).reduce((a, s) => a + sessionMoney(s, task, hourlyRate), 0);
  const taskMs = (task) => sessionsOf(task).reduce((a, s) => a + s.ms, 0);
  const stamp = `${fmtDate(Date.now())} ${fmtTime(Date.now(), langCode)}`;
  const taskRows = [
    [cellBold(t(langCode, 'xlsx.project')), project.name],
    project.description ? [cellBold(t(langCode, 'xlsx.description')), project.description] : [],
    [cellBold(t(langCode, 'xlsx.exported')), stamp],
    [],
    [t(langCode, 'xlsx.num'), t(langCode, 'xlsx.task'), t(langCode, 'xlsx.status'), t(langCode, 'xlsx.total_time'), t(langCode, 'xlsx.hours'), t(langCode, 'xlsx.sum', { cur }),
      t(langCode, 'xlsx.rate', { cur }), t(langCode, 'xlsx.sessions'), t(langCode, 'xlsx.first_entry'), t(langCode, 'xlsx.last_entry')].map(cellBold),
  ];
  const tFirst = taskRows.length + 1;
  tasks.forEach((task, i) => {
    const starts = sessionsOf(task).map((s) => new Date(s.start).getTime());
    const ms = taskMs(task);
    taskRows.push([
      i + 1, task.title || t(langCode, 'xlsx.no_title'), task.done ? t(langCode, 'xlsx.done') : t(langCode, 'xlsx.active'),
      fmtClock(ms), cellHours(hoursOf(ms)),
      cellHours(taskMoney(task)), cellHours(effectiveRate(task, hourlyRate)),
      sessionsOf(task).length,
      starts.length ? fmtDate(Math.min(...starts)) : '', starts.length ? fmtDate(Math.max(...starts)) : '',
    ]);
  });
  const tLast = tFirst + tasks.length - 1;
  const totalMs = tasks.reduce((a, task) => a + taskMs(task), 0);
  const totalMoney = tasks.reduce((a, task) => a + taskMoney(task), 0);
  taskRows.push([
    cellBold(t(langCode, 'xlsx.total')), '', '', fmtClock(totalMs),
    tasks.length ? { f: `SUM(E${tFirst}:E${tLast})`, n: hoursOf(totalMs), s: 2 } : cellHours(0),
    tasks.length ? { f: `SUM(F${tFirst}:F${tLast})`, n: totalMoney, s: 2 } : cellHours(0), '',
    tasks.reduce((a, task) => a + sessionsOf(task).length, 0),
  ]);

  const all = [];
  for (const task of tasks) for (const s of sessionsOf(task)) all.push({ t: task, s });
  all.sort((a, b) => new Date(a.s.start) - new Date(b.s.start));
  const sesRows = [
    [t(langCode, 'xlsx.num'), t(langCode, 'xlsx.task'), t(langCode, 'xlsx.date'), t(langCode, 'xlsx.start'), t(langCode, 'xlsx.end'), t(langCode, 'xlsx.duration'),
      t(langCode, 'xlsx.hours'), t(langCode, 'xlsx.rate', { cur }), t(langCode, 'xlsx.sum', { cur }), t(langCode, 'xlsx.note')].map(cellBold),
  ];
  all.forEach(({ t: task, s }, i) => {
    sesRows.push([
      i + 1, task.title || t(langCode, 'xlsx.no_title'), fmtDate(s.start), fmtTime(s.start, langCode),
      s.end ? fmtTime(s.end, langCode) : '', fmtClock(s.ms), cellHours(hoursOf(s.ms)),
      cellHours(sessionRate(s, task, hourlyRate)), cellHours(sessionMoney(s, task, hourlyRate)),
      s.recovered ? t(langCode, 'xlsx.recovered') : s.manual ? t(langCode, 'xlsx.manual') : '',
    ]);
  });
  const sesTotalMs = all.reduce((a, x) => a + x.s.ms, 0);
  const sesTotalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.t, hourlyRate), 0);
  sesRows.push([
    cellBold(t(langCode, 'xlsx.total')), '', '', '', '', fmtClock(sesTotalMs),
    all.length ? { f: `SUM(G2:G${all.length + 1})`, n: hoursOf(sesTotalMs), s: 2 } : cellHours(0), '',
    all.length ? { f: `SUM(I2:I${all.length + 1})`, n: sesTotalMoney, s: 2 } : cellHours(0),
  ]);
  return [
    { name: t(langCode, 'xlsx.sheet_tasks').slice(0, 31), cols: [6, 34, 12, 14, 9, 12, 12, 8, 14, 16].map((width) => ({ width })), rows: taskRows },
    { name: t(langCode, 'xlsx.sheet_sessions').slice(0, 31), cols: [6, 34, 12, 10, 10, 14, 9, 12, 12, 16].map((width) => ({ width })), rows: sesRows },
  ];
}

/** Новое (нет на десктопе): сводка по ВСЕМ проектам сразу — один лист на
 * проект + общий итог, для кнопки "выгрузить всё" в настройках. */
export function buildAllProjectsSheets(projects, tasksByProjectId, langCode, currencyCode, hourlyRate) {
  const cur = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  const stamp = `${fmtDate(Date.now())} ${fmtTime(Date.now(), langCode)}`;
  const rows = [
    [cellBold(t(langCode, 'xlsx.exported')), stamp],
    [],
    [t(langCode, 'xlsx.num'), t(langCode, 'xlsx.project'), t(langCode, 'xlsx.total_time'), t(langCode, 'xlsx.hours'), t(langCode, 'xlsx.sum', { cur }), t(langCode, 'xlsx.sessions')].map(cellBold),
  ];
  const first = rows.length + 1;
  let grandMs = 0;
  let grandMoney = 0;
  let grandSessions = 0;
  projects.forEach((project, i) => {
    const tasks = tasksByProjectId(project.id);
    const ms = tasks.reduce((a, task) => a + (task.totalMs || 0), 0);
    const money = tasks.reduce((a, task) => a + (task.sessions || []).reduce((b, s) => b + sessionMoney(s, task, hourlyRate), 0), 0);
    const sessionsCount = tasks.reduce((a, task) => a + (task.sessions ? task.sessions.length : 0), 0);
    grandMs += ms; grandMoney += money; grandSessions += sessionsCount;
    rows.push([i + 1, project.name, fmtClock(ms), cellHours(hoursOf(ms)), cellHours(money), sessionsCount]);
  });
  const last = first + projects.length - 1;
  rows.push([
    cellBold(t(langCode, 'xlsx.total')), '', fmtClock(grandMs),
    projects.length ? { f: `SUM(D${first}:D${last})`, n: hoursOf(grandMs), s: 2 } : cellHours(0),
    projects.length ? { f: `SUM(E${first}:E${last})`, n: grandMoney, s: 2 } : cellHours(0),
    grandSessions,
  ]);
  const usedNames = new Set();
  const uniqueName = (raw) => {
    const base = (raw || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || t(langCode, 'xlsx.default_task_sheet');
    let name = base;
    let n = 2;
    while (usedNames.has(name)) name = `${base} ${n++}`;
    usedNames.add(name);
    return name;
  };

  const summarySheetName = uniqueName(t(langCode, 'xlsx.sheet_tasks'));
  const sheets = [{ name: summarySheetName, cols: [6, 34, 14, 9, 12, 10].map((width) => ({ width })), rows }];
  for (const project of projects) {
    const [tasksSheet] = buildProjectSheets(project, tasksByProjectId(project.id), langCode, currencyCode, hourlyRate);
    sheets.push({ ...tasksSheet, name: uniqueName(project.name) });
  }
  return sheets;
}

/** Новое (нет на десктопе): экспорт произвольного периода из календаря —
 * сессии сразу по всем проектам за диапазон дат, один лист. */
export function buildPeriodSheets(tasks, getProjectById, langCode, currencyCode, hourlyRate, range) {
  const cur = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  const all = [];
  for (const task of tasks) {
    for (const s of task.sessions || []) {
      if (inRange(s.start, range)) all.push({ task, s });
    }
  }
  all.sort(sortByStart);
  const rows = [
    [t(langCode, 'xlsx.num'), t(langCode, 'xlsx.task'), t(langCode, 'xlsx.project'), t(langCode, 'xlsx.date'), t(langCode, 'xlsx.start'), t(langCode, 'xlsx.end'),
      t(langCode, 'xlsx.duration'), t(langCode, 'xlsx.hours'), t(langCode, 'xlsx.rate', { cur }), t(langCode, 'xlsx.sum', { cur }), t(langCode, 'xlsx.note')].map(cellBold),
  ];
  all.forEach(({ task, s }, i) => {
    const project = getProjectById(task.projectId);
    rows.push([
      i + 1, task.title || t(langCode, 'xlsx.no_title'), project ? project.name : t(langCode, 'xlsx.no_project'),
      fmtDate(s.start), fmtTime(s.start, langCode), s.end ? fmtTime(s.end, langCode) : '',
      fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, task, hourlyRate)),
      cellHours(sessionMoney(s, task, hourlyRate)), s.recovered ? t(langCode, 'xlsx.recovered') : s.manual ? t(langCode, 'xlsx.manual') : '',
    ]);
  });
  const totalMs = all.reduce((a, x) => a + x.s.ms, 0);
  const totalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.task, hourlyRate), 0);
  rows.push([
    cellBold(t(langCode, 'xlsx.total')), '', '', '', '', '', fmtClock(totalMs),
    all.length ? { f: `SUM(H2:H${all.length + 1})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
    all.length ? { f: `SUM(J2:J${all.length + 1})`, n: totalMoney, s: 2 } : cellHours(0),
  ]);
  return [{ name: t(langCode, 'xlsx.sheet_sessions').slice(0, 31), cols: [6, 30, 24, 12, 10, 10, 14, 9, 12, 12, 16].map((width) => ({ width })), rows }];
}

// Выбор выгрузки в Excel: период и проекты. Запуск: npm run test:unit
//
// Окно «Экспорт в Excel» обещает до нажатия, что попадёт в файл: даты под
// полем периода и строку «Будет выгружено: N записей». Обещание держится на
// чистых функциях core/export.js, а файл собирает core/reports.js — и если
// они разойдутся в трактовке границы суток, окно скажет одно, а в таблице
// окажется другое. Поэтому здесь не только границы периодов, но и сверка
// сводки с настоящим отчётом на одних и тех же записях.
const test = require('node:test');
const assert = require('node:assert/strict');

const E = require('../../src/renderer/core/export.js');
const R = require('../../src/renderer/core/reports.js');
const I = require('../../src/renderer/core/i18n.js');
const L = require('../../src/renderer/core/lang.js');

const at = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);
const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

// Среда, 10 июня 2026, полдень — как в браузерных тестах (tests/e2e/clock.js).
const NOW = at(2026, 6, 10, 12);

// --- периоды ------------------------------------------------------------------

test('периоды идут в том порядке, в каком они в списке, и «Всё время» первым', () => {
  assert.deepEqual(E.EXPORT_PERIODS, ['all', 'day', 'week', 'month', 'half_year', 'year', 'custom']);
});

test('«Всё время» — без границ', () => {
  assert.equal(E.exportRange('all', NOW), null);
});

test('день — сегодня от полуночи до последней миллисекунды', () => {
  const r = E.exportRange('day', NOW);
  assert.deepEqual(parts(r.from), [2026, 6, 10, 0, 0, 0, 0]);
  assert.deepEqual(parts(r.to), [2026, 6, 10, 23, 59, 59, 999]);
});

test('неделя — с понедельника по воскресенье, целиком', () => {
  const r = E.exportRange('week', NOW);
  assert.deepEqual(parts(r.from), [2026, 6, 8, 0, 0, 0, 0], 'понедельник');
  assert.deepEqual(parts(r.to), [2026, 6, 14, 23, 59, 59, 999], 'воскресенье');
});

test('неделя: воскресенье принадлежит прошедшей неделе, понедельник — началу новой', () => {
  const sunday = E.exportRange('week', at(2026, 6, 14, 23, 30));
  assert.deepEqual(parts(sunday.from).slice(0, 3), [2026, 6, 8]);
  assert.deepEqual(parts(sunday.to).slice(0, 3), [2026, 6, 14]);
  const monday = E.exportRange('week', at(2026, 6, 15, 0, 0));
  assert.deepEqual(parts(monday.from).slice(0, 3), [2026, 6, 15]);
  assert.deepEqual(parts(monday.to).slice(0, 3), [2026, 6, 21]);
});

test('неделя на стыке месяцев и года', () => {
  // Четверг, 1 января 2026: неделя началась в понедельник, 29 декабря.
  const r = E.exportRange('week', at(2026, 1, 1, 9));
  assert.deepEqual(parts(r.from).slice(0, 3), [2025, 12, 29]);
  assert.deepEqual(parts(r.to).slice(0, 3), [2026, 1, 4]);
});

test('месяц — календарный, целиком, с учётом длины месяца', () => {
  const june = E.exportRange('month', NOW);
  assert.deepEqual(parts(june.from), [2026, 6, 1, 0, 0, 0, 0]);
  assert.deepEqual(parts(june.to), [2026, 6, 30, 23, 59, 59, 999]);
  assert.deepEqual(parts(E.exportRange('month', at(2028, 2, 10)).to).slice(0, 3), [2028, 2, 29], 'високосный февраль');
  assert.deepEqual(parts(E.exportRange('month', at(2026, 2, 10)).to).slice(0, 3), [2026, 2, 28]);
});

test('полгода — с первого числа месяца пять месяцев назад до конца сегодняшнего дня', () => {
  const r = E.exportRange('half_year', NOW);
  assert.deepEqual(parts(r.from), [2026, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(parts(r.to), [2026, 6, 10, 23, 59, 59, 999]);
  // Через границу года.
  assert.deepEqual(parts(E.exportRange('half_year', at(2026, 2, 3)).from).slice(0, 3), [2025, 9, 1]);
});

test('год — двенадцать месяцев с первого числа до конца сегодняшнего дня', () => {
  const r = E.exportRange('year', NOW);
  assert.deepEqual(parts(r.from), [2025, 7, 1, 0, 0, 0, 0]);
  assert.deepEqual(parts(r.to), [2026, 6, 10, 23, 59, 59, 999]);
  assert.deepEqual(parts(E.exportRange('year', at(2026, 1, 20)).from).slice(0, 3), [2025, 2, 1]);
});

test('свой период — обе даты включительно', () => {
  const r = E.exportRange('custom', NOW, { from: '2026-05-03', to: '2026-05-09' });
  assert.deepEqual(parts(r.from), [2026, 5, 3, 0, 0, 0, 0]);
  assert.deepEqual(parts(r.to), [2026, 5, 9, 23, 59, 59, 999]);
});

test('свой период: один день — от полуночи до полуночи', () => {
  const r = E.exportRange('custom', NOW, { from: '2026-05-03', to: '2026-05-03' });
  assert.deepEqual(parts(r.from), [2026, 5, 3, 0, 0, 0, 0]);
  assert.deepEqual(parts(r.to), [2026, 5, 3, 23, 59, 59, 999]);
});

test('свой период: перепутанные границы меняются местами, а не отбрасываются', () => {
  const r = E.exportRange('custom', NOW, { from: '2026-05-09', to: '2026-05-03' });
  assert.deepEqual(parts(r.from).slice(0, 3), [2026, 5, 3]);
  assert.deepEqual(parts(r.to).slice(0, 3), [2026, 5, 9]);
});

test('свой период: нет одной границы — берётся другая, нет обеих — сегодня', () => {
  const onlyFrom = E.exportRange('custom', NOW, { from: '2026-05-03' });
  assert.deepEqual(parts(onlyFrom.to).slice(0, 3), [2026, 5, 3]);
  const onlyTo = E.exportRange('custom', NOW, { to: '2026-05-09' });
  assert.deepEqual(parts(onlyTo.from).slice(0, 3), [2026, 5, 9]);
  const none = E.exportRange('custom', NOW);
  assert.deepEqual(parts(none.from).slice(0, 3), [2026, 6, 10]);
  assert.deepEqual(parts(none.to).slice(0, 3), [2026, 6, 10]);
});

test('каждый период из списка что-то значит: без границ только «Всё время»', () => {
  for (const p of E.EXPORT_PERIODS) {
    const r = E.exportRange(p, NOW, { from: '2026-06-01', to: '2026-06-02' });
    if (p === 'all') assert.equal(r, null);
    else assert.ok(r && r.from <= r.to, `${p}: границы не заданы или перевёрнуты`);
  }
});

// --- подпись под полем периода ---------------------------------------------------

// Формат подставной: сам вид даты — дело платформы, ядру важно, где писать год.
const fmt = (d, withYear) => `${d.getDate()}.${d.getMonth() + 1}${withYear ? `.${d.getFullYear()}` : ''}`;

test('подпись: год пишется один раз, у конца, когда границы в одном году', () => {
  const r = { from: at(2026, 10, 1), to: at(2026, 10, 31, 23, 59, 59, 999) };
  assert.equal(E.exportRangeLabel(r, fmt), '1.10 – 31.10.2026');
});

test('подпись: границы в разных годах — год у обеих', () => {
  const r = { from: at(2025, 12, 29), to: at(2026, 1, 4, 23, 59, 59, 999) };
  assert.equal(E.exportRangeLabel(r, fmt), '29.12.2025 – 4.1.2026');
});

test('подпись: один день — одна дата; «всё время» — null', () => {
  assert.equal(E.exportRangeLabel(E.exportRange('day', NOW), fmt), '10.6.2026');
  assert.equal(E.exportRangeLabel(null, fmt), null);
});

// --- что попадёт в файл ---------------------------------------------------------

/** Задача с записями: [старт Date, миллисекунды]. */
const task = (projectId, spans, extra = {}) => ({
  id: `t${Math.random()}`,
  projectId,
  title: 'Задача',
  sessions: spans.map(([start, ms]) => ({ start: start.toISOString(), end: new Date(start.getTime() + ms).toISOString(), ms })),
  totalMs: spans.reduce((a, [, ms]) => a + ms, 0),
  ...extra,
});
const H = 3_600_000;

test('запись принадлежит периоду по началу: на границе суток', () => {
  const june = E.exportRange('custom', NOW, { from: '2026-06-10', to: '2026-06-10' });
  const tasks = [task('p1', [
    [at(2026, 6, 9, 23, 59, 59, 999), 2 * H], // начата за миллисекунду до периода, длится внутрь него
    [at(2026, 6, 10, 0, 0, 0, 0), H], //       первая миллисекунда периода
    [at(2026, 6, 10, 23, 30), 2 * H], //       начата вечером, кончается уже завтра
    [at(2026, 6, 10, 23, 59, 59, 999), H], //  последняя миллисекунда периода
    [at(2026, 6, 11, 0, 0, 0, 0), H], //       начата сразу после
  ])];
  const sum = E.exportSummary(tasks, june);
  assert.equal(sum.count, 3, 'в день попали три записи: две на границах и вечерняя');
  assert.equal(sum.ms, 4 * H);
  assert.equal(sum.empty, false);
});

test('сводка за период считает время по записям, за всё время — по totalMs задачи', () => {
  // Так же считает и отчёт (reports.js: taskMs): totalMs — то, по чему живёт
  // остальное приложение, и в сводке по проектам он главнее суммы записей.
  const t1 = task('p1', [[at(2026, 6, 1, 10), H]], { totalMs: 5 * H });
  assert.deepEqual(E.exportSummary([t1], null), { count: 1, ms: 5 * H, empty: false });
  assert.equal(E.exportSummary([t1], E.exportRange('month', NOW)).ms, H);
});

test('нет записей — сводка пуста, и это видно по флагу', () => {
  assert.deepEqual(E.exportSummary([], null), { count: 0, ms: 0, empty: true });
  const t1 = task('p1', [[at(2026, 1, 5, 10), H]]);
  assert.equal(E.exportSummary([t1], E.exportRange('month', NOW)).empty, true, 'записи есть, но не в этом месяце');
  assert.equal(E.exportSummary([{ id: 'x', projectId: 'p1' }], null).empty, true, 'задача без поля sessions');
});

test('сводка сходится с настоящим отчётом на тех же записях', () => {
  // Один и тот же набор — и в сводку окна, и в core/reports.js. Границы суток
  // расставлены нарочно: именно там две копии правила и расходятся.
  const tasks = [
    task('p1', [
      [at(2026, 6, 9, 23, 59, 59, 999), H],
      [at(2026, 6, 10, 0, 0, 0, 0), 2 * H],
      [at(2026, 6, 10, 23, 59, 59, 999), 3 * H],
      [at(2026, 6, 11, 0, 0, 0, 0), 4 * H],
    ]),
    task('p2', [[at(2026, 6, 10, 9), H / 2], [at(2026, 5, 31, 22), H]]),
    task('p2', []),
  ];
  const rep = R.makeReports({
    t: (k) => k, cur: '₽', fmtClock: (ms) => ms, fmtDate: String, fmtTime: String, hoursOf: (ms) => ms / H,
    effectiveRate: () => 0, sessionRate: () => 0, sessionMoney: () => 0,
  });
  for (const period of ['day', 'week', 'month', 'custom']) {
    const range = E.exportRange(period, NOW, { from: '2026-06-10', to: '2026-06-10' });
    const sum = E.exportSummary(tasks, range);
    const [sheet] = rep.buildPeriodSheets(tasks, () => null, range);
    const total = sheet.rows[sheet.rows.length - 1];
    assert.equal(sheet.rows.length - 2, sum.count, `${period}: число записей в листе и в сводке`);
    assert.equal(total[6], sum.ms, `${period}: время в итоговой строке и в сводке`);
  }
  // «Всё время»: итоги сводного листа.
  const sum = E.exportSummary(tasks, null);
  const projects = [{ id: 'p1', name: 'А' }, { id: 'p2', name: 'Б' }];
  const [summary] = rep.buildAllProjectsSheets(projects, (id) => tasks.filter((x) => x.projectId === id));
  const total = summary.rows[summary.rows.length - 1];
  assert.equal(total[2], sum.ms, 'всё время: время');
  assert.equal(total[5], sum.count, 'всё время: записи');
});

test('«Всё время» показывает то, что за ним лежит: от первой записи до последней', () => {
  assert.equal(E.exportSpan([]), null);
  assert.equal(E.exportSpan([{ id: 'x', sessions: [] }]), null);
  const span = E.exportSpan([
    task('p1', [[at(2026, 3, 9, 15), H]]),
    task('p2', [[at(2025, 11, 2, 8), H], [at(2026, 6, 9, 23, 40), H]]),
  ]);
  assert.deepEqual(parts(span.from), [2025, 11, 2, 0, 0, 0, 0]);
  assert.deepEqual(parts(span.to), [2026, 6, 9, 23, 59, 59, 999]);
});

// --- проекты --------------------------------------------------------------------

const ALL = ['a', 'b', 'c'];

test('выбор проектов: пусто, «все до одного» и неизвестные id — это «все»', () => {
  assert.equal(E.normalizeExportProjects(null, ALL), null);
  assert.equal(E.normalizeExportProjects([], ALL), null);
  assert.equal(E.normalizeExportProjects(['a', 'b', 'c'], ALL), null);
  assert.equal(E.normalizeExportProjects(['c', 'a', 'b', 'a'], ALL), null, 'повторы не мешают');
  assert.equal(E.normalizeExportProjects(['gone'], ALL), null, 'проекта уже нет — выбирать нечего');
  assert.deepEqual(E.normalizeExportProjects(['a', 'gone'], ALL), ['a'], 'удалённый отбрасывается, остальные остаются');
  assert.deepEqual(E.normalizeExportProjects(['b', 'a'], ALL), ['b', 'a']);
});

test('отметка проекта: из «всех» — сужение до одного, дальше — добавление и снятие', () => {
  let sel = null;
  sel = E.toggleExportProject(sel, 'b', ALL);
  assert.deepEqual(sel, ['b'], 'нажали на проект при «всех» — выбран только он');
  sel = E.toggleExportProject(sel, 'c', ALL);
  assert.deepEqual(sel, ['b', 'c']);
  sel = E.toggleExportProject(sel, 'b', ALL);
  assert.deepEqual(sel, ['c'], 'повторное нажатие снимает отметку');
  sel = E.toggleExportProject(sel, 'c', ALL);
  assert.equal(sel, null, 'снята последняя — снова «все»');
});

test('отметка проекта: отмечены все по одному — это «все проекты»', () => {
  let sel = E.toggleExportProject(null, 'a', ALL);
  sel = E.toggleExportProject(sel, 'b', ALL);
  assert.deepEqual(sel, ['a', 'b']);
  sel = E.toggleExportProject(sel, 'c', ALL);
  assert.equal(sel, null);
});

test('отметка проекта: единственный проект — те же «все»', () => {
  assert.equal(E.toggleExportProject(null, 'only', ['only']), null);
});

test('отметка не меняет переданный список', () => {
  const sel = ['a'];
  E.toggleExportProject(sel, 'b', ALL);
  assert.deepEqual(sel, ['a']);
});

test('задачи выбранных проектов; «все» — копия списка, а не он сам', () => {
  const tasks = [task('a', []), task('b', []), task('c', []), task('a', [])];
  assert.equal(E.exportTasks(tasks, ['a']).length, 2);
  assert.deepEqual(E.exportTasks(tasks, ['b', 'c']).map((x) => x.projectId), ['b', 'c']);
  const everything = E.exportTasks(tasks, null);
  assert.equal(everything.length, 4);
  assert.notEqual(everything, tasks, 'иначе сортировка снаружи портила бы исходный список');
});

test('подпись кнопки проектов: все, название одного, число нескольких', () => {
  const projects = [{ id: 'a', name: 'Сайт' }, { id: 'b', name: 'Лендинг' }, { id: 'c', name: 'Бот' }];
  const words = { all: 'Все проекты', many: (n) => `${n} шт.` };
  assert.equal(E.exportProjectsLabel(null, projects, words), 'Все проекты');
  assert.equal(E.exportProjectsLabel(['b'], projects, words), 'Лендинг');
  assert.equal(E.exportProjectsLabel(['a', 'c'], projects, words), '2 шт.');
  assert.equal(E.exportProjectsLabel(['gone'], projects, words), 'Все проекты', 'выбранного уже нет');
});

// --- склонение подписи ---------------------------------------------------------

const label = (lang, n) => {
  const many = (k) => L.translate(I.T, lang, 'export.projects_n', { n: k, plural: L.pluralForm(I.T, lang, k, 'plural.project') });
  return E.exportProjectsLabel(
    Array.from({ length: n }, (_, i) => `p${i}`),
    Array.from({ length: n + 1 }, (_, i) => ({ id: `p${i}`, name: `П${i}` })),
    { all: '—', many },
  );
};
const summary = (lang, n) => L.translate(I.T, lang, 'export.summary', {
  n, plural: L.pluralForm(I.T, lang, n, 'plural.entry'), time: '2ч',
});

test('склонение «N проектов» по-русски', () => {
  const got = [2, 3, 4, 5, 11, 12, 14, 21, 22, 25].map((n) => label('ru', n));
  assert.deepEqual(got, ['2 проекта', '3 проекта', '4 проекта', '5 проектов', '11 проектов', '12 проектов', '14 проектов', '21 проект', '22 проекта', '25 проектов']);
});

test('склонение «N записей» по-русски', () => {
  assert.equal(summary('ru', 1), 'Будет выгружено: 1 запись, 2ч');
  assert.equal(summary('ru', 3), 'Будет выгружено: 3 записи, 2ч');
  assert.equal(summary('ru', 5), 'Будет выгружено: 5 записей, 2ч');
  assert.equal(summary('ru', 11), 'Будет выгружено: 11 записей, 2ч');
  assert.equal(summary('ru', 21), 'Будет выгружено: 21 запись, 2ч');
  assert.equal(summary('ru', 102), 'Будет выгружено: 102 записи, 2ч');
});

test('склонение по-украински', () => {
  assert.deepEqual([2, 5, 11, 21].map((n) => label('uk', n)), ['2 проєкти', '5 проєктів', '11 проєктів', '21 проєкт']);
  assert.equal(summary('uk', 2), 'Буде вивантажено: 2 записи, 2ч');
  assert.equal(summary('uk', 5), 'Буде вивантажено: 5 записів, 2ч');
});

test('склонение по-английски', () => {
  assert.deepEqual([2, 3, 21].map((n) => label('en', n)), ['2 projects', '3 projects', '21 projects']);
  assert.equal(summary('en', 1), 'To be exported: 1 entry, 2ч');
  assert.equal(summary('en', 2), 'To be exported: 2 entries, 2ч');
});

test('по-казахски число стоит перед единственным числом', () => {
  assert.deepEqual([2, 5, 21].map((n) => label('kk', n)), ['2 жоба', '5 жоба', '21 жоба']);
  assert.equal(summary('kk', 3), 'Экспортқа кетеді: 3 жазба, 2ч');
});

test('у окна экспорта есть все строки на четырёх языках', () => {
  const keys = [
    ...E.EXPORT_PERIODS.map((p) => `export.period_${p}`),
    'export.period_label', 'export.projects_label', 'export.projects_n', 'export.date_from', 'export.date_to',
    'export.summary', 'export.empty', 'filter.all_projects', 'plural.project', 'plural.entry',
  ];
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    for (const key of keys) assert.ok(I.T[lang][key], `${lang}: нет ${key}`);
  }
});

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

// ---------------------------------------------------------------------------
// Без денег: deps.money === false («личное», core/modes.js)
// ---------------------------------------------------------------------------
// Листы собираются сразу без колонок «Ставка» и «Сумма» и без строк «ставка»
// и «заработано» в шапке листа задачи. Раньше веб вырезал их из готовых
// листов по подписи шапки (stripMoneyFromSheets в app.js), а телефон так
// сделать не мог — форма листов в ядре, а формулы ссылаются на буквы колонок
// и номера строк. Теперь это параметр сборки, и один код работает на обеих
// поверхностях.

const NM = makeReports({ ...deps, money: false });

/** Эталон: то, что делал веб до выноса в ядро, — вырезание из готовых листов
 *  по подписи шапки (жирная строка), со сдвигом букв колонок и номеров строк
 *  в формулах. Независимый от сборки путь к тому же результату: сверка с ним
 *  и есть «деньги ушли, остальное на своих местах». */
function stripByLabels(sheets) {
  const tpl = (key) => deps.t(key, { cur: '\u0001' }).split('\u0001');
  const like = (text, [pre, post = '']) => typeof text === 'string'
    && text.length >= pre.length + post.length && text.startsWith(pre) && text.endsWith(post);
  const moneyCols = [tpl('xlsx.rate'), tpl('xlsx.sum')];
  const moneyRows = [tpl('xlsx.rate_now'), tpl('xlsx.earned')];
  const textOf = (c) => (c && typeof c === 'object' ? c.t : c);
  const colName = (i) => { let n = i + 1; let out = ''; while (n > 0) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); } return out; };
  const colIndex = (name) => [...name].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return sheets.map((sheet) => {
    const goneRows = sheet.rows.map((r, i) => (r.length && moneyRows.some((p) => like(textOf(r[0]), p)) ? i : -1)).filter((i) => i >= 0);
    const rows = sheet.rows.filter((_, i) => !goneRows.includes(i));
    const head = rows.find((r) => r.length > 3 && r.every((c) => c && typeof c === 'object' && c.s === 1));
    const drop = head ? head.map((c, i) => (moneyCols.some((p) => like(textOf(c), p)) ? i : -1)).filter((i) => i >= 0) : [];
    const from = head ? rows.indexOf(head) : rows.length;
    const col = (i) => i - drop.filter((d) => d < i).length;
    const row = (n) => n - goneRows.filter((g) => g < n - 1).length;
    const fix = (c) => (c && typeof c === 'object' && typeof c.f === 'string'
      ? { ...c, f: c.f.replace(/\b([A-Z]{1,3})(\d+)\b/g, (m, letters, num) => colName(col(colIndex(letters))) + row(Number(num))) }
      : c);
    return {
      ...sheet,
      cols: Array.isArray(sheet.cols) ? sheet.cols.filter((_, i) => !drop.includes(i)) : sheet.cols,
      rows: rows.map((r, ri) => (ri < from ? r : r.filter((_, i) => !drop.includes(i)).map(fix))),
    };
  });
}

const A = task('A', [ses('2026-06-10T10:00:00Z', 1), ses('2026-06-12T10:00:00Z', 2, { manual: true })], { projectId: 'p1', rate: 250, done: true });
const B = task('B', [ses('2026-07-20T10:00:00Z', 4, { recovered: true })], { projectId: 'p2' });
const EMPTY = task('Пусто', [], { projectId: 'p1' });
const CLIENT = { id: 'p1', name: 'Клиент', description: 'про него' };
const JUNE = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') };
const projectOf = (id) => ({ p1: CLIENT, p2: { id: 'p2', name: 'Бот' } }[id]);
const byProject = { p1: [A, EMPTY], p2: [B], p3: [] };

/** Все четыре построителя на разных данных: с описанием проекта и без, с
 *  периодом и без, с пустыми задачами и вовсе без данных. */
const CASES = {
  'лист задачи': (R) => R.buildTaskSheets(A, CLIENT),
  'лист задачи без сессий': (R) => R.buildTaskSheets(EMPTY, null),
  'проект с описанием и строкой «Версия»': (R) => R.buildProjectSheets(CLIENT, [A, B, EMPTY], { meta: [[{ t: 'Версия', s: 1 }, 'v1']] }),
  'проект за период': (R) => R.buildProjectSheets(CLIENT, [A, B], { range: JUNE }),
  'проект без задач': (R) => R.buildProjectSheets({ name: 'П' }, []),
  'сводка по проектам': (R) => R.buildAllProjectsSheets([CLIENT, { id: 'p2', name: 'Бот' }, { id: 'p3', name: 'Бот' }], (id) => byProject[id]),
  'сводка без проектов': (R) => R.buildAllProjectsSheets([], () => []),
  'сессии периода': (R) => R.buildPeriodSheets([A, B], projectOf, JUNE),
  'сессии периода без записей': (R) => R.buildPeriodSheets([EMPTY], projectOf, JUNE),
};

/** Первая строка шапки таблицы: жирная, больше трёх ячеек. */
const headOf = (sheet) => sheet.rows.find((r) => r.length > 3 && r.every((c) => c && c.s === 1));

for (const [name, build] of Object.entries(CASES)) {
  test(`без денег (${name}): то же, что с деньгами за вычетом колонок денег, формулы на своих местах`, () => {
    const full = build(R);
    const free = build(NM);
    assert.deepEqual(free, stripByLabels(full));
    // Эталон не вхолостую: в листе с деньгами он что-то убирает.
    assert.notDeepEqual(stripByLabels(full), full, 'в листе с деньгами денежные колонки есть');
  });

  test(`без денег (${name}): ни подписей ставки и суммы, ни валюты; лист без денег эталон не меняет`, () => {
    const free = build(NM);
    const text = JSON.stringify(free);
    assert.doesNotMatch(text, /xlsx\.(rate|rate_now|sum|earned)\b/, 'подписей денег нет');
    assert.ok(!text.includes('₽'), 'валюты нет');
    assert.deepEqual(stripByLabels(free), free, 'вырезать уже нечего');
  });

  test(`без денег (${name}): ширин колонок по числу колонок, строки не шире шапки`, () => {
    for (const sheet of build(NM)) {
      const head = headOf(sheet);
      assert.ok(head, `${sheet.name}: шапка таблицы на месте`);
      assert.equal(sheet.cols.length, head.length, `${sheet.name}: ширины по числу колонок`);
      for (const r of sheet.rows) assert.ok(r.length <= head.length, `${sheet.name}: строка не шире шапки`);
    }
  });

  test(`${name}: SUM указывает на колонку «Часы», а его диапазон — на строки данных над итогом`, () => {
    // Для листов с деньгами и без: деньги убрали, формула не уехала.
    for (const R_ of [R, NM]) {
      for (const sheet of build(R_)) {
        const head = headOf(sheet);
        const headIndex = sheet.rows.indexOf(head);
        for (const r of sheet.rows) {
          for (const c of r) {
            if (!c || typeof c.f !== 'string') continue;
            const m = c.f.match(/^SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/);
            assert.ok(m && m[1] === m[3], `${sheet.name}: формула SUM по одной колонке: ${c.f}`);
            const col = m[1].charCodeAt(0) - 65;
            const [a, b] = [Number(m[2]), Number(m[4])];
            const isHours = head[col].t === 'xlsx.hours';
            const isMoney = /^xlsx\.sum/.test(head[col].t);
            assert.ok(isHours || (R_ === R && isMoney), `${sheet.name}: ${c.f} — колонка «${head[col].t}»`);
            assert.equal(a - 1, headIndex + 1, `${sheet.name}: диапазон начинается сразу под шапкой`);
            assert.equal(b, sheet.rows.length - 1, `${sheet.name}: диапазон кончается над итоговой строкой`);
            const cells = sheet.rows.slice(a - 1, b).map((x) => x[col].n);
            const sum = cells.reduce((acc, n) => acc + n, 0);
            assert.ok(Math.abs(sum - c.n) < 1e-9, `${sheet.name}: ${c.f} — числа в ячейках дают ${sum}, в итоге ${c.n}`);
          }
        }
      }
    }
  });
}

test('без денег: лист задачи — семь колонок, в шапке на две строки меньше, SUM по тем же сессиям', () => {
  const [sheet] = NM.buildTaskSheets(A, CLIENT);
  assert.equal(sheet.cols.length, 7);
  assert.deepEqual(
    sheet.rows[6].map((c) => c.t),
    ['xlsx.num', 'xlsx.date', 'xlsx.start', 'xlsx.end', 'xlsx.duration', 'xlsx.hours', 'xlsx.note'],
  );
  assert.equal(sheet.rows[3][0].t, 'xlsx.sessions');
  assert.equal(sheet.rows[4][0].t, 'xlsx.exported', 'после числа сессий сразу отметка о выгрузке');
  // Две сессии: строки 8 и 9 (с деньгами было бы 10 и 11).
  const total = sheet.rows[sheet.rows.length - 1];
  assert.equal(total.length, 6);
  assert.equal(total[5].f, 'SUM(F8:F9)');
  assert.equal(total[5].n, 3);
  assert.equal(sheet.rows[7][6], '', 'пометка сдвинулась на место ставки');
  assert.equal(sheet.rows[8][6], 'xlsx.manual');
  const [withMoney] = R.buildTaskSheets(A, CLIENT);
  assert.equal(withMoney.rows[withMoney.rows.length - 1][5].f, 'SUM(F10:F11)', 'с деньгами строки ниже, как и было');
});

test('без денег: проект — на лист задач 8 колонок, на лист сессий 8, SUM на своих строках', () => {
  const [tasks, sessions] = NM.buildProjectSheets(CLIENT, [A, B], { meta: [[{ t: 'Версия', s: 1 }, 'v1']] });
  assert.equal(tasks.cols.length, 8);
  assert.equal(sessions.cols.length, 8);
  const tTotal = tasks.rows[tasks.rows.length - 1];
  assert.equal(tTotal[4].f, 'SUM(E7:E8)', 'под описанием и «Версией» задачи начинаются с седьмой строки');
  assert.equal(tTotal[5], 3, 'число сессий — в колонке, где раньше стояла сумма');
  const sTotal = sessions.rows[sessions.rows.length - 1];
  assert.equal(sTotal[6].f, 'SUM(G2:G4)');
  assert.equal(sTotal.length, 7);
});

test('без денег: сводка по проектам и лист периода', () => {
  const [summary] = NM.buildAllProjectsSheets([CLIENT, { id: 'p2', name: 'Бот' }], (id) => byProject[id]);
  assert.equal(summary.cols.length, 5);
  const total = summary.rows[summary.rows.length - 1];
  assert.equal(total[3].f, 'SUM(D4:D5)');
  assert.equal(total[4], 3, 'сессий: две у первого проекта и одна у второго');
  assert.equal(total.length, 5);

  const [period] = NM.buildPeriodSheets([A, B], projectOf, JUNE);
  assert.equal(period.cols.length, 9);
  const pTotal = period.rows[period.rows.length - 1];
  assert.equal(pTotal[7].f, 'SUM(H2:H3)', 'в июне две сессии первой задачи');
  assert.equal(pTotal.length, 8);
});

test('деньги по умолчанию есть: money не задан, true или undefined — листы прежние', () => {
  for (const extra of [{}, { money: true }, { money: undefined }]) {
    const R2 = makeReports({ ...deps, ...extra });
    for (const [name, build] of Object.entries(CASES)) {
      assert.deepEqual(build(R2), build(R), name);
    }
  }
});

test('без денег: повторный вызов даёт то же, входные данные не меняются', () => {
  const before = JSON.stringify([A, B, EMPTY]);
  for (const [name, build] of Object.entries(CASES)) {
    const first = build(NM);
    const second = build(NM);
    assert.deepEqual(second, first, `${name}: второй вызов не отличается`);
  }
  assert.equal(JSON.stringify([A, B, EMPTY]), before, 'задачи не тронуты');
  // И листы с деньгами после листов без денег — по-прежнему с деньгами:
  // флаг живёт в makeReports, а не в общем состоянии.
  assert.match(JSON.stringify(R.buildTaskSheets(A, CLIENT)), /xlsx\.rate_now/);
});

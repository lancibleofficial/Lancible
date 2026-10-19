// Обёртка отчётов на телефоне. Запуск: npm run test:unit
//
// Сама форма отчёта общая и проверяется в reports.test.js. Здесь стережётся
// единственное, что делает mobile/src/lib/xlsxReports.js, — привязка
// зависимостей: на телефоне t, fmtTime и денежные функции берут лишние
// аргументы (язык, ставку), а ядро зовёт их короткими. Промахнуться в этой
// привязке легко, а заметно это только в готовом файле выгрузки.
//
// Файл — ES-модуль с импортами React Native, поэтому, как и в
// mobile-i18n.test.js, читаем его текстом и выполняем в песочнице: тащить в
// проект сборщик ради одной обёртки было бы дороже.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'xlsxReports.js');
const Core = require('../../src/renderer/core/reports.js');

/** Загружает обёртку, подменив её импорты. Возвращает и построители, и
 *  журнал вызовов — по нему видно, с чем ядро позвало каждую зависимость. */
function loadAdapter() {
  const calls = { t: [], fmtTime: [], effectiveRate: [], sessionRate: [], sessionMoney: [] };
  const src = fs.readFileSync(FILE, 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, '');

  const stubs = {
    Core,
    t: (lang, key, params) => { calls.t.push(lang); return params ? `${key}:${params.cur}` : key; },
    fmtClock: (ms) => `clock(${ms})`,
    fmtDate: () => 'DATE',
    fmtTime: (ts, lang) => { calls.fmtTime.push(lang); return 'TIME'; },
    hoursOf: (ms) => ms / 3600000,
    effectiveRate: (task, rate) => { calls.effectiveRate.push(rate); return rate; },
    sessionRate: (s, task, rate) => { calls.sessionRate.push(rate); return rate; },
    sessionMoney: (s, task, rate) => { calls.sessionMoney.push(rate); return (s.ms / 3600000) * rate; },
    CURRENCY_SYMBOLS: { RUB: '₽', USD: '$' },
  };
  const names = Object.keys(stubs);
  const body = `${src};return { buildTaskSheets, buildAllProjectsSheets, buildPeriodSheets };`;
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, body)(...names.map((n) => stubs[n]));
  return { api, calls };
}

const HOUR = 3600000;
const ses = (iso, hours) => ({ start: iso, end: iso, ms: hours * HOUR });
const mkTask = (title, sessions, extra) => ({
  title, sessions, totalMs: sessions.reduce((a, s) => a + s.ms, 0), ...extra,
});

test('обёртка отдаёт все три построителя', () => {
  const { api } = loadAdapter();
  for (const name of ['buildTaskSheets', 'buildAllProjectsSheets', 'buildPeriodSheets']) {
    assert.equal(typeof api[name], 'function', `нет ${name}`);
  }
});

test('язык доходит до словаря, но не до формата времени', () => {
  const { api, calls } = loadAdapter();
  api.buildTaskSheets(mkTask('A', [ses('2026-06-10T10:00:00Z', 1)]), { name: 'П' }, 'kk', 'RUB', 100);

  assert.ok(calls.t.length > 0, 'словарь вообще звали');
  assert.deepEqual([...new Set(calls.t)], ['kk'], 'во все вызовы словаря ушёл один язык');

  // А время в отчёте нарочно не зависит от языка: туда идёт функция ядра,
  // ЧЧ:ММ:СС, одна и та же на всех платформах и во всех языках. Пока
  // мобильная версия подставляла сюда экранный формат, выгрузка с телефона
  // отличалась от десктопной — в ней не было секунд.
  assert.ok(calls.fmtTime.length > 0, 'время в отчёте всё же форматируется');
  assert.deepEqual(
    [...new Set(calls.fmtTime)], [undefined],
    'но язык в него не передаётся ни разу',
  );
});

test('ставка доходит до всех денежных функций', () => {
  const { api, calls } = loadAdapter();
  api.buildTaskSheets(mkTask('A', [ses('2026-06-10T10:00:00Z', 2)]), null, 'ru', 'RUB', 777);

  assert.deepEqual([...new Set(calls.effectiveRate)], [777]);
  assert.deepEqual([...new Set(calls.sessionRate)], [777]);
  assert.deepEqual([...new Set(calls.sessionMoney)], [777]);
});

test('валюта превращается в символ, а неизвестная остаётся кодом', () => {
  const { api } = loadAdapter();
  const rub = api.buildTaskSheets(mkTask('A', []), null, 'ru', 'RUB', 0)[0];
  const xxx = api.buildTaskSheets(mkTask('A', []), null, 'ru', 'XXX', 0)[0];
  assert.equal(rub.rows[4][0].t, 'xlsx.rate_now:₽');
  assert.equal(xxx.rows[4][0].t, 'xlsx.rate_now:XXX');
});

test('период доходит до отбора сессий', () => {
  const { api } = loadAdapter();
  const task = mkTask('A', [ses('2026-06-10T10:00:00Z', 1), ses('2026-07-20T10:00:00Z', 4)]);
  const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') };
  const [sheet] = api.buildPeriodSheets([task], () => null, 'ru', 'RUB', 100, range);

  // Заголовок, одна сессия (июньская), итоговая строка.
  assert.equal(sheet.rows.length, 3, 'в отчёт попала одна сессия');
  assert.equal(sheet.rows[1][6], `clock(${HOUR})`, 'в отчёт попал только июньский час');
});

test('сводка по проектам зовёт выборку задач по идентификатору', () => {
  const { api } = loadAdapter();
  const asked = [];
  const sheets = api.buildAllProjectsSheets(
    [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    (id) => { asked.push(id); return [mkTask('x', [ses('2026-06-10T10:00:00Z', 1)])]; },
    'ru', 'RUB', 100,
  );
  assert.ok(asked.includes('p1') && asked.includes('p2'), 'спросили про оба проекта');
  assert.equal(sheets.length, 3, 'сводный лист и два проектных');
});

test('лист периода зовёт выборку проекта по задаче', () => {
  const { api } = loadAdapter();
  const tasks = [mkTask('A', [ses('2026-06-10T10:00:00Z', 1)], { projectId: 'p1' })];
  const [sheet] = api.buildPeriodSheets(tasks, (id) => (id === 'p1' ? { name: 'Клиент' } : null), 'ru', 'RUB', 100);
  assert.equal(sheet.rows[1][2], 'Клиент');
});

test('{ money: false } последним аргументом доходит до ядра: листы без ставки и суммы; без него — с деньгами', () => {
  const { api } = loadAdapter();
  const t1 = mkTask('A', [ses('2026-06-10T10:00:00Z', 2)], { projectId: 'p1' });
  const sheetsOf = (opts) => [
    ...api.buildTaskSheets(t1, { name: 'П' }, 'ru', 'RUB', 100, opts),
    ...api.buildAllProjectsSheets([{ id: 'p1', name: 'A' }], () => [t1], 'ru', 'RUB', 100, opts),
    ...api.buildPeriodSheets([t1], () => ({ name: 'П' }), 'ru', 'RUB', 100, undefined, opts),
  ];
  const moneyLabels = /xlsx\.(rate|rate_now|sum|earned)\b/;
  assert.match(JSON.stringify(sheetsOf()), moneyLabels, 'без флага деньги в листах есть');
  assert.match(JSON.stringify(sheetsOf({ money: true })), moneyLabels);
  const free = JSON.stringify(sheetsOf({ money: false }));
  assert.doesNotMatch(free, moneyLabels, 'money: false — подписей денег нет ни в одном листе');
  assert.ok(!free.includes('₽'), 'и валюты нет');
});

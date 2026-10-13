// Календарь ядра в день перевода часов. Запуск: npm run test:unit
//
// Ядро считало календарные дни как «начало + n · 86 400 000 мс». А сутки
// дважды в год длятся 23 или 25 часов (Украина — 29 марта и 25 октября
// 2026, США — 8 марта и 1 ноября), и такой сдвиг уезжает с полуночи на час.
// Хуже всего было с sessionSegments: в 25-часовой день «начало плюс сутки» —
// это 23:00, запись после 23:00 не продвигала нарезку ни на шаг, и экран
// «Время» зависал намертво. Остальное тише: граница недели на час раньше
// или позже полуночи, ночная запись режется не в полночь, «раз в две
// недели» срабатывает через одну.
//
// CI гоняет набор в UTC, где перевода нет, поэтому пояс задаёт сам тест.
// Каждая проверка идёт в отдельном процессе Node с TZ в окружении: так пояс
// честно читается при старте, а главное — вечный цикл изнутри процесса не
// прервать, дочерний же убивается по таймауту, и тест падает, а не вешает
// весь набор.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE = path.join(__dirname, '..', '..', 'src', 'renderer', 'core');

// Дни перевода — [год, месяц с нуля, число], все воскресенья. Алматы — пояс
// без перевода, контроль: там сутки всегда 24 часа, а ответы те же.
const ZONES = [
  { tz: 'Europe/Kyiv', back: [2026, 9, 25], fwd: [2026, 2, 29], backH: 25, fwdH: 23 },
  { tz: 'America/New_York', back: [2026, 10, 1], fwd: [2026, 2, 8], backH: 25, fwdH: 23 },
  { tz: 'Asia/Almaty', back: [2026, 9, 25], fwd: [2026, 2, 29], backH: 24, fwdH: 24 },
];

/** «ГГГГ-ММ-ДД ЧЧ:ММ» по местному времени. Нужна в дочернем процессе —
 *  уходит туда текстом. */
function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Дата дня через n дней от day — в UTC, чтобы не зависеть от пояса этого
 *  процесса. Ожидания строятся ею, а не проверяемым кодом. */
const keyPlus = ([y, m, d], n) => {
  const x = new Date(Date.UTC(y, m, d + n));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

/** Выполняет probe(core, args) в процессе Node с поясом tz и возвращает
 *  результат. Память урезана: вечный цикл копит куски, и без потолка он
 *  съел бы гигабайты раньше таймаута. */
function inZone(tz, probe, args) {
  const req = (f) => `require(${JSON.stringify(path.join(CORE, f))})`;
  const code = `${stamp}\n`
    + `const core = { A: ${req('agenda.js')}, R: ${req('repeat.js')}, V: ${req('views.js')}, L: ${req('slots.js')}, M: ${req('reminders.js')} };\n`
    + `process.stdout.write(JSON.stringify((${probe})(core, ${JSON.stringify(args)})));`;
  const env = { ...process.env, TZ: tz };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', code], { env, encoding: 'utf8', timeout: 5000 });
  const timedOut = !!r.error && r.error.code === 'ETIMEDOUT';
  const outOfMemory = /heap/i.test(r.stderr || '');
  assert.ok(!timedOut && !outOfMemory, `${tz}: завис — цикл не продвигается (${timedOut ? 'таймаут' : 'кончилась память'})`);
  assert.equal(r.status, 0, `${tz}: ${r.error || r.stderr}`);
  return JSON.parse(r.stdout);
}

test('пояс доходит до дочернего процесса — иначе проверки ниже зелёные впустую', () => {
  for (const z of ZONES) {
    const hours = inZone(z.tz, (core, { back, fwd }) => [back, fwd].map(([y, m, d]) => (new Date(y, m, d + 1) - new Date(y, m, d)) / 3600000), z);
    assert.deepEqual(hours, [z.backH, z.fwdH], z.tz);
  }
});

// --- нарезка записей по дням ------------------------------------------------

function probeSegments({ A }, { day }) {
  const [y, m, d] = day;
  const at = (dd, hh, mm = 0) => new Date(y, m, d + dd, hh, mm).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const cut = (sessions, from, to) => A.sessionSegments([{ id: 't', sessions }], from, to)
    .map((s) => [stamp(s.start), stamp(s.end), Math.round(s.ms / 60000), s.dayIndex, s.crossesDay]);
  const span = (a, b) => [{ start: iso(a), end: iso(b) }];
  const month = A.agendaRange('month', at(0, 12));
  const f = new Date(month.from);
  // Край диапазона Date: следующей полуночи у такой даты нет.
  const EDGE = 8.64e15;
  return {
    late: cut(span(at(0, 23, 30), at(0, 23, 50)), at(0, 0), at(1, 0)),
    // Столбец месяца сверяется с датой, отсчитанной от начала сетки
    // календарём, а не проверяемым кодом.
    lateInMonth: cut(span(at(0, 23, 30), at(0, 23, 50)), month.from, month.to)
      .map(([s, , , idx]) => [s, stamp(new Date(f.getFullYear(), f.getMonth(), f.getDate() + idx))]),
    overnight: cut(span(at(0, 23), at(1, 1, 30)), at(0, 0), at(2, 0)),
    across: cut(span(at(-1, 22), at(1, 2)), at(-1, 0), at(2, 0)),
    // Битые записи: длительность больше, чем вмещает Date, и запись на краю
    // диапазона. Цикл обязан выйти, а куски — остаться числами.
    huge: cut([{ start: iso(at(0, 10)), end: null, ms: 1e300 }], at(0, 0), at(1, 0)),
    edge: A.sessionSegments([{ id: 't', sessions: [{ start: iso(EDGE - 3600000), end: null, ms: 1e9 }] }], EDGE - 7200000, EDGE + 1e9)
      .every((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start),
  };
}

test('sessionSegments: в день перевода часов не зависает и режет сутки по местной полуночи', () => {
  for (const z of ZONES) {
    for (const [day, hours] of [[z.back, z.backH], [z.fwd, z.fwdH]]) {
      const k = (n, hm) => `${keyPlus(day, n)} ${hm}`;
      assert.deepEqual(inZone(z.tz, probeSegments, { day }), {
        // 23:30–23:50 в 25-часовой день — то самое зависание.
        late: [[k(0, '23:30'), k(0, '23:50'), 20, 0, false]],
        lateInMonth: [[k(0, '23:30'), k(0, '00:00')]],
        // Через полночь — кусок до полуночи и кусок после, ровно по полуночи.
        overnight: [[k(0, '23:00'), k(1, '00:00'), 60, 0, true], [k(1, '00:00'), k(1, '01:30'), 90, 1, true]],
        // Через весь день перевода: средний кусок — сутки целиком, 23 или 25 часов.
        across: [
          [k(-1, '22:00'), k(0, '00:00'), 120, 0, true],
          [k(0, '00:00'), k(1, '00:00'), hours * 60, 1, true],
          [k(1, '00:00'), k(1, '02:00'), 120, 2, true],
        ],
        huge: [[k(0, '10:00'), k(1, '00:00'), 14 * 60, 0, true]],
        edge: true,
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- отрезки сетки и шаги -----------------------------------------------------

function probeRanges({ A, V }, { day, year }) {
  const [y, m, d] = day;
  const noon = (dd) => new Date(y, m, d + dd, 12).getTime();
  const show = (r) => [stamp(r.from), stamp(r.to), r.days];
  const midnight = (ms) => stamp(ms).endsWith(' 00:00');
  const dateOf = (from, i) => { const f = new Date(from); return stamp(new Date(f.getFullYear(), f.getMonth(), f.getDate() + i)); };

  // Каждый день года опорным, в каждом режиме: границы — полночи, дни
  // сетки идут подряд без повторов и пропусков, шаг вперёд встаёт ровно
  // на конец текущего отрезка, шаг назад возвращает в него же.
  const bad = [];
  for (let i = 0; new Date(year, 0, 1 + i).getFullYear() === year; i += 1) {
    const a = new Date(year, 0, 1 + i, 12).getTime();
    for (const mode of ['day', 'week', 'month', 'agenda']) {
      const r = A.agendaRange(mode, a);
      const tag = `${mode} ${stamp(a)}`;
      if (!midnight(r.from) || !midnight(r.to)) bad.push(`${tag}: границы ${show(r)}`);
      if (dateOf(r.from, r.days) !== stamp(r.to)) bad.push(`${tag}: ${r.days} дн. не доходят до ${stamp(r.to)}`);
      const starts = V.agendaDays([], { from: r.from, days: r.days, now: a, t: (x) => x, projectColor: () => '' }).map((x) => stamp(x.start));
      starts.forEach((s, i) => { if (s !== dateOf(r.from, i)) bad.push(`${tag}: день ${i} — ${s}`); });
      const next = A.shiftAnchor(mode, a, 1);
      if (mode !== 'month' && A.agendaRange(mode, next).from !== r.to) bad.push(`${tag}: шаг вперёд — ${stamp(next)}`);
      const back = A.shiftAnchor(mode, next, -1);
      if (!(back >= r.from && back < r.to)) bad.push(`${tag}: шаг назад — ${stamp(back)}`);
    }
  }

  // Сроки и призраки повторений встают в столбец своей даты.
  const week = A.agendaRange('week', noon(0));
  const tasks = [{ id: 't', dueAt: new Date(noon(-6)).toISOString(), repeat: { freq: 'day', every: 1 } }];
  const items = A.deadlineItems(tasks, week.from, week.to).concat(A.repeatGhosts(tasks, week.from, week.to));
  items.forEach((x) => { if (dateOf(week.from, x.dayIndex).slice(0, 10) !== stamp(x.at).slice(0, 10)) bad.push(`срок ${stamp(x.at)} в столбце ${x.dayIndex}`); });

  return {
    week: show(week),
    day: show(A.agendaRange('day', noon(0))),
    nextDay: stamp(A.shiftAnchor('day', noon(0), 1)),
    prevDay: stamp(A.shiftAnchor('day', noon(1), -1)),
    nextWeek: stamp(A.shiftAnchor('week', noon(-6), 1)),
    items: items.length,
    bad: bad.slice(0, 10),
  };
}

test('agendaRange и shiftAnchor: на неделе перевода часов границы — местные полуночи, дни подряд', () => {
  for (const z of ZONES) {
    for (const day of [z.back, z.fwd]) {
      const k = (n) => `${keyPlus(day, n)} 00:00`;
      assert.deepEqual(inZone(z.tz, probeRanges, { day, year: day[0] }), {
        // День перевода — воскресенье: неделя с понедельника d−6 до понедельника d+1.
        week: [k(-6), k(1), 7],
        day: [k(0), k(1), 1],
        nextDay: k(1),
        prevDay: k(0),
        nextWeek: k(1),
        items: 7,
        bad: [],
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- геометрия часовой сетки ------------------------------------------------

function probeGrid({ A }, { day }) {
  const [y, m, d] = day;
  const at = (dd, hh, mm = 0) => new Date(y, m, d + dd, hh, mm).getTime();
  const c = A.clampSpan(at(0, 0), at(0, 23, 30), at(1, 2), 15);
  return {
    hour: A.dayFraction(at(0, 23, 30)) * 24,
    back: stamp(A.atDayFraction(at(0, 0), 23.5 / 24)),
    end: stamp(A.atDayFraction(at(0, 0), 1)),
    clamp: [stamp(c.start), stamp(c.end)],
  };
}

test('сетка дня: 23:30 стоит на 23:30, а конец суток — следующая полночь', () => {
  for (const z of ZONES) {
    for (const day of [z.back, z.fwd]) {
      const k = (n, hm) => `${keyPlus(day, n)} ${hm}`;
      assert.deepEqual(inZone(z.tz, probeGrid, { day }), {
        hour: 23.5,
        back: k(0, '23:30'),
        end: k(1, '00:00'),
        clamp: [k(0, '23:30'), k(1, '00:00')],
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- повторения -------------------------------------------------------------

function probeRepeat({ R }, { day }) {
  const [y, m, d] = day;
  const at = (dd, hh) => new Date(y, m, d + dd, hh).getTime();
  return {
    // Со среды перед переводом — «по понедельникам раз в две недели»:
    // понедельник сразу после перевода — уже следующая неделя, не своя.
    biweekly: stamp(R.nextDue({ freq: 'week', every: 2, weekdays: [1] }, at(-4, 10))),
    sunday: stamp(R.nextDue({ freq: 'week', every: 2, weekdays: [0] }, at(-4, 10))),
    daily: R.upcomingDue({ freq: 'day', every: 1 }, at(-1, 10), at(3, 0), 5).map(stamp),
  };
}

test('повторения: на неделе перевода часов «раз в две недели» не срабатывает через одну', () => {
  for (const z of ZONES) {
    for (const day of [z.back, z.fwd]) {
      const k = (n) => `${keyPlus(day, n)} 10:00`;
      assert.deepEqual(inZone(z.tz, probeRepeat, { day }), {
        biweekly: k(8),
        sunday: k(0),
        daily: [k(0), k(1), k(2)],
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- «время работы» ---------------------------------------------------------

function probeSlots({ L }, { day }) {
  const [y, m, d] = day;
  const at = (dd, hh, mm = 0) => new Date(y, m, d + dd, hh, mm).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const show = (occ) => occ.map((o) => [stamp(o.start), stamp(o.end)]);
  // Правило — у задачи (task.repeat), у отрезка своего нет.
  const everyDay = { freq: 'day', every: 1 };
  const daily = { id: 's', start: iso(at(-3, 10)), end: iso(at(-3, 11)) };
  // Начат год назад: прыжок к окну проходит через оба перевода часов.
  const old = { ...daily, start: iso(at(-365, 10)), end: iso(at(-365, 11)) };
  const night = { id: 'n', start: iso(at(0, 23)), end: iso(at(1, 1)) };
  // Задача «каждый день» с двумя отрезками, утренним и вечерним, заведёнными
  // за неделю до перевода: оба идут по правилу задачи в своё время суток.
  const task = {
    id: 'w', repeat: everyDay,
    slots: [{ id: 'am', start: iso(at(-7, 10)), end: iso(at(-7, 11)) }, { id: 'pm', start: iso(at(-7, 18)), end: iso(at(-7, 19)) }],
  };
  // Перекат (b): разовый отрезок накануне перевода едет на день вперёд.
  // Своё время напоминания едет вместе с ним; (c) — на день возврата.
  const roll = L.planTaskRoll({
    id: 't', repeat: { freq: 'day', every: 1 }, remindAt: iso(at(-1, 9, 30)), slots: [{ id: 'o', start: iso(at(-1, 10)), end: iso(at(-1, 11)) }],
  }, at(-1, 12));
  const back = L.planTaskRoll({ id: 'c', repeat: { freq: 'day', every: 1 }, remindAt: iso(at(-1, 9, 30)) }, at(-1, 12));
  return {
    daily: show(L.slotOccurrences(daily, at(-1, 0), at(2, 0), 200, everyDay)),
    old: show(L.slotOccurrences(old, at(-1, 0), at(2, 0), 200, everyDay)),
    night: L.slotItems([{ id: 't', slots: [night] }], at(0, 0), at(2, 0)).map((x) => [stamp(x.start), stamp(x.end), x.dayIndex]),
    task: L.slotItems([task], at(0, 0), at(1, 0)).map((x) => [x.slotId, stamp(x.start), stamp(x.end), x.dayIndex, x.recurring]),
    roll: [stamp(Date.parse(roll.patch.slots[0].start)), stamp(Date.parse(roll.patch.slots[0].end))],
    remind: [roll.patch.remindAt, back.patch.remindAt, back.patch.reopenAt].map((v) => stamp(Date.parse(v))),
  };
}

test('время работы: в день перевода часов отрезок стоит на своём времени суток', () => {
  for (const z of ZONES) {
    for (const day of [z.back, z.fwd]) {
      const k = (n, hm) => `${keyPlus(day, n)} ${hm}`;
      const tenToEleven = (n) => [k(n, '10:00'), k(n, '11:00')];
      assert.deepEqual(inZone(z.tz, probeSlots, { day }), {
        daily: [tenToEleven(-1), tenToEleven(0), tenToEleven(1)],
        old: [tenToEleven(-1), tenToEleven(0), tenToEleven(1)],
        night: [[k(0, '23:00'), k(1, '00:00'), 0], [k(1, '00:00'), k(1, '01:00'), 1]],
        task: [['am', ...tenToEleven(0), 0, true], ['pm', k(0, '18:00'), k(0, '19:00'), 0, true]],
        roll: tenToEleven(0),
        remind: [k(0, '09:30'), k(0, '09:30'), k(0, '00:00')],
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- напоминания списком ----------------------------------------------------

function probeReminders({ M }, { day, nightTime }) {
  const [y, m, d] = day;
  const at = (dd, hh, mm = 0) => new Date(y, m, d + dd, hh, mm).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const show = (list) => list.map((e) => stamp(e.at));
  const opts = { horizonMs: 3 * 86400000 };
  // «За 15 минут до начала» ежедневного отрезка 10–11, заведённого год назад:
  // прыжок к окну проходит через оба перевода часов.
  // Правило — у задачи, у отрезка своего нет.
  const work = {
    id: 'w', repeat: { freq: 'day', every: 1 }, slots: [{ id: 's', start: iso(at(-365, 10)), end: iso(at(-365, 11)) }],
    reminders: [{ id: 'b', kind: 'before', anchor: 'start', offsetMin: 15 }],
  };
  // «Каждый день в 09:00» и «каждое воскресенье» в час, которого в день
  // перевода вперёд нет: вхождение встаёт на час позже, а следующее
  // возвращается на своё время.
  const daily = { id: 'r', reminders: [{ id: 'p', kind: 'repeat', rule: { freq: 'day', every: 1 }, time: '09:00', start: iso(at(-400, 12)) }] };
  const night = { id: 'n', reminders: [{ id: 'q', kind: 'repeat', rule: { freq: 'week', every: 1, weekdays: [0] }, time: nightTime, start: iso(at(-14, 12)) }] };
  return {
    before: show(M.pendingReminders([work], at(-1, 12), opts)),
    beforeDue: show(M.remindersDue([work], at(0, 9, 50))),
    repeat: show(M.pendingReminders([daily], at(-1, 12), opts)),
    repeatDue: show(M.remindersDue([daily], at(0, 9, 5))),
    night: show(M.pendingReminders([night], at(-8, 12), { horizonMs: 16 * 86400000 })),
  };
}

test('напоминания: в день перевода часов «до начала» и «повторять» звучат в своё время суток', () => {
  for (const z of ZONES) {
    for (const day of [z.back, z.fwd]) {
      const k = (n, hm) => `${keyPlus(day, n)} ${hm}`;
      // Несуществующий час дня перевода вперёд: в Нью-Йорке — 02:00–03:00,
      // в Киеве — 03:00–04:00; в Алматы перевода нет.
      const [nightTime, later] = z.tz === 'Europe/Kyiv' ? ['03:30', '04:30'] : ['02:30', '03:30'];
      const gap = day === z.fwd && z.fwdH === 23;
      assert.deepEqual(inZone(z.tz, probeReminders, { day, nightTime }), {
        before: [k(0, '09:45'), k(1, '09:45'), k(2, '09:45')],
        beforeDue: [k(0, '09:45')],
        repeat: [k(0, '09:00'), k(1, '09:00'), k(2, '09:00')],
        repeatDue: [k(0, '09:00')],
        night: [k(-7, nightTime), k(0, gap ? later : nightTime), k(7, nightTime)],
      }, `${z.tz}, ${keyPlus(day, 0)}`);
    }
  }
});

// --- правило в исходниках ---------------------------------------------------

test('календарные дни нигде не считаются сутками в миллисекундах', () => {
  // Сдвиг на день — только addDaysMs ядра (на телефоне — addDays из
  // calendarMath, обёртка над ним), конец дня — следующая полночь, а не
  // «плюс 24 часа». Сутки в миллисекундах остаются там, где это длительность,
  // а не календарь: «до срока меньше суток», горизонт поиска сроков.
  const fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  const ALLOWED = [
    ['src/renderer/core/due.js', 'at = due - DAY'],
    ['src/renderer/app.js', 'base + (400 * 86400000)'],
    ['mobile/src/components/RepeatSheet.js', 'base + 400 * 86400000'],
  ];
  const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(ROOT, 'src/renderer/core')).filter((f) => f.endsWith('.js')).map((f) => `src/renderer/core/${f}`)];
  // Телефон — кроме копий ядра (их сверяет mobile-core.test.js) и собранного редактора.
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!['core', 'editor'].includes(e.name)) walk(rel); } else if (rel.endsWith('.js')) files.push(rel);
    }
  };
  walk('mobile/src');
  const DAY_MATH = /[-+]\s*\(?\s*(?:[\w.]+\s*\*\s*)?(?:\b(?:Core|Agenda|A)\.DAY\b|\bDAY\b|86_?400_?000)|(?:86_?400_?000|\bDAY\b)\s*\*|24\s*\*\s*3_?600_?000|24\s*\*\s*60\s*\*\s*60/;
  const found = [];
  for (const file of files) {
    fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line) || !DAY_MATH.test(line)) return;
      if (ALLOWED.some(([f, s]) => f === file && line.includes(s))) return;
      found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, [], `сутки в миллисекундах вместо календаря:\n  ${found.join('\n  ')}`);
});

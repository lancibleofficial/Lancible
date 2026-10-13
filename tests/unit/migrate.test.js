// Миграция сохранённых данных — самая опасная функция в приложении: она
// трогает всё, что накопил пользователь, при каждом запуске, и её ошибку уже
// не откатить. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../../src/renderer/core/migrate.js');

const PALETTE = ['#111', '#222', '#333'];
const CURRENCIES = { RUB: '₽', USD: '$', EUR: '€' };
const SYM2CODE = { '₽': 'RUB', $: 'USD', '€': 'EUR' };

/** Свежий генератор идентификаторов на каждый прогон — иначе тесты начнут
 *  зависеть друг от друга через общий счётчик. */
function deps() {
  let n = 0;
  return {
    t: (key) => key,
    uid: () => 'u' + (++n),
    langs: ['ru', 'en', 'uk', 'kk'],
    palette: PALETTE,
    currencies: CURRENCIES,
    sym2code: SYM2CODE,
    defaultProjectNameKey: 'app.default_project_name',
  };
}

test('пустое состояние обрастает всеми полями', () => {
  const s = migrate({}, deps());
  assert.deepEqual(s.tasks, []);
  assert.deepEqual(s.projects, []);
  assert.deepEqual(s.statuses, []);
  assert.deepEqual(s.tags, []);
  assert.deepEqual(s.versions, []);
  assert.equal(s.settings.hourlyRate, 0);
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.settings.lang, 'ru');
  assert.equal(s.settings.currency, 'RUB');
  assert.equal(s.settings.syncEnabled, true);
});

test('поля интерфейса ядро не трогает — их чинит платформа через крючок', () => {
  // navCollapsed и notifSeenAt раньше чинились здесь, а boardCollapsed и
  // подсказка про свайп — в миграции телефона. Это поля разных экранов, и
  // общими они быть не могут. Ядро даёт им место и список живых проектов,
  // без которого не проверить ссылки.
  const seen = [];
  const s = migrate(
    { projects: [{ id: 'p1', name: 'П', createdAt: '2026-06-10T12:00:00.000Z' }], ui: { своё: 1 } },
    { ...deps(), ui: (state, info) => { seen.push(info); state.ui.своё = 2; } },
  );
  assert.equal(seen.length, 1, 'крючок зовётся ровно один раз');
  assert.deepEqual([...seen[0].known], ['p1'], 'крючку известно, какие проекты живы');
  assert.equal(seen[0].fallback, 'p1');
  assert.equal(s.ui.своё, 2, 'правки крючка остаются в состоянии');
  assert.equal(s.ui.navCollapsed, undefined, 'ядро не придумывает чужих полей');
});

test('мусор вместо массивов заменяется пустыми массивами, а не роняет запуск', () => {
  const s = migrate({ tasks: 'сломалось', projects: null, statuses: 42, settings: 'нет' }, deps());
  assert.deepEqual(s.tasks, []);
  assert.deepEqual(s.projects, []);
  assert.deepEqual(s.statuses, []);
  assert.equal(typeof s.settings, 'object');
});

test('валюта из символа переводится в код', () => {
  assert.equal(migrate({ settings: { currency: '₽' } }, deps()).settings.currency, 'RUB');
  assert.equal(migrate({ settings: { currency: '$' } }, deps()).settings.currency, 'USD');
  assert.equal(migrate({ settings: { currency: 'USD' } }, deps()).settings.currency, 'USD', 'код остаётся кодом');
  assert.equal(migrate({ settings: { currency: 'ВЫДУМКА' } }, deps()).settings.currency, 'RUB');
});

test('неизвестный язык откатывается на русский', () => {
  assert.equal(migrate({ settings: { lang: 'fr' } }, deps()).settings.lang, 'ru');
  assert.equal(migrate({ settings: { lang: 'kk' } }, deps()).settings.lang, 'kk');
});

test('проект без статусов получает набор по умолчанию', () => {
  const s = migrate({ projects: [{ id: 'p1', name: 'Проект' }] }, deps());
  assert.equal(s.statuses.length, 6);
  assert.ok(s.statuses.every((st) => st.projectId === 'p1'));
});

test('у каждого проекта свой набор статусов', () => {
  const s = migrate({ projects: [{ id: 'p1' }, { id: 'p2' }] }, deps());
  assert.equal(s.statuses.filter((st) => st.projectId === 'p1').length, 6);
  assert.equal(s.statuses.filter((st) => st.projectId === 'p2').length, 6);
  const ids = new Set(s.statuses.map((st) => st.id));
  assert.equal(ids.size, 12, 'идентификаторы не должны совпадать между проектами');
});

test('общие статусы старой версии разводятся по проектам вместе с задачами', () => {
  // Это главный переход в истории данных: раньше набор был один на всё
  // приложение. Если задача не переедет на копию статуса своего проекта, она
  // молча сбросится в «к выполнению» — и пользователь потеряет состояние
  // работы, ничего об этом не узнав.
  const s = migrate({
    projects: [{ id: 'p1' }, { id: 'p2' }],
    statuses: [
      { id: 'old-todo', kind: 'todo', order: 0, name: 'К выполнению', builtin: true },
      { id: 'old-done', kind: 'done', order: 1, name: 'Готово', builtin: true },
    ],
    tasks: [
      { id: 't1', projectId: 'p1', statusId: 'old-done', done: true },
      { id: 't2', projectId: 'p2', statusId: 'old-todo', done: false },
    ],
  }, deps());

  assert.ok(s.statuses.every((st) => st.projectId), 'общих статусов остаться не должно');
  assert.equal(s.statuses.length, 4, 'по две копии на каждый из двух проектов');

  const byId = new Map(s.statuses.map((st) => [st.id, st]));
  const t1 = s.tasks.find((t) => t.id === 't1');
  const t2 = s.tasks.find((t) => t.id === 't2');
  assert.equal(byId.get(t1.statusId).projectId, 'p1', 'задача перешла на статус своего проекта');
  assert.equal(byId.get(t1.statusId).kind, 'done', 'и сохранила состояние');
  assert.equal(byId.get(t2.statusId).projectId, 'p2');
  assert.equal(byId.get(t2.statusId).kind, 'todo');
});

test('задача с несуществующим статусом получает статус по умолчанию своего проекта', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    tasks: [{ id: 't1', projectId: 'p1', statusId: 'призрак', done: false }],
  }, deps());
  const st = s.statuses.find((x) => x.id === s.tasks[0].statusId);
  assert.ok(st, 'статус должен существовать');
  assert.equal(st.kind, 'todo');
  assert.equal(st.projectId, 'p1');
});

test('выполненная задача попадает в статус вида done', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    tasks: [{ id: 't1', projectId: 'p1', done: true }],
  }, deps());
  const st = s.statuses.find((x) => x.id === s.tasks[0].statusId);
  assert.equal(st.kind, 'done');
  assert.equal(s.tasks[0].cancelled, false, 'выполненная — не отменённая');
});

test('статус неизвестного вида чинится до «к выполнению»', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [{ id: 'a', projectId: 'p1', kind: 'выдумка', order: 0, name: 'Странный' }],
  }, deps());
  assert.equal(s.statuses[0].kind, 'todo');
});

test('статусы удалённого проекта не остаются висеть', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [
      { id: 'a', projectId: 'p1', kind: 'todo', order: 0 },
      { id: 'b', projectId: 'удалённый', kind: 'todo', order: 0 },
    ],
  }, deps());
  assert.ok(s.statuses.every((st) => st.projectId === 'p1'));
});

test('порядок статусов пересчитывается подряд, без дыр', () => {
  const s = migrate({
    projects: [{ id: 'p1' }],
    statuses: [
      { id: 'a', projectId: 'p1', kind: 'todo', order: 10 },
      { id: 'b', projectId: 'p1', kind: 'progress', order: 30 },
      { id: 'c', projectId: 'p1', kind: 'done', order: 20 },
    ],
  }, deps());
  const ordered = s.statuses.slice().sort((x, y) => x.order - y.order);
  assert.deepEqual(ordered.map((st) => st.id), ['a', 'c', 'b']);
  assert.deepEqual(ordered.map((st) => st.order), [0, 1, 2]);
});

test('ссылки на удалённые теги вычищаются', () => {
  const s = migrate({
    projects: [{ id: 'p1', tagIds: ['tag1', 'удалённый'] }],
    tasks: [{ id: 't1', projectId: 'p1', tagIds: ['удалённый'] }],
    tags: [{ id: 'tag1', name: 'Срочное' }],
  }, deps());
  assert.deepEqual(s.projects[0].tagIds, ['tag1']);
  assert.deepEqual(s.tasks[0].tagIds, []);
});

test('задача без проекта привязывается к первому, а не теряется', () => {
  const s = migrate({
    projects: [{ id: 'p1' }, { id: 'p2' }],
    tasks: [{ id: 't1', projectId: 'исчез' }, { id: 't2' }],
  }, deps());
  assert.ok(s.tasks.every((t) => t.projectId === 'p1'));
});

test('задачи без единого проекта получают проект, а не пропадают', () => {
  const s = migrate({ tasks: [{ id: 't1', projectId: 'нет' }] }, deps());
  assert.equal(s.projects.length, 1);
  assert.equal(s.tasks[0].projectId, s.projects[0].id);
});

// Найдено при написании этих тестов, не чинится до отдельного решения.
// Проект-спасатель создаётся в самом конце migrate, когда набор статусов уже
// роздан всем остальным, — и остаётся без единого столбца. Задача внутри него
// получает statusId: null, то есть не попадает ни в один столбец доски.
// Случай редкий (все проекты пропали, задачи остались), но данные при этом
// уже повреждены, и молча жить с этим неправильно.
test('задача в проекте-спасателе должна иметь статус', { todo: 'известная недоработка' }, () => {
  const s = migrate({ tasks: [{ id: 't1', projectId: 'нет', done: false }] }, deps());
  assert.ok(s.statuses.length > 0, 'у проекта-спасателя нет статусов');
  assert.ok(
    s.statuses.some((st) => st.id === s.tasks[0].statusId),
    'задача осталась со статусом, которого не существует',
  );
});

test('повторная миграция ничего не меняет', () => {
  // Миграция выполняется при каждом запуске. Если второй прогон что-то
  // меняет, значит данные «плывут» сами по себе — например, статусы
  // размножаются с каждым открытием приложения.
  const start = {
    projects: [{ id: 'p1', name: 'Проект' }, { id: 'p2' }],
    tasks: [
      { id: 't1', projectId: 'p1', done: true },
      { id: 't2', projectId: 'p2', done: false },
      // Свой повтор у отрезка (данные разработки) переходит задаче один раз:
      // второй прогон не находит его и не отдаёт задаче второе правило.
      {
        id: 't3', projectId: 'p1', done: false,
        slots: [
          { id: 'a', start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z', repeat: { freq: 'week', every: 1, weekdays: [1] } },
          { id: 'b', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T10:00:00.000Z', repeat: { freq: 'day', every: 1 } },
        ],
      },
    ],
    tags: [{ id: 'tag1', name: 'Срочное' }],
    settings: { currency: '₽', lang: 'en', hourlyRate: 1500 },
  };
  const once = migrate(JSON.parse(JSON.stringify(start)), deps());
  const twice = migrate(JSON.parse(JSON.stringify(once)), deps());
  assert.deepEqual(twice, once);
  const t3 = once.tasks.find((x) => x.id === 't3');
  assert.deepEqual([t3.repeat.freq, t3.repeat.weekdays], ['week', [1]], 'первое правило — задаче');
  assert.ok(t3.slots.every((sl) => !('repeat' in sl)), 'с отрезков снято');
});

test('миграция не придумывает данные на пустом месте', () => {
  const s = migrate({}, deps());
  assert.equal(s.projects.length, 0, 'без задач проект создавать незачем');
  assert.equal(s.statuses.length, 0);
});

test('битое время задачи чинится, а не роняет подсчёт', () => {
  // Правило пришло с телефона, где оно было, а у десктопа его не было:
  // задача с sessions: null роняла первый же подсчёт — sessionsOf зовёт
  // .filter. Приехать такое может из синхронизации или из правленого
  // руками файла данных.
  const s = migrate({
    projects: [{ id: 'p1', name: 'П', createdAt: '2026-06-10T12:00:00.000Z' }],
    tasks: [
      { id: 'a', projectId: 'p1', sessions: null, totalMs: 'много' },
      { id: 'b', projectId: 'p1', sessions: [{ ms: 5 }], totalMs: 5 },
    ],
  }, deps());
  assert.deepEqual(s.tasks[0].sessions, []);
  assert.equal(s.tasks[0].totalMs, 0);
  assert.deepEqual(s.tasks[1].sessions, [{ ms: 5 }], 'целые записи не трогаются');
  assert.equal(s.tasks[1].totalMs, 5);
});

// --- теги проекта, ставка и валюта проекта (с 7 октября 2026) ------------------

test('тег без projectId — общий, тег исчезнувшего проекта убирается', () => {
  const s = migrate({
    projects: [{ id: 'p1', name: 'A' }],
    tags: [{ id: 'g', name: 'Общий' }, { id: 't1', name: 'Свой', projectId: 'p1' }, { id: 'dead', name: 'Ничей', projectId: 'gone' }],
    tasks: [{ id: 'a', projectId: 'p1', tagIds: ['g', 't1', 'dead'] }],
  }, deps());
  assert.deepEqual(s.tags.map((tg) => [tg.id, tg.projectId]), [['g', null], ['t1', 'p1']]);
  assert.deepEqual(s.tasks[0].tagIds, ['g', 't1'], 'ссылка на убранный тег вычищена');
});

test('ставка и валюта проекта: пусто — общие, символ валюты переводится в код', () => {
  const s = migrate({
    projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B', rate: '2500', currency: '$' }, { id: 'p3', name: 'C', rate: 'abc', currency: 'XXX' }],
  }, deps());
  assert.deepEqual(s.projects.map((p) => [p.rate, p.currency]), [[null, null], [2500, 'USD'], [null, null]]);
});

test('документы: без поля — пустой список, битые выброшены, сирота — общий', () => {
  const run = (st) => require('../../src/renderer/core/migrate.js').migrate(st, deps());
  const a = run({ projects: [], tasks: [] });
  assert.deepEqual(a.documents, []);
  const b = run({ projects: [{ id: 'p1', name: 'X' }], tasks: [], documents: [null, { title: 'без id' }, { id: 'd1', projectId: 'gone' }, { id: 'd2', projectId: 'p1', title: 'Ок' }] });
  assert.deepEqual(b.documents.map((d) => [d.id, d.projectId, d.title]), [['d1', null, ''], ['d2', 'p1', 'Ок']]);
  // Повторный прогон ничего не меняет.
  const again = JSON.stringify(b.documents);
  run(b);
  assert.equal(JSON.stringify(b.documents), again);
});

// --- «время работы» и возврат повторяющейся задачи (с 11 октября 2026) ---------

/** Задачи с отрезками в каждом виде, в каком их может прислать синхронизация:
 *  без id, с ненормализованным правилом, битые, с чужими ключами. */
function withSlots() {
  return {
    projects: [{ id: 'p1', name: 'П' }],
    tasks: [
      {
        id: 't1', projectId: 'p1', done: false, reopenAt: '2026-10-12T00:00:00.000Z', будущее: { x: 1 },
        slots: [
          { start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z', repeat: { freq: 'week', every: '2', weekdays: [3, 1, 1] }, remindOffsetMin: 15 },
          { id: 'keep', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T11:00:00.000Z', своё: 'да' },
          { start: 'когда-нибудь', end: '2026-10-13T11:00:00.000Z' },
          { start: '2026-10-13T11:00:00.000Z', end: '2026-10-13T10:00:00.000Z' },
          null,
        ],
      },
      { id: 't2', projectId: 'p1', done: true, repeat: { freq: 'day', every: 1 }, reopenAt: '2026-10-12T00:00:00.000Z' },
      { id: 't3', projectId: 'p1', done: true, reopenAt: 'не дата', slots: 'сломано' },
      { id: 't4', projectId: 'p1', done: false },
      // Своё правило у задачи есть — правило отрезка отбрасывается.
      {
        id: 't5', projectId: 'p1', done: false, repeat: { freq: 'month', every: 1 },
        slots: [{ id: 'm', start: '2026-10-14T09:00:00.000Z', end: '2026-10-14T10:00:00.000Z', repeat: { freq: 'day', every: 1 } }],
      },
      // Два отрезка со своими правилами: задаче достаётся первое, второе — в
      // никуда. Правило у битого отрезка не в счёт.
      {
        id: 't6', projectId: 'p1', done: false,
        slots: [
          { id: 'bad', start: 'x', end: 'y', repeat: { freq: 'year', every: 1 } },
          { id: 'one', start: '2026-10-15T09:00:00.000Z', end: '2026-10-15T10:00:00.000Z', repeat: null },
          { id: 'first', start: '2026-10-16T09:00:00.000Z', end: '2026-10-16T10:00:00.000Z', repeat: { freq: 'day', every: 3, from: 'done', keepHistory: true, done: 4 } },
          { id: 'second', start: '2026-10-17T09:00:00.000Z', end: '2026-10-17T10:00:00.000Z', repeat: { freq: 'week', every: 1 } },
        ],
      },
    ],
  };
}

test('отрезки: битые выброшены, id выдан тем, у кого его нет', () => {
  const s = migrate(withSlots(), deps());
  const [t1, , t3, t4] = s.tasks;
  assert.equal(t1.slots.length, 2);
  assert.match(t1.slots[0].id, /^u\d+$/, 'новый id из генератора');
  assert.equal(t1.slots[1].id, 'keep', 'свой id не меняется');
  assert.equal(t1.slots[1].своё, 'да', 'чужой ключ отрезка уцелел');
  assert.deepEqual(t3.slots, [], 'мусор вместо списка — пустой список');
  assert.equal(t4.slots, undefined, 'поля не было — и не появилось: читается через slotsOf');
});

// Повтор у задачи один (с 12 октября 2026, как у события в Google
// Календаре). Свой повтор у отрезка бывал только в данных разработки.
test('отрезки: своё правило отрезка переходит задаче, если у неё нет своего, и снимается со всех', () => {
  const s = migrate(withSlots(), deps());
  const byId = Object.fromEntries(s.tasks.map((x) => [x.id, x]));
  const noRepeat = (t) => t.slots.every((sl) => !('repeat' in sl));
  // t1: правило было у первого отрезка, ненормализованное.
  assert.deepEqual(byId.t1.repeat.weekdays, [1, 3]);
  assert.equal(byId.t1.repeat.every, 2);
  assert.equal(byId.t1.repeat.freq, 'week');
  assert.ok(noRepeat(byId.t1));
  // t5: у задачи своё — оно и остаётся.
  assert.deepEqual(byId.t5.repeat, { freq: 'month', every: 1 }, 'правило задачи не тронуто');
  assert.ok(noRepeat(byId.t5));
  // t6: первое правило целого отрезка; from, keepHistory и done у отрезка
  // ничего не значили — у задачи они по умолчанию.
  assert.deepEqual([byId.t6.repeat.freq, byId.t6.repeat.every, byId.t6.repeat.from, byId.t6.repeat.keepHistory, byId.t6.repeat.done],
    ['day', 3, 'schedule', false, 0]);
  assert.deepEqual(byId.t6.slots.map((sl) => sl.id), ['one', 'first', 'second'], 'битый выброшен, остальные на месте');
  assert.ok(noRepeat(byId.t6), 'второе правило отброшено');
  assert.equal(byId.t4.repeat, null, 'без отрезков — без правила');
});

test('возврат: у открытой задачи и битый — снят, у закрытой — цел', () => {
  const s = migrate(withSlots(), deps());
  const [t1, t2, t3, t4] = s.tasks;
  assert.equal(t1.reopenAt, null, 'открытая задача ничего не ждёт');
  assert.equal(t2.reopenAt, '2026-10-12T00:00:00.000Z');
  assert.equal(t3.reopenAt, null);
  assert.equal(t4.reopenAt, undefined);
});

test('неизвестное поле задачи переживает миграцию', () => {
  const s = migrate(withSlots(), deps());
  assert.deepEqual(s.tasks[0].будущее, { x: 1 });
});

test('повторная миграция с отрезками ничего не меняет, id выдаются ровно раз', () => {
  const once = migrate(withSlots(), deps());
  const ids = once.tasks[0].slots.map((sl) => sl.id);
  // Свежий генератор начал бы с тех же u1, u2 — поэтому второй прогон с
  // генератором, который не должен быть вызван для отрезков вовсе.
  let calls = 0;
  const twice = migrate(JSON.parse(JSON.stringify(once)), { ...deps(), uid: () => { calls += 1; return `x${calls}`; } });
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.tasks[0].slots.map((sl) => sl.id), ids);
  assert.equal(calls, 0, 'второй прогон новых id не выдаёт');
});

// --- напоминания списком (с 11 октября 2026) -----------------------------------
// Список task.reminders (core/reminders.js) появляется из старых полей, принимает
// правки старых клиентов (десктоп 0.4.3 и телефон 1.2.2 знают только
// remindOffsetMin, remindAt и notifiedAt) и забирает смещения у отрезков из
// данных разработки.

const DUE = '2026-10-20T15:00:00.000Z';
const slotAt = (id, day, extra) => ({ id, start: `2026-10-${day}T09:00:00.000Z`, end: `2026-10-${day}T10:00:00.000Z`, ...extra });

function withReminders() {
  return {
    projects: [{ id: 'p1', name: 'П' }],
    tasks: [
      { id: 'off', projectId: 'p1', dueAt: DUE, remindOffsetMin: 120, notifiedAt: '2026-10-20T13:00:05.000Z' },
      { id: 'own', projectId: 'p1', remindAt: '2026-10-14T09:00:00Z' },
      { id: 'none', projectId: 'p1' },
      {
        id: 'dev', projectId: 'p1',
        slots: [
          slotAt('a', 14, { remindOffsetMin: 15, notifiedUpTo: '2026-10-14T09:00:00.000Z' }),
          slotAt('b', 15, { remindOffsetMin: 15 }),
          slotAt('c', 16, { remindOffsetMin: 60 }),
          slotAt('d', 17, { remindOffsetMin: null }),
        ],
        reminders: [{ id: 'mine', kind: 'before', anchor: 'start', offsetMin: 60, unit: 'hour', notifiedUpTo: null }],
      },
      {
        id: 'list', projectId: 'p1', dueAt: DUE, remindOffsetMin: 30, remindAt: null,
        reminders: [
          { id: 'x', kind: 'at', at: '2026-10-18T08:00:00.000Z', notifiedAt: null, своё: 1 },
          { id: 'y', kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min', notifiedUpTo: null },
          { kind: 'repeat', rule: { freq: 'week', weekdays: [3, 1] }, time: '9:05', start: '2026-10-12T06:00:00.000Z' },
          { id: 'z', kind: 'мусор' },
          null,
        ],
      },
    ],
  };
}

const taskOf = (s, id) => s.tasks.find((x) => x.id === id);

test('напоминания: список создаётся из старых полей, старые поля остаются его зеркалом', () => {
  const s = migrate(withReminders(), deps());
  assert.deepEqual(taskOf(s, 'off').reminders, [
    { id: 'legacy-due', kind: 'before', anchor: 'due', offsetMin: 120, unit: 'hour', notifiedUpTo: DUE },
  ], 'старый клиент уже напомнил — отметка переехала в список');
  assert.equal(taskOf(s, 'off').remindOffsetMin, 120);
  assert.deepEqual(taskOf(s, 'own').reminders, [
    { id: 'legacy-at', kind: 'at', at: '2026-10-14T09:00:00.000Z', notifiedAt: null },
  ]);
  assert.equal(taskOf(s, 'own').remindAt, '2026-10-14T09:00:00.000Z', 'зеркало пишется в приведённом виде');
  assert.deepEqual(taskOf(s, 'none').reminders, []);
  assert.equal(taskOf(s, 'none').remindOffsetMin, null);
});

test('напоминания: смещения у отрезков (данные разработки) уходят в «до начала» без дублей и снимаются с отрезков', () => {
  const dev = taskOf(migrate(withReminders(), deps()), 'dev');
  assert.deepEqual(dev.reminders.map((r) => [r.id, r.anchor, r.offsetMin, r.notifiedUpTo]), [
    ['mine', 'start', 60, null], // 60 уже было в списке — второго не заводим
    ['legacy-start-15', 'start', 15, '2026-10-14T09:00:00.000Z'], // одно на оба отрезка, отметка — самая поздняя
  ]);
  assert.deepEqual(dev.slots.map((sl) => sl.id), ['a', 'b', 'c', 'd'], 'отрезки целы');
  assert.ok(dev.slots.every((sl) => !('remindOffsetMin' in sl)), 'поле у отрезков снято');
});

test('напоминания: список приводится к виду — мусор выброшен, чужие ключи целы, id выдан', () => {
  const list = taskOf(migrate(withReminders(), deps()), 'list');
  assert.deepEqual(list.reminders.map((r) => [r.id, r.kind]), [['x', 'at'], ['y', 'before'], ['r1', 'repeat']]);
  assert.equal(list.reminders[0].своё, 1);
  assert.equal(list.reminders[2].time, '09:05');
  assert.deepEqual(list.reminders[2].rule.weekdays, [1, 3]);
  assert.equal(list.remindOffsetMin, 30, 'зеркало: первое «до дедлайна»');
  assert.equal(list.remindAt, null);
});

test('напоминания: повторная миграция ничего не меняет', () => {
  const once = migrate(withReminders(), deps());
  const twice = migrate(JSON.parse(JSON.stringify(once)), deps());
  assert.deepEqual(twice, once);
});

test('напоминания: правка старого клиента ложится в список — смещение сменили, сняли, поставили своё время', () => {
  const base = migrate(withReminders(), deps());
  const edit = (patch) => {
    const s = JSON.parse(JSON.stringify(base));
    Object.assign(taskOf(s, 'list'), patch);
    const out = taskOf(migrate(s, deps()), 'list');
    // И после правки повторный прогон ничего не меняет.
    assert.deepEqual(taskOf(migrate(JSON.parse(JSON.stringify(s)), deps()), 'list'), out);
    return out;
  };
  // Старый клиент снимает notifiedAt на любой правке напоминания.
  const changed = edit({ remindOffsetMin: 60, notifiedAt: null });
  assert.deepEqual(changed.reminders.map((r) => [r.id, r.kind, r.offsetMin]), [['x', 'at', undefined], ['y', 'before', 60], ['r1', 'repeat', undefined]],
    'зеркальное «до дедлайна» стало часом, остальные целы');
  assert.equal(changed.reminders[1].unit, 'hour');

  const cleared = edit({ remindOffsetMin: null, notifiedAt: null });
  assert.deepEqual(cleared.reminders.map((r) => r.id), ['x', 'r1'], 'сняли — зеркальное ушло');
  assert.equal(cleared.remindAt, '2026-10-18T08:00:00.000Z', 'зеркалом стало следующее — «в своё время»');

  const own = edit({ remindOffsetMin: null, remindAt: '2026-10-19T07:30:00.000Z', notifiedAt: null });
  assert.deepEqual(own.reminders.map((r) => [r.id, r.kind, r.at || null]), [
    ['y', 'at', '2026-10-19T07:30:00.000Z'], ['x', 'at', '2026-10-18T08:00:00.000Z'], ['r1', 'repeat', null],
  ], 'смещение сменили на своё время — зеркальное стало «в своё время» и встало первым, чтобы остаться зеркалом');
  assert.equal(own.remindOffsetMin, null);
  assert.equal(own.remindAt, '2026-10-19T07:30:00.000Z');

  // Без зеркального в списке своё время старого клиента добавляется.
  const s = JSON.parse(JSON.stringify(base));
  Object.assign(taskOf(s, 'dev'), { remindAt: '2026-10-19T07:30:00.000Z' });
  const dev = taskOf(migrate(s, deps()), 'dev');
  assert.deepEqual(dev.reminders.map((r) => r.id), ['mine', 'legacy-start-15', 'legacy-at']);
});

// --- снятый цвет акцента (11 октября 2026) -------------------------------------
// Акцент сменился с #87ff65 на #69d345. Новые проекты и статусы «Готово» уже
// получают новый, а у накопленных данных сохранён старый: их перекрашиваем при
// загрузке, и так же — при приёме из облака, откуда старая версия приложения
// всё ещё может прислать прежний цвет.

const OLD_ACCENT = '#87ff65';
const NEW_ACCENT = '#69d345';

/** Состояние со снятым цветом во всех местах, где он мог сохраниться, и с
 *  чужими цветами рядом — их трогать нельзя. */
function withOldAccent() {
  return {
    projects: [
      { id: 'p1', name: 'Сайт', color: OLD_ACCENT },
      { id: 'p2', name: 'Заглавные', color: '#87FF65' },
      { id: 'p3', name: 'С пробелами', color: ' #87Ff65 ' },
      { id: 'p4', name: 'Голубой', color: '#5ec8f2' },
      { id: 'p5', name: 'Почти тот же', color: '#87ff66' },
    ],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'Готово', color: OLD_ACCENT, kind: 'done', order: 0, builtin: true },
      { id: 's2', projectId: 'p1', name: 'Моё', color: '#f5c451', kind: 'todo', order: 1, builtin: false },
      { id: 's3', projectId: 'p2', name: 'Готово', color: '#87FF65', kind: 'done', order: 0, builtin: true },
    ],
    tags: [
      { id: 'g1', name: 'Старый', color: OLD_ACCENT },
      { id: 'g2', name: 'Свой', color: '#b98cf0' },
      { id: 'g3', name: 'Новый', color: NEW_ACCENT },
    ],
    tasks: [],
  };
}

test('старый акцент у проектов, статусов и тегов становится новым, чужие цвета целы', () => {
  const s = migrate(withOldAccent(), deps());
  assert.deepEqual(s.projects.map((p) => p.color), [NEW_ACCENT, NEW_ACCENT, NEW_ACCENT, '#5ec8f2', '#87ff66']);
  const status = (id) => s.statuses.find((st) => st.id === id);
  assert.equal(status('s1').color, NEW_ACCENT);
  assert.equal(status('s2').color, '#f5c451', 'чужой цвет статуса не тронут');
  assert.equal(status('s3').color, NEW_ACCENT, 'регистр не важен');
  assert.deepEqual(s.tags.map((tg) => tg.color), [NEW_ACCENT, '#b98cf0', NEW_ACCENT]);
  // Ни одного старого цвета не осталось ни у одной записи.
  const left = [...s.projects, ...s.statuses, ...s.tags].filter((x) => String(x.color).trim().toLowerCase() === OLD_ACCENT);
  assert.deepEqual(left, []);
});

test('общие статусы старой версии со старым акцентом разводятся по проектам уже новыми', () => {
  const s = migrate({
    projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    statuses: [{ id: 'old1', name: 'Готово', color: OLD_ACCENT, kind: 'done', order: 0 }],
  }, deps());
  assert.deepEqual(s.statuses.map((st) => [st.projectId, st.color]), [['p1', NEW_ACCENT], ['p2', NEW_ACCENT]]);
});

test('перекраска идемпотентна: второй прогон ничего не меняет', () => {
  const once = migrate(withOldAccent(), deps());
  const twice = migrate(JSON.parse(JSON.stringify(once)), deps());
  assert.deepEqual(twice, once);
});

test('перекраска не трогает ничего, кроме поля цвета у проектов, статусов и тегов', () => {
  const { renewColors } = require('../../src/renderer/core/migrate.js');
  // Цвет внутри содержимого и у записей без такого поля — не свойство записи.
  const state = {
    projects: [{ id: 'p1', name: OLD_ACCENT, description: OLD_ACCENT, color: 42 }, null, 'мусор'],
    statuses: null,
    tags: [{ id: 'g', name: 'Без цвета' }],
    versions: [{ id: 'v1', projectId: 'p1', name: 'Релиз', color: OLD_ACCENT }],
    documents: [{ id: 'd1', title: OLD_ACCENT, blocks: [{ color: OLD_ACCENT }] }],
  };
  const before = JSON.stringify(state);
  assert.equal(renewColors(state), state, 'меняет на месте и возвращает то же');
  assert.equal(JSON.stringify(state), before);
  // Голый набор из облака — только массивы, без остального состояния.
  const blob = { projects: [{ id: 'p', color: OLD_ACCENT }] };
  renewColors(blob);
  assert.equal(blob.projects[0].color, NEW_ACCENT);
});

test('цвет с именем из прототипа объекта остаётся строкой как был, а не становится функцией', () => {
  // Таблица снятых цветов — обычный объект, и поиск по ней без проверки
  // собственного ключа находил «constructor» или «__proto__» в прототипе.
  const { renewColors } = require('../../src/renderer/core/migrate.js');
  const odd = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', ' Constructor '];
  const blob = {
    projects: odd.map((color, i) => ({ id: `p${i}`, name: 'Битый', color })),
    statuses: [{ id: 's', projectId: 'p0', name: 'Битый', color: '__proto__', kind: 'todo', order: 0 }],
    tags: [{ id: 'g', name: 'Битый', color: 'toString' }],
  };
  renewColors(blob);
  assert.deepEqual(blob.projects.map((p) => p.color), odd);
  assert.equal(blob.statuses[0].color, '__proto__');
  assert.equal(blob.tags[0].color, 'toString');
  const s = migrate({ projects: [{ id: 'p', name: 'Битый', color: 'constructor' }], tags: [{ id: 'g', name: 'Тег', color: '__proto__' }] }, deps());
  assert.equal(s.projects[0].color, 'constructor');
  assert.equal(s.tags[0].color, '__proto__');
  assert.equal(typeof s.tags[0].color, 'string');
});

test('приём из облака: старый цвет приходит новым, а повторная доставка ничего не отправляет обратно', () => {
  // Как applyRemoteData десктопа: принятое кладётся в состояние, гоняется
  // миграция и только потом снимается отпечаток «это уже есть на сервере».
  // Пока отпечаток по перекрашенным данным совпадает с тем, что собирается
  // к отправке, push молчит — два устройства не перебрасываются одним и тем
  // же. Старая версия приложения может прислать прежний цвет снова и снова:
  // каждый раз он красится при приёме и отпечаток остаётся прежним.
  const payload = (st) => JSON.stringify({ projects: st.projects, tasks: st.tasks, statuses: st.statuses, tags: st.tags, versions: st.versions, documents: st.documents });
  const state = migrate({ projects: [{ id: 'p1', name: 'Мой', color: '#5ec8f2' }] }, deps());
  const receive = (remote) => {
    const data = JSON.parse(JSON.stringify(remote));
    state.projects = data.projects;
    state.statuses = data.statuses;
    state.tags = data.tags;
    migrate(state, deps());
    return payload(state);
  };
  const remote = withOldAccent();
  const first = receive(remote);
  assert.ok(!first.toLowerCase().includes(OLD_ACCENT), 'старого цвета в принятом нет');
  assert.equal(JSON.parse(first).projects[0].color, NEW_ACCENT);
  // Облако осталось со старым цветом и присылает то же ещё раз.
  assert.equal(receive(remote), first, 'отпечаток тот же — отправлять нечего');
  // Принятое уже в новой форме миграция тоже не меняет.
  assert.equal(payload(migrate(JSON.parse(first), deps())), first);
});

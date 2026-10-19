// Несколько аккаунтов на устройстве — core/accounts.js. Запуск: npm run test:unit
//
// Цена ошибки здесь — чужие данные под своим именем: открыть задачи одного
// аккаунта под другим, затереть гостевые при входе или потерять сеанс из-за
// уже использованного refresh-токена. Поэтому стережём раскладку ключей,
// список и план переключения.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../src/renderer/core/accounts.js');

const U1 = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const U2 = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

const t = (k) => ({ 'accounts.guest': 'Без аккаунта' }[k] || k);

test('гость живёт под прежними ключами — ничего не переезжает', () => {
  assert.equal(A.dataScope(null), 'lancible:data');
  assert.equal(A.dataFileName(null), 'data.json');
  assert.equal(A.mobileDataName(null), 'lancible-data');
  assert.equal(A.dataScope(undefined), 'lancible:data');
});

test('у аккаунта своя область на каждой поверхности', () => {
  assert.equal(A.dataScope(U1), `lancible:data:${U1}`);
  assert.equal(A.dataFileName(U1), `data-${U1}.json`);
  assert.equal(A.mobileDataName(U1), `lancible-data:${U1}`);
  assert.notEqual(A.dataScope(U1), A.dataScope(U2));
});

test('uid, который годится в путь, — только буквы, цифры и дефис', () => {
  for (const bad of ['../x', 'a/b', 'a\\b', '', ' ', 'x'.repeat(65), 42, null, {}]) {
    assert.equal(A.isValidUid(bad), false, String(bad));
    // негодный uid — это гость, а не файл за пределами userData
    assert.equal(A.dataFileName(bad), 'data.json');
  }
  assert.equal(A.isValidUid(U1), true);
});

test('normalizeAccounts: мусор, дубли и чужой current', () => {
  assert.deepEqual(A.normalizeAccounts(null), { list: [], current: null });
  assert.deepEqual(A.normalizeAccounts('x'), { list: [], current: null });
  const acc = A.normalizeAccounts({
    list: [
      { uid: U1, email: 'a@x', refreshToken: 'r1', lastUsedAt: 1 },
      { email: 'без uid' },
      { uid: '../evil', refreshToken: 'r' },
      { uid: U1, email: 'a@new', refreshToken: 'r1b', lastUsedAt: 5 },
      { uid: U2, email: 'b@x', refreshToken: 'r2', lastUsedAt: 3 },
    ],
    current: 'нет-такого',
  });
  assert.deepEqual(acc.list.map((e) => e.uid), [U1, U2], 'дубль слит на месте первого');
  assert.equal(acc.list[0].email, 'a@new', 'поля — у записи, что использовалась позже');
  assert.equal(acc.list[0].refreshToken, 'r1b');
  assert.equal(acc.current, null);
  assert.equal(A.normalizeAccounts({ list: acc.list, current: U2 }).current, U2);
  // голый массив тоже читается
  assert.equal(A.normalizeAccounts([{ uid: U1, refreshToken: 'r' }]).list.length, 1);
});

test('запись без refresh-токена остаётся, но «нужно войти заново»', () => {
  const acc = A.normalizeAccounts({ list: [{ uid: U1, email: 'a@x' }] });
  assert.equal(acc.list.length, 1);
  assert.equal(acc.list[0].needsSignIn, true);
  assert.equal(acc.list[0].refreshToken, '');
});

test('upsertAccount: новый — в конец, старый — на месте, поля без undefined', () => {
  let acc = A.upsertAccount(null, { uid: U1, email: 'a@x', refreshToken: 'r1', lastUsedAt: 1 });
  acc = A.upsertAccount(acc, { uid: U2, email: 'b@x', refreshToken: 'r2', lastUsedAt: 2 });
  acc = A.upsertAccount(acc, { uid: U1, name: 'Аня' });
  assert.deepEqual(acc.list.map((e) => e.uid), [U1, U2]);
  assert.equal(acc.list[0].name, 'Аня');
  assert.equal(acc.list[0].email, 'a@x', 'email не стёрт тем, что его не передали');
  assert.equal(acc.list[0].refreshToken, 'r1');
  assert.equal(acc.current, null, 'current ставит не upsert');
  // негодный uid — список не меняется
  assert.deepEqual(A.upsertAccount(acc, { uid: '../x' }), acc);
});

test('ротация: свежий refresh-токен заменяет прежний и снимает пометку', () => {
  let acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1' });
  acc = A.markNeedsSignIn(acc, U1);
  assert.equal(acc.list[0].needsSignIn, true);
  assert.equal(acc.list[0].refreshToken, '', 'протухший токен не хранится');
  acc = A.upsertAccount(acc, { uid: U1, accessToken: 'a2', refreshToken: 'r2' });
  assert.equal(acc.list[0].needsSignIn, false);
  assert.equal(acc.list[0].refreshToken, 'r2');
  assert.equal(acc.list[0].accessToken, 'a2');
});

test('setCurrentAccount: только из списка, иначе гость', () => {
  const acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1' });
  assert.equal(A.setCurrentAccount(acc, U1).current, U1);
  assert.equal(A.setCurrentAccount(acc, U2).current, null);
  assert.equal(A.setCurrentAccount(acc, null).current, null);
});

test('removeAccount: убрали текущий — текущим стал гость', () => {
  let acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1' });
  acc = A.upsertAccount(acc, { uid: U2, refreshToken: 'r2' });
  acc = A.setCurrentAccount(acc, U1);
  const a = A.removeAccount(acc, U1);
  assert.deepEqual(a.list.map((e) => e.uid), [U2]);
  assert.equal(a.current, null);
  const b = A.removeAccount(acc, U2);
  assert.equal(b.current, U1, 'чужой уход текущего не трогает');
});

test('nextAccount: последний по времени из живых, иначе гость', () => {
  let acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1', lastUsedAt: 10 });
  acc = A.upsertAccount(acc, { uid: U2, refreshToken: 'r2', lastUsedAt: 20 });
  assert.equal(A.nextAccount(acc, U1), U2);
  assert.equal(A.nextAccount(acc, U2), U1);
  assert.equal(A.nextAccount(A.markNeedsSignIn(acc, U2), U1), null, 'без сеанса — не кандидат');
  assert.equal(A.nextAccount(null, U1), null);
});

test('planSwitch: тот же аккаунт — ничего', () => {
  const acc = A.setCurrentAccount(A.upsertAccount(null, { uid: U1, refreshToken: 'r1' }), U1);
  const p = A.planSwitch(acc, U1);
  assert.equal(p.sameAccount, true);
  assert.equal(p.signOut, false);
  assert.equal(p.needSession, false);
  assert.equal(A.planSwitch(null, null).sameAccount, true, 'гость → гость — тоже ничего');
});

test('planSwitch: из аккаунта в аккаунт — снять сеанс, поднять другой', () => {
  let acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1' });
  acc = A.setCurrentAccount(A.upsertAccount(acc, { uid: U2, refreshToken: 'r2' }), U1);
  assert.deepEqual(A.planSwitch(acc, U2), {
    save: U1, load: U2, sameAccount: false, signOut: true, needSession: true, canResume: true,
  });
});

test('planSwitch: в гостя и из гостя', () => {
  const acc = A.upsertAccount(null, { uid: U1, refreshToken: 'r1' });
  const fromGuest = A.planSwitch(acc, U1);
  assert.equal(fromGuest.save, null);
  assert.equal(fromGuest.signOut, false, 'у гостя снимать нечего');
  assert.equal(fromGuest.needSession, true);
  const toGuest = A.planSwitch(A.setCurrentAccount(acc, U1), null);
  assert.deepEqual([toGuest.save, toGuest.load, toGuest.signOut, toGuest.needSession], [U1, null, true, false]);
});

test('planSwitch: аккаунта нет в списке — гость; без токена — без синхронизации', () => {
  assert.equal(A.planSwitch(null, U2).load, null);
  const acc = A.markNeedsSignIn(A.upsertAccount(null, { uid: U1, refreshToken: 'r1' }), U1);
  const p = A.planSwitch(acc, U1);
  assert.equal(p.load, U1, 'данные открываются и без сеанса');
  assert.equal(p.canResume, false);
});

test('accountLabel: имя, почта, «Без аккаунта»', () => {
  assert.equal(A.accountLabel({ name: ' Аня ', email: 'a@x' }, t), 'Аня');
  assert.equal(A.accountLabel({ name: '', email: 'a@x' }, t), 'a@x');
  assert.equal(A.accountLabel(null, t), 'Без аккаунта');
  assert.equal(A.accountLabel({}, t), 'Без аккаунта');
});

test('accountInitial и цвет аватара — от uid, в пределах палитры', () => {
  assert.equal(A.accountInitial({ name: 'аня' }), 'А');
  assert.equal(A.accountInitial({ email: 'bob@x' }), 'B');
  assert.equal(A.accountInitial(null), '?');
  for (const n of [1, 5, 8]) {
    const i = A.accountColorIndex(U1, n);
    assert.ok(Number.isInteger(i) && i >= 0 && i < n);
  }
  assert.equal(A.accountColorIndex(U1, 8), A.accountColorIndex(U1, 8), 'один uid — один цвет');
  assert.equal(A.accountColorIndex(U1, 0), 0);
});

// --- перенос «Без аккаунта» в аккаунт ------------------------------------------

const guest = () => ({
  projects: [{ id: 'pg', name: 'Гостевой' }, { id: 'shared', name: 'Общий (уже в аккаунте)' }],
  tasks: [{ id: 'tg', projectId: 'pg', title: 'Задача гостя' }, { id: 'ts', projectId: 'shared', title: 'Задача в общем' }],
  statuses: [{ id: 'sg', projectId: 'pg', name: 'К выполнению' }, { id: 'ss-g', projectId: 'shared', name: 'Чужой статус' }],
  versions: [{ id: 'vg', projectId: 'pg', name: 'v1' }, { id: 'vs-g', projectId: 'shared', name: 'v9' }],
  tags: [{ id: 'tag-common', name: 'Срочно' }, { id: 'tag-g', name: 'Гостевой тег' }, { id: 'tag-pg', projectId: 'pg', name: 'Проектный' }, { id: 'tag-shared-g', projectId: 'shared', name: 'Чужой проектный' }],
  documents: [{ id: 'dg', title: 'Заметка гостя' }],
  activeTimer: { taskId: 'tg', startedAt: '2026-10-17T10:00:00.000Z' },
  settings: { lang: 'en', hourlyRate: 500 },
});
const account = () => ({
  projects: [{ id: 'shared', name: 'Общий' }, { id: 'pa', name: 'Аккаунта' }],
  tasks: [{ id: 'ta', projectId: 'pa', title: 'Задача аккаунта' }],
  statuses: [{ id: 'sa', projectId: 'pa', name: 'Готово' }, { id: 'ss', projectId: 'shared', name: 'Свой статус' }],
  versions: [],
  tags: [{ id: 'tag-common', name: 'Срочно (своё имя)' }],
  documents: [],
  activeTimer: null,
  settings: { lang: 'ru', hourlyRate: 1500, syncResolvedFor: { userId: 'u' } },
  ui: { view: 'home' },
});
const idsOf = (list) => list.map((x) => x.id).sort();

test('mergeScopeData: объединение по id без дублей, своё остаётся своим', () => {
  const m = A.mergeScopeData(account(), guest());
  assert.deepEqual(idsOf(m.projects), ['pa', 'pg', 'shared']);
  assert.equal(m.projects.find((p) => p.id === 'shared').name, 'Общий', 'проект, который уже был, — версия аккаунта');
  assert.deepEqual(idsOf(m.tasks), ['ta', 'tg', 'ts']);
  assert.deepEqual(idsOf(m.documents), ['dg']);
  for (const k of ['projects', 'tasks', 'statuses', 'versions', 'tags', 'documents']) {
    assert.equal(new Set(m[k].map((x) => x.id)).size, m[k].length, `${k}: дубль`);
  }
});

test('mergeScopeData: статусы, версии и теги проекта едут за проектом', () => {
  const m = A.mergeScopeData(account(), guest());
  assert.deepEqual(idsOf(m.statuses), ['sa', 'sg', 'ss'], 'статус пришедшего проекта приехал, чужой — к уже бывшему — нет');
  assert.deepEqual(idsOf(m.versions), ['vg']);
  assert.ok(m.tags.some((x) => x.id === 'tag-pg'), 'тег пришедшего проекта приехал');
  assert.ok(!m.tags.some((x) => x.id === 'tag-shared-g'), 'проектный тег к уже бывшему проекту не подкладывается');
});

test('mergeScopeData: общие теги сливаются по id', () => {
  const m = A.mergeScopeData(account(), guest());
  const common = m.tags.filter((x) => x.id === 'tag-common');
  assert.equal(common.length, 1);
  assert.equal(common[0].name, 'Срочно (своё имя)');
  assert.ok(m.tags.some((x) => x.id === 'tag-g'), 'новый общий тег гостя приехал');
});

test('mergeScopeData: идемпотентно и не трогает входы', () => {
  const t = account();
  const s = guest();
  const before = JSON.stringify([t, s]);
  const once = A.mergeScopeData(t, s);
  assert.deepEqual(A.mergeScopeData(once, s), once, 'второй перенос того же ничего не добавил');
  assert.equal(JSON.stringify([t, s]), before);
});

test('mergeScopeData: таймер, настройки и интерфейс', () => {
  const m = A.mergeScopeData(account(), guest());
  assert.deepEqual(m.activeTimer, guest().activeTimer, 'в аккаунте таймер не шёл — переехал гостевой');
  assert.deepEqual(m.settings, account().settings, 'настройки — области аккаунта');
  assert.deepEqual(m.ui, account().ui);
  const running = { ...account(), activeTimer: { taskId: 'ta', startedAt: '2026-10-17T09:00:00.000Z' } };
  assert.equal(A.mergeScopeData(running, guest()).activeTimer.taskId, 'ta', 'идущий таймер аккаунта остаётся');
  // Пустой аккаунт — просто данные гостя.
  const fresh = A.mergeScopeData({ settings: {} }, guest());
  assert.deepEqual(idsOf(fresh.projects), ['pg', 'shared']);
  assert.deepEqual(idsOf(fresh.statuses), ['sg', 'ss-g']);
});

// Таймер гостя при переносе (19 октября 2026): идёт и в аккаунте, и у
// гостя — раньше гостевой пропадал вместе со своим временем.
const T_GUEST = Date.parse('2026-10-17T10:00:00.000Z');
const NOW_MS = T_GUEST + 90 * 60000;
const running = () => ({ ...account(), activeTimer: { taskId: 'ta', startedAt: '2026-10-17T09:00:00.000Z' } });

test('mergeScopeData: таймер гостя, который не может остаться активным, закрывается записью времени на своей задаче', () => {
  const m = A.mergeScopeData(running(), guest(), { now: NOW_MS });
  assert.equal(m.activeTimer.taskId, 'ta', 'идёт таймер аккаунта');
  const tg = m.tasks.find((x) => x.id === 'tg');
  assert.deepEqual(tg.sessions, [{
    id: 's@2026-10-17T10:00:00.000Z', start: '2026-10-17T10:00:00.000Z', end: new Date(NOW_MS).toISOString(),
    ms: 90 * 60000, rate: 500,
  }], 'как обычная остановка: конец — сейчас, ставка — гостя, не «вручную»');
  assert.equal(tg.totalMs, 90 * 60000);
  assert.equal(tg.updatedAt, new Date(NOW_MS).toISOString());
  assert.deepEqual(A.mergeScopeData(m, guest(), { now: NOW_MS + 60000 }), m, 'повторный перенос записи не удваивает');

  // Задача таймера уже была в аккаунте — запись ложится в её версию.
  const both = running();
  both.tasks.push({ id: 'tg', projectId: 'pa', title: 'Та же задача в аккаунте', totalMs: 1000, sessions: [{ id: 'old', start: 'x', end: 'y', ms: 1000 }] });
  const tg2 = A.mergeScopeData(both, guest(), { now: NOW_MS }).tasks.find((x) => x.id === 'tg');
  assert.equal(tg2.title, 'Та же задача в аккаунте');
  assert.deepEqual(tg2.sessions.map((x) => x.id), ['old', 's@2026-10-17T10:00:00.000Z']);
  assert.equal(tg2.totalMs, 1000 + 90 * 60000);

  // Меньше секунды — без записи, как у stopTimer.
  const short = A.mergeScopeData(running(), guest(), { now: T_GUEST + 500 });
  assert.equal(short.tasks.find((x) => x.id === 'tg').sessions, undefined);
});

test('settleGuestTimer: перед переносом журналом — таймер гостя в запись, если в аккаунте идёт свой', () => {
  const g = guest();
  const before = JSON.stringify(g);
  const settled = A.settleGuestTimer(running(), g, { now: NOW_MS });
  assert.equal(settled.activeTimer, null, 'активным он не остаётся');
  assert.equal(settled.tasks.find((x) => x.id === 'tg').totalMs, 90 * 60000);
  assert.equal(JSON.stringify(g), before, 'вход не меняется');
  assert.equal(A.settleGuestTimer(account(), g, { now: NOW_MS }), g, 'в аккаунте таймер не идёт — гость как есть, его таймер переедет');
  // После settle перенос без журнала записи не удваивает.
  const m = A.mergeScopeData(running(), settled, { now: NOW_MS + 60000 });
  assert.equal(m.tasks.find((x) => x.id === 'tg').sessions.length, 1);
  // Таймер на задаче, которой у гостя уже нет, — просто останавливается.
  const lost = A.settleGuestTimer(running(), { ...g, activeTimer: { taskId: 'нет', startedAt: '2026-10-17T10:00:00.000Z' } }, { now: NOW_MS });
  assert.equal(lost.activeTimer, null);
  assert.deepEqual(lost.tasks, g.tasks);
});

test('emptiedScopeData: гость без сущностей, настройки на месте', () => {
  const e = A.emptiedScopeData(guest());
  for (const k of ['projects', 'tasks', 'statuses', 'versions', 'tags', 'documents']) assert.deepEqual(e[k], []);
  assert.equal(e.activeTimer, null);
  assert.deepEqual(e.settings, guest().settings);
});

test('accountChangedElsewhere: другая вкладка открыла другой аккаунт — да; добавила аккаунт или освежила токены — нет', () => {
  // Веб, две вкладки (17 октября 2026): список аккаунтов в localStorage общий,
  // открытая область — у каждой вкладки своя. Сменился текущий в другой
  // вкладке — сеанс в общем хранилище уже чужой.
  const list = [{ uid: U1, refreshToken: 'r1' }, { uid: U2, refreshToken: 'r2' }];
  assert.equal(A.accountChangedElsewhere({ list, current: U2 }, U1), true);
  assert.equal(A.accountChangedElsewhere({ list, current: U1 }, U1), false, 'тот же текущий — токены и список не в счёт');
  assert.equal(A.accountChangedElsewhere({ list, current: null }, U1), true, 'там открыт гость');
  assert.equal(A.accountChangedElsewhere({ list, current: U1 }, null), true, 'гость здесь, там вошли');
  assert.equal(A.accountChangedElsewhere({ list, current: null }, null), false);
  assert.equal(A.accountChangedElsewhere(null, U1), true, 'список стёрт — аккаунта здесь больше нет');
  assert.equal(A.accountChangedElsewhere(null, null), false);
  assert.equal(A.accountChangedElsewhere({ list: [{ uid: U2, refreshToken: 'r2' }], current: U1 }, U1), true, 'текущего нет в списке — нормализация даёт гостя');
  assert.equal(A.accountChangedElsewhere({ list, current: U2 }, 'не-uid'), true, 'мусор вместо uid — гость');
});

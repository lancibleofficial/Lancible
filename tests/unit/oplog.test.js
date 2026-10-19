// Журнал правок — синхронизация без потерь (src/renderer/core/oplog.js).
// Запуск: npm run test:unit
//
// Проект — tmp/design-sync-oplog.md (17 октября 2026). Первые десять тестов —
// его сценарии по номерам, дальше — то, на чём такие схемы ломаются обычно:
// повтор, порядок прихода, правка раньше создания, мост к старым клиентам.
//
// Сервер здесь — модель таблицы changes: seq по порядку, повтор op_id
// отбивается, at режется до now + 5 минут, base_seq — не больше последнего
// seq (как триггер в supabase/sync2.sql). Устройство — пачка ядра: правит
// копию состояния, сохраняет (commitLocal), шлёт (ackPending), читает
// «seq > lastSeq» (mergeIncoming). Офлайн — значит не шлёт и не читает.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../../src/renderer/core/oplog.js');

const MIN = 60000;
const DAY = 86400000;
const T0 = Date.parse('2026-10-17T09:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
const LISTS = ['projects', 'tasks', 'statuses', 'tags', 'versions', 'documents'];
// id правок — по счётчику: при равном времени спор решает id, и прогон должен
// повторяться один в один.
let idn = 0;
const nextId = () => `00000000-0000-4000-8000-${(++idn).toString(16).padStart(12, '0')}`;

function task(id, title, extra) {
  return Object.assign({
    id, projectId: 'p1', title, done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
    createdAt: iso(T0 - DAY), updatedAt: iso(T0 - DAY), statusId: 's1', tagIds: [], versionId: null, repeat: null,
    cancelled: false, dueAt: null, reminders: [], remindOffsetMin: null, remindAt: null, notifiedAt: null,
  }, extra);
}

function base() {
  return {
    projects: [{ id: 'p1', name: 'Работа', color: '#69d345', description: '', pinnedAt: null, tagIds: [], createdAt: iso(T0 - DAY) }],
    tasks: [task('t1', 'Написать отчёт'), task('t2', 'Позвонить')],
    statuses: [{ id: 's1', projectId: 'p1', name: 'К выполнению', color: '#888888', kind: 'todo', order: 0, builtin: true }],
    tags: [],
    versions: [],
    documents: [{ id: 'd1', title: 'Заметки', projectId: null, body: null, pinnedAt: null, createdAt: iso(T0 - DAY), updatedAt: iso(T0 - DAY) }],
  };
}

const notes = (text) => ({ ops: [{ insert: `${text}\n` }], lancible: { v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] } });

// Классы без конструктора, с create(): граф кода не связывает `new X()` с
// конструктором и счёл бы его мёртвым кодом (graph-dead-code.test.js).
class Server {
  static create() {
    const s = new Server();
    s.rows = [];
    s.seq = 0;
    s.now = T0;
    return s;
  }
  insert(ops) {
    const out = [];
    for (const op of ops) {
      if (this.rows.some((r) => r.op_id === op.id)) continue; // unique (user_id, op_id)
      const row = clone(O.opToRow(op));
      const top = this.seq;
      row.seq = ++this.seq;
      row.created_at = iso(this.now);
      if (Date.parse(row.at) > this.now + 5 * MIN) row.at = iso(this.now + 5 * MIN);
      row.base_seq = Math.min(row.base_seq, top);
      this.rows.push(row);
      out.push(clone(row));
    }
    return out;
  }
  after(seq) { return this.rows.filter((r) => r.seq > seq).map(clone); }
}

/** Что клиент пишет на диск (packSync2 в app.js, lib/oplogScope.js на
 *  телефоне): состояние и шесть полей пачки — и ничего сверх. */
function stored(b) {
  return clone({ state: b.state, pending: b.pending, lastSeq: b.lastSeq, conflicts: b.conflicts, trash: b.trash, meta: b.meta, deferred: b.deferred });
}

class Device {
  /** opts.device — deviceId, если он не совпадает с именем устройства в
   *  тесте (две вкладки одного браузера). */
  static create(id, server, opts) {
    const o = opts || {};
    const d = new Device();
    d.id = id;
    d.dev = o.device || id;
    d.server = server;
    d.skew = o.skew || 0;
    d.events = [];
    d.restored = [];
    const snap = o.snapshot || { seq: 0, data: base() };
    d.bundle = O.bootstrapFromSnapshot(snap, server.after(snap.seq), { deviceId: d.dev, now: iso(d.now()), newId: nextId });
    return d;
  }
  /** Копия устройства на этот момент, с тем же deviceId: телефон из
   *  резервной копии, скопированная папка десктопа. */
  static copy(src, id) {
    const d = new Device();
    d.id = id;
    d.dev = src.dev;
    d.server = src.server;
    d.skew = src.skew;
    d.events = [];
    d.restored = [];
    d.bundle = stored(src.bundle);
    return d;
  }
  now() { return this.server.now + this.skew; }
  get state() { return this.bundle.state; }
  edit(fn) {
    const live = clone(this.bundle.state);
    fn(live, this.now());
    const r = O.commitLocal(this.bundle, live, { deviceId: this.dev, at: iso(this.now()), newId: nextId });
    this.bundle = r.bundle;
    return r.ops;
  }
  push() {
    if (!this.bundle.pending.length) return [];
    const rows = this.server.insert(this.bundle.pending);
    this.bundle = O.ackPending(this.bundle, rows, { deviceId: this.dev, now: iso(this.now()), newId: nextId });
    return rows;
  }
  /** Перезапуск: пачка — только то, что пережило запись на диск. */
  reload() { this.bundle = stored(this.bundle); }
  pull(limit, shuffle) {
    let rows = this.server.after(this.bundle.lastSeq);
    if (limit !== undefined && limit !== null) rows = rows.slice(0, limit);
    if (shuffle) rows = shuffle(rows);
    const out = O.mergeIncoming(this.bundle, rows, { deviceId: this.dev, now: iso(this.now()), newId: nextId });
    this.events.push(...out.events);
    this.restored.push(...out.restored);
    this.bundle = out;
    return out;
  }
}

/** Все на связи, пока не разошлось всё: пометки конфликтов тоже уходят. */
function settle(devices) {
  for (let i = 0; i < 5; i++) {
    for (const d of devices) d.push();
    for (const d of devices) d.pull();
  }
}

const T = (s, id) => (s.tasks || []).find((x) => x.id === id);
function setField(s, id, field, value, now) { const x = T(s, id); x[field] = value; x.updatedAt = iso(now); }
function addSession(s, id, sid, startMs, ms, now) {
  const x = T(s, id);
  const rec = { start: iso(startMs), end: iso(startMs + ms), ms, rate: null };
  if (sid) rec.id = sid;
  x.sessions.push(rec);
  x.totalMs += ms;
  x.updatedAt = iso(now);
}
function editSession(s, id, sid, ms, now, extra) {
  const x = T(s, id);
  const i = x.sessions.findIndex((r) => r.id === sid);
  const old = x.sessions[i];
  x.totalMs = x.totalMs - old.ms + ms;
  x.sessions[i] = Object.assign({}, old, { end: iso(Date.parse(old.start) + ms), ms }, extra);
  x.updatedAt = iso(now);
}
function dropSession(s, id, sid, now) {
  const x = T(s, id);
  const i = x.sessions.findIndex((r) => r.id === sid);
  x.totalMs -= x.sessions[i].ms;
  x.sessions.splice(i, 1);
  x.updatedAt = iso(now);
}
const dropTask = (s, id) => { s.tasks = s.tasks.filter((x) => x.id !== id); };

/** Состояние без того, что не синхронизируется: порядок в массивах и то,
 *  есть ли у записи времени свой id (у автора записи его может не быть). */
function norm(state) {
  const out = {};
  for (const k of LISTS) {
    out[k] = (state[k] || []).map((e) => {
      const c = clone(e);
      if (Array.isArray(c.sessions)) {
        c.sessions = c.sessions.map((s) => { const x = Object.assign({}, s); delete x.id; return x; })
          .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
      }
      return c;
    }).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  }
  return out;
}
const conflictIds = (d) => d.bundle.conflicts.map((c) => c.id).sort();
const trashIds = (d) => d.bundle.trash.map((t) => `${t.entity}:${t.entityId}`).sort();

function assertConverged(devices, why) {
  const [first, ...rest] = devices;
  for (const d of rest) {
    assert.deepEqual(norm(d.state), norm(first.state), `${why || ''}: ${d.id} разошёлся с ${first.id}`);
    assert.deepEqual(conflictIds(d), conflictIds(first), `${why || ''}: конфликты ${d.id} и ${first.id} разные`);
    assert.deepEqual(trashIds(d), trashIds(first), `${why || ''}: корзины ${d.id} и ${first.id} разные`);
  }
}

function trio() {
  const srv = Server.create();
  return { srv, A: Device.create('A', srv), B: Device.create('B', srv), C: Device.create('C', srv) };
}

// ---------------------------------------------------------------------------
// Сценарии проекта
// ---------------------------------------------------------------------------

test('1. три устройства офлайн правят одну задачу: название, срок, заметки — всё на месте, конфликтов нет', () => {
  const { srv, A, B, C } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Отчёт за квартал', now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'dueAt', iso(T0 + 3 * DAY), now));
  srv.now += MIN; C.edit((s, now) => setField(s, 't1', 'notes', notes('черновик'), now));
  settle([A, B, C]);
  for (const d of [A, B, C]) {
    const t1 = T(d.state, 't1');
    assert.equal(t1.title, 'Отчёт за квартал', d.id);
    assert.equal(t1.dueAt, iso(T0 + 3 * DAY), d.id);
    assert.deepEqual(t1.notes, notes('черновик'), d.id);
    // updatedAt правили все трое — тихое поле: побеждает последняя, без конфликта.
    assert.equal(t1.updatedAt, iso(T0 + 3 * MIN), d.id);
    assert.deepEqual(d.bundle.conflicts, [], `${d.id}: конфликт на разных полях`);
  }
  assertConverged([A, B, C], 'сценарий 1');
});

test('2. два устройства офлайн правят название — видна поздняя, обе версии хранятся; выбор закрывает конфликт везде', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Версия A', now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Версия B', now));
  settle([A, B]);
  for (const d of [A, B]) {
    assert.equal(T(d.state, 't1').title, 'Версия B', `${d.id}: показана не поздняя`);
    assert.equal(d.bundle.conflicts.length, 1, d.id);
    const c = d.bundle.conflicts[0];
    assert.equal(c.id, 'task:t1:title');
    assert.deepEqual(c.versions.map((v) => v.value).sort(), ['Версия A', 'Версия B']);
    assert.deepEqual(c.versions.map((v) => v.deviceId).sort(), ['A', 'B']);
  }
  // Подписи — относительно своего устройства.
  const onA = A.bundle.conflicts[0];
  assert.equal(onA.ours.value, 'Версия A');
  assert.equal(onA.theirs.value, 'Версия B');
  assert.equal(onA.shown, 'theirs');
  assert.equal(B.bundle.conflicts[0].shown, 'ours');
  // Пометка о конфликте — в журнале, со значениями версий: по ней ту же
  // пометку покажет и устройство, которое само спора не застало.
  const marks = srv.rows.filter((r) => r.field === 'conflict');
  assert.ok(marks.length >= 1 && marks.length <= 2, `пометок ${marks.length}`);
  const announced = new Set(marks.flatMap((r) => r.value.versions.map((v) => v.value)));
  assert.deepEqual([...announced].sort(), ['Версия A', 'Версия B']);

  srv.now += MIN;
  const r = O.resolveConflict(A.bundle, 'task:t1:title', 'ours', { deviceId: 'A', at: iso(A.now()) });
  A.bundle = r.bundle;
  assert.equal(T(A.state, 't1').title, 'Версия A', 'выбор не применился у себя');
  settle([A, B]);
  for (const d of [A, B]) {
    assert.equal(T(d.state, 't1').title, 'Версия A', d.id);
    assert.deepEqual(d.bundle.conflicts, [], `${d.id}: конфликт не закрылся`);
  }
  // Обе версии остались в журнале.
  const titles = srv.rows.filter((row) => row.entity_id === 't1' && row.field === 'title').map((row) => row.value);
  assert.ok(titles.includes('Версия A') && titles.includes('Версия B'));
});

test('3. правка после увиденной правки — не конфликт: побеждает последняя, даже с отстающими часами', () => {
  const { srv, A, B } = trio();
  B.skew = -30 * MIN; // часы B отстают: по at его правка «раньше»
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Сначала A', now));
  A.push();
  srv.now += MIN; B.pull();
  assert.equal(T(B.state, 't1').title, 'Сначала A');
  B.edit((s, now) => setField(s, 't1', 'title', 'Потом B', now));
  settle([A, B]);
  for (const d of [A, B]) {
    assert.equal(T(d.state, 't1').title, 'Потом B', d.id);
    assert.deepEqual(d.bundle.conflicts, [], d.id);
  }
});

test('4. удаление против правки: параллельно — задача остаётся с пометкой; последовательно — в корзину; возврат — правка', () => {
  // Параллельно.
  {
    const { srv, A, B, C } = trio();
    srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
    assert.ok(!T(A.state, 't1'));
    assert.deepEqual(trashIds(A), ['task:t1'], 'своё удаление не легло в корзину');
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Правка B', now));
    settle([A, B, C]);
    for (const d of [A, B, C]) {
      assert.equal(T(d.state, 't1') && T(d.state, 't1').title, 'Правка B', `${d.id}: задача не уцелела`);
      assert.deepEqual(trashIds(d), [], d.id);
    }
    assert.ok(A.restored.some((r) => r.entityId === 't1'), 'A не получил пометку «восстановлена»');
    assert.ok(A.events.some((e) => e.type === 'restored' && e.entityId === 't1'));
    assertConverged([A, B, C], 'параллельное удаление');
  }
  // Последовательно, затем возврат из корзины.
  {
    const { srv, A, B, C } = trio();
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Правка B', now));
    B.push();
    srv.now += MIN; A.pull();
    A.edit((s) => dropTask(s, 't1'));
    settle([A, B, C]);
    for (const d of [A, B, C]) {
      assert.ok(!T(d.state, 't1'), `${d.id}: удаление, видевшее правку, не сработало`);
      assert.deepEqual(trashIds(d), ['task:t1'], d.id);
      assert.equal(d.bundle.trash[0].data.title, 'Правка B');
    }
    srv.now += MIN;
    const r = O.restoreFromTrash(C.bundle, 'task', 't1', { deviceId: 'C', at: iso(C.now()) });
    C.bundle = r.bundle;
    assert.deepEqual(r.ops.map((o) => [o.field, o.value === null ? null : typeof o.value]), [['deleted', null], ['*', 'object']]);
    settle([A, B, C]);
    for (const d of [A, B, C]) {
      assert.equal(T(d.state, 't1') && T(d.state, 't1').title, 'Правка B', `${d.id}: возврат не доехал`);
      assert.deepEqual(trashIds(d), [], d.id);
    }
    assertConverged([A, B, C], 'возврат из корзины');
  }
});

test('5. записи времени с двух устройств — обе; правка одной записи параллельно — конфликт по записи', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => addSession(s, 't1', 'sa', T0, 30 * MIN, now));
  srv.now += MIN; B.edit((s, now) => addSession(s, 't1', 'sb', T0 + HOUR(), 20 * MIN, now));
  settle([A, B]);
  for (const d of [A, B]) {
    const t1 = T(d.state, 't1');
    assert.deepEqual(t1.sessions.map((x) => x.id).sort(), ['sa', 'sb'], d.id);
    assert.equal(t1.totalMs, 50 * MIN, `${d.id}: сумма времени`);
    assert.deepEqual(d.bundle.conflicts, [], d.id);
  }
  // Обе правят одну запись, не видя друг друга.
  srv.now += MIN; A.edit((s, now) => editSession(s, 't1', 'sa', 40 * MIN, now));
  srv.now += MIN; B.edit((s, now) => editSession(s, 't1', 'sa', 25 * MIN, now, { rate: 1500 }));
  settle([A, B]);
  for (const d of [A, B]) {
    const t1 = T(d.state, 't1');
    const sa = t1.sessions.find((x) => x.id === 'sa');
    assert.equal(sa.ms, 25 * MIN, `${d.id}: показана не поздняя правка записи`);
    assert.equal(t1.totalMs, 45 * MIN, `${d.id}: totalMs не сошёлся с записями`);
    assert.equal(d.bundle.conflicts.length, 1, d.id);
    assert.equal(d.bundle.conflicts[0].field, 'sessions');
    assert.equal(d.bundle.conflicts[0].sessionId, 'sa');
  }
  // Снятие против правки той же записи — правка остаётся, конфликта нет.
  srv.now += MIN; A.edit((s, now) => dropSession(s, 't1', 'sb', now));
  srv.now += MIN; B.edit((s, now) => editSession(s, 't1', 'sb', 10 * MIN, now));
  settle([A, B]);
  for (const d of [A, B]) {
    const t1 = T(d.state, 't1');
    assert.equal(t1.sessions.find((x) => x.id === 'sb').ms, 10 * MIN, `${d.id}: правку записи съело снятие`);
    assert.equal(t1.totalMs, 35 * MIN, d.id);
    assert.equal(d.bundle.conflicts.length, 1, `${d.id}: снятие против правки дало конфликт`);
  }
  assertConverged([A, B], 'записи времени');
});
function HOUR() { return 60 * MIN; }

test('6. новое устройство: слепок + правки после него = состояние остальных', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'A1', now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B1', now)); // конфликт
  srv.now += MIN; B.edit((s, now) => addSession(s, 't2', 'x1', T0, 15 * MIN, now));
  settle([A, B]);
  assert.equal(A.bundle.pending.length, 0);
  const snap = O.compactSnapshot(A.bundle);
  assert.equal(snap.seq, A.bundle.lastSeq);
  assert.equal(O.compactSnapshot({ state: A.state, pending: [{ id: 'x' }] }), null, 'слепок с неотправленным — враньё');
  // После слепка — ещё правки.
  srv.now += MIN; B.edit((s, now) => setField(s, 't2', 'dueAt', iso(T0 + DAY), now));
  srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
  settle([A, B]);
  const D = Device.create('D', srv, { snapshot: clone(snap) });
  settle([A, B, D]);
  assertConverged([A, B, D], 'новое устройство');
  // И без слепка — с нуля по всему журналу.
  const E = Device.create('E', srv);
  assertConverged([A, E], 'весь журнал с нуля');
});

/** Офлайн-правки сценариев 1–5 на трёх устройствах (каждое — пачкой). */
function offlineSet() {
  return [
    (A) => A.edit((s, now) => setField(s, 't1', 'title', 'A: название', now)),
    (B) => B.edit((s, now) => setField(s, 't1', 'title', 'B: название', now)),
    (C) => C.edit((s, now) => setField(s, 't1', 'notes', notes('C'), now)),
    (A) => A.edit((s, now) => addSession(s, 't2', 'a1', T0, 10 * MIN, now)),
    (B) => B.edit((s, now) => addSession(s, 't2', 'b1', T0 + HOUR(), 5 * MIN, now)),
    (C) => C.edit((s) => dropTask(s, 't2')),
    (A) => A.edit((s, now) => setField(s, 't1', 'dueAt', iso(T0 + 2 * DAY), now)),
    (B) => B.edit((s) => dropTask(s, 't1')),
  ];
}

test('7. повтор правок ничего не меняет; порядок прихода не важен', () => {
  // Повтор: те же строки ещё раз (и подряд в одной пачке) — состояние то же.
  const { srv, A, B, C } = trio();
  const steps = offlineSet();
  const dev = { A, B, C };
  steps.forEach((step, i) => { srv.now += MIN; step(dev['ABC'[[0, 1, 2, 0, 1, 2, 0, 1][i]]]); });
  settle([A, B, C]);
  const before = clone(A.bundle);
  const again = O.mergeIncoming(A.bundle, srv.after(0).concat(srv.after(0)), { deviceId: 'A', now: iso(srv.now) });
  assert.deepEqual(norm(again.state), norm(before.state));
  assert.deepEqual(again.conflicts.map((c) => c.id), before.conflicts.map((c) => c.id));
  assert.deepEqual(again.events, []);
  assert.equal(again.lastSeq, before.lastSeq);

  // Порядок: те же офлайн-правки, разная очерёдность отправки на сервер.
  const perms = [['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A']];
  let reference = null;
  for (const order of perms) {
    const t = trio();
    const ds = { A: t.A, B: t.B, C: t.C };
    steps.forEach((step, i) => { t.srv.now += MIN; step(ds['ABC'[[0, 1, 2, 0, 1, 2, 0, 1][i]]]); });
    for (const k of order) ds[k].push();
    // Чтение кусками разной длины, перемешанными внутри.
    let flip = 0;
    for (const k of order) ds[k].pull(2 + (flip++ % 3), (rows) => rows.reverse());
    settle([t.A, t.B, t.C]);
    assertConverged([t.A, t.B, t.C], `порядок ${order.join('')}`);
    const got = { state: norm(t.A.state), conflicts: conflictIds(t.A), trash: trashIds(t.A) };
    if (!reference) reference = got;
    else assert.deepEqual(got, reference, `порядок ${order.join('')} дал другой итог`);
  }
  // Итог сценариев 1–5 в одном наборе: t1 удалили параллельно правкам — жива;
  // t2 удалили параллельно записям времени — жива, записи обе.
  assert.ok(reference.state.tasks.some((x) => x.id === 't1'));
  const t2 = reference.state.tasks.find((x) => x.id === 't2');
  assert.equal(t2 && t2.sessions.length, 2);
  assert.deepEqual(reference.conflicts, ['task:t1:title']);
});

test('8. мост: sync_state от старого клиента → правки; новые данные не затёрты', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Новое A', now));
  settle([A, B]);
  // Зеркало для старых клиентов — тот же состав, что syncPayload.
  const mirror = O.mirrorSyncState(A.bundle);
  assert.deepEqual(Object.keys(mirror).sort(), LISTS.slice().sort());
  const mirrorSeq = A.bundle.lastSeq;
  // Пока старый клиент правит, новое устройство тоже правит — после зеркала.
  srv.now += MIN; B.edit((s, now) => setField(s, 't2', 'notes', notes('новое на B'), now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't2', 'title', 'B: звонок', now));
  B.push();
  // Старый клиент: стоит на зеркале, правит название t2 и заводит задачу.
  // Документов он не знает — поля нет вовсе: это «не знаю», а не «удалил всё».
  const old = clone(mirror);
  delete old.documents;
  old.tasks.find((x) => x.id === 't2').title = 'Старый: звонок';
  old.tasks.unshift(task('t9', 'Со старого телефона'));
  const meta = { at: iso(srv.now), baseSeq: mirrorSeq, stamp: '2026-10-17T09:03:00.000Z' };
  const fromA = O.legacyBridgeOps(mirror, old, meta);
  const fromB = O.legacyBridgeOps(mirror, old, meta);
  assert.deepEqual(fromA.map((o) => o.id), fromB.map((o) => o.id), 'id правок моста не совпали — сервер не отобьёт повтор');
  assert.ok(fromA.every((o) => o.deviceId === 'legacy' && o.baseSeq === mirrorSeq));
  assert.ok(!fromA.some((o) => o.entity === 'document'), 'отсутствие documents прочитано как удаление');
  assert.ok(!fromA.some((o) => o.field === 'deleted'));
  // Оба новых устройства шлют одно и то же — второй раз всё отбито.
  assert.equal(srv.insert(fromA).length, fromA.length);
  assert.equal(srv.insert(fromB).length, 0);
  settle([A, B]);
  for (const d of [A, B]) {
    const t2 = T(d.state, 't2');
    assert.deepEqual(t2.notes, notes('новое на B'), `${d.id}: мост затёр заметки нового устройства`);
    assert.ok(T(d.state, 't9'), `${d.id}: задача старого клиента не доехала`);
    assert.equal(T(d.state, 't1').title, 'Новое A');
    // Название t2 правили и старый, и новый, не видя друг друга, — конфликт.
    const c = d.bundle.conflicts.find((x) => x.id === 'task:t2:title');
    assert.ok(c, `${d.id}: параллельная правка моста не дала конфликта`);
    assert.deepEqual(c.versions.map((v) => v.value).sort(), ['B: звонок', 'Старый: звонок']);
  }
  assertConverged([A, B], 'мост');
});

test('9. гость → вход: локальные сущности появились в аккаунте, существующие в аккаунте целы', () => {
  const { srv, A } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Аккаунт: отчёт', now));
  settle([A]);
  // Гость работал без входа: свой проект, своя задача — и копия t1 со
  // старым названием (когда-то синхронизировался, потом вышел).
  const guest = {
    projects: [{ id: 'pg', name: 'Личное', color: '#3366ff', description: '', pinnedAt: null, tagIds: [], createdAt: iso(T0 - 2 * DAY) }],
    tasks: [
      task('tg', 'Купить хлеб', { projectId: 'pg', updatedAt: iso(T0 - 2 * DAY) }),
      task('t1', 'Гость: отчёт', { updatedAt: iso(T0 - 2 * HOUR()) }),
    ],
    statuses: [], tags: [], versions: [], documents: [],
  };
  const ops = O.guestImportOps(guest, { deviceId: 'G', at: iso(srv.now) });
  assert.ok(ops.every((o) => o.field === '*' && o.baseSeq === 0), 'гость шлёт не только создания или видел аккаунт');
  assert.equal(ops.find((o) => o.entityId === 'tg').at, iso(T0 - 2 * DAY), 'время правки гостя — не его updatedAt');

  srv.now += MIN;
  const G = Device.create('G', srv);
  const adopted = O.adoptGuestState(G.bundle, guest, { deviceId: 'G', at: iso(srv.now) });
  G.bundle = adopted.bundle;
  assert.ok(T(G.state, 'tg'), 'гостевая задача не легла в пачку аккаунта');
  settle([A, G]);
  for (const d of [A, G]) {
    assert.ok(T(d.state, 'tg') && d.state.projects.some((p) => p.id === 'pg'), `${d.id}: гостевое не появилось`);
    assert.equal(T(d.state, 't2').title, 'Позвонить', `${d.id}: тронута задача аккаунта`);
    assert.equal(T(d.state, 't1').title, 'Аккаунт: отчёт', `${d.id}: более старое гостевое затёрло аккаунт`);
    const c = d.bundle.conflicts.find((x) => x.id === 'task:t1:title');
    assert.ok(c && c.versions.some((v) => v.value === 'Гость: отчёт'), `${d.id}: версия гостя потерялась`);
  }
  assertConverged([A, G], 'гость');
});

test('10. часы убежали вперёд — at ограничен временем сервера, порядок не ломается', () => {
  const { srv, A, B, C } = trio();
  A.skew = 2 * HOUR();
  C.skew = -HOUR();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'A из будущего', now));
  A.push();
  const row = srv.rows.find((r) => r.field === 'title');
  assert.ok(Date.parse(row.at) <= srv.now + 5 * MIN, 'сервер не обрезал будущее');
  // B правит то же поле позже по настоящему времени, не видя A, — побеждает:
  // обрезанное время A уже не «позже всех».
  srv.now += 10 * MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B честно позже', now));
  settle([A, B, C]);
  for (const d of [A, B, C]) assert.equal(T(d.state, 't1').title, 'B честно позже', `${d.id}: будущее время выиграло спор`);
  // C с отстающими часами правит, увидев всё, — побеждает по порядку.
  srv.now += MIN; C.edit((s, now) => setField(s, 't1', 'title', 'C по очереди', now));
  settle([A, B, C]);
  for (const d of [A, B, C]) assert.equal(T(d.state, 't1').title, 'C по очереди', d.id);
  assertConverged([A, B, C], 'часы');

  // Правка без времени сервера режется от ctx.now так же.
  const far = { id: 'f1', entity: 'task', entityId: 't2', field: 'title', value: 'x', at: iso(T0 + DAY), deviceId: 'Z', baseSeq: 0, seq: 999 };
  const out = O.mergeIncoming(O.bootstrapFromSnapshot({ seq: 0, data: base() }, []), [far], { deviceId: 'Q', now: iso(T0) });
  assert.equal(out.meta['task:t2'].f.title[0].at, iso(T0 + 5 * MIN));
});

// ---------------------------------------------------------------------------
// Сверх сценариев
// ---------------------------------------------------------------------------

test('идемпотентность по op.id: applyOps и mergeIncoming не применяют правку дважды', () => {
  const st = base();
  const op = { id: '11111111-1111-4111-8111-111111111111', entity: 'task', entityId: 't1', field: 'sessions+', value: { id: 'k', start: iso(T0), end: iso(T0 + MIN), ms: MIN }, at: iso(T0), deviceId: 'Z', baseSeq: 0, seq: 3 };
  const once = O.applyOps(st, [op], { now: iso(T0) });
  const twice = O.applyOps(once.state, [op, op], { now: iso(T0) });
  assert.equal(T(twice.state, 't1').totalMs, MIN, 'запись времени посчитана дважды');
  assert.equal(T(twice.state, 't1').sessions.length, 1);
  const skipped = O.applyOps(st, [op], { appliedIds: [op.id] });
  assert.equal(skipped.applied.length, 0);
  assert.equal(O.applyOps(st, [op], { lastSeq: 3 }).applied.length, 0, 'seq ≤ lastSeq применился');
  assert.equal(st.tasks[0].sessions.length, 0, 'applyOps поменял исходное состояние');

  const b0 = O.bootstrapFromSnapshot({ seq: 0, data: base() }, []);
  const m1 = O.mergeIncoming(b0, [op, Object.assign({}, op)], { deviceId: 'Q', now: iso(T0) });
  const m2 = O.mergeIncoming(m1, [op], { deviceId: 'Q', now: iso(T0) });
  assert.equal(T(m2.state, 't1').totalMs, MIN);
  assert.equal(T(m2.state, 't1').sessions.length, 1);
  assert.equal(b0.state.tasks[0].sessions.length, 0, 'mergeIncoming поменял исходную пачку');
});

test('правка раньше создания откладывается и применяется, когда сущность пришла', () => {
  const edit = { id: 'e1', entity: 'task', entityId: 'tx', field: 'title', value: 'Уточнили', at: iso(T0 + 2 * MIN), deviceId: 'Z', baseSeq: 5, seq: 6 };
  const make = { id: 'c1', entity: 'task', entityId: 'tx', field: '*', value: task('tx', 'Новая'), at: iso(T0 + MIN), deviceId: 'Z', baseSeq: 4, seq: 5 };
  // Механически: в одном списке, правка первой.
  const flat = O.applyOps(base(), [edit, make]);
  assert.equal(T(flat.state, 'tx').title, 'Уточнили');
  assert.deepEqual(flat.deferred, []);
  assert.deepEqual(O.applyOps(base(), [edit]).deferred.map((o) => o.id), ['e1']);
  // Слиянием: правка пришла отдельно — ждёт в deferred, переживает пачку.
  // Создание её не видело (baseSeq 1 < 2), она — создания: они параллельны,
  // показывается поздняя, вторая — «другая версия». Не теряется ни одна.
  let b = O.bootstrapFromSnapshot({ seq: 0, data: base() }, []);
  b = O.mergeIncoming(b, [Object.assign({}, edit, { seq: 2, baseSeq: 1 })], { deviceId: 'Q', now: iso(T0) });
  assert.ok(!T(b.state, 'tx'));
  assert.deepEqual(b.deferred.map((o) => o.id), ['e1']);
  b = O.mergeIncoming(b, [Object.assign({}, make, { seq: 3, baseSeq: 1, deviceId: 'W' })], { deviceId: 'Q', now: iso(T0 + 5 * MIN) });
  assert.equal(T(b.state, 'tx').title, 'Уточнили');
  assert.deepEqual(b.deferred, []);
  const c = b.conflicts.find((x) => x.id === 'task:tx:title');
  assert.ok(c, 'создание и правка, не видевшие друг друга, не дали двух версий');
  assert.deepEqual(c.versions.map((v) => v.value).sort(), ['Новая', 'Уточнили']);
});

test('записи времени — множество: без id узнаются по началу, stampSessionIds ничего не ломает', () => {
  const { srv, A, B } = trio();
  // Записи без id — как у всех, заведённых до журнала.
  srv.now += MIN; A.edit((s, now) => addSession(s, 't1', null, T0, 10 * MIN, now));
  srv.now += MIN; B.edit((s, now) => addSession(s, 't1', null, T0 + HOUR(), 20 * MIN, now));
  settle([A, B]);
  for (const d of [A, B]) {
    assert.equal(T(d.state, 't1').sessions.length, 2, d.id);
    assert.equal(T(d.state, 't1').totalMs, 30 * MIN, d.id);
  }
  // Правка конца записи без id — правка той же записи, а не новая.
  srv.now += MIN;
  A.edit((s, now) => {
    const x = T(s, 't1');
    const rec = x.sessions.find((r) => r.start === iso(T0));
    rec.ms = 15 * MIN; rec.end = iso(T0 + 15 * MIN);
    x.totalMs += 5 * MIN; x.updatedAt = iso(now);
  });
  settle([A, B]);
  assert.equal(T(B.state, 't1').sessions.length, 2, 'правка записи без id стала второй записью');
  assert.equal(T(B.state, 't1').totalMs, 35 * MIN);
  assertConverged([A, B], 'записи без id');

  const stamped = O.stampSessionIds(A.state);
  assert.notEqual(stamped, A.state);
  assert.deepEqual(T(stamped, 't1').sessions.map((x) => x.id).sort(), [`s@${iso(T0)}`, `s@${iso(T0 + HOUR())}`]);
  assert.equal(O.stampSessionIds(stamped), stamped, 'повторный прогон что-то поменял');
  const c = O.commitLocal(A.bundle, stamped, { deviceId: 'A', at: iso(srv.now) });
  assert.deepEqual(c.ops, [], 'проставленные id ушли правками');
});

test('конфликт по заметкам хранит обе версии целиком и не закрывается дальнейшей правкой', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'notes', notes('текст A'), now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'notes', notes('текст B'), now));
  settle([A, B]);
  const c = A.bundle.conflicts.find((x) => x.id === 'task:t1:notes');
  assert.ok(c);
  assert.deepEqual(c.versions.map((v) => v.value).sort((a, b) => (a.ops[0].insert < b.ops[0].insert ? -1 : 1)), [notes('текст A'), notes('текст B')]);
  // Человек продолжает писать в показанной версии — «другая» остаётся.
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'notes', notes('текст B, дописано'), now));
  settle([A, B]);
  for (const d of [A, B]) {
    assert.deepEqual(T(d.state, 't1').notes, notes('текст B, дописано'), d.id);
    const k = d.bundle.conflicts.find((x) => x.id === 'task:t1:notes');
    assert.ok(k && k.versions.some((v) => same(v.value, notes('текст A'))), `${d.id}: «другая версия» пропала от правки`);
  }
  // Документ — то же, поле body.
  srv.now += MIN; A.edit((s, now) => { s.documents[0].body = notes('док A'); s.documents[0].updatedAt = iso(now); });
  srv.now += MIN; B.edit((s, now) => { s.documents[0].body = notes('док B'); s.documents[0].updatedAt = iso(now); });
  settle([A, B]);
  assert.ok(A.bundle.conflicts.some((x) => x.id === 'document:d1:body'));
  assert.ok(!A.bundle.conflicts.some((x) => x.id === 'document:d1:updatedAt'), 'тихое поле дало конфликт');
});
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

test('черновик, который автор сам переписал, не видя соперника, — не «другая версия»; переписанный после — версия', () => {
  // B офлайн правит название дважды, A — один раз: спорят A и последнее B.
  {
    const { srv, A, B, C } = trio();
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B-черновик', now));
    B.push(); // черновик ушёл в журнал раньше, чем A что-то прислал
    srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'A', now));
    A.push();
    C.pull(); // C застал спор «A против черновика»
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B-итог', now)); // B всё ещё не видел A
    settle([A, B, C]);
    for (const d of [A, B, C]) {
      const c = d.bundle.conflicts.find((x) => x.id === 'task:t1:title');
      assert.ok(c, d.id);
      assert.deepEqual(c.versions.map((v) => v.value).sort(), ['A', 'B-итог'], `${d.id}: черновик B показан версией`);
    }
    assertConverged([A, B, C], 'черновик');
  }
  // A проиграл спор и переписал показанный текст B — своё офлайн-написанное
  // остаётся версией: уникальное теперь только в нём.
  {
    const { srv, A, B } = trio();
    srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'notes', notes('A офлайн'), now));
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'notes', notes('B'), now));
    settle([A, B]);
    srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'notes', notes('B, и правка A'), now));
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'notes', notes('B, и правка B'), now)); // параллельно A
    settle([A, B]);
    for (const d of [A, B]) {
      const c = d.bundle.conflicts.find((x) => x.id === 'task:t1:notes');
      assert.ok(c && c.versions.some((v) => same(v.value, notes('A офлайн'))), `${d.id}: офлайн-текст A пропал из версий`);
    }
    assertConverged([A, B], 'переписанный после');
  }
});

test('resolveConflict закрывает конфликт и даёт обычную правку; версия, пришедшая параллельно решению, остаётся', () => {
  const { srv, A, B, C } = trio();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'A', now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B', now));
  settle([A, B]);
  const choice = A.bundle.conflicts[0].versions.find((v) => v.value === 'A').opId;
  srv.now += MIN;
  const r = O.resolveConflict(B.bundle, 'task:t1:title', choice, { deviceId: 'B', at: iso(B.now()) });
  assert.equal(r.ops.length, 2);
  const [fieldOp, done] = r.ops;
  assert.deepEqual([fieldOp.entity, fieldOp.entityId, fieldOp.field, fieldOp.value], ['task', 't1', 'title', 'A']);
  assert.equal(fieldOp.baseSeq, B.bundle.lastSeq);
  assert.equal(done.field, 'resolved');
  assert.equal(done.value.key, 'task:t1:title');
  assert.equal(done.value.keep, choice);
  assert.equal(done.value.seen.length, 2);
  B.bundle = r.bundle;
  assert.deepEqual(B.bundle.conflicts, []);
  // C был офлайн всё это время и тоже правил название — не видя ни A, ни B,
  // ни решения.
  srv.now += MIN; C.edit((s, now) => setField(s, 't1', 'title', 'C', now));
  settle([A, B, C]);
  for (const d of [A, B, C]) {
    assert.equal(T(d.state, 't1').title, 'C', `${d.id}: показана не поздняя`);
    const k = d.bundle.conflicts.find((x) => x.id === 'task:t1:title');
    assert.ok(k, `${d.id}: параллельная решению версия потерялась`);
    assert.deepEqual(k.versions.map((v) => v.value).sort(), ['A', 'C'], d.id);
  }
});

test('diffStates: поля целиком, totalMs и порядок не уходят, отсутствующего списка не касается', () => {
  const prev = base();
  const next = clone(prev);
  next.tasks.reverse(); // порядок — не правка
  T(next, 't1').totalMs = 999; // производное — не правка
  T(next, 't1').notes = notes('x');
  T(next, 't2').tagIds = ['g1'];
  delete next.documents; // «не знаю»
  next.statuses[0].order = 3;
  const ops = O.diffStates(prev, next, { deviceId: 'A', at: iso(T0), baseSeq: 7 });
  assert.deepEqual(ops.map((o) => `${o.entity}:${o.entityId}:${o.field}`).sort(), ['status:s1:order', 'task:t1:notes', 'task:t2:tagIds']);
  assert.ok(ops.every((o) => o.deviceId === 'A' && o.baseSeq === 7 && o.seq === null && o.at === iso(T0)));
  assert.ok(ops.every((o) => /^[0-9a-f-]{36}$/.test(o.id)), 'id правки — не uuid');
  // Значение — копия: правка состояния на месте (app.js) не меняет правку.
  T(next, 't1').notes.ops.push({ insert: 'позже' });
  assert.equal(ops.find((o) => o.field === 'notes').value.ops.length, 1);
  // Создание и удаление.
  const n2 = clone(prev);
  n2.tasks = n2.tasks.filter((x) => x.id !== 't2');
  n2.tasks.unshift(task('t3', 'Новая'));
  const ops2 = O.diffStates(prev, n2, { deviceId: 'A', at: iso(T0) });
  assert.deepEqual(ops2.map((o) => [o.entityId, o.field]), [['t3', '*'], ['t2', 'deleted']]);
  assert.equal(ops2[1].value, iso(T0));
});

test('isConcurrent: «видела» по baseSeq и по устройству, неотправленная своя — параллельна новому', () => {
  const a = { id: 'a', seq: 5, baseSeq: 3, deviceId: 'A' };
  assert.equal(O.isConcurrent(a, { id: 'b', seq: 6, baseSeq: 4, deviceId: 'B' }), true);
  assert.equal(O.isConcurrent(a, { id: 'b', seq: 6, baseSeq: 5, deviceId: 'B' }), false, 'видела — не параллельно');
  assert.equal(O.isConcurrent(a, { id: 'c', seq: 9, baseSeq: 0, deviceId: 'A' }), false, 'одно устройство — по очереди');
  const mine = { id: 'm', seq: null, baseSeq: 4, deviceId: 'A' };
  assert.equal(O.isConcurrent(mine, { id: 'x', seq: 7, baseSeq: 4, deviceId: 'B' }), true);
  assert.equal(O.isConcurrent(mine, { id: 'y', seq: 4, baseSeq: 2, deviceId: 'B' }), false, 'своя видела то, что уже было применено');
  assert.equal(O.isConcurrent({ id: 'n', seq: null, deviceId: 'A' }, { id: 'y', seq: 4, baseSeq: 2, deviceId: 'B' }, { lastSeq: 4 }), false, 'без baseSeq — по ctx.lastSeq');
});

test('ackPending и сервер, обрезавший своё время: победитель пересчитывается', () => {
  const { srv, A, B } = trio();
  A.skew = 3 * HOUR();
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'A', now));
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B', now));
  B.push();
  A.pull(); // своя ещё не отправлена, её время — +3 часа: пока выигрывает
  assert.equal(T(A.state, 't1').title, 'A');
  // Сервер принял правку A со временем раньше, чем у B (подстроено).
  const mine = A.bundle.pending.find((p) => p.field === 'title');
  const rows = [{ op_id: mine.id, seq: 99, at: iso(T0), base_seq: 0, entity: 'task', entity_id: 't1', field: 'title', device_id: 'A' }];
  A.bundle = O.ackPending(A.bundle, rows, { deviceId: 'A', now: iso(srv.now) });
  assert.ok(!A.bundle.pending.some((p) => p.id === mine.id), 'принятая правка осталась в очереди');
  assert.equal(T(A.state, 't1').title, 'B', 'после обрезки времени победитель не сменился');
});

test('корзина: trashSweep убирает старше 30 дней, свежее не трогает', () => {
  const { srv, A } = trio();
  srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
  srv.now += 10 * DAY; A.edit((s) => dropTask(s, 't2'));
  const kept = O.trashSweep(A.bundle, iso(T0 + 20 * DAY));
  assert.deepEqual(kept.trash.map((t) => t.entityId).sort(), ['t1', 't2']);
  const swept = O.trashSweep(A.bundle, iso(T0 + 31 * DAY));
  assert.deepEqual(swept.trash.map((t) => t.entityId), ['t2']);
  assert.ok(!swept.meta['task:t1'], 'история вычищенного осталась');
  assert.ok(swept.meta['task:t2']);
  assert.deepEqual(O.trashSweep(A.bundle, iso(T0 + 31 * DAY), 5).trash, []);
});

test('строки таблицы ↔ правки: opToRow и rowToOp обратимы, mergeIncoming берёт строки как есть', () => {
  const op = { id: '22222222-2222-4222-8222-222222222222', entity: 'task', entityId: 't1', field: 'title', value: 'Из строки', at: iso(T0), deviceId: 'Z', baseSeq: 2, seq: null };
  const row = Object.assign(O.opToRow(op), { seq: 4, created_at: iso(T0) });
  assert.deepEqual(Object.keys(O.opToRow(op)).sort(), ['at', 'base_seq', 'device_id', 'entity', 'entity_id', 'field', 'op_id', 'value']);
  assert.deepEqual(O.rowToOp(row), Object.assign({}, op, { seq: 4, createdAt: iso(T0) }));
  const out = O.mergeIncoming(O.bootstrapFromSnapshot({ seq: 0, data: base() }, []), [row], { deviceId: 'Q', now: iso(T0) });
  assert.equal(T(out.state, 't1').title, 'Из строки');
  assert.equal(out.lastSeq, 4);
});

// ---------------------------------------------------------------------------
// Генератор: случайные правки, связь и порядок — итог один на всех
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** opts.shared — у A и B один deviceId (две вкладки, копия устройства);
 *  opts.noDelete — без удалений задач. */
function randomRun(seed, opts) {
  const o = opts || {};
  idn = 0;
  const r = rng(seed);
  const pickOf = (arr) => arr[Math.floor(r() * arr.length)];
  const srv = Server.create();
  const devs = ['A', 'B', 'C'].map((id) => Device.create(id, srv, { device: o.shared && id !== 'C' ? 'W' : id, skew: Math.floor((r() - 0.5) * 4 * MIN) }));
  if (r() < 0.3) devs[0].skew = 2 * HOUR(); // одно устройство с убежавшими часами
  let n = 0;
  const shuffle = (rows) => rows.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  for (let step = 0; step < 45; step++) {
    srv.now += Math.floor(r() * 3 * MIN);
    const d = pickOf(devs);
    const alive = (d.state.tasks || []).map((x) => x.id);
    const roll = r();
    if (roll < 0.15) d.push();
    else if (roll < 0.28) d.pull(r() < 0.5 ? undefined : 1 + Math.floor(r() * 4), shuffle);
    else if (!alive.length || roll < 0.33) {
      n++;
      d.edit((s, now) => s.tasks.unshift(task(`${d.id}-t${n}`, `новая ${n}`, { createdAt: iso(now), updatedAt: iso(now) })));
    } else {
      const id = pickOf(alive);
      const kind = r();
      if (kind < 0.25) d.edit((s, now) => setField(s, id, 'title', pickOf(['α', 'β', 'γ', `т${step}`]), now));
      else if (kind < 0.35) d.edit((s, now) => setField(s, id, 'notes', notes(`з${step}`), now));
      else if (kind < 0.42) d.edit((s, now) => setField(s, id, 'dueAt', iso(T0 + Math.floor(r() * 5) * DAY), now));
      else if (kind < 0.57) { n++; d.edit((s, now) => addSession(s, id, `${d.id}-s${n}`, T0 + n * HOUR(), (1 + Math.floor(r() * 9)) * MIN, now)); }
      else if (kind < 0.7) {
        const ss = T(d.state, id).sessions.filter((x) => x.id);
        if (ss.length) { const sid = pickOf(ss).id; d.edit((s, now) => editSession(s, id, sid, (1 + Math.floor(r() * 9)) * MIN, now)); }
      } else if (kind < 0.76) {
        const ss = T(d.state, id).sessions.filter((x) => x.id);
        if (ss.length) { const sid = pickOf(ss).id; d.edit((s, now) => dropSession(s, id, sid, now)); }
      } else if (kind < 0.84) {
        if (!o.noDelete) d.edit((s) => dropTask(s, id));
      }
      else if (kind < 0.9 && d.bundle.trash.length) {
        const t = pickOf(d.bundle.trash);
        d.bundle = O.restoreFromTrash(d.bundle, t.entity, t.entityId, { deviceId: d.dev, at: iso(d.now()), newId: nextId }).bundle;
      } else if (d.bundle.conflicts.length) {
        const c = pickOf(d.bundle.conflicts);
        d.bundle = O.resolveConflict(d.bundle, c.id, pickOf(['ours', 'theirs']), { deviceId: d.dev, at: iso(d.now()), newId: nextId }).bundle;
      }
    }
  }
  settle(devs);
  return { srv, devs };
}

/** Случайная история: все сошлись, с нуля по журналу — то же. */
function checkRun(seed, opts) {
  const { srv, devs } = randomRun(seed, opts);
  for (const d of devs) assert.equal(d.bundle.pending.length, 0, `seed ${seed}: ${d.id} не всё отправил`);
  assertConverged(devs, `seed ${seed}`);
  const fresh = Device.create('F', srv);
  assert.deepEqual(norm(fresh.state), norm(devs[0].state), `seed ${seed}: журнал с нуля дал другое состояние`);
  assert.deepEqual(trashIds(fresh), trashIds(devs[0]), `seed ${seed}: корзина по журналу другая`);
  assert.deepEqual(conflictIds(fresh), conflictIds(devs[0]), `seed ${seed}: конфликты по журналу другие`);
  // Сумма времени у каждой задачи — сумма её записей.
  for (const x of devs[0].state.tasks) {
    assert.equal(x.totalMs, x.sessions.reduce((a, s) => a + s.ms, 0), `seed ${seed}: totalMs ${x.id} разошёлся с записями`);
  }
}

test('генератор: 300 случайных историй на трёх устройствах сходятся, и с нуля по журналу — то же', () => {
  for (let seed = 1; seed <= 300; seed++) checkRun(seed);
});

test('генератор: два устройства с одним deviceId (вкладки, копия) — правки полей, записи времени, конфликты и выбор сходятся', () => {
  // Без удалений: удаление против правки у копий одного deviceId сходится
  // не всегда (своё удаление ложится у себя раньше своего места в журнале,
  // а остальные считают правки копий идущими по очереди) — см.
  // ARCHITECTURE.md, «Синхронизация».
  for (let seed = 1; seed <= 300; seed++) checkRun(seed, { shared: true, noDelete: true });
});

test('project.updatedAt (отметка свежести, 19.10.2026) — тихое поле: правки проекта с двух устройств сходятся без конфликта, побеждает поздняя', () => {
  // Веб и телефон ставят project.updatedAt при правке проекта (имя, цвет,
  // статусы, версии, свои теги) — по нему «Проекты» стоят по свежести
  // (Core.projectsByActivity). Поле в QUIET: «другая версия» времени правки
  // человеку не нужна, и спора из-за него быть не должно.
  const { srv, A, B, C } = trio();
  const P = (s) => s.projects.find((x) => x.id === 'p1');
  srv.now += MIN; A.edit((s, now) => { P(s).name = 'Работа и дом'; P(s).updatedAt = iso(now); });
  srv.now += MIN; B.edit((s, now) => {
    s.statuses.push({ id: 's2', projectId: 'p1', name: 'Ревью', color: '#888888', kind: 'progress', order: 1, builtin: false });
    P(s).updatedAt = iso(now);
  });
  settle([A, B, C]);
  for (const d of [A, B, C]) {
    assert.equal(P(d.state).name, 'Работа и дом', d.id);
    assert.ok(d.state.statuses.some((x) => x.id === 's2'), `${d.id}: статус на месте`);
    assert.equal(P(d.state).updatedAt, iso(T0 + 2 * MIN), `${d.id}: побеждает поздняя отметка`);
    assert.deepEqual(d.bundle.conflicts, [], `${d.id}: из-за отметки свежести конфликта нет`);
  }
  assertConverged([A, B, C], 'отметка свежести проекта');
  // Закрепление отметку не ставит — и не трогает её у других.
  srv.now += MIN; C.edit((s, now) => { P(s).pinnedAt = iso(now); });
  settle([A, B, C]);
  for (const d of [A, B, C]) assert.equal(P(d.state).updatedAt, iso(T0 + 2 * MIN), d.id);
  assertConverged([A, B, C], 'после закрепления');
});

// ---------------------------------------------------------------------------
// Своё — по op_id, спасённое, время удаления, \u0000 (19 октября 2026)
// ---------------------------------------------------------------------------
//
// Одна установка — не всегда одно устройство: две вкладки веба делят
// lancible:device, телефон из резервной копии и скопированная папка
// десктопа приносят второй экземпляр с тем же deviceId. Своей правку делает
// op_id (очередь и отправленные), а не deviceId.

/** op_id в отправленных (meta, s) сущности. */
const sentIds = (d, ek) => ((d.bundle.meta[ek] && d.bundle.meta[ek].s) || []);

test('вторая вкладка с тем же deviceId получает задачу первой: lastSeq не уходит за неё без применения, слепок и зеркало — с ней', () => {
  const srv = Server.create();
  const A = Device.create('A', srv, { device: 'web-W' });
  const B = Device.create('B', srv, { device: 'web-W' }); // вторая вкладка того же браузера
  const C = Device.create('C', srv);
  srv.now += MIN; A.edit((s, now) => s.tasks.unshift(task('t3', 'Из вкладки A', { createdAt: iso(now), updatedAt: iso(now) })));
  const rows = A.push();
  const made = rows.find((r) => r.entity_id === 't3' && r.field === '*');
  B.pull();
  assert.ok(T(B.state, 't3'), 'задача вкладки A не появилась во вкладке B');
  assert.equal(B.bundle.lastSeq, made.seq);
  assert.ok(O.compactSnapshot(B.bundle).data.tasks.some((x) => x.id === 't3'), 'слепок ушёл бы без задачи');
  assert.ok(O.mirrorSyncState(B.bundle).tasks.some((x) => x.id === 't3'), 'зеркало для старых клиентов — без задачи');
  // И обратно: правка вкладки B доходит до A и до других.
  srv.now += MIN; B.edit((s, now) => setField(s, 't3', 'title', 'Уточнила вкладка B', now));
  settle([A, B, C]);
  for (const d of [A, B, C]) {
    assert.equal(T(d.state, 't3').title, 'Уточнила вкладка B', d.id);
    assert.deepEqual(d.bundle.conflicts, [], `${d.id}: правки по очереди дали конфликт`);
  }
  assertConverged([A, B, C], 'две вкладки');
});

test('своя правка подтверждается и не применяется дважды — и после перезапуска между отправкой и чтением', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => addSession(s, 't1', 'sa', T0, 30 * MIN, now));
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Черновик', now));
  const rows = A.push();
  // Ушла из очереди — лежит в отправленных, пока журнал её не вернёт; в
  // слепок это знание устройства не попадает.
  assert.equal(A.bundle.pending.length, 0);
  assert.deepEqual(sentIds(A, 'task:t1').slice().sort(), rows.map((r) => r.op_id).sort(), 'отправленные не запомнены');
  assert.ok(Object.values(O.compactSnapshot(A.bundle).data.oplog.meta).every((m) => !m.s), 'слепок унёс отправленные');
  // Название переписано до чтения журнала, потом перезапуск.
  srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Итог', now));
  A.reload();
  A.pull();
  const t1 = T(A.state, 't1');
  assert.equal(t1.title, 'Итог');
  assert.equal(t1.sessions.length, 1, 'своя запись времени применилась второй раз');
  assert.equal(t1.totalMs, 30 * MIN);
  assert.deepEqual(A.bundle.conflicts, [], 'своя переписанная правка стала «другой версией»');
  assert.deepEqual(A.events, []);
  assert.deepEqual(sentIds(A, 'task:t1'), [], 'прочитанное осталось в отправленных');
  settle([A, B]);
  for (const d of [A, B]) {
    assert.equal(T(d.state, 't1').title, 'Итог', d.id);
    assert.equal(T(d.state, 't1').totalMs, 30 * MIN, d.id);
    assert.deepEqual(d.bundle.conflicts, [], d.id);
  }
  assertConverged([A, B], 'своё после перезапуска');
});

test('пачка, сохранённая до списка отправленных: своё создание узнаётся по истории сущности, ложного конфликта нет', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; A.edit((s, now) => s.tasks.unshift(task('t3', 'Новая', { createdAt: iso(now), updatedAt: iso(now) })));
  A.push();
  srv.now += MIN; A.edit((s, now) => setField(s, 't3', 'title', 'Новая, уточнённая', now));
  for (const ek of Object.keys(A.bundle.meta)) delete A.bundle.meta[ek].s; // так выглядела пачка раньше
  A.pull();
  assert.equal(T(A.state, 't3').title, 'Новая, уточнённая');
  assert.deepEqual(A.bundle.conflicts, []);
  settle([A, B]);
  assertConverged([A, B], 'старая пачка');
  assert.deepEqual(B.bundle.conflicts, []);
});

test('телефон из резервной копии (тот же deviceId) сходится с остальными: правки после копии доходят в обе стороны', () => {
  const { srv, A, B } = trio();
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'B: до копии', now));
  B.push(); // копия снята после отправки, но до чтения: в ней есть отправленные
  const B2 = Device.copy(B, 'B2');
  srv.now += MIN; B.pull();
  srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'dueAt', iso(T0 + 2 * DAY), now));
  srv.now += MIN; B.edit((s, now) => s.tasks.unshift(task('tb', 'Со старого телефона', { createdAt: iso(now), updatedAt: iso(now) })));
  B.push();
  // Новый телефон восстановлен из копии и выходит на связь.
  srv.now += MIN; B2.pull();
  assert.ok(T(B2.state, 'tb'), 'правка старого телефона не дошла до восстановленного');
  assert.equal(T(B2.state, 't1').dueAt, iso(T0 + 2 * DAY));
  srv.now += MIN; B2.edit((s, now) => setField(s, 'tb', 'notes', notes('с нового телефона'), now));
  settle([A, B, B2]);
  for (const d of [A, B, B2]) {
    assert.deepEqual(T(d.state, 'tb').notes, notes('с нового телефона'), d.id);
    assert.equal(T(d.state, 't1').title, 'B: до копии', d.id);
    assert.deepEqual(d.bundle.conflicts, [], d.id);
  }
  assertConverged([A, B, B2], 'резервная копия');
});

test('две копии с одним deviceId правят одно поле параллельно — конфликт с обеими версиями, как у разных устройств, итог один на всех', () => {
  for (const firstSent of ['A', 'B']) {
    const srv = Server.create();
    const A = Device.create('A', srv, { device: 'phone-P' });
    const B = Device.create('B', srv, { device: 'phone-P' });
    const C = Device.create('C', srv);
    srv.now += MIN; A.edit((s, now) => setField(s, 't1', 'title', 'Версия A', now));
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Версия B', now));
    if (firstSent === 'B') { B.push(); A.push(); } else { A.push(); B.push(); }
    settle([A, B, C]);
    for (const d of [A, B, C]) {
      const c = d.bundle.conflicts.find((x) => x.id === 'task:t1:title');
      assert.ok(c, `${firstSent}: ${d.id} не видит конфликта`);
      assert.deepEqual(c.versions.map((v) => v.value).sort(), ['Версия A', 'Версия B'], `${firstSent}: ${d.id}`);
    }
    assertConverged([A, B, C], `копии, первой ушла ${firstSent}`);
    // Показана последняя в журнале: так её видит и устройство, которому
    // эти правки — «по очереди» одного deviceId.
    const last = srv.rows.filter((r) => r.field === 'title').sort((a, b) => b.seq - a.seq)[0];
    assert.equal(T(C.state, 't1').title, last.value, firstSent);
    // Выбор закрывает конфликт везде.
    srv.now += MIN;
    C.bundle = O.resolveConflict(C.bundle, 'task:t1:title', 'theirs', { deviceId: 'C', at: iso(C.now()), newId: nextId }).bundle;
    settle([A, B, C]);
    for (const d of [A, B, C]) assert.deepEqual(d.bundle.conflicts, [], `${firstSent}: ${d.id} — конфликт не закрылся`);
    assertConverged([A, B, C], `копии после выбора, ${firstSent}`);
  }
});

test('копии одного deviceId: удаление на одной против правки на другой — итог один на всех', () => {
  // Правка копии B ушла и прочитана раньше, чем ушло удаление копии A.
  {
    const srv = Server.create();
    const A = Device.create('A', srv, { device: 'W' });
    const B = Device.create('B', srv, { device: 'W' });
    const C = Device.create('C', srv);
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Правка B', now));
    srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
    B.push(); B.pull();
    A.push();
    settle([A, B, C]);
    assertConverged([A, B, C], 'удаление позже правки копии');
  }
  // Правка копии ещё в очереди, когда приходит удаление другой копии.
  {
    const srv = Server.create();
    const A = Device.create('A', srv, { device: 'W' });
    const B = Device.create('B', srv, { device: 'W' });
    const C = Device.create('C', srv);
    srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
    A.push();
    srv.now += MIN; B.edit((s, now) => setField(s, 't1', 'title', 'Правка B', now));
    B.pull(); // своя правка B ещё не ушла
    C.pull();
    settle([A, B, C]);
    assertConverged([A, B, C], 'правка копии в очереди');
  }
});

test('задача, спасённая поздней правкой после вычистки корзины, уходит заново целиком и появляется у всех, и у удалившего', () => {
  const { srv, A: X, B: Y, C: Z } = trio();
  srv.now += MIN; Y.edit((s, now) => setField(s, 't1', 'title', 'Y офлайн: поздняя правка', now)); // Y без связи
  srv.now += MIN; X.edit((s) => dropTask(s, 't1'));
  X.push();
  Z.pull();
  srv.now += 31 * DAY;
  X.bundle = O.trashSweep(X.bundle, iso(X.now()), 30);
  Z.bundle = O.trashSweep(Z.bundle, iso(Z.now()), 30);
  assert.deepEqual(trashIds(X), []);
  assert.ok(!X.bundle.meta['task:t1'], 'история вычищенного осталась');
  // Y выходит на связь через месяц.
  Y.push();
  Y.pull();
  assert.ok(T(Y.state, 't1'), 'правка Y не спасла задачу у самого Y');
  assert.ok(Y.events.some((e) => e.type === 'restored' && e.entityId === 't1'));
  const again = Y.bundle.pending.filter((p) => p.entityId === 't1' && p.field === '*');
  assert.equal(again.length, 1, 'спасённая задача не ушла заново целиком');
  assert.equal(again[0].value.title, 'Y офлайн: поздняя правка');
  settle([X, Y, Z]);
  for (const d of [X, Y, Z]) {
    assert.equal(T(d.state, 't1') && T(d.state, 't1').title, 'Y офлайн: поздняя правка', `${d.id}: спасённой задачи нет`);
    assert.deepEqual(d.bundle.deferred, [], `${d.id}: правка так и ждёт создания`);
    assert.deepEqual(d.bundle.conflicts, [], d.id);
  }
  assertConverged([X, Y, Z], 'спасённая задача');
  // С нуля по журналу — то же, и без новых правок: при старте повторять некому.
  const F = Device.create('F', srv);
  assert.equal(T(F.state, 't1').title, 'Y офлайн: поздняя правка');
  assert.deepEqual(F.bundle.pending, []);
});

test('свежее удаление против поздней правки — задача возвращается из корзины правкой, целиком заново не уходит', () => {
  const { srv, A: X, B: Y, C: Z } = trio();
  srv.now += MIN; Y.edit((s, now) => setField(s, 't1', 'title', 'Правка Y', now));
  srv.now += MIN; X.edit((s) => dropTask(s, 't1'));
  X.push();
  Z.pull();
  srv.now += HOUR();
  Y.push();
  Y.pull();
  assert.ok(T(Y.state, 't1'));
  assert.deepEqual(Y.bundle.pending.filter((p) => p.field === '*'), [], 'свежее удаление: у всех задача ещё в корзине');
  settle([X, Y, Z]);
  for (const d of [X, Y, Z]) assert.equal(T(d.state, 't1') && T(d.state, 't1').title, 'Правка Y', d.id);
  assertConverged([X, Y, Z], 'свежее удаление');
});

test('время чужого удаления — по журналу (created_at): часы автора, отставшие на 40 дней, не выметают удалённое сразу', () => {
  const { srv, A, B } = trio();
  A.skew = -40 * DAY;
  srv.now += MIN; A.edit((s) => dropTask(s, 't1'));
  A.push();
  B.pull();
  const t = B.bundle.trash.find((x) => x.entityId === 't1');
  assert.equal(t.deletedAt, iso(srv.now), 'время удаления — не время приёма журналом');
  assert.ok(O.trashSweep(B.bundle, iso(B.now()), 30).trash.some((x) => x.entityId === 't1'), 'выметено сразу');
  assert.ok(!O.trashSweep(B.bundle, iso(B.now() + 31 * DAY), 30).trash.some((x) => x.entityId === 't1'), 'через 31 день не выметено');
  // Строка без created_at (старый вид) — как раньше: время из самой правки.
  const old = { id: 'del-old', entity: 'task', entityId: 't2', field: 'deleted', value: iso(T0 - 40 * DAY), at: iso(T0 - 40 * DAY), deviceId: 'Z', baseSeq: 0, seq: 50 };
  const out = O.mergeIncoming(O.bootstrapFromSnapshot({ seq: 0, data: base() }, []), [old], { deviceId: 'Q', now: iso(T0) });
  assert.equal(out.trash.find((x) => x.entityId === 't2').deletedAt, iso(T0 - 40 * DAY));
});

test('\\u0000 в названии и заметках в очередь не уходит, в пачке не остаётся и следующего сохранения не будит', () => {
  const { srv, A, B } = trio();
  srv.now += MIN;
  const ops = A.edit((s, now) => {
    setField(s, 't1', 'title', 'Отчёт\u0000 за квартал', now);
    setField(s, 't1', 'notes', notes('строка\u0000с нулём'), now);
  });
  assert.ok(!JSON.stringify(A.bundle.pending).includes('\\u0000'), 'символ ушёл в очередь');
  assert.equal(ops.find((o) => o.field === 'title').value, 'Отчёт за квартал');
  assert.deepEqual(ops.find((o) => o.field === 'notes').value, notes('строкас нулём'));
  assert.equal(T(A.state, 't1').title, 'Отчёт за квартал', 'символ остался в состоянии пачки');
  // Живое состояние клиента ещё держит символ — новых правок это не даёт.
  const live = clone(A.state);
  T(live, 't1').title = 'Отчёт\u0000 за квартал';
  assert.deepEqual(O.commitLocal(A.bundle, live, { deviceId: 'A', at: iso(A.now()), newId: nextId }).ops, []);
  settle([A, B]);
  assert.equal(T(B.state, 't1').title, 'Отчёт за квартал');
  assertConverged([A, B], 'нулевой символ');
  // Правка, легшая в очередь до чистки, уходит строкой уже без него.
  const queued = { id: 'q1', entity: 'task', entityId: 't1', field: 'notes', value: { ops: [{ insert: 'x\u0000y\n' }], k: { 'a\u0000': 1 } }, at: iso(T0), deviceId: 'A', baseSeq: 0, seq: null };
  assert.deepEqual(O.opToRow(queued).value, { ops: [{ insert: 'xy\n' }], k: { a: 1 } });
  // Удалённое до чистки возвращается из корзины тоже без него.
  const dirty = stored(A.bundle);
  dirty.trash.push({ entity: 'task', entityId: 'tz', data: task('tz', 'Старая\u0000'), deletedAt: iso(A.now()), deviceId: 'A', opId: 'd-old', ref: null });
  const back = O.restoreFromTrash(dirty, 'task', 'tz', { deviceId: 'A', at: iso(A.now()), newId: nextId });
  assert.equal(back.ops.find((o) => o.field === '*').value.title, 'Старая');
  assert.equal(T(back.bundle.state, 'tz').title, 'Старая');
});

// Подменный supabase для тестов синхронизации телефона (17 октября 2026,
// журнал правок). Не тест — помощник: jest берёт только *.test.js.
//
// Сервер ведёт себя как supabase/sync2.sql: seq по порядку, повтор op_id
// отбивается (ignore-duplicates — молча, без строки в ответе), at режется до
// now + 5 минут, base_seq — не больше последнего seq пользователя, слепок не
// забегает вперёд журнала; RLS — свои строки (uid вошедшего). sync_state —
// upsert меняет только присланные колонки (как PostgREST), поэтому
// mirror_seq, которого старый клиент не шлёт, остаётся. Realtime — события
// подписанным каналам (INSERT на changes, INSERT/UPDATE на sync_state), со
// строкой целиком, как у supabase. offline — каждый запрос падает, как без
// сети. refuse — вставку в changes сервер отбивает этой ошибкой (ответ 4xx),
// а чтение идёт; строку с \u0000 в значении он отбивает всегда, как Postgres
// (jsonb этот символ не принимает: 22P05) — вся вставка целиком.
//
// Второе устройство (peer) — пачка ядра с тем же протоколом, что у
// телефона: читает журнал, правит, шлёт. Им тесты делают «чужие» правки.
const Oplog = require('../src/core/oplog.js');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const MIN = 60000;

function createWorld() {
  const db = {
    uid: null, // кто вошёл (auth.uid() для RLS и значений по умолчанию)
    seq: 0,
    changes: [],
    snapshots: [],
    syncState: {},
    profiles: {},
    channels: [],
    calls: [],
    offline: false,
    refuse: null,
    hold: null,
    now: () => Date.now(),
  };

  const iso = (ms) => new Date(ms).toISOString();
  const topOf = (uid) => db.changes.filter((r) => r.user_id === uid).reduce((m, r) => Math.max(m, r.seq), 0);

  function emit(table, event, row) {
    for (const ch of db.channels.slice()) {
      for (const h of ch.handlers) {
        const f = h.filter || {};
        if (f.table !== table) continue;
        if (f.event !== '*' && f.event !== event) continue;
        if (f.filter && f.filter !== `user_id=eq.${row.user_id}`) continue;
        setTimeout(() => h.handler({ eventType: event, new: clone(row) }), 0);
      }
    }
  }

  const hasNul = (v) => (typeof v === 'string' ? v.includes('\u0000')
    : Array.isArray(v) ? v.some(hasNul)
      : v && typeof v === 'object' ? Object.keys(v).some((k) => k.includes('\u0000') || hasNul(v[k])) : false);

  /** Строки журнала без RLS — как их кладёт сервер (и для «чужих» устройств). */
  function insertChanges(rows, { ignoreDuplicates = true, user } = {}) {
    if (rows.some((r) => hasNul(r && r.value) || hasNul(r && r.entity_id) || hasNul(r && r.field))) {
      return { error: { code: '22P05', message: 'unsupported Unicode escape sequence', details: '\u0000 cannot be converted to text.' }, status: 400 };
    }
    const out = [];
    for (const raw of rows) {
      const row = clone(raw);
      row.user_id = row.user_id || user || db.uid;
      if (db.changes.some((r) => r.user_id === row.user_id && r.op_id === row.op_id)) {
        if (ignoreDuplicates) continue;
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      const top = topOf(row.user_id);
      db.seq += 1;
      row.seq = db.seq;
      const now = db.now();
      row.created_at = iso(now);
      if (!row.at || Date.parse(row.at) > now + 5 * MIN) row.at = iso(now + 5 * MIN);
      row.base_seq = Math.min(Number(row.base_seq) || 0, top);
      db.changes.push(row);
      out.push(clone(row));
    }
    for (const r of out) emit('changes', 'INSERT', r);
    return { data: out, error: null };
  }

  function upsertSyncState(row) {
    const uid = row.user_id || db.uid;
    const had = db.syncState[uid];
    const next = { ...(had || {}), ...clone(row), user_id: uid };
    db.syncState[uid] = next;
    emit('sync_state', had ? 'UPDATE' : 'INSERT', next);
    return next;
  }

  class Query {
    static create(table) {
      const q = new Query();
      Object.assign(q, { table, filters: [], ord: null, lim: null, single: false, op: 'select', payload: null, opts: {}, ret: false });
      return q;
    }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    gt(c, v) { this.filters.push((r) => Number(r[c]) > Number(v)); return this; }
    lte(c, v) { this.filters.push((r) => Number(r[c]) <= Number(v)); return this; }
    order(c, o = {}) { this.ord = { c, asc: o.ascending !== false }; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single = true; return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = rows; this.opts = opts; return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    // hold — обещание: пока оно не исполнилось, ответы не приходят (запрос
    // «в пути»; тест успевает, например, сменить аккаунт).
    then(resolve, reject) { return Promise.resolve(db.hold).then(() => this.run()).then(resolve, reject); }

    pick(rows) {
      let out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.ord) {
        const { c, asc } = this.ord;
        out = out.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.lim !== null) out = out.slice(0, this.lim);
      out = clone(out);
      if (this.single) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }

    run() {
      db.calls.push(`${this.op} ${this.table}`);
      if (db.offline) return { data: null, error: { message: 'Network request failed' } };
      const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
      if (this.table === 'changes') {
        if (this.op === 'select') return this.pick(db.changes.filter((r) => r.user_id === db.uid));
        if (rows.some((r) => (r.user_id || db.uid) !== db.uid)) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
        if (db.refuse) return { data: null, error: db.refuse, status: 400 };
        const res = insertChanges(rows, { ignoreDuplicates: this.op === 'upsert' && !!this.opts.ignoreDuplicates });
        if (res.error) return { data: null, error: res.error, status: res.status || 400 };
        return { data: this.ret ? res.data : null, error: null };
      }
      if (this.table === 'snapshots') {
        if (this.op === 'select') return this.pick(db.snapshots.filter((r) => r.user_id === db.uid));
        for (const raw of rows) {
          const row = { ...clone(raw), user_id: raw.user_id || db.uid };
          if (db.snapshots.some((s) => s.user_id === row.user_id && s.seq === row.seq)) {
            if (this.opts.ignoreDuplicates) continue;
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          if (row.seq > topOf(row.user_id)) return { data: null, error: { code: '23514', message: 'слепок впереди журнала' } };
          row.created_at = iso(db.now());
          db.snapshots.push(row);
        }
        return { data: null, error: null };
      }
      if (this.table === 'sync_state') {
        if (this.op === 'select') return this.pick(Object.values(db.syncState).filter((r) => r.user_id === db.uid));
        for (const raw of rows) upsertSyncState(raw);
        return { data: null, error: null };
      }
      if (this.table === 'profiles') {
        if (this.op === 'select') {
          return this.pick(Object.entries(db.profiles).map(([id, p]) => ({ id, ...p })));
        }
        return { data: null, error: null };
      }
      return { data: this.single ? null : [], error: null };
    }
  }

  const client = {
    // Вход тесты синхронизации не гоняют: сеанса нет (редактору на странице
    // задачи этого достаточно). Тест аккаунтов подставляет свой auth.
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table) => Query.create(table),
    channel: (name) => {
      const ch = {
        name,
        handlers: [],
        on(type, filter, handler) { this.handlers.push({ type, filter, handler }); return this; },
        subscribe() { db.channels.push(this); return this; },
      };
      return ch;
    },
    removeChannel: (ch) => { db.channels = db.channels.filter((x) => x !== ch); },
  };

  /** Другое устройство того же пользователя: пачка ядра поверх журнала. */
  function peer(deviceId, uid) {
    const p = {
      id: deviceId,
      uid,
      bundle: null,
      events: [],
      /** Прочитать журнал: впервые — слепок (или sync_state как seq 0) и
       *  правки после; дальше — seq > lastSeq. */
      pull() {
        const mine = db.changes.filter((r) => r.user_id === uid);
        if (!p.bundle) {
          const snaps = db.snapshots.filter((s) => s.user_id === uid).sort((a, b) => b.seq - a.seq);
          const snap = snaps[0] ? { seq: snaps[0].seq, data: clone(snaps[0].data) } : { seq: 0, data: clone((db.syncState[uid] || {}).data || {}) };
          p.bundle = Oplog.bootstrapFromSnapshot(snap, clone(mine.filter((r) => r.seq > snap.seq)), { deviceId, now: iso(db.now()) });
          return p;
        }
        const out = Oplog.mergeIncoming(p.bundle, clone(mine.filter((r) => r.seq > p.bundle.lastSeq)), { deviceId, now: iso(db.now()) });
        p.events.push(...out.events);
        p.bundle = out;
        return p;
      },
      /** Правка копии состояния и сохранение (commitLocal). */
      edit(fn, at) {
        const live = clone(p.bundle.state);
        fn(live);
        p.bundle = Oplog.commitLocal(p.bundle, live, { deviceId, at: at || iso(db.now()) }).bundle;
        return p;
      },
      push() {
        if (!p.bundle.pending.length) return p;
        const res = insertChanges(p.bundle.pending.map((op) => Oplog.opToRow(op, uid)), { user: uid });
        p.bundle = Oplog.ackPending(p.bundle, res.data, { deviceId, now: iso(db.now()) });
        return p;
      },
      get state() { return p.bundle.state; },
    };
    return p;
  }

  return { db, client, insertChanges, upsertSyncState, peer };
}

/** Дать отработать обещаниям и таймерам (настоящие часы): крутим очередь
 *  через setImmediate — на Windows setTimeout(0) стоит ~15 мс. */
async function settle(ms = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) await new Promise((r) => setImmediate(r));
}

/** Дождаться условия (не дольше ms). */
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await settle(10);
  }
  if (!cond()) throw new Error('не дождались');
}

/** Модули телефона (свежие — после jest.resetModules) и вход в аккаунт:
 *  область открыта, первый вход прочитал облако. Сервер — тот, что отдаёт
 *  подменённый supabaseClient (__world). */
function phone() {
  const m = {
    AsyncStorage: require('@react-native-async-storage/async-storage'),
    ...require('../src/store/useAppStore'),
    sync: require('../src/lib/sync'),
    device: require('../src/lib/device'),
    world: require('../src/lib/supabaseClient').__world,
  };
  m.app = () => m.useAppStore.getState();
  m.signIn = async (uid = 'u1') => {
    m.world.db.uid = uid;
    await m.openDataScope(uid);
    await settle(50);
    m.sync.setSyncUser(uid);
    await m.sync.syncOnSignIn(uid);
    await settle();
  };
  return m;
}

module.exports = { createWorld, settle, until, phone };

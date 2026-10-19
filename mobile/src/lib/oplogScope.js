// Пачка журнала правок в записи области (17 октября 2026; правила и протокол
// — core/oplog.js, как устроено целиком — ARCHITECTURE.md, «Синхронизация»).
// Тот же вид, что у веба и десктопа (src/renderer/app.js: packSync2 /
// unpackSync2): поле sync2 в той же записи области, что и данные
// (lancible-data:<uid>, store/useAppStore.js), — данные без своих
// неотправленных правок были бы потерей, а две записи вместо одной могли бы
// разойтись при сбое между ними.
//
//   sync2 = { v: 1, uid, linked, pending, lastSeq, conflicts, trash, meta,
//             deferred, mirror, snapSeq, bridged, adopt, state? }
//   linked  — область связана с журналом на этом устройстве (linkAccount в
//             lib/sync.js); до связи пачки нет: гость и область аккаунта до
//             первого обмена очередь не копят — их данные уходят при связи
//             целиком (adoptGuestState);
//   mirror  — последнее увиденное зеркало sync_state { seq, data } (от него
//             считают старые клиенты, мост) или { seq, base: true }, если оно
//             совпадает с состоянием пачки, — тогда без второй копии данных;
//   snapSeq — seq последнего слепка; bridged — updated_at последней записи
//             старого клиента, уже переведённой в правки; adopt — гостевые
//             данные, перенесённые до связи («Перенести»), — ждут её;
//   state   — только у телефона и только пока не совпадает с данными: стор
//             пишет запись после каждой правки, а в журнал правка уходит с
//             дебаунсом (lib/sync.js). Совпадает — state пачки при чтении
//             берётся копией данных записи (так у веба всегда: он сводит
//             данные в пачку перед каждой записью).
import Oplog from '../core/oplog.js';

/** Сколько дней удалённое лежит в корзине. */
export const TRASH_DAYS = 30;

export const SYNCED = ['projects', 'tasks', 'statuses', 'tags', 'versions', 'documents'];

/** Сущность журнала по списку (core/oplog.js, LISTS) и обратно. */
export const ENTITY_OF = {
  projects: 'project', tasks: 'task', statuses: 'status', tags: 'tag', versions: 'version', documents: 'document',
};
export const LIST_OF = Object.fromEntries(Object.entries(ENTITY_OF).map(([k, v]) => [v, k]));

const arr = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

/** Шесть списков из состояния (стора или записи области). */
export function listsOf(s) {
  const out = {};
  for (const k of SYNCED) out[k] = arr(s && s[k]);
  return out;
}

/** Глубокая копия шести списков: пачка и стор не делят объекты. */
export const listsCopy = (s) => clone(listsOf(s));

/** Есть ли в списках хоть одна сущность (и теги без проектов тоже). */
export const hasAnyLists = (lists) => !!lists && SYNCED.some((k) => Array.isArray(lists[k]) && lists[k].length > 0);

/** Служебное рядом с пачкой, ядру не нужное. */
export const freshExtra = () => ({ mirror: null, snapSeq: 0, bridged: null, adopt: [] });

/** JSON с ключами по алфавиту: одинаковые данные — одинаковая строка, в каком
 *  бы порядке ни легли поля. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Зеркало { seq, data, json } — json считается один раз. */
export const mirrorOf = (seq, data) => ({ seq, data: data || {}, json: null });
export const mirrorJson = (m) => {
  if (!m) return null;
  if (!m.json) m.json = canon(Oplog.mirrorSyncState(m.data || {}));
  return m.json;
};

/** Поле sync2 из записи области uid → { bundle, extra }. Чужая область,
 *  гость, незнакомый вид — пачки нет. Корзина старше 30 дней — прочь. */
export function unpackSync2(raw, data, uid, now = Date.now()) {
  const extra = freshExtra();
  if (!uid || !raw || typeof raw !== 'object' || raw.v !== 1 || raw.uid !== uid) return { bundle: null, extra };
  extra.snapSeq = Number(raw.snapSeq) || 0;
  extra.bridged = raw.bridged || null;
  extra.adopt = arr(raw.adopt);
  let bundle = null;
  if (raw.linked) {
    bundle = {
      state: raw.state && typeof raw.state === 'object' ? raw.state : listsCopy(data),
      pending: arr(raw.pending),
      lastSeq: Number(raw.lastSeq) || 0,
      conflicts: arr(raw.conflicts),
      trash: arr(raw.trash),
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      deferred: arr(raw.deferred),
    };
    const swept = Oplog.trashSweep(bundle, now, TRASH_DAYS);
    bundle = {
      state: swept.state, pending: swept.pending, lastSeq: swept.lastSeq, conflicts: swept.conflicts,
      trash: swept.trash, meta: swept.meta, deferred: swept.deferred,
    };
  }
  if (raw.mirror && Number.isFinite(Number(raw.mirror.seq))) {
    const mdata = raw.mirror.base ? (bundle ? Oplog.mirrorSyncState(bundle.state) : null) : raw.mirror.data;
    if (mdata) extra.mirror = mirrorOf(Number(raw.mirror.seq), mdata);
  }
  return { bundle, extra };
}

// Списки стора, которые совпадают со state пачки, — по ссылкам. Ставится
// перед каждой записью пачки (lib/sync.js): стор меняет списки только
// заменой, и та же ссылка значит то же содержимое.
let clean = null;

/** Эти списки (ссылки из стора) совпадают со state пачки. */
export function markClean(lists) {
  clean = lists;
}

/** Ссылки на списки стора после патча. */
export function refsAfter(s, patch) {
  const out = {};
  for (const k of SYNCED) out[k] = patch && Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : s[k];
  return out;
}

// Совпадает ли зеркало с состоянием пачки — считается раз на пару (state,
// зеркало): запись области идёт после каждой правки стора.
let baseMemo = { state: null, mirror: null, base: false };
function mirrorIsBase(bundle, mirror) {
  if (baseMemo.state !== bundle.state || baseMemo.mirror !== mirror) {
    baseMemo = { state: bundle.state, mirror, base: mirrorJson(mirror) === canon(Oplog.mirrorSyncState(bundle.state)) };
  }
  return baseMemo.base;
}

/** Поле sync2 для записи области (стор: oplog, syncExtra, scopeUid). Гость
 *  и область без пачки и без служебного — null. */
export function packSync2(s) {
  const uid = s && s.scopeUid;
  if (!uid) return null;
  const bundle = s.oplog;
  const x = s.syncExtra || freshExtra();
  const adopt = arr(x.adopt);
  if (!bundle && !adopt.length && !x.mirror) return null;
  const out = { v: 1, uid };
  if (bundle) {
    Object.assign(out, {
      linked: true,
      pending: bundle.pending,
      lastSeq: bundle.lastSeq,
      conflicts: bundle.conflicts,
      trash: bundle.trash,
      meta: bundle.meta,
      deferred: bundle.deferred,
    });
    if (!(clean && SYNCED.every((k) => clean[k] === s[k]))) out.state = bundle.state;
  }
  if (x.mirror) out.mirror = bundle && mirrorIsBase(bundle, x.mirror) ? { seq: x.mirror.seq, base: true } : { seq: x.mirror.seq, data: x.mirror.data };
  if (x.snapSeq) out.snapSeq = x.snapSeq;
  if (x.bridged) out.bridged = x.bridged;
  if (adopt.length) out.adopt = adopt;
  return out;
}

/** Ядро возвращает пачку своего вида: только её поля, без событий. */
export function strip(out) {
  return {
    state: out.state,
    pending: out.pending,
    lastSeq: out.lastSeq,
    conflicts: out.conflicts,
    trash: out.trash,
    meta: out.meta,
    deferred: out.deferred,
  };
}

// Служебные правки — не «значение поля»: их не сжимаем.
const COALESCE_KEEP = new Set(['*', 'deleted', 'conflict', 'resolved', 'sessions+', 'sessions-', 'sessions~']);

/** Своя неотправленная правка поля, которую перекрыла следующая своя правка
 *  того же поля, никому уже не нужна: её значения нет ни в состоянии, ни в
 *  истории поля (верхняя там — новая). Без сжатия офлайн-заметка уходила бы
 *  в журнал целиком на каждую паузу в наборе. Убираются только такие: не в
 *  полёте и без записи о конфликте поля (её версии ссылаются на id правок).
 *  То же правило, что у веба (app.js: coalescePending). */
export function coalescePending(bundle, fresh, inFlight) {
  if (!bundle || !Array.isArray(fresh) || !fresh.length) return bundle;
  const keyOf = (op) => `${op.entity}:${op.entityId}:${op.field}`;
  const newest = new Map();
  for (const op of fresh) if (op && !COALESCE_KEEP.has(op.field)) newest.set(keyOf(op), op.id);
  if (!newest.size) return bundle;
  const drop = new Set();
  for (const op of bundle.pending || []) {
    if (!op || COALESCE_KEEP.has(op.field)) continue;
    const keep = newest.get(keyOf(op));
    if (!keep || keep === op.id || (inFlight && inFlight.has(op.id))) continue;
    if (op.seq !== null && op.seq !== undefined) continue;
    const m = bundle.meta && bundle.meta[`${op.entity}:${op.entityId}`];
    if (m && m.k && m.k[op.field]) continue;
    drop.add(op.id);
  }
  if (!drop.size) return bundle;
  return { ...bundle, pending: bundle.pending.filter((op) => !drop.has(op.id)) };
}

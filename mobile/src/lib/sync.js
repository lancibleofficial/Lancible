// Синхронизация телефона — журнал правок по полям (17 октября 2026; проект —
// tmp/design-sync-oplog.md, правила слияния и протокол клиента — шапка
// core/oplog.js, общего с вебом и десктопом; как устроено целиком —
// ARCHITECTURE.md, «Синхронизация»). Поток тот же, что у веба
// (src/renderer/app.js, раздел «Синхронизация — журнал правок»): те же
// шаги, паузы и повторы, чтобы устройства вели себя одинаково.
//
// До этого в облако уходило всё состояние одним JSON (sync_state): кто
// последним отправил, тот и прав, а при входе лист спрашивал, «какие данные
// оставить». Теперь в облако уходят правки полей (таблица changes), чужие
// сливаются по полям, а две правки одного поля, сделанные не видя друг
// друга, — конфликт: видна одна версия, другая лежит рядом («Другая
// версия»). Ничего не спрашивается и не теряется.
//
// Пачка — у области данных (store/useAppStore.js: oplog, запись — поле sync2,
// lib/oplogScope.js). Гость и область аккаунта, ещё не связанная с журналом
// на этом устройстве, пачки не держат: копить очередь из каждой буквы,
// которая никуда не уйдёт, незачем. Их данные уходят при первой связи
// целиком (linkAccount → adoptGuestState).
//
//   сохранение — подписка на стор: правка списков → через 400 мс
//     stampSessionIds → commitLocal → пачка в стор (и в запись области);
//   отправка   — upsert строк opToRow (до 2000 одной вставкой) с
//     on_conflict user_id,op_id и ignore-duplicates → ackPending → чтение
//     журнала; сбой — повтор через 2, 5, 15, 30, 60 с, дальше 2 и 5 минут
//     (19 октября 2026): у отправки свой счётчик неудач, удачное чтение его
//     не сбрасывает, и пока отступ не вышел, отправка ждёт — вставку, которую
//     сервер отбивает (4xx), больше не шлют каждые 2 с; символ \u0000 (его
//     не принимает jsonb) из строк правки вычищается перед отправкой;
//     очередь — в записи области и переживает перезапуск;
//   приём      — realtime INSERT на changes только будит: читаем seq >
//     lastSeq страницами по 1000; перед приёмом своё — в журнал (и текст из
//     открытого редактора); все страницы — в пачку, в стор один раз, глубокой
//     копией, с миграцией; события — тостами; пометки о конфликтах —
//     отправить. Поводы — realtime, возврат приложения на экран, сверка раз в
//     минуту, повтор после сбоя;
//   первая связь — последний слепок и правки после него; слепка нет —
//     sync_state как слепок seq 0 (журнал пуст — он же в snapshots); своё в
//     области и ждущий перенос «Без аккаунта» — adoptGuestState;
//   слепок      — отрыв больше 1000 правок и пустая очередь → compactSnapshot;
//   мост к старым клиентам (десктоп ≤ 0.4.4, телефон ≤ 1.2.3) — зеркало в
//     sync_state через 1,5 с после обмена (updated_by 'oplog:<устройство>',
//     mirror_seq); запись старого клиента → legacyBridgeOps от того зеркала,
//     от которого он считал (неизвестного — ждём две минуты устройство,
//     которое его писало, потом от ближайшего известного) → в журнал.
//
// Каждый ответ сети применяется, лишь если за время запроса не сменились ни
// аккаунт, ни область (epoch, syncFor). Сознательно НЕ импортирует
// useAuthStore (цикл auth ↔ sync): тот сам зовёт setSyncUser / syncOnSignIn /
// flushSync. activeTimer, settings и ui в журнал не уходят — это данные
// устройства.
import { AppState } from 'react-native';
import { sb } from './supabaseClient';
import { useAppStore } from '../store/useAppStore';
import { migrate } from './migrate';
import Oplog from '../core/oplog.js';
import Accounts from '../core/accounts.js';
import { loadDeviceId, deviceId } from './device';
import {
  SYNCED, listsOf, listsCopy, hasAnyLists, freshExtra, mirrorOf, mirrorJson, canon,
  markClean, refsAfter, strip, coalescePending,
} from './oplogScope';
import { trashGroup } from './trash';
import { entityTitle } from './conflictText';
import { t } from './i18n';

export const COMMIT_DEBOUNCE_MS = 400;
/** Строк журнала за один запрос — чтение страницами. */
export const SYNC_PAGE = 1000;
/** Своих правок за одну отправку: одна вставка — одна транзакция. */
export const SYNC_SEND_MAX = 2000;
/** Слепок — когда журнал ушёл от прошлого дальше, чем на столько правок. */
export const SNAPSHOT_EVERY = 1000;
/** Пауза перед зеркалом для старых клиентов: правки идут пачками. */
export const MIRROR_DELAY_MS = 1500;
/** Запись старого клиента от неизвестного зеркала сначала ждёт устройство,
 *  которое его писало. */
export const LEGACY_GRACE_MS = 120000;
/** Повторы после сбоя: всё реже, до пяти минут. Отправка, которую сервер
 *  отбивает, доходит до потолка за восемь минут, а не крутится раз в 2 с. */
export const SYNC_BACKOFF_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
/** Тихая сверка с журналом, пока приложение на экране: realtime может
 *  молча отвалиться, а пропущенная правка не должна ждать перезапуска. */
export const SYNC_POLL_MS = 60000;
const ROW_COLUMNS = 'seq, device_id, op_id, entity, entity_id, field, value, at, base_seq, created_at';
const SYNC_STATE_COLS = 'data, updated_at, updated_by, mirror_seq';

let currentUserId = null;
// Растёт при смене аккаунта и выключении синхронизации: ответ сети с
// прежним номером не применяется.
let epoch = 0;
let channel = null;
// Стор пишет сама синхронизация — подписка не принимает это за правку.
let applying = false;
let commitTimer = null;
let retryTimer = null;
let retryAt = 0;
// Неудачи чтения и связи — fails; отправки — sendFails: удачное чтение не
// обнуляет неудачи отправки (вставку могут отбивать при живой сети), а до
// sendWaitUntil отправка ждёт своего повтора.
let fails = 0;
let sendFails = 0;
let sendWaitUntil = 0;
let sendBusy = false;
let sendAgain = false;
let pullBusy = false;
let pullAgain = false;
let mirrorTimer = null;
let legacyTimer = null;
let pollTimer = null;
let pullSoonTimer = null;
// Идущий вход (syncOnSignIn) — { uid, ep }: повтор того же аккаунта в той
// же эпохе — тот же вход; A → B → A — уже новый.
let signInFor = null;
// Первая связь — своя у каждого аккаунта и эпохи: uid → { ep, promise }.
// Медленная связь A не держит и не роняет вход B (и вернувшегося A).
const linking = new Map();
/** Правки в полёте: их нельзя ни сжать, ни отправить второй раз сразу. */
const inFlight = new Set();
/** Ушли на сервер, но ещё не подтверждены (повтор отбит, строки в ответе
 *  нет): подтвердит чтение журнала, повторять сразу незачем. */
const sentIds = new Set();
/** Открытые редакторы с текстом, который они ещё держат у себя. */
const flushers = new Set();

const nowIso = () => new Date().toISOString();
const st = () => useAppStore.getState();
const syncOn = () => st().settings.syncEnabled !== false;
const isOplogRow = (row) => !!(row && typeof row.updated_by === 'string' && row.updated_by.startsWith('oplog:'));
const rowMirrorSeq = (row) => (row && row.mirror_seq !== null && row.mirror_seq !== undefined ? Number(row.mirror_seq) || 0 : 0);

/** Открыта ли в сторе область аккаунта uid и прочитана ли она. */
function scopeIs(uid) {
  const s = st();
  return !!uid && s.hasHydrated && s.scopeUid === uid && useAppStore.persist.getOptions().name === Accounts.mobileDataName(uid);
}
/** Ответ запроса, начатого при epoch ep для uid, ещё можно применить. */
const syncFor = (uid, ep) => ep === epoch && uid === currentUserId && scopeIs(uid);
/** Можно ли сейчас говорить с журналом. */
const live = () => !!currentUserId && scopeIs(currentUserId) && syncOn() && !!deviceId();

function setStore(patch, clean) {
  if (clean) markClean(refsAfter(st(), patch));
  applying = true;
  try {
    useAppStore.setState(patch);
  } finally {
    applying = false;
  }
}

/** Открытый редактор отдаёт стору то, что ещё держит (useEditorSession):
 *  перед приёмом и выбором версии его буквы должны быть в журнале.
 *  @returns снять регистрацию */
export function registerEditorFlush(fn) {
  flushers.add(fn);
  return () => flushers.delete(fn);
}
/** Открытые редакторы отдают стору несохранённый текст сейчас, синхронно.
 *  Зовёт и сама синхронизация, и чат-бот перед «Применить» и «Отменить»
 *  (lib/aiChat.js): предложение может править заметки задачи, открытой в
 *  другой вкладке, и без сброса позже сработавшее сохранение редактора
 *  затёрло бы его правку. */
export function flushEditors() {
  for (const fn of [...flushers]) {
    try { fn(); } catch (err) { console.error('Не удалось сохранить текст редактора:', err); }
  }
}

// ---------------------------------------------------------------------------
// Сохранение: правки списков → пачка
// ---------------------------------------------------------------------------

/** Живое состояние → пачка: что поменялось с прошлого раза — правками в
 *  очередь, удалённое — в корзину. Только у области, связанной с журналом.
 *  @returns есть ли новые правки */
export function commitNow() {
  clearTimeout(commitTimer);
  commitTimer = null;
  const s = st();
  if (!s.hasHydrated || !s.oplog || !deviceId()) return false;
  const lists = listsOf(s);
  // Записи времени без id — их ключ заранее (core/oplog.js): сдвиг начала
  // записи остаётся правкой той же записи, а не «сняли и добавили».
  const stamped = Oplog.stampSessionIds(lists);
  const r = Oplog.commitLocal(s.oplog, stamped, { deviceId: deviceId(), at: nowIso() });
  const patch = {};
  if (stamped.tasks !== lists.tasks) patch.tasks = stamped.tasks;
  if (r.ops.length || patch.tasks) patch.oplog = coalescePending(strip(r.bundle), r.ops, inFlight);
  if (!patch.oplog) {
    markClean(refsAfter(s, null));
    return false;
  }
  setStore(patch, true);
  return r.ops.length > 0;
}

function scheduleCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    if (commitNow()) sendPending();
  }, COMMIT_DEBOUNCE_MS);
}

/** Пачка после приёма, связи, выбора версии или корзины — в стор: её state
 *  ложится глубокой копией (пачка своей копией владеет), с миграцией, как
 *  при загрузке. То, что поменяет миграция, — свои правки этого устройства:
 *  сразу в очередь, и стор с пачкой снова совпадают. Возврат закрытых
 *  повторяющихся задач — следом, обычной правкой. */
function applyBundle(next, before) {
  const s = st();
  const changed = SYNCED.some((k) => next.state[k] !== before.state[k]);
  if (!changed) {
    setStore({ oplog: next }, true);
    return;
  }
  const draft = migrate({ ...s, ...listsCopy(next.state), ui: { ...s.ui }, settings: { ...s.settings } });
  const patch = {};
  for (const k of SYNCED) patch[k] = draft[k];
  patch.ui = draft.ui;
  // Открытый проект удалили на другом устройстве — экран на «Главную».
  if (patch.ui.projectId && !patch.projects.some((p) => p && p.id === patch.ui.projectId)) {
    patch.ui = { ...patch.ui, view: 'home', projectId: null };
  }
  const r = Oplog.commitLocal(next, listsOf(patch), { deviceId: deviceId(), at: nowIso() });
  patch.oplog = coalescePending(strip(r.bundle), r.ops, inFlight);
  setStore(patch, true);
  st().reopenDue();
}

/** Действие ядра над пачкой: сначала своё несохранённое — в журнал, потом
 *  fn(пачка) → новая пачка (или null — ничего), она — в стор. */
function updateBundle(fn) {
  flushEditors();
  commitNow();
  const s = st();
  if (!s.hasHydrated || !s.oplog) return null;
  const before = s.oplog;
  const out = fn(before);
  if (!out) return null;
  applyBundle(strip(out), before);
  return out;
}

function onStoreChange(state, prev) {
  if (applying) return;
  if (!state.hasHydrated) {
    // Открывается другая область. Ждущее сохранение — правка прежней: её
    // данные и state пачки уже записаны, и при следующем открытии дифф
    // вернёт правку в журнал.
    if (prev.hasHydrated) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    return;
  }
  if (!prev.hasHydrated) {
    onScopeOpened();
    return;
  }
  if (!state.oplog || SYNCED.every((k) => state[k] === prev[k])) return;
  scheduleCommit();
}

/** Область прочитана: несохранённое с прошлого раза и правки миграции — в
 *  журнал (корзину старше 30 дней вычистило чтение, lib/oplogScope.js). */
function onScopeOpened() {
  loadDeviceId().then(() => {
    if (!st().hasHydrated) return;
    if (commitNow() && live()) sendPending();
  });
}

// ---------------------------------------------------------------------------
// Отправка и приём
// ---------------------------------------------------------------------------

// Колонки журнала (supabase/sync2.sql): правку с пустым id сущности или
// слишком длинным полем сервер не примет, и вся вставка падала бы на ней.
// \u0000 Postgres не принимает ни в text, ни в jsonb: в id и поле его быть
// не может, а из значения его вычищает cleanOp до этой проверки.
const NUL = /\u0000/;
const NUL_ALL = /\u0000/g;
function hasNul(v) {
  if (typeof v === 'string') return NUL.test(v);
  if (Array.isArray(v)) return v.some(hasNul);
  if (v && typeof v === 'object') return Object.keys(v).some((k) => NUL.test(k) || hasNul(v[k]));
  return false;
}
function noNul(v) {
  if (typeof v === 'string') return v.replace(NUL_ALL, '');
  if (Array.isArray(v)) return v.map(noNul);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(NUL_ALL, ''), noNul(x)]));
  return v;
}
const sendable = (op) => !!op && typeof op.entityId === 'string' && op.entityId.length >= 1 && op.entityId.length <= 200
  && typeof op.field === 'string' && op.field.length >= 1 && op.field.length <= 100
  && !NUL.test(op.entityId) && !NUL.test(op.field) && !hasNul(op.value);

/** Правка без \u0000 в значении: одна такая (вставили текст с нулевым
 *  символом) отбивала бы всю вставку, а с ней — синхронизацию целиком. Ядро
 *  вычищает его при записи правки в очередь; это — для правок, что легли в
 *  очередь раньше. Нечего чистить — та же правка. */
const cleanOp = (op) => (op && hasNul(op.value) ? { ...op, value: noNul(op.value) } : op);

/** Повтор через ms — если раньше уже не назначен: ранний повтор поздним не
 *  откладывается. */
function retryIn(ms) {
  const at = Date.now() + ms;
  if (retryTimer && retryAt <= at) return;
  clearTimeout(retryTimer);
  retryAt = at;
  retryTimer = setTimeout(() => { retryTimer = null; retryAt = 0; syncNow(); }, ms);
}

/** Повтор чтения, связи, моста — по их неудачам. */
function scheduleRetry() {
  const ms = SYNC_BACKOFF_MS[Math.min(fails, SYNC_BACKOFF_MS.length - 1)];
  fails += 1;
  retryIn(ms);
}

/** Отправка не прошла (сеть или отказ сервера): следующая — не раньше
 *  отступа, и он растёт, пока отправка не пройдёт. */
function sendFailed() {
  const ms = SYNC_BACKOFF_MS[Math.min(sendFails, SYNC_BACKOFF_MS.length - 1)];
  sendFails += 1;
  sendWaitUntil = Date.now() + ms;
  retryIn(ms);
}

/** Неудачи забыты: другой аккаунт, возврат приложения на экран. */
function resetBackoff() {
  fails = 0;
  sendFails = 0;
  sendWaitUntil = 0;
}

/** Свои правки — в журнал: insert с игнором повторов → ackPending → чтение
 *  журнала (там подтвердятся и правки, которые сервер уже знал). */
async function sendPending() {
  if (!live() || !st().oplog) return;
  if (sendBusy) { sendAgain = true; return; }
  commitNow();
  // Прошлая отправка не прошла — ждём её повтора (таймер уже стоит).
  if (Date.now() < sendWaitUntil) { retryIn(sendWaitUntil - Date.now()); return; }
  const uid = currentUserId;
  const ep = epoch;
  let b = st().oplog;
  if (b.pending.some((op) => cleanOp(op) !== op)) {
    setStore({ oplog: { ...b, pending: b.pending.map(cleanOp) } }, false);
    b = st().oplog;
  }
  if (b.pending.some((op) => !sendable(op))) {
    console.error('Правки, которые журнал не примет, сняты с очереди:', b.pending.filter((op) => !sendable(op)).map((op) => op && op.field));
    setStore({ oplog: { ...b, pending: b.pending.filter(sendable) } }, false);
    b = st().oplog;
  }
  const batch = b.pending.slice(0, SYNC_SEND_MAX);
  if (!batch.length) return;
  sendBusy = true;
  sendAgain = false;
  for (const op of batch) inFlight.add(op.id);
  let ok = false;
  try {
    const { data, error } = await sb.from('changes')
      .upsert(batch.map((op) => Oplog.opToRow(op, uid)), { onConflict: 'user_id,op_id', ignoreDuplicates: true })
      .select(ROW_COLUMNS);
    if (!syncFor(uid, ep) || !st().oplog) return;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length) updateBundle((cur) => Oplog.ackPending(cur, rows, { deviceId: deviceId(), now: Date.now() }));
    for (const op of batch) sentIds.add(op.id);
    sendFails = 0;
    sendWaitUntil = 0;
    ok = true;
  } catch (err) {
    console.error('Не удалось отправить правки:', err);
    if (syncFor(uid, ep)) sendFailed();
  } finally {
    sendBusy = false;
    for (const op of batch) inFlight.delete(op.id);
  }
  if (!ok) return;
  // ack не двигает lastSeq: журнал до своих правок мог быть не прочитан.
  await pullChanges();
  if (!syncFor(uid, ep) || !st().oplog) return;
  const pending = st().oplog.pending;
  const ids = new Set(pending.map((p) => p.id));
  for (const id of [...sentIds]) if (!ids.has(id)) sentIds.delete(id);
  if (sendAgain || pending.some((p) => !sentIds.has(p.id))) sendPending();
  else if (pending.length) scheduleRetry();
}

/** Все строки журнала после seq (и не дальше upTo) — страницами. */
async function readChanges(uid, after, upTo) {
  const rows = [];
  let from = after;
  for (;;) {
    let q = sb.from('changes').select(ROW_COLUMNS).eq('user_id', uid).gt('seq', from);
    if (upTo !== undefined && upTo !== null) q = q.lte('seq', upTo);
    const { data, error } = await q.order('seq', { ascending: true }).limit(SYNC_PAGE);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < SYNC_PAGE) return rows;
    from = Number(page[page.length - 1].seq);
  }
}

/** Тосты слияния: спасённое от удаления, другая версия, просто обновление. */
function syncToasts(events, foreign) {
  const s = st();
  const lang = s.settings.lang;
  const list = Array.isArray(events) ? events : [];
  const restored = list.find((e) => e.type === 'restored');
  const conflict = list.find((e) => e.type === 'conflict');
  if (restored) s.showToast(t(lang, 'sync.restored_toast', { name: entityTitle(s, restored.entity, restored.entityId, lang) }));
  else if (conflict) s.showToast(t(lang, 'sync.conflict_toast', { name: entityTitle(s, conflict.entity, conflict.entityId, lang) }));
  else if (foreign) s.showToast(t(lang, 'sync.updated_toast'));
}

/** Чтение журнала: на событие realtime не берём строку из события, а читаем
 *  всё после lastSeq по порядку (строка из события могла обогнать соседку).
 *  Все страницы — одним слиянием: в стор результат ложится один раз, и
 *  миграция не заведёт проекту, чьи статусы на следующей странице, свои. */
async function pullChanges() {
  if (!live() || !st().oplog) return;
  if (pullBusy) { pullAgain = true; return; }
  pullBusy = true;
  pullAgain = false;
  const uid = currentUserId;
  const ep = epoch;
  let rows = [];
  let failed = false;
  try {
    rows = await readChanges(uid, st().oplog.lastSeq);
    fails = 0;
  } catch (err) {
    console.error('Не удалось прочитать журнал правок:', err);
    failed = true;
    if (syncFor(uid, ep)) scheduleRetry();
  } finally {
    pullBusy = false;
  }
  if (!syncFor(uid, ep) || !st().oplog) return;
  if (rows.length) {
    let events = [];
    const dev = deviceId();
    const out = updateBundle((cur) => {
      const merged = Oplog.mergeIncoming(cur, rows, { deviceId: dev, now: Date.now() });
      events = merged.events || [];
      return merged;
    });
    if (out) syncToasts(events, rows.some((r) => r.device_id !== dev));
  }
  if (pullAgain) { pullAgain = false; await pullChanges(); return; }
  if (failed) return;
  maybeSnapshot(uid, ep);
  scheduleMirror();
  // В очереди могли появиться пометки о конфликтах — их тоже отправить.
  if (st().oplog && st().oplog.pending.some((p) => !sentIds.has(p.id))) sendPending();
}

/** Слепок для новых устройств: журнал ушёл от прошлого дальше, чем на
 *  SNAPSHOT_EVERY правок, и своих неотправленных нет (иначе слепок соврал
 *  бы). Два устройства на одном seq — второй отбит ключом, это нормально. */
async function maybeSnapshot(uid, ep) {
  const b = st().oplog;
  if (!syncFor(uid, ep) || !b || b.pending.length) return;
  if (b.lastSeq - (st().syncExtra.snapSeq || 0) <= SNAPSHOT_EVERY) return;
  const snap = Oplog.compactSnapshot(b);
  if (!snap) return;
  try {
    const { error } = await sb.from('snapshots').insert({ user_id: uid, seq: snap.seq, data: snap.data });
    if (error && error.code !== '23505') throw error;
    if (!syncFor(uid, ep)) return;
    setStore({ syncExtra: { ...st().syncExtra, snapSeq: snap.seq } }, false);
  } catch (err) {
    console.error('Не удалось положить слепок:', err);
  }
}

// ---------------------------------------------------------------------------
// Мост к старым клиентам (sync_state)
// ---------------------------------------------------------------------------

function scheduleMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { mirrorTimer = null; writeMirror(); }, MIRROR_DELAY_MS);
}

async function readSyncState(uid) {
  const { data, error } = await sb.from('sync_state').select(SYNC_STATE_COLS).eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data || null;
}

const setExtra = (patch) => setStore({ syncExtra: { ...st().syncExtra, ...patch } }, false);

/** Зеркало для старых клиентов: состояние в sync_state, с mirror_seq и
 *  updated_by 'oplog:…'. Сначала — свежая запись: если там непереведённая
 *  правка старого клиента, зеркало её затёрло бы, — сперва мост. */
async function writeMirror() {
  const b = st().oplog;
  if (!live() || !b || b.pending.length) return;
  const uid = currentUserId;
  const ep = epoch;
  const data = Oplog.mirrorSyncState(b);
  const json = canon(data);
  const seq = b.lastSeq;
  const m = st().syncExtra.mirror;
  if (m && m.seq === seq && mirrorJson(m) === json) return;
  try {
    const row = await readSyncState(uid);
    if (!syncFor(uid, ep) || !st().oplog) return;
    if (row && !isOplogRow(row) && row.updated_at !== st().syncExtra.bridged) { await bridgeLegacy(uid, ep, row); return; }
    const now = st().oplog;
    if (now.pending.length || now.lastSeq !== seq) return; // пока ждали, пришло новое — следующим разом
    const { error } = await sb.from('sync_state').upsert({
      user_id: uid,
      data,
      updated_at: nowIso(),
      updated_by: `oplog:${deviceId()}`,
      mirror_seq: seq,
    });
    if (error) throw error;
    if (!syncFor(uid, ep)) return;
    setExtra({ mirror: { seq, data, json } });
  } catch (err) {
    console.error('Не удалось обновить sync_state для старых версий:', err);
  }
}

/** Запись sync_state (realtime или чтение): зеркало другого нового
 *  устройства — запомнить как последнее увиденное; запись старого клиента
 *  — в правки. */
async function onSyncStateRow(uid, row) {
  if (!row || uid !== currentUserId || !live() || !st().oplog) return;
  if (row.user_id && row.user_id !== uid) return;
  if (isOplogRow(row)) {
    if (row.updated_by !== `oplog:${deviceId()}`) setExtra({ mirror: mirrorOf(rowMirrorSeq(row), row.data) });
    return;
  }
  await bridgeLegacy(uid, epoch, row);
}

/** Запись старого клиента → правки устройства 'legacy' (legacyBridgeOps):
 *  разница с зеркалом, от которого он считал (его seq — mirror_seq строки:
 *  старый клиент колонку не знает и не трогает), с baseSeq этого зеркала.
 *  id правок — от updated_at: все новые устройства дают одни и те же, и
 *  повтор отбивает сервер. Зеркала нет у этого устройства — сначала ждём то,
 *  которое его писало; не дождались — берём ближайшее известное (лишнее
 *  станет «другой версией», а не потерей). */
async function bridgeLegacy(uid, ep, row) {
  if (!syncFor(uid, ep) || !live() || !st().oplog) return;
  const stamp = row.updated_at || null;
  if (!stamp || st().syncExtra.bridged === stamp) return;
  const base = rowMirrorSeq(row);
  const m = st().syncExtra.mirror;
  if (!m || m.seq !== base) {
    const wait = LEGACY_GRACE_MS - (Date.now() - Date.parse(stamp));
    if (wait > 0) {
      clearTimeout(legacyTimer);
      legacyTimer = setTimeout(() => { legacyTimer = null; writeMirror(); }, wait + 1000);
      return;
    }
  }
  const prev = m ? m.data : Oplog.mirrorSyncState(st().oplog);
  const ops = Oplog.legacyBridgeOps(prev, row.data || {}, { at: stamp, baseSeq: base, stamp });
  try {
    if (ops.length) {
      const { error } = await sb.from('changes')
        .upsert(ops.map((op) => Oplog.opToRow(op, uid)), { onConflict: 'user_id,op_id', ignoreDuplicates: true });
      if (error) throw error;
    }
  } catch (err) {
    console.error('Не удалось перевести запись старой версии в правки:', err);
    if (syncFor(uid, ep)) scheduleRetry();
    return;
  }
  if (!syncFor(uid, ep) || !st().oplog) return;
  setExtra({ bridged: stamp, mirror: mirrorOf(base, row.data) });
  await pullChanges();
}

// ---------------------------------------------------------------------------
// Первая связь, вход, подписка
// ---------------------------------------------------------------------------

/** Первая связь области аккаунта с журналом на этом устройстве: последний
 *  слепок и правки после него; слепка нет — sync_state как слепок seq 0 (и
 *  он же, если журнал пуст, ложится в snapshots: следующие устройства
 *  начнут с него). Своё, что лежало в области до связи, и ждущий перенос
 *  «Без аккаунта» — adoptGuestState: правками baseSeq 0, общее с аккаунтом —
 *  по полям, с пометками; ничего не затирается. Вопроса «какие данные
 *  оставить» больше нет. @returns связана ли */
async function linkAccount(uid, ep) {
  try {
    const snapRes = await sb.from('snapshots').select('seq, data').eq('user_id', uid).order('seq', { ascending: false }).limit(1);
    if (snapRes.error) throw snapRes.error;
    let snap = (Array.isArray(snapRes.data) && snapRes.data[0]) || null;
    const row = await readSyncState(uid);
    const fromRow = !snap;
    if (!snap) snap = { seq: 0, data: (row && row.data) || {} };
    const ops = await readChanges(uid, Number(snap.seq) || 0);
    if (!syncFor(uid, ep)) return false;
    if (st().oplog) return true; // связал параллельный вызов
    if (fromRow && row && !ops.length) {
      const { error } = await sb.from('snapshots').insert({ user_id: uid, seq: 0, data: row.data || {} });
      if (error && error.code !== '23505') console.error('Не удалось положить слепок sync_state:', error);
    }
    if (!syncFor(uid, ep) || st().oplog) return !!st().oplog;
    flushEditors();
    const s = st();
    const at = nowIso();
    let b = strip(Oplog.bootstrapFromSnapshot({ seq: Number(snap.seq) || 0, data: snap.data || {} }, ops, { deviceId: deviceId(), now: Date.now() }));
    const events = [];
    for (const lists of [Oplog.stampSessionIds(listsCopy(s)), ...(s.syncExtra.adopt || [])]) {
      if (!hasAnyLists(lists)) continue;
      const res = Oplog.adoptGuestState(b, lists, { deviceId: deviceId(), at });
      b = strip(res.bundle);
      events.push(...(res.events || []));
    }
    const extra = { ...freshExtra(), snapSeq: Number(snap.seq) || 0 };
    if (row) {
      // Зеркало, от которого считают старые клиенты: запись нового
      // устройства — как есть; запись старого, взятая за слепок, — она же и
      // есть то, что в пачке.
      if (isOplogRow(row) || fromRow) extra.mirror = mirrorOf(rowMirrorSeq(row), row.data);
      if (!isOplogRow(row) && fromRow) extra.bridged = row.updated_at || null;
    }
    sentIds.clear();
    // До связи пачки не было: «прежняя» — пустая, и в стор ложится всё.
    setStore({ syncExtra: extra }, false);
    applyBundle(b, { state: {} });
    syncToasts(events, false);
    return true;
  } catch (err) {
    console.error('Не удалось связаться с журналом правок:', err);
    if (syncFor(uid, ep)) scheduleRetry();
    return false;
  }
}

/** После входа (и на старте с живым сеансом, и когда включили
 *  синхронизацию): связь с журналом, если её ещё нет, подписка, чтение,
 *  мост, отправка. Почти одновременные повторные вызовы — один. */
export async function syncOnSignIn(userId) {
  const uid = userId || currentUserId;
  if (!uid || uid !== currentUserId || !syncOn()) return;
  await loadDeviceId();
  if (!live() || (signInFor && signInFor.uid === uid && signInFor.ep === epoch)) return;
  const ep = epoch;
  const me = { uid, ep };
  signInFor = me;
  try {
    if (!st().oplog) {
      let link = linking.get(uid);
      if (!link || link.ep !== ep) {
        const entry = { ep, promise: null };
        entry.promise = linkAccount(uid, ep).finally(() => { if (linking.get(uid) === entry) linking.delete(uid); });
        linking.set(uid, entry);
        link = entry;
      }
      if (!(await link.promise)) return;
    }
    if (!syncFor(uid, ep)) return;
    subscribeSyncRealtime(uid);
    startPoll();
    await pullChanges();
    if (!syncFor(uid, ep)) return;
    // Пока телефона не было, старый клиент мог записать sync_state.
    try {
      const row = await readSyncState(uid);
      if (row && syncFor(uid, ep)) await onSyncStateRow(uid, { user_id: uid, ...row });
    } catch (err) {
      console.error('Не удалось прочитать sync_state:', err);
    }
    await sendPending();
    scheduleMirror();
  } finally {
    if (signInFor === me) signInFor = null;
  }
}

/** Всё, что журналу сейчас нужно: связь, чтение, отправка. Зовут повтор
 *  после сбоя, возврат приложения на экран и тихая сверка. */
export async function syncNow() {
  if (!live()) return;
  if (!st().oplog) { await syncOnSignIn(currentUserId); return; }
  await pullChanges();
  await sendPending();
}

/** Событие realtime — только повод перечитать журнал; строки одной вставки
 *  — одно чтение. */
function pullSoon(uid) {
  clearTimeout(pullSoonTimer);
  pullSoonTimer = setTimeout(() => { pullSoonTimer = null; if (uid === currentUserId && live()) pullChanges(); }, 60);
}

/** Подписка на журнал (новая строка — повод перечитать) и на sync_state
 *  (мост). */
export function subscribeSyncRealtime(userId) {
  unsubscribeSyncRealtime();
  if (!userId || !syncOn()) return;
  channel = sb
    .channel(`sync2:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'changes', filter: `user_id=eq.${userId}` }, () => pullSoon(userId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_state', filter: `user_id=eq.${userId}` }, (payload) => {
      if (userId === currentUserId) onSyncStateRow(userId, payload && payload.new);
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') pullSoon(userId); });
}

export function unsubscribeSyncRealtime() {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
  clearTimeout(pullSoonTimer);
  pullSoonTimer = null;
}

function startPoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (AppState.currentState === 'active') syncNow(); }, SYNC_POLL_MS);
}

function stopTimers() {
  clearInterval(pollTimer);
  pollTimer = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  retryAt = 0;
  clearTimeout(mirrorTimer);
  mirrorTimer = null;
  clearTimeout(legacyTimer);
  legacyTimer = null;
}

/** Настройки — источник данных: синхронизацию можно выключить на этом
 *  устройстве, не выходя из аккаунта. Правки тем временем копятся в очереди
 *  и уйдут, когда её включат. */
export function setSyncEnabled(enabled) {
  const { setSettings, showToast, settings } = st();
  setSettings({ syncEnabled: enabled });
  if (enabled) {
    if (currentUserId) syncOnSignIn(currentUserId);
  } else {
    epoch += 1;
    unsubscribeSyncRealtime();
    stopTimers();
  }
  showToast(t(settings.lang, enabled ? 'sync.enabled_toast' : 'sync.disabled_toast'));
}

/** Зовётся из useAuthStore при каждой смене входа. Другой аккаунт (или
 *  выход) — подписка, очередь в полёте и таймеры прежнего снимаются, ответы
 *  про него больше не применяются. Обмен начинает syncOnSignIn. */
export function setSyncUser(userId) {
  const next = userId || null;
  if (next !== currentUserId) {
    epoch += 1;
    unsubscribeSyncRealtime();
    stopTimers();
    resetBackoff();
    sentIds.clear();
    sendAgain = false;
    pullAgain = false;
  }
  currentUserId = next;
}

/** Перед сменой аккаунта, выходом и стиранием копии (store/useAuthStore.js):
 *  несохранённое — в журнал области сейчас, очередь — в облако своим же
 *  сеансом. Не вышло — уйдёт, когда аккаунт откроют снова. */
export async function flushSync() {
  flushEditors();
  commitNow();
  if (!live() || !st().oplog) return;
  await sendPending();
}

// ---------------------------------------------------------------------------
// Действия экранов: выбор версии, корзина, перенос «Без аккаунта»
// ---------------------------------------------------------------------------

/** «Оставить эту»: правка поля выбранным значением и 'resolved' — в очередь,
 *  значение — в стор, отправка сразу. choice — opId версии. */
export function resolveConflict(conflictId, choice) {
  if (!deviceId()) return false;
  const out = updateBundle((b) => {
    const r = Oplog.resolveConflict(b, conflictId, choice, { deviceId: deviceId(), at: nowIso() });
    return r.ops.length ? r.bundle : null;
  });
  if (out) sendPending();
  return !!out;
}

/** «Восстановить»: возврат — правками ядра (restoreFromTrash), вместе с тем,
 *  что ушло с проектом, и с проектом задачи, если он тоже в корзине
 *  (lib/trash.js — то же правило, что у веба). */
export function restoreFromTrash(entity, entityId) {
  const s = st();
  if (!deviceId() || !s.oplog) return false;
  const group = trashGroup(s.oplog.trash, entity, entityId);
  if (!group.length) return false;
  const at = nowIso();
  const out = updateBundle((b) => {
    let x = b;
    for (const g of group) x = Oplog.restoreFromTrash(x, g.entity, g.entityId, { deviceId: deviceId(), at }).bundle;
    return x === b ? null : x;
  });
  if (out) sendPending();
  return !!out;
}

/** «Перенести данные без аккаунта» в открытую область. Связана с журналом —
 *  слияние без потерь (adoptGuestState): новое — правками создания, общее с
 *  аккаунтом — по полям, другая версия — рядом. Ещё не связана — пока
 *  объединение без дублей (core/accounts.js: mergeScopeData), а слияние
 *  сделает связь: при совпадении id гостевое ждёт её (syncExtra.adopt).
 *  Таймер гостя переезжает, если у аккаунта своего нет. */
export function adoptGuestData(guest) {
  const s = st();
  if (!s.hasHydrated || !guest) return false;
  // В аккаунте тоже идёт таймер — таймер гостя закрывается записью времени
  // на своей задаче (ядро, 19 октября 2026), а не пропадает вместе со временем.
  guest = Accounts.settleGuestTimer({ activeTimer: s.activeTimer }, guest, { now: Date.now() });
  const guestLists = listsCopy(guest);
  if (s.oplog) {
    if (!deviceId()) return false;
    const out = updateBundle((b) => Oplog.adoptGuestState(b, guestLists, { deviceId: deviceId(), at: nowIso() }).bundle);
    if (!out) return false;
    if (!st().activeTimer && guest.activeTimer) useAppStore.setState({ activeTimer: guest.activeTimer });
    if (live()) sendPending();
    return true;
  }
  const ids = new Set(SYNCED.flatMap((k) => (s[k] || []).map((x) => `${k}:${x && x.id}`)));
  const shared = SYNCED.some((k) => guestLists[k].some((x) => ids.has(`${k}:${x && x.id}`)));
  const merged = Accounts.mergeScopeData({ ...listsOf(s), activeTimer: s.activeTimer }, guest);
  const patch = { activeTimer: merged.activeTimer };
  for (const k of SYNCED) patch[k] = merged[k];
  if (shared) patch.syncExtra = { ...s.syncExtra, adopt: [...(s.syncExtra.adopt || []), guestLists] };
  useAppStore.setState(patch);
  return true;
}

useAppStore.subscribe(onStoreChange);

// Возврат на экран — подписка заново (сокет мог протухнуть в фоне) и обмен;
// уход в фон — несохранённое в журнал сразу и попытка отправить.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    if (currentUserId && live()) {
      if (st().oplog) subscribeSyncRealtime(currentUserId);
      // Вернули на экран — пробуем сейчас, а не по отступу.
      resetBackoff();
      syncNow();
    }
  } else if (state === 'background' || state === 'inactive') {
    flushEditors();
    if (commitNow() && live()) sendPending();
  }
});

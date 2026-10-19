// Журнал правок на вебе и десктопе: помощники клиента и то, что видно в
// исходниках. Запуск: npm run test:unit
//
// Правила слияния — ядро (core/oplog.js), их сценарии — tests/unit/oplog.test.js.
// Здесь — склейка app.js с ядром, которую иначе проверил бы только браузер
// (tests/e2e/sync2.spec.js): как пачка ложится в данные области и встаёт
// обратно, какие свои правки сжимаются, id установки на десктопе, и
// правила, которые держались бы на внимании: старого «кто последним
// отправил» и вопроса «какие данные оставить» больше нет, новые записи
// времени — сразу с id, удаление аккаунта копию на устройстве не стирает.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const Core = { ...require('../../src/renderer/core/oplog.js') };
const { T } = require('../../src/renderer/core/i18n.js');
const app = read('src/renderer/app.js');

function fnSource(name) {
  let from = app.indexOf(`\nfunction ${name}(`);
  if (from < 0) from = app.indexOf(`\nasync function ${name}(`);
  assert.ok(from >= 0, `в app.js нет function ${name}`);
  return app.slice(from, app.indexOf('\n}\n', from + 1) + 3);
}
function constSource(name) {
  const m = app.match(new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `в app.js нет const ${name}`);
  return m[0];
}

/** Помощники из app.js — те самые функции, с ядром на месте Core. */
const H = new Function('Core', [
  constSource('SYNC_LISTS'), fnSource('freshSyncExtra'), fnSource('listsCopy'), fnSource('packSync2'), fnSource('unpackSync2'),
  constSource('COALESCE_KEEP'), fnSource('coalescePending'),
  'return { freshSyncExtra, listsCopy, packSync2, unpackSync2, coalescePending };',
].join('\n'))(Core);

const UID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const DEV = 'web-11111111-2222-4333-8444-555555555555';
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const lists = (tasks) => ({ projects: [{ id: 'p', name: 'П' }], tasks, statuses: [], tags: [], versions: [], documents: [] });
const commit = (bundle, next, at) => Core.commitLocal(bundle, next, { deviceId: DEV, at, newId });

test('пачка ложится в данные области полем sync2 без копии состояния и встаёт обратно', () => {
  const data = lists([{ id: 't', projectId: 'p', title: 'А' }]);
  const { bundle } = commit({}, data, '2026-10-17T10:00:00.000Z');
  assert.equal(bundle.pending.length, 2, 'проект и задача — в очереди');
  const sync2 = H.packSync2(bundle, H.freshSyncExtra(), UID);
  assert.equal(sync2.v, 1);
  assert.equal(sync2.uid, UID);
  assert.equal(sync2.linked, true);
  assert.equal(sync2.state, undefined, 'состоянием служат сами списки области');
  const saved = JSON.parse(JSON.stringify({ ...data, settings: {}, sync2 }));
  const { bundle: back } = H.unpackSync2(saved, UID);
  assert.equal(saved.sync2, undefined, 'поле снимается с данных');
  assert.deepEqual(back.pending, bundle.pending, 'очередь пережила запись');
  assert.deepEqual(back.state.tasks, data.tasks, 'состояние пачки — списки области');
  assert.notEqual(back.state.tasks, saved.tasks, 'и не делит с ними объекты');
  // Следующее сохранение сверяется с восстановленным — лишних правок нет.
  assert.deepEqual(commit(back, saved, '2026-10-17T10:01:00.000Z').ops, []);
});

test('чужая область, гость и незнакомый вид — пачки нет', () => {
  const { bundle } = commit({}, lists([]), '2026-10-17T10:00:00.000Z');
  const sync2 = H.packSync2(bundle, H.freshSyncExtra(), UID);
  assert.equal(H.unpackSync2({ sync2: { ...sync2 } }, 'bbbbbbbb-0000-4000-8000-0000000000b2').bundle, null);
  assert.equal(H.unpackSync2({ sync2: { ...sync2 } }, null).bundle, null);
  assert.equal(H.unpackSync2({ sync2: { ...sync2, v: 2 } }, UID).bundle, null);
  assert.equal(H.unpackSync2({}, UID).bundle, null);
  // Не связанная с журналом область хранит только то, что ждёт связи.
  const wait = H.packSync2(null, { ...H.freshSyncExtra(), adopt: [lists([])] }, UID);
  assert.equal(wait.linked, undefined);
  const got = H.unpackSync2({ sync2: wait }, UID);
  assert.equal(got.bundle, null);
  assert.equal(got.extra.adopt.length, 1);
});

test('зеркало sync_state, совпавшее с данными, хранится пометкой, а не второй копией', () => {
  const data = lists([{ id: 't', projectId: 'p', title: 'А' }]);
  const { bundle } = commit({}, data, '2026-10-17T10:00:00.000Z');
  const same = H.packSync2(bundle, { ...H.freshSyncExtra(), mirror: { seq: 7, data: Core.mirrorSyncState(bundle.state) } }, UID);
  assert.deepEqual(same.mirror, { seq: 7, base: true });
  const back = H.unpackSync2(JSON.parse(JSON.stringify({ ...data, sync2: same })), UID);
  assert.deepEqual(back.extra.mirror.data, Core.mirrorSyncState(bundle.state));
  assert.equal(back.extra.mirror.seq, 7);
  const old = lists([{ id: 't', projectId: 'p', title: 'Старое' }]);
  const differs = H.packSync2(bundle, { ...H.freshSyncExtra(), mirror: { seq: 3, data: old } }, UID);
  assert.deepEqual(differs.mirror, { seq: 3, data: old });
});

test('своя неотправленная правка поля, перекрытая следующей, из очереди уходит', () => {
  let b = commit({}, lists([{ id: 't', projectId: 'p', title: 'А', notes: null }]), '2026-10-17T10:00:00.000Z').bundle;
  for (const [i, text] of ['А1', 'А12', 'А123'].entries()) {
    const r = commit(b, lists([{ id: 't', projectId: 'p', title: text, notes: null }]), `2026-10-17T10:0${i + 1}:00.000Z`);
    b = H.coalescePending(r.bundle, r.ops, new Set());
  }
  const titles = b.pending.filter((o) => o.field === 'title');
  assert.deepEqual(titles.map((o) => o.value), ['А123'], 'из трёх правок названия осталась последняя');
  assert.ok(b.pending.some((o) => o.field === '*' && o.entity === 'task'), 'создание не сжимается');
  // Слитая очередь даёт другому устройству то же, что и полная.
  const other = Core.mergeIncoming({}, b.pending.map((o, i) => ({ ...o, seq: i + 1 })), { deviceId: 'win-x' });
  assert.equal(other.state.tasks[0].title, 'А123');
});

test('в полёте и в записи о конфликте правка не сжимается', () => {
  let b = commit({}, lists([{ id: 't', projectId: 'p', title: 'А' }]), '2026-10-17T10:00:00.000Z').bundle;
  let r = commit(b, lists([{ id: 't', projectId: 'p', title: 'Б' }]), '2026-10-17T10:01:00.000Z');
  b = r.bundle;
  const flying = b.pending.find((o) => o.field === 'title').id;
  r = commit(b, lists([{ id: 't', projectId: 'p', title: 'В' }]), '2026-10-17T10:02:00.000Z');
  b = H.coalescePending(r.bundle, r.ops, new Set([flying]));
  assert.deepEqual(b.pending.filter((o) => o.field === 'title').map((o) => o.value), ['Б', 'В'], 'ушедшая на сервер — на месте');
  // Запись о конфликте поля ссылается на id правок — их не трогаем.
  const marked = { ...b, meta: { ...b.meta, 'task:t': { ...b.meta['task:t'], k: { title: { versions: [], gone: [], told: [] } } } } };
  r = commit(marked, lists([{ id: 't', projectId: 'p', title: 'Г' }]), '2026-10-17T10:03:00.000Z');
  const kept = H.coalescePending(r.bundle, r.ops, new Set());
  assert.equal(kept.pending.filter((o) => o.field === 'title').length, 3);
});

test('записи времени, удаление и пометки не сжимаются', () => {
  const ops = [
    { id: '1', entity: 'task', entityId: 't', field: 'sessions+', value: { id: 's1' }, seq: null },
    { id: '2', entity: 'task', entityId: 't', field: 'deleted', value: '2026-10-17T10:00:00.000Z', seq: null },
  ];
  const fresh = [
    { id: '3', entity: 'task', entityId: 't', field: 'sessions+', value: { id: 's2' }, seq: null },
    { id: '4', entity: 'task', entityId: 't', field: 'deleted', value: null, seq: null },
  ];
  const b = { pending: ops.concat(fresh), meta: {} };
  assert.equal(H.coalescePending(b, fresh, new Set()).pending.length, 4);
});

test('id установки на десктопе: система и uuid, один на установку, в device.json', () => {
  const { createDataStore } = require('../../src/data-store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-device-'));
  try {
    const id = createDataStore(dir).deviceId();
    assert.match(id, /^(win|mac|linux)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(createDataStore(dir).deviceId(), id, 'после перезапуска — тот же');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')), { id });
    // Не в области: у гостя и аккаунтов он общий.
    const store = createDataStore(dir);
    store.setScope(UID);
    assert.equal(store.deviceId(), id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('мост к хранилищу: deviceId — у preload и у веба', () => {
  assert.match(read('src/preload.js'), /deviceId: \(\) => ipcRenderer\.invoke\('device:id'\)/);
  assert.match(read('src/data-store.js'), /ipcMain\.handle\('device:id'/);
  assert.match(read('web/api-shim.js'), /DEVICE_KEY = 'lancible:device'/);
});

test('старого «кто последним отправил» нет: сохранение сводит в журнал, вопроса «какие данные оставить» нет', () => {
  for (const gone of ['lastSyncedJSON', 'pushSyncState', 'SYNC_CLIENT_ID', 'planSignInSync(', "'sync.conflict_text'", 'isSyncAlreadyResolved']) {
    assert.ok(!app.includes(gone), `в app.js осталось ${gone}`);
  }
  const save = fnSource('saveNow');
  assert.match(save, /window\.api\.save\(persistData\(\)\)/, 'на диск — данные с пачкой');
  assert.match(fnSource('persistData'), /commitLive\(\)/);
  assert.match(fnSource('commitLive'), /stampLive\(\);[\s\S]*Core\.commitLocal\(/, 'записям без id — ключ до диффа');
  assert.match(app, /addEventListener\('beforeunload', \(\) => \{ if \(savePending && !scopeSwitching\) window\.api\.save\(persistData\(\)\); \}\)/);
  // Отправка — с игнором повторов, приём — чтением после lastSeq.
  const send = fnSource('sendPending');
  assert.match(send, /onConflict: 'user_id,op_id', ignoreDuplicates: true/);
  assert.match(send, /Core\.ackPending\(/);
  const pull = fnSource('pullChanges');
  assert.match(pull, /let after = syncBundle\.lastSeq;[\s\S]*\.gt\('seq', after\)/);
  assert.match(pull, /\.order\('seq', \{ ascending: true \}\)/);
  assert.match(pull, /Core\.mergeIncoming\(/);
  // Страницы сливаются разом, после последней: своё — в очередь прямо перед
  // приёмом, без await между ними (правка, сделанная, пока грузилась
  // следующая страница, иначе терялась; e2e — sync2.spec.js).
  const merge = pull.slice(pull.indexOf('if (rows.length && syncFor(uid)'), pull.indexOf('Core.mergeIncoming('));
  assert.match(merge, /flushEditor\(\);\s*commitLive\(\);/);
  assert.ok(!/await /.test(merge), 'между своим в очередь и приёмом нет await');
  assert.ok(pull.indexOf('Core.mergeIncoming(') > pull.lastIndexOf('await sb.from('), 'приём — после чтения всех страниц');
  // Строку из события realtime не применяем — событие лишь повод читать.
  const sub = fnSource('subscribeSyncRealtime');
  assert.match(sub, /table: 'changes'[^\n]*\(\) => pullSoon\(uid\)/);
  // Перенос «Без аккаунта» в связанный аккаунт — без потерь.
  assert.match(fnSource('moveGuestData'), /Core\.adoptGuestState\(/);
  assert.match(fnSource('linkAccount'), /Core\.bootstrapFromSnapshot\(/);
  assert.match(fnSource('linkAccount'), /Core\.adoptGuestState\(/);
});

test('зеркало для старых версий подписано oplog: и несёт mirror_seq', () => {
  const mirror = fnSource('writeMirror');
  assert.match(mirror, /updated_by: `oplog:\$\{deviceId\}`/);
  assert.match(mirror, /mirror_seq: seq/);
  assert.match(mirror, /Core\.mirrorSyncState\(/);
  const bridge = fnSource('bridgeLegacy');
  assert.match(bridge, /Core\.legacyBridgeOps\(prev, row\.data \|\| \{\}, \{ at: stamp, baseSeq: base, stamp \}\)/);
  assert.match(bridge, /ignoreDuplicates: true/);
});

test('новые записи времени заводятся сразу с id', () => {
  const pushes = [...app.matchAll(/sessions\.push\(\{([^}]*)/g)].map((m) => m[1]);
  assert.ok(pushes.length >= 3, `записей времени найдено ${pushes.length}`);
  for (const p of pushes) assert.match(p, /\bid: uid\(\)/, `запись без id: ${p.trim().slice(0, 60)}`);
});

test('удаление аккаунта на сервере копию на устройстве не стирает', () => {
  // Текст подтверждения обещает «Копия на этом устройстве останется» — так
  // и делаем; стереть её — «Удалить данные аккаунта с устройства».
  const del = fnSource('deleteAccount');
  assert.ok(!/dataRemove/.test(del), 'deleteAccount стирает область');
  assert.match(T.ru['account.delete_confirm'], /останется/);
});

test('строки журнала — на четырёх языках, с одинаковыми подстановками', () => {
  const keys = Object.keys(T.ru).filter((k) => k.startsWith('sync.'));
  assert.ok(keys.length > 40, `строк sync.* всего ${keys.length}`);
  for (const lang of ['en', 'uk', 'kk']) {
    for (const k of keys) {
      assert.ok(typeof T[lang][k] === 'string' && T[lang][k], `${lang}: нет ${k}`);
      const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(vars(T[lang][k]), vars(T.ru[k]), `${lang} ${k}: подстановки`);
    }
  }
  for (const k of ['sync.conflict_title', 'sync.conflict_text', 'sync.use_server', 'sync.use_local']) assert.ok(!(k in T.ru), `осталась строка вопроса ${k}`);
});

// Дублирование проекта и задачи. Запуск: npm run test:unit
//
// Что должна делать копия: получить новые id, унести всё содержимое, кроме
// записей времени, и ссылаться на копии, а не на оригинал. Последнее главное:
// копия, чей статус или версия остались от оригинала, правит чужие настройки
// и пропадает с доски, как только оригинал удалят.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/renderer/core/duplicate.js');
const I = require('../../src/renderer/core/i18n.js');

const NOW = '2026-10-11T12:00:00.000Z';
const OLD = '2026-09-01T08:00:00.000Z';
const counter = () => { let n = 0; return () => `n${++n}`; };
const opts = (suffix = '(копия)') => ({ uid: counter(), now: NOW, suffix });

/** Проект p1: три статуса, две версии, свой тег, общий тег, четыре задачи
 *  (одна выполнена, одна с записями времени и текстом с картинкой), документ. */
function fixture() {
  const session = { start: '2026-10-10T09:00:00.000Z', end: '2026-10-10T10:00:00.000Z', ms: 3_600_000 };
  return {
    projects: [
      { id: 'p0', name: 'Другой', color: '#111111', description: '', pinnedAt: null, createdAt: OLD, tagIds: [], rate: null, currency: null },
      {
        id: 'p1', name: 'Сайт', color: '#87ff65', description: 'Лендинг', pinnedAt: '2026-10-05T00:00:00.000Z',
        createdAt: OLD, tagIds: ['gl', 'pt'], rate: 1500, currency: 'USD',
      },
    ],
    statuses: [
      { id: 'sa', projectId: 'p1', name: 'К выполнению', color: '#8a93a5', kind: 'todo', order: 0, builtin: true },
      { id: 'sb', projectId: 'p1', name: 'В работе', color: '#f5c451', kind: 'progress', order: 1, builtin: true },
      { id: 'sc', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 2, builtin: true },
      { id: 'sd', projectId: 'p1', name: 'Отменено', color: '#8a93a5', kind: 'cancelled', order: 3, builtin: true },
      { id: 'x1', projectId: 'p0', name: 'Чужой', color: '#8a93a5', kind: 'todo', order: 0, builtin: true },
    ],
    versions: [
      { id: 'v1', projectId: 'p1', name: 'v1.0', order: 0, releasedAt: '2026-09-20T00:00:00.000Z' },
      { id: 'v2', projectId: 'p1', name: 'v2.0', order: 1, releasedAt: null },
      { id: 'vx', projectId: 'p0', name: 'Чужая', order: 0, releasedAt: null },
    ],
    tags: [
      { id: 'gl', name: 'Срочное', color: '#ff0000', projectId: null },
      { id: 'pt', name: 'Дизайн', color: '#00ff00', projectId: 'p1' },
      { id: 'px', name: 'Чужой тег', color: '#0000ff', projectId: 'p0' },
    ],
    tasks: [
      {
        id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, doneAt: null, cancelled: false,
        notes: { doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'asset:img-1' } }] } },
        totalMs: 3_600_000, sessions: [session], rate: 2000, pinnedAt: '2026-10-06T00:00:00.000Z',
        createdAt: OLD, updatedAt: OLD, statusId: 'sb', tagIds: ['gl', 'pt'], versionId: 'v2',
        repeat: { every: 1, unit: 'week' }, dueAt: '2026-10-20T15:00:00.000Z',
        remindOffsetMin: 30, remindAt: null, notifiedAt: null,
      },
      {
        id: 't2', projectId: 'p1', title: 'Сдача', done: true, doneAt: '2026-10-09T00:00:00.000Z', cancelled: false,
        notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD,
        statusId: 'sc', tagIds: [], versionId: 'v1', repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      },
      {
        id: 't3', projectId: 'p1', title: 'Отказ', done: false, doneAt: null, cancelled: true,
        notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD,
        statusId: 'sd', tagIds: [], versionId: null, repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      },
      {
        id: 't4', projectId: 'p1', title: '', done: false, doneAt: null, cancelled: false,
        notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD,
        statusId: 'sa', tagIds: [], versionId: null, repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      },
      {
        id: 'tx', projectId: 'p0', title: 'Чужая', done: false, doneAt: null, cancelled: false,
        notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD,
        statusId: 'x1', tagIds: [], versionId: 'vx', repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      },
    ],
    documents: [
      { id: 'd1', title: 'Бриф', projectId: 'p1', body: { type: 'container', pages: [{ src: 'asset:img-2' }] }, pinnedAt: null, createdAt: OLD, updatedAt: OLD },
      { id: 'd2', title: 'Чужой документ', projectId: 'p0', body: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD },
      { id: 'd3', title: 'Общий', projectId: null, body: null, pinnedAt: null, createdAt: OLD, updatedAt: OLD },
    ],
  };
}

// --- название -------------------------------------------------------------------

test('суффикс «копия» — на языке интерфейса, на каждом из четырёх', () => {
  const expected = { ru: '(копия)', en: '(copy)', uk: '(копія)', kk: '(көшірме)' };
  for (const [lang, suffix] of Object.entries(expected)) {
    assert.equal(I.T[lang]['docs.copy_suffix'], suffix, `${lang}: другая строка суффикса`);
    assert.equal(D.copyTitle('Сайт', I.T[lang]['docs.copy_suffix']), `Сайт ${suffix}`);
  }
});

test('у проекта и задачи есть пункт «Дублировать» на всех четырёх языках', () => {
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    for (const key of ['project.duplicate', 'task.duplicate']) {
      assert.ok(I.T[lang][key], `${lang}/${key}: нет строки`);
    }
  }
});

test('пустое название остаётся пустым: «(копия)» вместо него было бы названием', () => {
  assert.equal(D.copyTitle('', '(копия)'), '');
  assert.equal(D.copyTitle('   ', '(копия)'), '');
  assert.equal(D.copyTitle(undefined, '(копия)'), '');
  assert.equal(D.copyTitle('  Сайт ', '(копия)'), 'Сайт (копия)', 'краевые пробелы не удваиваются');
});

// --- проект ---------------------------------------------------------------------

test('проект: настройки те же, id, название и дата создания — новые', () => {
  const data = fixture();
  const { project } = D.duplicateProject(data, 'p1', opts());
  assert.notEqual(project.id, 'p1');
  assert.equal(project.name, 'Сайт (копия)');
  assert.equal(project.createdAt, NOW);
  for (const key of ['color', 'description', 'rate', 'currency', 'pinnedAt']) {
    assert.deepEqual(project[key], data.projects[1][key], `${key} должен остаться как у оригинала`);
  }
});

test('проект: статусы и версии — копии, а не те же объекты', () => {
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.deepEqual(copy.statuses.map((s) => [s.name, s.kind, s.color, s.order, s.builtin]),
    data.statuses.filter((s) => s.projectId === 'p1').map((s) => [s.name, s.kind, s.color, s.order, s.builtin]));
  assert.deepEqual(copy.versions.map((v) => [v.name, v.order, v.releasedAt]),
    [['v1.0', 0, '2026-09-20T00:00:00.000Z'], ['v2.0', 1, null]]);
  for (const row of [...copy.statuses, ...copy.versions, ...copy.tags]) assert.equal(row.projectId, copy.project.id);
  const oldIds = new Set([...data.statuses, ...data.versions, ...data.tags].map((r) => r.id));
  for (const row of [...copy.statuses, ...copy.versions, ...copy.tags]) assert.ok(!oldIds.has(row.id), `${row.id} — id оригинала`);
});

test('проект: теги проекта копируются, общие остаются теми же', () => {
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.deepEqual(copy.tags.map((tg) => [tg.name, tg.color]), [['Дизайн', '#00ff00']], 'чужие и общие теги не копируются');
  const [own] = copy.tags;
  assert.deepEqual(copy.project.tagIds, ['gl', own.id], 'общий — тот же, проектный — копия');
  assert.deepEqual(copy.tasks[0].tagIds, ['gl', own.id]);
});

test('проект: задачи копируются все и только свои, со всем содержимым', () => {
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.deepEqual(copy.tasks.map((t) => t.title), ['Вёрстка', 'Сдача', 'Отказ', ''], 'порядок сохранён, «Чужая» не попала');
  const t = copy.tasks[0];
  assert.deepEqual(t.notes, data.tasks[0].notes);
  assert.equal(t.rate, 2000);
  assert.equal(t.pinnedAt, '2026-10-06T00:00:00.000Z');
  assert.deepEqual(t.repeat, { every: 1, unit: 'week' });
  assert.equal(t.dueAt, '2026-10-20T15:00:00.000Z');
  assert.equal(t.remindOffsetMin, 30);
});

test('проект: выполненность и отмена переезжают как есть', () => {
  const copy = D.duplicateProject(fixture(), 'p1', opts());
  const [, done, cancelled] = copy.tasks;
  assert.equal(done.done, true);
  assert.equal(done.doneAt, '2026-10-09T00:00:00.000Z');
  assert.equal(cancelled.done, false);
  assert.equal(cancelled.cancelled, true);
});

test('проект: записей времени у копии нет, ни у одной задачи', () => {
  const copy = D.duplicateProject(fixture(), 'p1', opts());
  for (const t of copy.tasks) {
    assert.deepEqual(t.sessions, [], `${t.title}: записи`);
    assert.equal(t.totalMs, 0, `${t.title}: время`);
  }
});

test('проект: ни одна ссылка копии не ведёт на статус, версию или тег оригинала', () => {
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  const statusIds = new Set(copy.statuses.map((s) => s.id));
  const versionIds = new Set(copy.versions.map((v) => v.id));
  const tagIds = new Set(['gl', ...copy.tags.map((tg) => tg.id)]);
  for (const t of copy.tasks) {
    assert.ok(statusIds.has(t.statusId), `${t.title}: статус не из копии`);
    assert.ok(t.versionId === null || versionIds.has(t.versionId), `${t.title}: версия не из копии`);
    for (const id of t.tagIds) assert.ok(tagIds.has(id), `${t.title}: тег ${id} не из копии`);
    assert.equal(t.projectId, copy.project.id);
  }
  // Соответствие по смыслу: «В работе» осталась «В работе», v2.0 — v2.0.
  const nameOf = (rows, id) => rows.find((r) => r.id === id).name;
  assert.equal(nameOf(copy.statuses, copy.tasks[0].statusId), 'В работе');
  assert.equal(nameOf(copy.statuses, copy.tasks[1].statusId), 'Готово');
  assert.equal(nameOf(copy.versions, copy.tasks[0].versionId), 'v2.0');
  assert.equal(copy.tasks[2].versionId, null);
});

test('проект: задача со статусом, которого нет, встаёт в статус по умолчанию копии', () => {
  const data = fixture();
  data.tasks[3].statusId = 'призрак';
  data.tasks[1].versionId = 'призрак';
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.equal(copy.statuses.find((s) => s.id === copy.tasks[3].statusId).name, 'К выполнению');
  assert.equal(copy.tasks[1].versionId, null, 'версия-призрак не переезжает');
});

test('проект: документы проекта копируются, чужие и общие — нет', () => {
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.equal(copy.documents.length, 1);
  const [d] = copy.documents;
  assert.equal(d.title, 'Бриф');
  assert.equal(d.projectId, copy.project.id);
  assert.notEqual(d.id, 'd1');
  assert.equal(d.updatedAt, NOW);
  assert.deepEqual(d.body, data.documents[0].body);
});

test('у всего, что скопировано, новые id — и все разные', () => {
  const copy = D.duplicateProject(fixture(), 'p1', opts());
  const ids = [copy.project, ...copy.statuses, ...copy.versions, ...copy.tags, ...copy.tasks, ...copy.documents].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('n')), 'остался id оригинала');
  for (const t of copy.tasks) {
    assert.equal(t.createdAt, NOW);
    assert.equal(t.updatedAt, NOW, 'время правки — момент копирования, иначе копия «старше» самой себя');
  }
});

test('копия глубокая: правка копии не задевает оригинал', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.equal(JSON.stringify(data), before, 'сама функция оригинал не трогает');
  copy.tasks[0].notes.doc.content[0].attrs.src = 'asset:другая';
  copy.tasks[0].repeat.every = 9;
  copy.tasks[0].tagIds.push('нов');
  copy.documents[0].body.pages[0].src = 'asset:другая';
  copy.project.tagIds.push('нов');
  assert.equal(JSON.stringify(data), before, 'правка копии дошла до оригинала');
});

test('картинки: копия ссылается на те же asset:<id>, ничего не теряя', () => {
  // Байты картинки лежат по id в общем хранилище (src/editor/assets.js) и при
  // удалении задачи или документа не стираются. Поэтому копия, которая держит
  // те же ссылки, переживёт удаление оригинала.
  const data = fixture();
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.equal(copy.tasks[0].notes.doc.content[0].attrs.src, 'asset:img-1');
  assert.equal(copy.documents[0].body.pages[0].src, 'asset:img-2');
});

test('проекта нет — копировать нечего', () => {
  assert.equal(D.duplicateProject(fixture(), 'нет такого', opts()), null);
});

test('проект без задач, статусов и документов копируется пустым', () => {
  const data = { projects: [{ id: 'p', name: 'Пустой', tagIds: undefined }], tasks: [], statuses: [], versions: [], tags: [] };
  const copy = D.duplicateProject(data, 'p', opts('(copy)'));
  assert.equal(copy.project.name, 'Пустой (copy)');
  assert.deepEqual(copy.project.tagIds, []);
  assert.deepEqual([copy.tasks, copy.statuses, copy.versions, copy.tags, copy.documents], [[], [], [], [], []]);
});

test('копия копии: «(копия) (копия)» — допустимо, и ничего не ломается', () => {
  const data = fixture();
  const o = opts(); // один генератор на все копии: id второй не повторяют id первой
  const first = D.duplicateProject(data, 'p1', o);
  data.projects.push(first.project);
  data.statuses.push(...first.statuses);
  data.versions.push(...first.versions);
  data.tags.push(...first.tags);
  data.tasks.push(...first.tasks);
  data.documents.push(...first.documents);
  const second = D.duplicateProject(data, first.project.id, o);
  assert.equal(second.project.name, 'Сайт (копия) (копия)');
  assert.equal(second.tasks.length, 4);
  // Ссылки второй копии — на вторую копию, а не на первую и не на оригинал.
  const mine = new Set(second.statuses.map((s) => s.id));
  for (const t of second.tasks) assert.ok(mine.has(t.statusId));
  assert.ok(second.statuses.every((s) => !first.statuses.some((f) => f.id === s.id)), 'id статусов второй копии совпали с первой');
  // И само число копий не растёт от повторных нажатий на оригинал: у каждой свои id.
  const again = D.duplicateProject(data, 'p1', o);
  assert.equal(again.project.name, 'Сайт (копия)');
  assert.equal(again.tasks.length, 4);
});

// --- задача ---------------------------------------------------------------------

test('задача: всё, кроме записей времени и «выполнено», — как у оригинала', () => {
  const data = fixture();
  const copy = D.duplicateTask(data, 't1', opts());
  assert.notEqual(copy.id, 't1');
  assert.equal(copy.title, 'Вёрстка (копия)');
  assert.equal(copy.projectId, 'p1', 'тот же проект');
  assert.deepEqual(copy.notes, data.tasks[0].notes);
  assert.deepEqual(copy.tagIds, ['gl', 'pt']);
  assert.equal(copy.versionId, 'v2');
  assert.equal(copy.statusId, 'sb', 'открытый статус сохраняется');
  assert.equal(copy.dueAt, '2026-10-20T15:00:00.000Z');
  assert.deepEqual(copy.repeat, { every: 1, unit: 'week' });
  assert.equal(copy.rate, 2000);
  assert.equal(copy.pinnedAt, '2026-10-06T00:00:00.000Z');
  assert.equal(copy.createdAt, NOW);
  assert.equal(copy.updatedAt, NOW);
});

test('задача: отметка «уже напомнили» не переезжает — копия с тем же сроком напомнит о себе', () => {
  const data = fixture();
  data.tasks[0].notifiedAt = '2026-10-10T08:00:00.000Z';
  const copy = D.duplicateTask(data, 't1', opts());
  assert.equal(copy.notifiedAt, null);
  assert.equal(copy.dueAt, '2026-10-20T15:00:00.000Z', 'срок и напоминание остаются');
  assert.equal(copy.remindOffsetMin, 30);
  assert.equal(data.tasks[0].notifiedAt, '2026-10-10T08:00:00.000Z', 'у оригинала отметка цела');
});

test('проект: у задач копии отметка «уже напомнили» тоже снята, у оригинала цела', () => {
  const data = fixture();
  data.tasks[0].notifiedAt = '2026-10-10T08:00:00.000Z';
  data.tasks[1].notifiedAt = '2026-10-09T08:00:00.000Z';
  const copy = D.duplicateProject(data, 'p1', opts());
  assert.deepEqual(copy.tasks.map((t) => t.notifiedAt), [null, null, null, null]);
  assert.equal(data.tasks[0].notifiedAt, '2026-10-10T08:00:00.000Z');
  assert.equal(data.tasks[1].notifiedAt, '2026-10-09T08:00:00.000Z');
});

test('задача: записей времени нет, время ноль — оригинал остаётся при своих', () => {
  const data = fixture();
  const copy = D.duplicateTask(data, 't1', opts());
  assert.deepEqual(copy.sessions, []);
  assert.equal(copy.totalMs, 0);
  assert.equal(data.tasks[0].sessions.length, 1, 'у оригинала запись на месте');
  assert.equal(data.tasks[0].totalMs, 3_600_000);
});

test('задача: выполненная копируется невыполненной и уходит из «Готово»', () => {
  const data = fixture();
  const copy = D.duplicateTask(data, 't2', opts());
  assert.equal(copy.done, false);
  assert.equal(copy.doneAt, null);
  assert.equal(copy.cancelled, false);
  assert.equal(copy.statusId, 'sa', 'статус по умолчанию для открытых — первый «к выполнению»');
  assert.equal(copy.versionId, 'v1', 'остальное — как было');
});

test('задача: отменённая — тоже открытая копия в статусе по умолчанию', () => {
  const copy = D.duplicateTask(fixture(), 't3', opts());
  assert.equal(copy.cancelled, false);
  assert.equal(copy.done, false);
  assert.equal(copy.statusId, 'sa');
});

test('задача: со статусом, которого нет, копия тоже встаёт в статус по умолчанию', () => {
  const data = fixture();
  data.tasks[0].statusId = 'призрак';
  assert.equal(D.duplicateTask(data, 't1', opts()).statusId, 'sa');
});

test('задача без названия копируется без названия', () => {
  assert.equal(D.duplicateTask(fixture(), 't4', opts()).title, '');
});

test('задача: копия глубокая, а оригинал функция не трогает', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const copy = D.duplicateTask(data, 't1', opts());
  assert.equal(JSON.stringify(data), before);
  copy.notes.doc.content.push({ type: 'paragraph' });
  copy.tagIds.push('нов');
  copy.repeat.unit = 'day';
  assert.equal(JSON.stringify(data), before);
});

test('задача: картинки остаются теми же ссылками', () => {
  assert.equal(D.duplicateTask(fixture(), 't1', opts()).notes.doc.content[0].attrs.src, 'asset:img-1');
});

test('задачи нет — копировать нечего', () => {
  assert.equal(D.duplicateTask(fixture(), 'нет такой', opts()), null);
});

test('копия копии задачи: «(копия) (копия)» допустимо', () => {
  const data = fixture();
  const o = opts(); // один генератор: id второй копии не повторяют id первой
  const first = D.duplicateTask(data, 't1', o);
  data.tasks.push(first);
  const second = D.duplicateTask(data, first.id, o);
  assert.equal(second.title, 'Вёрстка (копия) (копия)');
  assert.notEqual(second.id, first.id);
});

// --- «время работы» (с 11 октября 2026) --------------------------------------

test('отрезки копируются, но отметка «уже напомнили» у них снята, и возврата копия не ждёт', () => {
  const data = fixture();
  const slots = [
    { id: 'a', start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z', remindOffsetMin: 15, notifiedUpTo: '2026-10-12T09:00:00.000Z' },
    { id: 'b', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T10:00:00.000Z', remindOffsetMin: null, notifiedUpTo: null },
  ];
  data.tasks[0].slots = slots;
  data.tasks[1].reopenAt = '2026-10-20T00:00:00.000Z';
  const before = JSON.stringify(data);
  const task = D.duplicateTask(data, 't1', opts());
  assert.deepEqual(task.slots.map((s) => [s.id, s.start, s.notifiedUpTo, s.remindOffsetMin]), [
    ['a', slots[0].start, null, 15], ['b', slots[1].start, null, null],
  ]);
  assert.equal(task.reopenAt, null);
  assert.equal(D.duplicateTask(data, 't2', opts()).reopenAt, null, 'копия задачи открыта — ждать ей нечего');
  const project = D.duplicateProject(data, 'p1', opts());
  assert.equal(project.tasks[0].slots[0].notifiedUpTo, null);
  assert.deepEqual(project.tasks.map((t) => t.reopenAt), [null, '2026-10-20T00:00:00.000Z', null, null],
    'в копии проекта закрытая ждёт того же дня, что и оригинал');
  assert.equal(JSON.stringify(data), before, 'у оригинала всё цело');
});

test('закрытая копия в копии проекта не засчитывает раз серии второй раз', () => {
  // Без reopenAt лечение planReopen приняло бы её за закрытую старым клиентом:
  // спланировало бы заново и подняло repeat.done.
  const L = require('../../src/renderer/core/slots.js');
  const data = fixture();
  Object.assign(data.tasks[1], {
    doneAt: '2026-10-12T10:00:00.000Z', reopenAt: '2026-10-20T00:00:00.000Z',
    repeat: { freq: 'week', every: 1, ends: { kind: 'after', count: 3 }, done: 1 },
  });
  const copy = D.duplicateProject(data, 'p1', opts()).tasks[1];
  assert.equal(copy.done, true);
  assert.equal(copy.reopenAt, '2026-10-20T00:00:00.000Z');
  assert.deepEqual(L.planReopen([copy], Date.parse('2026-10-14T12:00:00.000Z')), [], 'день ещё не настал — ни плана, ни счёта');
});

// --- напоминания списком (с 11 октября 2026) ------------------------------------

test('напоминания копируются со своими id и без отметок «уже напомнили»', () => {
  const data = fixture();
  const reminders = [
    { id: 'r-due', kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min', notifiedUpTo: '2026-10-12T09:00:00.000Z' },
    { id: 'r-at', kind: 'at', at: '2026-10-12T08:00:00.000Z', notifiedAt: '2026-10-12T08:00:00.000Z', своё: 1 },
    { id: 'r-rep', kind: 'repeat', rule: { freq: 'day', every: 1 }, time: '09:00', start: '2026-10-01T00:00:00.000Z', notifiedUpTo: '2026-10-11T09:00:00.000Z' },
  ];
  data.tasks[0].reminders = reminders;
  const before = JSON.stringify(data);
  const o = opts();
  const task = D.duplicateTask(data, 't1', o);
  assert.deepEqual(task.reminders.map((r) => [r.kind, r.notifiedUpTo === undefined ? 'нет' : r.notifiedUpTo, r.notifiedAt === undefined ? 'нет' : r.notifiedAt]), [
    ['before', null, 'нет'], ['at', 'нет', null], ['repeat', null, 'нет'],
  ], 'отметки сняты, лишних полей не появилось');
  const ids = task.reminders.map((r) => r.id);
  assert.ok(ids.every((id) => !reminders.some((r) => r.id === id)), 'id — новые');
  assert.equal(new Set([...ids, task.id]).size, ids.length + 1, 'и не совпадают ни друг с другом, ни с id задачи');
  assert.equal(task.reminders[1].своё, 1, 'остальное — как у оригинала');
  assert.equal(task.reminders[0].offsetMin, 30);
  const project = D.duplicateProject(data, 'p1', opts());
  assert.ok(project.tasks[0].reminders.every((r) => !reminders.some((x) => x.id === r.id)));
  assert.equal(JSON.stringify(data), before, 'у оригинала всё цело');
});

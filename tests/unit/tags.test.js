// Теги. Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/renderer/core/tags.js');

const tags = [
  { id: 'a', name: 'Срочное', color: '#f00' },
  { id: 'b', name: 'Дизайн', color: '#0f0' },
  { id: 'c', name: 'Правки клиента', color: '#00f' },
];

test('getTag не падает на неизвестном идентификаторе', () => {
  assert.equal(T.getTag(tags, 'b').name, 'Дизайн');
  assert.equal(T.getTag(tags, 'призрак'), null);
});

test('теги сущности идут в порядке общего списка, а не проставления', () => {
  // Иначе одни и те же два тега на разных задачах выглядели бы по-разному.
  assert.deepEqual(T.tagsOf(tags, ['c', 'a']).map((t) => t.id), ['a', 'c']);
  assert.deepEqual(T.tagsOf(tags, ['a', 'c']).map((t) => t.id), ['a', 'c']);
});

test('ссылки на исчезнувшие теги просто пропускаются', () => {
  assert.deepEqual(T.tagsOf(tags, ['a', 'призрак']).map((t) => t.id), ['a']);
  assert.deepEqual(T.tagsOf(tags, null), []);
  assert.deepEqual(T.tagsOf(tags, []), []);
});

test('подсчёт использований считает и проекты, и задачи', () => {
  const projects = [{ id: 'p1', tagIds: ['a'] }, { id: 'p2', tagIds: [] }, { id: 'p3' }];
  const tasks = [{ id: 't1', tagIds: ['a', 'b'] }, { id: 't2', tagIds: ['b'] }, { id: 't3', tagIds: [] }];
  assert.deepEqual(T.tagUsage(projects, tasks, 'a'), { projects: 1, tasks: 1 });
  assert.deepEqual(T.tagUsage(projects, tasks, 'b'), { projects: 0, tasks: 2 });
  assert.deepEqual(T.tagUsage(projects, tasks, 'c'), { projects: 0, tasks: 0 });
});

test('подсчёт не падает на сущностях без поля tagIds', () => {
  assert.deepEqual(T.tagUsage([{ id: 'p' }], [{ id: 't' }], 'a'), { projects: 0, tasks: 0 });
});

test('toggleTag ставит и снимает, не трогая исходный список', () => {
  const ids = ['a'];
  assert.deepEqual(T.toggleTag(ids, 'b'), ['a', 'b']);
  assert.deepEqual(T.toggleTag(ids, 'a'), []);
  assert.deepEqual(ids, ['a'], 'исходный массив меняться не должен');
  assert.deepEqual(T.toggleTag(null, 'a'), ['a']);
});

test('поиск не различает регистр и ищет по вхождению', () => {
  assert.deepEqual(T.searchTags(tags, 'сроч').map((t) => t.id), ['a']);
  assert.deepEqual(T.searchTags(tags, 'КЛИЕНТА').map((t) => t.id), ['c']);
  assert.deepEqual(T.searchTags(tags, '').map((t) => t.id), ['a', 'b', 'c'], 'пустой запрос — весь список');
  assert.deepEqual(T.searchTags(tags, '   ').map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(T.searchTags(tags, 'нетакого'), []);
});

test('поиск возвращает новый список, а не исходный', () => {
  // Иначе вызывающий, отсортировав результат, незаметно перетасует state.tags.
  const out = T.searchTags(tags, '');
  assert.notEqual(out, tags);
});

test('занятое имя ловится без учёта регистра и краевых пробелов', () => {
  // Два тега «Срочное» и «срочное» на глаз не различить, и заводить оба
  // бессмысленно.
  assert.equal(T.nameTaken(tags, 'Срочное'), true);
  assert.equal(T.nameTaken(tags, '  срочное  '), true);
  assert.equal(T.nameTaken(tags, 'Новое'), false);
  assert.equal(T.nameTaken(tags, ''), false, 'пустое имя не занято — его просто не сохранят');
});

test('при переименовании сам тег себя не блокирует', () => {
  assert.equal(T.nameTaken(tags, 'Срочное', 'a'), false);
  assert.equal(T.nameTaken(tags, 'Дизайн', 'a'), true, 'а чужое имя — блокирует');
});

test('точное совпадение отличается от частичного', () => {
  // От этого зависит, предлагать ли «Создать тег»: «Сроч» — это ещё не
  // «Срочное», и создать такой тег должно быть можно.
  assert.equal(T.exactMatch(tags, 'срочное').id, 'a');
  assert.equal(T.exactMatch(tags, 'Сроч'), null);
  assert.equal(T.exactMatch(tags, ''), null);
});

test('keepKnown вычищает ссылки на удалённые теги', () => {
  assert.deepEqual(T.keepKnown(tags, ['a', 'удалён', 'c']), ['a', 'c']);
  assert.deepEqual(T.keepKnown(tags, null), []);
  assert.deepEqual(T.keepKnown([], ['a']), []);
});

// --- общие и проектные теги (с 7 октября 2026) ---------------------------------

const scoped = [
  { id: 'g', name: 'Срочное', color: '#f00', projectId: null },
  { id: 'p1a', name: 'Макет', color: '#0f0', projectId: 'p1' },
  { id: 'p2a', name: 'Макет', color: '#00f', projectId: 'p2' },
];

test('в проекте видны общие теги и его собственные, чужие — нет', () => {
  assert.deepEqual(T.tagsForProject(scoped, 'p1').map((tg) => tg.id), ['g', 'p1a']);
  assert.deepEqual(T.tagsForProject(scoped, 'p2').map((tg) => tg.id), ['g', 'p2a']);
  assert.deepEqual(T.tagsForProject(scoped, null).map((tg) => tg.id), ['g'], 'без проекта — только общие');
});

test('имя проектного тега занято только тем, что видно в его проекте', () => {
  assert.equal(T.nameTaken(scoped, 'макет', null, 'p1'), true, 'свой «Макет» уже есть');
  assert.equal(T.nameTaken(scoped, 'Макет', null, 'p3'), false, 'в третьем проекте «Макет» свободен');
  assert.equal(T.nameTaken(scoped, 'срочное', null, 'p3'), true, 'общий тег занимает имя везде');
});

test('общему тегу имя занимает любой тег — он виден всюду', () => {
  assert.equal(T.nameTaken(scoped, 'Макет', null), true);
  assert.equal(T.nameTaken(scoped, 'Макет', 'p1a'), true, 'второй «Макет» всё равно мешает');
});

test('точное совпадение ищется среди видных в проекте', () => {
  assert.equal(T.exactMatch(scoped, 'макет', 'p1').id, 'p1a');
  assert.equal(T.exactMatch(scoped, 'макет', 'p3'), null);
  assert.equal(T.exactMatch(scoped, 'макет').id, 'p1a', 'без области — по всем');
});

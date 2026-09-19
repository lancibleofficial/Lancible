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

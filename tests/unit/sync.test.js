// Решения синхронизации. Запуск: npm run test:unit
//
// Это единственное место в проекте, где ошибка ветки стоит пользователю его
// данных: взяли серверное вместо местного — и работа за день исчезла. Поэтому
// здесь перебраны все восемь сочетаний трёх условий, а не только те, что
// кажутся вероятными.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/renderer/core/sync.js');

test('пустой набор — это отсутствие проектов и задач, а не отсутствие полей', () => {
  assert.equal(S.hasData(null), false);
  assert.equal(S.hasData(undefined), false);
  assert.equal(S.hasData({}), false);
  assert.equal(S.hasData({ projects: [], tasks: [] }), false);
  // Настройки и теги не в счёт: аккаунт с выбранным языком всё равно пуст, и
  // спрашивать «чьи данные оставить» про него бессмысленно.
  assert.equal(S.hasData({ settings: { lang: 'ru' }, tags: [{ id: 'x' }] }), false);
});

test('один проект или одна задача — уже данные', () => {
  assert.equal(S.hasData({ projects: [{ id: 'p' }] }), true);
  assert.equal(S.hasData({ tasks: [{ id: 't' }] }), true);
  assert.equal(S.hasData({ projects: [{ id: 'p' }], tasks: [{ id: 't' }] }), true);
});

test('все восемь сочетаний разобраны', () => {
  const cases = [
    // local, remote, resolved → решение
    [false, false, false, 'none'],
    [false, false, true, 'none'],
    [true, false, false, 'push'],
    [true, false, true, 'push'],
    [false, true, false, 'pull'],
    [false, true, true, 'pull'],
    [true, true, false, 'ask'],
    [true, true, true, 'none'],
  ];
  for (const [localHasData, remoteHasData, resolved, want] of cases) {
    assert.equal(
      S.planSignInSync({ localHasData, remoteHasData, resolved }), want,
      `местное=${localHasData} серверное=${remoteHasData} разрешено=${resolved}`,
    );
  }
});

test('данные с обеих сторон без разрешения — только спросить, никогда не решать самим', () => {
  // Самая опасная ветка: тут нельзя ни залить, ни забрать молча.
  assert.equal(S.planSignInSync({ localHasData: true, remoteHasData: true, resolved: false }), 'ask');
});

test('уже разрешённое расхождение не спрашивается второй раз', () => {
  // Иначе диалог всплывал бы на каждом запуске из-за обычной правки, уже
  // уехавшей на сервер, — а не из-за настоящего расхождения.
  assert.equal(S.planSignInSync({ localHasData: true, remoteHasData: true, resolved: true }), 'none');
});

test('мусор вместо состояния не роняет и не решает за пользователя', () => {
  assert.equal(S.planSignInSync(null), 'none');
  assert.equal(S.planSignInSync({}), 'none');
  assert.equal(S.planSignInSync({ localHasData: 'да', remoteHasData: 0 }), 'push');
});

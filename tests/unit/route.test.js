// Адреса экранов: разбор и сборка. Запуск: npm run test:unit
//
// Откуда тест. Обновление страницы отправляло на «Сегодня» с любого экрана, а
// у проектов и задач не было своих ссылок. Теперь каждый экран и открытая
// сущность лежат в хэше (#/project/<id>), и от этих двух функций зависит всё:
// ошибка в разборе открыла бы не тот экран, а ошибка в сборке сломала бы
// «Скопировать ссылку» и «назад» в браузере.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRoute, buildRoute, routeKey, routeLink, deepLinkRoute, isAuthHash,
} = require('../../src/renderer/core/route.js');

const HOME = { view: 'home' };

test('каждый вид адреса разбирается в свой экран', () => {
  assert.deepEqual(parseRoute('#/today'), HOME);
  assert.deepEqual(parseRoute('#/projects'), { view: 'projects' });
  assert.deepEqual(parseRoute('#/project/p1'), { view: 'project', id: 'p1', tab: 'list' });
  assert.deepEqual(parseRoute('#/project/p1/board'), { view: 'project', id: 'p1', tab: 'board' });
  assert.deepEqual(parseRoute('#/project/p1/versions'), { view: 'project', id: 'p1', tab: 'versions' });
  assert.deepEqual(parseRoute('#/project/p1/docs'), { view: 'project', id: 'p1', tab: 'docs' });
  assert.deepEqual(parseRoute('#/task/t1'), { view: 'task', id: 't1' });
  assert.deepEqual(parseRoute('#/docs'), { view: 'docs' });
  assert.deepEqual(parseRoute('#/doc/d1'), { view: 'docs', id: 'd1' });
  assert.deepEqual(parseRoute('#/stats'), { view: 'time' });
  assert.deepEqual(parseRoute('#/settings'), { view: 'settings' });
});

test('статистика: режим — часть адреса, лишнее и незнакомое отбрасывается', () => {
  for (const mode of ['day', 'week', 'month', 'agenda']) {
    assert.deepEqual(parseRoute(`#/stats/${mode}`), { view: 'time', mode });
  }
  assert.deepEqual(parseRoute('#/stats/year'), { view: 'time' }, 'незнакомый режим — экран без режима');
  assert.deepEqual(parseRoute('#/stats/week/что-то'), { view: 'time', mode: 'week' });
});

test('старое имя #/time — тот же экран, что #/stats', () => {
  assert.deepEqual(parseRoute('#/time'), { view: 'time' });
  assert.deepEqual(parseRoute('#/time/month'), { view: 'time', mode: 'month' });
  assert.equal(buildRoute(parseRoute('#/time/month')), '#/stats/month', 'адрес заменяется на новый');
  assert.equal(buildRoute(parseRoute('#/time')), '#/stats');
});

test('вкладка проекта: незнакомая — список задач, «list» в адресе не пишется', () => {
  assert.deepEqual(parseRoute('#/project/p1/что-то'), { view: 'project', id: 'p1', tab: 'list' });
  assert.deepEqual(parseRoute('#/project/p1/list'), { view: 'project', id: 'p1', tab: 'list' });
  assert.equal(buildRoute({ view: 'project', id: 'p1', tab: 'list' }), '#/project/p1');
  assert.equal(buildRoute({ view: 'project', id: 'p1' }), '#/project/p1');
  assert.equal(buildRoute({ view: 'project', id: 'p1', tab: 'board' }), '#/project/p1/board');
  assert.equal(buildRoute({ view: 'project', id: 'p1', tab: 'нет-такой' }), '#/project/p1');
});

test('пустое и мусор — «Сегодня»', () => {
  for (const bad of [undefined, null, '', '#', '#/', '/', 'abc', '#abc', '#/unknown', '#/unknown/p1',
    '#/project', '#/project/', '#/task', '#/doc', '#//', '#?x=1', '#/%E0%A4%A', 42, {},
    '#/project/%E0%A4%A', '#/task/%', '#/doc/%ZZ']) {
    assert.deepEqual(parseRoute(bad), HOME, `«${String(bad)}» должен вести на «Сегодня»`);
  }
});

test('разбор терпим к мелочам: слэш на конце, регистр имени экрана, запрос после «?»', () => {
  assert.deepEqual(parseRoute('#/projects/'), { view: 'projects' });
  assert.deepEqual(parseRoute('/projects'), { view: 'projects' }, 'без решётки');
  assert.deepEqual(parseRoute('projects'), { view: 'projects' }, 'и без слэша');
  assert.deepEqual(parseRoute('#/Settings'), { view: 'settings' });
  assert.deepEqual(parseRoute('#/project/p1?utm=x'), { view: 'project', id: 'p1', tab: 'list' });
});

test('сборка: каждый экран в свой адрес', () => {
  assert.equal(buildRoute({ view: 'home' }), '#/today');
  assert.equal(buildRoute({ view: 'projects' }), '#/projects');
  assert.equal(buildRoute({ view: 'task', id: 't1' }), '#/task/t1');
  assert.equal(buildRoute({ view: 'docs' }), '#/docs');
  assert.equal(buildRoute({ view: 'docs', id: 'd1' }), '#/doc/d1');
  assert.equal(buildRoute({ view: 'time' }), '#/stats');
  assert.equal(buildRoute({ view: 'time', mode: 'agenda' }), '#/stats/agenda');
  assert.equal(buildRoute({ view: 'time', mode: 'year' }), '#/stats');
  assert.equal(buildRoute({ view: 'settings' }), '#/settings');
});

test('сборка не падает на пустом и чужом: «Сегодня» или список', () => {
  assert.equal(buildRoute(undefined), '#/today');
  assert.equal(buildRoute({}), '#/today');
  assert.equal(buildRoute({ view: 'calendar' }), '#/today', 'старые имена вида адресом не бывают');
  assert.equal(buildRoute({ view: 'task' }), '#/today', 'задача без id — «Сегодня»');
  assert.equal(buildRoute({ view: 'project' }), '#/projects', 'проект без id — список проектов');
});

test('идентификатор с любыми символами кодируется и возвращается тем же', () => {
  const ids = ['a/b', 'a#b', 'a?b', '100%', 'x y', 'пробел и кириллица', '../..', 'a&b=c', '😀', 'k:1', 'x%2Fy', "it's"];
  for (const id of ids) {
    for (const route of [
      { view: 'project', id, tab: 'board' }, { view: 'project', id, tab: 'list' },
      { view: 'task', id }, { view: 'docs', id },
    ]) {
      const hash = buildRoute(route);
      // Сегмент с id — третий (#, «project», id): в нём ни «/», ни «?», ни «#».
      const idSegment = hash.slice(2).split('/')[1];
      assert.ok(!/[\s#?]/.test(hash.slice(1)), `«${hash}»: в адресе остались сырые символы`);
      assert.equal(decodeURIComponent(idSegment), id, `«${hash}»: id рассыпался по сегментам`);
      assert.deepEqual(parseRoute(hash), route, `«${id}» не пережил круг через ${hash}`);
    }
  }
  assert.equal(buildRoute({ view: 'task', id: 'a/b' }), '#/task/a%2Fb');
});

test('routeKey: смена вкладки и режима — тот же экран, другой id — другой', () => {
  const same = (a, b) => routeKey(a) === routeKey(b);
  assert.ok(same({ view: 'project', id: 'p1', tab: 'list' }, { view: 'project', id: 'p1', tab: 'board' }));
  assert.ok(same({ view: 'time', mode: 'week' }, { view: 'time', mode: 'month' }));
  assert.ok(!same({ view: 'project', id: 'p1' }, { view: 'project', id: 'p2' }));
  assert.ok(!same({ view: 'project', id: 'p1' }, { view: 'task', id: 'p1' }), 'проект и задача с одним id — разные экраны');
  assert.ok(!same({ view: 'docs' }, { view: 'docs', id: 'd1' }));
  assert.ok(!same({ view: 'home' }, { view: 'settings' }));
  assert.equal(routeKey(undefined), 'home:');
});

test('routeLink: адрес приложения без прежнего хэша и маршрут за ним', () => {
  const r = { view: 'project', id: 'p1' };
  assert.equal(routeLink('https://lancible.vercel.app/app/', r), 'https://lancible.vercel.app/app/#/project/p1');
  assert.equal(routeLink('http://localhost:5173/#/settings', r), 'http://localhost:5173/#/project/p1');
  assert.equal(routeLink('https://lancible.vercel.app/app/', { view: 'task', id: 'a b' }), 'https://lancible.vercel.app/app/#/task/a%20b');
});

test('lancible://: проект, задача и документ открываются, вход и неизвестное — нет', () => {
  assert.deepEqual(deepLinkRoute('lancible://project/p1'), { view: 'project', id: 'p1', tab: 'list' });
  assert.deepEqual(deepLinkRoute('lancible://project/p1/board'), { view: 'project', id: 'p1', tab: 'board' });
  assert.deepEqual(deepLinkRoute('lancible://task/t1'), { view: 'task', id: 't1' });
  assert.deepEqual(deepLinkRoute('lancible://doc/d1'), { view: 'docs', id: 'd1' });
  assert.deepEqual(deepLinkRoute('lancible://project/a%2Fb'), { view: 'project', id: 'a/b', tab: 'list' });
  assert.deepEqual(deepLinkRoute('LANCIBLE://Project/Abc/'), { view: 'project', id: 'Abc', tab: 'list' }, 'регистр id сохраняется');
  assert.deepEqual(deepLinkRoute('lancible:project/p1'), { view: 'project', id: 'p1', tab: 'list' }, 'без «//»');
  assert.deepEqual(deepLinkRoute('lancible://project/p1?x=1#y'), { view: 'project', id: 'p1', tab: 'list' });

  assert.equal(deepLinkRoute('lancible://auth-callback?code=abc'), null, 'вход через Google — не маршрут');
  for (const bad of ['lancible://', 'lancible://garbage', 'lancible://project', 'lancible://project/', 'lancible://task',
    'https://lancible.vercel.app/app/#/project/p1', '', null, undefined, 'project/p1']) {
    assert.equal(deepLinkRoute(bad), null, `«${String(bad)}» не должен открывать экран`);
  }
});

test('isAuthHash: токены входа в хэше — не маршрут, и затирать их нельзя', () => {
  assert.ok(isAuthHash('#access_token=abc&refresh_token=def&type=recovery'));
  assert.ok(isAuthHash('#error=access_denied&error_description=oops'));
  assert.ok(isAuthHash('#error_code=otp_expired'));
  assert.ok(!isAuthHash('#/project/p1'));
  assert.ok(!isAuthHash(''));
  assert.ok(!isAuthHash(undefined));
  assert.ok(!isAuthHash('#abc'));
});

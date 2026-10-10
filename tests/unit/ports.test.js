// Порты браузерных прогонов у каждой копии свои. Запуск: npm run test:unit
//
// Зачем. Копий репозитория несколько (C:\…\task-timer у Publish и
// E:\lancible\<папка> у остальных сессий), и пока порты были одни на всех,
// прогон из одной копии подхватывал сервер другой и проверял её код. Здесь —
// что порты вычисляются от пути, у известных копий не совпадают и что
// Playwright не переиспользует чужой сервер. Что сервер под тестом отдаёт
// файлы именно этой копии, проверяют tests/e2e/server-identity.spec.js и
// tests/landing/server-identity.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ports = require('../ports');

const { portsFor, FIRST, SLOTS } = ports;

// Копии из регламента (CLAUDE.md → «Где кто работает»).
const COPIES = [
  'C:/Users/Turan/Documents/task-timer',
  ...['web', 'mobile', 'core', 'gfx', 'qa-web', 'qa-mobile', 'legal'].map((d) => `E:/lancible/${d}`),
];

const portList = (p) => [p.run.PORT_WEB, p.run.PORT_LANDING, p.watch.PORT_WEB, p.watch.PORT_LANDING];

test('у одной папки порты всегда одни и те же', () => {
  assert.deepEqual(portsFor('E:/lancible/qa-web'), portsFor('E:/lancible/qa-web'));
});

test('у копий из регламента порты прибиты — одинаково на Windows и на Linux', () => {
  // Числа сняты на Windows 10 октября 2026. Путь с буквой диска
  // разбирается правилами Windows на любой платформе, поэтому и в CI на
  // Linux порты обязаны совпасть. Поменялись — значит, у всех копий
  // съехали порты, и браузерные прогоны снова могут встретить чужой сервер.
  const expected = {
    'C:/Users/Turan/Documents/task-timer': 25116,
    'E:/lancible/web': 22024,
    'E:/lancible/mobile': 32632,
    'E:/lancible/core': 26764,
    'E:/lancible/gfx': 27580,
    'E:/lancible/qa-web': 20100,
    'E:/lancible/qa-mobile': 26588,
    'E:/lancible/legal': 22516,
  };
  for (const [root, port] of Object.entries(expected)) {
    assert.equal(portsFor(root).run.PORT_WEB, port, `${root}: порт сдвинулся`);
    assert.equal(portsFor(root.replace(/\//g, '\\')).run.PORT_WEB, port, `${root} с обратными слэшами: порт сдвинулся`);
  }
});

test('регистр букв и вид слэшей на Windows порты не меняют', () => {
  assert.deepEqual(portsFor('E:\\lancible\\qa-web\\'), portsFor('e:/Lancible/QA-WEB'));
});

test('у каждой копии из регламента свои четыре порта, ни один не общий', () => {
  const seen = new Map();
  for (const root of COPIES) {
    const own = portList(portsFor(root));
    assert.equal(new Set(own).size, 4, `${root}: порты внутри копии совпали`);
    for (const port of own) {
      assert.ok(!seen.has(port), `${root} и ${seen.get(port)} делят порт ${port} — задайте LANCIBLE_TEST_PORT_BASE одной из них`);
      seen.set(port, root);
    }
  }
});

test('порты в своём диапазоне, в стороне от разработки, Metro и резерва Windows', () => {
  const busy = new Set([5173, 5174, 8081, 5357]);
  for (const root of [...COPIES, '/home/runner/work/Lancible/Lancible']) {
    for (const port of portList(portsFor(root))) {
      assert.ok(port >= FIRST && port < FIRST + SLOTS * 4, `${root}: порт ${port} вне диапазона`);
      assert.ok(!busy.has(port), `${root}: порт ${port} занят другим`);
      assert.ok(port < 50000 || port > 50059, `${root}: порт ${port} в резерве Windows`);
    }
  }
});

test('сторож и ручной прогон на разных парах', () => {
  const p = portsFor('E:/lancible/qa-web');
  assert.notEqual(p.run.PORT_WEB, p.watch.PORT_WEB);
  assert.notEqual(p.run.PORT_LANDING, p.watch.PORT_LANDING);
});

test('порты этой копии вычислены от её собственного пути', () => {
  if (process.env.LANCIBLE_TEST_PORT_BASE) return; // задано руками — сверять не с чем
  const mine = portsFor(path.join(__dirname, '..', '..'));
  const expected = process.env.LANCIBLE_TEST_PORTS === 'watch' ? mine.watch : mine.run;
  assert.deepEqual({ PORT_WEB: ports.PORT_WEB, PORT_LANDING: ports.PORT_LANDING }, expected);
});

test('LANCIBLE_TEST_PORT_BASE задаёт начало вручную', () => {
  assert.deepEqual(portsFor('E:/x', { base: 30000 }), {
    run: { PORT_WEB: 30000, PORT_LANDING: 30001 },
    watch: { PORT_WEB: 30002, PORT_LANDING: 30003 },
  });
});

test('Playwright поднимает свои серверы на портах копии и чужой не переиспользует', () => {
  const config = require('../../playwright.config.js');
  const servers = config.webServer;
  assert.equal(servers.length, 2);
  for (const s of servers) {
    assert.equal(s.reuseExistingServer, false, `${s.command}: переиспользует уже поднятый сервер — может оказаться чужим`);
  }
  assert.match(servers[0].url, new RegExp(`:${ports.PORT_WEB}/`));
  assert.match(servers[1].url, new RegExp(`:${ports.PORT_LANDING}/`));
  for (const p of config.projects) {
    const port = p.name === 'web' ? ports.PORT_WEB : ports.PORT_LANDING;
    assert.equal(p.use.baseURL, `http://localhost:${port}`, `${p.name}: baseURL не на портах этой копии`);
  }
});

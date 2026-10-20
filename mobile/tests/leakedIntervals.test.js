// Сторож протекающих интервалов (tests/support/leakedIntervals.js).
//
// 20 октября 2026 опрос синхронизации, запущенный одним тестовым файлом,
// сработал через 60 с посреди другого (tests/skeleton.test.js) — модули
// первого уже выгружены, AppState undefined, тест красный. Теперь каждый
// файл после своих тестов снимает оставленные интервалы (jest.after-env.js).
const fs = require('fs');
const path = require('path');
const { track } = require('./support/leakedIntervals');

function fakeScope() {
  let next = 1;
  const running = new Set();
  return {
    running,
    setInterval: jest.fn(() => { const id = next++; running.add(id); return id; }),
    clearInterval: jest.fn((id) => { running.delete(id); }),
  };
}

test('оставленные интервалы снимаются, снятые файлом — не трогаются второй раз', () => {
  const scope = fakeScope();
  const t = track(scope);
  const a = scope.setInterval(() => {}, 60000);
  const b = scope.setInterval(() => {}, 1000);
  scope.clearInterval(b);
  expect(t.size()).toBe(1);
  expect(scope.running).toEqual(new Set([a]));

  t.clearAll();
  expect(scope.running.size).toBe(0);
  expect(t.size()).toBe(0);
  t.restore();
});

test('restore возвращает исходные setInterval и clearInterval', () => {
  const scope = fakeScope();
  const { setInterval: realSet, clearInterval: realClear } = scope;
  const t = track(scope);
  expect(scope.setInterval).not.toBe(realSet);
  t.restore();
  expect(scope.setInterval).toBe(realSet);
  expect(scope.clearInterval).toBe(realClear);
});

test('подключено к каждому файлу: setupFilesAfterEnv — jest.after-env.js, а он снимает интервалы после всех тестов', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  expect(pkg.jest.setupFilesAfterEnv).toContain('<rootDir>/jest.after-env.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'jest.after-env.js'), 'utf8');
  expect(src).toMatch(/track\(global\)/);
  expect(src).toMatch(/afterAll\(\(\) => intervals\.clearAll\(\)\)/);
});

test('в этом файле интервалы отслеживаются: global.setInterval — обёртка', () => {
  expect(global.setInterval.name).toBe('setIntervalTracked');
});

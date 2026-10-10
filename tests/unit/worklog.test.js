// Журнал работы: повторная отправка не задваивает события, очередь не в git.
// Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { stamp, missingEvents, validate } = require('../../scripts/worklog.js');

const ROOT = path.resolve(__dirname, '../..');

test('stamp ставит время только событиям без него и одно на всю запись', () => {
  const payload = {
    task: { id: 't', title: 'T' },
    events: [{ kind: 'change', title: 'а' }, { kind: 'fix', title: 'б', at: '2026-10-01T00:00:00.000Z' }],
  };
  const out = stamp(payload, '2026-10-10T12:00:00.000Z');
  assert.equal(out.events[0].at, '2026-10-10T12:00:00.000Z');
  assert.equal(out.events[1].at, '2026-10-01T00:00:00.000Z');
  assert.equal(payload.events[0].at, undefined, 'исходная запись не меняется');
  assert.deepEqual(stamp({ task: { id: 't', title: 'T' } }).events, []);
});

test('missingEvents: событие с временем узнаётся по виду, заголовку и моменту', () => {
  // Postgres отдаёт момент в своём формате — сравнение не по строке.
  const existing = [{ kind: 'check', title: 'Тесты зелёные', detail: null, at: '2026-10-10T12:00:00+00:00' }];
  const sent = { kind: 'check', title: 'Тесты зелёные', at: '2026-10-10T12:00:00.000Z' };
  assert.deepEqual(missingEvents([sent], existing), [], 'ответ потерялся — повтор ничего не пишет');

  const later = { kind: 'check', title: 'Тесты зелёные', at: '2026-10-10T15:00:00.000Z' };
  assert.deepEqual(missingEvents([later], existing), [later], 'то же событие в другой момент — новое');
  const otherKind = { kind: 'fix', title: 'Тесты зелёные', at: '2026-10-10T12:00:00.000Z' };
  assert.deepEqual(missingEvents([otherKind], existing), [otherKind]);
});

test('missingEvents: старая запись без времени узнаётся по виду, заголовку и подробностям', () => {
  const existing = [{ kind: 'change', title: 'Колонки', detail: 'Три вместо двух', at: '2026-10-09T13:42:00+00:00' }];
  assert.deepEqual(missingEvents([{ kind: 'change', title: 'Колонки', detail: 'Три вместо двух' }], existing), []);
  const changed = { kind: 'change', title: 'Колонки', detail: 'Четыре' };
  assert.deepEqual(missingEvents([changed], existing), [changed]);
  assert.deepEqual(missingEvents([{ kind: 'change', title: 'Колонки', detail: null }],
    [{ kind: 'change', title: 'Колонки', detail: null, at: '2026-10-09T00:00:00+00:00' }]), [], 'null и пусто совпадают');
});

test('очередь и архив журнала не лежат в git', () => {
  const tracked = execFileSync('git', ['ls-files', 'logs'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(tracked, '', `в git остались: ${tracked}`);
  for (const file of ['logs/pending.jsonl', 'logs/sent.jsonl']) {
    // check-ignore выходит с кодом 1, если файл не игнорируется.
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: ROOT, stdio: 'ignore' }),
      `${file} должен быть в .gitignore`);
  }
});

// 10 октября 2026 запись с выдуманным title затёрла названия трёх задач:
// задача обновляется по id. Для заведённой задачи title можно не слать —
// тогда send() обновляет только присланные поля, а без задачи отказывает.
test('validate: id обязателен, title — только при заведении задачи', () => {
  assert.throws(() => validate({ task: { title: 'Без id' } }), /нужен task\.id/);
  assert.doesNotThrow(() => validate({ task: { id: 'x-1', status: 'review' }, events: [] }));
  assert.throws(() => validate({ task: { id: 'Не слаг' } }), /слагом/);
});

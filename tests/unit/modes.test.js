// Режимы использования — core/modes.js. Запуск: npm run test:unit
//
// Правило одно на три поверхности: что прячет «личное», что — выключенный
// таймер, и что переключатель заработка не действует без денег.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES, DEFAULT_MODE, normalizeMode, modeFlags } = require('../../src/renderer/core/modes.js');

test('умолчание — фрилансер со всем включённым', () => {
  assert.equal(DEFAULT_MODE, 'freelance');
  assert.deepEqual(modeFlags(undefined), { mode: 'freelance', money: true, timer: true, earnings: true });
  assert.deepEqual(modeFlags({}), { mode: 'freelance', money: true, timer: true, earnings: true });
});

test('незнакомый режим — умолчание', () => {
  assert.equal(normalizeMode('business'), 'freelance');
  assert.equal(normalizeMode(null), 'freelance');
  for (const m of MODES) assert.equal(normalizeMode(m), m);
});

test('«личное» прячет деньги целиком, и переключатель заработка не действует', () => {
  const f = modeFlags({ mode: 'personal', showEarnings: true });
  assert.equal(f.money, false);
  assert.equal(f.earnings, false, 'заработок без денег не бывает');
  assert.equal(f.timer, true, 'таймер от режима не зависит');
});

test('таймер и заработок выключаются по отдельности у фрилансера', () => {
  assert.deepEqual(modeFlags({ showTimer: false }), { mode: 'freelance', money: true, timer: false, earnings: true });
  assert.deepEqual(modeFlags({ showEarnings: false }), { mode: 'freelance', money: true, timer: true, earnings: false });
});

test('флаги — только булевы: строка "false" из старых настроек не считается выключением', () => {
  // showTimer хранится как boolean; всё, что не строго false, — включено,
  // иначе перенос настроек между версиями мог бы молча спрятать таймер.
  assert.equal(modeFlags({ showTimer: 'false' }).timer, true);
  assert.equal(modeFlags({ showTimer: 0 }).timer, true);
});

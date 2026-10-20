// Подключается к каждому тестовому файлу после jest (setupFilesAfterEnv).
//
// Интервалы, которые файл не снял сам, снимаются после всех его тестов —
// иначе они тикают дальше и срабатывают посреди следующего файла, уже без
// своих модулей (tests/support/leakedIntervals.js).
const { track } = require('./tests/support/leakedIntervals');

const intervals = track(global);
afterAll(() => intervals.clearAll());

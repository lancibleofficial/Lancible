// Снимки не зависят от машины, на которой их сняли. Запуск: npm run test:unit
//
// С 10 октября 2026 язык лендинга берётся из браузера. Без закреплённой
// локали эталон, снятый на русской системе, не совпадал бы с прогоном на
// английской (и наоборот) — снимки краснели бы не от правок вида.
const test = require('node:test');
const assert = require('node:assert/strict');

test('у визуального набора закреплена локаль', () => {
  const config = require('../../playwright.config.js');
  const visual = config.projects.find((p) => p.name === 'visual');
  assert.ok(visual, 'нет проекта visual');
  assert.equal(visual.use.locale, 'ru-RU', 'снимки сняты на русском — основном языке сайта');
});

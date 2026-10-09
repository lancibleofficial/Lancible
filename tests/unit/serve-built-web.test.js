// Веб собирается перед браузерными прогонами. Запуск: npm run test:unit
//
// tests/serve-built-web.js собирает web/ и только потом поднимает сервер.
// Здесь — что Playwright зовёт именно его и что неполная или старая сборка
// распознаётся, а не уезжает в прогон.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REQUIRED, missingBuildFiles, staleBuildFiles } = require('../serve-built-web.js');

test('сервер веба в Playwright собирает web/ перед подъёмом', () => {
  const config = require('../../playwright.config.js');
  const web = config.webServer.find((s) => /index\.html$/.test(s.url) && !/--root landing/.test(s.command));
  assert.ok(web, 'не нашёл webServer веба');
  assert.match(web.command, /^node tests\/serve-built-web\.js \d+$/, 'веб поднимается без сборки — прогон проверит старый web/');
  assert.ok(web.timeout >= 120_000, 'таймаут мал: в свежей копии сначала ставятся web/node_modules');
});

test('без vendor/supabase.js сборка считается неполной', () => {
  assert.ok(REQUIRED.includes('vendor/supabase.js'), 'без supabase.js app.js падает на старте — это должно ронять подготовку');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-web-'));
  for (const f of REQUIRED.filter((x) => x !== 'vendor/supabase.js')) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  assert.deepEqual(missingBuildFiles(dir), ['vendor/supabase.js']);
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor', 'supabase.js'), 'x');
  assert.deepEqual(missingBuildFiles(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web/app.js от прошлой сборки распознаётся как старый', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-root-'));
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  put('src/renderer/app.js', 'новый');
  put('src/renderer/styles.css', 'стили');
  put('web/app.js', 'старый');
  put('web/styles.css', 'стили');
  assert.deepEqual(staleBuildFiles(dir), ['web/app.js']);
  put('web/app.js', 'новый');
  assert.deepEqual(staleBuildFiles(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

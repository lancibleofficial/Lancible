// Шрифты рендерера — точное зеркало assets/fonts. Запуск: npm run test:unit
//
// copy-vendor.js раньше только докладывал файлы, и убранное начертание
// (Basique Pro, 10 октября 2026 — лицензии нет) оставалось в
// src/renderer/vendor/fonts и уезжало в установщик десктопа.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const vendorFonts = path.join(ROOT, 'src', 'renderer', 'vendor', 'fonts');
const assetFonts = path.join(ROOT, 'assets', 'fonts');

test('copy-vendor оставляет в vendor/fonts ровно то, что лежит в assets/fonts', () => {
  fs.mkdirSync(vendorFonts, { recursive: true });
  fs.writeFileSync(path.join(vendorFonts, 'Removed-Long-Ago.woff2'), '');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'copy-vendor.js')], { cwd: ROOT, stdio: 'ignore' });
  const woff2 = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith('.woff2')).sort();
  assert.deepEqual(woff2(vendorFonts), woff2(assetFonts));
});

test('copy-vendor не читает личную папку font/', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-vendor.js'), 'utf8');
  assert.doesNotMatch(src, /path\.join\(root, 'font'\)/);
});

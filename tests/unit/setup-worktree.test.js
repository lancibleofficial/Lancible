// Заведение копии репозитория: то, что можно проверить без сети и без npm.
// Сам прогон проверяется заведением настоящей копии (см. журнал
// 2026-10-10-worktree-setup). Запуск: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { platformPath, needsMobile, zipTool } = require('../../scripts/setup-worktree.js');

test('путь к Electron в dist — как пишет electron/install.js', () => {
  assert.equal(platformPath('win32'), 'electron.exe');
  assert.equal(platformPath('darwin'), 'Electron.app/Contents/MacOS/Electron');
  assert.equal(platformPath('linux'), 'electron');
  // Сверка с самим пакетом: разойдёмся с ним — Electron не найдётся.
  const install = fs.readFileSync(path.join(__dirname, '../../node_modules/electron/install.js'), 'utf8');
  for (const p of ['electron.exe', 'Electron.app/Contents/MacOS/Electron']) assert.ok(install.includes(`'${p}'`), p);
});

test('зависимости телефона — ролям mobile, qa-mobile и core, флаг сильнее', () => {
  assert.equal(needsMobile('mobile/start'), true);
  assert.equal(needsMobile('qa-mobile/x'), true);
  assert.equal(needsMobile('core/x'), true);
  assert.equal(needsMobile('web/x'), false);
  assert.equal(needsMobile(''), false);
  assert.equal(needsMobile('web/x', ['--mobile']), true);
  assert.equal(needsMobile('core/x', ['--no-mobile']), false);
});

test('zip распаковывает bsdtar, а не GNU tar из Git Bash', () => {
  assert.match(zipTool('win32'), /System32[\\/]tar\.exe$/);
  assert.equal(zipTool('darwin'), '/usr/bin/tar');
  assert.equal(zipTool('linux'), null);
});

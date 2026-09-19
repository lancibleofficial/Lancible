// Включает крюки git из папки .githooks. Запускается сам на `npm install`
// (скрипт prepare), поэтому отдельно вызывать не нужно.
//
// Крюки лежат в репозитории, а не в .git/hooks: папку .git не клонируют, и
// крюк, положенный туда руками, живёт только на одной машине.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// В архиве без .git (сборка на Vercel, распакованный tarball) делать нечего.
if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('[setup-hooks] не репозиторий git — пропускаю');
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'pipe' });
  console.log('[setup-hooks] крюки включены: .githooks');
} catch (err) {
  // Не повод ронять установку: без крюка всё равно есть проверка в CI.
  console.warn('[setup-hooks] не удалось включить крюки:', err.message);
}

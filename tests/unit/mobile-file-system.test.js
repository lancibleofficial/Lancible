// Телефон и expo-file-system: из корня пакета — только классы.
// Запуск: npm run test:unit
//
// Откуда взялось. С SDK 54 функции в корне expo-file-system (deleteAsync,
// createDownloadResumable, getContentUriAsync, cacheDirectory…) оставлены
// только затем, чтобы бросать ошибку на вызове: старый API переехал в
// expo-file-system/legacy, новый — классы File, Directory, Paths. Импорт при
// этом проходит, сборка собирается, и падает только нажатие. Так встроенное
// обновление APK не работало с 1.1.1 по 1.2.0 — во всех трёх выпусках.
//
// Здесь правило на все исходники телефона разом: из корня берём только
// новый API, а «import * as FileSystem» запрещён — через него любой старый
// вызов снова пройдёт незамеченным. Список разрешённого — то, что корень
// пакета экспортирует, кроме legacyWarnings (src/index.ts в SDK 57).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MOBILE = path.join(__dirname, '..', '..', 'mobile');
const ALLOWED = new Set([
  'File', 'Directory', 'Paths', 'DownloadTask', 'UploadTask',
  'EncodingType', 'FileMode', 'UploadType', 'DEFAULT_DEBOUNCE_MS',
]);

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('из корня expo-file-system телефон берёт только классы нового API', () => {
  const files = [...sources(path.join(MOBILE, 'src')), path.join(MOBILE, 'App.js')];
  const bad = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(MOBILE, file).replace(/\\/g, '/');
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]expo-file-system['"]/g)) {
      const clause = m[1].trim();
      if (/\*\s+as\s+/.test(clause)) { bad.push(`${rel}: import ${clause}`); continue; }
      const names = (clause.match(/\{([^}]*)\}/) || [, ''])[1]
        .split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean);
      for (const name of names) if (!ALLOWED.has(name)) bad.push(`${rel}: ${name}`);
    }
    if (/require\(\s*['"]expo-file-system['"]\s*\)/.test(src)) bad.push(`${rel}: require('expo-file-system')`);
  }
  assert.deepEqual(bad, [], 'старый API — из expo-file-system/legacy, а лучше File/Directory/Paths');
});

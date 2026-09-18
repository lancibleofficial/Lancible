// Заливает собранные артефакты релиза (Windows: .exe/.exe.blockmap/latest.yml;
// macOS: .dmg/.zip/.zip.blockmap/latest-mac.yml — какие есть, те и заливаются)
// в публичный Supabase Storage bucket "releases" — оттуда их скачивает
// electron-updater на обеих платформах. Это ОТДЕЛЬНЫЙ канал от страницы
// релизов на GitHub: там ссылки для новых пользователей, здесь — фид
// обновлений для уже установленных копий.
//
// Обычно запускается не руками, а последним шагом .github/workflows/release.yml
// по тегу v*: там уже собраны обе платформы, и локальная машина не нужна.
// Вручную — после npm run build:exe и/или npm run build:dmg:
//   npm run publish:release            # берёт файлы из dist/
//   node scripts/publish-release.js X  # или из любой другой папки
//
// Нужны переменные окружения (локально проще всего — файл .env рядом с
// package.json, НЕ коммитить; в CI — секрет репозитория):
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...   ← полный доступ на запись, не светить
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'releases';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY — задай их в .env (см. комментарий в начале файла) или в переменных окружения.');
  process.exit(1);
}

async function upload(filePath, destName) {
  const body = fs.readFileSync(filePath);
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${destName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'x-upsert': 'true',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  if (!res.ok) throw new Error(`${destName}: ${res.status} ${await res.text()}`);
  console.log('uploaded:', destName);
}

// latest.yml/latest-mac.yml — манифесты, по которым electron-updater находит
// файл для скачивания на каждой платформе; должны заливаться последними,
// чтобы клиент не увидел ссылку на ещё не залитый инсталлятор/архив.
const RELEASE_EXTENSIONS = ['.exe', '.exe.blockmap', '.dmg', '.dmg.blockmap', '.zip', '.zip.blockmap'];
const MANIFEST_NAMES = ['latest.yml', 'latest-mac.yml'];
const isManifest = (f) => MANIFEST_NAMES.includes(f);
const isReleaseFile = (f) => isManifest(f) || RELEASE_EXTENSIONS.some((ext) => f.endsWith(ext));

// Обход в глубину: локально файлы лежат прямо в dist/, а в CI — в
// подпапках, по одной на платформу (actions/download-artifact кладёт каждый
// артефакт отдельно). В бакет всё попадает плоско, под своим именем:
// именно эти имена записаны в latest.yml, по ним обновлятор и скачивает.
function collect(dir, found = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collect(full, found); continue; }
    if (!isReleaseFile(entry.name)) continue;
    const prev = found.get(entry.name);
    if (prev && prev !== full) {
      console.error(`Два файла с именем ${entry.name}: ${prev} и ${full}`);
      process.exit(1);
    }
    found.set(entry.name, full);
  }
  return found;
}

async function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'dist');
  const hint = 'сначала npm run build:exe и/или npm run build:dmg';
  if (!fs.existsSync(root)) {
    console.error(`Нет папки ${root} — ${hint}`);
    process.exit(1);
  }
  const found = collect(root);
  if (!found.size) {
    console.error(`В ${root} нет файлов релиза — ${hint}`);
    process.exit(1);
  }
  // Манифесты — последними, чтобы клиент не увидел ссылку на ещё не залитый файл.
  const names = [...found.keys()].sort((a, b) => Number(isManifest(a)) - Number(isManifest(b)));
  for (const name of names) await upload(found.get(name), name);
  console.log('Готово:', `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`);
}
main().catch((err) => { console.error(err); process.exit(1); });

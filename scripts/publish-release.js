// Заливает собранные dist/*.exe (+ .blockmap, latest.yml) в публичный Supabase
// Storage bucket "releases" — оттуда их скачивает electron-updater. Запуск
// после npm run build:exe:
//   npm run publish:release
//
// Нужны переменные окружения (проще всего — файл .env рядом с package.json,
// НЕ коммитить: service_role-ключ даёт полный доступ на запись):
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...
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

async function main() {
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('Нет папки dist/ — сначала npm run build:exe');
    process.exit(1);
  }
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.exe') || f.endsWith('.exe.blockmap') || f === 'latest.yml');
  if (!files.length) {
    console.error('В dist/ нет файлов релиза — сначала npm run build:exe');
    process.exit(1);
  }
  // latest.yml — последним, чтобы клиенты не увидели ссылку на ещё не залитый инсталлятор.
  files.sort((a, b) => (a === 'latest.yml') - (b === 'latest.yml'));
  for (const f of files) await upload(path.join(distDir, f), f);
  console.log('Готово:', `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`);
}
main().catch((err) => { console.error(err); process.exit(1); });

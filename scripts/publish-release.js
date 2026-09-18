// Наполняет фид автообновления в публичном Supabase Storage bucket "releases":
// оттуда electron-updater в уже установленных копиях узнаёт о новой версии.
// Это ОТДЕЛЬНЫЙ канал от страницы релизов на GitHub — там ссылки для новых
// пользователей, здесь фид для существующих.
//
// ВАЖНО, откуда такая схема. Установщики весят под 80 МБ (Windows) и 174 МБ
// (macOS), а Supabase Storage отклоняет такие файлы: 413 EntityTooLarge.
// Поэтому с ключом --release-base в хранилище уезжают ТОЛЬКО манифесты
// (latest.yml и latest-mac.yml, сотни байт), а ссылки внутри них переписываются
// на ассеты релиза GitHub, который раздаёт большие файлы без ограничений.
// electron-updater это поддерживает: абсолютный url в манифесте перекрывает
// базовый адрес из build.publish.
//
// Почему манифест всё-таки лежит в хранилище, а не берётся прямо с GitHub:
// в этом репозитории релизы общие для всех платформ, и тег mobile-* регулярно
// оказывается свежее десктопного. Адрес «последнего релиза» тогда уводил бы
// обновлятор на сборку, где никакого latest.yml нет. Бакет же всегда описывает
// именно актуальную десктопную версию.
//
// Обычно запускается не руками, а последним шагом .github/workflows/release.yml
// по тегу v*. Вручную — после npm run build:exe и/или npm run build:dmg:
//   npm run publish:release      # всё из dist/ целиком, для своего хостинга
//   node scripts/publish-release.js artifacts --release-base <URL релиза>
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

// GitHub при загрузке ассета заменяет всё, что вне [A-Za-z0-9._-], на точку:
// «Lancible Setup 0.2.1.exe» превращается в «Lancible.Setup.0.2.1.exe», и
// только по второму имени файл отдаётся. Проверено запросом: форма с
// пробелами и форма с дефисами обе дают 404.
const githubAssetName = (name) => name.replace(/[^A-Za-z0-9._-]/g, '.');

// Переписывает в манифесте ссылки на файлы с голых имён на абсолютные адреса
// ассетов релиза. Трогает поля url (внутри files) и path (легаси-поле для
// старых клиентов); sha512 и size остаются как есть, они и проверяют,
// что скачалось именно то. Значение, уже являющееся ссылкой, не трогаем.
function rewriteManifest(text, releaseBase) {
  const base = releaseBase.replace(/\/+$/, '');
  return text.replace(
    /^(\s*(?:-\s+)?(?:url|path):[ \t]*)(\S.*?)[ \t]*$/gm,
    (line, head, value) => {
      if (/^(https?:)?\/\//i.test(value)) return line;
      return `${head}${base}/${githubAssetName(value)}`;
    },
  );
}

async function upload(filePath, destName, body = fs.readFileSync(filePath)) {
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
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--release-base');
  const releaseBase = baseIdx === -1 ? null : args[baseIdx + 1];
  if (baseIdx !== -1 && !releaseBase) {
    console.error('--release-base указан без значения');
    process.exit(1);
  }
  const dirArg = args.find((a, i) => !a.startsWith('--') && i !== baseIdx + 1);

  const root = dirArg ? path.resolve(dirArg) : path.join(__dirname, '..', 'dist');
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

  if (releaseBase) {
    // Большие файлы уже лежат в релизе GitHub — в бакет уходят только
    // манифесты со ссылками на них.
    const manifests = [...found.keys()].filter(isManifest);
    if (!manifests.length) {
      console.error(`В ${root} нет ни latest.yml, ни latest-mac.yml — заливать нечего`);
      process.exit(1);
    }
    for (const name of manifests) {
      const text = rewriteManifest(fs.readFileSync(found.get(name), 'utf8'), releaseBase);
      console.log(`--- ${name} ---\n${text}`);
      await upload(found.get(name), name, Buffer.from(text, 'utf8'));
    }
  } else {
    // Манифесты последними, чтобы клиент не увидел ссылку на ещё не залитый файл.
    const names = [...found.keys()].sort((a, b) => Number(isManifest(a)) - Number(isManifest(b)));
    for (const name of names) await upload(found.get(name), name);
  }
  console.log('Готово:', `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`);
}
main().catch((err) => { console.error(err); process.exit(1); });

// Наполняет фид автообновления в публичном Supabase Storage bucket "releases":
// оттуда electron-updater в уже установленных копиях узнаёт о новой версии.
// Это ОТДЕЛЬНЫЙ канал от страницы релизов на GitHub — там ссылки для новых
// пользователей, здесь фид для существующих.
//
// ВАЖНО, откуда такая схема. Установщики весят под 80 МБ (Windows) и 180 МБ
// (macOS), а Supabase Storage отклоняет такие файлы: 413 EntityTooLarge.
// Поэтому с ключом --release-base в хранилище уезжают ТОЛЬКО манифесты
// (latest.yml и latest-mac.yml, сотни байт), а ссылки внутри них переписываются
// на адрес --release-base — туда, где лежат сами файлы. electron-updater это
// поддерживает: абсолютный url в манифесте перекрывает базовый адрес из
// build.publish.
//
// Где лежат сами файлы. Раздаёт их Cloudflare R2 (публичный адрес r2.dev
// бакета): GitHub Releases при замере 10 октября 2026 отдавал пользователю
// около 19 КБ/с, и обновление в 82 МБ качалось больше часа; Cloudflare в тот
// же день — 18 МБ/с. GitHub Releases остаются архивом и запасным вариантом:
// без секретов R2 workflow по-прежнему переписывает ссылки на них.
//
// Раскладка в R2 — та же, что у GitHub: <R2_PUBLIC_URL>/v<версия>/<имя файла>
// (у GitHub — .../releases/download/v<версия>/<имя файла>). Это не вкус:
// electron-updater находит блокмап прошлой версии для дифференциальной
// загрузки, подставляя старый номер версии в адрес нового файла, поэтому
// версия в адресе должна встречаться так же, как в имени.
//
// Почему манифест всё-таки лежит в хранилище, а не берётся прямо с GitHub:
// в этом репозитории релизы общие для всех платформ, и тег mobile-* регулярно
// оказывается свежее десктопного. Адрес «последнего релиза» тогда уводил бы
// обновлятор на сборку, где никакого latest.yml нет. Бакет же всегда описывает
// именно актуальную десктопную версию.
//
// Три режима, каждый — отдельным вызовом:
//   --stage <папка>        разложить файлы релиза (без манифестов) под теми
//                          именами, что записаны в ссылках; ключи Supabase не
//                          нужны. Папку workflow потом заливает в R2 через
//                          aws s3 cp.
//   --release-base <URL>   залить в Supabase только манифесты, переписав в них
//                          ссылки на <URL>/<имя файла>. С --check-urls перед
//                          этим каждая ссылка проверяется запросом HEAD (файл
//                          отвечает 200 и нужного размера): иначе фид указал бы
//                          в пустоту, если файлы не доехали или публичный адрес
//                          бакета не включён.
//   без ключей             залить всё из папки как есть, для своего хостинга.
//
// Обычно запускается не руками, а .github/workflows/release.yml по тегу v* и
// .github/workflows/mirror-release.yml (перевод уже вышедшего релиза на R2).
// Вручную — после npm run build:exe и/или npm run build:dmg:
//   npm run publish:release      # всё из dist/ целиком, для своего хостинга
//   node scripts/publish-release.js artifacts --release-base <URL> --check-urls
//
// Нужны переменные окружения (локально проще всего — файл .env рядом с
// package.json, НЕ коммитить; в CI — секрет репозитория); для --stage не нужны:
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

const BUCKET = 'releases';
let SUPABASE_URL;
let SERVICE_KEY;

// Ключи нужны только тем режимам, что пишут в Supabase, и читаются не при
// загрузке файла: тест подключает скрипт ради функций ниже, и .env разработчика
// с настоящим ключом ему ни к чему.
function requireSupabase() {
  loadEnvFile();
  SUPABASE_URL = process.env.SUPABASE_URL;
  SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY — задай их в .env (см. комментарий в начале файла) или в переменных окружения.');
    process.exit(1);
  }
}

// GitHub при загрузке ассета заменяет всё, что вне [A-Za-z0-9._-], на точку:
// «Lancible Setup 0.2.1.exe» превращается в «Lancible.Setup.0.2.1.exe», и
// только по второму имени файл отдаётся. Проверено запросом: форма с
// пробелами и форма с дефисами обе дают 404. В R2 файлы кладутся под тем же
// именем (--stage), чтобы адреса в манифесте не зависели от того, откуда файл.
const githubAssetName = (name) => name.replace(/[^A-Za-z0-9._-]/g, '.');

// Переписывает в манифесте ссылки на файлы с голых имён на абсолютные адреса
// под releaseBase. Трогает поля url (внутри files) и path (легаси-поле для
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

// Файлы, на которые манифест отправляет клиента: адрес и размер из соседней
// строки size. Легаси-поле path верхнего уровня повторяет первый url и сюда не
// попадает.
function manifestFiles(text) {
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s+url:[ \t]*(\S.*?)[ \t]*$/);
    if (url) { files.push({ url: url[1], size: null }); continue; }
    const size = line.match(/^\s+size:[ \t]*(\d+)[ \t]*$/);
    if (size && files.length) files[files.length - 1].size = Number(size[1]);
  }
  return files;
}

// Каждая ссылка из манифеста отвечает на HEAD кодом 2xx, а длина, если сервер
// её назвал, совпадает с size. Несколько попыток: свежезалитый файл на CDN
// иногда виден не с первого запроса, а r2.dev ещё и ограничивает частоту.
async function checkUrls(files, { fetchImpl = fetch, attempts = 3, delayMs = 2000 } = {}) {
  for (const { url, size } of files) {
    let problem = '';
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((r) => setTimeout(r, delayMs));
      try {
        const res = await fetchImpl(url, { method: 'HEAD' });
        const len = res.headers.get('content-length');
        if (!res.ok) problem = `${url}: ${res.status}`;
        else if (size != null && len != null && Number(len) !== size) problem = `${url}: размер ${len}, а в манифесте ${size}`;
        else { problem = ''; break; }
      } catch (err) {
        problem = `${url}: ${err.message}`;
      }
    }
    if (problem) throw new Error(`Ссылка из манифеста не открывается — ${problem}`);
    console.log('доступен:', url);
  }
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

// Раскладывает установщики и блокмапы (манифесты не нужны: они уезжают в
// Supabase) в одну плоскую папку под именами из githubAssetName.
function stage(found, outDir) {
  const names = [...found.keys()].filter((f) => !isManifest(f));
  if (!names.length) {
    console.error('Кроме манифестов в папке ничего нет — выкладывать в хранилище нечего');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const taken = new Map();
  for (const name of names) {
    const dest = githubAssetName(name);
    if (taken.has(dest)) {
      console.error(`Имена ${taken.get(dest)} и ${name} после замены символов совпадают: ${dest}`);
      process.exit(1);
    }
    taken.set(dest, name);
    fs.copyFileSync(found.get(name), path.join(outDir, dest));
    console.log('staged:', dest);
  }
}

async function main() {
  const args = process.argv.slice(2);
  // Значение флага — следующий аргумент; в позиционный (папка) оно не попадает.
  const valueIdx = new Set();
  const flagValue = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    if (!args[i + 1] || args[i + 1].startsWith('--')) {
      console.error(`${name} указан без значения`);
      process.exit(1);
    }
    valueIdx.add(i + 1);
    return args[i + 1];
  };
  const releaseBase = flagValue('--release-base');
  const stageDir = flagValue('--stage');
  const checkUrlsOn = args.includes('--check-urls');
  if (releaseBase && stageDir) {
    console.error('--stage и --release-base — отдельные вызовы: сначала разложить и залить файлы, потом манифесты');
    process.exit(1);
  }
  if (checkUrlsOn && !releaseBase) {
    console.error('--check-urls проверяет ссылки, переписанные по --release-base, — без него проверять нечего');
    process.exit(1);
  }
  const dirArg = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i));

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

  if (stageDir) {
    stage(found, path.resolve(stageDir));
    return;
  }

  requireSupabase();
  if (releaseBase) {
    // Большие файлы уже лежат по адресу releaseBase (R2 или релиз GitHub) — в
    // бакет уходят только манифесты со ссылками на них.
    const manifests = [...found.keys()].filter(isManifest);
    if (!manifests.length) {
      console.error(`В ${root} нет ни latest.yml, ни latest-mac.yml — заливать нечего`);
      process.exit(1);
    }
    const rewritten = new Map(manifests.map((name) => [name, rewriteManifest(fs.readFileSync(found.get(name), 'utf8'), releaseBase)]));
    // Сначала проверяются ВСЕ ссылки, и только потом что-то уходит в фид:
    // иначе latest.yml мог бы обновиться, а latest-mac.yml нет.
    if (checkUrlsOn) {
      for (const text of rewritten.values()) await checkUrls(manifestFiles(text));
    }
    for (const [name, text] of rewritten) {
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

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { githubAssetName, rewriteManifest, manifestFiles, checkUrls };

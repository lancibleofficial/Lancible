// Фид автообновления и раздача установщиков из Cloudflare R2.
// Запуск: npm run test:unit
//
// Откуда тест. 10 октября 2026 выяснилось, что GitHub Releases отдаёт
// пользователю ~19 КБ/с, и обновление в 82 МБ качается больше часа (Cloudflare
// в тот же день — 18 МБ/с). Установщики переехали в R2, манифесты остались в
// Supabase Storage: scripts/publish-release.js переписывает в них ссылки на
// адрес R2, а release.yml и mirror-release.yml кладут туда сами файлы.
//
// Настоящая загрузка в R2 без ключей невозможна, поэтому проверяется то, что
// видно в коде: во что превращаются манифесты (на настоящих latest.yml 0.4.2),
// найдёт ли electron-updater по такой раскладке блокмап прошлой версии (зовётся
// его собственный код), как скрипт раскладывает файлы для заливки и что
// workflow-файлы делают шаги в том порядке, в котором фид не указывает в пустоту.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { githubAssetName, rewriteManifest, manifestFiles, checkUrls } = require('../../scripts/publish-release.js');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish-release.js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const R2 = 'https://pub-0123456789abcdef.r2.dev/v0.4.2';

// Манифесты релиза v0.4.2 как их кладёт electron-builder: голые имена файлов.
const LATEST = `version: 0.4.2
files:
  - url: Lancible Setup 0.4.2.exe
    sha512: M27td0YH98UMcyR1jTkmzY7cuxonPxXgTMlWHlCt8NjDefrFJK0Un2cNmW2v1T8iuhl84PUl8HvhQfQhfFbYAQ==
    size: 82014245
path: Lancible Setup 0.4.2.exe
sha512: M27td0YH98UMcyR1jTkmzY7cuxonPxXgTMlWHlCt8NjDefrFJK0Un2cNmW2v1T8iuhl84PUl8HvhQfQhfFbYAQ==
releaseDate: '2026-10-10T11:33:18.815Z'
`;
const LATEST_MAC = `version: 0.4.2
files:
  - url: Lancible-0.4.2-universal-mac.zip
    sha512: fU6jiVtpDlEUoFwTtglyapQ7wF7NJiy0J4DhbaILWReFw9FoTQV5CmmCqa3z094PIwbk9tqZK1QDZmMjr7a7Gw==
    size: 182255203
  - url: Lancible-0.4.2-universal.dmg
    sha512: 6ud0fYnNtZHKnAWX/gpVglMF6hUyqeoTar3cvHSKyV/VpcyOIYR31cjLpWQ29FHtk18n3562aIa+AY09Og+5jA==
    size: 182524474
path: Lancible-0.4.2-universal-mac.zip
sha512: fU6jiVtpDlEUoFwTtglyapQ7wF7NJiy0J4DhbaILWReFw9FoTQV5CmmCqa3z094PIwbk9tqZK1QDZmMjr7a7Gw==
releaseDate: '2026-10-10T11:33:59.756Z'
`;

// --- ссылки в манифестах -------------------------------------------------------

test('манифест Windows: ссылки ведут в R2, имя — как у GitHub, всё остальное не тронуто', () => {
  const out = rewriteManifest(LATEST, R2);
  assert.equal(out, LATEST
    .replace('url: Lancible Setup 0.4.2.exe', `url: ${R2}/Lancible.Setup.0.4.2.exe`)
    .replace('path: Lancible Setup 0.4.2.exe', `path: ${R2}/Lancible.Setup.0.4.2.exe`));
});

test('манифест macOS: оба файла (zip для автообновления и dmg) переписаны', () => {
  const files = manifestFiles(rewriteManifest(LATEST_MAC, R2));
  assert.deepEqual(files, [
    { url: `${R2}/Lancible-0.4.2-universal-mac.zip`, size: 182255203 },
    { url: `${R2}/Lancible-0.4.2-universal.dmg`, size: 182524474 },
  ]);
});

test('слэш на конце адреса R2 не удваивается, готовые ссылки не трогаются', () => {
  assert.equal(rewriteManifest(LATEST_MAC, `${R2}///`), rewriteManifest(LATEST_MAC, R2));
  const done = rewriteManifest(LATEST, R2);
  assert.equal(rewriteManifest(done, 'https://other.example/v0.4.2'), done);
});

test('имя файла в ссылке совпадает с тем, под которым его выложит --stage', () => {
  assert.equal(githubAssetName('Lancible Setup 0.4.2.exe'), 'Lancible.Setup.0.4.2.exe');
  assert.equal(githubAssetName('Lancible.Setup.0.4.2.exe'), 'Lancible.Setup.0.4.2.exe');
  assert.equal(githubAssetName('Lancible-0.4.2-universal.dmg'), 'Lancible-0.4.2-universal.dmg');
});

test('electron-updater по такой раскладке находит блокмапы старой и новой версии', () => {
  // Его собственный код: старая версия подставляется в путь нового файла.
  const { Provider } = require('electron-updater/out/providers/Provider');
  const [file] = manifestFiles(rewriteManifest(LATEST, R2));
  const [oldMap, newMap] = Provider.prototype.getBlockMapFiles.call({}, new URL(file.url), '0.4.1', '0.4.2');
  assert.equal(String(oldMap), 'https://pub-0123456789abcdef.r2.dev/v0.4.1/Lancible.Setup.0.4.1.exe.blockmap');
  assert.equal(String(newMap), `${file.url}.blockmap`);
});

// --- проверка ссылок перед заливкой фида ---------------------------------------

const answer = (status, length) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => length } });
const quick = { attempts: 3, delayMs: 0 };

test('checkUrls: файлы на месте и нужной длины — проходит', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([init.method, url]); return answer(200, '82014245'); };
  await checkUrls([{ url: `${R2}/a.exe`, size: 82014245 }, { url: `${R2}/b.exe`, size: null }], { fetchImpl, ...quick });
  assert.deepEqual(seen, [['HEAD', `${R2}/a.exe`], ['HEAD', `${R2}/b.exe`]]);
});

test('checkUrls: 404 и чужая длина останавливают заливку фида', async () => {
  await assert.rejects(checkUrls([{ url: `${R2}/a.exe`, size: 1 }], { fetchImpl: async () => answer(404, null), ...quick }), /a\.exe: 404/);
  await assert.rejects(checkUrls([{ url: `${R2}/a.exe`, size: 100 }], { fetchImpl: async () => answer(200, '99'), ...quick }), /размер 99, а в манифесте 100/);
});

test('checkUrls: сбой сети и 429 переживаются повтором, постоянный — нет', async () => {
  const replies = [new Error('ECONNRESET'), answer(429, null), answer(200, '5')];
  await checkUrls([{ url: `${R2}/a.exe`, size: 5 }], { fetchImpl: async () => { const r = replies.shift(); if (r instanceof Error) throw r; return r; }, ...quick });
  assert.equal(replies.length, 0);
  let calls = 0;
  await assert.rejects(checkUrls([{ url: `${R2}/a.exe`, size: 5 }], { fetchImpl: async () => { calls++; throw new Error('нет сети'); }, ...quick }), /нет сети/);
  assert.equal(calls, 3);
});

// --- раскладка файлов для заливки в R2 ----------------------------------------

function run(args, env = {}) {
  // Ключей Supabase нет: режим --stage в них не нуждается, и тест не должен
  // дотянуться до настоящего фида, даже если у разработчика есть .env.
  const clean = { ...process.env, ...env };
  delete clean.SUPABASE_URL;
  delete clean.SUPABASE_SERVICE_ROLE_KEY;
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: clean });
}

test('--stage: установщики и блокмапы лежат плоско под именами из ссылок, манифестов нет', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-stage-'));
  try {
    const put = (rel, body) => { const f = path.join(tmp, 'artifacts', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
    // Как после actions/download-artifact: по подпапке на платформу.
    put('windows-installer/Lancible Setup 0.4.2.exe', 'exe');
    put('windows-installer/Lancible Setup 0.4.2.exe.blockmap', 'exe-map');
    put('windows-installer/latest.yml', LATEST);
    put('mac-installer/Lancible-0.4.2-universal.dmg', 'dmg');
    put('mac-installer/Lancible-0.4.2-universal-mac.zip', 'zip');
    put('mac-installer/latest-mac.yml', LATEST_MAC);
    put('mac-installer/readme.txt', 'не файл релиза');
    const out = path.join(tmp, 'r2-stage');

    const r = run([path.join(tmp, 'artifacts'), '--stage', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), [
      'Lancible-0.4.2-universal-mac.zip',
      'Lancible-0.4.2-universal.dmg',
      'Lancible.Setup.0.4.2.exe',
      'Lancible.Setup.0.4.2.exe.blockmap',
    ]);
    assert.equal(fs.readFileSync(path.join(out, 'Lancible.Setup.0.4.2.exe'), 'utf8'), 'exe');
    // Каждая ссылка из манифеста указывает на выложенный файл.
    for (const text of [LATEST, LATEST_MAC]) {
      for (const { url } of manifestFiles(rewriteManifest(text, R2))) {
        assert.ok(fs.existsSync(path.join(out, url.slice(R2.length + 1))), url);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--stage вместе с --release-base и --check-urls без --release-base — ошибка, ничего не делается', () => {
  const both = run([os.tmpdir(), '--stage', 'x', '--release-base', R2]);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /отдельные вызовы/);
  const lone = run([os.tmpdir(), '--check-urls']);
  assert.equal(lone.status, 1);
  assert.match(lone.stderr, /--check-urls/);
});

// --- workflow-файлы -----------------------------------------------------------

// Парсер не в зависимостях проекта: js-yaml приходит с electron-builder. Нет его —
// тест пропускается громко, а проверки по тексту ниже всё равно работают.
let yaml = null;
try { yaml = require('js-yaml'); } catch { /* пропуск ниже */ }
const SKIP = yaml ? false : 'нет js-yaml в node_modules — npm ci';
const load = (p) => yaml.load(read(p));
const stepsOf = (doc, job) => doc.jobs[job].steps;
const find = (steps, re) => {
  const i = steps.findIndex((s) => re.test(s.name || ''));
  assert.ok(i >= 0, `нет шага ${re}`);
  return i;
};

const SECRETS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];
const WORKFLOWS = ['.github/workflows/release.yml', '.github/workflows/mirror-release.yml'];

test('оба workflow — корректный YAML', { skip: SKIP }, () => {
  for (const p of WORKFLOWS) assert.doesNotThrow(() => load(p), p);
});

test('release.yml: файлы уходят в R2 до фида, фид без R2 — по-старому, на GitHub', { skip: SKIP }, () => {
  const steps = stepsOf(load(WORKFLOWS[0]), 'release');
  const check = find(steps, /Проверить, заданы ли ключи Cloudflare R2/);
  const up = find(steps, /Выложить установщики в Cloudflare R2/);
  const feedR2 = find(steps, /фид автообновления.*файлы в R2/);
  const feedGh = find(steps, /фид автообновления.*файлы на GitHub/);
  assert.ok(check < up && up < feedR2, 'порядок: проверка ключей → заливка файлов → фид');

  assert.equal(steps[check].id, 'r2');
  for (const name of SECRETS) assert.match(steps[check].run + JSON.stringify(steps[check].env), new RegExp(name));
  assert.match(steps[check].run, /::warning::/, 'без секретов — понятная строка в логе');

  assert.match(steps[up].if, /steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(steps[up].run, /publish-release\.js artifacts --stage r2-stage/);
  assert.match(steps[up].run, /aws s3 cp r2-stage "s3:\/\/\$\{R2_BUCKET\}\/\$\{TAG\}\/" --recursive/);
  assert.match(steps[up].run, /--endpoint-url "https:\/\/\$\{R2_ACCOUNT_ID\}\.r2\.cloudflarestorage\.com"/);
  assert.match(steps[up].run, /set -euo pipefail/, 'сбой загрузки обязан остановить задачу до фида');

  assert.match(steps[feedR2].if, /steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(steps[feedR2].run, /--release-base "\$\{R2_PUBLIC_URL%\/\}\/\$\{TAG\}" --check-urls/);
  assert.match(steps[feedGh].if, /steps\.r2\.outputs\.enabled != 'true'/);
  assert.match(steps[feedGh].run, /github\.com\/\$\{\{ github\.repository \}\}\/releases\/download\//);
  assert.doesNotMatch(steps[feedGh].run, /--check-urls/);
});

test('mirror-release.yml: запускается вручную с тегом, фид — после загрузки в R2', { skip: SKIP }, () => {
  const doc = load(WORKFLOWS[1]);
  const on = doc.on ?? doc[true];
  assert.deepEqual(Object.keys(on), ['workflow_dispatch']);
  assert.equal(on.workflow_dispatch.inputs.tag.required, true);

  const steps = stepsOf(doc, 'mirror');
  const check = find(steps, /Проверить тег и ключи R2/);
  const down = find(steps, /Скачать ассеты релиза/);
  const up = find(steps, /Выложить файлы в Cloudflare R2/);
  const feed = find(steps, /Переключить фид автообновления на R2/);
  assert.ok(check < down && down < up && up < feed, 'порядок: проверка → скачивание → R2 → фид');

  assert.equal(doc.jobs.mirror.env.TAG, '${{ inputs.tag }}', 'тег идёт через переменную, не подстановкой в команду');
  assert.match(steps[down].run, /gh release download "\$TAG"/);
  for (const ext of ['*.exe', '*.exe.blockmap', '*.dmg', '*.dmg.blockmap', '*.zip', '*.zip.blockmap', 'latest.yml', 'latest-mac.yml']) {
    assert.ok(steps[down].run.includes(`'${ext}'`), `не скачивается ${ext}`);
  }
  assert.match(steps[up].run, /publish-release\.js release-assets --stage r2-stage/);
  assert.match(steps[up].run, /aws s3 cp r2-stage "s3:\/\/\$\{R2_BUCKET\}\/\$\{TAG\}\/" --recursive/);
  assert.match(steps[up].run, /set -euo pipefail/);
  assert.match(steps[feed].run, /--release-base "\$\{R2_PUBLIC_URL%\/\}\/\$\{TAG\}" --check-urls/);
  assert.match(steps[feed].run, /sort -V/, 'старую версию поверх новой в фид не кладём');
});

test('оба workflow раскладывают файлы одинаково и настроены на R2', () => {
  for (const p of WORKFLOWS) {
    const text = read(p);
    for (const name of SECRETS) assert.ok(text.includes(`secrets.${name}`), `${p}: нет секрета ${name}`);
    // Без этих двух aws cli новых версий не может работать с R2.
    assert.match(text, /AWS_REQUEST_CHECKSUM_CALCULATION: when_required/, p);
    assert.match(text, /AWS_RESPONSE_CHECKSUM_VALIDATION: when_required/, p);
    assert.match(text, /AWS_DEFAULT_REGION: auto/, p);
    // Тот же путь, что у GitHub (download/v0.4.2/<файл>): ради блокмапа прошлой версии.
    assert.ok(text.includes('"s3://${R2_BUCKET}/${TAG}/"'), `${p}: файлы уходят не в <тег>/`);
    assert.ok(text.includes('"${R2_PUBLIC_URL%/}/${TAG}"'), `${p}: ссылки фида не на <тег>/`);
    assert.ok(!/r2\.dev/.test(text.replace(/^\s*#.*$/gm, '')), `${p}: адрес бакета — только секретом`);
  }
});

test('документы называют секреты R2 и команду зеркала', () => {
  for (const doc of ['README.md', 'ARCHITECTURE.md']) {
    const text = read(doc);
    for (const name of SECRETS) assert.ok(text.includes(name), `в ${doc} нет ${name}`);
    assert.ok(text.includes('gh workflow run mirror-release.yml -f tag='), `в ${doc} нет команды зеркала`);
    assert.match(text, /r2\.dev/, `в ${doc} нет оговорки про r2.dev`);
  }
});

// Фид автообновления и раздача установщиков из Cloudflare R2.
// Запуск: npm run test:unit
//
// Откуда тест. 10 октября 2026 выяснилось, что GitHub Releases отдаёт
// пользователю ~19 КБ/с, и обновление в 82 МБ качается больше часа (Cloudflare
// в тот же день — 18 МБ/с). Установщики переехали в R2, манифесты остались в
// Supabase Storage: scripts/publish-release.js переписывает в них ссылки на
// адрес R2, а release.yml и mirror-release.yml кладут туда сами файлы. APK
// телефона раздаётся оттуда же (mobile-release.yml и mirror-release.yml по
// тегу mobile-v*), а его latest.json правится руками по блоку из лога.
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
const { spawnSync, execFile } = require('node:child_process');
const http = require('node:http');
const { githubAssetName, rewriteManifest, manifestFiles, checkUrls, mobileRelease, androidManifestBlock, checkMobileApk } = require('../../scripts/publish-release.js');

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
// log молчит: печать в stdout процесса теста на Windows рвала протокол раннера.
const quick = { attempts: 3, delayMs: 0, log: () => {} };

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

// --- APK телефона в R2 ---------------------------------------------------------
//
// Откуда. APK (~96 МБ) тоже шёл с GitHub Releases и тоже ~19 КБ/с. Теперь он
// раздаётся из R2 по пути mobile-v<версия>/Lancible-<версия>.apk, а блок
// "android" для latest.json репозитория lancible-updates печатает скрипт.

const R2_BASE = 'https://pub-0123456789abcdef.r2.dev';

test('mobileRelease: тег телефона → версия, имя APK и путь в бакете', () => {
  assert.deepEqual(mobileRelease('mobile-v1.2.2'), {
    version: '1.2.2',
    apkName: 'Lancible-1.2.2.apk',
    key: 'mobile-v1.2.2/Lancible-1.2.2.apk',
  });
  assert.equal(mobileRelease('mobile-v1.10').key, 'mobile-v1.10/Lancible-1.10.apk');
});

test('mobileRelease: десктопные и кривые теги не принимает', () => {
  // v0.4.3 — десктоп: его файлы и фид идут другим путём.
  for (const tag of ['v0.4.3', 'mobile-1.2.2', 'mobile-v', 'mobile-v1.', 'mobile-v1.2.2-rc1', 'mobile-v1.2.2/../x', 'xmobile-v1.2.2', '', undefined]) {
    assert.equal(mobileRelease(tag), null, String(tag));
  }
});

test('androidManifestBlock: блок "android" для latest.json, url и apk — прямая ссылка', () => {
  const url = `${R2_BASE}/mobile-v1.2.2/Lancible-1.2.2.apk`;
  const block = androidManifestBlock({ version: '1.2.2', url, size: 100663296 });
  assert.equal(block, `"android": {
  "version": "1.2.2",
  "url": "${url}",
  "apk": "${url}",
  "size": 100663296
}`);
  // Вставленный в файл с блоком "ios", он остаётся корректным JSON.
  const doc = JSON.parse(`{ ${block}, "ios": { "version": "1.2.2", "url": "https://example.com" } }`);
  assert.equal(doc.android.apk, doc.android.url);
  assert.equal(doc.android.size, 100663296);
});

test('checkUrls requireLength: сервер, не назвавший размер, не проходит', async () => {
  const noLength = async () => answer(200, null);
  await checkUrls([{ url: `${R2_BASE}/a.apk`, size: 5 }], { fetchImpl: noLength, ...quick });
  await assert.rejects(checkUrls([{ url: `${R2_BASE}/a.apk`, size: 5 }], { fetchImpl: noLength, requireLength: true, ...quick }), /не назвал размер/);
});

function fakeApk(name = 'Lancible-1.2.2.apk', body = 'PK-apk-body') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-apk-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return { dir, file, size: Buffer.byteLength(body) };
}

test('checkMobileApk: HEAD идёт на <R2>/<тег>/<файл>, размер берётся с диска, блок готов', async () => {
  const { dir, file, size } = fakeApk();
  try {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push([init.method, url]); return answer(200, String(size)); };
    const r = await checkMobileApk(file, 'mobile-v1.2.2', `${R2_BASE}///`, { fetchImpl, ...quick });
    const url = `${R2_BASE}/mobile-v1.2.2/Lancible-1.2.2.apk`;
    assert.deepEqual(seen, [['HEAD', url]]);
    assert.deepEqual({ url: r.url, size: r.size }, { url, size });
    assert.equal(r.block, androidManifestBlock({ version: '1.2.2', url, size }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkMobileApk: чужой размер, 404, чужое имя файла и десктопный тег — ошибка', async () => {
  const { dir, file, size } = fakeApk();
  try {
    await assert.rejects(checkMobileApk(file, 'mobile-v1.2.2', R2_BASE, { fetchImpl: async () => answer(200, String(size + 1)), ...quick }), /размер/);
    await assert.rejects(checkMobileApk(file, 'mobile-v1.2.2', R2_BASE, { fetchImpl: async () => answer(404, null), ...quick }), /404/);
    await assert.rejects(checkMobileApk(file, 'mobile-v1.2.2', R2_BASE, { fetchImpl: async () => answer(200, null), ...quick }), /не назвал размер/);
    await assert.rejects(checkMobileApk(file, 'mobile-v1.2.3', R2_BASE, { fetchImpl: async () => answer(200, String(size)), ...quick }), /ожидался файл Lancible-1\.2\.3\.apk/);
    await assert.rejects(checkMobileApk(file, 'v0.4.3', R2_BASE, { fetchImpl: async () => answer(200, String(size)), ...quick }), /не похож на тег телефона/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Скрипт целиком, против настоящего HTTP-сервера на localhost: HEAD, размер,
// печать блока и страница выполнения задачи ($GITHUB_STEP_SUMMARY). Ключей Supabase
// нет — режим телефона в них не нуждается и фид десктопа тронуть не может.
function runAsync(args, env = {}) {
  const clean = { ...process.env, ...env };
  delete clean.SUPABASE_URL;
  delete clean.SUPABASE_SERVICE_ROLE_KEY;
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: clean }, (error, stdout, stderr) => {
      resolve({ status: error ? error.code : 0, stdout, stderr });
    });
  });
}

test('--mobile-apk: проверяет APK по HTTP и печатает блок для latest.json, фид не трогает', async () => {
  const { dir, file, size } = fakeApk();
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'HEAD' && req.url === '/mobile-v1.2.2/Lancible-1.2.2.apk') {
      res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'application/vnd.android.package-archive' });
    } else {
      res.writeHead(404);
    }
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const summary = path.join(dir, 'summary.md');
    const ok = await runAsync(['--mobile-apk', file, '--tag', 'mobile-v1.2.2', '--public-url', `${base}/`], { GITHUB_STEP_SUMMARY: summary });
    assert.equal(ok.status, 0, ok.stderr);
    const url = `${base}/mobile-v1.2.2/Lancible-1.2.2.apk`;
    assert.ok(ok.stdout.includes(androidManifestBlock({ version: '1.2.2', url, size })), ok.stdout);
    assert.match(ok.stdout, /блок "ios" не трогать/);
    assert.ok(fs.readFileSync(summary, 'utf8').includes(androidManifestBlock({ version: '1.2.2', url, size })), 'блок не попал на страницу задачи');
    assert.deepEqual(requests, ['HEAD /mobile-v1.2.2/Lancible-1.2.2.apk'], 'скрипт ходит только за самим APK');

    // Файл не от того тега — код возврата не нулевой, блока в выводе нет, до сети не доходит.
    const wrong = await runAsync(['--mobile-apk', file, '--tag', 'mobile-v1.2.3', '--public-url', base]);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /ожидался файл Lancible-1\.2\.3\.apk/);
    assert.doesNotMatch(wrong.stdout, /"android"/);
    assert.equal(requests.length, 1);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--mobile-apk: без --tag и --public-url, вместе с другими режимами, а --tag сам по себе — ошибка', () => {
  const { dir, file } = fakeApk();
  try {
    for (const args of [
      ['--mobile-apk', file],
      ['--mobile-apk', file, '--tag', 'mobile-v1.2.2'],
      ['--mobile-apk', file, '--tag', 'mobile-v1.2.2', '--public-url', R2_BASE, '--release-base', R2],
      ['--mobile-apk', file, '--tag', 'mobile-v1.2.2', '--public-url', R2_BASE, '--stage', 'x'],
      ['--mobile-apk', file, '--tag', 'mobile-v1.2.2', '--public-url', R2_BASE, '--check-urls'],
    ]) {
      const r = run(args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /--mobile-apk — отдельный вызов/);
    }
    const lone = run([os.tmpdir(), '--tag', 'mobile-v1.2.2']);
    assert.equal(lone.status, 1);
    assert.match(lone.stderr, /нужны только режиму --mobile-apk/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
const MOBILE = '.github/workflows/mobile-release.yml';

test('все три workflow выката — корректный YAML', { skip: SKIP }, () => {
  for (const p of [...WORKFLOWS, MOBILE]) assert.doesNotThrow(() => load(p), p);
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

test('mobile-release.yml: APK уходит в R2 после сборки, до подсказки про latest.json, без R2 — по-старому', { skip: SKIP }, () => {
  const doc = load(MOBILE);
  const steps = stepsOf(doc, 'build');
  const dl = find(steps, /Скачать APK под нужным именем/);
  const gh = find(steps, /Опубликовать GitHub Release/);
  const check = find(steps, /Проверить, заданы ли ключи Cloudflare R2/);
  const up = find(steps, /Выложить APK в Cloudflare R2/);
  const head = find(steps, /Проверить раздачу и вывести блок для latest\.json/);
  const old = find(steps, /Напомнить про манифест обновлений/);
  assert.ok(dl < gh && gh < check && check < up && up < head && head < old, 'порядок: сборка → GitHub Release (архив) → ключи → R2 → HEAD и блок');

  assert.equal(steps[check].id, 'r2');
  for (const name of SECRETS) assert.match(steps[check].run + JSON.stringify(steps[check].env), new RegExp(name));
  assert.match(steps[check].run, /::warning::/, 'без секретов — понятная строка в логе');

  // Путь в бакете — <тег>/<файл>: ровно то, что считает mobileRelease.
  assert.match(steps[up].if, /steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(steps[up].run, /aws s3 cp "\$APK_NAME" "s3:\/\/\$\{R2_BUCKET\}\/\$\{TAG\}\/\$\{APK_NAME\}"/);
  assert.match(steps[up].run, /--endpoint-url "https:\/\/\$\{R2_ACCOUNT_ID\}\.r2\.cloudflarestorage\.com"/);
  assert.match(steps[up].run, /--content-type application\/vnd\.android\.package-archive/);
  assert.match(steps[up].run, /set -euo pipefail/, 'сбой загрузки обязан остановить задачу до подсказки');
  assert.equal(steps[up].env.TAG, '${{ steps.meta.outputs.tag }}');
  assert.match(read(MOBILE), /name="Lancible-\$\{\{ steps\.meta\.outputs\.version \}\}\.apk"/, 'имя APK — Lancible-<версия>.apk, как считает mobileRelease');

  assert.match(steps[head].if, /steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(steps[head].run, /publish-release\.js --mobile-apk "\$APK_NAME" --tag "\$TAG" --public-url "\$R2_PUBLIC_URL"/);
  assert.match(steps[old].if, /steps\.r2\.outputs\.enabled != 'true'/, 'без R2 остаётся прежнее напоминание');
  assert.match(steps[old].run, /stat -c %s/);

  const text = read(MOBILE);
  for (const name of SECRETS) assert.ok(text.includes(`secrets.${name}`), `нет секрета ${name}`);
  assert.match(text, /AWS_REQUEST_CHECKSUM_CALCULATION: when_required/);
  assert.match(text, /AWS_RESPONSE_CHECKSUM_VALIDATION: when_required/);
  assert.match(text, /AWS_DEFAULT_REGION: auto/);
  assert.ok(!/r2\.dev/.test(text.replace(/^\s*#.*$/gm, '')), 'адрес бакета — только секретом');
  // Телефон к фиду десктопа отношения не имеет.
  assert.ok(!/SUPABASE|latest\.yml|latest-mac\.yml|--release-base/.test(text.replace(/^\s*#.*$/gm, '')), 'mobile-release.yml не трогает фид десктопа');
});

test('mirror-release.yml: теги mobile-v* идут отдельной задачей, которая фид десктопа тронуть не может', { skip: SKIP }, () => {
  const doc = load(WORKFLOWS[1]);
  assert.deepEqual(Object.keys(doc.jobs), ['mirror', 'mirror-mobile']);
  // Развилка по тегу: десктопная задача — всё, что не mobile-v*, мобильная — только mobile-v*.
  assert.equal(doc.jobs.mirror.if, "${{ !startsWith(inputs.tag, 'mobile-v') }}");
  assert.equal(doc.jobs['mirror-mobile'].if, "${{ startsWith(inputs.tag, 'mobile-v') }}");
  assert.equal(doc.jobs['mirror-mobile'].env.TAG, '${{ inputs.tag }}', 'тег идёт через переменную, не подстановкой в команду');

  const steps = stepsOf(doc, 'mirror-mobile');
  const check = find(steps, /Проверить тег и ключи R2/);
  const down = find(steps, /Скачать APK релиза/);
  const up = find(steps, /Выложить APK в Cloudflare R2/);
  const head = find(steps, /Проверить раздачу и вывести блок для latest\.json/);
  assert.ok(check < down && down < up && up < head, 'порядок: проверка → скачивание → R2 → HEAD и блок');

  assert.match(steps[check].run, /\^mobile-v\[0-9\]\+\(\\\.\[0-9\]\+\)\*\$/, 'принимается только mobile-v<версия>');
  for (const name of SECRETS) assert.match(steps[check].run + JSON.stringify(steps[check].env), new RegExp(name));
  // Скачивается один ассет, и это APK: манифесты десктопа даже не попадают на раннер.
  assert.match(steps[down].run, /apk="Lancible-\$\{TAG#mobile-v\}\.apk"/, 'имя APK — Lancible-<версия>.apk, как считает mobileRelease');
  assert.match(steps[down].run, /gh release download "\$TAG" .* --pattern "\$apk"/);
  assert.doesNotMatch(steps[down].run, /\.exe|\.dmg|\.zip|latest/);
  assert.match(steps[up].run, /aws s3 cp "\$APK" "s3:\/\/\$\{R2_BUCKET\}\/\$\{TAG\}\/\$\(basename "\$APK"\)"/);
  assert.match(steps[up].run, /--endpoint-url "https:\/\/\$\{R2_ACCOUNT_ID\}\.r2\.cloudflarestorage\.com"/);
  assert.match(steps[up].run, /set -euo pipefail/);
  assert.match(steps[head].run, /publish-release\.js --mobile-apk "\$APK" --tag "\$TAG" --public-url "\$R2_PUBLIC_URL"/);

  // Главное: ни ключа Supabase, ни манифестов, ни режима «залить фид» в мобильной задаче.
  const mobileJob = JSON.stringify(doc.jobs['mirror-mobile']);
  assert.doesNotMatch(mobileJob, /SUPABASE|latest\.yml|latest-mac\.yml|--release-base|releases\/latest/);
  for (const name of SECRETS) assert.ok(mobileJob.includes(`secrets.${name}`), `нет секрета ${name}`);
  assert.match(mobileJob, /AWS_REQUEST_CHECKSUM_CALCULATION/);

  // А десктопная задача осталась прежней: фид переключает только она.
  const desktop = stepsOf(doc, 'mirror');
  const feed = find(desktop, /Переключить фид автообновления на R2/);
  assert.match(desktop[feed].run, /--release-base/);
  assert.match(desktop[find(desktop, /Проверить тег и ключи R2/)].run, /\^v\[0-9\]/, 'десктопный тег — по-прежнему v*');
});

test('документы называют секреты R2 и команду зеркала', () => {
  for (const doc of ['README.md', 'ARCHITECTURE.md']) {
    const text = read(doc);
    for (const name of SECRETS) assert.ok(text.includes(name), `в ${doc} нет ${name}`);
    assert.ok(text.includes('gh workflow run mirror-release.yml -f tag='), `в ${doc} нет команды зеркала`);
    assert.match(text, /r2\.dev/, `в ${doc} нет оговорки про r2.dev`);
  }
});

test('документы описывают выпуск APK: R2, зеркало телефона, latest.json и порядок до лендинга', () => {
  for (const doc of ['README.md', 'ARCHITECTURE.md']) {
    const text = read(doc);
    assert.ok(text.includes('gh workflow run mirror-release.yml -f tag=mobile-v'), `в ${doc} нет команды зеркала для APK`);
    assert.ok(text.includes('mobile-v<версия>/Lancible-<версия>.apk'), `в ${doc} нет пути APK в R2`);
    assert.ok(text.includes('lancible-updates'), `в ${doc} нет latest.json в lancible-updates`);
    assert.match(text, /зеркало[^\n]*latest\.json[^\n]*лендинг/i, `в ${doc} нет порядка «зеркало → latest.json → лендинг»`);
  }
});

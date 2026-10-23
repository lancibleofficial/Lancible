// Выпуск кнопкой: .github/workflows/publish.yml и то, что он зовёт.
// Запуск: npm run test:unit
//
// Откуда тест. 23 октября 2026 выпуск переехал из чек-листа в CLAUDE.md на
// кнопку в админке. Главное правило переехало вместе с ним: пока полный прогон
// (Linux CI и Windows со снимками) не зелёный, ничего не публикуется, а упавший
// шаг останавливает всё, что после него. Настоящий запуск — это выпуск, поэтому
// здесь проверяется устройство самого workflow: кто от кого зависит, кто
// пушит и чем, что уходит в оболочку.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// Парсер не в зависимостях проекта: js-yaml приходит с electron-builder. Нет его —
// тест пропускается громко (так же, как в publish-release.test.js).
let yaml = null;
try { yaml = require('js-yaml'); } catch { /* пропуск ниже */ }
const SKIP = yaml ? false : 'нет js-yaml в node_modules — npm ci';
const load = (p) => yaml.load(read(p));
// js-yaml читает ключ «on» как true (YAML 1.1).
const triggers = (doc) => doc.on ?? doc[true];

const PUBLISH = '.github/workflows/publish.yml';
const SECRETS_R2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];

const needsOf = (job) => [].concat(job.needs || []);
/** Все работы, от которых зависит id, — прямо или через других. */
function ancestors(jobs, id, seen = new Set()) {
  for (const n of needsOf(jobs[id])) {
    assert.ok(jobs[n], `${id} ждёт несуществующую работу ${n}`);
    if (!seen.has(n)) { seen.add(n); ancestors(jobs, n, seen); }
  }
  return seen;
}
const runs = (job) => (job.steps || []).map((s) => s.run || '').join('\n');

test('publish.yml запускается только кнопкой: workflow_dispatch с двумя необязательными версиями', { skip: SKIP }, () => {
  const doc = load(PUBLISH);
  const on = triggers(doc);
  assert.deepEqual(Object.keys(on), ['workflow_dispatch'], 'ни push, ни тегов, ни расписания');
  const { inputs } = on.workflow_dispatch;
  assert.deepEqual(Object.keys(inputs).sort(), ['desktop_version', 'mobile_version'], 'входы — те, что шлёт releases.start');
  for (const i of Object.values(inputs)) {
    assert.equal(i.required, false);
    assert.equal(i.type, 'string');
  }
  // «Хотя бы одна» проверяется в первой работе — до тестов.
  assert.match(runs(doc.jobs.plan), /release-steps\.js versions --desktop "\$DESKTOP" --mobile "\$MOBILE"/);
});

test('один выпуск за раз: concurrency без отмены идущего', { skip: SKIP }, () => {
  const { concurrency } = load(PUBLISH);
  assert.equal(typeof concurrency.group, 'string');
  assert.ok(concurrency.group.length > 0);
  assert.equal(concurrency['cancel-in-progress'], false, 'идущий выпуск не обрывается посередине');
});

test('тесты обеих систем стоят раньше коммита версий и тегов', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  assert.equal(jobs.tests.uses, './.github/workflows/test.yml', 'линуксовая половина — test.yml целиком');
  const win = jobs['tests-windows'];
  assert.equal(win['runs-on'], 'windows-latest');
  const winRun = runs(win);
  assert.match(winRun, /setup-worktree\.js --mobile/, 'подготовка как у копии: Electron, веб, телефон');
  assert.match(winRun, /playwright install chromium/);
  assert.match(winRun, /^npm test$/m);
  // npm test — тот самый полный набор, и снимки в нём есть.
  const testScript = JSON.parse(read('package.json')).scripts.test;
  for (const layer of ['test:unit', 'test:mobile', 'check:mobile-build', 'smoke', 'test:e2e', 'test:landing', 'test:admin', 'test:visual']) {
    assert.ok(testScript.includes(`npm run ${layer}`), `npm test не гоняет ${layer}`);
  }

  const before = ancestors(jobs, 'versions');
  for (const id of ['plan', 'tests', 'tests-windows']) assert.ok(before.has(id), `versions не ждёт ${id}`);
  // Без своего if: упал любой из них — versions пропускается (success() по умолчанию).
  assert.equal(jobs.versions.if, undefined);
  assert.equal(jobs.tests.if, undefined);
  assert.equal(jobs['tests-windows'].if, undefined);
});

test('теги и коммит версий — только в «Версиях и тегах», одним атомарным пушем GITHUB_TOKEN', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  const v = jobs.versions;
  const text = runs(v);
  assert.match(text, /release-steps\.js versions --desktop "\$DESKTOP" --mobile "\$MOBILE" --write/);
  assert.match(text, /git add package\.json package-lock\.json mobile\/app\.json/);
  assert.match(text, /git tag -a "\$DESKTOP_TAG"/);
  assert.match(text, /git tag -a "\$MOBILE_TAG"/);
  assert.match(text, /git push --atomic origin "\$\{refs\[@\]\}"/);
  assert.match(text, /HEAD:refs\/heads\/main/);
  // Тот коммит, что проверили тесты, а не свежий main.
  const checkout = v.steps.find((s) => String(s.uses).startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  // Свой токен в checkout — и тег запустил бы release.yml второй раз по push: tags.
  assert.equal(checkout.with.token, undefined, 'пушит GITHUB_TOKEN: такой тег других workflow не запускает');
  for (const [id, job] of Object.entries(jobs)) {
    if (id === 'versions') continue;
    // Читать теги (git ls-remote в «Входах») можно, ставить и пушить — нет.
    assert.doesNotMatch(runs(job), /git tag\b|git push[^\n]*(--tags|refs\/tags)/, `${id} не должен ставить теги`);
  }
});

test('сборки вызываются после тегов, с тегом и ref, и только выпускаемой платформы', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  for (const [id, file, input] of [['desktop', './.github/workflows/release.yml', 'desktop'], ['mobile', './.github/workflows/mobile-release.yml', 'mobile']]) {
    const job = jobs[id];
    assert.equal(job.uses, file);
    assert.ok(ancestors(jobs, id).has('versions'), `${id} не ждёт тегов`);
    assert.ok(ancestors(jobs, id).has('tests-windows'), `${id} не ждёт тестов Windows`);
    assert.equal(job.with.tag, `\${{ needs.plan.outputs.${input}_tag }}`);
    assert.equal(job.with.ref, `refs/tags/\${{ needs.plan.outputs.${input}_tag }}`);
    assert.equal(job.if, `\${{ needs.plan.outputs.${input} != '' }}`);
    assert.equal(job.permissions.contents, 'write', 'страница релиза пишется GITHUB_TOKEN вызванного workflow');
  }
});

test('секреты, отданные сборкам, объявлены в их workflow_call — и наоборот', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  for (const [id, file] of [['desktop', '.github/workflows/release.yml'], ['mobile', '.github/workflows/mobile-release.yml']]) {
    const declared = Object.keys(triggers(load(file)).workflow_call.secrets).sort();
    assert.deepEqual(Object.keys(jobs[id].secrets).sort(), declared, `${id}: секреты не совпадают с ${file}`);
    for (const [name, value] of Object.entries(jobs[id].secrets)) assert.equal(value, `\${{ secrets.${name} }}`);
    for (const name of SECRETS_R2) assert.ok(declared.includes(name), `${file}: нет ${name}`);
  }
  assert.ok(jobs.desktop.secrets.SUPABASE_SERVICE_ROLE_KEY, 'десктопу нужен ключ фида');
  assert.ok(jobs.mobile.secrets.EXPO_TOKEN, 'телефону нужен токен Expo');
  assert.equal(jobs.mobile.secrets.SUPABASE_SERVICE_ROLE_KEY, undefined, 'телефону ключ фида десктопа не положен');
  assert.equal(jobs.desktop.secrets.LANCIBLE_UPDATES_TOKEN, undefined);
});

test('проверка файлов — после сборок; latest.json и лендинг — только после проверки', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  const verify = jobs.verify;
  for (const id of ['versions', 'desktop', 'mobile']) assert.ok(needsOf(verify).includes(id), `verify не ждёт ${id}`);
  // Не выпускаемая платформа — skipped, упавшая — стоп.
  assert.match(verify.if, /needs\.versions\.result == 'success'/);
  assert.match(verify.if, /\(needs\.desktop\.result == 'success' \|\| needs\.desktop\.result == 'skipped'\)/);
  assert.match(verify.if, /\(needs\.mobile\.result == 'success' \|\| needs\.mobile\.result == 'skipped'\)/);
  assert.match(verify.if, /!cancelled\(\)/);
  const vr = runs(verify);
  assert.match(vr, /release-steps\.js verify --public-url "\$R2_PUBLIC_URL"/);
  assert.match(vr, /gh release view "\$DESKTOP_TAG"/, 'установщики на странице релиза');
  assert.match(vr, /gh release view "\$MOBILE_TAG"/);
  for (const f of ['Lancible.Setup.$DESKTOP.exe', 'Lancible-$DESKTOP-universal.dmg', 'Lancible-$DESKTOP-universal-mac.zip', 'latest.yml', 'latest-mac.yml', 'Lancible-$MOBILE.apk']) {
    assert.ok(vr.includes(f), `в релизе не проверяется ${f}`);
  }
  assert.equal(verify.env.WIN_BYTES, '${{ needs.desktop.outputs.win_bytes }}');
  assert.equal(verify.env.APK_BYTES, '${{ needs.mobile.outputs.apk_bytes }}');

  const updates = jobs.updates;
  assert.ok(needsOf(updates).includes('verify'));
  assert.match(updates.if, /needs\.verify\.result == 'success'/);
  assert.match(updates.if, /needs\.plan\.outputs\.mobile != ''/);
  const other = updates.steps.find((s) => s.with && s.with.repository);
  assert.equal(other.with.repository, 'lancibleofficial/lancible-updates');
  assert.equal(other.with.token, '${{ secrets.LANCIBLE_UPDATES_TOKEN }}');
  assert.match(runs(updates), /release-steps\.js latest-json updates\/latest\.json/);

  const landing = jobs.landing;
  for (const id of ['verify', 'updates']) assert.ok(needsOf(landing).includes(id), `landing не ждёт ${id}`);
  assert.match(landing.if, /needs\.verify\.result == 'success'/);
  assert.match(landing.if, /\(needs\.updates\.result == 'success' \|\| needs\.updates\.result == 'skipped'\)/, 'зеркало → latest.json → лендинг');
  const lr = runs(landing);
  assert.match(lr, /release-landing\.js --public-url "\$R2_PUBLIC_URL"/);
  assert.match(lr, /node --test tests\/unit\/landing\.test\.js/, 'кнопки сверяются тестом лендинга до пуша');
  assert.match(lr, /git push origin HEAD:refs\/heads\/main/);
});

test('писать могут только те, кому надо; токен lancible-updates — только в своей работе', { skip: SKIP }, () => {
  const doc = load(PUBLISH);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  const writers = Object.entries(doc.jobs).filter(([, j]) => j.permissions && j.permissions.contents === 'write').map(([id]) => id).sort();
  assert.deepEqual(writers, ['desktop', 'landing', 'mobile', 'versions']);
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (id === 'updates' || id === 'plan') continue;
    assert.doesNotMatch(JSON.stringify(job), /LANCIBLE_UPDATES_TOKEN/, `${id} видит токен lancible-updates`);
  }
});

test('входы и вывод шагов не подставляются в текст команд', { skip: SKIP }, () => {
  // Версии приходят снаружи (админка, ручной запуск): в оболочку — только
  // переменными окружения, иначе «1.0.0; что-нибудь» стало бы командой.
  for (const file of [PUBLISH, '.github/workflows/release.yml', '.github/workflows/mobile-release.yml']) {
    const { jobs } = load(file);
    for (const [id, job] of Object.entries(jobs)) {
      for (const step of job.steps || []) {
        if (!step.run) continue;
        assert.doesNotMatch(step.run, /\$\{\{\s*(inputs|github\.event\.inputs|needs)\./, `${file}, ${id}: «${step.name || step.run.slice(0, 40)}» подставляет вход в команду`);
      }
    }
  }
});

test('итог: работа «Итог» идёт всегда и видит все шаги', { skip: SKIP }, () => {
  const { jobs } = load(PUBLISH);
  assert.equal(jobs.summary.if, '${{ always() }}');
  const others = Object.keys(jobs).filter((id) => id !== 'summary').sort();
  assert.deepEqual([...needsOf(jobs.summary)].sort(), others);
  assert.match(runs(jobs.summary), /release-steps\.js summary/);
  assert.equal(jobs.summary.steps.find((s) => s.run).env.NEEDS, '${{ toJSON(needs) }}');
  // Имена работ в итоге — те же, что в release-steps.js.
  const { JOB_NAMES } = require('../../scripts/release-steps.js');
  assert.deepEqual(Object.keys(JOB_NAMES).sort(), others);
});

test('test.yml по-прежнему на каждый push и PR, а теперь и как workflow_call', { skip: SKIP }, () => {
  const on = triggers(load('.github/workflows/test.yml'));
  assert.deepEqual(Object.keys(on).sort(), ['pull_request', 'push', 'workflow_call', 'workflow_dispatch']);
  assert.deepEqual(on.push.branches, ['**']);
});

test('release.yml и mobile-release.yml: теги и ручной запуск как были, плюс workflow_call с тегом', { skip: SKIP }, () => {
  for (const [file, pattern, job, outputs] of [
    ['.github/workflows/release.yml', 'v*', 'release', { win_bytes: 'sizes', mac_bytes: 'sizes' }],
    ['.github/workflows/mobile-release.yml', 'mobile-v*', 'build', { apk_bytes: 'apk' }],
  ]) {
    const doc = load(file);
    const on = triggers(doc);
    assert.deepEqual(on.push, { tags: [pattern] }, `${file}: тег ${pattern} запускает как раньше`);
    assert.equal(on.workflow_dispatch.inputs.tag.required, true);
    for (const name of ['tag', 'ref']) {
      assert.equal(on.workflow_call.inputs[name].required, true, `${file}: вход ${name}`);
      assert.equal(on.workflow_call.inputs[name].type, 'string');
    }
    // Вызванный workflow видит github.sha вызвавшего — коммит без новой версии.
    // Поэтому каждый checkout берёт ref из входа (пустой — как раньше).
    for (const [id, j] of Object.entries(doc.jobs)) {
      const co = j.steps.filter((s) => String(s.uses).startsWith('actions/checkout'));
      assert.ok(co.length > 0, `${file}, ${id}: нет checkout`);
      for (const s of co) assert.equal(s.with && s.with.ref, '${{ inputs.ref }}', `${file}, ${id}: checkout не по ref`);
    }
    // Выходы: workflow_call → работа → шаг с таким id.
    for (const [name, stepId] of Object.entries(outputs)) {
      assert.equal(on.workflow_call.outputs[name].value, `\${{ jobs.${job}.outputs.${name} }}`);
      assert.match(doc.jobs[job].outputs[name], new RegExp(`^\\$\\{\\{ steps\\.${stepId}\\.outputs\\.`));
      assert.ok(doc.jobs[job].steps.some((s) => s.id === stepId), `${file}: нет шага id=${stepId}`);
    }
  }
  // Размеры установщиков считаются только при вызове из publish.yml: выкат по тегу их не видит.
  const sizes = load('.github/workflows/release.yml').jobs.release.steps.find((s) => s.id === 'sizes');
  assert.equal(sizes.if, "${{ inputs.ref != '' }}");
  assert.match(sizes.run, /release-steps\.js sizes artifacts >> "\$GITHUB_OUTPUT"/);
});

test('документы называют выпуск кнопкой, его секреты и токен админки', () => {
  const arch = read('ARCHITECTURE.md');
  for (const word of ['publish.yml', 'release-landing.js', 'LANCIBLE_UPDATES_TOKEN', 'GITHUB_RELEASE_TOKEN', 'workflow_call', 'EXPO_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', ...SECRETS_R2]) {
    assert.ok(arch.includes(word), `в ARCHITECTURE.md нет ${word}`);
  }
  const flat = (text) => text.replace(/\s+/g, ' ');
  assert.match(flat(arch), /LANCIBLE_UPDATES_TOKEN`?\*\*[^.]*lancible-updates[^.]*Contents: Read and write/, 'в ARCHITECTURE.md не названы права токена lancible-updates');
  const fn = flat(read('supabase/functions/README.md'));
  assert.ok(fn.includes('GITHUB_RELEASE_TOKEN'), 'в README функций нет GITHUB_RELEASE_TOKEN');
  assert.match(fn, /Actions: Read and write/, 'в README функций не названы права токена выпуска');
});

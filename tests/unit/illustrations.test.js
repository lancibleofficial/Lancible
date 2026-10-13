// Иллюстрации пустых экранов. Запуск: npm run test:unit
//
// Сценки живут в одном месте — src/renderer/core/illustrations.js — и
// красятся только стилями: у формы класс-роль, заливку ей даёт styles.css из
// токенов темы. Здесь сторожится, что так и осталось: в сценках нет ни одного
// цвета и ни одного неизвестного класса, у каждого класса есть правило, а
// разметка и код зовут только те сценки, что есть, и не держат своих копий.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Art = require('../../src/renderer/core/illustrations.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('у каждой сценки — подложка, несколько форм и пятно акцента', () => {
  assert.ok(Art.ART_SCENES.length >= 3, `сценок: ${Art.ART_SCENES.length}`);
  for (const name of Art.ART_SCENES) {
    const shapes = Art.artShapes(name);
    assert.match(shapes, /^<\w+ class="es-plate"/, `${name}: первой лежит подложка`);
    assert.ok((shapes.match(/<(rect|circle|path)\b/g) || []).length >= 5, `${name}: сценка из нескольких форм`);
    assert.match(shapes, /class="es-mark\b/, `${name}: без акцента сценка выходит серой`);
  }
});

test('в сценках нет цвета: только классы, заливку даёт тема', () => {
  for (const name of Art.ART_SCENES) {
    const shapes = Art.artShapes(name);
    assert.doesNotMatch(shapes, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${name}: цвет числом`);
    assert.doesNotMatch(shapes, /\s(fill|stroke|style|color|opacity)=/, `${name}: оформление атрибутом, а не классом`);
    const used = [...shapes.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    const unknown = [...new Set(used)].filter((c) => !Art.ART_PARTS.includes(c));
    assert.deepEqual(unknown, [], `${name}: классы мимо списка частей`);
  }
});

test('у каждой части сценки есть правило в styles.css', () => {
  const css = read('src/renderer/styles.css');
  for (const part of Art.ART_PARTS) {
    assert.match(css, new RegExp(`\\.${part}(?![\\w-])[^{}]*\\{`), `нет правила для .${part}`);
  }
});

test('artSvg: рамка одна, картинка декоративная', () => {
  const svg = Art.artSvg('projects');
  assert.match(svg, /^<svg class="es-art" data-art="projects" viewBox="0 0 120 88" aria-hidden="true"/);
  assert.equal(Art.artSvg('нет-такой'), '');
});

test('разметка и код зовут только существующие сценки и не держат своих копий', () => {
  for (const page of ['src/renderer/index.html', 'web/index.html']) {
    const html = read(page);
    const slots = [...html.matchAll(/<svg class="es-art" data-art="([\w-]+)"[^>]*>(.*?)<\/svg>/g)];
    assert.ok(slots.length >= 2, `${page}: мест под сценку: ${slots.length}`);
    for (const [, name, inner] of slots) {
      assert.ok(Art.ART_SCENES.includes(name), `${page}: нет сценки «${name}»`);
      assert.equal(inner, '', `${page}: в <svg data-art="${name}"> формы вписаны руками — их вписывает paintArt()`);
    }
  }
  const app = read('src/renderer/app.js');
  for (const [, name] of app.matchAll(/\bart: '([\w-]+)'/g)) {
    assert.ok(Art.ART_SCENES.includes(name), `app.js: нет сценки «${name}»`);
  }
});

test('телефон берёт сценки побайтной копией, а не своими формами', () => {
  // С 11 октября 2026 у телефона те же сценки: файл в списке копий ядра
  // (побайтность сторожит mobile-core.test.js), а разметку разбирает и красит
  // из theme.js mobile/src/lib/art.js. Копия законна — это та же сценка. А
  // своих форм у телефона больше нет: шесть сценок, нарисованных сначала там
  // (mobile/src/lib/artScenes.js), переехали сюда, и файл ушёл.
  const sync = read('scripts/sync-mobile-core.js');
  assert.match(sync.match(/const FILES = \[([^\]]*)\]/)[1], /'illustrations\.js'/);
  assert.equal(read('mobile/src/core/illustrations.js'), read('src/renderer/core/illustrations.js'), 'копия на телефоне отстала — node scripts/sync-mobile-core.js');
  const art = read('mobile/src/lib/art.js');
  assert.match(art, /from '\.\.\/core\/illustrations\.js'/);
  assert.equal(fs.existsSync(path.join(ROOT, 'mobile', 'src', 'lib', 'artScenes.js')), false, 'свои сценки телефона — снова в отдельном файле');
  // Форм сценки (подложки-«камешка») нет ни в одном файле телефона, кроме копии ядра.
  const plate = Art.artShapes('projects').match(/d="([^"]+)"/)[1];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const owners = walk(path.join(ROOT, 'mobile', 'src'))
    .filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}core${path.sep}`) && !f.includes(`${path.sep}editor${path.sep}`))
    .filter((f) => fs.readFileSync(f, 'utf8').includes(plate))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(owners, [], 'формы сценок на телефоне — только из core/illustrations.js');
  // На всех трёх поверхностях — шесть сценок, нарисованных на телефоне, тоже.
  for (const name of ['tasks', 'filter', 'timer', 'search', 'tags', 'versions']) assert.ok(Art.ART_SCENES.includes(name), `нет сценки «${name}»`);
});

test('слова пустых экранов: каждый ключ empty.* где-то показан, мёртвых ключей нет', () => {
  // Шаг 2 (11 октября 2026) перевёл все пустые состояния веба и десктопа на
  // общую деталь, и часть старых строк осталась без мест: «Пока нет данных»
  // статистики не показывался нигде, «Сначала создайте проект» доски был
  // недостижим (доска — вкладка проекта), подпись «+ Новая» устарела.
  const { T } = require('../../src/renderer/core/i18n.js');
  const code = read('src/renderer/app.js') + read('src/renderer/index.html');
  const own = Object.keys(T.ru).filter((k) => k.startsWith('empty.'));
  assert.ok(own.length >= 10, `ключей empty.*: ${own.length}`);
  for (const k of own) assert.ok(code.includes(`'${k}'`) || code.includes(`"${k}"`), `${k}: в словаре есть, на экране — нет`);
  const gone = ['stats.empty', 'board.empty', 'sidebar.empty_default', 'sidebar.no_match', 'history.empty', 'version.empty_hint', 'search.start_typing'];
  for (const lang of Object.keys(T)) {
    assert.deepEqual(gone.filter((k) => k in T[lang]), [], `${lang}: мёртвые строки пустых экранов вернулись`);
  }
  assert.doesNotMatch(read('src/renderer/index.html'), /id="board-empty"/, 'пустой экран доски без проекта недостижим');
});

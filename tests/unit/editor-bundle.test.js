// Сборка редактора не отстала от исходников. Запуск: npm run test:unit
//
// src/renderer/editor.js и mobile/src/editor/editorBundle.js — результат
// scripts/build-editor.js, закоммиченный в репозиторий (почему — в шапке
// скрипта). В шапке обоих — отпечаток исходников: src/editor/*, core/doc.js,
// core/icons.js и раздел «Редактор» в styles.css. Поправили редактор и не собрали — тест
// красный, иначе десктоп, веб и телефон работали бы на старом коде, а набор
// оставался бы зелёным.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash, pdfHash, OUT_RENDERER, OUT_MOBILE, OUT_PDF, OUT_PDF_ASSET } = require('../../scripts/build-editor.js');

const stampOf = (file, name = 'lancible-editor') => {
  const head = fs.readFileSync(file, 'utf8').slice(0, 300);
  const m = head.match(new RegExp(`${name} ([0-9a-f]{16})`));
  return m ? m[1] : null;
};

test('сборка для десктопа и веба собрана из текущих исходников', () => {
  assert.equal(stampOf(OUT_RENDERER), hash(), 'редактор поправлен, а не собран: npm run build:editor');
});

test('сборка для телефона собрана из тех же исходников', () => {
  assert.equal(stampOf(OUT_MOBILE), hash(), 'редактор поправлен, а не собран: npm run build:editor');
});

test('сборка телефона несёт стили редактора и сам редактор', () => {
  const src = fs.readFileSync(OUT_MOBILE, 'utf8');
  assert.match(src, /export const EDITOR_CSS = "/);
  assert.match(src, /export const EDITOR_JS = "/);
  assert.match(src, /\.led-pm/, 'в стилях для телефона нет раздела редактора');
  assert.match(src, /#ledmodal-backdrop/, 'в стилях для телефона нет подложки окна редактора');
});

test('сборка кладётся в <script> телефона целиком: в ней нет «</script»', () => {
  // DocEditor.js вставляет редактор строкой внутрь <script>…</script>.
  // Подстрока «</script» в коде закрыла бы тег посреди редактора.
  assert.doesNotMatch(fs.readFileSync(OUT_RENDERER, 'utf8'), /<\/script/i);
});

// --- pdf.js отдельным файлом (17 октября 2026) ------------------------------------
//
// pdf.js с воркером весит 1,7 МБ, поэтому он не в editor.js, а рядом —
// src/renderer/editor-pdf.js (точка входа src/editor/pdfjs.js); редактор
// грузит его тегом <script> при первом PDF. У файла свой отпечаток: точка
// входа и версия pdfjs-dist.

test('pdf.js собран из текущей точки входа и версии pdfjs-dist', () => {
  assert.equal(stampOf(OUT_PDF, 'lancible-editor-pdf'), pdfHash(), 'editor-pdf.js отстал от src/editor/pdfjs.js или pdfjs-dist: npm run build:editor');
});

// Телефон (протокол 3, 17 октября 2026): тот же модуль ассетом
// mobile/assets/editor-pdf.txt — хозяин впрыскивает его в WebView по запросу
// pdf-module. Отстал ассет — на телефоне открывался бы старый модуль.
test('модуль PDF для телефона — mobile/assets/editor-pdf.txt, тот же файл и отпечаток', () => {
  assert.equal(stampOf(OUT_PDF_ASSET, 'lancible-editor-pdf'), pdfHash(), 'editor-pdf.txt отстал: npm run build:editor');
  assert.equal(fs.readFileSync(OUT_PDF_ASSET, 'utf8'), fs.readFileSync(OUT_PDF, 'utf8'), 'ассет телефона и editor-pdf.js разошлись');
});

test('pdf.js — только в editor-pdf.js: не в editor.js и не в сборке телефона', () => {
  const pdf = fs.readFileSync(OUT_PDF, 'utf8');
  assert.match(pdf, /var LancibleEditorPdf\s*=/, 'editor-pdf.js не ставит window.LancibleEditorPdf');
  assert.match(pdf, /pdfjsWorker/, 'в editor-pdf.js нет воркера pdf.js');
  for (const file of [OUT_RENDERER, OUT_MOBILE]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /pdfjsWorker|GlobalWorkerOptions/, `${path.basename(file)}: pdf.js попал в сборку редактора`);
  }
  assert.match(fs.readFileSync(OUT_RENDERER, 'utf8'), /editor-pdf\.js/, 'editor.js не знает, откуда грузить pdf.js');
});

test('шапки называют лицензию pdf.js: в коде её нет (legalComments: none)', () => {
  const head = (file) => fs.readFileSync(file, 'utf8').slice(0, 600);
  assert.match(head(OUT_PDF), /pdf\.js[^\n]*Apache License 2\.0/);
  for (const file of [OUT_RENDERER, OUT_MOBILE]) assert.match(head(file), /pdf\.js — Apache-2\.0/, path.basename(file));
});

test('editor-pdf.js доезжает до веба и десктопа', () => {
  const ROOT = path.join(__dirname, '..', '..');
  // Веб: sync-web-assets.js кладёт его рядом с editor.js, а подготовка
  // браузерных прогонов без него падает (tests/serve-built-web.js).
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'sync-web-assets.js'), 'utf8'), /'editor-pdf\.js'\), path\.join\(webDir, 'editor-pdf\.js'\)/);
  assert.ok(require('../serve-built-web.js').REQUIRED.includes('editor-pdf.js'));
  assert.match(fs.readFileSync(path.join(ROOT, 'web', '.gitignore'), 'utf8'), /^editor-pdf\.js\r?$/m, 'web/editor-pdf.js — сборка, в git ей не место');
  // Десктоп: установщик берёт src/** целиком, и исключения его не задевают.
  const { files } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build;
  assert.ok(files.includes('src/**/*'), 'build.files: нет src/**');
  assert.deepEqual(files.filter((f) => f.startsWith('!') && /editor|renderer\/\*/.test(f)), []);
});

test('оба index.html грузят собранный редактор и не грузят Quill', () => {
  for (const page of ['src/renderer/index.html', 'web/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', page), 'utf8');
    assert.match(html, /<script src="editor\.js"><\/script>/, `${page}: нет editor.js`);
    assert.doesNotMatch(html, /quill/i, `${page}: остался Quill`);
    assert.match(html, /img-src[^;]*blob:/, `${page}: без blob: в img-src картинки из хранилища не покажутся`);
  }
});

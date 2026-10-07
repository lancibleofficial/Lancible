// Сборка редактора не отстала от исходников. Запуск: npm run test:unit
//
// src/renderer/editor.js и mobile/src/editor/editorBundle.js — результат
// scripts/build-editor.js, закоммиченный в репозиторий (почему — в шапке
// скрипта). В шапке обоих — отпечаток исходников: src/editor/*, core/doc.js
// и раздел «Редактор» в styles.css. Поправили редактор и не собрали — тест
// красный, иначе десктоп, веб и телефон работали бы на старом коде, а набор
// оставался бы зелёным.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash, OUT_RENDERER, OUT_MOBILE } = require('../../scripts/build-editor.js');

const stampOf = (file) => {
  const head = fs.readFileSync(file, 'utf8').slice(0, 200);
  const m = head.match(/lancible-editor ([0-9a-f]{16})/);
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

test('оба index.html грузят собранный редактор и не грузят Quill', () => {
  for (const page of ['src/renderer/index.html', 'web/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', page), 'utf8');
    assert.match(html, /<script src="editor\.js"><\/script>/, `${page}: нет editor.js`);
    assert.doesNotMatch(html, /quill/i, `${page}: остался Quill`);
    assert.match(html, /img-src[^;]*blob:/, `${page}: без blob: в img-src картинки из хранилища не покажутся`);
  }
});

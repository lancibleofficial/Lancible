// Вставка адреса на выделенный текст (src/editor/plugins.js: singleUrl,
// linkOnPaste). Запуск: npm run test:unit
//
// Откуда взялось (17 октября 2026). Выделили слово, скопировали адрес,
// Ctrl+V — и слово пропадало, вместо него вставал адрес. Так ведут себя
// поля без оформления; в редакторе текста (Google Docs, Notion, Word) адрес
// на выделение — это ссылка: текст остаётся, на него ложится адрес. Без
// выделения вставка прежняя. В браузере то же проверяет
// tests/e2e/editor-menu.spec.js — и Ctrl+V, и «Вставить» из меню.
//
// Редактор — ES-модули; тест собирает нужные файлы esbuild-ом в CommonJS,
// как tests/unit/editor-host.test.js. DOM не нужен: хватает состояния.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', '..', 'src', 'editor');

const E = (() => {
  const entry = [
    "export * as plugins from './plugins.js';",
    "export { schema } from './schema.js';",
    "export { EditorState, TextSelection, NodeSelection, AllSelection } from 'prosemirror-state';",
  ].join('\n');
  const out = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: SRC, sourcefile: 'editor-paste-test.js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();

const { plugins, schema, EditorState, TextSelection, NodeSelection, AllSelection } = E;
const N = schema.nodes;

test('один адрес — http, https, mailto; края обрезаются', () => {
  assert.equal(plugins.singleUrl('https://example.com'), 'https://example.com');
  assert.equal(plugins.singleUrl('http://example.com/a?b=1#c'), 'http://example.com/a?b=1#c');
  assert.equal(plugins.singleUrl('  https://example.com/путь\n'), 'https://example.com/путь');
  assert.equal(plugins.singleUrl('mailto:hi@example.com'), 'mailto:hi@example.com');
  assert.equal(plugins.singleUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
});

test('не один адрес — null: текст, два адреса, перевод строки, чужая схема', () => {
  for (const v of [
    '', '   ', null, undefined, 'просто текст', 'example.com', 'www.example.com',
    'https://a.com https://b.com', 'https://a.com\nhttps://b.com', 'https://a.com\r\nещё',
    'смотрите https://example.com', 'https://', 'https:// example.com', 'http://[bad',
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'data:text/html,hi',
    'mailto:', 'mailto:кто-то',
  ]) assert.equal(plugins.singleUrl(v), null, JSON.stringify(v));
});

/** Абзац «Привет мир» и выделение from..to. */
function stateWith(from, to, doc) {
  const d = doc || schema.node('doc', null, [N.paragraph.create(null, schema.text('Привет мир'))]);
  const s = EditorState.create({ doc: d, schema });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to == null ? from : to)));
}

function run(cmd, state) {
  let next = null;
  const ok = cmd(state, (tr) => { next = state.apply(tr); });
  return { ok, state: next };
}

const linkOf = (state, pos) => {
  const m = schema.marks.link.isInSet(state.doc.nodeAt(pos).marks);
  return m ? m.attrs.href : null;
};

test('адрес на выделенный текст: текст остаётся, на нём ссылка', () => {
  // «мир» — с 8 по 11 (абзац начинается с 1).
  const r = run(plugins.linkOnPaste('https://example.com/mir'), stateWith(8, 11));
  assert.equal(r.ok, true);
  assert.equal(r.state.doc.textContent, 'Привет мир', 'текст не заменён адресом');
  assert.equal(linkOf(r.state, 8), 'https://example.com/mir');
  assert.equal(linkOf(r.state, 1), null, 'ссылка — только на выделенном');
});

test('ссылка на выделении меняется на новый адрес', () => {
  const first = run(plugins.linkOnPaste('https://old.example.com'), stateWith(1, 11)).state;
  const again = first.apply(first.tr.setSelection(TextSelection.create(first.doc, 1, 11)));
  const r = run(plugins.linkOnPaste('mailto:me@example.com'), again);
  assert.equal(r.ok, true);
  assert.equal(linkOf(r.state, 1), 'mailto:me@example.com');
});

test('без выделения, не один адрес, в коде, не текстом — вставка как раньше', () => {
  assert.equal(plugins.linkOnPaste('https://example.com')(stateWith(4)), false, 'курсор без выделения');
  assert.equal(plugins.linkOnPaste('https://a.com\nhttps://b.com')(stateWith(8, 11)), false, 'два адреса');
  assert.equal(plugins.linkOnPaste('слово')(stateWith(8, 11)), false, 'не адрес');
  const code = schema.node('doc', null, [N.code_block.create(null, schema.text('const x = 1'))]);
  assert.equal(plugins.linkOnPaste('https://example.com')(stateWith(2, 6, code)), false, 'в блоке кода ссылок нет');
  const s = stateWith(1);
  assert.equal(plugins.linkOnPaste('https://example.com')(s.apply(s.tr.setSelection(new AllSelection(s.doc)))), false, 'выделено всё');
  const hr = schema.node('doc', null, [N.paragraph.create(null, schema.text('a')), N.horizontal_rule.create(), N.paragraph.create()]);
  const hs = EditorState.create({ doc: hr, schema });
  const node = hs.apply(hs.tr.setSelection(NodeSelection.create(hs.doc, 3)));
  assert.equal(plugins.linkOnPaste('https://example.com')(node), false, 'выделен блок');
});

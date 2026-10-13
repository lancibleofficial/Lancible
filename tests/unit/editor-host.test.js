// Редактор без браузера: команды по имени, состояние для нативной панели,
// markdown-сокращения, Enter в чек-листе, масштаб. Запуск: npm run test:unit
//
// Откуда взялось (12 октября 2026, переработка редактора на телефоне). Панель
// телефона стала нативной: кнопки снаружи WebView зовут editor.exec(имя), а
// подсветку берут из сообщения «format» (src/editor/host.js, протокол — в
// DESIGN.md). Команда, которой нет в exec, на телефоне молча не работала бы —
// поэтому имена сверяются с панелью десктопа. Сокращения и Enter в пустом
// пункте — то, чем на телефоне пользуются вместо кнопок.
//
// Редактор — ES-модули с ProseMirror; тест собирает нужные файлы esbuild-ом
// (он уже есть: им собирается редактор) в один CommonJS-модуль. DOM не нужен:
// ProseMirror-состояние, правила ввода и клавиши работают без него, а там,
// где правилам нужен view, хватает подставного { state, dispatch }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'editor');

const E = (() => {
  const entry = [
    "export * as host from './host.js';",
    "export * as plugins from './plugins.js';",
    "export * as C from './commands.js';",
    "export { schema } from './schema.js';",
    "export { EditorState, TextSelection } from 'prosemirror-state';",
    "export { history } from 'prosemirror-history';",
  ].join('\n');
  const out = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: SRC, sourcefile: 'editor-host-test.js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();

const { host, plugins, C, schema, EditorState, TextSelection, history } = E;
const N = schema.nodes;

// --- подставной view: правила ввода и клавиши ------------------------------------

function makeView(doc, sel) {
  const rules = plugins.buildInputRules({ smartTypography: () => false, getLang: () => 'ru' });
  const keys = plugins.buildKeymaps();
  let state = EditorState.create({ doc: doc || undefined, schema, plugins: [rules, ...keys, history()] });
  if (sel != null) state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, sel)));
  const view = {
    state,
    composing: false,
    dispatch(tr) { view.state = view.state.apply(tr); },
    endOfTextblock: () => false,
  };
  /** Набор с клавиатуры: каждый знак сначала предлагается правилам ввода. */
  view.type = (text) => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      if (!rules.props.handleTextInput.call(rules, view, from, to, ch)) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    return view;
  };
  /** Клавиша — через наши клавиши, как её увидит ProseMirror. */
  view.press = (key) => {
    const code = { Enter: 13, Backspace: 8 }[key];
    const ev = { key, keyCode: code, which: code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    for (const k of keys) if (k.props.handleKeyDown(view, ev)) return view;
    return view;
  };
  return view;
}

const json = (v) => v.state.doc.toJSON().content;
const top = (v) => v.state.doc.firstChild;

// --- exec: все кнопки панели ------------------------------------------------------

/** Команды, которые знает веб-панель: кнопки строки (data-cmd), пункты меню
 *  групп (MENUS) и остров таблицы (data-tt). Группы — не команды, а меню. */
function toolbarIds() {
  const src = fs.readFileSync(path.join(SRC, 'toolbar.js'), 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/cmd\('(\w+)'\)/g)) ids.add(m[1]);
  for (const m of src.matchAll(/'data-tt': '(\w+)'/g)) ids.add(m[1]);
  const menus = /const MENUS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(menus, 'в toolbar.js не нашлось MENUS');
  for (const m of menus[1].matchAll(/'(\w+)'/g)) ids.add(m[1]);
  for (const group of ['format', 'insert', 'lists', 'more']) ids.delete(group);
  return [...ids];
}

test('exec знает каждую команду веб-панели: телефон зовёт их по имени', () => {
  const ids = toolbarIds();
  assert.ok(ids.length > 40, `команд панели слишком мало: ${ids.length}`);
  const missing = ids.filter((id) => !host.EXEC_NAMES.includes(id));
  assert.deepEqual(missing, [], 'этих команд панели нет в exec (src/editor/host.js: commands)');
});

test('exec знает перо: инструмент, цвет, толщину, отмену и «Готово»', () => {
  for (const id of ['annotate', 'inkTool', 'inkShape', 'inkColor', 'inkSize', 'inkUndo', 'inkRedo', 'inkDuplicate', 'inkDelete', 'inkHide', 'inkClear', 'inkDone']) {
    assert.ok(host.EXEC_NAMES.includes(id), `нет ${id}`);
  }
});

test('список «фокус не возвращать» называет только настоящие команды', () => {
  const stray = [...host.KEEP_FOCUS].filter((id) => !host.EXEC_NAMES.includes(id));
  assert.deepEqual(stray, []);
});

test('exec меняет документ: Ж, заголовок через block, чек-лист', () => {
  const v = makeView(null);
  v.type('слово');
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 6)));
  const ed = { view: v };
  const cmds = host.commands(ed);
  cmds.bold();
  assert.ok(C.formatState(v.state).strong, 'полужирный не включился');
  cmds.block('h2');
  assert.equal(top(v).type, N.heading);
  assert.equal(top(v).attrs.level, 2);
  cmds.block('text');
  assert.equal(top(v).type, N.paragraph);
  cmds.tasks();
  assert.equal(top(v).type, N.task_list);
  cmds.highlight();
  assert.equal(C.formatState(v.state).highlight, 'yellow', 'маркер без цвета — жёлтый');
  cmds.highlight();
  assert.equal(C.formatState(v.state).highlight, null, 'второй раз — снять');
  cmds.link('lancible.vercel.app');
  assert.equal(C.formatState(v.state).link, 'https://lancible.vercel.app');
});

// --- состояние для нативной панели -------------------------------------------------

function fakeEd(v, extra) {
  return Object.assign({
    view: Object.assign(v, { hasFocus: () => true, coordsAtPos: () => ({ top: 40, bottom: 60, left: 10, right: 10 }) }),
    editable: true, annotating: false, panel: null, zoom: 1,
    find: { dom: { hidden: true } },
    threads: () => [{ resolved: false }, { resolved: true }],
    settings: () => ({ ink: { tool: 'pen', shape: 'line', color: 'ink', size: 3, recent: ['ink'] } }),
  }, extra || {});
}

test('состояние для панели: то же, что у веб-панели, и сам редактор', () => {
  const v = makeView(null);
  v.type('# Заголовок');
  const st = host.toolbarState(fakeEd(v, { zoom: 1.5 }));
  for (const k of ['strong', 'em', 'underline', 'strike', 'link', 'textColor', 'highlight', 'block', 'list', 'quote', 'inTable', 'canUndo', 'canRedo']) {
    assert.ok(k in st, `нет ${k}`);
  }
  assert.equal(st.block, 'h1');
  assert.equal(st.canUndo, true);
  assert.equal(st.focused, true);
  assert.equal(st.zoom, 1.5);
  assert.equal(st.threads, 1);
  assert.doesNotThrow(() => JSON.stringify(st));
});

test('мост: format и caret — сразу, повтор того же — нет, хвост — по таймеру', async () => {
  const v = makeView(null);
  const sent = [];
  const ed = fakeEd(v);
  const bridge = new host.HostBridge(ed, (m) => sent.push(m));
  bridge.schedule();
  bridge.schedule();
  bridge.schedule();
  assert.deepEqual(sent.map((m) => m.type), ['format', 'caret']);
  assert.deepEqual(sent[1], { type: 'caret', top: 40, bottom: 60 });
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  assert.equal(sent.length, 2, 'то же состояние второй раз не шлётся');
  host.commands(ed).bold();
  bridge.schedule();
  assert.equal(sent.filter((m) => m.type === 'format').length, 2, 'включили полужирный — новое состояние');
  bridge.height(320);
  bridge.height(320);
  assert.deepEqual(sent.filter((m) => m.type === 'height'), [{ type: 'height', px: 320, height: 320 }]);
  bridge.ink();
  assert.deepEqual(sent.pop(), { type: 'ink', on: false, tool: 'pen', shape: 'line', color: 'ink', size: 3, recent: ['ink'], selected: 0 });
  bridge.destroy();
});

test('мост: сообщения хозяина доходят до редактора, чужие — нет', () => {
  const calls = [];
  const ed = {
    exec: (n, a) => calls.push(['exec', n, a]), setZoom: (z) => calls.push(['zoom', z]), setContent: (c) => calls.push(['content', c]),
    focus: () => calls.push(['focus']), blur: () => calls.push(['blur']), insertHostImage: (m) => calls.push(['image', m.dataUrl]),
    applyLink: (h, t) => calls.push(['link', h, t]),
  };
  const bridge = new host.HostBridge(ed, null);
  assert.equal(bridge.receive({ type: 'exec', name: 'bold' }), true);
  assert.equal(bridge.receive({ type: 'setZoom', zoom: 1.4 }), true);
  assert.equal(bridge.receive({ type: 'setContent', content: 1 }), true);
  assert.equal(bridge.receive({ type: 'focus' }), true);
  assert.equal(bridge.receive({ type: 'blur' }), true);
  assert.equal(bridge.receive({ type: 'insertImage', dataUrl: 'data:x' }), true);
  assert.equal(bridge.receive({ type: 'setLink', href: 'a.b', text: 'т' }), true);
  assert.equal(bridge.receive({ type: 'auth' }), false, 'auth разбирает страница DocEditor');
  assert.equal(bridge.receive(null), false);
  assert.deepEqual(calls, [['exec', 'bold', undefined], ['zoom', 1.4], ['content', 1], ['focus'], ['blur'], ['image', 'data:x'], ['link', 'a.b', 'т']]);
});

// --- масштаб и окно ---------------------------------------------------------------

test('масштаб текста: 0.8–2, с точностью до процента, мусор — 1', () => {
  assert.equal(host.clampZoom(0.5), 0.8);
  assert.equal(host.clampZoom(3), 2);
  assert.equal(host.clampZoom(1.234), 1.23);
  assert.equal(host.clampZoom('1.5'), 1.5);
  for (const bad of [null, undefined, 'x', NaN, 0, -1, Infinity]) assert.equal(host.clampZoom(bad), 1, String(bad));
});

test('окно WebView не масштабирует страницу, и сборка телефона отдаёт ту же строку', () => {
  assert.match(host.VIEWPORT, /user-scalable=no/);
  assert.match(host.VIEWPORT, /maximum-scale=1\b/);
  const bundle = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'editor', 'editorBundle.js'), 'utf8').slice(0, 2000);
  assert.ok(bundle.includes(`export const EDITOR_VIEWPORT = ${JSON.stringify(host.VIEWPORT)};`), 'npm run build:editor');
  assert.ok(bundle.includes(`export const EDITOR_PROTOCOL = ${host.PROTOCOL};`), 'npm run build:editor');
});

test('фото от хозяина data:-адресом — в Blob без fetch (политика страницы его не пускает)', async () => {
  const blob = host.dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(await host.dataUrlToBlob('data:text/plain,a%20b').text(), 'a b');
  assert.throws(() => host.dataUrlToBlob('https://x'));
});

test('адрес ссылки: схема, почта, якорь', () => {
  assert.equal(host.normalizeHref('example.com'), 'https://example.com');
  assert.equal(host.normalizeHref('a@b.co'), 'mailto:a@b.co');
  assert.equal(host.normalizeHref('http://x.y'), 'http://x.y');
  assert.equal(host.normalizeHref('#h'), '#h');
  assert.equal(host.normalizeHref('  '), '');
});

// --- markdown-сокращения в начале строки -------------------------------------------

test('сокращения: списки, чек-лист, заголовки, цитата', () => {
  const cases = [
    ['- пункт', N.bullet_list], ['* пункт', N.bullet_list], ['1. пункт', N.ordered_list],
    ['[] дело', N.task_list], ['[ ] дело', N.task_list], ['> цитата', N.blockquote],
  ];
  for (const [text, type] of cases) {
    const v = makeView(null).type(text);
    assert.equal(top(v).type, type, text);
    assert.equal(top(v).textContent, text.replace(/^(- |\* |1\. |\[ ?\] |> )/, ''), text);
  }
  for (const level of [1, 2, 3]) {
    const v = makeView(null).type(`${'#'.repeat(level)} Заголовок`);
    assert.equal(top(v).type, N.heading);
    assert.equal(top(v).attrs.level, level);
    assert.equal(top(v).textContent, 'Заголовок');
  }
});

test('сокращения: [x] — сразу отмеченный пункт', () => {
  const v = makeView(null).type('[x] готово');
  assert.equal(top(v).type, N.task_list);
  assert.equal(top(v).firstChild.attrs.checked, true);
});

test('сокращения: «- [ ] » — чек-лист, а не чек-лист внутри маркированного', () => {
  const v = makeView(null).type('- [ ] дело');
  assert.equal(v.state.doc.childCount, 1);
  assert.equal(top(v).type, N.task_list);
  assert.equal(top(v).childCount, 1);
  assert.equal(top(v).firstChild.firstChild.type, N.paragraph);
  assert.equal(top(v).textContent, 'дело');
});

test('сокращения: ``` с пробелом и ```язык с Enter — блок кода', () => {
  const a = makeView(null).type('``` ');
  assert.equal(top(a).type, N.code_block);
  const b = makeView(null).type('```js').press('Enter');
  assert.equal(top(b).type, N.code_block);
  assert.equal(top(b).attrs.language, 'js');
  assert.equal(top(b).textContent, '');
  b.type('let a');
  assert.equal(top(b).textContent, 'let a', 'курсор — внутри блока кода');
});

test('Backspace сразу после сокращения возвращает набранное', () => {
  const v = makeView(null).type('- ').press('Backspace');
  assert.equal(top(v).type, N.paragraph);
  assert.equal(top(v).textContent, '- ');
});

// --- Enter в чек-листе ---------------------------------------------------------------

test('Enter в пустом пункте чек-листа — выход из списка; новый пункт не отмечен', () => {
  const v = makeView(null).type('[x] первое').press('Enter');
  assert.equal(top(v).childCount, 2, 'Enter в конце пункта — новый пункт');
  assert.equal(top(v).lastChild.attrs.checked, false, 'новый пункт не отмечен');
  v.press('Enter');
  assert.deepEqual(json(v).map((n) => n.type), ['task_list', 'paragraph']);
  assert.equal(top(v).childCount, 1);
  assert.equal(v.state.selection.$from.parent.type, N.paragraph);
  v.type('текст');
  assert.equal(v.state.doc.lastChild.textContent, 'текст');
});

test('Enter в пустом пункте маркированного списка — тоже выход', () => {
  const v = makeView(null).type('- один').press('Enter').press('Enter');
  assert.deepEqual(json(v).map((n) => n.type), ['bullet_list', 'paragraph']);
});

test('splitItem: пустой пункт в середине чек-листа выходит из списка, разрезая его', () => {
  const doc = schema.node('doc', null, [schema.node('task_list', null, [
    schema.node('task_item', null, [schema.node('paragraph', null, [schema.text('a')])]),
    schema.node('task_item', null, [schema.node('paragraph')]),
    schema.node('task_item', null, [schema.node('paragraph', null, [schema.text('b')])]),
  ])]);
  // Позиция внутри пустого абзаца второго пункта: 1 (список) + 1+1+1+1 (пункт «a») + 1 (пункт) + 1 (абзац).
  const v = makeView(doc, 8);
  assert.equal(v.state.selection.$from.parent.content.size, 0);
  assert.equal(C.splitItem(v.state, v.dispatch), true);
  assert.deepEqual(json(v).map((n) => n.type), ['task_list', 'paragraph', 'task_list']);
});

// 13 октября 2026: телефон терял последние 150 мс набора, уходя со страницы.
// Страница держала правку 150 мс, а телефон сохраняет то, что уже получил:
// спросить страницу на уходе он не успевает — WebView размонтирован раньше,
// чем пришёл бы ответ. Теперь хозяину правка уходит сразу (своя задержка
// сохранения у телефона — 300 мс), десктоп и веб по-прежнему сливают серию.
test('правка: телефону (nativeToolbar) — сразу, десктопу и вебу — через 150 мс', () => {
  assert.equal(host.CHANGE_MS, 150);
  assert.equal(host.changeDelay(true), 0);
  assert.equal(host.changeDelay(false), host.CHANGE_MS);
  const src = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  assert.match(src, /this\.emitChange = debounce\([\s\S]*?, changeDelay\(this\.host\)\);/);
});

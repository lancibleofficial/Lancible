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
    "export * as G from './pdfgeom.js';",
    "export { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';",
    "export { history, undo } from 'prosemirror-history';",
    "export { GapCursor } from 'prosemirror-gapcursor';",
    "export { CellSelection } from 'prosemirror-tables';",
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

const { host, plugins, C, G, schema, EditorState, TextSelection, NodeSelection, history, undo, GapCursor, CellSelection } = E;
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

// 19 октября 2026, эмулятор: картинка в заметках догружается и растит документ,
// курсор под ней уезжает вниз, а хозяин держал прокрутку по старому caret —
// последняя строка уходила под парящую панель. Поменялась высота — курсор
// шлём заново; без фокуса и тот же — нет.
test('мост: высота поменялась — курсор заново, без фокуса и тот же — нет', async () => {
  const v = makeView(null);
  v.type('под картинкой');
  const sent = [];
  let at = { top: 40, bottom: 60 };
  let focus = true;
  const ed = fakeEd(v);
  ed.view.hasFocus = () => focus;
  ed.view.coordsAtPos = () => at;
  const bridge = new host.HostBridge(ed, (m) => sent.push(m));
  const carets = () => sent.filter((m) => m.type === 'caret');
  bridge.height(300);
  assert.equal(sent.length, 1, 'первая высота — не перемена: шлётся только height');
  bridge.schedule();
  assert.deepEqual(carets(), [{ type: 'caret', top: 40, bottom: 60 }]);
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  // Картинка выше курсора догрузилась: документ вырос, курсор ушёл вниз.
  at = { top: 240, bottom: 260 };
  bridge.height(500);
  assert.deepEqual(carets().pop(), { type: 'caret', top: 240, bottom: 260 }, 'вырос — caret с новым bottom');
  assert.ok(carets().pop().bottom > carets()[0].bottom, 'bottom ниже прежнего');
  assert.equal(carets().length, 2);
  // Высота ещё поменялась, а курсор там же — второй раз то же не шлётся.
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  bridge.height(540);
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  assert.equal(carets().length, 2, 'курсор не сдвинулся — повтора нет');
  // Внутри окна прореживания: хвост уходит по таймеру, а не теряется.
  bridge.schedule();
  at = { top: 300, bottom: 320 };
  bridge.height(600);
  assert.equal(carets().length, 2, 'окно прореживания ещё не кончилось');
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  assert.deepEqual(carets().pop(), { type: 'caret', top: 300, bottom: 320 });
  assert.equal(carets().length, 3);
  // Без фокуса в тексте курсор хозяину не нужен — ни при росте, ни при убыли.
  focus = false;
  at = { top: 500, bottom: 520 };
  bridge.height(900);
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  bridge.height(700);
  await new Promise((r) => setTimeout(r, host.THROTTLE_MS + 30));
  assert.equal(carets().length, 3, 'без фокуса caret не шлётся');
  // Фокус вернулся — курсор снова приходит, даже если высота та же.
  focus = true;
  bridge.height(800);
  assert.deepEqual(carets().pop(), { type: 'caret', top: 500, bottom: 520 });
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

// --- контекстная панель телефона (протокол 4, 18 октября 2026) ------------------------
//
// Островов у блоков на телефоне больше нет: их действия — в панели над
// клавиатурой, которую строит хозяин. Редактор говорит, что выделено
// (сообщение context), а кнопки панели зовут exec по именам протокола.

const p = (text) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const img = (attrs) => schema.node('image', Object.assign({ src: 'asset:a', alt: '' }, attrs || {}));
const docOf = (...nodes) => schema.node('doc', null, nodes);

/** Подставной редактор на документе, выделен узел в pos (NodeSelection). */
function nodeEd(doc, pos, extra) {
  const v = makeView(doc);
  if (pos != null) v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)));
  return fakeEd(v, extra);
}

const PROTOCOL_4 = [
  'deselect', 'deleteBlock',
  'imageAlign', 'imageWidth', 'imageCaption', 'imageAlt', 'imageReplace', 'imageDownload',
  'tableRowAdd', 'tableColAdd', 'tableRowDelete', 'tableColDelete', 'tableMerge', 'tableSplit', 'tableHeaderRow', 'tableChart',
  'chartEdit', 'drawingEdit',
  'pdfTool', 'pdfLayerColor', 'pdfLayerSize', 'pdfLayerBold', 'pdfLayerFront', 'pdfLayerBack', 'pdfLayerDelete',
];
const IN_PLACE = ['tableRowAdd', 'tableColAdd', 'tableRowDelete', 'tableColDelete', 'tableMerge', 'tableSplit', 'tableHeaderRow'];

test('протокол 5: картинки аккаунта — assets-adopt с ids и referenced, assets-forget с ответом assets-forgotten', async () => {
  assert.equal(host.PROTOCOL, 5);
  const calls = [];
  const ed = {
    adoptGuestAssets: (userId, which) => { calls.push(['adopt', userId, which]); return Promise.resolve(0); },
    forgetAssets: (userId) => { calls.push(['forget', userId]); return Promise.resolve(0); },
  };
  const bridge = new host.HostBridge(ed, () => {});
  assert.equal(bridge.receive({ type: 'assets-adopt', userId: 'U1' }), true);
  assert.equal(bridge.receive({ type: 'assets-adopt', userId: 'U1', ids: ['a', 'asset:b'] }), true);
  assert.equal(bridge.receive({ type: 'assets-adopt', userId: 'U1', referenced: true }), true);
  assert.equal(bridge.receive({ type: 'assets-forget', userId: 'U1' }), true);
  assert.deepEqual(calls, [
    ['adopt', 'U1', { referenced: false, ids: null }],
    ['adopt', 'U1', { referenced: false, ids: ['a', 'asset:b'] }],
    ['adopt', 'U1', { referenced: true, ids: null }],
    ['forget', 'U1'],
  ]);
  // Имена описаны там, где описан протокол.
  const design = fs.readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');
  for (const t of ["type:'assets-forget'", "type:'assets-forgotten'", 'ids:']) assert.ok(design.includes(t), `DESIGN.md: ${t}`);
});

test('протокол 4: каждое имя контекстной панели есть в exec; выделен блок — фокус не трогают', () => {
  assert.ok(host.PROTOCOL >= 4);
  const missing = PROTOCOL_4.filter((n) => !host.EXEC_NAMES.includes(n));
  assert.deepEqual(missing, [], 'нет в exec (host.js: commands)');
  for (const n of ['blockUp', 'blockDown']) assert.ok(host.EXEC_NAMES.includes(n), n);
  // «Назад», картинка, график, рисунок, PDF — клавиатуру не открывают.
  for (const n of PROTOCOL_4.filter((x) => !IN_PLACE.includes(x))) assert.ok(host.KEEP_FOCUS.has(n), `${n} — в KEEP_FOCUS`);
  // Строки и столбцы — правка на месте, как rowBelow: фокус остаётся в тексте.
  for (const n of IN_PLACE) assert.ok(!host.KEEP_FOCUS.has(n), n);
});

test('context: картинка — выравнивание, ширина в % полосы, подпись, описание', () => {
  const doc = docOf(p('до'), img({ alt: 'фото', width: 60, align: 'left' }), p('после'));
  const at = 4;
  assert.equal(doc.nodeAt(at).type, N.image);
  assert.deepEqual(host.contextState(nodeEd(doc, at)), { kind: 'image', state: { align: 'left', widthPct: 60, hasCaption: false, caption: '', alt: 'фото' } });
  const full = docOf(p('до'), img({ align: 'full', caption: 'подпись' }), p('после'));
  assert.deepEqual(host.contextState(nodeEd(full, at)).state, { align: 'full', widthPct: 100, hasCaption: true, caption: 'подпись', alt: '' }, 'текст подписи — хозяину: лист откроется с ним');
  // «Как есть» — ширину меряет редактор (картинка на экране); не знает — null.
  const natural = docOf(p('до'), img(), p('после'));
  assert.equal(host.contextState(nodeEd(natural, at, { imageWidthPct: (pos) => (pos === at ? 37 : 0) })).state.widthPct, 37);
  assert.equal(host.contextState(nodeEd(natural, at)).state.widthPct, null);
  assert.equal(host.contextState(fakeEd(makeView(natural, 2))), null, 'курсор в тексте — контекста нет');
});

test('context: таблица, график, рисунок; страница PDF и её слой', () => {
  const v = makeView(null);
  host.commands(fakeEd(v)).table({ rows: 3, cols: 2, header: true });
  assert.deepEqual(host.contextState(fakeEd(v)), { kind: 'table', state: { canMerge: false, canSplit: false, headerRow: true } });
  const chart = docOf(p('a'), schema.node('chart', { chart: null }), p('b'));
  assert.deepEqual(host.contextState(nodeEd(chart, 3)), { kind: 'chart', state: {} });
  const drawing = docOf(p('a'), schema.node('drawing'), p('b'));
  assert.deepEqual(host.contextState(nodeEd(drawing, 3)), { kind: 'drawing', state: {} });
  assert.deepEqual(host.contextState(fakeEd(makeView(drawing, 1), { activeDrawing: {} })), { kind: 'drawing', state: {} }, 'рисунок в правке');
  const page = (lines) => docOf(p('a'), schema.node('pdfpage', { src: 'asset:pdf', page: 1, w: 595, h: 842, preview: 'asset:png', overlays: [], lines }), p('b'));
  const line = { x: 50, y: 60, w: 200, h: 14, size: 12, text: 'Строка' };
  assert.deepEqual(host.contextState(nodeEd(page(null), 3)), { kind: 'pdfpage', state: { tool: null, hasLines: true } }, 'строки не распознаны — кнопка распознает');
  assert.deepEqual(host.contextState(nodeEd(page([]), 3)).state, { tool: null, hasLines: false }, 'скан: заменять нечего');
  const pv = { replacing: true, selectedLayer: () => null };
  assert.deepEqual(host.contextState(nodeEd(page([line]), 3, { pdfPageView: () => pv })).state, { tool: 'replace', hasLines: true });
  const text = G.normalizeOverlay({ id: 't1', type: 'text', x: 10, y: 10, w: 100, h: 20, text: 'т', font: { size: 14, weight: 'bold', color: 'red' } }, { w: 595, h: 842 });
  const layer = { replacing: false, selectedLayer: () => text };
  assert.deepEqual(host.contextState(nodeEd(page([line]), 3, { pdfPageView: () => layer })), {
    kind: 'pdflayer', state: { type: 'text', color: 'red', size: 14, bold: true, sizes: G.FONT_STEPS },
  });
  const rect = G.normalizeOverlay({ id: 'r1', type: 'rect', x: 10, y: 10, w: 100, h: 20, stroke: { color: 'blue', width: 4 } }, { w: 595, h: 842 });
  assert.deepEqual(G.layerContext(rect), { type: 'rect', color: 'blue', size: 4, bold: false, sizes: G.STROKE_STEPS });
  const white = G.normalizeOverlay({ id: 'w1', type: 'whiteout', x: 10, y: 10, w: 100, h: 20 }, { w: 595, h: 842 });
  assert.deepEqual(G.layerContext(white), { type: 'whiteout', color: null, size: null, bold: false, sizes: [] });
});

test('мост: context — при смене выделения, без повторов; ушёл — kind null; getState — заново', () => {
  const doc = docOf(p('до'), img({ width: 50 }), p('после'));
  const v = makeView(doc, 2);
  const sent = [];
  const ed = fakeEd(v);
  const bridge = new host.HostBridge(ed, (m) => sent.push(m));
  const contexts = () => sent.filter((m) => m.type === 'context');
  bridge.flushState();
  assert.deepEqual(contexts(), [], 'ничего не выделено — хозяин знает и так');
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 4)));
  bridge.flushState();
  bridge.flushState();
  assert.deepEqual(contexts(), [{ type: 'context', kind: 'image', state: { align: 'center', widthPct: 50, hasCaption: false, caption: '', alt: '' } }]);
  host.commands(ed).imageWidth(80);
  bridge.flushState();
  assert.equal(contexts().pop().state.widthPct, 80, 'ширина поменялась — новый context');
  host.commands(ed).imageCaption('Новая подпись');
  bridge.flushState();
  assert.deepEqual(contexts().pop().state, { align: 'center', widthPct: 80, hasCaption: true, caption: 'Новая подпись', alt: '' }, 'подпись поменялась — её текст хозяину');
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 2)));
  bridge.flushState();
  assert.deepEqual(contexts().pop(), { type: 'context', kind: null, state: null });
  const n = contexts().length;
  bridge.receive({ type: 'getState' });
  assert.equal(contexts().length, n + 1, 'getState — context заново');
  bridge.destroy();
});

test('exec картинки: выравнивание, ширина (и шире исходной), подпись, описание; выделение остаётся', () => {
  const v = makeView(docOf(p('до'), img(), p('после')));
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 4)));
  const cmds = host.commands(fakeEd(v));
  const attrs = () => v.state.doc.nodeAt(4).attrs;
  const stillSelected = () => v.state.selection instanceof NodeSelection && v.state.selection.node.type === N.image;
  assert.equal(cmds.imageAlign('right'), true);
  assert.equal(attrs().align, 'right');
  assert.ok(stillSelected(), 'после кнопки картинка выделена — панель не гаснет');
  cmds.imageWidth(150);
  assert.equal(attrs().width, 100, 'больше полосы — полоса');
  cmds.imageWidth(5);
  assert.equal(attrs().width, 10, 'меньше 10 % — 10');
  cmds.imageWidth('64.4');
  assert.equal(attrs().width, 64);
  assert.equal(cmds.imageWidth(null), false, 'без числа — ничего');
  cmds.imageAlign('full');
  assert.deepEqual([attrs().align, attrs().width], ['full', null], 'во всю ширину — ширину снимает');
  cmds.imageWidth(70);
  assert.deepEqual([attrs().align, attrs().width], ['center', 70], 'ширина у «во всю ширину» — по центру');
  cmds.imageAlign('wrap-left');
  assert.deepEqual([attrs().align, attrs().width], ['wrap-left', 40], 'обтекание — доля полосы по умолчанию');
  cmds.imageAlign('left');
  assert.deepEqual([attrs().align, attrs().width], ['left', null]);
  assert.equal(cmds.imageAlign('diagonal'), false);
  cmds.imageCaption('Подпись');
  cmds.imageAlt('  описание  ');
  assert.deepEqual([attrs().caption, attrs().alt], ['Подпись', 'описание']);
  assert.ok(stillSelected());
  undo(v.state, v.dispatch);
  assert.deepEqual([attrs().caption, attrs().alt], ['Подпись', ''], 'каждая кнопка — свой шаг отмены');
  // Текст под курсором — не картинка: команды картинки ничего не делают.
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 2)));
  assert.equal(cmds.imageAlign('center'), false);
  assert.equal(cmds.imageWidth(50), false);
});

test('exec таблицы: строки, столбцы, объединить, разделить, строка заголовков', () => {
  const v = makeView(null);
  const ed = fakeEd(v);
  const cmds = host.commands(ed);
  cmds.table({ rows: 2, cols: 2, header: true });
  const tableAt = () => { let at = -1; v.state.doc.forEach((n, pos) => { if (n.type === N.table) at = pos; }); return at; };
  const shape = () => { const t = v.state.doc.nodeAt(tableAt()); return [t.childCount, t.firstChild.childCount]; };
  const ctx = () => host.contextState(ed).state;
  cmds.tableHeaderRow();
  assert.equal(ctx().headerRow, false, 'строка заголовков снята');
  cmds.tableHeaderRow();
  assert.equal(ctx().headerRow, true);
  cmds.tableRowAdd();
  cmds.tableColAdd();
  assert.deepEqual(shape(), [3, 3]);
  cmds.tableRowDelete();
  cmds.tableColDelete();
  assert.deepEqual(shape(), [2, 2]);
  // Две ячейки первой строки — объединить, потом разделить.
  const at = tableAt();
  const first = v.state.doc.resolve(at + 2);
  const second = v.state.doc.resolve(at + 2 + v.state.doc.nodeAt(at + 2).nodeSize);
  v.dispatch(v.state.tr.setSelection(new CellSelection(first, second)));
  assert.equal(ctx().canMerge, true);
  assert.equal(cmds.tableMerge(), true);
  assert.equal(v.state.doc.nodeAt(at).firstChild.childCount, 1, 'две ячейки — одна');
  assert.equal(ctx().canSplit, true);
  assert.equal(cmds.tableSplit(), true);
  assert.equal(v.state.doc.nodeAt(at).firstChild.childCount, 2);
  assert.equal(ctx().canSplit, false);
});

test('«назад» (leaveBlock): курсор сразу за блоком; за блоком не текст — промежуток; документ цел', () => {
  const doc = docOf(p('до'), img(), p('после'));
  const v = makeView(doc);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 4)));
  assert.equal(C.leaveBlock()(v.state, v.dispatch), true);
  assert.ok(v.state.selection instanceof TextSelection);
  assert.equal(v.state.selection.$head.parent.textContent, 'после');
  assert.equal(v.state.selection.$head.parentOffset, 0, 'в начало следующего абзаца');
  assert.ok(v.state.doc.eq(doc), 'документ не изменился');
  // Картинка последней — курсор-промежуток после неё, абзац не вставляется.
  const last = docOf(p('до'), img());
  const w = makeView(last);
  w.dispatch(w.state.tr.setSelection(NodeSelection.create(w.state.doc, 4)));
  C.leaveBlock()(w.state, w.dispatch);
  assert.ok(w.state.selection instanceof GapCursor, 'промежуток за картинкой');
  assert.equal(w.state.selection.from, w.state.doc.content.size);
  assert.ok(w.state.doc.eq(last));
  // Курсор в таблице — за таблицу.
  const t = makeView(null);
  host.commands(fakeEd(t)).table({ rows: 2, cols: 2, header: false });
  assert.equal(C.leaveBlock()(t.state, t.dispatch), true);
  assert.equal(C.tableContext(t.state), null, 'из таблицы ушли');
  // Текст под курсором — уходить не из чего.
  assert.equal(C.leaveBlock()(makeView(docOf(p('текст')), 2).state), false);
});

test('deleteBlock: выделенный блок — он сам, в таблице — таблица, последний — пустой абзац', () => {
  const v = makeView(docOf(p('до'), img(), p('после')));
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 4)));
  assert.equal(C.deleteSelectedBlock(v.state, v.dispatch), true);
  assert.deepEqual(json(v).map((n) => n.type), ['paragraph', 'paragraph']);
  const only = makeView(docOf(img()));
  only.dispatch(only.state.tr.setSelection(NodeSelection.create(only.state.doc, 0)));
  C.deleteSelectedBlock(only.state, only.dispatch);
  assert.deepEqual(json(only).map((n) => n.type), ['paragraph'], 'документ не пустеет');
  const t = makeView(docOf(p('до')), 2);
  host.commands(fakeEd(t)).table({ rows: 2, cols: 2, header: false });
  assert.ok(json(t).some((n) => n.type === 'table'));
  C.deleteSelectedBlock(t.state, t.dispatch);
  assert.ok(!json(t).some((n) => n.type === 'table'), 'таблица удалена целиком');
});

test('blockUp и blockDown: выделенный блок — на место выше и ниже, остаётся выделенным', () => {
  const v = makeView(docOf(p('один'), img(), p('два')));
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 6)));
  const cmds = host.commands(fakeEd(v));
  const order = () => json(v).map((n) => (n.type === 'image' ? 'IMG' : n.content[0].text));
  assert.equal(cmds.blockUp(), true);
  assert.deepEqual(order(), ['IMG', 'один', 'два']);
  assert.equal(v.state.selection.node && v.state.selection.node.type, N.image);
  assert.equal(cmds.blockUp(), false, 'выше некуда');
  cmds.blockDown();
  cmds.blockDown();
  assert.deepEqual(order(), ['один', 'два', 'IMG']);
});


// --- номера блоков (bid) ------------------------------------------------------------
//
// 19 октября 2026: bid вложенного графика повторялся после «Дублировать»,
// дубля строки и вставки, и ответ хозяина по bid (receiveChart) правил первый
// экземпляр. Теперь bid не повторяется ни у одного блока.

test('bid не повторяется и у вложенных: дубль списка с графиком — у копии свои номера, у первого прежние', () => {
  const chart = (bid) => schema.node('chart', { bid, chart: null });
  const list = schema.node('bullet_list', { bid: 'L1' }, [schema.node('list_item', null, [schema.node('paragraph', null, schema.text('пункт')), chart('C1')])]);
  const doc = schema.node('doc', null, [list, schema.node('paragraph', { bid: 'P1' }, schema.text('хвост'))]);
  let state = EditorState.create({ doc, schema, plugins: [plugins.blockIds] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
  assert.ok(C.duplicateBlock(state, (tr) => { state = state.apply(tr); }));
  const bids = [];
  state.doc.descendants((n) => { if (n.attrs && n.attrs.bid) bids.push([n.type.name, n.attrs.bid]); });
  const charts = bids.filter(([t]) => t === 'chart').map(([, b]) => b);
  assert.equal(charts.length, 2);
  assert.equal(charts[0], 'C1', 'первый график — с прежним номером');
  assert.notEqual(charts[1], 'C1');
  assert.equal(new Set(bids.map(([, b]) => b)).size, bids.length, `номера повторяются: ${JSON.stringify(bids)}`);
  assert.equal(state.doc.firstChild.attrs.bid, 'L1', 'первый список — с прежним номером');
});

test('bid: верхний уровень первым — вложенная копия выше по документу номер блока верхнего уровня не забирает', () => {
  const doc = schema.node('doc', null, [
    schema.node('blockquote', { bid: 'Q1' }, [schema.node('paragraph', { bid: 'P2' }, schema.text('копия'))]),
    schema.node('paragraph', { bid: 'P2' }, schema.text('оригинал')),
    schema.node('table', { bid: 'T1' }, [schema.node('table_row', null, [
      schema.node('table_cell', null, [schema.node('chart', { bid: 'C9', chart: null })]),
      schema.node('table_cell', null, [schema.node('chart', { bid: 'C9', chart: null })]),
    ])]),
  ]);
  let state = EditorState.create({ doc, schema, plugins: [plugins.blockIds] });
  state = state.apply(state.tr.setMeta('led-init', true));
  assert.equal(state.doc.child(1).attrs.bid, 'P2', 'абзац верхнего уровня держит свой номер (за него держатся пометки)');
  assert.notEqual(state.doc.child(0).firstChild.attrs.bid, 'P2', 'у вложенной копии номер новый');
  const cells = [];
  state.doc.child(2).descendants((n) => { if (n.type.name === 'chart') cells.push(n.attrs.bid); });
  assert.equal(cells[0], 'C9');
  assert.ok(cells[1] && cells[1] !== 'C9', 'два графика в ячейках (дубль строки) — разные номера');
  // Второй прогон ничего не меняет.
  const again = state.apply(state.tr.setMeta('led-init', true));
  assert.ok(again.doc.eq(state.doc));
});

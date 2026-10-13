// «Время работы» в вебе и на десктопе: то, что видно в исходниках. Запуск:
// npm run test:unit
//
// Правила отрезков (вхождения, повтор, напоминания) — в tests/unit/slots.test.js.
// Здесь — склейка с интерфейсом, которую иначе проверил бы только браузер:
// разметка у десктопа и веба одна (web/index.html пишется руками), кнопки,
// которые ищет код, в ней есть, а строки перевода есть на всех четырёх языках.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const { T } = require('../../src/renderer/core/i18n.js');

const desktop = read('src/renderer/index.html');
const web = read('web/index.html');
const app = read('src/renderer/app.js');

/** Кусок разметки от начала тега с таким id до закрывающего его </div>
 *  (пробелы между тегами не в счёт: отступы у двух файлов разные). */
function block(html, id) {
  const open = html.indexOf(`id="${id}"`);
  assert.ok(open > 0, `в разметке нет id="${id}"`);
  const start = html.lastIndexOf('<div', open);
  let depth = 0;
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length).replace(/>\s+</g, '><').trim();
  }
  throw new Error(`тег с id="${id}" не закрыт`);
}

/** Разметка свойств задачи: с 13 октября 2026 её собирает app.js
 *  (taskParamsHtml), а в обоих index.html стоит пустой #task-params. Здесь
 *  функция исполняется как есть, значки — пустые. */
function taskParamsMarkup() {
  const from = app.indexOf('function srowHtml(');
  const to = app.indexOf("document.getElementById('task-params').innerHTML");
  assert.ok(from > 0 && to > from, 'в app.js нет taskParamsHtml');
  return new Function('icon', `${app.slice(from, to)}; return taskParamsHtml();`)(() => '');
}
const panel = taskParamsMarkup();

test('свойства задачи и окно отрезка одинаковы в index.html десктопа и веба', () => {
  // Строка «Время работы» — в разметке свойств, которую собирает app.js: в
  // обоих index.html от неё только пустой #task-params.
  for (const id of ['task-props', 'sldlg-backdrop']) {
    assert.equal(block(web, id), block(desktop, id), `${id}: разметка веба разошлась с десктопом`);
  }
  assert.match(panel, /<button type="button" class="srow" id="slots-row">/);
});

test('окно отрезка — строки на острове, как лист отрезка на телефоне', () => {
  // Дата, начало и конец — строками «название · значение ›» (.srow) на одном
  // острове (.sgroup), длительность — подстрокой под концом; «Повторение
  // задачи» — своим островом ниже. Пары кнопок «Начало / Конец» больше нет.
  const dlg = block(desktop, 'sldlg-backdrop');
  const rows = [...dlg.matchAll(/<button type="button" class="srow" id="([a-z-]+)">/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['sldlg-date-btn', 'sldlg-start-btn', 'sldlg-end-btn', 'sldlg-repeat-row']);
  assert.equal((dlg.match(/class="sgroup/g) || []).length, 2, 'два острова: часы и повторение');
  assert.match(dlg, /<span class="srow-sub" id="sldlg-dur">/, 'длительность — подстрокой под концом');
  assert.doesNotMatch(dlg, /sdlg-times|linklike/, 'остались кнопки-пары или ссылка');
  assert.match(dlg, /id="sldlg-delete" class="danger sldlg-delete"/);
});

test('каждый id отрезка, который ищет код, есть в обеих разметках', () => {
  const ids = [...new Set([...app.matchAll(/\$\('((?:slot|sldlg)[a-z-]*|rpdlg-title|rp-from-field)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 10, `id в коде найдено ${ids.length}`);
  for (const [name, html] of [['десктоп', desktop], ['веб', web]]) {
    const missing = ids.filter((id) => !html.includes(`id="${id}"`) && !panel.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${name}: код ищет id, которых нет в разметке`);
  }
});

test('окно отрезка стоит среди подложек: центруется общим правилом и лежит выше окна задачи', () => {
  assert.match(desktop, /id="sldlg-backdrop"/);
  const css = read('src/renderer/styles.css');
  // Общий селектор — один, в нём перечислены все подложки (см. ui-rules.test.js);
  // здесь только то, что отрезок в нём назван и поверх окна задачи (100).
  assert.match(css, /#rpdlg-backdrop, #sldlg-backdrop,/);
  assert.match(css, /#sldlg-backdrop \{ z-index: (\d+); \}/);
  const z = (id) => Number((css.match(new RegExp(`#${id} \\{ z-index: (\\d+); \\}`)) || [])[1]);
  assert.ok(z('sldlg-backdrop') > 100, 'окно отрезка ниже окна задачи');
  assert.ok(z('rpdlg-backdrop') > z('sldlg-backdrop'), 'окно повторения ниже окна отрезка, из которого его зовут');
});

const NEW_KEYS = [
  'slot.label', 'slot.add', 'slot.none', 'slot.end_before_start', 'slot.with_task_repeat',
  'repeat.dialog_title', 'notif.slot', 'agenda.planned', 'repeat.returns', 'repeat.moved_slot',
];

test('новые строки есть на всех четырёх языках', () => {
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    for (const key of NEW_KEYS) assert.ok(T[lang][key], `${lang}: нет строки ${key}`);
    // Правило задачи словами подставляется в середину фразы.
    assert.match(T[lang]['slot.with_task_repeat'], /\{rule\}/, `${lang}: в slot.with_task_repeat нет {rule}`);
  }
});

test('у отрезка нет своего повтора: окно говорит про правило задачи и даёт ссылку на её окно', () => {
  // Правило одно, task.repeat; отрезок — дата и часы. Выбора повтора в окне
  // отрезка нет, режима «повтор отрезка» у окна повторения тоже.
  for (const [name, html] of [['десктоп', desktop], ['веб', web]]) {
    for (const id of ['sldlg-repeat-btn', 'sldlg-repeat-label', 'sldlg-repeat-link', 'slot-hint']) {
      assert.ok(!html.includes(`id="${id}"`), `${name}: в окне отрезка остался #${id}`);
    }
    for (const id of ['sldlg-repeat-note', 'sldlg-repeat-row']) {
      assert.ok(html.includes(`id="${id}"`), `${name}: в разметке нет #${id}`);
    }
    assert.match(block(html, 'sldlg-backdrop'), /data-i18n="repeat\.dialog_title"/);
  }
  // Подсказки «повторяются с задачей» у строки больше нет: правило видно своей
  // строкой «Повторение» рядом. Ключи прежних чипов ушли из словаря.
  for (const key of ['slot.repeats_with_task', 'slot.task_repeat_link', 'slot.once', 'slot.edit', 'slot.delete']) {
    for (const lang of Object.keys(T)) assert.equal(T[lang][key], undefined, `${lang}: ключ ${key} остался`);
  }
  for (const gone of ['sldlgRepeatBtn', 'setSlotRepeat', 'slotMode']) {
    assert.doesNotMatch(app, new RegExp(`\\b${gone}\\b`), `в app.js остался ${gone}`);
  }
  assert.doesNotMatch(app, /sldlg\.repeat\b/, 'в черновике окна отрезка снова есть repeat');
  assert.doesNotMatch(app, /rpdlg\.slot\b/, 'у окна повторения снова есть режим отрезка');
  assert.match(app, /function openRepeatDialog\(task\) \{/);
  // В запись отрезка повтор не пишется: ни при сохранении окна, ни в подписи.
  for (const fn of ['saveSlotDialog', 'slotLabel']) {
    const body = (app.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`)) || [''])[0];
    assert.ok(body, `${fn} не найдена`);
    assert.doesNotMatch(body, /\brepeat\b/, `${fn}: повтор снова пишется в отрезок`);
  }
});

test('«нужен дедлайн» больше нигде не требуется: ключа нет ни в коде, ни в словаре', () => {
  assert.doesNotMatch(app, /repeat\.needs_due/);
  for (const lang of Object.keys(T)) assert.equal(T[lang]['repeat.needs_due'], undefined, `${lang}: ключ остался`);
});

test('переключатель уведомлений называется «Напоминания» на всех языках', () => {
  // С дедлайнами и напоминаниями без них и отрезками «времени работы» он
  // говорит уже не только о дедлайнах.
  assert.deepEqual(
    ['ru', 'en', 'uk', 'kk'].map((l) => T[l]['notif.enable']),
    ['Напоминания', 'Reminders', 'Нагадування', 'Еске салулар'],
  );
  assert.match(desktop, /data-i18n="notif\.enable">Напоминания</);
  assert.match(web, /data-i18n="notif\.enable">Напоминания</);
});

test('каждый перевод, который просит app.js буквой, есть в словаре', () => {
  // Пропущенный ключ не роняет приложение: t() молча показывает сам ключ, и
  // «slot.add» на кнопке видно только в том языке и на том экране.
  const keys = [...new Set([...app.matchAll(/\bt\(\s*'([a-z0-9_]+\.[a-z0-9_.]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length > 150, `ключей найдено ${keys.length}`);
  const missing = keys.filter((k) => !(k in T.ru));
  assert.deepEqual(missing, [], 'ключи, которых нет в словаре');
});

// --- окна держат id задачи ---------------------------------------------------

/** Функция верхнего уровня из app.js текстом: от «function name(» до первой
 *  закрывающей скобки в начале строки. */
function fnSource(name) {
  const from = app.indexOf(`\nfunction ${name}(`);
  assert.ok(from >= 0, `в app.js нет function ${name}`);
  return app.slice(from, app.indexOf('\n}\n', from + 1) + 3);
}
/** Объявление `const name = …;` из app.js целиком. */
function constSource(name) {
  const m = app.match(new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `в app.js нет const ${name}`);
  return m[0];
}

test('окна повторения, отрезка и напоминания пишут в живую задачу, а не в прежний объект', () => {
  // Приём облака (applyRemoteData) кладёт в state.tasks новые объекты. Окно,
  // державшее прежний, на «Сохранить» писало в него — правка молча пропадала.
  for (const dlg of ['rpdlg', 'sldlg', 'rmdlg']) {
    assert.doesNotMatch(app, new RegExp(`\\b${dlg}\\.task\\b`), `${dlg} держит саму задачу`);
  }
  const src = [
    constSource('getTask'), constSource('sldlg'), constSource('rmdlg'), fnSource('dialogTask'),
    fnSource('openSlotDialog'), fnSource('closeSlotDialog'), fnSource('saveSlotDialog'),
    fnSource('openReminderDialog'), fnSource('closeReminderDialog'), fnSource('saveReminderDialog'),
  ].join('\n');
  const state = { tasks: [] };
  const el = {
    sldlgBackdrop: { hidden: true }, sldlgDelete: {}, rmdlgBackdrop: { hidden: true }, rmdlgDelete: {},
    rmKindSeg: { querySelector: () => null },
  };
  const Core = { normalizeSlot: (s) => s, describeReminder: () => null, slotsOf: () => [], remindersOf: () => [] };
  const writes = [];
  const toasts = [];
  const noop = () => {};
  const d = new Function(
    'state', 'el', 'Core', 'uid', 'toast', 't', 'putSlot', 'applyReminders', 'reminderFromDialog',
    'renderSlotDialog', 'renderReminderDialog', 'closeDatePicker', 'closeTimePicker', 'ensureNotifPermission',
    `${src}\nreturn { openSlotDialog, saveSlotDialog, openReminderDialog, saveReminderDialog };`,
  )(
    state, el, Core, () => 'new', (m) => toasts.push(m), (k) => k,
    (task) => writes.push(['slot', task]), (task) => writes.push(['reminder', task]),
    () => ({ kind: 'at', at: '2026-10-14T09:00:00.000Z' }), noop, noop, noop, noop, noop,
  );

  for (const [kind, open, save, backdrop] of [
    ['slot', d.openSlotDialog, d.saveSlotDialog, el.sldlgBackdrop],
    ['reminder', d.openReminderDialog, d.saveReminderDialog, el.rmdlgBackdrop],
  ]) {
    writes.length = 0;
    toasts.length = 0;
    state.tasks = [{ id: 'a', title: 'A' }];
    open(state.tasks[0], null);
    state.tasks = state.tasks.map((x) => ({ ...x })); // то же облако — новые объекты
    save();
    assert.equal(writes.length, 1, kind);
    assert.equal(writes[0][1], state.tasks[0], `${kind}: правка — в задачу из state.tasks`);

    // Задачу удалили на другом устройстве, пока окно было открыто.
    writes.length = 0;
    open(state.tasks[0], null);
    state.tasks = [];
    save();
    assert.deepEqual(writes, [], `${kind}: исчезнувшей задаче не пишем`);
    assert.equal(backdrop.hidden, true, `${kind}: окно закрыто`);
    assert.deepEqual(toasts, ['sync.updated_toast'], `${kind}: и сказано почему`);
  }
});

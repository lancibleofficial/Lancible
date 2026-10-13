// «Напоминания» в вебе и на десктопе: то, что видно в исходниках. Запуск:
// npm run test:unit
//
// Правила списка (вхождения, отметки, зеркало старых полей) — в
// tests/unit/reminders.test.js. Здесь — склейка с интерфейсом, которую иначе
// проверил бы только браузер: разметка десктопа и веба одна (web/index.html
// пишется руками), id, которые ищет код, в ней есть, строки перевода есть на
// четырёх языках, а старого интерфейса напоминания — меню у дедлайна, поля
// «Своё время» и выбора в окне отрезка — не осталось ни в разметке, ни в коде.
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
const css = read('src/renderer/styles.css');
const LANGS = ['ru', 'en', 'uk', 'kk'];

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

test('группа «Напоминания» — в общей разметке свойств, окно напоминания одинаково в обоих index.html', () => {
  // Строки напоминаний рисует renderTaskReminders в остров #remind-row; сам
  // остров и подпись группы — в разметке свойств (одна, из app.js).
  assert.match(panel, /<div class="sgroup-label" data-i18n="remind\.label"><\/div><div class="sgroup" id="remind-row"><\/div>/);
  assert.equal(block(web, 'task-props'), block(desktop, 'task-props'), 'task-props: разметка веба разошлась с десктопом');
  assert.equal(block(web, 'rmdlg-backdrop'), block(desktop, 'rmdlg-backdrop'), 'rmdlg-backdrop: разметка веба разошлась с десктопом');
});

test('каждый id напоминаний, который ищет код, есть в обеих разметках', () => {
  const ids = [...new Set([...app.matchAll(/\$\('((?:remind|rm|rmdlg)[a-z-]*)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 15, `id в коде найдено ${ids.length}`);
  for (const [name, html] of [['десктоп', desktop], ['веб', web]]) {
    const missing = ids.filter((id) => !html.includes(`id="${id}"`) && !panel.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${name}: код ищет id, которых нет в разметке`);
  }
});

test('напоминание в свойствах — строка (.srow), её щелчок открывает окно напоминания', () => {
  // Чипов с меню «Изменить… · Удалить» больше нет: строка открывает окно
  // сразу, удаление — кнопкой в окне. «Добавить напоминание» — последняя строка.
  const body = (app.match(/function renderTaskReminders\(task\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert.ok(body, 'renderTaskReminders не найдена');
  assert.match(body, /srow remind-item/);
  assert.match(body, /openReminderDialog\(task, rem\)/);
  assert.match(body, /add\.id = 'remind-add'/);
  assert.doesNotMatch(body, /openMenu|remind-chip/);
});

test('окно напоминания стоит среди подложек: центруется общим правилом, меню и пикеры выше него', () => {
  assert.match(desktop, /id="rmdlg-backdrop"/);
  // Общий селектор — один, в нём перечислены все подложки (см. ui-rules.test.js).
  assert.match(css, /#rpdlg-backdrop, #sldlg-backdrop, #rmdlg-backdrop,/);
  const z = (id) => Number((css.match(new RegExp(`#${id} \\{ z-index: (\\d+); \\}`)) || [])[1]);
  assert.ok(z('rmdlg-backdrop') > 100, 'окно напоминания ниже окна задачи');
  // Пикеры даты и времени (.dp-pop, .tp-pop) и меню открываются из этого окна.
  const pop = Number((css.match(/\.dp-pop \{[^}]*z-index: (\d+)/) || [])[1]);
  assert.ok(pop > z('rmdlg-backdrop'), 'пикер даты ниже окна напоминания');
});

test('окно напоминания — окно повторения: те же сегменты, дни недели и поле числа', () => {
  const dlg = block(desktop, 'rmdlg-backdrop');
  assert.match(dlg, /class="modal modal-lg rpdlg rmdlg"/);
  assert.match(dlg, /class="rp-days" id="rm-days"/);
  assert.match(dlg, /class="rp-num"/);
  assert.doesNotMatch(dlg, /<select/);
});

test('у напоминания три вида и два якоря — в разметке окна', () => {
  const dlg = block(desktop, 'rmdlg-backdrop');
  for (const kind of ['before', 'at', 'repeat']) assert.match(dlg, new RegExp(`data-kind="${kind}"`));
  for (const anchor of ['start', 'due']) assert.match(dlg, new RegExp(`data-anchor="${anchor}"`));
  for (const unit of ['min', 'hour', 'day']) assert.match(dlg, new RegExp(`data-unit="${unit}"`));
  for (const freq of ['day', 'week', 'month']) assert.match(dlg, new RegExp(`data-freq="${freq}"`));
});

// Ключи, что собираются в коде по шаблону (`remind.at_${side}`), в проверку
// «просит буквой» не попадают, поэтому названы здесь поимённо.
const KEYS = [
  'remind.label', 'remind.add',
  'remind.kind_before', 'remind.kind_at', 'remind.kind_repeat',
  'remind.anchor_start', 'remind.anchor_due', 'remind.at_start', 'remind.at_due',
  'remind.unit_min', 'remind.unit_hour', 'remind.unit_day',
  'remind.before_start_n', 'remind.before_due_n',
  'remind.daily_at', 'remind.weekly_at', 'remind.monthly_at',
  'remind.need_anchor', 'remind.custom_label', 'remind.too_long', 'remind.bad_number',
  'remind.month_day', 'remind.when',
  'notif.at_start', 'notif.before_start', 'notif.at_due', 'notif.before_due', 'notif.reminder_text',
];

test('строки напоминаний есть на всех четырёх языках', () => {
  for (const lang of LANGS) {
    for (const key of KEYS) assert.ok(T[lang][key], `${lang}: нет строки ${key}`);
  }
});

test('подписи со вставками держат все подстановки на всех языках', () => {
  const holes = {
    'remind.before_start_n': ['{n}', '{unit}'], 'remind.before_due_n': ['{n}', '{unit}'],
    'remind.daily_at': ['{time}'], 'remind.weekly_at': ['{days}', '{time}'], 'remind.monthly_at': ['{day}', '{time}'],
    'notif.at_start': ['{title}'], 'notif.at_due': ['{title}'], 'notif.reminder_text': ['{title}'],
    'notif.before_start': ['{n}', '{unit}', '{title}'], 'notif.before_due': ['{n}', '{unit}', '{title}'],
  };
  for (const lang of LANGS) {
    for (const [key, list] of Object.entries(holes)) {
      for (const hole of list) assert.ok(T[lang][key].includes(hole), `${lang}/${key}: нет ${hole}`);
    }
  }
});

test('каждый ключ напоминаний в словаре кому-то нужен: в коде или в разметке', () => {
  // Лишний ключ ничего не ломает и потому копится; смотрим только свои.
  const page = `${app}\n${desktop}\n${web}`;
  const dead = KEYS.filter((key) => {
    if (page.includes(`'${key}'`) || page.includes(`"${key}"`)) return false;
    // Собираются по шаблону: remind.at_${side}, remind.before_${side}_n,
    // notif.at_${side}, notif.before_${side}, remind.unit через REMIND_UNIT_KEY.
    return !/^(remind\.(at|before)_|notif\.(at|before)_|remind\.unit_)/.test(key);
  });
  assert.deepEqual(dead, [], 'ключи, которых никто не просит');
  for (const tpl of ['remind.at_${side}', 'remind.before_${side}_n', 'notif.at_${side}', 'notif.before_${side}']) {
    assert.ok(app.includes(tpl), `в коде нет шаблона ${tpl}, а ключи на него остались`);
  }
  for (const unit of ['remind.unit_min', 'remind.unit_hour', 'remind.unit_day']) {
    assert.ok(app.includes(`'${unit}'`), `${unit} не назван в REMIND_UNIT_KEY`);
  }
});

test('старого интерфейса напоминания нет: меню у дедлайна, «Своё время», выбор в окне отрезка', () => {
  for (const [name, html] of [['десктоп', desktop], ['веб', web]]) {
    for (const id of ['due-remind', 'due-custom-row', 'remind-date-btn', 'sldlg-remind-btn', 'sldlg-remind-label']) {
      assert.ok(!html.includes(`id="${id}"`), `${name}: в разметке остался #${id}`);
    }
    assert.doesNotMatch(html, /data-i18n="due\.remind_at"/);
  }
  for (const gone of ['dueRemind', 'dueCustomRow', 'remindDateBtn', 'sldlgRemindBtn', 'applyRemind',
    'slotRemindLabel', 'SLOT_REMIND', 'slotRemindersDue', 'legacyPendingReminders', 'DUE_REMIND_PRESETS',
    'REMIND_LABEL', 'remindKey', 'reminderTime']) {
    assert.doesNotMatch(app, new RegExp(`\\b${gone}\\b`), `в app.js остался ${gone}`);
  }
  // Ядро их тоже не отдаёт: ни меню у дедлайна, ни прежний движок отрезков.
  const due = require('../../src/renderer/core/due.js');
  const slots = require('../../src/renderer/core/slots.js');
  for (const gone of ['DUE_REMIND_PRESETS', 'REMIND_LABEL', 'remindKey', 'reminderTime']) {
    assert.ok(!(gone in due), `core/due.js снова отдаёт ${gone}`);
  }
  for (const gone of ['SLOT_REMIND_PRESETS', 'SLOT_REMIND_LABEL', 'slotRemindersDue', 'legacyPendingReminders']) {
    assert.ok(!(gone in slots), `core/slots.js снова отдаёт ${gone}`);
  }
  for (const key of ['due.remind_at', 'slot.remind_start', 'remind.none', 'remind.at', 'remind.15m', 'remind.1h',
    'remind.3h', 'remind.1d', 'remind.custom', 'remind.edit', 'remind.delete']) {
    for (const lang of LANGS) assert.equal(T[lang][key], undefined, `${lang}: ключ ${key} остался`);
  }
});

test('срабатывание идёт через ядро: remindersDue и markFired, а не поля задачи', () => {
  const body = (app.match(/function checkReminders\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert.ok(body, 'checkReminders не найдена');
  assert.match(body, /Core\.remindersDue\(/);
  assert.match(body, /Core\.markFired\(/);
  assert.doesNotMatch(body, /notifiedAt|reminderTime|slotRemindersDue/);
});

test('список правится только через withReminders: зеркало старых полей не забывается', () => {
  assert.match(app, /Core\.withReminders\(task, list\)/);
  // Прямых записей в старые поля из интерфейса не осталось: их пишет только
  // ядро. Исключение — пустые поля новой задачи.
  const writes = [...app.matchAll(/\btask\.(remindOffsetMin|remindAt)\s*=(?!=)/g)];
  assert.deepEqual(writes.map((m) => m[0]), [], 'app.js пишет старые поля напрямую');
});

// Круг правок веба 13 октября 2026: то, что видно в исходниках. Запуск:
// npm run test:unit
//
// Правая панель задачи — как на телефоне: статус и версия чипами, теги
// бейджами, остальное — группами строк «название · значение ›». Разметку
// свойств собирает app.js (taskParamsHtml), чтобы два index.html не
// расходились; здесь — что она одна, что в ней всё на месте, а старого
// (фишек, поля ставки, кнопки «Дублировать», двух колёс выбора времени) не
// осталось ни в разметке, ни в коде, ни в словаре. Поведение — в браузере:
// tests/e2e/task-panel.spec.js.
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
const PAGES = [['десктоп', desktop], ['веб', web]];

function taskParamsMarkup() {
  const from = app.indexOf('function srowHtml(');
  const to = app.indexOf("document.getElementById('task-params').innerHTML");
  assert.ok(from > 0 && to > from, 'в app.js нет taskParamsHtml');
  return new Function('icon', `${app.slice(from, to)}; return taskParamsHtml();`)((name) => `<svg data-icon="${name}"></svg>`);
}
const panel = taskParamsMarkup();

test('свойства задачи — одна разметка из app.js, в index.html только пустой #task-params', () => {
  for (const [name, html] of PAGES) {
    assert.match(html, /<div class="task-params" id="task-params"><\/div>/, `${name}: #task-params не пустой`);
    // Ни одной строки свойств руками в разметке страницы.
    for (const id of ['due-date-btn', 'slots-row', 'task-repeat', 'rate-row', 'task-statuses', 'remind-row']) {
      assert.ok(!html.includes(`id="${id}"`), `${name}: #${id} лежит в index.html, а не в разметке из app.js`);
    }
  }
});

test('группы и строки панели — в порядке телефона', () => {
  const labels = [...panel.matchAll(/class="sgroup-label"(?: id="[a-z-]+")? data-i18n="([a-z_.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['task.status_label', 'version.label', 'tag.pick', 'task.group_when', 'remind.label', 'task.group_more']);
  const rows = [...panel.matchAll(/<button type="button" class="srow" id="([a-z-]+)">/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['due-date-btn', 'slots-row', 'task-repeat', 'rate-row']);
  // Каждая строка — значок, название, значение и шеврон.
  for (const id of rows) {
    const row = panel.slice(panel.indexOf(`id="${id}"`), panel.indexOf('</button>', panel.indexOf(`id="${id}"`)));
    assert.match(row, /class="srow-label" data-i18n="[a-z_.]+"/, `${id}: нет названия`);
    assert.match(row, /class="srow-value" id="[a-z-]+"/, `${id}: нет значения`);
    assert.match(row, /data-icon="chevron-right"/, `${id}: нет шеврона`);
  }
  // Значки — как на телефоне: дедлайн — календарь, время работы — часы.
  assert.match(panel, /id="due-date-btn"><svg data-icon="calendar">/);
  assert.match(panel, /id="slots-row"><svg data-icon="clock">/);
  assert.match(panel, /id="task-repeat"><svg data-icon="refresh">/);
  assert.match(panel, /id="rate-row"><svg data-icon="wallet">/);
});

test('старой панели нет: фишки, поле ставки, чипы отрезков и напоминаний, «Дублировать»', () => {
  const gone = ['task-status', 'task-status-dot', 'task-version', 'task-rate', 'rate-unit', 'money-calc', 'due-state',
    'due-clear-btn', 'slot-add', 'slot-list', 'slot-hint', 'remind-list', 'duplicate-task-btn'];
  for (const [name, html] of PAGES) {
    for (const id of gone) assert.ok(!html.includes(`id="${id}"`), `${name}: остался #${id}`);
  }
  for (const id of gone) {
    assert.ok(!panel.includes(`id="${id}"`), `разметка свойств: остался #${id}`);
    assert.ok(!app.includes(`$('${id}')`), `app.js ищет #${id}`);
  }
  for (const cls of ['due-bar', 'money-bar', 'slot-chip', 'remind-chip', 'repeat-next']) {
    assert.ok(!new RegExp(`\\.${cls}\\b`).test(css), `styles.css: осталось .${cls}`);
  }
  assert.doesNotMatch(app, /\brepeatPresetItems\b|\bREPEAT_PRESET_KEY\b/, 'меню готовых правил повторения осталось');
});

test('низ панели — «Выполнено» и «Удалить»; «Дублировать» — в меню «⋯» задачи', () => {
  for (const [name, html] of PAGES) {
    const start = html.indexOf('<div class="task-actions">');
    const actions = html.slice(start, html.indexOf('</div>', start));
    assert.deepEqual([...actions.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]), ['task-done-btn', 'delete-task-btn'], name);
    assert.match(html, /<button type="button" id="task-more" class="icon-btn task-more" data-i18n-aria="task\.menu"/, `${name}: нет «⋯» задачи`);
  }
  assert.match(app, /openTaskMenu\(task, el\.taskMore, \{ toggle: true \}\)/);
  const menu = (app.match(/function openTaskMenu\([^)]*\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert.match(menu, /duplicateTask\(task\.id\)/, 'в меню задачи нет «Дублировать»');
});

test('меню «⋯» проекта — без «Редактировать…» и «Статусы и версии»: настройки — шестерёнкой', () => {
  const menu = (app.match(/function openProjectMenu\(p, anchor\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert.ok(menu, 'openProjectMenu не найдена');
  assert.doesNotMatch(menu, /project\.edit|board\.statuses|openStatusDialog/);
  for (const key of ['project.pin', 'project.unpin', 'project.duplicate', 'link.copy', 'project.excel', 'project.delete']) {
    assert.ok(menu.includes(`'${key}'`), `в меню нет ${key}`);
  }
  // На узком вебе шестерёнка не прячется: другого входа в настройки нет.
  assert.doesNotMatch(read('web/responsive.css'), /#board-statuses/);
});

test('выбор времени — один: поле и подсказки, двух колёс нет нигде', () => {
  for (const [name, html] of PAGES) {
    assert.match(html, /<input id="tp-input" class="field-sm tp-input"/, `${name}: нет поля времени`);
    assert.match(html, /<div class="tp-list" id="tp-list" role="listbox"/, `${name}: нет подсказок`);
    for (const id of ['tp-hours', 'tp-minutes', 'dp-hours', 'dp-minutes', 'dp-hours-pick', 'dp-minutes-pick']) {
      assert.ok(!html.includes(`id="${id}"`), `${name}: остался #${id}`);
    }
    assert.match(html, /id="dp-time-btn"/, `${name}: у окна даты нет кнопки времени`);
  }
  for (const gone of ['tpHours', 'tpMinutes', 'dpHours', 'dpMinutes', 'dpPickFrom', 'dpCommitTime', 'dpTimeValue']) {
    assert.doesNotMatch(app, new RegExp(`\\b${gone}\\b`), `app.js: остался ${gone}`);
  }
  assert.doesNotMatch(css, /\.tp-col\b|\.dp-combo\b|\.dp-tf\b/, 'styles.css: остались колёса или поля часов');
  assert.equal((app.match(/^function openTimePicker\(/gm) || []).length, 1, 'openTimePicker — одна');
  // Все места, где выбирают время, зовут её: запись (2), окно с календаря (2),
  // отрезок (2), напоминание, строка времени в окне даты (дедлайн, «один раз»).
  const calls = (app.match(/openTimePicker\(el\./g) || []).length;
  assert.ok(calls >= 8, `вызовов openTimePicker: ${calls}`);
  assert.match(app, /'\.tp-list'/, 'подсказки без накладной полосы (OVS_AREAS)');
});

test('валюта в настройках — та же строка-кнопка, что «Язык»', () => {
  // С 17 октября 2026 строки настроек — общие .srow (как SettingRow телефона);
  // валюта прячется в «личном» режиме (.if-money), язык — никогда.
  for (const [name, html] of PAGES) {
    assert.match(html, /<button type="button" class="srow" id="settings-lang-row">/, name);
    assert.match(html, /<button type="button" class="srow if-money" id="settings-currency-row">/, `${name}: валюта не строкой`);
    assert.match(html, /<span class="srow-value" id="settings-currency-value"><\/span>/, name);
    assert.ok(!html.includes('id="settings-currency"'), `${name}: осталась кнопка-поле валюты`);
  }
});

test('поле названия в окне тега — общее (.field), не системное', () => {
  for (const [name, html] of PAGES) assert.match(html, /<input id="tagdlg-name" class="field" type="text"/, name);
  // Названия статусов и версий в окне проекта — тоже общее компактное поле.
  assert.equal((app.match(/<input class="field-sm st-name" type="text"/g) || []).length, 2);
});

test('новые строки — на четырёх языках, прежние ушли из словаря', () => {
  const fresh = ['task.group_when', 'task.group_more', 'task.menu', 'slot.none', 'task.rate_project', 'rate.shared', 'rate.none', 'task.rate_dialog'];
  for (const lang of LANGS) {
    for (const key of fresh) assert.ok(T[lang][key], `${lang}: нет ${key}`);
    assert.match(T[lang]['task.rate_dialog'], /\{unit\}/);
    for (const key of ['task.rate_project', 'rate.shared']) assert.match(T[lang][key], /\{rate\}/, `${lang}/${key}`);
  }
  const page = `${app}\n${panel}\n${desktop}\n${web}`;
  for (const key of fresh) assert.ok(page.includes(`'${key}'`) || page.includes(`"${key}"`), `${key} никто не просит`);
  const dead = ['repeat.daily', 'repeat.weekly', 'repeat.monthly', 'repeat.yearly', 'repeat.weekdays_preset', 'repeat.custom',
    'version.manage', 'money.calc', 'money.no_rate', 'due.set', 'currency.title', 'project.edit'];
  for (const lang of LANGS) for (const key of dead) assert.equal(T[lang][key], undefined, `${lang}: ключ ${key} остался`);
});

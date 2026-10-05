// Сверка телефона с десктопом там, где общего файла нет. Запуск: npm run test:unit
//
// В ARCHITECTURE.md есть таблица «шва»: что делится побайтно, а что живёт в
// двух реализациях. Строки с «нет» опасны не тем, что код продублирован, а
// тем, что расхождение не видно: обе стороны работают, просто по-разному, и
// узнаёшь об этом из жалобы пользователя.
//
// После переноса format, money и tags в ядро сравнивать почти нечего — зато
// есть что стеречь: что телефон берёт ИМЕННО функции ядра, а не их двойников.
// Проверка «работает так же» пропустила бы заново написанную копию, проверка
// тождеством — нет.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CoreTags = require('../../src/renderer/core/tags.js');
const CoreFormat = require('../../src/renderer/core/format.js');
const CoreMoney = require('../../src/renderer/core/money.js');

const MOBILE = path.join(__dirname, '..', '..', 'mobile', 'src', 'lib');

/** Грузит ES-модуль телефона, подменив импорты: тащить сборщик ради сверки
 *  дороже, чем эти несколько строк (так же сделано в mobile-i18n.test.js). */
function loadMobile(file, stubs, names) {
  const src = fs.readFileSync(path.join(MOBILE, file), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, '');
  const keys = Object.keys(stubs);
  const body = `${src};return { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(...keys, body)(...keys.map((k) => stubs[k]));
}

// --- теги --------------------------------------------------------------------

test('теги на телефоне — это ровно функции ядра, а не их двойники', () => {
  const api = loadMobile(
    'tags.js',
    { Core: CoreTags },
    ['getTag', 'tagsOf', 'tagUsage', 'toggleTag', 'searchTags', 'nameTaken', 'exactMatch', 'keepKnown', 'badgeInk', 'badgeBg'],
  );
  for (const name of ['getTag', 'tagsOf', 'tagUsage', 'toggleTag', 'searchTags', 'nameTaken', 'exactMatch', 'keepKnown']) {
    assert.equal(api[name], CoreTags[name], `${name} на телефоне — не функция ядра`);
  }
  // А цветовые остались своими: на десктопе есть color-mix, в React Native нет.
  assert.equal(typeof api.badgeInk, 'function');
  assert.equal(typeof api.badgeBg, 'function');
  assert.equal(CoreTags.badgeInk, undefined, 'цветовым в ядре делать нечего');
});

// --- формат и деньги ---------------------------------------------------------

const NAMES = [
  'fmtClock', 'fmtShort', 'fmtDur', 'parseNum', 'hoursOf', 'capFirst', 'fmtDate', 'fmtTime',
  'effectiveRate', 'sessionRate', 'sessionMoney',
  'taskElapsedMs', 'earnedOf', 'fmtWhen',
  'fmtTimeShort', 'fmtDateShort', 'monthLabel', 'moneyFmt', 'fmtMoney', 'CURRENCY_SYMBOLS',
];
const mobile = loadMobile(
  'format.js',
  {
    CoreFormat,
    CoreMoney,
    LOCALE_MAP: { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', kk: 'kk-KZ' },
    t: (lang, key, params) => `${key}|${lang}|${params && params.time}`,
  },
  NAMES,
);

test('форматирование берётся у ядра, а не переписано заново', () => {
  for (const name of ['fmtClock', 'fmtShort', 'fmtDur', 'parseNum', 'hoursOf', 'capFirst', 'fmtDate', 'fmtTime']) {
    assert.equal(mobile[name], CoreFormat[name], `${name} — не функция ядра`);
  }
});

test('деньги берутся у ядра', () => {
  for (const name of ['effectiveRate', 'sessionRate', 'sessionMoney']) {
    assert.equal(mobile[name], CoreMoney[name], `${name} — не функция ядра`);
  }
});

test('обёртки подставляют «сейчас» и считают то же, что ядро', () => {
  // Ядру «сейчас» приходит параметром, чтобы результат можно было проверить;
  // телефону удобнее без него. Обёртка — единственное, что их различает.
  const now = Date.now();
  const task = { id: 't', totalMs: 5000, sessions: [{ ms: 3600000 }] };
  const idle = null;
  const running = { taskId: 't', startedAt: new Date(now - 60000).toISOString() };

  assert.equal(mobile.taskElapsedMs(task, idle), CoreFormat.taskElapsedMs(task, idle, now));
  assert.equal(mobile.earnedOf(task, 100, idle), CoreMoney.earnedOf(task, 100, idle, now));

  // С идущим таймером допускаем пару миллисекунд между двумя Date.now().
  const d1 = Math.abs(mobile.taskElapsedMs(task, running) - CoreFormat.taskElapsedMs(task, running, now));
  const d2 = Math.abs(mobile.earnedOf(task, 100, running) - CoreMoney.earnedOf(task, 100, running, now));
  assert.ok(d1 <= 50, `taskElapsedMs разошёлся на ${d1} мс`);
  assert.ok(d2 < 0.01, `earnedOf разошёлся на ${d2}`);
});

test('fmtWhen подставляет локаль и словарь телефона', () => {
  const today = new Date();
  today.setHours(14, 30, 0, 0);
  // Заглушка словаря отдаёт ключ, язык и подстановку — видно, что дошло всё.
  assert.equal(mobile.fmtWhen(today.toISOString(), 'kk'), 'session.today|kk|14:30');
  assert.match(mobile.fmtWhen('2020-03-04T14:30:00', 'ru'), /^04\.03 \d{2}:\d{2}$/);
});

// --- то, что осталось своим --------------------------------------------------

test('fmtTime и fmtTimeShort — разные вещи, и теперь это видно по имени', () => {
  // Раньше обе назывались fmtTime, и выгрузка с телефона отличалась от
  // десктопной: в отчёт уходило экранное ЧЧ:ММ вместо ЧЧ:ММ:СС. Теперь в
  // отчёт идёт функция ядра, а экранная зовётся иначе.
  const iso = '2026-06-10T14:30:05';
  assert.equal(mobile.fmtTime(iso), '14:30:05', 'в отчёт — с секундами, как в ядре');
  assert.equal(mobile.fmtTimeShort(iso, 'ru'), '14:30', 'на экран — без них');
  assert.equal(CoreFormat.fmtTimeShort, undefined, 'экранного формата в ядре нет и не нужно');
});

test('локальные форматы остались на телефоне', () => {
  assert.equal(typeof mobile.fmtDateShort, 'function');
  assert.equal(typeof mobile.monthLabel, 'function');
  assert.equal(mobile.CURRENCY_SYMBOLS.RUB, '₽');
  assert.equal(mobile.fmtMoney(1234.5, 'ru', 'KZT').endsWith('₸'), true);
});

test('список своего не разрастается молча', () => {
  // Если у телефона заведётся функция с именем из ядра, которой здесь нет, —
  // это новая необъявленная копия. Именно так однажды появилась вторая
  // реализация отчётов.
  const src = fs.readFileSync(path.join(MOBILE, 'format.js'), 'utf8');
  const single = [...src.matchAll(/^export (?:function|const) ([a-zA-Z0-9_]+)/gm)].map((m) => m[1]);
  const destructured = [...src.matchAll(/^export const \{([^}]+)\}/gm)]
    .flatMap((m) => m[1].split(',').map((x) => x.trim()))
    .filter(Boolean);
  const exported = [...single, ...destructured];

  const fromCore = exported.filter((n) => n in CoreFormat || n in CoreMoney);
  const wrapped = ['taskElapsedMs', 'earnedOf', 'fmtWhen'];
  const checked = [
    'fmtClock', 'fmtShort', 'fmtDur', 'parseNum', 'hoursOf', 'capFirst', 'fmtDate', 'fmtTime',
    'effectiveRate', 'sessionRate', 'sessionMoney',
  ];
  const unexplained = fromCore.filter((n) => !checked.includes(n) && !wrapped.includes(n));
  assert.deepEqual(unexplained, [], `необъявленные совпадения имён: ${unexplained.join(', ')}`);
});

// --- сроки и напоминания -----------------------------------------------------

const CoreDue = require('../../src/renderer/core/due.js');

const mobileDue = loadMobile(
  'due.js',
  {
    Core: CoreDue,
    t: (lang, key, params) => `${key}|${lang}|${params && params.n}`,
    fmtDateShort: (date, lang) => `дата|${lang}|${date.getDate()}`,
  },
  ['REMIND_PRESETS', 'REMIND_LABEL', 'remindKey', 'reminderTime', 'dueState', 'dueShort', 'notificationFeed'],
);

test('сроки на телефоне — это функции ядра, а не их двойники', () => {
  // До этого переноса здесь лежали дословные копии четырёх правил, причём два
  // из них уже были в ядре — просто спрятаны в money.js, где их никто не искал.
  for (const name of ['remindKey', 'reminderTime']) {
    assert.equal(mobileDue[name], CoreDue[name], `${name} — не функция ядра`);
  }
  assert.deepEqual(mobileDue.REMIND_PRESETS, CoreDue.REMIND_PRESETS);
  assert.deepEqual(mobileDue.REMIND_LABEL, CoreDue.REMIND_LABEL);
});

test('обёртки сроков подставляют «сейчас» и язык, не меняя правила', () => {
  const now = Date.now();
  const soon = { id: 'a', dueAt: new Date(now + 3600000).toISOString() };
  const later = { id: 'b', dueAt: new Date(now + 10 * 86400000).toISOString() };

  assert.equal(mobileDue.dueState(soon), CoreDue.dueState(soon, now));
  assert.equal(mobileDue.dueState(later), CoreDue.dueState(later, now));

  assert.deepEqual(
    mobileDue.notificationFeed([soon, later], null).map((n) => [n.task.id, n.kind]),
    CoreDue.notificationFeed([soon, later], null, now).map((n) => [n.task.id, n.kind]),
  );

  // Язык доходит до перевода и до формата даты — обе подстановки на месте.
  assert.equal(mobileDue.dueShort(soon, 'en'), 'due.today|en|undefined');
  assert.ok(mobileDue.dueShort(later, 'kk').startsWith('дата|kk|'));
});

// --- машинка перевода --------------------------------------------------------

const CoreLang = require('../../src/renderer/core/lang.js');

const mobileI18n = (() => {
  const src = fs.readFileSync(path.join(MOBILE, 'i18n.js'), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', 'Lang', `${src};module.exports = { T, LOCALE_MAP, LANG_NAMES, t, pluralForm };`)(box, CoreLang);
  return box.exports;
})();

test('карта локалей и названия языков — те же объекты, что в ядре', () => {
  assert.equal(mobileI18n.LOCALE_MAP, CoreLang.LOCALE_MAP);
  assert.equal(mobileI18n.LANG_NAMES, CoreLang.LANG_NAMES);
});

test('телефон не переписывает правило склонения заново', () => {
  // Проверка по тексту, а не по поведению: заново написанная копия вела бы
  // себя так же, и поведенческий тест её бы пропустил. Ровно этим правило и
  // разошлось в прошлый раз — комментарий про славянское правило лежал в
  // двух файлах слово в слово.
  // Комментарии вычёркиваем: в шапке файла как раз написано, что машинка
  // уехала в ядро, и искать там нечего. Проверка про код, а не про прозу.
  const src = fs.readFileSync(path.join(MOBILE, 'i18n.js'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  for (const mark of ['m100', 'славянское правило', 'n === 1 ? 0 : 1']) {
    assert.ok(!src.includes(mark), `в словаре телефона снова своя машинка: «${mark}»`);
  }
});

test('перевод и склонение на телефоне считают ровно то же, что ядро', () => {
  const { T } = mobileI18n;
  for (const lang of Object.keys(T)) {
    for (const key of ['nav.home', 'common.cancel', 'нет.такого.ключа']) {
      assert.equal(
        mobileI18n.t(lang, key),
        CoreLang.translate(T, lang, key),
        `${lang}/${key}: обёртка считает не то же, что ядро`,
      );
    }
    for (const n of [0, 1, 2, 5, 11, 21, 101]) {
      assert.equal(
        mobileI18n.pluralForm(lang, n, 'plural.task'),
        CoreLang.pluralForm(T, lang, n, 'plural.task'),
        `${lang}/${n}: форма слова расходится с ядром`,
      );
    }
  }
});

// --- справочники продукта ----------------------------------------------------

test('палитра и валюты на телефоне — те же объекты, что в ядре', () => {
  // Шестнадцать цветов и десять валют лежали в двух экземплярах. Добавить
  // валюту на одной стороне и забыть про другую было делом одной правки.
  const Catalog = require('../../src/renderer/core/catalog.js');
  const src = fs.readFileSync(path.join(MOBILE, 'migrate.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!code.includes("'#87ff65', '#5ec8f2'"), 'палитра снова переписана на телефоне');
  assert.ok(!/KGS:\s*'сом'/.test(code), 'валюты снова переписаны на телефоне');
  assert.ok(code.includes('Catalog'), 'телефон должен брать справочники из ядра');
  assert.equal(Catalog.PALETTE.length, 16);
});

// --- строка задачи ------------------------------------------------------------

test('строка задачи на телефоне берёт решения у ядра, а не принимает сама', () => {
  // Раньше TaskListItem сам решал, какие значки показать, и разошёлся с
  // десктопом молча: не было ни версии, ни значка повторения. Проверка по
  // тексту — поведенческий тест пропустил бы заново написанные решения,
  // если они совпадут с ядром сегодня и разойдутся завтра.
  const file = path.join(__dirname, '..', '..', 'mobile', 'src', 'components', 'TaskListItem.js');
  const code = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(code.includes('taskRowView'), 'строка должна звать taskRowView');
  for (const own of ['getStatus(', 'dueState(', 'dueShort(', 'taskElapsedMs(', 'normalizeRepeat(']) {
    assert.ok(!code.includes(own), `строка снова решает сама: «${own}»`);
  }
});

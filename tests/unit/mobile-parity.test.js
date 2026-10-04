// Сверка телефона с десктопом там, где общего файла нет. Запуск: npm run test:unit
//
// В ARCHITECTURE.md есть таблица «шва»: что делится побайтно, а что живёт в
// двух реализациях. Строки с «нет» опасны не тем, что код продублирован, а
// тем, что расхождение не видно: обе стороны работают, просто по-разному, и
// узнаёшь об этом из жалобы пользователя.
//
// Здесь стережётся то, что обязано совпадать. Что различается намеренно
// (мобильные строки короче, у даты есть «сегодня»), сюда не входит — и
// перечислено ниже, чтобы отличать умысел от недосмотра.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CoreTags = require('../../src/renderer/core/tags.js');
const CoreFormat = require('../../src/renderer/core/format.js');

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

// --- теги ------------------------------------------------------------------
// Телефон берёт их из побайтной копии ядра. Проверяем не «работает так же»,
// а «это те же самые функции»: иначе копия однажды снова заведётся.

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

// --- формат ----------------------------------------------------------------
// Общего файла тут нет и не будет: мобильный format.js — это ещё и деньги, и
// подписи вроде «сегодня». Но чистые функции обязаны давать одно и то же.

const mobileFormat = loadMobile(
  'format.js',
  {
    LOCALE_MAP: { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', kk: 'kk-KZ' },
    t: (lang, key) => key,
  },
  ['fmtClock', 'fmtShort', 'fmtDur', 'parseNum', 'hoursOf', 'capFirst', 'taskElapsedMs'],
);

const LANGS = ['ru', 'en', 'uk', 'kk'];
const MS = [0, 1, 999, 1000, 59_999, 60_000, 61_000, 3_599_999, 3_600_000, 3_661_000, 86_400_000, 123_456_789];

test('fmtClock даёт одно и то же на любом числе', () => {
  for (const ms of [...MS, -1, -100000]) {
    assert.equal(mobileFormat.fmtClock(ms), CoreFormat.fmtClock(ms), `разошлись на ${ms}`);
  }
});

test('fmtShort совпадает на всех языках — значит и таблица единиц совпадает', () => {
  // Единицы («ч», «h», «г», «сағ») лежат в обоих файлах отдельными таблицами.
  // Разойтись они могут молча, поэтому проходим все языки, а не только русский.
  for (const lang of [...LANGS, 'нет такого']) {
    for (const ms of MS) {
      assert.equal(
        mobileFormat.fmtShort(ms, lang), CoreFormat.fmtShort(ms, lang),
        `разошлись на ${ms} мс, язык ${lang}`,
      );
    }
  }
});

test('fmtDur совпадает: ноль пишется честным нулём, а не прочерком', () => {
  for (const lang of LANGS) {
    for (const ms of MS) {
      assert.equal(mobileFormat.fmtDur(ms, lang), CoreFormat.fmtDur(ms, lang), `разошлись на ${ms}, ${lang}`);
    }
  }
  assert.notEqual(CoreFormat.fmtDur(0, 'ru'), '—', 'fmtDur не прочерк — на этом держится сверка');
});

test('parseNum одинаково терпит запятую, пробелы и мусор', () => {
  const inputs = ['', '0', '12', '12,5', '12.5', '1 234', '1 234,56', ' 7 ', 'abc', '-5', '0,0', null, undefined, '1e3'];
  for (const v of inputs) {
    assert.equal(mobileFormat.parseNum(v), CoreFormat.parseNum(v), `разошлись на ${JSON.stringify(v)}`);
  }
});

test('hoursOf и capFirst совпадают', () => {
  for (const ms of MS) assert.equal(mobileFormat.hoursOf(ms), CoreFormat.hoursOf(ms));
  for (const s of ['', 'слово', 'ДВА слова', 'ß', '1абв']) {
    assert.equal(mobileFormat.capFirst(s), CoreFormat.capFirst(s), `разошлись на ${JSON.stringify(s)}`);
  }
});

test('taskElapsedMs: математика та же, но время берётся по-разному', () => {
  // Единственное известное расхождение в подписях. У ядра «сейчас» —
  // параметр, и его можно подставить в тесте; телефон зовёт Date.now() внутри
  // и потому непроверяем в заданный момент. Пока так, но считают они одно:
  // сверяем, подставив ядру то же самое «сейчас».
  const now = Date.now();
  const task = { id: 't1', totalMs: 5000 };
  const running = { taskId: 't1', startedAt: new Date(now - 60000).toISOString() };
  const other = { taskId: 'чужая', startedAt: new Date(now - 60000).toISOString() };

  assert.equal(mobileFormat.taskElapsedMs(task, null), CoreFormat.taskElapsedMs(task, null, now));
  assert.equal(mobileFormat.taskElapsedMs(task, other), CoreFormat.taskElapsedMs(task, other, now));
  // Идущий таймер: допускаем расхождение в пару миллисекунд между двумя
  // вызовами Date.now(), но не больше.
  const diff = Math.abs(mobileFormat.taskElapsedMs(task, running) - CoreFormat.taskElapsedMs(task, running, now));
  assert.ok(diff <= 50, `идущий таймер разошёлся на ${diff} мс`);
});

// --- деньги ----------------------------------------------------------------
// На десктопе это отдельный core/money.js, на телефоне они живут внутри
// format.js. Подписи совпадают, кроме earnedOf — там та же история с «сейчас».

const CoreMoney = require('../../src/renderer/core/money.js');
const mobileMoney = loadMobile(
  'format.js',
  { LOCALE_MAP: { ru: 'ru-RU' }, t: (lang, key) => key },
  ['effectiveRate', 'sessionRate', 'sessionMoney', 'earnedOf'],
);

const RATES = [0, 1, 100, 2000, 2500.5];
const TASKS = [
  { id: 't', totalMs: 0, sessions: [] },
  { id: 't', rate: 0, totalMs: 0, sessions: [] },          // своя ставка — ноль, а не «не задано»
  { id: 't', rate: 3000, totalMs: 0, sessions: [] },
  { id: 't', rate: null, totalMs: 0, sessions: [] },
];

test('ставка задачи считается одинаково, включая нулевую', () => {
  for (const task of TASKS) {
    for (const rate of RATES) {
      assert.equal(
        mobileMoney.effectiveRate(task, rate), CoreMoney.effectiveRate(task, rate),
        `разошлись на ставке ${rate}, задача ${JSON.stringify(task.rate)}`,
      );
    }
  }
});

test('ставка и деньги записи совпадают, в том числе у записи со своей ставкой', () => {
  const sessions = [
    { ms: 3600000 },
    { ms: 1800000, rate: 500 },
    { ms: 1800000, rate: 0 },
    { ms: 0 },
  ];
  for (const task of TASKS) {
    for (const rate of RATES) {
      for (const s of sessions) {
        assert.equal(mobileMoney.sessionRate(s, task, rate), CoreMoney.sessionRate(s, task, rate));
        assert.equal(mobileMoney.sessionMoney(s, task, rate), CoreMoney.sessionMoney(s, task, rate));
      }
    }
  }
});

test('earnedOf совпадает на закрытых записях', () => {
  // С идущим таймером не сверяем: у ядра «сейчас» — параметр, у телефона
  // Date.now() внутри, и это уже проверено на taskElapsedMs.
  const task = {
    id: 't',
    totalMs: 5400000,
    sessions: [{ ms: 3600000 }, { ms: 1800000, rate: 500 }],
  };
  for (const rate of RATES) {
    assert.equal(
      mobileMoney.earnedOf(task, rate, null), CoreMoney.earnedOf(task, rate, null, Date.now()),
      `разошлись на ставке ${rate}`,
    );
  }
});

test('список намеренных различий не разрастается молча', () => {
  // Если у телефона появилась функция с именем из ядра, которой здесь нет, —
  // это новая необъявленная копия, и её нужно либо сверить, либо объяснить.
  const mobileSrc = fs.readFileSync(path.join(MOBILE, 'format.js'), 'utf8');
  const mobileNames = [...mobileSrc.matchAll(/^export (?:function|const) ([a-zA-Z0-9_]+)/gm)].map((m) => m[1]);
  const shared = mobileNames.filter((n) => n in CoreFormat);

  const checked = ['fmtClock', 'fmtShort', 'fmtDur', 'parseNum', 'hoursOf', 'capFirst', 'taskElapsedMs'];
  // Намеренно разные: у телефона свои локали и подписи вроде «сегодня».
  const byDesign = ['fmtDate', 'fmtTime'];

  const unexplained = shared.filter((n) => !checked.includes(n) && !byDesign.includes(n));
  assert.deepEqual(unexplained, [], `новые необъявленные копии: ${unexplained.join(', ')}`);
});

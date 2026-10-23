// Словарь телефона. Запуск: npm run test:mobile (из корня)
//
// Экраны зовут t(lang, 'ключ'); ключа нет — на экране виден сам ключ, и
// заметить это можно только глазами на нужном языке. Поэтому все ключи,
// упомянутые в исходниках буквально, должны быть во всех четырёх языках.
// Ключи, собранные из шаблона (`filter.${key}`), сюда не попадают — они
// проверяются там, где перечислены их части.
const fs = require('fs');
const path = require('path');
const { t, T } = require('../src/lib/i18n');

const LANGS = ['ru', 'en', 'uk', 'kk'];
const SRC = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (name !== 'core' && name !== 'editor') walk(p, out); }
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const usedKeys = () => {
  const keys = new Set();
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*[A-Za-z_.]+\s*,\s*'([a-z0-9_.]+)'/g)) keys.add(m[1]);
  }
  return [...keys].sort();
};

test('каждый ключ из исходников есть во всех четырёх языках', () => {
  const missing = [];
  for (const key of usedKeys()) {
    for (const lang of LANGS) {
      if (!(T[lang] && Object.prototype.hasOwnProperty.call(T[lang], key))) missing.push(`${lang}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test('ключи, собранные из частей, тоже на месте', () => {
  const parts = {
    'filter.': ['all', 'active', 'done'],
    // «День» ушёл 12 октября 2026: повтор и напоминание выбирают частоту
    // строками «Каждый день / Каждую неделю / Каждый месяц» (repeat.*).
    'calendar.': ['week', 'month', 'today'],
    'weekday.': ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    'repeat.': ['daily', 'weekly', 'monthly', 'yearly', 'weekdays_preset', 'custom'],
    'notif.perm_': ['granted', 'denied', 'ask'],
    // Волна 2 (17 октября 2026): разделы «Меню», режимы, обратная связь, лист графика.
    'settings.section_': ['main', 'work', 'account', 'data', 'about', 'feedback'],
    'mode.': ['freelance', 'personal'],
    'feedback.kind_': ['bug', 'idea', 'other'],
    'feedback.ph_': ['bug', 'idea', 'other'],
    'chart.kind_': ['bar', 'hbar', 'line', 'area', 'pie', 'donut'],
  };
  const missing = [];
  for (const [prefix, list] of Object.entries(parts)) {
    for (const suffix of list) for (const lang of LANGS) if (!T[lang][prefix + suffix]) missing.push(`${lang}: ${prefix}${suffix}`);
  }
  expect(missing).toEqual([]);
});

test('подписи журнала правок — поля конфликтов, виды в корзине, устройства — во всех четырёх языках и те же, что у веба', () => {
  // Ключи берутся из таблиц (lib/conflictText.js), а не буквально в t(...).
  const { FIELD_LABEL_KEYS, ENTITY_LABEL_KEYS } = require('../src/lib/conflictText');
  const keys = [...Object.values(FIELD_LABEL_KEYS), ...Object.values(ENTITY_LABEL_KEYS),
    ...['web', 'win', 'mac', 'linux', 'android', 'ios'].map((d) => `sync.device_${d}`)];
  const missing = [];
  for (const key of keys) for (const lang of LANGS) if (!T[lang][key]) missing.push(`${lang}: ${key}`);
  expect(missing).toEqual([]);
  // sync.* — те же ключи и те же слова, что у веба: окно конфликта и корзина
  // называют одно и то же одинаково на всех устройствах. Своя у телефона —
  // только короткая подпись тумблера в строке меню.
  const web = require('../../src/renderer/core/i18n.js').T;
  const diff = [];
  for (const lang of LANGS) {
    for (const key of Object.keys(web[lang]).filter((k) => k.startsWith('sync.') && k !== 'sync.toggle_label')) {
      if (T[lang][key] !== web[lang][key]) diff.push(`${lang}: ${key}`);
    }
  }
  expect(diff).toEqual([]);
});

test('время задачи (slot.overlap_*) и рабочие часы (settings.work_*) — те же ключи и те же слова, что у веба', () => {
  // Вопрос о пересечении и лист рабочих часов (18 октября 2026) — одни и те
  // же на вебе и телефоне: «В этом промежутке уже есть задача «X» (10:00–11:00).
  // Создать в то же время?», «Агент ищет свободное время в эти часы…».
  const web = require('../../src/renderer/core/i18n.js').T;
  const diff = [];
  for (const lang of LANGS) {
    const keys = Object.keys(web[lang]).filter((k) => k.startsWith('slot.overlap_') || k.startsWith('settings.work_'));
    if (lang === 'ru') expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) if (T[lang][key] !== web[lang][key]) diff.push(`${lang}: ${key}`);
  }
  expect(diff).toEqual([]);
});

test('пять вкладок подписаны; третья — «Чат-бот» (с 18 октября 2026 на месте «Сегодня»)', () => {
  expect(t('ru', 'ai.tab')).toBe('Чат-бот');
  expect(t('en', 'ai.tab')).toBe('Chatbot');
  const { TAB_TITLES } = require('../src/components/TabHeader');
  expect(TAB_TITLES).toEqual({ Projects: 'nav.projects', Tasks: 'nav.tasks', Chat: 'ai.tab', Stats: 'nav.stats', Menu: 'nav.menu' });
  for (const lang of LANGS) {
    for (const key of Object.values(TAB_TITLES)) {
      expect(typeof t(lang, key)).toBe('string');
      expect(t(lang, key)).not.toBe(key);
    }
  }
});

test('агент (ai.*) — те же ключи и те же слова, что у веба; свои у телефона — только по списку', () => {
  // Агент один на все устройства (core/ai.js): ошибки проверки приходят
  // ключами ai.err_*, карточку и шаги называют одни и те же слова. Своё у
  // телефона — подпись вкладки и подстроки карточки, которые у веба живут
  // под чужими ключами (home.next_due, task.done_label, task.reopen, tabs.notes).
  const web = require('../../src/renderer/core/i18n.js').T;
  // Пункты листа скрепки «Фото» / «Файл» (18 октября 2026) — тоже свои: у веба
  // скрепка сразу открывает выбор файла, листа нет.
  const OWN = {
    'ai.tab': null, 'ai.sub_due': 'home.next_due', 'ai.sub_done': 'task.done_label', 'ai.sub_open': 'task.reopen', 'ai.sub_notes': 'tabs.notes',
    'ai.attach_photo': null, 'ai.attach_file': null,
    // «Ответ прервался» (19 октября 2026): лента у телефона одна на все экраны
    // чата, и открытие другого чата обрывает идущий ответ — свой чат говорит
    // об этом, когда в него вернулись. У веба панель одна, обрыва нет.
    'ai.interrupted': null,
    // Отказ функции «переписка длиннее предела» (400 too long, 19 октября 2026).
    // Пока у веба этого ключа нет; появится — сверится словами в цикле ниже.
    'ai.too_long': null,
  };
  // Только у веба: кнопка агента в шапке и «×» панели — у вкладки их нет;
  // «К списку чатов» — у телефона это стрелка «назад» стека; перетаскивания
  // файла на экран нет (лишний ключ в словаре телефона ловит
  // tests/unit/mobile-i18n.test.js).
  const WEB_ONLY = ['ai.open', 'ai.close', 'ai.back', 'ai.drop_hint'];
  const diff = [];
  for (const lang of LANGS) {
    const webAi = Object.keys(web[lang]).filter((k) => k.startsWith('ai.'));
    // Остальные ключи веба есть и у телефона: ядро может прислать любой ai.err_*.
    for (const key of webAi) if (!WEB_ONLY.includes(key) && T[lang][key] !== web[lang][key]) diff.push(`${lang}: ${key}`);
    for (const key of Object.keys(T[lang]).filter((k) => k.startsWith('ai.') && !webAi.includes(k))) {
      if (!(key in OWN)) diff.push(`${lang}: ${key} — нет у веба`);
      else if (OWN[key] && T[lang][key] !== web[lang][OWN[key]]) diff.push(`${lang}: ${key} ≠ ${OWN[key]}`);
    }
  }
  expect(diff).toEqual([]);
});

test('«закрытый тест» агента (21 октября 2026): ai.locked_*, ai.request_* — во всех четырёх языках, по-русски — слово в слово из договорённости, те же слова, что у веба', () => {
  // Экран вместо поля и чатов, пока аккаунту не выдали доступ
  // (components/chat/ChatLocked.js); тот же экран — у веба и десктопа.
  const KEYS = ['ai.locked_title', 'ai.locked_text', 'ai.locked_note', 'ai.request_access', 'ai.request_sent', 'ai.request_failed'];
  expect(KEYS.map((key) => T.ru[key])).toEqual([
    'ИИ-агент в закрытом тесте',
    'Доступ открываем по приглашению. Оставьте запрос — напишем, когда откроем.',
    'Вместе с запросом уйдёт почта вашего аккаунта — по ней мы выдадим доступ.',
    'Запросить доступ',
    'Запрос отправлен',
    'Запрос не отправился — проверьте интернет и попробуйте ещё раз.',
  ]);
  const web = require('../../src/renderer/core/i18n.js').T;
  const diff = [];
  for (const lang of LANGS) {
    for (const key of KEYS) {
      const v = T[lang][key];
      if (typeof v !== 'string' || !v.trim()) diff.push(`${lang}: ${key} — нет`);
      else if (lang !== 'ru' && v === T.ru[key]) diff.push(`${lang}: ${key} — не переведено`);
      else if (v !== web[lang][key]) diff.push(`${lang}: ${key} ≠ веб`);
    }
  }
  expect(diff).toEqual([]);
});

test('выключатель «Статистика экранов» (23 октября 2026): settings.usage_* — во всех четырёх языках слово в слово из договорённости и те же, что у веба', () => {
  // Строка в «Данных» (screens/SettingsSectionScreen.js, lib/screenStats.js);
  // у веба — та же строка и те же слова (src/renderer/core/i18n.js).
  const WANT = {
    ru: ['Статистика экранов', 'Отправлять, какие экраны вы открываете, — без содержимого заметок и задач. Так мы видим, чем пользуются.'],
    en: ['Screen statistics', 'Send which screens you open — without the contents of notes or tasks. It shows us what people use.'],
    uk: ['Статистика екранів', 'Надсилати, які екрани ви відкриваєте, — без вмісту нотаток і завдань. Так ми бачимо, чим користуються.'],
    kk: ['Экрандар статистикасы', 'Қай экрандарды ашатыныңызды жіберу — жазбалар мен тапсырмалардың мазмұнынсыз. Осылайша немен пайдаланатынын көреміз.'],
  };
  const KEYS = ['settings.usage_title', 'settings.usage_hint'];
  for (const lang of LANGS) expect(KEYS.map((key) => T[lang][key])).toEqual(WANT[lang]);
  const web = require('../../src/renderer/core/i18n.js').T;
  const diff = [];
  for (const lang of LANGS) for (const key of KEYS) if (T[lang][key] !== web[lang][key]) diff.push(`${lang}: ${key} ≠ веб`);
  expect(diff).toEqual([]);
});

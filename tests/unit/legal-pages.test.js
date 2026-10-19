// Правовые документы лендинга, сторонние ресурсы и доступность разметки.
// Запуск: npm run test:unit
//
// Документы живут по четыре перевода в странице (landing/privacy.html и
// соседи). Переводы правятся руками, и разъехаться им легче всего молча:
// в русском появился раздел, в казахском — нет. Поэтому сверяем скелет —
// разделы, ссылки, поля реквизитов — между языками каждой страницы.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LANDING = path.join(__dirname, '..', '..', 'landing');
const read = (f) => fs.readFileSync(path.join(LANDING, f), 'utf8').replace(/\r\n/g, '\n');
const { LEGAL_DOCS, LEGAL_LANGS } = require('../../src/renderer/core/legal.js');
const BUSINESS = require('../../landing/business.js');

const DOCS = LEGAL_DOCS.map((d) => `${d}.html`);
const SITE = ['index.html', 'blog.html', 'logs.html', 'architecture.html', 'graph.html', ...DOCS];

function articles(page) {
  const html = read(page);
  return [...html.matchAll(/<article class="legal-doc" data-lang="(\w+)"([^>]*)>([\s\S]*?)<\/article>/g)]
    .map((m) => ({ lang: m[1], attrs: m[2], body: m[3] }));
}

/** Скелет перевода: число разделов, ссылки, поля реквизитов, метки возраста. */
function skeleton(body) {
  return {
    h2: (body.match(/<h2>/g) || []).length,
    h3: (body.match(/<h3>/g) || []).length,
    li: (body.match(/<li>/g) || []).length,
    rows: (body.match(/<tr>/g) || []).length,
    links: [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    biz: [...body.matchAll(/data-biz="(\w+)"/g)].map((m) => m[1]),
    age: (body.match(/data-min-age/g) || []).length,
    buttons: (body.match(/<button/g) || []).length,
  };
}

test('в каждом документе четыре перевода, без скрипта виден русский', () => {
  for (const page of DOCS) {
    const arts = articles(page);
    assert.deepEqual(arts.map((a) => a.lang), LEGAL_LANGS, `${page}: переводы не те или не в том порядке`);
    for (const a of arts) {
      const hidden = /\shidden\b/.test(a.attrs);
      assert.equal(hidden, a.lang !== 'ru', `${page}: перевод ${a.lang} ${hidden ? 'спрятан' : 'виден'} без скрипта`);
      assert.match(a.attrs, /data-title="[^"]+"/, `${page} ${a.lang}: нет data-title`);
      assert.match(a.attrs, /data-heading="[^"]+"/, `${page} ${a.lang}: нет data-heading`);
      assert.match(a.attrs, new RegExp(`lang="${a.lang}"`), `${page} ${a.lang}: нет lang — читалка прочтёт не тем голосом`);
    }
  }
});

test('переводы одного документа устроены одинаково', () => {
  for (const page of DOCS) {
    const [ru, ...rest] = articles(page);
    const base = skeleton(ru.body);
    for (const a of rest) {
      assert.deepEqual(skeleton(a.body), base, `${page}: перевод ${a.lang} разошёлся с русским по устройству`);
    }
  }
});

test('Политика называет Anthropic в каждом переводе: в списке поставщиков и в разделе про ИИ-агента', () => {
  // ИИ-агент отправляет запрос стороннему обработчику — Anthropic, PBC (API
  // Claude). Если получатель назван не во всех переводах, человек, читающий
  // политику на казахском, о нём не узнает. Проверяем не номера разделов, а
  // сами имена: перестановка разделов тест не уронит, а потеря поставщика —
  // уронит.
  const arts = articles('privacy.html');
  assert.deepEqual(arts.map((a) => a.lang), LEGAL_LANGS);
  for (const a of arts) {
    assert.ok(a.body.includes('<strong>Anthropic, PBC</strong>'), `privacy.html ${a.lang}: Anthropic не назван среди поставщиков`);
    assert.ok(a.body.includes('Anthropic Commercial Terms'), `privacy.html ${a.lang}: в разделе про ИИ-агента нет условий Anthropic Commercial Terms`);
  }
});

test('Политика cookie называет чаты ИИ-агента (lancible:ai:<id>:chats и :chat:<chat>) в каждом переводе', () => {
  // Веб-версия пишет беседы с агентом в localStorage: список чатов —
  // lancible:ai:<id пользователя>:chats, сообщения чата —
  // lancible:ai:<id>:chat:<id чата> (с 18 октября 2026; прежний одиночный
  // ключ lancible:ai:<id> переносится в них и удаляется). По правилу
  // COMPLIANCE.md («Новый ключ в localStorage») каждый — строка в таблице
  // Политики cookie, во всех четырёх переводах. Ищем сами ключи в ячейке
  // таблицы, а не слова вокруг них: перевод можно переписать, а потерять
  // строку — нельзя. Кнопки «Новый разговор» больше нет — и в тексте её нет.
  const arts = articles('cookies.html');
  assert.deepEqual(arts.map((a) => a.lang), LEGAL_LANGS);
  for (const a of arts) {
    assert.ok(a.body.includes('<td><code>lancible:ai:&lt;id&gt;:chats</code></td>'), `cookies.html ${a.lang}: в таблице нет ключа lancible:ai:<id>:chats (список чатов агента)`);
    assert.ok(a.body.includes('<td><code>lancible:ai:&lt;id&gt;:chat:&lt;chat&gt;</code></td>'), `cookies.html ${a.lang}: в таблице нет ключа lancible:ai:<id>:chat:<chat> (сообщения чата)`);
    assert.ok(!a.body.includes('<td><code>lancible:ai:&lt;id&gt;</code></td>'), `cookies.html ${a.lang}: прежний ключ lancible:ai:<id> всё ещё в таблице`);
    assert.doesNotMatch(a.body, /Новый разговор|New conversation|Нова розмова|Жаңа әңгіме/, `cookies.html ${a.lang}: кнопки «Новый разговор» больше нет`);
  }
});

test('Политика cookie называет области аккаунтов и их список (lancible:data:<id>, lancible:accounts)', () => {
  // С 17 октября 2026 на одном устройстве может быть несколько аккаунтов
  // (core/accounts.js): у каждого своя копия данных — lancible:data:<id>, а
  // список аккаунтов с сеансами тех, что сейчас не открыты, —
  // lancible:accounts. Два новых ключа localStorage — две строки таблицы в
  // каждом переводе (COMPLIANCE.md, «Новый ключ в localStorage»).
  const arts = articles('cookies.html');
  assert.deepEqual(arts.map((a) => a.lang), LEGAL_LANGS);
  for (const a of arts) {
    assert.ok(a.body.includes('<td><code>lancible:data:&lt;id&gt;</code></td>'), `cookies.html ${a.lang}: в таблице нет ключа lancible:data:<id> (данные аккаунта)`);
    assert.ok(a.body.includes('<td><code>lancible:accounts</code></td>'), `cookies.html ${a.lang}: в таблице нет ключа lancible:accounts (список аккаунтов)`);
  }
  // И ключи — те самые, что пишет шим веба.
  const shim = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'api-shim.js'), 'utf8');
  assert.match(shim, /'lancible:accounts'/);
  assert.equal(require('../../src/renderer/core/accounts.js').dataScope('u-1'), 'lancible:data:u-1');
});

test('журнал правок: Политика cookie называет lancible:device, Политика конфиденциальности — журнал и id установки', () => {
  // С 17 октября 2026 синхронизация — журналом правок (core/oplog.js,
  // supabase/sync2.sql): в базу уходит каждая правка поля с временем и
  // случайным id установки, а веб держит этот id в localStorage
  // (lancible:device). Новый ключ — строка таблицы cookie, новая запись в
  // базе — строка «С аккаунтом» и срок хранения в Политике, в каждом
  // переводе (COMPLIANCE.md, «Новый ключ в localStorage»).
  const cookies = articles('cookies.html');
  assert.deepEqual(cookies.map((a) => a.lang), LEGAL_LANGS);
  for (const a of cookies) {
    assert.ok(a.body.includes('<td><code>lancible:device</code></td>'), `cookies.html ${a.lang}: в таблице нет ключа lancible:device (id установки)`);
  }
  const shim = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'api-shim.js'), 'utf8');
  assert.match(shim, /'lancible:device'/);
  const words = { ru: /Журнал правок/, en: /change log/i, uk: /Журнал змін/, kk: /Өзгерістер журналы/ };
  const privacy = articles('privacy.html');
  assert.deepEqual(privacy.map((a) => a.lang), LEGAL_LANGS);
  for (const a of privacy) {
    const hits = a.body.split(words[a.lang]).length - 1;
    assert.ok(hits >= 2, `privacy.html ${a.lang}: журнал правок назван ${hits} раз — нужны строка данных и срок хранения`);
  }
});

/** Раздел документа от его заголовка до следующего <h2>. */
function sectionOf(body, heading) {
  const at = body.search(heading);
  if (at < 0) return null;
  const next = body.indexOf('<h2>', at + 4);
  return body.slice(at, next < 0 ? undefined : next);
}
const AI_HEADING = { ru: /<h2>(\d+)\. ИИ-агент<\/h2>/, en: /<h2>(\d+)\. AI agent<\/h2>/, uk: /<h2>(\d+)\. ШІ-агент<\/h2>/, kk: /<h2>(\d+)\. ЖИ-агент<\/h2>/ };

test('Условия: раздел про ИИ-агента в каждом переводе и ссылка на тот раздел Политики, где он описан', () => {
  // Редакция 17 октября 2026 (TERMS_VERSION): Условия говорят, что агент
  // только предлагает, ответы модели бывают неточными, у сообщений есть
  // лимит, а данные уходят модели только по действию человека, — и отсылают
  // за подробностями к разделу Политики. Номер раздела Политики сверяем с
  // настоящим: перестановка разделов не должна оставить ссылку на чужой.
  const privacy = Object.fromEntries(articles('privacy.html').map((a) => [a.lang, a.body]));
  const terms = articles('terms.html');
  assert.deepEqual(terms.map((a) => a.lang), LEGAL_LANGS);
  for (const a of terms) {
    const pm = privacy[a.lang].match(AI_HEADING[a.lang]);
    assert.ok(pm, `privacy.html ${a.lang}: нет раздела про ИИ-агента`);
    const sec = sectionOf(a.body, AI_HEADING[a.lang]);
    assert.ok(sec, `terms.html ${a.lang}: нет раздела про ИИ-агента`);
    assert.ok(sec.includes('href="privacy.html"'), `terms.html ${a.lang}: раздел про агента не ссылается на Политику`);
    assert.match(sec, new RegExp(`(^|[^\\d])${pm[1]}([^\\d]|$)`), `terms.html ${a.lang}: ссылка не на раздел ${pm[1]} Политики, где описан агент`);
    assert.equal((sec.match(/<li>/g) || []).length, 4, `terms.html ${a.lang}: четыре пункта — предлагает, неточен, лимит, данные`);
  }
});

test('Политика §11 про агента называет вложения и то, что перекодировка снимает метаданные, — в каждом переводе', () => {
  // С 18 октября 2026 к сообщению агенту прикладывают изображения, PDF и
  // текстовые файлы (core/ai.js, AI_ATTACH): это новые данные, которые
  // уходят Anthropic. Политика должна говорить, что уходит, что нигде не
  // хранится и что изображения перекодируются на устройстве — без
  // метаданных. Слова ищем в самом разделе про агента, а не по всей
  // странице: «вложение» в другом разделе обещанием про агента не будет.
  const words = {
    ru: [/Вложени/, /метаданн/, /не храним/],
    en: [/Attachments/, /metadata/, /do not store attachments/],
    uk: [/Вкладен/, /метадан/, /не зберігаємо вкладення/],
    kk: [/Тіркеме/, /метадерек/, /сақтамаймыз/],
  };
  const arts = articles('privacy.html');
  assert.deepEqual(arts.map((a) => a.lang), LEGAL_LANGS);
  for (const a of arts) {
    const sec = sectionOf(a.body, AI_HEADING[a.lang]);
    assert.ok(sec, `privacy.html ${a.lang}: нет раздела про ИИ-агента`);
    for (const w of words[a.lang]) assert.match(sec, w, `privacy.html ${a.lang}: в разделе про агента нет «${w.source}»`);
    assert.match(sec, /<li><strong>[^<]+<\/strong>[^<]*(PNG, JPEG, WebP, GIF)[^<]*<\/li>/, `privacy.html ${a.lang}: пункт о вложениях не называет типы изображений`);
  }
});

test('Удаление аккаунта называет журнал правок и записи обращений к агенту среди того, что стирается', () => {
  // С 17 октября 2026 на сервере, кроме данных, лежат журнал правок
  // (supabase/sync2.sql) и записи об обращениях к агенту (supabase/ai.sql);
  // оба стираются вместе с аккаунтом — страница для Google Play должна это
  // говорить на каждом языке.
  const words = {
    ru: [/журналом правок/, /ИИ-агенту/],
    en: [/change log/, /AI agent/],
    uk: [/журналом змін/, /ШІ-агента/],
    kk: [/өзгерістер журналы/, /ЖИ-агентке/],
  };
  for (const a of articles('delete-account.html')) {
    for (const w of words[a.lang]) assert.match(a.body, w, `delete-account.html ${a.lang}: нет «${w.source}»`);
  }
});

// --- сверка 19 октября 2026: тексты против кода --------------------------------
//
// Правовая сверка нашла, что документы отстали от кода: обратной связи в них
// не было, раздачу файлов (Cloudflare R2) не называл никто, срок копии
// данных на устройстве в двух документах был разный. Каждое расхождение ниже —
// тест, привязанный к коду, где это возможно: меняется код — тест напоминает
// о тексте.

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP_T = require('../../src/renderer/core/i18n.js').T;
/** Словарь телефона — ES-модуль; читаем так же, как tests/unit/legal-strings.test.js. */
const MOBILE_T = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'lib', 'i18n.js'), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, '');
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function('module', 'Lang', `${src};module.exports = { T };`)(box, require('../../src/renderer/core/lang.js'));
  return box.exports.T;
})();
const byLang = (page) => Object.fromEntries(articles(page).map((a) => [a.lang, a.body]));
const section = (body, n) => sectionOf(body, new RegExp(`<h2>${n}\\. `));

test('обратная связь: Политика §3, §5 и §6 описывают форму на каждом языке, подсказка формы — привязку к аккаунту', () => {
  // Форма (app.js sendFeedback, mobile/src/lib/feedback.js) пишет в таблицу
  // feedback вид, текст до 4000 знаков, платформу, версию, язык, устройство
  // (userAgent / модель) и путь к снимку до 5 МБ; у вошедшего — user_id. Копию
  // в Telegram с 19 октября 2026 шлёт функция Supabase feedback-notify, без
  // Make (supabase/feedback-bot.sql); срок — до разбора, не дольше 12 месяцев,
  // и по сроку строки со снимками стирает сама функция (задание
  // feedback-sweep), а копию в Telegram команда удаляет вручную.
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'feedback.sql'), 'utf8');
  const bot = fs.readFileSync(path.join(ROOT, 'supabase', 'feedback-bot.sql'), 'utf8');
  const notify = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'feedback-notify', 'index.ts'), 'utf8');
  assert.match(bot, /net\.http_post\(/, 'feedback-bot.sql: пересылка уже не через функцию — поправьте Политику §3 и §5');
  assert.match(bot, /cron\.schedule\(\s*'feedback-sweep'/, 'feedback-bot.sql: уборки по сроку нет — Политика §6 обещает автоматическое удаление');
  assert.match(notify, /setUTCFullYear\(d\.getUTCFullYear\(\) - 1\)/, 'feedback-notify: срок уборки уже не 12 месяцев — поправьте Политику §6');
  assert.match(sql, /char_length\(text\) between 1 and 4000/, 'feedback.sql: предел текста уже не 4000 — поправьте Политику §3');
  assert.match(sql, /5242880/, 'feedback.sql: предел снимка уже не 5 МБ — поправьте Политику §3');
  const words = {
    ru: { h3: '<h3>Обратная связь</h3>', max: '4000', mb: '5 МБ', keep: /не дольше 12 месяцев: по истечении этого срока они удаляются автоматически/, manual: /Telegram команда удаляет вручную/, fn: 'функцией нашего сервера Supabase' },
    en: { h3: '<h3>Feedback</h3>', max: '4,000', mb: '5 MB', keep: /no longer than 12 months: after that they are deleted automatically/, manual: /Telegram work chat manually/, fn: 'by a function on our Supabase server' },
    uk: { h3: '<h3>Зворотний зв’язок</h3>', max: '4000', mb: '5 МБ', keep: /не довше 12 місяців: після цього строку вони видаляються автоматично/, manual: /Telegram команда видаляє вручну/, fn: 'функцією нашого сервера Supabase' },
    kk: { h3: '<h3>Кері байланыс</h3>', max: '4000', mb: '5 МБ', keep: /12 айдан аспайды: бұл мерзім өткенде олар автоматты түрде жойылады/, manual: /кейін қолмен/, fn: 'біздің Supabase серверіміздегі функция' },
  };
  const privacy = byLang('privacy.html');
  for (const lang of LEGAL_LANGS) {
    const w = words[lang];
    const s3 = section(privacy[lang], 3);
    assert.ok(s3 && s3.includes(w.h3), `privacy.html ${lang}: в §3 нет подраздела про обратную связь`);
    const fb = s3.slice(s3.indexOf(w.h3), s3.indexOf('<h3>', s3.indexOf(w.h3) + 4));
    for (const need of [w.max, w.mb, 'User-Agent', 'Telegram', w.fn]) assert.ok(fb.includes(need), `privacy.html ${lang}: в §3 про обратную связь нет «${need}»`);
    assert.ok(!privacy[lang].includes('Make'), `privacy.html ${lang}: Make всё ещё назван — пересылает функция Supabase`);
    const s5 = section(privacy[lang], 5);
    const tgItem = s5.match(/<li><strong>Telegram<\/strong>[^<]*<\/li>/);
    assert.ok(tgItem, `privacy.html ${lang}: в §5 нет Telegram среди получателей`);
    assert.ok(tgItem[0].includes('Supabase'), `privacy.html ${lang}: §5 не говорит, что копию в Telegram пересылает функция Supabase`);
    const s6 = section(privacy[lang], 6);
    assert.match(s6, w.keep, `privacy.html ${lang}: в §6 нет срока хранения обратной связи и автоматического удаления`);
    assert.match(s6, w.manual, `privacy.html ${lang}: в §6 не сказано, что копию в Telegram удаляют вручную`);
  }
  const account = { ru: /аккаунт/, en: /account/, uk: /акаунт/, kk: /аккаунт/ };
  for (const lang of LEGAL_LANGS) {
    for (const key of ['feedback.meta_hint_web', 'feedback.meta_hint_desktop']) {
      assert.match(DESKTOP_T[lang][key], account[lang], `${key} (${lang}): подсказка не говорит, что сообщение вошедшего привязывается к аккаунту`);
    }
    assert.match(MOBILE_T[lang]['feedback.meta_hint'], account[lang], `телефон feedback.meta_hint (${lang}): нет привязки к аккаунту`);
  }
});

test('раздача файлов: Cloudflare назван в Политике §3 и §5 и в Политике cookie, раз «Скачать» ведёт на R2', () => {
  // С 10 октября 2026 установщики, обновления десктопа и APK раздаёт
  // Cloudflare R2 (scripts/publish-release.js, кнопки лендинга на r2.dev).
  const index = read('index.html');
  const onR2 = /href="https:\/\/[^"]+\.r2\.dev\//.test(index);
  if (!onR2) return; // раздача уехала с R2 — тогда поправьте и тексты, и этот тест
  const privacy = byLang('privacy.html');
  const cookies = byLang('cookies.html');
  const installer = /установщик|installer|інсталятор|орнатқыш/i;
  for (const lang of LEGAL_LANGS) {
    assert.ok(section(privacy[lang], 3).includes('Cloudflare R2'), `privacy.html ${lang}: §3 не говорит, откуда скачиваются установщики и обновления`);
    const s5 = section(privacy[lang], 5);
    assert.ok(s5.includes('<strong>Cloudflare, Inc.</strong>'), `privacy.html ${lang}: Cloudflare нет среди поставщиков`);
    assert.match(s5, /Vercel, Cloudflare, GitHub/, `privacy.html ${lang}: Cloudflare нет в списке компаний из США`);
    const gh = s5.match(/<li><strong>GitHub, Inc\.<\/strong>[^<]*<\/li>/);
    assert.ok(gh && !installer.test(gh[0]), `privacy.html ${lang}: GitHub всё ещё назван раздачей установщиков`);
    assert.ok(cookies[lang].includes('Cloudflare R2'), `cookies.html ${lang}: пример внешнего ресурса не называет Cloudflare R2`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'COMPLIANCE.md'), 'utf8'), /\| Cloudflare R2 \|/, 'COMPLIANCE.md: нет строки Cloudflare R2 в «Сторонних сервисах»');
});

test('копия данных на устройстве: удаление аккаунта её не стирает — так говорят Политика cookie, «Удаление аккаунта» и строка подтверждения', () => {
  // deleteAccount → leaveAccount: копия на устройстве остаётся
  // (account.delete_confirm: «Копия на этом устройстве останется»). Стирает
  // её «Удалить данные аккаунта с устройства» — вместе с чатами агента и
  // файлами заметок этого аккаунта. Название пункта берём из словаря, чтобы
  // документ цитировал экран дословно.
  const cookies = byLang('cookies.html');
  const del = byLang('delete-account.html');
  const promise = /удалите аккаунт|delete the account|видалите акаунт|аккаунтты жойғанша/;
  const pdf = /PDF/;
  for (const lang of LEGAL_LANGS) {
    const forget = DESKTOP_T[lang]['accounts.forget'];
    assert.equal(MOBILE_T[lang]['accounts.forget'], forget, `accounts.forget (${lang}) разный на десктопе и телефоне`);
    const row = cookies[lang].match(/<tr><td><code>lancible:data:&lt;id&gt;<\/code><\/td>(?:<td>[^<]*<\/td>){2}<td>([^<]*)<\/td><\/tr>/);
    assert.ok(row, `cookies.html ${lang}: строка lancible:data:<id> не разобралась`);
    assert.doesNotMatch(row[1], promise, `cookies.html ${lang}: срок lancible:data:<id> обещает, что удаление аккаунта стирает копию`);
    assert.ok(row[1].includes(`«${forget}»`) || row[1].includes(`“${forget}”`), `cookies.html ${lang}: срок lancible:data:<id> не называет «${forget}»`);
    assert.ok(del[lang].includes(forget), `delete-account.html ${lang}: нет пункта «${forget}»`);
    const assets = cookies[lang].match(/<tr><td><code>lancible-assets<\/code>[^\n]*<\/tr>/);
    assert.ok(assets && pdf.test(assets[0]), `cookies.html ${lang}: lancible-assets не называет PDF-файлы заметок`);
    for (const key of ['lancible:ai:&lt;id&gt;:chats', 'lancible:ai:&lt;id&gt;:chat:&lt;chat&gt;']) {
      const chat = cookies[lang].match(new RegExp(`<tr><td><code>${key}</code>[^\\n]*</tr>`));
      assert.ok(chat && chat[0].includes(forget), `cookies.html ${lang}: срок ${key} не называет «${forget}»`);
    }
    assert.match(DESKTOP_T[lang]['accounts.forget_confirm'], pdf, `accounts.forget_confirm (${lang}): подтверждение не говорит, что уходят и файлы заметок`);
    assert.equal(MOBILE_T[lang]['accounts.forget_confirm'], DESKTOP_T[lang]['accounts.forget_confirm'], `accounts.forget_confirm (${lang}) разный на десктопе и телефоне`);
  }
});

test('Политика cookie: под таблицей названо, что уходит при синхронизации, — lancible:data:<id>, lancible-assets, lancible:device', () => {
  // С несколькими аккаунтами синхронизируется область аккаунта
  // (lancible:data:<id>), а lancible:data — данные без аккаунта — не уходит
  // никуда; с каждой правкой уходит id установки (lancible:device).
  const chat = Number((fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'lib', 'aiChat.js'), 'utf8').match(/AI_ITEMS_MAX = (\d+)/) || [])[1]);
  for (const a of articles('cookies.html')) {
    const after = a.body.slice(a.body.indexOf('</table>'));
    const para = after.slice(0, after.indexOf('</p>'));
    for (const key of ['lancible:data:&lt;id&gt;', 'lancible-assets', 'lancible:device', 'lancible:data</code>']) {
      assert.ok(para.includes(key.endsWith('</code>') ? `<code>${key}` : `<code>${key}</code>`), `cookies.html ${a.lang}: абзац под таблицей не называет ${key.replace('</code>', '')}`);
    }
    const row = a.body.match(/<tr><td><code>lancible:ai:&lt;id&gt;:chat:&lt;chat&gt;<\/code>[^\n]*<\/tr>/)[0];
    assert.ok(chat && row.includes(String(chat)), `cookies.html ${a.lang}: строка чата не называет ленту до ${chat} строк (AI_ITEMS_MAX)`);
  }
});

test('«Удаление аккаунта» и Политика §6 называют слепки состояния, PDF и обратную связь среди стираемого', () => {
  // snapshots (supabase/sync2.sql) хранят состояние целиком вместе с корзиной
  // и стираются только с аккаунтом; PDF лежат в doc-assets рядом с
  // картинками; обращения из аккаунта стираются каскадом (feedback.sql).
  const words = {
    ru: { snap: /слепк/, fb: /обратной связи/ },
    en: { snap: /snapshot/, fb: /feedback/ },
    uk: { snap: /зліпк/, fb: /зворотного зв’язку/ },
    kk: { snap: /күй көшірмел/, fb: /кері байланыс/ },
  };
  const privacy = byLang('privacy.html');
  for (const a of articles('delete-account.html')) {
    const w = words[a.lang];
    for (const re of [w.snap, w.fb, /PDF/]) assert.match(a.body, re, `delete-account.html ${a.lang}: нет «${re.source}»`);
    assert.match(a.body, /12/, `delete-account.html ${a.lang}: не назван срок копии обращения в Telegram`);
    const s6 = section(privacy[a.lang], 6);
    for (const re of [w.snap, /PDF/]) assert.match(s6, re, `privacy.html ${a.lang}: §6 без «${re.source}»`);
  }
});

test('Политика §11 «Что уходит» покрывает все поля снимка агента (Core.aiSnapshot)', () => {
  // Новое поле в снимке — новые данные у Anthropic. Список полей сверяем с
  // кодом: добавили поле — тест упадёт, пока его нет в тексте и здесь.
  const snap = require('../../src/renderer/core/ai.js').aiSnapshot(
    { projects: [], tasks: [{ id: 't1', title: 'x' }] }, { tz: 'Asia/Almaty', lang: 'ru', focus: { view: 'list' } });
  assert.deepEqual(Object.keys(snap).sort(), ['focus', 'lang', 'now', 'projects', 'tags', 'tasks', 'totals', 'tz', 'weekStart'], 'у снимка агента новое поле — допишите его в §11 и сюда');
  assert.deepEqual(Object.keys(snap.tasks[0]).sort(), ['cancelled', 'done', 'dueAt', 'id', 'project', 'repeat', 'slots', 'spentMin', 'status', 'tags', 'title', 'version'], 'у задачи в снимке новое поле — допишите его в §11 и сюда');
  const words = {
    ru: [/правило повтора/, /часовой пояс/, /язык интерфейса/, /текущее время/, /открыто на экране/, /длительность вызова/],
    en: [/repeat rule/, /time zone/, /interface language/, /current time/, /open on the screen/, /how long the call took/],
    uk: [/правило повторення/, /часовий пояс/, /мова інтерфейсу/, /поточний час/, /відкрито на екрані/, /тривалість виклику/],
    kk: [/қайталау ережесі/, /уақыт белдеу/, /интерфейс тілі/, /ағымдағы уақыт/, /экранда не ашық/, /шақыру ұзақтығы/],
  };
  for (const a of articles('privacy.html')) {
    const sec = sectionOf(a.body, AI_HEADING[a.lang]);
    for (const w of words[a.lang]) assert.match(sec, w, `privacy.html ${a.lang}: в §11 нет «${w.source}»`);
  }
});

test('идентификатор установки: Политика §3 называет приставки систем, как их пишет код', () => {
  // src/data-store.js (win-/mac-/linux-), web/api-shim.js (web-),
  // mobile/src/lib/device.js (android-/ios-). Приставка называет систему —
  // документ не должен говорить «ничего об устройстве».
  const store = fs.readFileSync(path.join(ROOT, 'src', 'data-store.js'), 'utf8');
  assert.match(store, /`\$\{os\}-\$\{crypto\.randomUUID\(\)\}`/, 'src/data-store.js: id установки строится иначе — сверьте §3');
  for (const a of articles('privacy.html')) {
    assert.ok(section(a.body, 3).includes('(web-, win-, mac-, linux-, android-, ios-)'), `privacy.html ${a.lang}: §3 не называет приставки id установки`);
  }
});

test('/legal: не «все MIT», а лицензии вложенных библиотек — те, что в node_modules', () => {
  // Шапка src/renderer/editor-pdf.js называет openjpeg (BSD-2-Clause), pako,
  // tslib; markdown-it тянет entities, electron-updater — semver, sax,
  // graceful-fs и argparse. Лицензию сверяем с package.json пакета: у sax
  // 1.6.1 она BlueOak-1.0.0, а не ISC, как считалось, — так и надо узнавать.
  const NESTED = { entities: 'BSD-2-Clause', pako: 'Zlib', tslib: '0BSD', semver: 'ISC', 'graceful-fs': 'ISC', sax: 'BlueOak-1.0.0', argparse: 'Python-2.0' };
  for (const [pkg, licence] of Object.entries(NESTED)) {
    const file = path.join(ROOT, 'node_modules', pkg, 'package.json');
    if (fs.existsSync(file)) {
      const real = String(JSON.parse(fs.readFileSync(file, 'utf8')).license || '');
      assert.ok(real.includes(licence), `${pkg}: в node_modules лицензия «${real}», а /legal говорит «${licence}»`);
    }
  }
  const all = /все по лицензии MIT|all under the MIT licence|усі за ліцензією MIT|бәрі MIT лицензиясымен/;
  for (const a of articles('legal.html')) {
    const text = a.body.replace(/<[^>]+>/g, '');
    assert.doesNotMatch(text, all, `legal.html ${a.lang}: снова «все библиотеки — MIT»`);
    for (const [pkg, licence] of Object.entries(NESTED)) {
      // «semver и graceful-fs (в electron-updater) — ISC»: имя и лицензия — в
      // одном звене перечня между точками с запятой.
      assert.match(text, new RegExp(`${pkg}[^;.]* — [^;.]*${licence.replace(/[.]/g, '\\.')}`), `legal.html ${a.lang}: нет ${pkg} с лицензией ${licence}`);
    }
    assert.match(text, /openjpeg[^;.]*BSD-2-Clause/, `legal.html ${a.lang}: нет обвязки openjpeg с BSD-2-Clause`);
  }
});

test('COMPLIANCE.md: обратная связь, Telegram и Cloudflare в «Сторонних сервисах» (Make — нет), агент на телефоне, ограничение частоты обратной связи', () => {
  const c = fs.readFileSync(path.join(ROOT, 'COMPLIANCE.md'), 'utf8');
  const services = c.slice(c.indexOf('## Сторонние сервисы'), c.indexOf('## Где лежат данные'));
  for (const name of ['| Telegram', '| Cloudflare R2', 'feedback', 'feedback-notify']) assert.ok(services.includes(name), `COMPLIANCE.md: в «Сторонних сервисах» нет «${name}»`);
  // С 19 октября 2026 копию в Telegram шлёт функция Supabase feedback-notify.
  assert.ok(!services.includes('| Make'), 'COMPLIANCE.md: Make всё ещё среди сторонних сервисов');
  assert.match(services, /\| Telegram \|[^\n]*feedback-notify/, 'COMPLIANCE.md: строка Telegram не называет функцию feedback-notify');
  assert.match(services, /\| Anthropic \|[^\n]*телефон/, 'COMPLIANCE.md: строка Anthropic не называет телефон');
  assert.match(c, /lancible-ai:<uid>:chats/, 'COMPLIANCE.md: нет ключей чатов телефона в AsyncStorage');
  assert.match(c, /mobile\/assets\/editor-pdf\.txt/, 'COMPLIANCE.md: pdf.js в APK (editor-pdf.txt) не назван');
  assert.doesNotMatch(c, /в APK не входит/, 'COMPLIANCE.md: всё ещё «pdf.js в APK не входит»');
  assert.doesNotMatch(c, /`lancible:ai:<id пользователя>`/, 'COMPLIANCE.md: старый ключ lancible:ai:<id пользователя> вместо ключей списка чатов');
  // 19 октября 2026 принятый риск «вставка без ограничения частоты» сменило
  // само ограничение (supabase/feedback.sql) — запись должна называть его.
  assert.doesNotMatch(c, /без ограничения частоты, так что спам возможен/, 'COMPLIANCE.md: всё ещё принятый риск вместо ограничения частоты');
  const limits = c.slice(c.indexOf('**Ограничение частоты**'));
  assert.ok(c.includes('**Ограничение частоты**'), 'COMPLIANCE.md: нет записи об ограничении частоты обратной связи');
  for (const s of ['feedback_rate', '5 сообщений за 10 минут', '20 за сутки', '30 в час', 'feedback.rate', '15 минут', 'feedback_shot_expected']) {
    assert.ok(limits.slice(0, 1500).includes(s), `COMPLIANCE.md, ограничение частоты: нет «${s}»`);
  }
});

test('/legal называет библиотеки, которые свои модули телефона тянут в Android', () => {
  // mobile/modules/*/android/build.gradle — свои нативные модули: их
  // зависимости уходят в APK мимо package.json, и лицензия у них не
  // обязательно MIT. Новая — впишите её в /legal на четырёх языках и сюда.
  const KNOWN = {
    'com.google.android.material:material': { name: 'Material Components for Android (Google)', licence: 'Apache-2.0' },
  };
  const modules = path.join(__dirname, '..', '..', 'mobile', 'modules');
  const deps = [];
  for (const dir of fs.existsSync(modules) ? fs.readdirSync(modules) : []) {
    const gradle = path.join(modules, dir, 'android', 'build.gradle');
    if (!fs.existsSync(gradle)) continue;
    const src = fs.readFileSync(gradle, 'utf8');
    for (const m of src.matchAll(/^\s*(?:implementation|api)\s*\(?\s*["']([\w.-]+:[\w.-]+):[^"']+["']/gm)) deps.push(m[1]);
  }
  const arts = articles('legal.html');
  for (const dep of deps) {
    const lib = KNOWN[dep];
    assert.ok(lib, `${dep}: новая зависимость Android — её нет ни в /legal, ни в этом списке`);
    for (const a of arts) {
      // Название и лицензия — в одном предложении.
      const said = a.body.split(/(?<=\.)\s+/).find((s) => s.includes(lib.name));
      assert.ok(said && said.includes(lib.licence), `legal.html ${a.lang}: нет ${lib.name} с лицензией ${lib.licence}`);
    }
  }
});

test('каждое поле реквизитов в документах есть в бланке business.js', () => {
  for (const page of DOCS) {
    for (const m of read(page).matchAll(/data-biz="(\w+)"/g)) {
      assert.ok(m[1] in BUSINESS, `${page}: поле ${m[1]} не описано в landing/business.js`);
    }
  }
});

test('реквизиты заполнены', { todo: Object.values(BUSINESS).some((v) => !String(v).trim()) && 'бланк landing/business.js ждёт решения по юрлицу — см. COMPLIANCE.md' }, () => {
  const empty = Object.entries(BUSINESS).filter(([, v]) => !String(v).trim()).map(([k]) => k);
  assert.deepEqual(empty, [], `не заполнены: ${empty.join(', ')}`);
});

test('правовые страницы подключают реквизиты, переключатель языка и баннер', () => {
  for (const page of DOCS) {
    const html = read(page);
    for (const src of ['business.js', 'legal.js', 'consent.js']) {
      assert.ok(html.includes(`<script src="${src}"></script>`), `${page}: не подключает ${src}`);
    }
    assert.ok(html.indexOf('<script src="business.js">') < html.indexOf('<script src="legal.js">'), `${page}: business.js должен идти раньше legal.js`);
    // Переключателей на правовой странице два, и это разные вещи: язык
    // сайта в подвале (ru/en — столько переводов у лендинга) и язык
    // документа рядом с заголовком (все четыре). Пишут они один и тот же
    // выбор, см. landing/i18n.js.
    const doc = html.match(/<section class="page-hero">[\s\S]*?<\/section>/)[0];
    const docLangs = [...doc.matchAll(/<button type="button" data-lang="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(docLangs, LEGAL_LANGS, `${page}: у документа не те языки`);
    const foot = html.match(/<footer>[\s\S]*<\/footer>/)[0];
    const siteLangs = [...foot.matchAll(/<button type="button" data-lang="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(siteLangs, ['ru', 'en'], `${page}: у сайта не те языки`);
  }
});

test('баннер согласия и правовые ссылки — на каждой странице сайта', () => {
  for (const page of SITE) {
    const html = read(page);
    assert.ok(html.includes('<script src="consent.js"></script>'), `${page}: нет баннера согласия`);
    assert.ok(/<button[^>]*data-consent-open/.test(html), `${page}: нет кнопки «Настройки cookie»`);
    const footer = html.match(/<footer>[\s\S]*<\/footer>/)[0];
    for (const d of DOCS) {
      if (d === page) continue;
      assert.ok(footer.includes(`href="${d}"`), `${page}: в подвале нет ссылки на ${d}`);
    }
  }
});

// --- сторонние ресурсы ----------------------------------------------------------
//
// Каждый сторонний адрес в <head> — это IP посетителя, отданный третьей
// стороне до всякого согласия. Шрифты лежат у нас (landing/fonts/) с
// 7 октября 2026; исключение — служебный граф, который видит только автор.
const THIRD_PARTY_OK = {
  'graph-view.html': ['unpkg.com'],
};

test('страницы ничего не грузят со сторонних адресов', () => {
  const pages = fs.readdirSync(LANDING).filter((f) => f.endsWith('.html'));
  for (const page of pages) {
    const html = read(page);
    const hosts = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*(?:src|href)="https?:\/\/([^/"]+)/g)]
      .map((m) => m[1])
      .filter((h) => !(h === 'lancible.vercel.app'));
    const allowed = THIRD_PARTY_OK[page] || [];
    const bad = hosts.filter((h) => !allowed.includes(h));
    assert.deepEqual(bad, [], `${page}: грузит со сторонних адресов`);
  }
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(read('landing.css')), 'landing.css тянет шрифты с Google');
});

test('у каждого шрифта лендинга есть файл и лицензия рядом', () => {
  const css = read('landing.css');
  const files = [...css.matchAll(/url\('fonts\/([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 8, `в landing.css нашлось ${files.length} файлов шрифтов — разбор промахнулся?`);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(LANDING, 'fonts', f)), `нет файла шрифта ${f}`);
    const family = f.split('-')[0];
    assert.ok(fs.existsSync(path.join(LANDING, 'fonts', `${family}-OFL.txt`)), `у ${family} нет лицензии рядом`);
  }
});

// --- доступность разметки -------------------------------------------------------

/** Разметка без <script> и без адресов картинок в data:-URI: внутри них
 *  «<svg» и «<button» — это строки, а не элементы. */
function markup(page) {
  return read(page)
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/href="data:[^"]*"/g, 'href=""');
}

test('декоративные значки скрыты от читалок, смысловые — подписаны', () => {
  for (const page of SITE) {
    for (const m of markup(page).matchAll(/<svg\b([^>]*)>/g)) {
      const a = m[1];
      const ok = /aria-hidden="true"/.test(a) || (/role="img"/.test(a) && /aria-label(ledby)?="/.test(a));
      assert.ok(ok, `${page}: <svg${a.slice(0, 60)}…> без aria-hidden и без подписи`);
    }
  }
});

test('у картинок есть alt, у кнопок и ссылок — имя', () => {
  for (const page of SITE) {
    const html = markup(page);
    for (const m of html.matchAll(/<img\b([^>]*)>/g)) {
      assert.match(m[1], /\balt="/, `${page}: <img> без alt`);
    }
    for (const m of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const text = m[3].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
      const named = text || /aria-label="[^"]+"/.test(m[2]) || /title="[^"]+"/.test(m[2]);
      // Пустые места под текст, который подставит скрипт страницы, видны по id.
      const filled = /\bid="/.test(m[2]);
      assert.ok(named || filled, `${page}: <${m[1]}${m[2].slice(0, 60)}> без имени`);
    }
  }
});

test('с клавиатуры виден фокус', () => {
  assert.match(read('landing.css'), /:focus-visible\{outline:2px solid var\(--accent\)/, 'общее правило фокуса пропало из landing.css');
});

// --- честность витрины ---------------------------------------------------------

test('на сайте нет отзывов, рейтингов и счётчиков пользователей', () => {
  // Сейчас ни отзывов, ни рейтингов, ни «нас выбрали 10 000 человек» на
  // сайте нет — и появиться они могут только настоящими, с источником.
  // Тест ловит разметку и слова, по которым такое обычно узнаётся; если
  // отзыв настоящий — заведите для него исключение здесь же, со ссылкой на
  // источник.
  const SIGNS = /aggregateRating|"@type"\s*:\s*"Review"|testimonial|class="[^"]*(review|rating|stars)[^"]*"|★|(^|[^а-яё])отзывы([^а-яё]|$)|пользователей уже|users already|trusted by/i;
  for (const page of [...SITE, 'blog-posts.js']) {
    const m = read(page).match(SIGNS);
    assert.equal(m, null, `${page}: «${m && m[0]}» — отзыв или рейтинг без источника?`);
  }
});

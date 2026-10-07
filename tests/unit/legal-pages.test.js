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
    const langs = [...html.matchAll(/<button type="button" data-lang="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(langs, LEGAL_LANGS, `${page}: в переключателе не те языки`);
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

// Лендинг: инварианты, которые видно в самих файлах. Запуск: npm run test:unit
//
// Зачем. Правило «шапка и подвал лендинга одни и те же на всех его страницах»
// до сих пор держалось на внимании: общего шаблона у страниц нет, каждая
// написана руками, и расхождение заметно только если открыть две вкладки
// рядом. Так оно и разъехалось — надпись «GitHub» в шапке пряталась на узком
// экране на трёх страницах из четырёх.
//
// Почему без браузера. Всё, что здесь проверяется, читается из файла:
// разметка статическая, правила вёрстки лежат в <style> тут же, маршруты — в
// vercel.json. Это секунды и ноль зависимостей, поэтому проверки идут вместе
// с юнитами и успевают отработать в крюке перед коммитом. Рисованная часть —
// размеры, поведение на узком экране, живые коды ответа — в tests/landing/,
// она требует браузера и гоняется отдельно.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules, ruleText } = require('../css');

const LANDING = path.join(__dirname, '..', '..', 'landing');
const PAGES = ['index.html', 'blog.html', 'logs.html', 'architecture.html', 'graph.html'];

// Страницы, которых не должно быть в поиске. Они открыты по прямому адресу —
// закрывает их не пароль, а отсутствие ссылок и запрет индексации.
const PRIVATE = ['logs', 'architecture', 'graph'];

const read = (name) => fs.readFileSync(path.join(LANDING, name), 'utf8');

/** CSS, который действует на страницу: общий landing.css (если подключён),
 *  затем её собственный <style> — в том порядке, в каком их читает браузер. */
function stylesOf(page) {
  const html = read(page);
  const own = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const shared = html.includes('href="landing.css"') ? read('landing.css') : '';
  return `${shared}\n${own}`;
}

/** Содержимое единственного блока <tag>…</tag>. Падает, если блоков не один:
 *  «одна шапка на страницу» — это тоже инвариант, а не допущение. */
function onlyBlock(html, tag, page) {
  const open = new RegExp(`<${tag}[\\s>]`, 'gi');
  const n = (html.match(open) || []).length;
  assert.equal(n, 1, `${page}: блоков <${tag}> должно быть ровно один, найдено ${n}`);
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  assert.ok(m, `${page}: блок <${tag}> не разобрался`);
  return m[1];
}

/** Строки блока без пустых и без отступов — сравнивать удобнее, а смысл тот же. */
const lines = (block) => block.split('\n').map((l) => l.trim()).filter(Boolean);

// --- шапка и подвал ---------------------------------------------------------

test('подвал одинаков на всех страницах, кроме ссылки на саму себя', () => {
  // Единственное законное отличие — ссылка на саму себя: на главной нет
  // пункта «Главная». Поэтому берём самый полный подвал за образец и
  // сверяем с ним остальные, вычёркивая из образца ссылку на эту страницу.
  const got = {};
  for (const page of PAGES) got[page] = lines(onlyBlock(read(page), 'footer', page));
  const fullest = PAGES.reduce((a, b) => (got[b].length > got[a].length ? b : a));
  for (const page of PAGES) {
    const expected = got[fullest].filter((l) => !l.includes(`href="${page}"`));
    assert.deepEqual(got[page], expected,
      `${page}: подвал разошёлся с ${fullest}`);
  }
});

test('у каждой страницы ровно одна шапка и один подвал', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(onlyBlock(html, 'header', page).length > 0, `${page}: шапка пуста`);
    assert.ok(onlyBlock(html, 'footer', page).length > 0, `${page}: подвал пуст`);
  }
});

test('в шапке каждой страницы один и тот же набор ссылок, кроме своего места', () => {
  // У шапки три слота: герб слева, таблетка состояния и две ссылки справа.
  // Одна из ссылок — всегда GitHub, вторая меняется от страницы к странице
  // (на главной нельзя ссылаться на главную). Проверяем, что меняется ровно
  // она, а число ссылок и внешняя ссылка — одни и те же.
  for (const page of PAGES) {
    const head = onlyBlock(read(page), 'header', page);
    const hrefs = [...head.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
    const external = hrefs.filter((h) => h.startsWith('http'));
    assert.deepEqual(external, ['https://github.com/lancibleofficial/Lancible'],
      `${page}: внешних ссылок в шапке должно быть ровно одна — на GitHub`);
    const own = hrefs.filter((h) => !h.startsWith('http'));
    assert.ok(own.length >= 1 && own.length <= 2,
      `${page}: внутренних ссылок в шапке ${own.length}, ожидалось одна или две`);
    for (const h of own) {
      assert.ok(!h.startsWith(page),
        `${page}: шапка ссылается на саму страницу (${h})`);
    }
  }
});

test('каждая страница подключает landing.css раньше своего <style>', () => {
  // Порядок и есть смысл: общее идёт первым, чтобы страница могла его
  // подправить. Подключи общий файл после своего <style> — и он молча
  // перебьёт правки страницы.
  for (const page of PAGES) {
    const html = read(page);
    const link = html.indexOf('<link rel="stylesheet" href="landing.css">');
    const style = html.indexOf('<style');
    assert.ok(link !== -1, `${page}: не подключает landing.css`);
    assert.ok(style === -1 || link < style, `${page}: landing.css подключён после своего <style>`);
  }
});

// --- правила вёрстки шапки и подвала ---------------------------------------

/** Классы, из которых собраны шапка и подвал. Правила про них обязаны
 *  совпадать на всех страницах — иначе одна и та же шапка ведёт себя
 *  по-разному, что и случилось с надписью «GitHub». */
const CHROME = /(^|[\s,>+~])(header|footer)\b|\.(header-row|header-actions|brand|gh-link|status-pill|status-dot|footer-brand|footer-links)\b/;

function chromeCss(page) {
  return cssRules(stylesOf(page))
    .filter((r) => CHROME.test(r.sel))
    .map(ruleText)
    .sort();
}

test('шапка и подвал описаны одними и теми же правилами на всех страницах', () => {
  const base = chromeCss('blog.html');
  for (const page of PAGES) {
    const got = chromeCss(page);
    const missing = base.filter((r) => !got.includes(r));
    const extra = got.filter((r) => !base.includes(r));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
      `${page}: правила шапки/подвала разошлись с blog.html`);
  }
});

// --- ссылки ----------------------------------------------------------------

test('все ссылки внутри сайта ведут в существующий файл и существующий якорь', () => {
  const idsOf = (page) => new Set(
    [...read(page).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
  );
  const cache = {};
  const ids = (page) => (cache[page] = cache[page] || idsOf(page));

  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
      const href = m[1];
      if (/^(https?:|mailto:|data:|tel:)/.test(href)) continue;
      // /app — перенаправление на веб-версию, его разбирает vercel.json.
      if (href.startsWith('/app')) continue;
      const [file, anchor] = href.split('#');
      const target = file || page;
      assert.ok(fs.existsSync(path.join(LANDING, target)),
        `${page}: ссылка на несуществующий файл ${href}`);
      if (anchor) {
        assert.ok(ids(target).has(anchor),
          `${page}: ссылка ${href} ведёт в якорь, которого нет на ${target}`);
      }
    }
  }
});

test('в разметке нет классов, которых никто не описывает', () => {
  // Мёртвый класс — это не опечатка в стилях, а ложное обещание: кто-то
  // прочтёт разметку и решит, что элемент как-то оформлен.
  const allCss = PAGES.map(stylesOf).join('\n');
  const described = new Set([...allCss.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((m) => m[1]));
  // Классы, которые ставит и ищет сам скрипт страницы, в стилях не обязаны
  // встречаться — проверяем по тексту всей страницы, а не только по <style>.
  const unknown = new Set();
  for (const page of PAGES) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
    for (const m of html.matchAll(/\bclass="([^"]+)"/g)) {
      for (const cls of m[1].trim().split(/\s+/)) {
        if (described.has(cls)) continue;
        if (scripts.includes(cls)) continue;
        unknown.add(`${page}: .${cls}`);
      }
    }
  }
  assert.deepEqual([...unknown].sort(), [],
    'классы в разметке, которых нет ни в стилях, ни в скриптах');
});

// --- маршруты и поисковики --------------------------------------------------

const vercel = () => JSON.parse(read('vercel.json'));

test('каждый rewrite ведёт в существующий файл или наружу', () => {
  for (const r of vercel().rewrites) {
    if (/^https?:/.test(r.destination)) continue;
    const file = r.destination.split('#')[0].split('?')[0].replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(LANDING, file)),
      `rewrite ${r.source} → ${r.destination}: файла нет`);
  }
});

test('служебные страницы закрыты от поисковиков по обоим адресам', () => {
  // Адреса два: красивый (/logs) и настоящий (/logs.html). Заголовок нужен на
  // обоих — иначе страницу найдут по второму.
  const cfg = vercel();
  const noindex = new Set();
  for (const h of cfg.headers || []) {
    const tag = (h.headers || []).find((x) => x.key === 'X-Robots-Tag');
    if (tag && /noindex/.test(tag.value)) noindex.add(h.source);
  }
  const robots = read('robots.txt');
  for (const name of PRIVATE) {
    assert.ok(noindex.has(`/${name}`), `нет X-Robots-Tag для /${name}`);
    assert.ok(noindex.has(`/${name}.html`), `нет X-Robots-Tag для /${name}.html`);
    assert.ok(new RegExp(`^Disallow: /${name}$`, 'm').test(robots),
      `нет строки Disallow: /${name} в robots.txt`);
  }
  // Сам граф лежит отдельным файлом и открывается из /graph во фрейме — и
  // напрямую, кнопкой «во весь экран». Его адрес тоже должен быть закрыт.
  assert.ok(noindex.has('/graph-view.html'), 'нет X-Robots-Tag для /graph-view.html');
});

test('на служебные страницы нет ссылок с сайта', () => {
  // Весь смысл «откроет тот, кто знает адрес» держится на этом.
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
      const href = m[1].replace(/^\//, '').replace(/\.html$/, '');
      if (PRIVATE.includes(href)) {
        assert.fail(`${page}: ссылка на служебную страницу ${m[1]}`);
      }
    }
  }
});

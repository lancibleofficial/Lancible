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
const LEGAL = ['privacy.html', 'terms.html', 'cookies.html', 'refund.html', 'legal.html', 'delete-account.html'];
const PAGES = ['index.html', 'blog.html', ...LEGAL];

// Бывшие служебные страницы. До 23 октября 2026 журнал работы, устройство и
// граф кода были открыты на лендинге по прямому адресу (закрывали их только
// отсутствие ссылок и запрет индексации), а в журнале описаны уязвимости и
// как их закрывали. Теперь это разделы админки; на лендинге этих адресов нет
// вовсе — 404, и никакого перенаправления: адрес админки не рекламируется.
const REMOVED = ['logs', 'architecture', 'graph', 'graph-view'];

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
const CHROME = /(^|[\s,>+~])(header|footer)\b|\.(header-row|header-actions|brand|gh-link|status-pill|status-dot|footer-brand|footer-links|footer-legal|footer-consent)\b/;

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

// --- один адрес -----------------------------------------------------------------
//
// С 6 октября 2026 у продукта один адрес — lancible.vercel.app, и всё
// открывается от него: лендинг, веб (/app) и блог.
// До этого веб жил отдельным проектом Vercel со своим адресом, а лендинг
// проксировал на него /app. Исключения по решению — будущая админ-панель и
// служебные функции без страниц.

test('перенаправления лендинга никуда наружу не уводят', () => {
  const cfg = vercel();
  for (const r of [...(cfg.rewrites || []), ...(cfg.redirects || [])]) {
    assert.ok(r.destination.startsWith('/'), `${r.source} → ${r.destination}: ведёт на другой адрес`);
  }
});

test('в коде и настройках из адресов Vercel — только lancible.vercel.app (и адрес админки)', () => {
  // Документация и журнал рассказывают историю переезда и называют старый
  // адрес — их не смотрим; код, разметку и настройки — смотрим все.
  // Исключение из правила «один адрес» (CLAUDE.md) — админ-панель, отдельный
  // проект Vercel (23 октября 2026): её адрес знают только сама админка,
  // функция admin (CORS) и их тесты.
  const ALLOWED = new Set(['lancible.vercel.app', 'lancible-admin.vercel.app']);
  const ROOT = path.join(LANDING, '..');
  const SKIP = /(^|[\\/])(node_modules|\.git|graphify-out|test-results[\w-]*|dist|logs|vendor|\.vercel)([\\/]|$)|^landing[\\/]app[\\/]|^web[\\/](app\.js|styles\.css|xlsx\.js|core[\\/])/;
  const EXT = /\.(js|json|html|css|yml)$/;
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (SKIP.test(rel)) continue;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!EXT.test(e.name) || /package-lock\.json$/.test(e.name)) continue;
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/[a-z0-9-]+\.vercel\.app/g)) {
        if (!ALLOWED.has(m[0])) found.push(`${rel}: ${m[0]}`);
        // Адрес админки — только в самой админке, её функции и тестах.
        else if (m[0] === 'lancible-admin.vercel.app' && !/^(admin|supabase[\\/]functions[\\/]admin|tests)[\\/]/.test(rel)) found.push(`${rel}: ${m[0]} — адрес админки вне админки`);
      }
    }
  };
  for (const dir of ['src', 'web', 'mobile', 'landing', 'scripts', 'tests', '.github', 'admin', 'supabase']) walk(dir);
  assert.deepEqual(found, [], 'чужие адреса Vercel');
});

test('веб собирается внутрь лендинга целиком', () => {
  // Сборку делает проект лендинга: ставит пакеты веба и зовёт скрипт сборки.
  const cfg = vercel();
  assert.match(cfg.installCommand || '', /--prefix \.\.\/web/, 'лендинг не ставит пакеты веба');
  assert.match(cfg.buildCommand || '', /build-landing-app\.js/, 'лендинг не собирает веб');
  // Всё, что подключает страница веба, должно доехать в /app: служебное, что
  // сборка выбрасывает, не может быть ничем из этого.
  const { EXCLUDE } = require('../../scripts/build-landing-app.js');
  const html = fs.readFileSync(path.join(LANDING, '..', 'web', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10, 'страница веба почти ничего не подключает — разбор промахнулся');
  const lost = refs.filter((r) => EXCLUDE.has(r.replace(/^\.\//, '').split('/')[0]));
  assert.deepEqual(lost, [], 'сборка выбросит то, что страница веба подключает');
});

test('каждый rewrite ведёт в существующий файл или наружу', () => {
  for (const r of vercel().rewrites) {
    if (/^https?:/.test(r.destination)) continue;
    const file = r.destination.split('#')[0].split('?')[0].replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(LANDING, file)),
      `rewrite ${r.source} → ${r.destination}: файла нет`);
  }
});

test('служебных страниц на лендинге нет: ни файлов, ни маршрутов, ни строк в robots.txt', () => {
  // Старые адреса должны отвечать 404: файла нет, rewrite в него не ведёт, а
  // redirect не уводит на админку — её адрес на сайте не звучит нигде.
  const cfg = vercel();
  const routes = [...(cfg.rewrites || []), ...(cfg.redirects || []), ...(cfg.headers || [])];
  const robots = read('robots.txt');
  for (const name of REMOVED) {
    assert.ok(!fs.existsSync(path.join(LANDING, `${name}.html`)), `landing/${name}.html снова на месте — служебные страницы живут в админке`);
    const re = new RegExp(`^/${name}(\\.html)?$`);
    const hit = routes.filter((r) => re.test(r.source || '') || re.test(r.destination || ''));
    assert.deepEqual(hit.map((r) => r.source), [], `vercel.json: маршрут или заголовок для /${name}`);
    assert.ok(!new RegExp(`/${name}\\b`).test(robots), `robots.txt называет /${name} — адрес, которого нет, называть незачем`);
  }
  for (const r of routes) {
    assert.ok(!/admin/i.test(`${r.source} ${r.destination || ''}`), `vercel.json: ${r.source} ведёт в админку`);
  }
});

test('на бывшие служебные страницы нет ссылок с сайта', () => {
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
      const href = m[1].replace(/^\//, '').replace(/\.html$/, '');
      if (REMOVED.includes(href)) {
        assert.fail(`${page}: ссылка на бывшую служебную страницу ${m[1]}`);
      }
    }
  }
});

/** Кнопки скачивания на главной: версия из подписи над кнопкой и адрес, у
 *  которого заданное расширение. */
function downloadCards(ext) {
  const html = read('index.html');
  return [...html.matchAll(/<span>v(\d+\.\d+\.\d+)<\/span>[\s\S]*?<a class="platform-cta" href="([^"]+)"/g)]
    .filter(([, , href]) => ext.test(href))
    .map(([, version, href]) => ({ version, href }));
}
const R2_HOST = /^https:\/\/pub-[0-9a-f]+\.r2\.dev\//;

test('кнопки скачивания десктопа ведут в R2, на версию из подписи', () => {
  // С 10 октября 2026 установщики раздаёт Cloudflare R2: с GitHub Releases
  // они шли у части людей ~19 КБ/с, и установщик в 82 МБ качался час.
  // Раскладка в бакете — v<версия>/<файл>, как кладёт .github/workflows/release.yml.
  // Подпись над кнопкой и адрес — одна версия, иначе кнопка обещает одно, а
  // отдаёт другое.
  const cards = downloadCards(/\.(exe|dmg)$/);
  assert.equal(cards.length, 2, 'на главной две кнопки десктопа: .exe и .dmg');
  for (const { version, href } of cards) {
    assert.match(href, R2_HOST, `${href}: установщик должен идти из R2, а не с GitHub`);
    assert.ok(href.includes(`/v${version}/`) && href.includes(version), `${href}: адрес не на версию v${version} из подписи`);
  }
});

test('кнопка APK ведёт в R2, на версию из подписи', () => {
  // APK (~96 МБ) с GitHub Releases идёт с той же скоростью, что установщики, и
  // раздаётся оттуда же: mobile-v<версия>/Lancible-<версия>.apk. Путь собирает
  // mobileRelease — ту же функцию зовут mobile-release.yml и mirror-release.yml,
  // так что кнопка не разойдётся с тем, куда файл реально кладётся.
  // Сам файл в R2 появляется зеркалом (mirror-release.yml -f tag=mobile-v…) —
  // до пуша лендинга.
  const { mobileRelease } = require('../../scripts/publish-release.js');
  const cards = downloadCards(/\.apk$/);
  assert.equal(cards.length, 1, 'на главной одна кнопка APK');
  const { version, href } = cards[0];
  assert.match(href, R2_HOST, `${href}: APK должен идти из R2, а не с GitHub`);
  assert.ok(href.endsWith(`/${mobileRelease(`mobile-v${version}`).key}`), `${href}: адрес не на mobile-v${version} из подписи`);
});

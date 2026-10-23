// Лента блога — из базы, с запасом в файле. Запуск: npm run test:landing
//
// Откуда тест (23 октября 2026, админ-панель): «посты лендинга — из базы,
// сразу». blog.html и блок блога на главной читают опубликованные записи из
// таблицы blog_posts (Supabase REST, публичный ключ anon); пока база не ответила, а также без сети, без таблицы и без
// записей — лента из landing/blog-posts.js, пустой она не бывает. Порядок —
// по дате, свежие сверху; записи одного дня — как в файле, чтобы якоря
// blog.html#p-ГГГГ-ММ-ДД-2 не поменяли смысл. Ссылка на запись, которая есть
// только в базе, прокручивает к ней, когда база ответила.
//
// База подменяется на уровне сети (page.route): что ушло — то и проверяется.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const LANDING = path.join(__dirname, '..', '..', 'landing');

/** Записи файла — как их видит страница (window.LANCIBLE_POSTS). */
function filePosts() {
  const win = {};
  new Function('window', fs.readFileSync(path.join(LANDING, 'blog-posts.js'), 'utf8'))(win);
  return win.LANCIBLE_POSTS;
}
const FILE = filePosts();

/** Запись в том виде, в каком её отдаёт PostgREST. */
const row = (p, createdAt = '2026-10-23T09:00:00+00:00') => ({
  date: p.date, tag: p.tag, version: p.version || null, title: p.title, body: p.body, created_at: createdAt,
});

/** Новые записи — их в файле нет. */
const NEW = {
  date: '2026-11-02',
  tag: 'feature',
  version: '0.6.0',
  title: { ru: 'Админ-панель и посты из базы', en: 'Admin panel and posts from the database' },
  body: { ru: ['Первый абзац.', 'Второй абзац.'], en: ['First paragraph.', 'Second paragraph.'] },
};
const NEW2 = {
  date: '2026-11-01',
  tag: 'improvement',
  title: { ru: 'Счётчик экранов', en: 'Screen statistics' },
  body: { ru: ['Только имя экрана.'], en: ['Only the screen name.'] },
};

/** Подменить blog_posts. answer(route) — свой ответ; по умолчанию rows.
 *  Возвращает журнал запросов. */
async function base(page, { rows = [], answer } = {}) {
  const log = [];
  await page.route('**/rest/v1/blog_posts**', async (route) => {
    const req = route.request();
    log.push({ method: req.method(), url: new URL(req.url()), headers: req.headers() });
    if (answer) return answer(route);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(rows),
    });
  });
  return log;
}

const titles = (page) => page.locator('#blogList .blog-entry .blog-title');

test.use({ locale: 'ru-RU' });

test('blog.html: опубликованные записи из базы, свежие сверху, язык сайта', async ({ page }) => {
  // База отдаёт вперемешку — порядок ставит страница.
  const rows = [row(FILE[1]), row(NEW2), row(FILE[0]), row(NEW)];
  const log = await base(page, { rows });
  await page.goto('/blog.html');
  await expect(titles(page)).toHaveText([NEW.title.ru, NEW2.title.ru, FILE[0].title.ru, FILE[1].title.ru]);

  // Запрос — чтение опубликованного публичным ключом, без клиентской библиотеки.
  const get = log.find((r) => r.method === 'GET');
  expect(get, 'страница не спросила базу').toBeTruthy();
  expect(get.url.origin).toBe('https://yiglgfkjjvwijukdzutw.supabase.co');
  expect(get.url.searchParams.get('published')).toBe('eq.true');
  expect(get.url.searchParams.get('select').split(',')).toEqual(expect.arrayContaining(['date', 'tag', 'version', 'title', 'body']));
  const key = get.headers.apikey;
  expect(JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role, 'ключ — anon').toBe('anon');
  expect(get.headers.authorization).toBe(`Bearer ${key}`);

  // Запись из базы — как запись из файла: дата, версия-ссылка, ярлык, абзацы.
  const first = page.locator('#blogList .blog-entry').first();
  await expect(first).toHaveAttribute('id', 'p-2026-11-02');
  await expect(first).toHaveClass(/latest/);
  await expect(first.locator('.blog-version')).toHaveText('0.6.0');
  await expect(first.locator('.blog-version')).toHaveAttribute('href', '#p-2026-11-02');
  await expect(first.locator('.blog-tag')).toHaveText('Новое');
  await expect(first.locator('.blog-text p')).toHaveText(NEW.body.ru);
  // Фильтр считает записи базы.
  await expect(page.locator('#blogFilter button[data-filter="all"] .filter-count')).toHaveText('4');

  // Язык — общий для сайта; украинскому и казахскому — английский текст записи.
  await page.click('footer .lang-switch button[data-lang="en"]');
  await expect(titles(page).first()).toHaveText(NEW.title.en);
  await page.evaluate(() => window.LancibleLang.set('uk'));
  await expect(titles(page).first()).toHaveText(NEW.title.en);
  await expect(page.locator('#blogList .blog-entry').first().locator('.blog-text p')).toHaveText(NEW.body.en);
});

test('главная: три свежие записи из базы и «Все записи»', async ({ page }) => {
  await base(page, { rows: [row(FILE[0]), row(NEW), row(FILE[2]), row(NEW2), row(FILE[1])] });
  await page.goto('/index.html');
  await expect(titles(page)).toHaveText([NEW.title.ru, NEW2.title.ru, FILE[0].title.ru]);
  await expect(page.locator('#blogList .blog-entry').first()).toHaveClass(/latest/);
  await expect(page.locator('#blogMore')).toBeVisible();
  await expect(page.locator('#blogMoreBtn')).toHaveAttribute('href', 'blog.html');
});

test('пока база молчит — лента из файла; ответила — её записи, пустой лента не бывает', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const log = await base(page, {
    answer: async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([row(NEW), ...FILE.map((p) => row(p))]) });
    },
  });
  await page.goto('/blog.html');
  await expect.poll(() => log.length, 'страница спросила базу').toBeGreaterThan(0);
  await expect(page.locator('#blogList .blog-entry')).toHaveCount(FILE.length);
  await expect(titles(page).first()).toHaveText(FILE[0].title.ru);
  release();
  await expect(titles(page).first()).toHaveText(NEW.title.ru);
  await expect(page.locator('#blogList .blog-entry')).toHaveCount(FILE.length + 1);
});

test('нет сети, нет таблицы, пусто, кривые строки — запасная лента из blog-posts.js', async ({ page }) => {
  const answers = {
    'нет сети': (route) => route.abort('internetdisconnected'),
    'нет таблицы': (route) => route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.blog_posts'" }) }),
    'база упала': (route) => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'unavailable' }),
    'пусто': (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
    'кривые строки': (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ date: 'вчера', title: { ru: 'x' } }, { date: '2026-11-03', title: null }]) }),
  };
  for (const [what, answer] of Object.entries(answers)) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const log = await base(page, { answer });
    await page.goto('/blog.html');
    await expect.poll(() => log.length, `${what}: страница спросила базу`).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    await expect(page.locator('#blogList .blog-entry'), what).toHaveCount(FILE.length);
    await expect(titles(page).first(), what).toHaveText(FILE[0].title.ru);
    await expect(page.locator('#blogList .blog-empty'), what).toHaveCount(0);

    await page.goto('/index.html');
    await expect(titles(page), `${what}: главная`).toHaveText(FILE.slice(0, 3).map((p) => p.title.ru));
  }
});

test('якоря: запись только из базы — прокрутка к ней, записи одного дня — в порядке файла', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // База отдаёт записи одного дня в обратном порядке и с одним временем
  // заведения (сид кладёт их одной вставкой) — порядок дня держит файл.
  const day = FILE.filter((p) => p.date === '2026-10-10');
  expect(day.length, 'в файле несколько записей 10 октября').toBeGreaterThan(1);
  const rows = [...FILE].reverse().map((p) => row(p, '2026-10-23T09:00:00+00:00'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await base(page, {
    answer: async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([...rows, row(NEW2), row(NEW)]) });
    },
  });

  // Ссылка на запись, которой в файле нет: пока база молчит — её нет на
  // странице; ответила — страница сама к ней прокрутилась.
  await page.goto('/blog.html#p-2026-11-01');
  await expect(page.locator('#blogList .blog-entry')).toHaveCount(FILE.length);
  await expect(page.locator('#p-2026-11-01')).toHaveCount(0);
  release();
  const target = page.locator('#p-2026-11-01');
  await expect(target.locator('.blog-title')).toHaveText(NEW2.title.ru);
  await expect.poll(() => target.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  // Записи 10 октября — те же якоря, что у ленты из файла.
  for (const [i, p] of day.entries()) {
    const id = i === 0 ? 'p-2026-10-10' : `p-2026-10-10-${i + 1}`;
    await expect(page.locator(`#${id} .blog-title`), id).toHaveText(p.title.ru);
  }
});

test('якорь записи из файла: прокрутка сразу, а ответ базы с новой записью сверху её не сбивает', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const anchorPost = FILE.find((p) => p.date === '2026-10-13');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await base(page, {
    answer: async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([row(NEW), row(NEW2), ...FILE.map((p) => row(p))]) });
    },
  });
  await page.goto('/blog.html#p-2026-10-13');
  const target = page.locator('#p-2026-10-13');
  await expect(target.locator('.blog-title')).toHaveText(anchorPost.title.ru);
  const top = () => target.evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await expect.poll(top).toBeLessThan(200);
  release();
  await expect(page.locator('#blogList .blog-entry')).toHaveCount(FILE.length + 2);
  // Две новые записи встали выше — запись по ссылке осталась у верхнего края.
  await expect.poll(top).toBeLessThan(200);
  await expect.poll(top).toBeGreaterThan(-5);
});

// Страницы о коде: граф и схема архитектуры. Запуск: npm run test:landing
//
// Что эти страницы обещают, проверяется здесь по отрисованному. Числа на них
// сторожит tests/unit/architecture.test.js — по тексту файлов; сюда попало
// то, что видно только в браузере: граф правда рисуется, окно с ним занимает
// место, а подписи на схеме читаются и не наезжают одна на другую.
const { test, expect } = require('@playwright/test');

test.describe('/graph', () => {
  test('граф рисуется в окне на странице', async ({ page }) => {
    // vis-network приезжает с unpkg, а граф раскладывается сам — на 1900
    // узлах это секунды. Отсюда и запас по времени.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/graph');
    const frame = page.frameLocator('iframe.graph-frame');
    // Граф рисуется на <canvas> внутри #graph. Есть холст с размером — значит
    // библиотека загрузилась, данные разобрались и отрисовка прошла.
    const canvas = frame.locator('#graph canvas');
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    const box = await canvas.boundingBox();
    expect(box.width, 'холст графа слишком узкий').toBeGreaterThan(400);
    expect(box.height, 'холст графа слишком низкий').toBeGreaterThan(400);
    // Граф живёт во фрейме, и стоит его странице поставить фокус в поиск —
    // браузер прокрутит к фрейму всю страницу, и описание над графом уедет
    // из виду. Открываться страница должна сверху.
    expect(await page.evaluate(() => window.scrollY), 'страницу прокрутило при загрузке графа').toBe(0);
  });

  for (const width of [1280, 375]) {
    test(`окно с графом во всю ширину и не ниже 520 при ширине ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/graph');
      const got = await page.evaluate(() => {
        const f = document.querySelector('iframe.graph-frame').getBoundingClientRect();
        return { w: Math.round(f.width), h: Math.round(f.height), page: document.documentElement.clientWidth };
      });
      expect(got.w, 'окно уже страницы').toBe(got.page);
      expect(got.h, 'окно ниже 520').toBeGreaterThanOrEqual(520);
    });
  }

  test('сам граф отдаётся и закрыт от поисковиков', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}/graph-view.html`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

test.describe('/architecture: схема', () => {
  /** Прямоугольники всех подписей схемы в координатах страницы. */
  const labels = (page) => page.evaluate(() => {
    const svg = document.querySelector('figure svg[role="img"]');
    const frame = svg.getBoundingClientRect();
    return {
      frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom },
      texts: [...svg.querySelectorAll('text')].map((t) => {
        const r = t.getBoundingClientRect();
        return { text: t.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
    };
  });

  test('подписи не наезжают друг на друга и не вылезают за схему', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/architecture');
    await page.evaluate(() => document.fonts.ready);
    const { frame, texts } = await labels(page);
    expect(texts.length, 'на схеме нет подписей — селектор промахнулся').toBeGreaterThan(10);

    for (const t of texts) {
      expect(t.left >= frame.left - 0.5 && t.right <= frame.right + 0.5
        && t.top >= frame.top - 0.5 && t.bottom <= frame.bottom + 0.5,
      `«${t.text}» вылезает за схему`).toBe(true);
    }
    // Полпикселя — на сглаживание: соседние строки одного узла законно
    // касаются краями.
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const clashes = [];
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        if (overlap(texts[i], texts[j])) clashes.push(`«${texts[i].text}» × «${texts[j].text}»`);
      }
    }
    expect(clashes, 'подписи наезжают друг на друга').toEqual([]);
  });

  test('на схеме есть связь лендинга с вебом', async ({ page }) => {
    // Пользователи попадают в веб-версию с лендинга, по адресу /app. На
    // прежней схеме этой связи не было.
    await page.goto('/architecture');
    const { texts } = await labels(page);
    expect(texts.map((t) => t.text)).toContain('/app');
  });
});

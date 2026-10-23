// Журнал, «Устройство» и граф кода в админке. Запуск: npx playwright test --project=admin
//
// До 23 октября 2026 это были служебные страницы лендинга (/logs,
// /architecture, /graph), а их отрисовку проверял
// tests/landing/code-pages.spec.js. Теперь это разделы админки: журнал — из
// функции admin (logs.list, подменена в mock.js), текст «Устройства» и данные
// графа — статикой из admin/. Страница получает ту же политику безопасности,
// что на сайте ({ csp: true }): нарушение — строка в консоли, то есть провал
// (проверяет приспособление open в mock.js). Числа «Устройства» и вид данных
// графа сверяет tests/unit/architecture.test.js — по тексту файлов.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, sitePolicy } = require('./mock');

const GRAPH = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'graph', 'graph.json'), 'utf8'));

/** Адреса статики, которую тянула страница: content/, graph/, vendor/vis-network. */
function watchStatic(page) {
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^\/(content\/architecture|graph\/graph\.json|vendor\/vis-network)/.test(u.pathname)) seen.push(u.pathname);
  });
  return seen;
}

/** Кнопки сегментного фильтра: «подпись число». */
const seg = (loc) => loc.evaluateAll((els) => els.map((b) => {
  const n = b.querySelector('.seg-count');
  return `${b.firstChild.textContent}${n ? ` ${n.textContent}` : ''}`;
}));

test('политика сайта в этих тестах настоящая: страница её получает, а нарушение видно как ошибка', async ({ page, open }) => {
  // Без этой проверки «граф рисуется под политикой» могло бы значить
  // «политики не было вовсе».
  const backend = await open({ signedIn: 'aal2', csp: true });
  const res = await page.goto('/#/overview');
  expect(res.headers()['content-security-policy']).toBe(sitePolicy());
  const width = await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('style', 'width: 123px');
    document.body.append(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return w;
  });
  expect(width, 'стиль строкой применился — политики нет').not.toBe(123);
  await expect.poll(() => backend.errors.some((e) => /Content Security Policy/.test(e))).toBe(true);
  backend.errors.length = 0; // нарушение — нарочное
});

// ---------- журнал ----------

test.describe('Журнал', () => {
  test('рисуется из logs.list: задачи свежими первыми, статус, срок, круги, события по времени', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2', csp: true });
    await page.goto('/#/logs');
    await expect(page.locator('.page-title')).toHaveText('Журнал');
    const cards = page.locator('.log-task');
    await expect(cards).toHaveCount(3);
    expect(await cards.evaluateAll((els) => els.map((e) => e.dataset.id))).toEqual(['2026-10-23-admin', '2026-10-22-blog', '2026-10-21-agent']);
    expect(backend.callsOf('logs.list')).toEqual([{ action: 'logs.list', page: 1, per: 20 }]);

    const a = page.locator('.log-task[data-id="2026-10-21-agent"]');
    await expect(a.locator('.log-task-title')).toHaveText('ИИ-агент по приглашению');
    await expect(a.locator('.log-task-summary')).toHaveText('Доступ к агенту — по списку ai_access, лимит 50 в сутки.');
    await expect(a.locator('[data-role="status"]')).toHaveText('Задеплоено');
    await expect(a.locator('.log-task-meta')).toContainText('20 октября 2026 — 21 октября 2026');
    await expect(a.locator('.log-task-meta')).toContainText('кругов правок: 2');
    await expect(a.locator('[data-role="count"]')).toHaveText('5 событий');
    expect(await a.locator('.log-event').evaluateAll((els) => els.map((e) => e.dataset.kind))).toEqual(['request', 'change', 'error', 'fix', 'deploy']);
    await expect(a.locator('.log-event[data-kind="error"] .log-kind')).toHaveText('Ошибка');
    await expect(a.locator('.log-event[data-kind="error"] .log-detail')).toHaveText('getUser без токена бросал исключение,\nа не возвращал ошибку');
    await expect(a.locator('.log-event[data-kind="fix"] .log-round')).toHaveText('круг 2');
    await expect(a.locator('.log-event[data-kind="request"] .log-round')).toHaveCount(0);
    await expect(a.locator('.log-event').first().locator('.log-time')).toHaveText(/^\d\d:\d\d$/);
    // События — по времени, а не в порядке ответа (в ответе check раньше error).
    const b = page.locator('.log-task[data-id="2026-10-22-blog"]');
    expect(await b.locator('.log-event').evaluateAll((els) => els.map((e) => e.dataset.kind))).toEqual(['change', 'error', 'check']);
    await expect(b.locator('[data-role="status"]')).toHaveText('На проверке');
    await expect(b.locator('.log-task-meta')).not.toContainText('—');
    await expect(page.locator('.log-task[data-id="2026-10-23-admin"]')).toContainText('Событий пока нет.');
    await expect(page.locator('#logs-updated')).toHaveText(/^обновлено в \d\d:\d\d$/);
    // Перенос строки в подробностях — как написан.
    expect(await a.locator('.log-event[data-kind="error"] .log-detail').evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');
  });

  test('фильтры: вид события и статус задачи — со счётчиками; пустые виды прячутся; выбор уходит в logs.list', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2', csp: true });
    await page.goto('/#/logs');
    await expect(page.locator('.log-task')).toHaveCount(3);
    const kinds = page.locator('#logs-kind button');
    expect(await seg(kinds)).toEqual(['Все события 8', 'Правка 1', 'Изменение 2', 'Ошибка 2', 'Починено 1', 'Проверка 1', 'Деплой 1']);
    const statuses = page.locator('#logs-status button');
    expect(await seg(statuses)).toEqual(['Все задачи 3', 'В работе 1', 'На проверке 1', 'Принято 0', 'Задеплоено 1']);

    await kinds.filter({ hasText: 'Ошибка' }).click();
    await expect.poll(() => backend.callsOf('logs.list').length).toBe(2);
    expect(backend.callsOf('logs.list')[1]).toEqual({ action: 'logs.list', page: 1, per: 20, kind: 'error' });
    await expect(page.locator('.log-task')).toHaveCount(2);
    await expect(page.locator('.log-event')).toHaveCount(2);
    await expect(page.locator('.log-task[data-id="2026-10-21-agent"] [data-role="count"]')).toHaveText('1 из 5 событий');
    await expect(page.locator('.log-task[data-id="2026-10-22-blog"] [data-role="count"]')).toHaveText('1 из 3 событий');
    await expect(page.locator('#logs-kind button.on')).toContainText('Ошибка');

    // Статус «На проверке»: у этих задач нет правок, починок и деплоя — их
    // кнопки прячутся; выбранная «Ошибка» остаётся.
    await statuses.filter({ hasText: 'На проверке' }).click();
    await expect.poll(() => backend.callsOf('logs.list').length).toBe(3);
    expect(backend.callsOf('logs.list')[2]).toEqual({ action: 'logs.list', page: 1, per: 20, status: 'review', kind: 'error' });
    await expect(page.locator('.log-task')).toHaveCount(1);
    expect(await seg(page.locator('#logs-kind button'))).toEqual(['Все события 3', 'Изменение 1', 'Ошибка 1', 'Проверка 1']);

    await page.locator('#logs-kind button').filter({ hasText: 'Все события' }).click();
    await page.locator('#logs-status button').filter({ hasText: 'Все задачи' }).click();
    await expect.poll(() => backend.callsOf('logs.list').length).toBe(5);
    expect(backend.callsOf('logs.list')[4]).toEqual({ action: 'logs.list', page: 1, per: 20 });
    await expect(page.locator('.log-task')).toHaveCount(3);
  });

  test('«Показать ещё» дописывает следующую страницу, «Обновить» начинает с первой', async ({ page, open }) => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `t-${String(i).padStart(2, '0')}`, title: `Задача ${i}`, summary: null, status: 'accepted', round: 1,
      startedAt: '2026-10-01T08:00:00Z', updatedAt: `2026-10-${String(25 - i).padStart(2, '0')}T08:00:00Z`, eventsTotal: 1,
      events: [{ kind: 'change', title: `Шаг ${i}`, detail: null, round: 1, at: '2026-10-01T09:00:00Z' }],
    }));
    const backend = await open({ signedIn: 'aal2', csp: true, handlers: {
      'logs.list': ({ page: p = 1, per = 20 }) => ({ total: 25, page: p, per, rows: many.slice((p - 1) * per, p * per), counts: { statuses: { all: 25, in_progress: 0, review: 0, accepted: 25, deployed: 0 }, kinds: { all: 25, request: 0, change: 25, error: 0, fix: 0, check: 0, deploy: 0 } } }),
    } });
    await page.goto('/#/logs');
    await expect(page.locator('.log-task')).toHaveCount(20);
    await page.locator('#logs-more').click();
    await expect(page.locator('.log-task')).toHaveCount(25);
    await expect(page.locator('#logs-more')).toHaveCount(0);
    expect(backend.callsOf('logs.list').map((c) => c.page)).toEqual([1, 2]);
    await page.locator('#logs-reload').click();
    await expect(page.locator('.log-task')).toHaveCount(20);
    expect(backend.callsOf('logs.list').map((c) => c.page)).toEqual([1, 2, 1]);
  });

  test('нет таблиц журнала — подсказка про supabase/logs.sql; пустой журнал — пустое состояние', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2', csp: true, handlers: { 'logs.list': () => ({ __status: 500, body: { error: 'setup', code: 'PGRST205' } }) } });
    await page.goto('/#/logs');
    await expect(page.locator('#logs-setup')).toContainText('supabase/logs.sql');
    backend.handlers['logs.list'] = () => ({ total: 0, page: 1, per: 20, rows: [], counts: { statuses: { all: 0 }, kinds: { all: 0 } } });
    await page.locator('#logs-reload').click();
    await expect(page.locator('.empty-state-title')).toHaveText('Журнал пуст');
  });
});

// ---------- устройство ----------

test.describe('Устройство', () => {
  test('текст грузится, только когда раздел открыт', async ({ page, open }) => {
    await open({ signedIn: 'aal2', csp: true });
    const seen = watchStatic(page);
    await page.goto('/#/overview');
    await expect(page.locator('.ch-bar').first()).toBeAttached();
    expect(seen).toEqual([]);
    await page.locator('.rail-item[data-section="architecture"]').click();
    await expect(page.locator('.page-title')).toHaveText('Устройство');
    await expect(page.locator('#arch .arch-sec')).toHaveCount(9);
    // Без .html: на Vercel (cleanUrls) адрес с .html отвечает перенаправлением.
    expect(seen).toEqual(['/content/architecture']);
    await expect(page.locator('#arch .arch-sec h2').first()).toHaveText('Четыре поверхности');
    await expect(page.locator('#arch .arch-stats .stat')).toHaveCount(4);
    await expect(page.locator('#arch .arch-stats .stat-value').first()).toHaveText(/^\d+$/);
    await expect(page.locator('#arch #design .tbl')).toHaveCount(4);
    // Разметка — своя, без скриптов и стилей строкой.
    expect(await page.locator('#arch').evaluate((el) => el.querySelectorAll('script, style, [style]').length)).toBe(0);
  });

  /** Прямоугольники всех подписей схемы в координатах страницы. */
  const labels = (page) => page.evaluate(() => {
    const svg = document.querySelector('#arch figure svg[role="img"]');
    const frame = svg.getBoundingClientRect();
    return {
      frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom, width: frame.width },
      texts: [...svg.querySelectorAll('text')].map((t) => {
        const r = t.getBoundingClientRect();
        return { text: t.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
    };
  });

  for (const width of [1280, 1024]) {
    test(`подписи схемы не наезжают друг на друга и не вылезают за схему на ${width}`, async ({ page, open }) => {
      await open({ signedIn: 'aal2', csp: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/architecture');
      await expect(page.locator('#arch figure svg')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const { frame, texts } = await labels(page);
      expect(texts.length, 'на схеме нет подписей — селектор промахнулся').toBeGreaterThan(10);
      expect(frame.width, 'схема сжалась').toBeGreaterThan(600);
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
  }

  test('на схеме есть связь лендинга с вебом и с базой (блог)', async ({ page, open }) => {
    await open({ signedIn: 'aal2', csp: true });
    await page.goto('/#/architecture');
    await expect(page.locator('#arch figure svg')).toBeVisible();
    const { texts } = await labels(page);
    expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(['/app', 'блог']));
  });
});

// ---------- граф кода ----------

test.describe('Граф кода', () => {
  test('граф и библиотека грузятся только при открытии раздела', async ({ page, open }) => {
    await open({ signedIn: 'aal2', csp: true });
    const seen = watchStatic(page);
    await page.goto('/#/overview');
    await expect(page.locator('.ch-bar').first()).toBeAttached();
    await page.locator('.rail-item[data-section="logs"]').click();
    await expect(page.locator('.log-task')).toHaveCount(3);
    expect(seen, 'граф грузится до открытия раздела').toEqual([]);
    await page.locator('.rail-item[data-section="graph"]').click();
    await expect(page.locator('#graph-canvas canvas')).toBeVisible({ timeout: 30_000 });
    expect(seen.slice().sort()).toEqual(['/graph/graph.json', '/vendor/vis-network-9.1.6.min.js']);
    // Второй заход — библиотека уже есть, приходят только данные.
    await page.locator('.rail-item[data-section="logs"]').click();
    await page.locator('.rail-item[data-section="graph"]').click();
    await expect(page.locator('#graph-canvas canvas')).toBeVisible({ timeout: 30_000 });
    expect(seen.filter((u) => u.includes('vis-network'))).toHaveLength(1);
  });

  test('граф рисуется под строгой политикой сайта: холст во всю ширину острова и не ниже 400, числа графа', async ({ page, open }) => {
    test.setTimeout(60_000);
    await open({ signedIn: 'aal2', csp: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/#/graph');
    const canvas = page.locator('#graph-canvas canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    const box = await canvas.boundingBox();
    const shell = await page.locator('#graph-shell').boundingBox();
    expect(box.width, 'холст графа слишком узкий').toBeGreaterThan(600);
    expect(box.height, 'холст графа слишком низкий').toBeGreaterThan(400);
    expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width);
    expect(await page.evaluate(() => window.scrollY), 'страницу прокрутило при загрузке графа').toBe(0);
    const stats = await page.locator('#graph-stats .stat-value').allInnerTexts();
    const n = (v) => new Intl.NumberFormat('ru-RU').format(v);
    expect(stats).toEqual([n(GRAPH.meta.nodes), n(GRAPH.meta.edges), n(GRAPH.meta.communities), GRAPH.meta.date]);
    await expect(page.locator('#graph-legend .graph-legend-item')).toHaveCount(GRAPH.legend.length);
    // Цвет сообщества — данные графа, переменной: политика сайта её пускает.
    const first = GRAPH.legend[0];
    const rgb = await page.evaluate((hex) => { const d = document.createElement('div'); d.style.color = hex; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, first.color);
    expect(await page.locator(`#graph-legend [data-cid="${first.cid}"] .node-dot`).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rgb);
    // Подсказка над узлом — правилом admin.css (свои стили vis не пускает политика).
    const tip = await page.evaluate(() => {
      const d = document.createElement('div'); d.className = 'vis-tooltip'; document.body.append(d);
      const s = getComputedStyle(d); const out = { position: s.position, visibility: s.visibility, pointer: s.pointerEvents }; d.remove(); return out;
    });
    expect(tip).toEqual({ position: 'absolute', visibility: 'hidden', pointer: 'none' });
  });

  test('поиск находит узел и показывает его карточку; легенда прячет сообщество; во весь экран и обратно', async ({ page, open }) => {
    test.setTimeout(60_000);
    await open({ signedIn: 'aal2', csp: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/#/graph');
    await expect(page.locator('#graph-canvas canvas')).toBeVisible({ timeout: 30_000 });
    const node = GRAPH.nodes[0];
    await page.locator('#graph-search').fill(node.label);
    const hit = page.locator(`#graph-results .graph-link[data-nid="${node.id}"]`);
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page.locator('#graph-results')).toBeHidden();
    await expect(page.locator('#graph-info')).toHaveAttribute('data-node', String(node.id));
    await expect(page.locator('#graph-info dd').first()).toHaveText(node.label);
    await page.locator('#graph-search').fill('такого-узла-нет-точно');
    await expect(page.locator('#graph-results')).toContainText('Ничего не нашлось');
    await page.locator('#graph-search').fill('');
    await expect(page.locator('#graph-results')).toBeHidden();

    const c0 = page.locator(`#graph-legend [data-cid="${GRAPH.legend[0].cid}"]`);
    await c0.click();
    await expect(c0).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#graph-legend-count')).toHaveText(`скрыто 1 из ${GRAPH.legend.length}`);
    await page.locator('#graph-show-all').click();
    await expect(c0).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#graph-hide-all').click();
    await expect(page.locator('#graph-legend [aria-pressed="true"]')).toHaveCount(0);
    await page.locator('#graph-show-all').click();
    await expect(page.locator('#graph-legend [aria-pressed="false"]')).toHaveCount(0);

    await page.locator('#graph-full').click();
    await expect(page.locator('#graph-shell')).toHaveClass(/is-full/);
    await expect(page.locator('#graph-full')).toHaveAttribute('aria-pressed', 'true');
    const full = await page.locator('#graph-shell').boundingBox();
    expect(full.width).toBeGreaterThan(1200);
    expect(full.height).toBeGreaterThan(850);
    await expect.poll(async () => (await page.locator('#graph-canvas canvas').boundingBox()).height).toBeGreaterThan(800);
    await page.keyboard.press('Escape');
    await expect(page.locator('#graph-shell')).not.toHaveClass(/is-full/);
    await expect(page.locator('#graph-full')).toHaveText('Во весь экран');
  });

  test('нет файла графа — ошибка с «Повторить», а не пустой холст', async ({ page, open }) => {
    await open({ signedIn: 'aal2', csp: true });
    await page.route('**/graph/graph.json', (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await page.goto('/#/graph');
    await expect(page.locator('#graph-box .note.is-error')).toContainText('HTTP 404');
    await expect(page.locator('#graph-box .note.is-error button')).toHaveText('Повторить');
  });
});

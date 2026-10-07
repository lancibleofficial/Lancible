// «Проекты» — карточки и таблица недавних задач. Запуск: npm run test:e2e
//
// С 7 октября 2026 проекты живут на своей странице: карточка — цвет,
// название, описание, время и деньги за всё время, прогресс, срок ближайшей
// задачи; ниже таблица недавних задач — плей/стоп, задача с проектом,
// последняя запись, время, деньги. Карточка открывает проект, строка —
// задачу.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((HOUR) => {
    const now = new Date();
    state.settings.hourlyRate = 1000;
    const mk = (id, name, color, pinnedAt = null, desc = '') => {
      state.projects.push({ id, name, color, description: desc, pinnedAt, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65', null, 'Вёрстка лендинга');
    mk('p2', 'Приложение', '#5ec8f2');
    mk('p3', 'Кофейня', '#f5c451', new Date(now.getTime() - HOUR).toISOString());
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (start, end) => ({ start: start.toISOString(), end: end.toISOString(), ms: end - start });
    const add = (id, pid, title, sessions, extra = {}) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('t1', 'p1', 'Вёрстка', [ses(at(9), at(10))], { dueAt: at(18).toISOString() });
    add('t2', 'p2', 'Экран входа', [ses(at(14), at(14, 45))]);
    add('t3', 'p3', 'Логотип', [ses(at(11), at(12))], { done: true });
    add('t4', 'p1', 'Форма', []);
    openView('projects');
  }, HOUR);
}

test('карточки: закреплённые первыми, у каждой время, деньги, прогресс и срок', async ({ page }) => {
  await seed(page);
  const cards = page.locator('.ptile');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.ptile-name')).toHaveText(['Кофейня', 'Сайт', 'Приложение']);
  const site = cards.filter({ hasText: 'Сайт' });
  await expect(site.locator('.ptile-desc')).toHaveText('Вёрстка лендинга');
  await expect(site.locator('.ptile-time')).toHaveText('1ч');
  await expect(site.locator('.ptile-money')).toHaveText(/1\s000\s₽/);
  await expect(site.locator('.ptile-foot')).toContainText('0 из 2 задач');
  await expect(site.locator('.ptile-foot')).toContainText('дедлайн 10 июн.');
  await expect(cards.filter({ hasText: 'Приложение' }).locator('.ptile-foot')).toContainText('без дедлайна');
  // Готово 1 из 1 — полоса прогресса заполнена целиком.
  const w = await page.evaluate(() => {
    const bar = document.querySelector('.ptile .ptile-progress');
    return bar.querySelector('i').getBoundingClientRect().width / bar.getBoundingClientRect().width;
  });
  expect(w).toBeGreaterThan(0.98);
  await site.click();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#ph-name')).toHaveText('Сайт');
});

test('таблица недавних задач: плей в строке запускает таймер, строка открывает задачу', async ({ page }) => {
  await seed(page);
  const rows = page.locator('.recent-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.recent-name')).toHaveText(['Экран входа', 'Вёрстка']);
  await expect(rows.first().locator('.recent-num').first()).toHaveText('45м');
  await rows.first().locator('.rl-play').click();
  expect(await page.evaluate(() => state.activeTimer.taskId)).toBe('t2');
  expect(await page.evaluate(() => state.ui.view), 'плей не уводит со страницы').toBe('projects');
  await expect(rows.first().locator('.recent-when')).toHaveText('идёт сейчас');
  await rows.nth(1).click();
  expect(await page.evaluate(() => [state.ui.view, selectedId])).toEqual(['task', 't1']);
});

test('без проектов — подсказка, кнопка создания на месте', async ({ page }) => {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => openView('projects'));
  await expect(page.locator('#home-empty')).toBeVisible();
  await expect(page.locator('#recent-section')).toBeHidden();
  await page.locator('#create-project-btn').click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
});

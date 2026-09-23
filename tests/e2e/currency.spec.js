// Выбор валюты. Запуск: npm run test:e2e
//
// Валюта была последним местом, где стоял системный <select>: он не умеет ни
// нашей темы, ни наших шрифтов, а на macOS рисуется вовсе по-своему. Здесь
// проверяется, что его нет и что своё меню действительно меняет валюту в
// обоих местах сразу — в подвале боковой панели проекта и в настройках.
const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  return page.evaluate(() => {
    const now = new Date();
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт клиента', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: now.toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';
    const cols = orderedStatuses(pid);
    const start = new Date(now.getTime() - (2 * 3_600_000));
    state.tasks.push({
      id: uid(), projectId: pid, title: 'Главная страница', done: false, notes: null,
      totalMs: 2 * 3_600_000,
      sessions: [{ start: start.toISOString(), end: now.toISOString(), ms: 2 * 3_600_000 }],
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    return { pid };
  });
}

test('на странице не осталось ни одного видимого системного select', async ({ page }) => {
  // Три <select> на странице всё же есть — скрытые внутренности панели Quill,
  // которую он сам подменяет своими .ql-picker. Проверяем именно видимые.
  await seed(page);
  const stray = await page.evaluate(() => [...document.querySelectorAll('select')]
    .filter((n) => n.offsetParent !== null)
    .map((n) => n.id || n.className));
  expect(stray, `видимые select: ${stray}`).toEqual([]);

  await page.evaluate(() => { state.ui.view = 'settings'; render(); });
  const inSettings = await page.locator('#settings-view select').count();
  expect(inSettings).toBe(0);
});

test('валюта выбирается своим списком и меняется сразу в обоих местах', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#currency')).toHaveText('RUB ₽');
  await expect(page.locator('#project-earned')).toContainText('4 000 ₽');

  await page.locator('#currency').click();
  const items = page.locator('#ctx-menu .ctx-item');
  await expect(items).toHaveCount(10);
  await expect(items.first()).toHaveText('USD $');
  // Текущая помечена галочкой — как в остальных наших меню.
  await expect(page.locator('#ctx-menu .ctx-item.sel')).toHaveText('RUB ₽');
  // Пока меню открыто, кнопка подсвечена.
  await expect(page.locator('#currency')).toHaveClass(/open/);

  await items.filter({ hasText: 'KZT' }).click();
  await expect(page.locator('#ctx-menu')).toBeHidden();
  await expect(page.locator('#currency')).toHaveText('KZT ₸');
  await expect(page.locator('#project-earned'), 'суммы пересчитаны').toContainText('4 000 ₸');
  expect(await page.evaluate(() => state.settings.currency)).toBe('KZT');

  // Вторая кнопка — та же валюта: она в приложении одна.
  await page.evaluate(() => { state.ui.view = 'settings'; render(); });
  await expect(page.locator('#settings-currency')).toHaveText('KZT ₸');
});

test('валюту можно сменить и со страницы настроек', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { state.ui.view = 'settings'; render(); });

  await page.locator('#settings-currency').click();
  await page.locator('#ctx-menu .ctx-item').filter({ hasText: 'EUR' }).click();

  await expect(page.locator('#settings-currency')).toHaveText('EUR €');
  expect(await page.evaluate(() => state.settings.currency)).toBe('EUR');

  await page.evaluate(() => { openProject(state.projects[0].id); });
  await expect(page.locator('#currency')).toHaveText('EUR €');
  await expect(page.locator('#project-earned')).toContainText('€');
});

test('смена языка не сбрасывает выбранную валюту', async ({ page }) => {
  // Раньше список опций пересобирался на каждую смену языка, и значение
  // приходилось запоминать и возвращать руками. Теперь возвращать нечего —
  // но проверить стоит: валюта живёт в состоянии, а не в разметке.
  await seed(page);
  await page.evaluate(() => { state.settings.currency = 'PLN'; setLang('en'); });
  await expect(page.locator('#currency')).toHaveText('PLN zł');
  await expect(page.locator('#currency')).toHaveAttribute('title', 'Currency');
  expect(await page.evaluate(() => state.settings.currency)).toBe('PLN');
});

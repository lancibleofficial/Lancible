// Полноэкранный редактор: выход и место под кнопки окна. Запуск: npm run test:e2e
//
// Откуда взялось. 10 октября 2026 на десктопе: редактор развёрнут на весь
// экран, его панель инструментов уезжает под нативные кнопки окна, и кнопка
// «Выйти из полного экрана», стоящая у правого края панели, оказывается под
// «свернуть/закрыть» — выйти нельзя. На Windows кнопки окна рисует система
// поверх страницы, на маке «светофор» стоит слева.
//
// Что здесь, а что в смоуке. Браузер не знает ни env(titlebar-area-*), ни
// нативных кнопок, поэтому правый отступ под кнопки Windows меряет только
// scripts/smoke.js — в настоящем окне Electron. Здесь — то, что видно и в
// браузере: Esc и отступ слева под «светофор» мака (по классу платформы).
const { test, expect } = require('@playwright/test');

async function openTask(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(pid);
    const id = uid();
    state.tasks.push({
      id, projectId: pid, title: 'Заметки', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
  });
}

const led = (page) => page.locator('#editor-wrap .led');
const exitBtn = (page) => page.locator('#editor-wrap .led-toolbar-end button');

async function enterFullscreen(page) {
  await exitBtn(page).click();
  await expect(led(page)).toHaveClass(/led-fullscreen/);
}

test('Esc выходит из полного экрана', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc выходит из полного экрана и после щелчка по полю страницы — щелчок ставит курсор в конец текста', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  // Пустое место справа от текста: с 13 октября 2026 щелчок туда не роняет
  // фокус на body, а возвращает его в текст и ставит курсор в конец
  // (onBlankDown). Esc ловится на документе и выходит из полного экрана
  // независимо от того, где фокус.
  const box = await page.locator('#editor-wrap .led-scroll').boundingBox();
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  expect(await page.evaluate(() => !!document.activeElement && document.activeElement.closest('.ProseMirror') !== null), 'фокус в тексте').toBe(true);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc сначала закрывает меню редактора, и только второй — полный экран', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  await page.locator('#editor-wrap .led-toolbar button[title="Таблица"]').click();
  await expect(page.locator('.led-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.led-pop'), 'меню закрылось').toHaveCount(0);
  await expect(led(page), 'а полный экран остался').toHaveClass(/led-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc в окне редактора закрывает окно, а не полный экран', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  // Ctrl+/ — окно с горячими клавишами, то самое #ledmodal-backdrop.
  await page.keyboard.press('Control+/');
  await expect(page.locator('#ledmodal-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ledmodal-backdrop'), 'окно закрылось').toHaveCount(0);
  await expect(led(page), 'полный экран остался').toHaveClass(/led-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc в поиске по документу закрывает поиск, а не полный экран', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  await page.keyboard.press('Control+f');
  const find = page.locator('#editor-wrap .led-find-in').first();
  await expect(find).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(find, 'поиск закрылся').toBeHidden();
  await expect(led(page), 'полный экран остался').toHaveClass(/led-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc в меню «/» закрывает меню, а не полный экран', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  await page.locator('#editor-wrap .led-pm').click();
  await page.keyboard.type('/');
  const slash = page.locator('.led-slash');
  await expect(slash).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(slash, 'меню закрылось').toBeHidden();
  await expect(led(page), 'а полный экран остался').toHaveClass(/led-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('Esc во время набора через IME не выходит из полного экрана', async ({ page }) => {
  // В японском, китайском и корейском наборе Esc сбрасывает подсказку набора
  // (isComposing) и не должен выкидывать человека из полного экрана. Playwright
  // не умеет IME, поэтому событие собрано руками — тем же слушателем оно и
  // принимается. Контроль в конце: то же событие без isComposing выходит, значит
  // тест не пустой.
  await openTask(page);
  await enterFullscreen(page);
  const esc = (isComposing) => page.evaluate((composing) => {
    const target = document.querySelector('#editor-wrap .led-pm');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: composing, bubbles: true, cancelable: true }));
  }, isComposing);
  await esc(true);
  await expect(led(page), 'набор не закончен — полный экран остался').toHaveClass(/led-fullscreen/);
  await esc(false);
  await expect(led(page), 'тот же Esc без набора — выходит').not.toHaveClass(/led-fullscreen/);
});

test('Esc вне полного экрана ничего не делает с редактором', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-pm').click();
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
  await expect(page.locator('#editor-wrap .led-pm')).toBeVisible();
});

test('кнопка выхода видна и нажимается в полном экране; у правого края панели', async ({ page }) => {
  await openTask(page);
  await enterFullscreen(page);
  const btn = exitBtn(page);
  await expect(btn).toBeVisible();
  const hit = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { onTop: el === top || el.contains(top), right: r.right, vw: document.documentElement.clientWidth };
  });
  expect(hit.onTop, 'в центре кнопки лежит она сама, а не что-то поверх').toBe(true);
  expect(hit.vw - hit.right, 'у правого края окна (в браузере кнопок окна нет)').toBeLessThan(14);
  await btn.click();
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
});

test('на маке панель полного экрана начинается правее «светофора»', async ({ page }) => {
  await openTask(page);
  await page.evaluate(() => document.body.classList.add('platform-mac'));
  await enterFullscreen(page);
  const g = await page.evaluate(() => {
    const tb = document.querySelector('#editor-wrap .led-toolbar');
    const first = tb.querySelector('button');
    const traffic = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--traffic-w'));
    return { traffic, firstLeft: first.getBoundingClientRect().left, toolbarLeft: tb.getBoundingClientRect().left, height: tb.getBoundingClientRect().height };
  });
  expect(g.traffic, 'ширина зоны под «светофор» — токен').toBeGreaterThan(60);
  expect(g.firstLeft - g.toolbarLeft, 'первая кнопка правее зоны «светофора»').toBeGreaterThanOrEqual(g.traffic);
  expect(g.height, 'панель не ниже полосы кнопок окна (52 px)').toBeGreaterThanOrEqual(52);
});

test('вход в полный экран и выход из него сообщают хозяину редактора', async ({ page }) => {
  await openTask(page);
  await page.evaluate(() => {
    window.__overlay = [];
    window.api.setTitlebarOverlay = (theme, colors) => { window.__overlay.push({ theme, ...colors }); return Promise.resolve(true); };
  });
  await enterFullscreen(page);
  await page.keyboard.press('Escape');
  await expect(led(page)).not.toHaveClass(/led-fullscreen/);
  const calls = await page.evaluate(() => window.__overlay);
  expect(calls.length, 'два вызова: вход и выход').toBe(2);
  for (const c of calls) {
    expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.symbolColor).toMatch(/^#[0-9a-f]{6}$/);
  }
});

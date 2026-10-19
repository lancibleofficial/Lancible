// Пункты меню без подложки. Запуск: npm run test:e2e
//
// До 10 октября 2026 пункт при наведении получал серую подложку
// (--panel-2), а «Удалить проект» — такую же под красным текстом. Решение
// пользователя: подложки нет ни у кого. Наведение и стрелки в меню редактора
// видны только цветом: в покое текст приглушён, у наведённого — ярче. У
// красных — из приглушённого красного (токен --danger-dim) в полный --danger.
// Клавиатурному фокусу цвета мало — соседние пункты различаются оттенком, — и
// у него есть ещё контур токеном --accent-ink, тоже без заливки. Выбранный
// пункт (.sel) остаётся акцентным, как был.
//
// Меряется вычисленный стиль в живом браузере, в обеих темах, на настоящих
// меню приложения: проекта, статуса задачи, часов (compact) и «/» редактора.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Контраст по WCAG двух цветов. Браузер отдаёт либо "rgb(r, g, b)", либо —
 *  для color-mix — "color(srgb r g b)" с долями от 0 до 1. */
const ratio = (fg, bg) => {
  const lum = (c) => {
    const scale = c.startsWith('color(') ? 255 : 1;
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
      const x = (Number(v) * scale) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

async function seed(page, theme) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((th) => {
    const now = new Date();
    state.settings.theme = th;
    applyTheme();
    const p = { id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    const due = new Date(now); due.setHours(18, 0, 0, 0);
    state.tasks.push({
      id: 't1', projectId: p.id, title: 'Вёрстка', done: false, notes: null, totalMs: 0, sessions: [],
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(p.id)[1].id, tagIds: [], versionId: null, repeat: null,
      dueAt: due.toISOString(), remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = p.id;
    state.ui.view = 'project';
    render();
    selectTask('t1');
  }, theme);
}

/** Токен темы → вычисленный цвет, через пробный элемент: ровно то, что видит человек. */
const token = (page, name) => page.evaluate((n) => {
  const probe = document.createElement('div');
  probe.style.color = `var(${n})`;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, name);

const look = (item) => item.evaluate((n) => {
  const s = getComputedStyle(n);
  return {
    bg: s.backgroundColor, color: s.color, image: s.backgroundImage,
    outline: { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor },
  };
});

/** Дождаться конца 0.1-секундного перехода цвета. */
const settle = (page) => page.waitForTimeout(250);

/**
 * Обходит пункты меню: в покое и под указателем. Подложки нет ни там, ни там;
 * у обычного цвет «приглушённый → --text», у опасного — «смесь → --danger»,
 * у выбранного остаётся акцентным.
 */
async function checkItems(page, items) {
  const text = await token(page, '--text');
  const dim = await token(page, '--text-dim');
  const danger = await token(page, '--danger');
  const dangerDim = await token(page, '--danger-dim');
  const accent = await token(page, '--accent-ink');
  const panel = await token(page, '--panel');
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  const seen = { plain: 0, danger: 0, sel: 0 };
  for (let i = 0; i < n; i += 1) {
    const item = items.nth(i);
    const cls = (await item.getAttribute('class')) || '';
    await page.mouse.move(2, 2);
    await settle(page);
    const rest = await look(item);
    await item.hover();
    await settle(page);
    const over = await look(item);
    const name = (await item.innerText()).trim();

    expect(rest.bg, `«${name}» в покое: подложки нет`).toBe(TRANSPARENT);
    expect(over.bg, `«${name}» под указателем: подложки нет`).toBe(TRANSPARENT);
    expect(over.image, `«${name}»: и градиента вместо подложки нет`).toBe('none');
    expect(over.outline.style, `«${name}» под указателем: контура нет — он только у клавиатурного фокуса`).toBe('none');
    if (/\bsel\b/.test(cls)) {
      seen.sel += 1;
      expect(rest.color, `«${name}» выбранный: акцент`).toBe(accent);
      expect(over.color, `«${name}» выбранный: акцент и под указателем`).toBe(accent);
    } else if (/\bdanger\b/.test(cls)) {
      seen.danger += 1;
      expect(over.color, `«${name}» опасный под указателем: полный --danger`).toBe(danger);
      expect(rest.color, `«${name}» опасный в покое: приглушён`).not.toBe(danger);
      expect(rest.color, `«${name}» опасный в покое: токен --danger-dim, а не смесь на месте`).toBe(dangerDim);
      expect(rest.color, `«${name}» опасный в покое: всё ещё красноватый`).not.toBe(dim);
      expect(ratio(rest.color, panel), `«${name}» опасный в покое читается (AA, 4.5)`).toBeGreaterThanOrEqual(4.5);
    } else {
      seen.plain += 1;
      expect(rest.color, `«${name}» в покое: --text-dim`).toBe(dim);
      expect(over.color, `«${name}» под указателем: --text`).toBe(text);
      expect(over.color, `«${name}» под указателем ярче, чем в покое`).not.toBe(rest.color);
    }
  }
  await page.mouse.move(2, 2);
  return seen;
}

for (const theme of ['dark', 'light']) {
  test.describe(`тема ${theme}`, () => {
    test('меню проекта: обычные пункты и «Удалить проект» — без подложки, цветом', async ({ page }) => {
      await seed(page, theme);
      await page.evaluate(() => openProjectMenu(state.projects[0], document.getElementById('titlebar')));
      const items = page.locator('#ctx-menu .ctx-item');
      await expect(items.first()).toBeVisible();
      const seen = await checkItems(page, items);
      expect(seen.plain, 'обычные пункты есть').toBeGreaterThan(2);
      expect(seen.danger, '«Удалить проект» есть и красный').toBe(1);
      await expect(items.last()).toHaveClass(/danger/);
    });

    // Статус задачи с 13 октября 2026 — чипами в панели, а не меню, и списка
    // часов у дедлайна больше нет (общий выбор времени, time-picker.spec.js):
    // выбранный пункт проверяется на списке валют.
    test('список с выбором (валюта): выбранный пункт остаётся акцентным, остальные — без подложки', async ({ page }) => {
      await seed(page, theme);
      await page.evaluate(() => openCurrencyMenu(document.getElementById('titlebar')));
      const items = page.locator('#ctx-menu .ctx-item');
      await expect(items.first()).toBeVisible();
      const seen = await checkItems(page, items);
      expect(seen.sel, 'выбранная валюта одна').toBe(1);
      expect(seen.plain).toBeGreaterThan(1);
      // Галочка выбранного — акцентная, как была.
      await expect(page.locator('#ctx-menu .ctx-item.sel .ctx-check')).toHaveCSS('color', await token(page, '--accent-ink'));
    });

    test('меню «/» в редакторе: курсор стрелками виден цветом, без подложки', async ({ page }) => {
      await seed(page, theme);
      await page.locator('#editor-wrap .led-pm').click();
      await page.keyboard.type('/');
      const slash = page.locator('.led-slash');
      await expect(slash).toBeVisible();
      const items = slash.locator('.ctx-item');
      expect(await items.count()).toBeGreaterThan(3);
      const text = await token(page, '--text');
      const dim = await token(page, '--text-dim');
      await page.mouse.move(2, 2);
      // Курсор стоит на первом пункте; остальные — в покое.
      const cur = items.first();
      await expect(cur).toHaveClass(/led-cur/);
      await settle(page);
      const a = await look(cur);
      const b = await look(items.nth(1));
      expect(a.bg, 'под курсором подложки нет').toBe(TRANSPARENT);
      expect(b.bg).toBe(TRANSPARENT);
      expect(a.color, 'курсор — цвет --text').toBe(text);
      expect(b.color, 'остальные — приглушены').toBe(dim);
      // Стрелка вниз переносит курсор: подсвечивается следующий, прежний гаснет.
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toHaveClass(/led-cur/);
      await settle(page);
      expect((await look(items.nth(1))).color).toBe(text);
      expect((await look(items.first())).color).toBe(dim);
      expect((await look(items.nth(1))).bg).toBe(TRANSPARENT);
    });

    test('клавиатурный фокус на пункте виден цветом и контуром, подложки не даёт', async ({ page }) => {
      await seed(page, theme);
      await page.evaluate(() => openProjectMenu(state.projects[0], document.getElementById('titlebar')));
      const items = page.locator('#ctx-menu .ctx-item');
      await expect(items.first()).toBeVisible();
      const text = await token(page, '--text');
      const danger = await token(page, '--danger');
      const ring = await token(page, '--accent-ink');
      await page.mouse.move(2, 2);
      // Табуляция включает «клавиатурный» режим — после неё focus() даёт :focus-visible.
      await page.keyboard.press('Tab');
      for (const [item, want] of [[items.first(), text], [items.last(), danger]]) {
        const rest = await look(item);
        expect(rest.outline.style, 'пока фокуса нет, контура нет').toBe('none');
        await item.focus();
        await settle(page);
        expect(await item.evaluate((n) => n.matches(':focus-visible')), 'это клавиатурный фокус').toBe(true);
        const s = await look(item);
        expect(s.bg, 'фокус без подложки').toBe(TRANSPARENT);
        expect(s.color, 'фокус — цветом').toBe(want);
        expect(s.outline, 'и заметным контуром токена, не системным кольцом').toEqual({ style: 'solid', width: '2px', color: ring });
        // Контур не должен резаться краем меню: он нарисован внутрь пункта.
        const fits = await item.evaluate((n) => {
          const r = n.getBoundingClientRect();
          const m = n.closest('#ctx-menu').getBoundingClientRect();
          return r.left >= m.left && r.right <= m.right;
        });
        expect(fits, 'пункт с контуром целиком внутри меню').toBe(true);
        await item.evaluate((n) => n.blur());
      }
    });
  });
}

test('в таблицах стилей у .ctx-item нет ни одной подложки — ни в одном состоянии', async ({ page }) => {
  await seed(page, 'dark');
  const offenders = await page.evaluate(() => {
    const found = [];
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) walk(rule.cssRules);
        if (!rule.selectorText || !/\.ctx-item/.test(rule.selectorText)) continue;
        const bg = rule.style.getPropertyValue('background') || rule.style.getPropertyValue('background-color');
        // «none» / «transparent» — это и есть отсутствие подложки.
        if (bg && !/^(none|transparent)$/.test(bg.trim())) found.push(`${rule.selectorText} { background: ${bg} }`);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* чужой источник */ }
    }
    return found;
  });
  expect(offenders).toEqual([]);
});

// Выпадашка закрывается повторным щелчком по своей кнопке. Раньше нажатие на
// кнопку закрывало меню как «щелчок снаружи», а сам щелчок тут же открывал его
// заново — со стороны казалось, что меню не закрыть.
test('язык: повторный щелчок по кнопке закрывает список; Esc и щелчок снаружи — как раньше', async ({ page }) => {
  await seed(page, 'dark');
  const menu = page.locator('#ctx-menu');
  const toggle = page.locator('#lang-toggle');
  // Слушатели меню вешаются на следующем такте (setTimeout 0): человек не
  // успевает щёлкнуть быстрее, а тест — успевает, и без паузы был бы
  // подвержен гонке.
  const open = async (target = toggle) => {
    await target.click();
    await expect(menu).toBeVisible();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
  };

  await open();
  await expect(menu.locator('.ctx-item')).not.toHaveCount(0);
  await expect(toggle).toHaveClass(/open/);

  await toggle.click();
  await expect(menu, 'повторный щелчок закрывает').toBeHidden();
  await expect(toggle).not.toHaveClass(/open/);
  // Кнопка не залипла: следующий щелчок открывает снова, ещё один — закрывает.
  await open();
  await toggle.click();
  await expect(menu).toBeHidden();

  // Щелчок по значку внутри кнопки — тоже по кнопке.
  await open();
  await toggle.locator('svg').first().click();
  await expect(menu).toBeHidden();

  await open();
  await page.keyboard.press('Escape');
  await expect(menu, 'Esc закрывает').toBeHidden();

  await open();
  await page.mouse.click(700, 400);
  await expect(menu, 'щелчок снаружи закрывает').toBeHidden();

  // Выбор языка работает, как работал: меню закрывается, язык сменился.
  await open();
  await menu.locator('.ctx-item', { hasText: 'English' }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => state.settings.lang)).toBe('en');
});

test('строка языка в настройках закрывает список так же', async ({ page }) => {
  await seed(page, 'dark');
  await page.evaluate(() => openSettings('main')); // язык — в разделе «Основное»
  const row = page.locator('#settings-lang-row');
  const menu = page.locator('#ctx-menu');
  await row.click();
  await expect(menu).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
  await row.click();
  await expect(menu).toBeHidden();
});

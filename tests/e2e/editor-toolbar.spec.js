// Панель редактора — одна строка с приоритетной раскладкой. Запуск: npm run test:e2e
//
// Откуда взялось. До 11 октября 2026 панель была в два-три ряда: в узком
// редакторе (страница задачи — колонка рядом со списком) кнопки
// переносились, и панель съедала поле текста; на телефоне она уезжала вбок
// прокруткой. Решение пользователя: одна строка; частое видно всегда, редкое —
// в группах «Формат» и «Вставить», инструменты документа — в «…»; если ширина
// позволяет — показывать по максимуму. Раскладка — src/editor/toolbar.js.
//
// Что проверяется:
//   - строка одна (высота строки — одна кнопка, все кнопки на одной высоте) и
//     не прокручивается на 1280, 900, 600, 375 и в полном экране;
//   - на широком окне кнопок больше, чем на узком, а раскладка следует за
//     шириной в обе стороны без перезагрузки;
//   - каждая команда достижима на любой ширине — кнопкой или пунктом меню;
//   - группа открывается и закрывается мышью и клавиатурой;
//   - включённое оформление видно и у кнопки в строке, и у кнопки группы, и у
//     пункта в её меню.
const { test, expect } = require('@playwright/test');
const { COMMANDS, reachable, tool } = require('./led-toolbar');

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
  await expect(page.locator('#editor-wrap .led-toolbar')).toBeVisible();
  await settle(page);
}

const pm = (page) => page.locator('#editor-wrap .led-pm');
const group = (page, name) => page.locator(`#editor-wrap .led-toolbar [data-group="${name}"]:visible`);
const pop = (page) => page.locator('.led-pop');

/** Геометрия строки: видимые кнопки, их высоты и верх, прокрутка строки. */
const rowGeo = (page) => page.evaluate(() => {
  const tb = document.querySelector('#editor-wrap .led-toolbar');
  const main = tb.querySelector('.led-toolbar-main');
  const btns = [...tb.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
  const rects = btns.map((b) => b.getBoundingClientRect());
  const t = tb.getBoundingClientRect();
  return {
    count: btns.length,
    cmds: btns.map((b) => b.dataset.cmd || b.dataset.group),
    mainH: main.getBoundingClientRect().height,
    btnH: Math.max(...rects.map((r) => r.height)),
    tops: [...new Set(rects.map((r) => Math.round(r.top)))],
    overflow: main.scrollWidth - main.clientWidth,
    outside: btns.filter((b, i) => rects[i].left < t.left - 0.5 || rects[i].right > t.right + 0.5).map((b) => b.dataset.cmd || b.dataset.group),
  };
});

function expectOneRow(g, where) {
  expect(g.tops, `${where}: все кнопки на одной высоте — ${g.cmds.join(' ')}`).toHaveLength(1);
  expect(g.mainH, `${where}: строка высотой в одну кнопку`).toBeLessThanOrEqual(g.btnH + 0.5);
  expect(g.overflow, `${where}: строка не прокручивается`).toBeLessThanOrEqual(0);
  expect(g.outside, `${where}: ни одна кнопка не вылезла за панель`).toEqual([]);
}

/** Раскладка пересчитывается наблюдателем за шириной — кадром позже, а
 *  колонка редактора после смены окна доезжает анимацией. Ждём, пока ширина
 *  строки не простоит шесть кадров подряд. */
const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  const main = document.querySelector('#editor-wrap .led-toolbar-main');
  const t0 = performance.now();
  let last = -1;
  let same = 0;
  const tick = () => {
    const w = main.getBoundingClientRect().width;
    same = w === last ? same + 1 : 0;
    last = w;
    if (same >= 6 || performance.now() - t0 > 3000) resolve();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

for (const width of [1280, 900, 600, 375]) {
  test(`панель — одна строка на ${width} px, частое на виду`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openTask(page);
    await settle(page);
    const g = await rowGeo(page);
    expectOneRow(g, `${width} px`);
    // Частое видно всегда: на 375 у редактора 254 px строки, и туда входит
    // ровно это — отмена и повтор, стиль, Ж, К, ссылка, списки, «…».
    for (const cmd of ['undo', 'redo', 'block', 'bold', 'italic', 'link', 'more', 'fullscreen']) {
      expect(g.cmds, `${width} px: «${cmd}» в строке`).toContain(cmd);
    }
    expect(g.cmds.includes('bullet') || g.cmds.includes('lists'), `${width} px: списки в строке`).toBe(true);
    expect(g.cmds[g.cmds.length - 1], '«Во весь экран» — крайняя справа').toBe('fullscreen');
  });
}

test('в полном экране — одна строка, и кнопок в ней больше, чем в колонке', async ({ page }) => {
  await openTask(page);
  await settle(page);
  const before = await rowGeo(page);
  await page.locator('#editor-wrap .led-toolbar-end button').click();
  await expect(page.locator('#editor-wrap .led')).toHaveClass(/led-fullscreen/);
  await settle(page);
  const g = await rowGeo(page);
  expectOneRow(g, 'полный экран');
  expect(g.count, 'полный экран шире колонки — кнопок больше').toBeGreaterThan(before.count);
  // На всю ширину 1280 обе группы — с подписями, а вставки и оформление — кнопками.
  for (const cmd of ['strike', 'color', 'highlight', 'align', 'table', 'image', 'chart', 'drawing']) expect(g.cmds).toContain(cmd);
  await expect(group(page, 'format').locator('.led-drop-label')).toHaveText('Формат');
  await expect(group(page, 'insert').locator('.led-drop-label')).toHaveText('Вставить');
});

test('полный экран раскладывает строку сразу, не дожидаясь кадра', async ({ page }) => {
  // Наблюдатель за шириной зовётся с кадром отрисовки, а в скрытом окне
  // (смоук Electron) кадров нет: 11 октября там панель так и осталась в виде
  // до раскладки — все 36 кнопок, обрезанные краем. Поэтому вход в полный
  // экран пересчитывает строку сам, в том же вызове.
  await openTask(page);
  const g = await page.evaluate(() => {
    editor.toggleFullscreen(true);
    const main = document.querySelector('#editor-wrap .led-toolbar-main');
    const tb = main.getBoundingClientRect();
    const btns = [...main.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    return { overflow: main.scrollWidth - main.clientWidth, outside: btns.filter((b) => b.getBoundingClientRect().right > tb.right + 0.5).length, strike: btns.some((b) => b.dataset.cmd === 'strike') };
  });
  expect(g.overflow, 'строка не вылезла').toBeLessThanOrEqual(0);
  expect(g.outside, 'ни одна кнопка не за краем').toBe(0);
  expect(g.strike, 'и уже разложена под полную ширину').toBe(true);
});

test('раскладка идёт за шириной: на 1280 кнопок больше, чем на 600, и обратно — как было', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTask(page);
  await settle(page);
  const wide = await rowGeo(page);
  await page.evaluate(() => { window.__ledMetrics = editor.toolbar.metrics; });
  await page.setViewportSize({ width: 600, height: 800 });
  await settle(page);
  const narrow = await rowGeo(page);
  expectOneRow(narrow, '600 px после сужения');
  expect(wide.count, 'на 1280 видно больше кнопок, чем на 600').toBeGreaterThan(narrow.count);
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
  expect((await rowGeo(page)).cmds, 'вернули ширину — вернулись и кнопки').toEqual(wide.cmds);
  // Без дёрганья раскладки: ширины кнопок меряются один раз, а на каждое
  // изменение ширины раскладка только считается по ним.
  expect(await page.evaluate(() => editor.toolbar.metrics === window.__ledMetrics), 'замер не повторялся').toBe(true);
});

for (const width of [1280, 375]) {
  test(`каждая команда достижима на ${width} px: кнопкой или пунктом меню`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openTask(page);
    await settle(page);
    const found = await reachable(page);
    expect(COMMANDS.filter((c) => !found.has(c)), 'недостижимые команды').toEqual([]);
    expect(found.has('fullscreen')).toBe(true);
  });
}

test('каждая команда достижима и в полном экране', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar-end button').click();
  await settle(page);
  const found = await reachable(page);
  expect(COMMANDS.filter((c) => !found.has(c)), 'недостижимые команды').toEqual([]);
  await expect(page.locator('#editor-wrap .led'), 'Esc закрывал меню, а не полный экран').toHaveClass(/led-fullscreen/);
});

test('команда из меню группы работает так же, как кнопка: подчёркнутый на 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('слово');
  await page.keyboard.press('Control+a');
  expect((await rowGeo(page)).cmds, 'на 375 подчёркнутого в строке нет').not.toContain('underline');
  await tool(page, 'underline');
  await expect(pm(page).locator('u')).toHaveText('слово');
  // Фокус и выделение остались в тексте: следующее оформление — сразу.
  await page.keyboard.press('Control+b');
  await expect(pm(page).locator('strong')).toHaveText('слово');
});

test('группа открывается и закрывается мышью', async ({ page }) => {
  await openTask(page);
  const fmt = group(page, 'format');
  await fmt.click();
  await expect(pop(page)).toBeVisible();
  await expect(fmt).toHaveAttribute('aria-expanded', 'true');
  // Меню группы — тот же вид, что остальные выпадашки редактора.
  await expect(pop(page)).toHaveClass(/ctx-menu/);
  await expect(pop(page).locator('.ctx-item').first()).toBeVisible();
  await fmt.click();
  await expect(pop(page), 'второй щелчок закрывает').toHaveCount(0);
  await expect(fmt).toHaveAttribute('aria-expanded', 'false');

  const ins = group(page, 'insert');
  await ins.click();
  await expect(pop(page)).toBeVisible();
  await pm(page).click();
  await expect(pop(page), 'щелчок мимо закрывает').toHaveCount(0);
  await expect(ins).toHaveAttribute('aria-expanded', 'false');
});

test('клавиатура: стрелки по строке, Enter и пробел открывают группу, Esc закрывает и возвращает фокус', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('слово');
  await page.keyboard.press('Control+a');
  const active = () => page.evaluate(() => {
    const a = document.activeElement;
    return { cmd: a.dataset.cmd || a.dataset.group || null, inPop: !!a.closest('.led-pop'), text: a.textContent };
  });
  await page.locator('#editor-wrap .led-toolbar [data-cmd="block"]:visible').focus();
  await page.keyboard.press('ArrowRight');
  expect((await active()).cmd, 'стрелка вправо — следующая кнопка').toBe('bold');
  await page.keyboard.press('ArrowLeft');
  expect((await active()).cmd).toBe('block');
  await page.keyboard.press('End');
  expect((await active()).cmd, 'End — крайняя справа').toBe('fullscreen');
  await page.keyboard.press('Home');
  expect((await active()).cmd, 'Home — первая кнопка (набранное можно отменить)').toBe('undo');

  for (let i = 0; i < 30 && (await active()).cmd !== 'format'; i++) await page.keyboard.press('ArrowRight');
  expect((await active()).cmd).toBe('format');
  await page.keyboard.press('Enter');
  await expect(pop(page)).toBeVisible();
  const first = await active();
  expect(first.inPop, 'Enter открыл меню, фокус — на первом пункте').toBe(true);
  await page.keyboard.press('ArrowDown');
  const second = await active();
  expect(second.inPop && second.cmd !== first.cmd, 'стрелка вниз — следующий пункт').toBe(true);
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  expect((await active()).cmd, 'Esc вернул фокус на кнопку группы').toBe('format');

  await page.keyboard.press(' ');
  await expect(pop(page), 'пробел тоже открывает').toBeVisible();
  // Пункт меню — Enter: зачёркнутый из меню «Формат» ложится на выделение.
  for (let i = 0; i < 20 && (await active()).cmd !== 'strike'; i++) await page.keyboard.press('ArrowDown');
  expect((await active()).cmd).toBe('strike');
  await page.keyboard.press('Enter');
  await expect(pop(page)).toHaveCount(0);
  await expect(pm(page).locator('s')).toHaveText('слово');

  // Tab ходит по кнопкам строки сам.
  await page.locator('#editor-wrap .led-toolbar [data-cmd="bold"]:visible').focus();
  await page.keyboard.press('Tab');
  expect((await active()).cmd, 'Tab — следующая кнопка').toBe('italic');
});

test('включённое оформление видно у кнопки, у группы и у пункта её меню', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('слово');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await expect(page.locator('#editor-wrap .led-toolbar [data-cmd="bold"]:visible')).toHaveClass(/\bon\b/);
  // Зачёркнутого в строке на 1280 нет — он в «Формате»: подсвечена группа.
  expect((await rowGeo(page)).cmds).not.toContain('strike');
  await expect(group(page, 'format')).not.toHaveClass(/\bon\b/);
  await page.keyboard.press('Control+Shift+x');
  await expect(group(page, 'format'), 'группа подсвечена: внутри включено').toHaveClass(/\bon\b/);
  await group(page, 'format').click();
  const strike = pop(page).locator('[data-cmd="strike"]');
  await expect(strike).toHaveAttribute('aria-checked', 'true');
  await expect(strike).toHaveClass(/\bsel\b/);
  await expect(pop(page).locator('[data-cmd="code"]'), 'невключённое — не отмечено').toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // Узко: «Формат» свёрнут в «…» — подсвечены «…» и пункт группы в нём.
  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page);
  await expect(group(page, 'format')).toHaveCount(0);
  await expect(group(page, 'more'), '«…» подсвечена: внутри включено').toHaveClass(/\bon\b/);
  await group(page, 'more').click();
  await expect(pop(page).locator('[data-group="format"]')).toHaveClass(/\bsel\b/);
  await pop(page).locator('[data-group="format"]').click();
  await expect(pop(page).locator('[data-cmd="strike"]')).toHaveAttribute('aria-checked', 'true');
});

test.describe('телефон', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('одна строка без прокрутки, каждая команда достижима', async ({ page }) => {
    await openTask(page);
    expect(await page.evaluate(() => editor.isMobile)).toBe(true);
    await settle(page);
    const g = await rowGeo(page);
    expectOneRow(g, 'телефон 360');
    for (const cmd of ['undo', 'block', 'bold', 'italic', 'more', 'fullscreen']) expect(g.cmds).toContain(cmd);
    const found = await reachable(page);
    expect(COMMANDS.filter((c) => !found.has(c)), 'недостижимые команды').toEqual([]);
  });
});

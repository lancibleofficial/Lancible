// Ручки строки и столбца таблицы — как в Jira и YouTrack (волна 2, 17
// октября 2026; src/editor/tablehandles.js). Запуск: npm run test:e2e
//
// Откуда взялось. До 17 октября строки и столбцы правились шестерёнкой на
// разделителях: она появлялась у линии под указателем и ходила за мышью, а
// на телефоне её не было вовсе. Теперь ручки стоят по курсору: строки —
// слева снаружи таблицы на высоте его строки, столбца — над таблицей над его
// столбцом; мышь их не двигает. Нажатие выделяет строку или столбец и
// открывает меню. Здесь — что ручки встают куда обещано, переезжают за
// курсором и только за ним, меню делает то, что написано, и на экране
// телефона ручка строки не уходит за левый край.
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
      id, projectId: pid, title: 'Таблица', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
  });
}

const ED = '#editor-wrap';

/** Таблица 4×4 со строкой заголовков; в каждой ячейке — «r<строка>c<столбец>». */
async function fillTable(page, root) {
  await page.locator(`${root} .led-pm`).click();
  await page.evaluate((r) => {
    // editor — переменная app.js (let), а не свойство window.
    // eslint-disable-next-line no-undef
    const ed = r === '#editor-wrap' ? editor : window.__ped;
    ed.exec('table', { rows: 4, cols: 4, header: true });
  }, root);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      await page.keyboard.type(`r${r}c${c}`);
      if (r < 3 || c < 3) await page.keyboard.press('Tab');
    }
  }
}

const cell = (page, root, r, c) => page.locator(`${root} .led-pm table tr`).nth(r).locator('td, th').nth(c);

/** Где ручки и таблица: прямоугольники на экране и текст таблицы по строкам. */
const geometry = (page, root, r, c) => page.evaluate(({ root: sel, r: row, c: col }) => {
  const rect = (el) => { if (!el || el.hidden) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const q = (s) => document.querySelector(`${sel} ${s}`);
  const table = q('.led-pm table');
  return {
    row: rect(q('.led-thandle-row')),
    col: rect(q('.led-thandle-col')),
    table: rect(table),
    tr: rect(table.rows[row]),
    cell: rect(table.rows[row] && table.rows[row].cells[col]),
  };
}, { root, r, c });

const tableText = (page, root) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .led-pm table tr`)].map((tr) => [...tr.children].map((td) => td.textContent)), root);

/** Ручки стоят у строки r и столбца c. Курсор после щелчка ProseMirror
 *  читает из selectionchange — событием позже, поэтому с повтором. */
async function expectAt(page, root, r, c) {
  let g = null;
  await expect(async () => { g = await geometry(page, root, r, c); checkAt(g, r, c); }).toPass({ timeout: 3000 });
  return g;
}

function checkAt(g, r, c) {
  expect(g.row, 'ручка строки видна').not.toBeNull();
  expect(g.col, 'ручка столбца видна').not.toBeNull();
  // Строка: слева снаружи таблицы, во всю высоту строки.
  expect(g.row.right, 'ручка строки — снаружи таблицы слева').toBeLessThanOrEqual(g.table.left);
  expect(g.table.left - g.row.right, 'и вплотную к ней').toBeLessThan(8);
  expect(Math.abs(g.row.top - g.tr.top), `ручка строки — у строки ${r}`).toBeLessThan(1.5);
  expect(Math.abs(g.row.height - g.tr.height), 'во всю высоту строки').toBeLessThan(1.5);
  // Столбец: над таблицей, во всю ширину столбца.
  expect(g.col.bottom, 'ручка столбца — над таблицей').toBeLessThanOrEqual(g.table.top);
  expect(g.table.top - g.col.bottom).toBeLessThan(8);
  expect(Math.abs(g.col.left - g.cell.left), `ручка столбца — у столбца ${c}`).toBeLessThan(1.5);
  expect(Math.abs(g.col.width - g.cell.width), 'во всю ширину столбца').toBeLessThan(1.5);
}

test.describe('десктоп и веб', () => {
  test.beforeEach(async ({ page }) => {
    await openTask(page);
    await fillTable(page, ED);
  });

  test('ручки — по курсору: строка слева, столбец сверху; переезжают за курсором', async ({ page }) => {
    await cell(page, ED, 2, 3).click();
    await expectAt(page, ED, 2, 3);
    // Курсор в другую ячейку щелчком — ручки за ним.
    await cell(page, ED, 1, 0).click();
    await expectAt(page, ED, 1, 0);
    // И с клавиатуры: Tab — в соседний столбец той же строки.
    await page.keyboard.press('Tab');
    await expectAt(page, ED, 1, 1);
    // Курсор вне таблицы — ручек нет.
    await page.evaluate(() => editor.focusEnd());
    await expect(page.locator(`${ED} .led-thandle-row`)).toBeHidden();
    await expect(page.locator(`${ED} .led-thandle-col`)).toBeHidden();
  });

  test('мышь над другой строкой и столбцом — ручки на месте', async ({ page }) => {
    await cell(page, ED, 2, 3).click();
    const before = await expectAt(page, ED, 2, 3);
    for (const [r, c] of [[0, 0], [3, 1], [1, 2]]) {
      const b = await cell(page, ED, r, c).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
      // «Ничего не произошло» проверяется не сразу: шестерёнка до 17 октября
      // догоняла указатель за кадр-другой.
      await page.waitForTimeout(120);
      const g = await geometry(page, ED, 2, 3);
      expect(g.row, `мышь над (${r},${c}): ручка строки не сдвинулась`).toEqual(before.row);
      expect(g.col, `мышь над (${r},${c}): ручка столбца не сдвинулась`).toEqual(before.col);
    }
    // Ручка блока (перетащить таблицу целиком) встаёт над левым верхним углом
    // таблицы, а не у первой строки — там ручка строки (menus.js: BlockHandle).
    // Ручка блока живёт только в широком редакторе (уже 760 — прячется), а
    // колонка задачи у́же: смотрим во весь экран.
    // eslint-disable-next-line no-undef
    await page.evaluate(() => editor.exec('fullscreen', true));
    await cell(page, ED, 0, 0).click();
    const b0 = await cell(page, ED, 0, 0).boundingBox();
    await page.mouse.move(b0.x + 10, b0.y + b0.height / 2);
    await expect(page.locator(`${ED} .led-handle`)).toBeVisible();
    const [blockH, rowH, colH, tbl] = await page.evaluate((sel) => ['.led-handle', '.led-thandle-row', '.led-thandle-col', '.led-pm table']
      .map((s) => document.querySelector(`${sel} ${s}`).getBoundingClientRect().toJSON()), ED);
    const cross = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    expect(cross(blockH, rowH), 'ручка блока не ложится на ручку строки').toBe(false);
    expect(cross(blockH, colH), 'и на ручку столбца').toBe(false);
    expect(blockH.bottom, 'ручка блока — над таблицей').toBeLessThanOrEqual(tbl.top);
  });

  test('нажатие на ручку строки: строка выделена, меню открыто; Esc закрывает', async ({ page }) => {
    await cell(page, ED, 2, 3).click();
    await page.locator(`${ED} .led-thandle-row`).click();
    const menu = page.locator('.led-pop.led-tmenu');
    await expect(menu).toBeVisible();
    await expect(page.locator(`${ED} .led-thandle-row`)).toHaveAttribute('aria-expanded', 'true');
    // Выделена вся строка 2 — и только она.
    const selected = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .led-pm table tr`)].map((tr) => [...tr.children].filter((td) => td.classList.contains('selectedCell')).length), ED);
    expect(selected).toEqual([0, 0, 4, 0]);
    const cmds = await menu.locator('.ctx-item').evaluateAll((els) => els.map((e) => e.dataset.cmd));
    expect(cmds).toEqual(['rowAbove', 'rowBelow', 'rowDup', 'rowUp', 'rowDown', 'rowDel']);
    // Ручки на месте, пока меню открыто.
    await expectAt(page, ED, 2, 3);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator(`${ED} .led-thandle-row`)).toHaveAttribute('aria-expanded', 'false');
    // Курсор вернулся в ячейку: выделения ячеек нет, ручки там же, текст пишется.
    await expect(page.locator(`${ED} .led-pm .selectedCell`)).toHaveCount(0);
    await expectAt(page, ED, 2, 3);
    await page.keyboard.type('!');
    expect((await tableText(page, ED))[2][3]).toBe('r2c3!');
  });

  test('меню строки: удалить, вставить, дублировать, переместить', async ({ page }) => {
    const menuItem = async (cmd) => {
      await page.locator(`${ED} .led-thandle-row`).click();
      await page.locator(`.led-tmenu [data-cmd="${cmd}"]`).click();
      await expect(page.locator('.led-tmenu')).toHaveCount(0);
    };
    await cell(page, ED, 2, 1).click();
    await menuItem('rowDel');
    let rows = await tableText(page, ED);
    expect(rows.map((r) => r[0])).toEqual(['r0c0', 'r1c0', 'r3c0']);
    // Курсор остался в таблице — на строке, вставшей на место удалённой.
    await expectAt(page, ED, 2, 1);
    await menuItem('rowAbove');
    rows = await tableText(page, ED);
    expect(rows.map((r) => r[0])).toEqual(['r0c0', 'r1c0', '', 'r3c0']);
    await expectAt(page, ED, 2, 1);
    await page.keyboard.type('новая');
    await menuItem('rowDup');
    rows = await tableText(page, ED);
    expect(rows.map((r) => r[1])).toEqual(['r0c1', 'r1c1', 'новая', 'новая', 'r3c1']);
    // Копия — ниже, курсор на ней.
    await expectAt(page, ED, 3, 1);
    await menuItem('rowDown');
    rows = await tableText(page, ED);
    expect(rows.map((r) => r[0])).toEqual(['r0c0', 'r1c0', '', 'r3c0', '']);
    await expectAt(page, ED, 4, 1);
    // Последняя строка вниз не едет.
    await page.locator(`${ED} .led-thandle-row`).click();
    await expect(page.locator('.led-tmenu [data-cmd="rowDown"]')).toBeDisabled();
    await page.locator('.led-tmenu [data-cmd="rowUp"]').click();
    rows = await tableText(page, ED);
    expect(rows.map((r) => r[0])).toEqual(['r0c0', 'r1c0', '', '', 'r3c0']);
    await expectAt(page, ED, 3, 1);
  });

  test('меню столбца: вставить справа, выровнять по центру, столбец заголовков, удалить', async ({ page }) => {
    await cell(page, ED, 2, 1).click();
    await page.locator(`${ED} .led-thandle-col`).click();
    const menu = page.locator('.led-pop.led-tmenu');
    await expect(menu).toBeVisible();
    const selected = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .led-pm table tr`)].map((tr) => [...tr.children].map((td) => (td.classList.contains('selectedCell') ? 1 : 0)).join('')), ED);
    expect(selected, 'выделен весь столбец 1').toEqual(['0100', '0100', '0100', '0100']);
    const cmds = await menu.locator('.ctx-item').evaluateAll((els) => els.map((e) => e.dataset.cmd));
    expect(cmds).toEqual(['colLeft', 'colRight', 'colDup', 'colMoveLeft', 'colMoveRight', 'align-left', 'align-center', 'align-right', 'colHeader', 'colDel']);
    await expect(menu.locator('[data-cmd="align-left"]')).toHaveAttribute('aria-checked', 'true');
    await menu.locator('[data-cmd="colRight"]').click();
    let rows = await tableText(page, ED);
    expect(rows[1]).toEqual(['r1c0', 'r1c1', '', 'r1c2', 'r1c3']);
    await expectAt(page, ED, 2, 2);
    // Назад к столбцу 1 и выровнять его по центру — только его.
    await cell(page, ED, 2, 1).click();
    await page.locator(`${ED} .led-thandle-col`).click();
    await page.locator('.led-tmenu [data-cmd="align-center"]').click();
    const aligns = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .led-pm table tr`)].map((tr) => [...tr.children].map((td) => getComputedStyle(td.querySelector('p')).textAlign)), ED);
    for (const row of aligns) expect(row[1]).toBe('center');
    for (const row of aligns) expect([row[0], row[2], row[3], row[4]].every((a) => a !== 'center'), 'соседние столбцы не задеты').toBe(true);
    // Столбец заголовков: ячейки ниже строки заголовков — th, строка заголовков цела.
    await page.locator(`${ED} .led-thandle-col`).click();
    await expect(page.locator('.led-tmenu [data-cmd="align-center"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.led-tmenu [data-cmd="colHeader"]').click();
    const tags = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .led-pm table tr`)].map((tr) => [...tr.children].map((td) => td.tagName[1]).join('')), ED);
    expect(await tags()).toEqual(['HHHHH', 'DHDDD', 'DHDDD', 'DHDDD']);
    await page.locator(`${ED} .led-thandle-col`).click();
    await expect(page.locator('.led-tmenu [data-cmd="colHeader"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.led-tmenu [data-cmd="colHeader"]').click();
    expect(await tags(), 'снова обычный столбец, строка заголовков цела').toEqual(['HHHHH', 'DDDDD', 'DDDDD', 'DDDDD']);
    await page.locator(`${ED} .led-thandle-col`).click();
    await page.locator('.led-tmenu [data-cmd="colDel"]').click();
    rows = await tableText(page, ED);
    expect(rows[1]).toEqual(['r1c0', '', 'r1c2', 'r1c3']);
  });

  test('ручки не мешают подменю «Таблица ›» по правой кнопке', async ({ page }) => {
    await cell(page, ED, 1, 1).click();
    await expectAt(page, ED, 1, 1);
    const b = await cell(page, ED, 1, 1).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    await page.locator('.led-ctx [data-cmd="table"]').click();
    await page.locator('.led-ctx [data-cmd="rowBelow"]').click();
    expect((await tableText(page, ED)).length).toBe(5);
    await expectAt(page, ED, 1, 1);
  });
});

/** Редактор как на телефоне — окно 375 px, живой режим (высота по тексту). */
async function phoneEditor(page) {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:740px;overflow:auto;z-index:500;background:var(--bg)';
    document.body.append(box);
    window.__msgs = [];
    window.__ped = LancibleEditor.create(box, {
      mobile: true, inApp: true, nativeToolbar: true, autoHeight: true, content: null,
      post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))),
    });
  });
}

test('телефон, 375: ручка строки в пределах окна, у таблицы поле слева под неё', async ({ page }) => {
  await phoneEditor(page);
  await fillTable(page, '#phone-ed');
  await cell(page, '#phone-ed', 2, 0).click();
  const g = await expectAt(page, '#phone-ed', 2, 0);
  expect(g.row.left, 'ручка строки не уходит за левый край').toBeGreaterThanOrEqual(0);
  expect(g.col.right, 'ручка столбца — в окне').toBeLessThanOrEqual(375);
  const margin = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#phone-ed .led-pm .tableWrapper')).marginLeft));
  expect(margin, 'поле слева у таблицы — под ручку').toBeGreaterThanOrEqual(20);
  expect(g.row.width, 'ручка под палец шире десктопной').toBeGreaterThanOrEqual(16);
  // Касание ручки — меню в пределах окна.
  await page.locator('#phone-ed .led-thandle-row').click();
  const m = await page.locator('.led-pop.led-tmenu').boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(375);
  await page.locator('.led-tmenu [data-cmd="rowDup"]').click();
  expect((await tableText(page, '#phone-ed')).map((r) => r[0])).toEqual(['r0c0', 'r1c0', 'r2c0', 'r2c0', 'r3c0']);
});

// Панель редактора в e2e: команда нажимается там, где она сейчас есть, — в
// строке или в меню группы.
//
// С 11 октября 2026 панель — одна строка с приоритетной раскладкой
// (src/editor/toolbar.js): какие кнопки в строке, зависит от ширины, а что не
// влезло — в меню «Формат», «Вставить», списков или «…». Тест, который
// щёлкал бы кнопку по подписи, зависел бы от ширины окна; поэтому команды
// ищутся по метке data-cmd — и у кнопки в строке, и у пункта меню. Группы —
// по data-group; в «…» свёрнутая группа — пунктом с data-group, он открывает
// её меню на том же месте.
const { expect } = require('@playwright/test');

/** Все команды панели: каждая обязана быть достижима на любой ширине. */
const COMMANDS = [
  'undo', 'redo', 'block', 'bold', 'italic', 'underline', 'strike', 'link',
  'fontSize', 'fontFamily', 'color', 'highlight', 'align', 'outdent', 'indent', 'code', 'sup', 'sub', 'clear',
  'bullet', 'ordered', 'tasks',
  'table', 'image', 'imageUrl', 'chart', 'drawing', 'quote', 'callout', 'codeblock', 'hr',
  'annotate', 'comment', 'find', 'outline', 'comments', 'view',
  'exportMd', 'exportHtml', 'exportPdf', 'copyMd', 'print', 'shortcuts',
];

const bar = (page, scope) => page.locator(`${scope} .led-toolbar`);
const labels = (loc, attr) => loc.evaluateAll((els, a) => els.map((e) => e.dataset[a]), attr);

/** Обойти меню групп: для каждой видимой группы (и вложенной в «…») —
 *  открыть, отдать меню в visit(), закрыть. visit вернул true — стоп, меню
 *  не закрываем: visit сам что-то в нём нажал. */
async function walkMenus(page, scope, visit) {
  const groups = await labels(bar(page, scope).locator('[data-group]:visible'), 'group');
  for (const g of groups) {
    const opener = bar(page, scope).locator(`[data-group="${g}"]:visible`);
    await opener.click();
    const pop = page.locator('.led-pop');
    await expect(pop, `меню «${g}» открылось`).toBeVisible();
    if (await visit(pop, g)) return true;
    const nested = await labels(pop.locator('[data-group]'), 'group');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    for (const n of nested) {
      await opener.click();
      await page.locator(`.led-pop [data-group="${n}"]`).click();
      await expect(pop, `вложенное меню «${n}» открылось`).toBeVisible();
      if (await visit(pop, `${g}›${n}`)) return true;
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
    }
  }
  return false;
}

/** Команды, до которых можно дотянуться: кнопки строки и пункты всех меню. */
async function reachable(page, scope = '#editor-wrap') {
  const found = new Set(await labels(bar(page, scope).locator('[data-cmd]:visible'), 'cmd'));
  await walkMenus(page, scope, async (pop) => {
    for (const c of await labels(pop.locator('[data-cmd]'), 'cmd')) found.add(c);
    return false;
  });
  return found;
}

/** Нажать команду: кнопкой в строке, а если её там нет — пунктом меню. */
async function tool(page, cmd, scope = '#editor-wrap') {
  const inline = bar(page, scope).locator(`[data-cmd="${cmd}"]:visible`);
  if (await inline.count()) { await inline.first().click(); return; }
  const hit = await walkMenus(page, scope, async (pop) => {
    const item = pop.locator(`[data-cmd="${cmd}"]`);
    if (!(await item.count())) return false;
    await item.click();
    return true;
  });
  if (!hit) throw new Error(`команды «${cmd}» нет ни в строке панели, ни в её меню`);
}

module.exports = { COMMANDS, reachable, tool };

// Окно «Экспорт в Excel»: период и проекты выпадашками. Запуск: npm run test:e2e
//
// До 11 октября 2026 окно было сеткой из семи вкладок периода («Всё время /
// День / Неделя / …») и кнопок «Отмена / Экспорт». Решение пользователя: это
// неудобно и непонятно; период — выпадающим списком, и добавить выбор
// проектов. Теперь два поля друг под другом (период, проекты), под периодом
// серой строкой его точные даты, под полями — сводка «Будет выгружено: N
// записей, Xч Yм», а когда выгружать нечего, «Экспорт» неактивен.
//
// Правила периода и выбора проектов проверены юнитами (tests/unit/export.test.js);
// здесь — что окно ими пользуется: выпадашки открываются и мерятся, мультивыбор
// держит меню открытым, а в файл (его запись подменена) уходят записи только
// выбранных проектов и только за выбранный период.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Среда, 10 июня 2026 (см. clock.js). Три проекта; у «Сайта» две версии.
 *  Записи расставлены по границам суток: 9 июня 23:50 (вчера) и 10 июня
 *  23:30 (начата сегодня, кончается завтра). */
async function seed(page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate(() => {
    const now = new Date();
    const H = 3_600_000;
    const mk = (name, color) => {
      const id = uid();
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] });
      seedProjectStatuses(id);
      return id;
    };
    const site = mk('Сайт', '#87ff65');
    const landing = mk('Лендинг', '#5ec8f2');
    const bot = mk('Бот', '#ff8a5c');
    const v13 = { id: uid(), projectId: site, name: 'v1.3', releasedAt: null, order: 0 };
    const v14 = { id: uid(), projectId: site, name: 'v1.4', releasedAt: null, order: 1 };
    state.versions.push(v13, v14);
    // spans: [месяц, день, час, минута, часов]
    const add = (projectId, title, versionId, spans) => {
      const sessions = spans.map(([m, d, h, min, hours]) => {
        const start = new Date(2026, m - 1, d, h, min);
        const ms = hours * H;
        return { start: start.toISOString(), end: new Date(start.getTime() + ms).toISOString(), ms };
      });
      state.tasks.push({
        id: uid(), projectId, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: orderedStatuses(projectId)[0].id, tagIds: [], versionId, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    add(site, 'Вёрстка', v13.id, [[6, 10, 10, 0, 2], [6, 9, 23, 50, 1], [5, 12, 9, 0, 3]]);
    add(site, 'Поиск', v14.id, [[6, 10, 23, 30, 1]]);
    add(landing, 'Первый экран', null, [[6, 10, 15, 0, 1], [6, 1, 9, 0, 1]]);
    add(bot, 'Команды', null, [[1, 5, 9, 0, 1]]);
    state.ui.view = 'time';
    render();
    return { site, landing, bot, v13: v13.id, v14: v14.id };
  });
}

const DIALOG = '#expdlg-backdrop';
const MENU = '#ctx-menu';

async function openDialog(page) {
  await page.locator('#export-period-btn').click();
  await expect(page.locator(DIALOG)).toBeVisible();
}
const text = (page, sel) => page.locator(sel).evaluate((n) => n.textContent.replace(/\s+/g, ' ').trim());
const pickPeriod = async (page, label) => {
  await page.locator('#exp-period').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: label }).click();
};
/** Дождаться конца анимаций: окно и меню въезжают с масштабом, и до этого рамки чуть меньше. */
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
const menuLabels = (page) => page.locator(`${MENU} .ctx-item .ctx-label`).allTextContents();
const checked = (page) => page.locator(`${MENU} .ctx-item.sel .ctx-label`).allTextContents();

/** Подменяет запись файла: что бы ни пришло в выгрузку, оно оказывается в
 *  window.__exports. */
const captureExports = (page) => page.evaluate(() => {
  window.__exports = [];
  window.api.exportXlsx = async ({ defaultName, sheets }) => {
    window.__exports.push({ defaultName, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows })) });
    return { ok: true };
  };
});
const exported = (page) => page.evaluate(() => window.__exports);

/** Строки-записи листа: те, что начинаются с порядкового номера. */
const sessionRows = (sheet) => sheet.rows.filter((r) => typeof r[0] === 'number');

// --- устройство окна --------------------------------------------------------------

test('в окне нет сетки вкладок периода: два поля с подписями, сводка и кнопки внизу', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  const m = await page.evaluate(() => {
    const root = document.querySelector('#expdlg-backdrop .modal');
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width }; };
    return {
      tabs: root.querySelectorAll('.exp-tab, .segmented, .segmented-row, #exp-pills').length,
      selects: root.querySelectorAll('select').length,
      modal: box('#expdlg-backdrop .modal'),
      period: box('#exp-period'), projects: box('#exp-projects'), summary: box('#exp-summary'),
      cancel: box('#expdlg-cancel'), ok: box('#expdlg-ok'),
      title: root.querySelector('.modal-title').textContent.trim(),
      labels: [...root.querySelectorAll(':scope > label')].map((l) => l.textContent.trim()),
      overflow: root.scrollWidth - root.clientWidth,
    };
  });
  expect(m.tabs, 'вкладок периода в окне нет').toBe(0);
  expect(m.selects, 'системных <select> нет').toBe(0);
  expect(m.title).toBe('Экспорт в Excel');
  expect(m.labels, 'у полей подписи сверху').toEqual(['Период', 'Проекты']);
  expect(m.period.bottom, 'период над проектами').toBeLessThan(m.projects.top);
  expect(Math.abs(m.period.w - m.projects.w), 'поля одной ширины').toBeLessThan(1);
  expect(m.period.w, 'и во всю ширину окна без отступов').toBeGreaterThan(m.modal.right - m.modal.left - 40);
  expect(m.projects.bottom, 'сводка под полями').toBeLessThan(m.summary.top);
  expect(m.summary.bottom, 'кнопки под сводкой').toBeLessThan(m.ok.top);
  expect(m.cancel.right, '«Отмена» левее «Экспорта»').toBeLessThan(m.ok.left);
  expect(m.modal.bottom - m.ok.bottom, 'кнопки у нижнего края окна').toBeLessThan(26);
  expect(m.overflow, 'ничего не вылезает вбок').toBeLessThanOrEqual(0);

  // Стартовое состояние.
  expect(await text(page, '#exp-period')).toBe('Всё время');
  expect(await text(page, '#exp-projects')).toBe('Все проекты');
  await expect(page.locator('#exp-dates')).toBeHidden();
});

// --- закрытие и фокус -------------------------------------------------------------
//
// Окно ведёт себя как остальные модалки приложения: Escape и щелчок по
// подложке закрывают, фокус при открытии уходит внутрь, при закрытии
// возвращается на кнопку, с которой окно открыли. Открытое над ним меню или
// календарь первым забирает Escape на себя — окно остаётся.

const activeId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);

test('Escape закрывает окно; фокус уходит на первое поле и возвращается на «Экспорт»', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  expect(await activeId(page), 'фокус в окне, на выпадашке периода').toBe('exp-period');

  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toBeHidden();
  expect(await activeId(page), 'и вернулся на кнопку «Экспорт»').toBe('export-period-btn');

  // Окно открывается снова и закрывается так же — слушатель не одноразовый.
  await openDialog(page);
  expect(await activeId(page)).toBe('exp-period');
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toBeHidden();
});

test('щелчок по подложке закрывает окно, щелчок внутри окна — нет', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  await page.locator(`${DIALOG} .modal-title`).click();
  await page.locator('#exp-range-text').click();
  await expect(page.locator(DIALOG), 'щелчок по самому окну его не закрывает').toBeVisible();

  const corner = await page.evaluate(() => {
    const x = 6;
    const y = window.innerHeight - 6;
    const hit = document.elementFromPoint(x, y);
    return { x, y, id: hit && hit.id };
  });
  expect(corner.id, 'в углу экрана — подложка окна').toBe('expdlg-backdrop');
  await page.mouse.click(corner.x, corner.y);
  await expect(page.locator(DIALOG)).toBeHidden();
  expect(await activeId(page), 'фокус вернулся на «Экспорт»').toBe('export-period-btn');
});

test('«Отмена» и «Экспорт» тоже возвращают фокус на кнопку, с которой окно открыли', async ({ page }) => {
  await seed(page);
  await captureExports(page);
  await openDialog(page);
  await page.locator('#expdlg-cancel').click();
  await expect(page.locator(DIALOG)).toBeHidden();
  expect(await activeId(page)).toBe('export-period-btn');

  await openDialog(page);
  await page.locator('#expdlg-ok').click();
  await expect(page.locator(DIALOG)).toBeHidden();
  expect((await exported(page)).length, 'выгрузка ушла').toBe(1);
  expect(await activeId(page)).toBe('export-period-btn');
});

test('Escape над открытым меню закрывает только меню, над календарём — только календарь', async ({ page }) => {
  await seed(page);
  await openDialog(page);

  await page.locator('#exp-projects').click();
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator(DIALOG), 'окно под меню осталось').toBeVisible();

  await pickPeriod(page, 'Свой период…');
  await page.locator('#exp-from').click();
  await expect(page.locator('#dp-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dp-pop')).toBeHidden();
  await expect(page.locator(DIALOG), 'окно под календарём осталось').toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG), 'следующий Escape закрывает уже его').toBeHidden();
});

// --- период ----------------------------------------------------------------------

test('период — выпадашка: семь пунктов, меню шириной с кнопку, выбор меняет строку с датами', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  await page.locator('#exp-period').click();
  await expect(page.locator(MENU)).toBeVisible();
  await settled(page);

  expect(await menuLabels(page)).toEqual([
    'Всё время', 'Сегодня', 'Эта неделя', 'Этот месяц', 'Последние полгода', 'Последний год', 'Свой период…',
  ]);
  expect(await checked(page)).toEqual(['Всё время']);

  const w = await page.evaluate(() => ({
    btn: document.getElementById('exp-period').getBoundingClientRect().width,
    menu: document.getElementById('ctx-menu').getBoundingClientRect().width,
    fit: document.getElementById('ctx-menu').classList.contains('fit'),
    open: document.getElementById('exp-period').classList.contains('open'),
  }));
  expect(Math.abs(w.menu - w.btn), 'меню шириной с кнопку').toBeLessThan(1.5);
  expect(w.menu, 'и не шире разумного').toBeLessThanOrEqual(420);
  expect(w.fit, 'названия обрезаются многоточием').toBe(true);
  expect(w.open, 'открытая кнопка подсвечена').toBe(true);

  // «Всё время» под полем показывает, что за ним лежит: от первой записи до последней.
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toBeHidden();
  expect(await text(page, '#exp-range-text')).toBe('5 янв. – 10 июн. 2026');

  const cases = [
    ['Сегодня', '10 июн. 2026'],
    ['Эта неделя', '8 июн. – 14 июн. 2026'],
    ['Этот месяц', '1 июн. – 30 июн. 2026'],
    ['Последние полгода', '1 янв. – 10 июн. 2026'],
    ['Последний год', '1 июл. 2025 – 10 июн. 2026'],
  ];
  for (const [label, range] of cases) {
    await pickPeriod(page, label);
    await expect(page.locator(MENU), 'выбор закрывает меню').toBeHidden();
    expect(await text(page, '#exp-period'), label).toBe(label);
    expect(await text(page, '#exp-range-text'), `даты под полем: ${label}`).toBe(range);
  }
  // Повторный щелчок по кнопке закрывает меню, а не открывает заново.
  await page.locator('#exp-period').click();
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator('#exp-period').click();
  await expect(page.locator(MENU)).toBeHidden();
});

test('«Свой период» — две даты «с» и «по» с обычным выбором даты', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  await pickPeriod(page, 'Свой период…');
  await expect(page.locator('#exp-dates')).toBeVisible();
  await expect(page.locator('#exp-range-text'), 'даты уже на кнопках — строка под полем не нужна').toBeHidden();
  expect(await page.locator('#exp-dates label').allTextContents()).toEqual(['С', 'По']);
  expect(await text(page, '#exp-from')).toBe('10 июн. 2026');
  expect(await text(page, '#exp-to')).toBe('10 июн. 2026');

  // «С» — 9 июня: это выбор даты приложения (dp-pop), а не системный.
  await page.locator('#exp-from').click();
  await expect(page.locator('#dp-pop')).toBeVisible();
  await page.locator('#dp-days .dp-day', { hasText: /^9$/ }).click();
  await expect(page.locator('#dp-pop')).toBeHidden();
  expect(await text(page, '#exp-from')).toBe('9 июн. 2026');
  expect(await text(page, '#exp-summary')).toBe('Будет выгружено: 4 записи, 5ч');

  // «По» раньше «с» тянет «с» за собой, а не оставляет перевёрнутый период.
  await page.locator('#exp-to').click();
  await page.locator('#dp-days .dp-day', { hasText: /^8$/ }).click();
  expect(await text(page, '#exp-to')).toBe('8 июн. 2026');
  expect(await text(page, '#exp-from')).toBe('8 июн. 2026');
  expect(await text(page, '#exp-summary')).toContain('Записей нет');

  // Две кнопки в одном ряду, поровну.
  const row = await page.evaluate(() => {
    const a = document.getElementById('exp-from').getBoundingClientRect();
    const b = document.getElementById('exp-to').getBoundingClientRect();
    return { sameRow: Math.abs(a.top - b.top) < 2, a: a.width, b: b.width, gap: b.left - a.right };
  });
  expect(row.sameRow).toBe(true);
  expect(Math.abs(row.a - row.b)).toBeLessThan(1.5);
  expect(row.gap).toBeGreaterThan(0);
});

// --- проекты ---------------------------------------------------------------------

test('проекты — мультивыбор с галочками: меню остаётся открытым, «Все проекты» сбрасывает', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  await page.locator('#exp-projects').click();
  await expect(page.locator(MENU)).toBeVisible();
  await settled(page);

  expect(await menuLabels(page)).toEqual(['Все проекты', 'Сайт', 'Лендинг', 'Бот']);
  expect(await checked(page), 'по умолчанию — все проекты').toEqual(['Все проекты']);
  const dots = await page.locator(`${MENU} .ctx-dot`).evaluateAll((ns) => ns.map((n) => getComputedStyle(n).backgroundColor));
  expect(dots, 'у проектов цветные точки, у «Всех» её нет').toHaveLength(3);
  expect(new Set(dots).size, 'и цвета у них свои').toBe(3);

  const w = await page.evaluate(() => ({
    btn: document.getElementById('exp-projects').getBoundingClientRect().width,
    menu: document.getElementById('ctx-menu').getBoundingClientRect().width,
  }));
  expect(Math.abs(w.menu - w.btn), 'меню шириной с кнопку').toBeLessThan(1.5);

  const item = (name) => page.locator(`${MENU} .ctx-item`, { hasText: name });

  await item('Сайт').click();
  await expect(page.locator(MENU), 'отметка не закрывает меню').toBeVisible();
  expect(await checked(page)).toEqual(['Сайт']);
  expect(await text(page, '#exp-projects'), 'подпись — название одного').toBe('Сайт');

  await item('Лендинг').click();
  expect(await checked(page)).toEqual(['Сайт', 'Лендинг']);
  expect(await text(page, '#exp-projects'), 'подпись — число нескольких').toBe('2 проекта');

  await item('Сайт').click();
  expect(await checked(page), 'повторный щелчок снимает отметку').toEqual(['Лендинг']);
  expect(await text(page, '#exp-projects')).toBe('Лендинг');

  await item('Все проекты').click();
  expect(await checked(page), '«Все проекты» сбрасывает остальные').toEqual(['Все проекты']);
  expect(await text(page, '#exp-projects')).toBe('Все проекты');

  // Отмечены все по одному — те же «Все проекты».
  await item('Сайт').click();
  await item('Лендинг').click();
  await item('Бот').click();
  expect(await checked(page)).toEqual(['Все проекты']);
  expect(await text(page, '#exp-projects')).toBe('Все проекты');

  // Снята последняя отметка — тоже «все»: выгрузка по нулю проектов бессмысленна.
  await item('Бот').click();
  await item('Бот').click();
  expect(await checked(page)).toEqual(['Все проекты']);

  // Меню закрывается Escape и щелчком мимо, а окно остаётся.
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator(DIALOG)).toBeVisible();
  await page.locator('#exp-projects').click();
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator('#expdlg-backdrop .modal-title').click();
  await expect(page.locator(MENU)).toBeHidden();
});

test('множественная подпись склоняется: «3 проекта», «5 проектов»', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const id = uid();
      state.projects.push({ id, name: `Ещё ${i}`, color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
      seedProjectStatuses(id);
    }
  });
  await openDialog(page);
  await page.locator('#exp-projects').click();
  const item = (name) => page.locator(`${MENU} .ctx-item`, { hasText: name });
  await item('Сайт').click();
  await item('Лендинг').click();
  await item('Бот').click();
  expect(await text(page, '#exp-projects')).toBe('3 проекта');
  await item('Ещё 0').click();
  await item('Ещё 1').click();
  expect(await text(page, '#exp-projects')).toBe('5 проектов');
});

test('длинное название проекта: кнопка и меню обрезают его многоточием и не растут', async ({ page }) => {
  await seed(page);
  const LONG = 'Очень длинное название проекта которое не помещается ни в кнопку выбора ни в меню под ней целиком';
  await page.evaluate((name) => {
    const id = uid();
    state.projects.push({ id, name, color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
    seedProjectStatuses(id);
  }, LONG);
  await openDialog(page);
  await settled(page);
  const before = await page.locator('#exp-projects').evaluate((n) => n.getBoundingClientRect().width);
  await page.locator('#exp-projects').click();
  await settled(page);
  const menu = await page.locator(MENU).evaluate((n) => n.getBoundingClientRect().width);
  expect(Math.abs(menu - before), 'меню не растянулось под длинное имя').toBeLessThan(1.5);
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Очень длинное' }).click();
  const after = await page.evaluate(() => {
    const n = document.querySelector('#exp-projects .dp-select-name');
    return { cut: n.scrollWidth > n.clientWidth, overflow: getComputedStyle(n).textOverflow, w: document.getElementById('exp-projects').getBoundingClientRect().width };
  });
  expect(after.cut, 'название в кнопке обрезано').toBe(true);
  expect(after.overflow).toBe('ellipsis');
  expect(Math.abs(after.w - before), 'кнопка не выросла').toBeLessThan(1.5);
});

// --- сводка и «Экспорт» ----------------------------------------------------------

test('сводка считает записи и время по периоду и проектам; границы суток — по началу записи', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  const summary = () => text(page, '#exp-summary');

  expect(await summary(), 'всё время, все проекты').toBe('Будет выгружено: 7 записей, 10ч');
  // «Сегодня»: 10:00 и 23:30 (она кончается уже завтра) «Сайта» и 15:00 «Лендинга»;
  // запись 9 июня в 23:50 не попадает, хотя заканчивается в 00:50 десятого.
  await pickPeriod(page, 'Сегодня');
  expect(await summary()).toBe('Будет выгружено: 3 записи, 4ч');
  await pickPeriod(page, 'Эта неделя');
  expect(await summary()).toBe('Будет выгружено: 4 записи, 5ч');
  await pickPeriod(page, 'Этот месяц');
  expect(await summary()).toBe('Будет выгружено: 5 записей, 6ч');

  // Те же периоды, но по одному проекту.
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Лендинг' }).click();
  expect(await summary()).toBe('Будет выгружено: 2 записи, 2ч');
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Сайт' }).click();
  expect(await summary()).toBe('Будет выгружено: 5 записей, 6ч');
});

test('записей нет — «Экспорт» неактивен, подсказка в строке и на кнопке, файл не пишется', async ({ page }) => {
  await seed(page);
  await captureExports(page);
  await openDialog(page);
  await expect(page.locator('#expdlg-ok')).toBeEnabled();
  const height = () => page.locator(`${DIALOG} .modal`).evaluate((n) => n.offsetHeight);
  const before = await height();

  // «Бот» — одна запись в январе; за сегодня у него ничего.
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Бот' }).click();
  await page.keyboard.press('Escape');
  await pickPeriod(page, 'Сегодня');

  const hint = 'Записей нет — выберите другой период или проекты';
  expect(await text(page, '#exp-summary')).toBe(hint);
  await expect(page.locator('#exp-summary')).toHaveClass(/empty/);
  await expect(page.locator('#expdlg-ok')).toBeDisabled();
  await expect(page.locator('#expdlg-ok')).toHaveAttribute('title', hint);
  const look = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('expdlg-ok'));
    return { opacity: Number(cs.opacity), cursor: cs.cursor };
  });
  expect(look.opacity, 'погасшая кнопка тусклее').toBeLessThan(0.6);
  expect(await height(), 'подсказка длиннее строки, но окно не выросло: иначе оно уезжало бы из-под открытого меню').toBe(before);
  await page.locator('#expdlg-ok').click({ force: true });
  await expect(page.locator(DIALOG), 'нажатие на неё окно не закрывает').toBeVisible();
  expect(await exported(page)).toEqual([]);

  // Другой период — кнопка снова жива, подсказка ушла.
  await pickPeriod(page, 'Последние полгода');
  await expect(page.locator('#expdlg-ok')).toBeEnabled();
  expect(await text(page, '#exp-summary')).toBe('Будет выгружено: 1 запись, 1ч');
  await expect(page.locator('#expdlg-ok')).not.toHaveAttribute('title', /.+/);
});

// --- что уходит в файл -------------------------------------------------------------

test('за период и по выбранным проектам: в файле только их записи', async ({ page }) => {
  await seed(page);
  await captureExports(page);
  await openDialog(page);

  await pickPeriod(page, 'Этот месяц');
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Лендинг' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#expdlg-ok').click();
  await expect(page.locator(DIALOG), 'после выгрузки окно закрыто').toBeHidden();

  const [one] = await exported(page);
  expect(one.defaultName).toBe('Lancible — период — Лендинг — 2026-06-01 — 2026-06-30');
  expect(one.sheets).toHaveLength(1);
  const rows = sessionRows(one.sheets[0]);
  expect(rows, 'две записи «Лендинга» за июнь').toHaveLength(2);
  expect(new Set(rows.map((r) => r[2])), 'и только его').toEqual(new Set(['Лендинг']));
  expect(rows.map((r) => r[3]).sort(), 'даты — внутри периода').toEqual(['2026-06-01', '2026-06-10']);

  // Тот же месяц по двум проектам: «Бот» не попадает, «Сайт» с границей суток — да.
  await openDialog(page);
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Лендинг' }).click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Сайт' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#exp-projects')).toHaveText('2 проекта');
  await page.locator('#expdlg-ok').click();
  const two = (await exported(page))[1];
  expect(two.defaultName).toBe('Lancible — период — 2 проекта — 2026-06-01 — 2026-06-30');
  const rows2 = sessionRows(two.sheets[0]);
  expect(rows2).toHaveLength(5);
  expect(new Set(rows2.map((r) => r[2])), 'проекты — только выбранные').toEqual(new Set(['Сайт', 'Лендинг']));
  expect(rows2.map((r) => r[3] + ' ' + r[4]), 'записи, начатые 9 и 10 июня, — в своих днях').toEqual(
    ['2026-06-01 09:00:00', '2026-06-09 23:50:00', '2026-06-10 10:00:00', '2026-06-10 15:00:00', '2026-06-10 23:30:00'],
  );
});

test('«Всё время» по выбранным проектам: сводный лист и по листу на каждый, без остальных', async ({ page }) => {
  await seed(page);
  await captureExports(page);
  await openDialog(page);

  // Все проекты: сводка и три листа.
  await page.locator('#expdlg-ok').click();
  const all = (await exported(page))[0];
  expect(all.defaultName).toBe('Lancible — все проекты — 2026-06-10');
  expect(all.sheets.map((s) => s.name)).toEqual(['Задачи', 'Сайт', 'Лендинг', 'Бот']);

  // Два проекта: сводка только по ним.
  await openDialog(page);
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Лендинг' }).click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Бот' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#expdlg-ok').click();
  const two = (await exported(page))[1];
  expect(two.defaultName).toBe('Lancible — 2 проекта — 2026-06-10');
  expect(two.sheets.map((s) => s.name)).toEqual(['Задачи', 'Лендинг', 'Бот']);
  const summaryRows = two.sheets[0].rows.filter((r) => typeof r[0] === 'number');
  expect(summaryRows.map((r) => r[1]), 'в сводке только выбранные').toEqual(['Лендинг', 'Бот']);
});

// --- откуда открыли ---------------------------------------------------------------

test('открыто с экрана, где выбран проект, — он и предвыбран, вместе с версией', async ({ page }) => {
  const ids = await seed(page);
  await captureExports(page);

  // Без фильтра — все.
  await openDialog(page);
  expect(await text(page, '#exp-projects')).toBe('Все проекты');
  await page.locator('#expdlg-cancel').click();
  await expect(page.locator(DIALOG)).toBeHidden();

  // Выбран проект.
  await page.evaluate((id) => { statsFilter.projectId = id; statsFilter.versionId = 'all'; }, ids.landing);
  await openDialog(page);
  expect(await text(page, '#exp-projects')).toBe('Лендинг');
  expect(await text(page, '#exp-summary')).toBe('Будет выгружено: 2 записи, 2ч');
  await page.locator('#exp-projects').click();
  expect(await checked(page)).toEqual(['Лендинг']);
  await page.keyboard.press('Escape');
  await page.locator('#expdlg-cancel').click();

  // Выбраны проект и версия: отбор по версии не теряется.
  await page.evaluate((a) => { statsFilter.projectId = a.site; statsFilter.versionId = a.v13; }, ids);
  await openDialog(page);
  expect(await text(page, '#exp-projects')).toBe('Сайт · v1.3');
  expect(await text(page, '#exp-summary'), 'только записи «Вёрстки» из v1.3').toBe('Будет выгружено: 3 записи, 6ч');
  await page.locator('#expdlg-ok').click();
  const filtered = (await exported(page))[0];
  expect(filtered.defaultName).toBe('Lancible — Сайт · v1.3 — 2026-06-10');
  expect(filtered.sheets.map((s) => s.name)).toEqual(['Задачи', 'Сайт']);

  // Любая отметка в списке проектов снимает версию.
  await openDialog(page);
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Лендинг' }).click();
  await page.keyboard.press('Escape');
  expect(await text(page, '#exp-projects')).toBe('2 проекта');
  expect(await text(page, '#exp-summary')).toBe('Будет выгружено: 6 записей, 9ч');

  // Фильтр на экране не тронут: окно его только читает.
  const filter = await page.evaluate(() => ({ ...statsFilter }));
  expect(filter.versionId).toBe(ids.v13);
});

test('период помнится между открытиями, проекты — нет', async ({ page }) => {
  await seed(page);
  await openDialog(page);
  await pickPeriod(page, 'Этот месяц');
  await page.locator('#exp-projects').click();
  await page.locator(`${MENU} .ctx-item`, { hasText: 'Бот' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#expdlg-cancel').click();
  await openDialog(page);
  expect(await text(page, '#exp-period')).toBe('Этот месяц');
  expect(await text(page, '#exp-projects')).toBe('Все проекты');
});

// --- узкое окно и обе темы ---------------------------------------------------------

test('на узком окне окно и меню не вылезают за край', async ({ page }) => {
  await seed(page, 375);
  // На узком окне кнопка «Экспорт» в шапке может уходить в меню, а окно — то же.
  await page.evaluate(() => openExportPeriodDialog());
  await expect(page.locator(DIALOG)).toBeVisible();
  const fit = () => page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const modal = r('#expdlg-backdrop .modal');
    return { left: modal.left, right: modal.right, vw: window.innerWidth, hscroll: document.documentElement.scrollWidth - window.innerWidth };
  });
  const m = await fit();
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(m.vw);
  expect(m.hscroll, 'горизонтальной прокрутки нет').toBeLessThanOrEqual(0);

  for (const sel of ['#exp-period', '#exp-projects']) {
    await page.locator(sel).click();
    const box = await page.locator(MENU).evaluate((n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, vw: window.innerWidth }; });
    expect(box.left, `${sel}: меню не левее края`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${sel}: и не правее`).toBeLessThanOrEqual(box.vw);
    await page.keyboard.press('Escape');
  }
  await pickPeriod(page, 'Свой период…');
  const dates = await page.evaluate(() => {
    const a = document.getElementById('exp-from').getBoundingClientRect();
    const b = document.getElementById('exp-to').getBoundingClientRect();
    const modal = document.querySelector('#expdlg-backdrop .modal').getBoundingClientRect();
    return { right: b.right, modalRight: modal.right, aW: a.width, scroll: document.querySelector('#expdlg-backdrop .modal').scrollWidth - document.querySelector('#expdlg-backdrop .modal').clientWidth };
  });
  expect(dates.right).toBeLessThanOrEqual(dates.modalRight);
  expect(dates.scroll).toBeLessThanOrEqual(0);
});

for (const theme of ['dark', 'light']) {
  test(`в ${theme === 'dark' ? 'тёмной' : 'светлой'} теме тексты окна читаются: контраст не ниже 4.5:1`, async ({ page }) => {
    await seed(page);
    await page.evaluate((th) => { state.settings.theme = th; applyTheme(); }, theme);
    await openDialog(page);
    await pickPeriod(page, 'Этот месяц');
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => { const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const got = await page.evaluate(() => {
      const panel = getComputedStyle(document.querySelector('#expdlg-backdrop .modal')).backgroundColor;
      const field = getComputedStyle(document.getElementById('exp-period'));
      const out = { panel, field: { color: field.color, bg: field.backgroundColor } };
      for (const id of ['exp-range-text', 'exp-summary']) out[id] = getComputedStyle(document.getElementById(id)).color;
      out.label = getComputedStyle(document.querySelector('#expdlg-backdrop label')).color;
      return out;
    });
    expect(ratio(got.field.color, got.field.bg), 'текст в поле').toBeGreaterThanOrEqual(4.5);
    expect(ratio(got['exp-range-text'], got.panel), 'строка с датами').toBeGreaterThanOrEqual(4.5);
    expect(ratio(got['exp-summary'], got.panel), 'сводка').toBeGreaterThanOrEqual(4.5);
    expect(ratio(got.label, got.panel), 'подписи полей').toBeGreaterThanOrEqual(4.5);
  });
}

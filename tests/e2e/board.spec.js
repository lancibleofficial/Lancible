// Канбан-доска: что показывает карточка и заголовок столбца, и как выглядит
// закреплённая задача в списке. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

const HOUR = 3_600_000;

/** Готовит проект с задачами прямо в состоянии приложения: через интерфейс
 *  пришлось бы гонять таймер, а нам нужны заранее известные суммы. */
async function seed(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  return page.evaluate((HOUR) => {
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт клиента', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';
    const cols = orderedStatuses(pid);
    const add = (title, colIdx, hours, rate, pinned) => {
      const ms = hours * HOUR;
      state.tasks.push({
        id: uid(), projectId: pid, title, done: cols[colIdx].kind === 'done', notes: null,
        totalMs: ms,
        sessions: ms ? [{ start: new Date(Date.now() - ms).toISOString(), end: new Date().toISOString(), ms }] : [],
        rate: rate ?? null, pinnedAt: pinned ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        statusId: cols[colIdx].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    add('С временем и часами', 1, 2, null, true);   // 2ч × 2000 = 4000
    add('Пустая', 1, 0, null, false);               // ничего
    add('Со своей ставкой', 2, 1.5, 4000, false);   // 1.5ч × 4000 = 6000
    state.ui.projectId = pid;
    state.ui.boardProjectId = pid;
    render();
    return pid;
  }, HOUR);
}

async function openBoard(page) {
  await page.evaluate(() => { state.ui.view = 'board'; renderBoardPage(); render(); });
  await expect(page.locator('.board-col').first()).toBeVisible();
}

test('карточка показывает время и деньги, включая нули', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  const cards = page.locator('.board-col').nth(1).locator('.board-card');
  await expect(cards).toHaveCount(2);

  // Нули показываются наравне с остальным: строка под названием держит одну
  // высоту, и карточки не прыгают, когда тронули таймер.
  await expect(cards.nth(0).locator('.bc-time')).toHaveText(/2ч/);
  await expect(cards.nth(0).locator('.bc-money')).toHaveText(/4\s?000/);
  await expect(cards.nth(1).locator('.bc-time')).toHaveText(/0м/);
  await expect(cards.nth(1).locator('.bc-money')).toHaveText(/^0\s/);
});

test('деньги считаются по своей ставке задачи, а не по общей', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  const card = page.locator('.board-col').nth(2).locator('.board-card').first();
  await expect(card.locator('.bc-money')).toHaveText(/6\s?000/);
});

test('заголовок столбца показывает сумму времени по своим задачам', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  const heads = page.locator('.board-col-head');
  await expect(heads.nth(0).locator('.board-col-time')).toHaveText('0м');
  await expect(heads.nth(1).locator('.board-col-time')).toHaveText(/2ч/);
  await expect(heads.nth(2).locator('.board-col-time')).toHaveText(/1ч 30м/);
});

test('идущий таймер попадает и в карточку, и в сумму столбца', async ({ page }) => {
  // Без этого доска расходится с карточкой задачи ровно на то время,
  // которое идёт прямо сейчас.
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Пустая');
    state.activeTimer = { taskId: task.id, startedAt: new Date(Date.now() - 3_600_000).toISOString() };
    render();
  });
  await openBoard(page);

  const cards = page.locator('.board-col').nth(1).locator('.board-card');
  await expect(cards.nth(1).locator('.bc-time')).toHaveText(/1ч/);
  await expect(page.locator('.board-col-head').nth(1).locator('.board-col-time')).toHaveText(/3ч/);
});

test('карточка доски поднята над столбцом, а не провалена в него', async ({ page }) => {
  // Доска была единственным местом, где карточка стояла на «второй» серой
  // поверхности: на светлой теме та темнее фона страницы, и карточка
  // читалась провалом, а не листком поверх столбца.
  await seed(page);

  for (const theme of ['dark', 'light']) {
    const got = await page.evaluate((th) => {
      state.settings.theme = th;
      applyTheme();
      state.ui.view = 'board';
      renderBoardPage();
      render();
      const lum = (c) => {
        const [r, g, b] = c.match(/[\d.]+/g).map(Number);
        return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      };
      const board = getComputedStyle(document.querySelector('.board-card')).backgroundColor;
      const column = getComputedStyle(document.querySelector('.board-col')).backgroundColor;
      const page = getComputedStyle(document.body).backgroundColor;
      state.ui.view = 'home';
      render();
      const t = getComputedStyle(document.querySelector('.ptile'));
      return {
        board, column, page, tile: t.backgroundColor, tileBorder: t.borderTopColor,
        lift: lum(board) - lum(column), tileLift: lum(t.backgroundColor) - lum(page),
      };
    }, theme);
    // Карточка на ступень светлее того, на чём лежит (с редизайна 6 октября
    // в тёмной теме так устроены все слои). В светлой «Чистой» всё белое, и
    // столбец доски — тихая серая полоса, на которой белая карточка видна.
    expect(got.lift, `в теме ${theme} карточка не светлее столбца`).toBeGreaterThan(5);
    if (theme === 'light') {
      expect(got.board, 'на светлой карточка доски белая').toBe('rgb(255, 255, 255)');
      expect(got.column, 'а столбец под ней — нет').not.toBe(got.board);
      expect(got.tile, 'карточка проекта белая, как страница').toBe(got.page);
      expect(got.tileBorder, 'и отделена от страницы рамкой').not.toBe(got.page);
    } else {
      expect(got.tileLift, 'в тёмной карточка проекта светлее страницы').toBeGreaterThan(5);
    }
  }
});

test('шапка доски: название без подложки, стрелка и шестерёнка', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  const btn = page.locator('#board-project');
  await expect(btn.locator('#board-project-name')).toHaveText('Сайт клиента');
  await expect(btn.locator('.board-chev')).toBeVisible();
  // Подложка убрана: название читается как заголовок, а не как поле ввода.
  await expect(btn).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(btn).toHaveCSS('border-style', 'none');
  // Кнопка одна на название и стрелку, поэтому зона клика у них общая.
  await expect(page.locator('#board-project-name')).toHaveCount(1);

  const gear = page.locator('#board-statuses');
  await expect(gear).toBeVisible();
  await expect(gear.locator('svg')).toHaveAttribute('fill-rule', 'evenodd');
  await expect(gear).not.toHaveText(/Статус/);
});

test('клик по названию проекта открывает выбор проекта', async ({ page }) => {
  await seed(page);
  await openBoard(page);
  await page.locator('#board-project').click();
  await expect(page.locator('#ctx-menu .ctx-item')).toHaveCount(1);
  await expect(page.locator('#ctx-menu .ctx-item').first()).toHaveText('Сайт клиента');
});

test('закреплённая задача не заливается цветом — её отмечает только пин', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { state.ui.view = 'project'; render(); });

  const pinned = page.locator('#task-list .task-item.pinned').first();
  const plain = page.locator('#task-list .task-item:not(.pinned):not(.selected)').first();
  await expect(pinned).toBeVisible();

  const colors = await page.evaluate(() => {
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const p = document.querySelector('#task-list .task-item.pinned');
    const o = document.querySelector('#task-list .task-item:not(.pinned):not(.selected)');
    return { pinned: bg(p), plain: bg(o), pin: getComputedStyle(p.querySelector('.task-pin')).opacity };
  });
  expect(colors.pinned, 'фон закреплённой должен совпадать с обычной').toBe(colors.plain);
  expect(colors.pin, 'иконка пина остаётся видимой всегда').toBe('1');
  await expect(plain).toBeVisible();
});

test('свойства задачи — строкой фишек под названием, без вкладки «Настройки»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks[0];
    task.dueAt = new Date(Date.now() + 3 * 86400000).toISOString();
    state.ui.view = 'project';
    selectedId = task.id;
    loadEditor(task);
    render();
  });
  // Свойства видны сразу, вкладки две: «Заметки» и «История».
  await expect(page.locator('#task-props #task-status')).toBeVisible();
  await expect(page.locator('#task-tabs button')).toHaveText(['Заметки', 'История']);

  // Фишки стоят под названием и над полосой таймера, у всех одна высота,
  // и подложка у заданного свойства есть, а у пустого — нет.
  const m = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const chips = [...document.querySelectorAll('#task-props .task-params > div')].filter((d) => !d.hidden);
    const bg = (d) => getComputedStyle(d).backgroundColor;
    const status = document.querySelector('#task-props .status-bar');
    const repeat = document.querySelector('#task-props .repeat-bar');
    return {
      title: r('#task-title').bottom,
      chipsTop: Math.min(...chips.map((d) => d.getBoundingClientRect().top)),
      chipsBottom: Math.max(...chips.map((d) => d.getBoundingClientRect().bottom)),
      timerTop: r('.timer-bar').top,
      heights: [...new Set(chips.map((d) => Math.round(d.getBoundingClientRect().height)))],
      statusBg: bg(status),
      repeatBg: bg(repeat),
      labelWidth: r('#task-props .status-bar .due-label').width,
    };
  });
  expect(m.chipsTop, 'фишки под названием').toBeGreaterThanOrEqual(m.title);
  expect(m.chipsBottom, 'и над полосой таймера').toBeLessThanOrEqual(m.timerTop);
  expect(m.heights, `у фишек разная высота: ${m.heights}`).toHaveLength(1);
  expect(m.statusBg, 'у заданного свойства подложка').not.toBe('rgba(0, 0, 0, 0)');
  expect(m.repeatBg, 'у пустого — нет').toBe('rgba(0, 0, 0, 0)');
  expect(m.labelWidth, 'подпись спрятана — говорит иконка').toBeLessThanOrEqual(1);
});

test('в окне задачи из календаря свойства остаются колонкой с подписями', async ({ page }) => {
  // Узел .task-params один: его одалживает окно задачи из календаря. Строка
  // фишек ограничена #task-props, и в окне раскладка прежняя.
  await seed(page);
  const m = await page.evaluate(() => {
    openTaskModal(state.tasks[0], null);
    const left = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
    const label = document.querySelector('#tmdlg-params .status-bar .due-label').getBoundingClientRect();
    return { lefts: ['#task-status', '#task-rate', '#due-date-btn'].map(left), labelWidth: label.width };
  });
  expect(new Set(m.lefts).size, `левые границы разошлись: ${m.lefts}`).toBe(1);
  expect(m.labelWidth, 'подписи видны').toBeGreaterThan(10);
});

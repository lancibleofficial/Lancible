// Версии: дорожки на доске, версия в задаче, настройка версий у проекта.
// Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

const HOUR = 3_600_000;

/** Проект с четырьмя версиями: две в работе, две выпущены. Готовим прямо в
 *  состоянии приложения — через интерфейс пришлось бы гонять таймер, а нам
 *  нужны заранее известные суммы времени. */
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

    const mkVer = (name, releasedAt, order) => {
      const v = { id: uid(), projectId: pid, name, releasedAt, order };
      state.versions.push(v);
      return v;
    };
    const v11 = mkVer('v1.1', new Date('2026-08-28').toISOString(), 0);
    mkVer('v1.2', new Date('2026-09-12').toISOString(), 1);
    const v13 = mkVer('v1.3', null, 2);
    const v14 = mkVer('v1.4', null, 3);

    const cols = orderedStatuses(pid);
    const add = (title, colIdx, hours, versionId) => {
      const ms = hours * HOUR;
      state.tasks.push({
        id: uid(), projectId: pid, title, done: cols[colIdx].kind === 'done', notes: null,
        totalMs: ms,
        sessions: ms ? [{ start: new Date(Date.now() - ms).toISOString(), end: new Date().toISOString(), ms }] : [],
        rate: null, pinnedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        statusId: cols[colIdx].id, tagIds: [], versionId, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    add('Вёрстка карточек', 1, 2, v13.id);   // 2ч
    add('API отчётов', 2, 1.5, v13.id);      // 1ч 30м
    add('Поиск по задачам', 1, 0.5, v14.id); // 30м
    add('Старый импорт', 3, 3, v11.id);      // 3ч
    add('Без версии пока', 1, 1, null);      // 1ч

    state.ui.projectId = pid;
    state.ui.boardProjectId = pid;
    return pid;
  }, HOUR);
}

async function openBoard(page) {
  await page.evaluate(() => { state.ui.view = 'board'; renderBoardPage(); render(); });
  await expect(page.locator('.board-col').first()).toBeVisible();
}

/** Перенос карточки. Настоящий HTML5-драг Playwright не воспроизводит, и
 *  тест бьёт прямо по обработчику — по тому, ради чего он написан. */
async function dropOn(page, selector, taskTitle) {
  await page.evaluate(({ selector, taskTitle }) => {
    const task = state.tasks.find((t) => t.title === taskTitle);
    const dt = new DataTransfer();
    dt.setData('text/plain', task.id);
    document.querySelector(selector).dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, { selector, taskTitle });
}

const versionOf = (page, title) => page.evaluate((title) => {
  const task = state.tasks.find((t) => t.title === title);
  const v = task.versionId ? getVersion(task.versionId) : null;
  return { version: v ? v.name : null, status: getStatus(task.statusId).name };
}, title);

test('пока версий нет, доска остаётся прежней — без дорожек', async ({ page }) => {
  // Одна-единственная дорожка — это не дорожка, а лишняя полоса над
  // столбцами. Проекты, которые версиями не пользуются, не должны заметить
  // ничего.
  await seed(page);
  await page.evaluate(() => {
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Без версий', color: '#5ec8f2', description: '',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    state.ui.boardProjectId = pid;
    state.ui.view = 'board';
    renderBoardPage();
  });
  await expect(page.locator('.board-lane')).toHaveCount(0);
  await expect(page.locator('#board-cols')).not.toHaveClass(/has-lanes/);
  await expect(page.locator('.board-col')).toHaveCount(6);
});

test('дорожки: работа сверху, выпущенное ниже и свёрнуто, «без версии» последней', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  await expect(page.locator('.lane-name')).toHaveText(['v1.3', 'v1.4', 'v1.2', 'v1.1', 'Без версии']);
  // Выпущенная версия закрыта: разворачивать её при каждом открытии доски
  // незачем, поэтому она приходит свёрнутой.
  await expect(page.locator('.board-lane').nth(2)).toHaveClass(/collapsed/);
  await expect(page.locator('.board-lane').nth(3)).toHaveClass(/collapsed/);
  await expect(page.locator('.board-lane').nth(0)).not.toHaveClass(/collapsed/);
  await expect(page.locator('.board-lane').nth(2).locator('.board-lane-cols')).toBeHidden();
});

test('заголовок дорожки считает время и задачи по своей версии', async ({ page }) => {
  await seed(page);
  await openBoard(page);

  const lane = (i) => page.locator('.board-lane').nth(i).locator('.board-lane-head');
  await expect(lane(0).locator('.board-count')).toHaveText('2');
  await expect(lane(0).locator('.board-col-time')).toHaveText(/3ч 30м/); // 2ч + 1ч 30м
  await expect(lane(1).locator('.board-col-time')).toHaveText(/30м/);
  await expect(lane(4).locator('.lane-name')).toHaveText('Без версии');
  await expect(lane(4).locator('.board-col-time')).toHaveText(/1ч/);
});

test('заголовок дорожки — полоса во всю видимую ширину и не уезжает вбок', async ({ page }) => {
  // И ширина, и удержание держатся на замере в app.js, а не на CSS: дорожка
  // шире окна, проценты считались бы от неё, а position: sticky двигает
  // элемент только внутри его дорожки — заголовку шириной с неё сдвигаться
  // уже некуда.
  await seed(page);
  await openBoard(page);
  await page.waitForTimeout(300); // раскладка должна улечься

  const measure = () => page.evaluate(() => {
    const box = document.getElementById('board-cols');
    const cs = getComputedStyle(box);
    const padL = parseFloat(cs.paddingLeft);
    const padR = parseFloat(cs.paddingRight);
    const boxLeft = box.getBoundingClientRect().left;
    return {
      scrollLeft: Math.round(box.scrollLeft),
      overflow: box.scrollWidth > box.clientWidth,
      visible: { left: Math.round(boxLeft + padL), right: Math.round(boxLeft + box.clientWidth - padR) },
      heads: [...document.querySelectorAll('.board-lane-head')].map((h) => {
        const b = h.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) };
      }),
    };
  });

  const before = await measure();
  expect(before.overflow, 'для проверки нужна доска шире окна').toBe(true);
  expect(new Set(before.heads.map((h) => h.w)).size, 'все заголовки одной ширины').toBe(1);
  expect(before.heads[0].left).toBe(before.visible.left);
  expect(Math.abs(before.heads[0].right - before.visible.right)).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    const box = document.getElementById('board-cols');
    box.scrollLeft = box.scrollWidth;
  });
  await page.waitForTimeout(150);

  const after = await measure();
  expect(after.scrollLeft, 'доска должна была уехать вправо').toBeGreaterThan(0);
  for (const [i, head] of after.heads.entries()) {
    expect(head.left, `заголовок ${i} уехал вместе с доской`).toBe(before.heads[0].left);
    expect(head.w, `заголовок ${i} изменил ширину`).toBe(before.heads[0].w);
  }
});

test('у выпущенной версии в заголовке стоит дата', async ({ page }) => {
  await seed(page);
  await openBoard(page);
  const shipped = page.locator('.board-lane').nth(3).locator('.board-lane-head');
  await expect(shipped).toHaveClass(/released/);
  await expect(shipped.locator('.lane-released')).toHaveText(/28 авг/);
});

test('перенос между дорожками меняет и статус, и версию', async ({ page }) => {
  // Это и есть главный смысл дорожек: задача переезжает из выпуска в выпуск
  // тем же движением, каким она ходит по статусам.
  await seed(page);
  await openBoard(page);

  const before = await versionOf(page, 'Вёрстка карточек');
  expect(before.version).toBe('v1.3');

  const target = '.board-lane:nth-of-type(2) .board-col:nth-of-type(4)';
  const targetStatus = await page.locator(`${target} .board-col-name`).textContent();
  await dropOn(page, target, 'Вёрстка карточек');

  const after = await versionOf(page, 'Вёрстка карточек');
  expect(after.version, 'версия должна стать версией дорожки').toBe('v1.4');
  expect(after.status, 'статус должен стать статусом столбца').toBe(targetStatus);
});

test('перенос на заголовок дорожки меняет только версию', async ({ page }) => {
  // У свёрнутой дорожки столбцов на экране нет, и без этого отправить туда
  // задачу было бы нечем.
  await seed(page);
  await openBoard(page);

  const before = await versionOf(page, 'Поиск по задачам');
  await dropOn(page, '.board-lane:nth-of-type(4) .board-lane-head', 'Поиск по задачам');
  const after = await versionOf(page, 'Поиск по задачам');

  expect(after.version).toBe('v1.1');
  expect(after.status, 'статус трогать не должны').toBe(before.status);
});

test('перенос в дорожку «Без версии» снимает версию', async ({ page }) => {
  await seed(page);
  await openBoard(page);
  await dropOn(page, '.board-lane:nth-of-type(5) .board-col:nth-of-type(2)', 'API отчётов');
  expect((await versionOf(page, 'API отчётов')).version).toBe(null);
});

test('задача, заведённая в дорожке, сразу получает её версию', async ({ page }) => {
  await seed(page);
  await openBoard(page);
  await page.locator('.board-lane').nth(1).locator('.board-add').first().click();
  const made = await page.evaluate(() => {
    const task = getTask(selectedId);
    return task.versionId ? getVersion(task.versionId).name : null;
  });
  expect(made).toBe('v1.4');
});

test('версия задачи видна в списке и в её настройках', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Вёрстка карточек');
    state.ui.view = 'project';
    selectedId = task.id;
    loadEditor(task);
    render();
    setTaskTab('settings');
  });

  await expect(page.locator('#task-version-row')).toBeVisible();
  await expect(page.locator('#task-version')).toHaveText('v1.3');

  const badges = page.locator('#task-list .task-item');
  await expect(badges.nth(0).locator('.task-version')).toHaveText('v1.3');
  await expect(badges.nth(3).locator('.task-version')).toHaveText('v1.1');
  await expect(badges.nth(3).locator('.task-version')).toHaveClass(/released/);
  await expect(badges.nth(4).locator('.task-version')).toHaveCount(0);
});

test('без версий в проекте строка версии в задаче не показывается', async ({ page }) => {
  // Завести версию можно только в настройках проекта, и пустой выбор в
  // каждой задаче занимал бы место ни за чем.
  await seed(page);
  await page.evaluate(() => {
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Без версий', color: '#5ec8f2', description: '',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    const now = new Date().toISOString();
    const task = {
      id: uid(), projectId: pid, title: 'Одинокая', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    };
    state.tasks.push(task);
    state.ui.view = 'project';
    state.ui.projectId = pid;
    selectedId = task.id;
    loadEditor(task);
    render();
    setTaskTab('settings');
  });
  await expect(page.locator('#task-version-row')).toBeHidden();
});

test('выбор версии — свой выпадающий список, без системного select', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'API отчётов');
    state.ui.view = 'project';
    selectedId = task.id;
    loadEditor(task);
    render();
    setTaskTab('settings');
  });
  await page.locator('#task-version').click();

  const items = page.locator('#ctx-menu .ctx-item');
  await expect(items.first()).toHaveText('Без версии');
  await expect(items).toHaveCount(6); // «Без версии» + четыре версии + «Настроить версии…»
  await expect(page.locator('#tab-settings select')).toHaveCount(0);

  await items.nth(4).click(); // v1.4
  await expect(page.locator('#task-version')).toHaveText('v1.4');
});

test('настройки проекта: статусы и версии в одном окне и на одной линии', async ({ page }) => {
  await seed(page);
  await openBoard(page);
  await page.locator('#board-statuses').click();

  await expect(page.locator('#stdlg-backdrop .modal-title')).toHaveText('Настройки проекта');
  await expect(page.locator('#stdlg-backdrop .setup-section')).toHaveText(['Статусы', 'Версии']);
  await expect(page.locator('#ver-list .ver-row')).toHaveCount(4);
  await expect(page.locator('#ver-list .ver-row').nth(0).locator('.ver-rel')).toHaveText(/28 авг/);
  await expect(page.locator('#ver-list .ver-row').nth(2).locator('.ver-rel')).toHaveText('в работе');
  await expect(page.locator('#ver-list .ver-row').nth(2).locator('.ver-use')).toHaveText('задач: 2');

  // Два списка в одном окне должны читаться как один: у версии нет кружка
  // цвета, и без выравнивания её поля стояли на 27 пикселей левее.
  const lefts = await page.evaluate(() => {
    const left = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
    return {
      status: left('#st-list .st-row .st-name'),
      version: left('#ver-list .ver-row .st-name'),
      statusDel: left('#st-list .st-row .st-del'),
      versionDel: left('#ver-list .ver-row .st-del'),
    };
  });
  expect(lefts.version, `поля разошлись на ${lefts.version - lefts.status}px`).toBe(lefts.status);
  expect(lefts.versionDel).toBe(lefts.statusDel);
});

test('удалённая версия снимается с задач, а задачи остаются', async ({ page }) => {
  // В отличие от статуса, без которого задаче некуда деться, версии у задачи
  // может не быть вовсе — поэтому спрашиваем и просто снимаем.
  await seed(page);
  await openBoard(page);
  await page.locator('#board-statuses').click();

  await page.locator('#ver-list .ver-row').nth(2).locator('.st-del').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-text')).toHaveText(/v1\.3/);
  await page.locator('#confirm-ok').click();

  await expect(page.locator('#ver-list .ver-row')).toHaveCount(3);
  const left = await page.evaluate(() => ({
    tasks: state.tasks.filter((t) => t.projectId === state.ui.boardProjectId).length,
    onV13: state.tasks.filter((t) => t.versionId && getVersion(t.versionId) && getVersion(t.versionId).name === 'v1.3').length,
    orphans: state.tasks.filter((t) => t.versionId && !getVersion(t.versionId)).length,
  }));
  expect(left.tasks, 'задачи удаляться не должны').toBe(5);
  expect(left.onV13).toBe(0);
  expect(left.orphans, 'висячих ссылок на удалённую версию быть не должно').toBe(0);
});

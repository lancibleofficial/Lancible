// Дублирование проекта и задачи. Запуск: npm run test:e2e
//
// Решения пользователя от 11 октября 2026. Проект копируется целиком — со
// статусами, версиями, тегами проекта, задачами и документами, — кроме записей
// времени: иначе часы и деньги в отчётах удвоились бы. Задача — всё, кроме
// записей времени и отметки «выполнено». Копия встаёт рядом с оригиналом и
// открывается; название — «<название> (копия)» на языке интерфейса.
//
// Что и как копируется, проверено юнитами (tests/unit/duplicate.test.js).
// Здесь — что пункты меню есть, нажимаются и дают то, что обещано, в живом
// приложении: копия появилась, открылась, пуста по времени и уходит в данные.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((HOUR) => {
    const now = new Date();
    const iso = now.toISOString();
    const mk = (id, name, color, extra = {}) => {
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: iso, tagIds: [], rate: null, currency: null, ...extra });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65', { description: 'Лендинг', rate: 1500, currency: 'USD', tagIds: ['g1', 'pt1'] });
    mk('p2', 'Другой', '#5ec8f2');
    state.tags.push(
      { id: 'g1', name: 'Срочное', color: '#ff5a5a', projectId: null },
      { id: 'pt1', name: 'Дизайн', color: '#c084fc', projectId: 'p1' },
    );
    state.versions.push({ id: 'v1', projectId: 'p1', name: 'v1.0', order: 0, releasedAt: null });
    const status = (pid, kind) => orderedStatuses(pid).find((s) => s.kind === kind).id;
    const at = (h) => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d; };
    const ses = (a, b) => ({ start: a.toISOString(), end: b.toISOString(), ms: b - a });
    const add = (id, pid, title, extra = {}) => {
      const sessions = extra.sessions || [];
      state.tasks.push({
        id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
        rate: null, pinnedAt: null, createdAt: iso, updatedAt: iso,
        statusId: status(pid, 'todo'), tagIds: [], versionId: null, repeat: null,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
      });
    };
    const text = Core.writeNotes({
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Сверстать главную' }] },
          { type: 'image', attrs: { src: 'asset:img-1' } },
        ],
      },
    });
    add('t1', 'p1', 'Вёрстка', {
      statusId: status('p1', 'progress'), tagIds: ['g1', 'pt1'], versionId: 'v1', rate: 2000,
      dueAt: at(18).toISOString(), notes: text, sessions: [ses(at(9), at(10))],
      repeat: { freq: 'week', every: 1, weekdays: [1], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never' }, done: 0 },
    });
    add('t2', 'p1', 'Сдача', { statusId: status('p1', 'done'), done: true, doneAt: iso, sessions: [ses(at(11), at(12))] });
    add('t3', 'p2', 'Чужая', { sessions: [ses(at(13), at(14))] });
    const doc = Core.newDocument({ id: 'd1', title: 'Бриф', projectId: 'p1' });
    doc.body = Core.writeNotes({ doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'asset:img-2' } }] } });
    state.documents.push(doc);
    state.ui.view = 'project';
    state.ui.projectId = 'p1';
    render();
  }, HOUR);
}

const item = (page, name) => page.locator('#ctx-menu .ctx-item', { hasText: name });

// --- проект ---------------------------------------------------------------------

test('меню проекта на его странице: «Дублировать» со значком; копия встаёт рядом и открывается', async ({ page }) => {
  await seed(page);
  await page.locator('#project-menu-btn').click();
  const dup = item(page, 'Дублировать');
  await expect(dup).toBeVisible();
  await expect(dup.locator('svg.ctx-icon'), 'значок — из словаря иконок, справа').toHaveCount(1);
  await dup.click();

  await expect(page.locator('#ph-name')).toHaveText('Сайт (копия)');
  const s = await page.evaluate(() => ({
    names: state.projects.map((p) => p.name),
    open: state.projects.find((p) => p.id === state.ui.projectId).name,
    view: state.ui.view,
  }));
  expect(s.names, 'копия — сразу за оригиналом').toEqual(['Сайт', 'Сайт (копия)', 'Другой']);
  expect(s.open).toBe('Сайт (копия)');
  expect(s.view).toBe('project');
});

test('меню «⋯» проекта: без «Редактировать…» и «Статусы и версии» — настройки открывает шестерёнка', async ({ page }) => {
  // 13 октября 2026: у проекта есть кнопка-шестерёнка, дублировать её пунктами
  // меню незачем. На карточке «Проектов» сверху ещё «Открыть».
  const labels = () => page.locator('#ctx-menu .ctx-item .ctx-label').allTextContents();
  await seed(page);
  await page.locator('#project-menu-btn').click();
  expect(await labels()).toEqual([
    'В быстрый доступ', 'Дублировать', 'Скопировать ссылку', 'Скачать Excel', 'Скопировать сводку', 'Удалить проект',
  ]);
  await page.keyboard.press('Escape');
  await page.evaluate(() => openView('projects'));
  await page.locator('.ptile', { hasText: 'Сайт' }).locator('.ptile-menu').click();
  expect(await labels()).toEqual([
    'Открыть', 'В быстрый доступ', 'Дублировать', 'Скопировать ссылку', 'Скачать Excel', 'Скопировать сводку', 'Удалить проект',
  ]);
  await page.keyboard.press('Escape');
  // Шестерёнка видна и на узком вебе: другого входа в настройки проекта нет.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => openProject('p1'));
  await expect(page.locator('#board-statuses')).toBeVisible();
  await page.locator('#board-statuses').click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
});

test('копия проекта: настройки, статусы, версии, теги, задачи и документы — те же, времени нет', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(() => {
    duplicateProject('p1');
    const copy = state.projects.find((p) => p.name === 'Сайт (копия)');
    const own = (rows) => rows.filter((x) => x.projectId === copy.id);
    return {
      project: { color: copy.color, rate: copy.rate, currency: copy.currency, description: copy.description },
      id: copy.id,
      statuses: own(state.statuses).map((x) => x.name),
      origStatuses: state.statuses.filter((x) => x.projectId === 'p1').map((x) => x.name),
      versions: own(state.versions).map((x) => x.name),
      tags: own(state.tags).map((x) => x.name),
      tasks: own(state.tasks).map((x) => ({ title: x.title, done: x.done, sessions: x.sessions.length, ms: x.totalMs, rate: x.rate, due: !!x.dueAt, repeat: !!x.repeat })),
      docs: state.documents.filter((d) => d.projectId === copy.id).map((d) => d.title),
      msCopy: projectMs(copy.id),
      msOrig: projectMs('p1'),
      moneyCopy: projectMoney(copy.id),
      total: state.tasks.length,
    };
  });
  expect(r.project).toEqual({ color: '#87ff65', rate: 1500, currency: 'USD', description: 'Лендинг' });
  expect(r.statuses).toEqual(r.origStatuses);
  expect(r.versions).toEqual(['v1.0']);
  expect(r.tags).toEqual(['Дизайн']);
  expect(r.tasks.map((x) => x.title)).toEqual(['Вёрстка', 'Сдача']);
  expect(r.tasks[0]).toMatchObject({ rate: 2000, due: true, repeat: true, sessions: 0, ms: 0 });
  expect(r.tasks[1], 'выполненная остаётся выполненной').toMatchObject({ done: true, sessions: 0, ms: 0 });
  expect(r.docs).toEqual(['Бриф']);
  expect(r.msCopy, 'часы копии — ноль').toBe(0);
  expect(r.moneyCopy).toBe(0);
  expect(r.msOrig, 'у оригинала часы на месте').toBe(2 * HOUR);
  expect(r.total, 'чужие задачи не размножились: 3 было, 2 добавилось').toBe(5);
});

test('в копии проекта нет ни одной ссылки на статусы, версии и теги проекта оригинала', async ({ page }) => {
  await seed(page);
  const bad = await page.evaluate(() => {
    duplicateProject('p1');
    const copy = state.projects.find((p) => p.name === 'Сайт (копия)');
    const ok = (rows) => new Set(rows.filter((x) => x.projectId === copy.id).map((x) => x.id));
    const statuses = ok(state.statuses);
    const versions = ok(state.versions);
    const tags = new Set([...ok(state.tags), 'g1']);
    const out = [];
    for (const t of state.tasks.filter((x) => x.projectId === copy.id)) {
      if (!statuses.has(t.statusId)) out.push(`${t.title}: статус`);
      if (t.versionId && !versions.has(t.versionId)) out.push(`${t.title}: версия`);
      for (const id of t.tagIds) if (!tags.has(id)) out.push(`${t.title}: тег ${id}`);
    }
    for (const id of copy.tagIds) if (!tags.has(id)) out.push(`проект: тег ${id}`);
    return out;
  });
  expect(bad).toEqual([]);
});

test('колода «Проекты»: меню карточки тоже дублирует, и копия открывается', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openView('projects'));
  await page.locator('.ptile', { hasText: 'Сайт' }).locator('.ptile-menu').click();
  await item(page, 'Дублировать').click();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#ph-name')).toHaveText('Сайт (копия)');
});

test('копия проекта уходит в данные: и на диск, и в то, что шлётся в облако', async ({ page }) => {
  await seed(page);
  const id = await page.evaluate(() => { duplicateProject('p1'); return state.ui.projectId; });
  const payload = await page.evaluate(() => {
    const p = syncPayload();
    return {
      projects: p.projects.map((x) => x.id),
      tasks: p.tasks.filter((x) => x.projectId === state.ui.projectId).length,
      docs: p.documents.filter((x) => x.projectId === state.ui.projectId).length,
      statuses: p.statuses.filter((x) => x.projectId === state.ui.projectId).length,
    };
  });
  expect(payload.projects).toContain(id);
  expect(payload.tasks).toBe(2);
  expect(payload.docs).toBe(1);
  expect(payload.statuses).toBeGreaterThan(0);
  // На диск — тем же путём, что и любая правка; после перезагрузки копия на месте.
  await page.evaluate(() => saveNow());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  const names = await page.evaluate(() => state.projects.map((p) => p.name));
  expect(names).toEqual(['Сайт', 'Сайт (копия)', 'Другой']);
});

test('копия копии проекта: «(копия) (копия)», ничего не ломается', async ({ page }) => {
  await seed(page);
  const names = await page.evaluate(() => {
    duplicateProject('p1');
    duplicateProject(state.ui.projectId);
    return state.projects.map((p) => p.name);
  });
  expect(names).toEqual(['Сайт', 'Сайт (копия)', 'Сайт (копия) (копия)', 'Другой']);
  await expect(page.locator('#ph-name')).toHaveText('Сайт (копия) (копия)');
});

test('суффикс — на языке интерфейса в момент копирования', async ({ page }) => {
  await seed(page);
  const names = await page.evaluate(() => {
    const out = [];
    for (const lang of ['en', 'uk', 'kk']) {
      state.settings.lang = lang;
      duplicateProject('p2');
      out.push(state.projects.find((p) => p.id === state.ui.projectId).name);
    }
    return out;
  });
  expect(names).toEqual(['Другой (copy)', 'Другой (копія)', 'Другой (көшірме)']);
});

// --- задача ---------------------------------------------------------------------

test('строка списка: правый щелчок — меню с «Дублировать»; копия рядом, открыта, без времени', async ({ page }) => {
  await seed(page);
  await page.locator('.task-item[data-id="t1"]').click({ button: 'right' });
  await expect(page.locator('#ctx-menu .ctx-item')).toHaveText(['Закрепить наверх', 'Дублировать', 'Скопировать ссылку', 'Удалить задачу']);
  await expect(item(page, 'Дублировать').locator('svg.ctx-icon')).toHaveCount(1);
  await item(page, 'Дублировать').click();

  await expect(page.locator('#task-view')).toBeVisible();
  await expect(page.locator('#task-title')).toHaveValue('Вёрстка (копия)');
  const s = await page.evaluate(() => {
    const copy = getTask(selectedId);
    return {
      titles: state.tasks.filter((t) => t.projectId === 'p1').map((t) => t.title),
      copy: {
        project: copy.projectId, done: copy.done, doneAt: copy.doneAt ?? null, sessions: copy.sessions.length, ms: copy.totalMs,
        tags: copy.tagIds, version: copy.versionId, rate: copy.rate, due: copy.dueAt, repeat: copy.repeat && copy.repeat.freq,
        status: copy.statusId === getTask('t1').statusId, notes: JSON.stringify(copy.notes) === JSON.stringify(getTask('t1').notes),
        pinned: copy.pinnedAt,
      },
      orig: { sessions: getTask('t1').sessions.length },
    };
  });
  expect(s.titles, 'копия — сразу за оригиналом').toEqual(['Вёрстка', 'Вёрстка (копия)', 'Сдача']);
  expect(s.copy).toMatchObject({
    project: 'p1', done: false, doneAt: null, sessions: 0, ms: 0, tags: ['g1', 'pt1'], version: 'v1', rate: 2000,
    repeat: 'week', status: true, notes: true, pinned: null,
  });
  expect(s.copy.due).toBeTruthy();
  expect(s.orig.sessions, 'у оригинала запись на месте').toBe(1);
  await expect(page.locator('#session-count')).toHaveText('0');
  await expect(page.locator('#task-done-btn'), 'у копии нет «выполнено»').toHaveText('Выполнено');
});

test('карточка доски: «Дублировать» из выполненной даёт открытую копию в статусе по умолчанию', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { state.ui.projectTab = 'board'; render(); });
  await page.locator('.board-card[data-id="t2"]').click({ button: 'right' });
  await item(page, 'Дублировать').click();
  await expect(page.locator('#task-view')).toBeVisible();
  await expect(page.locator('#task-title')).toHaveValue('Сдача (копия)');
  const s = await page.evaluate(() => {
    const copy = getTask(selectedId);
    return { done: copy.done, cancelled: copy.cancelled, kind: getStatus(copy.statusId).kind, first: copy.statusId === orderedStatuses('p1').find((x) => x.kind === 'todo').id, sessions: copy.sessions.length };
  });
  expect(s).toEqual({ done: false, cancelled: false, kind: 'todo', first: true, sessions: 0 });
  await expect(page.locator('#task-done-btn')).toHaveText('Выполнено');
});

test('строка в карточке проекта на «Проектах» — то же меню', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openView('projects'));
  await page.locator('.ptile', { hasText: 'Сайт' }).locator('.ptile-task', { hasText: 'Вёрстка' }).click({ button: 'right' });
  await item(page, 'Дублировать').click();
  await expect(page.locator('#task-title')).toHaveValue('Вёрстка (копия)');
});

test('открытая задача: внизу «Выполнено» и «Удалить» парой, «Дублировать» — в меню «⋯» задачи', async ({ page }) => {
  // С 13 октября 2026 отдельной кнопки «Дублировать» в панели нет: она в меню
  // задачи — том же, что по правой кнопке на строке, — у правого края крошек.
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    await seed(page, viewport);
    await page.evaluate(() => selectTask('t1'));
    const m = await page.evaluate(() => {
      const row = document.querySelector('.task-actions').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.task-actions button')].map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cut: n.scrollWidth > n.clientWidth };
      });
      const more = document.getElementById('task-more').getBoundingClientRect();
      const crumbs = document.querySelector('.task-crumbs').getBoundingClientRect();
      return {
        ids: btns.map((x) => x.id),
        inside: btns.every((x) => x.left >= row.left - 0.5 && x.right <= row.right + 0.5),
        cut: btns.some((x) => x.cut),
        pair: Math.abs(btns[0].top - btns[1].top) < 1 && btns[0].right <= btns[1].left + 0.5,
        moreRight: crumbs.right - more.right,
      };
    });
    const w = viewport.width;
    expect(m.ids).toEqual(['task-done-btn', 'delete-task-btn']);
    expect(m.inside, `${w}: кнопки внутри панели`).toBe(true);
    expect(m.cut, `${w}: подписи не обрезаны`).toBe(false);
    expect(m.pair, `${w}: «Выполнено» и «Удалить» в одном ряду`).toBe(true);
    expect(m.moreRight, `${w}: «⋯» у правого края крошек`).toBeLessThan(12);
  }
  await expect(page.locator('#duplicate-task-btn')).toHaveCount(0);
  await seed(page);
  await page.evaluate(() => selectTask('t1'));
  await page.locator('#task-more').click();
  await expect(page.locator('#ctx-menu .ctx-item .ctx-label')).toHaveText(['Закрепить наверх', 'Дублировать', 'Скопировать ссылку', 'Удалить задачу']);
  // Повторный щелчок по «⋯» закрывает меню.
  await page.locator('#task-more').click();
  await expect(page.locator('#ctx-menu')).toBeHidden();
  await page.locator('#task-more').click();
  await item(page, 'Дублировать').click();
  await expect(page.locator('#task-title')).toHaveValue('Вёрстка (копия)');
});

test('картинки в тексте: копия держит те же ссылки и не теряет их, когда оригинал удалён', async ({ page }) => {
  // Байты картинки лежат по id в общем хранилище и вместе с задачей не
  // стираются; значит, копии достаточно тех же ссылок asset:<id> (см.
  // core/duplicate.js).
  await seed(page);
  await page.evaluate(() => duplicateTask('t1'));
  await page.evaluate(() => { deleteTask('t1'); });
  await page.locator('#confirm-ok').click();
  const r = await page.evaluate(() => {
    const copy = state.tasks.find((t) => t.title === 'Вёрстка (копия)');
    return {
      gone: !state.tasks.some((t) => t.id === 't1'),
      src: copy.notes.lancible.doc.content.find((n) => n.type === 'image').attrs.src,
    };
  });
  expect(r.gone).toBe(true);
  expect(r.src).toBe('asset:img-1');
});

// «Проекты» — ряд больших карточек и таблица недавних задач. Запуск:
// npm run test:e2e
//
// С 9 октября 2026 карточка — как колода на телефоне: шапка (цвет, название,
// «✓ готово/всего» и ближайший дедлайн), время и деньги за всё время,
// прогресс, поле новой задачи, невыполненные задачи со своей прокруткой
// (галочка, мета, плей), внизу «Перейти в проект». Карточки стоят рядом и
// листаются вбок. Ниже — таблица недавних задач, как и была.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((HOUR) => {
    const now = new Date();
    state.settings.hourlyRate = 1000;
    const mk = (id, name, color, pinnedAt = null, desc = '') => {
      state.projects.push({ id, name, color, description: desc, pinnedAt, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65', null, 'Вёрстка лендинга');
    mk('p2', 'Приложение', '#5ec8f2');
    mk('p3', 'Кофейня', '#f5c451', new Date(now.getTime() - HOUR).toISOString());
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (start, end) => ({ start: start.toISOString(), end: end.toISOString(), ms: end - start });
    const add = (id, pid, title, sessions, extra = {}) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('t1', 'p1', 'Вёрстка', [ses(at(9), at(10))], { dueAt: at(18).toISOString() });
    add('t2', 'p2', 'Экран входа', [ses(at(14), at(14, 45))]);
    add('t3', 'p3', 'Логотип', [ses(at(11), at(12))], { done: true });
    add('t4', 'p1', 'Форма', []);
    openView('projects');
  }, HOUR);
}

test('карточки: закреплённые первыми, у каждой время, деньги, прогресс и срок', async ({ page }) => {
  await seed(page);
  const cards = page.locator('.ptile');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.ptile-name')).toHaveText(['Кофейня', 'Сайт', 'Приложение']);
  const site = cards.filter({ hasText: 'Сайт' });
  await expect(site.locator('.ptile-time')).toHaveText('1ч');
  await expect(site.locator('.ptile-money')).toHaveText(/1\s000\s₽/);
  await expect(site.locator('.ptile-count')).toHaveText('0/2');
  await expect(site.locator('.ptile-head .ptile-due')).toHaveText('· сегодня');
  await expect(cards.filter({ hasText: 'Приложение' }).locator('.ptile-head .ptile-due'), 'без дедлайна — без подписи').toHaveCount(0);
  // Готово 1 из 1 — полоса прогресса заполнена целиком.
  const w = await page.evaluate(() => {
    const bar = document.querySelector('.ptile .ptile-progress');
    return bar.querySelector('i').getBoundingClientRect().width / bar.getBoundingClientRect().width;
  });
  expect(w).toBeGreaterThan(0.98);
  await site.locator('.ptile-head').click();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#ph-name')).toHaveText('Сайт');
  await page.evaluate(() => openView('projects'));
  await cards.filter({ hasText: 'Приложение' }).locator('.ptile-open').click();
  await expect(page.locator('#ph-name')).toHaveText('Приложение');
});

test('в карточке — невыполненные задачи, свежие сверху, со статусом, сроком и временем', async ({ page }) => {
  await seed(page);
  const site = page.locator('.ptile', { hasText: 'Сайт' });
  await expect(site.locator('.ptile-task .rl-name')).toHaveText(['Вёрстка', 'Форма']);
  const first = site.locator('.ptile-task').first();
  await expect(first.locator('.ptile-status')).toHaveText('Backlog');
  await expect(first.locator('.ptile-due')).toHaveText('сегодня');
  await expect(first.locator('.task-time')).toHaveText('1ч');
  await expect(site.locator('.ptile-task').nth(1).locator('.task-time'), 'без времени — без нуля').toHaveCount(0);
  const coffee = page.locator('.ptile', { hasText: 'Кофейня' });
  await expect(coffee.locator('.ptile-task'), 'выполненной в карточке нет').toHaveCount(0);
  await expect(coffee.locator('.ptile-empty')).toHaveText('Задач пока нет');
  await first.click();
  expect(await page.evaluate(() => [state.ui.view, selectedId])).toEqual(['task', 't1']);
});

test('плей в карточке запускает таймер и не уводит со страницы; время ползёт', async ({ page }) => {
  await seed(page);
  // Обе задачи сайта менялись час назад: остановка даст «Форме» свежую отметку.
  await page.evaluate(() => {
    for (const id of ['t1', 't4']) getTask(id).updatedAt = new Date(Date.now() - 3_600_000).toISOString();
    render();
  });
  const site = page.locator('.ptile', { hasText: 'Сайт' });
  await site.locator('.ptile-task', { hasText: 'Форма' }).locator('.rl-play').click();
  expect(await page.evaluate(() => [state.activeTimer.taskId, state.ui.view])).toEqual(['t4', 'projects']);
  const row = site.locator('.ptile-task', { hasText: 'Форма' });
  await expect(row).toHaveClass(/\brun\b/);
  await expect(row.locator('.ptile-running')).toHaveText('идёт сейчас');
  await expect(site.locator('.ptile-task .rl-name'), 'запуск не переставляет строки').toHaveText(['Вёрстка', 'Форма']);
  // Часы прибиты (clock.js): «прошла минута» — это старт на минуту раньше;
  // тик раз в 250 мс должен сам переписать числа, без перерисовки.
  await page.evaluate(() => { state.activeTimer.startedAt = new Date(Date.now() - 61_000).toISOString(); });
  await expect(row.locator('.task-time')).toHaveText('1м');
  await expect(site.locator('.ptile-time')).toHaveText('1ч 1м');
  await row.locator('.rl-play').click();
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  await expect(site.locator('.ptile-task .rl-name'), 'остановленная — свежая, уезжает наверх').toHaveText(['Форма', 'Вёрстка']);
});

test('идущая на входе стоит в своей карточке первой', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { startTimer('t4'); openView('home'); openView('projects'); });
  await expect(page.locator('.ptile', { hasText: 'Сайт' }).locator('.ptile-task .rl-name')).toHaveText(['Форма', 'Вёрстка']);
});

test('галочка закрывает задачу, и она уходит из карточки', async ({ page }) => {
  await seed(page);
  const site = page.locator('.ptile', { hasText: 'Сайт' });
  await site.locator('.ptile-task', { hasText: 'Форма' }).locator('.task-done').check();
  expect(await page.evaluate(() => state.ui.view), 'галочка не открывает задачу').toBe('projects');
  await expect(site.locator('.ptile-task .rl-name')).toHaveText(['Вёрстка']);
  expect(await page.evaluate(() => getTask('t4').done)).toBe(true);
  await expect(site.locator('.ptile-count')).toHaveText('1/2');
});

test('поле новой задачи заводит её в этом проекте и открывает её страницу', async ({ page }) => {
  await seed(page);
  const app = page.locator('.ptile', { hasText: 'Приложение' });
  await app.locator('.ptile-qa button').click();
  expect(await page.evaluate(() => state.tasks.length), 'пустое не заводится').toBe(4);
  await app.locator('.ptile-qa-in').fill('  Онбординг ');
  await app.locator('.ptile-qa-in').press('Enter');
  const got = await page.evaluate(() => {
    const task = getTask(selectedId);
    return { view: state.ui.view, title: task.title, projectId: task.projectId, status: task.statusId === defaultStatusId('p2', false) };
  });
  expect(got).toEqual({ view: 'task', title: 'Онбординг', projectId: 'p2', status: true });
  await page.evaluate(() => openView('projects'));
  await expect(app.locator('.ptile-qa-in'), 'поле после создания пустое').toHaveValue('');
  await expect(app.locator('.ptile-task .rl-name').first()).toHaveText('Онбординг');
});

test('перерисовка не теряет набранное, фокус и прокрутку ряда', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => render());
  const app = page.locator('.ptile', { hasText: 'Приложение' });
  await app.locator('.ptile-qa-in').fill('Черно');
  // Ряд встаёт по краю карточки, поэтому сдвиг берём тот, на котором он
  // остановился, и сверяем его до и после перерисовки.
  const before = await page.evaluate(() => { const n = document.getElementById('projects-track'); n.scrollLeft = 332; return n.scrollLeft; });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => render());
  await expect(app.locator('.ptile-qa-in')).toHaveValue('Черно');
  await expect(app.locator('.ptile-qa-in')).toBeFocused();
  expect(await page.evaluate(() => document.getElementById('projects-track').scrollLeft)).toBe(before);
});

test('карточки стоят в ряд одной высоты и листаются стрелками', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      state.projects.push({ id: `px${i}`, name: `Проект ${i}`, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
    }
    render();
  });
  // Размеры раскладки, а не getBoundingClientRect: карточки въезжают с
  // анимацией (scale 0.98), и прямоугольник в её середине меньше настоящего.
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.ptile')]
    .map((n) => ({ top: n.offsetTop, height: n.offsetHeight, width: n.offsetWidth })));
  expect(new Set(boxes.map((b) => b.top)).size, 'одним рядом').toBe(1);
  expect(new Set(boxes.map((b) => b.height)).size, 'одной высоты').toBe(1);
  expect(boxes[0].width).toBe(320);
  expect(boxes[0].height).toBeGreaterThanOrEqual(440);
  const scrollX = () => page.evaluate(() => document.getElementById('projects-track').scrollLeft);
  await expect(page.locator('#deck-prev')).toBeDisabled();
  await page.locator('#deck-next').click();
  await expect.poll(scrollX).toBeGreaterThan(300);
  await expect(page.locator('#deck-prev')).toBeEnabled();
  await page.locator('#deck-prev').click();
  await expect.poll(scrollX).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'страница вбок не едет').toBe(true);
  // Ряд доходит до правого края окна: карточку справа не обрезает в воздухе.
  const edge = await page.evaluate(() => {
    const track = document.getElementById('projects-track').getBoundingClientRect();
    const head = document.querySelector('#projects-view .page-head').getBoundingClientRect();
    const cut = [...document.querySelectorAll('.ptile')].find((n) => n.getBoundingClientRect().right > track.right);
    return { right: track.right, w: innerWidth, head: head.right, cutVisible: cut ? Math.round(innerWidth - cut.getBoundingClientRect().left) : null };
  });
  expect(edge.right, 'ряд — до края окна').toBe(edge.w);
  expect(edge.w - edge.head, 'шапка страницы — с прежним полем').toBeGreaterThanOrEqual(12);
  expect(edge.cutVisible, 'край следующей карточки виден до края окна').toBeGreaterThan(0);
  // В конце ряда последняя карточка встаёт с полем --gap, а не вплотную к краю.
  const end = await page.evaluate(() => {
    const track = document.getElementById('projects-track');
    track.style.scrollSnapType = 'none';
    track.scrollLeft = track.scrollWidth;
    const cards = track.querySelectorAll('.ptile');
    return Math.round(innerWidth - cards[cards.length - 1].getBoundingClientRect().right);
  });
  expect(end).toBe(12);
  await page.evaluate(() => { const track = document.getElementById('projects-track'); track.style.scrollSnapType = ''; track.scrollLeft = 0; });

  // Влезли все — стрелок нет.
  await page.evaluate(() => { state.projects = state.projects.slice(0, 2); render(); });
  await expect(page.locator('#deck-next')).toBeHidden();
});

test('таблица недавних задач: плей в строке запускает таймер, строка открывает задачу', async ({ page }) => {
  await seed(page);
  const rows = page.locator('.recent-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.recent-name')).toHaveText(['Экран входа', 'Вёрстка']);
  await expect(rows.first().locator('.recent-num').first()).toHaveText('45м');
  await rows.first().locator('.rl-play').click();
  expect(await page.evaluate(() => state.activeTimer.taskId)).toBe('t2');
  expect(await page.evaluate(() => state.ui.view), 'плей не уводит со страницы').toBe('projects');
  await expect(rows.first().locator('.recent-when')).toHaveText('идёт сейчас');
  await rows.nth(1).click();
  expect(await page.evaluate(() => [state.ui.view, selectedId])).toEqual(['task', 't1']);
});

// Пустой экран (9 октября 2026): по центру картинка пустой карточки,
// «У вас пока нет проектов», пояснение и единственная акцентная кнопка —
// кнопка в шапке на это время прячется.
for (const scheme of ['dark', 'light']) {
  test(`${scheme}: без проектов — пустой экран по центру с одной кнопкой «Создать проект»`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await pinClock(page);
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => openView('projects'));
    const empty = page.locator('#home-empty');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.empty-state-title')).toHaveText('У вас пока нет проектов');
    await expect(empty.locator('.es-art')).toBeVisible();
    await expect(page.locator('#recent-section')).toBeHidden();
    await expect(page.locator('#create-project-btn'), 'в шапке кнопки нет — она по центру').toBeHidden();
    await expect(page.locator('#projects-view .btn-accent:visible')).toHaveCount(1);
    await expect(page.locator('#projects-view')).toHaveClass(/\bsettled\b/);
    const m = await page.evaluate(() => {
      const view = document.getElementById('projects-view').getBoundingClientRect();
      const head = document.querySelector('#projects-view .page-head').getBoundingClientRect();
      const box = document.querySelector('#home-empty').getBoundingClientRect();
      const card = getComputedStyle(document.querySelector('.es-front')).backgroundColor;
      const probe = document.createElement('div');
      probe.style.background = 'var(--panel)';
      document.body.appendChild(probe);
      const panelColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        dx: Math.abs((box.left + box.right) / 2 - (view.left + view.right - 12) / 2),
        dy: Math.abs((box.top + box.bottom) / 2 - (head.bottom + view.bottom) / 2),
        card, panelColor,
      };
    });
    expect(m.dx, 'по центру по горизонтали').toBeLessThanOrEqual(2);
    expect(m.dy, 'по центру по вертикали под шапкой').toBeLessThanOrEqual(16);
    expect(m.card, 'картинка — из токенов темы').toBe(m.panelColor);

    await empty.locator('#home-empty-create').click();
    await expect(page.locator('#pdlg-backdrop')).toBeVisible();
    await page.locator('#pdlg-name').fill('Первый');
    await page.locator('#pdlg-save').click();
    await page.evaluate(() => openView('projects'));
    await expect(empty, 'проект есть — пустого экрана нет').toBeHidden();
    await expect(page.locator('#create-project-btn')).toBeVisible();
    await expect(page.locator('.ptile')).toHaveCount(1);
  });
}

// Закреп — не булавкой на карточке, а пунктом меню: закреплённый проект
// встаёт в левое меню своей группой «Быстрый доступ», над остальными.
test('закрепление — из меню карточки, закреплённые — группой «Быстрый доступ» в левом меню', async ({ page }) => {
  await seed(page);
  await expect(page.locator('.ptile .ptile-pin'), 'булавки на карточке нет').toHaveCount(0);
  const quick = page.locator('#nav-pinned .nav-pname');
  const rest = page.locator('#nav-projects .nav-pname');
  await expect(page.locator('#nav-pinned-head')).toBeVisible();
  await expect(page.locator('#nav-pinned-head')).toContainText('Быстрый доступ');
  await expect(page.locator('#nav-pinned-head svg.icon'), 'у группы — значок закрепления').toBeVisible();
  await expect(quick).toHaveText(['Кофейня']);
  await expect(rest).toHaveText(['Сайт', 'Приложение']);

  const menu = async (name, item) => {
    const card = page.locator('.ptile', { hasText: name });
    await card.hover();
    await card.locator('.ptile-menu').click();
    await page.locator('#ctx-menu .ctx-item', { hasText: item }).click();
  };
  await menu('Сайт', 'В быстрый доступ');
  await expect(quick, 'в порядке закрепления').toHaveText(['Кофейня', 'Сайт']);
  await expect(rest).toHaveText(['Приложение']);

  await menu('Кофейня', 'Убрать из быстрого доступа');
  await menu('Сайт', 'Убрать из быстрого доступа');
  await expect(page.locator('#nav-pinned-head'), 'нечего показать — группы нет').toBeHidden();
  await expect(rest, 'вернулись к остальным, в порядке проектов').toHaveText(['Сайт', 'Приложение', 'Кофейня']);
});

test('узкий веб — колода, как на телефоне: карточка во всю ширину, край следующей виден', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => render());
  // Меряем после въезда: карточки появляются с анимацией (scale 0.98).
  await expect(page.locator('#projects-view')).toHaveClass(/\bsettled\b/);
  const got = await page.evaluate(() => {
    const track = document.getElementById('projects-track');
    const second = track.querySelectorAll('.ptile')[1];
    return {
      peek: Math.round(innerWidth - second.getBoundingClientRect().left),
      snap: getComputedStyle(track).scrollSnapType,
      pageX: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  expect(got.peek, 'от следующей карточки видно 40 px — до края экрана').toBe(40);
  expect(got.snap).toBe('x mandatory');
  expect(got.pageX, 'страница вбок не едет').toBe(true);
  await expect(page.locator('#deck-prev')).toBeHidden();
  await expect(page.locator('#deck-next')).toBeHidden();
  await expect(page.locator('.ptile').first().locator('.ptile-menu'), 'меню без наведения видно').toHaveCSS('opacity', '1');
});

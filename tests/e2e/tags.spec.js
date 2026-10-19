// Теги: создание, назначение, показ и удаление. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
});

/** Проект с тремя задачами. Через интерфейс это десяток кликов, а нам нужен
 *  не он, а то, что происходит с тегами дальше. */
async function seedProject(page) {
  return page.evaluate(() => {
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт клиента', color: '#87ff65', description: 'Лендинг',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    const cols = orderedStatuses(pid);
    for (const [i, title] of ['Свёрстать главную', 'Подключить оплату', 'Проверить'].entries()) {
      state.tasks.push({
        id: uid(), projectId: pid, title, done: false, notes: null, totalMs: 0, sessions: [],
        rate: null, pinnedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        statusId: cols[i + 1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    }
    state.ui.projectId = pid;
    state.ui.boardProjectId = pid;
    render();
    return pid;
  });
}

async function openSettings(page) {
  await page.evaluate(() => openSettings('work')); // теги — в разделе «Работа»
  await expect(page.locator('#tags-list')).toBeVisible();
}

async function createTag(page, name) {
  await openSettings(page);
  await page.locator('#tags-add').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await page.locator('#tagdlg-name').fill(name);
  await page.locator('#tagdlg-save').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeHidden();
}

test('пустой список объясняет, что такое теги, а не молчит', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#tags-list .tags-empty')).toContainText('видны во всех проектах');
});

test('тег создаётся и появляется в списке с пометкой, что он не используется', async ({ page }) => {
  await createTag(page, 'Срочное');
  const row = page.locator('#tags-list .srow');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Срочное');
  await expect(row).toContainText('не используется');
});

test('тег с занятым именем не создаётся, и причина названа', async ({ page }) => {
  await createTag(page, 'Срочное');
  await page.locator('#tags-add').click();
  // Регистр и краевые пробелы не должны обманывать проверку.
  await page.locator('#tagdlg-name').fill('  срочное  ');
  await page.locator('#tagdlg-save').click();

  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tagdlg-error')).toBeVisible();
  await expect(page.locator('#tagdlg-error')).toContainText('уже есть');
  expect(await page.evaluate(() => state.tags.length)).toBe(1);
});

test('тег вешается на задачу через пикер и снимается крестиком', async ({ page }) => {
  await seedProject(page);
  await createTag(page, 'Срочное');
  await createTag(page, 'Дизайн');

  await page.evaluate(() => {
    const task = state.tasks[0];
    selectTask(task.id);
  });
  await expect(page.locator('#task-props')).toBeVisible();

  await page.locator('#task-tags-add').click();
  await expect(page.locator('.tag-pop')).toBeVisible();
  await page.locator('.tag-pop-item').nth(0).click();
  await page.locator('.tag-pop-item').nth(1).click();
  // Выбранное помечено, а не залито: заливка спорила бы с наведением.
  await expect(page.locator('.tag-pop-item.sel')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(page.locator('#task-tags .tag-chip')).toHaveCount(2);

  // Значок удаления виден по наведению на чип — как и пользователь,
  // сначала подводим мышь к чипу.
  const first = page.locator('#task-tags .tag-chip').first();
  await first.hover();
  await first.locator('.tag-chip-x').click();
  await expect(page.locator('#task-tags .tag-chip')).toHaveCount(1);
  expect(await page.evaluate(() => state.tasks[0].tagIds.length)).toBe(1);
});

test('в пикере ищут по имени и оттуда же заводят новый тег', async ({ page }) => {
  await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate(() => {
    selectTask(state.tasks[0].id);
  });

  await page.locator('#task-tags-add').click();
  await page.locator('.tag-pop-search').fill('сроч');
  await expect(page.locator('.tag-pop-item')).toHaveCount(1);

  // «Бэклог» не совпадает ни с чем — значит, его предлагают создать.
  await page.locator('.tag-pop-search').fill('Бэклог');
  await expect(page.locator('.tag-pop-create')).toContainText('Бэклог');
  await page.locator('.tag-pop-create').click();

  // Окно создания открывается с уже подставленным именем.
  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tagdlg-name')).toHaveValue('Бэклог');
  await page.locator('#tagdlg-save').click();

  await expect(page.locator('#task-tags .tag-chip')).toContainText('Бэклог');
  expect(await page.evaluate(() => state.tags.length)).toBe(2);
});

test('теги проекта сохраняются только по кнопке сохранения', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');

  await page.evaluate((id) => openProjectDialog(getProject(id)), pid);
  await page.locator('#pdlg-tags-add').click();
  await page.locator('.tag-pop-item').first().click();
  // Гасим пикер нажатием на заголовок окна: клик в угол экрана попал бы по
  // подложке, а она закрывает и само окно проекта.
  await page.locator('#pdlg-title').click();
  await expect(page.locator('#pdlg-tags .tag-chip')).toHaveCount(1);

  await page.locator('#pdlg-cancel').click();
  expect(await page.evaluate((id) => getProject(id).tagIds.length, pid), 'отмена не должна сохранять').toBe(0);

  await page.evaluate((id) => openProjectDialog(getProject(id)), pid);
  await page.locator('#pdlg-tags-add').click();
  await page.locator('.tag-pop-item').first().click();
  await page.locator('#pdlg-title').click();
  await page.locator('#pdlg-save').click();
  expect(await page.evaluate((id) => getProject(id).tagIds.length, pid)).toBe(1);
});

test('чипы показываются там, где договорились, и нигде больше', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate((id) => {
    const tag = state.tags[0];
    getProject(id).tagIds = [tag.id];
    state.tasks[0].tagIds = [tag.id];
    render();
  }, pid);

  // Шапка проекта — да, список задач в боковой панели — нет.
  await page.evaluate(() => { state.ui.view = 'project'; render(); });
  await expect(page.locator('#ph-tags .tag-chip')).toHaveCount(1);
  await expect(page.locator('#task-list .tag-chip')).toHaveCount(0);

  // Карточка доски — да.
  await page.evaluate(() => { state.ui.view = 'board'; renderBoardPage(); render(); });
  await expect(page.locator('.board-card .tag-chip')).toHaveCount(1);

  // Плитка проекта на главной — нет.
  await page.evaluate(() => { state.ui.view = 'home'; render(); });
  await page.evaluate(() => openView('projects'));
  await expect(page.locator('.ptile .tag-chip')).toHaveCount(0);
});

test('удаление тега предупреждает, скольких оно коснётся, и отвязывает его', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate((id) => {
    const tag = state.tags[0];
    getProject(id).tagIds = [tag.id];
    state.tasks[0].tagIds = [tag.id];
    state.tasks[1].tagIds = [tag.id];
    render();
  }, pid);

  await openSettings(page);
  await expect(page.locator('#tags-list .srow')).toContainText('проектов: 1');
  await expect(page.locator('#tags-list .srow')).toContainText('задач: 2');

  await page.locator('#tags-list .srow').click();
  await page.locator('#tagdlg-delete').click();
  await expect(page.locator('#confirm-text')).toContainText('проектов: 1 · задач: 2');

  // Отмена ничего не удаляет.
  await page.locator('#confirm-cancel').click();
  expect(await page.evaluate(() => state.tags.length)).toBe(1);

  await page.locator('#tagdlg-delete').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeHidden();

  const after = await page.evaluate((id) => ({
    tags: state.tags.length,
    project: getProject(id).tagIds.length,
    tasks: state.tasks.reduce((a, t) => a + t.tagIds.length, 0),
  }), pid);
  expect(after).toEqual({ tags: 0, project: 0, tasks: 0 });
});

test('бейдж красится цветом тега и читается в обеих темах', async ({ page }) => {
  // Тонированный бейдж — первое, что ломается при смене темы: яркий цвет,
  // годный на тёмном фоне, на белом превращается в невидимку. Проверяем не
  // «красиво», а измеримое — контраст надписи к подложке карточки.
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await createTag(page, 'Бэкенд');
  await page.evaluate((id) => {
    state.tags[0].color = '#f0736b';
    state.tags[1].color = '#f5c451';
    state.tasks[0].tagIds = state.tags.map((t) => t.id);
    state.ui.view = 'board';
    state.ui.boardProjectId = id;
    renderBoardPage();
    render();
  }, pid);

  const chips = page.locator('.board-card .tag-chip');
  await expect(chips).toHaveCount(2);
  // Цвет несёт подложка, отдельной точке внутри бейджа делать нечего.
  await expect(page.locator('.board-card .tag-chip .tag-dot')).toHaveCount(0);

  const measure = (theme) => page.evaluate((th) => {
    state.settings.theme = th;
    applyTheme();
    const parse = (s) => {
      const m = s.match(/[\d.]+/g).map(Number);
      return s.startsWith('color(') ? m.slice(0, 3) : m.slice(0, 3).map((v) => v / 255);
    };
    const lum = (rgb) => {
      const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const card = parse(getComputedStyle(document.querySelector('.board-card')).backgroundColor.replace('rgba', 'rgb'));
    return [...document.querySelectorAll('.board-card .tag-chip')].map((c) => {
      const ink = parse(getComputedStyle(c).color);
      const [a, b] = [lum(ink), lum(card)];
      return { color: getComputedStyle(c).color, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  }, theme);

  for (const theme of ['dark', 'light']) {
    const got = await measure(theme);
    expect(new Set(got.map((c) => c.color)).size, `в теме ${theme} бейджи одного цвета`).toBe(2);
    for (const c of got) {
      expect(c.contrast, `в теме ${theme} контраст надписи всего ${c.contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('у неиспользуемого тега удаление не пугает лишними подробностями', async ({ page }) => {
  await createTag(page, 'Черновик');
  await page.locator('#tags-list .srow').click();
  await page.locator('#tagdlg-delete').click();
  await expect(page.locator('#confirm-text')).toHaveText('Удалить тег «Черновик»?');
});

test('пикер тегов в окне проекта не ложится на его кнопки', async ({ page }) => {
  // 7 октября 2026: список открывался вниз от «+» и накрывал «Отмена» и
  // «Сохранить». Внутри окна край — низ самого окна: не помещается снизу —
  // открывается вверх.
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate((id) => openProjectDialog(getProject(id)), pid);
  await page.locator('#pdlg-tags-add').click();
  const m = await page.evaluate(() => {
    const pop = document.querySelector('.tag-pop').getBoundingClientRect();
    const modal = document.querySelector('#pdlg-backdrop .modal').getBoundingClientRect();
    const buttons = document.querySelector('#pdlg-backdrop .modal-buttons').getBoundingClientRect();
    return { popBottom: pop.bottom, popTop: pop.top, modalBottom: modal.bottom, buttonsTop: buttons.top };
  });
  expect(m.popBottom, 'список внутри окна').toBeLessThanOrEqual(m.modalBottom);
  expect(m.popBottom, 'и не поверх кнопок').toBeLessThanOrEqual(m.buttonsTop + 1);
  expect(m.popTop).toBeGreaterThanOrEqual(0);
});

test('поля плашки слева и справа равны — везде, где плашки рисуются', async ({ page }) => {
  // Невидимый крестик у чипа с onRemove занимал 13 px справа от названия:
  // «Cool Project» сидел в плашке сдвинутым влево. Меряется текст внутри
  // плашки, а не сама плашка: поле — это расстояние от её края до букв.
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedProject(page);
  await page.evaluate(() => {
    const mk = (name, color, projectId) => { const tag = { id: uid(), name, color, projectId: projectId || null }; state.tags.push(tag); return tag.id; };
    const a = mk('Cool Project', '#5ec8f2');
    const b = mk('Some Tag', '#f5c451');
    const c = mk('Ещё', '#87ff65');
    const p = state.projects[0];
    p.tagIds = [a, b];
    state.tasks[0].tagIds = [a, b, c];
    state.ui.projectId = p.id;
    state.ui.boardProjectId = p.id;
    state.ui.view = 'project';
    state.ui.projectTab = 'board';
    render();
  });

  // Поля плашек в выбранном месте: [{ text, left, right }].
  const pads = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((chip) => chip.getBoundingClientRect().width > 0)
    .map((chip) => {
      const box = chip.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(chip.querySelector('.tag-name') || chip);
      const text = range.getBoundingClientRect();
      return { text: chip.textContent.trim(), left: text.left - box.left, right: box.right - text.right };
    }), sel);
  const equal = (list, where) => {
    expect(list.length, `${where}: плашки нашлись`).toBeGreaterThan(0);
    for (const p of list) {
      expect(Math.abs(p.left - p.right), `${where}, «${p.text}»: слева ${p.left}, справа ${p.right}`).toBeLessThanOrEqual(1);
      expect(p.left, `${where}, «${p.text}»: поле не нулевое`).toBeGreaterThan(3);
    }
  };

  equal(await pads('.board-card .tag-chip'), 'карточка доски');
  equal(await pads('#ph-tags .tag-chip'), 'шапка проекта');

  // С крестиком: чип задачи в свойствах и чип в окне проекта.
  await page.evaluate(() => selectTask(state.tasks[0].id));
  await expect(page.locator('#task-tags .tag-chip-x').first()).toBeAttached();
  equal(await pads('#task-tags .tag-chip'), 'свойства задачи');

  await page.evaluate(() => { state.ui.view = 'project'; render(); openProjectDialog(state.projects[0]); });
  await expect(page.locator('#pdlg-tags .tag-chip').first()).toBeVisible();
  equal(await pads('#pdlg-tags .tag-chip'), 'окно проекта');
});

test('значок удаления лежит поверх угла плашки: размер не меняется, виден по наведению и фокусу', async ({ page }) => {
  // До 11 октября крестик в покое был шириной 0 и раскрывался по наведению:
  // плашка дёргалась, а сам значок на 9 px выглядел кривым. Теперь значок —
  // круг поверх правого верхнего угла, а плашка не меняется никогда.
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedProject(page);
  await createTag(page, 'Cool Project');
  await page.evaluate(() => {
    state.tasks[0].tagIds = state.tags.map((tg) => tg.id);
    state.ui.view = 'project';
    state.ui.projectTab = 'board';
    render();
    selectTask(state.tasks[0].id);
  });

  const chip = page.locator('#task-tags .tag-chip').first();
  const x = chip.locator('.tag-chip-x');
  await expect(chip).toBeVisible();
  await expect(x).toHaveAttribute('aria-label', 'Удалить тег');

  const box = () => chip.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { w: r.width, h: r.height, pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight) };
  });
  const opacity = () => x.evaluate((n) => Number(getComputedStyle(n).opacity));

  const rest = await box();
  expect(Math.abs(rest.pl - rest.pr), 'поля плашки равны в покое').toBeLessThanOrEqual(1);
  expect(await opacity(), 'в покое значка не видно').toBe(0);

  await chip.hover();
  await expect.poll(opacity, { message: 'по наведению значок виден' }).toBe(1);
  const hover = await box();
  expect(hover.w, 'ширина плашки по наведению не изменилась').toBeCloseTo(rest.w, 1);
  expect(hover.h, 'высота плашки по наведению не изменилась').toBeCloseTo(rest.h, 1);
  expect(Math.abs(hover.pl - hover.pr), 'поля равны и по наведению').toBeLessThanOrEqual(1);

  // Круг лежит на правом верхнем углу плашки, иконка — по центру круга.
  const geo = await page.evaluate(() => {
    const c = document.querySelector('#task-tags .tag-chip').getBoundingClientRect();
    const b = document.querySelector('#task-tags .tag-chip-x');
    const r = b.getBoundingClientRect();
    const i = b.querySelector('.icon').getBoundingClientRect();
    return {
      round: getComputedStyle(b).borderRadius, w: r.width, h: r.height,
      cornerDx: (r.left + r.width / 2) - c.right, cornerDy: (r.top + r.height / 2) - c.top,
      iconDx: (i.left + i.width / 2) - (r.left + r.width / 2), iconDy: (i.top + i.height / 2) - (r.top + r.height / 2),
      icon: i.width,
    };
  });
  expect(geo.w).toBeCloseTo(geo.h, 1);
  expect(geo.round, 'значок круглый').toMatch(/^(50%|\d{2,}px)$/);
  expect(Math.abs(geo.cornerDx), 'центр круга у правого края плашки').toBeLessThanOrEqual(8);
  expect(Math.abs(geo.cornerDy), 'центр круга у верхнего края плашки').toBeLessThanOrEqual(8);
  expect(Math.abs(geo.iconDx) + Math.abs(geo.iconDy), 'иконка по центру круга').toBeLessThanOrEqual(1);
  expect(geo.icon, 'иконка в тон тексту, а не крупнее его').toBeLessThanOrEqual(12);

  // Клавиатура: убрали мышь — значок гаснет, фокус на нём его показывает.
  await page.mouse.move(5, 5);
  await expect.poll(opacity, { message: 'без наведения значок скрыт' }).toBe(0);
  await x.focus();
  await expect.poll(opacity, { message: 'по фокусу значок виден' }).toBe(1);
  expect((await box()).w, 'и по фокусу плашка не меняется').toBeCloseTo(rest.w, 1);

  // И снимает тег с клавиатуры (мышью — в тесте про пикер выше).
  await page.keyboard.press('Enter');
  await expect(page.locator('#task-tags .tag-chip')).toHaveCount(0);
  expect(await page.evaluate(() => state.tasks[0].tagIds.length)).toBe(0);
});

test('пикер тегов: подпись «общий» и галочка — колонками у правого края, у всех строк на одной линии', async ({ page }) => {
  // 13 октября 2026: подпись стояла сразу за именем, и у строк с длинным и
  // коротким именем «общий» и галочка гуляли. Теперь строка — сетка: точка ·
  // имя · подпись (колонка постоянной ширины, текст по правому краю) · галочка.
  await seedProject(page);
  const pid = await page.evaluate(() => {
    const p = state.projects[0];
    state.tags.push(
      { id: 'g1', name: 'Срочное', color: '#ff5a5a', projectId: null },
      { id: 'g2', name: 'Очень длинное название общего тега', color: '#5ec8f2', projectId: null },
      { id: 'p1', name: 'Макет', color: '#c084fc', projectId: p.id },
    );
    state.tasks[0].tagIds = ['g1', 'p1'];
    selectTask(state.tasks[0].id);
    return p.id;
  });
  expect(pid).toBeTruthy();
  await page.locator('#task-tags-add').click();
  await expect(page.locator('.tag-pop-item')).toHaveCount(3);
  const m = await page.evaluate(() => [...document.querySelectorAll('.tag-pop-item')].map((row) => {
    const scope = row.querySelector('.tag-pop-scope');
    const s = scope.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(scope);
    const text = range.getBoundingClientRect();
    const after = getComputedStyle(row, '::after');
    return {
      name: row.querySelector('.tag-pop-name').textContent,
      scopeText: scope.textContent, scopeLeft: Math.round(s.left), scopeRight: Math.round(s.right),
      textRight: text.width ? Math.round(text.right) : null, checked: after.content.includes('✓'),
      rowRight: Math.round(row.getBoundingClientRect().right),
    };
  }));
  const byName = Object.fromEntries(m.map((r) => [r.name, r]));
  expect(byName['Срочное'].scopeText).toBe('общий');
  expect(byName['Макет'].scopeText, 'у тега проекта подписи нет').toBe('');
  expect(new Set(m.map((r) => r.scopeLeft)).size, 'колонка подписи у всех строк одна').toBe(1);
  expect(new Set(m.map((r) => r.scopeRight)).size).toBe(1);
  for (const r of m.filter((x) => x.textRight != null)) expect(r.scopeRight - r.textRight, `${r.name}: «общий» по правому краю`).toBeLessThanOrEqual(1);
  expect(m.filter((r) => r.checked).map((r) => r.name).sort()).toEqual(['Макет', 'Срочное']);
  // Колонка галочки справа от подписи, длинное имя её не сдвигает.
  for (const r of m) expect(r.rowRight - r.scopeRight, `${r.name}: место под галочку`).toBeGreaterThanOrEqual(12);
});

test('окно «Новый тег»: поле названия — общее (.field), как в окне проекта', async ({ page }) => {
  // 13 октября 2026: поле стояло голым системным input, без нашей подложки и
  // скругления.
  await openSettings(page);
  await page.locator('#tags-add').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  const field = page.locator('#tagdlg-name');
  await expect(field).toHaveClass(/\bfield\b/);
  // Окно въезжает (popIn, scale 0.96 → 1): на лету рамки окна и поля
  // сжаты, а отступы из стилей — нет, и «во всю ширину» не сходится на ~1 px.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const m = await page.evaluate(() => {
    const probe = document.createElement('input');
    probe.className = 'field';
    document.body.appendChild(probe);
    const pick = (n) => { const cs = getComputedStyle(n); return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, pad: cs.paddingLeft, font: cs.fontSize }; };
    const want = pick(probe);
    probe.remove();
    const input = document.getElementById('tagdlg-name');
    const modal = input.closest('.modal');
    const mr = modal.getBoundingClientRect();
    const ms = getComputedStyle(modal);
    const ir = input.getBoundingClientRect();
    return { got: pick(input), want, fills: Math.abs((mr.width - parseFloat(ms.paddingLeft) - parseFloat(ms.paddingRight)) - ir.width) };
  });
  expect(m.got).toEqual(m.want);
  expect(m.fills, 'поле во всю ширину окна').toBeLessThanOrEqual(1);
});

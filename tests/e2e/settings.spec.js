// Настройки по разделам. Запуск: npm run test:e2e
//
// Откуда тест (17 октября 2026, пункт 14 круга): настройки веба и десктопа
// были одной страницей — два десятка строк в сетке островов. Стало как меню
// телефона: страница «Настройки» — профиль и строки-разделы (Основное,
// Работа, Аккаунт, Данные, О приложении, Обратная связь), каждая открывает
// свою страницу со своим адресом (#/settings/<раздел>), стрелка «назад» —
// тот же шаг, что «назад» браузера.
//
// 19 октября 2026 (круг 21): строки «Аккаунт» в списке нет — её дублировал
// верхний блок профиля; теперь он сам открывает раздел «Аккаунт» (справа
// шеврон), гостю — вход.
//
// Здесь — порядок и вид строк, адреса и история, содержимое разделов, вход
// и гость, переводы, вёрстка на 1280 и 375. Режимы — modes.spec.js, форма
// отзыва — feedback.spec.js.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Разделы — все страницы; ROWS — строки списка (без «Аккаунта»: его
 *  открывает верхний блок). */
const SECTIONS = ['main', 'work', 'account', 'data', 'about', 'feedback'];
const ROWS = SECTIONS.filter((x) => x !== 'account');
const TITLES = {
  ru: ['Основное', 'Работа', 'Аккаунт', 'Данные', 'О приложении', 'Обратная связь'],
  en: ['General', 'Work', 'Account', 'Data', 'About', 'Feedback'],
  uk: ['Основне', 'Робота', 'Акаунт', 'Дані', 'Про застосунок', 'Зворотний зв’язок'],
  kk: ['Негізгі', 'Жұмыс', 'Аккаунт', 'Деректер', 'Қосымша туралы', 'Кері байланыс'],
};
const rowTitles = (lang) => TITLES[lang].filter((_, i) => SECTIONS[i] !== 'account');

const hashOf = (page) => page.evaluate(() => location.hash);
/** Номер записи истории, на которой стоит приложение (app.js, lcbIdx). */
const historyIdx = (page) => page.evaluate(() => history.state && history.state.lcbIdx);
/** Видимая страница настроек: 'root' или имя раздела; не настройки — пусто. */
const shownPage = (page) => page.evaluate(() => {
  if (document.getElementById('settings-view').hidden) return [];
  const pages = [...document.querySelectorAll('#settings-view .settings-page')].filter((p) => !p.hidden);
  return pages.map((p) => p.dataset.section || 'root');
});

/** Чистая вкладка; hash — открыть сразу по ссылке, как из новой вкладки:
 *  назад из неё некуда. */
async function start(page, hash = '') {
  await pinClock(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/index.html');
  await page.evaluate((h) => { localStorage.clear(); history.replaceState(null, '', h || location.pathname); }, hash);
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
}
const openSettings = (page) => page.locator('#navrail .nav-item[data-view="settings"]').click();

test('список разделов: пять строк в порядке телефона, у каждой значок, название, сводка и шеврон', async ({ page }) => {
  await start(page);
  await openSettings(page);
  expect(await shownPage(page)).toEqual(['root']);
  expect(await hashOf(page)).toBe('#/settings');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#settings-sections > .srow')].map((r) => ({
    section: r.dataset.section,
    label: r.querySelector('.srow-label').textContent,
    icon: !!r.querySelector(':scope > svg.icon[data-icon]'),
    chev: !!r.querySelector('.srow-chev'),
    value: !!r.querySelector('.srow-value'),
    height: Math.round(r.getBoundingClientRect().height),
  })));
  expect(rows.map((r) => r.section)).toEqual(ROWS);
  expect(rows.map((r) => r.label)).toEqual(rowTitles('ru'));
  for (const r of rows) {
    expect(r.icon && r.chev && r.value, `${r.section}: значок, сводка и шеврон`).toBe(true);
    expect(r.height, `${r.section}: высота строки`).toBe(44);
  }
  // Сводка: язык и режим, валюта, версия.
  await expect(page.locator('#settings-sec-main-value')).toHaveText('Русский · Фрилансер');
  await expect(page.locator('#settings-sec-work-value')).toHaveText(/₽/);
  await expect(page.locator('#settings-sec-about-value')).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(page.locator('#settings-sec-account'), 'строки «Аккаунт» нет — её открывает верхний блок').toHaveCount(0);
  // Верхний блок гостя — «Гость» и шеврон; системных <select> нет нигде.
  await expect(page.locator('#settings-profile .settings-profile-name')).toHaveText('Гость');
  await expect(page.locator('#settings-profile svg.srow-chev')).toHaveCount(1);
  expect(await page.locator('#settings-view select').count()).toBe(0);
  expect(await page.locator('#settings-view select').count()).toBe(0);
  // Строки списка — общая деталь (.sgroup › .srow), остров страницы — --panel.
  const bg = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--panel)';
    document.body.append(probe);
    const panel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { panel, group: getComputedStyle(document.getElementById('settings-sections')).backgroundColor };
  });
  expect(bg.group).toBe(bg.panel);
});

test('каждая строка открывает свою страницу и адрес; «назад» — в список тем же шагом истории', async ({ page }) => {
  await start(page);
  await openSettings(page);
  for (const [i, section] of SECTIONS.entries()) {
    const before = await historyIdx(page);
    // «Аккаунт» открывает верхний блок (у вошедшего), остальные — строки.
    if (section === 'account') await page.evaluate(() => { currentUser = { id: 'u1', email: 'turan@example.com', name: 'Turan' }; render(); });
    await page.locator(section === 'account' ? '#settings-profile' : `#settings-sec-${section}`).click();
    if (section === 'account') await page.evaluate(() => { currentUser = null; });
    expect(await shownPage(page)).toEqual([section]);
    expect(await hashOf(page)).toBe(`#/settings/${section}`);
    expect(await historyIdx(page), `${section}: вход в раздел — новый шаг`).toBe(before + 1);
    const pageNode = page.locator(`#settings-page-${section}`);
    await expect(pageNode.locator('.page-title')).toHaveText(TITLES.ru[i]);
    await expect(page).toHaveTitle(`${TITLES.ru[i]} — Lancible`);
    await pageNode.locator('.settings-back').click();
    expect(await shownPage(page)).toEqual(['root']);
    expect(await hashOf(page)).toBe('#/settings');
    expect(await historyIdx(page), `${section}: стрелка — шаг назад, а не вперёд`).toBe(before);
    await expect(page).toHaveTitle('Настройки — Lancible');
  }
  // «Вперёд» браузера возвращает в последний раздел.
  await page.goForward();
  expect(await shownPage(page)).toEqual(['feedback']);
  await page.goBack();
  expect(await shownPage(page)).toEqual(['root']);
});

test('ссылка прямо в раздел открывает его после перезагрузки; назад некуда — стрелка ведёт в список', async ({ page }) => {
  await start(page, '#/settings/work');
  await expect(page.locator('#settings-view')).toBeVisible();
  expect(await shownPage(page)).toEqual(['work']);
  await page.reload();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  expect(await shownPage(page)).toEqual(['work']);
  await page.locator('#settings-page-work .settings-back').click();
  expect(await shownPage(page)).toEqual(['root']);
  expect(await hashOf(page)).toBe('#/settings');
  // Незнакомый раздел — список.
  await page.evaluate(() => { location.hash = '#/settings/нет-такого'; });
  await expect.poll(() => shownPage(page)).toEqual(['root']);
});

test('«Настройки» в рейле из раздела — список, а не последний раздел', async ({ page }) => {
  await start(page);
  await openSettings(page);
  await page.locator('#settings-sec-about').click();
  await page.locator('#navrail .nav-item[data-view="home"]').click();
  await openSettings(page);
  expect(await shownPage(page)).toEqual(['root']);
  // А «назад» браузера с «Сегодня» — в тот раздел, где стояли.
  await page.goBack();
  await page.goBack();
  expect(await shownPage(page)).toEqual(['about']);
});

test('Основное: язык, тема и режим; уведомления отдельной группой', async ({ page }) => {
  await start(page, '#/settings/main');
  const p = page.locator('#settings-page-main');
  await expect(p.locator('#settings-lang-row .srow-value')).toHaveText('Русский');
  await expect(p.locator('.theme-tabs.segmented > button.theme-tab')).toHaveCount(3);
  await expect(p.locator('#settings-mode > button')).toHaveText(['Фрилансер', 'Личное']);
  await expect(p.locator('#settings-mode > button.on')).toHaveText('Фрилансер');
  await expect(p.locator('#settings-mode-hint')).toHaveText('Ставки, суммы и заработок — в задачах, проектах и отчётах.');
  await expect(p.locator('.sgroup-label')).toHaveText(['Уведомления']);
  await expect(p.locator('#settings-notif-toggle')).toHaveAttribute('aria-pressed', 'true');
  // Язык — тем же списком, что был (.ctx-menu), а не системным окном.
  await p.locator('#settings-lang-row').click();
  await expect(page.locator('#ctx-menu .ctx-item')).toHaveCount(4);
  await page.locator('#ctx-menu .ctx-item', { hasText: 'English' }).click();
  await expect(p.locator('.page-title')).toHaveText('General');
  await expect(page).toHaveTitle('General — Lancible');
  // Тема переключается тут же.
  await p.locator('.theme-tab[data-theme="dark"]').click();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
});

test('Работа: ставка, валюта, таймер, заработок, рабочие часы и теги', async ({ page }) => {
  await start(page, '#/settings/work');
  const p = page.locator('#settings-page-work');
  const labels = await p.locator('.sgroup').first().locator('> .srow .srow-label').allTextContents();
  expect(labels).toEqual(['Ставка по умолчанию', 'Валюта', 'Таймер', 'Счётчик заработка']);
  await p.locator('#settings-rate').fill('1500');
  expect(await page.evaluate(() => state.settings.hourlyRate)).toBe(1500);
  await expect(p.locator('#settings-timer-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('#settings-earnings-toggle')).toHaveAttribute('aria-pressed', 'true');
  // Рабочие часы — своя группа: сводка словами, начало, конец, дни; «скоро»
  // больше нет (18 октября 2026).
  await expect(p.locator('#settings-hours > .srow .srow-label')).toHaveText(['Рабочие часы', 'Начало', 'Конец', 'Дни']);
  await expect(p.locator('#settings-hours-value')).toHaveText('Пн–Пт, 09:00–18:00');
  await expect(p.locator('#settings-hours .srow-sub')).toHaveCount(0);
  await expect(p.locator('#settings-hours-note')).toHaveText('Агент ищет свободное время в эти часы. Задачи можно ставить на любое время.');
  await expect(p.locator(':scope > .sgroup-label')).toHaveText(['Теги']);
  await expect(p.locator('#tags-add')).toBeVisible();
  // Сводка раздела — ставка.
  await page.locator('#settings-page-work .settings-back').click();
  await expect(page.locator('#settings-sec-work-value')).toHaveText('1 500 ₽/ч');
});

test('Работа → «Рабочие часы»: начало и конец — выбором времени, дни — квадратами; сохраняются и видны словами', async ({ page }) => {
  await start(page, '#/settings/work');
  const p = page.locator('#settings-page-work');
  const days = p.locator('#settings-hours-days > .rp-day');
  await expect(days).toHaveText(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  expect(await days.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed')))).toEqual(['true', 'true', 'true', 'true', 'true', 'false', 'false']);
  await expect(p.locator('#settings-hours-start')).toHaveText('09:00');
  await expect(p.locator('#settings-hours-end')).toHaveText('18:00');

  // Начало и конец — общим выбором времени (#tp-pop), как у отрезка.
  await p.locator('#settings-hours-start-row').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await page.locator('#tp-input').fill('10:00');
  await page.keyboard.press('Enter');
  await p.locator('#settings-hours-end-row').click();
  await page.locator('#tp-input').fill('19:30');
  await page.keyboard.press('Enter');
  // Дни — щелчком: понедельник снят, суббота добавлена.
  await days.filter({ hasText: 'Пн' }).click();
  await days.filter({ hasText: 'Сб' }).click();
  await expect(p.locator('#settings-hours-value')).toHaveText('Вт–Сб, 10:00–19:30');
  expect(await page.evaluate(() => state.settings.workHours)).toEqual({ start: '10:00', end: '19:30', days: [2, 3, 4, 5, 6] });

  // Конец не позже начала — не принимается, и сказано почему.
  await p.locator('#settings-hours-end-row').click();
  await page.locator('#tp-input').fill('9:00');
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toHaveText('Конец должен быть позже начала');
  await expect(p.locator('#settings-hours-end')).toHaveText('19:30');

  // Дни через один — перечнем.
  await days.filter({ hasText: 'Чт' }).click();
  await expect(p.locator('#settings-hours-value')).toHaveText('Вт, Ср, Пт, Сб, 10:00–19:30');

  // Сохраняются: после перезагрузки — те же.
  await page.evaluate(() => saveNow());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(p.locator('#settings-hours-value')).toHaveText('Вт, Ср, Пт, Сб, 10:00–19:30');
  await expect(p.locator('#settings-hours-start')).toHaveText('10:00');
  await expect(p.locator('#settings-hours-end')).toHaveText('19:30');

  // Последний день не снимается: искать агенту было бы негде.
  for (const d of ['Вт', 'Ср', 'Пт']) await days.filter({ hasText: d }).click();
  await expect(p.locator('#settings-hours-value')).toHaveText('Сб, 10:00–19:30');
  await days.filter({ hasText: 'Сб' }).click();
  await expect(page.locator('#toast')).toHaveText('Нужен хотя бы один день');
  await expect(days.filter({ hasText: 'Сб' })).toHaveAttribute('aria-pressed', 'true');

  // На других языках — их словами.
  await page.evaluate(() => setLang('en'));
  await expect(p.locator('#settings-hours-note')).toHaveText('The agent looks for free time within these hours. Tasks can be set for any time.');
});

test('Аккаунт: гостю — вход, вошедшему — имя, почта, пароль, синхронизация и выход', async ({ page }) => {
  await start(page, '#/settings/account');
  const p = page.locator('#settings-page-account');
  await expect(p.locator('#settings-account-guest')).toBeVisible();
  await expect(p.locator('#settings-account-guest .empty-state-title')).toHaveText('Вы не вошли');
  await expect(p.locator('#settings-account-card')).toBeHidden();
  await p.locator('#settings-account-guest .btn-accent').click();
  await expect(page.locator('#auth-backdrop')).toBeVisible();
  await page.evaluate(() => closeAuthModal());

  await page.evaluate(() => { currentUser = { id: 'u1', email: 'turan@example.com', name: 'Turan' }; render(); });
  await expect(p.locator('#settings-account-guest')).toBeHidden();
  await expect(p.locator('#settings-account-card > .srow .srow-label')).toHaveText(['Имя', 'Почта', 'Изменить пароль', 'Синхронизировать с аккаунтом', 'Выйти']);
  await expect(p.locator('#settings-name-value')).toHaveText('Turan');
  await expect(p.locator('#settings-email-value')).toHaveText('turan@example.com');
  await expect(p.locator('#settings-sync-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-page-account .settings-back').click();
  await expect(page.locator('#settings-profile .settings-profile-name')).toHaveText('Turan');
  await expect(page.locator('#settings-profile .settings-profile-sub')).toHaveText('turan@example.com');
});

test('верхний блок — аккаунт целиком: вошедшему открывает «Аккаунт», гостю — вход; шеврон справа', async ({ page }) => {
  await start(page);
  await openSettings(page);
  const top = page.locator('#settings-profile');
  // Гость: «Гость», подсказка и шеврон; щелчок по блоку — окно входа.
  await expect(top).toHaveJSProperty('tagName', 'BUTTON');
  await expect(top.locator('.settings-profile-name')).toHaveText('Гость');
  await expect(top.locator('#settings-signin-btn, #settings-signup-btn'), 'своих кнопок в блоке нет — весь блок и есть вход').toHaveCount(0);
  await top.click();
  await expect(page.locator('#auth-backdrop')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Вход');
  await page.evaluate(() => closeAuthModal());
  expect(await shownPage(page)).toEqual(['root']);

  // Вошедший: аватар, имя и почта, шеврон — и раздел «Аккаунт» по щелчку.
  await page.evaluate(() => { currentUser = { id: 'u1', email: 'turan@example.com', name: 'Turan' }; render(); });
  await expect(top.locator('.settings-profile-name')).toHaveText('Turan');
  await expect(top.locator('.settings-profile-sub')).toHaveText('turan@example.com');
  const g = await page.evaluate(() => {
    const b = document.getElementById('settings-profile').getBoundingClientRect();
    const chev = document.querySelector('#settings-profile .srow-chev').getBoundingClientRect();
    const name = document.querySelector('#settings-profile .settings-profile-name').getBoundingClientRect();
    const sub = document.querySelector('#settings-profile .settings-profile-sub').getBoundingClientRect();
    return { right: b.right - chev.right, chevMid: (chev.top + chev.bottom) / 2 - (b.top + b.bottom) / 2, stacked: sub.top >= name.bottom - 1 };
  });
  expect(g.right, 'шеврон — у правого края блока').toBeLessThanOrEqual(20);
  expect(Math.abs(g.chevMid), 'шеврон — посередине по высоте').toBeLessThanOrEqual(1);
  expect(g.stacked, 'почта — строкой под именем').toBe(true);
  const before = await historyIdx(page);
  await top.click();
  expect(await shownPage(page)).toEqual(['account']);
  expect(await hashOf(page)).toBe('#/settings/account');
  expect(await historyIdx(page), 'вход в раздел — новый шаг').toBe(before + 1);
  await page.locator('#settings-page-account .settings-back').click();
  expect(await shownPage(page)).toEqual(['root']);
});

test('Данные: экспорт открывает окно выгрузки, удаление аккаунта — только вошедшему', async ({ page }) => {
  await start(page, '#/settings/data');
  const p = page.locator('#settings-page-data');
  await expect(p.locator('#settings-delete-row')).toBeHidden();
  await p.locator('#settings-export-row').click();
  await expect(page.locator('#expdlg-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#expdlg-backdrop')).toBeHidden();
  await page.evaluate(() => { currentUser = { id: 'u1', email: 'turan@example.com', name: null }; render(); });
  await expect(p.locator('#settings-delete-row')).toBeVisible();
  await expect(p.locator('#settings-danger-label')).toHaveText('Удаление');
});

test('О приложении: о нас, блог, четыре документа и версия в подвале', async ({ page }) => {
  await start(page, '#/settings/about');
  const p = page.locator('#settings-page-about');
  await expect(p.locator('.sgroup .srow-label')).toHaveText(['О нас', 'Блог', 'Условия использования', 'Конфиденциальность', 'Файлы cookie', 'Документы и реквизиты']);
  await expect(p.locator('#settings-version')).toHaveText(/^Lancible · \d+\.\d+\.\d+/);
  const opened = [];
  await page.exposeFunction('__opened', (u) => opened.push(u));
  await page.evaluate(() => { window.open = (u) => { window.__opened(u); return null; }; });
  await p.locator('#settings-legal-cookies').click();
  await expect.poll(() => opened).toEqual(['https://lancible.vercel.app/cookies?lang=ru']);
});

test('названия разделов — на четырёх языках', async ({ page }) => {
  await start(page);
  await openSettings(page);
  for (const lang of ['en', 'uk', 'kk', 'ru']) {
    await page.evaluate((l) => setLang(l), lang);
    await expect(page.locator('#settings-sections > .srow .srow-label')).toHaveText(rowTitles(lang));
    for (const [i, section] of SECTIONS.entries()) {
      await expect(page.locator(`#settings-page-${section} .page-title`)).toHaveText(TITLES[lang][i]);
    }
  }
});

for (const width of [1280, 375]) {
  test(`${width}: ни одна страница настроек не уезжает вбок, строки не шире группы`, async ({ page }) => {
    await start(page);
    await page.setViewportSize({ width, height: 860 });
    await page.evaluate(() => { currentUser = { id: 'u1', email: 'very.long.address.for.testing@example.com', name: 'Очень длинное имя пользователя' }; render(); });
    for (const section of [null, ...SECTIONS]) {
      await page.evaluate((s) => openSettings(s), section);
      const m = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('#settings-view .settings-page')].find((p) => !p.hidden);
        const rows = [...visible.querySelectorAll('.srow')].filter((r) => r.offsetParent);
        return {
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
          wide: rows.filter((r) => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > r.parentElement.getBoundingClientRect().right + 1).map((r) => r.id || r.className),
        };
      });
      expect(m.docW, `${section || 'список'}: прокрутка вбок`).toBeLessThanOrEqual(m.winW);
      expect(m.wide, `${section || 'список'}: строки шире группы`).toEqual([]);
    }
  });
}

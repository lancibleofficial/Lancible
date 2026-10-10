// Версия приложения и ручная проверка обновлений в подвале Настроек.
// Запуск: npm run test:e2e
//
// Откуда тест. 10 октября 2026 выяснилось, что десктоп 0.4.0 не узнал о
// вышедших 0.4.1 и 0.4.2: проверка шла один раз при запуске, а узнать версию
// и спросить про обновление вручную в самом приложении было негде. Теперь в
// подвале Настроек — «Lancible · <версия>» (как на телефоне), а на десктопе
// рядом ссылка «Проверить обновления».
//
// Версия — одна строка на обеих поверхностях: десктоп берёт её у main
// (app.getVersion()), веб — из корневого package.json при сборке
// (web/version.js, scripts/sync-web-assets.js). Здесь проверена веб-сторона и
// то, что общий app.js рисует; настоящее окно десктопа — scripts/smoke.js, а
// main-процесс с таймером на час — tests/unit/updater.test.js.
//
// Десктопного API в браузере нет, поэтому для проверок ссылки к api-shim.js
// при загрузке дописывается подделка того, что даёт preload.js: на её месте
// тест сам играет роль main-процесса (отвечает на проверку, шлёт события).
const { test, expect } = require('@playwright/test');
const { version } = require('../../package.json');
const { pinClock } = require('./clock');

const IDLE = { phase: 'idle', version: null, percent: 0 };
const READY = { phase: 'ready', version: '0.5.0', percent: 100 };

/** Дописанное к api-shim.js: методы автообновления, как у preload.js. Ответ на
 *  проверку и состояние задаёт тест через window.__checkAnswer / __main. */
const FAKE_DESKTOP = `
;(() => {
  const api = window.api;
  const handlers = {};
  const calls = (window.__updateCalls = []);
  let status = window.__initialStatus || { phase: 'idle', version: null, percent: 0 };
  api.getUpdateStatus = () => Promise.resolve(status);
  api.checkForUpdate = () => { calls.push('check'); return window.__checkAnswer(); };
  api.installUpdate = () => { calls.push('install'); return Promise.resolve(true); };
  for (const name of ['Available', 'Progress', 'Ready', 'Error']) api['onUpdate' + name] = (cb) => { handlers[name] = cb; };
  window.__main = { emit: (name, data) => handlers[name](data), setStatus: (s) => { status = s; } };
})();
`;

/** Страница ведёт себя как в десктопе. Звать до открытия приложения. */
async function asDesktop(page, initialStatus = IDLE) {
  await page.addInitScript((s) => { window.__initialStatus = s; }, initialStatus);
  await page.route('**/api-shim.js', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + FAKE_DESKTOP });
  });
}

async function openSettings(page) {
  await pinClock(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.locator('.nav-item[data-view="settings"]').first().click();
  await expect(page.locator('#settings-view')).toBeVisible();
}

test('веб: в подвале версия из package.json, а кнопки проверки обновлений нет', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#settings-version')).toHaveText(`Lancible · ${version}`);
  await expect(page.locator('#settings-update-check'), 'на вебе страница и так свежая').toBeHidden();
  await expect(page.locator('#update-btn')).toBeHidden();
  // Окно спрашивает версию у window.api — та же строка, что на десктопе у main.
  expect(await page.evaluate(() => window.api.getVersion())).toBe(version);
  // Собранный файл с версией — не оставшийся от прошлой сборки.
  const built = await (await page.request.get('/version.js')).text();
  expect(built).toContain(JSON.stringify(version));
});

test('десктоп: версия и ссылка стоят в одной строке подвала по центру', async ({ page }) => {
  await asDesktop(page);
  await openSettings(page);
  const link = page.locator('#settings-update-check');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Проверить обновления');
  await expect(page.locator('#settings-version')).toHaveText(`Lancible · ${version}`);

  const box = (sel) => page.locator(sel).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  const [footer, ver, btn, content] = await Promise.all([
    box('.settings-footer'), box('#settings-version'), box('#settings-update-check'), box('.settings-grid'),
  ]);
  expect(ver.right, 'ссылка правее версии').toBeLessThanOrEqual(btn.left);
  expect(Math.abs(ver.top - btn.top), 'одна строка').toBeLessThanOrEqual(6);
  const groupCenter = (ver.left + btn.right) / 2;
  const contentCenter = (content.left + content.right) / 2;
  expect(Math.abs(groupCenter - contentCenter), 'подвал по центру страницы').toBeLessThanOrEqual(4);
  expect(footer.left).toBeGreaterThanOrEqual(content.left - 1);
  expect(footer.right).toBeLessThanOrEqual(content.right + 1);
});

test('десктоп: ссылка проходит состояния — проверяю, последняя версия, сбой, скачивание, установка', async ({ page }) => {
  await asDesktop(page);
  await openSettings(page);
  const link = page.locator('#settings-update-check');
  const panelBtn = page.locator('#update-btn');
  const calls = () => page.evaluate(() => window.__updateCalls);
  await expect(panelBtn).toBeHidden();

  // Пока main думает — «Проверяю…», нажать второй раз нельзя.
  await page.evaluate(() => { window.__checkAnswer = () => new Promise((r) => { window.__finishCheck = r; }); });
  await link.click();
  await expect(link).toHaveText('Проверяю…');
  await expect(link).toBeDisabled();
  await page.evaluate(() => window.__finishCheck({ ok: true, available: false, version: '0.4.2' }));
  await expect(link).toHaveText('Установлена последняя версия');
  await expect(link).toBeEnabled();
  await expect(panelBtn, 'обновления нет — кнопки в панели тоже').toBeHidden();

  // Сеть недоступна.
  await page.evaluate(() => { window.__checkAnswer = () => Promise.resolve({ ok: false, error: 'нет сети' }); });
  await link.click();
  await expect(link).toHaveText('Не удалось проверить обновления');

  // Нашлось: main уже качает, подпись и кнопка в панели повторяют скачивание.
  await page.evaluate(() => {
    window.__checkAnswer = () => {
      window.__main.setStatus({ phase: 'downloading', version: '0.5.0', percent: 0 });
      window.__main.emit('Available', { version: '0.5.0' });
      return Promise.resolve({ ok: true, available: true, version: '0.5.0' });
    };
  });
  await link.click();
  await expect(link).toHaveText('Скачивание…');
  await expect(link).toBeDisabled();
  await expect(panelBtn).toBeVisible();
  await expect(page.locator('#update-btn-label')).toHaveText('Скачивание…');
  await page.evaluate(() => window.__main.emit('Progress', { percent: 40 }));
  await expect(page.locator('#update-progress')).toHaveAttribute('style', /width:\s*40%/);

  // Скачано: и ссылка, и кнопка в панели ставят обновление.
  await page.evaluate(() => {
    window.__main.setStatus({ phase: 'ready', version: '0.5.0', percent: 100 });
    window.__main.emit('Ready');
  });
  await expect(link).toHaveText('Установить и перезапустить');
  await expect(link).toBeEnabled();
  expect(await calls()).toEqual(['check', 'check', 'check']);
  await link.click();
  await panelBtn.click();
  expect((await calls()).filter((c) => c === 'install')).toHaveLength(2);
});

test('десктоп: состояние обновления переживает перезагрузку окна', async ({ page }) => {
  await asDesktop(page, READY);
  await openSettings(page);
  // Событие «готово» окно не получало — состояние пришло от main при старте.
  await expect(page.locator('#update-btn')).toBeVisible();
  await expect(page.locator('#update-btn-label')).toHaveText('Установить и перезапустить');
  await expect(page.locator('#settings-update-check')).toHaveText('Установить и перезапустить');

  // Ошибка проверки скачанное не отменяет; оборванное скачивание — отменяет.
  await page.evaluate(() => window.__main.emit('Error', { message: 'сеть' }));
  await expect(page.locator('#update-btn')).toBeVisible();
  await page.evaluate(() => {
    window.__main.setStatus({ phase: 'idle', version: null, percent: 0 });
    window.__main.emit('Error', { message: 'обрыв' });
  });
  await expect(page.locator('#update-btn')).toBeHidden();
  await expect(page.locator('#settings-update-check')).toHaveText('Проверить обновления');
});

test('десктоп: кнопка обновления не теряет подпись, когда приложение перерисовывает переводы', async ({ page }) => {
  // applyStaticTranslations() зовётся с разных экранов и затирает всё, что
  // помечено data-i18n, — подпись кнопки, выставленная кодом, должна выжить.
  await asDesktop(page, READY);
  await openSettings(page);
  await page.evaluate(() => applyStaticTranslations());
  await expect(page.locator('#update-btn-label')).toHaveText('Установить и перезапустить');
  await page.evaluate(() => setLang('en'));
  await expect(page.locator('#update-btn-label')).toHaveText('Install and restart');
  await expect(page.locator('#settings-update-check')).toHaveText('Install and restart');
});

test('десктоп: подписи ссылки переводятся на все четыре языка', async ({ page }) => {
  await asDesktop(page);
  await openSettings(page);
  const expected = {
    en: 'Check for updates',
    uk: 'Перевірити оновлення',
    kk: 'Жаңартуларды тексеру',
    ru: 'Проверить обновления',
  };
  for (const [lang, text] of Object.entries(expected)) {
    await page.evaluate((l) => setLang(l), lang);
    await expect(page.locator('#settings-update-check')).toHaveText(text);
  }
});

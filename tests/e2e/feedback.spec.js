// Обратная связь на вебе и десктопе. Запуск: npm run test:e2e
//
// Откуда тест (17 октября 2026, пункт 17 круга): «фидбек и баг-репорт».
// Форма одна на веб, десктоп и телефон: вид (ошибка · идея · другое), текст
// до 4000, снимок экрана (на компьютере — файл с диска), «Отправить».
// Платформа, версия, язык и браузер уходят сами; гость шлёт без user_id.
// Строка — в таблицу feedback (supabase/feedback.sql), снимок — в приватный
// бакет feedback по пути <id записи>.<тип>. Ошибка сети — строка с
// «Повторить», текст не теряется; повтор — та же запись, а не вторая.
//
// С 19 октября 2026 («разумное ограничение»): сначала строка, потом снимок —
// бакет примет только файл, названный строкой. База держит частоту и
// отказывает 'feedback rate' (P0001) — своя строка, текст на месте. Отказала
// только загрузка — «сообщение ушло без снимка», повтор догружает снимок и
// строку второй раз не шлёт.
//
// Supabase подменяется на уровне сети: что ушло — то и проверяется.
const { test, expect } = require('@playwright/test');
const { version } = require('../../package.json');
const { pinClock } = require('./clock');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Самый маленький PNG: 1×1, прозрачный.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Подмена таблицы и бакета; всё меняется на ходу.
 *  answer — строка: 'ok' | 'fail' | 'offline' (и снимок тоже) | 'rate' (отказ
 *  базы по частоте, как его отдаёт PostgREST); shot — только снимок: 'ok' |
 *  'fail'. log — порядок запросов: 'row:<id>' и 'shot:<путь>'. */
async function cloud(page) {
  const net = { answer: 'ok', shot: 'ok', rows: [], uploads: [], log: [] };
  await page.route('**/rest/v1/feedback**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fulfill({ status: 405, body: '' });
    const raw = req.postDataJSON();
    const body = Array.isArray(raw) ? raw[0] : raw;
    net.rows.push({ body, prefer: req.headers().prefer || '' });
    net.log.push(`row:${body.id}`);
    if (net.answer === 'offline') return route.abort('internetdisconnected');
    if (net.answer === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
    if (net.answer === 'rate') {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: 'feedback rate', details: null, hint: 'От гостей — не больше 30 сообщений в час на всех.' }),
      });
    }
    return route.fulfill({ status: 201, body: '' });
  });
  await page.route('**/storage/v1/object/feedback/**', async (route) => {
    const req = route.request();
    const objPath = decodeURIComponent(new URL(req.url()).pathname.split('/storage/v1/object/feedback/')[1]);
    net.uploads.push({ path: objPath, method: req.method(), size: (req.postDataBuffer() || Buffer.alloc(0)).length });
    net.log.push(`shot:${objPath}`);
    if (net.answer === 'offline') return route.abort('internetdisconnected');
    if (net.shot === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":"500","error":"internal","message":"storage unavailable"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `feedback/${objPath}`, Id: 'obj-1' }) });
  });
  return net;
}

/** Приложить картинку через выбор файла. */
async function attachPng(page, name = 'shot.png') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#fb-attach').click()]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#fb-thumb')).toBeVisible();
}

async function start(page) {
  await pinClock(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/index.html#/settings/feedback');
  await page.reload();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('#settings-page-feedback')).toBeVisible();
}

test('форма: вид сегментами, поле до 4000 со счётчиком, снимок — блок со скрепкой, «Отправить» ждёт текста', async ({ page }) => {
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await expect(p.locator('#fb-kind > button')).toHaveText(['Ошибка', 'Идея', 'Другое']);
  await expect(p.locator('#fb-kind > button.on')).toHaveText('Ошибка');
  await expect(p.locator('#fb-text')).toHaveAttribute('maxlength', '4000');
  await expect(p.locator('#fb-text')).toHaveAttribute('placeholder', 'Что сломалось? Что вы делали перед этим?');
  await expect(p.locator('#fb-count')).toHaveText('0 из 4000');
  // Снимок (19 октября 2026): не переключатель, а блок — скрепка, подпись,
  // форматы; миниатюры пока нет.
  await expect(p.locator('#fb-attach svg[data-icon="paperclip"]')).toHaveCount(1);
  await expect(p.locator('#fb-attach .fb-attach-title')).toHaveText('Приложить снимок экрана');
  await expect(p.locator('#fb-attach-sub')).toHaveText('PNG, JPEG или WebP до 5 МБ');
  await expect(p.locator('#fb-attach')).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(p.locator('#fb-thumb')).toBeHidden();
  // Подсказка — правовая (feedback.meta_hint_web): у вошедшего сообщение привязывается к аккаунту.
  await expect(p.locator('#fb-hint')).toHaveText('Вместе с сообщением уйдут платформа, версия приложения, язык и строка браузера (браузер и система). Если вы вошли, сообщение будет привязано к аккаунту.');
  await expect(p.locator('#fb-send')).toBeDisabled();
  await p.locator('#fb-text').fill('   ');
  await expect(p.locator('#fb-send'), 'одни пробелы — не сообщение').toBeDisabled();
  await p.locator('#fb-kind > button[data-kind="idea"]').click();
  await expect(p.locator('#fb-text')).toHaveAttribute('placeholder', 'Что добавить или сделать удобнее?');
  await p.locator('#fb-text').fill('Хочу тёмную тему погуще');
  await expect(p.locator('#fb-count')).toHaveText('23 из 4000');
  await expect(p.locator('#fb-send')).toBeEnabled();
  // Общие детали: сегменты, поле, акцентная кнопка; снимок — свой блок, не переключатель.
  const cls = await page.evaluate(() => ({
    kind: document.getElementById('fb-kind').className,
    text: document.getElementById('fb-text').className,
    attach: document.getElementById('fb-attach').className,
    send: document.getElementById('fb-send').className,
  }));
  expect(cls.kind).toMatch(/\bsegmented\b/);
  expect(cls.text).toMatch(/\bfield\b/);
  expect(cls.attach).toBe('fb-attach');
  expect(cls.send).toBe('btn-accent');
  expect(await page.locator('#settings-page-feedback select').count()).toBe(0);
});

test('гость шлёт без user_id: вид, текст, платформа, версия, язык и браузер; тост и чистая форма', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-kind > button[data-kind="bug"]').click();
  await p.locator('#fb-text').fill('  Не сохраняется заметка  ');
  await p.locator('#fb-send').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  expect(net.rows).toHaveLength(1);
  const { body, prefer } = net.rows[0];
  expect(Object.keys(body).sort()).toEqual(['app_version', 'device', 'id', 'kind', 'lang', 'platform', 'screenshot_path', 'text']);
  expect(body).toMatchObject({
    kind: 'bug', text: 'Не сохраняется заметка', platform: 'web', app_version: version, lang: 'ru', screenshot_path: null,
  });
  expect(body.id).toMatch(UUID);
  expect(body.device).toBe(await page.evaluate(() => navigator.userAgent.slice(0, 200)));
  // Строку назад не просим: читать отзывы гостю нечем (политики select для
  // него нет), а return=representation требовал бы её.
  expect(prefer).not.toMatch(/return=representation/);
  expect(net.uploads).toEqual([]);
  // Форма очищена.
  await expect(p.locator('#fb-text')).toHaveValue('');
  await expect(p.locator('#fb-kind > button.on')).toHaveText('Ошибка');
  await expect(p.locator('#fb-send')).toBeDisabled();
  await expect(p.locator('#fb-error')).toBeHidden();
});

test('снимок — файл с диска: уходит в бакет под id записи, путь — в screenshot_path', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-text').fill('Кнопка уехала');
  // Щелчок по всему блоку открывает выбор картинки — и у правого края тоже.
  const box = await p.locator('#fb-attach').boundingBox();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.mouse.click(box.x + box.width - 30, box.y + box.height / 2)]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  // Выбранная — миниатюрой с крестиком, вместо форматов — имя файла.
  await expect(p.locator('#fb-thumb')).toBeVisible();
  await expect(p.locator('#fb-thumb-img')).toHaveAttribute('src', /^blob:/);
  await expect(p.locator('#fb-thumb-x')).toHaveAttribute('aria-label', 'Убрать снимок');
  await expect(p.locator('#fb-attach-sub')).toHaveText('shot.png');
  await expect.poll(() => page.evaluate(() => document.getElementById('fb-thumb-img').naturalWidth), 'картинка прочиталась').toBe(1);
  const g = await page.evaluate(() => {
    const block = document.getElementById('fb-attach').getBoundingClientRect();
    const thumb = document.getElementById('fb-thumb').getBoundingClientRect();
    const title = document.querySelector('#fb-attach .fb-attach-title').getBoundingClientRect();
    return { inside: thumb.left > block.left && thumb.right <= block.right && thumb.top >= block.top && thumb.bottom <= block.bottom, clear: title.right <= thumb.left };
  });
  expect(g.inside, 'миниатюра — внутри блока, справа').toBe(true);
  expect(g.clear, 'подпись на миниатюру не наезжает').toBe(true);
  // Щелчок по самой миниатюре — тоже выбор (замена), а не мимо.
  const thumbBox = await p.locator('#fb-thumb-img').boundingBox();
  const [swap] = await Promise.all([page.waitForEvent('filechooser'), page.mouse.click(thumbBox.x + 10, thumbBox.y + thumbBox.height - 8)]);
  await swap.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await p.locator('#fb-send').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  expect(net.uploads).toHaveLength(1);
  const { body } = net.rows[0];
  expect(net.uploads[0].path).toBe(`${body.id}.png`);
  expect(net.uploads[0].size).toBeGreaterThan(0);
  expect(body.screenshot_path).toBe(`${body.id}.png`);
  // Сначала строка, потом снимок: бакет примет только файл, который строка назвала.
  expect(net.log, 'сначала строка, потом снимок').toEqual([`row:${body.id}`, `shot:${body.id}.png`]);
  await expect(p.locator('#fb-thumb'), 'отправили — форма чистая, снимка нет').toBeHidden();
  await expect(p.locator('#fb-attach-sub')).toHaveText('PNG, JPEG или WebP до 5 МБ');

  // Не картинка или больше 5 МБ — отказ словами, файл не берётся.
  const [again] = await Promise.all([page.waitForEvent('filechooser'), p.locator('#fb-attach').click()]);
  await again.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.locator('#toast')).toHaveText('Подойдёт картинка PNG, JPEG или WebP до 5 МБ');
  await expect(p.locator('#fb-thumb')).toBeHidden();

  // Крестик убирает снимок: сообщение уходит без него.
  const [third] = await Promise.all([page.waitForEvent('filechooser'), p.locator('#fb-attach').click()]);
  await third.setFiles({ name: 'other.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.locator('#fb-thumb')).toBeVisible();
  await p.locator('#fb-thumb-x').click();
  await expect(p.locator('#fb-thumb')).toBeHidden();
  await expect(p.locator('#fb-attach')).toBeFocused();
  await p.locator('#fb-text').fill('Без снимка');
  await p.locator('#fb-send').click();
  await expect.poll(() => net.rows.length).toBe(2);
  expect(net.rows[1].body.screenshot_path).toBeNull();
  expect(net.uploads, 'второй раз в бакет ничего не ушло').toHaveLength(1);
});

test('сеть упала — строка с «Повторить», текст на месте; повтор — та же запись', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-text').fill('Падает экспорт');
  net.answer = 'offline';
  await p.locator('#fb-send').click();
  await expect(p.locator('#fb-error')).toBeVisible();
  await expect(p.locator('#fb-error')).toContainText('Не отправилось — проверьте интернет. Текст сохранён.');
  await expect(p.locator('#fb-text')).toHaveValue('Падает экспорт');
  await expect(p.locator('#fb-send')).toBeEnabled();
  net.answer = 'fail';
  await p.locator('#fb-retry').click();
  await expect(p.locator('#fb-error')).toBeVisible();
  net.answer = 'ok';
  await p.locator('#fb-retry').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  await expect(p.locator('#fb-error')).toBeHidden();
  expect(net.rows).toHaveLength(3);
  expect(new Set(net.rows.map((r) => r.body.id)).size, 'три попытки — одна запись').toBe(1);
  // Следующее сообщение — уже новая запись.
  await p.locator('#fb-text').fill('Ещё одно');
  await p.locator('#fb-send').click();
  await expect.poll(() => net.rows.length).toBe(4);
  expect(net.rows[3].body.id).not.toBe(net.rows[0].body.id);
});

test('база отказала по частоте: своя строка, текст и снимок на месте, в бакет ничего не ушло', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-text').fill('Шестое за десять минут');
  await attachPng(page);
  net.answer = 'rate';
  await p.locator('#fb-send').click();
  await expect(p.locator('#fb-error')).toBeVisible();
  await expect(p.locator('#fb-error-text')).toHaveText('Слишком много сообщений подряд. Попробуйте через несколько минут.');
  await expect(p.locator('#fb-text')).toHaveValue('Шестое за десять минут');
  await expect(p.locator('#fb-thumb')).toBeVisible();
  await expect(p.locator('#fb-send')).toBeEnabled();
  expect(net.uploads, 'строка не дошла — снимок не грузится').toEqual([]);
  // Строка — из словаря: смена языка переводит и её.
  for (const [l, text] of [
    ['en', 'Too many messages in a row. Please try again in a few minutes.'],
    ['uk', 'Забагато повідомлень поспіль. Спробуйте за кілька хвилин.'],
    ['kk', 'Қатарынан тым көп хабар. Бірнеше минуттан кейін қайталап көріңіз.'],
  ]) {
    await page.evaluate((x) => setLang(x), l);
    await expect(p.locator('#fb-error-text')).toHaveText(text);
  }
  await page.evaluate(() => setLang('ru'));
  // Через несколько минут — та же запись, со снимком следом.
  net.answer = 'ok';
  await p.locator('#fb-retry').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  const { id } = net.rows[0].body;
  expect(net.log).toEqual([`row:${id}`, `row:${id}`, `shot:${id}.png`]);
  await expect(p.locator('#fb-error')).toBeHidden();
});

test('отказала только загрузка снимка: «ушло без снимка», повтор догружает снимок, а строку второй раз не шлёт', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-text').fill('Съехала таблица');
  await attachPng(page);
  net.shot = 'fail';
  await p.locator('#fb-send').click();
  const shotFailed = 'Сообщение ушло без снимка — картинка не загрузилась. «Повторить» догрузит её.';
  await expect(p.locator('#fb-error')).toBeVisible();
  await expect(p.locator('#fb-error-text')).toHaveText(shotFailed);
  await expect(p.locator('#fb-text')).toHaveValue('Съехала таблица');
  await expect(p.locator('#fb-thumb')).toBeVisible();
  const { id } = net.rows[0].body;
  expect(net.rows[0].body.screenshot_path).toBe(`${id}.png`);
  // Ещё раз не вышло — строка всё равно одна.
  await p.locator('#fb-retry').click();
  await expect.poll(() => net.uploads.length).toBe(2);
  await expect(p.locator('#fb-error-text')).toHaveText(shotFailed);
  net.shot = 'ok';
  await p.locator('#fb-retry').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  expect(net.rows, 'строка ушла один раз').toHaveLength(1);
  expect(net.log).toEqual([`row:${id}`, `shot:${id}.png`, `shot:${id}.png`, `shot:${id}.png`]);
  await expect(p.locator('#fb-text')).toHaveValue('');
  await expect(p.locator('#fb-thumb')).toBeHidden();
  await expect(p.locator('#fb-error')).toBeHidden();
});

test('строка ушла без снимка, а снимок убрали — следующее «Отправить» — уже новое сообщение', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-text').fill('Не грузится картинка');
  await attachPng(page);
  net.shot = 'fail';
  await p.locator('#fb-send').click();
  await expect(p.locator('#fb-error-text')).toHaveText('Сообщение ушло без снимка — картинка не загрузилась. «Повторить» догрузит её.');
  await p.locator('#fb-thumb-x').click();
  await expect(p.locator('#fb-error'), 'прежнее сообщение уже у нас').toBeHidden();
  await p.locator('#fb-send').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  expect(net.rows).toHaveLength(2);
  expect(net.rows[1].body.id).not.toBe(net.rows[0].body.id);
  expect(net.rows[1].body.screenshot_path).toBeNull();
  expect(net.uploads).toHaveLength(1);
});

test('вошедший шлёт со своим user_id; подписи формы — на четырёх языках', async ({ page }) => {
  const net = await cloud(page);
  await start(page);
  await page.evaluate(() => { currentUser = { id: '11111111-2222-4333-8444-555555555555', email: 'turan@example.com', name: 'Turan' }; render(); });
  const p = page.locator('#settings-page-feedback');
  await p.locator('#fb-kind > button[data-kind="other"]').click();
  await p.locator('#fb-text').fill('Всё хорошо');
  await p.locator('#fb-send').click();
  await expect(page.locator('#toast')).toHaveText('Спасибо, получили');
  expect(net.rows[0].body).toMatchObject({ kind: 'other', user_id: '11111111-2222-4333-8444-555555555555' });

  const words = {
    en: ['Bug', 'Idea', 'Other', 'Send', 'Feedback'],
    uk: ['Помилка', 'Ідея', 'Інше', 'Надіслати', 'Зворотний зв’язок'],
    kk: ['Қате', 'Идея', 'Басқа', 'Жіберу', 'Кері байланыс'],
    ru: ['Ошибка', 'Идея', 'Другое', 'Отправить', 'Обратная связь'],
  };
  for (const [lang, [bug, idea, other, send, title]] of Object.entries(words)) {
    await page.evaluate((l) => setLang(l), lang);
    await expect(p.locator('#fb-kind > button')).toHaveText([bug, idea, other]);
    await expect(p.locator('#fb-send')).toHaveText(send);
    await expect(p.locator('.page-title')).toHaveText(title);
  }
  // Язык записи — язык приложения.
  await page.evaluate(() => setLang('kk'));
  await p.locator('#fb-text').fill('Сәлем');
  await p.locator('#fb-send').click();
  await expect.poll(() => net.rows.length).toBe(2);
  expect(net.rows[1].body.lang).toBe('kk');
});

for (const width of [1280, 375]) {
  test(`${width}: форма в ширину страницы, без прокрутки вбок`, async ({ page }) => {
    await start(page);
    await page.setViewportSize({ width, height: 860 });
    const m = await page.evaluate(() => {
      const form = document.getElementById('fb-form').getBoundingClientRect();
      const text = document.getElementById('fb-text').getBoundingClientRect();
      const send = document.getElementById('fb-send').getBoundingClientRect();
      return { docW: document.documentElement.scrollWidth, winW: innerWidth, form, text, send };
    });
    expect(m.docW).toBeLessThanOrEqual(m.winW);
    expect(Math.round(m.text.width)).toBe(Math.round(m.form.width));
    expect(m.send.right).toBeLessThanOrEqual(m.form.right + 0.5);
  });
}

// Снимки лендинга. Запуск: npm run test:visual
//
// Что ловят снимки и чего не ловят замеры. Замер отвечает на заданный
// вопрос: «одинаковая ли высота шапки», «нет ли прокрутки вбок». Снимок не
// задаёт вопросов — он замечает всё сразу: уехавший отступ, потерявшийся
// фон, съехавшую иконку. Цена — он краснеет и на намеренной правке вида,
// поэтому эталон пересоздаётся командой, а не сам.
//
// Почему снимаются элементы, а не страницы целиком. Первая версия снимала
// страницу целиком, и эталоны весили 14 МБ: один журнал занимал 6 МБ и рос с
// каждой записью. Хуже веса было другое — журнал читает базу при загрузке,
// то есть эталон ломался бы от любой новой записи, не имеющей отношения к
// вёрстке. Поэтому снимается то, про что есть правило: шапка и подвал на
// каждой странице. Плюс первый экран главной — там живёт вся витрина, и
// данных из сети на ней нет.
const { test } = require('@playwright/test');
const { expectShot } = require('./shot');

const PAGES = [
  ['главная', '/index.html'],
  ['блог', '/blog.html'],
  ['журнал', '/logs.html'],
  ['устройство', '/architecture.html'],
];

const SIZES = [['широкий', 1280], ['узкий', 375]];

/** Разметка приехала, шрифты приехали. Без ожидания шрифтов первый снимок
 *  набран запасным шрифтом, а второй — настоящим. */
async function ready(page, url) {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
}

/** Убрать со страницы всё, кроме шапки и подвала.
 *
 *  Зачем. Подвал стоит в конце страницы, и его верхний край приходится на
 *  дробную координату — какую именно, зависит от того, сколько текста выше.
 *  На журнале текст приезжает из базы и каждый раз немного другой, поэтому
 *  снимок подвала то 108 px высотой, то 109: вёрстка та же, округление
 *  разное. Снимая шапку и подвал, мы и не хотим зависеть от содержимого
 *  между ними — убираем его из потока, и подвал встаёт на одно и то же
 *  место на всех страницах.  */
async function onlyChrome(page) {
  const hidden = await page.evaluate(() => {
    const foot = document.querySelector('footer');
    const head = document.querySelector('header');
    if (!foot || !head || foot.parentElement !== head.parentElement) return -1;
    let n = 0;
    for (const el of [...foot.parentElement.children]) {
      if (el === foot || el === head) continue;
      el.style.display = 'none';
      n += 1;
    }
    return n;
  });
  // -1 означает, что шапка и подвал лежат в разных местах разметки и приём
  // не сработал. Молчать об этом нельзя: снимки станут плавающими.
  if (hidden < 0) throw new Error('шапка и подвал не соседи — снимок будет плавать');
}

for (const [label, url] of PAGES) {
  for (const [sizeName, width] of SIZES) {
    test(`${label}: шапка и подвал, экран ${sizeName}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await ready(page, url);
      await onlyChrome(page);
      for (const part of ['header', 'footer']) {
        await expectShot(page.locator(part), test, `${label}-${part}-${sizeName}.png`);
      }
    });
  }
}

for (const [sizeName, width] of SIZES) {
  test(`главная: первый экран, ${sizeName}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page, '/index.html');
    // Живой таймер тикает — закрашиваем. Не прячем: уберёшь элемент, поедет
    // вёрстка вокруг, и снимок перестанет проверять её.
    await expectShot(page, test, `главная-первый-экран-${sizeName}.png`, {
      mask: [page.locator('#liveTimer')],
    });
  });
}

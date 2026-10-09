// Лендинг: строка правовых ссылок в подвале — на одной линии.
// Запуск: npm run test:landing
//
// Откуда тест. 10 октября 2026 Testing (Web/Desktop) нашла, что кнопка
// «Настройки cookie» в подвале стоит на 6 px ниже соседних ссылок. В строку
// .footer-legal встал переключатель языка высотой 28 px и растянул под себя
// все её элементы. Ссылки держат текст у верха своей коробки, а <button> —
// по центру, отсюда и сдвиг. Починено в общем месте, landing.css:
// align-items:center.
//
// Что меряется. Не коробки — растянутые, они совпадали и при дефекте, — а
// сам текст: прямоугольник Range по содержимому ссылки и кнопки. У
// переключателя языка текста нет, у него берётся середина коробки. В каждой
// линии строки (на узком экране она переносится, и кнопка встаёт рядом с
// переключателем) середины должны совпадать с точностью до пикселя.
const { test, expect } = require('@playwright/test');

const PAGES = ['/index.html', '/blog.html', '/logs.html', '/architecture.html', '/graph.html', '/privacy.html', '/terms.html', '/cookies.html', '/refund.html', '/legal.html', '/delete-account.html'];
const WIDTHS = [1280, 375];

/** Элементы строки .footer-legal, разложенные по линиям: [[{ label, button,
 *  mid }]] — mid — середина текста (у переключателя — коробки) по вертикали. */
async function legalLines(page) {
  return page.evaluate(() => {
    const row = document.querySelector('.footer-legal');
    const items = [...row.querySelectorAll(':scope > a, :scope > .footer-consent, :scope > .lang-switch')];
    const lines = new Map();
    for (const el of items) {
      const box = el.getBoundingClientRect();
      let text = box;
      if (!el.classList.contains('lang-switch')) {
        const range = document.createRange();
        range.selectNodeContents(el);
        text = range.getBoundingClientRect();
      }
      // Линию задаёт середина коробки: у элементов одной линии она общая и
      // при растяжении, и при выравнивании по центру.
      const key = Math.round(box.top + box.height / 2);
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ label: el.textContent.trim(), button: el.classList.contains('footer-consent'), mid: text.top + text.height / 2 });
    }
    return {
      alignItems: getComputedStyle(row).alignItems,
      lines: [...lines.values()],
    };
  });
}

for (const width of WIDTHS) {
  test.describe(`подвал при ширине ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of PAGES) {
      test(`${path}: «Настройки cookie» на одной линии со ссылками`, async ({ page }) => {
        await page.goto(path);
        await page.locator('.footer-legal').scrollIntoViewIfNeeded();
        const { alignItems, lines } = await legalLines(page);
        expect(alignItems).toBe('center');
        // Кнопка не стоит одна: в её линии есть ещё ссылка или переключатель —
        // иначе сравнивать было бы не с чем и тест прошёл бы впустую.
        const withButton = lines.find((line) => line.some((i) => i.button));
        expect(withButton && withButton.length).toBeGreaterThan(1);
        for (const line of lines) {
          const mids = line.map((i) => i.mid);
          expect(Math.max(...mids) - Math.min(...mids), `в линии ${line.map((i) => i.label).join(' · ')}`).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}

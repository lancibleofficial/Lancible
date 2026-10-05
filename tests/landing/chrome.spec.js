// Лендинг: шапка и подвал после отрисовки. Запуск: npm run test:landing
//
// Что здесь и чего здесь нет. Разметку и правила сверяет tests/unit/
// landing.test.js — он читает файлы и успевает отработать в крюке. Сюда
// попало то, что видно только после отрисовки: высоты, положение, во что
// превращается шапка на узком экране и не вылезает ли что-то за поле
// страницы.
//
// Почему это вообще важно. Правило из CLAUDE.md «шапка и подвал лендинга
// одни и те же на всех его страницах» разошлось дважды: сначала надпись
// GitHub пряталась не тем правилом, потом порог сужения стоял на 560 на двух
// страницах и на 640 на двух других. Второе было настоящей поломкой: при
// ширине 561 правый блок шапки вылезал за поле страницы на 22 px.
const { test, expect } = require('@playwright/test');

const PAGES = ['/index.html', '/blog.html', '/logs.html', '/architecture.html'];

// Порог сужения шапки. Замер: в полном составе ей нужно 583 px (герб 125 +
// правый блок 394 + поля 48 + зазор 16), поэтому 640 с запасом, а 560 — уже
// поздно.
const NARROW_AT = 640;

/** Размеры и состояние шапки — одним замером, чтобы не гонять туда-сюда. */
async function chrome(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
    };
    const row = q('.header-row');
    const acts = q('.header-actions');
    const cs = getComputedStyle(row);
    const doc = document.documentElement;
    return {
      header: box(q('header')),
      row: box(row),
      footer: box(q('footer')),
      pill: getComputedStyle(q('.status-pill')).display,
      ghLabel: getComputedStyle(q('.gh-link[target] span.long')).display,
      // Насколько правый блок вылез за поле строки. Ноль — прижат к полю,
      // больше нуля — торчит наружу.
      overrun: Math.round(
        acts.getBoundingClientRect().right
        - (row.getBoundingClientRect().right - parseFloat(cs.paddingRight)),
      ),
      pageScrollsSideways: doc.scrollWidth > doc.clientWidth,
      headerLinks: [...q('header').querySelectorAll('a')].map((a) => a.textContent.trim()).filter(Boolean),
      footerLinks: [...q('footer').querySelectorAll('a')]
        .map((a) => `${a.getAttribute('href')} :: ${a.textContent.trim()}`),
    };
  });
}

for (const width of [1280, NARROW_AT + 1, NARROW_AT - 1, 375]) {
  test(`шапка и подвал одинаковы на всех страницах при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const seen = {};
    for (const url of PAGES) {
      await page.goto(url);
      // Шрифты приезжают с Google Fonts, то есть позже разметки. Померить до
      // них — значит померить запасной шрифт: у него другие метрики, и высота
      // подвала выходит другая. Под нагрузкой (например, когда рядом гоняет
      // сторож) разница вылезает, а в тишине её не видно — ровно тот сорт
      // плавающего теста, из-за которого перестают верить набору.
      await page.evaluate(() => document.fonts.ready);
      seen[url] = await chrome(page);
    }
    // Образец — страница с самым полным подвалом: на главной одного пункта
    // нет, и это единственное законное отличие.
    const fullest = PAGES.reduce((a, b) => (
      seen[b].footerLinks.length > seen[a].footerLinks.length ? b : a));
    const base = seen[fullest];
    for (const url of PAGES) {
      const got = seen[url];
      expect(got.header, `${url}: высота шапки`).toEqual(base.header);
      expect(got.row, `${url}: строка шапки`).toEqual(base.row);
      // Высоту подвала сравниваем только у страниц с одинаковым числом
      // ссылок. На главной ссылок на одну меньше (нет пункта «Главная»), и
      // на узком экране строка ссылок из-за этого переносится по-другому:
      // подвал законно ниже. Требовать там равенства — значит требовать,
      // чтобы лишний пункт не занимал места.
      if (got.footerLinks.length === base.footerLinks.length) {
        expect(got.footer.h, `${url}: высота подвала`).toEqual(base.footer.h);
      } else {
        expect(got.footer.h, `${url}: подвал с меньшим числом ссылок выше полного`)
          .toBeLessThanOrEqual(base.footer.h);
      }
      expect(got.pill, `${url}: таблетка состояния`).toBe(base.pill);
      expect(got.ghLabel, `${url}: подпись GitHub`).toBe(base.ghLabel);
      const self = url.replace(/^\//, '');
      expect(got.footerLinks, `${url}: подвал`)
        .toEqual(base.footerLinks.filter((l) => !l.startsWith(`${self} ::`)));
    }
  });

  test(`ничего не вылезает за поле страницы при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const url of PAGES) {
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      const got = await chrome(page);
      expect(got.overrun, `${url}: правый блок шапки торчит за поле`).toBeLessThanOrEqual(0);
      expect(got.pageScrollsSideways, `${url}: страницу можно утащить вбок`).toBe(false);
    }
  });
}

test(`шапка сужается ровно на ${NARROW_AT}, и ни пикселем позже`, async ({ page }) => {
  // Порог проверяется с обеих сторон: на пиксель шире — полный состав, на
  // пиксель уже — сжатый. Так тест ловит и сдвиг порога, и его пропажу.
  for (const url of PAGES) {
    await page.setViewportSize({ width: NARROW_AT + 1, height: 900 });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const wide = await chrome(page);
    expect(wide.pill, `${url}: при ${NARROW_AT + 1} таблетка должна быть видна`).not.toBe('none');
    expect(wide.ghLabel, `${url}: при ${NARROW_AT + 1} подпись GitHub должна быть видна`).not.toBe('none');

    await page.setViewportSize({ width: NARROW_AT - 1, height: 900 });
    const narrow = await chrome(page);
    expect(narrow.pill, `${url}: при ${NARROW_AT - 1} таблетка должна прятаться`).toBe('none');
    expect(narrow.ghLabel, `${url}: при ${NARROW_AT - 1} подпись GitHub должна прятаться`).toBe('none');
  }
});

test('служебные страницы отдаются по короткому адресу', async ({ page, baseURL }) => {
  // Локальный сервер повторяет rewrite Vercel: /logs открывается так же, как
  // /logs.html. Если это разъедется, ссылка в адресной строке перестанет
  // работать на сайте, а узнаем мы об этом от пользователя.
  for (const name of ['logs', 'architecture']) {
    const res = await page.request.get(`${baseURL}/${name}`);
    expect(res.status(), `/${name}: код ответа`).toBe(200);
    expect(await res.text(), `/${name}: отдалась не та страница`).toContain('<footer>');
  }
});

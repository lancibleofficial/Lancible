// Переключатель (.switch): видно ли кружок и стоит ли он ровно. Запуск: npm run test:e2e
//
// Откуда взялось. 10 октября 2026 пожаловались на настройки: белый кружок на
// светло-зелёной дорожке не виден (1.8:1 в светлой теме, 1.3:1 в тёмной), а
// сам переключатель стоит неровно — кружок отступал от верха на 1 px, от низа
// на 3, и казалось, что он съехал. Мерялось глазом; теперь — числами.
//
// Что обещано. Включённый: дорожка — акцент, кружок — цветом текста на
// акцентной кнопке (--accent-text). Выключенный: дорожка заметна на фоне
// карточки, кружок читается на ней. Контраст кружка к дорожке — не ниже 3:1
// (WCAG 1.4.11, графический элемент) во всех четырёх сочетаниях. Переключатель
// стоит по центру строки, а его правый край — на одинаковом расстоянии от
// края строки во всех строках настроек.
const { test, expect } = require('@playwright/test');

const THEMES = ['dark', 'light'];

/** Контраст по WCAG 2 считается в самой странице, по вычисленным rgb():
 *  window.wcagRatio(a, b). */
const WCAG = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  window.wcagRatio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
})()`;

async function open(page, theme) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(WCAG);
  // Дорожка и кружок меняют цвет и положение плавно: без этого замер сразу
  // после переключения увидел бы середину перехода, а не итог.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await page.evaluate((th) => { state.settings.theme = th; applyTheme(); }, theme);
}

/** Настройки со строкой синхронизации: она есть только у вошедшего. */
async function openSettings(page) {
  await page.evaluate(() => {
    currentUser = { id: 'u1', email: 'turan@example.com', name: 'Turan' };
    state.ui.view = 'settings';
    render();
  });
}

for (const theme of THEMES) {
  test(`${theme}: кружок отличим от дорожки не меньше чем 3:1, включён он или выключен`, async ({ page }) => {
    await open(page, theme);
    const res = await page.evaluate(() => {
      const colorOf = (token) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      };
      const out = [];
      // Все переключатели страницы, в том числе спрятанные в окнах: стиль
      // у них считается и без показа.
      for (const sw of document.querySelectorAll('.switch')) {
        const track = sw.querySelector('.switch-track');
        const thumb = sw.querySelector('.switch-thumb');
        if (!track || !thumb) continue;
        for (const on of [true, false]) {
          sw.setAttribute('aria-pressed', String(on));
          const t = getComputedStyle(track).backgroundColor;
          const k = getComputedStyle(thumb).backgroundColor;
          out.push({ id: sw.id || sw.className, on, track: t, thumb: k, ratio: +window.wcagRatio(t, k).toFixed(2) });
        }
      }
      return { out, accentText: colorOf('--accent-text'), accent: colorOf('--accent') };
    });
    expect(res.out.length, 'переключателей на странице').toBeGreaterThanOrEqual(8);
    for (const r of res.out) {
      expect(r.ratio, `${r.id} ${r.on ? 'вкл' : 'выкл'}: кружок ${r.thumb} на дорожке ${r.track}`).toBeGreaterThanOrEqual(3);
      if (r.on) {
        expect(r.thumb, `${r.id}: включённый кружок — цвет текста на акцентной кнопке`).toBe(res.accentText);
        expect(r.track, `${r.id}: включённая дорожка — акцент`).toBe(res.accent);
      }
    }
  });

  test(`${theme}: выключенная дорожка заметна на фоне карточки настроек`, async ({ page }) => {
    await open(page, theme);
    await openSettings(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#settings-view .settings-row.switch')].map((row) => {
      row.setAttribute('aria-pressed', 'false');
      const card = getComputedStyle(row.closest('.settings-card')).backgroundColor;
      const track = getComputedStyle(row.querySelector('.switch-track')).backgroundColor;
      return { id: row.id, card, track, ratio: +window.wcagRatio(card, track).toFixed(2) };
    }));
    expect(rows.length, 'строк-переключателей в настройках').toBe(2);
    for (const r of rows) expect(r.ratio, `${r.id}: дорожка ${r.track} на карточке ${r.card}`).toBeGreaterThanOrEqual(1.5);
  });

  test(`${theme}: в настройках переключатель по центру строки и прижат к правому краю одинаково`, async ({ page }) => {
    await open(page, theme);
    await openSettings(page);
    for (const on of [true, false]) {
      const geo = await page.evaluate((on) => [...document.querySelectorAll('#settings-view .settings-row.switch')].map((row) => {
        row.setAttribute('aria-pressed', String(on));
        const r = row.getBoundingClientRect();
        const t = row.querySelector('.switch-track').getBoundingClientRect();
        const k = row.querySelector('.switch-thumb').getBoundingClientRect();
        return {
          id: row.id,
          centerDy: (t.top + t.bottom) / 2 - (r.top + r.bottom) / 2,
          rightGap: r.right - t.right,
          pad: parseFloat(getComputedStyle(row).paddingRight),
          thumbTop: k.top - t.top,
          thumbBottom: t.bottom - k.bottom,
          thumbLeft: k.left - t.left,
          thumbRight: t.right - k.right,
        };
      }), on);
      expect(geo.length).toBe(2);
      for (const g of geo) {
        expect(Math.abs(g.centerDy), `${g.id}: центр дорожки против центра строки`).toBeLessThanOrEqual(1);
        expect(Math.abs(g.rightGap - g.pad), `${g.id}: дорожка у края строки, внутри отступа`).toBeLessThanOrEqual(1);
        expect(Math.abs(g.thumbTop - g.thumbBottom), `${g.id}: кружок по вертикали в дорожке`).toBeLessThanOrEqual(0.5);
        const side = on ? g.thumbRight : g.thumbLeft;
        expect(Math.abs(side - g.thumbTop), `${g.id}: отступ кружка от торца равен отступу от верха`).toBeLessThanOrEqual(0.5);
      }
      expect(Math.abs(geo[0].rightGap - geo[1].rightGap), 'правый край во всех строках одинаков').toBeLessThanOrEqual(0.5);
    }
  });

  test(`${theme}: на календаре переключатель периода — по центру своей строки`, async ({ page }) => {
    await open(page, theme);
    await page.evaluate(() => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); });
    const sw = page.locator('#cal-period-toggle');
    await expect(sw).toBeVisible();
    const g = await sw.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = el.querySelector('.switch-track').getBoundingClientRect();
      return { dy: (t.top + t.bottom) / 2 - (r.top + r.bottom) / 2 };
    });
    expect(Math.abs(g.dy)).toBeLessThanOrEqual(1);
  });
}

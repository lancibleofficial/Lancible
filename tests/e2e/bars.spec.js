// Шкалы веба натекают, как ProgressBar телефона. Запуск: npm run test:e2e -- bars
//
// 18 октября 2026 пользователь попросил анимацию заполнения везде, где есть
// шкала: при первом показе — от нуля до значения, при смене значения —
// плавно от прежнего к новому, без движения — сразу. Одна общая деталь:
// класс .bar-fill и помощник barFill в app.js (пружина --spring-flow, 0,7 с).
//
// Места: прогресс в карточке «Проектов» и в недавних проектах «Сегодня»,
// статусы и версии справа на странице проекта, вкладка «Версии», часы дня
// в календаре месяца. Загрузку обновления (только десктоп) держит
// app-version.spec.js — значение в style; натекает она той же barFill.
//
// Мерим кодом: доля ширины заливки от дорожки по кадрам и getAnimations().
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

/** «Сайт»: четыре задачи, одна выполнена (25%), версия с двумя задачами из
 *  них одна выполнена (50%); сегодня записано 2 часа (25% от 8). */
async function seed(page, { reduce = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR }) => {
    const now = new Date();
    state.projects.push({ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
    seedProjectStatuses('p1');
    state.versions.push({ id: 'v1', projectId: 'p1', name: '1.0', order: 0, releasedAt: null });
    const st = (kind) => orderedStatuses('p1').find((s) => s.kind === kind).id;
    const at = (h) => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d; };
    const add = (id, title, extra = {}) => state.tasks.push({
      id, projectId: 'p1', title, done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
      createdAt: now.toISOString(), updatedAt: new Date(now.getTime() - HOUR).toISOString(),
      statusId: orderedStatuses('p1')[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('a', 'Альфа', { versionId: 'v1', sessions: [{ start: at(9).toISOString(), end: at(11).toISOString(), ms: 2 * HOUR }], totalMs: 2 * HOUR });
    add('b', 'Бета', { versionId: 'v1', done: true, doneAt: now.toISOString(), statusId: st('done') });
    add('c', 'Гамма');
    add('d', 'Дельта');
    state.ui.view = 'home';
    render();
  }, { HOUR });
}

/** Доля заливки от дорожки по кадрам, пока ms не прошло. */
const watchBar = (page, sel, ms = 900) => page.evaluate(async ({ sel, ms }) => {
  const share = () => {
    const f = document.querySelector(sel);
    return f ? f.getBoundingClientRect().width / f.parentElement.getBoundingClientRect().width : null;
  };
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    out.push(share());
    await new Promise((r) => requestAnimationFrame(r));
  }
  out.push(share());
  return out;
}, { sel, ms });

/** Заливки, которые ещё едут (анимации ширины на странице). */
const flowing = (page) => page.evaluate(() => document.getAnimations()
  .filter((a) => a.effect && a.effect.target && a.effect.target.classList.contains('bar-fill')).length);

test('шкала натекает от нуля при показе экрана, к новому значению — от прежнего', async ({ page }) => {
  await seed(page);
  const FILL = '.ptile[data-id="p1"] .ptile-progress > i';
  // Новый экран: заливка стартует у нуля и приходит к 25% (с упругим перехлёстом).
  await page.evaluate(() => openView('projects'));
  const show = await watchBar(page, FILL);
  expect(show[0], 'в первом кадре — далеко до значения').toBeLessThan(0.15);
  expect(Math.max(...show), 'дошла до значения').toBeGreaterThan(0.25);
  expect(Math.max(...show), 'перехлёст пружины небольшой').toBeLessThan(0.25 * 1.1);
  expect(show.at(-1)).toBeCloseTo(0.25, 2);
  for (let i = 1; i < show.length && show[i] < 0.24; i += 1) expect(show[i], `кадр ${i}: растёт`).toBeGreaterThanOrEqual(show[i - 1] - 0.002);
  await expect.poll(() => flowing(page)).toBe(0);
  expect(await page.locator(FILL).getAttribute('class')).toContain('bar-fill');
  expect(await page.locator(FILL).evaluate((n) => n.style.width)).toBe('25%');

  // Перерисовка с тем же значением ничего не играет.
  await page.evaluate(() => render());
  expect(await flowing(page)).toBe(0);
  expect(await page.locator(FILL).evaluate((n) => n.getBoundingClientRect().width / n.parentElement.getBoundingClientRect().width)).toBeCloseTo(0.25, 2);

  // Отметили задачу — 25% → 50%, от прежнего места, а не от нуля.
  await page.evaluate(() => document.querySelector('.ptile-task[data-id="c"] .task-done').click());
  const next = await watchBar(page, FILL);
  expect(next[0], 'стартует с прежнего значения').toBeGreaterThan(0.24);
  expect(next[0]).toBeLessThan(0.3);
  expect(next.some((v) => v > 0.3 && v < 0.45), 'есть кадр посередине').toBe(true);
  // Перерисовка посреди пути (строку отпускают через 0,6 с) шкалу не сбивает.
  for (let i = 1; i < next.length && next[i] < 0.49; i += 1) expect(next[i], `кадр ${i}`).toBeGreaterThanOrEqual(next[i - 1] - 0.002);
  await expect.poll(() => flowing(page)).toBe(0);
  expect(await page.locator(FILL).evaluate((n) => n.getBoundingClientRect().width / n.parentElement.getBoundingClientRect().width)).toBeCloseTo(0.5, 2);
});

test('все шкалы веба — общая .bar-fill, в конце ширина равна значению', async ({ page }) => {
  await seed(page);
  /** Дождаться, пока заливки встанут, и снять доли: селектор → доля. */
  const shares = async (sels) => {
    await expect.poll(() => flowing(page)).toBe(0);
    return page.evaluate((list) => Object.fromEntries(list.map((s) => {
      const f = document.querySelector(s);
      return [s, f ? { share: f.getBoundingClientRect().width / f.parentElement.getBoundingClientRect().width, cls: f.className } : null];
    })), sels);
  };
  const check = (got, sel, value) => {
    expect(got[sel], `${sel} есть`).toBeTruthy();
    expect(got[sel].cls, `${sel} — общая деталь`).toContain('bar-fill');
    expect(got[sel].share, sel).toBeCloseTo(value, 2);
  };

  // «Сегодня»: недавние проекты.
  let got = await shares(['.hp-card .hp-bar i']);
  check(got, '.hp-card .hp-bar i', 0.25);

  // Страница проекта: статусы (сегменты делят дорожку) и версия.
  await page.evaluate(() => openProject('p1'));
  got = await shares(['#pp-bar > i', '#pv-rows .pv-bar i']);
  expect(got['#pp-bar > i'].cls).toContain('bar-fill');
  check(got, '#pv-rows .pv-bar i', 0.5);
  const segs = await page.evaluate(() => [...document.querySelectorAll('#pp-bar > i')].map((n) => n.style.width));
  expect(segs).toEqual(['75%', '25%']);

  // Вкладка «Версии».
  await page.evaluate(() => { state.ui.projectTab = 'versions'; render(); });
  got = await shares(['.pver-row .pver-fill']);
  check(got, '.pver-row .pver-fill', 0.5);

  // Календарь месяца: часы дня (2 из 8).
  await page.evaluate(() => { openView('time'); setTimeMode('month'); });
  got = await shares(['.cal-cell.today .cc-bar']);
  expect(got['.cal-cell.today .cc-bar'].cls).toContain('bar-fill');
  expect(await page.locator('.cal-cell.today .cc-bar').evaluate((n) => n.style.width)).toBe('25%');
});

test('без движения — шкала сразу на значении, анимаций нет', async ({ page }) => {
  await seed(page, { reduce: true });
  await page.evaluate(() => openView('projects'));
  const FILL = '.ptile[data-id="p1"] .ptile-progress > i';
  const show = await watchBar(page, FILL, 200);
  for (const v of show) expect(v).toBeCloseTo(0.25, 2);
  expect(await flowing(page)).toBe(0);
  await page.evaluate(() => document.querySelector('.ptile-task[data-id="c"] .task-done').click());
  expect(await flowing(page)).toBe(0);
  expect(await page.locator(FILL).evaluate((n) => n.getBoundingClientRect().width / n.parentElement.getBoundingClientRect().width)).toBeCloseTo(0.5, 2);
});

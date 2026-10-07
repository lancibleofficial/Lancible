// Доступность веба: имена у элементов управления и работа с клавиатуры.
// Запуск: npm run test:e2e
//
// Читалка экрана называет кнопку по тексту, aria-label или title. Кнопка-
// значок без всего этого звучит как «кнопка» — и непонятно, что она делает.
// Мерить это по разметке нельзя: половина кнопок получает текст из скрипта
// (дата, статус, валюта), поэтому проверяем отрисованную страницу.
const { test, expect } = require('@playwright/test');

const open = async (page) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  // Немного данных, чтобы на экранах были строки, а не только пустые состояния.
  await page.evaluate(() => {
    const p = { id: 'p1', name: 'Проект', color: '#7c5cff', createdAt: new Date().toISOString() };
    state.projects.push(p);
    state.tasks.push({ id: 't1', projectId: 'p1', title: 'Задача', done: false, sessions: [], createdAt: new Date().toISOString() });
    render();
  });
};

/** Видимые элементы управления без доступного имени. */
const unnamed = (page) => page.evaluate(() => {
  const name = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
    return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      || (el.querySelector('img[alt]') || {}).alt || '';
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  return [...document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')]
    .filter(visible)
    .filter((el) => !el.closest('[aria-hidden="true"]'))
    .filter((el) => {
      if (el.matches('input, textarea, select')) {
        return !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute('aria-label') && !el.getAttribute('placeholder') && !el.getAttribute('title');
      }
      return !name(el);
    })
    .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} в ${el.parentElement.id || el.parentElement.className}`);
});

for (const view of ['home', 'projects', 'time', 'settings']) {
  test(`у каждого элемента управления есть имя — экран ${view}`, async ({ page }) => {
    await open(page);
    await page.evaluate((v) => { state.ui.view = v; render(); }, view);
    expect(await unnamed(page)).toEqual([]);
  });
}

test('у значков-картинок в вебе есть alt', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src));
  expect(bad).toEqual([]);
});

test('фокус с клавиатуры виден на первых двадцати остановках Tab', async ({ page }) => {
  // Видимый фокус — это любая заметная перемена: обводка, тень, рамка или
  // фон — у самого элемента или у обёртки (поиск подсвечивает рамку обёртки
  // через :focus-within). Поля ввода показывают фокус рамкой, кнопки —
  // обводкой, и оба способа годятся. Не годится только «ничего не поменялось».
  await open(page);
  // Переходы выключены: иначе сразу после blur стиль ещё «в пути» и
  // совпадает с фокусным — тест увидел бы слепоту, которой нет.
  await page.addStyleTag({ content: '*{transition:none !important; animation:none !important;}' });
  const look = () => page.evaluate(() => {
    const el = document.activeElement;
    const sig = (n) => { const cs = getComputedStyle(n); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|'); };
    return { id: `${el.tagName}#${el.id}.${el.className}`, s: sig(el) + sig(el.parentElement) };
  });
  const blind = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await look();
    if (focused.id.startsWith('BODY')) continue;
    const plain = await page.evaluate(() => {
      const el = document.activeElement;
      // Тот же элемент без фокуса: снимаем его на миг и смотрим снова.
      el.blur();
      const sig = (n) => { const cs = getComputedStyle(n); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|'); };
      const s = sig(el) + sig(el.parentElement);
      el.focus({ focusVisible: true });
      return s;
    });
    if (plain === focused.s) blind.push(focused.id);
  }
  expect(blind).toEqual([]);
});

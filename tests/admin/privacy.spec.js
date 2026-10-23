// Политика (§9): админка не показывает содержимое проектов, задач, заметок и
// переписки с агентом, а сведения о входах — без IP-адресов. Только числа,
// даты, почта, платформы, тексты отзывов и наших ответов.
//
// Два сторожа: в подменённых ответах контракта таких полей нет, и если
// функция по ошибке пришлёт поле вроде ip, title, notes, content, — разделы
// его не нарисуют: каждый рисует только свои поля по имени.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./mock');

/** Поля, которых в данных о людях быть не должно. */
const FORBIDDEN = ['ip', 'ip_address', 'ipAddress', 'title', 'name', 'notes', 'note_text', 'content', 'messages', 'prompt', 'description', 'projectNames', 'taskTitles', 'document', 'documents'];

/** Действия с данными о людях. У блога и выпусков title — наш собственный
 *  текст (заголовок поста, название запуска), его эти правила не касаются. */
const PEOPLE = ['overview', 'screens', 'users', 'user', 'feedback.list'];

function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

test('в подменённых ответах о людях нет запретных полей', async ({ page, open }) => {
  const backend = await open({ signedIn: 'aal2' });
  void page;
  for (const action of PEOPLE) {
    const res = await backend.handlers[action]({ action, days: 30, id: 'u-1', q: '' }, backend);
    const bad = [...keysDeep(res)].filter((k) => FORBIDDEN.includes(k));
    expect(bad, `${action}: поля, которых админка показывать не должна`).toEqual([]);
  }
});

/** Метки, которые нельзя увидеть на странице ни в одном разделе. */
const LEAK = {
  ip: '203.0.113.77',
  ip_address: '198.51.100.23',
  title: 'ЗАГОЛОВОК-ПРОЕКТА-УТЕЧКА',
  name: 'ИМЯ-ПРОЕКТА-УТЕЧКА',
  notes: 'ЗАМЕТКА-УТЕЧКА',
  content: 'СОДЕРЖИМОЕ-УТЕЧКА',
  prompt: 'ВОПРОС-АГЕНТУ-УТЕЧКА',
  description: 'ОПИСАНИЕ-ЗАДАЧИ-УТЕЧКА',
};
const leaky = (o) => ({ ...o, ...LEAK, messages: [{ role: 'user', content: 'ПЕРЕПИСКА-УТЕЧКА' }], projectNames: ['ПРОЕКТ-УТЕЧКА'] });

test('лишние поля из функции админка не рисует', async ({ page, open }) => {
  const backend = await open({ signedIn: 'aal2' });
  const base = { ...backend.handlers };
  const wrap = (action, fix) => { backend.handlers[action] = async (body, b) => fix(await base[action](body, b)); };
  wrap('overview', (r) => leaky({ ...r, logins: leaky({ ...r.logins, series: r.logins.series.map(leaky) }), users: leaky(r.users) }));
  wrap('screens', (r) => ({ ...r, rows: r.rows.map(leaky) }));
  wrap('users', (r) => ({ ...r, rows: r.rows.map(leaky) }));
  wrap('user', (r) => ({ ...r, user: leaky(r.user), feedback: r.feedback.map(leaky), aiCalls: r.aiCalls.map(leaky), sessions: [leaky({ createdAt: '2026-10-22T08:00:00Z' })] }));
  wrap('feedback.list', (r) => ({ ...r, rows: r.rows.map((f) => leaky({ ...f, replies: [leaky({ body: 'Наш ответ', emailStatus: 'sent' })] })) }));

  const marks = [...Object.values(LEAK), 'ПЕРЕПИСКА-УТЕЧКА', 'ПРОЕКТ-УТЕЧКА'];
  for (const hash of ['#/overview', '#/screens', '#/users', '#/users/u-1', '#/feedback']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('.page-body > *').first()).toBeVisible();
    await expect(page.locator('.note[aria-busy]')).toHaveCount(0);
    // Видимый текст, подсказки и атрибуты — всё, где строка могла бы осесть.
    const all = await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('#app *')].map((el) => [...el.attributes].map((a) => a.value).join(' ')).join(' '));
    const shown = marks.filter((m) => all.includes(m));
    expect(shown, `${hash}: показано то, чего админка показывать не должна`).toEqual([]);
  }
  // Тексты отзывов и наших ответов — показываются, это их место.
  await expect(page.locator('.fb-card[data-id="f-1"] .fb-text')).toHaveText('Таймер сбивается после сна');
  await expect(page.locator('.fb-card[data-id="f-1"] .reply-text')).toHaveText('Наш ответ');
});

test('разделы о людях не обращаются к полям содержимого', () => {
  // Сторож в исходниках: раздел, взявший .content или .ip, — уже ошибка,
  // даже если сейчас функция этого поля не шлёт.
  const dir = path.join(__dirname, '..', '..', 'admin', 'js', 'sections');
  const found = [];
  for (const f of ['overview.js', 'usage.js', 'users.js', 'feedback.js']) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/\.(ip|ip_address|ipAddress|notes|content|messages|prompt|description|projectNames|taskTitles)\b/g)) found.push(`${f}: ${m[0]}`);
  }
  expect(found).toEqual([]);
});

// Удаление аккаунта стирает картинки в облаке раньше аккаунта.
// Запуск: npm run test:e2e
//
// Откуда тест. Картинки редактора лежат в хранилище Supabase, в папке
// doc-assets/<id пользователя>/, и каскадом за аккаунтом не уходят: SQL до
// байтов в хранилище не достаёт. С 10 октября 2026 страж в базе
// (supabase/storage.sql, guard_account_assets) не даёт удалить аккаунт, пока
// в папке есть файлы. Значит, клиент обязан сначала стереть папку через
// Storage API и только потом звать delete_my_account — и ровно этот порядок
// здесь проверяется.
//
// Войти в Supabase из теста нельзя, поэтому хранилище и вызов функции
// подменяются в самой странице: файлы живут в памяти, а каждый вызов
// пишется в журнал window.__calls.
const { test, expect } = require('@playwright/test');

/**
 * Открыть настройки вошедшим пользователем u1 с подменённым облаком.
 * @param files      имена файлов в doc-assets/u1/
 * @param remove     'ok' | 'error' | 'noop' — как отвечает remove
 * @param rpcAnswers по одному ответу на каждый вызов delete_my_account:
 *                   'ok' | 'remain' (страж: в папке снова файл) | 'error'
 */
async function signedIn(page, { files = [], remove = 'ok', rpcAnswers = ['ok'] } = {}) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.locator('.nav-item[data-view="settings"]').first().click();
  await page.evaluate(({ files, remove, rpcAnswers }) => {
    currentUser = { id: 'u1', email: 'test@example.com', name: null };
    const folder = { files: files.slice() };
    window.__calls = [];
    window.__pausedDuringList = [];
    sb.storage.from = (bucket) => ({
      async list(prefix, opts) {
        window.__calls.push(`list ${bucket}/${prefix} limit=${opts && opts.limit}`);
        window.__pausedDuringList.push(assetsPaused);
        // Папка-заглушка без id — такие хранилище тоже отдаёт; стирать её нечем.
        return { data: [{ id: null, name: 'sub' }, ...folder.files.map((n) => ({ id: `id-${n}`, name: n }))], error: null };
      },
      async remove(paths) {
        window.__calls.push(`remove ${paths.join(' ')}`);
        if (remove === 'error') return { data: null, error: { message: 'storage is down' } };
        // Правило доступа не пустило — ошибкой хранилище не отвечает.
        if (remove === 'noop') return { data: [], error: null };
        folder.files = folder.files.filter((n) => !paths.includes(`u1/${n}`));
        return { data: paths.map((p) => ({ name: p })), error: null };
      },
    });
    let n = 0;
    sb.rpc = async (name) => {
      window.__calls.push(`rpc ${name}`);
      const answer = rpcAnswers[n++] || 'ok';
      if (answer === 'remain') {
        // Загрузка, начатая до паузы, успела доехать.
        folder.files.push('late.png');
        return { data: null, error: { message: 'account assets remain' } };
      }
      if (answer === 'error') return { data: null, error: { message: 'network' } };
      return { data: null, error: null };
    };
    renderSettings();
  }, { files, remove, rpcAnswers });
}

async function confirmDelete(page) {
  await page.locator('#settings-delete-row').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-ok').click();
}

const calls = (page) => page.evaluate(() => window.__calls);
const signedOut = (page) => page.evaluate(() => currentUser === null);

test('сначала стирается папка картинок, потом удаляется аккаунт', async ({ page }) => {
  await signedIn(page, { files: ['a.webp', 'b.png'] });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([
    'list doc-assets/u1 limit=1000',
    'remove u1/a.webp u1/b.png', // папка-заглушка без id не стирается
    'list doc-assets/u1 limit=1000', // пусто — можно удалять аккаунт
    'rpc delete_my_account',
  ]);
  await expect(page.locator('#toast')).toHaveText('Аккаунт удалён');
});

test('пока стирается папка, картинки в облако не уходят, после — снова уходят', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'] });
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await page.evaluate(() => window.__pausedDuringList)).toEqual([true, true]);
  // Пауза снята: следующий вход в аккаунт снова получит облако картинок.
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
});

test('пустая папка — аккаунт удаляется сразу', async ({ page }) => {
  await signedIn(page, { files: [] });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual(['list doc-assets/u1 limit=1000', 'rpc delete_my_account']);
});

test('ошибка при стирании — аккаунт не удаляется, человек видит причину', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], remove: 'error' });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText('Не удалось удалить аккаунт. Проверьте соединение и попробуйте ещё раз.');
  expect(await calls(page)).toEqual(['list doc-assets/u1 limit=1000', 'remove u1/a.webp']);
  expect(await signedOut(page)).toBe(false);
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
});

test('хранилище молча ничего не стёрло — не крутимся вечно и аккаунт не трогаем', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], remove: 'noop' });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText('Не удалось удалить аккаунт. Проверьте соединение и попробуйте ещё раз.');
  expect(await calls(page)).toEqual(['list doc-assets/u1 limit=1000', 'remove u1/a.webp']);
  expect(await signedOut(page)).toBe(false);
});

test('файл доехал между стиранием и удалением — один повтор', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], rpcAnswers: ['remain', 'ok'] });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([
    'list doc-assets/u1 limit=1000',
    'remove u1/a.webp',
    'list doc-assets/u1 limit=1000',
    'rpc delete_my_account',
    'list doc-assets/u1 limit=1000',
    'remove u1/late.png',
    'list doc-assets/u1 limit=1000',
    'rpc delete_my_account',
  ]);
});

test('страж отказал и при повторе — повторов больше нет, аккаунт остался', async ({ page }) => {
  await signedIn(page, { files: [], rpcAnswers: ['remain', 'remain', 'ok'] });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText('Не удалось удалить аккаунт. Проверьте соединение и попробуйте ещё раз.');
  expect((await calls(page)).filter((c) => c.startsWith('rpc'))).toEqual(['rpc delete_my_account', 'rpc delete_my_account']);
  expect(await signedOut(page)).toBe(false);
});

test('другая ошибка удаления не повторяется', async ({ page }) => {
  await signedIn(page, { files: [], rpcAnswers: ['error', 'ok'] });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText('Не удалось удалить аккаунт. Проверьте соединение и попробуйте ещё раз.');
  expect((await calls(page)).filter((c) => c.startsWith('rpc'))).toEqual(['rpc delete_my_account']);
  expect(await signedOut(page)).toBe(false);
});

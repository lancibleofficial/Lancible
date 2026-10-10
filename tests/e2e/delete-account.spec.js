// Удаление аккаунта: серверная функция delete-account, а без неё — старый
// путь, в котором клиент сам стирает картинки раньше аккаунта.
// Запуск: npm run test:e2e
//
// Откуда тест. Картинки редактора лежат в хранилище Supabase, в папке
// doc-assets/<id пользователя>/, и каскадом за аккаунтом не уходят: SQL до
// байтов в хранилище не достаёт. С 10 октября 2026 страж в базе
// (supabase/storage.sql, guard_account_assets) не даёт удалить аккаунт, пока
// в папке есть файлы. Сначала клиент стирал папку сам и звал
// delete_my_account; теперь оба шага делает Edge Function delete-account
// (supabase/functions/delete-account), а старый путь остался на случай,
// когда функции нет (404) или до неё не дошли.
//
// Ответы функции: 200 — удалено; 409 — картинки стереть не вышло, аккаунт
// цел; 500 — картинки стёрты, аккаунт цел. Что именно стёрто, функция не
// говорит, поэтому клиент заранее читает свою папку и при 409 и 500
// возвращает в облако всё прочитанное, что есть у него на устройстве.
//
// Войти в Supabase из теста нельзя, поэтому хранилище, функция и вызов
// delete_my_account подменяются в самой странице: файлы живут в памяти, а
// каждый вызов пишется в журнал window.__calls.
const { test, expect } = require('@playwright/test');

// Две причины отказа — две строки (core/i18n.js): картинки не стёрлись
// (account.delete_assets_error, как на телефоне) и всё остальное
// (account.delete_error).
const ASSETS_ERROR = 'Не удалось стереть картинки из заметок, поэтому аккаунт не удалён. Попробуйте ещё раз.';
const DELETE_ERROR = 'Не удалось удалить аккаунт. Проверьте соединение и попробуйте ещё раз.';

// Первые два шага при любом ответе функции: чтение папки и вызов функции.
const PRE = ['list doc-assets/u1 limit=1000 offset=0', 'invoke delete-account'];
// Старый путь: стирание папки до пустоты и delete_my_account.
const LIST = 'list doc-assets/u1 limit=1000 offset=0';

/**
 * Открыть настройки вошедшим пользователем u1 с подменённым облаком.
 * @param files      имена файлов в doc-assets/u1/
 * @param fn         ответ функции delete-account: 200 | 409 | 500 | 401 |
 *                   404 (функции нет) | 'network' (до неё не дошли)
 * @param list       'ok' | 'error' — как отвечает list
 * @param remove     'ok' | 'error' | 'noop' — как отвечает remove
 * @param rpcAnswers по одному ответу на каждый вызов delete_my_account:
 *                   'ok' | 'remain' (страж: в папке снова файл) | 'error'
 */
async function signedIn(page, { files = [], fn = 200, list = 'ok', remove = 'ok', rpcAnswers = ['ok'] } = {}) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.locator('.nav-item[data-view="settings"]').first().click();
  await page.evaluate(({ files, fn, list, remove, rpcAnswers }) => {
    currentUser = { id: 'u1', email: 'test@example.com', name: null };
    const folder = { files: files.slice() };
    window.__calls = [];
    window.__pausedDuringList = [];
    window.__requeued = null;
    sb.storage.from = (bucket) => ({
      async list(prefix, opts) {
        const offset = (opts && opts.offset) || 0;
        window.__calls.push(`list ${bucket}/${prefix} limit=${opts && opts.limit} offset=${offset}`);
        window.__pausedDuringList.push(assetsPaused);
        if (list === 'error') return { data: null, error: { message: 'storage is down' } };
        // Папка-заглушка без id — такие хранилище тоже отдаёт; стирать её нечем.
        const all = [{ id: null, name: 'sub' }, ...folder.files.map((n) => ({ id: `id-${n}`, name: n }))];
        return { data: all.slice(offset, offset + opts.limit), error: null };
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
    // Ошибки — той же формы, что у supabase-js: код ответа в context.status.
    const httpError = (status) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status } });
    // sb.functions — геттер: каждый раз новый клиент, поэтому подменяется само
    // свойство, а не метод на временном объекте.
    const invoke = async (name) => {
      window.__calls.push(`invoke ${name}`);
      if (fn === 'network') return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } };
      if (fn === 200) { folder.files = []; return { data: { deleted: true }, error: null }; }
      // 409: часть картинок сервер успел стереть. 500: стёр всё, аккаунт цел.
      if (fn === 409) folder.files = folder.files.slice(1);
      if (fn === 500) folder.files = [];
      return { data: null, error: httpError(fn) };
    };
    Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke } });
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
    if (editorAssets) {
      const requeue = editorAssets.requeue.bind(editorAssets);
      editorAssets.requeue = (ids) => { window.__requeued = ids ? ids.slice() : 'all'; return requeue(ids); };
    }
    renderSettings();
  }, { files, fn, list, remove, rpcAnswers });
}

/** Облако картинок «вошедшего»: хранилище картинок получает токен, а его
 *  выгрузки перехватываются и пишутся в массив адресов. */
async function cloudUploads(page) {
  const uploads = [];
  await page.route('**/storage/v1/object/doc-assets/u1/*', (route) => {
    if (route.request().method() === 'POST') uploads.push(route.request().url().split('/').pop());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.evaluate(() => { assetAuth = { token: 'test-token', userId: 'u1' }; });
  return uploads;
}

/** Картинка, которая есть на этом устройстве и уже выгружена в облако. */
async function localImage(page, id) {
  await page.evaluate((id) => new Promise((resolve, reject) => {
    const req = indexedDB.open('lancible-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ blob: new Blob(['png'], { type: 'image/png' }), type: 'image/png', pending: false }, id);
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), id);
}

async function confirmDelete(page) {
  await page.locator('#settings-delete-row').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-ok').click();
}

const calls = (page) => page.evaluate(() => window.__calls);
const requeued = (page) => page.evaluate(() => window.__requeued);
const signedOut = (page) => page.evaluate(() => currentUser === null);

// --- функция delete-account ----------------------------------------------------

test('200 — аккаунт удалён одним вызовом функции, клиент выходит', async ({ page }) => {
  await signedIn(page, { files: ['a.webp', 'b.png'], fn: 200 });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual(PRE);
  await expect(page.locator('#toast')).toHaveText('Аккаунт удалён');
});

test('409 — аккаунт цел, «не стёрлись картинки», прочитанное возвращается в облако', async ({ page }) => {
  // Сервер успел стереть a.webp: что именно, он не говорит, поэтому
  // возвращается всё прочитанное заранее, что есть на устройстве.
  await signedIn(page, { files: ['a.webp', 'b.png'], fn: 409 });
  await localImage(page, 'a.webp');
  const uploads = await cloudUploads(page);
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(ASSETS_ERROR);
  expect(await calls(page)).toEqual(PRE);
  expect(await requeued(page)).toEqual(['a.webp', 'b.png']);
  await expect.poll(() => uploads).toEqual(['a.webp']);
  expect(await signedOut(page)).toBe(false);
});

test('500 — картинки стёрты, аккаунт цел: общая ошибка, картинки возвращаются', async ({ page }) => {
  await signedIn(page, { files: ['a.webp', 'b.png'], fn: 500 });
  await localImage(page, 'b.png');
  const uploads = await cloudUploads(page);
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  expect(await calls(page)).toEqual(PRE);
  expect(await requeued(page)).toEqual(['a.webp', 'b.png']);
  await expect.poll(() => uploads).toEqual(['b.png']);
  expect(await signedOut(page)).toBe(false);
});

test('401 и прочие отказы — общая ошибка, старый путь не зовётся и возвращать нечего', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 401 });
  await localImage(page, 'a.webp');
  const uploads = await cloudUploads(page);
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  expect(await calls(page)).toEqual(PRE);
  expect(await requeued(page)).toBeNull();
  await page.waitForTimeout(300);
  expect(uploads).toEqual([]);
  expect(await signedOut(page)).toBe(false);
});

test('папку прочитать не вышло — функцию не зовём, общая ошибка', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], list: 'error' });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  expect(await calls(page)).toEqual([LIST]);
  expect(await signedOut(page)).toBe(false);
});

test('папка читается страницами по 1000, и возвращается всё прочитанное', async ({ page }) => {
  const files = Array.from({ length: 1500 }, (_, i) => `f${i}`);
  await signedIn(page, { files, fn: 500 });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  // Заглушка «sub» занимает место на первой странице: 1001 запись — две
  // страницы, вторая неполная.
  expect(await calls(page)).toEqual(['list doc-assets/u1 limit=1000 offset=0', 'list doc-assets/u1 limit=1000 offset=1000', 'invoke delete-account']);
  expect((await requeued(page)).length).toBe(1500);
});

test('функции нет (404) — старый путь: стирание папки, потом delete_my_account', async ({ page }) => {
  await signedIn(page, { files: ['a.webp', 'b.png'], fn: 404 });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([
    ...PRE,
    LIST,
    'remove u1/a.webp u1/b.png', // папка-заглушка без id не стирается
    LIST, // пусто — можно удалять аккаунт
    'rpc delete_my_account',
  ]);
  await expect(page.locator('#toast')).toHaveText('Аккаунт удалён');
});

test('до функции не дошли (сеть) — тот же старый путь', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 'network' });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([...PRE, LIST, 'remove u1/a.webp', LIST, 'rpc delete_my_account']);
});

// --- старый путь (функции нет) ------------------------------------------------

test('пока идёт удаление, картинки в облако не уходят, после — снова уходят', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 404 });
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await page.evaluate(() => window.__pausedDuringList)).toEqual([true, true, true]);
  // Пауза снята: следующий вход в аккаунт снова получит облако картинок.
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
});

test('старый путь: пустая папка — аккаунт удаляется сразу', async ({ page }) => {
  await signedIn(page, { files: [], fn: 404 });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([...PRE, LIST, 'rpc delete_my_account']);
});

test('старый путь: ошибка при стирании — аккаунт не удаляется, «не стёрлись картинки»', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 404, remove: 'error' });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(ASSETS_ERROR);
  expect(await calls(page)).toEqual([...PRE, LIST, 'remove u1/a.webp']);
  expect(await signedOut(page)).toBe(false);
  expect(await page.evaluate(() => assetsPaused)).toBe(false);
});

test('старый путь: хранилище молча ничего не стёрло — не крутимся вечно', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 404, remove: 'noop' });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(ASSETS_ERROR);
  expect(await calls(page)).toEqual([...PRE, LIST, 'remove u1/a.webp']);
  expect(await signedOut(page)).toBe(false);
});

test('старый путь: файл доехал между стиранием и удалением — один повтор', async ({ page }) => {
  await signedIn(page, { files: ['a.webp'], fn: 404, rpcAnswers: ['remain', 'ok'] });
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  expect(await calls(page)).toEqual([
    ...PRE,
    LIST, 'remove u1/a.webp', LIST, 'rpc delete_my_account',
    LIST, 'remove u1/late.png', LIST, 'rpc delete_my_account',
  ]);
});

test('старый путь: страж отказал и при повторе — повторов больше нет, аккаунт остался', async ({ page }) => {
  await signedIn(page, { files: [], fn: 404, rpcAnswers: ['remain', 'remain', 'ok'] });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(ASSETS_ERROR);
  expect((await calls(page)).filter((c) => c.startsWith('rpc'))).toEqual(['rpc delete_my_account', 'rpc delete_my_account']);
  expect(await signedOut(page)).toBe(false);
});

test('старый путь: папка стёрта, а аккаунт остался — стёртое с устройства снова уходит в облако', async ({ page }) => {
  // Сбой сети между стиранием и удалением: без возврата картинки пропали бы
  // на других устройствах. img2 на этом устройстве нет — вернуть её нечем.
  await signedIn(page, { files: ['img1', 'img2'], fn: 404, rpcAnswers: ['error'] });
  await localImage(page, 'img1');
  const uploads = await cloudUploads(page);
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  await expect.poll(() => uploads).toEqual(['img1']);
  expect(await signedOut(page)).toBe(false);
});

test('старый путь: другая ошибка удаления не повторяется', async ({ page }) => {
  await signedIn(page, { files: [], fn: 404, rpcAnswers: ['error', 'ok'] });
  await confirmDelete(page);
  await expect(page.locator('#toast')).toHaveText(DELETE_ERROR);
  expect((await calls(page)).filter((c) => c.startsWith('rpc'))).toEqual(['rpc delete_my_account']);
  expect(await signedOut(page)).toBe(false);
});

// --- возврат картинок ---------------------------------------------------------

test('requeue без списка возвращает в очередь все картинки устройства', async ({ page }) => {
  // Так зовёт телефон: в момент сбоя его редактор обычно закрыт, и список
  // стёртого он не держит — возвращает всё при следующем открытии.
  await signedIn(page);
  await localImage(page, 'img1');
  await localImage(page, 'img2');
  const uploads = await cloudUploads(page);
  expect(await page.evaluate(() => editorAssets.requeue())).toBe(2);
  await page.evaluate(() => editorAssets.flush());
  await expect.poll(() => uploads.slice().sort()).toEqual(['img1', 'img2']);
});

test('аккаунт удалён — картинки в облако не возвращаются', async ({ page }) => {
  await signedIn(page, { files: ['img1'], fn: 200 });
  await localImage(page, 'img1');
  const uploads = await cloudUploads(page);
  await confirmDelete(page);
  await expect.poll(() => signedOut(page)).toBe(true);
  await page.waitForTimeout(300);
  expect(uploads).toEqual([]);
});

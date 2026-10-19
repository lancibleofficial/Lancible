// Вложения в чате агента на вебе (круг 20, 18 октября 2026): скрепка,
// перетаскивание на панель и вставка из буфера; проверка по байтам
// (Core.aiCheckAttachment); перекодировка картинок на устройстве (длинная
// сторона ≤ 1568, JPEG, PNG при прозрачности; без EXIF и всего, что
// дописано в файл); блоки Core.aiAttachmentBlocks перед текстом; после хода
// байтов нет ни в истории, ни в localStorage — только плашка «имя · тип ·
// размер»; 400 bad attachment — строкой у сообщения.
// Запуск: npm run test:e2e -- ai-attach
//
// Файлы собираются в самой странице (canvas → PNG/JPEG, байты руками) и
// подаются так же, как их подал бы человек: в поле выбора файла, событием
// drop на панель, событием paste в поле ввода.
const { test, expect } = require('@playwright/test');
const { stream, fn, open, signIn, input, openChat, savedChat, send } = require('./ai-helpers');

/** Сборщики файлов в странице: window.__mkFiles(specs) → [File]. */
async function installMakers(page) {
  await page.evaluate(() => {
    const cat = (...parts) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      return out;
    };
    const enc = (s) => new TextEncoder().encode(s);
    const canvasBytes = async (w, h, type, alpha) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      if (alpha) {
        x.clearRect(0, 0, w, h);
        x.fillStyle = 'rgba(30, 140, 90, 0.5)';
        x.fillRect(0, 0, w / 2, h);
      } else {
        x.fillStyle = 'rgb(40, 160, 110)';
        x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgb(250, 250, 250)';
        x.fillRect(10, 10, w / 3, h / 3);
      }
      const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
      return new Uint8Array(await blob.arrayBuffer());
    };
    /** APP1 Exif с поворотом (Orientation) и меткой в теле — сразу за SOI. */
    const withExif = (jpeg, orientation, marker) => {
      const tiff = cat(
        enc('MM'), new Uint8Array([0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]),
        new Uint8Array([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00]),
        new Uint8Array([0x00, 0x00, 0x00, 0x00]),
        enc(marker),
      );
      const body = cat(enc('Exif'), new Uint8Array([0, 0]), tiff);
      const len = body.length + 2;
      return cat(jpeg.subarray(0, 2), new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff]), body, jpeg.subarray(2));
    };
    window.__mkFiles = async (specs) => {
      const out = [];
      for (const s of specs) {
        let bytes;
        if (s.kind === 'png') bytes = await canvasBytes(s.w, s.h, 'image/png', s.alpha);
        else if (s.kind === 'jpeg') bytes = await canvasBytes(s.w, s.h, 'image/jpeg', false);
        else if (s.kind === 'text') bytes = enc(s.text);
        else bytes = new Uint8Array(s.bytes);
        if (s.exif) bytes = withExif(bytes, s.exif, s.marker || '');
        if (s.tail) bytes = cat(bytes, enc(s.tail));
        out.push(new File([bytes], s.name, { type: s.type || '' }));
      }
      return out;
    };
    window.__dt = (files) => { const dt = new DataTransfer(); for (const f of files) dt.items.add(f); return dt; };
  });
}

/** Скрепка: файлы — в поле выбора, как из системного окна. */
const pick = (page, specs) => page.evaluate(async (s) => {
  const input = document.getElementById('ai-file');
  input.files = window.__dt(await window.__mkFiles(s)).files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, specs);

/** Перетаскивание на панель: dragenter → dragover → (проверка) → drop. */
const dragOver = (page, specs) => page.evaluate(async (s) => {
  const dt = window.__dt(await window.__mkFiles(s));
  window.__drag = dt;
  const target = document.getElementById('ai-panel');
  target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, specs);
const drop = (page) => page.evaluate(() => {
  document.getElementById('ai-panel').dispatchEvent(new DragEvent('drop', { dataTransfer: window.__drag, bubbles: true, cancelable: true }));
});

/** Ctrl+V с картинкой в буфере. */
const paste = (page, specs) => page.evaluate(async (s) => {
  const dt = window.__dt(await window.__mkFiles(s));
  return document.getElementById('ai-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, specs);

/** Что внутри base64 из тела запроса: размеры картинки, есть ли в байтах строки. */
const inspect = (page, data, needles = []) => page.evaluate(async ({ b64, find }) => {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes]));
  return { w: bmp.width, h: bmp.height, size: bytes.length, found: find.filter((n) => bin.includes(n)) };
}, { b64: data, find: needles });

const chips = (page) => page.locator('#ai-attach-list .ai-chip');
const attachError = (page) => page.locator('#ai-attach-error');

async function openWithMakers(page, opts) {
  await open(page, { signedIn: true, ...opts });
  await installMakers(page);
}

test('скрепка: PNG перекодируется (≤ 1568 px, JPEG) и уходит блоком image перед текстом; после хода — только плашка', async ({ page }) => {
  await openWithMakers(page);
  const calls = await fn(page, [stream({ text: ['Вижу макет.'] }), stream({ text: ['Дальше.'] })]);
  await openChat(page);
  await expect(page.locator('#ai-attach')).toHaveAttribute('title', 'Приложить файл');
  await expect(page.locator('#ai-attach svg[data-icon="paperclip"]')).toHaveCount(1);
  expect(await page.locator('#ai-file').getAttribute('accept'), 'окно выбора — расширения из AI_ATTACH').toBe(await page.evaluate(() => Core.AI_ATTACH.accept));
  await pick(page, [{ kind: 'png', w: 2000, h: 1000, name: 'plan.png', type: 'image/png' }]);
  await expect(chips(page)).toHaveCount(1);
  const thumb = chips(page).locator('img.ai-chip-thumb');
  await expect(thumb, 'у картинки — миниатюра').toHaveAttribute('src', /^blob:/);
  await expect(attachError(page)).toBeHidden();
  await expect(page.locator('#ai-send'), 'с вложением можно отправить').toBeEnabled();

  await send(page, 'Разбери картинку');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Вижу макет.');
  await expect(page.locator('#ai-attach-list'), 'после отправки поле без вложений').toBeHidden();

  const content = calls[0].body.messages[0].content;
  expect(content.map((b) => b.type), 'блоки вложений — перед текстом').toEqual(['image', 'text']);
  expect(content[1]).toEqual({ type: 'text', text: 'Разбери картинку' });
  expect(content[0].source).toMatchObject({ type: 'base64', media_type: 'image/jpeg' });
  const img = await inspect(page, content[0].source.data);
  expect([img.w, img.h], 'длинная сторона — 1568').toEqual([1568, 784]);

  // В ленте — плашка «имя · тип · размер», без миниатюры.
  const plate = page.locator('.ai-msg.me .ai-file');
  await expect(plate).toHaveCount(1);
  await expect(plate.locator('.ai-file-name')).toHaveText('plan.png');
  await expect(plate.locator('.ai-file-meta')).toHaveText(/^· JPEG · \d+ КБ$/);
  await expect(page.locator('.ai-msg.me img')).toHaveCount(0);
  await expect(page.locator('.ai-msg.me')).toContainText('Разбери картинку');

  // История: вложение заменено строкой, байтов нет; у сообщения — имя, тип, размер.
  const rec = await savedChat(page);
  expect(JSON.stringify(rec)).not.toContain(content[0].source.data.slice(0, 120));
  expect(rec.messages[0].content[0].type).toBe('text');
  expect(rec.messages[0].content[0].text).toMatch(/^\[вложение «изображение» \(JPEG, .+\) — уже разобрано в этом разговоре\]$/);
  expect(rec.items[0].files).toEqual([{ name: 'plan.png', kind: 'image', type: 'JPEG', size: img.size }]);

  // Следующее сообщение байтов картинки уже не несёт.
  await send(page, 'Дальше');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Дальше.');
  expect(JSON.stringify(calls[1].body)).not.toContain('"type":"image"');
  expect(calls[1].body.messages[0].content[0].text).toContain('уже разобрано');

  // Перезагрузка: плашка на месте, байтов в localStorage нет нигде.
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await signIn(page);
  await page.locator('#ai-btn').click();
  await page.locator('.ai-row-open').click();
  await expect(page.locator('.ai-msg.me .ai-file-name')).toHaveText('plan.png');
  const long = await page.evaluate(() => Object.keys(localStorage).filter((k) => /[A-Za-z0-9+/]{400,}/.test(localStorage.getItem(k) || '')));
  expect(long, 'длинного base64 в localStorage нет').toEqual([]);
});

test('прозрачный PNG остаётся PNG; дописанное в файл и EXIF не уходят; поворот — по EXIF', async ({ page }) => {
  await openWithMakers(page);
  const calls = await fn(page, [stream({ text: ['Две картинки.'] })]);
  await openChat(page);
  await pick(page, [
    { kind: 'png', w: 300, h: 200, alpha: true, tail: 'SECRET-PAYLOAD', name: 'logo.png', type: 'image/png' },
    { kind: 'jpeg', w: 400, h: 200, exif: 6, marker: 'GPS-SECRET', name: 'photo.jpg', type: 'image/jpeg' },
  ]);
  await expect(chips(page)).toHaveCount(2);
  await send(page, 'Что тут?');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Две картинки.');
  const [png, jpeg, text] = calls[0].body.messages[0].content;
  expect(text).toEqual({ type: 'text', text: 'Что тут?' });
  expect(png.source.media_type, 'прозрачность сохранена — PNG').toBe('image/png');
  expect(jpeg.source.media_type).toBe('image/jpeg');
  const a = await inspect(page, png.source.data, ['SECRET-PAYLOAD']);
  expect(a.found, 'хвост после картинки не ушёл').toEqual([]);
  expect([a.w, a.h]).toEqual([300, 200]);
  const b = await inspect(page, jpeg.source.data, ['Exif', 'GPS-SECRET']);
  expect(b.found, 'EXIF срезан перекодировкой').toEqual([]);
  expect([b.w, b.h], 'повёрнута по EXIF (Orientation 6)').toEqual([200, 400]);
  await expect(page.locator('.ai-msg.me .ai-file-name')).toHaveText(['logo.png', 'photo.jpg']);
  await expect(page.locator('.ai-msg.me .ai-file-meta').first()).toHaveText(/^· PNG · /);
});

test('«.png» с текстом внутри и .docx — отказ строкой у поля; пятое вложение — отказ; крестик убирает (375 px)', async ({ page }) => {
  await openWithMakers(page, { width: 375, height: 812 });
  await openChat(page);
  await pick(page, [{ kind: 'text', text: 'просто текст, а не картинка', name: 'fake.png', type: 'image/png' }]);
  await expect(attachError(page)).toHaveText('«fake.png» не подойдёт: можно картинки PNG, JPEG, WebP, GIF, PDF и текст TXT, MD, CSV.');
  await expect(chips(page)).toHaveCount(0);
  await pick(page, [{ kind: 'bytes', bytes: [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00], name: 'отчёт.docx' }]);
  await expect(attachError(page)).toContainText('«отчёт.docx» не подойдёт');
  await expect(chips(page)).toHaveCount(0);

  await pick(page, [1, 2, 3, 4].map((i) => ({ kind: 'text', text: `Задача ${i}\nещё строка`, name: `список-${i}.txt`, type: 'text/plain' })));
  await expect(chips(page)).toHaveCount(4);
  await expect(attachError(page), 'удачное добавление снимает ошибку').toBeHidden();
  await expect(chips(page).first().locator('.ai-chip-name')).toHaveText('список-1.txt');
  await expect(chips(page).first().locator('.ai-chip-size')).toHaveText(/^\d+ Б$/);
  await expect(chips(page).first().locator('svg[data-icon="doc"]')).toHaveCount(1);
  await pick(page, [{ kind: 'text', text: 'пятый', name: 'пятый.txt', type: 'text/plain' }]);
  await expect(attachError(page)).toHaveText('Можно приложить не больше 4 файлов.');
  await expect(chips(page)).toHaveCount(4);

  // Узкая панель: плашки переносятся, вбок ничего не вылезает.
  const g = await page.evaluate(() => {
    const p = document.getElementById('ai-panel').getBoundingClientRect();
    const out = [...document.querySelectorAll('#ai-attach-list *')].filter((n) => n.getBoundingClientRect().right > p.right + 0.5);
    return { out: out.length, scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(g).toEqual({ out: 0, scroll: false });

  await chips(page).first().locator('.ai-chip-x').click();
  await expect(chips(page)).toHaveCount(3);
  await expect(attachError(page)).toBeHidden();
  await expect(input(page)).toBeFocused();
});

test('txt — перетаскиванием на панель (на главном — к первому сообщению нового чата), картинка — из буфера; txt уходит блоком document text', async ({ page }) => {
  await openWithMakers(page);
  const calls = await fn(page, [stream({ text: ['Завёл бы две задачи.'] })]);
  await page.locator('#ai-btn').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await dragOver(page, [{ kind: 'text', text: 'Купить молоко\nПозвонить Ане', name: 'list.txt', type: 'text/plain' }]);
  await expect(page.locator('#ai-panel')).toHaveClass(/ai-drop/);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('ai-panel'), '::after').content)).toBe('"Отпустите, чтобы приложить"');
  await drop(page);
  await expect(page.locator('#ai-panel')).not.toHaveClass(/ai-drop/);
  await expect(page.locator('#ai-hello'), 'вложение — в поле главного, чат заведёт отправка').toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator('.ai-chip-name')).toHaveText('list.txt');

  const handled = await paste(page, [{ kind: 'png', w: 120, h: 80, name: 'image.png', type: 'image/png' }]);
  expect(handled, 'картинку из буфера поле не вставляет текстом').toBe(false);
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1).locator('img')).toHaveCount(1);

  await send(page, 'Сделай задачи из списка');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Завёл бы две задачи.');
  const [doc, img, text] = calls[0].body.messages[0].content;
  expect(doc).toEqual({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: 'Купить молоко\nПозвонить Ане' },
    title: 'list.txt',
    context: 'Untrusted attachment from the user',
  });
  expect(img).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
  expect(text).toEqual({ type: 'text', text: 'Сделай задачи из списка' });
  await expect(page.locator('#ai-title'), 'название чата — из текста').toHaveText('Сделай задачи из списка');
  await expect(page.locator('.ai-msg.me .ai-file-meta').first()).toHaveText(/^· TXT · \d+ Б$/);
});

test('400 bad attachment — строка у сообщения; «Повторить» уходит без вложения; одни вложения — без повтора', async ({ page }) => {
  await openWithMakers(page);
  const calls = await fn(page, [
    { status: 400, json: { error: 'bad attachment', detail: 'signature' } },
    stream({ text: ['Понял без файла.'] }),
    { status: 400, json: { error: 'bad attachment', detail: 'signature' } },
  ]);
  await openChat(page);
  await pick(page, [{ kind: 'png', w: 200, h: 100, name: 'shot.png', type: 'image/png' }]);
  await send(page, 'Посмотри');
  const err = page.locator('.ai-msg.me + .ai-error');
  await expect(err.locator('span')).toHaveText('Сервер не принял вложение — агенту оно не ушло.');
  expect(calls[0].body.messages[0].content.map((b) => b.type)).toEqual(['image', 'text']);
  await err.locator('button', { hasText: 'Повторить' }).click();
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Понял без файла.');
  expect(calls[1].body.messages, 'повтор — тот же текст, без вложения').toEqual([{ role: 'user', content: [{ type: 'text', text: 'Посмотри' }] }]);

  // Одни вложения, без текста: отправить можно; сервер отказал — повторять нечего.
  await pick(page, [{ kind: 'png', w: 200, h: 100, name: 'ещё.png', type: 'image/png' }]);
  await expect(page.locator('#ai-send')).toBeEnabled();
  await input(page).press('Enter');
  await expect(page.locator('.ai-error span')).toHaveText('Сервер не принял вложение — агенту оно не ушло.');
  await expect(page.locator('.ai-error button')).toHaveCount(0);
  expect(calls[2].body.messages.at(-1).content.map((b) => b.type)).toEqual(['image']);
  expect((await savedChat(page)).messages.map((m) => m.role), 'неотвеченное сообщение из одних вложений ушло из истории').toEqual(['user', 'assistant']);
});

// Скрепка — значок внутри поля (19 октября 2026), а не отдельная кнопка слева
// от него. Замер геометрии и стилей, а не скриншот: значок лежит внутри
// прямоугольника поля, у левого края, без подложки и рамки; цвет — токен
// иконок, под наведением — цвет текста; зона не меньше 32 × 32; текст поля
// начинается правее; при нескольких строках значок стоит у нижней. Поле одно
// на главный экран и чат, поэтому проверяется на обоих.
for (const width of [1280, 375]) {
  test(`скрепка — значок внутри поля у левого края, без подложки и рамки; нажатие открывает выбор файлов (${width} px)`, async ({ page }) => {
    await openWithMakers(page, { width, height: 812 });
    await openChat(page);

    /** Токены как их видит страница: цвет, который получит элемент с color: var(--…). */
    const token = (name) => page.evaluate((n) => {
      const probe = document.createElement('i');
      probe.style.color = `var(${n})`;
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    }, name);
    const measure = () => page.evaluate(() => {
      const box = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const clip = document.getElementById('ai-attach');
      const field = document.getElementById('ai-input');
      const icon = clip.querySelector('svg');
      const cs = getComputedStyle(clip);
      const fs = getComputedStyle(field);
      const cx = clip.getBoundingClientRect();
      return {
        clip: box(clip), icon: box(icon), field: box(field), send: box(document.getElementById('ai-send')),
        textFrom: field.getBoundingClientRect().left + parseFloat(fs.paddingLeft) + parseFloat(fs.borderLeftWidth),
        bg: cs.backgroundColor, border: cs.borderTopWidth, color: cs.color, label: clip.getAttribute('aria-label'), title: clip.title,
        hit: clip.contains(document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2)),
        hitCorner: clip.contains(document.elementFromPoint(cx.left + 2, cx.top + 2)),
        scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    const inside = (a, b, slack = 0.5) => a.left >= b.left - slack && a.right <= b.right + slack && a.top >= b.top - slack && a.bottom <= b.bottom + slack;

    for (const screen of ['главный', 'чат']) {
      if (screen === 'чат') {
        // Чат завёл бы первое сообщение; пустой открытый чат — то же поле на второй странице.
        await page.evaluate(() => {
          ai.chat = { id: 'c-test', title: 'Тест', createdAt: new Date().toISOString(), messages: [], items: [], draft: null };
          ai.page = 'chat';
          aiRender(true);
        });
        await expect(page.locator('#ai-log')).toBeVisible();
      }
      const quiet = await token('--icon');
      const loud = await token('--text');
      expect(quiet, 'токены различимы').not.toBe(loud);

      const m = await measure();
      expect(inside(m.clip, m.field), `${screen}: зона скрепки внутри поля`).toBe(true);
      expect(inside(m.icon, m.field), `${screen}: значок внутри поля`).toBe(true);
      expect(m.clip.left - m.field.left, `${screen}: у левого края поля`).toBeLessThanOrEqual(6);
      expect(m.clip.width, `${screen}: зона не уже 32`).toBeGreaterThanOrEqual(32);
      expect(m.clip.height, `${screen}: зона не ниже 32`).toBeGreaterThanOrEqual(32);
      expect(m.textFrom, `${screen}: текст поля правее значка`).toBeGreaterThanOrEqual(m.icon.right);
      expect(m.send.left, `${screen}: «Отправить» справа от поля`).toBeGreaterThanOrEqual(m.field.right - 0.5);
      expect(m.bg, `${screen}: без подложки`).toBe('rgba(0, 0, 0, 0)');
      expect(m.border, `${screen}: без рамки`).toBe('0px');
      expect(m.color, `${screen}: тихий токен иконок`).toBe(quiet);
      expect(m.label).toBe('Приложить файл');
      expect(m.title).toBe('Приложить файл');
      expect(m.hit, `${screen}: в центре зоны — сама скрепка, а не поле`).toBe(true);
      expect(m.hitCorner, `${screen}: и у угла зоны`).toBe(true);
      expect(m.scroll).toBe(false);
      // Однострочное поле: значок вровень с «Отправить» по вертикали.
      expect(Math.abs((m.clip.top + m.clip.bottom) / 2 - (m.send.top + m.send.bottom) / 2), `${screen}: по центру строки`).toBeLessThanOrEqual(2);

      // Наведение — цвет текста; подложки и рамки по-прежнему нет.
      await page.locator('#ai-attach').hover();
      const hover = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('ai-attach')); return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopWidth }; });
      expect(hover, `${screen}: под наведением`).toEqual({ color: loud, bg: 'rgba(0, 0, 0, 0)', border: '0px' });
      await page.mouse.move(0, 0);

      // Несколько строк: поле растёт, значок остаётся у нижней строки — рядом с «Отправить».
      await page.locator('#ai-input').fill('раз\nдва\nтри\nчетыре');
      const tall = await measure();
      expect(tall.field.height, `${screen}: поле выросло`).toBeGreaterThan(m.field.height + 30);
      expect(inside(tall.clip, tall.field), `${screen}: значок внутри выросшего поля`).toBe(true);
      expect(tall.field.bottom - tall.clip.bottom, `${screen}: от низа поля — как в одной строке`).toBeCloseTo(m.field.bottom - m.clip.bottom, 0);
      expect(tall.clip.top - tall.field.top, `${screen}: значок не уехал вверх`).toBeGreaterThan(tall.field.height / 2);
      expect(Math.abs(tall.clip.bottom - tall.send.bottom), `${screen}: низ значка рядом с низом «Отправить»`).toBeLessThanOrEqual(4);
      expect(tall.textFrom).toBeGreaterThanOrEqual(tall.icon.right);
      await page.locator('#ai-input').fill('');
    }

    // Нажатие — тот же выбор файлов, что и раньше (поле выбора множественное).
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#ai-attach').click();
    const fc = await chooser;
    expect(fc.isMultiple()).toBe(true);
    await fc.setFiles([{ name: 'список.txt', mimeType: 'text/plain', buffer: Buffer.from('Купить молоко') }]);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).locator('.ai-chip-name')).toHaveText('список.txt');
  });
}

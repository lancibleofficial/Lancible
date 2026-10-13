// Знак Lancible: один исходник, нигде не осталось прежнего. Запуск: npm run test:unit
//
// Откуда тест. 11 октября 2026 знак сменился: прежний — зелёная «ракета» из
// трёх контуров в поле 256×256 — жил в build/logo-accent.svg и ещё в
// двенадцати местах строкой путей: шапка десктопа и веба, шапка, подвал и
// герой лендинга, favicon каждой страницы. Растровые иконки собирались из
// того же файла. Теперь источник один — assets/logo-mark.svg, разметку из него
// вписывает scripts/make-logo.js, растр рисуют make-icon.js и
// make-mobile-icons.js, а здесь проверяется, что всё это идёт от него: что
// разметка не отстала, цвет задаёт токен, растр нарисован этим знаком, а
// прежнего нигде нет.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { cssRules, declarations } = require('../css');
const { ACCENT, OPTICAL_DROP, FILES, SLOT_RE, FAVICON_RE, readLogo, logoBox, apply } = require('../../scripts/make-logo.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Первые координаты первого контура нового знака и признаки прежнего.
const NEW_PATH_START = 'M54.0483 16C55.6036 16 56.532 17.6837';
const OLD_PATH_START = 'M100.37 43.9496C101.421';

test('исходник: два контура в поле 64×64, без цвета', () => {
  const logo = readLogo();
  assert.equal(logo.viewBox, '0 0 64 64');
  assert.equal(logo.paths.length, 2);
  assert.ok(logo.paths[0].startsWith(NEW_PATH_START), 'первый контур — не тот знак, что прислали 11 октября');
  const svg = read('assets/logo-mark.svg');
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b|rgba?\(|fill="(?!none"|currentColor")/, 'в исходнике только currentColor: цвет задаёт место, где знак стоит');
});

test('рамка знака: 48×36, а в поле 64×64 он стоит ниже центра', () => {
  const b = logoBox(readLogo());
  for (const [got, want] of [[b.x, 8], [b.y, 16], [b.w, 48], [b.h, 36]]) assert.ok(Math.abs(got - want) < 0.01, `рамка ${JSON.stringify(b)}`);
});

// --- разметка ---------------------------------------------------------------------

const slotsOf = (html) => [...html.matchAll(SLOT_RE)].map((m) => m[2]);

test('разметка во всех страницах — из исходника', () => {
  // Правили исходник и не запустили scripts/make-logo.js — в шапке остался бы
  // прежний знак.
  const logo = readLogo();
  for (const rel of FILES) {
    const html = read(rel);
    assert.equal(apply(html, logo), html, `${rel}: знак не из assets/logo-mark.svg — node scripts/make-logo.js`);
  }
});

test('знак стоит там, где ему положено', () => {
  const slots = {
    'src/renderer/index.html': ['tb-logo'],
    'web/index.html': ['tb-logo'],
    'landing/index.html': ['brand', 'rocket-wrap', 'footer-brand'],
  };
  for (const rel of FILES) {
    const html = read(rel);
    const want = slots[rel] || ['brand', 'footer-brand'];
    assert.deepEqual(slotsOf(html), want, `${rel}: знак в шапке, подвале и герое`);
    assert.equal([...html.matchAll(new RegExp(FAVICON_RE.source, 'g'))].length, 1, `${rel}: нужен ровно один favicon-знак`);
  }
});

test('в разметке знака нет цвета: красит токен', () => {
  for (const rel of FILES) {
    const html = read(rel);
    for (const m of html.matchAll(SLOT_RE)) {
      assert.doesNotMatch(m[0], /#[0-9a-fA-F]{3,8}\b|rgba?\(|fill="(?!none"|currentColor")/, `${rel}: цвет в разметке знака`);
    }
  }
});

test('favicon — единственное место с цветом: он вписан в data:-картинку и равен акценту', () => {
  for (const rel of FILES) {
    const link = read(rel).match(FAVICON_RE)[0];
    assert.ok(link.includes(`fill=%22%23${ACCENT.slice(1).toUpperCase()}%22`), `${rel}: цвет favicon — не ${ACCENT}`);
    assert.ok(link.includes(NEW_PATH_START), `${rel}: favicon — не новый знак`);
  }
});

// --- цвет: токены своей поверхности ----------------------------------------------------

const ruleOf = (css, sel) => {
  const r = cssRules(css).find((x) => x.sel === sel && !x.at);
  assert.ok(r, `нет правила ${sel}`);
  return declarations(r.body);
};

test('акцент в favicon и растре — тот же, что --accent в styles.css и landing.css', () => {
  assert.match(read('src/renderer/styles.css'), new RegExp(`--accent:\\s*${ACCENT};`));
  assert.match(read('landing/landing.css'), new RegExp(`--accent:\\s*${ACCENT};`));
});

test('цвет знака в интерфейсе — токен акцента своей поверхности', () => {
  assert.equal(ruleOf(read('src/renderer/styles.css'), '.tb-logo-mark').color, 'var(--accent-ink)');
  const landing = read('landing/landing.css');
  assert.equal(ruleOf(landing, '.brand svg').color, 'var(--accent)');
  assert.equal(ruleOf(landing, '.footer-brand svg').color, 'var(--accent)');
  const home = read('landing/index.html').match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal(ruleOf(home, '.rocket-wrap svg').color, 'var(--accent)');
});

/** Поле (viewBox) знака в разметке: слот -> [x, y, w, h]. */
const slotBox = (rel, slot) => {
  const m = [...read(rel).matchAll(SLOT_RE)].find((x) => x[2] === slot);
  assert.ok(m, `${rel}: нет знака в ${slot}`);
  return m[0].match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
};
const mark = logoBox(readLogo());

test('знак шире, чем высок: коробка svg в интерфейсе повторяет поле знака в разметке', () => {
  // Квадратная коробка оставила бы знак в середине с пустыми полями сверху и
  // снизу — он бы «поплыл» относительно текста рядом.
  const home = read('landing/index.html').match(/<style>([\s\S]*?)<\/style>/)[1];
  const boxes = [
    [ruleOf(read('src/renderer/styles.css'), '.tb-logo-mark'), slotBox('src/renderer/index.html', 'tb-logo')],
    [ruleOf(read('landing/landing.css'), '.brand svg'), slotBox('landing/index.html', 'brand')],
    [ruleOf(read('landing/landing.css'), '.footer-brand svg'), slotBox('landing/index.html', 'footer-brand')],
    [ruleOf(home, '.rocket-wrap svg'), slotBox('landing/index.html', 'rocket-wrap')],
  ];
  for (const [d, [, , w, h]] of boxes) assert.ok(Math.abs(parseFloat(d.width) * h / w - parseFloat(d.height)) < 0.01, `${d.width}×${d.height} при поле ${w}×${h}`);
});

// --- оптическая центровка -----------------------------------------------------------
// Знак — треугольник вершиной вниз, вес тянет вверх, и по центру рамки он
// выглядит высоко. Там, где он стоит один, его спускают на OPTICAL_DROP высоты
// знака — один параметр на все места (scripts/make-logo.js). В строку с текстом
// знак не смещается: там его выравнивает текст.

test('оптическая центровка: смещение разумное — между рамкой и центром площади (14%)', () => {
  assert.ok(OPTICAL_DROP > 0.04 && OPTICAL_DROP < 0.144, String(OPTICAL_DROP));
});

test('в строку с текстом знак не смещён: поле впритык к знаку', () => {
  for (const [rel, slot] of [['src/renderer/index.html', 'tb-logo'], ['web/index.html', 'tb-logo'], ['landing/index.html', 'brand'], ['landing/index.html', 'footer-brand']]) {
    const [x, y, w, h] = slotBox(rel, slot);
    assert.ok(Math.abs(x - mark.x) < 0.01 && Math.abs(y - mark.y) < 0.01 && Math.abs(w - mark.w) < 0.01 && Math.abs(h - mark.h) < 0.01, `${rel} ${slot}: поле ${[x, y, w, h]}`);
  }
});

test('герой лендинга: знак ниже центра поля на OPTICAL_DROP высоты знака', () => {
  const [x, y, w, h] = slotBox('landing/index.html', 'rocket-wrap');
  assert.ok(Math.abs(w - mark.w) < 0.01 && Math.abs(x - mark.x) < 0.01);
  const drop = (mark.y + mark.h / 2) - (y + h / 2);
  assert.ok(Math.abs(drop - OPTICAL_DROP * mark.h) < 0.01, `смещение ${drop}, ждали ${OPTICAL_DROP * mark.h}`);
});

test('favicon: знак по центру ширины и ниже центра поля на OPTICAL_DROP высоты знака', () => {
  for (const rel of FILES) {
    const [x, y, w, h] = read(rel).match(FAVICON_RE)[0].match(/viewBox=%22([^"]+?)%22>/)[1].split('%20').map(Number);
    assert.equal(w, h, `${rel}: поле favicon квадратное`);
    assert.ok(Math.abs((mark.x + mark.w / 2) - (x + w / 2)) < 0.01, `${rel}: знак не по центру ширины`);
    assert.ok(Math.abs((mark.y + mark.h / 2) - (y + h / 2) - OPTICAL_DROP * mark.h) < 0.01, `${rel}: смещение favicon`);
  }
});

// --- растр -----------------------------------------------------------------------------

/** PNG 8 бит RGBA без чересстрочности — то, что отдаёт canvas.toDataURL. */
function decodePng(buf) {
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  let w = 0; let h = 0; const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString();
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.equal(data[8], 8); assert.equal(data[9], 6); assert.equal(data[12], 0); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const cur = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= 4 ? px[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + i] = (cur + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
  }
  return { w, h, at: (x, y) => [...px.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] };
}

/** Рамка пикселей, прошедших `pick`, и самый дальний от центра. */
function boxOf(img, pick) {
  let x0 = img.w; let y0 = img.h; let x1 = -1; let y1 = -1; let far = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!pick(img.at(x, y))) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      far = Math.max(far, Math.hypot(x + 0.5 - img.w / 2, y + 0.5 - img.h / 2));
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, far };
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const near = (px, rgb, tol) => px[3] > 200 && px.slice(0, 3).every((v, i) => Math.abs(v - rgb[i]) <= tol);

// Поля и рамка знака — те же числа, что в scripts/make-icon.js и
// scripts/make-mobile-icons.js: знак шире, чем высок, поэтому по полям
// вписывается ширина, высота — 3/4 ширины, центр рамки — по центру иконки и
// ниже на OPTICAL_DROP высоты знака.
const RATIO = 36 / 48;
const RULES = {
  full: { width: 1 - 2 * 0.19 },
  foreground: { width: 1 - 2 * 0.32 },
};

function checkMark(rel, width, pick) {
  const img = decodePng(fs.readFileSync(path.join(ROOT, rel)));
  assert.equal(img.w, 1024);
  assert.equal(img.h, 1024);
  const m = boxOf(img, pick);
  assert.ok(Math.abs(m.w - width * img.w) <= 3, `${rel}: ширина знака ${m.w}, ждали ${width * img.w}`);
  assert.ok(Math.abs(m.h - width * RATIO * img.h) <= 3, `${rel}: высота знака ${m.h}, ждали ${width * RATIO * img.h}`);
  // По ширине — в центре, по высоте — ниже центра на OPTICAL_DROP высоты знака.
  const cy = img.h / 2 + OPTICAL_DROP * width * RATIO * img.h;
  assert.ok(Math.abs(m.cx - img.w / 2) <= 2 && Math.abs(m.cy - cy) <= 2, `${rel}: знак не там: центр (${m.cx}, ${m.cy}), ждали (${img.w / 2}, ${cy})`);
  return { img, m };
}

for (const rel of ['mobile/assets/icon.png', 'mobile/assets/favicon.png', 'build/icon.png']) {
  // build/icon.png в git не лежит (его рисует `npm run icon` при сборке) — без
  // него проверять нечего.
  test(`${rel}: знак акцентного цвета на графитовом квадрате`, { skip: !exists(rel) && 'файл рисуется при сборке' }, () => {
    const { img } = checkMark(rel, RULES.full.width, (px) => near(px, hex(ACCENT), 40));
    assert.equal(img.at(0, 0)[3], 0, 'скруглённый угол прозрачен');
    assert.ok(near(img.at(100, 512), [0x2a, 0x2b, 0x2e], 12) || near(img.at(100, 512), [0x33, 0x34, 0x3a], 12), 'подложка — графит');
  });
}

test('mobile/assets: favicon и иконка — один рисунок', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'mobile/assets/icon.png')).equals(fs.readFileSync(path.join(ROOT, 'mobile/assets/favicon.png'))));
});

for (const rel of ['mobile/assets/android-icon-foreground.png', 'mobile/assets/splash-icon.png']) {
  test(`${rel}: знак на прозрачном фоне, в безопасной зоне маски Android`, () => {
    const { img, m } = checkMark(rel, RULES.foreground.width, (px) => near(px, hex(ACCENT), 40));
    assert.equal(img.at(0, 0)[3], 0);
    assert.equal(img.at(512, 100)[3], 0);
    // Адаптивная иконка — 108 dp, безопасный круг — 66 dp.
    assert.ok(m.far <= (66 / 108 / 2) * img.w, `знак выходит за безопасную зону: ${m.far}`);
  });
}

test('mobile/assets/android-icon-monochrome.png: тот же знак, весь белый', () => {
  const rel = 'mobile/assets/android-icon-monochrome.png';
  const { img } = checkMark(rel, RULES.foreground.width, (px) => px[3] > 200);
  for (let y = 0; y < img.h; y += 8) {
    for (let x = 0; x < img.w; x += 8) {
      const px = img.at(x, y);
      if (px[3] > 200) assert.deepEqual(px.slice(0, 3), [255, 255, 255], `${rel}: пиксель ${x},${y} не белый`);
    }
  }
});

test('app.json: иконки телефона — те самые файлы', () => {
  const app = JSON.parse(read('mobile/app.json')).expo;
  assert.equal(app.icon, './assets/icon.png');
  assert.equal(app.android.adaptiveIcon.foregroundImage, './assets/android-icon-foreground.png');
  assert.equal(app.android.adaptiveIcon.monochromeImage, './assets/android-icon-monochrome.png');
  assert.equal(app.web.favicon, './assets/favicon.png');
  const splash = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.image, './assets/splash-icon.png');
  for (const rel of ['icon.png', 'android-icon-foreground.png', 'android-icon-monochrome.png', 'splash-icon.png', 'favicon.png']) assert.ok(exists(`mobile/assets/${rel}`), rel);
});

// --- прежнего знака нет ----------------------------------------------------------------

test('прежнего знака нигде нет, и никто не ссылается на старый исходник', () => {
  assert.ok(!exists('build/logo-accent.svg'), 'build/logo-accent.svg удалён: источник — assets/logo-mark.svg');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0').filter(Boolean);
  const self = 'tests/unit/logo.test.js';
  for (const rel of files) {
    if (rel === self || !exists(rel)) continue;
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.ok(!buf.includes(OLD_PATH_START), `${rel}: контур прежнего знака`);
    assert.ok(!buf.includes('logo-accent'), `${rel}: ссылка на прежний исходник build/logo-accent.svg`);
  }
});

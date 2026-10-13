// Генерирует build/icon.ico (Windows) и build/icon.png (источник для мака) —
// рисует иконку на canvas в скрытом окне Electron (графитовый фон + знак из
// assets/logo-mark.svg, см. scripts/make-logo.js). .ico собирается
// многоразмерным через png-to-ico;
// electron-builder сам конвертирует icon.png в .icns при сборке mac-таргета
// (см. package.json build.mac.icon) — отдельного шага/утилиты для .icns не
// нужно, но источник должен быть не меньше 512×512, поэтому icon.png
// рендерится отдельно на 1024, а не переиспользует крупнейший ico-размер.
// Запуск: npm run icon
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ACCENT, readLogo, markJs } = require('./make-logo.js');

const OUT_DIR = path.join(__dirname, '..', 'build');
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const PNG_SIZE = 1024;

const BG_1 = '#2a2b2e';
const BG_2 = '#33343a';
// Знак шире, чем высок, поэтому по полям вписывается ширина: 19% с каждой
// стороны, высота выходит 3/4 ширины, знак по центру и спущен на
// OPTICAL_DROP (оптическая центровка, см. make-logo.js).
const MARK_WIDTH = 1 - 2 * 0.19;

const draw = (size, logo) => `(() => {
  const s = ${size};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const r = s * 0.22;

  // фон — графитовый скруглённый квадрат
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '${BG_2}');
  g.addColorStop(1, '${BG_1}');
  x.fillStyle = g;
  x.beginPath();
  x.roundRect(0, 0, s, s, r);
  x.fill();

  // знак (акцентный) — по центру
  ${markJs(logo, { cx: 's / 2', cy: 's / 2', width: `s * ${MARK_WIDTH}`, color: ACCENT })}

  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<body></body>');

  const logo = readLogo();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buffers = [];
  for (const size of ICO_SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(draw(size, logo));
    buffers.push(Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  const { default: pngToIco } = await import('png-to-ico');
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
  console.log('icon.ico written:', ico.length, 'bytes');

  const pngDataUrl = await win.webContents.executeJavaScript(draw(PNG_SIZE, logo));
  const pngBuf = Buffer.from(pngDataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), pngBuf);
  console.log('icon.png written:', pngBuf.length, 'bytes');
  app.quit();
});

// Генерирует иконки для mobile/ (Expo/Android) из assets/logo-mark.svg
// (читает scripts/make-logo.js) — тот же приём, что и в make-icon.js
// (Electron + canvas), но на 1024px и с отдельным прозрачным foreground-слоем
// под адаптивную иконку Android.
// Запуск: npx electron scripts/make-mobile-icons.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ACCENT, readLogo, markJs } = require('./make-logo.js');

const OUT_DIR = path.join(__dirname, '..', 'mobile', 'assets');
const SIZE = 1024;
const BG_1 = '#2a2b2e';
const BG_2 = '#33343a';
// Знак шире, чем высок, поэтому по полям вписывается ширина, высота выходит
// 3/4 ширины, знак по центру и спущен на OPTICAL_DROP (оптическая центровка,
// см. make-logo.js). У полной иконки поля 19% с каждой стороны, у
// foreground — 32%: Android обрезает и анимирует адаптивную иконку по маске,
// безопасная зона — центральные ~66%.
const FULL_WIDTH = 1 - 2 * 0.19;
const FOREGROUND_WIDTH = 1 - 2 * 0.32;

// icon.png: графитовый скруглённый квадрат + знак по центру (как на десктопе)
const drawFullIcon = (logo) => `(() => {
  const s = ${SIZE};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const r = s * 0.22;
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '${BG_2}');
  g.addColorStop(1, '${BG_1}');
  x.fillStyle = g;
  x.beginPath();
  x.roundRect(0, 0, s, s, r);
  x.fill();
  ${markJs(logo, { cx: 's / 2', cy: 's / 2', width: `s * ${FULL_WIDTH}`, color: ACCENT })}
  return c.toDataURL('image/png');
})()`;

// foreground: знак один, прозрачный фон, в safe-zone (см. выше)
const drawForeground = (logo, color) => `(() => {
  const s = ${SIZE};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  ${markJs(logo, { cx: 's / 2', cy: 's / 2', width: `s * ${FOREGROUND_WIDTH}`, color })}
  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<body></body>');

  const logo = readLogo();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const save = async (js, filename) => {
    const dataUrl = await win.webContents.executeJavaScript(js);
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', filename);
  };

  await save(drawFullIcon(logo), 'icon.png');
  await save(drawForeground(logo, ACCENT), 'android-icon-foreground.png');
  // монохромная иконка Android 13+: платформа красит её сама, нужна форма
  await save(drawForeground(logo, '#ffffff'), 'android-icon-monochrome.png');
  await save(drawForeground(logo, ACCENT), 'splash-icon.png');
  await save(drawFullIcon(logo), 'favicon.png');

  console.log('done');
  app.quit();
});

// Генерирует иконки для mobile/ (Expo/Android) из build/logo-accent.svg —
// тот же приём, что и в make-icon.js (Electron + canvas), но на 1024px и с
// отдельным прозрачным foreground-слоем под адаптивную иконку Android.
// Запуск: node scripts/make-mobile-icons.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SVG_PATH = path.join(__dirname, '..', 'build', 'logo-accent.svg');
const OUT_DIR = path.join(__dirname, '..', 'mobile', 'assets');
const SIZE = 1024;
const BG_1 = '#2a2b2e';
const BG_2 = '#33343a';
const ACCENT = '#87ff65';

function svgDataUrl(svgText) {
  return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf-8').toString('base64')}`;
}

// icon.png: графитовый скруглённый квадрат + лого по центру (как на десктопе)
const drawFullIcon = (logoDataUrl) => `(async () => {
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
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = ${JSON.stringify(logoDataUrl)}; });
  const pad = s * 0.19;
  const dw = s - pad * 2;
  x.drawImage(img, pad, pad, dw, dw);
  return c.toDataURL('image/png');
})()`;

// foreground: лого одно, прозрачный фон, в safe-zone ~66% (Android
// адаптивная иконка обрезает/анимирует по маске, поэтому глиф уже и по центру)
const drawForeground = (logoDataUrl) => `(async () => {
  const s = ${SIZE};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = ${JSON.stringify(logoDataUrl)}; });
  const pad = s * 0.32;
  const dw = s - pad * 2;
  x.drawImage(img, pad, pad, dw, dw);
  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<body></body>');

  const svgText = fs.readFileSync(SVG_PATH, 'utf-8');
  const logoDataUrl = svgDataUrl(svgText);
  const monoSvgText = svgText.replaceAll(ACCENT, '#ffffff');
  const monoDataUrl = svgDataUrl(monoSvgText);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const save = async (js, filename) => {
    const dataUrl = await win.webContents.executeJavaScript(js);
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', filename);
  };

  await save(drawFullIcon(logoDataUrl), 'icon.png');
  await save(drawForeground(logoDataUrl), 'android-icon-foreground.png');
  await save(drawForeground(monoDataUrl), 'android-icon-monochrome.png');
  await save(drawForeground(logoDataUrl), 'splash-icon.png');
  await save(drawFullIcon(logoDataUrl), 'favicon.png');

  console.log('done');
  app.quit();
});

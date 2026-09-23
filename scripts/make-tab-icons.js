// Растрирует глифы табов из mobile/src/components/Icon.js в PNG для iOS.
//
// Нативный UITabBarController на iOS не умеет рисовать наши SVG: ему нужны
// изображения. Поэтому иконки табов лежат в mobile/assets/tabs как
// template-картинки 24pt в трёх плотностях — iOS красит их сам, поэтому
// цвет здесь не важен, важна только форма и прозрачный фон.
//
// Тот же приём, что в make-icon.js: рисуем в Electron-окне на canvas и
// снимаем PNG. Запуск: npx electron scripts/make-tab-icons.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.join(__dirname, '..', 'mobile', 'assets', 'tabs');
const ICON_FILE = path.join(__dirname, '..', 'mobile', 'src', 'components', 'Icon.js');
// Какие глифы нужны табам. Имена совпадают с ключами в Icon.js и с именами
// файлов, которые ждёт MainTabs.ios.js.
const WANTED = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const SIZES = [
  { suffix: '', px: 24 },
  { suffix: '@2x', px: 48 },
  { suffix: '@3x', px: 72 },
];

/** Достаёт path-данные глифа прямо из Icon.js — второй копии быть не должно. */
function pathOf(name) {
  const src = fs.readFileSync(ICON_FILE, 'utf8');
  const re = new RegExp(`\\b${name}:\\s*'([^']+)'`);
  const m = src.match(re);
  if (!m) throw new Error(`в Icon.js нет глифа ${name}`);
  return m[1];
}

const draw = (d, px) => `(async () => {
  const c = document.createElement('canvas');
  c.width = ${px}; c.height = ${px};
  const x = c.getContext('2d');
  // Глифы нарисованы в системе координат 16x16 — масштабируем под размер.
  x.scale(${px} / 16, ${px} / 16);
  x.fillStyle = '#ffffff';
  x.fill(new Path2D(${JSON.stringify(d)}));
  return c.toDataURL('image/png');
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  if (!WANTED.length) {
    console.error('укажите имена глифов, например: npx electron scripts/make-tab-icons.js board menu');
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({ show: false, width: 128, height: 128 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const name of WANTED) {
    const d = pathOf(name);
    for (const { suffix, px } of SIZES) {
      const dataUrl = await win.webContents.executeJavaScript(draw(d, px));
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      const file = path.join(OUT_DIR, `${name}${suffix}.png`);
      fs.writeFileSync(file, png);
      console.log(`${path.basename(file)}  ${px}x${px}  ${png.length}б`);
    }
  }
  app.exit(0);
});

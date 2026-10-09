// Картинки иконок для нативных панелей iOS — из общего словаря
// src/renderer/core/icons.js (Solar Bold).
//
// UITabBar и UINavigationBar не умеют рисовать наши SVG: им нужны
// изображения. Поэтому иконки вкладок, кнопок шапки и «назад» лежат в
// mobile/assets как template-картинки в трёх плотностях — iOS красит их сам
// (цвет вкладки, tint шапки), поэтому цвет здесь не важен, важны форма и
// прозрачный фон. Без них iOS показал бы свои SF Symbols и шеврон.
//
// Рисуем в Electron-окне на canvas и снимаем PNG (тот же приём, что в
// make-icon.js). Запуск: npx electron scripts/make-ios-icons.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ICONS } = require('../src/renderer/core/icons.js');

const ASSETS = path.join(__dirname, '..', 'mobile', 'assets');

// Что рисовать: папка, имена из словаря, размер в pt. Имена совпадают с
// теми, что ждут MainTabs.ios.js (вкладки) и nativeHeader.js (шапка).
// Вкладка — 26pt, как глиф вкладки по HIG; кнопка шапки — 22pt, как
// символ в стеклянной кнопке. «Назад» — узкий шеврон без полей слева,
// иначе он отъехал бы от края дальше системного.
const SETS = [
  { dir: 'tabs', w: 26, h: 26, names: ['folder', 'tasks', 'today', 'chart', 'menu'] },
  { dir: 'header', w: 22, h: 22, names: ['search', 'bell', 'plus', 'calendar', 'panel', 'list', 'download', 'kebab', 'check'] },
  { dir: 'header', w: 13, h: 24, names: ['chevron-left'], file: 'back' },
];
const SCALES = [1, 2, 3];

/** Рамка иконки вписывается в высоту h и встаёт по центру ширины w. */
const draw = (icon, w, h, k) => `(async () => {
  const c = document.createElement('canvas');
  c.width = ${w * k}; c.height = ${h * k};
  const x = c.getContext('2d');
  const [vx, vy, vw, vh] = ${JSON.stringify(icon.vb.split(' ').map(Number))};
  const s = ${h * k} / vh;
  x.translate((${w * k} - vw * s) / 2, 0);
  x.scale(s, s);
  x.translate(-vx, -vy);
  x.fillStyle = '#ffffff';
  for (const [d, evenodd] of ${JSON.stringify(icon.p)}) x.fill(new Path2D(d), evenodd ? 'evenodd' : 'nonzero');
  return c.toDataURL('image/png');
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 128, height: 128 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  for (const set of SETS) {
    const dir = path.join(ASSETS, set.dir);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of set.names) {
      const icon = ICONS[name];
      if (!icon) throw new Error(`в core/icons.js нет иконки ${name}`);
      for (const k of SCALES) {
        const dataUrl = await win.webContents.executeJavaScript(draw(icon, set.w, set.h, k));
        const png = Buffer.from(dataUrl.split(',')[1], 'base64');
        const file = path.join(dir, `${set.file || name}${k > 1 ? `@${k}x` : ''}.png`);
        fs.writeFileSync(file, png);
        console.log(`${set.dir}/${path.basename(file)}  ${set.w * k}x${set.h * k}`);
      }
    }
  }
  app.exit(0);
});

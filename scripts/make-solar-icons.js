// Иконки всех поверхностей — Solar Bold (480 Design, CC BY 4.0).
//
// Один словарь «наше имя → файл Solar» ниже — единственное место, где
// решается, какая иконка что означает. Из него собирается
// src/renderer/core/icons.js: его читают десктоп и веб (<script>), редактор
// (import в сборке) и телефон (копия в mobile/src/core). Разметку в HTML
// генератор тоже обновляет сам: каждый <svg data-icon="имя"> в обоих
// index.html и на страницах лендинга получает пути из словаря.
//
// Запуск:
//   node scripts/make-solar-icons.js --solar <папка icons/SVG/Bold>
//       пересобрать core/icons.js из Solar и обновить HTML;
//   node scripts/make-solar-icons.js
//       только обновить HTML по уже собранному core/icons.js.
// Набор Solar: https://github.com/480-Design/Solar-Icon-Set (клонировать
// куда угодно вне репозитория). После — node scripts/sync-mobile-core.js и
// npx electron scripts/make-ios-icons.js (картинки для нативных панелей iOS).
//
// Иконки берутся только «чистые»: <path> с заливкой black, без прозрачности,
// групп и обводки — у таких цвет целиком задаёт currentColor. Галочка, плюс,
// крестик, минус и шевроны в Solar Bold есть только внутри круга; для них
// берётся сам знак — вырез из круглой иконки, — и рамка обрезается по нему.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'core', 'icons.js');
const HTML = [
  'src/renderer/index.html',
  'web/index.html',
  ...fs.readdirSync(path.join(ROOT, 'landing')).filter((f) => f.endsWith('.html')).map((f) => `landing/${f}`),
];

// Знак без круга: вырез из круглой иконки.
const GLYPH = {
  check: 'Essentional, UI/Check Circle',
  plus: 'Essentional, UI/Add Circle',
  x: 'Essentional, UI/Close Circle',
  minus: 'Essentional, UI/Minus Circle',
  'chevron-left': 'Arrows/Round Alt Arrow Left',
  'chevron-right': 'Arrows/Round Alt Arrow Right',
  'chevron-up': 'Arrows/Round Alt Arrow Up',
  'chevron-down': 'Arrows/Round Alt Arrow Down',
};

// Иконка целиком.
const FULL = {
  // навигация
  today: 'Time/Calendar Mark',
  folder: 'Folders/Folder',
  tasks: 'List/Checklist Minimalistic',
  chart: 'Business, Statistic/Chart Square',
  menu: 'Settings, Fine Tuning/Widget',
  docs: 'Notes/Documents',
  clock: 'Time/Clock Circle',
  settings: 'Settings, Fine Tuning/Settings',
  // действия и поля
  search: 'Search/Magnifer',
  play: 'Video, Audio, Sound/Play',
  pause: 'Video, Audio, Sound/Pause',
  stop: 'Video, Audio, Sound/Stop',
  bell: 'Notifications/Bell',
  'bell-bing': 'Notifications/Bell Bing',
  account: 'Users/User Rounded',
  calendar: 'Time/Calendar',
  stopwatch: 'Time/Stopwatch',
  doc: 'Notes/Document',
  tuning: 'Settings, Fine Tuning/Tuning 2',
  pin: 'Essentional, UI/Pin',
  tag: 'Money/Tag',
  wallet: 'Money/Wallet',
  currency: 'Money/Banknote 2',
  download: 'Arrows Action/Download Minimalistic',
  globe: 'Map & Location/Global',
  panel: 'Network, IT, Programming/Sidebar Minimalistic',
  'panel-right': 'Network, IT, Programming/Siderbar',
  list: 'Essentional, UI/Hamburger Menu',
  board: 'Design, Tools/Align Top',
  layers: 'Design, Tools/Layers',
  kebab: 'Essentional, UI/Menu Dots',
  status: 'Video, Audio, Sound/Record Circle',
  refresh: 'Arrows/Refresh',
  sun: 'Weather/Sun 2',
  moon: 'Weather/Moon',
  monitor: 'Electronic, Devices/Monitor',
  cloud: 'Weather/Cloud',
  'cloud-check': 'Weather/Cloud Check',
  lock: 'Security/Lock Keyhole Minimalistic',
  logout: 'Arrows Action/Logout 2',
  trash: 'Essentional, UI/Trash Bin Trash',
  info: 'Essentional, UI/Info Circle',
  blog: 'School/Notebook Minimalistic',
  'check-circle': 'Essentional, UI/Check Circle',
  'done-list': 'Notes/Clipboard Check',
  copy: 'Essentional, UI/Copy',
  link: 'Text Formatting/Link',
  // редактор
  'text-bold': 'Text Formatting/Text Bold',
  'text-italic': 'Text Formatting/Text Italic',
  'text-underline': 'Text Formatting/Text Underline',
  'text-strike': 'Text Formatting/Text Cross',
  code: 'Network, IT, Programming/Code',
  'code-block': 'Network, IT, Programming/Code Square',
  unlink: 'Text Formatting/Link Broken',
  eraser: 'Text Formatting/Eraser',
  'eraser-square': 'Text Formatting/Eraser Square',
  undo: 'Arrows Action/Undo Left Round',
  redo: 'Arrows Action/Undo Right Round',
  reply: 'Arrows Action/Undo Left',
  restart: 'Arrows/Restart',
  checklist: 'List/Checklist',
  callout: 'Messages, Conversation/Chat Line',
  image: 'Video, Audio, Sound/Gallery',
  'image-add': 'Video, Audio, Sound/Gallery Add',
  'chart-bars': 'Business, Statistic/Chart 2',
  'chart-line': 'Business, Statistic/Graph Up',
  'chart-pie': 'Business, Statistic/Pie Chart 2',
  'chart-area': 'Business, Statistic/Graph',
  pen: 'Messages, Conversation/Pen',
  'pen-line': 'Messages, Conversation/Pen 2',
  'pen-square': 'Messages, Conversation/Pen New Square',
  'pen-round': 'Messages, Conversation/Pen New Round',
  'arrow-up-right': 'Arrows/Arrow Right Up',
  'arrow-up': 'Arrows/Arrow Up',
  'arrow-down': 'Arrows/Arrow Down',
  'arrow-left': 'Arrows/Arrow Left',
  'arrow-right': 'Arrows/Arrow Right',
  comment: 'Messages, Conversation/Chat Round Line',
  comments: 'Messages, Conversation/Dialog 2',
  printer: 'Electronic, Devices/Printer Minimalistic',
  maximize: 'Arrows Action/Maximize Square Minimalistic',
  minimize: 'Arrows Action/Minimize Square Minimalistic',
  fullscreen: 'Video, Audio, Sound/Full Screen',
  target: 'Essentional, UI/Target',
  'paint-roller': 'Design, Tools/Paint Roller',
  palette: 'Design, Tools/Palette',
  danger: 'Essentional, UI/Danger Triangle',
  lightbulb: 'Electronic, Devices/Lightbulb Minimalistic',
  cursor: 'Essentional, UI/Cursor',
  'zoom-in': 'Search/Magnifer Zoom In',
  'zoom-out': 'Search/Magnifer Zoom Out',
  eye: 'Security/Eye',
  'eye-closed': 'Security/Eye Closed',
};

const fmt = (n) => String(+n.toFixed(3));
// Сторона рамки знаков в единицах Solar (иконка — 24): линия 1.5 занимает
// 15% размера, как у жирных иконок рядом.
const GLYPH_SIDE = 10;
// Точности в сотую единицы из 24 хватает с запасом, а файл вдвое меньше.
const squeeze = (d) => d.replace(/-?\d*\.\d+/g, (n) => String(+(+n).toFixed(2)));

/** Пути файла Solar: [[d, evenodd]]. Всё, кроме чёрной заливки, — отказ. */
function readSolar(dir, rel) {
  const file = path.join(dir, `${rel}.svg`);
  if (!fs.existsSync(file)) throw new Error(`нет файла Solar: ${rel}.svg`);
  const src = fs.readFileSync(file, 'utf8');
  if (/opacity|<g[\s>]|stroke|<(rect|line|polygon|polyline)\b/.test(src)) {
    throw new Error(`${rel}: в иконке прозрачность, группы, обводка или фигуры — такие не берём`);
  }
  const paths = [];
  const holes = [];
  const re = /<(path|circle|ellipse)\b([^>]*)\/?>/g;
  const num = (attrs, k) => Number((attrs.match(new RegExp(`\\s${k}="([^"]+)"`)) || [])[1]);
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[2];
    let d = (attrs.match(/\sd="([^"]+)"/) || [])[1];
    if (m[1] !== 'path') {
      // Круг и эллипс — двумя дугами, чтобы иконка оставалась набором путей.
      const cx = num(attrs, 'cx'); const cy = num(attrs, 'cy');
      const rx = m[1] === 'circle' ? num(attrs, 'r') : num(attrs, 'rx');
      const ry = m[1] === 'circle' ? rx : num(attrs, 'ry');
      d = `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
    }
    const fill = (attrs.match(/\sfill="([^"]+)"/) || [])[1];
    if (!d) throw new Error(`${rel}: путь без d`);
    if (fill === 'white') holes.push(d);
    else if (fill === 'black') paths.push([d, /fill-rule="evenodd"/.test(attrs) ? 1 : 0]);
    else throw new Error(`${rel}: заливка ${fill} — берём только black и white`);
  }
  if (!paths.length) throw new Error(`${rel}: ни одного пути`);
  // Белое у Solar — нарисованный поверх вырез (стрелки часов). На цветном
  // фоне он был бы белым пятном, поэтому он становится настоящей дырой:
  // один путь с правилом evenodd. Однозначно это только при одном чёрном.
  if (holes.length) {
    if (paths.length !== 1) throw new Error(`${rel}: белый вырез при нескольких чёрных путях`);
    return [[[paths[0][0], ...holes].join(' '), 1]];
  }
  return paths;
}

/** Числа абсолютного пути (M L H V C S Q T Z) → рамка. Относительных команд
 *  и дуг во вырезах Solar нет; встретятся — лучше упасть, чем ошибиться. */
function bbox(d) {
  if (/[a-yA]/.test(d.replace(/\d[eE][-+]?\d/g, '0'))) throw new Error(`рамка: относительные команды или дуги в «${d.slice(0, 40)}…»`);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  };
  let x = 0; let y = 0;
  const tokens = d.match(/[MLHVCSQTZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  let cmd = null;
  for (let i = 0; i < tokens.length;) {
    if (/[A-Z]/i.test(tokens[i])) { cmd = tokens[i].toUpperCase(); i += 1; if (cmd === 'Z') continue; }
    const n = (k) => Number(tokens[i + k]);
    if (cmd === 'H') { x = n(0); add(x, y); i += 1; } else if (cmd === 'V') { y = n(0); add(x, y); i += 1; } else {
      const len = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4 }[cmd];
      for (let k = 0; k < len; k += 2) add(n(k), n(k + 1));
      x = n(len - 2); y = n(len - 1); i += len;
    }
  }
  return box;
}

/** Вырез круглой иконки: всё после первого подпути (самого круга). Рамка —
 *  квадрат одной стороны для всех знаков с центром на знаке: так у галочки,
 *  крестика и шеврона одна толщина линии, как задумано в Solar. */
function glyph(dir, rel) {
  const paths = readSolar(dir, rel);
  if (paths.length !== 1 || !paths[0][1]) throw new Error(`${rel}: ждали один путь с вырезом`);
  const d = paths[0][0];
  const cut = d.indexOf('Z');
  const mark = d.slice(cut + 1).trim();
  if (!mark.startsWith('M')) throw new Error(`${rel}: не нашёлся вырез после круга`);
  const [x0, y0, x1, y1] = bbox(mark);
  const side = GLYPH_SIDE;
  if (Math.max(x1 - x0, y1 - y0) > side) throw new Error(`${rel}: знак шире рамки ${side}`);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const vb = [cx - side / 2, cy - side / 2, side, side].map(fmt).join(' ');
  return { vb, p: [[mark, 0]] };
}

function build(dir) {
  const icons = {};
  for (const [name, rel] of Object.entries(GLYPH)) icons[name] = Object.assign(glyph(dir, rel), { src: rel });
  for (const [name, rel] of Object.entries(FULL)) icons[name] = { vb: '0 0 24 24', p: readSolar(dir, rel), src: rel };
  const body = Object.entries(icons).map(([name, ic]) => {
    const p = ic.p.map(([d, e]) => `[${JSON.stringify(squeeze(d))}, ${e}]`).join(', ');
    return `    // ${ic.src}\n    ${JSON.stringify(name)}: { vb: ${JSON.stringify(ic.vb)}, p: [${p}] },`;
  }).join('\n');
  const src = `/* Иконки — Solar Bold (480 Design, CC BY 4.0,
 * https://github.com/480-Design/Solar-Icon-Set). СОБРАНО
 * scripts/make-solar-icons.js — руками не править: поменять иконку значит
 * поменять словарь в генераторе и запустить его.
 *
 * Общий файл для всех поверхностей: десктоп и веб читают его <script>,
 * редактор — import, телефон — копией в mobile/src/core.
 *
 * Иконка — { vb: viewBox, p: [[d, evenodd]] }. Цвета нет: заливка берётся
 * из currentColor (HTML) или пропа color (телефон).
 */
(function (global) {
  const ICONS = {
${body}
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /** Пути иконки разметкой — для строк HTML. */
  function iconPaths(name) {
    const ic = ICONS[name];
    if (!ic) return '';
    return ic.p.map(([d, e]) => (e ? \`<path fill-rule="evenodd" clip-rule="evenodd" d="\${d}"/>\` : \`<path d="\${d}"/>\`)).join('');
  }

  /** <svg> иконки для строк HTML. cls — класс (по умолчанию icon). */
  function iconSvg(name, cls) {
    const ic = ICONS[name];
    if (!ic) return '';
    return \`<svg class="\${esc(cls || 'icon')}" data-icon="\${esc(name)}" viewBox="\${ic.vb}" fill="currentColor" aria-hidden="true">\${iconPaths(name)}</svg>\`;
  }

  const api = { ICONS, iconPaths, iconSvg };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(OUT, src);
  console.log(`[make-solar-icons] ${Object.keys(icons).length} иконок → ${path.relative(ROOT, OUT)}`);
}

// Атрибуты, которые иконке Solar не нужны или мешают: старая рамка, обводка
// контурных иконок лендинга, заливка «none».
const DROP = /\s(?:viewBox|fill|fill-rule|clip-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|data-icon)="[^"]*"/g;

/** Каждый <svg data-icon="имя"> в HTML получает пути и рамку из словаря. */
function applyHtml() {
  delete require.cache[OUT];
  const { ICONS, iconPaths } = require(OUT);
  for (const rel of HTML) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const missing = [];
    let count = 0;
    const out = raw.replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g, (whole, attrs) => {
      const name = (attrs.match(/\sdata-icon="([^"]+)"/) || [])[1];
      if (!name) return whole;
      if (!ICONS[name]) { missing.push(name); return whole; }
      count += 1;
      const rest = attrs.replace(DROP, '').replace(/\s+$/, '');
      return `<svg${rest} data-icon="${name}" viewBox="${ICONS[name].vb}" fill="currentColor">${iconPaths(name)}</svg>`;
    });
    if (missing.length) throw new Error(`${rel}: нет в словаре: ${[...new Set(missing)].join(', ')}`);
    if (out !== raw) fs.writeFileSync(file, out);
    if (count) console.log(`${out === raw ? '=' : '→'} ${rel}: ${count}`);
  }
}

const at = process.argv.indexOf('--solar');
if (at !== -1) build(path.resolve(process.argv[at + 1] || ''));
else if (!fs.existsSync(OUT)) throw new Error('core/icons.js ещё не собран: запустите с --solar <папка Solar Bold>');
applyHtml();

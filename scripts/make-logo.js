// Знак Lancible: один исходник на все поверхности — assets/logo-mark.svg.
//
// Исходник монохромный (fill="currentColor"): цвет задаёт то место, где знак
// стоит. В интерфейсе это токен акцента своей поверхности — `color` у
// .tb-logo-mark в styles.css, у .brand svg, .footer-brand svg и героя
// лендинга в landing.css, — поэтому в разметке цвета нет. Единственное
// исключение — favicon: картинка в data:-адресе не видит ни CSS страницы, ни
// её токенов, и цвет вписан в неё сам (ACCENT ниже — тот же, что --accent в
// styles.css и landing.css; сверяет tests/unit/logo.test.js).
//
// Что делает запуск: переносит знак из исходника в разметку — шапка
// десктопа и веба (.tb-logo-mark в обоих index.html), шапка, подвал и герой
// лендинга (.brand, .footer-brand, .rocket-wrap) и favicon в <head> каждой
// страницы. Править знак руками в HTML не нужно: заменили assets/logo-mark.svg,
// запустили скрипт и перегенерировали растровые иконки.
//
// Растровые иконки рисуют другие скрипты и читают тот же исходник отсюда
// (readLogo, markJs):
//   npm run icon                      build/icon.ico и build/icon.png (десктоп);
//   npx electron scripts/make-mobile-icons.js   mobile/assets/* (телефон).
//
// Знак шире, чем высок (48×36 в поле 64×64), и стоит в поле не по центру,
// поэтому и в иконках, и в favicon его ставят по рамке (logoBox), а не по
// полю исходника. А там, где он стоит один, ещё и спускают на OPTICAL_DROP
// (см. ниже): треугольник вершиной вниз тянет вес вверх.
//
// Запуск: node scripts/make-logo.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo-mark.svg');
const ACCENT = '#69d345';
// Оптическая центровка. Знак — треугольник вершиной вниз: широкий верх тянет
// вес вверх (центр площади — на 36% высоты от верхнего края, а не на 50%), и
// по рамке он в квадрате выглядит высоко. Поэтому там, где знак стоит один —
// иконки, favicon, герой лендинга, — его спускают на эту долю высоты знака:
// примерно полпути от центра рамки к центру площади (14%). Один параметр на
// все места; в строку с текстом («Lancible» в шапке и подвале) знак не
// смещается — там его выравнивает текст.
const OPTICAL_DROP = 0.08;
const FILES = [
  'src/renderer/index.html',
  'web/index.html',
  // graph-view.html — выгрузка graphify, внутри graph.html: ни шапки, ни favicon у неё нет.
  ...fs.readdirSync(path.join(ROOT, 'landing')).filter((f) => f.endsWith('.html') && f !== 'graph-view.html').map((f) => `landing/${f}`),
];

/** Исходник: поле (viewBox) и контуры. Заливки в нём нет — только currentColor. */
function readLogo() {
  const svg = fs.readFileSync(SOURCE, 'utf8');
  const viewBox = (svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"/) || [])[1];
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  if (!viewBox || !paths.length) throw new Error(`${SOURCE}: нет viewBox или контуров`);
  return { viewBox, paths };
}

/** Рамка контуров: {x, y, w, h}. Разбирает M, L, H, V, C, Z (как отдаёт Figma);
 *  у кривых берёт крайние точки по производной, а не опорные. */
function logoBox({ paths }) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  // Крайние точки одной оси кубической кривой: корни производной на (0, 1).
  const extremes = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const roots = [];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-c / b); } else {
      const d = b * b - 4 * a * c;
      if (d >= 0) roots.push((-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a));
    }
    return roots.filter((t) => t > 0 && t < 1).map((t) => {
      const u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    });
  };
  for (const d of paths) {
    let cx = 0; let cy = 0; let sx = 0; let sy = 0;
    for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      const n = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      if (cmd === 'M') { [cx, cy] = n; sx = cx; sy = cy; add(cx, cy); } else if (cmd === 'L') { [cx, cy] = n; add(cx, cy); } else if (cmd === 'H') { [cx] = n; add(cx, cy); } else if (cmd === 'V') { [cy] = n; add(cx, cy); } else if (cmd === 'C') {
        const [ax, ay, bx, by, ex, ey] = n;
        for (const x of extremes(cx, ax, bx, ex)) add(x, cy);
        for (const y of extremes(cy, ay, by, ey)) add(cx, y);
        [cx, cy] = [ex, ey]; add(cx, cy);
      } else if (cmd === 'Z') { [cx, cy] = [sx, sy]; } else throw new Error(`make-logo.js: команда пути «${cmd}» не поддерживается (нужны M, L, H, V, C, Z)`);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Код для страницы (Electron + canvas): рисует знак на контексте `ctx` — по
 *  центру (cx, cy), шириной `width` в пикселях, цветом `color`. Ставит по
 *  рамке знака, а не по полю исходника, и спускает на OPTICAL_DROP. */
function markJs(logo, { ctx = 'x', cx, cy, width, color }) {
  const b = logoBox(logo);
  return `{
    const k = (${width}) / ${b.w};
    ${ctx}.save();
    ${ctx}.translate((${cx}) - (${b.x} + ${b.w / 2}) * k, (${cy}) + ${OPTICAL_DROP * b.h} * k - (${b.y} + ${b.h / 2}) * k);
    ${ctx}.scale(k, k);
    ${ctx}.fillStyle = ${JSON.stringify(color)};
    for (const d of ${JSON.stringify(logo.paths)}) ${ctx}.fill(new Path2D(d));
    ${ctx}.restore();
  }`;
}

const fmt = (n) => +n.toFixed(3);

/** Поле для разметки — рамка знака впритык: знак стоит в поле исходника ниже
 *  центра и с пустыми краями, а в шапке его выравнивают по тексту. С `drop` (доля
 *  высоты знака) сверху прибавляется запас, и знак оказывается ниже центра поля
 *  ровно на эту долю: поле остаётся симметричным вокруг знака, а не вокруг центра. */
function markViewBox(logo, drop = 0) {
  const b = logoBox(logo);
  return [b.x, b.y - 2 * drop * b.h, b.w, b.h * (1 + 2 * drop)].map(fmt).join(' ');
}

/** Контуры для HTML: у каждого fill="currentColor", отступ — от тега <svg>. */
function pathsHtml(logo, indent, nl) {
  return logo.paths.map((d) => `${nl}${indent}  <path d="${d}" fill="currentColor"/>`).join('');
}

// Куда знак ставится в разметке: контейнер -> открывающий тег <svg>. Знак — первое
// в контейнере, на своей строке; всё от тега до </svg> заменяется целиком.
// `drop` — знак стоит один (герой), его спускают на OPTICAL_DROP; остальные —
// в строку с текстом, там знак не смещается.
const SLOTS = {
  'tb-logo': { open: (vb) => `<svg class="tb-logo-mark" viewBox="${vb}" aria-hidden="true">` },
  brand: { open: (vb) => `<svg aria-hidden="true" viewBox="${vb}" fill="none" xmlns="http://www.w3.org/2000/svg">` },
  'footer-brand': { open: (vb) => `<svg aria-hidden="true" viewBox="${vb}" fill="none" xmlns="http://www.w3.org/2000/svg">` },
  'rocket-wrap': { drop: true, open: (vb) => `<svg aria-hidden="true" viewBox="${vb}" fill="none" xmlns="http://www.w3.org/2000/svg">` },
};
const SLOT_RE = /(<(?:div|a)\b[^>]*\bclass="(tb-logo|brand|footer-brand|rocket-wrap)"[^>]*>)(\r?\n)([ \t]*)<svg\b[^>]*>[\s\S]*?<\/svg>/g;
const FAVICON_RE = /<link rel="icon" href="data:image\/svg\+xml,[^"]*">/;

/** Favicon: квадратное поле по ширине знака с небольшими полями (как у прежнего
 *  знака — он занимал 84% поля), знак по центру и спущен на OPTICAL_DROP. Поле
 *  исходника не годится: знак в нём занимает 75% ширины и стоит ниже центра. */
function favicon(logo) {
  const b = logoBox(logo);
  const side = b.w * 1.12;
  const vb = [b.x + b.w / 2 - side / 2, b.y + b.h / 2 - side / 2 - OPTICAL_DROP * b.h, side, side].map(fmt).join(' ');
  const fill = `%22 fill=%22%23${ACCENT.slice(1).toUpperCase()}%22/>`;
  const body = logo.paths.map((d) => `<path d=%22${d}${fill}`).join('');
  return `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%22${vb.replace(/ /g, '%20')}%22>${body}</svg>">`;
}

/** Страница со знаком, взятым из исходника. */
function apply(html, logo = readLogo()) {
  return html
    .replace(SLOT_RE, (_, open, slot, nl, indent) => `${open}${nl}${indent}${SLOTS[slot].open(markViewBox(logo, SLOTS[slot].drop ? OPTICAL_DROP : 0))}${pathsHtml(logo, indent, nl)}${nl}${indent}</svg>`)
    .replace(FAVICON_RE, () => favicon(logo));
}

if (require.main === module) {
  const logo = readLogo();
  for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    const raw = fs.readFileSync(file, 'utf8');
    const out = apply(raw, logo);
    if (out !== raw) { fs.writeFileSync(file, out); console.log('обновлено:', rel); }
  }
}

module.exports = { ACCENT, OPTICAL_DROP, FILES, SLOT_RE, FAVICON_RE, readLogo, logoBox, markJs, apply };

// «Сохранить как PDF» и печать страниц PDF — то, что делается в браузере
// (17 октября 2026). Сам файл пишет pdf-lib в ленивом модуле (pdfwrite.js);
// здесь из документа собирается план для него: исходные PDF и картинки
// байтами, цвета — значениями токенов, блоки текста — простыми записями.
//
// Цвета. Документ хранит имена (pdfgeom.js: 'ink' и оттенки палитры); их
// значения берутся у токенов темы (getComputedStyle), как у пера
// (ink.js: resolveInkColor), — в PDF слой того же цвета, что на экране.
// «ink» — цвет текста на бумаге (--led-paper-ink), замазка — цвет бумаги
// (--led-paper): страница PDF белая в обеих темах.
//
// Картинки. pdf-lib вшивает только PNG и JPEG, а хранилище картинок
// (assets.js) сжимает фото в WebP — такие перерисовываются через canvas.
import * as G from './pdfgeom.js';
import { schema } from './schema.js';
import { strokeD, strokeOpacity, resolveInkColor } from './ink.js';

const N = schema.nodes;

const css = (cs, tok) => cs.getPropertyValue(tok).trim();

/** Цвета для выгрузки и печати: { ink, paper, c: {оттенок}, hl: {оттенок} }
 *  в долях 0…1 — по токенам темы у узла el. */
export function paperColors(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const pick = (...toks) => { for (const t of toks) { const c = G.parseCssColor(css(cs, t)); if (c) return c; } return null; };
  const out = { ink: pick('--led-paper-ink', '--text'), paper: pick('--led-paper', '--panel'), c: {}, hl: {} };
  for (const hue of G.HUES) {
    out.c[hue] = pick(`--led-c-${hue}`);
    out.hl[hue] = pick(`--led-hl-${hue}`);
  }
  return out;
}

/** Цвет из долей → #rrggbb для canvas (прозрачность — globalAlpha). Число
 *  собирается из значения токена, а не пишется в коде. */
const hex = (c) => {
  if (!c) return 'transparent';
  const two = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${two(c.r)}${two(c.g)}${two(c.b)}`;
};

/** Картинка по адресу. Чужой адрес (http, https) — с CORS: иначе холст,
 *  на котором её нарисовали, «грязный», и toBlob бросает SecurityError
 *  (19 октября 2026). Сервер CORS не разрешил — картинки нет (null). */
const loadImage = (url) => new Promise((resolve) => {
  if (!url) { resolve(null); return; }
  const img = new Image();
  if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** Картинка → то, что вшивает pdf-lib: PNG или JPEG как есть, остальное
 *  (WebP, GIF, BMP, SVG) — перерисовкой в PNG. { bytes, type, w, h } или null. */
export async function embeddable(blob, url) {
  const type = (blob && blob.type) || '';
  const own = !url && blob ? URL.createObjectURL(blob) : null;
  const img = await loadImage(url || own);
  if (own) URL.revokeObjectURL(own);
  if (!img) return null;
  const w = img.naturalWidth || 1;
  const hgt = img.naturalHeight || 1;
  if (blob && /^image\/png$/i.test(type)) return { bytes: await blobBytes(blob), type: 'png', w, h: hgt };
  if (blob && /^image\/jpe?g$/i.test(type)) return { bytes: await blobBytes(blob), type: 'jpg', w, h: hgt };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  canvas.width = 0;
  return png ? { bytes: await blobBytes(png), type: 'png', w, h: hgt } : null;
}

/** Картинка по src документа (asset:…, https:, data:). */
async function imageBySrc(ed, src) {
  if (!src) return null;
  try {
    const blob = src.startsWith('asset:') ? await ed.assets.blob(src) : null;
    const url = blob ? URL.createObjectURL(blob) : await ed.assets.resolve(src);
    const out = await embeddable(blob, url);
    if (blob) URL.revokeObjectURL(url);
    return out;
  } catch { return null; }
}

/** canvas или SVG графика на странице → PNG для плана. */
async function canvasImage(canvas) {
  if (!canvas || !canvas.width) return null;
  const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return png ? { bytes: await blobBytes(png), type: 'png', w: canvas.width, h: canvas.height } : null;
}

/** График — картинкой: у SVG на странице цвета из классов и токенов, а в
 *  отдельном файле их нет, поэтому вычисленные стили переносятся в копию. */
async function svgImage(live) {
  if (!live) return null;
  const copy = live.cloneNode(true);
  const src = [live, ...live.querySelectorAll('*')];
  const dst = [copy, ...copy.querySelectorAll('*')];
  const props = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline'];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    dst[i].setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  const r = live.getBoundingClientRect();
  const k = 2;
  copy.setAttribute('width', String(Math.round(r.width)));
  copy.setAttribute('height', String(Math.round(r.height)));
  const xml = new XMLSerializer().serializeToString(copy);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.width * k));
  canvas.height = Math.max(1, Math.round(r.height * k));
  const c = canvas.getContext('2d');
  c.scale(k, k);
  c.drawImage(img, 0, 0, r.width, r.height);
  return canvasImage(canvas);
}

/** Строчное содержимое блока → слова с оформлением для набора. */
function runs(node) {
  const out = [];
  node.forEach((ch) => {
    if (ch.type === N.hard_break) { out.push({ text: '\n' }); return; }
    if (!ch.isText) return;
    const mark = (name) => ch.marks.find((m) => m.type.name === name);
    const tc = mark('textColor');
    const hl = mark('highlight');
    out.push({
      text: ch.text,
      bold: !!mark('strong'),
      italic: !!mark('em'),
      underline: !!mark('underline') || !!mark('link'),
      strike: !!mark('strike'),
      color: tc && G.HUES.includes(tc.attrs.color) ? tc.attrs.color : (mark('link') ? 'blue' : null),
      hl: hl && G.HUES.includes(hl.attrs.color) ? hl.attrs.color : null,
    });
  });
  return out;
}

/** Блоки документа → записи набора A4 (pdfwrite.js: addFlow). */
async function flowBlocks(ed, plan, node, pos, out, ctx) {
  const c = ctx || { depth: 0, quote: false };
  const put = (b) => out.push(Object.assign({ depth: c.depth, quote: c.quote }, b));
  const img = async (key, getImage) => {
    if (!plan.images[key]) plan.images[key] = await getImage();
    if (plan.images[key]) put({ t: 'img', image: key });
  };
  switch (node.type.name) {
    case 'paragraph': put({ t: 'p', runs: runs(node), align: node.attrs.align }); return;
    case 'heading': put({ t: 'h', level: node.attrs.level, runs: runs(node), align: node.attrs.align }); return;
    case 'code_block': put({ t: 'code', text: node.textContent }); return;
    case 'horizontal_rule': put({ t: 'hr' }); return;
    case 'blockquote':
    case 'callout': {
      let p = pos + 1;
      for (let i = 0; i < node.childCount; i++) {
        const ch = node.child(i);
        await flowBlocks(ed, plan, ch, p, out, { depth: c.depth, quote: true });
        p += ch.nodeSize;
      }
      return;
    }
    case 'bullet_list':
    case 'ordered_list':
    case 'task_list': {
      let p = pos + 1;
      for (let i = 0; i < node.childCount; i++) {
        const item = node.child(i);
        const marker = node.type === N.task_list ? 'check' : (node.type === N.ordered_list ? `${(node.attrs.order || 1) + i}.` : '•');
        let q = p + 1;
        for (let j = 0; j < item.childCount; j++) {
          const ch = item.child(j);
          if (j === 0 && ch.isTextblock) out.push({ t: 'li', depth: c.depth + 1, quote: c.quote, marker, checked: !!item.attrs.checked, runs: runs(ch) });
          else await flowBlocks(ed, plan, ch, q, out, { depth: c.depth + 1, quote: c.quote });
          q += ch.nodeSize;
        }
        p += item.nodeSize;
      }
      return;
    }
    case 'table': {
      const rows = [];
      node.forEach((row) => {
        const cells = [];
        let header = true;
        row.forEach((cell) => { cells.push(cell.textContent); if (cell.type !== N.table_header) header = false; });
        rows.push({ cells, header });
      });
      put({ t: 'table', rows });
      return;
    }
    case 'image':
      await img(node.attrs.src, () => imageBySrc(ed, node.attrs.src));
      if (node.attrs.caption) put({ t: 'caption', text: node.attrs.caption });
      return;
    case 'gallery': {
      let p = pos + 1;
      for (let i = 0; i < node.childCount; i++) { await flowBlocks(ed, plan, node.child(i), p, out, c); p += node.child(i).nodeSize; }
      return;
    }
    case 'chart': {
      const dom = ed.view.nodeDOM(pos);
      await img(`chart:${pos}`, () => svgImage(dom && dom.querySelector && dom.querySelector('.led-chart-body svg')));
      return;
    }
    case 'drawing': {
      const dom = ed.view.nodeDOM(pos);
      await img(`drawing:${pos}`, () => canvasImage(dom && dom.querySelector && dom.querySelector('canvas.led-draw-canvas')));
      return;
    }
    case 'pdfpage':
      // Страница PDF внутри списка или цитаты — картинкой своего превью.
      await img(`page:${pos}`, async () => (await rasterPage(ed, node, { blob: true })) || null);
      return;
    default:
  }
}

/** План выгрузки — см. pdfwrite.js. missing — страниц, у которых на этом
 *  устройстве нет исходного PDF (они уйдут картинкой превью). */
export async function buildPdfPlan(ed) {
  const { doc } = ed.view.state;
  const plan = {
    title: ed.docTitle(),
    lang: ed.lang(),
    colors: paperColors(ed.root),
    sources: {},
    images: {},
    sections: [],
    ink: [],
  };
  let flow = null;
  let missing = 0;
  const children = [];
  // Где блок на экране — для пера (inkPlan): верх в координатах текста и,
  // у страницы PDF, её лист.
  const pmRect = ed.view.dom.getBoundingClientRect();
  const placed = [];
  doc.forEach((node, pos) => children.push({ node, pos }));
  for (const { node, pos } of children) {
    const dom = ed.view.nodeDOM(pos);
    const r = dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : null;
    const at = { node, top: r ? r.top - pmRect.top : null, bottom: r ? r.bottom - pmRect.top : null };
    placed.push(at);
    if (node.type === N.pdfpage) {
      flow = null;
      const sheet = dom && dom.querySelector ? dom.querySelector('.led-pdf-sheet') : null;
      const sr = sheet ? sheet.getBoundingClientRect() : null;
      if (sr && sr.width) at.sheet = { section: plan.sections.length, left: sr.left - pmRect.left, top: sr.top - pmRect.top, k: sr.width / (Number(node.attrs.w) || 595) };
      const a = node.attrs;
      if (!(a.src in plan.sources)) {
        const blob = a.src ? await ed.assets.blob(a.src) : null;
        plan.sources[a.src] = blob ? await blobBytes(blob) : null;
      }
      let preview = null;
      if (!plan.sources[a.src]) {
        missing += 1;
        preview = a.preview || `page:${pos}`;
        if (!plan.images[preview]) plan.images[preview] = await imageBySrc(ed, a.preview);
      }
      const overlays = G.normalizeOverlays(a.overlays, { w: a.w, h: a.h });
      for (const o of overlays) if (o.type === 'image' && !(o.src in plan.images)) plan.images[o.src] = await imageBySrc(ed, o.src);
      plan.sections.push({ kind: 'pdf', src: a.src, page: a.page, w: a.w, h: a.h, preview, overlays });
      continue;
    }
    if (!flow) { flow = { kind: 'flow', blocks: [] }; plan.sections.push(flow); }
    const from = flow.blocks.length;
    await flowBlocks(ed, plan, node, pos, flow.blocks);
    // Первая запись блока несёт его bid: по нему перо находит, где блок встал на A4.
    if (flow.blocks.length > from && node.attrs.bid) { flow.blocks[from].bid = node.attrs.bid; at.bid = node.attrs.bid; }
  }
  plan.inkScale = G.A4_CONTENT_W / Math.max(1, pmRect.width);
  plan.ink = inkPlan(ed, plan, placed);
  return { plan, missing };
}

/** Перо поверх документа — в выгрузку (17 октября 2026). Штрих относится к
 *  блоку верхнего уровня, под чьим верхом он начат (как держится и на
 *  экране, overlay.js: anchor):
 *   - блок — страница PDF: штрих ложится на эту страницу в её координатах —
 *     точно, вектором (target page: лист на экране и его масштаб px → pt);
 *   - другой блок: на страницу A4, где этот блок встал при наборе, от его
 *     верха, в масштабе ширина полосы A4 / ширина текста на экране (target
 *     block). Набор A4 переносит строки по-своему, поэтому внутри длинного
 *     абзаца штрих встаёт приблизительно — но рядом со своим блоком и
 *     вектором; растровая копия экрана поверх A4 легла бы мимо текста ещё
 *     вернее, раз сам текст набран заново.
 *  Спрятанные пометки (настройки «Вид») не выгружаются — что не видно, того
 *  нет и в файле. Цвет «ink» — чёрный на бумаге, а не цвет текста темы. */
export function inkPlan(ed, plan, placed) {
  if (!ed.overlay || ed.settings().inkHidden) return [];
  ed.overlay.measure();
  const strokes = ed.overlay.placed();
  if (!strokes.length) return [];
  const smoothing = (ed.settings().ink || {}).smoothing;
  const out = [];
  for (const st of strokes) {
    const pts = String(st.pts || '').split(';')[0].split(',');
    const y0 = (parseInt(pts[1], 36) || 0) / 10;
    // Блок под началом штриха: последний, чей верх не ниже точки.
    let at = null;
    for (const b of placed) if (b.top != null && b.top <= y0 + 0.5) at = b;
    if (!at) at = placed.find((b) => b.top != null) || null;
    if (!at) continue;
    let target = null;
    if (at.sheet) target = { section: at.sheet.section, ox: at.sheet.left, oy: at.sheet.top, k: at.sheet.k };
    else if (at.bid) target = { bid: at.bid, oy: at.top };
    if (!target) continue;
    const d = strokeD(st, smoothing);
    if (!d) continue;
    let color = null;
    if (st.color === 'ink') color = plan.colors.ink;
    else color = G.parseCssColor(resolveInkColor(st.color, ed.root)) || plan.colors.ink;
    out.push({ d, mode: st.tool === 'shape' ? 'stroke' : 'fill', width: st.size || 2, color, opacity: strokeOpacity(st), target });
  }
  return out;
}

// --- печать и HTML --------------------------------------------------------------------

/** Страница PDF со слоями — одной картинкой (печать, «Скачать HTML»): в
 *  файле нет редактора, чтобы положить слои поверх. Масштаб — как у превью.
 *  { blob: true } — вернуть план-картинку { bytes, type, w, h }, иначе
 *  data:-адрес PNG. Слой-картинку, которую не нарисовать (нет на устройстве,
 *  чужой адрес без CORS), страница пропускает — opts.report.skipped растёт. */
export async function rasterPage(ed, node, opts) {
  const a = node.attrs;
  const page = { w: Number(a.w) || 595, h: Number(a.h) || 842 };
  const url = a.preview ? await ed.assets.resolve(a.preview) : null;
  const img = await loadImage(url);
  const k = img && img.naturalWidth ? img.naturalWidth / page.w : 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.w * k));
  canvas.height = Math.max(1, Math.round(page.h * k));
  const c = canvas.getContext('2d');
  const colors = paperColors(ed.root);
  c.fillStyle = hex(colors.paper);
  c.fillRect(0, 0, canvas.width, canvas.height);
  if (img) c.drawImage(img, 0, 0, canvas.width, canvas.height);
  c.scale(k, k);
  const family = getComputedStyle(ed.root).fontFamily || 'sans-serif';
  const hue = (name) => (name === 'ink' ? colors.ink : colors.c[name]) || colors.ink;
  for (const o of G.normalizeOverlays(a.overlays, page)) {
    if (o.type === 'whiteout') { c.fillStyle = hex(colors.paper); c.fillRect(o.x, o.y, o.w, o.h); continue; }
    if (o.type === 'highlight') {
      const fill = colors.hl[o.fill.color] || colors.paper;
      c.save();
      c.globalAlpha = o.fill.opacity * (fill && fill.a != null ? fill.a : 1);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = hex(fill);
      c.fillRect(o.x, o.y, o.w, o.h);
      c.restore();
      continue;
    }
    if (o.type === 'rect') { c.strokeStyle = hex(hue(o.stroke.color)); c.lineWidth = o.stroke.width; c.strokeRect(o.x, o.y, o.w, o.h); continue; }
    if (o.type === 'arrow') {
      const x2 = o.x + o.w;
      const y2 = o.y + o.h;
      c.strokeStyle = hex(hue(o.stroke.color));
      c.fillStyle = c.strokeStyle;
      c.lineWidth = o.stroke.width;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(x2, y2); c.stroke();
      const [p, q] = G.arrowHead(o.x, o.y, x2, y2, o.stroke.width);
      c.beginPath(); c.moveTo(x2, y2); c.lineTo(p.x, p.y); c.lineTo(q.x, q.y); c.closePath(); c.fill();
      continue;
    }
    if (o.type === 'image') {
      const src = o.src.startsWith('asset:') ? await ed.assets.resolve(o.src) : o.src;
      const im = await loadImage(src);
      if (im) c.drawImage(im, o.x, o.y, o.w, o.h);
      else if (opts && opts.report) opts.report.skipped = (opts.report.skipped || 0) + 1;
      continue;
    }
    if (o.type === 'text') {
      const size = o.font.size;
      c.font = `${o.font.weight === 'bold' ? 700 : 400} ${size}px ${family}`;
      c.fillStyle = hex(hue(o.font.color));
      c.textBaseline = 'alphabetic';
      const m = c.measureText('Hg');
      const asc = m.fontBoundingBoxAscent || size * 0.8;
      const desc = m.fontBoundingBoxDescent || size * 0.2;
      const lead = size * G.LINE_HEIGHT;
      G.wrapText(o.text, o.w, (s) => c.measureText(s).width).forEach((line, i) => {
        c.fillText(line, o.x, o.y + i * lead + (lead - asc - desc) / 2 + asc);
      });
    }
  }
  // Холст всё же «грязный» — страница уходит строкой, а не ошибкой.
  let blob = null;
  try { blob = await new Promise((r) => canvas.toBlob(r, 'image/png')); } catch (e) { console.error('[editor] страница PDF картинкой', e); }
  canvas.width = 0;
  if (!blob) return null;
  if (opts && opts.blob) return { bytes: await blobBytes(blob), type: 'png', w: Math.round(page.w * k), h: Math.round(page.h * k) };
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

/** Байты → base64 — для хозяина (телефон): сообщение уходит строкой JSON. */
export function bytesToBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

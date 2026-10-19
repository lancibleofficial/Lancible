// «Сохранить как PDF» — сборка файла (17 октября 2026). Живёт в ленивой
// сборке editor-pdf.js вместе с pdf.js (точка входа pdfjs.js): pdf-lib и
// fontkit (MIT) весят больше мегабайта, и в editor.js им не место.
//
// На входе — план, который собрал редактор (pdfexport.js): без DOM, только
// байты и числа, — поэтому то же самое гоняет юнит в Node.
//
//   plan = {
//     title, lang,
//     colors: { ink, paper, c: { red… }, hl: { red… } } — { r, g, b, a } 0…1;
//     sources: { [src]: Uint8Array | null } — исходные PDF по asset id;
//     images:  { [key]: { bytes, type: 'png' | 'jpg', w, h } };
//     sections: [
//       { kind: 'pdf', src, page, w, h, preview, overlays }  — страница PDF;
//       { kind: 'flow', blocks: [...] }                       — остальной текст
//                                         (у первой записи блока — его bid);
//     ],
//     ink: [{ d, mode: 'fill'|'stroke', width, color, opacity, target }],
//       target { section, ox, oy, k } — на страницу PDF (px текста → pt:
//       (x − ox) / k), target { bid, oy } — на лист A4 блока bid от его верха
//       в масштабе inkScale (pdfexport.js: inkPlan);
//     inkScale,
//   }
//
// Страница PDF копируется из исходного файла целиком (copyPages: вектор,
// шрифты, ссылки), слои рисуются поверх. Страница с поворотом (/Rotate)
// кладётся на новую страницу своего видимого размера (embedPage + поворот):
// слои стоят в координатах того, что видно. Исходного файла нет (он остался
// на другом устройстве, а облако PDF ещё не принимает) — страница из превью
// картинкой, rasterized растёт, редактор об этом предупреждает.
//
// Остальные блоки — простым набором на страницах A4: заголовки, абзацы с
// жирным, курсивом (наклоном), цветом и маркером, списки и чек-листы, цитаты,
// код, таблицы, линии, картинки. Шрифт — Onest (OFL), тот же, что в
// приложении, — вшит подмножеством: кириллица, казахские и украинские буквы.
import { PDFDocument, rgb, degrees, BlendMode, LineCapStyle } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as G from './pdfgeom.js';
import ONEST_REGULAR from './fonts/Onest-Regular.ttf';
import ONEST_BOLD from './fonts/Onest-Bold.ttf';

export const { A4 } = G;
export const MARGIN = G.A4_MARGIN;

const STYLE = {
  p: { size: 11, lead: 1.45, after: 6 },
  h1: { size: 20, lead: 1.25, before: 12, after: 6, bold: true },
  h2: { size: 16, lead: 1.25, before: 10, after: 5, bold: true },
  h3: { size: 13.5, lead: 1.25, before: 8, after: 4, bold: true },
  h4: { size: 12, lead: 1.25, before: 6, after: 4, bold: true },
  code: { size: 9.5, lead: 1.4, after: 6 },
  cell: { size: 10, lead: 1.35 },
  caption: { size: 9, lead: 1.35, after: 6 },
};

const col = (c, fallback) => {
  const v = c || fallback || { r: 0, g: 0, b: 0 };
  return rgb(v.r, v.g, v.b);
};

/** Метрики шрифта в долях кегля: над базовой линией и под ней (минус). */
function metrics(bytes) {
  const f = fontkit.create(bytes);
  return { asc: f.ascent / f.unitsPerEm, desc: f.descent / f.unitsPerEm };
}

/** Где базовая линия i-й строки, если первая строка начинается в top (pt
 *  сверху): как в CSS — полуинтерлиньяж сверху, потом подъём шрифта. */
export const baselineAt = (top, i, size, lead, m) => top + i * size * lead + (size * lead - (m.asc - m.desc) * size) / 2 + m.asc * size;

/** Текст — без управляющих знаков: шрифту их нечем нарисовать. */
const clean = (s) => String(s == null ? '' : s).replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

export async function writePdf(plan, opts) {
  const o = opts || {};
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const regBytes = o.regular || ONEST_REGULAR;
  const boldBytes = o.bold || ONEST_BOLD;
  const fonts = {
    regular: await out.embedFont(regBytes, { subset: true }),
    bold: await out.embedFont(boldBytes, { subset: true }),
    m: metrics(regBytes),
    mb: metrics(boldBytes),
  };
  if (plan.title) out.setTitle(String(plan.title));
  if (plan.lang) out.setLanguage(String(plan.lang));
  out.setCreator('Lancible');
  out.setProducer('Lancible (pdf-lib)');
  const colors = plan.colors || {};
  const ctx = { out, fonts, colors, plan, images: new Map(), sources: new Map(), rasterized: 0, pages: [], blockAt: {} };

  for (const [i, s] of (plan.sections || []).entries()) {
    if (s.kind === 'pdf') ctx.pages[i] = await addPdfPage(ctx, s);
    else if (s.kind === 'flow') await addFlow(ctx, s.blocks || []);
  }
  drawInk(ctx, plan.ink || [], plan.inkScale || 1);
  if (!out.getPageCount()) out.addPage([A4.w, A4.h]);
  const bytes = await out.save();
  return { bytes, pages: out.getPageCount(), rasterized: ctx.rasterized };
}

// --- картинки и исходники ------------------------------------------------------------

async function embedImage(ctx, key) {
  if (!key) return null;
  if (ctx.images.has(key)) return ctx.images.get(key);
  const im = ctx.plan.images && ctx.plan.images[key];
  let emb = null;
  if (im && im.bytes) {
    try { emb = im.type === 'jpg' ? await ctx.out.embedJpg(im.bytes) : await ctx.out.embedPng(im.bytes); } catch { emb = null; }
  }
  ctx.images.set(key, emb);
  return emb;
}

async function sourceDoc(ctx, src) {
  if (ctx.sources.has(src)) return ctx.sources.get(src);
  const bytes = ctx.plan.sources && ctx.plan.sources[src];
  let doc = null;
  if (bytes) {
    try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch { doc = null; }
  }
  ctx.sources.set(src, doc);
  return doc;
}

// --- страница PDF -------------------------------------------------------------------

async function addPdfPage(ctx, s) {
  const { out } = ctx;
  const w = Number(s.w) || A4.w;
  const hgt = Number(s.h) || A4.h;
  const doc = await sourceDoc(ctx, s.src);
  const index = (Number(s.page) || 1) - 1;
  let page = null;
  let box = { x: 0, y: 0, width: w, height: hgt };
  if (doc && index >= 0 && index < doc.getPageCount()) {
    const srcPage = doc.getPage(index);
    const rotation = srcPage.getRotation().angle % 360;
    if (!rotation) {
      const [copied] = await out.copyPages(doc, [index]);
      page = out.addPage(copied);
      const cb = page.getCropBox();
      box = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    } else {
      // Повёрнутая страница — на новую, своего видимого размера: слои
      // нарисованы в том, что видно, а не в осях файла.
      const cb = srcPage.getCropBox();
      const turned = rotation === 90 || rotation === 270 || rotation === -90 || rotation === -270;
      page = out.addPage(turned ? [cb.height, cb.width] : [cb.width, cb.height]);
      let emb = null;
      // Страница без содержимого (пустая) — рисовать нечего, лист остаётся чистым.
      try { emb = await out.embedPage(srcPage, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height }); } catch { emb = null; }
      const p = G.rotatedPlacement(rotation, cb.width, cb.height);
      if (emb) page.drawPage(emb, { x: p.x, y: p.y, rotate: degrees(p.rotate) });
      const size = page.getSize();
      box = { x: 0, y: 0, width: size.width, height: size.height };
    }
  } else {
    // Исходника нет — страница из превью, картинкой во весь лист.
    page = out.addPage([w, hgt]);
    page.drawRectangle({ x: 0, y: 0, width: w, height: hgt, color: col(ctx.colors.paper) });
    const img = await embedImage(ctx, s.preview);
    if (img) page.drawImage(img, { x: 0, y: 0, width: w, height: hgt });
    ctx.rasterized += 1;
  }
  // Слои — в координатах страницы pdf.js; видимая область та же, что у неё
  // (CropBox), размер pdf.js и pdf-lib может разниться на доли пункта.
  const k = { x: box.width / w, y: box.height / hgt };
  const scaled = { x: box.x, y: box.y, width: box.width, height: box.height };
  for (const raw of G.normalizeOverlays(s.overlays, { w, h: hgt })) {
    const ov = Object.assign({}, raw, { x: raw.x * k.x, y: raw.y * k.y, w: raw.w * k.x, h: raw.h * k.y });
    await drawOverlay(ctx, page, ov, scaled, k.x);
  }
  return { page, box: scaled, kx: k.x };
}

// --- перо ------------------------------------------------------------------------------

/** Штрихи пера (pdfexport.js: inkPlan) — вектором, путь штриха в px текста
 *  на экране: drawSvgPath сдвигает и масштабирует его (ось y — вниз от
 *  точки x, y). */
function drawInk(ctx, ink, inkScale) {
  for (const st of ink) {
    const t = st.target || {};
    let page;
    let scale;
    let x;
    let y;
    if (t.section != null) {
      const at = ctx.pages[t.section];
      if (!at) continue;
      page = at.page;
      scale = at.kx / (t.k || 1);
      x = at.box.x - t.ox * scale;
      y = at.box.y + at.box.height + t.oy * scale;
    } else if (t.bid) {
      const at = ctx.blockAt[t.bid];
      if (!at) continue;
      page = at.page;
      scale = inkScale;
      x = MARGIN;
      y = A4.h - at.y + t.oy * scale;
    } else continue;
    const color = col(st.color, ctx.colors.ink);
    const opacity = Math.max(0, Math.min(1, st.opacity == null ? 1 : st.opacity)) * (st.color && st.color.a != null ? st.color.a : 1);
    if (st.mode === 'stroke') {
      page.drawSvgPath(st.d, { x, y, scale, borderColor: color, borderWidth: st.width, borderOpacity: opacity, borderLineCap: LineCapStyle.Round });
    } else {
      page.drawSvgPath(st.d, { x, y, scale, color, opacity });
    }
  }
}

async function drawOverlay(ctx, page, o, box, k) {
  const { colors, fonts } = ctx;
  const r = G.pdfRect(o, box);
  switch (o.type) {
    case 'whiteout':
      page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(colors.paper) });
      break;
    case 'highlight': {
      // Цвет маркера (--led-hl-*) — бывает и сам полупрозрачным (тёмная тема).
      const c = colors.hl && colors.hl[o.fill.color];
      page.drawRectangle({
        x: r.x, y: r.y, width: r.width, height: r.height,
        color: col(c, colors.paper), opacity: o.fill.opacity * (c && c.a != null ? c.a : 1), blendMode: BlendMode.Multiply,
      });
      break;
    }
    case 'rect':
      page.drawRectangle({
        x: r.x, y: r.y, width: r.width, height: r.height,
        borderColor: col(colors.c && colors.c[o.stroke.color], colors.ink), borderWidth: o.stroke.width * k,
      });
      break;
    case 'arrow': {
      const c = o.stroke.color === 'ink' ? colors.ink : colors.c && colors.c[o.stroke.color];
      const width = o.stroke.width * k;
      const a = G.pdfPoint(o.x, o.y, box);
      const b = G.pdfPoint(o.x + o.w, o.y + o.h, box);
      page.drawLine({ start: a, end: b, thickness: width, color: col(c, colors.ink), lineCap: LineCapStyle.Round });
      // Наконечник — в осях страницы сверху вниз, как у вида; drawSvgPath
      // сам переворачивает ось y от точки (x, y).
      const [p, q] = G.arrowHead(o.x, o.y, o.x + o.w, o.y + o.h, width);
      const top = box.y + box.height;
      page.drawSvgPath(`M ${o.x + o.w} ${o.y + o.h} L ${p.x} ${p.y} L ${q.x} ${q.y} Z`, { x: box.x, y: top, color: col(c, colors.ink), borderWidth: 0 });
      break;
    }
    case 'image': {
      const img = await embedImage(ctx, o.src);
      if (img) page.drawImage(img, { x: r.x, y: r.y, width: r.width, height: r.height });
      break;
    }
    case 'text': {
      const bold = o.font.weight === 'bold';
      const font = bold ? fonts.bold : fonts.regular;
      const m = bold ? fonts.mb : fonts.m;
      const size = o.font.size * k;
      const c = o.font.color === 'ink' ? colors.ink : colors.c && colors.c[o.font.color];
      const lines = G.wrapText(clean(o.text), o.w, (s) => font.widthOfTextAtSize(s, size));
      const top = box.y + box.height;
      lines.forEach((line, i) => {
        if (!line) return;
        const y = top - baselineAt(o.y, i, size, G.LINE_HEIGHT, m);
        page.drawText(line, { x: box.x + o.x, y, size, font, color: col(c, colors.ink) });
      });
      break;
    }
    default:
  }
}

// --- набор на A4 ----------------------------------------------------------------------

class Flow {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = null;
    this.y = 0; // pt сверху
    this.left = MARGIN;
    this.width = A4.w - MARGIN * 2;
    this.bottom = A4.h - MARGIN;
    this.pendingGap = 0;
  }

  newPage() {
    this.page = this.ctx.out.addPage([A4.w, A4.h]);
    this.y = MARGIN;
    this.pendingGap = 0;
  }

  /** Места под высоту hgt — иначе новая страница. Отступ перед блоком в
   *  начале страницы не нужен. */
  ensure(hgt) {
    if (!this.page) this.newPage();
    if (this.y > MARGIN) this.y += this.pendingGap;
    this.pendingGap = 0;
    if (this.y + hgt > this.bottom && this.y > MARGIN) this.newPage();
    // Где блок встал — для пера над ним (drawInk).
    if (this.mark) { this.ctx.blockAt[this.mark] = { page: this.page, y: this.y }; this.mark = null; }
  }

  gap(n) { this.pendingGap = Math.max(this.pendingGap, n || 0); }

  /** Строка слов: tokens [{ text, bold, italic, color, hl, underline, strike }]. */
  layoutRuns(runs, size, width) {
    const { fonts } = this.ctx;
    const words = [];
    for (const run of runs) {
      for (const part of clean(run.text).split(/(\n|\s+)/)) {
        if (!part) continue;
        words.push(Object.assign({}, run, { text: part }));
      }
    }
    const lines = [];
    let cur = [];
    let curW = 0;
    const measure = (wd) => (wd.bold ? fonts.bold : fonts.regular).widthOfTextAtSize(wd.text, size);
    const push = () => {
      while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) curW -= cur.pop().w;
      lines.push(cur);
      cur = [];
      curW = 0;
    };
    const with_ = (wd, text) => Object.assign({}, wd, { text });
    for (const wd of words) {
      if (wd.text === '\n') { push(); continue; }
      if (/^\s+$/.test(wd.text)) {
        if (cur.length) { const w = measure(wd); cur.push(Object.assign(wd, { w })); curW += w; }
        continue;
      }
      let w = measure(wd);
      if (curW + w > width && cur.length) push();
      if (w > width) {
        // Слово шире строки — по буквам.
        let piece = '';
        for (const ch of wd.text) {
          if (piece && measure(with_(wd, piece + ch)) > width) {
            cur.push(Object.assign(with_(wd, piece), { w: measure(with_(wd, piece)) }));
            push();
            piece = '';
          }
          piece += ch;
        }
        wd.text = piece;
        w = measure(wd);
      }
      cur.push(Object.assign(wd, { w }));
      curW += w;
    }
    if (cur.length || !lines.length) push();
    return lines;
  }

  /** Абзац из слов: строки по ширине, страницы — по месту. */
  paragraph(runs, st, opts) {
    const o = opts || {};
    const { fonts, colors } = this.ctx;
    const size = st.size;
    const lead = st.lead;
    const x0 = this.left + (o.indent || 0);
    const width = this.width - (o.indent || 0);
    const lines = this.layoutRuns(runs.map((r) => Object.assign({ bold: !!st.bold }, r, { bold: !!(st.bold || r.bold) })), size, width);
    this.gap(st.before);
    lines.forEach((line, i) => {
      const lh = size * lead;
      this.ensure(lh);
      if (i === 0 && o.marker) o.marker(this.page, this.y, lh);
      if (o.bar) this.page.drawRectangle({ x: x0 - 10, y: A4.h - this.y - lh, width: 2, height: lh, color: col(colors.c && colors.c.gray, colors.ink) });
      let x = x0;
      if (o.align === 'center' || o.align === 'right') {
        const total = line.reduce((n, t) => n + t.w, 0);
        x += o.align === 'center' ? (width - total) / 2 : width - total;
      }
      for (const t of line) {
        const font = t.bold ? fonts.bold : fonts.regular;
        const m = t.bold ? fonts.mb : fonts.m;
        const base = A4.h - baselineAt(this.y, 0, size, lead, m);
        if (t.hl && colors.hl && colors.hl[t.hl]) {
          this.page.drawRectangle({ x, y: A4.h - this.y - lh + size * 0.12, width: t.w, height: lh - size * 0.24, color: col(colors.hl[t.hl]) });
        }
        const c = t.color && colors.c && colors.c[t.color] ? colors.c[t.color] : colors.ink;
        if (!/^\s+$/.test(t.text)) {
          this.page.drawText(t.text, { x, y: base, size, font, color: col(c), xSkew: t.italic ? degrees(12) : undefined });
        }
        if (t.underline) this.page.drawLine({ start: { x, y: base - size * 0.12 }, end: { x: x + t.w, y: base - size * 0.12 }, thickness: size * 0.06, color: col(c) });
        if (t.strike) this.page.drawLine({ start: { x, y: base + size * 0.3 }, end: { x: x + t.w, y: base + size * 0.3 }, thickness: size * 0.06, color: col(c) });
        x += t.w;
      }
      this.y += lh;
    });
    this.gap(st.after);
  }

  rule() {
    this.gap(8);
    this.ensure(10);
    const y = A4.h - this.y - 5;
    this.page.drawLine({ start: { x: this.left, y }, end: { x: this.left + this.width, y }, thickness: 0.6, color: col(this.ctx.colors.c && this.ctx.colors.c.gray, this.ctx.colors.ink) });
    this.y += 10;
    this.gap(8);
  }

  async image(key, indent) {
    const im = this.ctx.plan.images && this.ctx.plan.images[key];
    const img = await embedImage(this.ctx, key);
    if (!img || !im) return;
    const maxW = this.width - (indent || 0);
    const maxH = this.bottom - MARGIN;
    // 1 px картинки — 0,75 pt (96 точек на дюйм), но не шире полосы.
    let w = Math.min(maxW, (im.w || img.width) * 0.75);
    let hgt = w * ((im.h || img.height) / (im.w || img.width));
    if (hgt > maxH) { hgt = maxH; w = hgt * ((im.w || img.width) / (im.h || img.height)); }
    this.gap(6);
    this.ensure(hgt);
    this.page.drawImage(img, { x: this.left + (indent || 0), y: A4.h - this.y - hgt, width: w, height: hgt });
    this.y += hgt;
    this.gap(8);
  }

  table(rows) {
    const { fonts, colors } = this.ctx;
    const n = Math.max(1, ...rows.map((r) => r.cells.length));
    const cw = this.width / n;
    const st = STYLE.cell;
    const pad = 4;
    const border = col(colors.c && colors.c.gray, colors.ink);
    this.gap(6);
    for (const row of rows) {
      const cells = row.cells.map((text) => this.layoutRuns([{ text, bold: row.header }], st.size, cw - pad * 2));
      const lines = Math.max(1, ...cells.map((c) => c.length));
      const rh = lines * st.size * st.lead + pad * 2;
      this.ensure(rh);
      cells.forEach((clines, ci) => {
        const x = this.left + ci * cw;
        this.page.drawRectangle({ x, y: A4.h - this.y - rh, width: cw, height: rh, borderColor: border, borderWidth: 0.5 });
        clines.forEach((line, li) => {
          let tx = x + pad;
          for (const t of line) {
            const font = t.bold ? fonts.bold : fonts.regular;
            const m = t.bold ? fonts.mb : fonts.m;
            if (!/^\s+$/.test(t.text)) this.page.drawText(t.text, { x: tx, y: A4.h - baselineAt(this.y + pad, li, st.size, st.lead, m), size: st.size, font, color: col(colors.ink) });
            tx += t.w;
          }
        });
      });
      this.y += rh;
    }
    this.gap(8);
  }
}

async function addFlow(ctx, blocks) {
  // Пустой хвост (абзац под последней страницей PDF) — не повод для листа.
  const real = blocks.filter((b) => b.t !== 'p' || (b.runs || []).some((r) => String(r.text || '').trim()));
  if (!real.length) return;
  const f = new Flow(ctx);
  for (const b of blocks) {
    if (b.bid) f.mark = b.bid;
    const indent = (b.depth || 0) * 18 + (b.quote ? 14 : 0);
    switch (b.t) {
      case 'h': f.paragraph(b.runs || [], STYLE[`h${Math.min(4, Math.max(1, b.level || 1))}`], { indent, bar: b.quote, align: b.align }); break;
      case 'p': f.paragraph(b.runs || [], STYLE.p, { indent, bar: b.quote, align: b.align }); break;
      case 'li': {
        const marker = (page, top, lh) => {
          const { fonts, colors } = ctx;
          const x = f.left + indent - 14;
          const size = STYLE.p.size;
          if (b.marker === 'check') {
            const s = size * 0.8;
            const y = A4.h - top - (lh + s) / 2;
            page.drawRectangle({ x, y, width: s, height: s, borderColor: col(colors.ink), borderWidth: 0.8 });
            if (b.checked) {
              page.drawLine({ start: { x: x + s * 0.2, y: y + s * 0.5 }, end: { x: x + s * 0.42, y: y + s * 0.25 }, thickness: 1, color: col(colors.ink) });
              page.drawLine({ start: { x: x + s * 0.42, y: y + s * 0.25 }, end: { x: x + s * 0.82, y: y + s * 0.78 }, thickness: 1, color: col(colors.ink) });
            }
            return;
          }
          const label = b.marker || '•';
          const w = fonts.regular.widthOfTextAtSize(label, size);
          page.drawText(label, { x: f.left + indent - 4 - w, y: A4.h - baselineAt(top, 0, size, STYLE.p.lead, fonts.m), size, font: fonts.regular, color: col(colors.ink) });
        };
        f.paragraph(b.runs || [], Object.assign({}, STYLE.p, { after: 2 }), { indent, marker, bar: b.quote });
        break;
      }
      case 'code': f.paragraph([{ text: b.text || '' }], STYLE.code, { indent: indent + 6, bar: true }); break;
      case 'caption': f.paragraph([{ text: b.text || '', color: 'gray' }], STYLE.caption, { indent, align: 'center' }); break;
      case 'hr': f.rule(); break;
      case 'img': await f.image(b.image, indent); break;
      case 'table': f.table(b.rows || []); break;
      default:
    }
  }
}

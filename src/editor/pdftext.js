// Текст страниц PDF → абзацы и заголовки редактора. Чистые функции: ни
// pdf.js, ни DOM — их гоняет юнит (tests/unit/editor-pdf.test.js), а
// pdf.js только поставляет элементы (pdf.js: getTextContent, src/editor/pdf.js).
//
// Как собирается (17 октября 2026, DESIGN.md «PDF в редакторе»):
//  1. Строки — элементы с одной координатой Y (с допуском в полвысоты
//     шрифта: надстрочные и неровная база остаются в строке), слева направо.
//  2. Колонки — в строке широкий промежуток (больше полутора высот шрифта)
//     делит её на куски. Если с одного и того же X куски начинаются во многих
//     строках страницы, там граница колонки: сначала читается левая колонка
//     сверху вниз, потом правая. Кусок, перекрывающий границу (заголовок во
//     всю ширину, подпись внизу), читается на своём месте между ними.
//     Границы не набралось — куски строки снова одна строка через пробел.
//  3. Абзацы — строки подряд, пока между ними нет пустого промежутка (шаг
//     строк больше обычного в 1,4 раза), колонка та же, а размер шрифта —
//     того же рода (заголовок или текст).
//  4. Заголовок — строка крупнее медианного размера шрифта документа в 1,3
//     раза и больше: от 2 раз — первый уровень, от 1,6 — второй, иначе третий.
//  5. Номер страницы — одинокое число первой или последней строкой страницы —
//     не переносится. Перенос слова («приме-» + «ром») склеивается.

const LINE_TOL = 0.5; // строки: допуск по Y — доля высоты шрифта
const COL_GAP = 1.5; // колонки: промежуток в строке шире стольких высот шрифта
const SPACE_GAP = 0.15; // пробел между элементами строки, если его нет в тексте
const PARA_GAP = 1.4; // абзац: шаг строк больше обычного во столько раз
const HEADING = 1.3; // заголовок: крупнее медианы во столько раз
const H1 = 2;
const H2 = 1.6;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/g;

/** Медиана, где у каждого значения свой вес (число знаков). */
function weightedMedian(pairs) {
  const s = pairs.filter((p) => p[1] > 0).sort((a, b) => a[0] - b[0]);
  const total = s.reduce((n, p) => n + p[1], 0);
  let acc = 0;
  for (const [v, w] of s) {
    acc += w;
    if (acc * 2 >= total) return v;
  }
  return 0;
}

/** Элементы getTextContent страницы → { str, x, y, w, size } в координатах
 *  страницы (Y вверх, база строки). Элементы без текста (метки разметки)
 *  и пробелы отбрасываются: промежутки считаются по координатам. */
export function textItems(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string') continue;
    const str = it.str.replace(CONTROL, '');
    if (!str.trim()) continue;
    const t = Array.isArray(it.transform) && it.transform.length >= 6 ? it.transform : [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 1;
    out.push({ str, x: +t[4] || 0, y: +t[5] || 0, w: Math.abs(+it.width || 0), size: Math.round(size * 10) / 10 });
  }
  return out;
}

/** Куски строки → текст: пробел между ними, если его нет и промежуток заметен. */
function joinItems(items) {
  let text = '';
  let prev = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const size = Math.max(it.size, prev.size);
      if (gap > SPACE_GAP * size && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
    }
    text += it.str;
    prev = it;
  }
  return text;
}

/** Основной размер строки — у кого больше знаков. */
function mainSize(items) {
  const by = new Map();
  for (const it of items) by.set(it.size, (by.get(it.size) || 0) + it.str.length);
  let best = items[0].size;
  let n = -1;
  for (const [size, count] of by) if (count > n || (count === n && size > best)) { best = size; n = count; }
  return best;
}

/** Строки страницы по Y, сверху вниз; в каждой — элементы слева направо. */
function rowsOf(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let row = null;
  for (const it of sorted) {
    if (row && Math.abs(row.y - it.y) <= LINE_TOL * Math.max(it.size, row.size)) {
      row.items.push(it);
      // База строки — у самого крупного шрифта: надстрочный её не двигает.
      if (it.size > row.size) { row.size = it.size; row.y = it.y; }
      continue;
    }
    row = { y: it.y, size: it.size, items: [it] };
    rows.push(row);
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/** Строка → куски по широким промежуткам (кандидаты в колонки). */
function segmentsOf(row) {
  const segs = [];
  let cur = null;
  for (const it of row.items) {
    const gap = cur ? it.x - cur.x1 : 0;
    if (!cur || gap > COL_GAP * Math.max(it.size, cur.size)) {
      cur = { items: [], x0: it.x, x1: it.x, size: it.size, y: row.y, split: !!cur };
      segs.push(cur);
    }
    cur.items.push(it);
    cur.x1 = Math.max(cur.x1, it.x + it.w);
    cur.size = Math.max(cur.size, it.size);
  }
  return segs;
}

/** Границы колонок страницы: X, с которого куски после широкого промежутка
 *  начинаются хотя бы в двух строках и не реже чем в каждой пятой. */
function columnBounds(rows, segsByRow) {
  const starts = [];
  for (const segs of segsByRow) for (const s of segs) if (s.split) starts.push(s);
  if (!starts.length) return [];
  starts.sort((a, b) => a.x0 - b.x0);
  const need = Math.max(2, Math.ceil(rows.length * 0.2));
  const bounds = [];
  let group = [starts[0]];
  const flush = () => { if (group.length >= need) bounds.push(Math.min(...group.map((s) => s.x0))); };
  for (const s of starts.slice(1)) {
    if (s.x0 - group[0].x0 <= 2 * s.size) group.push(s);
    else { flush(); group = [s]; }
  }
  flush();
  return bounds;
}

/** Строки страницы в порядке чтения: { text, y, size, key } — key меняется
 *  на смене колонки или полосы между общими строками. */
function readingLines(items) {
  const rows = rowsOf(items);
  const segsByRow = rows.map(segmentsOf);
  const bounds = columnBounds(rows, segsByRow);
  const lineOf = (its, y, extra) => Object.assign({ text: joinItems(its), y, size: mainSize(its) }, extra);
  if (!bounds.length) {
    return rows.map((r) => lineOf(r.items, r.y, { key: 'c0' }));
  }
  const tol = (s) => s.size;
  const colOf = (s) => bounds.filter((b) => s.x0 >= b - tol(s)).length;
  const crosses = (s) => bounds.some((b) => s.x0 < b - tol(s) && s.x1 > b + tol(s));
  const out = [];
  let band = 0;
  let cols = [];
  const flushBand = () => {
    cols.forEach((list, c) => { for (const s of list || []) out.push(lineOf(s.items, s.y, { key: `b${band}c${c}` })); });
    cols = [];
    band += 1;
  };
  for (const segs of segsByRow) {
    for (const s of segs) {
      if (crosses(s)) {
        flushBand();
        out.push(lineOf(s.items, s.y, { key: `b${band}s` }));
        band += 1;
        continue;
      }
      const c = colOf(s);
      (cols[c] = cols[c] || []).push(s);
    }
  }
  flushBand();
  return out;
}

const PAGE_NO = /^[\s\-–—]*\d{1,4}[\s\-–—]*$/;

/** Строки всех страниц: без номеров страниц. */
function documentLines(pages) {
  return (pages || []).map((items, p) => {
    const lines = readingLines(textItems(items));
    const drop = (i) => lines[i] && PAGE_NO.test(lines[i].text);
    if (lines.length > 1 && drop(lines.length - 1)) lines.pop();
    if (lines.length > 1 && drop(0)) lines.shift();
    return lines.map((l) => Object.assign(l, { page: p }));
  });
}

/** Обычный шаг строк в долях высоты шрифта: нижняя четверть шагов между
 *  соседними строками одной колонки и одного размера (медиана сползала бы к
 *  промежуткам между абзацами, когда абзацы короткие). */
function typicalStep(pageLines) {
  const steps = [];
  for (const lines of pageLines) {
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      const size = Math.max(a.size, b.size);
      const step = a.y - b.y;
      if (a.key === b.key && Math.abs(a.size - b.size) <= 0.15 * size && step > 0 && step < 2.5 * size) steps.push(step / size);
    }
  }
  if (!steps.length) return 1.2;
  const s = steps.sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 4)];
}

/** Две строки переноса слова: «приме-» + «ром» → «примером». */
function joinLines(a, b) {
  if (/\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** Страницы (массивы элементов getTextContent) → блоки редактора:
 *  { type: 'heading', level: 1–3, text } и { type: 'paragraph', text }. */
export function pdfTextBlocks(pages) {
  const pageLines = documentLines(pages);
  const all = pageLines.flat();
  if (!all.length) return [];
  const body = weightedMedian(all.map((l) => [l.size, l.text.length])) || 1;
  const levelOf = (size) => {
    const k = size / body;
    if (k < HEADING) return 0;
    return k >= H1 ? 1 : k >= H2 ? 2 : 3;
  };
  const step = typicalStep(pageLines);
  const blocks = [];
  let cur = null;
  let prev = null;
  for (const line of all) {
    const level = levelOf(line.size);
    const text = clean(line.text);
    if (!text) continue;
    let fresh = !cur || !prev || line.page !== prev.page || line.key !== prev.key || level !== cur.level;
    if (!fresh) {
      const gap = prev.y - line.y;
      const size = Math.max(prev.size, line.size);
      if (gap <= 0 || gap > PARA_GAP * step * size) fresh = true;
      // Заголовки разного размера — разные заголовки, даже вплотную.
      if (level && Math.abs(prev.size - line.size) > 0.15 * size) fresh = true;
    }
    if (fresh) {
      cur = { level, text };
      blocks.push(cur);
    } else cur.text = joinLines(cur.text, text);
    prev = line;
  }
  return blocks.map((b) => (b.level ? { type: 'heading', level: b.level, text: clean(b.text) } : { type: 'paragraph', text: clean(b.text) }));
}

// --- строки страницы для «Заменить текст» (волна 2, 17 октября 2026) ---------------
//
// Узел pdfpage хранит attrs.lines — строки распознанного текста страницы в
// её координатах (pt от левого верхнего угла, как у слоёв): по ним
// инструмент «Заменить текст» подсвечивает строку под указателем и ставит
// поверх замазку и текстовый слой тем же кеглем (pdfgeom.js:
// replaceOverlays). Строки — те же, что у сборки абзацев: элементы с одной
// базой по Y, широкий промежуток (колонка, таблица) делит строку на куски.

/** Верх строки над базой и низ под ней — доли кегля: столько закрывает
 *  замазка у любого шрифта (прописные с ударением, хвосты букв). */
export const LINE_ASC = 0.9;
export const LINE_DESC = 0.25;

/** Матрица на матрицу (pdf.js: Util.transform) — без pdf.js. */
export function mulTransform(m, t) {
  return [
    m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

const r1 = (v) => Math.round(v * 10) / 10;

/** Элементы getTextContent и матрица viewport страницы (масштаб 1) →
 *  строки [{ x, y, w, h, size, text }] в pt видимой страницы: y — верх
 *  строки (база − LINE_ASC кегля), h — до LINE_DESC кегля под базой.
 *  Наклонный и повёрнутый текст пропускается: заменять его прямой строкой
 *  нечем. */
export function pageLines(items, viewportTransform) {
  const m = Array.isArray(viewportTransform) && viewportTransform.length >= 6 ? viewportTransform : [1, 0, 0, -1, 0, 0];
  const k = Math.hypot(m[0], m[1]) || 1;
  const its = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string') continue;
    const str = it.str.replace(CONTROL, '');
    if (!str.trim()) continue;
    const t = mulTransform(m, Array.isArray(it.transform) && it.transform.length >= 6 ? it.transform : [1, 0, 0, 1, 0, 0]);
    // Прямой текст на видимой странице: [s, 0, 0, −s, x, база].
    const upright = t[0] > 0 && t[3] < 0 && Math.abs(t[1]) <= 0.02 * t[0] && Math.abs(t[2]) <= 0.02 * -t[3];
    if (!upright) continue;
    const size = Math.round(-t[3] * 10) / 10;
    // rowsOf ждёт ось y вверх, как в PDF: база — со знаком минус.
    its.push({ str, x: t[4], y: -t[5], w: Math.abs(+it.width || 0) * k, size });
  }
  const out = [];
  for (const row of rowsOf(its)) {
    for (const seg of segmentsOf(row)) {
      const text = joinItems(seg.items).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const base = -seg.y;
      const size = mainSize(seg.items);
      out.push({ x: r1(seg.x0), y: r1(base - LINE_ASC * size), w: r1(seg.x1 - seg.x0), h: r1((LINE_ASC + LINE_DESC) * size), size, text });
    }
  }
  return out;
}

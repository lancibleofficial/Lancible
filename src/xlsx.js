'use strict';

// Мини-генератор .xlsx без зависимостей: строит OOXML-части и упаковывает их
// в ZIP вручную. Работает и в Node (main.js, через require), и в браузере
// (веб-версия, через обычный <script> тег) — только Uint8Array/DataView,
// без Buffer/zlib. Записи ZIP всегда хранятся без сжатия (метод 0): у
// TextEncoder+DataView нет браузерного эквивалента Node-совместимого
// deflate без сторонней библиотеки, а несжатый .xlsx всё равно валиден по
// спецификации — только чуть крупнее файл, для табличных выгрузок это
// не проблема.
// Строки — массив ячеек, ячейка это строка | число | { n } | { t } | { f, n }.
//   { n: 12.5 }          — число
//   { n: 12.5, s: 2 }    — число со стилем (2 = формат 0.00)
//   { t: 'текст', s: 1 } — строка со стилем (1 = жирный)
//   { f: 'SUM(F2:F9)', n: 42, s: 2 } — формула с заранее посчитанным значением

(function (root) {
const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

/** @param {{name: string, data: Uint8Array}[]} files */
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = textEncoder.encode(f.name);
    const body = f.data; // всегда без сжатия — метод 0
    const crc = crc32(body);
    const method = 0;

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // bit 11: имена в UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true); // дата 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    parts.push(local, name, body);

    const cd = new Uint8Array(46);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, body.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = concatBytes(central);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBuf.length, true);
  ev.setUint32(16, offset, true);

  return concatBytes([...parts, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

function colLetter(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}

function sanitizeSheetName(name, index) {
  const clean = String(name || `Лист ${index + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim();
  return clean.slice(0, 31) || `Лист ${index + 1}`;
}

function cellXml(cell, ref) {
  if (cell === null || cell === undefined || cell === '') return '';
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
  if (typeof cell === 'string') {
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
  }
  const s = cell.s ? ` s="${cell.s}"` : '';
  if (cell.f !== undefined) {
    return `<c r="${ref}"${s}><f>${esc(cell.f)}</f><v>${cell.n ?? 0}</v></c>`;
  }
  if (cell.n !== undefined) return `<c r="${ref}"${s}><v>${cell.n}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.t ?? '')}</t></is></c>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const cols = sheet.cols
    ? `<cols>${sheet.cols
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const body = rows
    .map((cells, r) => {
      const rn = r + 1;
      const inner = cells.map((cell, c) => cellXml(cell, colLetter(c) + rn)).join('');
      return `<row r="${rn}">${inner}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * @param {{ name: string, rows: any[][], cols?: {width:number}[] }[]} sheets
 * @returns {Uint8Array}
 */
function buildWorkbook(sheets) {
  const names = sheets.map((s, i) => sanitizeSheetName(s.name, i));
  const stylesRid = `rId${sheets.length + 1}`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets>' +
    '<calcPr calcId="0" fullCalcOnLoad="1"/>' +
    '</workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="${stylesRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', data: textEncoder.encode(contentTypes) },
    { name: '_rels/.rels', data: textEncoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: textEncoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: textEncoder.encode(STYLES_XML) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: textEncoder.encode(sheetXml(s)),
    })),
  ];

  return zip(files);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildWorkbook };
} else {
  root.buildWorkbook = buildWorkbook;
}
})(typeof window !== 'undefined' ? window : globalThis);

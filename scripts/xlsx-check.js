// Проверка src/xlsx.js без Excel: CRC32, распаковка ZIP, well-formed XML.
// Запуск: node scripts/xlsx-check.js  (пишет scripts/_check.xlsx для ручной проверки)
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { buildWorkbook } = require('../src/xlsx');

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
};

// --- CRC32 против известного значения ---
{
  const mod = fs.readFileSync(path.join(__dirname, '..', 'src', 'xlsx.js'), 'utf8');
  // косвенно: соберём книгу и распакуем — если CRC врут, наш же распаковщик поймает
  assert(mod.includes('0xedb88320'), 'CRC32 polynomial present');
}

// --- Минимальный распаковщик ZIP (по локальным заголовкам) ---
function unzip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const compSize = buf.readUInt32LE(i + 18);
    const rawSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    const body = buf.slice(dataStart, dataStart + compSize);
    const raw = method === 8 ? zlib.inflateRawSync(body) : body;
    if (raw.length !== rawSize) throw new Error(`size mismatch in ${name}`);
    // сверяем CRC
    let c = 0xffffffff;
    for (let k = 0; k < raw.length; k++) {
      c ^= raw[k];
      for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    if (((c ^ 0xffffffff) >>> 0) !== crc) throw new Error(`CRC mismatch in ${name}`);
    files[name] = raw.toString('utf8');
    i = dataStart + compSize;
  }
  if (buf.readUInt32LE(i) !== 0x02014b50 && buf.readUInt32LE(i) !== 0x06054b50) {
    throw new Error('unexpected bytes after local entries');
  }
  return files;
}

// --- примитивная проверка well-formed XML (баланс тегов) ---
function xmlWellFormed(xml) {
  const stack = [];
  const re = /<\/?([A-Za-z_:][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [full, tag, , selfClose] = m;
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    if (full.startsWith('</')) {
      if (stack.pop() !== tag) return `mismatched </${tag}>`;
    } else if (!selfClose) {
      stack.push(tag);
    }
  }
  return stack.length === 0 ? null : `unclosed <${stack[stack.length - 1]}>`;
}

const now = Date.now();
const sheets = buildWorkbook([
  {
    name: 'Задача A/B*',
    cols: [{ width: 6 }, { width: 20 }],
    rows: [
      [{ t: 'Задача', s: 1 }, 'Тест "кавычки" & <>'],
      [{ t: 'Всего', s: 1 }, '01:05:30', { n: 1.0916666, s: 2 }],
      [],
      [{ t: '#', s: 1 }, { t: 'Часы', s: 1 }],
      [1, { n: 0.5, s: 2 }],
      [2, { n: 0.5916, s: 2 }],
      [{ t: 'Итого', s: 1 }, { f: 'SUM(B5:B6)', n: 1.0916, s: 2 }],
    ],
  },
]);

fs.writeFileSync(path.join(__dirname, '_check.xlsx'), sheets);
assert(sheets.length > 400, `workbook built (${sheets.length} bytes)`);

const files = unzip(sheets);
assert('[Content_Types].xml' in files, '[Content_Types].xml present + CRC ok');
assert('xl/workbook.xml' in files, 'xl/workbook.xml present');
assert('xl/worksheets/sheet1.xml' in files, 'sheet1 present');
assert('xl/styles.xml' in files, 'styles.xml present');
assert('xl/_rels/workbook.xml.rels' in files, 'workbook rels present');

for (const [name, xml] of Object.entries(files)) {
  const err = xmlWellFormed(xml);
  assert(!err, `well-formed: ${name}${err ? ' — ' + err : ''}`);
}

const sheet = files['xl/worksheets/sheet1.xml'];
assert(sheet.includes('&quot;') || sheet.includes('&amp;'), 'special chars escaped in cells');
assert(sheet.includes('<f>SUM(B5:B6)</f>'), 'formula cell written');
assert(/name="Задача A B "/.test(files['xl/workbook.xml']) || /Задача A B/.test(files['xl/workbook.xml']),
  'sheet name sanitized (no []:*?/\\)');

console.log(process.exitCode ? '\nX some checks failed' : '\nAll xlsx checks passed');

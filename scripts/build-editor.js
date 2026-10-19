// Сборка редактора: src/editor/ (ProseMirror и наш код) → один файл.
// Запуск: npm run build:editor
//
// Почему сборка закоммичена, а не делается на лету. У приложения нет
// сборщика: десктоп и веб грузят обычные <script>, а телефон кладёт
// редактор строкой в WebView. ProseMirror же — десяток ES-модулей. Собрать
// их нужно один раз на правку редактора, а не на каждой машине: Vercel
// ставит только web/package.json, EAS собирает телефон из mobile/ и
// корневых скриптов не запускает.
//
// Что получается:
//  - src/renderer/editor.js — для десктопа и веба (window.LancibleEditor);
//    в web/ его кладёт sync-web-assets.js вместе с app.js;
//  - mobile/src/editor/editorBundle.js — то же строкой плюс стили редактора
//    для WebView телефона, его окно (EDITOR_VIEWPORT) и версия протокола
//    нативной панели (EDITOR_PROTOCOL) — обе из src/editor/host.js;
//  - src/renderer/editor-pdf.js — PDF-модуль (window.LancibleEditorPdf) из
//    src/editor/pdfjs.js: pdf.js с воркером (чтение) и с 17 октября 2026
//    pdf-lib, fontkit и шрифт Onest (запись, src/editor/pdfwrite.js),
//    отдельным файлом рядом с editor.js: редактор грузит его тегом <script>
//    при первом PDF (src/editor/pdf.js), в web/ его кладёт тот же
//    sync-web-assets.js. В строку редактора телефона он не входит: три
//    мегабайта в WebView каждой заметки ни к чему;
//  - mobile/assets/editor-pdf.txt — тот же PDF-модуль текстом, ассетом
//    телефона (txt — обычный ассет Metro, в APK офлайн): хозяин впрыскивает
//    его в WebView по запросу редактора pdf-module (протокол 3, host.js).
//    Отпечаток — тот же, что у editor-pdf.js.
//
// В шапке каждого файла — отпечаток исходников (у editor-pdf.js — свой: его
// исходники, шрифты и версии pdfjs-dist, pdf-lib и fontkit). tests/unit/editor-bundle.test.js сверяет их с
// исходниками и краснеет, если редактор поправили, а собрать забыли.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'editor');
const OUT_RENDERER = path.join(ROOT, 'src', 'renderer', 'editor.js');
const OUT_MOBILE = path.join(ROOT, 'mobile', 'src', 'editor', 'editorBundle.js');
const OUT_PDF = path.join(ROOT, 'src', 'renderer', 'editor-pdf.js');
const OUT_PDF_ASSET = path.join(ROOT, 'mobile', 'assets', 'editor-pdf.txt');
const PDF_ENTRY = path.join(SRC, 'pdfjs.js');
/** Исходники, которые входят только в editor-pdf.js: точка входа и запись
 *  PDF. pdfgeom.js — общий у обеих сборок (вид слоёв и выгрузка). */
const PDF_ONLY = ['pdfjs.js', 'pdfwrite.js'];
const PDF_SOURCES = [...PDF_ONLY, 'pdfgeom.js'].map((f) => path.join(SRC, f));
const PDF_FONTS = ['Onest-Regular.ttf', 'Onest-Bold.ttf'].map((f) => path.join(SRC, 'fonts', f));
/** Библиотеки PDF-модуля: их версии — часть отпечатка. */
const PDF_LIBS = ['pdfjs-dist', 'pdf-lib', '@pdf-lib/fontkit'];
const STYLES = path.join(ROOT, 'src', 'renderer', 'styles.css');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** Файлы, от которых зависит сборка. Перевод строки — LF до хэша, чтобы на
 *  Windows с autocrlf отпечаток был тем же. */
function sourceFiles() {
  // pdfjs.js и pdfwrite.js — только в другой сборке (editor-pdf.js), у неё свой отпечаток.
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && !PDF_ONLY.includes(f)).sort().map((f) => path.join(SRC, f));
  files.push(path.join(ROOT, 'src', 'renderer', 'core', 'doc.js'));
  files.push(path.join(ROOT, 'src', 'renderer', 'core', 'icons.js'));
  return files;
}

/** Стили редактора для телефона: раздел «Редактор» из styles.css и общие
 *  детали, на которых он стоит (меню, окно, переключатели, поля). Цвета —
 *  токенами; значения токенов телефон подставляет из theme.js. */
const SHARED = [
  /^\.ctx-/, /^\.modal/, /^\.segmented/, /^\.switch/, /^\.field/, /^\.btn-soft/, /^#ledmodal-backdrop/,
];

function editorCss() {
  const css = read(STYLES);
  const start = css.indexOf('/* ---------- Редактор ----------');
  if (start < 0) throw new Error('в styles.css нет раздела «Редактор»');
  const rest = css.slice(start + 10);
  const endRel = rest.search(/\/\* (?:----------|==========) /);
  const section = css.slice(start, endRel < 0 ? css.length : start + 10 + endRel);
  const { cssRules } = require('../tests/css.js');
  const shared = [];
  for (const r of cssRules(css)) {
    if (r.at && !r.at.startsWith('@media')) continue;
    const sels = r.sel.split(',').map((s) => s.trim());
    const keep = sels.filter((s) => SHARED.some((re) => re.test(s)));
    if (!keep.length) continue;
    // Из общего правила подложек берём только нашу подложку.
    const sel = keep.join(', ');
    const rule = `${sel} { ${r.body} }`;
    shared.push(r.at ? `${r.at} { ${rule} }` : rule);
  }
  const frames = (css.match(/@keyframes (?:popIn|backdropIn)\s*\{[\s\S]*?\}\s*\}/g) || []);
  return [frames.join('\n'), shared.join('\n'), section].join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{2,}/g, '\n');
}

/** Окно WebView и версия протокола телефона — из src/editor/host.js, чтобы
 *  DocEditor брал их из сборки, а не держал свою копию строки. */
function hostConstants() {
  const src = read(path.join(SRC, 'host.js'));
  const viewport = /export const VIEWPORT = '([^']+)'/.exec(src);
  const protocol = /export const PROTOCOL = (\d+);/.exec(src);
  if (!viewport || !protocol) throw new Error('в src/editor/host.js нет VIEWPORT или PROTOCOL');
  return { viewport: viewport[1], protocol: +protocol[1] };
}

function hash() {
  const h = crypto.createHash('sha256');
  for (const f of sourceFiles()) h.update(read(f));
  h.update(editorCss());
  return h.digest('hex').slice(0, 16);
}

/** Версия библиотеки, из которой собран editor-pdf.js. */
const libVersion = (name) => JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`, { paths: [ROOT] }), 'utf8')).version;
const pdfjsVersion = () => libVersion('pdfjs-dist');

/** Отпечаток editor-pdf.js: его исходники, шрифты и версии библиотек —
 *  обновили библиотеку или шрифт и не собрали, тест тоже красный. */
function pdfHash() {
  const h = crypto.createHash('sha256');
  for (const f of PDF_SOURCES) h.update(read(f));
  for (const f of PDF_FONTS) h.update(fs.readFileSync(f));
  for (const lib of PDF_LIBS) h.update(`${lib}@${libVersion(lib)}`);
  return h.digest('hex').slice(0, 16);
}

/** Настройки esbuild у обеих сборок одни: iife с глобалом, без лицензий в коде. */
function esbuildOptions(entry, globalName, extra) {
  return Object.assign({
    entryPoints: [entry],
    globalName,
    bundle: true,
    format: 'iife',
    minify: true,
    legalComments: 'none',
    target: ['chrome100', 'safari15', 'firefox100'],
    write: false,
    charset: 'utf8',
  }, extra || {});
}

async function build() {
  const esbuild = require('esbuild');
  const result = await esbuild.build(esbuildOptions(path.join(SRC, 'index.js'), 'LancibleEditor'));
  const js = result.outputFiles[0].text;
  const stamp = hash();
  const head = `/* lancible-editor ${stamp} — собрано scripts/build-editor.js из src/editor/. Не править руками: npm run build:editor.\n   ProseMirror, markdown-it, perfect-freehand — MIT; иконки lucide — ISC. PDF — отдельным файлом editor-pdf.js: pdf.js — Apache-2.0, pdf-lib и fontkit — MIT, шрифт Onest — OFL 1.1. */\n`;
  fs.writeFileSync(OUT_RENDERER, head + js);
  // pdf.js — свой файл. legalComments: 'none' вырезает лицензии из кода,
  // поэтому шапка называет их сама.
  // Шрифты — байтами внутри файла (loader binary): грузятся вместе с
  // модулем, без отдельного запроса.
  const pdf = await esbuild.build(esbuildOptions(PDF_ENTRY, 'LancibleEditorPdf', { logLevel: 'error', loader: { '.ttf': 'binary' } }));
  const pdfJs = pdf.outputFiles[0].text;
  const pdfFile = `/* lancible-editor-pdf ${pdfHash()} — собрано scripts/build-editor.js из src/editor/pdfjs.js (pdfjs-dist ${pdfjsVersion()}, legacy; pdf-lib ${libVersion('pdf-lib')}; @pdf-lib/fontkit ${libVersion('@pdf-lib/fontkit')}). Не править руками: npm run build:editor.\n`
    + '   pdf.js — © Mozilla Foundation и авторы pdf.js, Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0), без изменений;\n'
    + '   входящие в него core-js и brotli — MIT, обвязка openjpeg — BSD-2-Clause.\n'
    + '   pdf-lib — © 2019 Andrew Dillon, MIT; @pdf-lib/fontkit — © Devon Govett и Andrew Dillon, MIT; входящие pako — MIT и Zlib, tslib — 0BSD.\n'
    + '   Шрифт Onest (Regular, Bold) — © 2021 The Onest Project Authors, SIL Open Font License 1.1 (src/editor/fonts/Onest-OFL.txt), без изменений. */\n' + pdfJs;
  fs.writeFileSync(OUT_PDF, pdfFile);
  // Телефону — тот же файл ассетом (хозяин впрыскивает его по pdf-module).
  fs.mkdirSync(path.dirname(OUT_PDF_ASSET), { recursive: true });
  fs.writeFileSync(OUT_PDF_ASSET, pdfFile);
  fs.mkdirSync(path.dirname(OUT_MOBILE), { recursive: true });
  const css = editorCss();
  const hc = hostConstants();
  fs.writeFileSync(OUT_MOBILE, `${head}export const EDITOR_HASH = ${JSON.stringify(stamp)};\n`
    + `export const EDITOR_PROTOCOL = ${hc.protocol};\nexport const EDITOR_VIEWPORT = ${JSON.stringify(hc.viewport)};\n`
    + `export const EDITOR_CSS = ${JSON.stringify(css)};\nexport const EDITOR_JS = ${JSON.stringify(js)};\n`);
  const kb = (n) => `${Math.round(n / 1024)} КБ`;
  console.log(`[build-editor] ${stamp}: editor.js ${kb(js.length)}, editor-pdf.js и mobile/assets/editor-pdf.txt ${kb(pdfFile.length)}, стили для телефона ${kb(css.length)}`);
}

if (require.main === module) {
  build().catch((e) => { console.error(`[build-editor] ${e.message}`); process.exit(1); });
}

module.exports = { hash, pdfHash, editorCss, hostConstants, OUT_RENDERER, OUT_MOBILE, OUT_PDF, OUT_PDF_ASSET, PDF_ONLY };

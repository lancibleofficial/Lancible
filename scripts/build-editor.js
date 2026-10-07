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
//    для WebView телефона.
//
// В шапке обоих файлов — отпечаток исходников. tests/unit/editor-bundle.test.js
// сверяет его с исходниками и краснеет, если редактор поправили, а собрать
// забыли.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'editor');
const OUT_RENDERER = path.join(ROOT, 'src', 'renderer', 'editor.js');
const OUT_MOBILE = path.join(ROOT, 'mobile', 'src', 'editor', 'editorBundle.js');
const STYLES = path.join(ROOT, 'src', 'renderer', 'styles.css');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** Файлы, от которых зависит сборка. Перевод строки — LF до хэша, чтобы на
 *  Windows с autocrlf отпечаток был тем же. */
function sourceFiles() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(SRC, f));
  files.push(path.join(ROOT, 'src', 'renderer', 'core', 'doc.js'));
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

function hash() {
  const h = crypto.createHash('sha256');
  for (const f of sourceFiles()) h.update(read(f));
  h.update(editorCss());
  return h.digest('hex').slice(0, 16);
}

async function build() {
  const esbuild = require('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'index.js')],
    bundle: true,
    format: 'iife',
    globalName: 'LancibleEditor',
    minify: true,
    legalComments: 'none',
    target: ['chrome100', 'safari15', 'firefox100'],
    write: false,
    charset: 'utf8',
  });
  const js = result.outputFiles[0].text;
  const stamp = hash();
  const head = `/* lancible-editor ${stamp} — собрано scripts/build-editor.js из src/editor/. Не править руками: npm run build:editor.\n   ProseMirror, markdown-it, perfect-freehand — MIT; иконки lucide — ISC. */\n`;
  fs.writeFileSync(OUT_RENDERER, head + js);
  fs.mkdirSync(path.dirname(OUT_MOBILE), { recursive: true });
  const css = editorCss();
  fs.writeFileSync(OUT_MOBILE, `${head}export const EDITOR_HASH = ${JSON.stringify(stamp)};\nexport const EDITOR_CSS = ${JSON.stringify(css)};\nexport const EDITOR_JS = ${JSON.stringify(js)};\n`);
  const kb = (n) => `${Math.round(n / 1024)} КБ`;
  console.log(`[build-editor] ${stamp}: editor.js ${kb(js.length)}, стили для телефона ${kb(css.length)}`);
}

if (require.main === module) {
  build().catch((e) => { console.error(`[build-editor] ${e.message}`); process.exit(1); });
}

module.exports = { hash, editorCss, OUT_RENDERER, OUT_MOBILE };

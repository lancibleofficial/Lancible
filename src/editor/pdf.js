// PDF в редакторе — веб и десктоп (17 октября 2026; телефон — позже).
//
// Команда «PDF» (меню «Вставить» рядом с «Картинкой», меню «/», exec pdf)
// открывает выбор файла: до 20 МБ и до 50 страниц. Дальше окно редактора
// (ui.js: modal) спрашивает, как вставить:
//  - «Страницы» — с 17 октября 2026 каждая страница встаёт узлом pdfpage
//    (pdfpage.js): превью — PNG, который рисует pdf.js (масштаб 2 от размера
//    страницы, но не шире 2000 px), поверх — слои (текст, картинки, фигуры,
//    маркер, замазка). Сам PDF один раз ложится в хранилище картинок
//    (assets.js: устройство и облако doc-assets) — из него «Сохранить как
//    PDF» копирует векторные страницы. Документы, где страницы вставлены
//    картинками до 17 октября, остаются картинками;
//  - «Текст» — текст страниц (getTextContent) собирается в абзацы и
//    заголовки чистой функцией pdftext.js и встаёт обычными блоками.
// Пока идёт — окно «Страница N из M» с отменой (кнопка, Esc).
//
// Импорт привязан к документу, для которого начат (19 октября 2026,
// ed.docJob): сменился документ (setContent — правка с другого устройства,
// другая задача) или редактор закрыт — импорт останавливается, окна
// закрываются, оставшиеся страницы никуда не встают. Исходный PDF ложится в
// хранилище только перед первой страницей, а превью — перед своей; то, что
// легло, но в документ не встало, выбрасывается (assets.discard) — сирот в
// хранилище и в облаке нет.
//
// pdf.js (Mozilla, Apache-2.0) — не в editor.js, а отдельным файлом рядом с
// ним: editor-pdf.js (точка входа src/editor/pdfjs.js, вторая сборка
// scripts/build-editor.js; воркер внутри и в том же потоке). loadPdfJs()
// грузит его тегом <script> с адреса рядом с editor.js при первом PDF и ждёт
// window.LancibleEditorPdf; второй раз не грузит. CSP веба и десктопа
// (script-src 'self') такой тег пропускает: файл со своего адреса. В сборку
// телефона pdf.js не входит. wasm, cmaps и шрифты pdf.js не поставляются:
// картинки JBIG2/JPX в сканах не рисуются, текст без своих шрифтов —
// системными.
import { insertPdfPage, insertBlocks } from './commands.js';
import { h } from './util.js';
import { modal } from './ui.js';
import { schema } from './schema.js';
import { pdfTextBlocks, pageLines } from './pdftext.js';

const N = schema.nodes;

export const PDF_MAX_MB = 20;
export const PDF_MAX_PAGES = 50;
export const PAGE_SCALE = 2;
export const PAGE_MAX_PX = 2000;

export const isPdf = (file) => !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

/** Масштаб картинки страницы шириной width (pt): 2, но не шире 2000 px. */
export const pageScale = (width) => Math.min(PAGE_SCALE, PAGE_MAX_PX / Math.max(1, width));

/** Файл pdf.js рядом со сборкой редактора (scripts/build-editor.js). */
export const PDF_BUNDLE = 'editor-pdf.js';

// Адрес самого editor.js — document.currentScript есть только, пока сборка
// исполняется, то есть сейчас. Веб на сайте живёт в /app/, десктоп — в
// file://…/src/renderer/: от адреса сборки, а не от страницы.
const SELF = typeof document !== 'undefined' && document.currentScript && document.currentScript.src ? document.currentScript.src : '';

/** Адрес editor-pdf.js рядом с editor.js (base — адрес editor.js). */
export const pdfBundleUrl = (base) => new URL(PDF_BUNDLE, base || SELF || document.baseURI).href;

const pdfGlobal = () => (typeof window !== 'undefined' && window.LancibleEditorPdf) || null;

/** PDF-модуль уже на странице (без загрузки). */
export const pdfModuleReady = () => !!pdfGlobal();

let lib = null;

/** pdf.js — один раз на страницу приложения: тег <script> с editor-pdf.js
 *  и его глобал. Не загрузился — следующий вызов попробует снова. */
export function loadPdfJs() {
  if (pdfGlobal()) return Promise.resolve(pdfGlobal());
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = pdfBundleUrl();
      tag.async = true;
      tag.dataset.ledPdf = '';
      tag.onload = () => (pdfGlobal() ? resolve(pdfGlobal()) : reject(new Error(`${PDF_BUNDLE}: нет LancibleEditorPdf`)));
      tag.onerror = () => { tag.remove(); reject(new Error(`${PDF_BUNDLE} не загрузился: ${tag.src}`)); };
      document.head.append(tag);
    });
    lib.catch(() => { lib = null; });
  }
  return lib;
}

/** Сколько ждать модуль от хозяина (телефон), мс. */
export const MODULE_WAIT_MS = 30000;

let hostWait = null;
let hostReady = null;

/** PDF-модуль для этого редактора. Веб и десктоп — тегом <script> рядом со
 *  сборкой (loadPdfJs). Телефон (nativeToolbar, протокол 3): своего адреса
 *  у страницы WebView нет, модуль лежит у хозяина ассетом
 *  (mobile/assets/editor-pdf.txt) — редактор просит его сообщением
 *  { type: 'pdf-module' }, хозяин впрыскивает код (injectJavaScript) и
 *  отвечает { type: 'pdf-module-ready' } (pdfModuleArrived). Один запрос на
 *  страницу; не дождались — следующий вызов спросит снова. */
export function loadPdfModule(ed) {
  if (pdfGlobal()) return Promise.resolve(pdfGlobal());
  if (!(ed && ed.host)) return loadPdfJs();
  if (!hostWait) {
    hostWait = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { hostWait = null; hostReady = null; reject(new Error('pdf-module: хозяин не прислал модуль')); }, MODULE_WAIT_MS);
      hostReady = (error) => {
        clearTimeout(timer);
        hostWait = null;
        hostReady = null;
        if (pdfGlobal() && !error) resolve(pdfGlobal());
        else reject(new Error(`pdf-module-ready: ${error || 'нет LancibleEditorPdf'}`));
      };
    });
    ed.bridge.send({ type: 'pdf-module' });
  }
  return hostWait;
}

/** Ответ хозяина на pdf-module: код впрыснут (или error — не вышло). */
export function pdfModuleArrived(error) {
  if (hostReady) hostReady(error || null);
}

/** Строки страницы attrs.lines (волна 2) — из исходного PDF в хранилище:
 *  для страниц, вставленных до того, как строки стали сохраняться при
 *  импорте. Исходника на устройстве нет — null. */
export async function recognizeLines(ed, attrs) {
  const blob = attrs.src ? await ed.assets.blob(attrs.src) : null;
  if (!blob) return null;
  const pdfjs = await loadPdfModule(ed);
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(Number(attrs.page) || 1);
    const lines = pageLines((await page.getTextContent()).items, page.getViewport({ scale: 1 }).transform);
    page.cleanup();
    return lines;
  } finally {
    task.destroy();
  }
}

/** pdf.js не загрузился (нет сети, файла нет рядом со сборкой) — окно с
 *  причиной: это не ошибка файла человека, тост её бы не объяснил. */
function loadFailed(ed) {
  const t = ed.t;
  modal(ed.root, t('pdf.title'), h('p', { class: 'confirm-text led-pdf-error' }, t('pdf.load_failed')),
    [{ label: t('common.close'), primary: true, run: (close) => close() }], { class: 'modal-lg led-pdf-modal' });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Окно выбора: 'pages' | 'text' | null (передумали). bind(close) — как
 *  закрыть окно извне (документ сменился). */
function chooseMode(ed, file, pages, bind) {
  const t = ed.t;
  return new Promise((resolve) => {
    let picked = null;
    const body = h('div', { class: 'led-pdf-choice' },
      h('p', { class: 'confirm-text led-pdf-file' }, t('pdf.file_info', { name: file.name || 'PDF', n: pages })),
      h('p', { class: 'led-hint' }, h('b', {}, t('pdf.as_pages')), ` — ${t('pdf.as_pages_hint')}`),
      h('p', { class: 'led-hint' }, h('b', {}, t('pdf.as_text')), ` — ${t('pdf.as_text_hint')}`));
    const m = modal(ed.root, t('pdf.title'), body, [
      { label: t('pdf.as_pages'), primary: true, run: (close) => { picked = 'pages'; close(); } },
      { label: t('pdf.as_text'), run: (close) => { picked = 'text'; close(); } },
      { label: t('common.cancel'), run: (close) => close() },
    ], { class: 'modal-lg led-pdf-modal', onClose: () => resolve(picked) });
    if (bind) bind(() => { picked = null; m.close(); });
  });
}

/** Окно хода: «Страница N из M», полоска и отмена. */
function progress(ed, total, onCancel) {
  const t = ed.t;
  let done = false;
  const text = h('p', { class: 'confirm-text led-pdf-step', role: 'status', 'aria-live': 'polite' });
  const fill = h('i');
  const m = modal(ed.root, t('pdf.title'), h('div', { class: 'led-pdf-progress' }, text, h('div', { class: 'led-pdf-bar' }, fill)),
    [{ label: t('common.cancel'), run: (close) => close() }],
    { class: 'modal-lg led-pdf-modal', onClose: () => { if (!done) onCancel(); } });
  return {
    set(n) {
      text.textContent = t('pdf.progress', { n, m: total });
      fill.style.width = `${Math.round(((n - 1) / total) * 100)}%`;
    },
    close() { if (done) return; done = true; m.close(); },
  };
}

/** Размер страницы в pt, как его видит pdf.js (с поворотом), до сотых. */
export const pageSize = (viewport) => ({ w: Math.round(viewport.width * 100) / 100, h: Math.round(viewport.height * 100) / 100 });

/** Страница → PNG. render — для отмены: текущую отрисовку можно прервать. */
async function renderPage(page, onTask) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pageScale(base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  onTask(task);
  try {
    await task.promise;
    return await new Promise((r) => canvas.toBlob(r, 'image/png'));
  } finally {
    onTask(null);
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Элементы getTextContent без ссылок на объекты pdf.js — то, что читает
 *  pdftext.js (и юнит на фикстуре): str, transform, width, height. */
const plainItems = (items) => (items || []).filter((it) => typeof it.str === 'string')
  .map((it) => ({ str: it.str, transform: Array.from(it.transform || []), width: it.width, height: it.height }));

/** Блоки из pdftext.js → узлы редактора. */
export function blocksToNodes(blocks) {
  return blocks.map((b) => (b.type === 'heading'
    ? N.heading.create({ level: b.level }, schema.text(b.text))
    : N.paragraph.create(null, schema.text(b.text))));
}

/** Весь путь: проверка файла, окно выбора, страницы или текст. */
export async function importPdf(ed, file) {
  const t = ed.t;
  if (ed.editable === false) return false;
  if (!isPdf(file)) { ed.toast(t('pdf.not_pdf')); return false; }
  if (file.size > PDF_MAX_MB * 1024 * 1024) { ed.toast(t('pdf.too_big', { mb: PDF_MAX_MB })); return false; }
  // Документ сменился или редактор закрыт — импорт этого документа кончен
  // (см. шапку): закрыть то окно, что открыто сейчас, прервать отрисовку.
  let stopNow = null;
  const job = ed.docJob ? ed.docJob(() => { if (stopNow) stopNow(); }) : { aborted: null, release() {} };
  try {
    return await importInto(ed, file, job, (fn) => { stopNow = fn; });
  } finally {
    job.release();
  }
}

async function importInto(ed, file, job, onStop) {
  const t = ed.t;
  const gone = () => !!job.aborted;
  // Документ сменился (не закрыт) — сказать, что вставка остановлена.
  const changed = () => { if (job.aborted === 'content') ed.toast(t('pdf.doc_changed')); };
  // Легло в хранилище, но в документ не встало — выбросить.
  const drop = (src) => (src && ed.assets.discard ? ed.assets.discard(src).catch(() => {}) : null);
  let pdfjs;
  try {
    if (!pdfGlobal()) ed.toast(t('pdf.opening'));
    pdfjs = await loadPdfModule(ed);
  } catch (e) {
    if (gone()) return false;
    console.error('[editor] pdf.js', e);
    loadFailed(ed);
    return false;
  }
  if (gone()) { changed(); return false; }
  let task = null;
  let doc;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false, verbosity: 0 });
    doc = await task.promise;
  } catch (e) {
    if (task) task.destroy();
    if (gone()) return false;
    ed.toast(e && e.name === 'PasswordException' ? t('pdf.password') : t('pdf.failed'));
    return false;
  }
  if (gone()) { task.destroy(); changed(); return false; }
  const total = doc.numPages;
  if (total > PDF_MAX_PAGES) {
    task.destroy();
    ed.toast(t('pdf.too_many', { max: PDF_MAX_PAGES, n: total }));
    return false;
  }
  const mode = await chooseMode(ed, file, total, onStop);
  onStop(null);
  if (gone()) { task.destroy(); changed(); return false; }
  if (!mode) { task.destroy(); return false; }

  let cancelled = false;
  let render = null;
  const bar = progress(ed, total, () => {
    cancelled = true;
    if (render) render.cancel();
  });
  onStop(() => {
    cancelled = true;
    if (render) render.cancel();
    bar.close();
  });
  const name = (file.name || 'pdf').replace(/\.pdf$/i, '') || 'pdf';
  let inserted = 0;
  const pages = [];
  // Сам PDF — один раз на файл, перед первой страницей: из него выгрузка
  // копирует страницы. Не встала ни одна — он никому не нужен.
  let source = '';
  let preview = '';
  try {
    for (let n = 1; n <= total && !cancelled; n++) {
      bar.set(n);
      await tick();
      if (cancelled) break;
      const page = await doc.getPage(n);
      if (mode === 'pages') {
        const viewport = page.getViewport({ scale: 1 });
        const size = pageSize(viewport);
        // Строки страницы — для «Заменить текст» (волна 2).
        const lines = pageLines((await page.getTextContent()).items, viewport.transform);
        const blob = await renderPage(page, (r) => { render = r; });
        page.cleanup();
        if (cancelled) break;
        if (!blob) throw new Error('страница не нарисовалась');
        if (!source) source = await ed.assets.put(new File([file], file.name || `${name}.pdf`, { type: 'application/pdf' }));
        if (cancelled) break;
        preview = await ed.assets.put(new File([blob], `${name}-${n}.png`, { type: 'image/png' }));
        if (cancelled) break;
        insertPdfPage({ src: source, page: n, w: size.w, h: size.h, preview, overlays: [], lines })(ed.view.state, ed.view.dispatch);
        preview = '';
        inserted += 1;
      } else {
        const content = await page.getTextContent();
        page.cleanup();
        if (cancelled) break;
        pages.push(plainItems(content.items));
      }
    }
  } catch (e) {
    if (!cancelled) {
      bar.close();
      task.destroy();
      drop(preview);
      if (!inserted) drop(source);
      ed.toast(t('pdf.failed'));
      return false;
    }
  }
  onStop(null);
  bar.close();
  task.destroy();
  drop(preview);
  if (!inserted) drop(source);
  if (gone()) { changed(); return false; }
  if (mode === 'pages') {
    if (cancelled) ed.toast(t('pdf.stopped', { n: inserted, m: total }));
  } else if (cancelled) {
    ed.toast(t('pdf.cancelled'));
  } else {
    const blocks = pdfTextBlocks(pages);
    if (!blocks.length) ed.toast(t('pdf.no_text'));
    else insertBlocks(blocksToNodes(blocks))(ed.view.state, ed.view.dispatch);
  }
  if (ed.textEditable()) ed.view.focus();
  return true;
}

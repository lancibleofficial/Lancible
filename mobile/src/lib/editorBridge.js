// Мост телефона к редактору текста в WebView (src/editor/, сборка
// src/editor/editorBundle.js). Единственное место на телефоне, где живёт
// протокол между ними; его описание — DESIGN.md, «Редактор на телефоне:
// протокол», код страницы — src/editor/host.js.
//
// Хозяин → редактор: postMessage JSON (страница отдаёт его ed.receive):
//   exec { name, arg } — команда по имени: bold, heading, bullet, link,
//     image, rowBelow, inkTool, inkColor, inkSize, inkUndo, inkDone, …;
//   setContent { content }, focus, blur, getState;
//   insertImage { dataUrl, name } | { assetId } | { src } | { cancel } —
//     ответ на image-pick;
//   setLink { href, text } — ответ на link;
//   chart { id, spec } — ответ на chart: id null — вставить новый, иначе
//     заменить данные узла; chart { cancel: true } — лист закрыли без
//     сохранения (17 октября 2026, протокол 2, лист — components/ChartSheet.js);
//   pdf-file { name, base64 } | { cancel } — ответ на pdf-pick (протокол 3);
//   pdf-module-ready {} | { error } — ответ на pdf-module: модуль впрыснут
//     (это делает сама впрыснутая строка, lib/editorPdf.js; отсюда — только
//     «уже на странице» и ошибка до впрыска);
//   viewport { top, height } — какая часть WebView видна (живой редактор:
//     край для автопрокрутки при переносе картинки);
//   assets-adopt { userId } — картинки, вставленные без аккаунта, — этому
//     аккаунту (перенос «Без аккаунта», DocEditor: adopt); с referenced: true
//     (протокол 5) — только те, на которые ссылается открытый документ
//     (документ области аккаунта, DocEditor шлёт по ready и после setContent);
//   assets-forget { userId } — стереть с устройства картинки аккаунта
//     (протокол 5, очередь — lib/assetForget.js); ответ — assets-forgotten.
// Редактор → хозяин: postMessage JSON, разбирает parseMessage:
//   assets-forgotten { userId, n } — картинки аккаунта стёрты (n — сколько);
//   format { state } — что включено под курсором (метки, абзац, список,
//     canUndo/canRedo, inTable), есть ли у текста фокус, включено ли перо;
//   caret { top, bottom } — курсор, CSS-пиксели от верха страницы;
//   height { px } — высота содержимого (живой редактор на странице задачи);
//   ink { on, tool, color, size } — режим пометок пером и перо;
//   image-pick { purpose } — нужна картинка; link { href, needText } — нужен
//     адрес ссылки; export { kind, name, mime, text } — отдать файл;
//   chart { id, spec } — вставка или правка графика: данные правит нативный
//     лист (форма spec — lib/chartSpec.js);
//   pdf-pick — выбрать PDF (системный выбор файла, lib/editorPdf.js);
//   pdf-module — впрыснуть PDF-модуль (ассет mobile/assets/editor-pdf.txt);
//   export { kind: 'pdf', name, mime, base64 } — «Сохранить как PDF», байты
//     base64 без data:;
//   autoscroll { dy } — сдвинуть страницу задачи на dy (перенос картинки у
//     края, высота по тексту);
//   gesture { on } — палец ведёт редактор (долгое нажатие: перенос картинки,
//     слой PDF; значок масштаба картинки — сразу): пока on, страница задачи
//     не прокручивается — иначе на Android её ScrollView перехватывает
//     движение, и WebView получает touchcancel (эмулятор, 17 октября 2026);
//   context { kind, state } — что выделено (протокол 4, 18 октября 2026):
//     kind image | table | chart | drawing | pdfpage | pdflayer или null —
//     выделение ушло. Панель над клавиатурой (components/EditorToolbar.js)
//     меняет содержимое на инструменты этого вида — плавающих островов в
//     странице с nativeToolbar нет. Команды панели — exec по именам
//     протокола: deselect, deleteBlock, imageAlign, imageWidth, imageCaption,
//     imageAlt, imageReplace, imageDownload, tableRowAdd, tableColAdd,
//     tableRowDelete, tableColDelete, tableMerge, tableSplit, tableHeaderRow,
//     tableChart, chartEdit, drawingEdit, pdfTool, pdfLayerColor,
//     pdfLayerSize, pdfLayerBold, pdfLayerFront, pdfLayerBack, pdfLayerDelete;
//   и прежние change, settings, toast, open, ready, requeued, error.
//
// Здесь — сторона телефона: команды (createBridge) и разбор сообщений
// (parseMessage). Страница WebView и её опции — components/DocEditor.js.
//
// Масштаба текста (setZoom) телефон не шлёт с 13 октября 2026: щипок над
// страницей мешал писать, а текст и так крупный. Редактор его понимает —
// для десктопа.

/** JSON внутрь <script>: «</» разорвал бы тег. */
export const inline = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Команды хозяина. send(msg) — сообщение в страницу (WebView.postMessage). */
export function createBridge(send) {
  const exec = (name, arg) => send(arg === undefined ? { type: 'exec', name } : { type: 'exec', name, arg });
  return {
    exec,
    setContent: (content) => send({ type: 'setContent', content }),
    focus: () => send({ type: 'focus' }),
    blur: () => send({ type: 'blur' }),
    getState: () => send({ type: 'getState' }),
    insertImage: (payload) => send({ type: 'insertImage', ...(payload || { cancel: true }) }),
    setLink: (href, text) => send({ type: 'setLink', href: href || '', text: text || '' }),
    chart: (id, spec) => send({ type: 'chart', id: id === undefined || id === '' ? null : id, spec }),
    chartCancel: () => send({ type: 'chart', cancel: true }),
    // PDF (протокол 3): файл — ответ на pdf-pick, null — передумали.
    pdfFile: (file) => send(file && typeof file.base64 === 'string'
      ? { type: 'pdf-file', name: file.name || 'document.pdf', base64: file.base64 }
      : { type: 'pdf-file', cancel: true }),
    pdfModuleReady: (error) => send(error ? { type: 'pdf-module-ready', error: String(error) } : { type: 'pdf-module-ready' }),
    viewport: (top, height) => send({ type: 'viewport', top, height }),
    // Перо: режим пометок и инструмент — те же команды exec.
    ink: (on) => exec(on ? 'annotate' : 'inkDone', on ? true : undefined),
    inkTool: (tool) => exec('inkTool', tool),
    inkColor: (color) => exec('inkColor', color),
    inkSize: (size) => exec('inkSize', size),
  };
}

/** Что под курсором, пока редактор ничего не прислал. */
export const EMPTY_FORMAT = Object.freeze({
  strong: false, em: false, underline: false, strike: false, code: false,
  link: null, textColor: null, highlight: null,
  block: 'paragraph', list: null, quote: false, inTable: false,
  canUndo: false, canRedo: false, focused: false, annotating: false,
});

/** Состояние панели из сообщения format: только известные поля. */
export function normalizeFormat(s) {
  const src = s && typeof s === 'object' ? s : {};
  const out = { ...EMPTY_FORMAT };
  for (const k of Object.keys(EMPTY_FORMAT)) {
    if (src[k] === undefined) continue;
    out[k] = typeof EMPTY_FORMAT[k] === 'boolean' ? !!src[k] : src[k];
  }
  return out;
}

/** Одинаково ли состояние: format приходит на каждый шаг курсора, а
 *  перерисовывать панель стоит, только когда что-то поменялось. */
export function sameFormat(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return Object.keys(EMPTY_FORMAT).every((k) => a[k] === b[k]);
}

const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === 'string' ? v : '');

/** Что бывает выделено (сообщение context, протокол 4). */
export const CONTEXT_KINDS = ['image', 'table', 'chart', 'drawing', 'pdfpage', 'pdflayer'];
/** Выравнивание картинки — кнопки панели. Десктоп умеет ещё обтекание
 *  (wrap-left, wrap-right): оно приходит как есть и показывается ближайшей
 *  стороной, а выбрать его на телефоне нельзя. */
export const IMAGE_ALIGNS = ['left', 'center', 'right', 'full'];
const IMAGE_ALIGNS_IN = [...IMAGE_ALIGNS, 'wrap-left', 'wrap-right'];
/** Инструменты страницы PDF; replace — «заменить текст». */
export const PDF_PAGE_TOOLS = ['text', 'image', 'rect', 'arrow', 'highlight', 'whiteout', 'replace'];

/** Состояние выделенного из сообщения context: только известные поля своего
 *  вида, в одном виде. Незнакомое значение — как будто его нет. */
export function normalizeContext(kind, s) {
  const src = s && typeof s === 'object' ? s : {};
  switch (kind) {
    case 'image': {
      const w = num(src.widthPct);
      return {
        align: IMAGE_ALIGNS_IN.includes(src.align) ? src.align : 'center',
        widthPct: w == null ? null : Math.min(100, Math.max(0, w)),
        hasCaption: !!src.hasCaption,
        // Текст подписи протокол 4 не присылает (только hasCaption); придёт —
        // лист подписи откроется с ним.
        caption: str(src.caption),
        alt: str(src.alt),
      };
    }
    case 'table':
      return { canMerge: !!src.canMerge, canSplit: !!src.canSplit, headerRow: !!src.headerRow };
    case 'pdfpage':
      return { tool: PDF_PAGE_TOOLS.includes(src.tool) ? src.tool : null, hasLines: !!src.hasLines };
    case 'pdflayer':
      return {
        type: str(src.type),
        color: typeof src.color === 'string' && src.color ? src.color : null,
        size: num(src.size),
        bold: !!src.bold,
        // Ступени размера от редактора (кегль текста или толщина линии, pt);
        // пусто — менять нечего, null — редактор их не прислал.
        sizes: Array.isArray(src.sizes) ? src.sizes.map(num).filter((v) => v != null && v > 0) : null,
      };
    default:
      return {};
  }
}

/** Одно ли выделение: context приходит вместе с format на каждый шаг. */
export function sameContext(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && JSON.stringify(a.state) === JSON.stringify(b.state);
}

/** Сообщение страницы → { type, … } в одном виде. Не JSON или без type — null.
 *  Старые имена сводятся к новым: drawing → ink, height.height → height.px. */
export function parseMessage(data) {
  let m;
  try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'drawing':
      return { type: 'ink', on: !!m.on };
    case 'ink': {
      const out = { type: 'ink', on: !!m.on };
      if (typeof m.tool === 'string') out.tool = m.tool;
      if (typeof m.color === 'string') out.color = m.color;
      if (num(m.size) != null) out.size = num(m.size);
      return out;
    }
    case 'height': {
      const px = num(m.px != null ? m.px : m.height);
      return px == null ? null : { type: 'height', px };
    }
    case 'format':
      return { type: 'format', state: normalizeFormat(m.state || m) };
    case 'caret': {
      const top = num(m.top);
      const bottom = num(m.bottom);
      return top == null || bottom == null ? null : { type: 'caret', top, bottom };
    }
    case 'link':
      return { type: 'link', href: str(m.href), needText: !!m.needText };
    case 'image-pick':
      return { type: 'image-pick', purpose: m.purpose === 'replace' ? 'replace' : 'insert' };
    case 'export': {
      const out = { type: 'export', kind: str(m.kind), name: str(m.name), mime: str(m.mime), text: str(m.text) };
      // Двоичный файл (kind pdf) — байтами base64, без префикса data:.
      if (typeof m.base64 === 'string') out.base64 = m.base64.replace(/^data:[^,]*,/, '');
      return out;
    }
    case 'pdf-pick':
    case 'pdf-module':
      return { type: m.type };
    // Протокол 5: картинки аккаунта стёрты (ответ на assets-forget).
    case 'assets-forgotten':
      return { type: 'assets-forgotten', userId: typeof m.userId === 'string' && m.userId ? m.userId : null, n: Number.isFinite(Number(m.n)) ? Number(m.n) : 0 };
    case 'gesture':
      return { type: 'gesture', on: !!m.on };
    case 'context': {
      const kind = CONTEXT_KINDS.includes(m.kind) ? m.kind : null;
      return { type: 'context', kind, state: kind ? normalizeContext(kind, m.state) : null };
    }
    case 'autoscroll': {
      const dy = num(m.dy);
      return dy == null || dy === 0 ? null : { type: 'autoscroll', dy };
    }
    case 'chart':
      return {
        type: 'chart',
        id: m.id === undefined || m.id === null || m.id === '' ? null : m.id,
        spec: m.spec && typeof m.spec === 'object' ? m.spec : null,
      };
    default:
      return m;
  }
}

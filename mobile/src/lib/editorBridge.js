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
//   setLink { href, text } — ответ на link.
// Редактор → хозяин: postMessage JSON, разбирает parseMessage:
//   format { state } — что включено под курсором (метки, абзац, список,
//     canUndo/canRedo, inTable), есть ли у текста фокус, включено ли перо;
//   caret { top, bottom } — курсор, CSS-пиксели от верха страницы;
//   height { px } — высота содержимого (живой редактор на странице задачи);
//   ink { on, tool, color, size } — режим пометок пером и перо;
//   image-pick { purpose } — нужна картинка; link { href, needText } — нужен
//     адрес ссылки; export { kind, name, mime, text } — отдать файл;
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
    case 'export':
      return { type: 'export', kind: str(m.kind), name: str(m.name), mime: str(m.mime), text: str(m.text) };
    default:
      return m;
  }
}

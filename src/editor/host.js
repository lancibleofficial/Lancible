// Редактор и его хозяин снаружи: команды по имени, состояние для кнопок и
// сообщения для нативной панели телефона.
//
// С 12 октября 2026 на телефоне панель инструментов — не веб-строка из
// toolbar.js, а нативная строка React Native над клавиатурой. Редактор тогда
// создают с nativeToolbar: true: веб-панели и панели пера в WebView нет
// вовсе, кнопки снаружи шлют команды сообщением (exec), а редактор в ответ
// рассказывает, что включено под курсором (format), где курсор (caret) и
// какой он высоты (height). Протокол целиком — DESIGN.md, «Редактор на
// телефоне: протокол»; здесь его код. Десктоп и веб этим не пользуются,
// кроме exec: его зовут тесты и меню.
import * as C from './commands.js';

/** Версия протокола: растёт, когда меняется форма сообщений. */
export const PROTOCOL = 1;

/** Окно WebView телефона: страница не масштабируется щипком. Масштаба
 *  текста на телефоне нет с 13 октября 2026 (щипок мешал писать), setZoom
 *  остался у редактора для десктопа. Телефон ставит строку в <meta
 *  name="viewport"> (в сборке — EDITOR_VIEWPORT, scripts/build-editor.js
 *  берёт её отсюда). */
export const VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/** Масштаб текста: от 80 % до 200 % размера из «Вида». */
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 2;

/** Масштаб в допустимых пределах, с точностью до процента. Мусор — 1. */
export function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

/** Сообщения о состоянии и курсоре — не чаще раза в столько миллисекунд:
 *  первое уходит сразу, последнее — по таймеру. */
export const THROTTLE_MS = 50;

/** Правка (onChange) после набора — через столько миллисекунд: серия знаков
 *  сливается в одну запись. */
export const CHANGE_MS = 150;

/** Задержка правки. Хозяину (телефон, nativeToolbar) — сразу: у него своя
 *  задержка сохранения (300 мс, mobile/src/hooks/useEditorSession.js), а
 *  уходя с экрана он страницу спросить не успевает — WebView размонтирован
 *  раньше, чем пришёл бы ответ, и последние 150 мс набора терялись
 *  (13 октября 2026). Десктопу и вебу — CHANGE_MS. */
export const changeDelay = (nativeToolbar) => (nativeToolbar ? 0 : CHANGE_MS);

/** Адрес ссылки, как его набирают руками: без схемы — https://, почта — mailto:. */
export function normalizeHref(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('#') || v.startsWith('/')) return v;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : `https://${v}`;
}

/** data:-адрес фото от хозяина → Blob. Без fetch: строгая политика
 *  безопасности страницы (connect-src) не пускает fetch по data:. */
export function dataUrlToBlob(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(url || ''));
  if (!m) throw new Error('не data:-адрес');
  const type = m[1] || 'application/octet-stream';
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Синонимы для «block»: нативная группа «H» шлёт короткие имена. */
const BLOCK_ALIAS = { text: 'paragraph', p: 'paragraph', code: 'code_block', codeblock: 'code_block', bullet: 'bullet_list', ordered: 'ordered_list', tasks: 'task_list' };

/** Команды по имени — одна точка входа для нативной панели, хозяина и
 *  тестов. arg — выбранное значение (уровень заголовка, цвет, тон выноски,
 *  размер таблицы…). Без arg команда делает очевидное или открывает своё
 *  меню у курсора — внутри редактора. Таблица собирается без обращения к
 *  редактору: имена можно перечислить и без DOM (EXEC_NAMES). */
export function commands(ed) {
  const run = (cmd) => cmd(ed.view.state, ed.view.dispatch, ed.view);
  const at = () => ed.caretAnchor();
  const T = C.table;
  const ink = (patch) => ed.overlay.toolbar.set(patch);
  return {
    // история
    undo: () => run(C.undo),
    redo: () => run(C.redo),
    // строчное оформление
    bold: () => run(C.toggle('strong')),
    italic: () => run(C.toggle('em')),
    underline: () => run(C.toggle('underline')),
    strike: () => run(C.toggle('strike')),
    code: () => run(C.toggle('code')),
    sup: () => run(C.toggle('sup')),
    sub: () => run(C.toggle('sub')),
    clear: () => run(C.clearFormatting),
    // Цвет: имя палитры (red, blue…) или null — снять; без arg — палитра у курсора.
    color: (arg) => (arg === undefined ? ed.toolbar.colorMenu('tc', at()) : run(C.setColorMark('textColor', arg || null))),
    // Маркер: без arg — включить жёлтый или снять, как Ctrl+Shift+H.
    highlight: (arg) => run(C.setColorMark('highlight', arg === undefined ? (C.formatState(ed.view.state).highlight ? null : 'yellow') : arg || null)),
    fontSize: (arg) => (arg === undefined ? ed.fontSizeMenu(at()) : run(C.setValueMark('fontSize', 'size', arg || null))),
    fontFamily: (arg) => (arg === undefined ? ed.fontFamilyMenu(at()) : run(C.setValueMark('fontFamily', 'family', arg || null))),
    // Ссылка: строка — поставить, '' или null — снять; без arg — спросить
    // адрес (на телефоне спрашивает хозяин, сообщением «link»).
    link: (arg) => (arg === undefined ? ed.editLink() : run(C.setLink(normalizeHref(arg) || null))),
    // блоки
    block: (arg) => (arg === undefined ? ed.toolbar.blockMenu(at()) : run(C.turnInto(BLOCK_ALIAS[arg] || arg))),
    paragraph: () => run(C.setParagraph),
    heading: (arg) => run(arg ? C.setHeading(+arg) : C.setParagraph),
    bullet: () => run(C.toggleList('bullet_list')),
    ordered: () => run(C.toggleList('ordered_list')),
    tasks: () => run(C.toggleList('task_list')),
    indent: () => run(C.indent),
    outdent: () => run(C.outdent),
    quote: () => run(C.toggleQuote),
    callout: (arg) => run(C.toggleCallout(arg)),
    codeblock: () => run(C.toggleCodeBlock),
    hr: () => run(C.insertRule),
    align: (arg) => (arg === undefined ? ed.toolbar.alignMenu(at()) : run(C.setAlign(arg || 'left'))),
    // вставка
    table: (arg) => run(C.insertTable((arg && arg.rows) || 3, (arg && arg.cols) || 3, !arg || arg.header !== false)),
    image: (arg) => ed.imageCommand(arg),
    imageUrl: (arg) => (arg ? run(C.insertImage({ src: String(arg), alt: '' })) : ed.imageFromUrl(at())),
    chart: () => ed.insertChart(),
    drawing: () => ed.insertDrawing(),
    // таблица под курсором
    rowAbove: () => run(T.rowAbove),
    rowBelow: () => run(T.rowBelow),
    colLeft: () => run(T.colLeft),
    colRight: () => run(T.colRight),
    rowDel: () => run(T.rowDel),
    colDel: () => run(T.colDel),
    tableDel: () => run(T.tableDel),
    merge: () => run(T.merge),
    split: () => run(T.split),
    headerRow: () => run(T.headerRow),
    headerCol: () => run(T.headerCol),
    fill: (arg) => run(T.fill(arg || null)),
    toChart: () => ed.chartFromTable(),
    // документ
    annotate: (arg) => ed.setAnnotate(arg == null ? !ed.annotating : !!arg),
    comment: () => ed.addComment(),
    comments: (arg) => ed.togglePanel('comments', arg),
    outline: (arg) => ed.togglePanel('outline', arg),
    find: (arg) => ed.find.open(!!arg),
    view: () => ed.toolbar.viewMenu(at()),
    fullscreen: (arg) => ed.toggleFullscreen(arg),
    zoom: (arg) => ed.setZoom(arg),
    // выгрузка: на телефоне файл отдаёт хозяин (сообщение «export»)
    exportMd: () => ed.exportAs('md'),
    exportHtml: () => ed.exportAs('html'),
    copyMd: () => ed.copyMarkdown(),
    print: () => ed.print(),
    shortcuts: () => ed.showShortcuts(),
    // перо поверх текста — для нативной строки пера
    inkTool: (arg) => ink({ tool: arg }),
    inkShape: (arg) => ink({ tool: 'shape', shape: arg }),
    inkColor: (arg) => {
      const sf = ed.overlay.surface;
      if (sf.selected.size) { sf.recolorSelected(arg); ed.overlay.toolbar.render(); ed.bridge.ink(); } else ink({ color: arg });
    },
    inkSize: (arg) => ink({ size: Number(arg) }),
    inkUndo: () => ed.overlay.surface.undo(),
    inkRedo: () => ed.overlay.surface.redo(),
    inkDuplicate: () => { ed.overlay.surface.duplicateSelected(); ed.bridge.ink(); },
    inkDelete: () => { ed.overlay.surface.deleteSelected(); ed.bridge.ink(); },
    inkHide: () => ed.hideInk(),
    inkClear: () => ed.overlay.confirmClear(),
    inkDone: () => ed.setAnnotate(false),
  };
}

/** Все имена exec — без редактора. */
export const EXEC_NAMES = Object.keys(commands(null));

/** После этих команд фокус в текст не возвращается: у них своё поле, своё
 *  меню или окно, или они вообще не про текст. Остальные — правка на месте,
 *  и курсор остаётся там, где писали. */
export const KEEP_FOCUS = new Set([
  'color', 'fontSize', 'fontFamily', 'link', 'block', 'align', 'image', 'imageUrl', 'chart', 'drawing', 'toChart',
  'annotate', 'comment', 'comments', 'outline', 'find', 'view', 'fullscreen', 'zoom',
  'exportMd', 'exportHtml', 'copyMd', 'print', 'shortcuts',
  'inkTool', 'inkShape', 'inkColor', 'inkSize', 'inkUndo', 'inkRedo', 'inkDuplicate', 'inkDelete', 'inkHide', 'inkClear', 'inkDone',
]);

/** Что включено под курсором — для подсветки кнопок снаружи. То же, что
 *  видит веб-панель (commands.js: formatState), и сверху состояние самого
 *  редактора. Только простые значения: уходит в JSON. */
export function toolbarState(ed) {
  const fs = C.formatState(ed.view.state);
  return Object.assign(fs, {
    focused: ed.view.hasFocus(),
    editable: ed.editable !== false,
    annotating: !!ed.annotating,
    panel: ed.panel || null,
    find: !!(ed.find && ed.find.dom && !ed.find.dom.hidden),
    zoom: ed.zoom || 1,
    threads: ed.threads().filter((th) => !th.resolved && !th.draft).length,
  });
}

/** Курсор в координатах страницы WebView (CSS px от верха документа). */
export function caretRect(ed) {
  try {
    const c = ed.view.coordsAtPos(ed.view.state.selection.head);
    const y = (typeof window !== 'undefined' && window.scrollY) || 0;
    return { top: Math.round(c.top + y), bottom: Math.round(c.bottom + y) };
  } catch {
    return null;
  }
}

/** Мост к хозяину: отправка сообщений с прореживанием и приём команд. */
export class HostBridge {
  constructor(ed, post) {
    this.ed = ed;
    this.post = post || null;
    this.last = { format: '', caret: '', height: -1 };
    this.timer = null;
    this.dirty = false;
  }

  send(msg) {
    if (!this.post) return;
    try { this.post(msg); } catch { /* хозяина уже нет — сообщение некому слушать */ }
  }

  /** Состояние поменялось (правка, курсор, фокус): сообщить, но не чаще
   *  раза в THROTTLE_MS и без повторов одного и того же. */
  schedule() {
    if (!this.post) return;
    if (this.timer) { this.dirty = true; return; }
    this.flushState();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) { this.dirty = false; this.flushState(); }
    }, THROTTLE_MS);
  }

  flushState() {
    const { ed } = this;
    if (!ed.view) return;
    const state = toolbarState(ed);
    const key = JSON.stringify(state);
    if (key !== this.last.format) { this.last.format = key; this.send({ type: 'format', state }); }
    // Курсор — только пока в тексте фокус: без клавиатуры держать его над
    // ней незачем. Ушёл фокус — забываем, чтобы при возврате прислать снова.
    const caret = state.focused ? caretRect(ed) : null;
    if (!caret) { this.last.caret = ''; return; }
    const ck = `${caret.top},${caret.bottom}`;
    if (ck !== this.last.caret) { this.last.caret = ck; this.send({ type: 'caret', top: caret.top, bottom: caret.bottom }); }
  }

  /** Высота содержимого (opts.autoHeight): WebView растёт по тексту. */
  height(px) {
    if (px === this.last.height) return;
    this.last.height = px;
    // height — то же число под старым именем: так его читает DocEditor.
    this.send({ type: 'height', px, height: px });
  }

  /** Режим пометок и перо — для нативной строки пера. */
  ink() {
    const { ed } = this;
    const s = ed.settings().ink;
    const sel = ed.overlay && ed.overlay.surface ? ed.overlay.surface.selected.size : 0;
    this.send({ type: 'ink', on: !!ed.annotating, tool: s.tool, shape: s.shape, color: s.color, size: s.size, recent: s.recent, selected: sel });
  }

  /** Сообщение от хозяина. true — разобрано здесь; false — не наше
   *  (auth, lang, flush, requeue разбирает страница DocEditor). */
  receive(m) {
    if (!m || typeof m !== 'object') return false;
    const { ed } = this;
    switch (m.type) {
      case 'exec': ed.exec(m.name, m.arg); return true;
      case 'setZoom': ed.setZoom(m.zoom != null ? m.zoom : m.value); return true;
      case 'setContent': ed.setContent(m.content); return true;
      case 'focus': ed.focus(); return true;
      case 'blur': ed.blur(); return true;
      case 'insertImage': ed.insertHostImage(m); return true;
      case 'setLink': ed.applyLink(m.href, m.text); return true;
      case 'getState':
        this.last.format = '';
        this.last.caret = '';
        this.flushState();
        this.ink();
        return true;
      default: return false;
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    this.post = null;
  }
}

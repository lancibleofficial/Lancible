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
//
// График (с 17 октября 2026, протокол 2). На телефоне вставку и правку
// графика ведёт нативный нижний лист, а не окно в WebView. Команда «график»
// (exec chart, «/», меню «Вставить»), «график из таблицы» (toChart) и
// касание графика в тексте шлют хозяину
//
//   editor → host: { type: 'chart', id, spec }
//     id   — bid узла графика (attrs.bid) при правке; null — новый график;
//     spec — { kind, title, rows }:
//       kind  — вид, 'bar' | 'hbar' | 'line' | 'area' | 'pie' | 'donut'
//               (attrs.chart.type, chart.js: CHART_TYPES);
//       title — название, строка (attrs.chart.title, '' — без названия);
//       rows  — [{ label: string, value: number }]: подписи (attrs.chart.labels)
//               и значения первого ряда (attrs.chart.series[0].values).
//     У нового графика spec — образец (defaultChart) или числа таблицы.
//
//   host → editor: ed.receive({ type: 'chart', id, spec })
//     id null — вставить новый график: у курсора, а после «график из
//     таблицы» — сразу под той таблицей; id — заменить данные того графика.
//     { type: 'chart', cancel: true } — передумали (можно не слать).
//
// Разбирать spec хозяину не нужно: редактор принимает его как есть и
// чинит сам (chart.js: chartFromSpec) — вид не из списка остаётся прежним
// ('bars' — синоним 'bar'), значение-строка читается как ячейка таблицы
// («14,5» → 14,5), мусор — 0. Чего в spec нет — легенда, подписи значений,
// стопка, имя ряда, другие ряды, — остаётся в узле; значения других рядов
// едут за своей подписью строки. Из spec в узел и обратно — chartSpec и
// chartFromSpec, они же в сборке (LancibleEditor.chartSpec / chartFromSpec).
// Узла с таким id нет (документ сменился, пока лист был открыт) — ответ
// { type: 'error', message } и ничего не меняется. На вебе и десктопе
// (без nativeToolbar) по-прежнему окно правки.
//
// PDF на телефоне (протокол 3, 17 октября 2026). Веб и десктоп выбирают и
// сохраняют PDF сами (окно выбора файла, downloadBlob). С нативной панелью
// файлы — у хозяина, а PDF-модуль (pdf.js, pdf-lib, шрифт — editor-pdf.js,
// 3 МБ) в строку редактора не входит: сборка кладёт его хозяину ассетом
// mobile/assets/editor-pdf.txt, и хозяин впрыскивает его по запросу.
//
//   editor → host: { type: 'pdf-pick' }
//     команда «PDF» (exec pdf, «/»): хозяин выбирает файл;
//   host → editor: ed.receive({ type: 'pdf-file', name, base64 })
//     байты PDF без префикса data:; { type: 'pdf-file', cancel: true } —
//     передумали. Дальше — окно способа (страницы или текст), как на вебе;
//   editor → host: { type: 'pdf-module' }
//     модуля в странице нет (импорт или выгрузка): хозяин впрыскивает текст
//     ассета (injectJavaScript) — он ставит window.LancibleEditorPdf;
//   host → editor: ed.receive({ type: 'pdf-module-ready' })
//     впрыснул; { type: 'pdf-module-ready', error } — не вышло. Не ответил
//     за 30 с — импорт или выгрузка сообщает об ошибке, следующая попытка
//     спросит снова;
//   editor → host: { type: 'export', kind: 'pdf', name, mime: 'application/pdf', base64 }
//     «Сохранить как PDF» (exec exportPdf): файл целиком, base64 без
//     префикса data: — хозяин сохраняет его или отдаёт «Поделиться».
//
// Перенос картинки за ручку при высоте по тексту (autoHeight): своей
// прокрутки у WebView нет, прокручивает хозяин —
//
//   editor → host: { type: 'autoscroll', dy }
//     на каждом кадре, пока палец у края видимой части; dy — CSS px, плюс —
//     вниз, минус — вверх; хозяин сдвигает внешний ScrollView на dy;
//   host → editor: ed.receive({ type: 'viewport', top, height })
//     необязательно: какая часть WebView сейчас видна (CSS px от его верха).
//     Без него край — край самого WebView.
//
// Перетаскивание пальцем (press.js: картинка за ручку, слои страницы PDF,
// их ручки и концы стрелок). На Android внешний ScrollView страницы задачи
// забирает движение после долгого нажатия, и в WebView приходит touchcancel.
// Поэтому —
//
//   editor → host: { type: 'gesture', on: true }
//     перетаскивание включилось: долгое нажатие (350 мс) прошло, а у ручек
//     рамки и концов стрелки — сразу на касании; хозяин выключает прокрутку
//     страницы (как на время пера);
//   editor → host: { type: 'gesture', on: false }
//     кончилось: отпустили, отмена (pointercancel), смена документа
//     (setContent), уход окна в фон или потеря фокуса, закрытие редактора
//     или вида. На каждое on — ровно одно off; повторного on без off нет.
//     Короткое касание и прокрутка пальцем не шлют ничего.
//
// Контекстная панель (протокол 4, 18 октября 2026). На телефоне плавающих
// островов нет: ни у картинки, ни у таблицы, графика, рисунка, страницы PDF
// и её слоя, ни панели над выделением — их действия хозяин показывает в
// панели над клавиатурой, а редактор рассказывает, что сейчас выделено:
//
//   editor → host: { type: 'context', kind, state }
//     при смене выделения — вместе с format и caret, с тем же прореживанием,
//     одинаковое не повторяется; getState присылает его заново. kind:
//     'image' | 'table' | 'chart' | 'drawing' | 'pdfpage' | 'pdflayer' | null
//     (null — контекст ушёл, state тогда null). state:
//       image    — { align, widthPct, hasCaption, caption, alt }: caption —
//                  текст подписи ('' — нет; лист подписи открывается с ним);
//                  align — attrs.align
//                  ('left' | 'center' | 'right' | 'full'; из десктопа бывает
//                  и 'wrap-left' | 'wrap-right'); widthPct — ширина в % полосы
//                  (в ряду — ряда): заданная, 100 у «во всю ширину», у «как
//                  есть» — измеренная (картинка ещё не загрузилась — null);
//       table    — { canMerge, canSplit, headerRow };
//       chart    — {};  drawing — {} (рисунок выделен или открыт в правке);
//       pdfpage  — { tool: null | 'replace', hasLines } (pdfgeom.js:
//                  pageContext; добавить слой — разовое действие, не режим);
//       pdflayer — { type, color, size, bold, sizes } (pdfgeom.js:
//                  layerContext; sizes — ступени для меню размера).
//
//   host → editor: { type: 'exec', name, arg } — имена ниже, в commands():
//     общее — deselect («назад»: снять выделение блока или слоя, курсор за
//     блок, фокус и клавиатуру не трогать; со слоя — на страницу), deleteBlock,
//     blockUp / blockDown (блок на место выше или ниже); картинка —
//     imageAlign (arg — выравнивание), imageWidth (arg — % полосы, 10–100,
//     можно шире исходного размера), imageCaption / imageAlt (arg — строка;
//     без arg — поле в самой странице), imageReplace (image-pick purpose
//     replace), imageDownload (export kind 'image', байты base64); таблица —
//     tableRowAdd, tableColAdd, tableRowDelete, tableColDelete, tableMerge,
//     tableSplit, tableHeaderRow, tableChart; график — chartEdit (сообщение
//     chart, лист хозяина); рисунок — drawingEdit; страница PDF — pdfTool
//     (arg: 'text' | 'image' | 'rect' | 'arrow' | 'highlight' | 'whiteout' —
//     добавить слой, 'replace' — режим «Заменить текст», null — выйти из
//     него); слой — pdfLayerColor (arg — имя цвета, null — по умолчанию),
//     pdfLayerSize (arg — pt), pdfLayerBold, pdfLayerFront, pdfLayerBack,
//     pdfLayerDelete.
//
//   editor → host: { type: 'export', kind: 'image', name, mime, base64 }
//     imageDownload: картинка из хранилища байтами (как export kind pdf);
//     картинка по адресу https — openUrl, в браузер системы.
//
// Масштаб картинки на телефоне — значок .led-img-resize в правом нижнем углу
// выделенной картинки (image.js): тянется пальцем сразу, без долгого
// нажатия, и шлёт gesture on/off, как перенос; ширина — в % полосы с
// пропорциями, в документ — одной правкой на жест.
//
// Картинки, вставленные без аккаунта (assets.js: owner null), сами в облако
// не уходят никому. Когда человек переносит данные «Без аккаунта» в
// аккаунт, хозяин отдаёт их этому аккаунту —
//
//   host → editor: ed.receive({ type: 'assets-adopt', userId })
//     гостевые записи хранилища картинок становятся записями userId и
//     выгружаются, если облако этого аккаунта открыто. Хранилище (IndexedDB
//     lancible-assets) общее у всех WebView приложения — хватает одного
//     вызова в любой открытой странице редактора.
//   host → editor: ed.receive({ type: 'assets-adopt', userId, referenced: true })
//     (19 октября 2026) только гостевые записи, на которые ссылается
//     открытый документ: документ — аккаунта userId, значит, и картинки в
//     нём его (вставлены, пока облако было закрыто: синхронизация выключена,
//     сеанс ещё не пришёл). Остальные гостевые не трогаются.
//   host → editor: ed.receive({ type: 'assets-adopt', userId, ids: ['…'] })
//     только эти записи (id после asset:, можно и с ним), если гостевые.
//
// Аккаунт удалён или убран с устройства (протокол 5, 19 октября 2026) —
//
//   host → editor: ed.receive({ type: 'assets-forget', userId })
//     с устройства стираются все записи хранилища с owner === userId
//     (гостевые и чужие остаются, облако не трогается), их адреса blob:
//     освобождаются;
//   editor → host: { type: 'assets-forgotten', userId, n } — сколько стёрто
//     (userId пустой — n 0, ничего не стёрто).
import { NodeSelection } from 'prosemirror-state';
import * as C from './commands.js';
import { pageContext, layerContext } from './pdfgeom.js';

/** Версия протокола: растёт, когда меняется форма сообщений. 2 — график
 *  правит хозяин (сообщение chart, 17 октября 2026); 3 — PDF на телефоне
 *  (pdf-pick, pdf-file, pdf-module, pdf-module-ready, export kind pdf),
 *  автопрокрутка (autoscroll, viewport), гостевые картинки (assets-adopt) и
 *  жест перетаскивания (gesture), тот же день; 4 — контекстная панель вместо
 *  островов (context, новые exec, export kind image; 18 октября 2026);
 *  5 — картинки аккаунта: assets-adopt с ids и referenced, assets-forget и
 *  ответ assets-forgotten (19 октября 2026). */
export const PROTOCOL = 5;

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

/** base64 (без префикса data:) → байты. Без fetch — по той же причине. */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
    // PDF: веб и десктоп — окно выбора файла; телефон — pdf-pick хозяину.
    pdf: () => ed.pickPdf(),
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
    // PDF целиком (pdf-lib, ленивый PDF-модуль): веб и десктоп скачивают файл,
    // хозяину уходит export kind 'pdf' (base64; модуль — по запросу pdf-module).
    exportPdf: () => ed.exportPdf(),
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
    // Контекстная панель телефона (протокол 4): выделенный блок. Островов
    // с nativeToolbar нет — их кнопки здесь. Веб и десктоп зовут те же имена
    // из тестов; острова у них остаются.
    deselect: () => ed.deselect(),
    deleteBlock: () => ed.deleteSelected(),
    blockUp: () => run((s, d) => C.moveBlockAt(s.selection.from, -1)(s, d)),
    blockDown: () => run((s, d) => C.moveBlockAt(s.selection.from, 1)(s, d)),
    // картинка (NodeSelection)
    imageAlign: (arg) => run(C.setImageAlign(arg)),
    imageWidth: (arg) => run(C.setImageWidth(arg)),
    imageCaption: (arg) => (typeof arg === 'string' ? run(C.setImageAttrs({ caption: arg })) : ed.imageAction('caption')),
    imageAlt: (arg) => (typeof arg === 'string' ? run(C.setImageAttrs({ alt: arg.trim() })) : ed.imageAction('alt')),
    imageReplace: () => ed.imageAction('replace'),
    imageDownload: () => ed.imageAction('download'),
    // таблица под курсором — короткие имена панели (те же команды, что выше)
    tableRowAdd: () => run(T.rowBelow),
    tableColAdd: () => run(T.colRight),
    tableRowDelete: () => run(T.rowDel),
    tableColDelete: () => run(T.colDel),
    tableMerge: () => run(T.merge),
    tableSplit: () => run(T.split),
    tableHeaderRow: () => run(T.headerRow),
    tableChart: () => ed.chartFromTable(),
    // график и рисунок
    chartEdit: () => ed.editSelectedChart(),
    drawingEdit: () => ed.editSelectedDrawing(),
    // страница PDF и её выделенный слой
    pdfTool: (arg) => ed.pdfCommand('tool', arg),
    pdfLayerColor: (arg) => ed.pdfCommand('color', arg),
    pdfLayerSize: (arg) => ed.pdfCommand('size', arg),
    pdfLayerBold: () => ed.pdfCommand('bold'),
    pdfLayerFront: () => ed.pdfCommand('front'),
    pdfLayerBack: () => ed.pdfCommand('back'),
    pdfLayerDelete: () => ed.pdfCommand('delete'),
  };
}

/** Что выделено — для контекстной панели телефона (сообщение context):
 *  { kind, state } или null. Без DOM, кроме того, что редактор отдаёт сам:
 *  измеренная ширина картинки (imageWidthPct) и вид страницы PDF с её
 *  выделенным слоем (pdfPageView). */
export function contextState(ed) {
  if (!ed || !ed.view) return null;
  if (ed.activeDrawing) return { kind: 'drawing', state: {} };
  const { state } = ed.view;
  const sel = state.selection;
  if (sel instanceof NodeSelection) {
    const { node } = sel;
    const name = node.type.name;
    if (name === 'image') {
      const a = node.attrs;
      let widthPct = a.align === 'full' ? 100 : (a.width != null ? a.width : null);
      if (widthPct == null && ed.imageWidthPct) widthPct = ed.imageWidthPct(sel.from);
      return { kind: 'image', state: { align: a.align || 'center', widthPct: widthPct == null ? null : widthPct, hasCaption: !!a.caption, caption: a.caption || '', alt: a.alt || '' } };
    }
    if (name === 'chart' || name === 'drawing') return { kind: name, state: {} };
    if (name === 'pdfpage') {
      const pv = ed.pdfPageView ? ed.pdfPageView(sel.from) : null;
      const layer = pv && pv.selectedLayer ? pv.selectedLayer() : null;
      if (layer) return { kind: 'pdflayer', state: layerContext(layer) };
      return { kind: 'pdfpage', state: pageContext(node.attrs, !!(pv && pv.replacing)) };
    }
  }
  const table = C.tableContext(state);
  return table ? { kind: 'table', state: table } : null;
}

/** Все имена exec — без редактора. */
export const EXEC_NAMES = Object.keys(commands(null));

/** После этих команд фокус в текст не возвращается: у них своё поле, своё
 *  меню или окно, или они вообще не про текст. Остальные — правка на месте,
 *  и курсор остаётся там, где писали. */
export const KEEP_FOCUS = new Set([
  'color', 'fontSize', 'fontFamily', 'link', 'block', 'align', 'image', 'imageUrl', 'pdf', 'chart', 'drawing', 'toChart',
  'annotate', 'comment', 'comments', 'outline', 'find', 'view', 'fullscreen', 'zoom',
  'exportMd', 'exportHtml', 'exportPdf', 'copyMd', 'print', 'shortcuts',
  'inkTool', 'inkShape', 'inkColor', 'inkSize', 'inkUndo', 'inkRedo', 'inkDuplicate', 'inkDelete', 'inkHide', 'inkClear', 'inkDone',
  // Контекстная панель: выделен блок, а не текст — клавиатуру не открывать.
  // Строки и столбцы таблицы (tableRowAdd…) — правка на месте, как rowBelow.
  'deselect', 'deleteBlock', 'blockUp', 'blockDown',
  'imageAlign', 'imageWidth', 'imageCaption', 'imageAlt', 'imageReplace', 'imageDownload',
  'tableChart', 'chartEdit', 'drawingEdit',
  'pdfTool', 'pdfLayerColor', 'pdfLayerSize', 'pdfLayerBold', 'pdfLayerFront', 'pdfLayerBack', 'pdfLayerDelete',
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
    // Контекст: «ничего не выделено» хозяин знает и так — первым не шлём.
    this.last = { format: '', caret: '', height: -1, context: 'null' };
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
    // Что выделено — для контекстной панели (протокол 4).
    const ctx = contextState(ed);
    const ctxKey = JSON.stringify(ctx);
    if (ctxKey !== this.last.context) { this.last.context = ctxKey; this.send({ type: 'context', kind: ctx ? ctx.kind : null, state: ctx ? ctx.state : null }); }
    // Курсор — только пока в тексте фокус: без клавиатуры держать его над
    // ней незачем. Ушёл фокус — забываем, чтобы при возврате прислать снова.
    const caret = state.focused ? caretRect(ed) : null;
    if (!caret) { this.last.caret = ''; return; }
    const ck = `${caret.top},${caret.bottom}`;
    if (ck !== this.last.caret) { this.last.caret = ck; this.send({ type: 'caret', top: caret.top, bottom: caret.bottom }); }
  }

  /** Высота содержимого (opts.autoHeight): WebView растёт по тексту.
   *
   *  Высота поменялась — курсор мог уехать, хотя выделение то же: картинка
   *  догрузилась, график или рисунок встал выше курсора, и он оказался ниже
   *  (или выше) прежнего. Хозяин держит прокрутку по последнему caret и сам
   *  не узнает — поэтому курсор шлём заново: тем же schedule, с тем же
   *  прореживанием, без фокуса в тексте и без повторов того же. Первая
   *  высота — не перемена: курсора ещё нет. */
  height(px) {
    if (px === this.last.height) return;
    const first = this.last.height < 0;
    this.last.height = px;
    // height — то же число под старым именем: так его читает DocEditor.
    this.send({ type: 'height', px, height: px });
    if (!first) this.schedule();
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
      case 'chart': ed.receiveChart(m); return true;
      case 'pdf-file': ed.receivePdfFile(m); return true;
      case 'pdf-module-ready': ed.pdfModuleReady(m); return true;
      case 'assets-adopt': ed.adoptGuestAssets(m.userId, { referenced: !!m.referenced, ids: Array.isArray(m.ids) ? m.ids : null }); return true;
      case 'assets-forget': ed.forgetAssets(m.userId); return true;
      case 'viewport': ed.hostViewport = m && Number.isFinite(+m.top) && Number.isFinite(+m.height) ? { top: +m.top, height: +m.height } : null; return true;
      case 'getState':
        this.last.format = '';
        this.last.caret = '';
        this.last.context = '';
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

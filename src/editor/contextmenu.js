// Меню по правой кнопке в тексте — десктоп и веб. На телефоне (и в вебе на
// телефоне) долгое касание остаётся системным: оно выделяет слово и ставит
// ручки выделения, своё меню их сломало бы.
//
// Вид — тот же, что у остальных меню редактора (ui.js: menu, .ctx-menu
// .led-pop): системного меню над текстом нет. Esc, щелчок мимо и Tab
// закрывают его, как любое меню редактора; в полном экране первый Esc
// закрывает меню, второй — полный экран (index.js: escapeFullscreen).
//
// Вырезать и копировать — событиями буфера (document.execCommand): их ловит
// ProseMirror и кладёт в буфер ровно то же, что по Ctrl+X и Ctrl+C. Вставить
// — чтением буфера (navigator.clipboard) и конвейером вставки ProseMirror
// (view.pasteHTML, view.pasteText) с событием, в котором лежит прочитанное:
// срабатывают те же правила, что по Ctrl+V (index.js: onPaste) — картинки,
// адрес на выделенный текст, Markdown. В Electron чтение буфера разрешено,
// браузер может спросить разрешение; отказал — подсказка «Нажмите Ctrl+V».
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { selectAll } from 'prosemirror-commands';
import { isInTable } from 'prosemirror-tables';
import * as C from './commands.js';
import { schema } from './schema.js';
import { menu } from './ui.js';
import { keyLabel } from './util.js';
import { imageViewOf } from './image.js';

const M = schema.marks;

/** Блоки, которые правая кнопка выделяет целиком. */
const WHOLE = new Set(['image', 'chart', 'drawing', 'horizontal_rule']);

/** Таблица — те же команды, что на её острове (имена exec, host.js). */
const TABLE_ITEMS = [
  ['rowAbove', 'table.row_above'], ['rowBelow', 'table.row_below'],
  ['colLeft', 'table.col_left'], ['colRight', 'table.col_right'],
  'sep',
  ['merge', 'table.merge'], ['split', 'table.split'], ['headerRow', 'table.header_row'],
  'sep',
  ['rowDel', 'table.row_delete', true], ['colDel', 'table.col_delete', true], ['tableDel', 'table.delete', true],
];

/** Что лежит в буфере: { text, html, files }. Сначала read() — с HTML и
 *  картинками; не вышло не из-за запрета — readText(). Запрет — исключение. */
export async function readClipboard() {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!cb) throw new Error('нет доступа к буферу');
  const out = { text: '', html: '', files: [] };
  if (cb.read) {
    let items = null;
    try {
      items = await cb.read();
    } catch (e) {
      if (!cb.readText || (e && e.name === 'NotAllowedError')) throw e;
    }
    if (items) {
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === 'text/plain' && !out.text) out.text = await blob.text();
          else if (type === 'text/html' && !out.html) out.html = await blob.text();
          else if (/^image\//.test(type)) out.files.push(new File([blob], `image.${type.slice(6).replace(/\W.*$/, '') || 'png'}`, { type }));
        }
      }
      return out;
    }
  }
  out.text = await cb.readText();
  return out;
}

/** Событие вставки с прочитанным из буфера — handlePaste видит его так же,
 *  как событие Ctrl+V. Собрать не вышло — undefined: вставит ProseMirror. */
function pasteEvent(data) {
  try {
    const dt = new DataTransfer();
    if (data.text) dt.setData('text/plain', data.text);
    if (data.html) dt.setData('text/html', data.html);
    for (const f of data.files) dt.items.add(f);
    return new ClipboardEvent('paste', { clipboardData: dt });
  } catch {
    return undefined;
  }
}

export class ContextMenu {
  constructor(ed) {
    this.ed = ed;
    this.onContext = (e) => this.open(e);
    // Куда нажали правой кнопкой. Меню приходит позже (на Windows — после
    // отпускания), а нажатие на картинку уже выделило её и показало над ней
    // кнопки: под указателем к этому времени может оказаться кнопка.
    this.down = null;
    this.onDown = (e) => { this.down = e.button === 2 ? e.target : null; };
    // На всей прокрутке, а не только на тексте: щелчок по полю под текстом —
    // то же меню, для нынешнего выделения.
    ed.scroller.addEventListener('pointerdown', this.onDown, true);
    ed.scroller.addEventListener('contextmenu', this.onContext);
  }

  destroy() {
    this.ed.scroller.removeEventListener('pointerdown', this.onDown, true);
    this.ed.scroller.removeEventListener('contextmenu', this.onContext);
  }

  /** Правая кнопка или клавиша меню в тексте. */
  open(e) {
    const { ed } = this;
    const down = this.down;
    this.down = null;
    if (ed.isMobile || ed.host || e.pointerType === 'touch' || e.defaultPrevented) return;
    const hit = down && down.isConnected && e.button === 2 ? down : e.target;
    const target = hit instanceof Element ? hit : null;
    // Поля (подпись картинки, язык кода) — со своим меню, кнопки — без него.
    // Страница PDF — со своими слоями и островом: вырезать и вставить там не про текст.
    if (!target || target.closest('input, textarea, select, button, .led-node-bar, .led-pdfpage')) return;
    e.preventDefault();
    // Рисунок в правке — правая кнопка там у пера.
    if (ed.activeDrawing || ed.annotating) return;
    // С клавиатуры (клавиша меню, Shift+F10) — у курсора, фокус в меню.
    const pointer = typeof e.pointerType === 'string' ? e.pointerType !== '' : e.button === 2;
    if (pointer && ed.view.dom.contains(target)) this.placeSelection(e, target);
    const at = pointer
      ? { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }
      : ed.caretAnchor();
    this.show(at, !pointer);
  }

  /** Щелчок мимо выделения — выделение туда, где щёлкнули: меню про то, что
   *  под указателем. Картинка, график, рисунок, линия — целиком, ссылка —
   *  вся, иначе — курсор. По выделению — оно остаётся. */
  placeSelection(e, target) {
    const { view } = this.ed;
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!hit) return;
    const { state } = view;
    const sel = state.selection;
    if (!sel.empty && sel.ranges.some((r) => r.$from.pos <= hit.pos && hit.pos <= r.$to.pos)) return;
    const block = this.blockAt(target, hit);
    if (block != null) {
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, block)));
      return;
    }
    const link = target.closest('a') ? C.markRange(state, M.link, hit.pos) : null;
    view.dispatch(state.tr.setSelection(link
      ? TextSelection.create(state.doc, link.from, link.to)
      : TextSelection.near(state.doc.resolve(hit.pos))));
  }

  /** Позиция блока «целиком» под щелчком или null. */
  blockAt(target, hit) {
    const { view } = this.ed;
    const el = target.closest('.led-figure, .led-chart, .led-drawing, hr');
    if (!el || !view.dom.contains(el)) return null;
    let byDom = null;
    try { byDom = view.posAtDOM(el, 0); } catch { byDom = null; }
    for (const p of [byDom, hit.inside]) {
      if (p == null || p < 0) continue;
      const node = view.state.doc.nodeAt(p);
      if (node && WHOLE.has(node.type.name)) return p;
    }
    return null;
  }

  show(at, keyboard) {
    const { ed } = this;
    const { view, t } = ed;
    const { state } = view;
    const sel = state.selection;
    const editable = view.editable;
    const items = [];
    if (editable) items.push({ label: t('ctx.cut'), kbd: 'Mod-x', cmd: 'cut', disabled: sel.empty, run: () => this.clip('cut') });
    items.push({ label: t('ctx.copy'), kbd: 'Mod-c', cmd: 'copy', disabled: sel.empty, run: () => this.clip('copy') });
    if (editable) {
      items.push({ label: t('ctx.paste'), kbd: 'Mod-v', cmd: 'paste', run: () => this.paste(false) });
      items.push({ label: t('ctx.paste_plain'), kbd: 'Mod-Shift-v', cmd: 'pastePlain', run: () => this.paste(true) });
    }
    items.push({ label: t('ctx.select_all'), kbd: 'Mod-a', cmd: 'selectAll', run: () => { selectAll(view.state, view.dispatch); view.focus(); } });
    const href = C.formatState(state).link;
    if (href) {
      items.push('sep');
      if (editable) items.push({ label: t('link.edit'), cmd: 'editLink', run: () => ed.editLink(at) });
      items.push({ label: t('link.open'), cmd: 'openLink', run: () => ed.openUrl(href) });
      if (editable) items.push({ label: t('link.remove'), cmd: 'unlink', run: () => { C.setLink(null)(view.state, view.dispatch); view.focus(); } });
    }
    if (editable && sel instanceof NodeSelection) items.push('sep', ...this.blockItems(sel.node, sel.from));
    if (editable && isInTable(state)) items.push('sep', { label: t('table.tools'), sub: true, cmd: 'table', run: () => this.tableMenu(at, keyboard) });
    this.menu(at, items, keyboard);
  }

  /** Меню у точки. Открыли с клавиатуры — фокус в меню, а закрыли — назад
   *  в текст: якорь здесь не кнопка, вернуть фокус ему нельзя. */
  menu(at, items, keyboard) {
    const { view } = this.ed;
    return menu(this.ed.root, at, items, {
      class: 'led-ctx',
      focus: keyboard,
      onClose: keyboard ? () => { if (!view.hasFocus()) view.focus(); } : null,
    });
  }

  /** Картинка — те же действия, что кнопками над ней; график, рисунок,
   *  линия — удалить. */
  blockItems(node, pos) {
    const { view, t } = this.ed;
    const del = {
      label: t('block.delete'), danger: true, cmd: 'deleteBlock',
      run: () => { view.dispatch(view.state.tr.deleteSelection().scrollIntoView()); view.focus(); },
    };
    const iv = node.type.name === 'image' ? imageViewOf(view.nodeDOM(pos)) : null;
    if (!iv) return [del];
    return [
      { label: t('image.replace'), cmd: 'imageReplace', run: () => iv.replace() },
      { label: t('image.alt'), cmd: 'imageAlt', run: () => iv.editAlt() },
      { label: t('image.download'), cmd: 'imageDownload', run: () => iv.download() },
      del,
    ];
  }

  /** Подменю таблицы: что сейчас неприменимо (объединить без выделенных
   *  ячеек), то погашено. */
  tableMenu(at, keyboard) {
    const { ed } = this;
    const items = TABLE_ITEMS.map((it) => (it === 'sep' ? 'sep' : {
      label: ed.t(it[1]), cmd: it[0], danger: !!it[2],
      disabled: !C.table[it[0]](ed.view.state),
      run: () => ed.exec(it[0]),
    }));
    this.menu(at, items, keyboard);
  }

  /** Вырезать, копировать — событием буфера, его обработает ProseMirror. */
  clip(kind) {
    const { ed } = this;
    ed.view.focus();
    let ok = false;
    try { ok = document.execCommand(kind); } catch { ok = false; }
    if (!ok) ed.toast(ed.t('ctx.key_hint', { key: keyLabel(kind === 'cut' ? 'Mod-x' : 'Mod-c') }));
  }

  /** Вставить из буфера. plain — без форматирования: текстом, мимо правил
   *  вставки (адрес не становится ссылкой, Markdown — разметкой). */
  async paste(plain) {
    const { ed } = this;
    const { view } = ed;
    view.focus();
    let data;
    try {
      data = await readClipboard();
    } catch {
      ed.toast(ed.t('ctx.paste_hint', { key: keyLabel(plain ? 'Mod-Shift-v' : 'Mod-v') }));
      return;
    }
    if (!view.editable || (!data.text && !data.html && !data.files.length)) return;
    view.focus();
    if (plain) {
      if (data.text) view.pasteText(data.text);
      return;
    }
    const ev = pasteEvent(data);
    if (data.html) view.pasteHTML(data.html, ev);
    else if (data.text) view.pasteText(data.text, ev);
    else ed.insertFiles(data.files);
  }
}

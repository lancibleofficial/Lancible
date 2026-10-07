// Ручки таблицы на разделителях — как в YouTrack.
//
// Навели на вертикальную линию между столбцами — она загорается акцентом, а
// рядом с указателем, чуть правее линии, появляется шестерёнка: вставить
// столбец на месте линии, удалить столбец слева или справа от неё. С
// горизонтальной линией то же для строк: шестерёнка чуть ниже линии.
//
// Шестерёнка стоит рядом с линией, а не на ней: на самой вертикальной линии
// живёт перетаскивание ширины столбца (prosemirror-tables), и щелчок по ней
// должен оставаться щелчком по ней.
import { TextSelection } from 'prosemirror-state';
import { TableMap, addColumnBefore, addColumnAfter, deleteColumn, addRowBefore, addRowAfter, deleteRow } from 'prosemirror-tables';
import { h, icon } from './util.js';
import { menu } from './ui.js';

const NEAR = 6; // насколько близко к линии, px
const GRACE = 350; // сколько ручка ждёт, пока до неё дотянутся, мс

export class TableHandles {
  constructor(ed) {
    this.ed = ed;
    this.target = null;
    this.line = h('div', { class: 'led-tline', hidden: true });
    this.gear = h('button', {
      type: 'button', class: 'led-tgear', hidden: true, title: ed.t('table.line_menu'), 'aria-label': ed.t('table.line_menu'),
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => this.openMenu(e.currentTarget),
      onmouseenter: () => clearTimeout(this.hideTimer),
      onmouseleave: () => this.scheduleHide(),
    }, icon('settings', 14));
  }

  mount(parent) { parent.append(this.line, this.gear); }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    if (this.menuOpen) return;
    this.hideTimer = setTimeout(() => this.hide(), GRACE);
  }

  hide() {
    this.line.hidden = true;
    this.gear.hidden = true;
    this.target = null;
  }

  /** Указатель над редактором: у какой линии таблицы он сейчас. */
  track(e) {
    const { view } = this.ed;
    if (!view.editable || this.ed.isMobile || this.menuOpen) return;
    const cell = e.target && e.target.closest ? e.target.closest('td, th') : null;
    if (!cell || !view.dom.contains(cell)) { if (!this.gear.hidden) this.scheduleHide(); return; }
    const r = cell.getBoundingClientRect();
    const dl = e.clientX - r.left;
    const dr = r.right - e.clientX;
    const dt = e.clientY - r.top;
    const db = r.bottom - e.clientY;
    const dx = Math.min(dl, dr);
    const dy = Math.min(dt, db);
    if (dx > NEAR && dy > NEAR) { if (!this.gear.hidden) this.scheduleHide(); return; }
    const info = this.cellInfo(cell);
    if (!info) return;
    clearTimeout(this.hideTimer);
    const kind = dx <= dy ? 'col' : 'row';
    const index = kind === 'col'
      ? (dl < dr ? info.rect.left : info.rect.right)
      : (dt < db ? info.rect.top : info.rect.bottom);
    this.target = { kind, index, tablePos: info.tablePos };
    this.place(cell, kind, kind === 'col' ? (dl < dr ? r.left : r.right) : (dt < db ? r.top : r.bottom), e);
  }

  /** Ячейка DOM → её прямоугольник в карте таблицы и позиция таблицы. */
  cellInfo(cell) {
    const { view } = this.ed;
    let pos;
    try { pos = view.posAtDOM(cell, 0); } catch { return null; }
    const $p = view.state.doc.resolve(pos);
    let cellDepth = -1;
    for (let d = $p.depth; d > 0; d--) {
      const role = $p.node(d).type.spec.tableRole;
      if (role === 'cell' || role === 'header_cell') { cellDepth = d; break; }
    }
    // Ячейка лежит в строке, строка — в таблице.
    if (cellDepth < 3) return null;
    const table = $p.node(cellDepth - 2);
    const tablePos = $p.before(cellDepth - 2);
    const map = TableMap.get(table);
    const rect = map.findCell($p.before(cellDepth) - tablePos - 1);
    return { rect, tablePos, map, table };
  }

  /** Линия — во всю длину таблицы, шестерёнка — рядом с указателем, сбоку
   *  от линии (круг 4: у конца линии до неё было далеко тянуться). На самой
   *  линии её не ставим: там перетаскивают ширину столбца. */
  place(cell, kind, at, e) {
    const wrap = this.line.parentElement;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const t = (cell.closest('.tableWrapper') || cell.closest('table')).getBoundingClientRect();
    const tbl = cell.closest('table').getBoundingClientRect();
    this.line.hidden = false;
    this.gear.hidden = false;
    this.line.dataset.kind = kind;
    this.gear.dataset.kind = kind;
    const GEAR = 22;
    const GAP = 7;
    if (kind === 'col') {
      Object.assign(this.line.style, { left: `${at - w.left - 1}px`, top: `${tbl.top - w.top}px`, width: '2px', height: `${tbl.height}px` });
      const y = Math.min(Math.max(e.clientY, tbl.top + GEAR / 2), tbl.bottom - GEAR / 2);
      Object.assign(this.gear.style, { left: `${at - w.left + GAP}px`, top: `${y - w.top - GEAR / 2}px` });
    } else {
      Object.assign(this.line.style, { left: `${Math.max(t.left, tbl.left) - w.left}px`, top: `${at - w.top - 1}px`, width: `${Math.min(t.width, tbl.width)}px`, height: '2px' });
      const x = Math.min(Math.max(e.clientX, Math.max(t.left, tbl.left) + GEAR / 2), Math.min(t.right, tbl.right) - GEAR / 2);
      Object.assign(this.gear.style, { left: `${x - w.left - GEAR / 2}px`, top: `${at - w.top + GAP}px` });
    }
  }

  /** Поставить курсор в ячейку (row, col) таблицы и выполнить команду. */
  runAt(target, row, col, cmd) {
    const { view } = this.ed;
    const table = view.state.doc.nodeAt(target.tablePos);
    if (!table) return;
    const map = TableMap.get(table);
    const r = Math.max(0, Math.min(map.height - 1, row));
    const c = Math.max(0, Math.min(map.width - 1, col));
    const cellPos = target.tablePos + 1 + map.map[r * map.width + c];
    const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cellPos + 1)));
    view.dispatch(tr);
    cmd(view.state, view.dispatch);
    view.focus();
  }

  openMenu(anchor) {
    const tg = this.target;
    if (!tg) return;
    const { t } = this.ed;
    const table = this.ed.view.state.doc.nodeAt(tg.tablePos);
    if (!table) return;
    const map = TableMap.get(table);
    const i = tg.index;
    const items = tg.kind === 'col' ? [
      { label: t('table.col_insert_here'), icon: 'colBefore', run: () => (i < map.width ? this.runAt(tg, 0, i, addColumnBefore) : this.runAt(tg, 0, i - 1, addColumnAfter)) },
      i > 0 ? { label: t('table.col_delete_left'), icon: 'trash', danger: true, run: () => this.runAt(tg, 0, i - 1, deleteColumn) } : null,
      i < map.width ? { label: t('table.col_delete_right'), icon: 'trash', danger: true, run: () => this.runAt(tg, 0, i, deleteColumn) } : null,
    ] : [
      { label: t('table.row_insert_here'), icon: 'rowBefore', run: () => (i < map.height ? this.runAt(tg, i, 0, addRowBefore) : this.runAt(tg, i - 1, 0, addRowAfter)) },
      i > 0 ? { label: t('table.row_delete_above'), icon: 'trash', danger: true, run: () => this.runAt(tg, i - 1, 0, deleteRow) } : null,
      i < map.height ? { label: t('table.row_delete_below'), icon: 'trash', danger: true, run: () => this.runAt(tg, i, 0, deleteRow) } : null,
    ];
    this.menuOpen = true;
    menu(this.ed.root, anchor, items.filter(Boolean), {
      onClose: () => { this.menuOpen = false; this.hide(); },
    });
  }
}

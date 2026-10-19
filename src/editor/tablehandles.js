// Ручки строки и столбца — как в Jira и YouTrack (волна 2, 17 октября 2026).
//
// Курсор встал в ячейку — слева снаружи таблицы, на высоте его строки,
// появляется ручка строки, а над таблицей, над его столбцом, — ручка
// столбца. Стоят, пока курсор не ушёл в другую строку или столбец (тогда
// переезжают к нему) или из таблицы (тогда прячутся). За мышью не ходят: на
// телефоне мыши нет, а на десктопе ручка, убегающая от указателя, — это то,
// от чего уходили. На телефоне то же, по касанию ячейки.
//
// Нажатие на ручку выделяет строку или столбец целиком (CellSelection) и
// открывает меню (.led-pop): вставить, дублировать, переместить, удалить;
// у столбца — ещё выравнивание и столбец заголовков. Команды — commands.js
// (table.*), те же, что у острова таблицы и подменю «Таблица ›» в меню по
// правой кнопке. Esc и щелчок мимо закрывают меню, курсор возвращается в
// ячейку, где стоял.
//
// До 17 октября здесь жила шестерёнка на разделителях: появлялась у линии
// под указателем, на телефоне её не было вовсе.
import { TextSelection } from 'prosemirror-state';
import { TableMap, CellSelection, isInTable, selectionCell } from 'prosemirror-tables';
import * as C from './commands.js';
import { h, icon } from './util.js';
import { menu, closePopup } from './ui.js';

/** От ручки до края таблицы, px. Ширина и высота ручки — из CSS (.led-thandle). */
const GAP = 3;

const px = (v) => `${Math.round(v)}px`;

export class TableHandles {
  constructor(ed) {
    this.ed = ed;
    /** Где курсор: { tablePos, row, col } — клетка карты таблицы. */
    this.at = null;
    this.menuKind = null;
    const make = (kind) => h('button', {
      type: 'button',
      class: `led-thandle led-thandle-${kind}`,
      hidden: true,
      'data-kind': kind,
      title: ed.t(kind === 'row' ? 'table.row_menu' : 'table.col_menu'),
      'aria-label': ed.t(kind === 'row' ? 'table.row_menu' : 'table.col_menu'),
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      // Фокус и курсор остаются в тексте: ручка — не место для курсора.
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => { e.preventDefault(); this.open(kind); },
    }, icon('grip', 12));
    this.row = make('row');
    this.col = make('col');
    // Широкая таблица прокручивается в своей обёртке — ручка столбца едет с ним.
    this.onScroll = (e) => { if (this.at && e.target && e.target.classList && e.target.classList.contains('tableWrapper')) this.place(); };
  }

  mount(parent) {
    parent.append(this.row, this.col);
    // scroll не всплывает — ловим на погружении.
    parent.addEventListener('scroll', this.onScroll, true);
    // Ширина окна, догрузившаяся картинка в ячейке, перенос строки — строка
    // и столбец сдвинулись без правки документа.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => { if (this.at) this.place(); });
      this.ro.observe(parent);
    }
  }

  hide() {
    this.row.hidden = true;
    this.col.hidden = true;
  }

  /** Клетка курсора. При выделении ячеек — прежняя клетка, пока она внутри
   *  выделения (ручка сама выделяет строку, и столбцу незачем от этого
   *  уезжать), иначе головная ячейка выделения. */
  cursorCell(state) {
    if (!isInTable(state)) return null;
    let $cell;
    try { $cell = selectionCell(state); } catch { return null; }
    const table = $cell.node(-1);
    const tableStart = $cell.start(-1);
    const map = TableMap.get(table);
    const tablePos = tableStart - 1;
    const sel = state.selection;
    const prev = this.at;
    if (sel instanceof CellSelection && prev && prev.tablePos === tablePos && prev.row < map.height && prev.col < map.width) {
      const r = map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart);
      if (prev.row >= r.top && prev.row < r.bottom && prev.col >= r.left && prev.col < r.right) return prev;
    }
    const r = map.findCell($cell.pos - tableStart);
    return { tablePos, row: r.top, col: r.left };
  }

  /** Состояние поменялось (правка, курсор) — ручки к курсору. Зовёт index.js: updateUi. */
  update() {
    const { view } = this.ed;
    this.at = view && view.editable ? this.cursorCell(view.state) : null;
    if (!this.at) { this.hide(); return; }
    this.place();
  }

  /** Ручка строки — слева от таблицы на высоте строки, ручка столбца — над
   *  таблицей над столбцом. Координаты — от полосы текста (.led-page-wrap). */
  place() {
    const { view } = this.ed;
    const host = this.row.parentElement;
    const { at } = this;
    const table = at && view.state.doc.nodeAt(at.tablePos);
    const wrapEl = table && view.nodeDOM(at.tablePos);
    const tableEl = wrapEl && wrapEl.nodeType === 1 ? (wrapEl.matches('table') ? wrapEl : wrapEl.querySelector('table')) : null;
    const rowEl = tableEl && tableEl.rows[at.row];
    if (!host || !rowEl) { this.hide(); return; }
    const hr = host.getBoundingClientRect();
    const tb = tableEl.getBoundingClientRect();
    const rr = rowEl.getBoundingClientRect();
    this.row.hidden = false;
    // Не левее края окна: на узком экране полю слева таблицы (стили) хватает
    // места, а это страховка на случай чужой вёрстки вокруг.
    const left = Math.max(tb.left - this.row.offsetWidth - GAP, 0) - hr.left;
    Object.assign(this.row.style, { left: px(left), top: px(rr.top - hr.top), height: px(rr.height) });

    const box = this.columnBox(table, tableEl, at);
    const vis = (wrapEl.classList && wrapEl.classList.contains('tableWrapper') ? wrapEl : tableEl).getBoundingClientRect();
    const l = Math.max(box.left, vis.left);
    const r = Math.min(box.right, vis.right);
    if (r - l < 8) { this.col.hidden = true; return; }
    this.col.hidden = false;
    Object.assign(this.col.style, { left: px(l - hr.left), width: px(r - l), top: px(tb.top - this.col.offsetHeight - GAP - hr.top) });
  }

  /** Края столбца на экране: по ячейке этого столбца без объединения, а если
   *  такой нет — по ячейке курсора. */
  columnBox(table, tableEl, at) {
    const { view } = this.ed;
    const map = TableMap.get(table);
    const start = at.tablePos + 1;
    let fallback = null;
    for (let r = 0; r < map.height; r++) {
      const cellAt = map.map[r * map.width + at.col];
      const dom = view.nodeDOM(start + cellAt);
      if (!dom || !dom.getBoundingClientRect) continue;
      if (r === at.row) fallback = dom;
      if (table.nodeAt(cellAt).attrs.colspan === 1) return dom.getBoundingClientRect();
    }
    return (fallback || tableEl).getBoundingClientRect();
  }

  /** Позиция ячейки (row, col) таблицы — или null, если её уже нет. */
  cellPos(tablePos, row, col) {
    const table = this.ed.view.state.doc.nodeAt(tablePos);
    if (!table || !table.type.spec.tableRole) return null;
    const map = TableMap.get(table);
    const r = Math.max(0, Math.min(map.height - 1, row));
    const c = Math.max(0, Math.min(map.width - 1, col));
    return tablePos + 1 + map.map[r * map.width + c];
  }

  /** Выделить строку или столбец клетки at целиком. */
  selectLine(kind, at) {
    const { view } = this.ed;
    const pos = this.cellPos(at.tablePos, at.row, at.col);
    if (pos == null) return false;
    const $cell = view.state.doc.resolve(pos);
    view.dispatch(view.state.tr.setSelection(kind === 'row' ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell)));
    return true;
  }

  /** Курсор в ячейку (row, col) — туда, где после команды оказалась строка
   *  или столбец, с которыми работали. */
  caretTo(tablePos, row, col) {
    const { view } = this.ed;
    const pos = this.cellPos(tablePos, row, col);
    if (pos == null) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))));
  }

  /** Нажали на ручку: строка или столбец выделены, меню открыто. */
  open(kind) {
    const { view } = this.ed;
    // Своё меню уже открыто — нажатие на ту же ручку его закрывает, на
    // другую — открывает её меню. Закрываем до того, как запомнить курсор:
    // закрытие возвращает его в ячейку.
    const again = this.menuKind === kind;
    if (this.menuKind) closePopup();
    if (again) return;
    const at = this.at;
    if (!at || !view.editable) return;
    const before = view.state.selection;
    const doc = view.state.doc;
    if (!this.selectLine(kind, at)) return;
    const anchor = kind === 'row' ? this.row : this.col;
    const items = kind === 'row' ? this.rowItems(at) : this.colItems(at);
    this.menuKind = kind;
    anchor.classList.add('on');
    anchor.setAttribute('aria-expanded', 'true');
    menu(this.ed.root, anchor, items, {
      class: 'led-tmenu',
      onClose: () => {
        this.menuKind = null;
        anchor.classList.remove('on');
        anchor.setAttribute('aria-expanded', 'false');
        // Строка выделялась только для меню. Закрыли — курсор туда, где
        // стоял; пункт меню, если его выбрали, поставит свой (run идёт после).
        if (view.state.doc === doc && view.state.selection instanceof CellSelection) view.dispatch(view.state.tr.setSelection(before));
      },
    });
  }

  /** Пункт меню: выделить строку или столбец, выполнить команду, курсор —
   *  в клетку next(at) (куда уехала строка, где встала новая). */
  item(kind, at, label, iconName, cmdName, next, extra) {
    const { view } = this.ed;
    const cmd = C.table[cmdName];
    return Object.assign({
      label, icon: iconName, cmd: cmdName,
      disabled: !cmd(view.state),
      run: () => {
        if (!this.selectLine(kind, at)) return;
        if (!cmd(view.state, view.dispatch)) return;
        const n = next(at);
        this.caretTo(at.tablePos, n.row, n.col);
        view.focus();
      },
    }, extra || {});
  }

  rowItems(at) {
    const { t } = this.ed;
    const same = (a) => a;
    const down = (a) => ({ row: a.row + 1, col: a.col });
    const up = (a) => ({ row: a.row - 1, col: a.col });
    return [
      this.item('row', at, t('table.row_insert_above'), 'rowAbove', 'rowAbove', same),
      this.item('row', at, t('table.row_insert_below'), 'rowBelow', 'rowBelow', down),
      this.item('row', at, t('table.row_duplicate'), 'copy', 'rowDup', down),
      this.item('row', at, t('table.row_move_up'), 'up', 'rowUp', up),
      this.item('row', at, t('table.row_move_down'), 'down', 'rowDown', down),
      'sep',
      this.item('row', at, t('table.row_delete'), 'trash', 'rowDel', same, { danger: true }),
    ];
  }

  colItems(at) {
    const { view, t } = this.ed;
    const same = (a) => a;
    const right = (a) => ({ row: a.row, col: a.col + 1 });
    const left = (a) => ({ row: a.row, col: a.col - 1 });
    const align = C.columnAlign(view.state);
    const alignItem = (v) => ({
      label: t(`fmt.align_${v}`), icon: `align${v[0].toUpperCase()}${v.slice(1)}`, cmd: `align-${v}`, active: align === v,
      run: () => {
        if (!this.selectLine('col', at)) return;
        C.setAlign(v)(view.state, view.dispatch);
        this.caretTo(at.tablePos, at.row, at.col);
        view.focus();
      },
    });
    return [
      this.item('col', at, t('table.col_insert_left'), 'colLeft', 'colLeft', same),
      this.item('col', at, t('table.col_insert_right'), 'colRight', 'colRight', right),
      this.item('col', at, t('table.col_duplicate'), 'copy', 'colDup', right),
      this.item('col', at, t('table.col_move_left'), 'arrowLeft', 'colMoveLeft', left),
      this.item('col', at, t('table.col_move_right'), 'arrowRight', 'colMoveRight', right),
      'sep',
      { heading: t('fmt.align') },
      alignItem('left'), alignItem('center'), alignItem('right'),
      'sep',
      this.item('col', at, t('table.col_header'), 'header', 'colHeader', same, { active: C.isHeaderColumn(view.state) }),
      'sep',
      this.item('col', at, t('table.col_delete'), 'trash', 'colDel', same, { danger: true }),
    ];
  }

  destroy() {
    if (this.ro) this.ro.disconnect();
    const host = this.row.parentElement;
    if (host) host.removeEventListener('scroll', this.onScroll, true);
  }
}

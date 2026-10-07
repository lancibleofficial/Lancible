// Панель инструментов сверху и панель таблицы под ней (видна, пока курсор
// в таблице). На узком экране панель прокручивается вбок, а не переносится:
// так кнопки не прыгают с места на место при наборе.
import { h, icon, btn, keyLabel } from './util.js';
import { menu, popup, colorGrid, tableSizeGrid } from './ui.js';
import * as C from './commands.js';

const BLOCK_LABEL = { paragraph: 'turn.paragraph', h1: 'turn.h1', h2: 'turn.h2', h3: 'turn.h3', h4: 'turn.h4', code_block: 'turn.code_block' };
const ALIGN_ICON = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' };

export class Toolbar {
  constructor(ed) {
    this.ed = ed;
    const t = ed.t;
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch, ed.view); ed.view.focus(); };
    const tip = (label, kbd) => (kbd ? `${label} (${keyLabel(kbd)})` : label);
    const b = this.b = {};

    b.undo = btn('undo', tip(t('undo'), 'Mod-z'), run(C.undo));
    b.redo = btn('redo', tip(t('redo'), 'Mod-Shift-z'), run(C.redo));
    b.block = h('button', {
      type: 'button', class: 'led-btn led-block-btn', title: t('block.style'),
      onmousedown: (e) => e.preventDefault(), onclick: (e) => this.blockMenu(e.currentTarget),
    }, h('span', { class: 'led-block-label' }), icon('chevronDown', 14));
    b.strong = btn('bold', tip(t('fmt.bold'), 'Mod-b'), run(C.toggle('strong')));
    b.em = btn('italic', tip(t('fmt.italic'), 'Mod-i'), run(C.toggle('em')));
    b.underline = btn('underline', tip(t('fmt.underline'), 'Mod-u'), run(C.toggle('underline')));
    b.strike = btn('strike', tip(t('fmt.strike'), 'Mod-Shift-x'), run(C.toggle('strike')));
    b.inline = btn('more', t('fmt.more'), () => this.inlineMenu(b.inline));
    b.color = btn('color', t('fmt.text_color'), () => this.colorMenu('tc', b.color));
    b.highlight = btn('highlight', tip(t('fmt.highlight'), 'Mod-Shift-h'), () => this.colorMenu('hl', b.highlight));
    b.link = btn('link', tip(t('fmt.link'), 'Mod-k'), () => ed.editLink(b.link));
    b.bullet = btn('bullet', tip(t('block.bullet'), 'Mod-Shift-8'), run(C.toggleList('bullet_list')));
    b.ordered = btn('ordered', tip(t('block.ordered'), 'Mod-Shift-7'), run(C.toggleList('ordered_list')));
    b.tasks = btn('tasks', tip(t('block.tasks'), 'Mod-Shift-9'), run(C.toggleList('task_list')));
    b.outdent = btn('outdent', tip(t('fmt.outdent'), 'Shift-Tab'), run(C.outdent));
    b.indent = btn('indent', tip(t('fmt.indent'), 'Tab'), run(C.indent));
    b.align = btn('alignLeft', t('fmt.align'), () => this.alignMenu(b.align));
    b.quote = btn('quote', tip(t('block.quote'), 'Mod-Shift-b'), run(C.toggleQuote));
    b.callout = btn('callout', t('block.callout'), () => this.calloutMenu(b.callout));
    b.table = btn('table', t('block.table'), () => this.tableMenu(b.table));
    b.image = btn('image', t('block.image'), () => ed.pickImage());
    b.chart = btn('chart', t('block.chart'), () => ed.insertChart());
    b.drawing = btn('draw', t('block.drawing'), () => ed.insertDrawing());
    b.insert = btn('plus', t('block.insert'), () => this.insertMenu(b.insert));
    b.comment = btn('comment', tip(t('comments.add'), 'Mod-Alt-m'), () => ed.addComment());
    b.annotate = btn('annotate', tip(t('ink.annotate'), 'Mod-Shift-d'), () => ed.setAnnotate(!ed.annotating));
    b.find = btn('search', tip(t('find.title'), 'Mod-f'), () => ed.find.open(false));
    b.comments = btn('comments', t('comments.title'), () => ed.togglePanel('comments'));
    b.outline = btn('outline', t('outline.title'), () => ed.togglePanel('outline'));
    b.view = btn('settings', t('view.title'), () => this.viewMenu(b.view));
    b.more = btn('more', t('more'), () => this.moreMenu(b.more));
    b.fontSize = btn('fontSize', t('fmt.font_size'), () => ed.fontSizeMenu(b.fontSize));
    b.fontFamily = btn('fontFamily', t('fmt.font_family'), () => ed.fontFamilyMenu(b.fontFamily));
    // «Во весь экран» — всегда у правого края, вне прокрутки и переносов.
    b.fullscreen = btn('fullscreen', tip(t('view.fullscreen'), 'Mod-Shift-Enter'), () => ed.toggleFullscreen());

    const g = (...xs) => h('div', { class: 'led-group' }, ...xs);
    // На телефоне панель — одна строка с прокруткой, и до конца её
    // долистывают редко. Поэтому там вперёд то, ради чего телефон берут в
    // руки: картинка с камеры, рисунок пальцем или пером, пометки поверх.
    const groups = ed.isMobile ? [
      g(b.undo, b.redo),
      g(b.image, b.drawing, b.annotate, b.table, b.chart, b.insert),
      g(b.block),
      g(b.strong, b.em, b.underline, b.strike, b.inline),
      g(b.fontSize, b.fontFamily),
      g(b.bullet, b.ordered, b.tasks, b.outdent, b.indent),
      g(b.color, b.highlight, b.link),
      g(b.quote, b.callout, b.align),
      g(b.comment, b.comments, b.find, b.outline, b.view, b.more),
    ] : [
      g(b.undo, b.redo),
      g(b.block),
      g(b.strong, b.em, b.underline, b.strike, b.inline),
      g(b.fontSize, b.fontFamily, b.color, b.highlight, b.link),
      g(b.bullet, b.ordered, b.tasks, b.outdent, b.indent, b.align),
      g(b.quote, b.callout),
      g(b.table, b.image, b.chart, b.drawing, b.insert),
      g(b.comment),
      h('div', { class: 'led-spacer' }),
      g(b.annotate, b.find, b.outline, b.comments, b.view, b.more),
    ];
    this.dom = h('div', { class: 'led-toolbar', role: 'toolbar', 'aria-label': t('toolbar') },
      h('div', { class: 'led-toolbar-main' }, ...groups),
      h('div', { class: 'led-toolbar-end' }, b.fullscreen));

    this.tableBar = this.buildTableBar();
  }

  /** Остров таблицы: плавает под таблицей, пока курсор в ней, — тем же
   *  видом, что панель над выделением. Строки и столбцы вставляются и
   *  удаляются шестерёнкой на разделителях (tablehandles.js); на телефоне
   *  наводить нечем, и там эти кнопки остаются здесь. */
  buildTableBar() {
    const { ed } = this;
    const t = ed.t;
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch); ed.view.focus(); };
    const T = C.table;
    const fill = btn('fill', t('table.fill'), () => {
      const p = popup(ed.root, fill, colorGrid('hl', null, (c) => { T.fill(c)(ed.view.state, ed.view.dispatch); p.close(); ed.view.focus(); }, t));
    });
    this.tb = {
      merge: btn('merge', t('table.merge'), run(T.merge), { 'data-tt': 'merge' }),
      split: btn('split', t('table.split'), run(T.split), { 'data-tt': 'split' }),
    };
    const sep = () => h('span', { class: 'led-bar-sep' });
    const rowsCols = ed.isMobile ? [
      btn('rowBefore', t('table.row_above'), run(T.rowAbove), { 'data-tt': 'rowAbove' }),
      btn('rowAfter', t('table.row_below'), run(T.rowBelow), { 'data-tt': 'rowBelow' }),
      btn('colBefore', t('table.col_left'), run(T.colLeft), { 'data-tt': 'colLeft' }),
      btn('colAfter', t('table.col_right'), run(T.colRight), { 'data-tt': 'colRight' }),
      btn('rows', t('table.row_delete'), run(T.rowDel), { 'data-tt': 'rowDel' }),
      btn('columns', t('table.col_delete'), run(T.colDel), { 'data-tt': 'colDel' }),
      sep(),
    ] : [];
    return h('div', { class: 'led-tablebar', hidden: true, role: 'toolbar', 'aria-label': t('table.tools') },
      ...rowsCols,
      this.tb.merge, this.tb.split,
      btn('header', t('table.header_row'), run(T.headerRow), { 'data-tt': 'headerRow' }),
      fill,
      sep(),
      btn('chart', t('table.to_chart'), () => ed.chartFromTable(), { 'data-tt': 'toChart' }),
      btn('trash', t('table.delete'), run(T.tableDel), { 'data-tt': 'tableDel', class: 'led-btn danger' }));
  }

  blockMenu(anchor) {
    const { ed } = this;
    const fs = C.formatState(ed.view.state);
    const items = [['paragraph', 'text', C.setParagraph, 'Mod-Alt-0'], ['h1', 'h1', C.setHeading(1), 'Mod-Alt-1'], ['h2', 'h2', C.setHeading(2), 'Mod-Alt-2'],
      ['h3', 'h3', C.setHeading(3), 'Mod-Alt-3'], ['h4', 'h4', C.setHeading(4), 'Mod-Alt-4'], ['code_block', 'codeblock', C.toggleCodeBlock, 'Mod-Alt-c']];
    menu(ed.root, anchor, items.map(([k, ic, cmd, kbd]) => ({
      label: ed.t(BLOCK_LABEL[k]), icon: ic, kbd, active: fs.block === k,
      run: () => { cmd(ed.view.state, ed.view.dispatch); ed.view.focus(); },
    })), { class: 'led-block-menu' });
  }

  inlineMenu(anchor) {
    const { ed } = this;
    const fs = C.formatState(ed.view.state);
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch); ed.view.focus(); };
    menu(ed.root, anchor, [
      { label: ed.t('fmt.code'), icon: 'code', kbd: 'Mod-e', active: fs.code, run: run(C.toggle('code')) },
      { label: ed.t('fmt.sup'), icon: 'sup', kbd: 'Mod-.', active: fs.sup, run: run(C.toggle('sup')) },
      { label: ed.t('fmt.sub'), icon: 'sub', kbd: 'Mod-,', active: fs.sub, run: run(C.toggle('sub')) },
      'sep',
      { label: ed.t('fmt.clear'), icon: 'clear', kbd: 'Mod-\\', run: run(C.clearFormatting) },
    ]);
  }

  colorMenu(kind, anchor) {
    const { ed } = this;
    const fs = C.formatState(ed.view.state);
    const p = popup(ed.root, anchor, colorGrid(kind, kind === 'tc' ? fs.textColor : fs.highlight, (c) => {
      C.setColorMark(kind === 'tc' ? 'textColor' : 'highlight', c)(ed.view.state, ed.view.dispatch);
      p.close();
      ed.view.focus();
    }, ed.t));
  }

  alignMenu(anchor) {
    const { ed } = this;
    const fs = C.formatState(ed.view.state);
    const keys = { left: 'Mod-Shift-l', center: 'Mod-Shift-e', right: 'Mod-Shift-r', justify: 'Mod-Shift-j' };
    menu(ed.root, anchor, Object.keys(ALIGN_ICON).map((a) => ({
      label: ed.t(`fmt.align_${a}`), icon: ALIGN_ICON[a], kbd: keys[a], active: fs.align === a,
      run: () => { C.setAlign(a)(ed.view.state, ed.view.dispatch); ed.view.focus(); },
    })));
  }

  calloutMenu(anchor) {
    const { ed } = this;
    const fs = C.formatState(ed.view.state);
    menu(ed.root, anchor, ['info', 'warn', 'ok', 'idea'].map((tone) => ({
      label: ed.t(`callout.${tone}`), icon: tone, active: fs.callout === tone,
      run: () => { C.toggleCallout(tone)(ed.view.state, ed.view.dispatch); ed.view.focus(); },
    })));
  }

  tableMenu(anchor) {
    const { ed } = this;
    const p = popup(ed.root, anchor, tableSizeGrid((r, c, header) => {
      p.close();
      C.insertTable(r, c, header)(ed.view.state, ed.view.dispatch);
      ed.view.focus();
    }, ed.t));
  }

  insertMenu(anchor) {
    const { ed } = this;
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch); ed.view.focus(); };
    menu(ed.root, anchor, [
      { label: ed.t('block.table'), icon: 'table', run: () => this.tableMenu(anchor) },
      { label: ed.t('block.image'), icon: 'image', run: () => ed.pickImage() },
      { label: ed.t('block.image_url'), icon: 'link', run: () => ed.imageFromUrl(anchor) },
      { label: ed.t('block.chart'), icon: 'chart', run: () => ed.insertChart() },
      { label: ed.t('block.drawing'), icon: 'draw', run: () => ed.insertDrawing() },
      'sep',
      { label: ed.t('block.code'), icon: 'codeblock', kbd: 'Mod-Alt-c', run: run(C.toggleCodeBlock) },
      { label: ed.t('block.hr'), icon: 'hr', run: run(C.insertRule) },
      { label: ed.t('block.callout'), icon: 'info', run: run(C.toggleCallout('info')) },
    ]);
  }

  viewMenu(anchor) {
    const { ed } = this;
    const s = ed.settings();
    const set = (patch) => () => ed.setSettings(patch);
    menu(ed.root, anchor, [
      { heading: ed.t('view.page_width') },
      ...['narrow', 'normal', 'wide', 'full'].map((w) => ({ label: ed.t(`view.width_${w}`), active: s.width === w, run: set({ width: w }) })),
      { heading: ed.t('view.font') },
      ...['sans', 'serif', 'mono'].map((f) => ({ label: ed.t(`view.font_${f}`), active: s.font === f, run: set({ font: f }) })),
      { heading: ed.t('view.size') },
      ...[14, 16, 18, 20].map((z) => ({ label: `${z} px`, active: s.size === z, run: set({ size: z }) })),
      'sep',
      { label: ed.t('view.focus'), icon: 'focus', active: s.focus, run: set({ focus: !s.focus }) },
      { label: ed.t('view.typewriter'), icon: 'type', active: s.typewriter, run: set({ typewriter: !s.typewriter }) },
      { label: ed.t('view.smart'), icon: 'quote', active: s.smart, run: set({ smart: !s.smart }) },
      { label: ed.t('view.spellcheck'), icon: 'check', active: s.spellcheck, run: set({ spellcheck: !s.spellcheck }) },
      { label: ed.t('view.stats'), icon: 'text', active: s.stats, run: set({ stats: !s.stats }) },
      { label: ed.t('view.show_ink'), icon: s.inkHidden ? 'eyeOff' : 'eye', active: !s.inkHidden, run: set({ inkHidden: !s.inkHidden }) },
      'sep',
      { label: ed.t(ed.fullscreen ? 'view.exit_fullscreen' : 'view.fullscreen'), icon: ed.fullscreen ? 'minimize' : 'fullscreen', kbd: 'Mod-Shift-Enter', run: () => ed.toggleFullscreen() },
    ], { class: 'led-view-menu' });
  }

  moreMenu(anchor) {
    const { ed } = this;
    menu(ed.root, anchor, [
      { label: ed.t('export.markdown'), icon: 'download', run: () => ed.exportAs('md') },
      { label: ed.t('export.html'), icon: 'download', run: () => ed.exportAs('html') },
      { label: ed.t('export.copy_md'), icon: 'copy', run: () => ed.copyMarkdown() },
      { label: ed.t('export.print'), icon: 'printer', kbd: 'Mod-p', run: () => ed.print() },
      'sep',
      { label: ed.t('help.shortcuts'), icon: 'info', kbd: 'Mod-/', run: () => ed.showShortcuts() },
    ]);
  }

  /** Кнопка «во весь экран» показывает, куда ведёт: развернуть или свернуть. */
  syncFullscreen() {
    const { ed } = this;
    const on = !!ed.fullscreen;
    const label = `${ed.t(on ? 'view.exit_fullscreen' : 'view.fullscreen')} (${keyLabel('Mod-Shift-Enter')})`;
    this.b.fullscreen.title = label;
    this.b.fullscreen.setAttribute('aria-label', label);
    this.b.fullscreen.classList.toggle('on', on);
    this.b.fullscreen.replaceChildren(icon(on ? 'minimize' : 'fullscreen'));
  }

  update(fs) {
    const b = this.b;
    b.fontSize.classList.toggle('on', !!fs.fontSize);
    b.fontFamily.classList.toggle('on', !!fs.fontFamily);
    b.undo.disabled = !fs.canUndo;
    b.redo.disabled = !fs.canRedo;
    for (const k of ['strong', 'em', 'underline', 'strike']) b[k].classList.toggle('on', !!fs[k]);
    b.inline.classList.toggle('on', fs.code || fs.sub || fs.sup);
    b.color.classList.toggle('on', !!fs.textColor);
    b.highlight.classList.toggle('on', !!fs.highlight);
    b.link.classList.toggle('on', !!fs.link);
    b.bullet.classList.toggle('on', fs.list === 'bullet_list');
    b.ordered.classList.toggle('on', fs.list === 'ordered_list');
    b.tasks.classList.toggle('on', fs.list === 'task_list');
    b.quote.classList.toggle('on', fs.quote);
    b.callout.classList.toggle('on', !!fs.callout);
    b.block.querySelector('.led-block-label').textContent = this.ed.t(BLOCK_LABEL[fs.block] || 'turn.paragraph');
    b.align.replaceChildren(icon(ALIGN_ICON[fs.align] || 'alignLeft'));
    b.annotate.classList.toggle('on', this.ed.annotating);
    b.comments.classList.toggle('on', this.ed.panel === 'comments');
    b.outline.classList.toggle('on', this.ed.panel === 'outline');
    const open = this.ed.threads().filter((th) => !th.resolved && !th.draft).length;
    b.comments.dataset.count = open ? String(open) : '';
    this.tableBar.hidden = !fs.inTable;
    if (fs.inTable) this.ed.placeTableBar();
    this.tb.merge.disabled = !fs.cellSelection;
  }
}

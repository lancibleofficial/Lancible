// Панель инструментов сверху и панель таблицы под ней (видна, пока курсор
// в таблице).
//
// Панель — всегда одна строка (11 октября 2026: в узком редакторе она
// разрасталась в два-три ряда и съедала поле текста, а на телефоне уезжала
// вбок прокруткой, до конца которой не долистывали). Раскладка приоритетная:
// в строке стоит столько кнопок, сколько влезает по ширине панели, — по
// очереди, кто нужнее. Что не влезло, уходит в меню своей группы: «Формат»
// (подчёркнутый, зачёркнутый, размер, шрифт, цвет, маркер, выравнивание,
// отступы), «Вставить» (таблица, картинка, график, рисунок, цитата, выноска,
// код, разделитель); инструменты документа (пометки, комментарии, поиск,
// оглавление, вид) — в «…» справа. Последний уровень — тоже «…»: туда
// свёрнутой группой уходит всё, чему не нашлось места. Всегда на виду, пока
// хватает места хотя бы им: отмена и повтор, стиль текста, полужирный и
// курсив, ссылка, списки (на узкой панели — одной кнопкой) и «Во весь экран»
// у правого края, вне строки.
//
// Без мерцания и без дёрганья раскладки: ширины кнопок меряются один раз —
// когда панель впервые видна, и ещё раз после загрузки шрифтов. На каждое
// изменение ширины (ResizeObserver: окно, колонка рядом, полный экран)
// раскладка считается арифметикой по этим числам и только записывается в
// DOM; чтений в цикле нет. Колбэк наблюдателя приходит до отрисовки кадра,
// так что промежуточного вида никто не видит.
import { h, icon, btn, keyLabel } from './util.js';
import { menu, popup, closePopup, colorGrid, tableSizeGrid } from './ui.js';
import * as C from './commands.js';

const BLOCK_LABEL = { paragraph: 'turn.paragraph', h1: 'turn.h1', h2: 'turn.h2', h3: 'turn.h3', h4: 'turn.h4', code_block: 'turn.code_block' };
const ALIGN_ICON = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' };
const LIST_ICON = { bullet_list: 'bullet', ordered_list: 'ordered', task_list: 'tasks' };

// Очередь сворачивания: шаг за шагом, пока строка не влезет. «hide» — кнопка
// уходит из строки в меню своей группы, «compact» — сжимается: подпись группы
// становится значком, «Текст ▾» — значком «T», три кнопки списков — одной;
// «dense» — черты между кучками кнопок уходят (на узкой панели каждый
// пиксель — кнопке). Сначала уходят инструменты документа, потом редкое
// оформление и вставки, под конец сжимается частое. Хвост очереди — крайний
// случай (очень узкая панель): в «…» уходят сами группы, а за ними и частое —
// строка остаётся одной при любой ширине, а каждая команда — в меню.
const STEPS = [
  ['hide', 'view'], ['hide', 'outline'], ['hide', 'comments'], ['hide', 'find'], ['hide', 'comment'], ['hide', 'annotate'],
  ['compact', 'insert'], ['compact', 'format'],
  ['hide', 'fontFamily'], ['hide', 'fontSize'], ['hide', 'indent'], ['hide', 'outdent'], ['hide', 'callout'], ['hide', 'quote'],
  ['hide', 'align'], ['hide', 'drawing'], ['hide', 'chart'], ['hide', 'highlight'], ['hide', 'color'], ['hide', 'strike'],
  ['hide', 'image'], ['hide', 'table'], ['hide', 'underline'],
  ['compact', 'block'], ['compact', 'lists'], ['dense'],
  ['hide', 'insert'], ['hide', 'format'],
  ['hide', 'redo'], ['hide', 'link'], ['hide', 'lists'], ['hide', 'undo'], ['hide', 'italic'], ['hide', 'bold'], ['hide', 'block'],
];
// Телефон: стиль текста и группы — значками и без черт с самого начала
// (кнопки там крупнее, и подпись в узкой строке обрезалась). Перо поверх
// текста и «Вставить» держатся дольше «Формата» — на телефоне ими пользуются
// чаще, а поиском и панелями — реже.
const STEPS_MOBILE = [
  ['hide', 'view'], ['hide', 'outline'], ['hide', 'comments'], ['hide', 'find'], ['hide', 'comment'],
  ['hide', 'fontFamily'], ['hide', 'fontSize'], ['hide', 'indent'], ['hide', 'outdent'], ['hide', 'callout'], ['hide', 'quote'],
  ['hide', 'align'], ['hide', 'drawing'], ['hide', 'chart'], ['hide', 'highlight'], ['hide', 'color'], ['hide', 'strike'],
  ['hide', 'image'], ['hide', 'table'], ['hide', 'underline'],
  ['compact', 'lists'], ['hide', 'format'], ['hide', 'annotate'], ['hide', 'insert'],
  ['hide', 'redo'], ['hide', 'link'], ['hide', 'lists'], ['hide', 'undo'], ['hide', 'italic'], ['hide', 'bold'], ['hide', 'block'],
];

// Меню групп: пункты по порядку, '|' — черта. Кнопка попадает в меню, когда
// её нет в строке; пункты без своей кнопки (код в строке, разделитель,
// экспорт…) стоят в меню всегда. В «…» свёрнутая группа — одним пунктом «›».
const MENUS = {
  format: ['underline', 'strike', '|', 'fontSize', 'fontFamily', 'color', 'highlight', '|', 'align', 'outdent', 'indent', '|', 'code', 'sup', 'sub', '|', 'clear'],
  insert: ['table', 'image', 'imageUrl', 'pdf', 'chart', 'drawing', '|', 'quote', 'callout', 'codeblock', 'hr'],
  lists: ['bullet', 'ordered', 'tasks'],
  more: ['undo', 'redo', 'block', 'bold', 'italic', 'link', 'lists', 'format', 'insert', '|',
    'annotate', 'comment', 'find', 'outline', 'comments', 'view', '|', 'exportMd', 'exportHtml', 'exportPdf', 'copyMd', 'print', '|', 'shortcuts'],
};

/** Черты меню: без двух подряд и без черты с краю. */
function tidy(ids) {
  const out = [];
  for (const id of ids) {
    if (id === '|' && (!out.length || out[out.length - 1] === '|')) continue;
    out.push(id);
  }
  while (out[out.length - 1] === '|') out.pop();
  return out;
}

export class Toolbar {
  constructor(ed) {
    this.ed = ed;
    const t = ed.t;
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch, ed.view); ed.view.focus(); };
    const tip = (label, kbd) => (kbd ? `${label} (${keyLabel(kbd)})` : label);
    const cmd = (id) => ({ 'data-cmd': id });
    const b = this.b = {};

    b.undo = btn('undo', tip(t('undo'), 'Mod-z'), run(C.undo), cmd('undo'));
    b.redo = btn('redo', tip(t('redo'), 'Mod-Shift-z'), run(C.redo), cmd('redo'));
    b.block = h('button', {
      type: 'button', class: 'led-btn led-block-btn', title: t('block.style'), 'aria-label': t('block.style'), 'data-cmd': 'block',
      'aria-haspopup': 'menu', onmousedown: (e) => e.preventDefault(), onclick: (e) => this.blockMenu(e.currentTarget),
    }, h('span', { class: 'led-block-label' }), icon('chevronDown', 14));
    // Сжатый вид стиля текста — значком: подпись («Заголовок 2») в узкой
    // строке обрезалась.
    b.blockIcon = btn('type', t('block.style'), () => this.blockMenu(b.blockIcon), Object.assign(cmd('block'), { 'aria-haspopup': 'menu' }));
    b.strong = btn('bold', tip(t('fmt.bold'), 'Mod-b'), run(C.toggle('strong')), cmd('bold'));
    b.em = btn('italic', tip(t('fmt.italic'), 'Mod-i'), run(C.toggle('em')), cmd('italic'));
    b.underline = btn('underline', tip(t('fmt.underline'), 'Mod-u'), run(C.toggle('underline')), cmd('underline'));
    b.strike = btn('strike', tip(t('fmt.strike'), 'Mod-Shift-x'), run(C.toggle('strike')), cmd('strike'));
    b.link = btn('link', tip(t('fmt.link'), 'Mod-k'), () => ed.editLink(b.link), cmd('link'));
    b.fontSize = btn('fontSize', t('fmt.font_size'), () => ed.fontSizeMenu(b.fontSize), cmd('fontSize'));
    b.fontFamily = btn('fontFamily', t('fmt.font_family'), () => ed.fontFamilyMenu(b.fontFamily), cmd('fontFamily'));
    b.color = btn('color', t('fmt.text_color'), () => this.colorMenu('tc', b.color), cmd('color'));
    b.highlight = btn('highlight', tip(t('fmt.highlight'), 'Mod-Shift-h'), () => this.colorMenu('hl', b.highlight), cmd('highlight'));
    b.align = btn('alignLeft', t('fmt.align'), () => this.alignMenu(b.align), cmd('align'));
    b.outdent = btn('outdent', tip(t('fmt.outdent'), 'Shift-Tab'), run(C.outdent), cmd('outdent'));
    b.indent = btn('indent', tip(t('fmt.indent'), 'Tab'), run(C.indent), cmd('indent'));
    b.bullet = btn('bullet', tip(t('block.bullet'), 'Mod-Shift-8'), run(C.toggleList('bullet_list')), cmd('bullet'));
    b.ordered = btn('ordered', tip(t('block.ordered'), 'Mod-Shift-7'), run(C.toggleList('ordered_list')), cmd('ordered'));
    b.tasks = btn('tasks', tip(t('block.tasks'), 'Mod-Shift-9'), run(C.toggleList('task_list')), cmd('tasks'));
    b.table = btn('table', t('block.table'), () => this.tableMenu(b.table), cmd('table'));
    b.image = btn('image', t('block.image'), () => ed.pickImage(), cmd('image'));
    b.chart = btn('chart', t('block.chart'), () => ed.insertChart(), cmd('chart'));
    b.drawing = btn('draw', t('block.drawing'), () => ed.insertDrawing(), cmd('drawing'));
    b.quote = btn('quote', tip(t('block.quote'), 'Mod-Shift-b'), run(C.toggleQuote), cmd('quote'));
    b.callout = btn('callout', t('block.callout'), () => this.calloutMenu(b.callout), cmd('callout'));
    b.annotate = btn('annotate', tip(t('ink.annotate'), 'Mod-Shift-d'), () => ed.setAnnotate(!ed.annotating), cmd('annotate'));
    b.comment = btn('comment', tip(t('comments.add'), 'Mod-Alt-m'), () => ed.addComment(), cmd('comment'));
    b.find = btn('search', tip(t('find.title'), 'Mod-f'), () => ed.find.open(false), cmd('find'));
    b.outline = btn('outline', t('outline.title'), () => ed.togglePanel('outline'), cmd('outline'));
    b.comments = btn('comments', t('comments.title'), () => ed.togglePanel('comments'), cmd('comments'));
    b.view = btn('settings', t('view.title'), () => this.viewMenu(b.view), cmd('view'));
    // Кнопки групп: подпись и галочка, в сжатом виде — значок и галочка.
    b.format = this.dropBtn('format', 'palette', t('toolbar.format'));
    b.insert = this.dropBtn('insert', 'plus', t('block.insert'));
    b.lists = this.dropBtn('lists', 'bullet', null, t('toolbar.lists'));
    b.more = btn('more', t('more'), () => this.toggleGroup('more'), { 'data-group': 'more', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    // «Во весь экран» — всегда у правого края, вне строки и её раскладки.
    b.fullscreen = btn('fullscreen', tip(t('view.fullscreen'), 'Mod-Shift-Enter'), () => ed.toggleFullscreen(), cmd('fullscreen'));

    // Слоты строки: что стоит в строке целиком, что — в сжатом виде. group —
    // в чьё меню уходит кнопка, когда её нет в строке.
    const S = this.slots = {};
    const slot = (id, group, full, compact) => { S[id] = { id, group, full, compact: compact || null }; };
    slot('undo', 'more', [b.undo]);
    slot('redo', 'more', [b.redo]);
    slot('block', 'more', [b.block], [b.blockIcon]);
    slot('bold', 'more', [b.strong]);
    slot('italic', 'more', [b.em]);
    slot('underline', 'format', [b.underline]);
    slot('strike', 'format', [b.strike]);
    slot('link', 'more', [b.link]);
    slot('fontSize', 'format', [b.fontSize]);
    slot('fontFamily', 'format', [b.fontFamily]);
    slot('color', 'format', [b.color]);
    slot('highlight', 'format', [b.highlight]);
    slot('align', 'format', [b.align]);
    slot('outdent', 'format', [b.outdent]);
    slot('indent', 'format', [b.indent]);
    slot('format', 'more', [b.format], 'label');
    slot('lists', 'more', [b.bullet, b.ordered, b.tasks], [b.lists]);
    slot('table', 'insert', [b.table]);
    slot('image', 'insert', [b.image]);
    slot('chart', 'insert', [b.chart]);
    slot('drawing', 'insert', [b.drawing]);
    slot('quote', 'insert', [b.quote]);
    slot('callout', 'insert', [b.callout]);
    slot('insert', 'more', [b.insert], 'label');
    for (const id of ['annotate', 'comment', 'find', 'outline', 'comments', 'view']) slot(id, 'more', [b[id]]);

    // Строка — кучки кнопок через черту; кнопка группы стоит в конце своих.
    const g = (...xs) => h('div', { class: 'led-group' }, ...xs);
    this.spacer = h('div', { class: 'led-spacer' });
    const groups = [
      g(b.undo, b.redo),
      g(b.block, b.blockIcon),
      g(b.strong, b.em, b.underline, b.strike, b.link),
      g(b.fontSize, b.fontFamily, b.color, b.highlight),
      g(b.align, b.outdent, b.indent, b.format),
      g(b.bullet, b.ordered, b.tasks, b.lists),
      g(b.table, b.image, b.chart, b.drawing),
      g(b.quote, b.callout, b.insert),
      this.spacer,
      g(b.annotate, b.comment, b.find, b.outline, b.comments, b.view),
      g(b.more),
    ];
    this.main = h('div', { class: 'led-toolbar-main' }, ...groups);
    this.clusters = groups.map((el) => (el === this.spacer ? { spacer: true } : { el, items: [...el.children] }));
    this.rowEls = [...new Set(Object.values(S).flatMap((s) => [...s.full, ...(s.compact && s.compact !== 'label' ? s.compact : [])]))];
    // Не слот — значит, в строке всегда: это «…».
    this.fixedEls = this.clusters.flatMap((c) => c.items || []).filter((el) => !this.rowEls.includes(el));
    // Кнопки групп сжимаются классом (подпись → значок), а не сменой кнопки.
    this.labelled = Object.values(S).filter((s) => s.compact === 'label').map((s) => ({ id: s.id, el: s.full[0] }));
    // В приложении на телефоне «Во весь экран» нет: редактор там и так на
    // весь экран. В вебе на телефоне она нужна — прячет оболочку сайта.
    this.dom = h('div', { class: 'led-toolbar', role: 'toolbar', 'aria-label': t('toolbar'), onkeydown: (e) => this.onKey(e) },
      this.main,
      ed.opts.inApp ? null : h('div', { class: 'led-toolbar-end' }, b.fullscreen));

    this.initial = {};
    for (const id of Object.keys(S)) this.initial[id] = 'full';
    this.initial.dense = false;
    if (ed.isMobile) Object.assign(this.initial, { block: 'compact', format: 'compact', insert: 'compact', dense: true });
    this.state = Object.assign({}, this.initial);
    this.metrics = null;
    this.fs = null;
    // Начальный вид — до первого замера: сжатые варианты спрятаны.
    this.apply(this.state);

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver((entries) => {
        const w = entries[entries.length - 1].contentRect.width;
        if (w > 0) this.layout(w);
      });
      this.ro.observe(this.main);
    }
    // Подписи («Текст», «Формат») меряются шрифтом интерфейса; пока он не
    // загружен, ширина другая — после загрузки меряем заново.
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { this.metrics = null; this.relayout(); }).catch(() => {});
    }

    this.tableBar = this.buildTableBar();
  }

  /** Кнопка группы: подпись (или значок) и галочка, меню — по щелчку. */
  dropBtn(group, ic, label, title) {
    const glyph = icon(ic);
    glyph.classList.add('led-drop-icon');
    const chev = icon('chevronDown', 12);
    chev.classList.add('led-drop-chev');
    return h('button', {
      type: 'button', class: `led-btn led-drop${label ? '' : ' led-compact'}`, title: label || title, 'aria-label': label || title,
      'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-group': group,
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => { e.preventDefault(); this.toggleGroup(group); },
    }, glyph, label ? h('span', { class: 'led-drop-label' }, label) : null, chev);
  }

  // --- раскладка в одну строку ------------------------------------------------

  /** Замер в три прохода, в каждом сначала запись, потом чтения: все кнопки
   *  строки показаны разом; черты между кучками убраны (.led-dense);
   *  подписи групп сжаты. Зовётся из колбэка наблюдателя, до отрисовки, и
   *  только когда ширин ещё нет. */
  measure() {
    this.dom.classList.remove('led-dense');
    for (const el of this.rowEls) el.hidden = false;
    for (const { el } of this.labelled) el.classList.remove('led-compact');
    for (const c of this.clusters) if (c.el) c.el.hidden = false;
    const width = (el) => el.getBoundingClientRect().width;
    const full = new Map([...this.rowEls, ...this.fixedEls].map((el) => [el, width(el)]));
    // Панель ещё не в документе или скрыта — замер пустой, повторим позже,
    // а строку возвращаем как была.
    if (![...full.values()].some((w) => w > 0)) {
      this.appliedKey = null;
      this.apply(this.state);
      return;
    }
    const gapIn = parseFloat(getComputedStyle(this.clusters.find((c) => c.el).el).columnGap) || 0;
    const gapOut = parseFloat(getComputedStyle(this.main).columnGap) || 0;
    // Обвязка кучки: отступ, черта и поля — всё, что сверх её кнопок.
    const chromeNow = () => {
      const out = new Map();
      for (const c of this.clusters) {
        if (!c.el) continue;
        const cs = getComputedStyle(c.el);
        const inner = c.items.reduce((a, el) => a + full.get(el), 0) + gapIn * (c.items.length - 1);
        out.set(c.el, width(c.el) - inner + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0));
      }
      return out;
    };
    const spacerNow = () => parseFloat(getComputedStyle(this.spacer).minWidth) || 0;
    const chrome = [chromeNow()];
    const spacer = [spacerNow()];
    this.dom.classList.add('led-dense');
    chrome.push(chromeNow());
    spacer.push(spacerNow());
    for (const { el } of this.labelled) el.classList.add('led-compact');
    const compact = new Map(this.labelled.map(({ el }) => [el, width(el)]));
    this.metrics = { full, compact, chrome, spacer, gapIn, gapOut };
    this.appliedKey = null;
  }

  /** Какие кнопки видны при раскладе и какой ширины. */
  shown(state) {
    const m = this.metrics;
    const out = new Map(this.fixedEls.map((el) => [el, m ? m.full.get(el) : 0]));
    for (const s of Object.values(this.slots)) {
      const st = state[s.id];
      if (st === 'hidden') continue;
      if (st === 'compact' && s.compact === 'label') out.set(s.full[0], m ? m.compact.get(s.full[0]) : 0);
      else for (const el of (st === 'compact' ? s.compact : s.full)) out.set(el, m ? m.full.get(el) : 0);
    }
    return out;
  }

  /** Ширина строки при раскладе — арифметикой по замеренным числам. */
  widthOf(state) {
    const m = this.metrics;
    const d = state.dense ? 1 : 0;
    const shown = this.shown(state);
    let total = 0;
    let parts = 0;
    for (const c of this.clusters) {
      if (c.spacer) { total += m.spacer[d]; parts++; continue; }
      const ws = c.items.filter((el) => shown.has(el)).map((el) => shown.get(el));
      if (!ws.length) continue;
      total += m.chrome[d].get(c.el) + ws.reduce((a, w) => a + w, 0) + m.gapIn * (ws.length - 1);
      parts++;
    }
    return total + m.gapOut * Math.max(0, parts - 1);
  }

  /** Расклад под ширину: идём по очереди сворачивания, пока не влезет. */
  layout(width) {
    if (!this.metrics) this.measure();
    if (!this.metrics) return;
    const state = Object.assign({}, this.initial);
    const steps = this.ed.isMobile ? STEPS_MOBILE : STEPS;
    // Полпикселя запаса: ширины дробные, а строка не должна прокручиваться.
    const fits = () => this.widthOf(state) <= width - 0.5;
    const done = [];
    for (let i = 0; i < steps.length && !fits(); i++) {
      const [op, id] = steps[i];
      const key = op === 'dense' ? 'dense' : id;
      if (op !== 'dense' && !this.slots[id]) continue;
      const was = state[key];
      if (op === 'dense') state.dense = true;
      else if (op === 'hide') state[id] = 'hidden';
      else if (state[id] === 'full' && this.slots[id].compact) state[id] = 'compact';
      if (state[key] !== was) done.push([key, was, state[key]]);
    }
    // Добор: очередь линейна, и широкая кнопка могла утянуть за собой узкую,
    // которая нужнее и влезла бы. Возвращаем ушедшее с конца очереди — самое
    // нужное первым, — если строка всё ещё влезает.
    for (let k = done.length - 1; k >= 0; k--) {
      const [key, was, now] = done[k];
      if (state[key] !== now) continue;
      state[key] = was;
      if (!fits()) state[key] = now;
    }
    this.apply(state);
  }

  /** Пересчитать по текущей ширине — вне наблюдателя: панель только что
   *  встала в документ, развернулась на весь экран, загрузились шрифты.
   *  Наблюдатель зовётся с кадром отрисовки, а в скрытом окне кадров нет —
   *  без этого вызова строка ждала бы первого кадра в виде до раскладки. */
  relayout() {
    if (!this.main.isConnected) return;
    const w = this.main.getBoundingClientRect().width;
    if (w > 0) this.layout(w);
  }

  /** Записать расклад в DOM: только запись, без чтений. */
  apply(state) {
    const key = Object.keys(this.slots).map((id) => state[id][0]).join('') + (state.dense ? '+' : '');
    if (key === this.appliedKey) return;
    const changed = this.appliedKey != null;
    this.appliedKey = key;
    this.state = state;
    this.dom.classList.toggle('led-dense', !!state.dense);
    const shown = this.shown(state);
    for (const el of this.rowEls) el.hidden = !shown.has(el);
    for (const { id, el } of this.labelled) el.classList.toggle('led-compact', state[id] === 'compact');
    for (const c of this.clusters) if (c.el) c.el.hidden = !c.items.some((el) => !el.hidden);
    // Открытое меню группы, чья кнопка ушла из строки, висело бы ни у чего —
    // закрываем. Кнопка осталась — меню остаётся: колонка рядом может
    // доезжать анимацией, и меню закрывалось бы у человека под рукой.
    const open = changed && this.dom.querySelector('[aria-expanded="true"]');
    if (open && (open.hidden || (open.parentElement && open.parentElement.hidden))) closePopup();
    this.paintGroups();
  }

  /** Кнопка в строке? Иначе команда — в меню группы. */
  inRow(id) {
    return !this.slots[id] || this.state[id] !== 'hidden';
  }

  // --- меню групп ---------------------------------------------------------------

  toggleGroup(name) {
    const at = this.b[name];
    if (at.getAttribute('aria-expanded') === 'true') { closePopup(); return; }
    this.openGroup(name, at);
  }

  openGroup(name, anchor) {
    const E = this.menuItems(anchor);
    const ids = tidy(MENUS[name].filter((id) => id === '|' || ((!this.slots[id] || !this.inRow(id)) && !(E[id] && E[id].hidden))));
    const items = ids.map((id) => {
      if (id === '|') return 'sep';
      const it = Object.assign({ cmd: id }, E[id]);
      // Свёрнутая в «…» группа — пункт «›»: её меню открывается на том же месте.
      if (it.group) it.run = () => this.openGroup(it.group, anchor);
      return it;
    });
    anchor.setAttribute('aria-expanded', 'true');
    menu(this.ed.root, anchor, items, { class: 'led-group-menu', onClose: () => anchor.setAttribute('aria-expanded', 'false') });
  }

  /** Пункты меню — так команда выглядит, когда её кнопки нет в строке.
   *  Подменю (цвет, таблица, выравнивание…) открываются у той же кнопки,
   *  что и меню группы. */
  menuItems(anchor) {
    const { ed } = this;
    const t = ed.t;
    const fs = C.formatState(ed.view.state);
    const run = (cmd) => () => { cmd(ed.view.state, ed.view.dispatch, ed.view); ed.view.focus(); };
    const open = (name) => ({ group: name, sub: true });
    const threads = ed.threads().filter((th) => !th.resolved && !th.draft).length;
    return {
      undo: { icon: 'undo', label: t('undo'), kbd: 'Mod-z', disabled: !fs.canUndo, run: run(C.undo) },
      redo: { icon: 'redo', label: t('redo'), kbd: 'Mod-Shift-z', disabled: !fs.canRedo, run: run(C.redo) },
      block: { icon: 'type', label: t('block.style'), sub: true, run: () => this.blockMenu(anchor) },
      bold: { icon: 'bold', label: t('fmt.bold'), kbd: 'Mod-b', active: !!fs.strong, run: run(C.toggle('strong')) },
      italic: { icon: 'italic', label: t('fmt.italic'), kbd: 'Mod-i', active: !!fs.em, run: run(C.toggle('em')) },
      underline: { icon: 'underline', label: t('fmt.underline'), kbd: 'Mod-u', active: !!fs.underline, run: run(C.toggle('underline')) },
      strike: { icon: 'strike', label: t('fmt.strike'), kbd: 'Mod-Shift-x', active: !!fs.strike, run: run(C.toggle('strike')) },
      link: { icon: 'link', label: t('fmt.link'), kbd: 'Mod-k', active: !!fs.link, run: () => ed.editLink(anchor) },
      fontSize: { icon: 'fontSize', label: t('fmt.font_size'), active: !!fs.fontSize, sub: true, run: () => ed.fontSizeMenu(anchor) },
      fontFamily: { icon: 'fontFamily', label: t('fmt.font_family'), active: !!fs.fontFamily, sub: true, run: () => ed.fontFamilyMenu(anchor) },
      color: { icon: 'color', label: t('fmt.text_color'), active: !!fs.textColor, sub: true, run: () => this.colorMenu('tc', anchor) },
      highlight: { icon: 'highlight', label: t('fmt.highlight'), active: !!fs.highlight, sub: true, run: () => this.colorMenu('hl', anchor) },
      align: { icon: ALIGN_ICON[fs.align] || 'alignLeft', label: t('fmt.align'), sub: true, run: () => this.alignMenu(anchor) },
      outdent: { icon: 'outdent', label: t('fmt.outdent'), kbd: 'Shift-Tab', run: run(C.outdent) },
      indent: { icon: 'indent', label: t('fmt.indent'), kbd: 'Tab', run: run(C.indent) },
      code: { icon: 'code', label: t('fmt.code'), kbd: 'Mod-e', active: !!fs.code, run: run(C.toggle('code')) },
      sup: { icon: 'sup', label: t('fmt.sup'), kbd: 'Mod-.', active: !!fs.sup, run: run(C.toggle('sup')) },
      sub: { icon: 'sub', label: t('fmt.sub'), kbd: 'Mod-,', active: !!fs.sub, run: run(C.toggle('sub')) },
      clear: { icon: 'clear', label: t('fmt.clear'), kbd: 'Mod-\\', run: run(C.clearFormatting) },
      bullet: { icon: 'bullet', label: t('block.bullet'), kbd: 'Mod-Shift-8', active: fs.list === 'bullet_list', run: run(C.toggleList('bullet_list')) },
      ordered: { icon: 'ordered', label: t('block.ordered'), kbd: 'Mod-Shift-7', active: fs.list === 'ordered_list', run: run(C.toggleList('ordered_list')) },
      tasks: { icon: 'tasks', label: t('block.tasks'), kbd: 'Mod-Shift-9', active: fs.list === 'task_list', run: run(C.toggleList('task_list')) },
      table: { icon: 'table', label: t('block.table'), sub: true, run: () => this.tableMenu(anchor) },
      image: { icon: 'image', label: t('block.image'), run: () => ed.pickImage() },
      imageUrl: { icon: 'link', label: t('block.image_url'), run: () => ed.imageFromUrl(anchor) },
      // PDF — веб и десктоп; с нативной панелью (телефон) пункта нет.
      pdf: { icon: 'pdf', label: t('block.pdf'), run: () => ed.pickPdf() },
      chart: { icon: 'chart', label: t('block.chart'), run: () => ed.insertChart() },
      drawing: { icon: 'draw', label: t('block.drawing'), run: () => ed.insertDrawing() },
      quote: { icon: 'quote', label: t('block.quote'), kbd: 'Mod-Shift-b', active: !!fs.quote, run: run(C.toggleQuote) },
      callout: { icon: 'callout', label: t('block.callout'), active: !!fs.callout, sub: true, run: () => this.calloutMenu(anchor) },
      codeblock: { icon: 'codeblock', label: t('block.code'), kbd: 'Mod-Alt-c', active: fs.block === 'code_block', run: run(C.toggleCodeBlock) },
      hr: { icon: 'hr', label: t('block.hr'), run: run(C.insertRule) },
      annotate: { icon: 'annotate', label: t('ink.annotate'), kbd: 'Mod-Shift-d', active: !!ed.annotating, run: () => ed.setAnnotate(!ed.annotating) },
      comment: { icon: 'comment', label: t('comments.add'), kbd: 'Mod-Alt-m', run: () => ed.addComment() },
      find: { icon: 'search', label: t('find.title'), kbd: 'Mod-f', run: () => ed.find.open(false) },
      outline: { icon: 'outline', label: t('outline.title'), active: ed.panel === 'outline', run: () => ed.togglePanel('outline') },
      comments: { icon: 'comments', label: threads ? `${t('comments.title')} · ${threads}` : t('comments.title'), active: ed.panel === 'comments', run: () => ed.togglePanel('comments') },
      view: { icon: 'settings', label: t('view.title'), sub: true, run: () => this.viewMenu(anchor) },
      lists: Object.assign({ icon: LIST_ICON[fs.list] || 'bullet', label: t('toolbar.lists'), active: !!fs.list }, open('lists')),
      format: Object.assign({ icon: 'palette', label: t('toolbar.format'), active: this.groupOn('format') }, open('format')),
      insert: Object.assign({ icon: 'plus', label: t('block.insert'), active: this.groupOn('insert') }, open('insert')),
      exportMd: { icon: 'download', label: t('export.markdown'), run: () => ed.exportAs('md') },
      exportHtml: { icon: 'download', label: t('export.html'), run: () => ed.exportAs('html') },
      exportPdf: { icon: 'pdf', label: t('export.pdf'), run: () => ed.exportPdf() },
      copyMd: { icon: 'copy', label: t('export.copy_md'), run: () => ed.copyMarkdown() },
      print: { icon: 'printer', label: t('export.print'), kbd: 'Mod-p', run: () => ed.print() },
      shortcuts: { icon: 'info', label: t('help.shortcuts'), kbd: 'Mod-/', run: () => ed.showShortcuts() },
    };
  }

  /** Включено ли то, за что отвечает кнопка, — чтобы подсветить группу,
   *  в чьём меню эта кнопка сейчас. */
  slotOn(id) {
    const fs = this.fs;
    if (!fs) return false;
    const { ed } = this;
    switch (id) {
      case 'bold': return !!fs.strong;
      case 'italic': return !!fs.em;
      case 'underline': case 'strike': case 'quote': case 'link': case 'fontSize': case 'fontFamily': case 'highlight': case 'callout':
        return !!fs[id];
      case 'color': return !!fs.textColor;
      case 'align': return !!fs.align && fs.align !== 'left';
      case 'lists': return !!fs.list;
      case 'annotate': return !!ed.annotating;
      case 'outline': case 'comments': return ed.panel === id;
      case 'format': case 'insert': return this.groupOn(id);
      default: return false;
    }
  }

  /** Группа подсвечена, если включено что-то из её меню. */
  groupOn(name) {
    const fs = this.fs;
    if (!fs) return false;
    if (name === 'lists') return !!fs.list;
    if (name === 'format' && (fs.code || fs.sub || fs.sup)) return true;
    return Object.values(this.slots).some((s) => s.group === name && !this.inRow(s.id) && this.slotOn(s.id));
  }

  paintGroups() {
    for (const name of ['format', 'insert', 'lists', 'more']) this.b[name].classList.toggle('on', this.groupOn(name));
  }

  /** Стрелки по строке: влево-вправо, Home и End; стрелка вниз на кнопке
   *  группы открывает её меню. Tab ходит по кнопкам сам. */
  onKey(e) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowDown'];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = [...this.dom.querySelectorAll('button')].filter((x) => !x.disabled && x.offsetParent !== null);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') {
      if (list[i].getAttribute('aria-haspopup') !== 'menu') return;
      e.preventDefault();
      list[i].click();
      return;
    }
    e.preventDefault();
    const n = list.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    list[j].focus();
  }

  destroy() {
    if (this.ro) this.ro.disconnect();
  }

  /** Остров таблицы: плавает под таблицей, пока курсор в ней, — тем же
   *  видом, что панель над выделением. Строки и столбцы — ручками слева и
   *  сверху таблицы (tablehandles.js) и на телефоне тоже: с 17 октября 2026
   *  кнопок строк и столбцов, повторявших меню ручек, на острове нет. Здесь —
   *  то, чего у ручек нет: объединить, разделить, строка заголовков, заливка,
   *  график из таблицы, удалить таблицу. */
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
    return h('div', { class: 'led-tablebar', hidden: true, role: 'toolbar', 'aria-label': t('table.tools') },
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
    this.fs = fs;
    const b = this.b;
    b.fontSize.classList.toggle('on', !!fs.fontSize);
    b.fontFamily.classList.toggle('on', !!fs.fontFamily);
    b.undo.disabled = !fs.canUndo;
    b.redo.disabled = !fs.canRedo;
    for (const k of ['strong', 'em', 'underline', 'strike']) b[k].classList.toggle('on', !!fs[k]);
    b.color.classList.toggle('on', !!fs.textColor);
    b.highlight.classList.toggle('on', !!fs.highlight);
    b.link.classList.toggle('on', !!fs.link);
    b.bullet.classList.toggle('on', fs.list === 'bullet_list');
    b.ordered.classList.toggle('on', fs.list === 'ordered_list');
    b.tasks.classList.toggle('on', fs.list === 'task_list');
    b.quote.classList.toggle('on', fs.quote);
    b.callout.classList.toggle('on', !!fs.callout);
    b.block.querySelector('.led-block-label').textContent = this.ed.t(BLOCK_LABEL[fs.block] || 'turn.paragraph');
    // Значки меняются, только когда меняется то, что они показывают.
    const align = ALIGN_ICON[fs.align] || 'alignLeft';
    if (this.alignIcon !== align) { this.alignIcon = align; b.align.replaceChildren(icon(align)); }
    const list = LIST_ICON[fs.list] || 'bullet';
    if (this.listIcon !== list) {
      this.listIcon = list;
      const glyph = icon(list);
      glyph.classList.add('led-drop-icon');
      b.lists.firstChild.replaceWith(glyph);
    }
    b.annotate.classList.toggle('on', this.ed.annotating);
    b.comments.classList.toggle('on', this.ed.panel === 'comments');
    b.outline.classList.toggle('on', this.ed.panel === 'outline');
    const open = this.ed.threads().filter((th) => !th.resolved && !th.draft).length;
    b.comments.dataset.count = open ? String(open) : '';
    this.paintGroups();
    this.tableBar.hidden = !fs.inTable;
    if (fs.inTable) this.ed.placeTableBar();
    this.tb.merge.disabled = !fs.cellSelection;
  }
}

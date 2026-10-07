// Общие детали интерфейса редактора: меню, всплывающие панели, выбор цвета,
// сетка размера таблицы, окно. Меню — тот же .ctx-menu, что во всём
// приложении: системных <select> в проекте нет (см. CLAUDE.md).
import { h, icon, placePopup, dismissOnOutside, keyLabel } from './util.js';
import { COLOR_KEYS } from './schema.js';

let openPopup = null;

export function closePopup() {
  if (openPopup) { const p = openPopup; openPopup = null; p.close(); }
}

/** Всплывающая панель у прямоугольника якоря. Одновременно — одна. */
export function popup(root, anchor, content, opts) {
  closePopup();
  const o = opts || {};
  const el = h('div', { class: `ctx-menu led-pop ${o.class || ''}`, role: o.role || 'dialog' }, content);
  root.append(el);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  if (o.above) placePopup(el, r.left + (o.center ? r.width / 2 : 0), r.top, { above: true, below: r.bottom, center: o.center });
  else placePopup(el, r.left + (o.center ? r.width / 2 : 0), r.bottom + 4, { flipY: r.top, center: o.center });
  let undo = null;
  const close = () => {
    if (undo) undo();
    el.remove();
    if (openPopup && openPopup.el === el) openPopup = null;
    if (o.onClose) o.onClose();
  };
  undo = dismissOnOutside(el, () => closePopup(), [anchor instanceof Element ? anchor : null]);
  openPopup = { el, close };
  return { el, close: () => closePopup() };
}

/** Меню из пунктов: { label, icon, kbd, active, danger, disabled, run } | 'sep'. */
export function menu(root, anchor, items, opts) {
  const list = h('div', { class: 'led-menu', role: 'menu' });
  let p = null;
  for (const it of items) {
    if (it === 'sep') { list.append(h('div', { class: 'ctx-sep' })); continue; }
    if (it.heading) { list.append(h('div', { class: 'led-menu-head' }, it.heading)); continue; }
    const b = h('button', {
      type: 'button',
      class: `ctx-item${it.active ? ' sel' : ''}${it.danger ? ' danger' : ''}`,
      role: 'menuitem',
      disabled: it.disabled || null,
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => { e.preventDefault(); p.close(); it.run(); },
    }, h('span', { class: 'ctx-main' }, it.icon ? icon(it.icon, 16) : null, h('span', { class: 'led-menu-label' }, it.label)),
    it.kbd ? h('span', { class: 'led-kbd' }, keyLabel(it.kbd)) : (it.active ? h('span', { class: 'ctx-check' }, '✓') : null));
    list.append(b);
  }
  p = popup(root, anchor, list, Object.assign({ role: 'menu' }, opts || {}));
  const first = list.querySelector('button:not([disabled])');
  if (first && opts && opts.focus) first.focus();
  return p;
}

/** Выбор цвета: образцы палитры и «без цвета». kind — 'tc' (текст) или 'hl'. */
export function colorGrid(kind, current, onPick, t) {
  const grid = h('div', { class: 'led-colors', role: 'listbox' });
  const none = h('button', {
    type: 'button',
    class: `led-swatch none${!current ? ' on' : ''}`,
    title: t('color.none'),
    onmousedown: (e) => e.preventDefault(),
    onclick: () => onPick(null),
  }, icon('x', 14));
  grid.append(none);
  for (const key of COLOR_KEYS) {
    grid.append(h('button', {
      type: 'button',
      class: `led-swatch sw-${kind}-${key}${current === key ? ' on' : ''}`,
      title: t(`color.${key}`),
      'data-color': key,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => onPick(key),
    }, kind === 'tc' ? 'A' : ''));
  }
  return grid;
}

/** Сетка «сколько строк и столбцов» для новой таблицы. */
export function tableSizeGrid(onPick, t) {
  const MAX = 8;
  const label = h('div', { class: 'led-tgrid-label' }, t('table.pick_size'));
  const grid = h('div', { class: 'led-tgrid' });
  const header = h('label', { class: 'led-check' }, h('input', { type: 'checkbox', checked: true }), t('table.with_header'));
  const cells = [];
  const mark = (r, c) => {
    cells.forEach((el) => el.classList.toggle('on', +el.dataset.r <= r && +el.dataset.c <= c));
    label.textContent = `${c} × ${r}`;
  };
  for (let r = 1; r <= MAX; r++) {
    for (let c = 1; c <= MAX; c++) {
      const cell = h('button', {
        type: 'button', class: 'led-tcell', dataset: { r, c }, 'aria-label': `${c} × ${r}`,
        onmouseenter: () => mark(r, c),
        onfocus: () => mark(r, c),
        onmousedown: (e) => e.preventDefault(),
        onclick: () => onPick(r, c, header.querySelector('input').checked),
      });
      cells.push(cell);
      grid.append(cell);
    }
  }
  return h('div', { class: 'led-tpick' }, label, grid, header);
}

/** Окно поверх: заголовок, содержимое, кнопки. Подложка стоит в общем
 *  правиле центровки модалок в styles.css — своей раскладки у неё нет. */
export function modal(root, title, body, buttons, opts) {
  const o = opts || {};
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); if (o.onClose) o.onClose(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const primary = buttons.find((b) => b.primary);
      if (primary) { e.preventDefault(); primary.run(close); }
    }
  };
  const box = h('div', { class: `modal led-modal ${o.class || ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-title' }, title),
    body,
    h('div', { class: 'modal-buttons' }, buttons.map((b) => h('button', {
      type: 'button', class: [b.primary ? 'primary' : '', b.danger ? 'confirm-danger' : ''].join(' ').trim() || null,
      onclick: () => b.run(close),
    }, b.label))));
  const backdrop = h('div', { id: 'ledmodal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, box);
  root.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  const first = box.querySelector('input, textarea, button');
  if (first && !o.noFocus) setTimeout(() => first.focus(), 0);
  return { close, box };
}

/** Сегментный переключатель — тот же .segmented, что в приложении. */
export function segmented(options, value, onChange, small) {
  const wrap = h('div', { class: `segmented${small ? ' segmented-sm' : ''}`, role: 'tablist' });
  const paint = (v) => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button', dataset: { v: o.value }, title: o.title || o.label || null, role: 'tab',
      onclick: () => { paint(o.value); onChange(o.value); },
    }, o.icon ? icon(o.icon, 16) : null, o.label ? h('span', {}, o.label) : null));
  }
  paint(value);
  return wrap;
}

/** Переключатель — тот же .switch, что в приложении: кнопка с aria-pressed. */
export function toggleSwitch(label, value, onChange, hint) {
  const b = h('button', {
    type: 'button', class: 'switch led-switch', 'aria-pressed': String(!!value),
    onclick: () => {
      const v = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(v));
      onChange(v);
    },
  }, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })),
  h('span', { class: 'led-setting-text' }, h('span', {}, label), hint ? h('span', { class: 'led-setting-hint' }, hint) : null));
  return b;
}

/** Ползунок с подписью значения. */
export function slider(label, value, min, max, step, onChange, fmt) {
  const out = h('span', { class: 'led-slider-val' }, fmt ? fmt(value) : String(value));
  const input = h('input', {
    type: 'range', min, max, step, value, class: 'led-range',
    oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt ? fmt(v) : String(v); onChange(v); },
  });
  return h('label', { class: 'led-setting led-setting-slider' }, h('span', { class: 'led-setting-text' }, label), input, out);
}

// Общие детали админки: сборка узлов, форматы, пустые состояния, ошибки,
// сегментный переключатель, меню, подтверждение, тост. Разделы берут их
// отсюда, своих вариантов не заводят (DESIGN.md, «Админ-панель»).
//
// Узлы собираются через h(): текст — textContent, атрибуты — по одному.
// Данные пользователей (письма, отзывы, почты) никогда не идут в innerHTML.
import { errorText, isGateError } from './api.js';

/** h('div', { class: 'x', on: { click } }, 'текст', узел, [узлы]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Ссылка наружу — только https, в новой вкладке, без адреса админки. */
export function extLink(href, text, cls) {
  const ok = typeof href === 'string' && /^https:\/\//.test(href);
  if (!ok) return h('span', { class: cls }, text);
  return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

// ---------- форматы ----------

const NUM = new Intl.NumberFormat('ru-RU');
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const fmtNum = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : NUM.format(Number(n)));
const noYear = (s) => s.replace(/\s*г\.$/, '');
export const fmtDate = (iso) => (iso ? noYear(DATE.format(new Date(iso))) : '—');
export const fmtDateTime = (iso) => (iso ? DATE_TIME.format(new Date(iso)) : '—');
/** День 'ГГГГ-ММ-ДД' (UTC, как в базе) — «23 окт.». */
export const fmtDay = (day) => (day ? DAY.format(new Date(`${day}T00:00:00Z`)) : '—');

/** Число в правильной форме слова: plural(3, 'день', 'дня', 'дней'). */
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ---------- страница раздела ----------

/** Шапка раздела и тело. actions — узлы справа от заголовка. */
export function page(root, title, actions) {
  const head = h('header', { class: 'page-head' },
    h('h1', { class: 'page-title', text: title }),
    h('div', { class: 'page-actions' }, actions || []));
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(head, body);
  return { head, body, actions: head.lastChild };
}

export function island(title, note, ...children) {
  return h('section', { class: 'island' },
    title || note ? h('div', { class: 'island-head' },
      title ? h('h2', { class: 'island-title', text: title }) : null,
      note ? (note instanceof Node ? note : h('span', { class: 'island-note', text: note })) : null) : null,
    children);
}

// ---------- состояния ----------

export function loading(text = 'Загружаю…') {
  return h('div', { class: 'note', 'aria-busy': 'true' }, text);
}

/** Пустое состояние — как в вебе: сценка из core/illustrations.js (копия в
 *  vendor/), заголовок, текст и кнопка, если действие очевидно. */
export function emptyState({ art, title, text, small, action }) {
  const box = h('div', { class: small ? 'empty-state empty-state-sm' : 'empty-state' });
  if (art && window.Core && window.Core.artSvg) {
    // Разметка сценки — своя, из vendor/illustrations.js, без данных пользователя.
    const tmp = document.createElement('div');
    tmp.innerHTML = window.Core.artSvg(art);
    if (tmp.firstElementChild) box.append(tmp.firstElementChild);
  }
  box.append(h('p', { class: 'empty-state-title', text: title }));
  if (text) box.append(h('p', { class: 'empty-state-text', text }));
  if (action) box.append(action);
  return box;
}

/** Ошибка с повтором. Для сети — понятная строка, для сервера — его код. */
export function errorBox(err, retry) {
  return h('div', { class: 'note is-error', role: 'alert' },
    h('p', { class: 'note-text', text: errorText(err) }),
    retry ? h('button', { type: 'button', class: 'btn-soft', on: { click: retry } }, 'Повторить') : null);
}

/** Загрузка в узел: «Загружаю…» → render(data) или ошибка с «Повторить».
 *  Устаревший ответ (переключили период, ушли из раздела) не рисуется.
 *  Ошибки входа рисует не раздел, а экран входа (app.js). → run() — повтор. */
export function loadInto(box, fetcher, render) {
  let seq = 0;
  const run = async () => {
    const my = ++seq;
    box.replaceChildren(loading());
    try {
      const data = await fetcher();
      if (my !== seq || !box.isConnected) return;
      render(data);
    } catch (e) {
      if (my !== seq || isGateError(e)) return;
      box.replaceChildren(errorBox(e, run));
    }
  };
  run();
  return run;
}

// ---------- переключатели ----------

/** Сегментный переключатель: [{ value, label }], текущее — .on. */
export function segmented(options, value, onChange, label) {
  const box = h('div', { class: 'segmented', role: 'group', 'aria-label': label || null });
  const paint = (v) => {
    for (const b of box.children) {
      const on = b.dataset.value === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const o of options) {
    box.append(h('button', {
      type: 'button',
      dataset: { value: String(o.value) },
      on: { click: () => { paint(o.value); onChange(o.value); } },
    }, o.label));
  }
  paint(value);
  box.setValue = paint;
  return box;
}

/** Кнопка-выпадашка: название и шеврон; список — openMenu. */
export function selectButton(text, onClick, attrs) {
  const btn = h('button', { type: 'button', class: 'dp-select', 'aria-haspopup': 'menu', ...attrs, on: { click: () => onClick(btn) } },
    h('span', { class: 'dp-select-name', text }),
    chevron());
  btn.setText = (t) => { btn.firstChild.textContent = t; };
  return btn;
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'chev');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M3 4.5 6 7.5 9 4.5');
  svg.append(p);
  return svg;
}

// ---------- меню ----------

let menuEl = null;
let menuCleanup = null;

export function closeMenu() {
  if (menuCleanup) menuCleanup();
  menuCleanup = null;
  if (menuEl) menuEl.remove();
  menuEl = null;
}

/** Своё меню вместо системного <select>: items — [{ label, value, sel, danger }]. */
export function openMenu(anchor, items, onPick) {
  if (menuEl && menuEl._anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu', id: 'ctx-menu' });
  menu._anchor = anchor;
  for (const it of items) {
    menu.append(h('button', {
      type: 'button',
      role: 'menuitemradio',
      'aria-checked': String(!!it.sel),
      class: `ctx-item${it.sel ? ' sel' : ''}${it.danger ? ' danger' : ''}`,
      on: { click: () => { closeMenu(); onPick(it.value); } },
    }, h('span', { class: 'ctx-label', text: it.label }), it.sel ? h('span', { class: 'ctx-check', 'aria-hidden': 'true' }, '✓') : null));
  }
  document.body.append(menu);
  menuEl = menu;
  anchor.classList.add('open');
  // Под кнопкой, в пределах экрана; у нижнего края — над ней.
  const r = anchor.getBoundingClientRect();
  const w = Math.max(r.width, menu.offsetWidth);
  menu.style.minWidth = `${Math.round(r.width)}px`;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - 4 - menu.offsetHeight);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  const first = menu.querySelector('.ctx-item.sel') || menu.querySelector('.ctx-item');
  if (first) first.focus();
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = [...menu.querySelectorAll('.ctx-item')];
      const i = list.indexOf(document.activeElement);
      const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      if (next) next.focus();
      e.preventDefault();
    }
  };
  const onScroll = () => closeMenu();
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onScroll);
  menuCleanup = () => {
    anchor.classList.remove('open');
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onScroll);
  };
}

// ---------- подтверждение ----------

/** Окно «вы уверены?». Центруется общим правилом .backdrop. → Promise<boolean>. */
export function confirmDialog({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    const okBtn = h('button', { type: 'button', class: danger ? 'btn-danger' : 'btn-accent', 'data-confirm': 'ok', on: { click: () => done(true) } }, ok);
    const back = h('div', { class: 'backdrop', id: 'confirm-backdrop', on: { mousedown: (e) => { if (e.target === back) done(false); } } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title' },
        h('h2', { class: 'modal-title', id: 'confirm-title', text: title }),
        text ? (text instanceof Node ? text : h('p', { class: 'modal-text', text })) : null,
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', class: 'btn-soft', 'data-confirm': 'cancel', on: { click: () => done(false) } }, cancel),
          okBtn)));
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    okBtn.focus();
  });
}

// ---------- тост ----------

let toastTimer = 0;
export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/** Кнопка «копировать» для секрета или id. */
export function copyButton(getText, label = 'Скопировать') {
  const btn = h('button', { type: 'button', class: 'btn-soft', on: { click: async () => {
    try { await navigator.clipboard.writeText(getText()); toast('Скопировано'); } catch { toast('Не удалось скопировать — выделите и скопируйте вручную'); }
  } } }, label);
  return btn;
}

/** Поле с подписью. */
export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'form-row' },
    h('label', { class: 'form-label', for: id, text: label }),
    input,
    hint ? h('p', { class: 'form-hint', text: hint }) : null);
}

/** Задержка ввода — поиск по мере набора. */
export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

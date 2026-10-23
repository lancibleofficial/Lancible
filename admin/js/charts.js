// Графики админки — свои лёгкие SVG, без библиотек. Цвета — классами из
// admin.css (токены --chart, --line, --text-faint), поэтому график верен
// обеим темам; из JS — только координаты и размеры.
import { h, fmtNum, fmtDay } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs, text) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
};

/** Дни периода 'ГГГГ-ММ-ДД' по UTC (день в базе — UTC), последний — сегодня. */
export function lastDays(days, today = new Date()) {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** Ряд с пропусками → ряд на каждый день периода (пропуск — ноль). Конец
 *  периода — последний день ряда, если он позже сегодняшнего по UTC. */
export function fillSeries(series, days) {
  const map = new Map();
  let latest = null;
  for (const p of Array.isArray(series) ? series : []) {
    if (!p || !p.day) continue;
    map.set(p.day, (map.get(p.day) || 0) + (Number(p.n) || 0));
    if (!latest || p.day > latest) latest = p.day;
  }
  const today = new Date();
  const end = latest && latest > today.toISOString().slice(0, 10) ? new Date(`${latest}T00:00:00Z`) : today;
  return lastDays(days, end).map((day) => ({ day, n: map.get(day) || 0 }));
}

/** Круглый верх шкалы: 1, 2, 5 × 10^k. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Столбики по дням. Перерисовывается по ширине контейнера. */
export function barChart(points, { label } = {}) {
  const box = h('div', { class: 'chart' });
  const total = points.reduce((a, p) => a + p.n, 0);
  const peak = points.reduce((a, p) => Math.max(a, p.n), 0);
  const draw = () => {
    const W = Math.max(200, Math.round(box.clientWidth || 480));
    const H = 168;
    const pad = { l: 40, r: 6, t: 10, b: 24 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const top = niceMax(peak);
    const svg = s('svg', {
      class: 'chart-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `${label || 'График'}: всего ${fmtNum(total)}, больше всего за день — ${fmtNum(peak)}`,
    });
    for (const f of [0, 0.5, 1]) {
      const y = pad.t + ph - ph * f;
      svg.append(s('line', { class: 'ch-grid', x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
      const v = top * f;
      svg.append(s('text', { class: 'ch-label', x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, fmtNum(Number.isInteger(v) ? v : Math.round(v * 10) / 10)));
    }
    const band = pw / Math.max(1, points.length);
    const bw = Math.max(1, Math.min(18, band * 0.68));
    points.forEach((p, i) => {
      const bh = p.n > 0 ? Math.max(2, (p.n / top) * ph) : 0;
      const x = pad.l + i * band + (band - bw) / 2;
      const r = s('rect', { class: 'ch-bar', x: x.toFixed(1), y: (pad.t + ph - bh).toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), rx: Math.min(3, bw / 2).toFixed(1) });
      r.append(s('title', null, `${fmtDay(p.day)}: ${fmtNum(p.n)}`));
      svg.append(r);
    });
    const ticks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
    for (const i of ticks) {
      const x = pad.l + i * band + band / 2;
      const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
      const tx = anchor === 'start' ? Math.max(pad.l, x - band / 2) : anchor === 'end' ? Math.min(W - pad.r, x + band / 2) : x;
      svg.append(s('text', { class: 'ch-label', x: tx.toFixed(1), y: H - 6, 'text-anchor': anchor }, fmtDay(points[i].day)));
    }
    box.replaceChildren(svg);
  };
  let lastW = -1;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) { ro.disconnect(); return; }
    const w = Math.round(box.clientWidth);
    if (w !== lastW) { lastW = w; draw(); }
  });
  ro.observe(box);
  draw();
  return box;
}

/** Строки с полосами: [{ label, value, sub }] — доли от наибольшего. */
export function barList(rows, { empty } = {}) {
  const max = rows.reduce((a, r) => Math.max(a, Number(r.value) || 0), 0);
  if (!rows.length && empty) return empty;
  return h('ul', { class: 'bar-list' }, rows.map((r) => {
    const fill = h('span', { class: 'bar-fill' });
    fill.style.width = `${max ? Math.max(1.5, ((Number(r.value) || 0) / max) * 100) : 0}%`;
    return h('li', { class: 'bar-row' },
      h('div', { class: 'bar-head' },
        h('span', { class: 'bar-name' }, r.label, r.code ? h('code', { class: 'bar-code', text: r.code }) : null, r.tag || null),
        h('span', { class: 'bar-value num' }, fmtNum(r.value), r.sub ? h('span', { class: 'bar-sub', text: r.sub }) : null)),
      h('div', { class: 'bar' }, fill));
  }));
}

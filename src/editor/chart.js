// Графики: отрисовка в SVG и окно правки.
//
// Данные графика живут в самом узле (attrs.chart), а не в отдельной
// таблице: график переносится, копируется и экспортируется вместе с
// текстом. «График из таблицы» копирует числа в момент создания.
//
// Цвета рядов — классами .led-series-N, значения — токенами палитры
// (styles.css на десктопе и в вебе, theme.js — на телефоне).
import Core from '../renderer/core/doc.js';
import { h, svg, icon } from './util.js';
import { modal, segmented, toggleSwitch } from './ui.js';

const { chartScale, chartShares } = Core;

export const CHART_TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'donut'];
const ICON = { bar: 'chart', hbar: 'rows', line: 'chartLine', area: 'chartArea', pie: 'chartPie', donut: 'chartPie' };

export function defaultChart(t) {
  return {
    type: 'bar',
    title: '',
    labels: [t('chart.sample_a'), t('chart.sample_b'), t('chart.sample_c'), t('chart.sample_d')],
    series: [{ name: t('chart.series_n', { n: 1 }), values: [4, 7, 5, 9] }],
    legend: true,
    values: false,
    stacked: false,
  };
}

export function normalizeChart(c) {
  const ch = Object.assign({ type: 'bar', title: '', labels: [], series: [], legend: true, values: false, stacked: false }, c || {});
  if (!CHART_TYPES.includes(ch.type)) ch.type = 'bar';
  ch.labels = (ch.labels || []).map((l) => String(l == null ? '' : l));
  ch.series = (ch.series || []).map((s) => ({
    name: String(s.name || ''),
    values: ch.labels.map((_, i) => (Number.isFinite(Number(s.values && s.values[i])) ? Number(s.values[i]) : 0)),
  }));
  return ch;
}

const fmtNum = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return String(+v.toFixed(2));
};

function text(x, y, s, cls, anchor) {
  const el = svg('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' });
  el.textContent = s;
  return el;
}

/** График → <svg>. width — ширина полосы текста; высота от неё. */
export function renderChart(raw, width) {
  const c = normalizeChart(raw);
  const W = Math.max(260, Math.round(width || 640));
  const pie = c.type === 'pie' || c.type === 'donut';
  const H = pie ? Math.min(360, Math.round(W * 0.6)) : Math.min(420, Math.max(220, Math.round(W * 0.5)));
  const root = svg('svg', { class: `led-chart-svg type-${c.type}`, viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': c.title || 'chart' });
  let top = 12;
  if (c.title) { root.append(text(W / 2, 22, c.title, 'led-ch-title')); top = 38; }
  const legendH = c.legend && (c.series.length > 1 || pie) ? 26 : 0;
  const bottomPad = legendH;

  if (!c.labels.length || !c.series.length) {
    root.append(text(W / 2, H / 2, '—', 'led-ch-axis'));
    return root;
  }

  if (pie) {
    const s = c.series[0];
    const shares = chartShares(s.values);
    const cx = W / 2;
    const cy = top + (H - top - bottomPad) / 2;
    const r = Math.max(30, Math.min(W / 2 - 20, (H - top - bottomPad) / 2 - 6));
    const inner = c.type === 'donut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    shares.forEach((sh, i) => {
      if (sh <= 0) return;
      const a1 = a0 + sh * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      let d;
      if (sh >= 0.9999) {
        d = `M${p(r, 0)}A${r},${r} 0 1 1 ${p(r, Math.PI)}A${r},${r} 0 1 1 ${p(r, 0)}`;
        if (inner) d += `M${p(inner, 0)}A${inner},${inner} 0 1 0 ${p(inner, Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, 0)}`;
      } else if (inner) {
        d = `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`;
      } else {
        d = `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
      }
      const path = svg('path', { d, class: `led-series-${i % 8} led-ch-slice`, 'fill-rule': 'evenodd' });
      const title = svg('title');
      title.textContent = `${c.labels[i]}: ${s.values[i]} (${Math.round(sh * 100)}%)`;
      path.append(title);
      root.append(path);
      if (sh > 0.06) {
        const mid = (a0 + a1) / 2;
        const lr = inner ? (r + inner) / 2 : r * 0.62;
        root.append(text(cx + lr * Math.cos(mid), cy + lr * Math.sin(mid) + 4, c.values ? fmtNum(s.values[i]) : `${Math.round(sh * 100)}%`, 'led-ch-slice-label'));
      }
      a0 = a1;
    });
    if (legendH) legend(root, c.labels, W, H - 8, true);
    return root;
  }

  const horizontal = c.type === 'hbar';
  const stacked = c.stacked && (c.type === 'bar' || c.type === 'hbar' || c.type === 'area');
  const all = [];
  if (stacked) {
    c.labels.forEach((_, i) => {
      let pos = 0; let neg = 0;
      c.series.forEach((s) => { if (s.values[i] >= 0) pos += s.values[i]; else neg += s.values[i]; });
      all.push(pos, neg);
    });
  } else c.series.forEach((s) => all.push(...s.values));
  const scale = chartScale(all, 5);
  const longest = Math.max(...scale.ticks.map((v) => fmtNum(v).length));
  const labelW = horizontal ? Math.min(W * 0.3, 8 + 7 * Math.max(...c.labels.map((l) => l.length))) : 0;
  const left = horizontal ? labelW + 10 : 14 + longest * 7;
  const right = 14;
  const bottom = (horizontal ? 22 : 30) + bottomPad;
  const plotW = W - left - right;
  const plotH = H - top - bottom;

  // Сетка и подписи оси значений.
  for (const v of scale.ticks) {
    const f = (v - scale.min) / (scale.max - scale.min);
    if (horizontal) {
      const x = left + f * plotW;
      root.append(svg('line', { x1: x, x2: x, y1: top, y2: top + plotH, class: v === 0 ? 'led-ch-zero' : 'led-ch-grid' }));
      root.append(text(x, top + plotH + 16, fmtNum(v), 'led-ch-axis'));
    } else {
      const y = top + plotH - f * plotH;
      root.append(svg('line', { x1: left, x2: left + plotW, y1: y, y2: y, class: v === 0 ? 'led-ch-zero' : 'led-ch-grid' }));
      root.append(text(left - 6, y + 4, fmtNum(v), 'led-ch-axis', 'end'));
    }
  }

  const n = c.labels.length;
  const band = (horizontal ? plotH : plotW) / n;
  const valPos = (v) => (v - scale.min) / (scale.max - scale.min);

  c.labels.forEach((lab, i) => {
    if (horizontal) root.append(text(left - 8, top + band * (i + 0.5) + 4, lab, 'led-ch-axis', 'end'));
    else {
      const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 56)));
      if (i % every === 0) root.append(text(left + band * (i + 0.5), top + plotH + 18, lab.length > 14 ? `${lab.slice(0, 13)}…` : lab, 'led-ch-axis'));
    }
  });

  if (c.type === 'bar' || c.type === 'hbar') {
    const groups = stacked ? 1 : c.series.length;
    const gap = band * 0.22;
    const bw = (band - gap) / groups;
    c.labels.forEach((_, i) => {
      let accPos = 0; let accNeg = 0;
      c.series.forEach((s, si) => {
        const v = s.values[i];
        let from; let to;
        if (stacked) {
          if (v >= 0) { from = accPos; to = accPos + v; accPos = to; } else { from = accNeg; to = accNeg + v; accNeg = to; }
        } else { from = 0; to = v; }
        const a = valPos(Math.min(from, to));
        const b = valPos(Math.max(from, to));
        const off = gap / 2 + (stacked ? 0 : si * bw);
        const rect = horizontal
          ? svg('rect', { x: left + a * plotW, y: top + band * i + off, width: Math.max(1, (b - a) * plotW), height: Math.max(1, bw - 2), rx: 3, class: `led-series-${si % 8}` })
          : svg('rect', { x: left + band * i + off, y: top + plotH - b * plotH, width: Math.max(1, bw - 2), height: Math.max(1, (b - a) * plotH), rx: 3, class: `led-series-${si % 8}` });
        const title = svg('title');
        title.textContent = `${s.name ? `${s.name} · ` : ''}${c.labels[i]}: ${v}`;
        rect.append(title);
        root.append(rect);
        if (c.values && !stacked) {
          root.append(horizontal
            ? text(left + b * plotW + 4, top + band * i + off + bw / 2 + 3, fmtNum(v), 'led-ch-val', 'start')
            : text(left + band * i + off + bw / 2 - 1, top + plotH - b * plotH - 5, fmtNum(v), 'led-ch-val'));
        }
      });
    });
  } else {
    // Линии и области.
    const base = c.labels.map(() => 0);
    c.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => {
        const y0 = stacked ? base[i] : 0;
        const y1 = y0 + v;
        if (stacked) base[i] = y1;
        return { x: left + band * (i + 0.5), y: top + plotH - valPos(y1) * plotH, y0: top + plotH - valPos(y0) * plotH, v };
      });
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
      if (c.type === 'area') {
        const back = pts.slice().reverse().map((p) => `L${p.x.toFixed(1)},${p.y0.toFixed(1)}`).join('');
        root.append(svg('path', { d: `${line}${back}Z`, class: `led-series-${si % 8} led-ch-area` }));
      }
      root.append(svg('path', { d: line, class: `led-series-${si % 8} led-ch-line` }));
      pts.forEach((p, i) => {
        const dot = svg('circle', { cx: p.x, cy: p.y, r: 3.5, class: `led-series-${si % 8} led-ch-dot` });
        const title = svg('title');
        title.textContent = `${s.name ? `${s.name} · ` : ''}${c.labels[i]}: ${p.v}`;
        dot.append(title);
        root.append(dot);
        if (c.values) root.append(text(p.x, p.y - 8, fmtNum(p.v), 'led-ch-val'));
      });
    });
  }

  if (legendH) legend(root, c.series.map((s) => s.name), W, H - 8, false);
  return root;
}

function legend(root, names, W, y, slices) {
  const items = names.map((nm, i) => ({ nm: nm.length > 18 ? `${nm.slice(0, 17)}…` : nm, i }));
  const widths = items.map((it) => 20 + it.nm.length * 7);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = Math.max(8, (W - total) / 2);
  items.forEach((it, k) => {
    root.append(svg('rect', { x, y: y - 9, width: 10, height: 10, rx: 2, class: `led-series-${it.i % 8}${slices ? ' led-ch-slice' : ''}` }));
    root.append(text(x + 15, y, it.nm, 'led-ch-legend', 'start'));
    x += widths[k];
  });
}

// --- окно правки ---------------------------------------------------------------------

/** Открыть правку графика. onSave(chart) — с новыми данными. */
export function editChart(root, initial, t, onSave) {
  let c = normalizeChart(JSON.parse(JSON.stringify(initial)));
  const preview = h('div', { class: 'led-chart-preview' });
  const grid = h('div', { class: 'led-chart-grid' });
  const pie = () => c.type === 'pie' || c.type === 'donut';

  const paint = () => {
    preview.replaceChildren(renderChart(c, 520));
    stackedRow.hidden = pie() || c.type === 'line';
  };

  const cellInput = (value, onInput, cls, numeric) => h('input', {
    class: `field-sm led-cell-in ${cls || ''}`, value, inputmode: numeric ? 'decimal' : null,
    oninput: (e) => { onInput(e.target.value); paint(); },
    onpaste: (e) => onPasteGrid(e),
  });

  function rebuildGrid() {
    const table = h('table', { class: 'led-chart-table' });
    const head = h('tr', {}, h('th', {}, t('chart.labels')));
    c.series.forEach((s, si) => {
      head.append(h('th', {},
        h('span', { class: `led-series-key led-series-${si % 8}` }),
        cellInput(s.name, (v) => { s.name = v; }, 'led-cell-head'),
        c.series.length > 1 ? h('button', {
          type: 'button', class: 'led-mini', title: t('chart.del_series'),
          onclick: () => { c.series.splice(si, 1); rebuildGrid(); paint(); },
        }, icon('x', 12)) : null));
    });
    head.append(h('th', {}, h('button', {
      type: 'button', class: 'led-mini', title: t('chart.add_series'),
      onclick: () => { c.series.push({ name: t('chart.series_n', { n: c.series.length + 1 }), values: c.labels.map(() => 0) }); rebuildGrid(); paint(); },
    }, icon('plus', 14))));
    table.append(head);
    c.labels.forEach((lab, i) => {
      const tr = h('tr', {}, h('td', {}, cellInput(lab, (v) => { c.labels[i] = v; })));
      c.series.forEach((s) => tr.append(h('td', {}, cellInput(String(s.values[i]), (v) => {
        const num = Core.parseCellNumber(v);
        s.values[i] = num == null ? 0 : num;
      }, '', true))));
      tr.append(h('td', {}, c.labels.length > 1 ? h('button', {
        type: 'button', class: 'led-mini', title: t('chart.del_row'),
        onclick: () => { c.labels.splice(i, 1); c.series.forEach((s) => s.values.splice(i, 1)); rebuildGrid(); paint(); },
      }, icon('x', 12)) : null));
      table.append(tr);
    });
    const add = h('button', {
      type: 'button', class: 'btn-soft led-add-row',
      onclick: () => { c.labels.push(''); c.series.forEach((s) => s.values.push(0)); rebuildGrid(); paint(); const ins = grid.querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus(); },
    }, icon('plus', 14), t('chart.add_row'));
    grid.replaceChildren(table, add);
  }

  /** Вставка блока из таблицы (Excel, Google Таблицы): строки через \n,
   *  ячейки через Tab — заменяет данные целиком. */
  function onPasteGrid(e) {
    const txt = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!txt || !txt.includes('\t')) return;
    e.preventDefault();
    const rows = txt.replace(/\r/g, '').split('\n').filter((r) => r.trim()).map((r) => r.split('\t'));
    const data = Core.chartFromRows(rows);
    if (!data) return;
    c.labels = data.labels;
    c.series = data.series;
    rebuildGrid();
    paint();
  }

  const title = h('input', {
    class: 'field', value: c.title, placeholder: t('chart.title_ph'),
    oninput: (e) => { c.title = e.target.value; paint(); },
  });
  const types = segmented(CHART_TYPES.map((v) => ({ value: v, icon: ICON[v], title: t(`chart.type_${v}`) })), c.type, (v) => { c.type = v; paint(); }, true);
  const stackedRow = toggleSwitch(t('chart.stacked'), c.stacked, (v) => { c.stacked = v; paint(); });
  const opts = h('div', { class: 'led-chart-opts' },
    toggleSwitch(t('chart.legend'), c.legend, (v) => { c.legend = v; paint(); }),
    toggleSwitch(t('chart.values'), c.values, (v) => { c.values = v; paint(); }),
    stackedRow);

  const body = h('div', { class: 'led-chart-editor' },
    h('div', { class: 'led-chart-left' }, title, types, preview, opts),
    h('div', { class: 'led-chart-right' }, h('div', { class: 'led-hint' }, t('chart.paste_hint')), grid));

  rebuildGrid();
  paint();
  return modal(root, t('chart.edit_title'), body, [
    { label: t('common.cancel'), run: (close) => close() },
    { label: t('common.save'), primary: true, run: (close) => { close(); onSave(normalizeChart(c)); } },
  ], { class: 'modal-lg led-chart-modal', noFocus: false });
}

/** NodeView графика: картинка, двойной щелчок — правка. */
export class ChartView {
  constructor(node, view, getPos, ctx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    this.dom = h('div', { class: 'led-chart', contenteditable: 'false' });
    this.body = h('div', { class: 'led-chart-body' });
    this.bar = h('div', { class: 'led-node-bar' },
      h('button', { type: 'button', class: 'led-btn', title: ctx.t('chart.edit'), onclick: () => this.edit() }, icon('edit', 16)),
      h('button', { type: 'button', class: 'led-btn', title: ctx.t('block.delete'), onclick: () => this.remove() }, icon('trash', 16)));
    this.dom.append(this.body, this.bar);
    this.dom.addEventListener('dblclick', () => this.edit());
    this.render();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.render()) : null;
    if (this.ro) this.ro.observe(this.dom);
  }

  render() {
    const w = this.dom.clientWidth || 640;
    if (this.lastW === w && this.lastNode === this.node) return;
    this.lastW = w;
    this.lastNode = this.node;
    this.body.replaceChildren(renderChart(this.node.attrs.chart, w));
  }

  edit() {
    if (!this.view.editable) return;
    editChart(this.ctx.root, this.node.attrs.chart, this.ctx.t, (chart) => {
      const pos = this.getPos();
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { chart })));
    });
  }

  remove() {
    const pos = this.getPos();
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() { this.dom.classList.add('sel'); }

  deselectNode() { this.dom.classList.remove('sel'); }

  stopEvent(e) { return this.bar.contains(e.target); }

  ignoreMutation() { return true; }

  destroy() { if (this.ro) this.ro.disconnect(); }
}

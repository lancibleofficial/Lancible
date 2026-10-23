// Граф кода: функции, файлы и разделы документов и связи между ними, по
// исходникам (graphify). До 23 октября 2026 — служебная страница /graph
// лендинга с выгрузкой graphify во фрейме; теперь — раздел админки:
//   • данные — graph/graph.json: npm run site:refresh (scripts/publish-site.js)
//     вынимает их из выгрузки graphify, проверяет на секреты и кладёт сюда;
//   • рисует vis-network — копия vendor/vis-network-9.1.6.min.js, та самая,
//     что в пакете (отпечаток сверяет tests/unit/landing-third-party.test.js);
//   • поиск, карточка узла и легенда сообществ — свои, на деталях админки:
//     выгрузка graphify держалась на встроенных скриптах и стилях строкой, а
//     политика сайта (vercel.json) их не пускает.
// Граф весит сотни килобайт, библиотека — 700: и то и другое грузится, только
// когда раздел открыт.
//
// Цвет сообщества — данные графа (их выбирает graphify), как цвет проекта в
// вебе: в холст он идёт как есть, в разметку — переменной --node-color. Цвета
// интерфейса холста (подписи, линии, выделение) — токены admin.css, их холст
// перечитывает при смене темы.
import { h, page, loadInto, fmtNum } from '../ui.js';
import { fetchStatic, loadScript } from '../static.js';

export const DATA = 'graph/graph.json';
export const VIS = 'vendor/vis-network-9.1.6.min.js';
const SEARCH_LIMIT = 20;

/** vis-network (сборка standalone) при загрузке вставляет в <head> восемь
 *  <style> со своими правилами. Политика сайта (style-src 'self') их не
 *  примет и напишет в консоль восемь ошибок. Пока скрипт выполняется,
 *  document.head — отвязанный узел: стили уходят в никуда. Нужное из них —
 *  подсказка над узлом (.vis-tooltip) — описано в admin.css токенами. */
function loadVis() {
  if (window.vis && window.vis.Network) return Promise.resolve(window.vis);
  const sink = document.createElement('div');
  return loadScript(VIS, {
    beforeLoad: () => Object.defineProperty(document, 'head', { configurable: true, get: () => sink }),
    afterLoad: () => { delete document.head; },
  }).then(() => window.vis);
}

/** Цвета холста из токенов темы (admin.css). */
function tokens(el) {
  const cs = getComputedStyle(el);
  const v = (name) => cs.getPropertyValue(name).trim();
  return { text: v('--text'), faint: v('--text-faint'), accent: v('--accent'), chart: v('--chart') };
}

/** Данные графа в порядке: узлы, связи, легенда. Чужой вид — ошибка, а не
 *  пустой холст. */
export function checkData(data) {
  const ok = data && Array.isArray(data.nodes) && Array.isArray(data.edges) && Array.isArray(data.legend)
    && data.nodes.every((n) => n && n.id != null && typeof n.label === 'string');
  if (!ok) throw new Error('graph.json: не тот вид');
  return data;
}

const colorOf = (n) => (n && n.color && typeof n.color === 'object' ? n.color.background || n.color.border : null);

/** Точка цвета сообщества: цвет — данные, переменной. */
function dot(color) {
  const el = h('span', { class: 'node-dot', 'aria-hidden': 'true' });
  if (color) el.style.setProperty('--node-color', color);
  return el;
}

function stats(meta) {
  const m = meta || {};
  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), h('b', { class: 'stat-value', text: value }));
  return h('div', { class: 'stats', id: 'graph-stats' },
    stat('узлов', fmtNum(m.nodes)),
    stat('связей', fmtNum(m.edges)),
    stat('сообществ', fmtNum(m.communities)),
    stat('построен', m.date || '—'));
}

export function mount(root) {
  const fullBtn = h('button', { type: 'button', class: 'btn-soft', id: 'graph-full', 'aria-pressed': 'false', disabled: true }, 'Во весь экран');
  const { body } = page(root, 'Граф кода', [fullBtn]);
  body.append(h('p', { class: 'island-lede graph-lede' },
    'Каждая точка — функция, файл или раздел документа; на большом графе — сообщество: кусок кода, который связан сам с собой теснее, чем с остальным. ',
    'Линии — вызовы, импорты и вложенность. Цвет — сообщество. Граф строится по исходникам программой graphify и обновляется при каждом выкате (npm run site:refresh).'));
  const box = h('div', { class: 'stack', id: 'graph-box' });
  body.append(box);

  let network = null;
  let teardown = [];
  const cleanup = () => {
    for (const fn of teardown) { try { fn(); } catch { /* уже убрано */ } }
    teardown = [];
    if (network) { network.destroy(); network = null; }
  };

  loadInto(box, async () => {
    const [data] = await Promise.all([fetchStatic(DATA, 'json').then(checkData), loadVis()]);
    return data;
  }, (data) => {
    cleanup();
    const vis = window.vis;
    const canvas = h('div', { class: 'graph-canvas', id: 'graph-canvas' });
    const search = h('input', { type: 'search', class: 'field', id: 'graph-search', placeholder: 'Найти узел…', autocomplete: 'off', 'aria-label': 'Найти узел' });
    const results = h('div', { class: 'graph-results', id: 'graph-results', hidden: true });
    const info = h('div', { class: 'graph-info', id: 'graph-info' }, h('p', { class: 'muted', text: 'Выберите точку, чтобы увидеть, что это.' }));
    const legendList = h('ul', { class: 'graph-legend', id: 'graph-legend' });
    const legendCount = h('span', { class: 'island-note', id: 'graph-legend-count' });
    const showAll = h('button', { type: 'button', class: 'linklike', id: 'graph-show-all' }, 'Показать все');
    const hideAll = h('button', { type: 'button', class: 'linklike', id: 'graph-hide-all' }, 'Скрыть все');
    const side = h('aside', { class: 'graph-side', 'aria-label': 'Поиск и легенда' },
      h('div', { class: 'graph-search' }, search, results),
      h('section', { class: 'graph-panel' }, h('h2', { class: 'sub-title', text: 'Узел' }), info),
      h('section', { class: 'graph-panel graph-panel-legend' },
        h('div', { class: 'graph-legend-head' }, h('h2', { class: 'sub-title', text: 'Сообщества' }), legendCount),
        h('div', { class: 'graph-legend-actions' }, showAll, hideAll),
        legendList));
    const shell = h('section', { class: 'island graph-shell', id: 'graph-shell' }, canvas, side);
    const shownNote = data.meta && data.meta.shown
      ? h('p', { class: 'muted graph-shown' }, `На рисунке: ${fmtNum(data.meta.shown.nodes)} ${data.meta.shown.nodes === data.meta.nodes ? 'узлов' : 'точек'} и ${fmtNum(data.meta.shown.edges)} связей между ними.`)
      : null;
    box.replaceChildren(stats(data.meta), shownNote || '', shell);

    let tok = tokens(canvas);
    const byId = new Map(data.nodes.map((n) => [String(n.id), n]));
    const nodeView = (n, i) => {
      const c = colorOf(n);
      return {
        id: n.id, label: n.label, title: n.title || n.label, size: n.size,
        color: c ? { background: c, border: c, highlight: { background: c, border: tok.text }, hover: { background: c, border: tok.text } } : undefined,
        // Затравка по спирали, как в шаблоне graphify: без неё физика на
        // большом графе считает отталкивание почти нулевых расстояний.
        x: 30 * Math.sqrt(i) * Math.cos(i * 2.4),
        y: 30 * Math.sqrt(i) * Math.sin(i * 2.4),
      };
    };
    const nodes = new vis.DataSet(data.nodes.map(nodeView));
    const edges = new vis.DataSet(data.edges.map((e, i) => ({
      id: i, from: e.from, to: e.to, title: e.title, dashes: !!e.dashes, width: e.width || 1,
      color: e.color && typeof e.color.opacity === 'number' ? { opacity: e.color.opacity } : undefined,
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    })));
    const themed = () => ({
      nodes: { font: { color: tok.text, face: 'Onest, sans-serif', size: 12 } },
      edges: { color: { color: tok.faint, highlight: tok.accent, hover: tok.text } },
    });
    network = new vis.Network(canvas, { nodes, edges }, {
      autoResize: true,
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: { gravitationalConstant: -60, centralGravity: 0.005, springLength: 120, springConstant: 0.08, damping: 0.4, avoidOverlap: 0.8 },
        stabilization: { iterations: 200, fit: true },
      },
      interaction: { hover: true, tooltipDelay: 100, hideEdgesOnDrag: true, navigationButtons: false, keyboard: false },
      nodes: { shape: 'dot', borderWidth: 1.5, ...themed().nodes },
      edges: { smooth: { type: 'continuous', roundness: 0.2 }, selectionWidth: 3, ...themed().edges },
    });
    const net = network;
    net.once('stabilizationIterationsDone', () => { if (network === net) net.setOptions({ physics: { enabled: false } }); });
    canvas.dataset.ready = 'true';
    fullBtn.disabled = false;

    // Гиперрёбра — группы узлов заливкой (в нынешнем графе их нет).
    const hyper = Array.isArray(data.hyperedges) ? data.hyperedges.filter((x) => x && Array.isArray(x.nodes)) : [];
    if (hyper.length) {
      net.on('afterDrawing', (ctx) => {
        for (const he of hyper) {
          const pts = he.nodes.map((id) => net.getPositions([id])[id]).filter(Boolean);
          if (pts.length < 2) continue;
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          const hull = convexHull(pts).map((p) => ({ x: cx + (p.x - cx) * 1.15, y: cy + (p.y - cy) * 1.15 }));
          ctx.save();
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = tok.chart;
          ctx.strokeStyle = tok.chart;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hull[0].x, hull[0].y);
          for (const p of hull.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.4;
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = tok.text;
          ctx.font = '600 11px Onest, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(he.label || ''), cx, cy - 5);
          ctx.restore();
        }
      });
    }

    // ---------- карточка узла ----------
    const field = (label, value) => [h('dt', { text: label }), h('dd', { text: value })];
    const showInfo = (id) => {
      const n = byId.get(String(id));
      if (!n) return;
      const meta = !n.file_type && !n.source_file;
      const near = net.getConnectedNodes(id).map((x) => byId.get(String(x))).filter(Boolean);
      const dl = h('dl', { class: 'dl graph-dl' },
        field('Узел', n.label),
        meta ? null : field('Вид', n.file_type || '—'),
        field('Сообщество', n.community_name || '—'),
        meta ? (n.member_count != null ? field('В нём узлов', fmtNum(n.member_count)) : null) : field('Файл', n.source_file || '—'),
        field('Связей', fmtNum(n.degree)));
      const list = near.length
        ? h('div', { class: 'graph-near' },
          h('p', { class: 'muted', text: `Соседи: ${fmtNum(near.length)}` }),
          h('ul', { class: 'graph-near-list' }, near.map((nb) => h('li', null,
            h('button', { type: 'button', class: 'graph-link', dataset: { nid: String(nb.id) }, on: { click: () => focusNode(nb.id) } }, dot(colorOf(nb)), h('span', { class: 'graph-link-name', text: nb.label }))))))
        : null;
      info.replaceChildren(dl, list || '');
      info.dataset.node = String(n.id);
    };
    const focusNode = (id) => {
      net.focus(id, { scale: 1.4, animation: true });
      net.selectNodes([id]);
      showInfo(id);
    };
    net.on('click', (p) => {
      if (p.nodes && p.nodes.length) showInfo(p.nodes[0]);
    });
    net.on('hoverNode', () => canvas.classList.add('is-pointer'));
    net.on('blurNode', () => canvas.classList.remove('is-pointer'));

    // ---------- поиск ----------
    const hideResults = () => { results.hidden = true; results.replaceChildren(); };
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      if (!q) { hideResults(); return; }
      const found = data.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
      if (!found.length) {
        results.replaceChildren(h('p', { class: 'muted graph-none', text: 'Ничего не нашлось' }));
        results.hidden = false;
        return;
      }
      results.replaceChildren(...found.map((n) => h('button', {
        type: 'button', class: 'graph-link', dataset: { nid: String(n.id) },
        on: { click: () => { focusNode(n.id); hideResults(); search.value = ''; } },
      }, dot(colorOf(n)), h('span', { class: 'graph-link-name', text: n.label }))));
      results.hidden = false;
    });
    const onDocDown = (e) => { if (!results.contains(e.target) && e.target !== search) hideResults(); };
    document.addEventListener('mousedown', onDocDown);
    teardown.push(() => document.removeEventListener('mousedown', onDocDown));

    // ---------- легенда ----------
    const hidden = new Set();
    const items = new Map();
    const paintLegend = () => {
      legendCount.textContent = hidden.size ? `скрыто ${fmtNum(hidden.size)} из ${fmtNum(data.legend.length)}` : `${fmtNum(data.legend.length)}`;
      for (const [cid, btn] of items) btn.setAttribute('aria-pressed', String(!hidden.has(cid)));
    };
    const setHidden = (cids, hide) => {
      const set = new Set(cids);
      for (const cid of cids) if (hide) hidden.add(cid); else hidden.delete(cid);
      nodes.update(data.nodes.filter((n) => set.has(n.community)).map((n) => ({ id: n.id, hidden: hide })));
      paintLegend();
    };
    for (const c of data.legend) {
      const btn = h('button', {
        type: 'button', class: 'graph-legend-item', 'aria-pressed': 'true', dataset: { cid: String(c.cid) },
        on: { click: () => setHidden([c.cid], !hidden.has(c.cid)) },
      }, dot(c.color), h('span', { class: 'graph-legend-label', text: c.label }), h('span', { class: 'graph-legend-n', text: fmtNum(c.count) }));
      items.set(c.cid, btn);
      legendList.append(h('li', null, btn));
    }
    showAll.addEventListener('click', () => setHidden([...hidden], false));
    hideAll.addEventListener('click', () => setHidden(data.legend.map((c) => c.cid).filter((cid) => !hidden.has(cid)), true));
    paintLegend();

    // ---------- во весь экран ----------
    const setFull = (on) => {
      shell.classList.toggle('is-full', on);
      fullBtn.setAttribute('aria-pressed', String(on));
      fullBtn.textContent = on ? 'Свернуть' : 'Во весь экран';
      requestAnimationFrame(() => { if (network === net) { net.setSize('100%', '100%'); net.redraw(); } });
    };
    const onFull = () => setFull(!shell.classList.contains('is-full'));
    const onKey = (e) => { if (e.key === 'Escape' && shell.classList.contains('is-full')) { e.preventDefault(); setFull(false); fullBtn.focus(); } };
    fullBtn.addEventListener('click', onFull);
    document.addEventListener('keydown', onKey);
    teardown.push(() => { fullBtn.removeEventListener('click', onFull); document.removeEventListener('keydown', onKey); });

    // ---------- тема ----------
    // Холст рисует цветами, а не классами: смена темы (кнопка в рейле или
    // система) — перечитать токены и перерисовать.
    const retheme = () => {
      if (network !== net) return;
      tok = tokens(canvas);
      net.setOptions(themed());
      nodes.update(data.nodes.map((n, i) => ({ id: n.id, color: nodeView(n, i).color })));
    };
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', retheme);
    teardown.push(() => { mo.disconnect(); mq.removeEventListener('change', retheme); });
  });

  return cleanup;
}

/** Выпуклая оболочка точек (монотонная цепь Эндрю), против часовой стрелки. */
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (seq) => {
    const out = [];
    for (const q of seq) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  const hull = build(p).concat(build(p.slice().reverse()));
  return hull.length >= 3 ? hull : p;
}

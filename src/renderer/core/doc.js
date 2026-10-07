/* Документ редактора — чистая логика, без DOM и без state.
 *
 * Редактор (src/editor/, ProseMirror) хранит текст деревом блоков в JSON
 * ProseMirror. Здесь всё, что с этим деревом делается без браузера:
 *
 *  - контейнер: документ плюс комментарии и слой пометок от руки;
 *  - переезд старых заметок Quill (Delta) в документ — лениво, при чтении:
 *    повторное чтение того же Delta даёт тот же документ, и ничего в данных
 *    не меняется, пока человек сам не поправит текст;
 *  - обратный перевод в Delta — для старых версий приложения, которые
 *    умеют только Quill: они читают `ops`, новые — `lancible`;
 *  - подсчёт слов, оглавление, Markdown, упаковка штрихов, шкала графика.
 *
 * Имена схемы (paragraph, heading, bullet_list…) — те же, что в
 * src/editor/schema.js. Разойдутся — сломается и переезд, и тесты.
 */
(function (global) {
  const DOC_VERSION = 1;

  // ---------------------------------------------------------------------------
  // Контейнер
  // ---------------------------------------------------------------------------

  const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

  const emptyContainer = () => ({ v: DOC_VERSION, doc: emptyDoc(), comments: [], ink: [] });

  const isDelta = (x) => Array.isArray(x) || !!(x && Array.isArray(x.ops) && !x.lancible);

  /** Приводит контейнер к полному виду: недостающее — пустым, чужое — прочь. */
  function normalizeContainer(c) {
    if (!c || typeof c !== 'object') return emptyContainer();
    const doc = c.doc && c.doc.type === 'doc' && Array.isArray(c.doc.content) && c.doc.content.length
      ? c.doc : emptyDoc();
    return {
      v: DOC_VERSION,
      doc,
      comments: Array.isArray(c.comments) ? c.comments : [],
      ink: Array.isArray(c.ink) ? c.ink : [],
    };
  }

  /** Что угодно из поля notes или body → контейнер.
   *  null — пустой; Delta (массив или {ops}) — переезд; {lancible} или сам
   *  контейнер — как есть. */
  function readNotes(notes) {
    if (!notes) return emptyContainer();
    if (notes.lancible) return normalizeContainer(notes.lancible);
    if (notes.doc) return normalizeContainer(notes);
    if (isDelta(notes)) {
      const ops = Array.isArray(notes) ? notes : notes.ops;
      return { v: DOC_VERSION, doc: deltaToDoc(ops), comments: [], ink: [] };
    }
    return emptyContainer();
  }

  /** Контейнер → поле notes задачи: новое плюс Delta для старых версий. */
  function writeNotes(container) {
    const c = normalizeContainer(container);
    return { ops: docToDelta(c.doc), lancible: c };
  }

  /** Пустой ли документ: ни текста, ни картинок, ни рисунков. */
  function isDocEmpty(container) {
    const c = normalizeContainer(container);
    if (c.ink.length) return false;
    let empty = true;
    walk(c.doc, (n) => {
      if (n.type === 'text' && n.text.trim()) empty = false;
      if (ATOMS.has(n.type) || n.type === 'table') empty = false;
    });
    return empty;
  }

  const ATOMS = new Set(['image', 'chart', 'drawing', 'horizontal_rule']);

  function walk(node, fn) {
    fn(node);
    if (node.content) for (const ch of node.content) walk(ch, fn);
  }

  // ---------------------------------------------------------------------------
  // Quill Delta → документ
  // ---------------------------------------------------------------------------

  /** Строчные атрибуты Quill → метки документа. Неизвестное пропускаем. */
  function deltaMarks(attrs) {
    if (!attrs) return undefined;
    const marks = [];
    if (attrs.bold) marks.push({ type: 'strong' });
    if (attrs.italic) marks.push({ type: 'em' });
    if (attrs.underline) marks.push({ type: 'underline' });
    if (attrs.strike) marks.push({ type: 'strike' });
    if (attrs.code) marks.push({ type: 'code' });
    if (attrs.script === 'sub') marks.push({ type: 'sub' });
    if (attrs.script === 'super') marks.push({ type: 'sup' });
    if (attrs.color) marks.push({ type: 'textColor', attrs: { color: String(attrs.color) } });
    if (attrs.background) marks.push({ type: 'highlight', attrs: { color: String(attrs.background) } });
    if (attrs.link) marks.push({ type: 'link', attrs: { href: String(attrs.link), title: null } });
    return marks.length ? marks : undefined;
  }

  /** Delta → строки: у каждой строки свои куски текста и атрибуты, которые
   *  Quill вешает на её перевод строки. */
  function deltaLines(ops) {
    const lines = [];
    let cur = [];
    for (const op of ops || []) {
      if (!op || op.insert == null) continue;
      if (typeof op.insert === 'string') {
        const parts = op.insert.split('\n');
        parts.forEach((part, i) => {
          if (part) cur.push({ text: part, attrs: op.attributes });
          if (i < parts.length - 1) {
            lines.push({ items: cur, attrs: op.attributes || {} });
            cur = [];
          }
        });
      } else if (typeof op.insert === 'object') {
        cur.push({ embed: op.insert, attrs: op.attributes });
      }
    }
    if (cur.length) lines.push({ items: cur, attrs: {} });
    return lines;
  }

  function inlineContent(items) {
    const out = [];
    for (const it of items) {
      if (it.text == null) continue;
      const node = { type: 'text', text: it.text };
      const marks = deltaMarks(it.attrs);
      if (marks) node.marks = marks;
      out.push(node);
    }
    return out;
  }

  const ALIGNS = new Set(['center', 'right', 'justify']);

  function paragraphOf(items, attrs, type, extra) {
    const node = { type: type || 'paragraph' };
    const a = Object.assign({}, extra || {});
    if (attrs && ALIGNS.has(attrs.align)) a.align = attrs.align;
    if (Object.keys(a).length) node.attrs = a;
    const content = inlineContent(items);
    if (content.length) node.content = content;
    return node;
  }

  /** Картинки из строки — отдельными блоками: в документе картинка стоит
   *  между абзацами, а не внутри строки. */
  function embedBlocks(items) {
    const out = [];
    for (const it of items) {
      if (!it.embed) continue;
      if (typeof it.embed.image === 'string') {
        out.push({ type: 'image', attrs: { src: it.embed.image, alt: '', caption: '', width: null, align: 'center' } });
      }
    }
    return out;
  }

  const LIST_TYPE = { bullet: 'bullet_list', ordered: 'ordered_list', checked: 'task_list', unchecked: 'task_list' };

  /** Подряд идущие строки списка → вложенные списки по indent. */
  function buildLists(lines) {
    const root = [];
    // стек: { level, list } — открытые списки, по одному на уровень
    const stack = [];
    for (const line of lines) {
      const level = Math.max(0, Number(line.attrs.indent) || 0);
      const kind = line.attrs.list;
      const type = LIST_TYPE[kind] || 'bullet_list';
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      let top = stack[stack.length - 1];
      if (top && top.level === level && top.list.type !== type) { stack.pop(); top = stack[stack.length - 1]; }
      if (!top || top.level < level) {
        const list = { type, content: [] };
        if (top) {
          const parentItem = top.list.content[top.list.content.length - 1];
          if (parentItem) parentItem.content.push(list);
          else root.push(list);
        } else root.push(list);
        stack.push({ level, list });
        top = stack[stack.length - 1];
      }
      const item = type === 'task_list'
        ? { type: 'task_item', attrs: { checked: kind === 'checked' }, content: [paragraphOf(line.items, line.attrs)] }
        : { type: 'list_item', content: [paragraphOf(line.items, line.attrs)] };
      top.list.content.push(item);
    }
    return root;
  }

  function buildTable(lines) {
    const rows = [];
    let lastId = null;
    for (const line of lines) {
      const rowId = String(line.attrs.table);
      if (rowId !== lastId) { rows.push({ type: 'table_row', content: [] }); lastId = rowId; }
      const cell = { type: 'table_cell', content: [paragraphOf(line.items, line.attrs)] };
      if (line.attrs.cellBg) cell.attrs = { background: String(line.attrs.cellBg) };
      rows[rows.length - 1].content.push(cell);
    }
    // ProseMirror требует прямоугольную таблицу — добиваем короткие строки.
    const width = Math.max(1, ...rows.map((r) => r.content.length));
    for (const r of rows) while (r.content.length < width) r.content.push({ type: 'table_cell', content: [{ type: 'paragraph' }] });
    return { type: 'table', content: rows };
  }

  /** Какой группе принадлежит строка: подряд идущие строки одной группы
   *  собираются в один блок (список, цитату, код, таблицу). */
  function lineGroup(attrs) {
    if (attrs.table) return 'table';
    if (attrs['code-block']) return 'code';
    if (attrs.list) return 'list';
    if (attrs.blockquote) return 'quote';
    return null;
  }

  function deltaToDoc(ops) {
    const lines = deltaLines(ops);
    const content = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const group = lineGroup(line.attrs);
      if (group) {
        const run = [];
        while (i < lines.length && lineGroup(lines[i].attrs) === group) { run.push(lines[i]); i++; }
        if (group === 'list') content.push(...buildLists(run));
        else if (group === 'table') content.push(buildTable(run));
        else if (group === 'quote') content.push({ type: 'blockquote', content: run.map((l) => paragraphOf(l.items, l.attrs)) });
        else {
          const text = run.map((l) => l.items.map((it) => it.text || '').join('')).join('\n');
          const lang = typeof run[0].attrs['code-block'] === 'string' && run[0].attrs['code-block'] !== 'plain'
            ? run[0].attrs['code-block'] : '';
          const node = { type: 'code_block', attrs: { language: lang } };
          if (text) node.content = [{ type: 'text', text }];
          content.push(node);
        }
        continue;
      }
      content.push(...embedBlocks(line.items));
      const hasText = line.items.some((it) => it.text);
      const level = Number(line.attrs.header);
      if (level >= 1 && level <= 6) content.push(paragraphOf(line.items, line.attrs, 'heading', { level: Math.min(level, 4) }));
      else if (hasText || !embedBlocks(line.items).length) content.push(paragraphOf(line.items, line.attrs));
      i++;
    }
    // Quill всегда держит в конце пустую строку — в документе она лишняя.
    while (content.length > 1 && isBlankParagraph(content[content.length - 1])) content.pop();
    return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
  }

  const isBlankParagraph = (n) => n.type === 'paragraph' && !(n.content && n.content.length) && !n.attrs;

  // ---------------------------------------------------------------------------
  // Документ → Quill Delta (для старых версий приложения)
  // ---------------------------------------------------------------------------

  function marksToAttrs(marks) {
    const a = {};
    for (const m of marks || []) {
      if (m.type === 'strong') a.bold = true;
      else if (m.type === 'em') a.italic = true;
      else if (m.type === 'underline') a.underline = true;
      else if (m.type === 'strike') a.strike = true;
      else if (m.type === 'code') a.code = true;
      else if (m.type === 'sub') a.script = 'sub';
      else if (m.type === 'sup') a.script = 'super';
      else if (m.type === 'textColor' && m.attrs) a.color = m.attrs.color;
      else if (m.type === 'highlight' && m.attrs) a.background = m.attrs.color;
      else if (m.type === 'link' && m.attrs) a.link = m.attrs.href;
    }
    return Object.keys(a).length ? a : null;
  }

  function pushInline(ops, node) {
    for (const ch of node.content || []) {
      if (ch.type === 'text') {
        const attrs = marksToAttrs(ch.marks);
        ops.push(attrs ? { insert: ch.text, attributes: attrs } : { insert: ch.text });
      } else if (ch.type === 'hard_break') {
        ops.push({ insert: '\n' });
      }
    }
  }

  function pushLine(ops, attrs) {
    const a = {};
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) a[k] = v;
    ops.push(Object.keys(a).length ? { insert: '\n', attributes: a } : { insert: '\n' });
  }

  function blockAlign(node) {
    return node.attrs && ALIGNS.has(node.attrs.align) ? node.attrs.align : null;
  }

  function textLine(ops, text, attrs) {
    if (text) ops.push({ insert: text });
    pushLine(ops, attrs);
  }

  function blockToDelta(ops, node, ctx) {
    switch (node.type) {
      case 'paragraph':
        pushInline(ops, node);
        pushLine(ops, Object.assign({ align: blockAlign(node) }, ctx.line));
        break;
      case 'heading':
        pushInline(ops, node);
        pushLine(ops, Object.assign({ header: node.attrs.level, align: blockAlign(node) }, ctx.line));
        break;
      case 'blockquote':
      case 'callout':
        for (const ch of node.content || []) blockToDelta(ops, ch, { line: { blockquote: true }, indent: ctx.indent });
        break;
      case 'code_block': {
        const text = (node.content || []).map((t) => t.text).join('');
        for (const l of text.split('\n')) textLine(ops, l, { 'code-block': (node.attrs && node.attrs.language) || 'plain' });
        break;
      }
      case 'bullet_list':
      case 'ordered_list':
      case 'task_list':
        for (const item of node.content || []) {
          const list = node.type === 'bullet_list' ? 'bullet'
            : node.type === 'ordered_list' ? 'ordered'
              : (item.attrs && item.attrs.checked ? 'checked' : 'unchecked');
          (item.content || []).forEach((ch, idx) => {
            if (idx === 0 && (ch.type === 'paragraph' || ch.type === 'heading')) {
              pushInline(ops, ch);
              pushLine(ops, { list, indent: ctx.indent || null });
            } else {
              blockToDelta(ops, ch, { line: {}, indent: (ctx.indent || 0) + 1 });
            }
          });
        }
        break;
      case 'table': {
        let r = 0;
        for (const row of node.content || []) {
          r += 1;
          for (const cell of row.content || []) {
            const first = (cell.content || [])[0];
            if (first) pushInline(ops, first);
            pushLine(ops, { table: `row-${r}`, cellBg: (cell.attrs && cell.attrs.background) || null });
          }
        }
        break;
      }
      case 'image':
        if (node.attrs && /^https?:|^data:image\//.test(node.attrs.src || '')) {
          ops.push({ insert: { image: node.attrs.src } });
          pushLine(ops, {});
        } else textLine(ops, `[${(node.attrs && node.attrs.alt) || 'image'}]`, {});
        break;
      case 'chart':
        textLine(ops, `[${chartTitle(node)}]`, {});
        break;
      case 'drawing':
        textLine(ops, '[✎]', {});
        break;
      case 'horizontal_rule':
        textLine(ops, '———', {});
        break;
      default:
        if (node.content) for (const ch of node.content) blockToDelta(ops, ch, ctx);
    }
  }

  const chartTitle = (node) => (node.attrs && node.attrs.chart && node.attrs.chart.title) || 'chart';

  function docToDelta(doc) {
    const ops = [];
    for (const node of (doc && doc.content) || []) blockToDelta(ops, node, { line: {}, indent: 0 });
    if (!ops.length) ops.push({ insert: '\n' });
    return ops;
  }

  // ---------------------------------------------------------------------------
  // Текст, счёт, оглавление
  // ---------------------------------------------------------------------------

  const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'code_block']);

  /** Текст документа по абзацам: каждый текстовый блок — своя строка. */
  function docPlainText(doc) {
    const lines = [];
    walk(doc || emptyDoc(), (n) => {
      if (!TEXT_BLOCKS.has(n.type)) return;
      lines.push((n.content || []).map((ch) => (ch.type === 'text' ? ch.text : ch.type === 'hard_break' ? '\n' : '')).join(''));
    });
    return lines.join('\n');
  }

  // Слово — подряд идущие буквы и цифры (любого алфавита), с апострофом и
  // дефисом внутри: «из-за», don't — одно слово.
  const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

  /** Счёт для того, кто пишет. Чтение — 200 слов в минуту, как принято для
   *  обычного текста; меньше минуты не бывает, если есть хоть слово. */
  function docStats(doc) {
    const text = docPlainText(doc);
    const words = (text.match(WORD) || []).length;
    const chars = text.replace(/\n/g, '').length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    let paragraphs = 0;
    walk(doc || emptyDoc(), (n) => {
      if (TEXT_BLOCKS.has(n.type) && (n.content || []).some((c) => c.type === 'text' && c.text.trim())) paragraphs += 1;
    });
    return { words, chars, charsNoSpaces, paragraphs, readingMin: words ? Math.max(1, Math.round(words / 200)) : 0 };
  }

  /** Оглавление: заголовки верхнего уровня документа по порядку, с номером
   *  блока, по которому редактор прокручивает к ним. */
  function docOutline(doc) {
    const out = [];
    ((doc && doc.content) || []).forEach((n, index) => {
      if (n.type !== 'heading') return;
      const text = (n.content || []).map((c) => c.text || '').join('').trim();
      if (text) out.push({ level: n.attrs.level, text, index });
    });
    return out;
  }

  /** Заголовок документа, если его не задали: первая непустая строка. */
  function docTitleGuess(doc, max) {
    const first = docPlainText(doc).split('\n').map((s) => s.trim()).find(Boolean) || '';
    const n = max || 60;
    return first.length > n ? `${first.slice(0, n - 1)}…` : first;
  }

  // ---------------------------------------------------------------------------
  // Markdown
  // ---------------------------------------------------------------------------

  const mdEscape = (s) => s.replace(/([\\`*_[\]#|<>])/g, '\\$1');

  function mdInline(node) {
    let out = '';
    for (const ch of node.content || []) {
      if (ch.type === 'hard_break') { out += '  \n'; continue; }
      if (ch.type !== 'text') continue;
      const marks = ch.marks || [];
      const has = (t) => marks.some((m) => m.type === t);
      if (has('code')) { out += `\`${ch.text}\``; continue; }
      let s = mdEscape(ch.text);
      if (has('strike')) s = `~~${s}~~`;
      if (has('em')) s = `*${s}*`;
      if (has('strong')) s = `**${s}**`;
      if (has('highlight')) s = `==${s}==`;
      const link = marks.find((m) => m.type === 'link');
      if (link) s = `[${s}](${link.attrs.href})`;
      out += s;
    }
    return out;
  }

  function mdBlock(node, indent, images) {
    const pad = '  '.repeat(indent);
    switch (node.type) {
      case 'paragraph': return pad + mdInline(node);
      case 'heading': return `${'#'.repeat(node.attrs.level)} ${mdInline(node)}`;
      case 'blockquote':
      case 'callout':
        return (node.content || []).map((c) => mdBlock(c, 0, images)).join('\n\n').split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
      case 'code_block':
        return `\`\`\`${(node.attrs && node.attrs.language) || ''}\n${(node.content || []).map((t) => t.text).join('')}\n\`\`\``;
      case 'horizontal_rule': return '---';
      case 'bullet_list':
      case 'ordered_list':
      case 'task_list':
        return (node.content || []).map((item, i) => {
          const marker = node.type === 'ordered_list' ? `${((node.attrs && node.attrs.order) || 1) + i}.`
            : node.type === 'task_list' ? `- [${item.attrs && item.attrs.checked ? 'x' : ' '}]` : '-';
          const [first, ...rest] = item.content || [];
          const head = `${pad}${marker} ${first ? mdInline(first) : ''}`;
          const tail = rest.map((c) => mdBlock(c, indent + 1, images));
          return [head, ...tail].join('\n');
        }).join('\n');
      case 'table': {
        const rows = (node.content || []).map((r) => (r.content || []).map((c) => ((c.content || [])
          .map((p) => mdInline(p)).join(' ')).replace(/\|/g, '\\|')));
        if (!rows.length) return '';
        const head = `| ${rows[0].join(' | ')} |`;
        const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
        return [head, sep, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
      }
      case 'image': {
        const src = node.attrs.src || '';
        if (images) images.push(src);
        return `![${node.attrs.alt || ''}](${src})${node.attrs.caption ? `\n*${mdEscape(node.attrs.caption)}*` : ''}`;
      }
      case 'chart': return mdChart(node);
      case 'drawing': return '*[✎]*';
      default: return (node.content || []).map((c) => mdBlock(c, indent, images)).join('\n\n');
    }
  }

  /** График в Markdown — его данные таблицей: в тексте рисовать нечем, а
   *  числа так не теряются. */
  function mdChart(node) {
    const c = (node.attrs && node.attrs.chart) || {};
    const labels = c.labels || [];
    const series = c.series || [];
    const title = c.title ? `**${mdEscape(c.title)}**\n\n` : '';
    if (!labels.length || !series.length) return `${title}*[chart]*`.trim();
    const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|');
    const head = `| | ${series.map((s) => cell(s.name)).join(' | ')} |`;
    const sep = `| --- | ${series.map(() => '---').join(' | ')} |`;
    const rows = labels.map((l, i) => `| ${cell(l)} | ${series.map((s) => cell((s.values || [])[i])).join(' | ')} |`);
    return `${title}${[head, sep, ...rows].join('\n')}`;
  }

  function docToMarkdown(doc) {
    return ((doc && doc.content) || []).map((n) => mdBlock(n, 0, null)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------------------------------------------------------------------------
  // Штрихи: точки ↔ строка
  // ---------------------------------------------------------------------------
  //
  // Рисунок живёт в данных задачи, а данные целиком уходят в синхронизацию на
  // каждое сохранение. Массив [[12.345, 67.891, 0.5], …] в JSON занимает
  // втрое больше, чем нужно. Поэтому координаты квантуются до десятых
  // пикселя, нажим — до сотых, всё пишется разностями соседних точек в
  // 36-ричной системе. Погрешность — 0,05 px, глазом её не увидеть.

  function packPoints(points) {
    const out = [];
    let px = 0; let py = 0; let pp = 0;
    for (const p of points || []) {
      const x = Math.round(p[0] * 10);
      const y = Math.round(p[1] * 10);
      const pr = Math.round((p[2] == null ? 0.5 : p[2]) * 100);
      out.push(`${(x - px).toString(36)},${(y - py).toString(36)},${(pr - pp).toString(36)}`);
      px = x; py = y; pp = pr;
    }
    return out.join(';');
  }

  function unpackPoints(str) {
    const out = [];
    if (!str) return out;
    let x = 0; let y = 0; let p = 0;
    for (const chunk of String(str).split(';')) {
      const [dx, dy, dp] = chunk.split(',');
      x += parseInt(dx, 36) || 0;
      y += parseInt(dy, 36) || 0;
      p += parseInt(dp, 36) || 0;
      out.push([x / 10, y / 10, p / 100]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Графики
  // ---------------------------------------------------------------------------

  /** Число из ячейки таблицы: «1 234,5», «12%», «$40», «−3». Не число — null. */
  function parseCellNumber(s) {
    const t = String(s == null ? '' : s).trim().replace(/[\s  ]/g, '').replace(/[−–]/g, '-');
    if (!t) return null;
    const m = t.replace(/[^\d.,-]/g, '');
    if (!/\d/.test(m)) return null;
    // Запятая — десятичная, если точки нет или она одна после точек-тысяч.
    let norm = m;
    if (m.includes(',') && m.includes('.')) norm = m.lastIndexOf(',') > m.lastIndexOf('.') ? m.replace(/\./g, '').replace(',', '.') : m.replace(/,/g, '');
    else if (m.includes(',')) norm = /,\d{3}$/.test(m) && m.split(',').length > 2 ? m.replace(/,/g, '') : m.replace(',', '.');
    const v = Number(norm);
    return Number.isFinite(v) ? v : null;
  }

  /** Таблица (строки ячеек-строк) → данные графика. Первая строка —
   *  названия рядов, первый столбец — подписи. Столбец без единого числа
   *  рядом не становится. */
  function chartFromRows(rows) {
    const clean = (rows || []).filter((r) => r && r.length);
    if (clean.length < 2) return null;
    const head = clean[0];
    const body = clean.slice(1);
    const labels = body.map((r) => String(r[0] == null ? '' : r[0]).trim());
    const series = [];
    for (let c = 1; c < head.length; c++) {
      const values = body.map((r) => parseCellNumber(r[c]));
      if (values.every((v) => v == null)) continue;
      series.push({ name: String(head[c] || '').trim() || `#${c}`, values: values.map((v) => (v == null ? 0 : v)) });
    }
    if (!series.length) return null;
    return { labels, series };
  }

  /** «Круглая» шкала: 0–100 шагом 20, а не 0–97,3 шагом 19,46. */
  function chartScale(values, ticks) {
    const nums = (values || []).filter((v) => Number.isFinite(v));
    let lo = Math.min(0, ...nums);
    let hi = Math.max(0, ...nums);
    if (lo === hi) hi = lo + 1;
    const want = ticks || 5;
    const raw = (hi - lo) / want;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || 10 * mag;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const list = [];
    for (let v = lo; v <= hi + step / 2; v += step) list.push(Number(v.toFixed(10)));
    return { min: lo, max: hi, step, ticks: list };
  }

  /** Доли круговой диаграммы: отрицательное и нули — не сектор. */
  function chartShares(values) {
    const pos = (values || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const sum = pos.reduce((a, b) => a + b, 0);
    return pos.map((v) => (sum ? v / sum : 0));
  }

  // ---------------------------------------------------------------------------
  // Комментарии
  // ---------------------------------------------------------------------------

  /** Ветки, у которых в тексте не осталось отметки, — «потерянные»: текст
   *  под ними удалили. Их не стираем молча, а показываем отдельно. */
  function commentIdsInDoc(doc) {
    const ids = new Set();
    walk(doc || emptyDoc(), (n) => {
      for (const m of n.marks || []) if (m.type === 'comment' && m.attrs && m.attrs.id) ids.add(m.attrs.id);
    });
    return ids;
  }

  function commentThreads(container) {
    const c = normalizeContainer(container);
    const live = commentIdsInDoc(c.doc);
    return c.comments.map((th) => Object.assign({}, th, { orphan: !live.has(th.id) }));
  }

  // ---------------------------------------------------------------------------
  // Документы — раздел «Документы»
  // ---------------------------------------------------------------------------

  function newDocument(o) {
    const now = o.now || new Date().toISOString();
    return {
      id: o.id,
      title: o.title || '',
      projectId: o.projectId || null,
      body: emptyContainer(),
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Список раздела: закреплённые сверху, дальше свежие правки. */
  function sortDocuments(docs) {
    return (docs || []).slice().sort((a, b) => {
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  /** Поиск по названию и тексту, без учёта регистра. */
  function searchDocuments(docs, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return (docs || []).slice();
    return (docs || []).filter((d) => String(d.title || '').toLowerCase().includes(q)
      || docPlainText(readNotes(d.body).doc).toLowerCase().includes(q));
  }

  const api = {
    DOC_VERSION,
    emptyDoc,
    emptyContainer,
    normalizeContainer,
    readNotes,
    writeNotes,
    isDocEmpty,
    deltaToDoc,
    docToDelta,
    docPlainText,
    docStats,
    docOutline,
    docTitleGuess,
    docToMarkdown,
    packPoints,
    unpackPoints,
    parseCellNumber,
    chartFromRows,
    chartScale,
    chartShares,
    commentThreads,
    newDocument,
    sortDocuments,
    searchDocuments,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

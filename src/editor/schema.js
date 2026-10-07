// Схема документа. Имена узлов и меток — те же, что в
// src/renderer/core/doc.js: по ним идут переезд из Quill, Markdown и счёт.
//
// bid — постоянный номер блока верхнего уровня. По нему пометки от руки
// поверх текста (ink) держатся за свой абзац: текст выше растёт — пометка
// едет вместе с абзацем, а не остаётся висеть на старой высоте.
import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

// Цвета текста и маркера — именами из палитры, а не числами: так один и тот
// же «жёлтый маркер» читается и на светлой теме, и на тёмной. Цвет, пришедший
// из Quill или вставленный из другого редактора, остаётся как был — стилем.
export const COLOR_KEYS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const isKey = (c) => COLOR_KEYS.includes(c);

const ALIGNS = ['left', 'center', 'right', 'justify'];

const blockAttrs = { bid: { default: null }, align: { default: null } };

function alignStyle(node) {
  const a = node.attrs.align;
  return a && a !== 'left' ? `text-align:${a}` : null;
}

function readAlign(dom) {
  const a = dom.style && dom.style.textAlign;
  return ALIGNS.includes(a) && a !== 'left' ? a : null;
}

function withBlock(attrs, node) {
  const out = Object.assign({}, attrs);
  if (node.attrs.bid) out['data-bid'] = node.attrs.bid;
  const st = alignStyle(node);
  if (st) out.style = st;
  return out;
}

const readBid = (dom) => dom.getAttribute('data-bid') || null;

const table = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    background: {
      default: null,
      getFromDOM: (dom) => dom.getAttribute('data-bg') || dom.style.backgroundColor || null,
      // Имя палитры — атрибутом (цвет берёт тема), чужой цвет — стилем.
      setDOMAttr: (value, attrs) => {
        if (!value) return;
        attrs['data-bg'] = value;
        if (!isKey(value)) attrs.style = `${attrs.style || ''}background-color:${value};`;
      },
    },
  },
});
table.table.attrs = { bid: { default: null } };
table.table.parseDOM = [{ tag: 'table', getAttrs: (dom) => ({ bid: readBid(dom) }) }];
table.table.toDOM = (node) => ['table', node.attrs.bid ? { 'data-bid': node.attrs.bid } : {}, ['tbody', 0]];

const CALLOUT_TONES = ['info', 'warn', 'ok', 'idea'];

export const nodes = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: Object.assign({}, blockAttrs),
    parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ bid: readBid(dom), align: readAlign(dom) }) }],
    toDOM: (node) => ['p', withBlock({}, node), 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: Object.assign({ level: { default: 1 } }, blockAttrs),
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom) => ({ level: Math.min(level, 4), bid: readBid(dom), align: readAlign(dom) }),
    })),
    toDOM: (node) => [`h${node.attrs.level}`, withBlock({}, node), 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { bid: { default: null } },
    parseDOM: [{ tag: 'blockquote', getAttrs: (dom) => ({ bid: readBid(dom) }) }],
    toDOM: (node) => ['blockquote', withBlock({}, node), 0],
  },

  callout: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { bid: { default: null }, tone: { default: 'info' } },
    parseDOM: [{
      tag: 'div.led-callout',
      getAttrs: (dom) => ({ bid: readBid(dom), tone: CALLOUT_TONES.includes(dom.dataset.tone) ? dom.dataset.tone : 'info' }),
    }],
    toDOM: (node) => ['div', withBlock({ class: `led-callout tone-${node.attrs.tone}`, 'data-tone': node.attrs.tone }, node), 0],
  },

  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { bid: { default: null }, language: { default: '' } },
    parseDOM: [{
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: (dom) => ({ bid: readBid(dom), language: dom.getAttribute('data-language') || '' }),
    }],
    toDOM: (node) => ['pre', withBlock({ 'data-language': node.attrs.language || '' }, node), ['code', 0]],
  },

  horizontal_rule: {
    group: 'block',
    attrs: { bid: { default: null } },
    parseDOM: [{ tag: 'hr', getAttrs: (dom) => ({ bid: readBid(dom) }) }],
    toDOM: (node) => ['hr', withBlock({}, node)],
  },

  bullet_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { bid: { default: null } },
    parseDOM: [{ tag: 'ul:not([data-type="tasks"])', getAttrs: (dom) => ({ bid: readBid(dom) }) }],
    toDOM: (node) => ['ul', withBlock({}, node), 0],
  },

  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { bid: { default: null }, order: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ bid: readBid(dom), order: dom.hasAttribute('start') ? +dom.getAttribute('start') : 1 }) }],
    toDOM: (node) => ['ol', withBlock(node.attrs.order === 1 ? {} : { start: node.attrs.order }, node), 0],
  },

  list_item: {
    content: 'paragraph block*',
    defining: true,
    parseDOM: [{ tag: 'li:not([data-checked])' }],
    toDOM: () => ['li', 0],
  },

  task_list: {
    group: 'block',
    content: 'task_item+',
    attrs: { bid: { default: null } },
    parseDOM: [{ tag: 'ul[data-type="tasks"]', priority: 60, getAttrs: (dom) => ({ bid: readBid(dom) }) }],
    toDOM: (node) => ['ul', withBlock({ 'data-type': 'tasks', class: 'led-tasks' }, node), 0],
  },

  task_item: {
    content: 'paragraph block*',
    defining: true,
    attrs: { checked: { default: false } },
    parseDOM: [{ tag: 'li[data-checked]', priority: 60, getAttrs: (dom) => ({ checked: dom.getAttribute('data-checked') === 'true' }) }],
    toDOM: (node) => ['li', { 'data-checked': String(node.attrs.checked), class: 'led-task' }, 0],
  },

  image: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: {
      bid: { default: null },
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      // Ширина в процентах полосы текста; null — как есть, но не шире полосы.
      width: { default: null },
      align: { default: 'center' },
    },
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (dom) => ({ src: dom.getAttribute('src'), alt: dom.getAttribute('alt') || '', bid: readBid(dom) }),
    }, {
      tag: 'figure.led-figure',
      getAttrs: (dom) => {
        const img = dom.querySelector('img');
        return img ? {
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt') || '',
          caption: (dom.querySelector('figcaption') || {}).textContent || '',
          width: dom.dataset.width ? Number(dom.dataset.width) : null,
          align: dom.dataset.align || 'center',
          bid: readBid(dom),
        } : false;
      },
    }],
    toDOM: (node) => {
      const a = node.attrs;
      const fig = ['figure', withBlock({ class: `led-figure align-${a.align}`, 'data-align': a.align, 'data-width': a.width || '' }, node),
        ['img', { src: a.src, alt: a.alt || '' }]];
      if (a.caption) fig.push(['figcaption', a.caption]);
      return fig;
    },
  },

  chart: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { bid: { default: null }, chart: { default: null } },
    parseDOM: [{
      tag: 'div.led-chart[data-chart]',
      getAttrs: (dom) => {
        try { return { chart: JSON.parse(dom.getAttribute('data-chart')), bid: readBid(dom) }; } catch { return false; }
      },
    }],
    toDOM: (node) => ['div', withBlock({ class: 'led-chart', 'data-chart': JSON.stringify(node.attrs.chart || {}) }, node)],
  },

  drawing: {
    group: 'block',
    atom: true,
    draggable: false,
    attrs: {
      bid: { default: null },
      height: { default: 320 },
      // Ширина, при которой рисовали: на другой ширине рисунок масштабируется
      // целиком, а не обрезается.
      width: { default: 720 },
      bg: { default: 'plain' },
      strokes: { default: [] },
    },
    parseDOM: [{
      tag: 'div.led-drawing[data-strokes]',
      getAttrs: (dom) => {
        try {
          return {
            strokes: JSON.parse(dom.getAttribute('data-strokes')),
            height: Number(dom.dataset.height) || 320,
            width: Number(dom.dataset.width) || 720,
            bg: dom.dataset.bg || 'plain',
            bid: readBid(dom),
          };
        } catch { return false; }
      },
    }],
    toDOM: (node) => ['div', withBlock({
      class: 'led-drawing',
      'data-strokes': JSON.stringify(node.attrs.strokes),
      'data-height': node.attrs.height,
      'data-width': node.attrs.width,
      'data-bg': node.attrs.bg,
    }, node)],
  },

  text: { group: 'inline' },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  table: table.table,
  table_row: table.table_row,
  table_cell: table.table_cell,
  table_header: table.table_header,
};

function colorMark(tag, styleProp, cls, skip) {
  return {
    attrs: { color: {} },
    parseDOM: [
      { tag: `${tag}[data-color]`, getAttrs: (dom) => ({ color: dom.getAttribute('data-color') }) },
      ...(tag === 'mark' ? [{ tag: 'mark', priority: 40, getAttrs: () => ({ color: 'yellow' }) }] : []),
      { style: styleProp, getAttrs: (v) => (v && !skip.test(v) ? { color: v } : false) },
    ],
    toDOM: (mark) => {
      const c = mark.attrs.color;
      return isKey(c)
        ? [tag, { class: `${cls}-${c}`, 'data-color': c }, 0]
        : [tag, { style: `${styleProp}:${c}`, 'data-color': c }, 0];
    },
  };
}

export const marks = {
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title, rel: 'noopener noreferrer', target: '_blank' }, 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d{2,})$/.test(v) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration-line=line-through' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },
  code: {
    excludes: '_',
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
  sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  textColor: colorMark('span', 'color', 'led-tc', /^(inherit|initial|currentcolor|rgb\(0, 0, 0\)|#000(000)?|black)$/i),
  highlight: colorMark('mark', 'background-color', 'led-hl', /^(inherit|initial|transparent|rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)|#fff(fff)?|white)$/i),
  // Комментарий. excludes: '' — на одном слове может висеть несколько веток.
  comment: {
    attrs: { id: {} },
    excludes: '',
    inclusive: false,
    parseDOM: [{ tag: 'span.led-comment[data-comment]', getAttrs: (dom) => ({ id: dom.getAttribute('data-comment') }) }],
    toDOM: (mark) => ['span', { class: 'led-comment', 'data-comment': mark.attrs.id }, 0],
  },
};

export const schema = new Schema({ nodes, marks });
export { CALLOUT_TONES };

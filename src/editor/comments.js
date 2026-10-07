// Комментарии к тексту.
//
// В тексте — метка comment с id ветки, сама ветка — в контейнере документа
// (container.comments): автор, текст, ответы, «решено». Автор хранится
// id и именем на момент записи — так ветка читается и тогда, когда
// документ откроет другой человек (на будущее совместной работы).
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema.js';
import { h, icon, uid } from './util.js';
import { menu } from './ui.js';

const M = schema.marks;
export const commentsKey = new PluginKey('led-comments');

/** Где в документе висят метки веток: id → [{from, to}]. */
export function commentRanges(doc) {
  const map = new Map();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type !== M.comment) continue;
      const list = map.get(m.attrs.id) || [];
      const last = list[list.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else list.push({ from: pos, to: pos + node.nodeSize });
      map.set(m.attrs.id, list);
    }
  });
  return map;
}

export function commentsPlugin(host) {
  return new Plugin({
    key: commentsKey,
    state: {
      init: () => ({ active: null, rev: 0 }),
      apply(tr, prev) {
        const meta = tr.getMeta(commentsKey);
        return meta ? Object.assign({}, prev, meta, { rev: prev.rev + 1 }) : prev;
      },
    },
    props: {
      decorations(state) {
        const { active } = commentsKey.getState(state);
        const resolved = new Set(host.threads().filter((th) => th.resolved).map((th) => th.id));
        const decos = [];
        for (const [id, ranges] of commentRanges(state.doc)) {
          const cls = id === active ? 'led-comment-active' : resolved.has(id) ? 'led-comment-resolved' : null;
          if (!cls) continue;
          for (const r of ranges) decos.push(Decoration.inline(r.from, r.to, { class: cls }));
        }
        return DecorationSet.create(state.doc, decos);
      },
      handleClick(view, pos) {
        const $p = view.state.doc.resolve(pos);
        const marks = ($p.nodeAfter ? $p.nodeAfter.marks : []).concat($p.nodeBefore ? $p.nodeBefore.marks : []);
        const m = marks.find((x) => x.type === M.comment && !host.isResolved(x.attrs.id));
        if (m) { host.activate(m.attrs.id, false); return false; }
        if (commentsKey.getState(view.state).active) host.activate(null, false);
        return false;
      },
    },
  });
}

function relTime(iso, lang) {
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  try {
    const rtf = new Intl.RelativeTimeFormat(lang || 'ru', { numeric: 'auto' });
    if (sec < 60) return rtf.format(0, 'second');
    if (sec < 3600) return rtf.format(-Math.round(sec / 60), 'minute');
    if (sec < 86400) return rtf.format(-Math.round(sec / 3600), 'hour');
    if (sec < 86400 * 7) return rtf.format(-Math.round(sec / 86400), 'day');
    return d.toLocaleDateString(lang || 'ru', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  } catch {
    return d.toLocaleString();
  }
}

/** Боковая панель веток. Живёт в редакторе, данные берёт у него. */
export class CommentsPanel {
  constructor(ed) {
    this.ed = ed;
    this.t = ed.t;
    this.showResolved = false;
    this.list = h('div', { class: 'led-cm-list' });
    this.count = h('span', { class: 'led-cm-count' });
    this.resolvedBtn = h('button', {
      type: 'button', class: 'led-btn', title: this.t('comments.show_resolved'),
      onclick: () => { this.showResolved = !this.showResolved; this.render(); },
    }, icon('resolve', 16));
    this.dom = h('aside', { class: 'led-side led-comments', hidden: true, 'aria-label': this.t('comments.title') },
      h('div', { class: 'led-side-head' },
        h('span', { class: 'led-side-title' }, this.t('comments.title'), this.count),
        this.resolvedBtn,
        h('button', { type: 'button', class: 'led-btn', title: this.t('common.close'), onclick: () => ed.togglePanel('comments', false) }, icon('x', 16))),
      this.list);
  }

  author() { return this.ed.user(); }

  /** Новая ветка на выделенном тексте. */
  add() {
    const { state } = this.ed.view;
    const { from, to, empty } = state.selection;
    if (empty) { this.ed.toast(this.t('comments.select_text')); return; }
    const id = uid();
    const quote = state.doc.textBetween(from, to, ' ').slice(0, 140);
    this.ed.threads().push({
      id, createdAt: new Date().toISOString(), author: this.author(), text: '', quote, resolved: false, replies: [], draft: true,
    });
    const tr = state.tr.addMark(from, to, M.comment.create({ id }));
    tr.setMeta(commentsKey, { active: id });
    this.ed.view.dispatch(tr);
    this.ed.togglePanel('comments', true);
    this.render();
    const box = this.list.querySelector(`[data-thread="${id}"] textarea`);
    if (box) box.focus();
  }

  removeThread(id) {
    const threads = this.ed.threads();
    const i = threads.findIndex((th) => th.id === id);
    if (i >= 0) threads.splice(i, 1);
    const { state } = this.ed.view;
    const tr = state.tr;
    const ranges = commentRanges(state.doc).get(id) || [];
    for (const r of ranges) tr.removeMark(r.from, r.to, M.comment.create({ id }));
    tr.setMeta(commentsKey, { active: null });
    this.ed.view.dispatch(tr);
    this.ed.changed();
    this.render();
  }

  update(id, patch) {
    const th = this.ed.threads().find((x) => x.id === id);
    if (!th) return;
    Object.assign(th, patch);
    this.ed.changed();
    // Перерисовать подсветку: «решено» гасит отметку в тексте.
    this.ed.view.dispatch(this.ed.view.state.tr.setMeta(commentsKey, {}));
    this.render();
  }

  jump(id) {
    const ranges = commentRanges(this.ed.view.state.doc).get(id);
    if (!ranges || !ranges.length) return;
    const { view } = this.ed;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, ranges[0].from, ranges[0].to));
    tr.setMeta(commentsKey, { active: id });
    view.dispatch(tr.scrollIntoView());
  }

  render() {
    const { view } = this.ed;
    const ranges = commentRanges(view.state.doc);
    const active = commentsKey.getState(view.state).active;
    const threads = this.ed.threads().slice().sort((a, b) => {
      const pa = ranges.get(a.id); const pb = ranges.get(b.id);
      return (pa ? pa[0].from : Infinity) - (pb ? pb[0].from : Infinity);
    });
    const open = threads.filter((th) => !th.resolved);
    this.count.textContent = open.length ? ` · ${open.length}` : '';
    this.resolvedBtn.classList.toggle('on', this.showResolved);
    const shown = threads.filter((th) => this.showResolved || !th.resolved);
    // Недописанные ответы и фокус переживают перерисовку.
    const drafts = new Map();
    let focused = null;
    for (const ta of this.list.querySelectorAll('textarea')) {
      const id = ta.closest('[data-thread]').dataset.thread;
      if (ta.value) drafts.set(id, ta.value);
      if (document.activeElement === ta) focused = { id, start: ta.selectionStart, end: ta.selectionEnd };
    }
    this.list.replaceChildren();
    if (!shown.length) {
      this.list.append(h('div', { class: 'led-cm-empty' }, this.t(threads.length ? 'comments.all_resolved' : 'comments.empty')));
      return;
    }
    for (const th of shown) this.list.append(this.card(th, !ranges.has(th.id), th.id === active));
    for (const [id, v] of drafts) {
      const ta = this.list.querySelector(`[data-thread="${id}"] textarea`);
      if (ta) ta.value = v;
    }
    if (focused) {
      const ta = this.list.querySelector(`[data-thread="${focused.id}"] textarea`);
      if (ta) { ta.focus(); ta.setSelectionRange(focused.start, focused.end); }
    }
  }

  card(th, orphan, active) {
    const me = this.author();
    const lang = this.ed.lang();
    const input = h('textarea', {
      class: 'field led-cm-input', rows: 1,
      placeholder: this.t(th.draft ? 'comments.write' : 'comments.reply'),
      oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        if (e.key === 'Escape') { e.preventDefault(); if (th.draft) this.removeThread(th.id); else this.ed.view.focus(); }
      },
    });
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      if (th.draft) this.update(th.id, { text, draft: false, createdAt: new Date().toISOString() });
      else {
        th.replies.push({ id: uid(), author: me, text, createdAt: new Date().toISOString() });
        this.update(th.id, {});
      }
    };
    const msg = (m, isReply) => h('div', { class: 'led-cm-msg' },
      h('div', { class: 'led-cm-meta' },
        h('span', { class: 'led-cm-avatar' }, (m.author && m.author.name ? m.author.name : '?').slice(0, 1).toUpperCase()),
        h('span', { class: 'led-cm-author' }, (m.author && m.author.name) || this.t('comments.someone')),
        h('span', { class: 'led-cm-time', title: new Date(m.createdAt).toLocaleString() }, relTime(m.createdAt, lang)),
        isReply && m.author && m.author.id === me.id ? h('button', {
          type: 'button', class: 'led-mini', title: this.t('comments.delete_reply'),
          onclick: (e) => { e.stopPropagation(); th.replies = th.replies.filter((r) => r.id !== m.id); this.update(th.id, {}); },
        }, icon('x', 12)) : null),
      h('div', { class: 'led-cm-text' }, m.text));
    const actions = th.draft ? null : h('div', { class: 'led-cm-actions' },
      h('button', {
        type: 'button', class: 'led-btn', title: this.t(th.resolved ? 'comments.reopen' : 'comments.resolve'),
        onclick: (e) => { e.stopPropagation(); this.update(th.id, th.resolved ? { resolved: false } : { resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: me }); },
      }, icon(th.resolved ? 'reopen' : 'check', 16)),
      h('button', {
        type: 'button', class: 'led-btn', title: this.t('more'),
        onclick: (e) => {
          e.stopPropagation();
          menu(this.ed.root, e.currentTarget, [
            { label: this.t('comments.copy_quote'), icon: 'copy', run: () => { try { navigator.clipboard.writeText(th.quote || ''); } catch { /* нет буфера */ } } },
            { label: this.t('comments.delete'), icon: 'trash', danger: true, run: () => this.removeThread(th.id) },
          ]);
        },
      }, icon('more', 16)));
    const card = h('div', {
      class: `led-cm-card${active ? ' active' : ''}${th.resolved ? ' resolved' : ''}${orphan ? ' orphan' : ''}`,
      dataset: { thread: th.id },
      onclick: (e) => { if (e.target.closest('textarea, button')) return; this.jump(th.id); },
    },
    h('div', { class: 'led-cm-top' },
      h('div', { class: 'led-cm-quote' }, orphan ? this.t('comments.orphan') : (th.quote || '')),
      actions),
    th.draft ? null : msg(th, false),
    ...(th.replies || []).map((r) => msg(r, true)),
    th.resolved ? h('div', { class: 'led-cm-resolved' }, this.t('comments.resolved_by', { name: (th.resolvedBy && th.resolvedBy.name) || '' })) : null,
    th.resolved ? null : h('div', { class: 'led-cm-reply' }, input,
      h('button', { type: 'button', class: 'led-btn led-cm-send', title: this.t('comments.send'), onclick: (e) => { e.stopPropagation(); send(); } }, icon('reply', 16))),
    th.draft ? h('button', { type: 'button', class: 'btn-soft led-cm-cancel', onclick: () => this.removeThread(th.id) }, this.t('common.cancel')) : null);
    return card;
  }
}

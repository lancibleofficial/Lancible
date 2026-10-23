// Блог: посты лендинга из базы (blog_posts). Список и редактор поста: дата,
// тег, версия, заголовок и абзацы на ru и en, предпросмотр, опубликовать или
// снять. Лендинг читает опубликованные сразу — выкладывать ничего не нужно.
import { call, rowsOf, errorText } from '../api.js';
import { h, page, island, segmented, loadInto, emptyState, field, confirmDialog, toast, fmtDate } from '../ui.js';

const TAGS = [
  { value: 'release', label: 'Релиз' },
  { value: 'feature', label: 'Новое' },
  { value: 'improvement', label: 'Улучшение' },
];
const TAG = Object.fromEntries(TAGS.map((t) => [t.value, t.label]));
const LANGS = [{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }];

let cache = [];

const today = () => new Date().toISOString().slice(0, 10);
const titleOf = (p, lang = 'ru') => (p.title && (p.title[lang] || p.title.ru || p.title.en)) || '(без заголовка)';

/** Абзацы из поля: пустая строка — граница абзаца. */
export const toParagraphs = (text) => String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const fromParagraphs = (list) => (Array.isArray(list) ? list.join('\n\n') : '');

function mountList(root) {
  const create = h('a', { class: 'btn-accent', href: '#/blog/new', id: 'post-new' }, 'Новый пост');
  const { body, actions } = page(root, 'Блог', [create]);
  loadInto(body, () => call('posts.list'), (res) => {
    cache = rowsOf(res, 'posts');
    if (!cache.length) {
      // Место по центру — кнопка шапки прячется (как в вебе).
      actions.hidden = true;
      body.replaceChildren(emptyState({ art: 'docs', title: 'Постов пока нет', text: 'Пост появится на лендинге, как только его опубликуют.', action: h('a', { class: 'btn-accent', href: '#/blog/new' }, 'Новый пост') }));
      return;
    }
    actions.hidden = false;
    const rows = cache.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    body.replaceChildren(h('section', { class: 'island table-island' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl', id: 'posts-table' },
      h('thead', null, h('tr', null, ['Дата', 'Тег', 'Версия', 'Заголовок', 'Статус'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, rows.map((p) => h('tr', { class: 'row-link', dataset: { id: p.id }, on: { click: (e) => { if (!e.target.closest('a')) location.hash = `#/blog/${encodeURIComponent(p.id)}`; } } },
        h('td', { class: 'nowrap', text: fmtDate(p.date) }),
        h('td', null, h('span', { class: 'chip', text: TAG[p.tag] || p.tag || '—' })),
        h('td', { class: 'nowrap muted', text: p.version || '—' }),
        h('td', { class: 'cell-main' }, h('a', { class: 'cell-title', href: `#/blog/${encodeURIComponent(p.id)}`, text: titleOf(p) })),
        h('td', null, h('span', { class: p.published ? 'chip ok' : 'chip', text: p.published ? 'Опубликован' : 'Черновик' })))))))));
  });
}

function preview(post, lang) {
  return h('article', { class: 'post-preview', lang },
    h('div', { class: 'post-meta' },
      h('span', { class: 'chip', text: lang === 'en' ? ({ release: 'Release', feature: 'New', improvement: 'Improved' }[post.tag] || '') : TAG[post.tag] || '' }),
      h('span', { class: 'muted', text: post.date ? fmtDate(post.date) : '' }),
      post.version ? h('span', { class: 'muted', text: post.version }) : null),
    h('h3', { class: 'post-title', text: post.title[lang] || (lang === 'en' ? 'Title' : 'Заголовок') }),
    (post.body[lang] || []).length
      ? post.body[lang].map((p) => h('p', { class: 'post-p', text: p }))
      : h('p', { class: 'muted', text: lang === 'en' ? 'No paragraphs yet.' : 'Абзацев пока нет.' }));
}

function editor(root, body, head, src) {
  const isNew = !src.id;
  const post = {
    id: src.id || null,
    date: src.date || today(),
    tag: src.tag || 'release',
    version: src.version || '',
    title: { ru: (src.title && src.title.ru) || '', en: (src.title && src.title.en) || '' },
    body: { ru: (src.body && src.body.ru) || [], en: (src.body && src.body.en) || [] },
    published: !!src.published,
  };
  let lang = 'ru';
  head.querySelector('.page-title').textContent = isNew ? 'Новый пост' : 'Пост';

  const date = h('input', { class: 'field', type: 'date', id: 'post-date', value: post.date, required: true });
  const tag = segmented(TAGS, post.tag, (v) => { post.tag = v; paintPreview(); }, 'Тег');
  tag.id = 'post-tag';
  const version = h('input', { class: 'field', type: 'text', id: 'post-version', value: post.version, placeholder: '0.5.2 · mobile 1.3.2', maxlength: '60' });
  const fields = {};
  for (const l of ['ru', 'en']) {
    fields[l] = {
      title: h('input', { class: 'field', type: 'text', id: `post-title-${l}`, value: post.title[l], maxlength: '200', lang: l }),
      body: h('textarea', { class: 'field post-body', id: `post-body-${l}`, rows: '12', lang: l, value: fromParagraphs(post.body[l]) }),
    };
  }
  const langBox = {};
  for (const l of ['ru', 'en']) {
    langBox[l] = h('div', { class: 'lang-fields', dataset: { lang: l }, hidden: l !== lang },
      field(l === 'ru' ? 'Заголовок' : 'Title', fields[l].title, l === 'ru' ? 'Одна строка, без точки в конце.' : 'One line, no full stop.'),
      field(l === 'ru' ? 'Абзацы' : 'Paragraphs', fields[l].body, l === 'ru' ? 'Пустая строка — новый абзац.' : 'A blank line starts a new paragraph.'));
  }
  const langSwitch = segmented(LANGS, lang, (v) => { lang = v; for (const l of ['ru', 'en']) langBox[l].hidden = l !== lang; paintPreview(); }, 'Язык');
  langSwitch.id = 'post-lang';

  const prevBox = h('div', { class: 'preview-box', id: 'post-preview' });
  const read = () => {
    post.date = date.value;
    post.version = version.value.trim();
    for (const l of ['ru', 'en']) {
      post.title[l] = fields[l].title.value.trim();
      post.body[l] = toParagraphs(fields[l].body.value);
    }
  };
  const paintPreview = () => { read(); prevBox.replaceChildren(preview(post, lang)); };
  for (const el of [date, version, fields.ru.title, fields.ru.body, fields.en.title, fields.en.body]) el.addEventListener('input', paintPreview);

  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const status = h('span', { class: post.published ? 'chip ok' : 'chip', id: 'post-status' });
  const paintStatus = () => { status.className = post.published ? 'chip ok' : 'chip'; status.textContent = post.published ? 'Опубликован' : 'Черновик'; };
  const save = h('button', { type: 'button', class: 'btn-accent', id: 'post-save' }, 'Сохранить');
  const publish = h('button', { type: 'button', class: 'btn-soft', id: 'post-publish' });
  const paintPublish = () => { publish.textContent = post.published ? 'Снять с публикации' : 'Опубликовать'; };
  const del = isNew ? null : h('button', { type: 'button', class: 'btn-danger', id: 'post-delete' }, 'Удалить');

  /** Те же правила, что у функции (postFields): дата, обе версии — заголовок
   *  и хотя бы один абзац, и у черновика тоже. Лендинг показывает
   *  английскую версию украинскому и казахскому посетителю. */
  function check() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) return 'Укажите дату.';
    for (const l of ['ru', 'en']) {
      if (!post.title[l] || !post.body[l].length) return `Заполните обе версии — заголовок и абзацы: не хватает ${l === 'ru' ? 'русской' : 'английской'}.`;
    }
    return '';
  }

  async function persist(published) {
    read();
    const next = { ...post, published };
    const problem = check();
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;
    save.disabled = true; publish.disabled = true;
    try {
      const payload = { date: next.date, tag: next.tag, version: next.version || null, title: { ...next.title }, body: { ru: [...next.body.ru], en: [...next.body.en] }, published };
      if (post.id) payload.id = post.id;
      const res = await call('posts.save', { post: payload });
      const saved = res.post || { ...payload, id: res.id || post.id };
      post.id = saved.id || post.id;
      post.published = !!saved.published;
      cache = cache.filter((p) => p.id !== post.id).concat([{ ...payload, ...saved }]);
      paintStatus(); paintPublish();
      const was = !!src.published;
      toast(post.published && !was ? 'Пост опубликован' : !post.published && was ? 'Пост снят с публикации' : 'Пост сохранён');
      src.published = post.published;
      if (isNew && post.id) history.replaceState(null, '', `#/blog/${encodeURIComponent(post.id)}`);
    } catch (e) {
      err.textContent = errorText(e); err.hidden = false;
    } finally {
      save.disabled = false; publish.disabled = false;
    }
  }

  save.addEventListener('click', () => persist(post.published));
  publish.addEventListener('click', () => persist(!post.published));
  if (del) del.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Удалить пост?', text: 'Пост пропадёт из базы и с лендинга. Вернуть его будет нельзя.', ok: 'Удалить', danger: true });
    if (!ok) return;
    try {
      await call('posts.delete', { id: post.id });
      cache = cache.filter((p) => p.id !== post.id);
      toast('Пост удалён');
      location.hash = '#/blog';
    } catch (e) { err.textContent = errorText(e); err.hidden = false; }
  });

  paintStatus(); paintPublish(); paintPreview();

  const form = island(null, null,
    h('div', { class: 'form-grid form-grid-3' },
      field('Дата', date),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: 'Тег' }), tag),
      field('Версия', version, 'Необязательно.')),
    h('div', { class: 'lang-head' }, langSwitch),
    langBox.ru, langBox.en,
    err,
    h('div', { class: 'form-actions' }, del, h('span', { class: 'spacer' }), status, publish, save));
  form.id = 'post-form';
  body.replaceChildren(h('div', { class: 'grid-2 editor-grid' }, form, island('Предпросмотр', 'так пост встанет в ленту', prevBox)));
}

function mountEditor(root, id) {
  const back = h('a', { class: 'btn-soft', href: '#/blog' }, '← Все посты');
  const { body, head } = page(root, id === 'new' ? 'Новый пост' : 'Пост', [back]);
  if (id === 'new') { editor(root, body, head, {}); return; }
  const hit = cache.find((p) => String(p.id) === id);
  if (hit) { editor(root, body, head, { ...hit }); return; }
  loadInto(body, () => call('posts.list'), (res) => {
    cache = rowsOf(res, 'posts');
    const p = cache.find((x) => String(x.id) === id);
    if (!p) { body.replaceChildren(emptyState({ art: 'docs', title: 'Такого поста нет', text: 'Возможно, его уже удалили.', action: h('a', { class: 'btn-soft', href: '#/blog' }, 'Все посты') })); return; }
    editor(root, body, head, { ...p });
  });
}

export function mount(root, rest) {
  if (rest[0]) mountEditor(root, rest[0]);
  else mountList(root);
}

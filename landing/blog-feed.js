/* Откуда лента блога берёт записи (23 октября 2026).
 *
 * Основной источник — таблица blog_posts в Supabase: посты пишет и
 * публикует админ-панель, и они видны сразу, без деплоя. Читается публичным
 * ключом anon прямо через PostgREST: клиентская
 * библиотека не нужна, а anon видит только опубликованные записи (правила —
 * supabase/admin.sql).
 *
 * Запасной путь — window.LANCIBLE_POSTS из blog-posts.js. С него лента
 * рисуется сразу, ещё до ответа базы, поэтому пустой она не бывает ни на
 * миг: нет сети, нет таблицы, база молчит дольше FETCH_MS или в ней пока
 * ничего не опубликовано — так и остаётся лента из файла. Ответ базы
 * приходит — лента перерисовывается его записями.
 *
 * Поля записи одинаковые в базе и в файле: date 'ГГГГ-ММ-ДД', tag,
 * version (может не быть), title { ru, en }, body { ru: [абзацы], en: [абзацы] }.
 * Порядок — по дате, свежие сверху. Записи одного дня стоят так же, как в
 * файле (ключ — дата и русский заголовок, тот же, что у сида
 * supabase/blog-posts-seed.sql): от порядка зависят якоря второй и
 * следующих записей дня (#p-2026-10-10-2), и ссылки на них не должны
 * поменять смысл с переездом ленты в базу. Новые записи того же дня — выше
 * прежних, между собой — по времени заведения.
 *
 * Читают blog.html (вся лента) и index.html (три свежие).
 */
(function (global) {
  const SUPABASE_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
  /** Дольше ждать базу незачем: лента из файла уже на экране. */
  const FETCH_MS = 6000;
  const TAGS = ['release', 'feature', 'improvement'];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const FILE = Array.isArray(global.LANCIBLE_POSTS) ? global.LANCIBLE_POSTS.filter((p) => p && DATE.test(p.date)) : [];

  const tagOf = (post) => (TAGS.includes(post.tag) ? post.tag : 'improvement');
  const keyOf = (post) => `${post.date}|${(post.title && post.title.ru) || ''}`;
  const fileIndex = new Map();
  FILE.forEach((post, i) => { if (!fileIndex.has(keyOf(post))) fileIndex.set(keyOf(post), i); });

  /** Свежие сверху; один день — порядком файла, новые того дня — выше. */
  function order(posts) {
    return posts.map((post, i) => ({ post, i })).sort((a, b) => {
      if (a.post.date !== b.post.date) return a.post.date < b.post.date ? 1 : -1;
      const fa = fileIndex.get(keyOf(a.post));
      const fb = fileIndex.get(keyOf(b.post));
      if (fa !== undefined && fb !== undefined) return fa - fb;
      if (fa !== undefined || fb !== undefined) return fa !== undefined ? 1 : -1;
      const ca = a.post.createdAt || '';
      const cb = b.post.createdAt || '';
      if (ca !== cb) return ca < cb ? 1 : -1;
      return a.i - b.i;
    }).map((x) => x.post);
  }

  /** Строка базы → запись ленты; кривую (нет даты или заголовка) — мимо. */
  function fromRow(row) {
    if (!row || typeof row !== 'object' || !DATE.test(String(row.date || ''))) return null;
    const title = row.title && typeof row.title === 'object' ? row.title : null;
    if (!title || !(title.ru || title.en)) return null;
    return {
      date: row.date,
      tag: row.tag,
      version: row.version || undefined,
      title,
      body: row.body && typeof row.body === 'object' ? row.body : {},
      createdAt: row.created_at || '',
    };
  }

  /** Опубликованные записи из базы или null — тогда остаётся файл. */
  async function fetchPosts() {
    if (typeof fetch !== 'function') return null;
    const params = new URLSearchParams({
      select: 'date,tag,version,title,body,created_at',
      published: 'eq.true',
      order: 'date.desc,created_at.desc',
    });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_MS) : 0;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?${params}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows)) return null;
      const posts = rows.map(fromRow).filter(Boolean);
      // Пусто — таблицу завели, а записи ещё не перенесли: лента из файла
      // лучше пустой.
      return posts.length ? posts : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Запрос — сразу, ещё до разметки: к DOMContentLoaded ответ, бывает, уже
  // пришёл.
  const fromBase = fetchPosts();

  /** Якорь записи — её дата; второй и следующим того же дня — с номером:
   *  иначе одинаковые id, и ссылка вела бы всегда на первую. */
  function anchors(posts) {
    const used = new Map();
    const out = new Map();
    for (const post of posts) {
      const base = `p-${post.date || 'post'}`;
      const seen = (used.get(base) || 0) + 1;
      used.set(base, seen);
      out.set(post, seen === 1 ? base : `${base}-${seen}`);
    }
    return out;
  }

  /** onPosts(posts, source): сразу — записями файла ('file'), потом, если
   *  база ответила записями, — ими ('base'). */
  function load(onPosts) {
    onPosts(order(FILE), 'file');
    fromBase.then((posts) => { if (posts) onPosts(order(posts), 'base'); });
  }

  global.LancibleBlog = { TAGS, tagOf, anchors, load };
})(typeof window !== 'undefined' ? window : globalThis);

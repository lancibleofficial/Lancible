#!/usr/bin/env node
/* Посты лендинга → SQL для таблицы blog_posts (supabase/admin.sql).
 *
 *   node scripts/blog-to-sql.js          — переписать supabase/blog-posts-seed.sql
 *   node scripts/blog-to-sql.js --check  — сверить файл с landing/blog-posts.js
 *                                          (выход 1, если отстал)
 *
 * С 23 октября 2026 посты лендинга живут в базе и правятся в админке; прежние
 * переносятся отсюда одним SQL. Повторный запуск SQL копий не плодит: id
 * поста — UUID версии 3 от «дата + заголовок ru» (ключ из контракта), вставка
 * — on conflict (id) do update. Значит, повтор возвращает перенесённые посты к
 * тексту файла, а посты, заведённые в админке, не трогает. Все переносятся
 * опубликованными. Порядок ленты — date, затем created_at по убыванию:
 * created_at ставится так, чтобы посты одного дня шли, как в файле.
 *
 * Тест — tests/unit/supabase-sql.test.js (файл не отстал от blog-posts.js).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'landing', 'blog-posts.js');
const OUT = path.join(ROOT, 'supabase', 'blog-posts-seed.sql');
const TAGS = new Set(['release', 'feature', 'improvement']);

/** Посты из landing/blog-posts.js — тем же массивом, что читает лендинг. */
function readPosts(file = SRC) {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, { filename: file });
  const posts = box.window.LANCIBLE_POSTS;
  if (!Array.isArray(posts)) throw new Error(`${file}: нет window.LANCIBLE_POSTS`);
  // Через JSON — в массивы и объекты своего контекста (vm даёт чужие) и
  // только данные.
  return JSON.parse(JSON.stringify(posts));
}

/** UUID версии 3 (md5) от даты и заголовка ru — ключ поста при переносе. */
function postId(post) {
  const b = crypto.createHash('md5').update(`lancible-blog\n${post.date}\n${post.title.ru}`, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const jsonLit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

/** Проверка поста — те же правила, что у таблицы и у posts.save. */
function checkPost(p, i) {
  const at = `пост ${i} (${p && p.date})`;
  if (!p || typeof p !== 'object') throw new Error(`${at}: не объект`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || Number.isNaN(Date.parse(`${p.date}T00:00:00Z`))) throw new Error(`${at}: date`);
  if (!TAGS.has(p.tag)) throw new Error(`${at}: tag`);
  if (p.version != null && (typeof p.version !== 'string' || !p.version.trim() || p.version.length > 60)) throw new Error(`${at}: version`);
  for (const lang of ['ru', 'en']) {
    if (!p.title || typeof p.title[lang] !== 'string' || !p.title[lang].trim()) throw new Error(`${at}: title.${lang}`);
    if (!p.body || !Array.isArray(p.body[lang]) || !p.body[lang].every((x) => typeof x === 'string')) throw new Error(`${at}: body.${lang}`);
  }
}

/** Текст SQL для набора постов. */
function buildSeed(posts) {
  posts.forEach(checkPost);
  const ids = new Set();
  // Посты одного дня — по порядку файла: первый в файле получает самый
  // поздний created_at (полдень UTC минус номер в пределах дня).
  const seenInDay = new Map();
  const rows = posts.map((p) => {
    const id = postId(p);
    if (ids.has(id)) throw new Error(`два поста с одной датой и заголовком: ${p.date} «${p.title.ru}»`);
    ids.add(id);
    const n = seenInDay.get(p.date) || 0;
    seenInDay.set(p.date, n + 1);
    const created = new Date(Date.parse(`${p.date}T12:00:00Z`) - n * 1000).toISOString();
    const title = { ru: p.title.ru, en: p.title.en };
    const body = { ru: p.body.ru, en: p.body.en };
    return `  (${lit(id)}, ${lit(p.date)}, ${lit(p.tag)}, ${p.version ? lit(p.version) : 'null'},\n   ${jsonLit(title)},\n   ${jsonLit(body)},\n   true, ${lit(created)})`;
  });
  return [
    '-- Lancible — посты лендинга в таблицу blog_posts (supabase/admin.sql).',
    '-- СГЕНЕРИРОВАН: node scripts/blog-to-sql.js из landing/blog-posts.js — руками',
    '-- не править. Выполнить после admin.sql: SQL Editor → New query → вставить',
    '-- целиком → Run. Повторный запуск копий не плодит: id поста — UUID от даты и',
    '-- заголовка ru, вставка — on conflict (id) do update (перенесённые посты',
    '-- возвращаются к тексту файла; заведённые в админке не трогаются).',
    `-- Постов: ${rows.length}, все опубликованы.`,
    '',
    'insert into public.blog_posts (id, date, tag, version, title, body, published, created_at)',
    'values',
    `${rows.join(',\n')}`,
    'on conflict (id) do update set',
    '  date = excluded.date,',
    '  tag = excluded.tag,',
    '  version = excluded.version,',
    '  title = excluded.title,',
    '  body = excluded.body,',
    '  published = excluded.published,',
    '  created_at = excluded.created_at;',
    '',
    '-- Проверка: столько же опубликованных постов, сколько в landing/blog-posts.js.',
    `select count(*) as published_posts from public.blog_posts where published and id in (${[...ids].map(lit).join(', ')});`,
    '',
  ].join('\n');
}

module.exports = { readPosts, buildSeed, postId, OUT };

if (require.main === module) {
  const sql = buildSeed(readPosts());
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (now !== sql) {
      console.error('supabase/blog-posts-seed.sql отстал от landing/blog-posts.js — node scripts/blog-to-sql.js');
      process.exit(1);
    }
    console.log('supabase/blog-posts-seed.sql — свежий');
  } else {
    fs.writeFileSync(OUT, sql);
    console.log(`supabase/blog-posts-seed.sql: ${readPosts().length} постов`);
  }
}

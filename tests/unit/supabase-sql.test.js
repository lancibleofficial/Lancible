// SQL для Supabase, который выполняется руками в SQL Editor, и выполняется
// повторно. Запуск: node --test tests/unit/supabase-sql.test.js
//
// Базы в юнитах нет — сверяется сам текст файлов: то, что повторный запуск
// одного файла не откатывает другой и что уже созданная таблица чинится тем же
// файлом. Права доступа на живой базе — tests/backend/*-rls.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = path.join(__dirname, '..', '..', 'supabase');
const read = (f) => fs.readFileSync(path.join(SQL, f), 'utf8').replace(/\r\n/g, '\n');
const typesIn = (s) => [...s.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]);

/** Корзина doc-assets в storage.sql: предел, типы и on conflict. */
function storageBucket() {
  const sql = read('storage.sql');
  const m = sql.match(/insert into storage\.buckets[\s\S]*?values \('doc-assets'[^,]*,[^,]*,\s*\w+,\s*(\d+),\s*array\[([^\]]*)\]\)\s*on conflict \(id\) do (update[\s\S]*?;|nothing;)/i);
  assert.ok(m, 'storage.sql: не нашлась вставка корзины doc-assets — поправить разбор в тесте');
  return { limit: Number(m[1]), types: typesIn(m[2]), onConflict: m[3] };
}

/** Что делает с корзиной storage-pdf.sql: предел и добавленные типы. */
function pdfBucket() {
  const sql = read('storage-pdf.sql');
  const m = sql.match(/update storage\.buckets\s+set file_size_limit = (\d+),\s*allowed_mime_types = ([\s\S]*?)\n\s*where id = 'doc-assets'/i);
  assert.ok(m, 'storage-pdf.sql: не нашёлся update корзины doc-assets — поправить разбор в тесте');
  return { limit: Number(m[1]), types: typesIn(m[2]) };
}

test('storage.sql не сужает корзину doc-assets после storage-pdf.sql — ни сразу, ни при повторном запуске', () => {
  // 19 октября 2026: storage.sql сам себя называет повторяемым, а его
  // on conflict переписывал корзину на «картинки до 15 МБ» — PDF из
  // редактора молча переставали уходить в облако.
  const base = storageBucket();
  const pdf = pdfBucket();
  assert.ok(pdf.types.includes('application/pdf'));
  assert.ok(base.limit >= pdf.limit, `storage.sql ставит ${base.limit} байт — меньше, чем storage-pdf.sql (${pdf.limit})`);
  for (const type of pdf.types) assert.ok(base.types.includes(type), `storage.sql не знает тип ${type} из storage-pdf.sql`);
  if (/^nothing/i.test(base.onConflict)) return;
  // do update — только расширяя: больший предел, объединение типов, null
  // («без ограничений») остаётся null.
  assert.doesNotMatch(base.onConflict, /file_size_limit\s*=\s*excluded\.file_size_limit/i, 'предел при повторе — не просто «как в файле»');
  assert.doesNotMatch(base.onConflict, /allowed_mime_types\s*=\s*excluded\.allowed_mime_types/i, 'типы при повторе — не просто «как в файле»');
  assert.match(base.onConflict, /greatest\(\s*b\.file_size_limit,\s*excluded\.file_size_limit\s*\)/i);
  assert.match(base.onConflict, /when b\.file_size_limit is null then null/i);
  assert.match(base.onConflict, /unnest\(\s*b\.allowed_mime_types \|\| excluded\.allowed_mime_types\s*\)/i);
  assert.match(base.onConflict, /when b\.allowed_mime_types is null then null/i);
});

test('feedback.sql: обращения вошедшего удаляются с аккаунтом, и уже созданная таблица чинится повторным запуском', () => {
  // Решение 1 волны 19 октября 2026: внешний ключ — on delete cascade.
  // create table if not exists старую таблицу (с on delete set null) не
  // трогает — ключ пересоздаётся отдельно, под тем же именем.
  const sql = read('feedback.sql');
  assert.doesNotMatch(sql, /on delete set null/i, 'set null — строки переживали бы удаление аккаунта');
  assert.match(sql, /user_id uuid references auth\.users\(id\) on delete cascade/i);
  const drop = sql.search(/alter table feedback drop constraint if exists feedback_user_id_fkey;/i);
  const add = sql.search(/alter table feedback add constraint feedback_user_id_fkey\s+foreign key \(user_id\) references auth\.users\(id\) on delete cascade;/i);
  assert.ok(drop > 0 && add > drop, 'ключ пересоздаётся: сначала drop if exists, потом add с cascade');
  assert.ok(drop > sql.search(/create table if not exists feedback/i), 'и после create table');
  // Снимки каскадом не уходят — их стирает функция удаления аккаунта, по
  // колонке, которая так и называется.
  assert.match(sql, /screenshot_path text/);
  const fn = fs.readFileSync(path.join(SQL, 'functions', 'delete-account', 'index.ts'), 'utf8');
  assert.match(fn, /\.from\('feedback'\)\s*\.select\('screenshot_path'\)/);
  assert.match(fn, /const FEEDBACK_BUCKET = 'feedback';/);
});

test('feedback.sql: частота строк — триггер с пределами 5 за 10 минут и 20 за сутки с аккаунта, 30 в час на всех гостей', () => {
  // Решение 19 октября 2026 («разумное ограничение»): до этого anon вставлял
  // строки без предела, и каждая уходила вебхуком в Telegram.
  const sql = read('feedback.sql');
  const m = sql.match(/create or replace function public\.feedback_rate_guard\(\)\s+returns trigger([\s\S]*?)\n\$\$;/i);
  assert.ok(m, 'нет функции public.feedback_rate_guard() — триггерной');
  const fn = m[1];
  assert.match(fn, /security definer/i, 'считать чужие строки вставляющему нельзя — функция security definer');
  assert.match(fn, /set search_path = ''/i);
  // Время ставит база: created_at из прошлого обходил бы окна подсчёта.
  assert.match(fn, /new\.created_at := now\(\);/i);
  // Вошедший: 5 за 10 минут и 20 за сутки — по своему user_id.
  assert.match(fn, /if new\.user_id is not null then/i);
  assert.match(fn, /f\.user_id = new\.user_id/i);
  assert.match(fn, /interval '10 minutes'/i);
  assert.match(fn, /interval '1 day'/i);
  assert.match(fn, /recent >= 5 or daily >= 20/i);
  // Гости — общий предел: все строки без user_id за час.
  assert.match(fn, /f\.user_id is null and f\.created_at > now\(\) - interval '1 hour'/i);
  assert.match(fn, /recent >= 30/i);
  // Отказ клиенты узнают по коду и тексту.
  const raises = [...fn.matchAll(/raise exception '([^']+)'\s+using errcode = '([^']+)'/gi)];
  assert.equal(raises.length, 2, 'два отказа: аккаунт и гости');
  for (const [, msg, code] of raises) assert.deepEqual([msg, code], ['feedback rate', 'P0001']);
  // Триггер — before insert, на каждую строку; повторный запуск пересоздаёт.
  assert.match(sql, /drop trigger if exists feedback_rate on feedback;\s*create trigger feedback_rate\s+before insert on feedback\s+for each row execute function public\.feedback_rate_guard\(\);/i);
});

test('feedback.sql: бакет принимает только снимок, названный в строке не старше 15 минут; путь — <uuid>.<png|jpg|webp>', () => {
  const sql = read('feedback.sql');
  const m = sql.match(/create or replace function public\.feedback_shot_expected\(object_name text\)\s+returns boolean([\s\S]*?)\n\$\$;/i);
  assert.ok(m, 'нет функции public.feedback_shot_expected(object_name text)');
  const fn = m[1];
  assert.match(fn, /security definer/i, 'гость таблицу не читает — проверка security definer');
  assert.match(fn, /set search_path = ''/i);
  assert.match(fn, /from public\.feedback f/i);
  assert.match(fn, /f\.screenshot_path = object_name/i);
  assert.match(fn, /f\.created_at > now\(\) - interval '15 minutes'/i);
  assert.match(sql, /grant execute on function public\.feedback_shot_expected\(text\) to anon, authenticated;/i);
  // Политика вставки в бакет — через функцию, а не «любой файл в бакет».
  const policy = sql.match(/create policy "feedback upload" on storage\.objects\s+for insert with check \(([^;]*)\);/i);
  assert.ok(policy, 'нет политики "feedback upload"');
  assert.equal(policy[1].replace(/\s+/g, ' ').trim(), "bucket_id = 'feedback' and public.feedback_shot_expected(name)");
  assert.ok(sql.indexOf('drop policy if exists "feedback upload" on storage.objects;') >= 0, 'повторный запуск пересоздаёт политику');
  // Формат пути — check таблицы; старое ограничение (только длина) пересоздаётся под тем же именем.
  const drop = sql.search(/alter table feedback drop constraint if exists feedback_screenshot_path_check;/i);
  const add = sql.search(/alter table feedback add constraint feedback_screenshot_path_check\s+check \(screenshot_path is null or screenshot_path ~ '\^\[0-9a-f-\]\{36\}\\.\(png\|jpg\|webp\)\$'\)/i);
  assert.ok(drop > 0 && add > drop, 'check формата пути: drop if exists, потом add');
  // Регулярка в check та же, что пишут клиенты: <uuid>.<ext>.
  const re = new RegExp(sql.match(/screenshot_path ~ '([^']+)'/)[1]);
  assert.ok(re.test('0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21.png'));
  assert.ok(re.test('0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21.webp'));
  for (const bad of ['../x.png', 'a/0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21.png', '0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21.gif', '0B7C2A8E-3F1D-4C5A-9E2B-7D6F5A4C3B21.png']) {
    assert.ok(!re.test(bad), `${bad} не должен проходить`);
  }
  // Файл по-прежнему выполняется повторно.
  assert.doesNotMatch(sql, /^\s*create function/im, 'функции — create or replace');
  for (const [, name] of sql.matchAll(/^\s*create trigger (\w+)/gim)) {
    assert.ok(sql.includes(`drop trigger if exists ${name} on feedback;`), `триггер ${name} пересоздаётся: drop trigger if exists`);
  }
});

// --- feedback-bot.sql: отзывы в Telegram и уборка (19 октября 2026) ------------
//
// Решение пользователя: функция feedback-notify шлёт отзывы в Telegram сама,
// а строки и снимки старше 12 месяцев стираются по расписанию. Файл лежит в
// открытом репозитории и выполняется повторно — поэтому сверяется: колонка
// захвата, триггер через pg_net на нужный адрес, в заголовках — только ключ
// anon клиентов, задание уборки одно при любом числе запусков.

const FN_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co/functions/v1/feedback-notify';

test('feedback-bot.sql: колонка notified_at, триггер после вставки зовёт feedback-notify через net.http_post с одним id', () => {
  const sql = read('feedback-bot.sql');
  assert.match(sql, /alter table public\.feedback add column if not exists notified_at timestamptz;/i);
  assert.match(sql, /create extension if not exists pg_net with schema extensions;/i);
  assert.match(sql, /create extension if not exists pg_cron with schema pg_catalog;/i);

  const call = sql.match(/create or replace function public\.feedback_bot_call\(payload jsonb\)\s+returns bigint([\s\S]*?)\n\$\$;/i);
  assert.ok(call, 'нет public.feedback_bot_call(payload jsonb)');
  assert.match(call[1], /security definer\s+set search_path = ''/i);
  assert.match(call[1], /net\.http_post\(/i, 'вызов — через pg_net');
  assert.ok(call[1].includes(`url := '${FN_URL}'`), `адрес функции — ${FN_URL}`);
  assert.match(call[1], /body := payload/);
  assert.match(sql, /revoke all on function public\.feedback_bot_call\(jsonb\) from anon, authenticated;/i, 'клиенты звать pg_net через неё не могут');

  const trg = sql.match(/create or replace function public\.feedback_notify\(\)\s+returns trigger([\s\S]*?)\n\$\$;/i);
  assert.ok(trg, 'нет триггерной public.feedback_notify()');
  assert.match(trg[1], /perform public\.feedback_bot_call\(jsonb_build_object\('id', new\.id\)\);/, 'в запрос уходит только id строки');
  assert.doesNotMatch(trg[1], /to_jsonb\(new\)|new\.text|new\.device/i, 'строка целиком в запрос не идёт');
  assert.match(trg[1], /exception when others then/i, 'сбой pg_net не роняет вставку отзыва');
  assert.match(sql, /drop trigger if exists feedback_notify on public\.feedback;\s*create trigger feedback_notify\s+after insert on public\.feedback\s+for each row execute function public\.feedback_notify\(\);/i);
  assert.doesNotMatch(sql, /^\s*create function/im, 'функции — create or replace');

  // Функция понимает ровно то, что шлёт база.
  const fn = fs.readFileSync(path.join(SQL, 'functions', 'feedback-notify', 'index.ts'), 'utf8');
  assert.match(fn, /b\.action === 'sweep'/);
  assert.match(fn, /\.is\('notified_at', null\)/, 'захват — только неотправленной строки');
});

test('feedback-bot.sql: в заголовках — ключ anon клиентов, служебного ключа в тексте нет', () => {
  const sql = read('feedback-bot.sql');
  assert.doesNotMatch(sql, /service_role/i, 'служебный ключ в SQL не кладётся — даже словом');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const anon = app.match(/const SUPABASE_ANON_KEY = '([^']+)'/)[1];
  const jwts = [...sql.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].map((m) => m[0]);
  assert.ok(jwts.length >= 2, 'ключ — в apikey и Authorization');
  for (const jwt of jwts) {
    assert.equal(jwt, anon, 'в SQL — ровно ключ anon из клиентов');
    assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role, 'anon');
  }
  assert.ok(sql.includes(`'Authorization', 'Bearer ${anon}'`), 'Authorization: Bearer <anon> — для «Verify JWT»');
  assert.ok(sql.includes(`'apikey', '${anon}'`));
});

test('feedback-bot.sql: уборка — одно задание pg_cron с sweep, повторный запуск снимает прежнее по имени', () => {
  const sql = read('feedback-bot.sql');
  const schedules = [...sql.matchAll(/select cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*\$cron\$([\s\S]*?)\$cron\$\s*\);/gi)];
  assert.equal(schedules.length, 1, 'одно задание');
  const [, name, cron, command] = schedules[0];
  assert.equal(name, 'feedback-sweep');
  assert.match(cron, /^\d+ \d+ \* \* \*$/, 'раз в сутки');
  assert.match(command, /public\.feedback_bot_call\('\{"action": "sweep"\}'::jsonb\)/);
  const unschedule = sql.search(/if exists \(select 1 from cron\.job where jobname = 'feedback-sweep'\) then\s+perform cron\.unschedule\('feedback-sweep'\);/i);
  assert.ok(unschedule > 0 && unschedule < schedules[0].index, 'перед cron.schedule прежнее задание снимается по имени');
});

// --- ai-access.sql: ИИ-агент по приглашению (21 октября 2026) ------------------
//
// Решение пользователя: агент — только аккаунтам, которым владелец выдал доступ
// строкой с почтой. Файл лежит в открытом репозитории и выполняется руками,
// поэтому сверяется: таблица, нижний регистр, закрытость для клиентов, RPC
// только для вошедших, и что функции ищут ровно эту таблицу.

test('ai-access.sql: таблица ai_access — почта в нижнем регистре (check), RLS, права anon и authenticated сняты', () => {
  const sql = read('ai-access.sql');
  const table = sql.match(/create table if not exists public\.ai_access \(([\s\S]*?)\n\);/i);
  assert.ok(table, 'нет create table if not exists public.ai_access');
  const cols = table[1].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/)[0]);
  assert.deepEqual(cols, ['email', 'note', 'granted_at'], 'колонки — по контракту; новая колонка — новые данные: Политика §11 и COMPLIANCE.md');
  assert.match(table[1], /email text primary key/i);
  assert.match(table[1], /granted_at timestamptz not null default now\(\)/i);
  assert.doesNotMatch(table[1], /references/i, 'ссылки на auth.users нет — доступ выдаётся и до регистрации');
  // Нижний регистр — check, пересоздаётся под тем же именем (повторный запуск чинит).
  const drop = sql.search(/alter table public\.ai_access drop constraint if exists ai_access_email_lower;/i);
  const add = sql.search(/alter table public\.ai_access add constraint ai_access_email_lower\s+check \(email = lower\(btrim\(email\)\)/i);
  assert.ok(drop > 0 && add > drop, 'check нижнего регистра: drop if exists, потом add');
  // Триггер приводит почту к нижнему регистру до check.
  assert.match(sql, /new\.email := lower\(btrim\(new\.email\)\);/);
  assert.match(sql, /drop trigger if exists ai_access_normalize on public\.ai_access;\s*create trigger ai_access_normalize\s+before insert or update of email on public\.ai_access/i);
  // Клиентам — ни чтения, ни записи: RLS без политик и явный revoke.
  assert.match(sql, /alter table public\.ai_access enable row level security;/i);
  assert.doesNotMatch(sql, /create policy/i, 'политик нет: клиенты таблицу не читают и не пишут');
  assert.match(sql, /revoke all on table public\.ai_access from anon, authenticated;/i);
  assert.doesNotMatch(sql, /grant [^;]* on (table )?public\.ai_access to/i, 'прав на таблицу никому не выдаём');
  assert.doesNotMatch(sql, /service_role/i, 'служебный ключ обходит RLS сам — в SQL его не называем');
});

test('ai-access.sql: ai_has_access() — security definer с пустым search_path, подтверждённая почта, только authenticated', () => {
  const sql = read('ai-access.sql');
  const m = sql.match(/create or replace function public\.ai_has_access\(\)\s+returns boolean([\s\S]*?)\n\$\$;/i);
  assert.ok(m, 'нет public.ai_has_access() returns boolean');
  const fn = m[1];
  assert.match(fn, /security definer/i, 'auth.users и ai_access вызывающему не читать — security definer');
  assert.match(fn, /set search_path = ''/i);
  assert.match(fn, /from auth\.users u/i);
  assert.match(fn, /join public\.ai_access a on a\.email = lower\(u\.email\)/i, 'сравнение — по нижнему регистру');
  assert.match(fn, /u\.id = auth\.uid\(\)/i, 'только про самого вызывающего');
  assert.match(fn, /u\.email_confirmed_at is not null/i, 'неподтверждённой почте доступа нет');
  assert.match(sql, /revoke all on function public\.ai_has_access\(\) from public;/i);
  assert.match(sql, /revoke all on function public\.ai_has_access\(\) from anon;/i);
  const grants = [...sql.matchAll(/grant execute on function public\.ai_has_access\(\) to ([^;]+);/gi)].map((g) => g[1].trim());
  assert.deepEqual(grants, ['authenticated'], 'execute — только authenticated, гостю нет');
  // Повторный запуск — or replace и drop if exists.
  assert.doesNotMatch(sql, /^\s*create function/im, 'функции — create or replace');
  for (const [, name, on] of sql.matchAll(/^\s*create trigger (\w+)[\s\S]*? on ([\w.]+)\s/gim)) {
    assert.ok(sql.includes(`drop trigger if exists ${name} on ${on};`), `триггер ${name} пересоздаётся: drop trigger if exists`);
  }
});

test('ai-access.sql: строка уходит с аккаунтом — триггер на auth.users и функция delete-account; ai-chat спрашивает ту же таблицу', () => {
  const sql = read('ai-access.sql');
  const m = sql.match(/create or replace function public\.ai_access_forget\(\)\s+returns trigger([\s\S]*?)\n\$\$;/i);
  assert.ok(m, 'нет триггерной public.ai_access_forget()');
  assert.match(m[1], /security definer\s+set search_path = ''/i);
  assert.match(m[1], /delete from public\.ai_access where email = lower\(btrim\(old\.email\)\);/i);
  assert.match(m[1], /exception when others then/i, 'сбой стирания не держит удаление аккаунта');
  assert.match(sql, /create trigger ai_access_forget\s+after delete on auth\.users/i);
  assert.match(sql, /revoke all on function public\.ai_access_forget\(\) from anon, authenticated;/i);
  const del = fs.readFileSync(path.join(SQL, 'functions', 'delete-account', 'index.ts'), 'utf8');
  assert.match(del, /\.from\('ai_access'\)\.delete\(\)\.eq\('email', e\)/);
  const chat = fs.readFileSync(path.join(SQL, 'functions', 'ai-chat', 'index.ts'), 'utf8');
  assert.match(chat, /\.from\('ai_access'\)\.select\('email'\)\.eq\('email', email\)/);
  assert.match(chat, /reply\(403, \{ error: 'no access' \}\)/);
});

// --- admin.sql: админ-панель (23 октября 2026) -----------------------------------
//
// Решение пользователя: админка — только веб, один админ (аккаунт владельца,
// с TOTP), всё через функцию admin служебным ключом. Файл лежит в открытом
// репозитории и выполняется руками повторно — поэтому сверяется: закрытость
// новых таблиц для клиентов, счётчик экранов только у вошедших, с пределом и
// без идентификаторов в имени экрана, функции admin_* только для
// service_role, почты владельца в файле нет, и функции зовут ровно то, что
// файл заводит.

const ADMIN_TABLES = ['admin_users', 'usage_daily', 'feedback_replies', 'app_settings', 'blog_posts'];
/** Аргументы, заголовок (до $$) и тело функции public.<name>(…) из файла. */
const fnBody = (sql, name) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s+returns[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(m, `нет функции public.${name}`);
  return { args: m[1], head: sql.slice(m.index, sql.indexOf('$$', m.index)), body: m[2] };
};

test('admin.sql: новые таблицы — RLS и права anon/authenticated сняты; политика одна — чтение опубликованных постов', () => {
  const sql = read('admin.sql');
  for (const t of ADMIN_TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), `${t}: create table if not exists`);
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: RLS`);
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated;`), `${t}: права клиентов сняты`);
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from public;`), `${t}: и у public`);
  }
  const policies = [...sql.matchAll(/create policy "([^"]+)" on ([\w.]+)\s+for (\w+) to ([^\n]+)\n\s+using \(([^)]*)\);/gi)];
  assert.deepEqual(policies.map((p) => [p[1], p[2], p[3], p[4].trim(), p[5]]), [['blog posts: read published', 'public.blog_posts', 'select', 'anon, authenticated', 'published']]);
  assert.equal([...sql.matchAll(/create policy/gi)].length, 1, 'других политик нет');
  assert.ok(sql.includes('drop policy if exists "blog posts: read published" on public.blog_posts;'), 'политика пересоздаётся');
  const grants = [...sql.matchAll(/^grant ([^;]+) on table ([\w.]+) to ([^;]+);/gim)].map((g) => `${g[1]} ${g[2]} ${g[3]}`);
  assert.deepEqual(grants, ['select public.blog_posts anon, authenticated'], 'клиентам — только чтение постов (остальное отрезает политика)');
  // Удаление аккаунта уносит всё, что про него: каскад от auth.users и от feedback.
  for (const t of ['admin_users', 'usage_daily']) {
    const table = sql.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`))[1];
    assert.match(table, /user_id uuid (primary key |not null )?references auth\.users\(id\) on delete cascade/, `${t}: каскад с аккаунтом`);
  }
  assert.match(sql, /feedback_id uuid not null references public\.feedback\(id\) on delete cascade/);
});

test('admin.sql: track_screen — только вошедший, за себя, предел 2000 в сутки; в имени экрана нет цифр (id сущности не пролезет)', () => {
  const sql = read('admin.sql');
  const fn = fnBody(sql, 'track_screen');
  assert.equal(fn.args, 'p_screen text, p_platform text');
  assert.match(fn.head, /security definer\s+set search_path = ''/i);
  assert.match(fn.body, /v_uid uuid := auth\.uid\(\);/);
  assert.match(fn.body, /if v_uid is null then\s+return;/, 'без входа — ничего');
  assert.match(fn.body, /where u\.user_id = v_uid and u\.day = v_day/);
  assert.match(fn.body, /if v_total >= 2000 then\s+return;/, 'предел — 2000 в сутки, сверх — молча');
  assert.match(fn.body, /values \(v_day, v_uid, p_screen, p_platform, 1\)/, 'пишет только за вызывающего');
  assert.match(fn.body, /on conflict \(day, user_id, screen, platform\) do update set views = u\.views \+ 1;/);
  assert.match(sql, /revoke all on function public\.track_screen\(text, text\) from public;/);
  assert.match(sql, /revoke all on function public\.track_screen\(text, text\) from anon;/);
  const grants = [...sql.matchAll(/grant execute on function public\.track_screen\(text, text\) to ([^;]+);/gi)].map((g) => g[1].trim());
  assert.deepEqual(grants, ['authenticated'], 'execute — только authenticated, гостю нет');
  // Имя экрана: правило в check таблицы и в функции — одно и то же, без цифр
  // (Политика: в статистике экранов нет идентификаторов).
  const check = sql.match(/usage_daily_screen_check\s+check \(screen ~ '([^']+)'\);/)[1];
  const inFn = fn.body.match(/p_screen !~ '([^']+)'/)[1];
  assert.equal(check, inFn, 'check таблицы и track_screen проверяют одним правилом');
  assert.doesNotMatch(check, /0-9|\\d/, 'цифр в имени экрана нет');
  const re = new RegExp(check);
  for (const ok of ['projects', 'project', 'task', 'settings.sync', 'agent.chat', 'settings.usage-stats', 'a', 'x'.repeat(40)]) assert.ok(re.test(ok), ok);
  for (const bad of ['project.3f9a', 'task-123', 'doc.7', 'Projects', '', '.x', 'x'.repeat(41), 'projects/1', 'задачи', 'p q']) assert.ok(!re.test(bad), `${bad} не должен проходить`);
  assert.match(sql, /usage_daily_platform_check\s+check \(platform in \('web', 'desktop', 'android', 'ios'\)\);/);
  assert.match(fn.body, /p_platform not in \('web', 'desktop', 'android', 'ios'\)/);
  // Хранится 12 месяцев: задание пересоздаётся по имени.
  const unschedule = sql.search(/if exists \(select 1 from cron\.job where jobname = 'usage-sweep'\) then\s+perform cron\.unschedule\('usage-sweep'\);/);
  const schedule = sql.search(/perform cron\.schedule\(\s*'usage-sweep'/);
  assert.ok(unschedule > 0 && schedule > unschedule, 'usage-sweep: снять прежнее, потом завести');
  assert.match(sql, /delete from public\.usage_daily where day < \(\(now\(\) at time zone 'utc'\)::date - interval '12 months'\)::date/);
});

test('admin.sql: функции admin_* — пустой search_path, выполнять может только service_role', () => {
  const sql = read('admin.sql');
  const defs = [...sql.matchAll(/create or replace function public\.(admin_\w+)\(/gi)].map((m) => m[1]);
  assert.deepEqual(defs.slice().sort(), ['admin_access_list', 'admin_created_entities', 'admin_logins', 'admin_overview', 'admin_screens', 'admin_session_days', 'admin_ts', 'admin_user_emails', 'admin_users_list']);
  const exposed = ['admin_overview', 'admin_screens', 'admin_users_list', 'admin_user_emails', 'admin_access_list'];
  for (const name of defs) {
    const { head } = fnBody(sql, name);
    assert.match(head, /set search_path = ''/i, `${name}: пустой search_path`);
    if (exposed.includes(name)) assert.match(head, /security definer/i, `${name}: security definer — читает auth.users`);
    const sig = sql.match(new RegExp(`revoke all on function public\\.${name}\\(([^)]*)\\) from public;`));
    assert.ok(sig, `${name}: revoke from public`);
    assert.ok(sql.includes(`revoke all on function public.${name}(${sig[1]}) from anon, authenticated;`), `${name}: revoke from anon, authenticated`);
    const grants = [...sql.matchAll(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to ([^;]+);`, 'g'))].map((g) => g[1].trim());
    assert.deepEqual(grants, exposed.includes(name) ? ['service_role'] : [], `${name}: execute — ${exposed.includes(name) ? 'только service_role' : 'никому (помощник)'}`);
  }
  // Входы — из журнала аудита и сессий Auth; сбой чтения не роняет обзор.
  const logins = fnBody(sql, 'admin_logins').body;
  assert.match(logins, /from auth\.audit_log_entries e/);
  assert.match(logins, /e\.payload ->> 'action' = 'login'/);
  assert.match(logins, /from auth\.sessions s/);
  assert.equal([...logins.matchAll(/exception when others then/g)].length, 2, 'обе части — со своей подстраховкой');
  // Заведённые проекты и задачи — правка-создание '*' журнала changes.
  const made = fnBody(sql, 'admin_created_entities').body;
  assert.match(made, /from public\.changes c\s+where c\.field = '\*' and c\.entity in \('project', 'task'\)/);
  assert.match(made, /group by c\.entity, c\.user_id, c\.entity_id/, 'одна сущность — одно создание, возврат из корзины не в счёт');
});

test('admin.sql: почты владельца в файле нет; повторный запуск безопасен; feedback.status — new/answered/closed, новая строка всегда new', () => {
  const sql = read('admin.sql');
  assert.deepEqual([...sql.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0]), [], 'ни одной почты: репозиторий открытый');
  assert.match(sql, /where lower\(email\) = lower\('<ваша почта>'\)/, 'в шапке — заготовка с местом под почту');
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{10,}/, 'ключей в файле нет');
  assert.doesNotMatch(sql, /^\s*create function/im, 'функции — create or replace');
  assert.doesNotMatch(sql, /^\s*create table (?!if not exists)/im, 'таблицы — if not exists');
  assert.doesNotMatch(sql, /^\s*create (unique )?index (?!if not exists)/im, 'индексы — if not exists');
  for (const [, name, on] of sql.matchAll(/^\s*create trigger (\w+)\s+\w+ \w+(?: or \w+)* on ([\w.]+)/gim)) {
    assert.ok(sql.includes(`drop trigger if exists ${name} on ${on};`), `триггер ${name} пересоздаётся`);
  }
  for (const [, table, name] of sql.matchAll(/alter table ([\w.]+) add constraint (\w+)/g)) {
    const drop = sql.indexOf(`alter table ${table} drop constraint if exists ${name};`);
    const add = sql.indexOf(`alter table ${table} add constraint ${name}`);
    assert.ok(drop >= 0 && drop < add, `${name}: drop if exists перед add`);
  }
  assert.match(sql, /alter table public\.feedback add column if not exists status text not null default 'new';/);
  assert.match(sql, /add constraint feedback_status_check\s+check \(status in \('new', 'answered', 'closed'\)\);/);
  assert.match(fnBody(sql, 'feedback_status_new').body, /new\.status := 'new';/);
  assert.match(sql, /create trigger feedback_status_new\s+before insert on public\.feedback/);
  assert.match(sql, /add constraint feedback_replies_email_status_check\s+check \(email_status is null or email_status in \('sent', 'failed', 'not_configured'\)\);/);
  assert.match(sql, /add constraint feedback_replies_body_check\s+check \(char_length\(body\) between 1 and 4000\);/);
  assert.match(sql, /add constraint blog_posts_tag_check\s+check \(tag in \('release', 'feature', 'improvement'\)\);/);
});

test('admin.sql и функции: зовут ровно то, что файл заводит — RPC, параметры, таблицы, ключи настроек', () => {
  const sql = read('admin.sql');
  const admin = fs.readFileSync(path.join(SQL, 'functions', 'admin', 'index.ts'), 'utf8');
  const calls = [...admin.matchAll(/\.rpc\('(\w+)'(?:, \{([^}]*)\})?/g)].map((m) => [m[1], (m[2] || '').split(',').map((x) => x.split(':')[0].trim()).filter(Boolean)]);
  assert.ok(calls.length >= 5, 'функция admin зовёт счётчики');
  for (const [name, params] of calls) {
    const declared = fnBody(sql, name).args.split(',').map((a) => a.trim().split(/\s+/)[0]).filter(Boolean);
    for (const p of params) assert.ok(declared.includes(p), `${name}: параметра ${p} нет в admin.sql (${declared.join(', ')})`);
  }
  for (const t of ['admin_users', 'feedback_replies', 'app_settings', 'blog_posts', 'usage_daily']) {
    assert.ok(admin.includes(`.from('${t}')`), `функция admin ходит в ${t}`);
  }
  const chat = fs.readFileSync(path.join(SQL, 'functions', 'ai-chat', 'index.ts'), 'utf8');
  assert.match(chat, /\.from\('app_settings'\)\.select\('key, value'\)/, 'ai-chat только читает app_settings');
  assert.doesNotMatch(chat, /\.from\('app_settings'\)\.(insert|update|upsert|delete)/);
  for (const key of ['ai.model', 'ai.effort', 'ai.daily_limit', 'ai.daily_units']) {
    assert.ok(chat.includes(`'${key}'`) && admin.includes(`'${key}'`), `ключ ${key} — у обеих функций`);
    assert.ok(sql.includes(key), `ключ ${key} описан в admin.sql`);
  }
});

test('blog-posts-seed.sql: свежий (scripts/blog-to-sql.js из landing/blog-posts.js), все посты опубликованы, повтор копий не плодит', () => {
  const { readPosts, buildSeed, postId } = require('../../scripts/blog-to-sql.js');
  const posts = readPosts();
  const seed = read('blog-posts-seed.sql');
  assert.equal(seed, buildSeed(posts), 'supabase/blog-posts-seed.sql отстал — node scripts/blog-to-sql.js');
  assert.match(seed, /^insert into public\.blog_posts \(id, date, tag, version, title, body, published, created_at\)$/m);
  assert.match(seed, /^on conflict \(id\) do update set$/m, 'upsert по id');
  const ids = [...seed.matchAll(/^ {2}\('([0-9a-f-]{36})', '(\d{4}-\d{2}-\d{2})'/gm)].map((m) => m[1]);
  assert.equal(ids.length, posts.length, 'каждый пост — одной строкой');
  assert.equal(new Set(ids).size, ids.length, 'id не повторяются');
  assert.deepEqual(ids, posts.map(postId), 'id — от даты и заголовка ru');
  assert.equal([...seed.matchAll(/^ {3}true, '/gm)].length, posts.length, 'все опубликованы');
  // Ключ стабилен: тот же пост — тот же id; другой заголовок — другой.
  const p = { date: '2026-10-23', title: { ru: 'А' } };
  assert.equal(postId(p), postId({ ...p }));
  assert.notEqual(postId(p), postId({ date: '2026-10-23', title: { ru: 'Б' } }));
  assert.match(postId(p), /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID версии 3');
  // Посты одного дня — в порядке файла: created_at убывает.
  const sameDay = [...seed.matchAll(/^ {2}\('[0-9a-f-]{36}', '2026-10-10'[\s\S]*?true, '([^']+)'\)/gm)].map((m) => m[1]);
  assert.equal(sameDay.length, posts.filter((x) => x.date === '2026-10-10').length);
  assert.deepEqual(sameDay, [...sameDay].sort().reverse());
});

// --- logs.sql: журнал работы закрыт (23 октября 2026) ------------------------------
//
// До 23 октября журнал читала публичная страница /logs ключом anon (политики
// «select using (true)»), а в журнале — ход работы, в том числе найденные
// уязвимости. Теперь читает только служебный ключ (функция admin, logs.list),
// а недельный дайджест в Make — узкой функцией work_log_digest по токену.

test('logs.sql: публичного чтения журнала нет — прежние политики снимаются, права клиентов сняты, RLS включён', () => {
  const sql = read('logs.sql');
  const code = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /create policy/i, 'политик на журнал нет: читает только служебный ключ');
  assert.doesNotMatch(code, /using \(true\)/i);
  for (const [name, table] of [['read work log tasks', 'work_log_tasks'], ['read work log events', 'work_log_events']]) {
    assert.ok(sql.includes(`drop policy if exists "${name}" on ${table};`), `прежняя публичная политика «${name}» снимается`);
  }
  for (const t of ['work_log_tasks', 'work_log_events']) {
    assert.match(sql, new RegExp(`alter table ${t} enable row level security;`), `${t}: RLS`);
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from public;`), `${t}: права public сняты`);
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated;`), `${t}: права клиентов сняты`);
  }
  assert.doesNotMatch(sql, /^\s*grant [^;]* on table/im, 'клиентам на таблицы журнала ничего не выдаётся');
  // Повторный запуск безопасен, данных файл не трогает.
  assert.doesNotMatch(sql, /^\s*create table (?!if not exists)/im);
  assert.doesNotMatch(sql, /^\s*create (unique )?index (?!if not exists)/im);
  assert.doesNotMatch(sql, /^\s*create function/im, 'функции — create or replace');
  assert.doesNotMatch(sql, /^\s*(delete|truncate|drop table|update)\b/im, 'данные журнала файл не трогает');
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{10,}/, 'ключей в файле нет');
});

test('logs.sql: work_log_digest — только по токену из app_settings (сравнение хэшей), 1–31 день, только kind/title/detail/at, execute — anon', () => {
  const sql = read('logs.sql');
  const fn = fnBody(sql, 'work_log_digest');
  assert.equal(fn.args, 'p_token text, p_days integer default 7');
  assert.match(fn.head, /returns table \(kind text, title text, detail text, at timestamptz\)/, 'наружу — только четыре поля события');
  assert.match(fn.head, /security definer\s+set search_path = ''/i);
  // Дни: вне 1…31 — отказ, а не тихая подрезка.
  assert.match(fn.body, /if p_days is null or p_days < 1 or p_days > 31 then\s+raise exception '[^']*' using errcode = '22023';/);
  // Токен: из app_settings, не короче 32 знаков с обеих сторон, сравнение — SHA-256.
  assert.match(fn.body, /from public\.app_settings s\s+where s\.key = 'digest\.token';/);
  assert.match(fn.body, /exception when undefined_table then/, 'без admin.sql — отказ, а не падение');
  assert.match(fn.body, /v_secret is null or char_length\(v_secret\) < 32/);
  assert.match(fn.body, /p_token is null or char_length\(p_token\) < 32 or char_length\(p_token\) > 256/);
  assert.match(fn.body, /pg_catalog\.sha256\(pg_catalog\.convert_to\(p_token, 'UTF8'\)\)\s+<> pg_catalog\.sha256\(pg_catalog\.convert_to\(v_secret, 'UTF8'\)\)/, 'сравнивать хэши, а не строки');
  assert.doesNotMatch(fn.body, /p_token\s*(<>|=|!=)\s*v_secret|v_secret\s*(<>|=|!=)\s*p_token/, 'строки токена напрямую не сравниваются');
  assert.match(fn.body, /raise exception '[^']*forbidden' using errcode = '42501';/);
  const check = fn.body.indexOf('42501');
  const select = fn.body.indexOf('return query');
  assert.ok(check > 0 && select > check, 'сначала токен, потом данные');
  // Данные: только события, только окно дней, предел строк; задач и сводок нет.
  // Окно, порядок и предел — как у прежнего запроса сценария Make
  // (at=gte.<дата>, order=at.desc, limit=500), чтобы остальное в нём не менять.
  assert.match(fn.body, /select e\.kind, e\.title, e\.detail, e\.at\s+from public\.work_log_events e\s+where e\.at >= pg_catalog\.timezone\('utc', \(pg_catalog\.timezone\('utc', pg_catalog\.now\(\)\)::date - p_days\)::timestamp\)\s+order by e\.at desc\s+limit 500;/);
  assert.doesNotMatch(fn.body, /work_log_tasks/, 'задачи дайджесту не нужны');
  // Права: снято у всех, выдано только anon (запрос Make — ключом anon).
  assert.match(sql, /revoke all on function public\.work_log_digest\(text, integer\) from public;/);
  assert.match(sql, /revoke all on function public\.work_log_digest\(text, integer\) from anon, authenticated;/);
  const grants = [...sql.matchAll(/^grant execute on function public\.work_log_digest\(text, integer\) to ([^;]+);/gim)].map((g) => g[1].trim());
  assert.deepEqual(grants, ['anon']);
  // Токена в файле нет; ключ digest.token проходит check таблицы app_settings.
  assert.doesNotMatch(sql, /values \('digest\.token', '[0-9a-f]{20,}/i, 'токен не пишется в открытый репозиторий');
  const keyCheck = read('admin.sql').match(/app_settings_key_check\s+check \(key ~ '([^']+)'/)[1];
  assert.ok(new RegExp(keyCheck).test('digest.token'), 'ключ digest.token проходит check app_settings');
});

test('logs.sql и функция admin: logs.list читает те же таблицы и колонки, что заводит файл', () => {
  const sql = read('logs.sql');
  const admin = fs.readFileSync(path.join(SQL, 'functions', 'admin', 'index.ts'), 'utf8');
  const cols = (table) => {
    const body = sql.match(new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`))[1];
    return new Set([...body.matchAll(/^\s+(\w+) /gm)].map((m) => m[1]));
  };
  const reads = [...admin.matchAll(/\.from\('(work_log_\w+)'\)\s*\.select\('([^']+)'\)/g)];
  assert.ok(reads.length >= 3, 'функция admin читает журнал');
  for (const [, table, list] of reads) {
    const have = cols(table);
    for (const c of list.split(',').map((x) => x.trim())) assert.ok(have.has(c), `${table}.${c} нет в logs.sql`);
  }
  assert.doesNotMatch(admin, /\.from\('work_log_\w+'\)\.(insert|update|upsert|delete)/, 'админка журнал только читает');
});

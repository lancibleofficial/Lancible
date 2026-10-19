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

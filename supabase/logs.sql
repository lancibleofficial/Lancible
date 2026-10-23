-- Lancible — журнал работы (раздел «Журнал» в админке).
-- Выполнить: Supabase Dashboard → SQL Editor → New query → вставить целиком →
-- Run. Повторный запуск безопасен: «if not exists», «or replace», «drop … if
-- exists»; данные он не трогает. Схема приложения лежит рядом, в schema.sql;
-- журнал держим отдельным файлом, потому что к данным пользователей он
-- отношения не имеет.
--
-- С 23 октября 2026 журнал закрыт. До этого его читала публичная страница
-- /logs на лендинге ключом anon (политики «select using (true)»), а в журнале
-- описан ход работы — в том числе найденные уязвимости и как их закрывали.
-- Теперь:
--   • читать журнал целиком может только служебный ключ: функция admin
--     (действие logs.list, только админ со вторым фактором) и сам
--     scripts/worklog.js;
--   • писать — по-прежнему только служебный ключ (scripts/worklog.js);
--   • недельному дайджесту в Make оставлен узкий путь — функция
--     work_log_digest(токен, дни) ниже: только вид, заголовок, подробности и
--     время событий за последние N дней (N от 1 до 31) и только с верным
--     токеном.
--
-- ЧТО СДЕЛАТЬ ОДИН РАЗ, после выполнения файла (раньше него — supabase/admin.sql:
-- токен дайджеста лежит в его таблице app_settings):
--   1. Завести токен дайджеста — в SQL Editor, одной командой; она же покажет
--      его один раз (скопируйте значение из колонки token):
--        insert into public.app_settings (key, value)
--          values ('digest.token', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
--          on conflict (key) do update set value = excluded.value, updated_at = now()
--          returning value #>> '{}' as token;
--      Повторный запуск выдаёт новый токен, прежний перестаёт работать.
--      Посмотреть нынешний: select value #>> '{}' from public.app_settings where key = 'digest.token';
--   2. В сценарии Make «Lancible: журнал работы → Telegram», модуль
--      «Журнал Lancible: события за неделю» (HTTP), вместо прежнего
--        GET …/rest/v1/work_log_events?select=kind,title,detail,at&order=at.desc&limit=500&at=gte.<дата>
--      поставить
--        Method: POST
--        URL: https://yiglgfkjjvwijukdzutw.supabase.co/rest/v1/rpc/work_log_digest
--        Query string: пусто (все четыре параметра убрать)
--        Headers: apikey и Authorization: Bearer <ключ anon> — как были
--        Body type: Raw, Content type: JSON (application/json)
--        Request content: {"p_token": "<токен из шага 1>", "p_days": 7}
--        Parse response: да (как было)
--      Ответ — тот же список [{ kind, title, detail, at }] за те же 7 дней
--      (от полуночи UTC), свежие первыми, до 500 строк: остальные модули
--      сценария менять не нужно. Токен — в теле, а не в адресе: адреса
--      оседают в журналах.
--   Неверный или не заведённый токен — ошибка 42501 (HTTP 401/403), дни вне
--   1…31 — ошибка 22023 (HTTP 400): сценарий упадёт громко, а не пришлёт
--   пустой дайджест.
--
-- Зачем две таблицы, а не одна: журнал сгруппирован по задачам, и у задачи
-- есть собственное состояние (в работе → на проверке → принято →
-- задеплоено), которое меняется по ходу дела. Событие же не меняется никогда —
-- это запись о том, что произошло. Разное поведение — разные таблицы.

create table if not exists work_log_tasks (
  id text primary key,                 -- слаг вида 2026-09-19-kanban-spacing
  title text not null,                 -- как задачу сформулировал пользователь
  summary text,                        -- одно предложение: что в итоге сделано
  status text not null default 'in_progress',
                                       -- in_progress | review | accepted | deployed
  round int not null default 1,        -- какой круг правок идёт сейчас
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists work_log_events (
  id bigint generated always as identity primary key,
  task_id text not null references work_log_tasks(id) on delete cascade,
  kind text not null,                  -- request | change | error | fix | check | deploy
  title text not null,                 -- одна строка, без точки в конце
  detail text,                         -- подробности: причина, замер, команда
  round int not null default 1,        -- к какому кругу правок относится
  at timestamptz not null default now()
);

create index if not exists work_log_events_task_idx on work_log_events (task_id, at);
create index if not exists work_log_events_at_idx on work_log_events (at);

-- Row Level Security. RLS включён, политик нет: клиент (anon, authenticated)
-- не читает и не пишет ни строки. Служебный ключ RLS обходит сам и живёт вне
-- браузера — им ходят функция admin и scripts/worklog.js. Права клиентов на
-- таблицы сняты и явно: в Supabase новые таблицы схемы public открыты им по
-- умолчанию, и политика, заведённая по ошибке, без прав ничего не откроет.
alter table work_log_tasks enable row level security;
alter table work_log_events enable row level security;

-- Прежние политики чтения — публичные (страница /logs до 23 октября 2026).
drop policy if exists "read work log tasks" on work_log_tasks;
drop policy if exists "read work log events" on work_log_events;

revoke all on table public.work_log_tasks from public;
revoke all on table public.work_log_tasks from anon, authenticated;
revoke all on table public.work_log_events from public;
revoke all on table public.work_log_events from anon, authenticated;

-- Дайджест для Make ----------------------------------------------------------------
-- Узкий путь для одного потребителя: kind, title, detail и at событий за
-- последние p_days дней (1…31), свежие первыми, не больше 500 строк — ровно
-- то, что сценарий брал прежним запросом. Без задач, их сводок и статусов. security definer — читает закрытую таблицу
-- правами владельца; search_path пустой, все имена — со схемой.
--
-- Токен — строка app_settings под ключом digest.token (supabase/admin.sql:
-- таблицу читает только служебный ключ). Сравниваются не строки, а их
-- SHA-256: время сравнения хэшей не говорит, сколько первых знаков токена
-- угадано, — это и есть сравнение постоянным временем, доступное в SQL.
-- Короче 32 знаков токен не принимается ни с той, ни с другой стороны.
-- plpgsql, а не sql: таблицу app_settings заводит admin.sql, и файл
-- выполняется и без него — тогда дайджест отвечает отказом, а не падает.

create or replace function public.work_log_digest(p_token text, p_days integer default 7)
returns table (kind text, title text, detail text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'work_log_digest: p_days must be 1..31' using errcode = '22023';
  end if;
  begin
    select s.value #>> '{}' into v_secret
    from public.app_settings s
    where s.key = 'digest.token';
  exception when undefined_table then
    v_secret := null;
  end;
  if v_secret is null or char_length(v_secret) < 32
     or p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256
     or pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
        <> pg_catalog.sha256(pg_catalog.convert_to(v_secret, 'UTF8')) then
    raise exception 'work_log_digest: forbidden' using errcode = '42501';
  end if;
  -- Окно и порядок — как у прежнего запроса сценария (at=gte.<дата N дней
  -- назад>, order=at.desc, limit=500): от полуночи UTC того дня, свежие первыми.
  return query
    select e.kind, e.title, e.detail, e.at
    from public.work_log_events e
    where e.at >= pg_catalog.timezone('utc', (pg_catalog.timezone('utc', pg_catalog.now())::date - p_days)::timestamp)
    order by e.at desc
    limit 500;
end;
$$;

revoke all on function public.work_log_digest(text, integer) from public;
revoke all on function public.work_log_digest(text, integer) from anon, authenticated;
grant execute on function public.work_log_digest(text, integer) to anon;

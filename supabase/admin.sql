-- Lancible — админ-панель: кто админ, счётчик экранов, ответы на отзывы,
-- настройки агента, посты лендинга и счётчики для админа (23 октября 2026).
-- Выполнить: Supabase Dashboard → SQL Editor → New query → вставить целиком →
-- Run. Повторный запуск безопасен: «if not exists», «or replace», «drop … if
-- exists»; данные он не трогает.
--
-- ПОРЯДОК — один раз, по шагам:
--   0. Раньше этого файла выполнены supabase/feedback.sql, ai.sql,
--      ai-budget.sql, ai-access.sql и sync2.sql: счётчики читают их таблицы.
--   1. Выполнить этот файл целиком. Последний select — пять строк, все true.
--   2. Назначить себя админом (почта владельца в файл не пишется:
--      репозиторий открытый) — в SQL Editor, своей почтой:
--        insert into public.admin_users (user_id)
--          select id from auth.users where lower(email) = lower('<ваша почта>')
--          on conflict (user_id) do nothing;
--      Проверка: select count(*) from public.admin_users; — 1.
--   3. Перенести посты лендинга: supabase/blog-posts-seed.sql целиком → Run
--      (его пишет scripts/blog-to-sql.js из landing/blog-posts.js).
--   4. Второй фактор: функция admin пускает только с aal2 (TOTP). В Supabase
--      TOTP включён по умолчанию (Authentication → Sign In / Providers →
--      Multi-Factor); привязать его своему аккаунту — при первом входе в
--      админку.
-- Функция admin (supabase/functions/admin) работает служебным ключом; её
-- выкладка и секреты — supabase/functions/README.md, «Админ-панель».
--
-- Что здесь лежит:
--   admin_users       — кто админ: только id аккаунта и время назначения.
--   usage_daily       — счётчик экранов: день (UTC), аккаунт, идентификатор
--                       экрана (projects, task, settings.sync…), платформа и
--                       число открытий. Ни содержимого заметок и задач, ни
--                       адресов, ни устройства. В идентификаторе экрана нет
--                       цифр (check и track_screen): id проекта или задачи
--                       вида project.3f9a или task-123 туда не пролезет. Пишет его только вошедший —
--                       через track_screen() ниже; гость ничего не
--                       отправляет. Хранится 12 месяцев (задание usage-sweep)
--                       и уходит каскадом с аккаунтом.
--   feedback.status   — разбор отзыва: new → answered → closed.
--   feedback_replies  — ответы админа на отзыв: текст, когда и как ушло
--                       письмо. Уходят вместе с отзывом (каскад: удаление
--                       аккаунта, уборка старше 12 месяцев).
--   app_settings      — настройки агента из админки (ai.model, ai.effort,
--                       ai.daily_limit, ai.daily_units); их читает ai-chat.
--   blog_posts        — посты лендинга; читать опубликованные может кто
--                       угодно, писать — только служебный ключ.
-- Клиенты таблиц admin_users, usage_daily, feedback_replies и app_settings не
-- читают и не пишут: RLS включён, политик нет, права anon и authenticated
-- сняты явно (в Supabase новые таблицы схемы public открыты им по
-- умолчанию). Служебный ключ обходит RLS сам.
--
-- Счётчики для админа — функции public.admin_*: security definer с пустым
-- search_path, выполнять может только service_role (функция admin), у
-- public, anon и authenticated право снято. Дни — по UTC.
--   Входы. В этом проекте журнал auth.audit_log_entries пуст (23 октября
--   2026: /auth/v1/admin/audit отдаёт 0 записей при пяти аккаунтах со
--   входами — запись журнала аудита в базу выключена), поэтому вход — это
--   новая сессия в auth.sessions (каждый вход по паролю или Google заводит
--   сессию, обновление токена — нет). Сессия, из которой вышли, из таблицы
--   уходит, так что число — оценка снизу. Если журнал аудита включат
--   (Authentication → Audit Logs), за день берётся большее из двух: записей
--   'login' и новых сессий.
--   Проекты и задачи «заведено» — по журналу правок changes (sync2.sql):
--   создание сущности — правка с field = '*' (core/oplog.js, diffStates),
--   её первая строка на (аккаунт, сущность); день — createdAt самой сущности
--   из этой правки, если он есть и не позже приёма сервером, иначе время
--   приёма. Возврат из корзины — тоже '*', но той же сущности: не считается.
--   Только у синхронизирующих аккаунтов (десктоп ≥ 0.5.0, телефон ≥ 1.3.0).
--   Активный за день — кто открыл экран, прислал правку, звал агента, оставил
--   отзыв или вошёл/обновил сессию в этот день.
--
-- Проверка: tests/unit/supabase-sql.test.js (текст файла) и
-- tests/backend/admin-function.test.js (функция admin на подменах).

-- 1. Кто админ ------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public;
revoke all on table public.admin_users from anon, authenticated;

-- 2. Счётчик экранов ------------------------------------------------------------

create table if not exists public.usage_daily (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  screen text not null,
  platform text not null,
  views integer not null default 0,
  primary key (day, user_id, screen, platform)
);

-- Ограничения — по имени, отдельно от create table: повторный запуск чинит и
-- уже созданную таблицу.
alter table public.usage_daily drop constraint if exists usage_daily_screen_check;
alter table public.usage_daily add constraint usage_daily_screen_check
  check (screen ~ '^[a-z][a-z_.-]{0,39}$');
alter table public.usage_daily drop constraint if exists usage_daily_platform_check;
alter table public.usage_daily add constraint usage_daily_platform_check
  check (platform in ('web', 'desktop', 'android', 'ios'));
alter table public.usage_daily drop constraint if exists usage_daily_views_check;
alter table public.usage_daily add constraint usage_daily_views_check
  check (views >= 0);

-- Счёт предела и карточка пользователя — по аккаунту и дню.
create index if not exists usage_daily_user_day on public.usage_daily (user_id, day);

alter table public.usage_daily enable row level security;
revoke all on table public.usage_daily from public;
revoke all on table public.usage_daily from anon, authenticated;

-- Отметить открытие экрана. Зовёт клиент: rpc('track_screen', { p_screen,
-- p_platform }) — только вошедший (гость ничего не отправляет), не чаще раза
-- в 2 с на экран, только при включённом выключателе и принятой редакции.
-- security definer: читать и писать таблицу клиенту нельзя, а дописать свою
-- строку надо. Пишется только за самого вызывающего (auth.uid()), день —
-- по UTC. Предел — 2000 открытий на аккаунт в сутки: сверх — молча ничего
-- (счётчик не должен ни ронять клиента, ни раздувать таблицу). Чужой
-- идентификатор экрана или платформа — ошибка 22023: клиенты её глотают.
create or replace function public.track_screen(p_screen text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_total bigint;
begin
  if v_uid is null then
    return;
  end if;
  if p_screen is null or p_screen !~ '^[a-z][a-z_.-]{0,39}$' then
    raise exception 'bad screen' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('web', 'desktop', 'android', 'ios') then
    raise exception 'bad platform' using errcode = '22023';
  end if;
  select coalesce(sum(u.views), 0) into v_total
    from public.usage_daily u
    where u.user_id = v_uid and u.day = v_day;
  if v_total >= 2000 then
    return;
  end if;
  insert into public.usage_daily as u (day, user_id, screen, platform, views)
    values (v_day, v_uid, p_screen, p_platform, 1)
    on conflict (day, user_id, screen, platform) do update set views = u.views + 1;
end;
$$;

-- Звать может только вошедший; гостю (anon) — нет.
revoke all on function public.track_screen(text, text) from public;
revoke all on function public.track_screen(text, text) from anon;
grant execute on function public.track_screen(text, text) to authenticated;

-- Хранится 12 месяцев: старше — стирает ежедневное задание pg_cron
-- (расширение включает supabase/feedback-bot.sql). Нет pg_cron — файл всё
-- равно выполняется, а в выводе — предупреждение.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'usage-sweep') then
      perform cron.unschedule('usage-sweep');
    end if;
    perform cron.schedule(
      'usage-sweep',
      '25 3 * * *',
      $cron$delete from public.usage_daily where day < ((now() at time zone 'utc')::date - interval '12 months')::date$cron$
    );
  else
    raise warning 'usage-sweep: нет pg_cron — включить расширение (Database → Extensions) и выполнить файл ещё раз';
  end if;
end;
$$;

-- 3. Разбор отзывов -------------------------------------------------------------

alter table public.feedback add column if not exists status text not null default 'new';
alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check
  check (status in ('new', 'answered', 'closed'));
create index if not exists feedback_status_created on public.feedback (status, created_at desc);

-- Новая строка — всегда 'new': вставляет её клиент (гость или вошедший), и
-- сам себе пометить отзыв разобранным он не может.
create or replace function public.feedback_status_new()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'new';
  return new;
end;
$$;

revoke all on function public.feedback_status_new() from public;
revoke all on function public.feedback_status_new() from anon, authenticated;

drop trigger if exists feedback_status_new on public.feedback;
create trigger feedback_status_new
  before insert on public.feedback
  for each row execute function public.feedback_status_new();

create table if not exists public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  body text not null,
  sent_at timestamptz,
  email_status text,
  created_at timestamptz not null default now()
);

alter table public.feedback_replies drop constraint if exists feedback_replies_body_check;
alter table public.feedback_replies add constraint feedback_replies_body_check
  check (char_length(body) between 1 and 4000);
-- null — письмо ещё не ушло (строка пишется до отправки, итог — правкой).
alter table public.feedback_replies drop constraint if exists feedback_replies_email_status_check;
alter table public.feedback_replies add constraint feedback_replies_email_status_check
  check (email_status is null or email_status in ('sent', 'failed', 'not_configured'));
create index if not exists feedback_replies_feedback on public.feedback_replies (feedback_id, created_at);

alter table public.feedback_replies enable row level security;
revoke all on table public.feedback_replies from public;
revoke all on table public.feedback_replies from anon, authenticated;

-- 4. Настройки агента -----------------------------------------------------------
-- Ключи: ai.model, ai.effort, ai.daily_limit, ai.daily_units. Строки нет —
-- ai-chat берёт прежний секрет (AI_MODEL, AI_EFFORT, AI_DAILY_LIMIT,
-- AI_DAILY_UNITS) или умолчание; значение проверяется белым списком и в
-- функции admin (при записи), и в ai-chat (при чтении). Ключи API здесь не
-- хранятся — только в секретах функций.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and char_length(key) <= 64);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public;
revoke all on table public.app_settings from anon, authenticated;

-- 5. Посты лендинга -------------------------------------------------------------
-- Порядок в ленте — date по убыванию, затем created_at по убыванию.
-- title — { ru, en }: строка на каждом языке; body — { ru: [абзацы], en:
-- [абзацы] } (как в landing/blog-posts.js; украинский и казахский читают
-- английский).

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  tag text not null,
  version text,
  title jsonb not null,
  body jsonb not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.blog_posts drop constraint if exists blog_posts_tag_check;
alter table public.blog_posts add constraint blog_posts_tag_check
  check (tag in ('release', 'feature', 'improvement'));
alter table public.blog_posts drop constraint if exists blog_posts_version_check;
alter table public.blog_posts add constraint blog_posts_version_check
  check (version is null or char_length(version) between 1 and 60);
alter table public.blog_posts drop constraint if exists blog_posts_title_check;
alter table public.blog_posts add constraint blog_posts_title_check
  check (jsonb_typeof(title) = 'object'
         and jsonb_typeof(title -> 'ru') = 'string'
         and jsonb_typeof(title -> 'en') = 'string');
alter table public.blog_posts drop constraint if exists blog_posts_body_check;
alter table public.blog_posts add constraint blog_posts_body_check
  check (jsonb_typeof(body) = 'object'
         and jsonb_typeof(body -> 'ru') = 'array'
         and jsonb_typeof(body -> 'en') = 'array');

create index if not exists blog_posts_feed on public.blog_posts (published, date desc, created_at desc);

create or replace function public.blog_posts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.blog_posts_touch() from public;
revoke all on function public.blog_posts_touch() from anon, authenticated;

drop trigger if exists blog_posts_touch on public.blog_posts;
create trigger blog_posts_touch
  before update on public.blog_posts
  for each row execute function public.blog_posts_touch();

alter table public.blog_posts enable row level security;
revoke all on table public.blog_posts from public;
revoke all on table public.blog_posts from anon, authenticated;
grant select on table public.blog_posts to anon, authenticated;

drop policy if exists "blog posts: read published" on public.blog_posts;
create policy "blog posts: read published" on public.blog_posts
  for select to anon, authenticated
  using (published);

-- 6. Счётчики для админа (только service_role) ------------------------------------

-- Строка времени из правки → timestamptz; не ISO или не разобралась — null.
create or replace function public.admin_ts(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

-- Заведённые проекты и задачи: первая правка-создание (field = '*') на
-- аккаунт и сущность; время — createdAt сущности, но не позже приёма.
create index if not exists changes_created on public.changes (entity, user_id) where field = '*';

create or replace function public.admin_created_entities()
returns table (entity text, owner uuid, entity_id text, created timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.entity, c.user_id, c.entity_id,
         min(least(public.admin_ts(c.value ->> 'createdAt'), c.created_at))
  from public.changes c
  where c.field = '*' and c.entity in ('project', 'task')
  group by c.entity, c.user_id, c.entity_id;
$$;

-- Входы по дням с p_from: журнал аудита ('login') и новые сессии; за день —
-- большее. Нет прав на таблицу Auth или её нет — та часть пустая, а не
-- ошибка всего счётчика.
create or replace function public.admin_logins(p_from timestamptz)
returns table (login_day date, logins bigint, src text)
language plpgsql
set search_path = ''
as $$
declare
  v_audit jsonb := '{}'::jsonb;
  v_sess jsonb := '{}'::jsonb;
begin
  begin
    select coalesce(jsonb_object_agg(t.d::text, t.c), '{}'::jsonb) into v_audit
    from (
      select (e.created_at at time zone 'utc')::date as d, count(*) as c
      from auth.audit_log_entries e
      where e.created_at >= p_from and e.payload ->> 'action' = 'login'
      group by 1
    ) t;
  exception when others then
    v_audit := '{}'::jsonb;
  end;
  begin
    select coalesce(jsonb_object_agg(t.d::text, t.c), '{}'::jsonb) into v_sess
    from (
      select (s.created_at at time zone 'utc')::date as d, count(*) as c
      from auth.sessions s
      where s.created_at >= p_from
      group by 1
    ) t;
  exception when others then
    v_sess := '{}'::jsonb;
  end;
  return query
    select k.key::date,
           greatest(coalesce((v_audit ->> k.key)::bigint, 0), coalesce((v_sess ->> k.key)::bigint, 0)),
           case when v_audit ? k.key
                 and coalesce((v_audit ->> k.key)::bigint, 0) >= coalesce((v_sess ->> k.key)::bigint, 0)
                then 'audit' else 'sessions' end
    from (select jsonb_object_keys(v_audit) as key union select jsonb_object_keys(v_sess)) k;
end;
$$;

-- Дни, когда у аккаунта появлялась или обновлялась сессия (для «активных»).
create or replace function public.admin_session_days(p_from timestamptz)
returns table (seen_user uuid, seen_day date)
language plpgsql
set search_path = ''
as $$
begin
  return query
    select s.user_id, (s.created_at at time zone 'utc')::date from auth.sessions s where s.created_at >= p_from
    union
    select s.user_id, (s.updated_at at time zone 'utc')::date from auth.sessions s where s.updated_at >= p_from;
exception when others then
  return;
end;
$$;

-- Обзор: { days, users, logins, active, projects, tasks, feedback, ai,
-- platforms }; ряды — [{ day, n }] за p_days дней (7, 30 или 90; иное — 30),
-- последний — сегодня по UTC.
create or replace function public.admin_overview(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_today date := (now() at time zone 'utc')::date;
  v_first date;
  v_span date;
  v_since timestamptz;
  v_out jsonb;
begin
  v_first := v_today - (v_days - 1);
  -- Неделя и месяц считаются и при ряде в 7 дней.
  v_span := least(v_first, v_today - 29);
  v_since := v_span::timestamp at time zone 'utc';

  with
  days as (
    select g::date as d from generate_series(v_first::timestamp, v_today::timestamp, interval '1 day') g
  ),
  signups as (
    select (u.created_at at time zone 'utc')::date as d from auth.users u
  ),
  logins as (
    select l.login_day as d, l.logins as n, l.src from public.admin_logins(v_since) l
  ),
  seen as (
    select x.user_id as uid, x.day as d from public.usage_daily x where x.day >= v_span
    union
    select c.user_id, (c.created_at at time zone 'utc')::date from public.changes c where c.created_at >= v_since
    union
    select a.user_id, (a.created_at at time zone 'utc')::date from public.ai_calls a where a.created_at >= v_since
    union
    select f.user_id, (f.created_at at time zone 'utc')::date from public.feedback f
      where f.user_id is not null and f.created_at >= v_since
    union
    select s.seen_user, s.seen_day from public.admin_session_days(v_since) s
  ),
  made as (
    select e.entity, (e.created at time zone 'utc')::date as d from public.admin_created_entities() e
  )
  select jsonb_build_object(
    'days', v_days,
    'users', jsonb_build_object(
      'total', (select count(*) from signups),
      'new7', (select count(*) from signups s where s.d > v_today - 7),
      'new30', (select count(*) from signups s where s.d > v_today - 30),
      'series', (select jsonb_agg(jsonb_build_object('day', dd.d, 'n', (select count(*) from signups s where s.d = dd.d)) order by dd.d) from days dd)
    ),
    'logins', jsonb_build_object(
      'day', (select coalesce(sum(l.n), 0) from logins l where l.d = v_today),
      'week', (select coalesce(sum(l.n), 0) from logins l where l.d > v_today - 7),
      'month', (select coalesce(sum(l.n), 0) from logins l where l.d > v_today - 30),
      'source', case when exists (select 1 from logins l where l.src = 'audit') then 'audit' else 'sessions' end,
      'series', (select jsonb_agg(jsonb_build_object('day', dd.d, 'n', (select coalesce(sum(l.n), 0) from logins l where l.d = dd.d)) order by dd.d) from days dd)
    ),
    'active', jsonb_build_object(
      'dau', (select count(distinct s.uid) from seen s where s.d = v_today),
      'wau', (select count(distinct s.uid) from seen s where s.d > v_today - 7),
      'mau', (select count(distinct s.uid) from seen s where s.d > v_today - 30),
      'series', (select jsonb_agg(jsonb_build_object('day', dd.d, 'n', (select count(distinct s.uid) from seen s where s.d = dd.d)) order by dd.d) from days dd)
    ),
    'projects', jsonb_build_object(
      'total', (select count(*) from made m where m.entity = 'project'),
      'series', (select jsonb_agg(jsonb_build_object('day', dd.d, 'n', (select count(*) from made m where m.entity = 'project' and m.d = dd.d)) order by dd.d) from days dd)
    ),
    'tasks', jsonb_build_object(
      'total', (select count(*) from made m where m.entity = 'task'),
      'series', (select jsonb_agg(jsonb_build_object('day', dd.d, 'n', (select count(*) from made m where m.entity = 'task' and m.d = dd.d)) order by dd.d) from days dd)
    ),
    'feedback', jsonb_build_object(
      'new', (select count(*) from public.feedback f where f.status = 'new'),
      'total', (select count(*) from public.feedback f)
    ),
    'ai', jsonb_build_object(
      'calls7', (select count(*) from public.ai_calls a where a.created_at >= (v_today - 6)::timestamp at time zone 'utc'),
      'users7', (select count(distinct a.user_id) from public.ai_calls a where a.created_at >= (v_today - 6)::timestamp at time zone 'utc'),
      'unitsToday', (select coalesce(sum(a.cost_units), 0) from public.ai_calls a where a.created_at >= v_today::timestamp at time zone 'utc')
    ),
    'platforms', (
      select jsonb_build_object(
        'web', count(distinct x.user_id) filter (where x.platform = 'web'),
        'desktop', count(distinct x.user_id) filter (where x.platform = 'desktop'),
        'android', count(distinct x.user_id) filter (where x.platform = 'android'),
        'ios', count(distinct x.user_id) filter (where x.platform = 'ios'))
      from public.usage_daily x where x.day >= v_first
    )
  ) into v_out;
  return v_out;
end;
$$;

-- Экраны за p_days дней: открытия и аккаунты по экрану и платформе.
create or replace function public.admin_screens(p_days integer default 30)
returns table (screen text, platform text, views bigint, users bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select u.screen, u.platform, sum(u.views)::bigint, count(distinct u.user_id)::bigint
  from public.usage_daily u
  where u.day > (now() at time zone 'utc')::date - (case when p_days in (7, 30, 90) then p_days else 30 end)
  group by u.screen, u.platform
  order by 3 desc, 1, 2;
$$;

-- Список аккаунтов: { total, rows: [{ id, email, createdAt, lastSignInAt,
-- provider, aiAccess, projects, tasks, lastActiveDay, feedback, aiCalls7 }] }.
-- p_q — часть почты (без учёта регистра; % и _ — буквально), p_id — один
-- аккаунт, p_access — 'yes' или 'no': только с доступом к агенту или только
-- без него (total и страницы — уже по отобранным). Новые — первыми.
-- Старая подпись из четырёх аргументов снимается: рядом с новой (пятый — по
-- умолчанию) вызов по именам не отличил бы одну от другой.
drop function if exists public.admin_users_list(text, integer, integer, uuid);
create or replace function public.admin_users_list(
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_id uuid default null,
  p_access text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select u.id, u.email::text as email, u.created_at, u.last_sign_in_at,
           coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider
    from auth.users u
    where (p_id is null or u.id = p_id)
      and (coalesce(p_q, '') = ''
           or u.email ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_access is null
           or exists (select 1 from public.ai_access a where a.email = lower(u.email)) = (p_access = 'yes'))
  ),
  page as (
    select b.* from base b
    order by b.created_at desc, b.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  made as (
    select e.owner,
           count(*) filter (where e.entity = 'project') as projects,
           count(*) filter (where e.entity = 'task') as tasks
    from public.admin_created_entities() e
    where e.owner in (select p.id from page p)
    group by e.owner
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'createdAt', p.created_at,
        'lastSignInAt', p.last_sign_in_at,
        'provider', p.provider,
        'aiAccess', exists (select 1 from public.ai_access a where a.email = lower(p.email)),
        'projects', coalesce(m.projects, 0),
        'tasks', coalesce(m.tasks, 0),
        'lastActiveDay', greatest(
          (select max(x.day) from public.usage_daily x where x.user_id = p.id),
          (select (max(c.created_at) at time zone 'utc')::date from public.changes c where c.user_id = p.id),
          (select (max(a.created_at) at time zone 'utc')::date from public.ai_calls a where a.user_id = p.id),
          (p.last_sign_in_at at time zone 'utc')::date
        ),
        'feedback', (select count(*) from public.feedback f where f.user_id = p.id),
        'aiCalls7', (select count(*) from public.ai_calls a where a.user_id = p.id and a.created_at >= now() - interval '7 days')
      ) order by p.created_at desc, p.id)
      from page p left join made m on m.owner = p.id
    ), '[]'::jsonb)
  );
$$;

-- Почты аккаунтов по id — для списка отзывов и письма-ответа.
create or replace function public.admin_user_emails(p_ids uuid[])
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids);
$$;

-- Список приглашённых к агенту и есть ли на почту аккаунт.
create or replace function public.admin_access_list()
returns table (email text, note text, granted_at timestamptz, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a.email, a.note, a.granted_at,
         (select u.id from auth.users u where lower(u.email) = a.email limit 1)
  from public.ai_access a
  order by a.granted_at desc, a.email;
$$;

-- Права: функции admin_* — только service_role. Помощники (admin_ts,
-- admin_created_entities, admin_logins, admin_session_days) зовутся изнутри
-- и права не выдаются никому.
revoke all on function public.admin_ts(text) from public;
revoke all on function public.admin_ts(text) from anon, authenticated;
revoke all on function public.admin_created_entities() from public;
revoke all on function public.admin_created_entities() from anon, authenticated;
revoke all on function public.admin_logins(timestamptz) from public;
revoke all on function public.admin_logins(timestamptz) from anon, authenticated;
revoke all on function public.admin_session_days(timestamptz) from public;
revoke all on function public.admin_session_days(timestamptz) from anon, authenticated;
revoke all on function public.admin_overview(integer) from public;
revoke all on function public.admin_overview(integer) from anon, authenticated;
grant execute on function public.admin_overview(integer) to service_role;
revoke all on function public.admin_screens(integer) from public;
revoke all on function public.admin_screens(integer) from anon, authenticated;
grant execute on function public.admin_screens(integer) to service_role;
revoke all on function public.admin_users_list(text, integer, integer, uuid, text) from public;
revoke all on function public.admin_users_list(text, integer, integer, uuid, text) from anon, authenticated;
grant execute on function public.admin_users_list(text, integer, integer, uuid, text) to service_role;
revoke all on function public.admin_user_emails(uuid[]) from public;
revoke all on function public.admin_user_emails(uuid[]) from anon, authenticated;
grant execute on function public.admin_user_emails(uuid[]) to service_role;
revoke all on function public.admin_access_list() from public;
revoke all on function public.admin_access_list() from anon, authenticated;
grant execute on function public.admin_access_list() to service_role;

-- PostgREST узнаёт новые таблицы и функции сам; на всякий случай — сразу.
notify pgrst, 'reload schema';

-- Проверка: пять строк, все true.
select 'admin tables under RLS' as what,
       bool_and(c.relrowsecurity)::text as ok
from pg_class c
where c.oid in ('public.admin_users'::regclass, 'public.usage_daily'::regclass, 'public.feedback_replies'::regclass,
                'public.app_settings'::regclass, 'public.blog_posts'::regclass)
union all
select 'track_screen() for authenticated, not anon',
       (has_function_privilege('authenticated', 'public.track_screen(text, text)', 'execute')
        and not has_function_privilege('anon', 'public.track_screen(text, text)', 'execute'))::text
union all
select 'admin_overview() only for service_role',
       (has_function_privilege('service_role', 'public.admin_overview(integer)', 'execute')
        and not has_function_privilege('authenticated', 'public.admin_overview(integer)', 'execute')
        and not has_function_privilege('anon', 'public.admin_overview(integer)', 'execute'))::text
union all
select 'usage_daily closed to clients',
       (not has_table_privilege('authenticated', 'public.usage_daily', 'select')
        and not has_table_privilege('anon', 'public.usage_daily', 'select'))::text
union all
select 'feedback.status column',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'feedback' and column_name = 'status')::text;

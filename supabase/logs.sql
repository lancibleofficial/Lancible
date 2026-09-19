-- Lancible — журнал работы (страница /logs на лендинге).
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Схема приложения лежит рядом, в schema.sql; журнал держим
-- отдельным файлом, потому что к данным пользователей он отношения не имеет.
--
-- Зачем две таблицы, а не одна: лента на странице сгруппирована по задачам, и
-- у задачи есть собственное состояние (в работе → на проверке → принято →
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

-- Row Level Security. Страница /logs читает эти таблицы публичным anon-ключом,
-- поэтому чтение открыто всем. Политик на запись нет намеренно: писать может
-- только service_role, который RLS обходит и живёт вне браузера. Без этого
-- любой, кто откроет исходник страницы, смог бы дописать в журнал что угодно.
alter table work_log_tasks enable row level security;
alter table work_log_events enable row level security;

drop policy if exists "read work log tasks" on work_log_tasks;
drop policy if exists "read work log events" on work_log_events;

create policy "read work log tasks" on work_log_tasks for select using (true);
create policy "read work log events" on work_log_events for select using (true);

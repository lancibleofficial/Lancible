-- Lancible — схема Supabase. Выполнить один раз через
-- Supabase Dashboard → SQL Editor → New query → вставить целиком → Run.
--
-- profiles/user_settings нужны уже сейчас (вход + онбординг), projects/tasks/
-- sessions — задел под синхронизацию данных (следующий этап), но создаём всё
-- сразу, чтобы не возвращаться к SQL Editor повторно.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  use_case text,          -- для чего используют приложение (аналитика)
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  color text,
  description text,
  pinned_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists tasks (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  title text,
  done boolean default false,
  notes jsonb,
  total_ms bigint default 0,
  rate numeric,
  pinned_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references tasks(id) on delete cascade not null,
  start timestamptz not null,
  "end" timestamptz,
  ms bigint,
  rate numeric,
  kind text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hourly_rate numeric,
  currency text,
  theme text,
  lang text,
  updated_at timestamptz default now()
);

-- Row Level Security — обязательно: без этого anon-ключ (публичный, зашит в
-- приложение) даёт доступ ко ВСЕМ строкам таблицы, а не только своим.
alter table profiles enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table sessions enable row level security;
alter table user_settings enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own projects" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks" on tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sessions" on sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Lancible — синхронизация журналом правок (sync2).
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Повторный запуск безопасен: всё написано через
-- «if not exists» / «or replace» / «drop … if exists».
--
-- Зачем. До этого в облако уходило всё состояние одним JSON (sync_state):
-- кто последним отправил, тот и прав, и правки второго устройства, сделанные
-- офлайн, пропадали целиком. Теперь сервер хранит журнал правок по полям и
-- ничего в нём не меняет и не стирает; как правки сливаются на устройстве —
-- src/renderer/core/oplog.js (проект — tmp/design-sync-oplog.md, 17 октября
-- 2026).
--
-- ВАЖНО: выполнить ДО выкатки версий, которые пишут журнал (десктоп 0.5.0,
-- телефон 1.3.0). Старые версии продолжают жить на sync_state — его этот файл
-- не трогает, только добавляет колонку для моста (п. 5). Проверка —
-- tests/backend/sync2-rls.test.js (npm run test:backend): пока файл не
-- выполнен, она помечена todo.

-- 1. Журнал ------------------------------------------------------------------
-- Одна строка — правка одного поля одной сущности. seq — порядок на сервере;
-- он общий на всю таблицу, но под замком пользователя (триггер ниже) идёт по
-- времени фиксации: увидел строку с seq N — значит, все свои строки с
-- меньшим seq уже видны. На этом держится чтение «seq > lastSeq» на
-- устройстве: без замка строка, получившая seq раньше соседки, но
-- зафиксированная позже, проскочила бы мимо навсегда.
--
-- op_id — id правки, который дало устройство. Повтор отправки той же правки
-- (обрыв связи после записи, ответ не дошёл) отбивается уникальностью
-- (user_id, op_id): клиент шлёт с on_conflict=user_id,op_id и
-- resolution=ignore-duplicates — это insert … on conflict do nothing, права
-- на update для него не нужны.
--
-- device_id — случайный id установки приложения, не железа: по нему
-- устройство отличает свои правки от чужих и показывает в конфликте, с
-- какого устройства версия. Персональных данных в нём нет (это уходит и в
-- политику конфиденциальности).
create table if not exists public.changes (
  seq        bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 1 and 100),
  op_id      uuid not null,
  entity     text not null check (entity in ('project', 'task', 'status', 'tag', 'version', 'document')),
  entity_id  text not null check (char_length(entity_id) between 1 and 200),
  field      text not null check (char_length(field) between 1 and 100),
  value      jsonb,
  at         timestamptz not null,
  base_seq   bigint not null default 0 check (base_seq >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, op_id)
);

-- Чтение устройства — всегда «свои строки после seq по порядку».
create index if not exists changes_user_seq on public.changes (user_id, seq);

-- 2. Что сервер ставит сам ---------------------------------------------------
-- seq — после замка пользователя (см. п. 1). Значение по умолчанию у колонки
-- уже взято до триггера — оно просто пропадает дыркой в нумерации, это не
-- страшно: нумерация общая на всех пользователей и дырявая и так.
-- created_at — время сервера, присланное не берётся.
-- at — время правки на устройстве, но не дальше 5 минут в будущее: убежавшие
-- вперёд часы иначе выигрывали бы любой параллельный спор (побеждает более
-- поздняя правка). Ядро режет так же, от created_at строки.
-- base_seq — не больше последнего своего seq: правка не могла видеть того,
-- чего в журнале ещё нет; иначе ошибка клиента сделала бы её «видевшей» все
-- будущие правки, и она молча перекрывала бы их.
--
-- Функция — с правами вызывающего: max(seq) читает только свои строки (RLS),
-- nextval по последовательности колонки у ролей есть и так.
create or replace function public.changes_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  top bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('lancible.changes:' || new.user_id::text, 0));
  new.seq := nextval(pg_get_serial_sequence('public.changes', 'seq'));
  new.created_at := now();
  if new.at is null or new.at > now() + interval '5 minutes' then
    new.at := least(coalesce(new.at, now()), now() + interval '5 minutes');
  end if;
  select coalesce(max(c.seq), 0) into top from public.changes c where c.user_id = new.user_id;
  if new.base_seq > top then
    new.base_seq := top;
  end if;
  return new;
end;
$$;

drop trigger if exists changes_before_insert on public.changes;
create trigger changes_before_insert
  before insert on public.changes
  for each row execute function public.changes_before_insert();

-- 3. Слепки ------------------------------------------------------------------
-- Новое устройство не читает весь журнал: берёт последний слепок и правки
-- после него. data — блоб того же вида, что sync_state, плюс служебное
-- (корзина, конфликты, история полей) — core/oplog.js, compactSnapshot.
-- Два устройства, снявшие слепок на одном seq, не мешают друг другу:
-- второй insert отбивается ключом (23505), и это нормально.
create table if not exists public.snapshots (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seq        bigint not null check (seq >= 0),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, seq)
);

-- Слепок не может забегать вперёд журнала: устройство, взявшее такой слепок,
-- пропустило бы правки между настоящим концом журнала и этим seq.
create or replace function public.snapshots_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  top bigint;
begin
  select coalesce(max(c.seq), 0) into top from public.changes c where c.user_id = new.user_id;
  if new.seq > top then
    raise exception 'слепок на seq % впереди журнала (последний seq %)', new.seq, top
      using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists snapshots_before_insert on public.snapshots;
create trigger snapshots_before_insert
  before insert on public.snapshots
  for each row execute function public.snapshots_before_insert();

-- 4. Права -------------------------------------------------------------------
-- Ключ anon открыт, своего сервера у нас нет: от чужих данных отделяют только
-- политики. Читать и дописывать — свои строки. Менять и удалять — никому:
-- журнал только дописывается, иначе «ничего не теряется» держалось бы на
-- честном слове клиента. Политик на update/delete нет, а сами права отняты —
-- попытка получает 42501, а не тихие «ноль строк».
-- Удаление аккаунта (delete_my_account, legal.sql) уносит строки каскадом от
-- auth.users: каскад идёт с правами владельца таблицы, отнятые права ему не
-- мешают.
alter table public.changes enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists "own changes read" on public.changes;
create policy "own changes read" on public.changes
  for select using (auth.uid() = user_id);
drop policy if exists "own changes write" on public.changes;
create policy "own changes write" on public.changes
  for insert with check (auth.uid() = user_id);

drop policy if exists "own snapshots read" on public.snapshots;
create policy "own snapshots read" on public.snapshots
  for select using (auth.uid() = user_id);
drop policy if exists "own snapshots write" on public.snapshots;
create policy "own snapshots write" on public.snapshots
  for insert with check (auth.uid() = user_id);

revoke update, delete, truncate on public.changes from anon, authenticated;
revoke update, delete, truncate on public.snapshots from anon, authenticated;
grant select, insert on public.changes to authenticated;
grant select, insert on public.snapshots to authenticated;
grant usage on sequence public.changes_seq_seq to authenticated;

-- 5. Мост к старым клиентам --------------------------------------------------
-- Десктоп ≤ 0.4.4 и телефон ≤ 1.2.3 пишут sync_state целиком. Новый клиент
-- после каждого слияния зеркалит туда состояние и пишет в mirror_seq, на
-- каком seq журнала это зеркало. Старый клиент колонку не знает и не
-- присылает (upsert меняет только присланные колонки), поэтому в его записи
-- она остаётся seq зеркала, от которого он считал, — это baseSeq его правок
-- (core/oplog.js, legacyBridgeOps). Мост живёт один релиз.
alter table public.sync_state add column if not exists mirror_seq bigint;

-- 6. Realtime ----------------------------------------------------------------
-- Событие — только повод перечитать «seq > lastSeq»: строку из события
-- устройство не применяет (она могла обогнать соседку). Политика select
-- действует и здесь: чужие события не приходят.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'changes'
  ) then
    alter publication supabase_realtime add table public.changes;
  end if;
end;
$$;

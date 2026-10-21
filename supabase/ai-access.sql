-- Lancible — ИИ-агент по приглашению: кому открыт агент (21 октября 2026).
-- Выполнить: Supabase Dashboard → SQL Editor → New query → вставить целиком →
-- Run. Повторный запуск безопасен: всё через «if not exists», «or replace» и
-- «drop … if exists», выданный доступ он не трогает.
--
-- ВАЖНО — порядок, иначе агент закроется и для владельца:
--   1. выполнить этот файл;
--   2. добавить свою почту (ниже, «Как выдать доступ»);
--   3. выложить заново ai-chat и delete-account (supabase/functions/README.md,
--      «ИИ-агент по приглашению»).
-- Выложенная ai-chat закрыта по умолчанию: нет таблицы, нет строки, почта не
-- подтверждена — 403 { error: 'no access' }, к модели вызов не идёт.
--
-- Как выдать доступ. Table Editor → ai_access → Insert row → email — почта
-- аккаунта (регистр не важен: триггер ниже сам приводит её к нижнему, лишние
-- пробелы убирает), note — пометка для себя, необязательно → Save. Или в SQL
-- Editor:
--   insert into public.ai_access (email, note) values ('name@example.com', 'кто это');
-- Работает сразу: функция и клиенты спрашивают таблицу на каждом вызове,
-- выкладывать ничего не нужно.
--
-- Как забрать. Table Editor → ai_access → строка → Delete row. Или:
--   delete from public.ai_access where email = 'name@example.com';
-- Следующий вызов агента получит 403; чаты на устройстве человека остаются.
--
-- Кому выдавать. В проекте выключено «Confirm email» (mailer_autoconfirm —
-- почта считается подтверждённой сразу при регистрации), поэтому
-- email_confirmed_at не доказывает, что адрес принадлежит человеку. Выдавайте
-- доступ почте уже заведённого аккаунта (Authentication → Users — он там
-- есть) — тогда занять её чужим аккаунтом нельзя: второй аккаунт с той же
-- почтой Supabase не заведёт. Почта, на которую аккаунта ещё нет, открывает
-- агента тому, кто первым на неё зарегистрируется. Запрос доступа из
-- приложения приходит обратной связью с почтой аккаунта, отправившего его, —
-- такой адрес уже чей-то аккаунт.
--
-- Что здесь лежит. Почта (в нижнем регистре), пометка владельца и время
-- выдачи — больше ничего; ссылки на auth.users нет: доступ можно выдать и до
-- регистрации. Строка живёт, пока доступ выдан, и стирается вместе с
-- аккаунтом: функцией delete-account и триггером ai_access_forget ниже —
-- он ловит и старый путь удаления (delete_my_account у прежних версий
-- приложения) и удаление в панели. Политика, §11; COMPLIANCE.md.

create table if not exists public.ai_access (
  email text primary key,
  note text,
  granted_at timestamptz not null default now()
);

-- Почта — всегда в нижнем регистре и без пробелов по краям: функция ищет
-- строку по lower(email) пользователя, «Name@Mail.com » не нашлась бы
-- никогда. Ограничение — заново под тем же именем, чтобы повторный запуск
-- чинил и уже созданную таблицу.
alter table public.ai_access drop constraint if exists ai_access_email_lower;
alter table public.ai_access add constraint ai_access_email_lower
  check (email = lower(btrim(email)) and email like '%_@_%');

-- Владелец вставляет почту руками, часто копией из письма — с заглавными.
-- Приводим сами, до проверки: check выше остаётся последним словом.
create or replace function public.ai_access_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

revoke all on function public.ai_access_normalize() from public;
revoke all on function public.ai_access_normalize() from anon, authenticated;

drop trigger if exists ai_access_normalize on public.ai_access;
create trigger ai_access_normalize
  before insert or update of email on public.ai_access
  for each row execute function public.ai_access_normalize();

-- Клиентам таблица не нужна ни на чтение, ни на запись: доступ они узнают
-- через ai_has_access() ниже, функция — служебным ключом (он обходит RLS).
-- RLS включён, политик нет, права у anon и authenticated сняты явно: в
-- Supabase новые таблицы схемы public по умолчанию открыты им на всё.
alter table public.ai_access enable row level security;
revoke all on table public.ai_access from public;
revoke all on table public.ai_access from anon, authenticated;

-- Есть ли доступ у вошедшего: его почта подтверждена и есть в ai_access.
-- security definer — читать auth.users и ai_access вызывающему нельзя;
-- функция отвечает только про него самого (auth.uid()) и только да или нет.
-- search_path пуст, а имена полные: иначе security definer можно обмануть,
-- подложив одноимённую таблицу в свою схему. Почта в auth.users хранится,
-- как её передал вход, — сравниваем lower().
create or replace function public.ai_has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.ai_access a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

-- Звать может только вошедший; гостю (anon) — нет.
revoke all on function public.ai_has_access() from public;
revoke all on function public.ai_has_access() from anon;
grant execute on function public.ai_has_access() to authenticated;

-- Аккаунт удалён — его строка доступа тоже. Строку стирает и delete-account
-- (до удаления, служебным ключом); триггер — для остальных путей: прежние
-- версии приложения удаляют аккаунт через delete_my_account, владелец — в
-- панели. security definer: удаляет служебная роль Auth или вызывающий, прав
-- на ai_access у них нет. Сбой здесь удаление аккаунта не держит.
create or replace function public.ai_access_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is not null then
    begin
      delete from public.ai_access where email = lower(btrim(old.email));
    exception when others then
      null;
    end;
  end if;
  return old;
end;
$$;

revoke all on function public.ai_access_forget() from public;
revoke all on function public.ai_access_forget() from anon, authenticated;

-- Триггер на чужой схеме (auth) — в своём блоке: если прав на него не
-- окажется, таблица и ai_has_access() выше всё равно останутся (SQL Editor
-- выполняет файл одной транзакцией), а строку будет стирать только
-- delete-account. Третья строка проверки ниже тогда — false.
do $$
begin
  drop trigger if exists ai_access_forget on auth.users;
  create trigger ai_access_forget
    after delete on auth.users
    for each row execute function public.ai_access_forget();
exception when insufficient_privilege then
  raise warning 'ai_access_forget: нет прав на триггер в auth.users — строку стирает только delete-account';
end;
$$;

-- Проверка: три строки, все true — таблица под RLS, функция только для
-- authenticated, триггер стирания на месте.
select 'ai_access under RLS' as what, relrowsecurity::text as ok from pg_class where oid = 'public.ai_access'::regclass
union all
select 'ai_has_access() for authenticated, not anon',
       (has_function_privilege('authenticated', 'public.ai_has_access()', 'execute')
        and not has_function_privilege('anon', 'public.ai_has_access()', 'execute'))::text
union all
select 'ai_access_forget on auth.users',
       exists (select 1 from pg_trigger where tgname = 'ai_access_forget' and tgrelid = 'auth.users'::regclass)::text;

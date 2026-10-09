-- Lancible — хранилище картинок редактора. Выполнить один раз через
-- Supabase Dashboard → SQL Editor → New query → вставить целиком → Run.
--
-- Зачем. В тексте документа картинка — ссылка asset:<id>, а байты лежат
-- отдельно (src/editor/assets.js): данные пользователя уходят в
-- синхронизацию одним куском на каждое сохранение, и фотографии внутри
-- превратили бы каждое нажатие клавиши в мегабайтный запрос. На устройстве
-- байты живут в IndexedDB; сюда — копия, чтобы картинка доехала на другие
-- устройства того же человека.
--
-- Устройство: приватная корзина doc-assets, путь <id пользователя>/<id
-- картинки>. Видеть, класть и удалять можно только в своей папке. Пока этот
-- SQL не выполнен, приложение работает как раньше: картинки остаются на том
-- устройстве, где их вставили, и докачиваются в облако, как только корзина
-- появится (assets.flush() на входе в аккаунт).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-assets', 'doc-assets', false, 15728640,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Политики пересоздаются, чтобы файл можно было выполнить целиком ещё раз,
-- когда в нём что-то добавилось: create policy без drop падает на второй раз.
drop policy if exists "doc-assets: read own" on storage.objects;
drop policy if exists "doc-assets: insert own" on storage.objects;
drop policy if exists "doc-assets: update own" on storage.objects;
drop policy if exists "doc-assets: delete own" on storage.objects;

-- Первая папка пути — id пользователя. storage.foldername(name)[1] — она.
create policy "doc-assets: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "doc-assets: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- x-upsert: true при повторной загрузке того же файла — это update.
create policy "doc-assets: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "doc-assets: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Удаление аккаунта стирает и картинки (добавлено 10 октября 2026).
--
-- Политика (§6) и страница /delete-account обещают стереть всё сразу. Строки
-- в таблицах уходят каскадом от auth.users, а байты картинок лежат не в базе,
-- а в хранилище: строку storage.objects из SQL удалять нельзя — Supabase это
-- запрещает, и правильно, иначе файл осиротел бы без строки. Стереть байты
-- может только Storage API. Поэтому порядок такой:
--
--   1. клиент удаляет всё в своей папке doc-assets/<uid>/ через Storage API
--      (политика «delete own» выше это разрешает, чужую папку — нет);
--   2. клиент вызывает delete_my_account() (supabase/legal.sql).
--
-- Страж ниже держит этот порядок на стороне базы: аккаунт не удаляется, пока
-- в его папке что-то лежит, — ни функцией, ни из панели Supabase, ни старой
-- версией приложения, которая про шаг 1 не знает. Лучше громкий отказ, чем
-- тихо нарушенное обещание. Клиент узнаёт отказ по тексту
-- «account assets remain».

-- Сколько файлов вызывающего лежит в doc-assets. Права — вызывающего
-- (security invoker): считает ровно то, что ему и так видно по «read own».
create or replace function public.my_asset_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int from storage.objects
  where bucket_id = 'doc-assets' and (storage.foldername(name))[1] = auth.uid()::text;
$$;

revoke all on function public.my_asset_count() from public;
revoke all on function public.my_asset_count() from anon;
grant execute on function public.my_asset_count() to authenticated;

-- security definer: пользователя удаляет и служебная роль Auth (панель,
-- admin API), у которой нет права читать storage.objects.
create or replace function public.guard_account_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from storage.objects
    where bucket_id = 'doc-assets' and (storage.foldername(name))[1] = old.id::text
  ) then
    raise exception 'account assets remain'
      using errcode = 'P0001',
            hint = 'Сначала удалите файлы doc-assets/<id пользователя>/ через Storage API.';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_account_assets() from public;

drop trigger if exists guard_account_assets on auth.users;
create trigger guard_account_assets
  before delete on auth.users
  for each row execute function public.guard_account_assets();

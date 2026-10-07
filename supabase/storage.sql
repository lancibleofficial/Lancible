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

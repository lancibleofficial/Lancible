-- Lancible — корзина doc-assets принимает исходные PDF (17 октября 2026).
-- Выполнить один раз через Supabase Dashboard → SQL Editor → New query →
-- вставить целиком → Run. Повторный запуск ничего не ломает.
--
-- Зачем. С волной «PDF со слоями» (src/editor/pdfpage.js) редактор кладёт в
-- хранилище картинок (src/editor/assets.js) не только превью страниц, но и
-- сам PDF: из него «Сохранить как PDF» копирует векторные страницы
-- (src/editor/pdfwrite.js). Корзина из supabase/storage.sql принимает только
-- картинки и до 15 МБ, а PDF в редактор берётся до 20 МБ (pdf.js:
-- PDF_MAX_MB).
--
-- Пока этот SQL не выполнен, ничего не теряется: PDF живёт на устройстве,
-- где его вставили (IndexedDB lancible-assets), и выгрузка берёт его оттуда.
-- Облако его не принимает, запись в устройстве остаётся «ждёт выгрузки» и
-- уходит при следующем входе (assets.flush). На другом устройстве до этого
-- «Сохранить как PDF» собирает такие страницы из превью картинкой и говорит
-- об этом тостом.
--
-- Правила доступа — те же, что у картинок (storage.sql: своя папка
-- <id пользователя>/…), их здесь не трогаем. Удаление аккаунта стирает и PDF:
-- клиент очищает всю папку doc-assets/<uid>/ (supabase/storage.sql, блок про удаление аккаунта).

update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array(
         select distinct m from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['application/pdf']) as m
       )
 where id = 'doc-assets';

-- Проверка: должно показать 20971520 и список с application/pdf.
select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'doc-assets';

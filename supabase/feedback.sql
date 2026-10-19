-- Lancible — отзывы и сообщения об ошибках из приложения.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Повторный запуск безопасен: «if not exists», «create or
-- replace» и «drop … if exists».
--
-- Решение пользователя 17 октября 2026: форма в приложении пишет в таблицу,
-- а дальше запись пересылается в Telegram. С 19 октября 2026 пересылает
-- функция нашего сервера Supabase feedback-notify (supabase/functions), без
-- стороннего сервиса автоматизации; триггер, колонку notified_at и
-- ежедневную уборку старше 12 месяцев заводит supabase/feedback-bot.sql —
-- выполнить после этого файла. Ничего не теряется, даже если пересылка не
-- настроена: неотправленные строки досылаются (запрос в конце
-- feedback-bot.sql).
--
-- Писать может и гость (user_id null), и вошедший — свои строки; читать
-- вошедший может только свои. Служебный ключ читает всё (панель/пересылка).
-- Проверка — tests/backend/feedback-rls.test.js (npm run test:backend) и
-- tests/unit/supabase-sql.test.js (текст этого файла).
--
-- 19 октября 2026: обращения вошедшего удаляются вместе с аккаунтом
-- (on delete cascade; раньше — set null, и текст, устройство и путь к снимку
-- переживали удаление). Снимки в бакете feedback каскадом не уходят — их
-- стирает функция delete-account до удаления пользователя
-- (supabase/functions/delete-account). Обращения гостя (без user_id) живут
-- до разбора, но не дольше 12 месяцев (по сроку их и снимки стирает
-- задание feedback-sweep из feedback-bot.sql); копия в рабочем чате Telegram
-- удаляется командой вручную после разбора и тоже не позже 12 месяцев
-- (решение 1 волны 19 октября, COMPLIANCE.md). Уже созданную таблицу файл чинит сам: внешний
-- ключ пересоздаётся ниже — выполнить файл заново.
--
-- 19 октября 2026, позже: разумное ограничение (решение пользователя
-- «Давай поставим разумное ограничение»). До этого ключ anon вставлял строки
-- без предела частоты, и каждая уходила в Telegram, а в бакет feedback можно
-- было положить любой файл по любому пути. Теперь:
--   1. Сначала строка, потом снимок. Клиент сам заводит id строки (uuid) и
--      путь снимка <id>.<png|jpg|webp>, вставляет строку с screenshot_path и
--      только потом грузит файл. Повтор после сбоя загрузки строку второй
--      раз не вставляет — только догружает снимок.
--   2. Бакет принимает только ожидаемый снимок: файл с именем, которое
--      названо в screenshot_path строки не старше 15 минут
--      (public.feedback_shot_expected). Формат пути держит check таблицы.
--   3. Частота — триггер feedback_rate: вошедший — не больше 5 строк за
--      10 минут и 20 за сутки; гости — 30 строк в час на всех вместе. Сверх —
--      ошибка 'feedback rate' (код P0001); клиенты показывают строку
--      feedback.rate, текст в поле остаётся. Время строки ставит база, а не
--      клиент: иначе created_at из прошлого обходил бы и предел, и 15 минут.
--
-- ПОРЯДОК ВЫКАТКИ. Новые клиенты (строка, потом снимок) работают и со старой
-- базой. Старые (десктоп до этой версии, APK до этой версии) грузят снимок
-- ДО строки — новая политика бакета им откажет, и сообщение со снимком у них
-- не уйдёт совсем (без снимка — уйдёт). Поэтому этот файл выполнять после
-- выхода веба, десктопа и APK с новым порядком — или принять, что на старых
-- версиях до обновления снимок не отправляется.
--
-- Для пересылки: триггер feedback-bot.sql срабатывает на вставку строки, то
-- есть ДО загрузки снимка. Функция feedback-notify берёт снимок из бакета с
-- повторами (сразу, через 5, 10, 20, 30 и 60 с); нет файла и после этого —
-- отвечает в чате «снимок не загрузился» (загрузка не удалась или человек
-- закрыл форму). Позже 15 минут после строки снимок уже не примут.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  text text not null check (char_length(text) between 1 and 4000),
  platform text not null check (platform in ('web', 'desktop', 'android', 'ios')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  lang text check (lang is null or char_length(lang) <= 8),
  device text check (device is null or char_length(device) <= 200),
  -- Путь к снимку экрана в приватном бакете feedback (<uuid>.<png|jpg|webp>);
  -- null — без снимка. Формат — ограничение feedback_screenshot_path_check ниже.
  screenshot_path text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created on feedback (created_at desc);

-- Внешний ключ на auth.users — заново и с cascade: create table if not exists
-- уже созданную таблицу не трогает, а до 19 октября ключ был on delete set
-- null. Имя — то, что Postgres дал ключу из строки user_id выше
-- (<таблица>_<колонка>_fkey); повторный запуск просто пересоздаёт его.
alter table feedback drop constraint if exists feedback_user_id_fkey;
alter table feedback add constraint feedback_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
-- Строки одного пользователя функция delete-account выбирает по user_id.
create index if not exists feedback_user on feedback (user_id) where user_id is not null;

-- Путь снимка — ровно <uuid>.<png|jpg|webp> в корне бакета: ни папок, ни
-- «../», ни чужих имён. До 19 октября путь проверялся только длиной (то же
-- имя ограничения — его дал Postgres колонке), поэтому оно пересоздаётся;
-- not valid — уже лежащие строки не перепроверяются, новые — всегда.
alter table feedback drop constraint if exists feedback_screenshot_path_check;
alter table feedback add constraint feedback_screenshot_path_check
  check (screenshot_path is null or screenshot_path ~ '^[0-9a-f-]{36}\.(png|jpg|webp)$') not valid;
-- По пути снимка его ищет политика бакета ниже; гостей считает триггер.
create index if not exists feedback_shot on feedback (screenshot_path) where screenshot_path is not null;
create index if not exists feedback_guest_created on feedback (created_at) where user_id is null;

alter table feedback enable row level security;

-- Вставка: гость — только без user_id; вошедший — только со своим.
drop policy if exists "feedback insert" on feedback;
create policy "feedback insert" on feedback
  for insert with check (user_id is null or auth.uid() = user_id);

-- Чтение: только свои строки вошедшего. Гостю читать нечего.
drop policy if exists "feedback own select" on feedback;
create policy "feedback own select" on feedback
  for select using (auth.uid() is not null and auth.uid() = user_id);

-- Изменять и удалять с ключом anon нельзя: политик update/delete нет, и
-- права сняты явно — иначе PostgREST отвечал бы «0 строк», а не отказом
-- 42501, и tests/backend/feedback-rls.test.js не отличил бы запрет от
-- промаха по фильтру.
revoke update, delete on feedback from anon, authenticated;

-- Частота (19 октября 2026). security definer: вставляющему читать чужие
-- строки нельзя, а считать надо все. Порядок в Postgres — сначала этот
-- триггер, потом политика вставки, потом ограничения таблицы.
create or replace function public.feedback_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
  daily integer;
begin
  -- Время строки — время базы: created_at из прошлого выпал бы из окон
  -- подсчёта, из будущего — продлил бы 15 минут на снимок.
  new.created_at := now();
  -- Та же строка второй раз (ответ на первую вставку потерялся) — не новое
  -- сообщение: пусть упрётся в первичный ключ (23505), клиент считает это
  -- успехом.
  if exists (select 1 from public.feedback f where f.id = new.id) then
    return new;
  end if;
  if new.user_id is not null then
    -- Чужой user_id отсечёт политика вставки (42501), считать его строки
    -- незачем; служебный ключ (auth.uid() null) не ограничивается.
    if new.user_id is distinct from auth.uid() then
      return new;
    end if;
    -- Две вкладки одного человека не проскочат предел одновременно.
    perform pg_advisory_xact_lock(hashtext('feedback rate ' || new.user_id::text));
    select count(*) filter (where f.created_at > now() - interval '10 minutes'), count(*)
      into recent, daily
      from public.feedback f
      where f.user_id = new.user_id and f.created_at > now() - interval '1 day';
    if recent >= 5 or daily >= 20 then
      raise exception 'feedback rate'
        using errcode = 'P0001',
              hint = 'С аккаунта — не больше 5 сообщений за 10 минут и 20 за сутки.';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('feedback rate guests'));
    select count(*) into recent
      from public.feedback f
      where f.user_id is null and f.created_at > now() - interval '1 hour';
    if recent >= 30 then
      raise exception 'feedback rate'
        using errcode = 'P0001',
              hint = 'От гостей — не больше 30 сообщений в час на всех.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.feedback_rate_guard() from public;
revoke all on function public.feedback_rate_guard() from anon, authenticated;

drop trigger if exists feedback_rate on feedback;
create trigger feedback_rate
  before insert on feedback
  for each row execute function public.feedback_rate_guard();

-- Снимки экрана — приватный бакет: прочитать — только служебный ключ.
-- Положить — только ожидаемый снимок: имя файла названо в screenshot_path
-- строки, которой не больше 15 минут. Перезаписать нельзя (прав update нет),
-- поэтому одна строка — один файл.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('feedback', 'feedback', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

-- security definer: гость таблицу feedback не читает (политики select для
-- него нет), а проверить строку нужно.
create or replace function public.feedback_shot_expected(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feedback f
    where f.screenshot_path = object_name
      and f.created_at > now() - interval '15 minutes'
  );
$$;

revoke all on function public.feedback_shot_expected(text) from public;
grant execute on function public.feedback_shot_expected(text) to anon, authenticated;

drop policy if exists "feedback upload" on storage.objects;
create policy "feedback upload" on storage.objects
  for insert with check (bucket_id = 'feedback' and public.feedback_shot_expected(name));
-- select/update/delete для anon и authenticated на этот бакет не выдаются.

-- Пересылка в Telegram — не здесь, а в supabase/feedback-bot.sql: триггер
--   после вставки зовёт функцию feedback-notify через pg_net с одним id
--   строки. Database Webhook в панели для этого не нужен (если его заводили
--   — удалить: Database → Webhooks). Снимка в бакете в момент вставки ещё
--   нет — см. заметку о пересылке в шапке.

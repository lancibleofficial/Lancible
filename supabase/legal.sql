-- Lancible — согласия, удаление аккаунта и минимум данных.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Повторный запуск безопасен: всё написано через
-- «if not exists» / «or replace».
--
-- ВАЖНО: выполнить ДО выкатки версии приложения, которая пишет эти поля.
-- Без колонок ниже онбординг не сможет сохранить профиль. Проверка —
-- tests/backend/rls.test.js (npm run test:backend): пока файл не выполнен,
-- она красная.

-- 1. Согласие с Условиями и Политикой ---------------------------------------
-- Какую редакцию человек принял, когда и подтвердил ли, что ему есть 16.
-- Версия — дата редакции документов, та же, что TERMS_VERSION в
-- src/renderer/core/legal.js. Поднимется версия — приложение спросит
-- согласие заново.
alter table profiles add column if not exists terms_version text;
alter table profiles add column if not exists terms_accepted_at timestamptz;
alter table profiles add column if not exists age_confirmed boolean not null default false;

-- 2. Лишнее не храним ---------------------------------------------------------
-- profiles.email — копия адреса из auth.users. Её никто не читает: приложение
-- берёт адрес из сессии. С этой версии клиенты её больше не пишут, а
-- накопленное стираем. Сама колонка остаётся, чтобы старые версии
-- приложения, которые ещё пишут её, не падали.
update profiles set email = null where email is not null;

-- 3. Удаление аккаунта самим пользователем -----------------------------------
-- Клиент держит только ключ anon, удалить строку из auth.users он не может.
-- Функция выполняется с правами владельца (security definer) и удаляет
-- ровно одного пользователя — того, кто её вызвал (auth.uid()). Всё
-- остальное уходит каскадом: profiles, projects, tasks, sessions,
-- user_settings, sync_state ссылаются на auth.users с on delete cascade
-- (schema.sql).
--
-- search_path пуст, а имена полные: иначе security definer можно обмануть,
-- подложив одноимённую таблицу в свою схему.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = me;
end;
$$;

-- Вызывать может только вошедший. У anon права нет вовсе — функция и так
-- отказала бы ему, но лучше, чтобы до неё не доходило.
revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

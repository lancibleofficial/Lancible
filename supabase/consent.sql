-- Lancible — редакция условий в профиле не откатывается назад.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → вставить целиком →
-- Run. Повторный запуск безопасен. Можно вместе с storage.sql.
--
-- Зачем (10 октября 2026). Клиент спрашивает согласие, когда принятая
-- редакция (profiles.terms_version) не совпадает с его собственной
-- TERMS_VERSION, — и записывает свою. Установленные десктоп 0.4.0 и телефон
-- 1.2.1 знают только редакцию 2026-10-07: человека, который уже принял
-- 2026-10-10 на вебе, они переспросят и перепишут версию обратно. След
-- принятия новой редакции пропал бы. Поправить старые клиенты нельзя — они
-- уже установлены, поэтому правило держит база.
--
-- Правило: terms_version не уменьшается. Если пришла редакция старше
-- записанной (или пустая), остаются записанные terms_version и
-- terms_accepted_at — это и есть след принятия более новой редакции.
-- Новая редакция записывается как обычно. Даты редакций — ISO (ГГГГ-ММ-ДД),
-- строкой сравниваются верно.
--
-- Колонки согласия заводит supabase/legal.sql; без них функция не нужна.

create or replace function public.keep_newest_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.terms_version is not null
     and (new.terms_version is null or new.terms_version < old.terms_version) then
    new.terms_version := old.terms_version;
    new.terms_accepted_at := old.terms_accepted_at;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_newest_terms() from public;

-- before update ловит и update, и upsert (ветка on conflict do update):
-- клиенты пишут согласие обоими путями.
drop trigger if exists keep_newest_terms on public.profiles;
create trigger keep_newest_terms
  before update on public.profiles
  for each row execute function public.keep_newest_terms();

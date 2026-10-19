-- Lancible — отзывы из формы в рабочий чат Telegram и уборка старше 12 месяцев.
-- Выполнить: Supabase Dashboard → SQL Editor → New query → вставить целиком →
-- Run. Повторный запуск безопасен: «if not exists», «create or replace»,
-- «drop … if exists», а задание уборки перед заведением снимается по имени.
--
-- ПОРЯДОК (supabase/functions/README.md, «feedback-notify: настройка»):
-- сначала supabase/feedback.sql (таблица и бакет), потом секреты бота и
-- выкладка функции feedback-notify, и только потом этот файл. Выполненный
-- раньше функции, он ничего не сломает: вызовы получат 404, отзывы
-- сохранятся как раньше, а неотправленные потом можно дослать запросом
-- в конце файла.
--
-- Решение пользователя 19 октября 2026 («Давай еще подготовим телеграм бота
-- по фидбеку»): функция Supabase шлёт отзывы прямо в Telegram, без
-- стороннего сервиса автоматизации, и база сама стирает отзывы старше
-- 12 месяцев. Кнопок у бота нет: копии в Telegram команда удаляет руками
-- после разбора, не позже 12 месяцев (Политика, §6).
--
-- Как устроено:
--   1. notified_at — когда строка ушла в Telegram. Функция «захватывает»
--      строку одним update … where notified_at is null, поэтому повтор
--      вызова не даёт дубля, а подделанный вызов может лишь переслать уже
--      существующую неотправленную строку.
--   2. Триггер feedback_notify после вставки зовёт функцию через pg_net с
--      телом { id } — больше ничего из строки в запрос не идёт, функция
--      перечитывает её сама. pg_net шлёт запрос только после фиксации
--      транзакции и не ждёт ответа: вставка не медленнее и не падает, даже
--      если функция недоступна (ошибка pg_net — warning, строка сохраняется).
--   3. Задание pg_cron feedback-sweep каждый день в 03:15 UTC зовёт функцию
--      с { action: 'sweep' }: строки старше 12 месяцев и их снимки, а также
--      файлы бакета feedback старше 12 месяцев без строки. Снимки стирает
--      функция через Storage API: прямой delete из storage.objects файл из
--      хранилища не убирает (документация Supabase, Storage → Delete
--      objects: «should always be done via the Storage API»).
--
-- Ключ в заголовках — публичный ключ anon, тот же, что в клиентах
-- (src/renderer/app.js, mobile/src/lib/supabaseClient.js): функция выложена
-- с «Verify JWT», и ей нужен любой настоящий JWT проекта. Служебный ключ
-- сюда не кладётся никогда: SQL-файлы лежат в открытом репозитории, а
-- функция берёт служебный ключ из своего окружения сама. Сверка —
-- tests/unit/supabase-sql.test.js.
--
-- Расширения pg_net и pg_cron включаются этим же файлом (так, как пишет
-- документация Supabase: pg_net — в схему extensions, pg_cron — в
-- pg_catalog). Если SQL Editor откажет в create extension — включить их в
-- панели: Database → Extensions → pg_net и pg_cron (или Integrations → Cron)
-- → Enable, и выполнить файл ещё раз.
--
-- Если для пересылки уже заводили Database Webhook в панели (Database →
-- Webhooks, на вставку в feedback) — удалить его: этот триггер его заменяет.
-- Двойной вызов функции дубля не даст, но вебхук отдавал бы строку целиком
-- туда, куда указывал.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 1. Когда строка ушла в Telegram; null — ещё не ушла (или отправка не
-- удалась и захват снят).
alter table public.feedback add column if not exists notified_at timestamptz;
-- Неотправленные — для запроса «дослать» в конце файла.
create index if not exists feedback_pending on public.feedback (created_at) where notified_at is null;

-- Вызов функции feedback-notify. Адрес и ключ — в одном месте: их берут и
-- триггер, и задание уборки, и ручной «дослать». Возвращает id запроса
-- pg_net (ответ — в net._http_response, хранится 6 часов).
-- security definer: триггер срабатывает от имени вставляющего (anon), а
-- звать pg_net ему незачем; самой функции у anon и authenticated нет.
create or replace function public.feedback_bot_call(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  return net.http_post(
    url := 'https://yiglgfkjjvwijukdzutw.supabase.co/functions/v1/feedback-notify',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck'
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.feedback_bot_call(jsonb) from public;
revoke all on function public.feedback_bot_call(jsonb) from anon, authenticated;

-- 2. После вставки — { id } в функцию. Ошибка pg_net вставку не держит:
-- отзыв важнее уведомления, а неотправленный можно дослать.
create or replace function public.feedback_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.feedback_bot_call(jsonb_build_object('id', new.id));
  exception when others then
    raise warning 'feedback_notify: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.feedback_notify() from public;
revoke all on function public.feedback_notify() from anon, authenticated;

drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify
  after insert on public.feedback
  for each row execute function public.feedback_notify();

-- 3. Уборка раз в сутки, 03:15 UTC. cron.schedule с тем же именем и так
-- заменяет задание, но снимаем его явно: повторный запуск файла не должен
-- плодить задания ни при какой версии pg_cron.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'feedback-sweep') then
    perform cron.unschedule('feedback-sweep');
  end if;
end;
$$;

select cron.schedule(
  'feedback-sweep',
  '15 3 * * *',
  $cron$select public.feedback_bot_call('{"action": "sweep"}'::jsonb)$cron$
);

-- Проверка (выполнить отдельно, по желанию):
--   select jobname, schedule, command from cron.job where jobname = 'feedback-sweep';
--   — одна строка, '15 3 * * *';
--   select id, status_code, error_msg, created from net._http_response order by created desc limit 5;
--   — ответы функции: 202 — отправка пошла, 200 — уже отправлена,
--     404 — функция не выложена, 500 — нет секретов бота.
--
-- Дослать неотправленные (после настройки бота или сбоя Telegram) —
-- выполнить отдельно; функция возьмёт каждую строку один раз:
--   select public.feedback_bot_call(jsonb_build_object('id', id))
--     from public.feedback where notified_at is null order by created_at;

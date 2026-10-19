-- Lancible — журнал вызовов ИИ-агента (Edge Function ai-chat).
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Повторный запуск безопасен: всё написано через
-- «if not exists» / «drop … if exists».
--
-- ВАЖНО: выполнить ДО выкладки функции ai-chat (supabase/functions/README.md).
-- Без таблицы функция отвечает 500 { error: 'journal' } на каждый вызов: по
-- ней она считает дневной лимит.
--
-- Что здесь лежит и чего нет. Строка — один вызов модели: кто, когда, какой
-- моделью, тратит ли он дневной лимит и сколько токенов ушло. Текста
-- переписки и данных пользователя здесь нет и не будет — ни запроса, ни
-- ответа, ни снимка задач (privacy.html, раздел про ИИ-агента).
--
-- counted — тратит ли вызов лимит: сообщение человека с текстом или вложением — да,
-- продолжение круга инструментов (последнее сообщение — одни tool_result) —
-- нет; модель не ответила (сеть, не 2xx) — функция снимает отметку, чтобы
-- сбой не съедал сообщение. Лимит — строки с counted за сутки UTC.
--
-- input_tokens — весь промпт вызова: свежие токены плюс записанные в кеш и
-- прочитанные из него. stop_reason — как у Anthropic (end_turn, tool_use,
-- max_tokens, refusal…), либо 'cancelled' (закрыли панель на полуслове),
-- 'error:<вид>' (ошибка посреди потока), 'http_<код>' / 'network' (модель не
-- ответила).

create table if not exists ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  counted boolean not null default true,
  input_tokens integer,
  output_tokens integer,
  ms integer,
  stop_reason text,
  created_at timestamptz not null default now()
);

-- Счёт лимита — «мои строки с сегодняшней полуночи UTC»: по этому индексу.
create index if not exists ai_calls_user_day on ai_calls (user_id, created_at desc);

-- Читать свои строки может сам пользователь (счётчик в приложении). Писать —
-- только служебный ключ функции: он обходит RLS, а политик на insert, update
-- и delete нет, так что ключ anon и вход пользователя записать ничего не могут.
-- Строки уходят вместе с аккаунтом (on delete cascade, delete_my_account).
alter table ai_calls enable row level security;

drop policy if exists "ai calls: read own" on ai_calls;
create policy "ai calls: read own" on ai_calls
  for select using (auth.uid() = user_id);

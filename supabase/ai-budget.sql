-- Lancible — бюджет ИИ-агента по цене (Edge Function ai-chat), 19 октября 2026.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → New query → вставить
-- целиком → Run. Повторный запуск безопасен: «add column if not exists».
-- Нужна таблица ai_calls (supabase/ai.sql).
--
-- Зачем. Лимит в 50 сообщений в сутки не держит цену: одно сообщение с
-- длинной историей, снимком на 120 КБ и PDF стоит как сотня коротких. С этими
-- колонками функция записывает цену каждого вызова и в начале следующего
-- сверяет сумму за сутки UTC с бюджетом AI_DAILY_UNITS (секрет функции, по
-- умолчанию 4 000 000) — набралось: 429 { error: 'budget', retryAfter }, к
-- модели вызов не идёт.
--
-- Что добавляется (по итогу потока, отдельной правкой после токенов):
--   cache_read_tokens  — токенов прочитано из кеша промпта Anthropic;
--   cache_write_tokens — токенов записано в кеш;
--   cost_units         — цена вызова в единицах: свежий вход × 1, запись в
--                        кеш × 1,25 (часовая × 2), чтение из кеша × 0,05,
--                        выход × 5 — множители цен claude-sonnet-5-5
--                        (supabase/functions/ai-chat/index.ts, UNIT).
-- input_tokens остаётся как был — весь промпт вызова (свежие + запись +
-- чтение); свежие = input_tokens − cache_read_tokens − cache_write_tokens.
-- Ни текста, ни данных пользователя здесь нет — только числа (privacy.html,
-- §11). NULL в cost_units — вызов прежней функции, оборванный до первого
-- кадра или не дошедший до модели: в сумму он идёт нулём.
--
-- Индекс. Сумма — по «моим строкам с сегодняшней полуночи UTC»: это тот же
-- ai_calls_user_day (user_id, created_at desc) из ai.sql, по которому уже
-- считается лимит; строк у человека за сутки — не больше 5 × AI_DAILY_LIMIT
-- (250), отдельный индекс не нужен.
--
-- Порядок не важен. Без колонок функция работает как раньше: чтение
-- cost_units отвечает 42703, и она считает лимит без бюджета, а правка цены
-- после потока молча не проходит. Выполнить можно до выкладки новой функции
-- или после; прежняя функция колонки просто не заполняет.

alter table ai_calls add column if not exists cache_read_tokens integer;
alter table ai_calls add column if not exists cache_write_tokens integer;
alter table ai_calls add column if not exists cost_units integer;

-- Проверка: три строки — cache_read_tokens, cache_write_tokens, cost_units.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_calls'
  and column_name in ('cache_read_tokens', 'cache_write_tokens', 'cost_units')
order by column_name;

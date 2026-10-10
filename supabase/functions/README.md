# Supabase Edge Functions

Служебные функции без страниц — исключение из правила «один адрес»
(CLAUDE.md). Живут по адресу `<проект>.supabase.co/functions/v1/<имя>`.

| Функция | Что делает | Тест |
|---|---|---|
| `delete-account` | Стирает `doc-assets/<uid>/` и удаляет аккаунт вызывающего одним запросом | `tests/backend/account-delete-function.test.js` |

## Выкладка

Секреты заводить не нужно: `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` у
функций есть по умолчанию. Выкладывает пользователь — одним из способов:

1. **Панель** (по умолчанию): Supabase Dashboard → Edge Functions → Deploy a
   new function → имя `delete-account` → вставить `delete-account/index.ts`
   целиком → Deploy. «Verify JWT» оставить включённым.
2. **Командой**: `npx supabase login`, затем
   `npx supabase functions deploy delete-account --project-ref yiglgfkjjvwijukdzutw`.

После выкладки — `LANCIBLE_ACCOUNT_TEST=1 npm run test:backend`: тест
заводит двух временных пользователей и проверяет функцию.

## Откат

Dashboard → Edge Functions → `delete-account` → Delete. Клиенты, не нашедшие
функцию (404), удаляют аккаунт старым путём: стирание папки на клиенте и
`delete_my_account`.

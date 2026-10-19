// Удаление аккаунта одним вызовом на сервере — Supabase Edge Function.
//
//   POST <проект>.supabase.co/functions/v1/delete-account
//   Authorization: Bearer <токен входа пользователя>
//
// Зачем, если есть delete_my_account (supabase/legal.sql). Клиент стирал
// папку doc-assets/<uid>/ сам и потом звал функцию в базе: между двумя
// шагами мог случиться сбой, а страж (storage.sql) в ответ показывал старым
// клиентам общее «проверьте соединение». Здесь оба шага делает сервер со
// служебным ключом, и клиент получает понятный ответ:
//
//   200 { deleted: true }          — аккаунт и картинки удалены
//   200 { deleted: true, screenshots: 'remain', detail }
//                                  — аккаунт удалён, а снимки экрана из
//                                    обратной связи стереть не вышло: пути
//                                    — в логе функции, стереть руками
//   401 { error: 'not signed in' } — нет входа или токен не пользователя
//   405                            — не POST
//   409 { error: 'assets remain' } — картинки стереть не вышло; аккаунт цел,
//                                    повторить
//   500 { error: 'delete failed' } — картинки стёрты, аккаунт удалить не вышло
//
// Старый путь (стирание на клиенте + delete_my_account) и страж остаются для
// установленных версий приложения.
//
// Обратная связь (19 октября 2026, supabase/feedback.sql): строки feedback
// этого пользователя уходят каскадом вместе с ним, а снимки экрана в бакете
// feedback — нет, и стереть их клиент не может (политик у бакета нет).
// Поэтому до удаления функция служебным ключом берёт screenshot_path из его
// строк и стирает эти файлы. Сбой здесь удаление не держит: человек просил
// удалить аккаунт, и отказ из-за снимка был бы хуже. Сбой пишется в лог
// (пути — <uuid>.png, без uid и почты) и в ответ.
//
// Секреты заводить не нужно: SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY у Edge
// Functions есть по умолчанию. Выкладка — supabase/functions/README.md.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'doc-assets';
const FEEDBACK_BUCKET = 'feedback';
// Снимок обратной связи клиент кладёт в корень бакета как <uuid>.<png|jpg|webp>
// (app.js, mobile/src/lib/feedback.js). Путь в строку пишет сам клиент,
// поэтому стираются только такие имена: «../…» или чужая папка не пройдут.
const SHOT_RE = /^[A-Za-z0-9-]{1,100}\.(?:png|jpe?g|webp)$/i;
const PAGE = 1000;
// Предел кругов стирания: 100 × 1000 картинок — с запасом на любого
// человека. Дальше — 409, а не цикл без конца на сервере у всех.
const MAX_ROUNDS = 100;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { error: 'not signed in' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Кто зовёт — только по токену входа. Ключ anon тоже JWT, но пользователя
  // за ним нет: getUser ответит ошибкой, и это 401.
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  const uid = who?.user?.id;
  if (whoErr || !uid) return reply(401, { error: 'not signed in' });

  // Стираем свою папку, пока список не опустеет: за раз приходит не больше
  // PAGE имён. Только папка этого uid — путь собирается из проверенного id.
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) return reply(409, { error: 'assets remain', detail: 'too many rounds' });
    const { data: page, error: listErr } = await admin.storage.from(BUCKET).list(uid, { limit: PAGE });
    if (listErr) return reply(409, { error: 'assets remain', detail: listErr.message });
    const paths = (page || []).filter((o) => o.id).map((o) => `${uid}/${o.name}`);
    if (!paths.length) break;
    const { data: removed, error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) return reply(409, { error: 'assets remain', detail: rmErr.message });
    // Ошибки нет, но ничего не стёрто — список не сократится, и цикл крутился
    // бы вхолостую. Со служебным ключом так быть не должно; если всё же —
    // это 409, а не вечный цикл.
    if (!removed || !removed.length) return reply(409, { error: 'assets remain', detail: 'nothing removed' });
  }

  // Снимки обратной связи — после картинок: если те не стёрлись (409),
  // аккаунт остаётся, и снимки вместе с ним.
  const shots = await removeScreenshots(admin, uid)
    .catch((e) => ({ detail: String((e as Error)?.message || e), paths: [] as string[] }));
  if (shots) console.error('delete-account: feedback screenshots remain', shots.detail, shots.paths);

  // Строки в таблицах уходят каскадом от auth.users. Если картинка успела
  // доехать между стиранием и удалением, страж из storage.sql откажет —
  // это тот же 409: повторить.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    if (/account assets remain/i.test(delErr.message)) return reply(409, { error: 'assets remain' });
    return reply(500, { error: 'delete failed', detail: delErr.message });
  }
  return reply(200, shots ? { deleted: true, screenshots: 'remain', detail: shots.detail } : { deleted: true });
});

/** Стирает снимки экрана из строк feedback пользователя uid. null — всё
 *  стёрто, стирать нечего или таблицы ещё нет (feedback.sql не выполнен);
 *  иначе — почему не вышло и какие пути остались. Экспорт — как у ai-chat:
 *  функцию зовёт обработчик Deno.serve, которого граф кода не разбирает. */
export async function removeScreenshots(admin: ReturnType<typeof createClient>, uid: string): Promise<{ detail: string; paths: string[] } | null> {
  const paths: string[] = [];
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) return { detail: 'too many rounds', paths };
    const from = round * PAGE;
    const { data, error } = await admin.from('feedback')
      .select('screenshot_path')
      .eq('user_id', uid)
      .not('screenshot_path', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') return null;
      return { detail: error.message, paths };
    }
    const rows = (data || []) as { screenshot_path: unknown }[];
    for (const r of rows) {
      const p = r.screenshot_path;
      if (typeof p === 'string' && SHOT_RE.test(p) && !paths.includes(p)) paths.push(p);
    }
    if (rows.length < PAGE) break;
  }
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(FEEDBACK_BUCKET).remove(paths.slice(i, i + PAGE));
    if (error) return { detail: error.message, paths: paths.slice(i) };
  }
  return null;
}

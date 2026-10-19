// Обратная связь → рабочий чат команды в Telegram — Supabase Edge Function.
//
//   POST <проект>.supabase.co/functions/v1/feedback-notify
//   Authorization: Bearer <ключ anon>       («Verify JWT» включён)
//
// Решение пользователя 19 октября 2026: отзывы из формы (supabase/feedback.sql)
// уходят в Telegram этой функцией, без стороннего сервиса автоматизации, а
// строки и снимки старше 12 месяцев стираются сами. Зовёт её база
// (supabase/feedback-bot.sql): триггер после вставки строки — через pg_net с
// телом { id }, ежедневное задание pg_cron — с { action: 'sweep' }.
//
// Вызовы:
//
//   { id }  или тело Database Webhook { type: 'INSERT', table: 'feedback',
//   record: { id, … } } — переслать отзыв. Из тела берётся ТОЛЬКО id: строка
//   перечитывается служебным ключом и «захватывается» один раз —
//   update feedback set notified_at = now() where id = $1 and notified_at
//   is null, с возвратом строки. Не захватилась (уже отправлена или такой
//   нет) — ничего не делаем. Поэтому подделанный вызов может лишь переслать
//   уже существующую неотправленную строку, а повтор вебхука не даёт дубля.
//     202 { queued: true }     — захвачена, отправка идёт в фоне
//     200 { skipped: true }    — уже отправлена или нет такой
//     500 { error: 'no telegram' } — нет секретов; строка не захвачена,
//                                после настройки её можно дослать
//     500 { error: 'claim failed' } — база не ответила (нет колонки
//                                notified_at — не выполнен feedback-bot.sql)
//
//   { action: 'sweep' } — стереть строки feedback старше 12 месяцев и их
//   снимки, а заодно файлы бакета feedback старше 12 месяцев, у которых
//   строки нет. Снимки — через Storage API: удаление строк storage.objects
//   прямым SQL файл из хранилища не убирает (документация Supabase,
//   Storage → Delete objects). Безвредно при любом вызове: стирается только
//   то, что Политика и так обещает стереть.
//     202 { sweep: 'started' }
//
//   Остальное: не POST — 405; не JSON, чужие type/table/schema, другой
//   action, id не uuid — 400; тело больше 256 КБ — 413. Ничего не делается.
//
// Отправка — в фоне (EdgeRuntime.waitUntil, документация Supabase:
// Functions → Background Tasks): ответ уходит сразу, pg_net не ждёт минуту
// снимка. Без EdgeRuntime (не Supabase) — запасной путь: ждём отправку и
// отвечаем после неё. Предел функции по времени — 150 с на бесплатном
// тарифе; ожидание снимка — 60 с.
//
// Сообщение — Telegram Bot API sendMessage, parse_mode HTML, всё
// пользовательское экранировано (&, <, >, "), предпросмотр ссылок выключен
// (link_preview_options; прежний disable_web_page_preview в нынешней
// документации Bot API не значится). В нём вид, платформа и версия, язык,
// устройство, «аккаунт» или «гость» (id пользователя — нет), время UTC,
// короткий id отзыва и текст; длиннее 4096 знаков — обрезается с пометкой.
// Снимок приходит после строки (клиент грузит его следом, бакет
// принимает его 15 минут), поэтому берём его с повторами — сразу, через 5,
// 10, 20, 30 и 60 с — и шлём sendPhoto ответом на сообщение
// (reply_parameters). Не появился — ответ строкой «снимок не загрузился».
// Фото Telegram не принял (размеры) — тот же файл документом.
//
// Ошибка Telegram пишется в лог без токена и без текста отзыва; основное
// сообщение не ушло — захват снимается (notified_at = null), и повторный
// вызов его дошлёт. Не ушёл только снимок — захват остаётся: текст уже в
// чате, а снимок лежит в Storage → feedback.
//
// Секреты: TELEGRAM_BOT_TOKEN (токен бота от @BotFather) и TELEGRAM_CHAT_ID
// (id рабочего чата); необязательный TELEGRAM_THREAD_ID — номер топика, если
// чат — группа с темами (20 октября 2026: рабочий чат разделён на топики).
// Топик 1 («General») Telegram принимает только без номера — его опускаем.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY у функций есть
// по умолчанию. Настройка и выкладка — supabase/functions/README.md.
// Тест без сети — tests/backend/feedback-notify-function.test.js.

import { createClient } from 'jsr:@supabase/supabase-js@2';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Admin = ReturnType<typeof createClient>;
type Telegram = { token: string; chat: string; thread?: number };
type Row = {
  id: string;
  user_id: string | null;
  kind: string;
  text: string;
  platform: string;
  app_version: string | null;
  lang: string | null;
  device: string | null;
  screenshot_path: string | null;
  created_at: string;
};

const BUCKET = 'feedback';
const TG_API = 'https://api.telegram.org';
// Предел Telegram — 4096 знаков текста после разбора разметки. Считаем по
// строке с тегами и сущностями: она не короче видимого текста, так что
// уложившись в неё, уложимся и в предел.
export const TG_MAX = 4096;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Тот же формат, что держит check таблицы (feedback_screenshot_path_check):
// <uuid>.<png|jpg|webp> в корне бакета.
const SHOT_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const COLS = 'id, user_id, kind, text, platform, app_version, lang, device, screenshot_path, created_at';
const MAX_BODY = 256 * 1024;
// Пачка уборки: 100 id или имён в фильтре in.(…) — около 4 КБ адреса, с
// запасом до предела строки запроса.
const PAGE = 100;
const MAX_ROUNDS = 200;

/** Время и ожидание — одним объектом, чтобы тест подменил их, не дожидаясь
 *  минуты. shotAt — секунды от первой попытки взять снимок. */
export const TIMING = {
  shotAt: [0, 5, 10, 20, 30, 60],
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

const KINDS: Record<string, [string, string]> = {
  bug: ['🐞', 'Ошибка'],
  idea: ['💡', 'Идея'],
  other: ['💬', 'Другое'],
};
const PLATFORMS: Record<string, string> = { web: 'веб', desktop: 'десктоп', android: 'Android', ios: 'iOS' };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(handle);

/** Обработчик запроса — отдельной функцией, а не стрелкой в Deno.serve:
 *  так его видит граф кода. */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const raw = await readBody(req);
  if (raw === null) return reply(413, { error: 'too large' });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'bad json' }); }
  const ask = parseCall(body);
  if ('error' in ask) return reply(400, { error: ask.error });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if ('action' in ask) {
    await later(sweep(admin).then((r) => console.log('feedback-notify: sweep', JSON.stringify(r))));
    return reply(202, { sweep: 'started' });
  }

  const tg = telegram();
  if (!tg) return reply(500, { error: 'no telegram' });

  // Захват — один update: из двух одновременных вызовов строку получит
  // только один, второй увидит notified_at и уйдёт ни с чем.
  const { data, error } = await admin.from('feedback')
    .update({ notified_at: TIMING.now().toISOString() })
    .eq('id', ask.id)
    .is('notified_at', null)
    .select(COLS)
    .maybeSingle();
  if (error) {
    console.error('feedback-notify: claim', error.code, redact(error.message));
    return reply(500, { error: 'claim failed' });
  }
  if (!data) return reply(200, { skipped: true });
  await later(deliver(admin, tg, data as Row));
  return reply(202, { queued: true });
}

/** Что просят: переслать строку (только её id) или убрать старое. */
export function parseCall(body: unknown): { id: string } | { action: 'sweep' } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad body' };
  const b = body as Record<string, unknown>;
  if ('action' in b) return b.action === 'sweep' ? { action: 'sweep' } : { error: 'bad action' };
  let id: unknown = b.id;
  if ('type' in b || 'table' in b || 'record' in b) {
    // Тело Database Webhook: только вставка в public.feedback.
    if (b.type !== 'INSERT' || b.table !== 'feedback' || ('schema' in b && b.schema !== 'public')) {
      return { error: 'not a feedback insert' };
    }
    const rec = b.record;
    id = rec && typeof rec === 'object' ? (rec as Record<string, unknown>).id : undefined;
  }
  return typeof id === 'string' && ID_RE.test(id) ? { id: id.toLowerCase() } : { error: 'bad id' };
}

/** Секреты бота; null — не заведены. */
function telegram(): Telegram | null {
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim();
  const chat = (Deno.env.get('TELEGRAM_CHAT_ID') || '').trim();
  if (!token || !chat) return null;
  return { token, chat, ...threadOf((Deno.env.get('TELEGRAM_THREAD_ID') || '').trim()) };
}

/** Номер топика из секрета: целое больше 1. Пусто или 1 («General») — без
 *  топика; не число — тоже без топика, с заметкой в логе (сообщение лучше
 *  получить в общем топике, чем потерять). */
function threadOf(raw: string): { thread?: number } {
  if (!raw) return {};
  const n = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (n > 1) return { thread: n };
  if (n !== 1) console.error('feedback-notify: TELEGRAM_THREAD_ID — не номер топика, шлём без топика');
  return {};
}

/** Поле топика для запросов Telegram (пусто — без топика). */
const inThread = (bot: Telegram) => (bot.thread ? { message_thread_id: bot.thread } : {});

/** Тело запроса до MAX_BODY; длиннее — null. */
async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > MAX_BODY) return null;
  const text = await req.text();
  return text.length > MAX_BODY ? null : text;
}

/** Фоновая работа: ответ уходит сразу. Без EdgeRuntime (не Supabase) —
 *  запасной путь: ждём здесь, ответ уйдёт после. Ошибка — в лог. */
async function later(p: Promise<unknown>): Promise<void> {
  const run = p.catch((e) => console.error('feedback-notify:', redact(String((e as Error)?.message || e))));
  try {
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function') {
      EdgeRuntime.waitUntil(run);
      return;
    }
  } catch { /* EdgeRuntime есть, но не принял — ждём сами */ }
  await run;
}

// --- сообщение --------------------------------------------------------------------

/** Экранирование для parse_mode HTML: Telegram знает &lt; &gt; &amp; &quot;. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const shortId = (id: string) => String(id).slice(0, 8);

function utc(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Текст сообщения в Telegram — не длиннее TG_MAX. */
export function messageText(row: Row): string {
  const [icon, kind] = KINDS[row.kind] || KINDS.other;
  const platform = PLATFORMS[row.platform] || row.platform || '—';
  const lines = [
    `${icon} <b>${kind}</b> · <code>${esc(shortId(row.id))}</code>`,
    `Платформа: ${esc(platform)}${row.app_version ? ` ${esc(row.app_version)}` : ''}`,
    `Язык: ${esc(row.lang || '—')}`,
    `Устройство: ${esc(row.device || '—')}`,
    `Отправитель: ${row.user_id ? 'аккаунт' : 'гость'}`,
    `Время: ${utc(row.created_at)}`,
  ];
  if (row.screenshot_path) lines.push('Снимок: ответом ниже');
  return fitText(`${lines.join('\n')}\n\n`, String(row.text ?? ''));
}

/** Шапка + экранированный текст в пределах TG_MAX; не влез — обрезается по
 *  целым знакам (не посреди сущности и не посреди суррогатной пары) с
 *  пометкой, сколько показано. */
export function fitText(head: string, text: string): string {
  const full = esc(text);
  if (head.length + full.length <= TG_MAX) return head + full;
  const chars = Array.from(text);
  const note = (n: number) => `\n\n<i>… обрезано: показано ${n} из ${chars.length} знаков, целиком — в таблице feedback</i>`;
  // n ≤ всего знаков, поэтому пометка с n не длиннее пометки со «всего».
  const budget = TG_MAX - head.length - note(chars.length).length;
  let out = '';
  let n = 0;
  for (const ch of chars) {
    const e = esc(ch);
    if (out.length + e.length > budget) break;
    out += e;
    n += 1;
  }
  return head + out + note(n);
}

// --- Telegram ---------------------------------------------------------------------

type TgResult = { ok: true; result: { message_id: number } } | { ok: false; status: number; code: number | null; description: string };

/** Вызов Bot API. Токен — только в адресе запроса; в логах его нет (redact).
 *  429 с retry_after до 30 с — одна повторная попытка. */
async function tg(bot: Telegram, method: string, payload: Record<string, unknown> | FormData): Promise<TgResult> {
  const init: RequestInit = payload instanceof FormData
    ? { method: 'POST', body: payload }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${TG_API}/bot${bot.token}/${method}`, init);
    } catch (e) {
      return { ok: false, status: 0, code: null, description: redact(String((e as Error)?.message || e)) };
    }
    let json: Record<string, any> | null = null;
    try { json = await res.json(); } catch { /* не JSON */ }
    if (res.ok && json && json.ok && json.result) return { ok: true, result: json.result };
    const wait = Number(json?.parameters?.retry_after);
    if (res.status === 429 && attempt === 0 && wait > 0 && wait <= 30) {
      await TIMING.sleep(wait * 1000);
      continue;
    }
    return { ok: false, status: res.status, code: typeof json?.error_code === 'number' ? json.error_code : null, description: cleanDescription(json?.description) };
  }
}

/** Убирает из строки токен бота: адрес запроса попадает в текст сетевых
 *  ошибок Deno («error sending request for url (…/bot<токен>/…)»). */
export function redact(s: string): string {
  let out = String(s ?? '');
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim();
  if (token) out = out.split(token).join('***');
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***');
}

/** Описание ошибки Telegram без того, что могло прийти из текста отзыва:
 *  кавычки («Unsupported start tag "…"») вырезаются, длина — до 160. */
function cleanDescription(d: unknown): string {
  return redact(String(d ?? '')).replace(/"[^"]*"/g, '"…"').replace(/'[^']*'/g, "'…'").slice(0, 160);
}

function logTg(method: string, r: TgResult, id: string) {
  if (r.ok) return;
  console.error('feedback-notify: telegram', method, r.status, r.code ?? '', r.description, 'feedback', shortId(id));
}

/** Переслать захваченную строку: сообщение, потом снимок ответом на него. */
export async function deliver(admin: Admin, bot: Telegram, row: Row): Promise<void> {
  const sent = await tg(bot, 'sendMessage', {
    chat_id: bot.chat,
    ...inThread(bot),
    text: messageText(row),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  if (!sent.ok) {
    logTg('sendMessage', sent, row.id);
    // Сообщение не ушло — строка снова «неотправленная», повтор дошлёт.
    const { error } = await admin.from('feedback').update({ notified_at: null }).eq('id', row.id);
    if (error) console.error('feedback-notify: release', error.code, redact(error.message), 'feedback', shortId(row.id));
    return;
  }
  const path = row.screenshot_path;
  if (!path) return;
  const to = { message_id: sent.result.message_id, allow_sending_without_reply: true };
  const note = async (text: string) => {
    const r = await tg(bot, 'sendMessage', {
      chat_id: bot.chat, ...inThread(bot), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_parameters: to,
    });
    logTg('sendMessage', r, row.id);
  };
  const shot = SHOT_RE.test(path) ? await fetchShot(admin, path) : null;
  if (!shot) {
    const last = TIMING.shotAt[TIMING.shotAt.length - 1] || 0;
    await note(`⚠️ Снимок не загрузился за ${last} с. Если он догрузится позже — Storage → feedback, <code>${esc(path)}</code>`);
    return;
  }
  const send = (method: 'sendPhoto' | 'sendDocument', field: 'photo' | 'document') => {
    const form = new FormData();
    form.append('chat_id', bot.chat);
    if (bot.thread) form.append('message_thread_id', String(bot.thread));
    form.append(field, shot, path);
    form.append('caption', `Снимок к ${shortId(row.id)}`);
    form.append('reply_parameters', JSON.stringify(to));
    return tg(bot, method, form);
  };
  const photo = await send('sendPhoto', 'photo');
  if (photo.ok) return;
  logTg('sendPhoto', photo, row.id);
  // Фото Telegram сжимает и проверяет размеры (сумма сторон до 10000,
  // соотношение до 20) — длинный снимок страницы уходит документом.
  const doc = await send('sendDocument', 'document');
  if (doc.ok) return;
  logTg('sendDocument', doc, row.id);
  await note(`⚠️ Снимок не отправился в Telegram — он в Storage → feedback, <code>${esc(path)}</code>`);
}

/** Снимок из бакета с повторами: файл клиент грузит после строки. */
export async function fetchShot(admin: Admin, path: string): Promise<Blob | null> {
  let waited = 0;
  for (const at of TIMING.shotAt) {
    const pause = at * 1000 - waited;
    if (pause > 0) {
      await TIMING.sleep(pause);
      waited += pause;
    }
    try {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (!error && data && data.size > 0) return data;
    } catch { /* сеть — следующая попытка */ }
  }
  return null;
}

// --- уборка старше 12 месяцев --------------------------------------------------------

/** Граница срока: ровно на год (12 месяцев) раньше now. */
export function cutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

type SweepResult = { rows: number; shots: number; orphans: number; error?: string };

/** Стирает строки feedback старше 12 месяцев со снимками, потом — файлы
 *  бакета старше 12 месяцев без строки. Сначала файлы, потом строки: не
 *  стёрся файл — строка остаётся, и следующая уборка попробует снова. */
export async function sweep(admin: Admin, now: Date = TIMING.now()): Promise<SweepResult> {
  const edge = cutoff(now);
  const before = edge.toISOString();
  const out: SweepResult = { rows: 0, shots: 0, orphans: 0 };

  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) return { ...out, error: 'too many rounds' };
    const { data, error } = await admin.from('feedback')
      .select('id, screenshot_path')
      .lt('created_at', before)
      .order('created_at', { ascending: true })
      .limit(PAGE);
    if (error) return { ...out, error: redact(error.message) };
    const rows = (data || []) as { id: string; screenshot_path: unknown }[];
    if (!rows.length) break;
    const paths = [...new Set(rows.map((r) => r.screenshot_path).filter((p): p is string => typeof p === 'string' && SHOT_RE.test(p)))];
    if (paths.length) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
      if (rmErr) return { ...out, error: redact(rmErr.message) };
      out.shots += paths.length;
    }
    const { error: delErr } = await admin.from('feedback').delete().in('id', rows.map((r) => r.id));
    if (delErr) return { ...out, error: redact(delErr.message) };
    out.rows += rows.length;
    if (rows.length < PAGE) break;
  }

  // Файлы без строки: список корня бакета от старых к новым. Стёртые уходят
  // из списка, а всё оставшееся на странице (файлы со строкой, папки)
  // сдвигает начало следующей. Папки (id null) не трогаем: клиенты кладут
  // снимки в корень. Первый же файл моложе срока — дальше только моложе.
  let offset = 0;
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) return { ...out, error: 'too many rounds' };
    const { data, error } = await admin.storage.from(BUCKET).list('', {
      limit: PAGE, offset, sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error) return { ...out, error: redact(error.message) };
    const page = (data || []) as { id: string | null; name: string; created_at?: string | null }[];
    const isOld = (o: { created_at?: string | null }) => !!o.created_at && Date.parse(o.created_at) < edge.getTime();
    const old = page.filter((o) => o.id && isOld(o)).map((o) => o.name);
    const young = page.some((o) => o.id && !isOld(o));
    let orphans = old;
    if (old.length) {
      const { data: owned, error: ownErr } = await admin.from('feedback').select('screenshot_path').in('screenshot_path', old);
      if (ownErr) return { ...out, error: redact(ownErr.message) };
      const keep = new Set(((owned || []) as { screenshot_path: string }[]).map((r) => r.screenshot_path));
      orphans = old.filter((n) => !keep.has(n));
      if (orphans.length) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(orphans);
        if (rmErr) return { ...out, error: redact(rmErr.message) };
        out.orphans += orphans.length;
      }
    }
    offset += page.length - orphans.length;
    if (young || page.length < PAGE) break;
  }
  return out;
}

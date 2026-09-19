#!/usr/bin/env node
/* Запись в журнал работы, который показывает страница lancible.vercel.app/logs.
 *
 * Хранилище — две таблицы в Supabase (supabase/logs.sql). Писать в них может
 * только service_role: ключ берётся из переменной окружения
 * SUPABASE_SERVICE_ROLE_KEY или из .env.local в корне репозитория.
 *
 * Использование — одна задача за вызов, JSON на вход:
 *
 *   node scripts/worklog.js <<'EOF'
 *   {
 *     "task": { "id": "2026-09-19-logs-page", "title": "Страница логов",
 *               "status": "review", "summary": "Что вышло в итоге" },
 *     "events": [
 *       { "kind": "change", "title": "Добавлена страница /logs",
 *         "detail": "Читает Supabase напрямую, без сборки" }
 *     ]
 *   }
 *   EOF
 *
 * Если ключа нет или сеть недоступна, запись не теряется: она ложится в
 * logs/pending.jsonl, и следующий `node scripts/worklog.js flush` досылает
 * очередь по порядку. Отправленное дублируется в logs/sent.jsonl — локальная
 * копия на случай, если до базы будет не достучаться.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const PENDING = path.join(LOGS_DIR, 'pending.jsonl');
const SENT = path.join(LOGS_DIR, 'sent.jsonl');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yiglgfkjjvwijukdzutw.supabase.co';

// Допустимые значения перечисляем здесь, а не только в SQL: опечатка в виде
// события должна ронять запись сразу, а не тихо оседать мусором в журнале.
const KINDS = ['request', 'change', 'error', 'fix', 'check', 'deploy'];
const STATUSES = ['in_progress', 'review', 'accepted', 'deployed'];

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) return null;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function validate(payload) {
  const task = payload && payload.task;
  if (!task || !task.id || !task.title) throw new Error('нужен task.id и task.title');
  if (!/^[a-z0-9-]+$/.test(task.id)) throw new Error(`task.id должен быть слагом: ${task.id}`);
  if (task.status && !STATUSES.includes(task.status)) {
    throw new Error(`неизвестный статус "${task.status}", допустимы: ${STATUSES.join(', ')}`);
  }
  for (const ev of payload.events || []) {
    if (!ev.kind || !ev.title) throw new Error('у события нужны kind и title');
    if (!KINDS.includes(ev.kind)) {
      throw new Error(`неизвестный вид "${ev.kind}", допустимы: ${KINDS.join(', ')}`);
    }
  }
  return payload;
}

async function request(table, rows, extraHeaders) {
  const key = serviceKey();
  if (!key) throw new Error('NO_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...extraHeaders,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function send(payload) {
  const now = new Date().toISOString();
  const task = { ...payload.task, updated_at: now };
  // Пустые поля не отправляем: при повторной записи задачи они затёрли бы
  // уже сохранённые значения — PostgREST обновляет ровно те колонки, что
  // пришли в теле запроса.
  for (const k of Object.keys(task)) if (task[k] === undefined || task[k] === null) delete task[k];

  await request('work_log_tasks', [task], { Prefer: 'return=minimal,resolution=merge-duplicates' });

  const events = (payload.events || []).map((ev) => ({
    task_id: payload.task.id,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail || null,
    round: ev.round || payload.task.round || 1,
    at: ev.at || now,
  }));
  if (events.length) await request('work_log_events', events);
  return events.length;
}

function queue(payload) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(PENDING, JSON.stringify({ queued_at: new Date().toISOString(), payload }) + '\n', 'utf8');
}

function archive(payload) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(SENT, JSON.stringify({ sent_at: new Date().toISOString(), payload }) + '\n', 'utf8');
}

async function flush() {
  if (!fs.existsSync(PENDING)) return console.log('очередь пуста');
  const lines = fs.readFileSync(PENDING, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) return console.log('очередь пуста');
  const left = [];
  let ok = 0;
  for (let i = 0; i < lines.length; i++) {
    if (left.length) { left.push(lines[i]); continue; } // порядок важнее скорости: после первой осечки дальше не идём
    try {
      const { payload } = JSON.parse(lines[i]);
      await send(payload);
      archive(payload);
      ok++;
    } catch (err) {
      console.error(`остановился на записи ${i + 1}: ${err.message}`);
      left.push(lines[i]);
    }
  }
  fs.writeFileSync(PENDING, left.length ? left.join('\n') + '\n' : '', 'utf8');
  console.log(`отправлено: ${ok}, осталось в очереди: ${left.length}`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'flush') return flush();

  if (cmd === 'pending') {
    if (!fs.existsSync(PENDING)) return console.log('очередь пуста');
    const lines = fs.readFileSync(PENDING, 'utf8').split('\n').filter(Boolean);
    console.log(`в очереди: ${lines.length}`);
    for (const line of lines) {
      const { payload } = JSON.parse(line);
      console.log(`  ${payload.task.id} — ${payload.task.title} (${(payload.events || []).length} событий)`);
    }
    return;
  }

  const raw = (await readStdin()).trim();
  if (!raw) {
    console.error('нечего записывать: JSON подаётся на стандартный ввод, см. заголовок файла');
    process.exit(1);
  }

  let payload;
  try {
    payload = validate(JSON.parse(raw));
  } catch (err) {
    console.error(`запись отклонена: ${err.message}`);
    process.exit(1);
  }

  try {
    const n = await send(payload);
    archive(payload);
    console.log(`записано: ${payload.task.id}, событий ${n}`);
  } catch (err) {
    queue(payload);
    const why = err.message === 'NO_KEY'
      ? 'нет SUPABASE_SERVICE_ROLE_KEY (переменная окружения или .env.local в корне)'
      : err.message;
    console.log(`в очередь (${why}): ${payload.task.id}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

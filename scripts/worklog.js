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
 * title нужен, только когда задача заводится. Для уже заведённой его можно
 * не передавать — тогда меняются лишь присланные поля (статус, итог), а
 * название остаётся прежним. Подставлять название наугад нельзя: запись
 * обновляет задачу по id, и чужое название затрёт настоящее.
 *
 * Если ключа нет или сеть недоступна, запись не теряется: она ложится в
 * logs/pending.jsonl, и следующая запись (или `node scripts/worklog.js flush`)
 * сначала досылает очередь по порядку. Отправленное дублируется в
 * logs/sent.jsonl — локальная копия на случай, если до базы будет не
 * достучаться.
 *
 * Оба файла в git не живут (.gitignore): у каждой копии репозитория своя
 * очередь, а журнал один — в базе. В git они конфликтовали при каждом слиянии
 * веток, а закоммиченная очередь досылалась повторно из каждой копии.
 *
 * Повторная отправка не задваивает события. Время события ставится один раз,
 * когда запись создана, и уезжает в очередь вместе с ней; перед вставкой
 * скрипт читает уже записанные события задачи и пропускает совпавшие. Так
 * переживается и потерянный ответ сервера: вставка дошла, ответ нет, запись
 * осталась в очереди — при досылке её события найдутся в базе.
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
  if (!task || !task.id) throw new Error('нужен task.id');
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

async function select(table, query) {
  const key = serviceKey();
  if (!key) throw new Error('NO_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Обновляет строки по фильтру, возвращает обновлённые. */
async function patch(table, filter, fields) {
  const key = serviceKey();
  if (!key) throw new Error('NO_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Ставит время каждому событию без него — один раз, при создании записи. */
function stamp(payload, now = new Date().toISOString()) {
  return { ...payload, events: (payload.events || []).map((ev) => (ev.at ? ev : { ...ev, at: now })) };
}

/**
 * События записи, которых ещё нет в базе. С временем событие узнаётся по
 * виду, заголовку и моменту; без времени (записи из очереди до 10 октября
 * 2026) — по виду, заголовку и подробностям.
 */
function missingEvents(events, existing) {
  const sameMoment = (a, b) => Date.parse(a) === Date.parse(b);
  return events.filter((ev) => !existing.some((ex) => ex.kind === ev.kind && ex.title === ev.title && (
    ev.at ? sameMoment(ex.at, ev.at) : (ex.detail || null) === (ev.detail || null)
  )));
}

async function send(payload) {
  const now = new Date().toISOString();
  const task = { ...payload.task, updated_at: now };
  // Пустые поля не отправляем: при повторной записи задачи они затёрли бы
  // уже сохранённые значения — PostgREST обновляет ровно те колонки, что
  // пришли в теле запроса.
  for (const k of Object.keys(task)) if (task[k] === undefined || task[k] === null) delete task[k];

  if (task.title) {
    await request('work_log_tasks', [task], { Prefer: 'return=minimal,resolution=merge-duplicates' });
  } else {
    // Без названия — только обновление заведённой задачи: вставка без title
    // упала бы на NOT NULL ещё до разбора конфликта.
    const updated = await patch('work_log_tasks', `id=eq.${encodeURIComponent(task.id)}`, task);
    if (!updated.length) {
      const err = new Error(`задачи ${task.id} ещё нет — при заведении нужен task.title`);
      err.code = 'NO_TASK';
      throw err;
    }
  }

  const events = payload.events || [];
  if (!events.length) return 0;
  const existing = await select('work_log_events',
    `select=kind,title,detail,at&task_id=eq.${encodeURIComponent(payload.task.id)}`);
  const rows = missingEvents(events, existing).map((ev) => ({
    task_id: payload.task.id,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail || null,
    round: ev.round || payload.task.round || 1,
    at: ev.at || now,
  }));
  if (rows.length) await request('work_log_events', rows);
  return rows.length;
}

function queue(payload) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(PENDING, JSON.stringify({ queued_at: new Date().toISOString(), payload }) + '\n', 'utf8');
}

function archive(payload) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(SENT, JSON.stringify({ sent_at: new Date().toISOString(), payload }) + '\n', 'utf8');
}

/** Досылает очередь по порядку. Возвращает, сколько записей в ней осталось. */
async function flush({ quiet = false } = {}) {
  const lines = fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8').split('\n').filter(Boolean) : [];
  if (!lines.length) {
    if (!quiet) console.log('очередь пуста');
    return 0;
  }
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
      // Задачи нет и названия нет — повтор не поможет, а очередь бы встала.
      if (err.code === 'NO_TASK') { console.error(`выброшена запись ${i + 1}: ${err.message}`); continue; }
      console.error(`остановился на записи ${i + 1}: ${err.message}`);
      left.push(lines[i]);
    }
  }
  fs.writeFileSync(PENDING, left.length ? left.join('\n') + '\n' : '', 'utf8');
  console.log(`очередь: отправлено ${ok}, осталось ${left.length}`);
  return left.length;
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
      const n = (payload.events || []).length;
      const m10 = n % 10, m100 = n % 100;
      const word = m10 === 1 && m100 !== 11 ? 'событие'
        : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'события' : 'событий';
      console.log(`  ${payload.task.id} — ${payload.task.title || '(название прежнее)'} (${n} ${word})`);
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
    payload = stamp(validate(JSON.parse(raw)));
  } catch (err) {
    console.error(`запись отклонена: ${err.message}`);
    process.exit(1);
  }

  // Сначала очередь: журнал читается по времени, и новая запись не должна
  // обгонять старые. Не ушла очередь — новая встаёт за ней.
  if (await flush({ quiet: true })) {
    queue(payload);
    return console.log(`в очередь за неотправленными: ${payload.task.id}`);
  }

  try {
    const n = await send(payload);
    archive(payload);
    console.log(`записано: ${payload.task.id}, событий ${n}`);
  } catch (err) {
    if (err.code === 'NO_TASK') {
      // Повтор не поможет — в очередь не кладём.
      console.error(`запись отклонена: ${err.message}`);
      process.exit(1);
    }
    queue(payload);
    const why = err.message === 'NO_KEY'
      ? 'нет SUPABASE_SERVICE_ROLE_KEY (переменная окружения или .env.local в корне)'
      : err.message;
    console.log(`в очередь (${why}): ${payload.task.id}`);
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { stamp, missingEvents, validate };

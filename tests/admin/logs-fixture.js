// Журнал работы для подменённой функции admin (logs.list): задачи и события
// и та же выборка, что делает функция (supabase/functions/admin, actLogsList):
// задачи свежими первыми, события по времени; kind оставляет задачи с
// событиями этого вида и только их события; счётчики видов — по задачам
// выбранного статуса, счётчики статусов — по всему журналу.
const KINDS = ['request', 'change', 'error', 'fix', 'check', 'deploy'];
const STATUSES = ['in_progress', 'review', 'accepted', 'deployed'];

const TASKS = [
  {
    id: '2026-10-21-agent', title: 'ИИ-агент по приглашению', summary: 'Доступ к агенту — по списку ai_access, лимит 50 в сутки.',
    status: 'deployed', round: 2, startedAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-21T15:00:00Z',
    events: [
      { kind: 'request', title: 'Пускать к агенту только по приглашению', detail: null, round: 1, at: '2026-10-20T08:00:00Z' },
      { kind: 'change', title: 'Таблица ai_access и проверка в ai-chat', detail: 'supabase/ai-access.sql', round: 1, at: '2026-10-20T10:00:00Z' },
      { kind: 'error', title: 'Гость получал 500 вместо 403', detail: 'getUser без токена бросал исключение,\nа не возвращал ошибку', round: 1, at: '2026-10-20T12:00:00Z' },
      { kind: 'fix', title: 'Без токена — 401 до вызова getUser', detail: null, round: 2, at: '2026-10-21T09:00:00Z' },
      { kind: 'deploy', title: 'Выкачено 0.5.1', detail: null, round: 2, at: '2026-10-21T15:00:00Z' },
    ],
  },
  {
    id: '2026-10-22-blog', title: 'Посты лендинга из базы', summary: null,
    status: 'review', round: 1, startedAt: '2026-10-22T08:00:00Z', updatedAt: '2026-10-22T18:00:00Z',
    events: [
      { kind: 'change', title: 'blog_posts и лента из PostgREST', detail: null, round: 1, at: '2026-10-22T09:00:00Z' },
      { kind: 'check', title: 'Лента не бывает пустой', detail: 'tests/landing/blog-feed.spec.js', round: 1, at: '2026-10-22T18:00:00Z' },
      { kind: 'error', title: 'Якорь уезжал после ответа базы', detail: null, round: 1, at: '2026-10-22T12:00:00Z' },
    ],
  },
  {
    id: '2026-10-23-admin', title: 'Админ-панель', summary: null,
    status: 'in_progress', round: 1, startedAt: '2026-10-23T07:00:00Z', updatedAt: '2026-10-23T11:00:00Z',
    events: [],
  },
];

function logsList(all, { status, kind, page = 1, per = 20 } = {}) {
  const st = status && status !== 'all' ? status : null;
  const kd = kind && kind !== 'all' ? kind : null;
  const statuses = { all: all.length };
  for (const s of STATUSES) statuses[s] = all.filter((t) => t.status === s).length;
  const inStatus = st ? all.filter((t) => t.status === st) : all;
  const kinds = { all: 0 };
  for (const k of KINDS) kinds[k] = 0;
  for (const t of inStatus) for (const e of t.events) { kinds.all += 1; kinds[e.kind] += 1; }
  const shown = inStatus
    .filter((t) => !kd || t.events.some((e) => e.kind === kd))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const rows = shown.slice((page - 1) * per, page * per).map((t) => ({
    ...t,
    eventsTotal: t.events.length,
    events: t.events.filter((e) => !kd || e.kind === kd).sort((a, b) => (a.at < b.at ? -1 : 1)),
  }));
  return { total: shown.length, page, per, status: st || 'all', kind: kd || 'all', counts: { statuses, kinds }, rows };
}

module.exports = { TASKS, logsList, KINDS, STATUSES };

// Журнал работы: задачи целиком — что сделано, что сломалось и почему, что
// попросили поправить, чем проверено и когда уехало. До 23 октября 2026 это
// была служебная страница /logs лендинга, читавшая базу ключом anon; теперь
// журнал клиентам закрыт (supabase/logs.sql), и раздел берёт его у функции
// admin (logs.list, служебным ключом, только админ со вторым фактором).
//
// Что умеет — то же, что умела /logs: задачи свежими первыми, у каждой статус,
// срок, круги правок и события по времени; фильтр по виду события со
// счётчиками (видны только виды, которые есть); «Обновить» и перечитывание
// при возвращении на вкладку. Сверху — фильтр по статусу задачи и «Показать
// ещё» вместо ленты целиком.
import { call } from '../api.js';
import { h, page, segmented, loadInto, emptyState, plural, fmtNum } from '../ui.js';

export const KINDS = { request: 'Правка', change: 'Изменение', error: 'Ошибка', fix: 'Починено', check: 'Проверка', deploy: 'Деплой' };
export const STATUSES = { in_progress: 'В работе', review: 'На проверке', accepted: 'Принято', deployed: 'Задеплоено' };
const PER = 20;

// Выбор фильтров помнится между заходами в раздел (до перезагрузки вкладки).
let status = 'all';
let kind = 'all';

const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
// ru-RU дописывает « г.» — как в блоге и на прежней /logs, отрезаем.
const day = (d) => DAY.format(d).replace(/\s*г\.$/, '');
const valid = (iso) => !!iso && !Number.isNaN(Date.parse(iso));

/** «19 сентября» или «19 сентября — 21 сентября»: «с 19 по 19» не пишем. */
export function period(task) {
  if (!valid(task.startedAt) || !valid(task.updatedAt)) return valid(task.updatedAt) ? day(new Date(task.updatedAt)) : '—';
  const from = new Date(task.startedAt);
  const to = new Date(task.updatedAt);
  return from.toDateString() === to.toDateString() ? day(from) : `${day(from)} — ${day(to)}`;
}

function eventRow(e) {
  const round = Number(e.round) > 1 ? h('span', { class: 'log-round', text: `круг ${e.round}` }) : null;
  return h('li', { class: 'log-event', dataset: { kind: e.kind } },
    h('span', { class: 'log-time mono', text: valid(e.at) ? TIME.format(new Date(e.at)) : '—' }),
    h('span', { class: `chip log-kind k-${e.kind}`, text: KINDS[e.kind] || e.kind }),
    h('div', { class: 'log-event-main' },
      h('p', { class: 'log-event-title' }, e.title || '', round),
      e.detail ? h('p', { class: 'log-detail', text: e.detail }) : null));
}

function taskCard(t, filtered) {
  const events = Array.isArray(t.events) ? t.events : [];
  const total = Number(t.eventsTotal) || events.length;
  const count = filtered && total !== events.length
    ? `${fmtNum(events.length)} из ${fmtNum(total)} ${plural(total, 'события', 'событий', 'событий')}`
    : `${fmtNum(events.length)} ${plural(events.length, 'событие', 'события', 'событий')}`;
  return h('article', { class: 'island log-task', dataset: { id: t.id } },
    h('div', { class: 'log-task-head' },
      h('div', { class: 'log-task-main' },
        h('h2', { class: 'log-task-title', text: t.title || t.id }),
        t.summary ? h('p', { class: 'log-task-summary', text: t.summary }) : null,
        h('div', { class: 'log-task-meta' },
          h('span', { text: period(t) }),
          h('span', { dataset: { role: 'count' }, text: count }),
          Number(t.round) > 1 ? h('span', { text: `кругов правок: ${t.round}` }) : null)),
      h('span', { class: `chip log-status s-${t.status}`, dataset: { role: 'status' }, text: STATUSES[t.status] || t.status || '—' })),
    events.length
      ? h('ol', { class: 'log-events' }, events.map(eventRow))
      : h('p', { class: 'muted', text: 'Событий пока нет.' }));
}

/** Кнопки фильтра: «Все» и значения со счётчиком; пустые значения прячутся,
 *  кроме выбранного — чтобы было видно, что выбрано. */
function filterOptions(map, counts, current, allLabel, hideEmpty) {
  const n = (k) => (counts && Number.isFinite(Number(counts[k])) ? Number(counts[k]) : null);
  const label = (text, k) => [text, n(k) == null ? null : h('span', { class: 'seg-count', text: fmtNum(n(k)) })];
  const out = [{ value: 'all', label: label(allLabel, 'all') }];
  for (const [k, text] of Object.entries(map)) {
    if (hideEmpty && n(k) === 0 && k !== current) continue;
    out.push({ value: k, label: label(text, k) });
  }
  return out;
}

export function mount(root) {
  const updated = h('span', { class: 'page-count', id: 'logs-updated' });
  const reloadBtn = h('button', { type: 'button', class: 'btn-soft', id: 'logs-reload' }, 'Обновить');
  const { body } = page(root, 'Журнал', [updated, reloadBtn]);
  const filters = h('div', { class: 'log-filters' });
  const list = h('div', { class: 'stack', id: 'logs-list' });
  body.append(filters, list);

  let pageNo = 1;
  let shown = [];
  let counts = null;
  let loadingNow = false;

  const paint = () => {
    const st = segmented(filterOptions(STATUSES, counts && counts.statuses, status, 'Все задачи', false), status, (v) => { status = v; pageNo = 1; reload(); }, 'Статус задачи');
    st.id = 'logs-status';
    const kd = segmented(filterOptions(KINDS, counts && counts.kinds, kind, 'Все события', true), kind, (v) => { kind = v; pageNo = 1; reload(); }, 'Вид события');
    kd.id = 'logs-kind';
    filters.replaceChildren(st, kd);
  };
  paint();

  const params = () => ({ page: pageNo, per: PER, ...(status !== 'all' ? { status } : {}), ...(kind !== 'all' ? { kind } : {}) });

  const fetcher = async () => {
    loadingNow = true;
    try {
      return await call('logs.list', params());
    } catch (e) {
      // Нет таблиц журнала — не admin.sql, а logs.sql: говорим прямо.
      if (e && e.code === 'setup') return { setup: true };
      throw e;
    } finally {
      loadingNow = false;
    }
  };

  const reload = loadInto(list, fetcher, (res) => {
    if (res.setup) {
      counts = null;
      paint();
      list.replaceChildren(h('div', { class: 'note', role: 'status', id: 'logs-setup' },
        h('p', { class: 'note-text' }, 'Таблиц журнала в базе нет. Выполните ', h('code', { text: 'supabase/logs.sql' }), ' (SQL Editor → New query → Run).')));
      return;
    }
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const total = Number(res.total) || 0;
    counts = res.counts || null;
    shown = pageNo === 1 ? rows : shown.concat(rows);
    paint();
    updated.textContent = `обновлено в ${TIME.format(new Date())}`;
    if (!shown.length) {
      const all = status === 'all' && kind === 'all';
      list.replaceChildren(emptyState(all
        ? { art: 'tasks', title: 'Журнал пуст', text: 'Записи появятся здесь, как только начнётся следующая задача.' }
        : { art: 'filter', title: 'Таких записей нет', text: 'Выберите «Все задачи» и «Все события», чтобы увидеть журнал целиком.' }));
      return;
    }
    const more = shown.length < total
      ? h('button', { type: 'button', class: 'btn-soft more-btn', id: 'logs-more', on: { click: () => { pageNo += 1; reload(); } } }, 'Показать ещё')
      : null;
    list.replaceChildren(...shown.map((t) => taskCard(t, kind !== 'all')), more || '');
  });

  reloadBtn.addEventListener('click', () => { pageNo = 1; reload(); });

  // Вкладку с журналом держат открытой подолгу, а записи прилетают из другого
  // места. Перечитываем при возвращении на вкладку — если человек не листает
  // дальше первой страницы (иначе «Показать ещё» сбросилось бы под ним).
  const onVisible = () => {
    if (document.hidden || loadingNow || pageNo !== 1 || !list.isConnected) return;
    reload();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}

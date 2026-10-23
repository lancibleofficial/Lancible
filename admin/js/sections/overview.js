// Обзор: карточки чисел и графики по дням за 7/30/90 дней.
// Ответ overview — ARCHITECTURE.md, контракт функции admin.
import { call } from '../api.js';
import { h, page, island, segmented, loadInto, fmtNum } from '../ui.js';
import { barChart, barList, fillSeries } from '../charts.js';

export const RANGES = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
];

let days = 30;

const PLATFORM_LABEL = { web: 'Веб', desktop: 'Десктоп', android: 'Android', ios: 'iOS' };

function stat(id, label, value, sub) {
  return h('div', { class: 'stat', dataset: { stat: id } },
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: 'stat-value num', text: fmtNum(value) }),
    sub ? h('div', { class: 'stat-sub', text: sub }) : null);
}

function chartIsland(id, title, series, note) {
  const points = fillSeries(series, days);
  const total = points.reduce((a, p) => a + p.n, 0);
  return h('section', { class: 'island chart-island', dataset: { chart: id } },
    h('div', { class: 'island-head' },
      h('h2', { class: 'island-title', text: title }),
      h('span', { class: 'island-note', text: note || `за период: ${fmtNum(total)}` })),
    barChart(points, { label: title }));
}

function render(box, d) {
  const u = d.users || {}, l = d.logins || {}, a = d.active || {}, p = d.projects || {}, t = d.tasks || {};
  const f = d.feedback || {}, ai = d.ai || {}, pl = d.platforms || {};
  const stats = h('div', { class: 'stats' },
    stat('users', 'Пользователи', u.total, `+${fmtNum(u.new7 || 0)} за 7 дней · +${fmtNum(u.new30 || 0)} за 30`),
    stat('logins', 'Входы сегодня', l.day, `за неделю ${fmtNum(l.week)} · за месяц ${fmtNum(l.month)}`),
    stat('active', 'Активные за день', a.dau, `за неделю ${fmtNum(a.wau)} · за месяц ${fmtNum(a.mau)}`),
    stat('projects', 'Проекты', p.total, 'заведено у синхронизирующих'),
    stat('tasks', 'Задачи', t.total, 'заведено у синхронизирующих'),
    stat('feedback', 'Новые отзывы', f.new, `всего ${fmtNum(f.total)}`),
    stat('ai', 'Агент за 7 дней', ai.calls7, `людей ${fmtNum(ai.users7)} · единиц сегодня ${fmtNum(ai.unitsToday)}`));

  const platforms = ['web', 'desktop', 'android', 'ios'].map((k) => ({ label: PLATFORM_LABEL[k], value: Number(pl[k]) || 0 }));
  const platformsIsland = island('Платформы', 'люди по платформам', barList(platforms));
  platformsIsland.dataset.chart = 'platforms';

  box.replaceChildren(
    stats,
    h('div', { class: 'grid-2' },
      chartIsland('users', 'Новые пользователи', u.series),
      chartIsland('logins', 'Входы', l.series),
      chartIsland('active', 'Активные по дням', a.series, 'люди за день'),
      platformsIsland,
      chartIsland('projects', 'Новые проекты', p.series),
      chartIsland('tasks', 'Новые задачи', t.series)));
}

export function mount(root) {
  const range = segmented(RANGES, days, (v) => { days = v; reload(); }, 'Период');
  range.id = 'overview-range';
  const { body } = page(root, 'Обзор', [range]);
  const reload = loadInto(body, () => call('overview', { days }), (d) => render(body, d));
}

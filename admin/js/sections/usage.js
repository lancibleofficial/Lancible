// Экраны: что открывают чаще всего и что редко или ни разу — по платформам.
// Данные — счётчик track_screen (только у вошедших, с включённой
// «Статистикой экранов»); полный список экранов — admin/screens.js.
import { call, rowsOf } from '../api.js';
import { h, page, island, segmented, loadInto, emptyState, fmtNum, plural } from '../ui.js';
import { barList } from '../charts.js';
import { RANGES } from './overview.js';

let days = 30;
let platform = 'web';
const TOP = 15;
const RARE = 10;

const known = () => window.AdminScreens || { SCREENS: {}, PLATFORMS: [], screenLabel: () => null };

function screenRow(r) {
  const label = known().screenLabel(r.platform, r.screen);
  return {
    label: label || r.screen,
    code: label ? r.screen : null,
    tag: label ? null : h('span', { class: 'chip warn', text: 'нет в списке' }),
    value: Number(r.views) || 0,
    sub: `${fmtNum(r.users)} ${plural(Number(r.users) || 0, 'человек', 'человека', 'человек')}`,
  };
}

function render(box, rows) {
  const mine = rows.filter((r) => r.platform === platform).sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
  const seen = new Set(mine.map((r) => r.screen));
  const never = (known().SCREENS[platform] || []).filter((s) => !seen.has(s.id));
  const views = (r) => Number(r.views) || 0;
  const max = mine.length ? views(mine[0]) : 0;
  // Редкие — не дальше пятнадцатого места или не больше десятой доли самого
  // частого (и меньше его: поровну открытые редкими не считаются). В
  // «частые» они не входят.
  const limit = Math.max(1, Math.round(max * 0.1));
  const rare = mine.length > 3
    ? mine.filter((r, i) => views(r) < max && (i >= TOP || views(r) <= limit)).reverse().slice(0, RARE)
    : [];
  const top = mine.filter((r) => !rare.includes(r)).slice(0, TOP);

  const topIsland = island('Чаще всего открывают', 'просмотры · люди',
    top.length
      ? barList(top.map(screenRow))
      : emptyState({ art: 'search', small: true, title: 'За этот период экраны не открывали', text: 'Счётчик пишет только у вошедших, у кого включена «Статистика экранов».' }));
  topIsland.dataset.list = 'top';

  const rareIsland = island('Редко и ни разу', null,
    h('h3', { class: 'sub-title', text: 'Редко' }),
    rare.length
      ? barList(rare.map(screenRow))
      : h('p', { class: 'muted', text: 'Редких экранов нет.' }),
    h('h3', { class: 'sub-title', text: `Ни разу не открывали · ${never.length}` }),
    never.length
      ? h('ul', { class: 'chip-list', dataset: { list: 'never' } }, never.map((s) => h('li', { class: 'chip' }, s.label, h('code', { class: 'chip-code', text: s.id }))))
      : h('p', { class: 'muted', text: 'Открывали все экраны из списка.' }));
  rareIsland.dataset.list = 'rare';

  box.replaceChildren(h('div', { class: 'grid-2' }, topIsland, rareIsland));
}

export function mount(root) {
  let rows = [];
  const range = segmented(RANGES, days, (v) => { days = v; reload(); }, 'Период');
  const plat = segmented(known().PLATFORMS.map((p) => ({ value: p.id, label: p.label })), platform, (v) => { platform = v; render(body, rows); }, 'Платформа');
  plat.id = 'screens-platform';
  const { body } = page(root, 'Экраны', [plat, range]);
  const reload = loadInto(body, () => call('screens', { days }), (res) => { rows = rowsOf(res, 'screens'); render(body, rows); });
}

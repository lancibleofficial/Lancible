// Пользователи: поиск, таблица, карточка пользователя (#/users/<id>).
import { call, rowsOf, errorText } from '../api.js';
import { h, page, island, segmented, loadInto, emptyState, confirmDialog, toast, fmtNum, fmtDate, fmtDateTime, fmtDay, debounce, copyButton } from '../ui.js';
import { barList } from '../charts.js';

const PER = 50;
let query = '';
let pageNo = 1;
/** Фильтр по доступу к агенту: all — все, yes — с доступом, no — без. */
let filter = 'all';
const FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'yes', label: 'С доступом к агенту' },
  { value: 'no', label: 'Без доступа' },
];
/** Пометка у доступа, выданного кнопкой из списка (её видно в «Агент и API»). */
const GRANT_NOTE = 'из списка пользователей';

const PROVIDER = { email: 'почта', google: 'Google', apple: 'Apple', github: 'GitHub' };
const KIND = { bug: 'Ошибка', idea: 'Идея', other: 'Другое' };
const STATUS = { new: 'Новый', answered: 'Отвечен', closed: 'Закрыт' };
const PLATFORM = { web: 'веб', desktop: 'десктоп', android: 'Android', ios: 'iOS' };

/** «Есть / нет» и кнопка доступа к агенту — одна и та же в строке таблицы и в
 *  карточке. Почта уходит в access.add / access.remove ровно та, что у аккаунта
 *  (из данных строки, не ввод руками); забрать — с подтверждением. Ответ
 *  функции — и метка, и кнопка обновляются на месте; пока запрос идёт, кнопка
 *  неактивна; ошибка — строка в тосте, состояние остаётся прежним. */
function accessCell(u) {
  const chip = h('span');
  const box = h('span', { class: 'access-cell', dataset: { role: 'access' } }, chip);
  let btn = null;
  const paint = () => {
    chip.className = u.aiAccess ? 'chip ok' : 'chip';
    chip.textContent = u.aiAccess ? 'есть' : 'нет';
    if (!btn) return;
    btn.className = u.aiAccess ? 'btn-danger btn-sm' : 'btn-soft btn-sm';
    btn.textContent = u.aiAccess ? 'Забрать доступ' : 'Дать доступ к агенту';
  };
  // У аккаунта без почты (вход по телефону, гость) выдавать некому: в списке доступа ключ — почта.
  if (u.email) {
    btn = h('button', { type: 'button', dataset: { action: 'access' }, on: { click: async (e) => {
      e.stopPropagation();
      const give = !u.aiAccess;
      if (!give) {
        const ok = await confirmDialog({ title: 'Закрыть доступ к агенту?', text: `${u.email} больше не сможет писать агенту. Чаты на устройстве останутся.`, ok: 'Закрыть доступ', danger: true });
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        await call(give ? 'access.add' : 'access.remove', give ? { email: u.email, note: GRANT_NOTE } : { email: u.email });
        u.aiAccess = give;
        toast(give ? 'Доступ выдан' : 'Доступ закрыт');
      } catch (err) { toast(errorText(err)); } finally { btn.disabled = false; paint(); }
    } } });
    box.append(btn);
  }
  paint();
  return box;
}

function table(rows) {
  const head = h('tr', null,
    ['Почта', 'Регистрация', 'Последний вход', 'Активность', 'Проекты', 'Задачи', 'Отзывы', 'Агент 7 дн.', 'Агент']
      .map((t, i) => h('th', { class: i >= 4 && i <= 7 ? 'num' : null, scope: 'col', text: t })));
  const body = rows.map((u) => h('tr', { class: 'row-link', dataset: { id: u.id }, on: { click: (e) => { if (!e.target.closest('a, button')) location.hash = `#/users/${encodeURIComponent(u.id)}`; } } },
    h('td', { class: 'cell-main' },
      h('a', { class: 'cell-title', href: `#/users/${encodeURIComponent(u.id)}`, text: u.email || '(без почты)' }),
      h('span', { class: 'cell-sub', text: PROVIDER[u.provider] || u.provider || '' })),
    h('td', { class: 'nowrap', text: fmtDate(u.createdAt) }),
    h('td', { class: 'nowrap', text: fmtDate(u.lastSignInAt) }),
    h('td', { class: 'nowrap', text: fmtDay(u.lastActiveDay) }),
    h('td', { class: 'num', text: fmtNum(u.projects) }),
    h('td', { class: 'num', text: fmtNum(u.tasks) }),
    h('td', { class: 'num', text: fmtNum(u.feedback) }),
    h('td', { class: 'num', text: fmtNum(u.aiCalls7) }),
    h('td', null, accessCell(u))));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl tbl-users', id: 'users-table' }, h('thead', null, head), h('tbody', null, body)));
}

function pager(total, onPage) {
  const pages = Math.max(1, Math.ceil(total / PER));
  if (pages <= 1) return null;
  const from = (pageNo - 1) * PER + 1;
  const to = Math.min(total, pageNo * PER);
  return h('div', { class: 'pager' },
    h('button', { type: 'button', class: 'btn-soft', disabled: pageNo <= 1, on: { click: () => onPage(pageNo - 1) } }, '← Назад'),
    h('span', { class: 'muted', text: `${fmtNum(from)}–${fmtNum(to)} из ${fmtNum(total)}` }),
    h('button', { type: 'button', class: 'btn-soft', disabled: pageNo >= pages, on: { click: () => onPage(pageNo + 1) } }, 'Вперёд →'));
}

function mountList(root) {
  const search = h('input', { class: 'field search-field', type: 'search', id: 'users-search', placeholder: 'Почта или id', 'aria-label': 'Поиск пользователей', value: query, autocomplete: 'off' });
  const count = h('span', { class: 'page-count', id: 'users-count' });
  const seg = segmented(FILTERS, filter, (v) => { filter = v; pageNo = 1; reload(); }, 'Доступ к агенту');
  seg.id = 'users-filter';
  const { body } = page(root, 'Пользователи', [count, seg, search]);
  const list = h('div', { class: 'island table-island' });
  body.append(list);
  const reload = loadInto(list, () => call('users', { q: query, page: pageNo, per: PER, ...(filter === 'all' ? {} : { access: filter }) }), (res) => {
    const rows = rowsOf(res, 'users');
    const total = Number(res.total) || rows.length;
    count.textContent = `всего ${fmtNum(total)}`;
    if (!rows.length) {
      list.replaceChildren(query || filter !== 'all'
        ? emptyState({ art: 'search', title: 'Никого не нашлось', text: filter === 'all' ? 'Проверьте почту или сотрите поиск.' : 'Проверьте почту, сотрите поиск или выберите «Все».' })
        : emptyState({ art: 'projects', title: 'Пользователей пока нет', text: 'Здесь появятся все, кто завёл аккаунт.' }));
      return;
    }
    list.replaceChildren(table(rows), pager(total, (p) => { pageNo = p; reload(); }) || '');
  });
  const run = () => { const q = search.value.trim(); if (q === query) return; query = q; pageNo = 1; reload(); };
  search.addEventListener('input', debounce(run, 300));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

function detailRows(pairs) {
  return h('dl', { class: 'dl' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', { text: k }), h('dd', null, v)]));
}

function mountCard(root, id) {
  const back = h('a', { class: 'btn-soft', href: '#/users' }, '← Все пользователи');
  const { body, head } = page(root, 'Пользователь', [back]);
  loadInto(body, () => call('user', { id }), (res) => {
    const u = res.user || res;
    head.querySelector('.page-title').textContent = u.email || 'Пользователь';
    const feedback = rowsOf(res, 'feedback').length ? rowsOf(res, 'feedback') : (Array.isArray(u.recentFeedback) ? u.recentFeedback : []);
    const calls = Array.isArray(res.aiCalls) ? res.aiCalls : Array.isArray(u.aiCalls) ? u.aiCalls : [];
    const info = island('Аккаунт', null, detailRows([
      ['ID', h('span', { class: 'id-row' }, h('code', { class: 'mono', text: u.id || id }), copyButton(() => u.id || id))],
      ['Почта', u.email || '—'],
      ['Вход через', (Array.isArray(u.providers) && u.providers.length ? u.providers : [u.provider]).filter(Boolean).map((p) => PROVIDER[p] || p).join(', ') || '—'],
      ['Регистрация', fmtDateTime(u.createdAt)],
      'emailConfirmedAt' in u ? ['Почта подтверждена', u.emailConfirmedAt ? fmtDateTime(u.emailConfirmedAt) : 'нет'] : null,
      'mfaFactors' in u ? ['Второй фактор', u.mfaFactors ? 'подключён' : 'нет'] : null,
      ['Последний вход', fmtDateTime(u.lastSignInAt)],
      ['Последняя активность', fmtDay(u.lastActiveDay)],
      ['Доступ к агенту', accessCell(u)],
    ]));
    const nums = h('div', { class: 'stats' },
      [['Проекты', u.projects], ['Задачи', u.tasks], ['Отзывы', u.feedback], ['Агент за 7 дней', u.aiCalls7]]
        .map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: k }), h('div', { class: 'stat-value num', text: fmtNum(v) }))));
    const fb = island('Последние отзывы', null, feedback.length
      ? h('ul', { class: 'rows' }, feedback.map((f) => h('li', { class: 'rows-item' },
          h('div', { class: 'rows-head' },
            h('span', { class: 'chip', text: KIND[f.kind] || f.kind || '—' }),
            h('span', { class: `chip st-${f.status || 'new'}`, text: STATUS[f.status] || f.status || 'Новый' }),
            h('span', { class: 'muted', text: fmtDateTime(f.createdAt) })),
          h('p', { class: 'rows-text clamp', text: f.text || '' }))))
      : emptyState({ art: 'chat', small: true, title: 'Отзывов не было' }));
    fb.dataset.list = 'user-feedback';
    const ai = island('Вызовы агента', 'без текста переписки', calls.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { text: 'Когда' }), h('th', { text: 'Модель' }), h('th', { class: 'num', text: 'Единицы' }), h('th', { text: 'В лимит' }))),
          h('tbody', null, calls.map((c) => h('tr', null,
            h('td', { class: 'nowrap', text: fmtDateTime(c.createdAt || c.at) }),
            h('td', { text: c.model || '—' }),
            h('td', { class: 'num', text: fmtNum(c.units != null ? c.units : c.costUnits) }),
            h('td', { text: c.counted === false ? 'нет' : 'да' }))))))
      : emptyState({ art: 'chat', small: true, title: 'Агентом не пользовался' }));
    ai.dataset.list = 'user-ai';
    // Экраны человека за 30 дней — только имена экранов и числа.
    const screens = Array.isArray(res.screens) ? res.screens : [];
    const label = (s) => (window.AdminScreens && window.AdminScreens.screenLabel(s.platform, s.screen)) || s.screen;
    const scr = island('Экраны за 30 дней', 'просмотры · дней', screens.length
      ? barList(screens.slice(0, 12).map((s) => ({ label: label(s), code: `${s.screen} · ${PLATFORM[s.platform] || s.platform}`, value: Number(s.views) || 0, sub: s.days != null ? `${fmtNum(s.days)} дн.` : null })))
      : emptyState({ art: 'search', small: true, title: 'Экраны не считались', text: 'Счётчик пишет только у включивших «Статистику экранов».' }));
    scr.dataset.list = 'user-screens';
    body.replaceChildren(nums, h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, info, scr), h('div', { class: 'stack' }, fb, ai)));
  });
}

export function mount(root, rest) {
  if (rest[0]) mountCard(root, rest[0]);
  else mountList(root);
}

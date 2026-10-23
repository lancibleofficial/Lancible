// Выпуски: что сейчас выпущено (версии в main, релизы, манифесты, кнопки
// лендинга), последние запуски и кнопка «Выпустить». Выпуск — запуск
// publish.yml: сначала все тесты (Linux CI и Windows со снимками), упал хоть
// один — ничего не публикуется.
import { call, errorText } from '../api.js';
import { h, page, island, loadInto, emptyState, field, confirmDialog, toast, extLink, fmtDateTime } from '../ui.js';

const VERSION = /^\d+\.\d+\.\d+$/;

const RUN = {
  queued: { cls: '', text: 'в очереди' },
  in_progress: { cls: 'info', text: 'идёт' },
  waiting: { cls: 'info', text: 'ждёт' },
  success: { cls: 'ok', text: 'успешно' },
  pending: { cls: '', text: 'ждёт' },
  failure: { cls: 'danger', text: 'упал' },
  cancelled: { cls: 'warn', text: 'отменён' },
  skipped: { cls: '', text: 'пропущен' },
};

/** Следующая заплатка: 0.5.1 → 0.5.2. */
export const bump = (v) => (VERSION.test(v || '') ? v.replace(/(\d+)$/, (n) => String(Number(n) + 1)) : '');

const versionOf = (x) => (x == null ? null : typeof x === 'string' ? x : x.version || null);

function norm(res) {
  const main = res.main || res.versions || {};
  const landing = res.landing || res.buttons || {};
  let manifests = res.manifests || {};
  if (Array.isArray(manifests)) manifests = Object.fromEntries(manifests.map((m) => [m.name || m.file, m]));
  return {
    desktop: versionOf(main.desktop),
    mobile: versionOf(main.mobile),
    landingDesktop: versionOf(landing.desktop),
    landingMobile: versionOf(landing.mobile),
    manifests,
    releases: Array.isArray(res.releases) ? res.releases : [],
    runs: Array.isArray(res.runs) ? res.runs : [],
    // Без GITHUB_RELEASE_TOKEN статус читается, а выпуск — нет.
    token: res.token !== false,
    errors: res.errors && typeof res.errors === 'object' ? res.errors : {},
  };
}

function cell(v, expected) {
  if (!v) return h('span', { class: 'muted', text: '—' });
  const off = expected && v !== expected;
  return h('span', { class: off ? 'chip warn' : 'chip ok', title: off ? `в main — ${expected}` : null, text: v });
}

const manifest = (name, v, expected) => h('span', { class: 'manifest', dataset: { manifest: name } }, h('span', { class: 'muted', text: name }), cell(v, expected));

function lastTag(releases, re) {
  const r = releases.find((x) => re.test(x.tag || x.tagName || ''));
  return r ? (r.tag || r.tagName).replace(/^mobile-v|^v/, '') : null;
}

function current(st) {
  const m = (name) => versionOf(st.manifests[name]);
  const desk = lastTag(st.releases, /^v\d/);
  const mob = lastTag(st.releases, /^mobile-v\d/);
  const row = (label, a, b) => h('tr', null, h('th', { scope: 'row', text: label }), h('td', null, a), h('td', null, b));
  const failedReads = Object.entries(st.errors);
  const box = island('Сейчас выпущено', 'зелёное — совпадает с main',
    failedReads.length
      ? h('p', { class: 'island-lede warn-line', id: 'release-errors', text: `Не прочитано: ${failedReads.map(([k, v]) => `${k} (${v})`).join(', ')}.` })
      : null,
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl tbl-kv', id: 'release-now' },
      h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { scope: 'col', text: 'Десктоп' }), h('th', { scope: 'col', text: 'Телефон' }))),
      h('tbody', null,
        row('Версия в main', cell(st.desktop), cell(st.mobile)),
        row('Последний релиз', cell(desk, st.desktop), cell(mob, st.mobile)),
        row('Манифесты',
          h('span', { class: 'manifests' }, manifest('latest.yml', m('latest.yml'), st.desktop), manifest('latest-mac.yml', m('latest-mac.yml'), st.desktop)),
          h('span', { class: 'manifests' }, manifest('latest.json', m('latest.json'), st.mobile))),
        row('Кнопки лендинга', cell(st.landingDesktop, st.desktop), cell(st.landingMobile, st.mobile))))));
  return box;
}

/** Состояние запуска или работы по полям GitHub: итог, а пока его нет — ход. */
export const stateOf = (x) => (x && (x.conclusion || (x.status === 'completed' ? 'success' : x.status))) || 'queued';
const failed = (x) => stateOf(x) === 'failure';
/** Работа «Версии и теги»: после неё теги уже стоят. */
const isTagsJob = (j) => j.key === 'tags' || /тег|tag/i.test(j.name || '');
const failedStep = (j) => j.failedStep || j.failed_step || j.step || null;

/** Подсказка к упавшему запуску: до тегов — выпускать заново можно, после —
 *  только перезапуск упавших работ (новый запуск той же версии встанет на
 *  «тег уже есть»). */
function runHint(run, jobs) {
  if (!failed(run)) return null;
  const tags = jobs.findIndex(isTagsJob);
  const fail = jobs.findIndex(failed);
  if (tags >= 0 && fail > tags && stateOf(jobs[tags]) === 'success') {
    return h('div', { class: 'run-hint warn-box', dataset: { hint: 'rerun' } },
      h('p', { class: 'warn-title', text: 'Теги уже поставлены' }),
      h('p', { text: 'Новый запуск с той же версией остановится на «тег уже есть». Перезапустите только упавшие работы.' }),
      extLink(run.url, 'Перезапустить упавшие работы на GitHub ↗', 'link'));
  }
  if (fail >= 0 && (tags < 0 || fail <= tags)) {
    return h('p', { class: 'run-hint muted', dataset: { hint: 'retry' }, text: 'Упало до тегов — ничего не опубликовано. Можно выпустить заново той же версией.' });
  }
  return null;
}

function runCard(r) {
  const st = RUN[stateOf(r)] || { cls: '', text: stateOf(r) };
  const jobs = Array.isArray(r.jobs) ? r.jobs : [];
  const versions = [r.desktop && `десктоп ${r.desktop}`, r.mobile && `телефон ${r.mobile}`].filter(Boolean).join(' · ');
  return h('li', { class: 'run', dataset: { run: String(r.id || '') } },
    h('div', { class: 'run-head' },
      h('div', { class: 'access-main' },
        h('span', { class: 'run-title', text: r.title || r.displayTitle || r.name || `Запуск ${r.id || ''}` }),
        h('span', { class: 'muted', text: [fmtDateTime(r.createdAt || r.created_at), versions].filter(Boolean).join(' · ') })),
      h('span', { class: `chip ${st.cls}`, dataset: { role: 'run-state' }, text: st.text }),
      r.url ? extLink(r.url, 'Запуск на GitHub ↗', 'link') : null),
    jobs.length
      ? h('ol', { class: 'steps', 'aria-label': 'Работы запуска' }, jobs.map((j) => {
          const js = RUN[stateOf(j)] || { cls: '', text: stateOf(j) };
          const step = failed(j) && failedStep(j);
          const now = stateOf(j) === 'in_progress' && j.currentStep;
          return h('li', { class: `step ${js.cls ? `st-${js.cls}` : 'st-idle'}`, dataset: { job: j.key || j.name || '' } },
            h('span', { class: 'step-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'step-body' },
              j.url ? extLink(j.url, j.name || j.key || '—', 'step-name') : h('span', { class: 'step-name', text: j.name || j.key || '—' }),
              h('span', { class: 'step-state', text: js.text }),
              step ? h('span', { class: 'step-fail', text: `шаг «${step}»` }) : null,
              now ? h('span', { class: 'step-now', text: `сейчас «${now}»` }) : null));
        }))
      : r.jobsError ? h('p', { class: 'muted', text: `Работы запуска не прочитаны (${r.jobsError}).` }) : null,
    runHint(r, jobs));
}

function runsIsland(runs) {
  return island('Последние запуски выпуска', 'publish.yml', runs.length
    ? h('ul', { class: 'runs', id: 'release-runs' }, runs.slice(0, 5).map(runCard))
    : emptyState({ art: 'timer', small: true, title: 'Запусков ещё не было' }));
}

function releasesIsland(releases) {
  return island('Релизы на GitHub', null, releases.length
    ? h('ul', { class: 'rows', id: 'release-list' }, releases.slice(0, 8).map((r) => h('li', { class: 'rows-item' },
        h('div', { class: 'access-main' }, h('code', { class: 'mono', text: r.tag || r.tagName || '—' }), h('span', { class: 'muted', text: r.name || '' })),
        r.draft ? h('span', { class: 'chip warn', text: 'черновик' }) : r.prerelease ? h('span', { class: 'chip', text: 'пред-выпуск' }) : null,
        h('span', { class: 'muted nowrap', text: fmtDateTime(r.publishedAt || r.published_at) }),
        r.url ? extLink(r.url, 'Открыть ↗', 'link') : null)))
    : emptyState({ art: 'versions', small: true, title: 'Релизов нет' }));
}

function startIsland(st) {
  const desktop = h('input', { class: 'field', id: 'rel-desktop', type: 'text', inputmode: 'decimal', placeholder: bump(st.desktop) ? `например, ${bump(st.desktop)}` : 'например, 0.1.0', autocomplete: 'off' });
  const mobile = h('input', { class: 'field', id: 'rel-mobile', type: 'text', inputmode: 'decimal', placeholder: bump(st.mobile) ? `например, ${bump(st.mobile)}` : 'например, 1.0.0', autocomplete: 'off' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const out = h('div', { class: 'release-result', id: 'release-result', hidden: true });
  const go = h('button', { type: 'button', class: 'btn-accent', id: 'release-start', disabled: !st.token }, 'Выпустить…');
  const noToken = st.token ? null : h('p', { class: 'form-error', id: 'release-no-token', text: 'Не задан GITHUB_RELEASE_TOKEN — выпуск кнопкой недоступен. Секрет задаётся в Supabase → Edge Functions → Secrets.' });

  go.addEventListener('click', async () => {
    const d = desktop.value.trim();
    const m = mobile.value.trim();
    if (!d && !m) { err.textContent = 'Укажите версию десктопа, телефона или обе.'; err.hidden = false; return; }
    for (const [v, name] of [[d, 'десктопа'], [m, 'телефона']]) {
      if (v && !VERSION.test(v)) { err.textContent = `Версия ${name} — три числа через точку, например 0.5.2.`; err.hidden = false; return; }
    }
    err.hidden = true;
    const what = [d && `десктоп ${d} (Windows и macOS)`, m && `телефон ${m}`].filter(Boolean).join(' и ');
    const ok = await confirmDialog({
      title: 'Выпустить?',
      text: h('div', { class: 'modal-text' },
        h('p', { text: `Выйдет ${what}.` }),
        h('p', { text: 'Сначала пройдут все тесты — Linux CI и Windows со снимками. Если упадёт хоть один, ничего не опубликуется.' })),
      ok: 'Выпустить',
    });
    if (!ok) return;
    go.disabled = true;
    try {
      const params = {};
      if (d) params.desktop = d;
      if (m) params.mobile = m;
      const res = await call('releases.start', params);
      out.replaceChildren(
        h('p', { text: 'Запуск начат. Сначала идут тесты — выпуск займёт время.' }),
        res.url ? extLink(res.url, /\/runs\/\d+/.test(res.url) ? 'Открыть запуск на GitHub ↗' : 'Открыть запуски на GitHub ↗', 'link') : null);
      out.hidden = false;
      desktop.value = ''; mobile.value = '';
      toast('Выпуск запущен — запуск появится в списке после «Обновить»');
    } catch (e) {
      err.textContent = errorText(e); err.hidden = false;
    } finally { go.disabled = false; }
  });

  const box = island('Выпустить', null,
    h('div', { class: 'warn-box' },
      h('p', { class: 'warn-title', text: 'Сначала идут все тесты' }),
      h('p', { text: 'Linux CI и Windows со снимками. Упал хоть один — ничего не публикуется: ни тегов, ни сборок, ни latest.json, ни кнопок лендинга.' })),
    h('div', { class: 'form-grid' },
      field('Десктоп, версия', desktop, st.desktop ? `сейчас ${st.desktop}; пусто — не выпускать` : 'пусто — не выпускать'),
      field('Телефон, версия', mobile, st.mobile ? `сейчас ${st.mobile}; пусто — не выпускать` : 'пусто — не выпускать')),
    err,
    noToken,
    h('div', { class: 'form-actions' }, go),
    out);
  box.id = 'release-form';
  return box;
}

export function mount(root) {
  const refresh = h('button', { type: 'button', class: 'btn-soft', id: 'release-refresh' }, 'Обновить');
  const { body } = page(root, 'Выпуски', [refresh]);
  const reload = loadInto(body, () => call('releases.status'), (res) => {
    const st = norm(res);
    body.replaceChildren(
      h('div', { class: 'grid-2' },
        h('div', { class: 'stack' }, current(st), startIsland(st)),
        h('div', { class: 'stack' }, runsIsland(st.runs), releasesIsland(st.releases))));
  });
  refresh.addEventListener('click', () => reload());
}

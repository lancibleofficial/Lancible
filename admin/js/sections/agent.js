// Агент и API: модель, усилие, лимиты и бюджет агента (app_settings), список
// доступа к агенту (ai_access), ключи — только «задан / не задан».
// Значения ключей в админку не приходят никогда.
import { call, rowsOf, errorText, ApiError } from '../api.js';
import { h, page, island, segmented, loadInto, emptyState, field, selectButton, openMenu, confirmDialog, toast, fmtDate, fmtDateTime, fmtNum } from '../ui.js';

/** Белый список и пределы — у функции admin (settings.get → options); здесь
 *  — запасные на случай, если она их не прислала. */
const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
const RANGES = { dailyLimit: { min: 1, max: 1000 }, dailyUnits: { min: 10000, max: 100000000 } };
/** Откуда сейчас значение (settings.get → source). */
const SOURCE = { settings: 'из админки', secret: 'из секрета функции', default: 'по умолчанию' };
const EFFORTS = [
  { value: 'low', label: 'Низкое' },
  { value: 'medium', label: 'Среднее' },
  { value: 'high', label: 'Высокое' },
];
const SECRET_NOTE = {
  ANTHROPIC_API_KEY: 'агент',
  TELEGRAM_BOT_TOKEN: 'бот отзывов',
  RESEND_API_KEY: 'ответы письмом',
  FEEDBACK_FROM: 'адрес отправителя',
  GITHUB_RELEASE_TOKEN: 'выпуск кнопкой',
};

/** Только эти поля уходят в settings.set — остальное функция не принимает. */
export const SETTINGS_FIELDS = ['model', 'effort', 'dailyLimit', 'dailyUnits'];

const intIn = (s, r) => /^\d+$/.test(String(s).trim()) && Number(s) >= r.min && Number(s) <= r.max;

function settingsIsland(settings) {
  const ai = settings.ai || {};
  const options = settings.options || {};
  const ranges = { dailyLimit: options.dailyLimit || RANGES.dailyLimit, dailyUnits: options.dailyUnits || RANGES.dailyUnits };
  const source = settings.source || {};
  const cur = { model: ai.model || MODELS[0], effort: ai.effort || 'medium', dailyLimit: ai.dailyLimit, dailyUnits: ai.dailyUnits };
  const saved = { ...cur };
  const list = Array.isArray(options.models) && options.models.length ? options.models : MODELS;
  const modelBtn = selectButton(cur.model, (btn) => {
    const opts = list.includes(cur.model) ? list : [cur.model, ...list];
    openMenu(btn, opts.map((m) => ({ value: m, label: m, sel: m === cur.model })), (m) => { cur.model = m; modelBtn.setText(m); dirty(); });
  }, { id: 'ai-model' });
  const effort = segmented(EFFORTS, cur.effort, (v) => { cur.effort = v; dirty(); }, 'Усилие');
  effort.id = 'ai-effort';
  const limit = h('input', { class: 'field num-field', id: 'ai-limit', type: 'text', inputmode: 'numeric', value: cur.dailyLimit != null ? String(cur.dailyLimit) : '' });
  const units = h('input', { class: 'field num-field', id: 'ai-units', type: 'text', inputmode: 'numeric', value: cur.dailyUnits != null ? String(cur.dailyUnits) : '' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'button', class: 'btn-accent', id: 'ai-save', disabled: true }, 'Сохранить');

  function read() {
    return { model: cur.model, effort: cur.effort, dailyLimit: limit.value.trim(), dailyUnits: units.value.trim() };
  }
  function dirty() {
    const v = read();
    const changed = v.model !== saved.model || v.effort !== saved.effort || v.dailyLimit !== String(saved.dailyLimit ?? '') || v.dailyUnits !== String(saved.dailyUnits ?? '');
    save.disabled = !changed;
  }
  limit.addEventListener('input', dirty);
  units.addEventListener('input', dirty);

  save.addEventListener('click', async () => {
    const v = read();
    if (!intIn(v.dailyLimit, ranges.dailyLimit) || !intIn(v.dailyUnits, ranges.dailyUnits)) {
      err.textContent = `Лимит — целое число от ${fmtNum(ranges.dailyLimit.min)} до ${fmtNum(ranges.dailyLimit.max)}, бюджет — от ${fmtNum(ranges.dailyUnits.min)} до ${fmtNum(ranges.dailyUnits.max)}.`;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const payload = { model: v.model, effort: v.effort, dailyLimit: Number(v.dailyLimit), dailyUnits: Number(v.dailyUnits) };
    save.disabled = true;
    try {
      const res = await call('settings.set', { ai: payload });
      Object.assign(saved, (res && res.ai) || payload);
      const src = (res && res.source) || {};
      for (const k of Object.keys(srcLine)) srcLine[k].textContent = SOURCE[src[k] || (k in payload ? 'settings' : '')] || '';
      toast('Настройки агента сохранены');
    } catch (e) {
      err.textContent = errorText(e);
      err.hidden = false;
    } finally {
      dirty();
    }
  });

  // Откуда значение сейчас: из админки, из секрета функции или по умолчанию.
  const srcLine = {};
  for (const k of ['model', 'effort', 'dailyLimit', 'dailyUnits']) srcLine[k] = h('span', { class: 'form-source', dataset: { source: k }, text: SOURCE[source[k]] || '' });
  const withSource = (f, k) => { f.querySelector('.form-label').append(srcLine[k]); return f; };
  const note = settings.updatedAt ? `сохранено ${fmtDateTime(settings.updatedAt)} · ai-chat берёт новое в течение минуты` : 'ai-chat берёт новые значения в течение минуты';
  const box = island('Модель и лимиты', note,
    h('div', { class: 'form-grid' },
      withSource(field('Модель', modelBtn), 'model'),
      withSource(h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: 'Усилие' }), effort), 'effort'),
      withSource(field('Сообщений в сутки на человека', limit, `Сутки — по UTC, от ${fmtNum(ranges.dailyLimit.min)} до ${fmtNum(ranges.dailyLimit.max)}. Сверх лимита агент отвечает «лимит на сегодня исчерпан».`), 'dailyLimit'),
      withSource(field('Бюджет в сутки, единиц', units, `Общий на всех, от ${fmtNum(ranges.dailyUnits.min)} до ${fmtNum(ranges.dailyUnits.max)}. Единица — токен свежего входа; кэш — 0,05, выход — ×5.`), 'dailyUnits')),
    err,
    h('div', { class: 'form-actions' }, save));
  box.id = 'ai-settings';
  return box;
}

function accessIsland(rows) {
  const email = h('input', { class: 'field', id: 'access-email', type: 'email', placeholder: 'name@example.com', autocomplete: 'off', 'aria-label': 'Почта' });
  const note = h('input', { class: 'field', id: 'access-note', type: 'text', placeholder: 'Пометка', autocomplete: 'off', 'aria-label': 'Пометка', maxlength: '200' });
  const add = h('button', { type: 'submit', class: 'btn-soft', id: 'access-add' }, 'Добавить');
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const list = h('ul', { class: 'rows', id: 'access-list' });

  const paint = () => {
    list.replaceChildren(...rows.map((r) => h('li', { class: 'rows-item access-row', dataset: { email: r.email } },
      h('div', { class: 'access-main' },
        h('span', { class: 'access-email', text: r.email }),
        r.note ? h('span', { class: 'muted', text: r.note }) : null),
      // Почта без аккаунта откроет агента тому, кто первым на неё
      // зарегистрируется (supabase/ai-access.sql), — это видно сразу.
      'userId' in r ? h('span', { class: r.userId ? 'chip ok' : 'chip warn', text: r.userId ? 'аккаунт есть' : 'аккаунта нет' }) : null,
      h('span', { class: 'muted nowrap', text: fmtDate(r.grantedAt || r.granted_at) }),
      h('button', { type: 'button', class: 'btn-danger btn-sm', dataset: { action: 'remove' }, on: { click: () => remove(r) } }, 'Удалить'))));
    if (!rows.length) list.replaceChildren(h('li', null, emptyState({ art: 'chat', small: true, title: 'Доступ пока никому не выдан', text: 'Агент закрыт для всех, кого нет в списке.' })));
  };

  async function remove(r) {
    const ok = await confirmDialog({ title: 'Закрыть доступ к агенту?', text: `${r.email} больше не сможет писать агенту. Чаты на устройстве останутся.`, ok: 'Закрыть доступ', danger: true });
    if (!ok) return;
    try {
      const res = await call('access.remove', { email: r.email });
      rows = Array.isArray(res.rows) ? res.rows : rows.filter((x) => x.email !== r.email);
      paint();
      toast('Доступ закрыт');
    } catch (e) { toast(errorText(e)); }
  }

  const form = h('form', { class: 'access-form', novalidate: true, on: { submit: async (ev) => {
    ev.preventDefault();
    const e = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { err.textContent = 'Нужна почта вида name@example.com.'; err.hidden = false; return; }
    err.hidden = true;
    add.disabled = true;
    try {
      const text = note.value.trim() || null;
      let res;
      try {
        // Сначала — только если аккаунт есть: без него функция отвечает 409 и ничего не пишет.
        res = await call('access.add', { email: e, note: text, requireAccount: true });
      } catch (x) {
        if (!(x instanceof ApiError && x.code === 'no account')) throw x;
        // Подтверждение выключено, поэтому почту без аккаунта может занять кто угодно: спрашиваем явно.
        const sure = await confirmDialog({
          title: 'Выдать доступ без аккаунта?',
          text: 'Аккаунта с этой почтой нет: доступ получит тот, кто первым на неё зарегистрируется.',
          ok: 'Всё равно выдать', danger: true,
        });
        if (!sure) return;
        res = await call('access.add', { email: e, note: text });
      }
      rows = Array.isArray(res.rows) ? res.rows : [{ email: e, note: text, grantedAt: new Date().toISOString() }, ...rows.filter((x) => x.email !== e)];
      email.value = ''; note.value = '';
      paint();
      toast(res.account === false ? 'Доступ выдан — аккаунта пока нет' : 'Доступ выдан');
    } catch (x) {
      err.textContent = errorText(x); err.hidden = false;
    } finally { add.disabled = false; }
  } } }, email, note, add);

  paint();
  const box = island('Доступ к агенту', 'по почте аккаунта', form, err, list);
  box.id = 'ai-access';
  return box;
}

function secretsIsland(secrets) {
  const names = Object.keys(secrets || {});
  const box = island('Ключи и секреты', null,
    h('p', { class: 'island-lede', text: 'Значения сюда не приходят — только есть ключ или нет. Меняются в Supabase → Edge Functions → Secrets.' }),
    names.length
      ? h('ul', { class: 'rows', id: 'secrets-list' }, names.map((n) => h('li', { class: 'rows-item secret-item', dataset: { secret: n } },
          h('div', { class: 'access-main' }, h('code', { class: 'mono', text: n }), SECRET_NOTE[n] ? h('span', { class: 'muted', text: SECRET_NOTE[n] }) : null),
          h('span', { class: secrets[n] ? 'chip ok' : 'chip warn', text: secrets[n] ? 'задан' : 'не задан' }))))
      : emptyState({ small: true, title: 'Функция не прислала список ключей' }));
  box.id = 'ai-secrets';
  return box;
}

export function mount(root) {
  const { body } = page(root, 'Агент и API');
  loadInto(body, () => Promise.all([call('settings.get'), call('access.list')]), ([settings, access]) => {
    body.replaceChildren(h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, settingsIsland(settings), secretsIsland(settings.secrets)),
      accessIsland(rowsOf(access, 'access'))));
  });
}

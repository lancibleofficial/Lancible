// Обратная связь: отзывы по статусу, снимок экрана, ответ письмом, статус.
// Ответ уходит письмом через почтовый сервис функции admin (Resend); у гостя
// почты нет — ответить нельзя, можно только сменить статус.
import { call, rowsOf, errorText } from '../api.js';
import { h, page, segmented, loadInto, emptyState, fmtNum, fmtDateTime, selectButton, openMenu, toast, extLink } from '../ui.js';

const FILTERS = [
  { value: 'new', label: 'Новые' },
  { value: 'answered', label: 'Отвеченные' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
];
const STATUS = { new: 'Новый', answered: 'Отвечен', closed: 'Закрыт' };
const KIND = { bug: 'Ошибка', idea: 'Идея', other: 'Другое' };
const PLATFORM = { web: 'Веб', desktop: 'Десктоп', android: 'Android', ios: 'iOS' };
const EMAIL = {
  sent: { cls: 'ok', text: 'письмо ушло' },
  failed: { cls: 'danger', text: 'письмо не ушло' },
  not_configured: { cls: 'warn', text: 'почта не настроена' },
};
const SENT_TEXT = {
  sent: 'Письмо отправлено.',
  failed: 'Ответ сохранён, но письмо не ушло: почтовый сервис отказал. Попробуйте позже.',
  not_configured: 'Ответ сохранён, но письмо не ушло: почта не настроена (RESEND_API_KEY).',
};

let filter = 'new';

const emailStatusOf = (r) => (r && (r.emailStatus || r.email_status)) || null;

function replyItem(r) {
  const st = EMAIL[emailStatusOf(r)];
  return h('li', { class: 'reply' },
    h('div', { class: 'rows-head' },
      h('span', { class: 'muted', text: `Ответ · ${fmtDateTime(r.sentAt || r.sent_at || r.createdAt || r.created_at)}` }),
      st ? h('span', { class: `chip ${st.cls}`, text: st.text }) : null),
    h('p', { class: 'reply-text', text: r.body || '' }));
}

function card(f) {
  const status = h('span', { class: `chip st-${f.status || 'new'}`, dataset: { role: 'status' }, text: STATUS[f.status] || f.status || 'Новый' });
  const meta = [PLATFORM[f.platform] || f.platform, f.appVersion && `версия ${f.appVersion}`, f.lang, f.device].filter(Boolean).join(' · ');
  const replies = h('ul', { class: 'replies' }, (f.replies || []).map(replyItem));
  const guest = !f.email;

  const text = h('textarea', { class: 'field reply-field', rows: '3', placeholder: guest ? 'У гостя нет почты' : 'Ответ письмом…', 'aria-label': 'Ответ письмом', disabled: guest, maxlength: '4000' });
  const send = h('button', { type: 'button', class: 'btn-soft', dataset: { action: 'reply' }, disabled: true }, 'Отправить');
  const result = h('p', { class: 'reply-result', role: 'status', hidden: true });
  text.addEventListener('input', () => { send.disabled = guest || !text.value.trim(); });

  const setStatus = (s) => {
    f.status = s;
    status.className = `chip st-${s}`;
    status.textContent = STATUS[s] || s;
    statusBtn.setText(`Статус: ${STATUS[s] || s}`);
  };

  send.addEventListener('click', async () => {
    const body = text.value.trim();
    if (!body || guest) return;
    send.disabled = true; text.disabled = true;
    result.hidden = true;
    try {
      const res = await call('feedback.reply', { id: f.id, body });
      const reply = res.reply || { body, emailStatus: emailStatusOf(res), sentAt: new Date().toISOString() };
      if (!emailStatusOf(reply) && emailStatusOf(res)) reply.emailStatus = emailStatusOf(res);
      (f.replies = f.replies || []).push(reply);
      replies.append(replyItem(reply));
      const es = emailStatusOf(reply);
      const next = res.status || (es === 'sent' ? 'answered' : f.status);
      if (next) setStatus(next);
      result.textContent = SENT_TEXT[es] || 'Ответ сохранён.';
      result.className = `reply-result ${es === 'sent' ? 'ok' : 'warn'}`;
      result.hidden = false;
      text.value = '';
    } catch (e) {
      result.textContent = errorText(e);
      result.className = 'reply-result danger';
      result.hidden = false;
      send.disabled = false;
    } finally {
      text.disabled = guest;
    }
  });

  const statusBtn = selectButton(`Статус: ${STATUS[f.status] || 'Новый'}`, (btn) => {
    openMenu(btn, Object.entries(STATUS).map(([value, label]) => ({ value, label, sel: value === f.status })), async (value) => {
      if (value === f.status) return;
      const prev = f.status;
      setStatus(value);
      try {
        await call('feedback.status', { id: f.id, status: value });
        toast(`Статус: ${STATUS[value]}`);
      } catch (e) {
        setStatus(prev);
        toast(errorText(e));
      }
    });
  }, { class: 'dp-select status-select', dataset: { action: 'status' } });

  const shot = f.screenshotUrl
    ? h('div', { class: 'shot' }, extLink(f.screenshotUrl, 'Снимок экрана ↗', 'shot-link'))
    : null;

  return h('article', { class: 'island fb-card', dataset: { id: f.id } },
    h('div', { class: 'fb-head' },
      h('div', { class: 'rows-head' },
        h('span', { class: 'chip', text: KIND[f.kind] || f.kind || '—' }),
        status,
        h('span', { class: 'muted', text: fmtDateTime(f.createdAt) })),
      statusBtn),
    h('div', { class: 'fb-from' },
      guest ? h('span', { class: 'muted', text: 'Гость — без почты' }) : h('span', { class: 'fb-email', text: f.email }),
      meta ? h('span', { class: 'muted', text: meta }) : null),
    h('p', { class: 'fb-text', text: f.text || '' }),
    shot,
    replies,
    h('div', { class: 'reply-form' },
      text,
      h('div', { class: 'reply-actions' },
        guest ? h('p', { class: 'form-hint', dataset: { role: 'guest-note' }, text: 'Гость не оставил почту — ответить письмом нельзя. Можно сменить статус.' }) : h('span'),
        send),
      result));
}

export function mount(root) {
  const filt = segmented(FILTERS, filter, (v) => { filter = v; pageNo = 1; reload(); }, 'Статус отзывов');
  filt.id = 'feedback-filter';
  const count = h('span', { class: 'page-count', id: 'feedback-count' });
  const { body } = page(root, 'Обратная связь', [count, filt]);
  let pageNo = 1;
  let shown = [];
  const list = h('div', { class: 'stack' });
  body.append(list);
  const params = () => (filter === 'all' ? { page: pageNo } : { status: filter, page: pageNo });
  const reload = loadInto(list, () => call('feedback.list', params()), (res) => {
    const rows = rowsOf(res, 'feedback');
    const total = Number(res.total) || rows.length;
    shown = pageNo === 1 ? rows : shown.concat(rows);
    count.textContent = `${fmtNum(total)} ${filter === 'all' ? 'всего' : FILTERS.find((x) => x.value === filter).label.toLowerCase()}`;
    if (!shown.length) {
      list.replaceChildren(emptyState({ art: 'chat', title: filter === 'new' ? 'Новых отзывов нет' : 'Здесь пусто', text: filter === 'new' ? 'Всё прочитано. Новые отзывы появятся здесь сами.' : 'Выберите «Все», чтобы увидеть отзывы целиком.' }));
      return;
    }
    const more = shown.length < total
      ? h('button', { type: 'button', class: 'btn-soft more-btn', on: { click: () => { pageNo += 1; reload(); } } }, 'Показать ещё')
      : null;
    list.replaceChildren(...shown.map(card), more || '');
  });
}

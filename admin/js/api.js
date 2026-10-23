// Вызов функции admin: POST { action, ...params } с JWT админа.
// Контракт (действия и формы ответов) — ARCHITECTURE.md, раздел админки, и
// supabase/functions/admin.
//
// Ошибки делятся на виды, и по виду решает уже вызывающий:
//   network   — до сервера не достучались: строка «нет связи» и «Повторить»;
//   mfa       — 403 { error: 'mfa' }: нужен второй фактор — экран кода;
//   forbidden — 403 { error: 'forbidden' }: аккаунт не админ;
//   auth      — 401 или сеанса нет: войти заново;
//   server    — всё остальное: текст ошибки сервера.
// mfa, forbidden и auth — про вход, а не про раздел: о них api сообщает
// событием на window, и app.js переключает экран входа сам.
import { functionUrl } from './config.js';
import { accessToken } from './client.js';

export class ApiError extends Error {
  constructor(kind, message, status = 0, code = '', detail = '') {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Ошибки, которые обрабатывает экран входа, а не раздел. */
export const isGateError = (e) => e instanceof ApiError && ['mfa', 'forbidden', 'auth'].includes(e.kind);

/** Понятные слова для кодов функции. Неизвестный код показывается как есть. */
const CODE_TEXT = {
  'no email': 'У отзыва нет почты — ответить письмом нельзя.',
  'not found': 'Такой записи уже нет.',
  'no account': 'Аккаунта с этой почтой нет.',
  'bad request': 'Сервер не принял данные — проверьте поля.',
  'bad value': 'Значение не из разрешённых — проверьте поля.',
  'bad version': 'Версия — три числа через точку, например 0.5.2.',
  'no github token': 'Не задан GITHUB_RELEASE_TOKEN — выпуск кнопкой недоступен.',
  github: 'GitHub не ответил. Попробуйте через минуту.',
  setup: 'В базе нет нужных таблиц или функций — выполните supabase/admin.sql.',
  db: 'База ответила ошибкой. Попробуйте ещё раз.',
  origin: 'Функция не пускает этот адрес — откройте админку с её собственного адреса.',
  internal: 'Сбой на сервере. Попробуйте ещё раз.',
};

export function errorText(e) {
  if (!(e instanceof ApiError)) return 'Что-то пошло не так. Попробуйте ещё раз.';
  if (e.kind === 'network') return 'Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.';
  if (e.kind === 'mfa') return 'Нужен второй фактор.';
  if (e.kind === 'forbidden') return 'Этот аккаунт не админ.';
  if (e.kind === 'auth') return 'Сеанс закончился — войдите снова.';
  const text = CODE_TEXT[e.code] || (e.code ? `Сервер ответил: ${e.code}` : `Сервер ответил ошибкой (HTTP ${e.status}).`);
  return e.detail && ['bad request', 'bad value', 'bad version'].includes(e.code) ? `${text} (${e.detail})` : text;
}

export async function call(action, params = {}) {
  const token = await accessToken();
  if (!token) {
    const e = new ApiError('auth', 'no session', 401);
    window.dispatchEvent(new CustomEvent('admin:gate', { detail: e }));
    throw e;
  }
  let res;
  try {
    res = await fetch(functionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...params, action }),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 'network');
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const code = body && typeof body.error === 'string' ? body.error : '';
  const detail = body ? String(body.detail || body.field || '') : '';
  let err = null;
  if (res.status === 403 && code === 'mfa') err = new ApiError('mfa', code, 403, code);
  else if (res.status === 403 && (code === 'forbidden' || !code)) err = new ApiError('forbidden', 'forbidden', 403, code);
  else if (res.status === 401) err = new ApiError('auth', code || 'unauthorized', 401, code);
  else if (!res.ok || code) err = new ApiError('server', code || `HTTP ${res.status}`, res.status, code, detail);
  if (err) {
    if (isGateError(err)) window.dispatchEvent(new CustomEvent('admin:gate', { detail: err }));
    throw err;
  }
  return body || {};
}

/** Список из ответа: функция отдаёт { ok, rows }, но разделы терпят и
 *  голый массив — так проще пережить мелкое расхождение формы. */
export const rowsOf = (res, ...keys) => {
  if (Array.isArray(res)) return res;
  for (const k of ['rows', ...keys]) if (res && Array.isArray(res[k])) return res[k];
  return [];
};

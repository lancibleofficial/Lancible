// Вход в админку: почта и пароль → второй фактор (TOTP) → разделы.
//
// Порядок проверок:
//   1. сеанса нет — форма входа;
//   2. функция admin отвечает на `me`: forbidden — «этот аккаунт не админ»
//      (второй фактор чужому аккаунту не предлагаем: подключать его не
//      админу незачем), mfa — экран второго фактора;
//   3. и своя проверка: пока токен не aal2, в разделы не пускаем, даже если
//      функция почему-то ответила.
// Второй фактор: подтверждённого TOTP нет — подключение (QR и секрет из
// mfa.enroll, код, challengeAndVerify); есть — только поле кода.
import { sb, currentAal, signOut } from './client.js';
import { call, errorText, ApiError } from './api.js';
import { h, errorBox, copyButton } from './ui.js';

let onEnter = () => {};
let busy = false;

const body = () => document.getElementById('auth-body');

function show(...nodes) {
  document.getElementById('app').hidden = true;
  document.getElementById('boot').hidden = true;
  document.getElementById('auth').hidden = false;
  body().replaceChildren(...nodes);
  const first = body().querySelector('input:not([disabled]), button.btn-accent');
  if (first) first.focus();
}

const title = (text) => h('h1', { class: 'auth-title', text });
const lede = (text) => h('p', { class: 'auth-lede', text });
const errLine = () => h('p', { class: 'auth-error', role: 'alert', hidden: true });
const setErr = (el, text) => { el.textContent = text || ''; el.hidden = !text; };

function signOutLink() {
  return h('button', { type: 'button', class: 'linklike auth-out', on: { click: async () => { await signOut(); showLogin(); } } }, 'Выйти');
}

/** Точка входа: решает, какой экран показать. enter(me) — когда пустили. */
export function startAuth(enter) {
  onEnter = enter;
  return gate();
}

export async function gate(note) {
  const { data } = await sb().auth.getSession();
  if (!data || !data.session) return showLogin(note);
  let me;
  try {
    me = await call('me');
  } catch (e) {
    return handleGateError(e);
  }
  if ((await currentAal()) !== 'aal2') return showMfa();
  return onEnter(me);
}

/** Ошибка входа, пришедшая из любого места (событие admin:gate). */
export function handleGateError(e) {
  if (!(e instanceof ApiError)) return showRetry(e);
  if (e.kind === 'mfa') return showMfa();
  if (e.kind === 'forbidden') return showForbidden();
  if (e.kind === 'auth') return signOut().then(() => showLogin('Сеанс закончился — войдите снова.'));
  return showRetry(e);
}

function showRetry(e) {
  show(title('Админка Lancible'), errorBox(e, () => gate()), signOutLink());
}

// ---------- почта и пароль ----------

export function showLogin(note) {
  const email = h('input', { class: 'field', type: 'email', name: 'email', autocomplete: 'username', required: true, id: 'login-email' });
  const pass = h('input', { class: 'field', type: 'password', name: 'password', autocomplete: 'current-password', required: true, id: 'login-password' });
  const err = errLine();
  const btn = h('button', { type: 'submit', class: 'btn-accent auth-submit' }, 'Войти');
  const form = h('form', { class: 'auth-form', id: 'login-form', novalidate: true, on: { submit: async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (!email.value.trim() || !pass.value) { setErr(err, 'Введите почту и пароль.'); return; }
    busy = true; btn.disabled = true; setErr(err, '');
    try {
      const { error } = await sb().auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) {
        const bad = /invalid login credentials/i.test(error.message || '') || error.status === 400;
        setErr(err, bad ? 'Неверная почта или пароль.' : (error.status ? `Вход не удался: ${error.message}` : errorText(new ApiError('network', 'network'))));
        return;
      }
      pass.value = '';
      await gate();
    } catch {
      setErr(err, errorText(new ApiError('network', 'network')));
    } finally {
      busy = false; btn.disabled = false;
    }
  } } },
  h('label', { class: 'form-label', for: 'login-email' }, 'Почта'), email,
  h('label', { class: 'form-label', for: 'login-password' }, 'Пароль'), pass,
  err, btn);
  show(title('Вход в админку'), note ? h('p', { class: 'auth-note', text: note }) : null, lede('Только для аккаунта владельца. После пароля — код из приложения-аутентификатора.'), form);
}

// ---------- второй фактор ----------

function codeInput() {
  return h('input', {
    class: 'field code-field', id: 'mfa-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
    maxlength: '6', pattern: '[0-9]{6}', placeholder: '000000', 'aria-label': 'Код из приложения',
  });
}

async function verify(factorId, input, err, btn) {
  const code = input.value.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) { setErr(err, 'Код — шесть цифр из приложения.'); return; }
  if (busy) return;
  busy = true; btn.disabled = true; setErr(err, '');
  try {
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setErr(err, error.status ? 'Код не подошёл. Проверьте время на телефоне и введите новый.' : errorText(new ApiError('network', 'network')));
      input.select();
      return;
    }
    await gate();
  } catch {
    setErr(err, errorText(new ApiError('network', 'network')));
  } finally {
    busy = false; btn.disabled = false;
  }
}

function codeForm(factorId) {
  const input = codeInput();
  const err = errLine();
  const btn = h('button', { type: 'submit', class: 'btn-accent auth-submit' }, 'Подтвердить');
  const form = h('form', { class: 'auth-form', id: 'mfa-form', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); verify(factorId, input, err, btn); } } },
    h('label', { class: 'form-label', for: 'mfa-code' }, 'Код из приложения'), input, err, btn);
  return form;
}

export async function showMfa() {
  show(title('Второй фактор'), h('div', { class: 'note', 'aria-busy': 'true' }, 'Проверяю…'));
  let factors;
  try {
    const { data, error } = await sb().auth.mfa.listFactors();
    if (error) throw error;
    factors = data;
  } catch (e) {
    if (e && e.status === 401) { await signOut(); return showLogin('Сеанс закончился — войдите снова.'); }
    return show(title('Второй фактор'), errorBox(new ApiError('network', 'network'), () => showMfa()), signOutLink());
  }
  const verified = (factors.totp || []).filter((f) => f.status === 'verified');
  if (verified.length) {
    return show(title('Второй фактор'), lede('Введите шесть цифр из приложения-аутентификатора.'), codeForm(verified[0].id), signOutLink());
  }
  return enroll(factors.all || []);
}

async function enroll(all) {
  show(title('Подключите второй фактор'), h('div', { class: 'note', 'aria-busy': 'true' }, 'Готовлю код…'));
  try {
    // Брошенное подключение (закрыли вкладку до кода) мешает новому с тем же
    // именем — снимаем неподтверждённые TOTP перед новым.
    for (const f of all) {
      if (f.factor_type === 'totp' && f.status !== 'verified') await sb().auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Lancible Admin', issuer: 'Lancible Admin' });
    if (error) throw error;
    const secret = (data.totp && data.totp.secret) || '';
    const qr = h('img', { class: 'qr', id: 'mfa-qr', alt: 'QR-код для приложения-аутентификатора', width: '184', height: '184' });
    qr.src = (data.totp && data.totp.qr_code) || '';
    return show(
      title('Подключите второй фактор'),
      lede('Без второго фактора админка не откроется. Отсканируйте код в приложении-аутентификаторе (1Password, Aegis, Google Authenticator) или введите секрет вручную, затем — шесть цифр из приложения.'),
      h('div', { class: 'qr-plate' }, qr),
      h('div', { class: 'secret-row' },
        h('code', { class: 'secret', id: 'mfa-secret', text: secret }),
        copyButton(() => secret)),
      codeForm(data.id),
      signOutLink());
  } catch (e) {
    const err = e && e.status ? new ApiError('server', e.message || 'enroll', e.status, e.message || '') : new ApiError('network', 'network');
    return show(title('Подключите второй фактор'), errorBox(err, () => showMfa()), signOutLink());
  }
}

// ---------- не админ ----------

export function showForbidden() {
  show(
    title('Этот аккаунт не админ'),
    lede('Админка открыта только аккаунту владельца. Войдите им — или закройте вкладку.'),
    h('button', { type: 'button', class: 'btn-soft', id: 'forbidden-out', on: { click: async () => { await signOut(); showLogin(); } } }, 'Выйти и войти другим аккаунтом'));
}

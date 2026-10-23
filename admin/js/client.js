// Клиент Supabase админки. Только вход: почта и пароль, второй фактор,
// выход. Данные админка в базе не читает — всё через функцию admin (api.js).
//
// Сеанс — только в sessionStorage: закрыл вкладку — вышел. В localStorage
// токен пережил бы вкладку и браузер, а админке это не нужно и опасно.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;

export function sb() {
  if (!client) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Текущий токен доступа или null. */
export async function accessToken() {
  const { data } = await sb().auth.getSession();
  return (data && data.session && data.session.access_token) || null;
}

/** Уровень входа по токену сеанса: 'aal1', 'aal2' или null. Это проверка
 *  на своей стороне — функция admin проверяет то же у себя. */
export async function currentAal() {
  const { data, error } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return null;
  return data.currentLevel || null;
}

/** Выход. Сначала — везде (отзывает обновляющий токен на сервере); не
 *  вышло (нет сети) — хотя бы здесь: сеанс из вкладки уходит в любом случае. */
export async function signOut() {
  try {
    const { error } = await sb().auth.signOut();
    if (!error) return;
  } catch { /* нет сети — выходим локально */ }
  try { await sb().auth.signOut({ scope: 'local' }); } catch { /* уже вышли */ }
  try {
    for (const k of Object.keys(window.sessionStorage)) if (k.startsWith('sb-')) window.sessionStorage.removeItem(k);
  } catch { /* хранилище закрыто */ }
}

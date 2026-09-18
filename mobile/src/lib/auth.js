// Порт auth-логики из src/renderer/app.js:1012-1105. Вместо чтения/записи
// DOM-элементов (`el.authEmail.value`, `el.authError.hidden = ...`) каждая
// функция принимает обычные параметры и возвращает простой объект-результат
// ({ok, errorKey, needsOnboarding, ...}), который экран сам превращает в
// useState/Alert.
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { sb } from './supabaseClient';

export async function afterSignedIn() {
  const { data } = await sb.auth.getUser();
  const user = data && data.user;
  if (!user) return { ok: false };
  let profile = null;
  try {
    const { data: row } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
    profile = row;
  } catch (err) {
    console.error('Не удалось прочитать профиль:', err);
  }
  if (!profile) return { ok: true, needsOnboarding: true, user: { id: user.id, email: user.email, name: null } };
  return { ok: true, needsOnboarding: false, user: { id: user.id, email: user.email, name: profile.name } };
}

export async function signInWithPassword(email, password) {
  email = (email || '').trim();
  if (!email || !password) return { ok: false, errorKey: null };
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (/invalid login credentials/i.test(error.message || '')) {
        return { ok: false, errorKey: 'auth.error_generic', offerSignup: true };
      }
      return { ok: false, errorKey: 'auth.error_generic' };
    }
    return afterSignedIn();
  } catch {
    return { ok: false, errorKey: 'auth.error_generic' };
  }
}

export async function signUp(email, password) {
  email = (email || '').trim();
  if (!email || !password) return { ok: false, errorKey: null };
  try {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return { ok: false, errorKey: 'auth.error_generic' };
    if (data.session) return afterSignedIn(); // подтверждение email отключено в проекте
    return { ok: true, needsConfirmation: true, email };
  } catch {
    return { ok: false, errorKey: 'auth.error_generic' };
  }
}

// Мобильный аналог handleGoogleSignIn из src/renderer/app.js:1115-1139 — тот
// же PKCE-обмен, но вместо системного браузера + кастомного протокола,
// которые ловит main.js на десктопе, тут открывается Chrome Custom Tab
// (openAuthSessionAsync) и он же возвращает redirect-URL с ?code=... прямо
// сюда, без отдельного deep-link-колбэка. Работает только в dev-client/EAS-
// сборке — Expo Go занимает схему exp:// и не даёт зарегистрировать
// кастомную lancible://, поэтому это не работает при обычном запуске из
// Expo Go (кнопка есть, но нажатие в Expo Go просто ничего не откроет).
export async function signInWithGoogle() {
  try {
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data || !data.url) return { ok: false, errorKey: 'auth.error_generic' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return result.type === 'cancel' || result.type === 'dismiss' ? { ok: false, cancelled: true } : { ok: false, errorKey: 'auth.error_generic' };
    }

    const code = new URL(result.url).searchParams.get('code');
    if (!code) return { ok: false, errorKey: 'auth.error_generic' };
    const { error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
    if (exchangeError) return { ok: false, errorKey: 'auth.error_generic' };
    return afterSignedIn();
  } catch {
    return { ok: false, errorKey: 'auth.error_generic' };
  }
}

export async function saveOnboarding(name, useCase) {
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return { ok: false };
    const cleanName = (name || '').trim() || null;
    await sb.from('profiles').upsert({ id: user.id, email: user.email, name: cleanName, use_case: useCase });
    return { ok: true, user: { id: user.id, email: user.email, name: cleanName } };
  } catch (err) {
    console.error('Не удалось сохранить профиль:', err);
    return { ok: false };
  }
}

export async function updateProfileName(name) {
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return { ok: false };
    const cleanName = (name || '').trim() || null;
    const { error } = await sb.from('profiles').update({ name: cleanName }).eq('id', user.id);
    if (error) throw error;
    return { ok: true, user: { id: user.id, email: user.email, name: cleanName } };
  } catch (err) {
    console.error('Не удалось обновить имя профиля:', err);
    return { ok: false };
  }
}

export async function changePassword(newPassword) {
  try {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error('Не удалось изменить пароль:', err);
    return { ok: false };
  }
}

export async function signOut() {
  await sb.auth.signOut();
}

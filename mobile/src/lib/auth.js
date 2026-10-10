// Порт auth-логики из src/renderer/app.js:1012-1105. Вместо чтения/записи
// DOM-элементов (`el.authEmail.value`, `el.authError.hidden = ...`) каждая
// функция принимает обычные параметры и возвращает простой объект-результат
// ({ok, errorKey, needsOnboarding, ...}), который экран сам превращает в
// useState/Alert.
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { sb } from './supabaseClient';
import Legal from '../core/legal.js';
import { useAppStore } from '../store/useAppStore';

/** Профиля нет — новый аккаунт, нужен онбординг. Профиль есть, но согласия
 *  с нынешней редакцией документов нет — нужен шаг согласия (core/legal.js).
 *  Тот же порядок, что в afterSignedIn десктопа. */
export async function afterSignedIn() {
  const { data } = await sb.auth.getUser();
  const user = data && data.user;
  if (!user) return { ok: false };
  let profile = null;
  try {
    const { data: row } = await sb.from('profiles').select('name, terms_version, age_confirmed').eq('id', user.id).maybeSingle();
    profile = row;
  } catch (err) {
    console.error('Не удалось прочитать профиль:', err);
  }
  if (!profile) return { ok: true, needsOnboarding: true, user: { id: user.id, email: user.email, name: null } };
  const me = { id: user.id, email: user.email, name: profile.name };
  if (Legal.needsConsent(profile)) return { ok: true, needsConsent: true, user: me };
  return { ok: true, user: me };
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
    if (data.session) return afterSignedIn();
    // Подтверждения почты нет: логин и пароль — и сразу внутри. Сервер без
    // сессии — входим тем же паролем; не вышло — ошибка в форме, а не экран
    // «проверьте почту», из которого было не выйти в другой аккаунт.
    const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
    if (signInError) return { ok: false, errorKey: 'auth.error_generic' };
    return afterSignedIn();
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

/** Шаг после входа: вызывается только с принятым согласием — без него
 *  экран не даёт нажать кнопку. consentOnly — профиль уже есть, пишем одно
 *  согласие. withProfile=false — «Пропустить»: согласие без имени и
 *  назначения. Email в профиль не пишется: он и так есть в аккаунте. */
export async function saveOnboarding(name, useCase, { consentOnly = false, withProfile = true } = {}) {
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return { ok: false };
    const consent = Legal.consentFields(Date.now());
    const { error } = consentOnly
      ? await sb.from('profiles').update(consent).eq('id', user.id)
      : await sb.from('profiles').upsert({
        id: user.id,
        ...(withProfile ? { name: (name || '').trim() || null, use_case: useCase } : {}),
        ...consent,
      });
    if (error) throw error;
    return afterSignedIn();
  } catch (err) {
    console.error('Не удалось сохранить профиль:', err);
    return { ok: false, errorKey: 'auth.error_generic' };
  }
}

// Картинки редактора в облаке лежат в doc-assets/<id пользователя>/ и
// каскадом за аккаунтом не уходят: байты живут в хранилище, стереть их можно
// только через Storage API, не SQL. Страж в базе (supabase/storage.sql) не
// даёт удалить аккаунт, пока в папке что-то есть, — поэтому папка стирается
// раньше, чем зовётся delete_my_account.
const ASSET_BUCKET = 'doc-assets';

/** Стереть свою папку картинок до пустоты; id стёртых складываются в
 *  removed. Бросает, если хранилище ответило ошибкой — или ничего не стёрло:
 *  правило доступа, не пустившее удаление, ошибкой не отвечает, и без этой
 *  проверки цикл не кончился бы. */
async function clearCloudAssets(uid, removed) {
  const bucket = sb.storage.from(ASSET_BUCKET);
  for (;;) {
    const { data, error } = await bucket.list(uid, { limit: 1000 });
    if (error) throw error;
    const files = (data || []).filter((o) => o.id);
    if (!files.length) return;
    const { data: gone, error: removeError } = await bucket.remove(files.map((o) => `${uid}/${o.name}`));
    if (removeError) throw removeError;
    if (!gone || !gone.length) throw new Error(`хранилище не стёрло ни одного из ${files.length} файлов`);
    removed.push(...files.map((o) => o.name));
  }
}

/** Все картинки своей папки в облаке — id, страницами по 1000. Бросает на
 *  ошибке хранилища. */
async function listCloudAssets(uid) {
  const bucket = sb.storage.from(ASSET_BUCKET);
  const PAGE = 1000;
  const names = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(uid, { limit: PAGE, offset });
    if (error) throw error;
    const page = data || [];
    names.push(...page.filter((o) => o.id).map((o) => o.name));
    if (page.length < PAGE) return names;
  }
}

/** Прежний путь, без серверной функции: папка стирается отсюда, потом
 *  delete_my_account в базе (supabase/legal.sql). Нужен, пока функции нет
 *  или до неё не достучаться. { error, assetsFailed, removed }. */
async function deleteViaRpc(uid) {
  const removed = [];
  let error = null;
  let assetsFailed = false;
  try {
    // Загрузка, начатая до паузы, всё равно может успеть положить файл между
    // стиранием и удалением — тогда страж отвечает «account assets remain».
    // На это — один повтор, не больше.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await clearCloudAssets(uid, removed);
      } catch (err) {
        assetsFailed = true;
        throw err;
      }
      ({ error } = await sb.rpc('delete_my_account'));
      assetsFailed = !!error && /account assets remain/i.test(error.message || '');
      if (!assetsFailed) break;
    }
  } catch (err) {
    error = err;
  }
  return { error, assetsFailed, removed };
}

/** Код ответа функции; null — до неё не достучались (сеть). */
function functionStatus(error) {
  if (error && error.name === 'FunctionsFetchError') return null;
  const ctx = error && error.context;
  return ctx && typeof ctx.status === 'number' ? ctx.status : -1;
}

/** Удаление аккаунта серверной функцией delete-account
 *  (supabase/functions/delete-account): она стирает папку картинок и самого
 *  пользователя, остальное уходит каскадом. Копия на телефоне, вместе с
 *  картинками, остаётся. Пользователя на сервере после этого нет — выходим
 *  только локально.
 *
 *  Ответы функции: 200 — удалён; 409 — картинки стереть не вышло, аккаунт
 *  цел; 500 — картинки стёрты, аккаунт удалить не вышло; 404 или сеть —
 *  функции нет, удаляем прежним путём (deleteViaRpc).
 *
 *  Что именно функция успела стереть, она не говорит. Поэтому перед вызовом
 *  читаем свою папку сами: при 409 и 500 весь этот список встаёт на возврат.
 *  Это надмножество стёртого, лишнее безвредно — выгрузка идёт с x-upsert, а
 *  requeue пропускает картинки, которых на телефоне нет. Нечем страховаться
 *  (список не прочитался) — функцию не зовём. */
export async function deleteAccount() {
  let uid = null;
  try {
    const { data } = await sb.auth.getSession();
    uid = data && data.session && data.session.user ? data.session.user.id : null;
  } catch (err) {
    console.error('Не удалось прочитать сессию:', err);
  }
  if (!uid) return { ok: false, reason: 'delete' };

  const store = () => useAppStore.getState();
  // Пока идёт удаление, картинки в облако не уходят (useEditorAuth отдаёт
  // null): иначе файл из очереди доехал бы в уже пустую папку, и страж не
  // дал бы удалить аккаунт. Пауза снимается в любом исходе.
  store().setAssetsPaused(true);
  let result;
  try {
    result = await deleteAccountPaused(uid);
  } finally {
    store().setAssetsPaused(false);
  }
  if (!result.ok) return result;
  // Аккаунта больше нет — возвращать в облако нечего и некуда.
  store().clearAssetRequeue();
  try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.error('Не удалось выйти:', err); }
  return { ok: true };
}

async function deleteAccountPaused(uid) {
  const store = () => useAppStore.getState();
  let listed;
  try {
    listed = await listCloudAssets(uid);
  } catch (err) {
    console.error('Не удалось прочитать картинки в облаке:', err);
    return { ok: false, reason: 'delete' };
  }

  let error = null;
  try {
    ({ error } = await sb.functions.invoke('delete-account'));
  } catch (err) {
    error = err;
  }
  if (!error) return { ok: true };

  const status = functionStatus(error);
  if (status === 404 || status === null) {
    // Функции нет или до неё не достучаться — прежний путь.
    const old = await deleteViaRpc(uid);
    if (!old.error) return { ok: true };
    console.error('Не удалось удалить аккаунт:', old.error);
    // Аккаунт остался, а папка стёрта целиком или частью: без возврата
    // картинки пропали бы на других устройствах.
    if (old.removed.length) store().queueAssetRequeue(old.removed);
    return { ok: false, reason: old.assetsFailed ? 'assets' : 'delete' };
  }

  console.error('Не удалось удалить аккаунт:', status, error);
  // 409 и 500: аккаунт цел, а папка, возможно, уже стёрта целиком или
  // частью. Те картинки, что есть на этом телефоне, снова встанут в очередь
  // при следующем открытии редактора (EditorScreen → DocEditor).
  if ((status === 409 || status === 500) && listed.length) store().queueAssetRequeue(listed);
  return { ok: false, reason: status === 409 ? 'assets' : 'delete' };
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

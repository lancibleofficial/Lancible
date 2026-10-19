import { useEffect, useState } from 'react';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseClient';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';

/** Доступ редактора к облаку картинок (Supabase Storage, корзина
 *  doc-assets): адрес, ключ, токен входа и id пользователя. Без входа или с
 *  выключенной синхронизацией — null, и картинки живут только на телефоне.
 *  Тоже null, пока удаляется аккаунт (assetsPaused): ни вставка, ни докачка в
 *  облако в это время не идут. И null, если сеанс — не текущего аккаунта
 *  (17 октября 2026, несколько аккаунтов): пока идёт переключение, в
 *  хранилище supabase может лежать сеанс прежнего (store/useAuthStore.js),
 *  и картинки этой области в чужую папку не уходят. */
export function useEditorAuth() {
  const syncEnabled = useAppStore((s) => s.settings.syncEnabled);
  const paused = useAppStore((s) => s.assetsPaused);
  const current = useAuthStore((s) => s.current);
  const [session, setSession] = useState(null);
  useEffect(() => {
    let alive = true;
    sb.auth.getSession().then(({ data }) => { if (alive) setSession(data ? data.session : null); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  if (!session || syncEnabled === false || paused || !session.user || session.user.id !== current) return null;
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, accessToken: session.access_token, userId: session.user.id };
}

/** Автор комментариев: тот, кто вошёл, или «Я» без аккаунта. */
export function editorUser(auth, profileName) {
  return auth ? { id: auth.userId, name: profileName || '' } : null;
}

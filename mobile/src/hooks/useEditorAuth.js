import { useEffect, useState } from 'react';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseClient';
import { useAppStore } from '../store/useAppStore';

/** Доступ редактора к облаку картинок (Supabase Storage, корзина
 *  doc-assets): адрес, ключ, токен входа и id пользователя. Без входа или с
 *  выключенной синхронизацией — null, и картинки живут только на телефоне.
 *  Тоже null, пока удаляется аккаунт (assetsPaused): ни вставка, ни докачка в
 *  облако в это время не идут. */
export function useEditorAuth() {
  const syncEnabled = useAppStore((s) => s.settings.syncEnabled);
  const paused = useAppStore((s) => s.assetsPaused);
  const [session, setSession] = useState(null);
  useEffect(() => {
    let alive = true;
    sb.auth.getSession().then(({ data }) => { if (alive) setSession(data ? data.session : null); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  if (!session || syncEnabled === false || paused) return null;
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, accessToken: session.access_token, userId: session.user.id };
}

/** Автор комментариев: тот, кто вошёл, или «Я» без аккаунта. */
export function editorUser(auth, profileName) {
  return auth ? { id: auth.userId, name: profileName || '' } : null;
}

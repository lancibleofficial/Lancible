// Стор аутентификации, отдельный от useAppStore — данные проектов/задач
// сохраняются локально независимо от того, вошёл ли пользователь (офлайн-
// первый принцип, как на десктопе/вебе). status используется SettingsScreen
// для переключения между экраном входа и профилем (вход опционален, гейта
// на уровне навигации нет — см. RootNavigator).
import { create } from 'zustand';
import { sb } from '../lib/supabaseClient';
import * as auth from '../lib/auth';
import { setSyncUser, syncOnSignIn } from '../lib/sync';

/** Сообщает состояние входа стору синхронизации и, если реально вошли
 * (не просто ждём онбординг), сразу пытается смёрджить локальные/серверные
 * данные — та же последовательность, что afterSignedIn->syncOnSignIn на
 * десктопе/вебе. */
function applyAuthResult(set, result) {
  set({ status: result.needsOnboarding ? 'needsOnboarding' : 'signedIn', user: result.user });
  if (!result.needsOnboarding) {
    setSyncUser(result.user.id);
    syncOnSignIn(result.user.id);
  }
}

export const useAuthStore = create((set, get) => ({
  status: 'loading', // loading | signedOut | needsOnboarding | signedIn
  user: null,
  authError: null,
  pendingConfirmEmail: null,

  init() {
    sb.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        setSyncUser(null);
        set({ status: 'signedOut', user: null });
        return;
      }
      const result = await auth.afterSignedIn();
      if (!result.ok) {
        setSyncUser(null);
        set({ status: 'signedOut', user: null });
        return;
      }
      applyAuthResult(set, result);
    });
  },

  async signIn(email, password) {
    set({ authError: null });
    const result = await auth.signInWithPassword(email, password);
    if (!result.ok) {
      set({ authError: result.errorKey });
      return result;
    }
    applyAuthResult(set, result);
    return result;
  },

  async signUp(email, password) {
    set({ authError: null });
    const result = await auth.signUp(email, password);
    if (!result.ok) {
      set({ authError: result.errorKey });
      return result;
    }
    if (result.needsConfirmation) {
      set({ pendingConfirmEmail: result.email });
      return result;
    }
    applyAuthResult(set, result);
    return result;
  },

  async completeOnboarding(name, useCase) {
    const result = await auth.saveOnboarding(name, useCase);
    if (result.ok) {
      set({ status: 'signedIn', user: result.user });
      setSyncUser(result.user.id);
      syncOnSignIn(result.user.id);
    }
    return result;
  },

  async updateName(name) {
    const result = await auth.updateProfileName(name);
    if (result.ok) set({ user: result.user });
    return result;
  },

  async changePassword(newPassword) {
    return auth.changePassword(newPassword);
  },

  async signOut() {
    await auth.signOut();
    setSyncUser(null);
    set({ status: 'signedOut', user: null, pendingConfirmEmail: null });
  },

  clearAuthError() {
    set({ authError: null });
  },
}));

// Supabase-клиент для React Native. anon-ключ — тот же, что и в десктопной/
// веб-версии (он и предназначен быть публичным — защита через RLS, а не
// секретность ключа, см. src/renderer/app.js:33-35).
//
// В отличие от веба/десктопа: detectSessionInUrl всегда false (тут нет ни
// window.location (веб), ни кастомного IPC-протокола (десктоп) — вход через
// Google на мобильном будет отдельным заходом через expo-auth-session, когда
// перейдём с Expo Go на dev-client). Хранилище сессии — AsyncStorage вместо
// localStorage. AppState-обвязка нужна, потому что в отличие от вкладки
// браузера или Electron-окна, мобильное приложение реально уходит в фон —
// без неё токен не обновлялся бы, пока экран выключен.
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
    storage: AsyncStorage,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') sb.auth.startAutoRefresh();
  else sb.auth.stopAutoRefresh();
});

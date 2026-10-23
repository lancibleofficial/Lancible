// Адреса и ключи админки. Всё здесь публичное: адрес проекта Supabase и
// anon-ключ те же, что зашиты в приложения и лендинг (landing/blog-feed.js,
// src/renderer/app.js). Данные защищает не секретность ключа, а функция
// admin: она пускает только аккаунт из admin_users и только с aal2.

export const SUPABASE_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Локально (scripts/serve-admin.js на localhost:5175) функцию отдаёт тот же
 *  сервер, что и страницу, — адрес свой, без CORS. На сайте — функция в
 *  Supabase. Решает адрес страницы, а не флаг сборки: сборки у админки нет. */
export function functionUrl(loc = window.location) {
  if (LOCAL_HOSTS.has(loc.hostname)) return `${loc.origin}/functions/v1/admin`;
  return `${SUPABASE_URL}/functions/v1/admin`;
}

/** Ключ, под которым supabase-js держит сеанс в sessionStorage. */
export const SESSION_KEY = 'sb-yiglgfkjjvwijukdzutw-auth-token';

/** Тема — единственное, что админка помнит между вкладками (localStorage):
 *  выбор вида, а не данные. Читает и theme-boot.js — до первой отрисовки. */
export const THEME_KEY = 'lancible-admin-theme';

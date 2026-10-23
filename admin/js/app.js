// Каркас админки: вход, боковая навигация, разделы по адресу (#/раздел/…),
// тема, выход. Разделы — модули в sections/: mount(корень, части адреса)
// рисует раздел и может вернуть функцию уборки.
import { startAuth, handleGateError } from './auth.js';
import { signOut } from './client.js';
import { closeMenu } from './ui.js';
import { THEME_KEY } from './config.js';
import * as overview from './sections/overview.js';
import * as usage from './sections/usage.js';
import * as users from './sections/users.js';
import * as feedback from './sections/feedback.js';
import * as agent from './sections/agent.js';
import * as blog from './sections/blog.js';
import * as releases from './sections/releases.js';
import * as logs from './sections/logs.js';
import * as architecture from './sections/architecture.js';
import * as graph from './sections/graph.js';

const SECTIONS = { overview, screens: usage, users, feedback, agent, blog, releases, logs, architecture, graph };

let entered = false;
let cleanup = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = SECTIONS[parts[0]] ? parts[0] : 'overview';
  return { name, rest: SECTIONS[parts[0]] ? parts.slice(1) : [] };
}

function route() {
  if (!entered) return;
  closeMenu();
  const { name, rest } = parseHash();
  for (const a of document.querySelectorAll('.rail-item')) {
    if (a.dataset.section === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const view = document.getElementById('view');
  view.replaceChildren();
  window.scrollTo(0, 0);
  cleanup = SECTIONS[name].mount(view, rest) || null;
  const t = view.querySelector('.page-title');
  document.title = `${t ? t.textContent : 'Админка'} · Lancible`;
}

function enter(me) {
  entered = true;
  document.getElementById('boot').hidden = true;
  document.getElementById('auth').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('rail-user').textContent = (me && me.email) || '';
  route();
}

function leave() {
  entered = false;
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  document.getElementById('view').replaceChildren();
  document.getElementById('app').hidden = true;
}

// Ошибки входа из разделов (сеанс кончился, нужен второй фактор, не админ):
// раздел гасим, показываем нужный экран входа. Пока идёт сам вход, событие
// ловит auth.js — здесь его не трогаем.
window.addEventListener('admin:gate', (ev) => {
  if (!entered) return;
  leave();
  handleGateError(ev.detail);
});

window.addEventListener('hashchange', route);

// ---------- тема ----------

const THEMES = [
  { id: 'system', label: 'Тема: как в системе' },
  { id: 'light', label: 'Тема: светлая' },
  { id: 'dark', label: 'Тема: тёмная' },
];

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

function applyTheme(id) {
  if (id === 'light' || id === 'dark') document.documentElement.dataset.theme = id;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = (THEMES.find((t) => t.id === id) || THEMES[0]).label;
}

let theme = readTheme();
document.getElementById('theme-btn').addEventListener('click', () => {
  const i = THEMES.findIndex((t) => t.id === theme);
  theme = THEMES[(i + 1) % THEMES.length].id;
  try { if (theme === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, theme); } catch { /* закрыто — тема до перезагрузки */ }
  applyTheme(theme);
});
applyTheme(theme);

document.getElementById('signout-btn').addEventListener('click', async () => {
  leave();
  await signOut();
  startAuth(enter);
});

startAuth(enter);

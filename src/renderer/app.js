'use strict';

// Класс платформы на <body> — по нему styles.css резервирует место под
// нативные кнопки окна, которые ОС рисует поверх страницы.
//
// На маке это светофор-кнопки слева (см. trafficLightPosition в
// src/main.js); без класса лого в шапке (.tb-logo) оказалось бы под ними.
// На Windows кнопки «свернуть/развернуть/закрыть» справа (titleBarOverlay),
// под них у лого зарезервирован правый отступ.
//
// В браузере никаких кнопок окна нет вовсе, поэтому вебу нужен СВОЙ класс, а
// не отсутствие маковского: правило «не мак — значит Windows» отдавало вебу
// 150 пикселей пустоты справа от лого.
if (window.__LANCIBLE_PLATFORM__ === 'web') {
  document.body.classList.add('platform-web');
} else if (window.api && window.api.platform === 'darwin') {
  document.body.classList.add('platform-mac');
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

let state = {
  projects: [],
  tasks: [],
  // Статусы задач — общие для всех проектов: пользователь просил, чтобы они
  // «отражались везде». Теги тоже общие и заводятся в настройках. Версии,
  // наоборот, принадлежат конкретному проекту.
  statuses: [],
  tags: [],
  versions: [],
  activeTimer: null,
  ui: { view: 'home', projectId: null, navCollapsed: false },
  settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru', syncEnabled: true, syncResolvedFor: null },
};
let selectedId = null;
let quill = null;

const DEFAULT_PROJECT_NAME_KEY = 'app.default_project_name';

// Словарь переводов, LOCALE_MAP и LANG_NAMES — в core/i18n.js: там на них
// есть тест, проверяющий, что набор ключей во всех языках одинаковый.
const { T, LOCALE_MAP, LANG_NAMES } = Core;
const HEARTBEAT_MS = 15000;
const PALETTE = [
  '#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#f58cc0', '#a4c2a8', '#8a93a5',
  '#e63950', '#2dd4bf', '#5468ff', '#ff9142', '#d946a8', '#6ee7b7', '#c8956d', '#6b7cad',
];
const TEXT_COLORS = ['', '#ecedef', '#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#a4c2a8', '#767b86'];
const FILL_COLORS = ['', '#3a4a34', '#2f4653', '#43385a', '#544a30', '#5a3a37', '#3e4a40'];

// Виды статусов, набор по умолчанию и разбор — в core/status.js.
const { STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES } = Core;

const CURRENCIES = {
  USD: '$', EUR: '€', GBP: '£', RUB: '₽', KZT: '₸',
  UAH: '₴', KGS: 'сом', BYN: 'Br', PLN: 'zł', TRY: '₺',
};
const SYM2CODE = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₽': 'RUB', '₸': 'KZT', '₴': 'UAH', '₺': 'TRY', 'Br': 'BYN', 'zł': 'PLN' };

// ---------------------------------------------------------------------------
// Аккаунт (Supabase) — вход опционален, приложение и без него полностью
// рабочее офлайн. Синхронизация данных — отдельный, более поздний этап;
// пока что вход только создаёт профиль (имя + для чего используют прилу).
// anon-ключ намеренно зашит в клиент — это публичный, предназначенный для
// встраивания в приложения ключ (защита данных — через RLS на стороне БД,
// не через секретность этого ключа).
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://yiglgfkjjvwijukdzutw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZ2xnZmtqanZ3aWp1a2R6dXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM5NjYsImV4cCI6MjEwNDY5OTk2Nn0.SF_vpL9F_CBf81NXIhcH_ZUWVoRtt3XoPpQjkDjPOck';
// На вебе (web/index.html выставляет этот флаг до загрузки app.js) страница
// сама и есть OAuth-редирект-цель — detectSessionInUrl:true даёт клиенту
// самому доставершить PKCE-обмен по возврату с Google, без кастомного
// протокола/IPC, которые нужны только на десктопе.
const IS_WEB = window.__LANCIBLE_PLATFORM__ === 'web';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: IS_WEB, persistSession: true, autoRefreshToken: true },
});

// ---------------------------------------------------------------------------
// Интернационализация (i18n)
// ---------------------------------------------------------------------------



/** Текущий язык интерфейса. */
const lang = () => (state.settings && state.settings.lang) || 'ru';
const locale = () => LOCALE_MAP[lang()] || 'ru-RU';

/** t('key', {a:1}) — перевод строки с подстановкой {a}. */
const t = (key, vars) => Core.translate(T, lang(), key, vars);

/** Число + правильная форма слова под текущий язык. */
const pluralForm = (n, baseKey) => Core.pluralForm(T, lang(), n, baseKey);


/** Применяет переводы ко всем статическим data-i18n* элементам разметки. */
function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el2) => { el2.textContent = t(el2.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el2) => { el2.placeholder = t(el2.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach((el2) => { el2.title = t(el2.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el2) => { el2.setAttribute('aria-label', t(el2.dataset.i18nAria)); });
  document.title = 'Lancible';
}

// ---------------------------------------------------------------------------
// Иконки (монохром, заливка)
// ---------------------------------------------------------------------------

const ICONS = {
  clock: 'M8 1.2a6.8 6.8 0 100 13.6A6.8 6.8 0 008 1.2zm0 2a4.8 4.8 0 110 9.6 4.8 4.8 0 010-9.6zM7.1 4.6a.9.9 0 011.8 0v2.9l2.1 1.2a.9.9 0 11-.9 1.56L7.55 8.77A.9.9 0 017.1 8V4.6z',
  wallet: 'M1.6 4.8A2.8 2.8 0 014.4 2H12a1 1 0 011 1v1H4.6a.6.6 0 100 1.2H14a1 1 0 011 1v5.5A2.3 2.3 0 0112.7 14H3.9A2.3 2.3 0 011.6 11.7V4.8zm10 3.2a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z',
  check: 'M13.6 3.3a1.05 1.05 0 010 1.5l-6.7 6.7a1.05 1.05 0 01-1.5 0L2 8.1a1.05 1.05 0 011.5-1.5l2.65 2.65 5.95-5.95a1.05 1.05 0 011.5 0z',
  pin: 'M9.3 1.2l5.5 5.5-1.1 1.1-1.2-.35-2.55 2.55.25 2.15-1.05 1.05L5.4 10.4 1.6 14.2l-.8-.8 3.8-3.8-2.7-2.7L3 5.85l2.15.25L7.7 3.55 7.35 2.3 8.4.25l.9.95z',
  x: 'M3.9 2.5L8 6.6l4.1-4.1 1.4 1.4L9.4 8l4.1 4.1-1.4 1.4L8 9.4l-4.1 4.1-1.4-1.4L6.6 8 2.5 3.9z',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

// ---------------------------------------------------------------------------
// Элементы
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const el = {
  navItems: [...document.querySelectorAll('.nav-item[data-view]')],
  navCollapse: $('nav-collapse'), tbSearch: document.querySelector('.tb-search'),
  searchPanel: $('search-panel'), searchInput: $('search-input'), searchResults: $('search-results'),

  langToggle: $('lang-toggle'), langLabel: $('lang-label'),
  themeTabs: [...document.querySelectorAll('.theme-tab')],

  updateBtn: $('update-btn'), updateBtnLabel: $('update-btn-label'), updateProgress: $('update-progress'),

  accountBtn: $('account-btn'), accountLabel: $('account-label'),
  mobileTabbar: $('mobile-tabbar'),
  mobileBackToList: $('mobile-back-to-list'),
  authBackdrop: $('auth-backdrop'),
  authStepCredentials: $('auth-step-credentials'), authStepOnboarding: $('auth-step-onboarding'),
  authStepConfirm: $('auth-step-confirm'), authConfirmText: $('auth-confirm-text'), authConfirmOk: $('auth-confirm-ok'),
  authGoogleBtn: $('auth-google-btn'),
  authEmail: $('auth-email'), authPassword: $('auth-password'), authError: $('auth-error'),
  authSignupOffer: $('auth-signup-offer'), authSignupBtn: $('auth-signup-btn'),
  authCancel: $('auth-cancel'), authSubmit: $('auth-submit'),
  authName: $('auth-name'), authUsecases: $('auth-usecases'),
  authOnboardingSkip: $('auth-onboarding-skip'), authOnboardingSave: $('auth-onboarding-save'),

  topbar: $('topbar'),
  stTime: $('st-time'), stMoney: $('st-money'), stMonth: $('st-month'), stDone: $('st-done'), stRunning: $('st-running'),

  homeView: $('home-view'), projectView: $('project-view'), calendarView: $('calendar-view'),
  settingsView: $('settings-view'), settingsProfile: $('settings-profile'),
  settingsLangRow: $('settings-lang-row'), settingsLangValue: $('settings-lang-value'),
  settingsDataLabel: $('settings-data-label'), settingsDataCard: $('settings-data-card'),
  settingsSyncToggle: $('settings-sync-toggle'),
  settingsRate: $('settings-rate'), settingsCurrency: $('settings-currency'),
  settingsAccountLabel: $('settings-account-label'), settingsAccountCard: $('settings-account-card'),
  settingsNameRow: $('settings-name-row'), settingsNameValue: $('settings-name-value'),
  settingsPasswordRow: $('settings-password-row'), settingsSignoutRow: $('settings-signout-row'),
  modalLabel2: $('modal-label2'), modalInput2: $('modal-input2'), modalError: $('modal-error'),

  homeCount: $('home-count'),
  pinnedSection: $('pinned-section'), pinnedTrack: $('pinned-track'),
  projectsTrack: $('projects-track'), allLabel: $('all-label'),
  recentSection: $('recent-section'), recentTrack: $('recent-track'),
  homeEmpty: $('home-empty'), createProjectBtn: $('create-project-btn'),

  miniCalTitle: $('mini-cal-title'), miniCalTot: $('mini-cal-tot'),
  miniCal: $('mini-cal'), sideToday: $('side-today'), openCalendarBtn: $('open-calendar'),

  backHome: $('back-home'), phDot: $('ph-dot'), phName: $('ph-name'),
  phDesc: $('ph-desc'), projectMenuBtn: $('project-menu-btn'),
  boardView: $('board-view'), boardProject: $('board-project'), boardCols: $('board-cols'),
  boardStatuses: $('board-statuses'), stdlgBackdrop: $('stdlg-backdrop'), stList: $('st-list'), stAdd: $('st-add'), stdlgClose: $('stdlg-close'),
  boardSum: $('board-sum'), boardEmpty: $('board-empty'),

  taskList: $('task-list'), sidebarEmpty: $('sidebar-empty'), newTaskBtn: $('new-task-btn'),
  defaultRate: $('default-rate'), currency: $('currency'), projectEarned: $('project-earned'),

  tfStatus: [...document.querySelectorAll('.tf-status button')],

  emptyState: $('empty-state'), detail: $('task-detail'),
  title: $('task-title'), pinTaskBtn: $('pin-task-btn'),
  taskTabs: [...document.querySelectorAll('.task-tabs button')], tabNotes: $('tab-notes'), tabSettings: $('tab-settings'), tabHistory: $('tab-history'),
  timerDisplay: $('timer-display'), timerSub: $('timer-sub'), timerBtn: $('timer-btn'),
  timerBtnIcon: $('timer-btn-icon'), timerBtnLabel: $('timer-btn-label'),
  deleteBtn: $('delete-task-btn'), exportTaskBtn: $('export-task-btn'),
  exportProjectBtn: $('export-project-btn'), exportCalendarBtn: $('export-calendar-btn'),
  statsView: $('stats-view'), spTime: $('sp-time'), spMoney: $('sp-money'), spDone: $('sp-done'),
  spRunning: $('sp-running'), spProjLabel: $('sp-proj-label'), spProjects: $('sp-projects'),
  spTaskLabel: $('sp-task-label'), spTasks: $('sp-tasks'), spEmpty: $('sp-empty'),
  spStatusLabel: $('sp-status-label'), spStatuses: $('sp-statuses'),
  exportAllBtn: $('export-all-btn'),
  exportPeriodBtn: $('export-period-btn'),
  expdlgBackdrop: $('expdlg-backdrop'), expPills: $('exp-pills'), expRange: $('exp-range'),
  expFrom: $('exp-from'), expTo: $('exp-to'),
  expCalPrev: $('exp-cal-prev'), expCalNext: $('exp-cal-next'), expCalTitle: $('exp-cal-title'), expCalDays: $('exp-cal-days'),
  expdlgOk: $('expdlg-ok'), expdlgCancel: $('expdlg-cancel'),
  taskRate: $('task-rate'), rateUnit: $('rate-unit'), moneyCalc: $('money-calc'),
  taskStatus: $('task-status'), taskStatusDot: $('task-status-dot'),
  notifBtn: $('notif-btn'), notifBadge: $('notif-badge'), notifPanel: $('notif-panel'),
  settingsNotifToggle: $('settings-notif-toggle'), settingsNotifSystem: $('settings-notif-system'),
  settingsAboutUs: $('settings-about-us'), settingsAboutBlog: $('settings-about-blog'),
  settingsNotifState: $('settings-notif-state'),
  notifList: $('notif-list'), notifEmpty: $('notif-empty'), notifSeen: $('notif-seen'),
  dueDateBtn: $('due-date-btn'), dueTimeBtn: $('due-time-btn'), dueState: $('due-state'),
  dueRemind: $('due-remind'), dueClearBtn: $('due-clear-btn'), dueCustomRow: $('due-custom-row'),
  remindDateBtn: $('remind-date-btn'), remindTimeBtn: $('remind-time-btn'),
  tableTools: $('table-tools'), ttSwatches: $('tt-swatches'),
  sessionList: $('session-list'), sessionCount: $('session-count'),
  sessionEmpty: $('session-empty'), addSessionBtn: $('add-session-btn'),

  calModes: [...document.querySelectorAll('.cal-modes button')],
  calPrev: $('cal-prev'), calNext: $('cal-next'), calToday: $('cal-today'),
  calTitle: $('cal-title'), calDays: $('cal-days'),
  calWeekdays: $('cal-weekdays'),
  calPeriodToggle: $('cal-period-toggle'),
  rangeFrom: $('range-from'), rangeTo: $('range-to'),
  dpPop: $('dp-pop'), dpTitle: $('dp-title'), dpDays: $('dp-days'), dpPrev: $('dp-prev'), dpNext: $('dp-next'),
  tpPop: $('tp-pop'), tpHours: $('tp-hours'), tpMinutes: $('tp-minutes'),
  calViewTot: $('cal-view-tot'),
  calDayHead: $('cal-day-head'), calDayTot: $('cal-day-tot'),
  calDayList: $('cal-day-list'), calDayEmpty: $('cal-day-empty'), calDayPanel: $('cal-day-panel'),

  toast: $('toast'), ctxMenu: $('ctx-menu'),
  modalBackdrop: $('modal-backdrop'), modalLabel: $('modal-label'),
  modalInput: $('modal-input'), modalOk: $('modal-ok'), modalCancel: $('modal-cancel'),
  confirmBackdrop: $('confirm-backdrop'), confirmTitle: $('confirm-title'), confirmText: $('confirm-text'),
  confirmOk: $('confirm-ok'), confirmCancel: $('confirm-cancel'),
  pdlgBackdrop: $('pdlg-backdrop'), pdlgTitle: $('pdlg-title'), pdlgName: $('pdlg-name'),
  pdlgDesc: $('pdlg-desc'), pdlgSwatches: $('pdlg-swatches'), pdlgSave: $('pdlg-save'), pdlgCancel: $('pdlg-cancel'),
  sdlgBackdrop: $('sdlg-backdrop'), sdlgTitle: $('sdlg-title'),
  sdlgDateBtn: $('sdlg-date-btn'), sdlgStartBtn: $('sdlg-start-btn'), sdlgEndBtn: $('sdlg-end-btn'),
  sdlgDur: $('sdlg-dur'), sdlgSave: $('sdlg-save'), sdlgCancel: $('sdlg-cancel'),
};

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

const getTask = (id) => state.tasks.find((t2) => t2.id === id) || null;
const getProject = (id) => state.projects.find((p) => p.id === id) || null;
const tasksOf = (projectId) => state.tasks.filter((t2) => t2.projectId === projectId);

// --- Статусы ---------------------------------------------------------------

// Обёртки над core/status.js: там те же функции, но список статусов
// приходит параметром, поэтому их можно проверить тестом.
const orderedStatuses = (projectId) => Core.orderedStatuses(state.statuses, projectId);
const getStatus = (id) => Core.getStatus(state.statuses, id);
const statusesOfKind = (projectId, kind) => Core.statusesOfKind(state.statuses, projectId, kind);
const defaultStatusId = (projectId, done) => Core.defaultStatusId(state.statuses, projectId, done);
const isDoneStatus = (id) => Core.isDoneStatus(state.statuses, id);

/** Набор по умолчанию для нового проекта. Вызывается при создании, а не
 *  только из migrate(): та правит уже сохранённые данные при загрузке и до
 *  проекта, заведённого в этой же сессии, не доберётся — его доска осталась
 *  бы без единого столбца. */
function seedProjectStatuses(projectId) {
  if (state.statuses.some((s) => s.projectId === projectId)) return;
  for (const row of Core.makeProjectStatuses(projectId, (key) => t(`status.default_${key}`), uid)) {
    state.statuses.push(row);
  }
}

/** Единственное место, где статус задачи меняется. Здесь же done приводится в
 *  соответствие — иначе статистика и календарь разойдутся с доской. */
const isClosedStatus = (id) => Core.isClosedStatus(state.statuses, id);

function setTaskStatus(task, statusId) {
  const s = getStatus(statusId);
  if (!task || !s) return;
  task.statusId = s.id;
  // done означает именно «сделано», а не «закрыто»: отменённая задача тоже
  // уходит из работы, но записывать её в выполненные нельзя — счёт «сделано
  // 8 из 10» перестал бы быть правдой.
  task.done = s.kind === 'done';
  task.cancelled = s.kind === 'cancelled';
  task.doneAt = task.done ? (task.doneAt || new Date().toISOString()) : null;
  task.updatedAt = new Date().toISOString();
}

/** Обратная сторона: галочка «выполнено» в списке тоже должна двигать задачу
 *  по доске, иначе список и доска разойдутся. Если задача уже стоит в статусе
 *  нужного вида, он сохраняется — у пользователя может быть несколько
 *  завершающих статусов, и галочка не должна схлопывать их в один. */
function setTaskDone(task, done) {
  if (!task) return;
  if (isDoneStatus(task.statusId) !== done) {
    const next = defaultStatusId(task.projectId, done);
    if (next) { setTaskStatus(task, next); return; }
  }
  task.done = done;
  task.doneAt = done ? new Date().toISOString() : null;
  task.updatedAt = new Date().toISOString();
}

// --- Теги и версии ---------------------------------------------------------

const getTag = (id) => state.tags.find((tg) => tg.id === id) || null;
const tagsOf = (entity) => (entity && Array.isArray(entity.tagIds) ? entity.tagIds.map(getTag).filter(Boolean) : []);
const getVersion = (id) => state.versions.find((v) => v.id === id) || null;
const versionsOf = (projectId) => state.versions.filter((v) => v.projectId === projectId);
const visibleTasks = () => tasksOf(state.ui.projectId);
const byPinned = (a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt);

/** Задачи открытого проекта: закреплённые / в работе / выполненные (без фильтра). */
function sortedProjectTasks() {
  const list = visibleTasks();
  const pinned = list.filter((t2) => t2.pinnedAt).sort(byPinned);
  const rest = list.filter((t2) => !t2.pinnedAt && !t2.done);
  const done = list.filter((t2) => !t2.pinnedAt && t2.done);
  return { pinned, rest, done, get all() { return [...pinned, ...rest, ...done]; } };
}

// ---------------------------------------------------------------------------
// Фильтр списка задач (не сохраняется — временное состояние вида)
// ---------------------------------------------------------------------------

let taskFilter = { status: 'all' };
const isFilterActive = () => taskFilter.status !== 'all';

function filteredProjectTasks() {
  let list = visibleTasks();
  if (taskFilter.status === 'active') list = list.filter((t2) => !t2.done);
  else if (taskFilter.status === 'done') list = list.filter((t2) => t2.done);
  return list;
}

// Чистое форматирование живёт в core/format.js — оно тестируется отдельно,
// без браузера. Здесь остаются обёртки с прежними именами и сигнатурами:
// они подставляют то, что раньше бралось из state прямо внутри функции.
const { pad2, fmtClock, DUR_UNITS, fmtDate, fmtTime, dayKey, keyToDate, hoursOf, escapeHtml, capFirst, parseNum } = Core;
const taskElapsedMs = (task) => Core.taskElapsedMs(task, state.activeTimer, Date.now());
const fmtShort = (ms) => Core.fmtShort(ms, lang());
const fmtDur = (ms) => Core.fmtDur(ms, lang());

function fmtWhen(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t('session.today', { time });
  return `${d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })} ${time}`;
}
const fmtDateShort = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const monthLabel = (y, m) => `${capFirst(new Date(y, m, 1).toLocaleDateString(locale(), { month: 'long' }))} ${y}`;


// ---------------------------------------------------------------------------
// Деньги
// ---------------------------------------------------------------------------

const moneyFmt = () => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 });


const currencySym = () => {
  const c = state.settings && state.settings.currency;
  return CURRENCIES[c] || c || '₽';
};

// Расчёт денег и сводки живут в core/money.js: там их можно проверить
// тестом, потому что ставка, идущий таймер и текущий момент приходят
// параметрами. Здесь — обёртки с прежними именами, подставляющие state.
const defaultRate = () => Number(state.settings && state.settings.hourlyRate) || 0;
const effectiveRate = (task) => Core.effectiveRate(task, defaultRate());
const hasOwnRate = Core.hasOwnRate;
const sessionRate = (s, task) => Core.sessionRate(s, task, defaultRate());
const sessionMoney = (s, task) => Core.sessionMoney(s, task, defaultRate());
const earnedOf = (task) => Core.earnedOf(task, defaultRate(), state.activeTimer, Date.now());
const allSessionPairs = () => Core.allSessionPairs(state.tasks);
const aggregateDays = () => Core.aggregateDays(state.tasks, defaultRate());
const rangeAgg = (from, to) => Core.rangeAgg(state.tasks, from, to, defaultRate());
const tasksDoneOnDay = (key) => Core.tasksDoneOnDay(state.tasks, key);
const projectMoney = (id) => Core.projectMoney(tasksOf(id), defaultRate(), state.activeTimer, Date.now());
const projectMs = (id) => Core.projectMs(tasksOf(id), state.activeTimer, Date.now());
const reminderTime = Core.reminderTime;
const dueState = (task) => Core.dueState(task, Date.now());

const fmtMoney = (n) => `${moneyFmt().format(Math.round((n + Number.EPSILON) * 100) / 100)} ${currencySym()}`;

const REMIND_PRESETS = [null, 0, 15, 60, 180, 1440, 'custom'];
const REMIND_LABEL = { null: 'remind.none', 0: 'remind.at', 15: 'remind.15m', 60: 'remind.1h', 180: 'remind.3h', 1440: 'remind.1d', custom: 'remind.custom' };



/** Короткая подпись срока для списка: «просрочено» / «сегодня» / дата. */
function dueShort(task) {
  if (!task.dueAt) return '';
  const due = new Date(task.dueAt);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(new Date())) / 86400000);
  if (dueState(task) === 'overdue') return t('due.overdue');
  if (days === 0) return t('due.today');
  if (days === 1) return t('due.tomorrow');
  if (days > 1 && days < 7) return t('due.in_days', { n: days });
  return fmtDateShort(due);
}


// ---------------------------------------------------------------------------
// Тост
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

const anyDialogOpen = () =>
  !el.modalBackdrop.hidden || !el.pdlgBackdrop.hidden || !el.sdlgBackdrop.hidden ||
  !el.confirmBackdrop.hidden || !el.searchPanel.hidden || !el.expdlgBackdrop.hidden;

// ---------------------------------------------------------------------------
// Диалог подтверждения (замена системного confirm())
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Диалог ввода (одно или два поля)
// ---------------------------------------------------------------------------

/** Единственный потребитель разметки #modal-backdrop — до появления
 *  настроек аккаунта она лежала в index.html неиспользованной. Второе поле
 *  и строка ошибки показываются по запросу: смене пароля нужны «новый» +
 *  «повтор» и сообщение о несовпадении, смене имени — одно поле. */
let promptResolve = null;
let promptSubmit = null;
function promptDialog({ label, value = '', type = 'text', label2 = null, okLabel = null, validate = null }) {
  el.modalLabel.textContent = label;
  el.modalInput.type = type;
  el.modalInput.value = value;
  el.modalLabel2.textContent = label2 || '';
  el.modalLabel2.hidden = !label2;
  el.modalInput2.type = type;
  el.modalInput2.value = '';
  el.modalInput2.hidden = !label2;
  el.modalError.hidden = true;
  el.modalOk.textContent = okLabel || t('common.ok');
  el.modalBackdrop.hidden = false;
  setTimeout(() => el.modalInput.focus(), 30);
  const submit = () => {
    const v1 = el.modalInput.value;
    const v2 = el.modalInput2.value;
    const err = validate ? validate(v1, v2) : null;
    if (err) { el.modalError.textContent = err; el.modalError.hidden = false; return; }
    closePrompt({ value: v1, value2: v2 });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePrompt(null); }
    else if (e.key === 'Enter') { e.preventDefault(); submit(); }
  };
  document.addEventListener('keydown', onKey, true);
  promptSubmit = submit;
  return new Promise((resolve) => {
    promptResolve = (v) => { document.removeEventListener('keydown', onKey, true); promptSubmit = null; resolve(v); };
  });
}
function closePrompt(result) {
  el.modalBackdrop.hidden = true;
  if (promptResolve) { const r = promptResolve; promptResolve = null; r(result); }
}
el.modalOk.addEventListener('click', () => { if (promptSubmit) promptSubmit(); });
el.modalCancel.addEventListener('click', () => closePrompt(null));

let confirmResolve = null;
function confirmDialog(message, { okLabel, cancelLabel, title, danger = true } = {}) {
  el.confirmTitle.textContent = title || t('common.delete_q');
  el.confirmText.textContent = message;
  el.confirmOk.textContent = okLabel || t('common.delete');
  el.confirmCancel.textContent = cancelLabel || t('common.cancel');
  el.confirmOk.classList.toggle('confirm-danger', danger);
  el.confirmBackdrop.hidden = false;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
    else if (e.key === 'Enter') { e.preventDefault(); closeConfirm(true); }
  };
  document.addEventListener('keydown', onKey, true);
  return new Promise((resolve) => {
    confirmResolve = (v) => { document.removeEventListener('keydown', onKey, true); resolve(v); };
  });
}
function closeConfirm(result) {
  el.confirmBackdrop.hidden = true;
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); }
}
el.confirmOk.addEventListener('click', () => closeConfirm(true));
el.confirmCancel.addEventListener('click', () => closeConfirm(false));
el.confirmBackdrop.addEventListener('click', (e) => { if (e.target === el.confirmBackdrop) closeConfirm(false); });

// ---------------------------------------------------------------------------
// Тема оформления (системная / светлая / тёмная)
// ---------------------------------------------------------------------------

function applyTheme() {
  const theme = (state.settings && state.settings.theme) || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);

  for (const btn of el.themeTabs) btn.classList.toggle('on', btn.dataset.theme === theme);
  window.api.setTitlebarOverlay(theme).catch(() => {});
}
for (const btn of el.themeTabs) {
  btn.addEventListener('click', () => {
    state.settings.theme = btn.dataset.theme;
    applyTheme();
    scheduleSave();
  });
}
// Нативные кнопки окна не следят за системной темой сами — при переключении
// ОС между светлой/тёмной темой пересинхронизируем их вручную, но только
// когда пользователь не переопределил тему явно (иначе CSS и так не следит).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (((state.settings && state.settings.theme) || 'system') === 'system') {
    window.api.setTitlebarOverlay('system').catch(() => {});
  }
});

function setLang(code) {
  state.settings.lang = code;
  el.langLabel.textContent = LANG_NAMES[code] || code;
  applyStaticTranslations();
  buildCurrencyOptions();
  renderUpdateBtn();
  renderAccountBtn();
  render();
  scheduleSave();
}
function openLangMenu(anchor) {
  const items = Object.keys(LANG_NAMES).map((code) => ({
    label: LANG_NAMES[code],
    selected: code === ((state.settings && state.settings.lang) || 'ru'),
    onClick: () => setLang(code),
  }));
  openMenu(anchor || el.langToggle, items);
}
el.langToggle.addEventListener('click', () => openLangMenu(el.langToggle));
el.settingsLangRow.addEventListener('click', () => openLangMenu(el.settingsLangRow));

el.settingsNotifToggle.addEventListener('click', () => {
  state.settings.notifyEnabled = state.settings.notifyEnabled === false;
  if (state.settings.notifyEnabled) ensureNotifPermission();
  renderSettings();
  scheduleSave();
});
el.settingsNotifSystem.addEventListener('click', () => {
  if (window.api && window.api.openNotificationSettings) { window.api.openNotificationSettings(); return; }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().then(renderSettings).catch(() => {});
    return;
  }
  toast(t('notif.system_hint'));
});
// Лендинг: главная и блог. Один адрес в одном месте, чтобы не искать его по
// коду, когда сайт переедет.
const LANDING_URL = 'https://lancible.vercel.app';

/** Открывает ссылку снаружи приложения. На десктопе — системным браузером
 *  через main-процесс (внутри окна Electron чужой сайт открывать нельзя),
 *  в вебе — обычной новой вкладкой. */
function openExternalLink(url) {
  if (window.api && window.api.openExternal) { window.api.openExternal(url); return; }
  window.open(url, '_blank', 'noopener');
}

el.settingsAboutUs.addEventListener('click', () => openExternalLink(LANDING_URL));
el.settingsAboutBlog.addEventListener('click', () => openExternalLink(LANDING_URL + '/blog.html'));
el.settingsSyncToggle.addEventListener('click', () => {
  toggleSyncEnabled();
  renderSettings();
});
el.settingsRate.addEventListener('input', () => {
  state.settings.hourlyRate = parseNum(el.settingsRate.value);
  const task = getTask(selectedId);
  if (task) renderMoney(task);
  renderStats();
  scheduleSave();
});
el.settingsNameRow.addEventListener('click', async () => {
  if (!currentUser) return;
  const res = await promptDialog({ label: t('profile.name_label'), value: currentUser.name || '', okLabel: t('common.save') });
  if (!res) return;
  const ok = await updateProfileName(res.value);
  toast(t(ok ? 'profile.name_updated' : 'profile.update_failed'));
  renderAccountBtn();
  renderSettings();
});
el.settingsPasswordRow.addEventListener('click', async () => {
  const res = await promptDialog({
    label: t('profile.new_password'), type: 'password', label2: t('profile.confirm_password'), okLabel: t('common.save'),
    validate: (a, b) => (a.length < 6 ? t('profile.password_too_short') : a !== b ? t('profile.password_mismatch') : null),
  });
  if (!res) return;
  const ok = await changePassword(res.value);
  toast(t(ok ? 'profile.password_updated' : 'profile.update_failed'));
});
el.settingsSignoutRow.addEventListener('click', signOut);
el.settingsCurrency.addEventListener('change', () => {
  state.settings.currency = el.settingsCurrency.value;
  render();
  scheduleSave();
});

if (el.mobileBackToList) {
  el.mobileBackToList.addEventListener('click', () => {
    flushEditor();
    selectedId = null;
    render();
    scheduleSave();
  });
}

// ---------------------------------------------------------------------------
// Автообновление
// ---------------------------------------------------------------------------

let updateState = 'idle'; // idle | available | downloading | ready

function renderUpdateBtn() {
  el.updateBtn.hidden = updateState === 'idle';
  el.updateBtn.classList.toggle('downloading', updateState === 'downloading');
  const key = updateState === 'ready' ? 'update.ready'
    : updateState === 'downloading' ? 'update.downloading'
    : 'update.available';
  el.updateBtnLabel.textContent = t(key);
}

// В вебе обновлений нет вовсе: страница и так всегда свежая, а window.api там
// этих методов не предоставляет (см. web/api-shim.js). Проверка на их наличие
// заодно и есть проверка «мы в десктопе».
if (window.api.onUpdateAvailable) {
  // Скачивание начинается само (autoDownload в src/main.js), поэтому «доступно»
  // и «скачивается» для пользователя — одно и то же состояние: ходить и
  // нажимать «скачать» больше не нужно, нажатие остаётся ровно одно — «Установить».
  window.api.onUpdateAvailable(() => { updateState = 'downloading'; renderUpdateBtn(); });
  window.api.onUpdateProgress(({ percent }) => { el.updateProgress.style.width = `${Math.round(percent || 0)}%`; });
  window.api.onUpdateReady(() => { updateState = 'ready'; renderUpdateBtn(); });
  window.api.onUpdateError(() => { updateState = 'idle'; renderUpdateBtn(); });
}

el.updateBtn.addEventListener('click', () => {
  // Пока идёт скачивание, кнопка только показывает прогресс — нажимать нечего.
  if (updateState === 'ready') window.api.installUpdate();
});

// ---------------------------------------------------------------------------
// Аккаунт: вход/регистрация (email+пароль) и онбординг. Вход опционален —
// приложение полностью работает офлайн без него; синхронизация данных
// (заливка/подтяжка проектов и задач) — отдельный, более поздний этап.
// ---------------------------------------------------------------------------

let currentUser = null; // { id, email, name } | null
const USE_CASES = ['personal', 'freelance', 'team', 'other'];
let selectedUseCase = null;

function renderAccountBtn() {
  el.accountLabel.textContent = currentUser ? (currentUser.name || currentUser.email) : t('auth.sign_in_nav');
}

/** Страница настроек — зеркалит то, что есть в настройках мобильного
 * приложения: профиль/вход, язык, тема, синхронизация (только для вошедших),
 * ставка и валюта по умолчанию. Языковой ряд/тема переиспользуют те же
 * функции, что и раньше делал навигационный рейл: .theme-tab кнопки живут
 * теперь только здесь и попадают в el.themeTabs тем же querySelectorAll на
 * старте, так что обработчики к ним цепляются без изменений. */
/** Отдельная страница статистики — зеркалит экран «Статистика» мобильного
 *  приложения. Карточки сверху дублируют топбар главной намеренно: там
 *  они идут довеском к списку проектов, здесь — заголовок собственной
 *  страницы, на которой ниже лежат разбивки по проектам и по задачам. */
function renderStatsPage() {
  const totalMs = state.tasks.reduce((a, t2) => a + taskElapsedMs(t2), 0);
  const totalMoney = state.tasks.reduce((a, t2) => a + earnedOf(t2), 0);
  el.spTime.textContent = fmtDur(totalMs);
  el.spMoney.textContent = fmtMoney(totalMoney);
  const done = state.tasks.filter((t2) => t2.done).length;
  el.spDone.textContent = state.tasks.length ? `${done} / ${state.tasks.length}` : '0';

  const running = state.activeTimer && getTask(state.activeTimer.taskId);
  el.spRunning.hidden = !running;
  if (running) {
    const sec = fmtClock(Date.now() - new Date(state.activeTimer.startedAt).getTime());
    el.spRunning.innerHTML = `<span class="r-name">${icon('clock')} ${escapeHtml(running.title || t('task.no_name'))}</span><span class="r-time">${sec}</span>`;
    el.spRunning.onclick = () => { openProject(running.projectId); selectTask(running.id); };
  }

  const byProject = state.projects
    .map((p) => ({ p, ms: tasksOf(p.id).reduce((a, t2) => a + taskElapsedMs(t2), 0), money: tasksOf(p.id).reduce((a, t2) => a + earnedOf(t2), 0) }))
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const byTask = state.tasks
    .map((t2) => ({ t2, ms: taskElapsedMs(t2), money: earnedOf(t2) }))
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  const row = (color, name, ms, money, onClick) => {
    const li = document.createElement('li');
    li.style.setProperty('--pc', color);
    li.innerHTML = `<span class="stats-dot"></span><span class="stats-name">${escapeHtml(name)}</span>`
      + `<span class="stats-val">${fmtDur(ms)}</span><span class="stats-val">${fmtMoney(money)}</span>`;
    if (onClick) { li.classList.add('clickable'); li.addEventListener('click', onClick); }
    return li;
  };

  el.spProjects.innerHTML = '';
  for (const { p, ms, money } of byProject) {
    el.spProjects.appendChild(row(p.color || PALETTE[0], p.name, ms, money, () => openProject(p.id)));
  }
  // Разбивка по статусам: сколько времени и денег стоит каждое состояние.
  // Статусы принадлежат проектам, поэтому одноимённые из разных проектов
  // складываются — иначе список превратился бы в перечисление всех наборов.
  const byStatus = new Map();
  for (const { t2, ms, money } of byTask) {
    const st = getStatus(t2.statusId);
    if (!st) continue;
    const cur = byStatus.get(st.name) || { name: st.name, color: st.color, ms: 0, money: 0, count: 0 };
    cur.ms += ms; cur.money += money; cur.count += 1;
    byStatus.set(st.name, cur);
  }
  el.spStatuses.innerHTML = '';
  const statusRows = [...byStatus.values()].sort((a, b) => b.ms - a.ms);
  for (const r of statusRows) el.spStatuses.appendChild(row(r.color, r.name, r.ms, r.money));
  el.spStatusLabel.hidden = !statusRows.length;

  el.spTasks.innerHTML = '';
  for (const { t2, ms, money } of byTask) {
    const p = getProject(t2.projectId);
    el.spTasks.appendChild(row(p ? p.color : PALETTE[0], t2.title || t('task.no_name'), ms, money, () => { openProject(t2.projectId); selectTask(t2.id); }));
  }
  el.spProjLabel.hidden = !byProject.length;
  el.spTaskLabel.hidden = !byTask.length;
  el.spEmpty.hidden = byProject.length > 0 || byTask.length > 0;
}

function renderSettings() {
  if (currentUser) {
    const initial = (currentUser.name || currentUser.email || '?')[0].toUpperCase();
    el.settingsProfile.innerHTML = `
      <div class="settings-avatar">${escapeHtml(initial)}</div>
      <div class="settings-profile-main">
        <div class="settings-profile-name">${escapeHtml(currentUser.name || currentUser.email)}</div>
        ${currentUser.name ? `<div class="settings-profile-sub">${escapeHtml(currentUser.email)}</div>` : ''}
      </div>`;
  } else {
    el.settingsProfile.innerHTML = `
      <div class="settings-avatar guest">?</div>
      <div class="settings-profile-main">
        <div class="settings-profile-name">${escapeHtml(t('profile.guest'))}</div>
        <div class="settings-profile-sub">${escapeHtml(t('profile.guest_sub'))}</div>
      </div>
      <div class="settings-guest-actions">
        <button type="button" class="ghost" id="settings-signin-btn">${escapeHtml(t('auth.sign_in'))}</button>
        <button type="button" class="btn-accent" id="settings-signup-btn">${escapeHtml(t('auth.create_account'))}</button>
      </div>`;
    $('settings-signin-btn').addEventListener('click', openAuthModal);
    $('settings-signup-btn').addEventListener('click', openAuthModal);
  }

  el.settingsAccountLabel.hidden = !currentUser;
  el.settingsAccountCard.hidden = !currentUser;
  if (currentUser) el.settingsNameValue.textContent = currentUser.name || t('profile.no_name');

  el.settingsLangValue.textContent = LANG_NAMES[(state.settings && state.settings.lang) || 'ru'];

  const notifyOn = state.settings.notifyEnabled !== false;
  el.settingsNotifToggle.setAttribute('aria-pressed', String(notifyOn));
  // На десктопе ведём в системные настройки, в браузере — показываем
  // состояние разрешения и предлагаем выдать его, если ещё не спрашивали.
  const perm = typeof Notification === 'undefined' ? 'denied' : Notification.permission;
  el.settingsNotifState.textContent = t(perm === 'granted' ? 'notif.perm_granted' : perm === 'denied' ? 'notif.perm_denied' : 'notif.perm_ask');

  const syncOn = state.settings.syncEnabled !== false;
  el.settingsDataLabel.hidden = !currentUser;
  el.settingsDataCard.hidden = !currentUser;
  el.settingsSyncToggle.setAttribute('aria-pressed', String(syncOn));

  if (document.activeElement !== el.settingsRate) {
    el.settingsRate.value = state.settings.hourlyRate ? String(state.settings.hourlyRate) : '';
  }
  el.settingsCurrency.value = state.settings.currency;
}

function buildUsecaseButtons() {
  el.authUsecases.innerHTML = '';
  for (const key of USE_CASES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'auth-usecase' + (selectedUseCase === key ? ' on' : '');
    b.textContent = t(`auth.usecase_${key}`);
    b.addEventListener('click', () => { selectedUseCase = key; buildUsecaseButtons(); });
    el.authUsecases.appendChild(b);
  }
}

function showAuthStep(step) {
  el.authStepCredentials.hidden = step !== 'credentials';
  el.authStepConfirm.hidden = step !== 'confirm';
  el.authStepOnboarding.hidden = step !== 'onboarding';
}
function openAuthModal() {
  el.authError.hidden = true;
  el.authSignupOffer.hidden = true;
  el.authEmail.value = '';
  el.authPassword.value = '';
  showAuthStep('credentials');
  el.authBackdrop.hidden = false;
  setTimeout(() => el.authEmail.focus(), 30);
}
function closeAuthModal() {
  el.authBackdrop.hidden = true;
}
function showAuthError(key) {
  el.authError.textContent = t(key);
  el.authError.hidden = false;
}
function openOnboarding() {
  selectedUseCase = null;
  el.authName.value = '';
  buildUsecaseButtons();
  showAuthStep('onboarding');
}

/** После успешного входа: если для пользователя ещё нет профиля — это его
 * самый первый настоящий вход (сразу после регистрации+подтверждения email,
 * или профиль по какой-то причине не сохранился раньше) — просим имя и
 * назначение прямо сейчас, а не пытаемся это сделать сразу в момент signUp():
 * пока email не подтверждён, сессии ещё нет и сохранить профиль всё равно
 * нечем. */
async function afterSignedIn(opts) {
  const silent = !!(opts && opts.silent); // true при тихом восстановлении сессии на старте — без модалки/тоста
  const { data } = await sb.auth.getUser();
  const user = data && data.user;
  if (!user) return;
  let profile = null;
  try {
    const { data: row } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
    profile = row;
  } catch (err) { console.error('Не удалось прочитать профиль:', err); }
  if (!profile) {
    if (!silent) openOnboarding();
    return;
  }
  currentUser = { id: user.id, email: user.email, name: profile.name };
  renderAccountBtn();
  // Окно входа закрывается сразу, ДО синхронизации. Раньше закрытие стояло
  // после неё, а синхронизация умеет спрашивать про конфликт данных и умеет
  // падать на сетевой ошибке — в обоих случаях окно оставалось висеть на
  // экране, хотя вход давно прошёл. Своё дело оно сделало, как только
  // аутентификация удалась.
  if (!silent) {
    closeAuthModal();
    toast(t('auth.signed_in_toast'));
  }
  await syncOnSignIn();
}

async function handleAuthSubmit() {
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!email || !password) return;
  el.authError.hidden = true;
  el.authSignupOffer.hidden = true;
  el.authSubmit.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (/invalid login credentials/i.test(error.message || '')) el.authSignupOffer.hidden = false;
      else showAuthError('auth.error_generic');
      return;
    }
    await afterSignedIn();
  } catch {
    showAuthError('auth.error_generic');
  } finally {
    el.authSubmit.disabled = false;
  }
}

async function handleSignup() {
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!email || !password) return;
  el.authSignupBtn.disabled = true;
  try {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { showAuthError('auth.error_generic'); return; }
    if (data.session) {
      // подтверждение email отключено в проекте — сессия уже есть сразу.
      await afterSignedIn();
    } else {
      el.authConfirmText.textContent = t('auth.confirm_text', { email });
      showAuthStep('confirm');
    }
  } catch {
    showAuthError('auth.error_generic');
  } finally {
    el.authSignupBtn.disabled = false;
  }
}

async function saveOnboarding() {
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (user) {
      await sb.from('profiles').upsert({
        id: user.id,
        email: user.email,
        name: el.authName.value.trim() || null,
        use_case: selectedUseCase,
      });
      currentUser = { id: user.id, email: user.email, name: el.authName.value.trim() || null };
      renderAccountBtn();
      await syncOnSignIn();
    }
  } catch (err) { console.error('Не удалось сохранить профиль:', err); }
  closeAuthModal();
  toast(t('auth.signed_in_toast'));
}

/** Имя живёт в таблице profiles (не в auth-метаданных) — так же, как в
 *  мобильном приложении, иначе две платформы читали бы разные источники. */
async function updateProfileName(name) {
  const clean = (name || '').trim() || null;
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return false;
    const { error } = await sb.from('profiles').update({ name: clean }).eq('id', user.id);
    if (error) throw error;
    currentUser = { ...currentUser, name: clean };
    return true;
  } catch (err) { console.error('Не удалось обновить имя профиля:', err); return false; }
}
async function changePassword(newPassword) {
  try {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  } catch (err) { console.error('Не удалось изменить пароль:', err); return false; }
}

async function signOut() {
  const ok = await confirmDialog(t('auth.sign_out_confirm'), {
    title: t('auth.sign_out'), okLabel: t('auth.sign_out'), danger: true,
  });
  if (!ok) return;
  await sb.auth.signOut();
  unsubscribeSyncRealtime();
  currentUser = null;
  renderAccountBtn();
  // Страница настроек показывает карточку профиля и раздел «Аккаунт» —
  // без этого после выхода она продолжала показывать вошедшего.
  if (state.ui.view === 'settings') renderSettings();
  toast(t('auth.signed_out_toast'));
}

async function handleGoogleSignIn() {
  el.authGoogleBtn.disabled = true;
  el.authError.hidden = true;
  try {
    // Десктоп: открываем системный браузер и ждём lancible://auth-callback
    // через IPC (кастомный протокол, main.js). Веб: сама страница и есть
    // редирект-цель — не мешаем signInWithOAuth перенаправить вкладку.
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: IS_WEB
        ? { redirectTo: window.location.origin + window.location.pathname }
        : { redirectTo: 'lancible://auth-callback', skipBrowserRedirect: true },
    });
    if (error) { showAuthError('auth.error_generic'); return; }
    if (!IS_WEB) {
      if (!data || !data.url) { showAuthError('auth.error_generic'); return; }
      await window.api.openExternal(data.url);
    }
    // на вебе signInWithOAuth уже сам перенаправил вкладку — сюда код не дойдёт
  } catch {
    showAuthError('auth.error_generic');
  } finally {
    el.authGoogleBtn.disabled = false;
  }
}

/** Колбэк системного браузера после входа через Google: main.js ловит
 * lancible://auth-callback (по протоколу, зарегистрированному инсталлятором)
 * и присылает его сюда через IPC — окно приложения всё это время остаётся
 * открытым, менять код на сессию тем же клиентом (PKCE) можно прямо здесь. */
// Не определён на вебе (detectSessionInUrl:true уже сам достраивает сессию
// по возврату с Google) — есть только у десктопного window.api.
if (window.api.onOAuthCallback) {
  window.api.onOAuthCallback(async ({ url }) => {
    let code = null;
    try {
      code = new URL(url).searchParams.get('code');
    } catch { /* некорректный колбэк — игнорируем */ }
    if (!code) return;
    try {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { showAuthError('auth.error_generic'); return; }
      await afterSignedIn();
    } catch {
      showAuthError('auth.error_generic');
    }
  });
}

el.accountBtn.addEventListener('click', () => {
  if (currentUser) {
    openMenu(el.accountBtn, [
      { label: t('sync.toggle_label'), selected: state.settings.syncEnabled !== false, onClick: toggleSyncEnabled },
      { sep: true },
      { label: t('auth.sign_out'), danger: true, onClick: signOut },
    ]);
  } else openAuthModal();
});
el.authCancel.addEventListener('click', closeAuthModal);
el.authBackdrop.addEventListener('click', (e) => { if (e.target === el.authBackdrop) closeAuthModal(); });
el.authSubmit.addEventListener('click', handleAuthSubmit);
el.authSignupBtn.addEventListener('click', handleSignup);
el.authGoogleBtn.addEventListener('click', handleGoogleSignIn);
el.authOnboardingSave.addEventListener('click', saveOnboarding);
el.authOnboardingSkip.addEventListener('click', async () => {
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (user) {
      // минимальная строка профиля — иначе онбординг будет всплывать при каждом входе.
      await sb.from('profiles').upsert({ id: user.id, email: user.email });
      currentUser = { id: user.id, email: user.email, name: null };
      renderAccountBtn();
    }
  } catch (err) { console.error('Не удалось сохранить профиль:', err); }
  closeAuthModal();
  toast(t('auth.signed_in_toast'));
});
el.authConfirmOk.addEventListener('click', closeAuthModal);
[el.authEmail, el.authPassword].forEach((input) => {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
});

sb.auth.getSession().then(({ data }) => { if (data && data.session) afterSignedIn({ silent: true }); });

// ---------------------------------------------------------------------------
// Синхронизация данных (проекты/задачи) с Supabase — только для вошедших.
// Хранится одним JSON-документом на пользователя (таблица sync_state), а не
// разложено по реляционным таблицам: это ровно то же самое, что уже целиком
// сохраняется локально в data.json, поэтому не потребовалось менять ни одну
// точку мутации state.projects/state.tasks. activeTimer/settings/ui
// намеренно НЕ синхронизируются — это данные конкретного устройства.
// ---------------------------------------------------------------------------

const SYNC_CLIENT_ID = uid(); // отличает собственные правки от чужих в realtime-подписке
let syncChannel = null;
let syncDirty = false;
let syncRetryTimer = null;
// JSON последнего состояния, которое точно совпадает с сервером (свой
// успешный пуш или только что подтянутые чужие данные) — pushSyncState
// сверяется с ним, чтобы не отправлять обратно то же самое, что и так
// только что пришло. Без этой проверки два устройства бесконечно
// перекидывались бы идентичными обновлениями по кругу (реально
// воспроизведено при тестировании), а под нагрузкой более старое
// сообщение могло прийти позже нового и откатить чужие изменения.
let lastSyncedJSON = null;

function syncPayload() {
  // Статусы, теги и версии — такие же пользовательские данные, как проекты и
  // задачи: без них на втором устройстве задача приедет со статусом, которого
  // там не существует, и миграция молча сбросит её в «к выполнению».
  return {
    projects: state.projects,
    tasks: state.tasks,
    statuses: state.statuses,
    tags: state.tags,
    versions: state.versions,
  };
}

async function pushSyncState() {
  if (!currentUser || state.settings.syncEnabled === false) return;
  const payload = syncPayload();
  const json = JSON.stringify(payload);
  if (json === lastSyncedJSON) return; // с последнего синка ничего не поменялось
  try {
    const { error } = await sb.from('sync_state').upsert({
      user_id: currentUser.id,
      data: payload,
      updated_at: new Date().toISOString(),
      updated_by: SYNC_CLIENT_ID,
    });
    if (error) throw error;
    lastSyncedJSON = json;
    syncDirty = false;
    // Держим "отпечаток" свежим при каждом обычном пуше, пока пользователь
    // не выходил из аккаунта — иначе создание задачи, пока уже залогинен,
    // само по себе устарило бы отпечаток и на следующем запуске диалог
    // "какие данные оставить" всплыл бы просто из-за обычной, уже
    // синхронизированной правки, а не из-за настоящего расхождения.
    rememberSyncResolution();
  } catch (err) {
    console.error('Не удалось синхронизировать данные:', err);
    syncDirty = true;
    scheduleSyncRetry();
  }
}

function scheduleSyncRetry() {
  clearTimeout(syncRetryTimer);
  syncRetryTimer = setTimeout(() => { if (syncDirty && currentUser) pushSyncState(); }, 15000);
}
window.addEventListener('online', () => { if (syncDirty && currentUser) pushSyncState(); });

function applyRemoteData(data) {
  state.projects = Array.isArray(data && data.projects) ? data.projects : [];
  state.tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  // Пришло с устройства, которое ещё не знает про статусы, — не затираем свои
  // пустым массивом, иначе migrate() заведёт дубликаты набора по умолчанию.
  if (Array.isArray(data && data.statuses)) state.statuses = data.statuses;
  if (Array.isArray(data && data.tags)) state.tags = data.tags;
  if (Array.isArray(data && data.versions)) state.versions = data.versions;
  migrate();
  if (selectedId && !getTask(selectedId)) selectedId = null;
  if (state.ui.projectId && !getProject(state.ui.projectId)) {
    state.ui.view = 'home';
    state.ui.projectId = null;
  }
  lastSyncedJSON = JSON.stringify(syncPayload());
  render();
  scheduleSave(); // сохраняем локально; pushSyncState сам не отправит лишнего — см. lastSyncedJSON
}

// "Отпечаток" локальных данных на момент разрешения конфликта — используется
// ниже, чтобы не спрашивать "какие данные оставить" повторно при каждом
// входе/перезапуске, если с прошлого раза ничего не изменилось (раньше
// диалог всплывал на КАЖДОЕ восстановление сессии на старте, а не только на
// осознанный вход, потому что afterSignedIn({silent:true}) всё равно звал
// syncOnSignIn). Отпечаток инвалидируется сам по себе, если пользователь
// поработал локально (в том числе выйдя из аккаунта) — тогда хэш перестаёт
// совпадать и при следующем входе диалог закономерно появится снова.
/* Вопрос «взять данные с сервера или оставить локальные» задаётся один раз на
 * аккаунт, и всё.
 *
 * Раньше решение помнилось вместе с отпечатком локальных данных, и любая
 * правка — добавленная задача, запущенный таймер — делала отпечаток другим.
 * Из-за этого приложение спрашивало заново при каждом запуске, хотя выбор был
 * сделан давно. Дальше устройства и так сходятся: обычная синхронизация
 * заливает и подтягивает изменения сама, конфликт возможен только в первый
 * раз, когда на обеих сторонах уже лежат независимо накопленные данные.
 *
 * Отметка живёт в локальных настройках, поэтому на новом устройстве вопрос
 * прозвучит ровно один раз — там он как раз уместен. */
function isSyncAlreadyResolved() {
  const r = state.settings.syncResolvedFor;
  return !!(currentUser && r && r.userId === currentUser.id);
}
function rememberSyncResolution() {
  if (!currentUser) return;
  if (isSyncAlreadyResolved()) return;
  state.settings.syncResolvedFor = { userId: currentUser.id };
  scheduleSave();
}

let syncInFlightFor = null;

/** При входе: если на сервере ничего нет — заливаем локальные данные; если
 * локально пусто — просто подтягиваем с сервера; если данные есть и там, и
 * там — спрашиваем пользователя, но только один раз для этой пары
 * (аккаунт, состояние локальных данных) — см. rememberSyncResolution. */
async function syncOnSignIn() {
  if (!currentUser || state.settings.syncEnabled === false) return;
  if (syncInFlightFor === currentUser.id) return; // защита от почти одновременных повторных вызовов (см. afterSignedIn)
  syncInFlightFor = currentUser.id;
  try {
    await syncOnSignInInner();
  } finally {
    syncInFlightFor = null;
  }
}

async function syncOnSignInInner() {
  let row = null;
  try {
    const { data, error } = await sb.from('sync_state').select('data, updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    row = data;
  } catch (err) {
    console.error('Не удалось прочитать синхронизированные данные:', err);
    return;
  }
  const localHasData = state.projects.length > 0 || state.tasks.length > 0;
  const remoteHasData = !!(row && row.data && ((row.data.projects || []).length > 0 || (row.data.tasks || []).length > 0));
  if (!remoteHasData) {
    if (localHasData) await pushSyncState();
  } else if (!localHasData) {
    applyRemoteData(row.data);
  } else if (!isSyncAlreadyResolved()) {
    const useServer = await confirmDialog(t('sync.conflict_text'), {
      title: t('sync.conflict_title'),
      okLabel: t('sync.use_server'),
      cancelLabel: t('sync.use_local'),
      danger: false,
    });
    if (useServer) applyRemoteData(row.data);
    else await pushSyncState();
  }
  rememberSyncResolution();
  subscribeSyncRealtime();
}

function subscribeSyncRealtime() {
  unsubscribeSyncRealtime();
  if (!currentUser || state.settings.syncEnabled === false) return;
  syncChannel = sb
    .channel('sync_state:' + currentUser.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_state', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
      const row = payload.new;
      if (!row || row.updated_by === SYNC_CLIENT_ID) return; // эхо нашей же записи
      applyRemoteData(row.data);
      rememberSyncResolution(); // см. комментарий в pushSyncState
      toast(t('sync.updated_toast'));
    })
    .subscribe();
}
function unsubscribeSyncRealtime() {
  if (syncChannel) { sb.removeChannel(syncChannel); syncChannel = null; }
}

/** Пункт меню аккаунта — источник данных: пользователь может полностью
 * отключить облачную синхронизацию для этого устройства (данные остаются
 * только локально, даже будучи залогиненным), не выходя из аккаунта. */
function toggleSyncEnabled() {
  const next = !(state.settings.syncEnabled !== false);
  state.settings.syncEnabled = next;
  scheduleSave();
  if (next) { if (currentUser) syncOnSignIn(); } else { unsubscribeSyncRealtime(); }
  toast(next ? t('sync.enabled_toast') : t('sync.disabled_toast'));
}

// ---------------------------------------------------------------------------
// Сохранение
// ---------------------------------------------------------------------------

let saveTimer = null;
let savePending = false;

function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  try {
    await window.api.save(state);
    if (currentUser) pushSyncState(); // не блокируем локальное сохранение сетью; сам не пришлёт лишнего — см. lastSyncedJSON
  } catch (err) {
    console.error('Не удалось сохранить данные:', err);
    toast(t('toast.save_error'));
    savePending = true;
  }
}
window.addEventListener('beforeunload', () => { if (savePending) window.api.save(state); });

// ---------------------------------------------------------------------------
// Рендер — маршрутизатор
// ---------------------------------------------------------------------------

function render() {
  if (state.ui.view === 'project' && !getProject(state.ui.projectId)) state.ui.view = 'home';
  const v = state.ui.view;

  document.body.classList.toggle('nav-collapsed', !!state.ui.navCollapsed);
  document.body.classList.toggle('has-selected-task', v === 'project' && !!selectedId);
  renderStats();
  renderNotifBadge();
  el.topbar.hidden = v !== 'home';

  el.navItems.forEach((tab) => {
    const active = tab.dataset.view === v || (tab.dataset.view === 'home' && v === 'project');
    tab.classList.toggle('active', active);
  });

  const views = { home: el.homeView, project: el.projectView, board: el.boardView, calendar: el.calendarView, stats: el.statsView, settings: el.settingsView };
  for (const [name, node] of Object.entries(views)) {
    const show = name === v;
    node.hidden = !show;
    if (show) { node.classList.remove('anim'); void node.offsetWidth; node.classList.add('anim'); }
  }

  if (v === 'home') renderHome();
  else if (v === 'project') { renderProjectHeader(); renderSidebar(); renderDetail(); renderFooter(); }
  else if (v === 'board') renderBoardPage();
  else if (v === 'stats') renderStatsPage();
  else if (v === 'settings') renderSettings();
  else renderCalendar();
}

function openView(view) {
  flushEditor();
  closeMenu();
  closeSearch();
  state.ui.view = view;
  render();
  scheduleSave();
  setTimeout(updateCarousels, 60);
}

function toggleNav() {
  state.ui.navCollapsed = !state.ui.navCollapsed;
  document.body.classList.toggle('nav-collapsed', state.ui.navCollapsed);
  scheduleSave();
  // Карусели пересчитываем по ходу анимации сворачивания рейла (не только в конце),
  // чтобы стрелки прокрутки не "прыгали" при появлении лишнего места.
  const start = performance.now();
  const step = (tm) => {
    updateCarousels();
    if (tm - start < 260) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

function renderStats() {
  const totalMs = state.tasks.reduce((a, t2) => a + taskElapsedMs(t2), 0);
  el.stTime.textContent = fmtDur(totalMs);
  el.stMoney.textContent = fmtMoney(state.tasks.reduce((a, t2) => a + earnedOf(t2), 0));

  const now = new Date();
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  el.stMonth.textContent = fmtMoney(rangeAgg(monthFrom, monthTo).money);

  const total = state.tasks.length;
  const done = state.tasks.filter((t2) => t2.done).length;
  el.stDone.textContent = total ? `${done} / ${total}` : '0';

  const at = state.activeTimer;
  const rt = at && getTask(at.taskId);
  el.stRunning.hidden = !rt;
  if (rt) {
    const sec = fmtClock(Date.now() - new Date(at.startedAt).getTime());
    el.stRunning.innerHTML =
      `<span class="r-name">${icon('clock')} ${escapeHtml(rt.title || t('task.no_name'))}</span><span class="r-time">${sec}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Главная
// ---------------------------------------------------------------------------

function renderHome() {
  const pinned = state.projects.filter((p) => p.pinnedAt).sort(byPinned);
  const rest = state.projects.filter((p) => !p.pinnedAt);

  el.homeCount.textContent = state.projects.length ? `· ${state.projects.length}` : '';
  el.pinnedSection.hidden = pinned.length === 0;
  el.allLabel.hidden = pinned.length === 0;
  el.homeEmpty.hidden = state.projects.length > 0;

  fillTrack(el.pinnedTrack, pinned.map(projectTile));
  fillNodes(el.projectsTrack, [...rest.map(projectTile), plusTile()]);

  const recent = recentTasks(12);
  el.recentSection.hidden = recent.length === 0;
  fillTrack(el.recentTrack, recent.map(recentTile));

  renderHomeSide();
  requestAnimationFrame(updateCarousels);
}

function fillTrack(track, nodes) {
  track.innerHTML = '';
  nodes.forEach((n, i) => {
    n.style.animationDelay = `${Math.min(i, 8) * 28}ms`;
    track.appendChild(n);
  });
}
/** Как fillTrack, но без ограничений на длину (для .projects-grid — заголовок ряда не важен). */
function fillNodes(container, nodes) {
  container.innerHTML = '';
  nodes.forEach((n, i) => {
    n.style.animationDelay = `${Math.min(i, 10) * 24}ms`;
    container.appendChild(n);
  });
}

function projectTile(p) {
  const tasks = tasksOf(p.id);
  const done = tasks.filter((t2) => t2.done).length;
  const ms = projectMs(p.id);
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  const tile = document.createElement('article');
  tile.className = 'ptile';
  tile.style.setProperty('--pc', p.color || PALETTE[0]);
  tile.dataset.id = p.id;
  // Закрепление вынесено из меню на саму карточку: это единственное действие,
  // которое нажимают часто, и ради него не стоит каждый раз открывать список.
  // Кнопка проявляется по наведению, чтобы не шуметь в сетке, но у уже
  // закреплённого проекта видна всегда — иначе непонятно, чем его открепить.
  const pinTitle = p.pinnedAt ? t('project.unpin') : t('project.pin');
  tile.innerHTML = `
    <button class="ptile-pin icon-btn${p.pinnedAt ? ' on' : ''}" aria-label="${escapeHtml(pinTitle)}" title="${escapeHtml(pinTitle)}" aria-pressed="${p.pinnedAt ? 'true' : 'false'}" tabindex="-1">
      ${icon('pin')}
    </button>
    <button class="ptile-menu icon-btn" aria-label="${escapeHtml(t('project.opts'))}" tabindex="-1">
      <svg class="icon" viewBox="0 0 16 16"><path d="M8 2.4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>
    </button>
    <div class="ptile-main">
      <div class="ptile-name">${escapeHtml(p.name)}</div>
      ${p.description ? `<div class="ptile-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="ptile-foot">
        <span class="ptile-stat">${icon('clock')} ${fmtDur(ms)}</span>
        <span class="ptile-stat">${icon('wallet')} ${fmtMoney(projectMoney(p.id))}</span>
        <span class="ptile-stat">${icon('check')} ${done}/${tasks.length}</span>
        <span class="ptile-date">${escapeHtml(t('home.created_on', { date: fmtDateShort(p.createdAt) }))}</span>
      </div>
      <div class="ptile-progress"><i style="width:${pct}%"></i></div>
    </div>`;
  tile.querySelector('.ptile-main').addEventListener('click', () => openProject(p.id));
  tile.querySelector('.ptile-pin').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePinProject(p.id);
  });
  tile.querySelector('.ptile-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectMenu(p, e.currentTarget);
  });
  return tile;
}

function plusTile() {
  const b = document.createElement('button');
  b.className = 'ptile ptile-add';
  b.innerHTML = '<span class="plus">+</span>';
  b.title = t('home.new_project_title');
  b.addEventListener('click', () => openProjectDialog(null));
  return b;
}

function recentTasks(limit) {
  return state.tasks
    .filter((t2) => !t2.done)
    .map((t2) => {
      let last = 0;
      for (const s of t2.sessions || []) last = Math.max(last, new Date(s.end || s.start).getTime());
      if (!last) last = new Date(t2.updatedAt || t2.createdAt || 0).getTime();
      return { t: t2, last };
    })
    .filter((x) => x.last > 0)
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map((x) => x.t);
}

function recentTile(task) {
  const p = getProject(task.projectId);
  const tile = document.createElement('div');
  tile.className = 'rtile' + (task.done ? ' done' : '');
  tile.style.setProperty('--pc', p ? p.color : PALETTE[0]);
  tile.innerHTML = `
    <div class="rtile-top">
      <input type="checkbox" ${task.done ? 'checked' : ''} />
      <span class="rtile-name">${escapeHtml(task.title || t('task.no_name'))}</span>
    </div>
    <div class="rtile-foot">
      <span class="rtile-proj"><span>${escapeHtml(p ? p.name : '')}</span></span>
      <span class="rtile-time">${icon('clock')} ${fmtDur(taskElapsedMs(task))}</span>
    </div>`;
  const cb = tile.querySelector('input');
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => {
    setTaskDone(task, cb.checked);
    tile.classList.toggle('done', task.done);
    renderStats();
    scheduleSave();
  });
  tile.addEventListener('click', () => { openProject(task.projectId); selectTask(task.id); });
  return tile;
}

function renderHomeSide() {
  const days = aggregateDays();
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  el.miniCalTitle.textContent = monthLabel(y, mo);

  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7;
  const dim = new Date(y, mo + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  el.miniCal.innerHTML = '';
  let mMs = 0;
  let mMoney = 0;
  const tKey = dayKey(now);
  for (const d of cells) {
    const c = document.createElement('button');
    c.className = 'mc-cell';
    if (d == null) { c.classList.add('empty'); c.disabled = true; el.miniCal.appendChild(c); continue; }
    const key = `${y}-${pad2(mo + 1)}-${pad2(d)}`;
    const agg = days.get(key);
    if (agg) { c.classList.add('has'); mMs += agg.ms; mMoney += agg.money; }
    if (key === tKey) c.classList.add('today');
    c.textContent = String(d);
    c.title = agg ? `${fmtDur(agg.ms)} · ${fmtMoney(agg.money)}` : '';
    c.addEventListener('click', () => {
      calState.year = y;
      calState.month = mo;
      calState.selected = key;
      if (calState.periodOn) togglePeriod();
      setCalMode('month');
      openView('calendar');
    });
    el.miniCal.appendChild(c);
  }
  el.miniCalTot.textContent = `${fmtDur(mMs)} · ${fmtMoney(mMoney)}`;
  const tAgg = days.get(tKey);
  const weekFrom = mondayOf(now);
  const weekTo = new Date(weekFrom.getTime() + 6 * 86400000);
  weekTo.setHours(23, 59, 59, 999);
  const week = rangeAgg(weekFrom, weekTo);
  el.sideToday.innerHTML = `
    <div class="side-stat"><span>${escapeHtml(t('calendar.today'))}</span><b>${tAgg ? `${fmtDur(tAgg.ms)} · ${fmtMoney(tAgg.money)}` : `0м · ${fmtMoney(0)}`}</b></div>
    <div class="side-stat"><span>${escapeHtml(t('calendar.for_week'))}</span><b>${fmtDur(week.ms)} · ${fmtMoney(week.money)}</b></div>`;
}

// карусели

const carousels = [];
function setupCarousels() {
  document.querySelectorAll('.carousel').forEach((c) => {
    const track = c.querySelector('.car-track');
    c.querySelectorAll('.car-arrow').forEach((a) => {
      a.addEventListener('click', () => {
        const dir = a.dataset.dir === '1' ? 1 : -1;
        track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
      });
    });
    track.addEventListener('scroll', () => updateCarousel(c));
    track.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { track.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    carousels.push(c);
  });
}
function updateCarousel(c) {
  const track = c.querySelector('.car-track');
  const [left, right] = c.querySelectorAll('.car-arrow');
  const overflow = track.scrollWidth > track.clientWidth + 4;
  const max = track.scrollWidth - track.clientWidth - 2;
  left.hidden = !overflow || track.scrollLeft <= 1;
  right.hidden = !overflow || track.scrollLeft >= max;
}
const updateCarousels = () => carousels.forEach(updateCarousel);
window.addEventListener('resize', updateCarousels);

// ---------------------------------------------------------------------------
// Поиск
// ---------------------------------------------------------------------------

function openSearch() {
  const r = el.tbSearch.getBoundingClientRect();
  el.searchPanel.style.left = `${Math.round(r.left)}px`;
  el.searchPanel.style.width = `${Math.max(320, Math.round(r.width))}px`;
  el.searchPanel.hidden = false;
  renderSearch(el.searchInput.value);
  setTimeout(() => document.addEventListener('pointerdown', searchOutside, true), 0);
}
function closeSearch() {
  el.searchPanel.hidden = true;
  document.removeEventListener('pointerdown', searchOutside, true);
}
function searchOutside(e) {
  if (!el.searchPanel.contains(e.target) && e.target !== el.searchInput) closeSearch();
}

function renderSearch(q) {
  q = q.trim().toLowerCase();
  el.searchResults.innerHTML = '';
  if (!q) {
    el.searchResults.innerHTML = `<div class="sr-empty">${escapeHtml(t('search.start_typing'))}</div>`;
    return;
  }
  const projects = state.projects
    .filter((p) => (p.name + ' ' + (p.description || '')).toLowerCase().includes(q))
    .slice(0, 6);
  const tasks = state.tasks
    .filter((t2) => (t2.title || '').toLowerCase().includes(q))
    .slice(0, 10);

  if (!projects.length && !tasks.length) {
    el.searchResults.innerHTML = `<div class="sr-empty">${escapeHtml(t('search.nothing_found'))}</div>`;
    return;
  }

  const addItem = (opts) => {
    const b = document.createElement('button');
    b.className = 'sr-item';
    b.innerHTML =
      `<span class="sr-dot" style="background:${opts.color}"></span>` +
      `<span class="sr-main"><span class="sr-title">${escapeHtml(opts.title)}</span>` +
      (opts.sub ? `<span class="sr-sub">${escapeHtml(opts.sub)}</span>` : '') + '</span>' +
      (opts.meta ? `<span class="sr-meta">${escapeHtml(opts.meta)}</span>` : '');
    b.addEventListener('click', () => { opts.onClick(); closeSearch(); });
    el.searchResults.appendChild(b);
    return b;
  };

  if (projects.length) {
    const g = document.createElement('div');
    g.className = 'sr-group';
    g.textContent = `${t('search.projects_group')} · ${projects.length}`;
    el.searchResults.appendChild(g);
    for (const p of projects) {
      const n = tasksOf(p.id).length;
      addItem({
        color: p.color || PALETTE[0],
        title: p.name,
        sub: t('search.project_sub', { n, plural: pluralForm(n, 'plural.task') }),
        meta: fmtDur(projectMs(p.id)),
        onClick: () => openProject(p.id),
      });
    }
  }
  if (tasks.length) {
    const g = document.createElement('div');
    g.className = 'sr-group';
    g.textContent = `${t('search.tasks_group')} · ${tasks.length}`;
    el.searchResults.appendChild(g);
    for (const t2 of tasks) {
      const p = getProject(t2.projectId);
      addItem({
        color: p ? p.color : PALETTE[0],
        title: (t2.done ? '✓ ' : '') + (t2.title || t('task.no_name')),
        sub: p ? t('search.task_sub', { name: p.name }) : '',
        meta: fmtDur(taskElapsedMs(t2)),
        onClick: () => { openProject(t2.projectId); selectTask(t2.id); },
      });
    }
  }
  const first = el.searchResults.querySelector('.sr-item');
  if (first) first.classList.add('sel');
}

// ---------------------------------------------------------------------------
// Календарь
// ---------------------------------------------------------------------------

const _now = new Date();
const calState = {
  mode: 'month',            // 'month' | 'week' | 'day'
  year: _now.getFullYear(),
  month: _now.getMonth(),
  weekStart: mondayOf(_now),
  day: startOfDay(_now),
  selected: dayKey(_now),
  periodOn: false,
  rangeFrom: null,
  rangeTo: null,
  picking: false,           // ждём вторую точку диапазона на сетке
};

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function calShift(delta) {
  if (calState.mode === 'month') {
    const dt = new Date(calState.year, calState.month + delta, 1);
    calState.year = dt.getFullYear();
    calState.month = dt.getMonth();
  } else if (calState.mode === 'week') {
    calState.weekStart = new Date(calState.weekStart.getTime() + delta * 7 * 86400000);
  } else {
    calState.day = new Date(calState.day.getTime() + delta * 86400000);
    calState.selected = dayKey(calState.day);
  }
  renderCalendar();
}

/** Границы текущего вида (для авто-заполнения диапазона периода). */
function currentViewBounds() {
  if (calState.mode === 'month') return [new Date(calState.year, calState.month, 1), new Date(calState.year, calState.month + 1, 0)];
  if (calState.mode === 'week') return [new Date(calState.weekStart), new Date(calState.weekStart.getTime() + 6 * 86400000)];
  return [new Date(calState.day), new Date(calState.day)];
}

function setCalMode(mode) {
  calState.mode = mode;
  el.calModes.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  el.calWeekdays.hidden = mode === 'day';
  if (calState.periodOn) seedRangeFromView();
  renderCalendar();
}

function seedRangeFromView() {
  const [from, to] = currentViewBounds();
  calState.rangeFrom = dayKey(from);
  calState.rangeTo = dayKey(to);
  calState.picking = false;
}

function togglePeriod() {
  calState.periodOn = !calState.periodOn;
  el.calPeriodToggle.setAttribute('aria-pressed', String(calState.periodOn));
  // Границы периода нигде не выписываются текстом: выбранный диапазон и так
  // подсвечен прямо на сетке календаря, а строка с датами под табами только
  // повторяла её и отодвигала сам календарь вниз.
  if (calState.periodOn) seedRangeFromView();
  else closeDatePicker();
  renderCalendar();
}

/** [от, до 23:59:59] выбранного диапазона периода, или null. */
function rangeBounds() {
  if (!calState.rangeFrom || !calState.rangeTo) return null;
  let [a, b] = [keyToDate(calState.rangeFrom), keyToDate(calState.rangeTo)];
  if (a > b) [a, b] = [b, a];
  return [a, new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59)];
}

/** Клик по дню на сетке месяца/недели во время выбора периода: 1-й клик — начало, 2-й — конец. */
function pickRangeDay(key) {
  if (!calState.picking) {
    calState.rangeFrom = key;
    calState.rangeTo = key;
    calState.picking = true;
  } else {
    calState.rangeTo = key;
    calState.picking = false;
  }
  renderCalendar();
}

// ---------------------------------------------------------------------------
// Кастомный выбор даты — переиспользуемый попап (период в календаре, диалог
// записи времени) вместо системного календаря у <input type="date">.
// ---------------------------------------------------------------------------

const dp = { open: false, anchor: null, value: null, view: new Date(), onPick: null };

function fmtDpBtn(key) {
  if (!key) return t('calendar.pick_date');
  const text = keyToDate(key).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  // ru-RU дописывает к году « г.» — на кнопке это лишний хвост, который ещё и
  // отъедает ширину у и без того тесной строки дедлайна.
  return text.replace(/\s*г\.$/, '');
}

/** Открывает попап у anchor, показывая value ('YYYY-MM-DD' или null); onPick(key) вызывается при клике по дню. */
function openDatePicker(anchorEl, value, onPick) {
  closeTimePicker();
  dp.anchor = anchorEl;
  dp.value = value || null;
  dp.view = value ? keyToDate(value) : new Date();
  dp.onPick = onPick;
  dp.open = true;
  anchorEl.classList.add('on');
  renderDatePicker();
  const r = anchorEl.getBoundingClientRect();
  el.dpPop.style.left = `${Math.round(r.left)}px`;
  el.dpPop.style.top = `${Math.round(r.bottom + 6)}px`;
  el.dpPop.hidden = false;
  setTimeout(() => document.addEventListener('pointerdown', dpOutside, true), 0);
}
function closeDatePicker() {
  if (!dp.open) return;
  dp.open = false;
  el.dpPop.hidden = true;
  if (dp.anchor) dp.anchor.classList.remove('on');
  document.removeEventListener('pointerdown', dpOutside, true);
}
function dpOutside(e) {
  if (!el.dpPop.contains(e.target) && e.target !== dp.anchor) closeDatePicker();
}
function renderDatePicker() {
  const y = dp.view.getFullYear();
  const m = dp.view.getMonth();
  el.dpTitle.textContent = monthLabel(y, m);
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  el.dpDays.innerHTML = '';
  const todayKey = dayKey(new Date());
  for (const d of cells) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-day';
    if (d == null) { b.classList.add('empty'); b.disabled = true; el.dpDays.appendChild(b); continue; }
    const key = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (key === todayKey) b.classList.add('today');
    if (key === dp.value) b.classList.add('sel');
    b.textContent = String(d);
    b.addEventListener('click', () => {
      dp.value = key;
      closeDatePicker();
      if (dp.onPick) dp.onPick(key);
    });
    el.dpDays.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Кастомный выбор времени (часы/минуты) — свой попап вместо <input type="time">.
// ---------------------------------------------------------------------------

const tp = { open: false, anchor: null, value: null, onPick: null };

/** Открывает попап у anchor, показывая value ('HH:MM'); onPick('HH:MM') вызывается при каждом клике. */
function openTimePicker(anchorEl, value, onPick) {
  closeDatePicker();
  const [h, m] = (value || '00:00').split(':').map(Number);
  tp.anchor = anchorEl;
  tp.value = { h: h || 0, m: m || 0 };
  tp.onPick = onPick;
  tp.open = true;
  anchorEl.classList.add('on');
  renderTimePicker();
  const r = anchorEl.getBoundingClientRect();
  el.tpPop.style.left = `${Math.round(r.left)}px`;
  el.tpPop.style.top = `${Math.round(r.bottom + 6)}px`;
  el.tpPop.hidden = false;
  setTimeout(() => document.addEventListener('pointerdown', tpOutside, true), 0);
  requestAnimationFrame(() => {
    const selH = el.tpHours.querySelector('.sel');
    const selM = el.tpMinutes.querySelector('.sel');
    if (selH) selH.scrollIntoView({ block: 'center' });
    if (selM) selM.scrollIntoView({ block: 'center' });
  });
}
function closeTimePicker() {
  if (!tp.open) return;
  tp.open = false;
  el.tpPop.hidden = true;
  if (tp.anchor) tp.anchor.classList.remove('on');
  document.removeEventListener('pointerdown', tpOutside, true);
}
function tpOutside(e) {
  if (!el.tpPop.contains(e.target) && e.target !== tp.anchor) closeTimePicker();
}
function renderTimePicker() {
  el.tpHours.innerHTML = '';
  for (let h = 0; h < 24; h++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = pad2(h);
    if (h === tp.value.h) b.classList.add('sel');
    b.addEventListener('click', () => { tp.value.h = h; commitTime(); });
    el.tpHours.appendChild(b);
  }
  el.tpMinutes.innerHTML = '';
  for (let m = 0; m < 60; m++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = pad2(m);
    if (m === tp.value.m) b.classList.add('sel');
    b.addEventListener('click', () => { tp.value.m = m; commitTime(); });
    el.tpMinutes.appendChild(b);
  }
}
function commitTime() {
  renderTimePicker();
  if (tp.onPick) tp.onPick(`${pad2(tp.value.h)}:${pad2(tp.value.m)}`);
}

/** Итог по времени/деньгам за весь видимый месяц/неделю — всегда виден в правой
 * панели, независимо от режима «период». Для «день» не нужен — там панель
 * справа и так уже показывает итог по выбранному дню. */
function renderViewTotal() {
  if (calState.mode === 'day') { el.calViewTot.hidden = true; return; }
  const [from, to] = currentViewBounds();
  const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
  const { ms, money } = rangeAgg(from, toEnd);
  const label = calState.mode === 'month' ? t('calendar.for_month') : t('calendar.for_week');
  el.calViewTot.hidden = false;
  el.calViewTot.classList.remove('period');
  el.calViewTot.innerHTML = `<span>${escapeHtml(label)}</span><b>${fmtDur(ms)} · ${fmtMoney(money)}</b>`;
}

function renderCalendar() {
  if (calState.mode === 'day') { el.calViewTot.hidden = true; renderDayHours(); return; }
  renderViewTotal();

  const days = aggregateDays();
  el.calDays.className = `cal-days ${calState.mode}`;

  const cells = [];
  if (calState.mode === 'month') {
    const { year, month } = calState;
    el.calTitle.textContent = monthLabel(year, month);
    const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const dim = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push({ key: `${year}-${pad2(month + 1)}-${pad2(d)}`, day: d });
    while (cells.length % 7) cells.push(null);
  } else {
    const ws = calState.weekStart;
    const we = new Date(ws.getTime() + 6 * 86400000);
    el.calTitle.textContent = `${ws.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws.getTime() + i * 86400000);
      cells.push({ key: dayKey(d), day: d.getDate() });
    }
  }

  const range = calState.periodOn ? rangeBounds() : null;
  el.calDays.innerHTML = '';
  const todayKey = dayKey(new Date());
  for (const c of cells) {
    const cell = document.createElement('button');
    cell.className = 'cal-cell';
    if (c == null) { cell.classList.add('empty'); cell.disabled = true; el.calDays.appendChild(cell); continue; }
    const agg = days.get(c.key);
    if (c.key === todayKey) cell.classList.add('today');
    if (!calState.periodOn && c.key === calState.selected) cell.classList.add('sel');
    if (range) {
      const d = keyToDate(c.key);
      if (d >= range[0] && d <= range[1]) cell.classList.add('in-range');
      if (c.key === calState.rangeFrom || c.key === calState.rangeTo) cell.classList.add('range-end');
    }
    let html = `<span class="cc-num">${c.day}</span>`;
    if (agg) html += `<span class="cc-time">${fmtDur(agg.ms)}</span><span class="cc-money">${fmtMoney(agg.money)}</span>`;
    const doneTasks = tasksDoneOnDay(c.key);
    if (doneTasks.length) {
      if (calState.mode === 'week') {
        html += `<div class="cc-done-list">${doneTasks.map((t2) =>
          `<span class="cc-done-item">${icon('check')}${escapeHtml(t2.title || t('task.no_name'))}</span>`,
        ).join('')}</div>`;
      } else {
        html += `<span class="cc-done-badge">${icon('check')}${doneTasks.length}</span>`;
      }
    }
    cell.innerHTML = html;
    if (agg) {
      const bar = document.createElement('i');
      bar.className = 'cc-bar';
      bar.style.width = `${Math.min(100, (agg.ms / (8 * 3_600_000)) * 100)}%`;
      cell.appendChild(bar);
    }
    cell.addEventListener('click', () => {
      if (calState.periodOn) pickRangeDay(c.key);
      else { calState.selected = c.key; renderCalendar(); }
    });
    el.calDays.appendChild(cell);
  }

  if (calState.periodOn) renderPeriodSummary();
  else renderCalDay();
}

/** Режим «День»: почасовая раскладка задач слева. */
function renderDayHours() {
  el.calTitle.textContent = capFirst(
    calState.day.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }),
  );
  el.calDays.className = 'cal-days day';
  el.calDays.innerHTML = '';

  const key = dayKey(calState.day);
  const sessions = allSessionPairs()
    .filter(({ s }) => dayKey(s.start) === key)
    .sort((a, b) => new Date(a.s.start) - new Date(b.s.start));
  const byHour = new Map();
  for (const item of sessions) {
    const h = new Date(item.s.start).getHours();
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(item);
  }

  for (let h = 0; h < 24; h++) {
    const items = byHour.get(h) || [];
    const row = document.createElement('div');
    row.className = 'hour-row' + (items.length ? ' has' : '');
    const chips = items.map(({ t: t2, s }) => {
      const p = getProject(t2.projectId);
      return `<button class="hour-chip" style="--pc:${p ? p.color : PALETTE[0]}">` +
        `<b>${escapeHtml(t2.title || t('task.no_name'))}</b>` +
        `<span>${fmtTime(s.start).slice(0, 5)}–${s.end ? fmtTime(s.end).slice(0, 5) : '…'} · ${fmtDur(s.ms)}</span></button>`;
    }).join('');
    row.innerHTML = `<span class="hour-label">${pad2(h)}:00</span><div class="hour-chips">${chips}</div>`;
    row.querySelectorAll('.hour-chip').forEach((btn, i) => {
      btn.addEventListener('click', () => { const { t: t2 } = items[i]; openProject(t2.projectId); selectTask(t2.id); });
    });
    el.calDays.appendChild(row);
  }

  if (calState.periodOn) renderPeriodSummary();
  else { calState.selected = key; renderCalDay(); }
}

function renderCalDay() {
  el.calDayList.className = 'cal-day-list';
  const key = calState.selected;
  el.calDayHead.textContent = capFirst(
    keyToDate(key).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' }),
  );
  const items = allSessionPairs()
    .filter(({ s }) => dayKey(s.start) === key)
    .sort((a, b) => new Date(a.s.start) - new Date(b.s.start));

  let ms = 0;
  let money = 0;
  el.calDayList.innerHTML = '';
  for (const { t: t2, s } of items) {
    ms += s.ms;
    money += sessionMoney(s, t2);
    const p = getProject(t2.projectId);
    const li = document.createElement('li');
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    li.innerHTML = `
      <div class="cdl-time">${fmtTime(s.start).slice(0, 5)}–${s.end ? fmtTime(s.end).slice(0, 5) : '…'}</div>
      <div class="cdl-dur">${fmtDur(s.ms)}</div>
      <div class="cdl-task">${escapeHtml(t2.title || t('task.no_name'))}<span class="cdl-proj">${escapeHtml(p ? p.name : '')}</span></div>
      <div class="cdl-money">${fmtMoney(sessionMoney(s, t2))}</div>`;
    li.addEventListener('click', () => { openProject(t2.projectId); selectTask(t2.id); });
    el.calDayList.appendChild(li);
  }
  el.calDayTot.textContent = items.length ? `${fmtDur(ms)} · ${fmtMoney(money)}` : '';
  el.calDayEmpty.hidden = items.length > 0;
}

/** Сводка за выбранный период: сколько заработано и по каким задачам. */
function renderPeriodSummary() {
  const bounds = rangeBounds();
  el.calDayList.className = 'period-list';
  if (!bounds) return;
  const [from, to] = bounds;
  const fromLabel = from.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const toLabel = to.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  el.calDayHead.textContent = fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`;

  const map = new Map();
  for (const { t: t2, s } of allSessionPairs()) {
    const d = new Date(s.start);
    if (d < from || d > to) continue;
    let e = map.get(t2.id);
    if (!e) { e = { t: t2, ms: 0, money: 0 }; map.set(t2.id, e); }
    e.ms += s.ms;
    e.money += sessionMoney(s, t2);
  }
  const tasks = [...map.values()].sort((a, b) => b.ms - a.ms);
  const totalMs = tasks.reduce((a, x) => a + x.ms, 0);
  const totalMoney = tasks.reduce((a, x) => a + x.money, 0);

  el.calDayTot.textContent = tasks.length ? `${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}` : '';
  el.calViewTot.hidden = false;
  el.calViewTot.classList.add('period');
  el.calViewTot.innerHTML = `<span>${escapeHtml(t('calendar.period_label'))}</span>`
    + `<b>${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}</b>`;
  el.calDayEmpty.hidden = tasks.length > 0;

  el.calDayList.innerHTML = '';
  for (const { t: t2, ms, money } of tasks) {
    const p = getProject(t2.projectId);
    const li = document.createElement('li');
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    li.innerHTML = `
      <span class="pl-check${t2.done ? ' done' : ''}">${icon('check')}</span>
      <span><span class="pl-name">${escapeHtml(t2.title || t('task.no_name'))}</span><span class="pl-proj">${escapeHtml(p ? p.name : '')}</span></span>
      <span class="pl-right"><span class="pl-money">${fmtMoney(money)}</span><span class="pl-time">${fmtDur(ms)}</span></span>`;
    li.addEventListener('click', () => { openProject(t2.projectId); selectTask(t2.id); });
    el.calDayList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Шапка проекта + подвал + список задач
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Доска задач — отдельная страница
// ---------------------------------------------------------------------------

/** Доска у каждого проекта своя, поэтому страница начинается с выбора
 *  проекта. Выбор живёт в ui, а не в данных: это способ смотреть, а не
 *  свойство проекта, и он не должен уезжать в синхронизацию. */
function boardProjectId() {
  if (state.ui.boardProjectId && getProject(state.ui.boardProjectId)) return state.ui.boardProjectId;
  return state.projects[0] ? state.projects[0].id : null;
}

function renderBoardPage() {
  const pid = boardProjectId();
  state.ui.boardProjectId = pid;
  const has = !!pid;
  el.boardEmpty.hidden = has;
  el.boardCols.hidden = !has;
  el.boardProject.hidden = !has;
  el.boardSum.hidden = !has;
  if (!has) { el.boardCols.innerHTML = ''; return; }

  const cur = getProject(pid);
  el.boardProject.textContent = cur ? cur.name : '';
  const tasks = tasksOf(pid);
  const done = tasks.filter((t2) => t2.done).length;
  el.boardSum.textContent = `${done}/${tasks.length}`;
  renderBoard();
}

function renderBoard() {
  const pid = boardProjectId();
  const tasks = tasksOf(pid);
  el.boardCols.innerHTML = '';
  for (const st of orderedStatuses(pid)) {
    const col = document.createElement('section');
    col.className = 'board-col';
    col.dataset.statusId = st.id;
    col.style.setProperty('--sc', st.color);

    const inCol = tasks.filter((t2) => t2.statusId === st.id);
    const head = document.createElement('div');
    head.className = 'board-col-head';
    head.innerHTML = `<span class="board-dot"></span><span class="board-col-name">${escapeHtml(st.name)}</span><span class="board-count">${inCol.length}</span>`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'board-col-body';
    for (const task of inCol) body.appendChild(boardCard(task));
    // Кнопка живёт внутри тела, сразу под последней карточкой, а не внизу
    // страницы: колонка растянута на всю высоту, и прижатая к её низу кнопка
    // оказывалась в сотнях пикселей от задач.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'board-add';
    add.title = t('board.add_task');
    add.setAttribute('aria-label', t('board.add_task'));
    add.textContent = '+';
    add.addEventListener('click', () => newTaskInStatus(pid, st.id));
    body.appendChild(add);
    col.appendChild(body);

    // Подсветка столбца под курсором и сам перенос.
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const task = getTask(e.dataTransfer.getData('text/plain'));
      if (!task || task.statusId === st.id) return;
      setTaskStatus(task, st.id);
      render();
      scheduleSave();
    });

    el.boardCols.appendChild(col);
  }
}

/** Палитра у якоря. Отдельный маленький попап, потому что в строке статуса
 *  ряд из шестнадцати кружков не помещается, а ради одного цвета открывать
 *  полноценный диалог незачем. */
function openColorPicker(anchor, onPick) {
  document.querySelectorAll('.color-pop').forEach((n2) => n2.remove());
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-dot';
    b.style.setProperty('--sc', c);
    b.addEventListener('click', () => { pop.remove(); onPick(c); });
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 8)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  const away = (e) => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', away);
  };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
}

// --- Настройка статусов проекта --------------------------------------------

/** Набор статусов настраивается у каждого проекта отдельно, поэтому диалог
 *  открывается с доски — страницы, которая этим набором и живёт. */
function openStatusDialog() {
  if (!boardProjectId()) return;
  renderStatusDialog();
  el.stdlgBackdrop.hidden = false;
}
function closeStatusDialog() { el.stdlgBackdrop.hidden = true; }

function renderStatusDialog() {
  const pid = boardProjectId();
  const list = orderedStatuses(pid);
  el.stList.innerHTML = '';
  list.forEach((st, i) => {
    const row = document.createElement('div');
    row.className = 'st-row';
    row.innerHTML = `
      <button type="button" class="st-color" style="--sc:${st.color}" data-act="color" data-i18n-title="project.color" title="Цвет"></button>
      <input class="st-name" type="text" value="${escapeHtml(st.name)}" data-i18n-ph="status.name_ph" placeholder="Название" />
      <button type="button" class="dp-btn st-kind" data-act="kind">${escapeHtml(t(`status.kind_${st.kind}`))}</button>
      <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} data-i18n-title="common.back" title="Выше">
        <svg class="icon" viewBox="0 0 16 16"><path d="M8 3.6l5.2 5.2-1.4 1.4L8 6.4l-3.8 3.8-1.4-1.4z"/></svg>
      </button>
      <button type="button" class="icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} data-i18n-title="common.forward" title="Ниже">
        <svg class="icon" viewBox="0 0 16 16"><path d="M8 12.4L2.8 7.2l1.4-1.4L8 9.6l3.8-3.8 1.4 1.4z"/></svg>
      </button>
      <button type="button" class="icon-btn st-del" data-act="del" data-i18n-title="common.delete" title="Удалить">
        <svg class="icon" viewBox="0 0 16 16"><path d="M6.2 1.6h3.6l.5 1.2h3.1v1.6H2.6V2.8h3.1zM3.6 5.6h8.8l-.6 8.2a1 1 0 01-1 .93H5.2a1 1 0 01-1-.93z"/></svg>
      </button>`;

    row.querySelector('.st-name').addEventListener('input', (e) => {
      st.name = e.target.value;
      scheduleSave();
    });
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'color') { openColorPicker(b, (c) => { st.color = c; renderStatusDialog(); scheduleSave(); }); return; }
      if (act === 'kind') {
        openMenu(b, STATUS_KINDS.map((k) => ({
          label: t(`status.kind_${k}`),
          selected: k === st.kind,
          onClick: () => {
            st.kind = k;
            // Вид решает, закрыта ли задача и считается ли она сделанной,
            // поэтому все задачи в этом статусе надо пересчитать — иначе
            // доска, галочки и статистика разойдутся.
            for (const task of state.tasks) if (task.statusId === st.id) setTaskStatus(task, st.id);
            renderStatusDialog();
            render();
            scheduleSave();
          },
        })));
        return;
      }
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        const other = list[j];
        if (!other) return;
        [st.order, other.order] = [other.order, st.order];
        renderStatusDialog();
        scheduleSave();
        return;
      }
      if (act === 'del') deleteStatus(st);
    });
    el.stList.appendChild(row);
  });
  applyStaticTranslations();
}

/** Удаление статуса — это всегда переезд задач: они не могут остаться без
 *  статуса. Поэтому спрашиваем, куда именно, и не даём убрать последний
 *  завершающий: иначе задачу станет нечем закрыть. */
async function deleteStatus(st) {
  const pid = st.projectId;
  const list = orderedStatuses(pid);
  if (list.length <= 1) { toast(t('status.delete_last')); return; }
  if (st.kind === 'done' && statusesOfKind(pid, 'done').length <= 1) { toast(t('status.delete_last_done')); return; }

  const target = list.find((s) => s.id !== st.id && s.kind === st.kind) || list.find((s) => s.id !== st.id);
  const moving = state.tasks.filter((t2) => t2.statusId === st.id);
  if (moving.length) {
    const ok = await confirmDialog(t('status.move_tasks', { name: target.name }));
    if (!ok) return;
  }
  for (const task of moving) setTaskStatus(task, target.id);
  state.statuses = state.statuses.filter((s) => s.id !== st.id);
  orderedStatuses(pid).forEach((s, i) => { s.order = i; });
  renderStatusDialog();
  render();
  scheduleSave();
}

function addStatus() {
  const pid = boardProjectId();
  if (!pid) return;
  const list = orderedStatuses(pid);
  state.statuses.push({
    id: uid(), projectId: pid, name: t('status.add'),
    color: PALETTE[list.length % PALETTE.length], kind: 'todo', order: list.length, builtin: false,
  });
  renderStatusDialog();
  render();
  scheduleSave();
  const last = el.stList.querySelector('.st-row:last-child .st-name');
  if (last) { last.focus(); last.select(); }
}

/** Создаёт задачу прямо в колонке доски и открывает её в проекте: название
 *  всё равно вводится в редакторе, а доска показывает только карточки. */
function newTaskInStatus(projectId, statusId) {
  const now = new Date().toISOString();
  const task = {
    id: uid(), projectId, title: '', done: false, notes: null,
    totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
    statusId, tagIds: [], versionId: null, repeat: null, cancelled: false,
    dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
  };
  setTaskStatus(task, statusId);
  state.tasks.unshift(task);
  state.ui.view = 'project';
  state.ui.projectId = projectId;
  selectedId = task.id;
  loadEditor(task);
  setTaskTab('notes');
  render();
  scheduleSave();
  el.title.focus();
}

function boardCard(task) {
  const card = document.createElement('article');
  card.className = 'board-card' + (task.done ? ' done' : '');
  card.draggable = true;
  card.dataset.id = task.id;
  const due = dueState(task);
  card.innerHTML = `
    <div class="bc-title">${escapeHtml(task.title || t('task.no_name'))}</div>
    <div class="bc-foot">
      ${task.totalMs ? `<span class="bc-time">${icon('clock')} ${fmtDur(task.totalMs)}</span>` : ''}
      ${due ? `<span class="task-due ${due}">${escapeHtml(dueShort(task))}</span>` : ''}
    </div>`;
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  // Клик по карточке открывает задачу в обычном режиме — доска для
  // раскладки, а редактор всё равно один.
  card.addEventListener('click', () => {
    state.ui.projectId = task.projectId;
    state.ui.view = 'project';
    selectedId = task.id;
    loadEditor(task);
    render();
  });
  return card;
}

function renderProjectHeader() {
  const p = getProject(state.ui.projectId);
  if (!p) return;
  el.phName.textContent = p.name;
  el.phDot.style.background = p.color || PALETTE[0];
  el.phDesc.textContent = p.description || '';
  el.phDesc.hidden = !p.description;
}

function renderFooter() {
  if (document.activeElement !== el.defaultRate) {
    el.defaultRate.value = state.settings.hourlyRate ? String(state.settings.hourlyRate) : '';
  }
  el.currency.value = state.settings.currency;
  const tasks = visibleTasks();
  el.projectEarned.textContent = tasks.length
    ? t('project.summary', { time: fmtDur(projectMs(state.ui.projectId)), money: fmtMoney(projectMoney(state.ui.projectId)) })
    : '';
}

function renderSidebar() {
  el.tfStatus.forEach((b) => b.classList.toggle('on', b.dataset.status === taskFilter.status));
  el.taskList.innerHTML = '';

  if (isFilterActive()) {
    // Фильтр активен: плоский список по фильтру, группы игнорируются
    // (но пин остаётся виден и работает у каждой задачи).
    const list = filteredProjectTasks();
    el.sidebarEmpty.hidden = list.length > 0;
    if (list.length === 0 && visibleTasks().length > 0) {
      el.sidebarEmpty.hidden = false;
      el.sidebarEmpty.innerHTML = escapeHtml(t('sidebar.no_match'));
    } else {
      el.sidebarEmpty.innerHTML = t('sidebar.empty_default');
    }
    list.forEach((t2, i) => el.taskList.appendChild(taskItem(t2, i)));
    return;
  }

  el.sidebarEmpty.innerHTML = t('sidebar.empty_default');
  const { pinned, rest, done } = sortedProjectTasks();
  el.sidebarEmpty.hidden = pinned.length + rest.length + done.length > 0;
  const multi = [pinned.length, rest.length, done.length].filter((n) => n > 0).length > 1;

  let i = 0;
  if (pinned.length) {
    if (multi) el.taskList.appendChild(taskSep(t('sep.pinned')));
    pinned.forEach((t2) => el.taskList.appendChild(taskItem(t2, i++)));
  }
  if (rest.length) {
    if (multi) el.taskList.appendChild(taskSep(t('sep.rest')));
    rest.forEach((t2) => el.taskList.appendChild(taskItem(t2, i++)));
  }
  if (done.length) {
    if (multi) el.taskList.appendChild(taskSep(t('sep.done')));
    done.forEach((t2) => el.taskList.appendChild(taskItem(t2, i++)));
  }
}

function taskSep(text) {
  const li = document.createElement('li');
  li.className = 'task-sep';
  li.textContent = text;
  return li;
}

function taskItem(task, i) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;
  li.style.animationDelay = `${Math.min(i, 12) * 16}ms`;
  if (task.id === selectedId) li.classList.add('selected');
  if (task.done) li.classList.add('done');
  if (task.pinnedAt) li.classList.add('pinned');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'task-done';
  cb.checked = !!task.done;
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => {
    setTaskDone(task, cb.checked);
    li.classList.toggle('done', task.done);
    renderStats();
    scheduleSave();
  });

  const name = document.createElement('span');
  name.className = 'task-name';
  name.textContent = task.title || t('task.no_name');

  const pin = document.createElement('button');
  pin.className = 'task-pin';
  pin.innerHTML = icon('pin');
  pin.title = task.pinnedAt ? t('task.unpin_short') : t('task.pin_short');
  pin.addEventListener('click', (e) => { e.stopPropagation(); togglePinTask(task.id); });

  const top = document.createElement('div');
  top.className = 'ti-top';
  top.append(cb, name, pin);

  const bottom = document.createElement('div');
  bottom.className = 'ti-bottom';
  // Статус в списке: галочка отвечает только на «закончена или нет», а в
  // каком именно состоянии задача — видно было лишь на доске.
  const st = getStatus(task.statusId);
  if (st) {
    const chip = document.createElement('span');
    chip.className = 'task-status';
    chip.style.setProperty('--sc', st.color);
    chip.innerHTML = `<span class="st-swatch"></span>${escapeHtml(st.name)}`;
    bottom.appendChild(chip);
  }
  const ds = dueState(task);
  if (ds) {
    const badge = document.createElement('span');
    badge.className = `task-due ${ds}`;
    badge.textContent = dueShort(task);
    bottom.appendChild(badge);
  }
  if (state.activeTimer && state.activeTimer.taskId === task.id) {
    const dot = document.createElement('span');
    dot.className = 'running-dot';
    dot.textContent = '●';
    bottom.appendChild(dot);
  }
  const time = document.createElement('span');
  time.className = 'task-time';
  time.textContent = fmtShort(taskElapsedMs(task));
  bottom.appendChild(time);

  li.append(top, bottom);
  li.addEventListener('click', () => selectTask(task.id));
  return li;
}

// ---------------------------------------------------------------------------
// Деталь задачи
// ---------------------------------------------------------------------------

/** Строки «Срок» и «Напомнить» под ставкой. Время срока показывается
 *  только когда сама дата задана — до этого показывать «00:00» не о чем. */
/** Лента уведомлений собирается из задач на лету, отдельного хранилища у
 *  неё нет: просроченные, те, чей срок в пределах суток, и те, у кого уже
 *  сработало напоминание. Непрочитанным считается то, чей момент
 *  наступил позже последнего открытия панели (ui.notifSeenAt). */
function notificationFeed() {
  const now = Date.now();
  const seen = state.ui.notifSeenAt ? new Date(state.ui.notifSeenAt).getTime() : 0;
  const out = [];
  for (const task of state.tasks) {
    if (task.done || !task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    const rt = reminderTime(task);
    const fired = !!rt && rt.getTime() <= now;
    let kind = null;
    let at = due;
    if (due < now) kind = 'overdue';
    else if (due - now <= 86400000) { kind = 'soon'; at = due - 86400000; }
    else if (fired) { kind = 'reminder'; at = rt.getTime(); }
    if (!kind) continue;
    out.push({ task, kind, at, due, unread: at > seen });
  }
  return out.sort((a, b) => a.due - b.due);
}

function renderNotifBadge() {
  const unread = notificationFeed().filter((n) => n.unread).length;
  el.notifBadge.hidden = unread === 0;
  el.notifBadge.textContent = unread > 99 ? '99+' : String(unread);
}

function renderNotifPanel() {
  const feed = notificationFeed();
  el.notifList.innerHTML = '';
  el.notifEmpty.hidden = feed.length > 0;
  for (const n of feed) {
    const p = getProject(n.task.projectId);
    const li = document.createElement('li');
    if (n.unread) li.classList.add('unread');
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    const when = n.kind === 'overdue' ? 'overdue' : n.kind === 'soon' ? 'soon' : '';
    li.innerHTML = `<span class="notif-dot"></span>`
      + `<span class="notif-main"><span class="notif-name">${escapeHtml(n.task.title || t('task.no_name'))}</span>`
      + `<span class="notif-sub">${escapeHtml(t(`notif.${n.kind}`))} · ${escapeHtml(p ? p.name : '')}</span></span>`
      + `<span class="notif-when ${when}">${escapeHtml(dueShort(n.task))}</span>`;
    li.addEventListener('click', () => { closeNotifPanel(); openProject(n.task.projectId); selectTask(n.task.id); });
    el.notifList.appendChild(li);
  }
}

function markNotifSeen() {
  state.ui.notifSeenAt = new Date().toISOString();
  renderNotifBadge();
  renderNotifPanel();
  scheduleSave();
}
function closeNotifPanel() {
  el.notifPanel.hidden = true;
  el.notifBtn.classList.remove('on');
}
function toggleNotifPanel() {
  if (!el.notifPanel.hidden) { closeNotifPanel(); return; }
  renderNotifPanel();
  el.notifPanel.hidden = false;
  el.notifBtn.classList.add('on');
  // Колокольчик стоит у поиска, а не у края экрана, поэтому панель
  // выравнивается по нему, а не по правому краю окна.
  const r = el.notifBtn.getBoundingClientRect();
  const w = el.notifPanel.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  el.notifPanel.style.left = `${Math.round(left)}px`;
  el.notifPanel.style.top = `${Math.round(r.bottom + 6)}px`;
  markNotifSeen();
}

/** Системное уведомление. В Electron разрешение выдано по умолчанию, в
 *  браузере его спрашивают один раз; отказ просто гасит эту ветку —
 *  внутренняя лента работает в любом случае. */
function ensureNotifPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function notifyOS(title, body) {
  try {
    if (state.settings.notifyEnabled === false) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body });
  } catch (err) { console.warn('Не удалось показать системное уведомление:', err); }
}

/** Раз в полминуты проверяем, не пора ли напомнить. notifiedAt пишется в
 *  саму задачу и синхронизируется, поэтому второе устройство про эту же
 *  задачу молчит. */
function checkReminders() {
  const now = Date.now();
  let fired = false;
  for (const task of state.tasks) {
    if (task.done || task.notifiedAt) continue;
    const rt = reminderTime(task);
    if (!rt || rt.getTime() > now) continue;
    task.notifiedAt = new Date().toISOString();
    fired = true;
    notifyOS(t('notif.reminder'), task.title || t('task.no_name'));
  }
  if (fired) scheduleSave();
  renderNotifBadge();
}

function renderDue(task) {
  const has = !!task.dueAt;
  const due = has ? new Date(task.dueAt) : null;
  el.dueDateBtn.textContent = has ? fmtDpBtn(dayKey(due)) : t('due.set');
  el.dueDateBtn.classList.toggle('is-empty', !has);
  el.dueDateBtn.classList.toggle('muted-btn', !has);
  el.dueTimeBtn.hidden = !has;
  if (has) el.dueTimeBtn.textContent = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
  el.dueClearBtn.hidden = !has;
  el.dueRemind.hidden = !has;

  const state2 = dueState(task);
  el.dueState.hidden = !state2 || state2 === 'later';
  el.dueState.className = `due-state ${state2 || ''}`;
  if (!el.dueState.hidden) el.dueState.textContent = dueShort(task);

  const isCustom = (task.remindOffsetMin === null || task.remindOffsetMin === undefined) && !!task.remindAt;
  el.dueRemind.textContent = t(REMIND_LABEL[remindKey(task)]);
  el.dueCustomRow.hidden = !has || !isCustom;
  if (isCustom) {
    const r = new Date(task.remindAt);
    el.remindDateBtn.textContent = fmtDpBtn(dayKey(r));
    el.remindTimeBtn.textContent = `${pad2(r.getHours())}:${pad2(r.getMinutes())}`;
  }
}

function renderDetail() {
  const task = getTask(selectedId);
  const hasTask = !!task && task.projectId === state.ui.projectId;
  el.emptyState.hidden = hasTask;
  el.detail.hidden = !hasTask;
  if (!hasTask) return;

  if (document.activeElement !== el.title) el.title.value = task.title || '';
  el.pinTaskBtn.classList.toggle('on', !!task.pinnedAt);
  el.pinTaskBtn.title = task.pinnedAt ? t('task.unpin_title') : t('task.pin_title');
  el.exportTaskBtn.disabled = !(task.sessions && task.sessions.length);

  renderTimer(task);
  renderTaskStatus(task);
  renderMoney(task);
  renderDue(task);
  renderSessions(task);
}

/** Статус задачи в редакторе. До этого поменять его можно было только
 *  перетаскиванием на доске — здесь он рядом со ставкой и сроком, среди
 *  остальных параметров задачи. */
function renderTaskStatus(task) {
  const cur = getStatus(task.statusId);
  el.taskStatus.textContent = cur ? cur.name : t('due.none');
  el.taskStatusDot.style.setProperty('--sc', cur ? cur.color : 'transparent');
}

function renderMoney(task) {
  const own = hasOwnRate(task);
  if (document.activeElement !== el.taskRate) el.taskRate.value = own ? String(task.rate) : '';
  const def = Number(state.settings.hourlyRate) || 0;
  el.taskRate.placeholder = def ? String(def) : '0';
  // Без пометки «по умолчанию»: ставка по умолчанию задаётся в настройках, и
  // повторять это в каждой задаче незачем — строка только удлинялась.
  el.rateUnit.textContent = `${currencySym()}${t('rate.per_hour')}`;

  const rate = effectiveRate(task);
  const ms = taskElapsedMs(task);
  const mins = Math.round(ms / 60000);
  const minWord = { ru: 'мин', en: 'min', uk: 'хв', kk: 'мин' }[lang()] || 'мин';
  const time = mins < 60 ? `${mins} ${minWord}` : fmtShort(ms);
  el.moneyCalc.innerHTML = rate
    ? `${t('money.calc', { time, rate: moneyFmt().format(rate), cur: currencySym() })} <b>${fmtMoney(earnedOf(task))}</b>`
    : t('money.no_rate');
}

function renderTimer(task) {
  const running = state.activeTimer && state.activeTimer.taskId === task.id;
  el.timerDisplay.textContent = fmtClock(taskElapsedMs(task));
  el.timerBtnIcon.textContent = running ? '■' : '▶';
  el.timerBtnLabel.textContent = running ? t('timer.stop') : t('timer.start');
  el.timerBtn.classList.toggle('running', running);
  if (running) {
    const sessionMs = Date.now() - new Date(state.activeTimer.startedAt).getTime();
    el.timerSub.textContent = t('timer.recording', { time: fmtClock(sessionMs) });
  } else if (state.activeTimer) {
    el.timerSub.textContent = t('timer.other_task');
  } else {
    el.timerSub.textContent = t('timer.sub_default');
  }
}

function renderSessions(task) {
  const sessions = task.sessions || [];
  el.sessionCount.textContent = String(sessions.length);
  el.sessionEmpty.hidden = sessions.length > 0;
  el.sessionList.innerHTML = '';

  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    const li = document.createElement('li');
    li.className = 'session-item';

    const when = document.createElement('span');
    when.className = 'session-when';
    when.title = t('session.edit_title');
    let tag = '';
    if (s.recovered) tag = t('session.recovered');
    else if (s.manual) tag = t('session.manual');
    when.textContent = fmtWhen(s.start) + tag;
    when.addEventListener('click', () => openSessionDialog(task, i));

    const right = document.createElement('span');
    right.style.cssText = 'display:flex;align-items:center;gap:8px';

    const dur = document.createElement('span');
    dur.className = 'session-dur';
    dur.textContent = fmtClock(s.ms);

    const del = document.createElement('button');
    del.className = 'session-del';
    del.innerHTML = icon('x');
    del.title = t('session.delete_title');
    del.addEventListener('click', () => {
      task.totalMs = Math.max(0, (task.totalMs || 0) - s.ms);
      task.sessions.splice(i, 1);
      task.updatedAt = new Date().toISOString();
      scheduleSave();
      render();
    });

    right.append(dur, del);
    li.append(when, right);
    el.sessionList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Действия с задачами
// ---------------------------------------------------------------------------

let activeTaskTab = 'notes';
function setTaskTab(tab) {
  activeTaskTab = tab;
  el.taskTabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  el.tabNotes.hidden = tab !== 'notes';
  el.tabSettings.hidden = tab !== 'settings';
  el.tabHistory.hidden = tab !== 'history';
}

function selectTask(id) {
  if (id === selectedId && state.ui.view === 'project') return;
  flushEditor();
  selectedId = id;
  const task = getTask(id);
  loadEditor(task);
  setTaskTab('notes');
  render();
  if (state.ui.view === 'project') {
    el.title.focus({ preventScroll: true });
    if (task && !task.title) el.title.select();
  }
}

function newTask() {
  if (!state.ui.projectId || state.ui.view !== 'project') return;
  flushEditor();
  const now = new Date().toISOString();
  const task = {
    id: uid(), projectId: state.ui.projectId, title: '', done: false, notes: null,
    totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
    // Статус проставляется здесь, а не только в migrate(): та правит уже
    // сохранённые данные при загрузке и до новой задачи в этой же сессии не
    // доберётся — задача осталась бы без статуса и не попала ни в один
    // столбец доски.
    statusId: defaultStatusId(state.ui.projectId, false), tagIds: [], versionId: null, repeat: null, cancelled: false,
  };
  state.tasks.unshift(task);
  selectedId = task.id;
  loadEditor(task);
  setTaskTab('notes');
  render();
  scheduleSave();
  el.title.focus();
}

async function deleteTask(id) {
  const task = getTask(id);
  if (!task) return;
  const ok = await confirmDialog(task.title ? t('confirm.delete_task_named', { name: task.title }) : t('confirm.delete_task'));
  if (!ok) return;
  if (state.activeTimer && state.activeTimer.taskId === id) state.activeTimer = null;
  state.tasks = state.tasks.filter((t2) => t2.id !== id);
  if (selectedId === id) {
    const next = sortedProjectTasks().all[0];
    selectedId = next ? next.id : null;
    loadEditor(getTask(selectedId));
  }
  render();
  scheduleSave();
}

function togglePinTask(id) {
  const t2 = getTask(id);
  if (!t2) return;
  t2.pinnedAt = t2.pinnedAt ? null : new Date().toISOString();
  t2.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------

function openProject(id) {
  const p = getProject(id);
  if (!p) return;
  flushEditor();
  closeMenu();
  closeSearch();
  taskFilter = { status: 'all' };
  state.ui.view = 'project';
  state.ui.projectId = id;
  const first = sortedProjectTasks().all[0];
  selectedId = first ? first.id : null;
  loadEditor(getTask(selectedId));
  render();
  scheduleSave();
}

function backHome() {
  flushEditor();
  closeMenu();
  state.ui.view = 'home';
  render();
  scheduleSave();
}

function togglePinProject(id) {
  const p = getProject(id);
  if (!p) return;
  p.pinnedAt = p.pinnedAt ? null : new Date().toISOString();
  render();
  scheduleSave();
}

async function deleteProject(id) {
  const project = getProject(id);
  if (!project) return;
  const n = tasksOf(id).length;
  const msg = n
    ? t('confirm.delete_project_with_tasks', { name: project.name, n, plural: pluralForm(n, 'plural.task') })
    : t('confirm.delete_project', { name: project.name });
  const ok = await confirmDialog(msg);
  if (!ok) return;
  const activeTask = state.activeTimer && getTask(state.activeTimer.taskId);
  if (activeTask && activeTask.projectId === id) state.activeTimer = null;
  state.tasks = state.tasks.filter((t2) => t2.projectId !== id);
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.ui.projectId === id) {
    state.ui.view = 'home';
    state.ui.projectId = state.projects[0] ? state.projects[0].id : null;
    selectedId = null;
    loadEditor(null);
  }
  render();
  scheduleSave();
}

async function copyProjectSummary(p) {
  const tasks = tasksOf(p.id);
  const done = tasks.filter((t2) => t2.done).length;
  const n = tasks.length;
  const parts = [p.name, fmtDur(projectMs(p.id)), `${n} ${pluralForm(n, 'plural.task')}, ${done} ${t('xlsx.done').toLowerCase()}`];
  const money = projectMoney(p.id);
  if (money > 0) parts.push(fmtMoney(money));
  try { await window.api.copy(parts.join(' · ')); toast(t('toast.summary_copied')); }
  catch { toast(t('toast.copy_failed')); }
}

// ---------------------------------------------------------------------------
// Плавающее меню
// ---------------------------------------------------------------------------

let menuCleanup = null;
function openMenu(anchor, items) {
  closeMenu();
  const m = el.ctxMenu;
  m.innerHTML = '';
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); continue; }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.selected ? ' sel' : '');
    b.innerHTML = `<span>${escapeHtml(it.label)}</span>` +
      (it.selected ? `<svg class="icon ctx-check" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS.check}"/></svg>` : '');
    b.addEventListener('click', () => { closeMenu(); it.onClick(); });
    m.appendChild(b);
  }
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const x = Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8);
  let y = r.bottom + 4;
  if (y + m.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - m.offsetHeight - 4);
  m.style.left = `${Math.max(8, x)}px`;
  m.style.top = `${y}px`;
  anchor.classList.add('open');
  const onDown = (e) => { if (!m.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
  }, 0);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
    anchor.classList.remove('open');
  };
}
function closeMenu() {
  el.ctxMenu.hidden = true;
  if (menuCleanup) { menuCleanup(); menuCleanup = null; }
}

function openProjectMenu(p, anchor) {
  const inProject = state.ui.view === 'project' && state.ui.projectId === p.id;
  const items = [];
  if (!inProject) items.push({ label: t('project.open'), onClick: () => openProject(p.id) });
  items.push({ label: t('project.edit'), onClick: () => openProjectDialog(p) });
  // Закрепление здесь больше не дублируется — для него есть своя кнопка на
  // карточке, слева от этого меню.
  items.push({ sep: true });
  items.push({ label: t('project.excel'), onClick: () => exportProjectById(p.id) });
  items.push({ label: t('project.copy_summary'), onClick: () => copyProjectSummary(p) });
  items.push({ sep: true });
  items.push({ label: t('project.delete'), danger: true, onClick: () => deleteProject(p.id) });
  openMenu(anchor, items);
}

// ---------------------------------------------------------------------------
// Диалог проекта
// ---------------------------------------------------------------------------

const pdlg = { editing: null, color: PALETTE[0] };

function openProjectDialog(project) {
  pdlg.editing = project || null;
  pdlg.color = project ? (project.color || PALETTE[0]) : PALETTE[state.projects.length % PALETTE.length];
  el.pdlgTitle.textContent = project ? t('project.edit_title') : t('project.new_title');
  el.pdlgName.value = project ? project.name : '';
  el.pdlgDesc.value = project ? (project.description || '') : '';
  buildSwatches();
  el.pdlgBackdrop.hidden = false;
  el.pdlgName.focus();
  el.pdlgName.select();
}
function buildSwatches() {
  el.pdlgSwatches.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c === pdlg.color ? ' sel' : '');
    b.style.background = c;
    b.addEventListener('click', () => { pdlg.color = c; buildSwatches(); });
    el.pdlgSwatches.appendChild(b);
  }
}
function closeProjectDialog() { el.pdlgBackdrop.hidden = true; }
function saveProjectDialog() {
  const name = el.pdlgName.value.trim();
  if (!name) { el.pdlgName.focus(); return; }
  const description = el.pdlgDesc.value.trim();
  if (pdlg.editing) {
    Object.assign(pdlg.editing, { name, description, color: pdlg.color });
    closeProjectDialog();
    render();
    scheduleSave();
  } else {
    const p = { id: uid(), name, description, color: pdlg.color, createdAt: new Date().toISOString(), pinnedAt: null, tagIds: [] };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    closeProjectDialog();
    openProject(p.id);
  }
}

// ---------------------------------------------------------------------------
// Диалог записи времени (свои дата/время-пикеры вместо системных)
// ---------------------------------------------------------------------------

const sdlg = { task: null, index: null, date: '', start: '', end: '' };

function updateSdlgButtons() {
  el.sdlgDateBtn.textContent = fmtDpBtn(sdlg.date);
  el.sdlgStartBtn.textContent = sdlg.start;
  el.sdlgEndBtn.textContent = sdlg.end;
}

function openSessionDialog(task, index) {
  if (!task) return;
  sdlg.task = task;
  sdlg.index = index;
  const s = index != null ? task.sessions[index] : null;
  const start = s ? new Date(s.start) : new Date(Date.now() - 3_600_000);
  const end = s && s.end ? new Date(s.end) : new Date();
  el.sdlgTitle.textContent = s ? t('sdlg.edit_title') : t('sdlg.add_title');
  sdlg.date = dayKey(start);
  sdlg.start = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  sdlg.end = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
  updateSdlgButtons();
  updateSdlgDur();
  el.sdlgBackdrop.hidden = false;
}
function sdlgTimes() {
  const dparts = (sdlg.date || '').split('-').map(Number);
  const sp = (sdlg.start || '').split(':').map(Number);
  const ep = (sdlg.end || '').split(':').map(Number);
  if (dparts.length !== 3 || sp.length < 2 || ep.length < 2 || dparts.some(Number.isNaN)) return null;
  const start = new Date(dparts[0], dparts[1] - 1, dparts[2], sp[0], sp[1]);
  let end = new Date(dparts[0], dparts[1] - 1, dparts[2], ep[0], ep[1]);
  if (end <= start) end = new Date(end.getTime() + 24 * 3_600_000);
  return { start, end, ms: end - start };
}
function updateSdlgDur() {
  const tm = sdlgTimes();
  el.sdlgDur.textContent = tm ? t('sdlg.duration', { time: fmtClock(tm.ms) }) : t('sdlg.check_datetime');
}
function closeSessionDialog() { el.sdlgBackdrop.hidden = true; closeDatePicker(); closeTimePicker(); }
function saveSessionDialog() {
  const tm = sdlgTimes();
  if (!tm || tm.ms < 60_000) { toast(t('toast.invalid_interval')); return; }
  const task = sdlg.task;
  const entry = { start: tm.start.toISOString(), end: tm.end.toISOString(), ms: tm.ms, rate: effectiveRate(task), manual: true };
  if (sdlg.index != null && task.sessions[sdlg.index]) {
    const old = task.sessions[sdlg.index];
    if (Number.isFinite(Number(old.rate))) entry.rate = Number(old.rate);
    task.totalMs = Math.max(0, (task.totalMs || 0) - old.ms + tm.ms);
    task.sessions[sdlg.index] = entry;
  } else {
    task.sessions = task.sessions || [];
    task.sessions.push(entry);
    task.totalMs = (task.totalMs || 0) + tm.ms;
  }
  task.updatedAt = new Date().toISOString();
  closeSessionDialog();
  render();
  scheduleSave();
}

el.sdlgDateBtn.addEventListener('click', () => openDatePicker(el.sdlgDateBtn, sdlg.date, (key) => {
  sdlg.date = key; updateSdlgButtons(); updateSdlgDur();
}));
el.sdlgStartBtn.addEventListener('click', () => openTimePicker(el.sdlgStartBtn, sdlg.start, (val) => {
  sdlg.start = val; updateSdlgButtons(); updateSdlgDur();
}));
el.sdlgEndBtn.addEventListener('click', () => openTimePicker(el.sdlgEndBtn, sdlg.end, (val) => {
  sdlg.end = val; updateSdlgButtons(); updateSdlgDur();
}));

// ---------------------------------------------------------------------------
// Выгрузка в Excel
// ---------------------------------------------------------------------------

const cellBold = (txt) => ({ t: txt, s: 1 });
const cellHours = (n) => ({ n, s: 2 });
const sortByStart = (a, b) => new Date(a.start || a.s.start) - new Date(b.start || b.s.start);

function buildTaskSheets(task) {
  const project = getProject(task.projectId);
  const sessions = [...(task.sessions || [])].sort(sortByStart);
  const totalMs = task.totalMs || 0;
  const cur = currencySym();
  const totalMoney = sessions.reduce((a, s) => a + sessionMoney(s, task), 0);
  const rows = [
    [cellBold(t('xlsx.task')), task.title || t('xlsx.no_title')],
    [cellBold(t('xlsx.project')), project ? project.name : t('xlsx.no_project')],
    [cellBold(t('xlsx.total_time')), fmtClock(totalMs), cellHours(hoursOf(totalMs))],
    [cellBold(t('xlsx.sessions')), sessions.length],
    [cellBold(t('xlsx.rate_now', { cur })), cellHours(effectiveRate(task))],
    [cellBold(t('xlsx.earned', { cur })), cellHours(totalMoney)],
    [cellBold(t('xlsx.exported')), `${fmtDate(Date.now())} ${fmtTime(Date.now())}`],
    [],
    [t('xlsx.num'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'), t('xlsx.duration'), t('xlsx.hours'),
      t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold),
  ];
  const firstRow = rows.length + 1;
  sessions.forEach((s, i) => {
    rows.push([
      i + 1, fmtDate(s.start), fmtTime(s.start), s.end ? fmtTime(s.end) : '',
      fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, task)),
      cellHours(sessionMoney(s, task)), s.recovered ? t('xlsx.recovered') : s.manual ? t('xlsx.manual') : '',
    ]);
  });
  const lastRow = firstRow + sessions.length - 1;
  rows.push([
    cellBold(t('xlsx.total')), '', '', '', fmtClock(sessions.reduce((a, s) => a + s.ms, 0)),
    sessions.length ? { f: `SUM(F${firstRow}:F${lastRow})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
    sessions.length ? { f: `SUM(H${firstRow}:H${lastRow})`, n: totalMoney, s: 2 } : cellHours(0),
  ]);
  return [{ name: task.title || t('xlsx.default_task_sheet'), cols: [6, 12, 10, 10, 14, 9, 12, 12, 14].map((width) => ({ width })), rows }];
}

function buildProjectSheets(project) {
  const tasks = tasksOf(project.id);
  const stamp = `${fmtDate(Date.now())} ${fmtTime(Date.now())}`;
  const cur = currencySym();
  const taskMoney = (t2) => (t2.sessions || []).reduce((a, s) => a + sessionMoney(s, t2), 0);
  const taskRows = [
    [cellBold(t('xlsx.project')), project.name],
    project.description ? [cellBold(t('xlsx.description')), project.description] : [],
    [cellBold(t('xlsx.exported')), stamp],
    [],
    [t('xlsx.num'), t('xlsx.task'), t('xlsx.status'), t('xlsx.total_time'), t('xlsx.hours'), t('xlsx.sum', { cur }),
      t('xlsx.rate', { cur }), t('xlsx.sessions'), t('xlsx.first_entry'), t('xlsx.last_entry')].map(cellBold),
  ];
  const tFirst = taskRows.length + 1;
  tasks.forEach((t2, i) => {
    const starts = (t2.sessions || []).map((s) => new Date(s.start).getTime());
    taskRows.push([
      i + 1, t2.title || t('xlsx.no_title'), t2.done ? t('xlsx.done') : t('xlsx.active'),
      fmtClock(t2.totalMs || 0), cellHours(hoursOf(t2.totalMs || 0)),
      cellHours(taskMoney(t2)), cellHours(effectiveRate(t2)),
      (t2.sessions || []).length,
      starts.length ? fmtDate(Math.min(...starts)) : '', starts.length ? fmtDate(Math.max(...starts)) : '',
    ]);
  });
  const tLast = tFirst + tasks.length - 1;
  const totalMs = tasks.reduce((a, t2) => a + (t2.totalMs || 0), 0);
  const totalMoney = tasks.reduce((a, t2) => a + taskMoney(t2), 0);
  taskRows.push([
    cellBold(t('xlsx.total')), '', '', fmtClock(totalMs),
    tasks.length ? { f: `SUM(E${tFirst}:E${tLast})`, n: hoursOf(totalMs), s: 2 } : cellHours(0),
    tasks.length ? { f: `SUM(F${tFirst}:F${tLast})`, n: totalMoney, s: 2 } : cellHours(0), '',
    tasks.reduce((a, t2) => a + (t2.sessions ? t2.sessions.length : 0), 0),
  ]);
  const all = [];
  for (const t2 of tasks) for (const s of t2.sessions || []) all.push({ t: t2, s });
  all.sort((a, b) => new Date(a.s.start) - new Date(b.s.start));
  const sesRows = [
    [t('xlsx.num'), t('xlsx.task'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'), t('xlsx.duration'),
      t('xlsx.hours'), t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold),
  ];
  all.forEach(({ t: t2, s }, i) => {
    sesRows.push([
      i + 1, t2.title || t('xlsx.no_title'), fmtDate(s.start), fmtTime(s.start),
      s.end ? fmtTime(s.end) : '', fmtClock(s.ms), cellHours(hoursOf(s.ms)),
      cellHours(sessionRate(s, t2)), cellHours(sessionMoney(s, t2)),
      s.recovered ? t('xlsx.recovered') : s.manual ? t('xlsx.manual') : '',
    ]);
  });
  const sesTotalMs = all.reduce((a, x) => a + x.s.ms, 0);
  const sesTotalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.t), 0);
  sesRows.push([
    cellBold(t('xlsx.total')), '', '', '', '', fmtClock(sesTotalMs),
    all.length ? { f: `SUM(G2:G${all.length + 1})`, n: hoursOf(sesTotalMs), s: 2 } : cellHours(0), '',
    all.length ? { f: `SUM(I2:I${all.length + 1})`, n: sesTotalMoney, s: 2 } : cellHours(0),
  ]);
  return [
    { name: t('xlsx.sheet_tasks'), cols: [6, 34, 12, 14, 9, 12, 12, 8, 14, 16].map((width) => ({ width })), rows: taskRows },
    { name: t('xlsx.sheet_sessions'), cols: [6, 34, 12, 10, 10, 14, 9, 12, 12, 16].map((width) => ({ width })), rows: sesRows },
  ];
}

/** Сводка по всем проектам: первый лист — итоги по каждому проекту,
 *  дальше по листу на проект. Порт buildAllProjectsSheets() из
 *  mobile/src/lib/xlsxReports.js. Имена листов Excel ограничены 31
 *  символом и не терпят []:*?/\\, плюс не могут повторяться — отсюда
 *  uniqueName(). */
function buildAllProjectsSheets() {
  const cur = currencySym();
  const stamp = `${fmtDate(Date.now())} ${fmtTime(Date.now())}`;
  const rows = [
    [cellBold(t('xlsx.exported')), stamp],
    [],
    [t('xlsx.num'), t('xlsx.project'), t('xlsx.total_time'), t('xlsx.hours'), t('xlsx.sum', { cur }), t('xlsx.sessions')].map(cellBold),
  ];
  const first = rows.length + 1;
  let grandMs = 0;
  let grandMoney = 0;
  let grandSessions = 0;
  state.projects.forEach((project, i) => {
    const tasks = tasksOf(project.id);
    const ms = tasks.reduce((a, t2) => a + (t2.totalMs || 0), 0);
    const money = tasks.reduce((a, t2) => a + (t2.sessions || []).reduce((b, ses) => b + sessionMoney(ses, t2), 0), 0);
    const count = tasks.reduce((a, t2) => a + (t2.sessions ? t2.sessions.length : 0), 0);
    grandMs += ms; grandMoney += money; grandSessions += count;
    rows.push([i + 1, project.name, fmtClock(ms), cellHours(hoursOf(ms)), cellHours(money), count]);
  });
  const last = first + state.projects.length - 1;
  rows.push([
    cellBold(t('xlsx.total')), '', fmtClock(grandMs),
    state.projects.length ? { f: `SUM(D${first}:D${last})`, n: hoursOf(grandMs), s: 2 } : cellHours(0),
    state.projects.length ? { f: `SUM(E${first}:E${last})`, n: grandMoney, s: 2 } : cellHours(0),
    grandSessions,
  ]);
  const used = new Set();
  const uniqueName = (raw) => {
    const base = (raw || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || t('xlsx.default_task_sheet');
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base} ${n++}`;
    used.add(name);
    return name;
  };
  const sheets = [{ name: uniqueName(t('xlsx.sheet_tasks')), cols: [6, 34, 14, 9, 12, 10].map((width) => ({ width })), rows }];
  for (const project of state.projects) {
    const [tasksSheet] = buildProjectSheets(project);
    sheets.push({ ...tasksSheet, name: uniqueName(project.name) });
  }
  return sheets;
}

/** Один лист «Сессии» за произвольный промежуток — для выгрузки из
 *  календаря. Порт buildPeriodSheets() из mobile/src/lib/xlsxReports.js;
 *  в отличие от buildProjectSheets он не привязан к проекту и собирает
 *  сессии всех задач, добавляя колонку с названием проекта. */
function buildPeriodSheets(from, to) {
  const cur = currencySym();
  const all = allSessionPairs()
    .filter(({ s }) => { const d = new Date(s.start); return d >= from && d <= to; })
    .sort((a, b) => new Date(a.s.start) - new Date(b.s.start));
  const rows = [
    [t('xlsx.num'), t('xlsx.task'), t('xlsx.project'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'),
      t('xlsx.duration'), t('xlsx.hours'), t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold),
  ];
  all.forEach(({ t: t2, s }, i) => {
    const p = getProject(t2.projectId);
    rows.push([
      i + 1, t2.title || t('xlsx.no_title'), p ? p.name : t('xlsx.no_project'),
      fmtDate(s.start), fmtTime(s.start), s.end ? fmtTime(s.end) : '',
      fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, t2)),
      cellHours(sessionMoney(s, t2)), s.recovered ? t('xlsx.recovered') : s.manual ? t('xlsx.manual') : '',
    ]);
  });
  const totalMs = all.reduce((a, x) => a + x.s.ms, 0);
  const totalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.t), 0);
  rows.push([
    cellBold(t('xlsx.total')), '', '', '', '', '', fmtClock(totalMs),
    all.length ? { f: `SUM(H2:H${all.length + 1})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
    all.length ? { f: `SUM(J2:J${all.length + 1})`, n: totalMoney, s: 2 } : cellHours(0),
  ]);
  return [{ name: t('xlsx.sheet_sessions').slice(0, 31), cols: [6, 30, 24, 12, 10, 10, 14, 9, 12, 12, 16].map((width) => ({ width })), rows }];
}

async function runExport(defaultName, sheets) {
  try {
    const res = await window.api.exportXlsx({ defaultName, sheets });
    if (res && res.ok) toast(t('toast.file_saved'));
    else if (res && res.error) toast(t('toast.save_failed', { err: res.error }));
  } catch (err) { console.error(err); toast(t('toast.export_failed')); }
}
function exportTask() {
  const task = getTask(selectedId);
  if (!task) return;
  const project = getProject(task.projectId);
  runExport(`${project ? project.name : t('export.project_fallback')} — ${task.title || t('export.task_fallback')} — ${fmtDate(Date.now())}`, buildTaskSheets(task));
}
function exportProjectById(id) {
  const p = getProject(id);
  if (!p) return;
  runExport(`${p.name} — ${t('export.all_tasks')} — ${fmtDate(Date.now())}`, buildProjectSheets(p));
}
/** Выбор периода выгрузки — то же, что лист ExportPeriodSheet в мобильном:
 *  пресеты плюс «Свой» с двумя датами. «Всё время» уходит в сводку по всем
 *  проектам (buildAllProjectsSheets), остальные — в лист сессий за диапазон
 *  (buildPeriodSheets), ровно как решает onExportRange на мобилке. */
// Порядок и разбивка строк — как в мобильном приложении: 3 сверху, 4 снизу.
const EXPORT_PRESET_ROWS = [['all', 'day', 'week'], ['month', 'half_year', 'year', 'custom']];
const EXPORT_PRESETS = EXPORT_PRESET_ROWS.flat();
const expdlg = { preset: 'all', from: null, to: null, picking: false, view: new Date() };

function expdlgRange() {
  const now = new Date();
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  if (expdlg.preset === 'all') return null;
  if (expdlg.preset === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (expdlg.preset === 'week') { const ws = mondayOf(now); return [ws, endOfDay(new Date(ws.getTime() + 6 * 86400000))]; }
  if (expdlg.preset === 'day') return [new Date(now.getFullYear(), now.getMonth(), now.getDate()), endOfDay(now)];
  if (expdlg.preset === 'half_year') return [new Date(now.getFullYear(), now.getMonth() - 5, 1), endOfDay(now)];
  if (expdlg.preset === 'year') return [new Date(now.getFullYear(), now.getMonth() - 11, 1), endOfDay(now)];
  let a = keyToDate(expdlg.from);
  let b = keyToDate(expdlg.to);
  if (a > b) [a, b] = [b, a];
  return [a, endOfDay(b)];
}

function renderExpdlg() {
  // Пресеты — сеткой 3 + 4 на одной подложке, как в мобильном приложении.
  // В одну строку семь вариантов не помещаются читаемо, а списком они
  // занимали бы пол-модалки.
  el.expPills.innerHTML = '';
  for (const row of EXPORT_PRESET_ROWS) {
    const line = document.createElement('div');
    line.className = 'exp-tab-row';
    for (const p of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exp-tab' + (p === expdlg.preset ? ' on' : '');
      b.textContent = t(`export.period_${p}`);
      b.addEventListener('click', () => { expdlg.preset = p; renderExpdlg(); });
      line.appendChild(b);
    }
    el.expPills.appendChild(line);
  }
  el.expRange.hidden = expdlg.preset !== 'custom';
  el.expFrom.textContent = fmtDpBtn(expdlg.from);
  el.expTo.textContent = fmtDpBtn(expdlg.to);
  // Подсвечена та граница, которую задаст следующий клик по календарю.
  el.expFrom.classList.toggle('active', !expdlg.picking);
  el.expTo.classList.toggle('active', !!expdlg.picking);
  if (expdlg.preset === 'custom') renderExpCal();
}

/** Календарь внутри модалки экспорта: он всегда на виду, а не выскакивает
 *  поверх неё по клику на поле. Диапазон набирается двумя кликами прямо по
 *  сетке — первый задаёт начало, второй конец, — и подсвечивается целиком. */
function renderExpCal() {
  const y = expdlg.view.getFullYear();
  const m = expdlg.view.getMonth();
  el.expCalTitle.textContent = monthLabel(y, m);
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  const todayKey = dayKey(new Date());
  let [lo, hi] = [expdlg.from, expdlg.to];
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];

  el.expCalDays.innerHTML = '';
  for (const d of cells) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-day';
    if (d == null) { b.classList.add('empty'); b.disabled = true; el.expCalDays.appendChild(b); continue; }
    const key = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (key === todayKey) b.classList.add('today');
    if (key === lo || key === hi) b.classList.add('sel');
    else if (lo && hi && key > lo && key < hi) b.classList.add('in-range');
    b.textContent = String(d);
    b.addEventListener('click', () => { pickExpDay(key); });
    el.expCalDays.appendChild(b);
  }
}

/** Первый клик задаёт начало и сбрасывает конец, второй — конец. Если второй
 *  клик пришёлся раньше первого, границы меняются местами, а не игнорируются. */
function pickExpDay(key) {
  if (!expdlg.picking) {
    expdlg.from = key;
    expdlg.to = key;
    expdlg.picking = true;
  } else {
    if (key < expdlg.from) { expdlg.to = expdlg.from; expdlg.from = key; }
    else expdlg.to = key;
    expdlg.picking = false;
  }
  renderExpdlg();
}

function openExportPeriodDialog() {
  const today = dayKey(new Date());
  if (!expdlg.from) expdlg.from = today;
  if (!expdlg.to) expdlg.to = today;
  expdlg.picking = false;
  expdlg.view = keyToDate(expdlg.from);
  renderExpdlg();
  el.expdlgBackdrop.hidden = false;
}
function closeExpdlg() { el.expdlgBackdrop.hidden = true; }

// Границы диапазона больше не открывают отдельный календарь — он встроен в
// модалку и всегда на виду. Стрелками листаются месяцы.
el.expCalPrev.addEventListener('click', () => { expdlg.view = new Date(expdlg.view.getFullYear(), expdlg.view.getMonth() - 1, 1); renderExpCal(); });
el.expCalNext.addEventListener('click', () => { expdlg.view = new Date(expdlg.view.getFullYear(), expdlg.view.getMonth() + 1, 1); renderExpCal(); });
el.expdlgCancel.addEventListener('click', closeExpdlg);
el.expdlgOk.addEventListener('click', () => {
  const range = expdlgRange();
  closeExpdlg();
  if (!range) { exportAllProjects(); return; }
  const [from, to] = range;
  runExport(`Lancible — ${t('export.period')} — ${fmtDate(from)} — ${fmtDate(to)}`, buildPeriodSheets(from, to));
});

function exportAllProjects() {
  runExport(`Lancible — ${t('export.all_projects')} — ${fmtDate(Date.now())}`, buildAllProjectsSheets());
}
/** Экспорт открытого проекта — та же выгрузка, что в контекстном меню
 *  плитки на главной, но доступная изнутри проекта (как в мобильном). */
function exportProject() {
  if (state.ui.projectId) exportProjectById(state.ui.projectId);
}
/** Выгружает то, что сейчас показано в календаре: выбранный период, если
 *  он включён, иначе границы текущего вида (месяц/неделя/день). */
function exportCalendar() {
  const picked = calState.periodOn ? rangeBounds() : null;
  let [from, to] = picked || currentViewBounds();
  if (!picked) {
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
  }
  runExport(`Lancible — ${t('export.period')} — ${fmtDate(from)} — ${fmtDate(to)}`, buildPeriodSheets(from, to));
}

// ---------------------------------------------------------------------------
// Таймер
// ---------------------------------------------------------------------------

function toggleTimer() {
  if (!selectedId) return;
  const running = state.activeTimer && state.activeTimer.taskId === selectedId;
  if (running) stopTimer();
  else startTimer(selectedId);
}
function startTimer(id) {
  if (state.activeTimer) stopTimer();
  const now = new Date().toISOString();
  state.activeTimer = { taskId: id, startedAt: now, heartbeatAt: now };
  savePending = true;
  saveNow();
  render();
}
function stopTimer() {
  if (!state.activeTimer) return;
  const { taskId, startedAt } = state.activeTimer;
  const task = getTask(taskId);
  const end = new Date();
  const ms = Math.max(0, end.getTime() - new Date(startedAt).getTime());
  if (task && ms >= 1000) {
    task.sessions = task.sessions || [];
    task.sessions.push({ start: startedAt, end: end.toISOString(), ms, rate: effectiveRate(task) });
    task.totalMs = (task.totalMs || 0) + ms;
    task.updatedAt = end.toISOString();
  }
  state.activeTimer = null;
  savePending = true;
  saveNow();
  render();
}

// ---------------------------------------------------------------------------
// Редактор (Quill) — текст-цвет + таблицы + заливка ячеек
// ---------------------------------------------------------------------------

const tableModule = () => { try { return quill.getModule('table'); } catch { return null; } };
let ttScope = 'cell';

function setupEditor() {
  // атрибутор фона ячейки таблицы (блочный, чтобы стиль лёг на <td> и попал в Delta)
  try {
    const Parchment = Quill.import('parchment');
    const CellBg = new Parchment.StyleAttributor('cellBg', 'background-color', { scope: Parchment.Scope.BLOCK });
    Quill.register(CellBg, true);
  } catch (e) { console.error('cellBg attributor:', e); }

  quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: t('editor.placeholder'),
    bounds: '#editor-wrap',
    modules: {
      table: true,
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: TEXT_COLORS }, { background: TEXT_COLORS }],
        [{ list: 'check' }, { list: 'bullet' }, { list: 'ordered' }],
        [{ indent: '-1' }, { indent: '+1' }],
        ['blockquote', 'code-block', 'link'],
        ['clean'],
      ],
    },
  });

  const tm = tableModule();
  if (tm) {
    const bar = quill.getModule('toolbar').container;
    const group = document.createElement('span');
    group.className = 'ql-formats';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ql-table-insert';
    btn.title = t('table.insert_title');
    btn.textContent = '▦';
    btn.addEventListener('click', () => {
      quill.focus();
      try { tm.insertTable(3, 3); } catch (e) { console.error(e); }
      persistNotes();
      updateTableTools();
    });
    group.appendChild(btn);
    bar.appendChild(group);

    el.tableTools.querySelectorAll('button[data-tt]').forEach((b) => {
      b.addEventListener('click', () => {
        quill.focus();
        const op = b.dataset.tt;
        try {
          if (op === 'rowBelow') tm.insertRowBelow();
          else if (op === 'colRight') tm.insertColumnRight();
          else if (op === 'rowDel') tm.deleteRow();
          else if (op === 'colDel') tm.deleteColumn();
          else if (op === 'tableDel') tm.deleteTable();
        } catch (e) { console.error(e); }
        persistNotes();
        updateTableTools();
      });
    });
    el.tableTools.querySelectorAll('button[data-scope]').forEach((b) => {
      b.addEventListener('click', () => {
        ttScope = b.dataset.scope;
        el.tableTools.querySelectorAll('button[data-scope]').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    buildFillSwatches();
  }

  quill.on('text-change', (_d, _o, source) => { if (source === 'user' && selectedId) persistNotes(); });
  quill.on('editor-change', () => updateTableTools());
  quill.enable(false);
}

function buildFillSwatches() {
  el.ttSwatches.innerHTML = '';
  for (const c of FILL_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-sw' + (c ? '' : ' none');
    if (c) b.style.background = c;
    b.title = c ? t('table.fill_title') : t('table.unfill_title');
    b.addEventListener('click', () => applyCellFill(c || null));
    el.ttSwatches.appendChild(b);
  }
}

function cellsForScope(tm, scope) {
  const range = quill.getSelection();
  if (!range) return [];
  let info;
  try { info = tm.getTable(range); } catch { return []; }
  const [table, row, cell] = info || [];
  if (!cell) return [];
  if (scope === 'cell') return [cell];
  if (scope === 'row') return [...(row.children ? childList(row) : [])];
  if (scope === 'col') {
    let ci = 0;
    let c = cell;
    while (c.prev) { c = c.prev; ci++; }
    const out = [];
    for (const r of childList(table)) {
      const cc = childAt(r, ci);
      if (cc) out.push(cc);
    }
    return out;
  }
  return [];
}
function childList(blot) {
  const out = [];
  blot.children.forEach((c) => out.push(c));
  return out;
}
function childAt(blot, i) {
  let n = 0;
  let res = null;
  blot.children.forEach((c) => { if (n === i) res = c; n++; });
  return res;
}

function applyCellFill(color) {
  const tm = tableModule();
  if (!tm || !quill) return;
  const cells = cellsForScope(tm, ttScope);
  if (!cells.length) { toast(t('toast.put_cursor_table')); return; }
  for (const c of cells) {
    try {
      const idx = c.offset(quill.scroll);
      const len = c.length();
      quill.formatLine(idx, Math.max(1, len), 'cellBg', color);
    } catch (e) { console.error(e); }
  }
  persistNotes();
}

function persistNotes() {
  const task = getTask(selectedId);
  if (!task) return;
  task.notes = quill.getContents();
  task.updatedAt = new Date().toISOString();
  scheduleSave();
}

function updateTableTools() {
  if (!quill || !el.tableTools) return;
  const tm = tableModule();
  let inTable = false;
  try {
    const range = quill.getSelection();
    if (tm && range && tm.getTable) inTable = !!tm.getTable(range)[0];
  } catch { inTable = false; }
  el.tableTools.hidden = !inTable;
}

function loadEditor(task) {
  if (!quill) return;
  if (!task) { quill.setContents([], 'silent'); quill.enable(false); return; }
  quill.enable(true);
  quill.setContents(task.notes || [{ insert: '\n' }], 'silent');
  updateTableTools();
}
function flushEditor() {
  if (!quill || !selectedId) return;
  const task = getTask(selectedId);
  if (task) task.notes = quill.getContents();
}

// ---------------------------------------------------------------------------
// Тик + heartbeat
// ---------------------------------------------------------------------------

setInterval(() => {
  if (!state.activeTimer) return;
  const task = getTask(state.activeTimer.taskId);
  if (state.ui.view === 'project') {
    if (task && task.id === selectedId) { renderTimer(task); renderMoney(task); }
    const li = el.taskList.querySelector(`.task-item[data-id="${state.activeTimer.taskId}"] .task-time`);
    if (li && task) li.textContent = fmtShort(taskElapsedMs(task));
    renderFooter();
  }
  renderStats();
}, 250);

setInterval(() => {
  if (!state.activeTimer) return;
  state.activeTimer.heartbeatAt = new Date().toISOString();
  savePending = true;
  saveNow();
}, HEARTBEAT_MS);

function recoverActiveTimer() {
  const at = state.activeTimer;
  if (!at) return;
  const task = getTask(at.taskId);
  const endIso = at.heartbeatAt || at.startedAt;
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(at.startedAt).getTime());
  if (task && ms >= 1000) {
    task.sessions = task.sessions || [];
    task.sessions.push({ start: at.startedAt, end: endIso, ms, rate: effectiveRate(task), recovered: true });
    task.totalMs = (task.totalMs || 0) + ms;
    toast(t('toast.timer_recovered', { name: task.title || t('task.no_name'), time: fmtShort(ms) }));
  }
  state.activeTimer = null;
  savePending = true;
  saveNow();
}

// ---------------------------------------------------------------------------
// События
// ---------------------------------------------------------------------------

el.navItems.forEach((tab) => tab.addEventListener('click', () => openView(tab.dataset.view)));
el.navCollapse.addEventListener('click', toggleNav);
el.searchInput.addEventListener('focus', openSearch);
el.searchInput.addEventListener('input', () => { renderSearch(el.searchInput.value); if (el.searchPanel.hidden) openSearch(); });
el.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSearch(); el.searchInput.blur(); }
  else if (e.key === 'Enter') {
    const sel = el.searchResults.querySelector('.sr-item.sel') || el.searchResults.querySelector('.sr-item');
    if (sel) sel.click();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...el.searchResults.querySelectorAll('.sr-item')];
    if (!items.length) return;
    let i = items.findIndex((x) => x.classList.contains('sel'));
    items.forEach((x) => x.classList.remove('sel'));
    i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[i].classList.add('sel');
    items[i].scrollIntoView({ block: 'nearest' });
  }
});
el.openCalendarBtn.addEventListener('click', () => openView('calendar'));
el.createProjectBtn.addEventListener('click', () => openProjectDialog(null));
el.backHome.addEventListener('click', backHome);
el.boardStatuses.addEventListener('click', openStatusDialog);
el.stAdd.addEventListener('click', addStatus);
el.stdlgClose.addEventListener('click', closeStatusDialog);
el.stdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.stdlgBackdrop) closeStatusDialog(); });

el.boardProject.addEventListener('click', () => {
  openMenu(el.boardProject, state.projects.map((p) => ({
    label: p.name,
    selected: p.id === boardProjectId(),
    onClick: () => { state.ui.boardProjectId = p.id; renderBoardPage(); },
  })));
});

el.projectMenuBtn.addEventListener('click', (e) => {
  const p = getProject(state.ui.projectId);
  if (p) openProjectMenu(p, e.currentTarget);
});

el.calModes.forEach((b) => b.addEventListener('click', () => setCalMode(b.dataset.mode)));
el.calPrev.addEventListener('click', () => calShift(-1));
el.calNext.addEventListener('click', () => calShift(1));
el.calToday.addEventListener('click', () => {
  const n = new Date();
  calState.year = n.getFullYear();
  calState.month = n.getMonth();
  calState.weekStart = mondayOf(n);
  calState.day = startOfDay(n);
  calState.selected = dayKey(n);
  if (calState.periodOn) seedRangeFromView();
  renderCalendar();
});
el.calPeriodToggle.addEventListener('click', togglePeriod);
// Границы периода больше не открывают собственный мини-календарь: большой
// календарь прямо под ними и так на экране, и период набирается кликами по
// нему (pickRangeDay). Два всплывающих календаря поверх третьего только
// сбивали с толку. Даты здесь — просто показания.
el.dpPrev.addEventListener('click', () => { dp.view = new Date(dp.view.getFullYear(), dp.view.getMonth() - 1, 1); renderDatePicker(); });
el.dpNext.addEventListener('click', () => { dp.view = new Date(dp.view.getFullYear(), dp.view.getMonth() + 1, 1); renderDatePicker(); });

el.tfStatus.forEach((b) => b.addEventListener('click', () => { taskFilter.status = b.dataset.status; renderSidebar(); }));
el.taskTabs.forEach((b) => b.addEventListener('click', () => setTaskTab(b.dataset.tab)));

el.newTaskBtn.addEventListener('click', newTask);
el.timerBtn.addEventListener('click', toggleTimer);
el.deleteBtn.addEventListener('click', () => deleteTask(selectedId));
el.exportTaskBtn.addEventListener('click', exportTask);

/** Правки срока пишутся прямо в задачу: отдельного «сохранить» в этом
 *  интерфейсе нет нигде, всё уходит через scheduleSave, как и остальное. */
function touchTask(task) {
  task.updatedAt = new Date().toISOString();
  task.notifiedAt = null;
  renderDue(task);
  renderSidebar();
  scheduleSave();
}
el.notifBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleNotifPanel(); });
el.notifSeen.addEventListener('click', (e) => { e.stopPropagation(); markNotifSeen(); });
el.notifPanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (!el.notifPanel.hidden) closeNotifPanel(); });
setInterval(checkReminders, 30000);

el.dueDateBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  openDatePicker(el.dueDateBtn, task.dueAt ? dayKey(new Date(task.dueAt)) : dayKey(new Date()), (key) => {
    const prev = task.dueAt ? new Date(task.dueAt) : null;
    const d = keyToDate(key);
    d.setHours(prev ? prev.getHours() : 18, prev ? prev.getMinutes() : 0, 0, 0);
    task.dueAt = d.toISOString();
    touchTask(task);
  });
});
el.dueTimeBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task || !task.dueAt) return;
  const d = new Date(task.dueAt);
  openTimePicker(el.dueTimeBtn, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, (val) => {
    const [h, m] = val.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    task.dueAt = d.toISOString();
    touchTask(task);
  });
});
el.dueClearBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  task.dueAt = null;
  task.remindAt = null;
  task.remindOffsetMin = null;
  touchTask(task);
});
/** Ключ текущего варианта напоминания: 'null' | 'custom' | число минут. */
function remindKey(task) {
  if ((task.remindOffsetMin === null || task.remindOffsetMin === undefined) && task.remindAt) return 'custom';
  return String(task.remindOffsetMin === undefined ? null : task.remindOffsetMin);
}
function applyRemind(task, v) {
  if (v !== 'null') ensureNotifPermission();
  if (v === 'custom') {
    task.remindOffsetMin = null;
    task.remindAt = task.remindAt || new Date(new Date(task.dueAt).getTime() - 3600000).toISOString();
  } else if (v === 'null') {
    task.remindOffsetMin = null;
    task.remindAt = null;
  } else {
    task.remindOffsetMin = Number(v);
    task.remindAt = null;
  }
  touchTask(task);
}
el.dueRemind.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task || !task.dueAt) return;
  const current = remindKey(task);
  openMenu(el.dueRemind, REMIND_PRESETS.map((p) => ({
    label: t(REMIND_LABEL[String(p)]),
    selected: String(p) === current,
    onClick: () => applyRemind(task, String(p)),
  })));
});
el.remindDateBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task || !task.remindAt) return;
  openDatePicker(el.remindDateBtn, dayKey(new Date(task.remindAt)), (key) => {
    const prev = new Date(task.remindAt);
    const d = keyToDate(key);
    d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    task.remindAt = d.toISOString();
    touchTask(task);
  });
});
el.remindTimeBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task || !task.remindAt) return;
  const d = new Date(task.remindAt);
  openTimePicker(el.remindTimeBtn, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, (val) => {
    const [h, m] = val.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    task.remindAt = d.toISOString();
    touchTask(task);
  });
});
el.exportProjectBtn.addEventListener('click', exportProject);
el.exportCalendarBtn.addEventListener('click', exportCalendar);
el.exportAllBtn.addEventListener('click', exportAllProjects);
el.exportPeriodBtn.addEventListener('click', openExportPeriodDialog);
el.pinTaskBtn.addEventListener('click', () => selectedId && togglePinTask(selectedId));
el.addSessionBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSessionDialog(getTask(selectedId), null); });

el.stRunning.addEventListener('click', () => {
  const task = state.activeTimer && getTask(state.activeTimer.taskId);
  if (!task) return;
  openProject(task.projectId);
  selectTask(task.id);
});

el.taskStatus.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  openMenu(el.taskStatus, orderedStatuses(task.projectId).map((st) => ({
    label: st.name,
    selected: st.id === task.statusId,
    onClick: () => { setTaskStatus(task, st.id); render(); scheduleSave(); },
  })));
});

el.taskRate.addEventListener('input', () => {
  const task = getTask(selectedId);
  if (!task) return;
  const v = el.taskRate.value.trim();
  task.rate = v === '' ? null : parseNum(v);
  task.updatedAt = new Date().toISOString();
  renderMoney(task);
  renderFooter();
  scheduleSave();
});
el.defaultRate.addEventListener('input', () => {
  state.settings.hourlyRate = parseNum(el.defaultRate.value);
  const task = getTask(selectedId);
  if (task) renderMoney(task);
  renderFooter();
  renderStats();
  scheduleSave();
});
el.currency.addEventListener('change', () => {
  state.settings.currency = el.currency.value;
  render();
  scheduleSave();
});

el.title.addEventListener('input', () => {
  const task = getTask(selectedId);
  if (!task) return;
  task.title = el.title.value;
  task.updatedAt = new Date().toISOString();
  const nameEl = el.taskList.querySelector(`.task-item[data-id="${task.id}"] .task-name`);
  if (nameEl) nameEl.textContent = task.title || t('task.no_name');
  scheduleSave();
});
el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quill.focus(); } });

el.pdlgSave.addEventListener('click', saveProjectDialog);
el.pdlgCancel.addEventListener('click', closeProjectDialog);
el.pdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.pdlgBackdrop) closeProjectDialog(); });
el.pdlgName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveProjectDialog(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeProjectDialog(); }
});
el.pdlgDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProjectDialog(); });

el.sdlgSave.addEventListener('click', saveSessionDialog);
el.sdlgCancel.addEventListener('click', closeSessionDialog);
el.sdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.sdlgBackdrop) closeSessionDialog(); });

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape' && dp.open) { closeDatePicker(); return; }
  if (e.key === 'Escape' && tp.open) { closeTimePicker(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'f') {
    e.preventDefault();
    el.searchInput.focus();
    el.searchInput.select();
    return;
  }
  if (anyDialogOpen()) return;
  if ((e.ctrlKey || e.metaKey) && k === 'n') {
    e.preventDefault();
    if (e.shiftKey) openProjectDialog(null);
    else newTask();
  }
});

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------

function buildCurrencyOptions() {
  for (const select of [el.currency, el.settingsCurrency]) {
    const cur = select.value;
    select.innerHTML = '';
    for (const [code, sym] of Object.entries(CURRENCIES)) {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = `${code} ${sym}`;
      select.appendChild(o);
    }
    select.title = t('currency.title');
    if (cur) select.value = cur;
  }
}

// Сама миграция живёт в core/migrate.js и покрыта тестами: она трогает все
// данные пользователя при каждом запуске, и её ошибку уже не откатить.
// Здесь — подстановка того, что она берёт из окружения.
function migrate() {
  Core.migrate(state, {
    t,
    uid,
    langs: Object.keys(T),
    palette: PALETTE,
    currencies: CURRENCIES,
    sym2code: SYM2CODE,
    defaultProjectNameKey: DEFAULT_PROJECT_NAME_KEY,
  });
}

async function init() {
  setupEditor();
  setupCarousels();
  buildCurrencyOptions();
  buildSwatches();

  try {
    const loaded = await window.api.load();
    if (loaded && typeof loaded === 'object') state = loaded;
  } catch (err) {
    console.error('Не удалось загрузить данные:', err);
    toast(t('toast.load_error'));
  }

  migrate();
  el.langLabel.textContent = LANG_NAMES[state.settings.lang] || state.settings.lang;
  applyStaticTranslations();
  applyTheme();
  buildCurrencyOptions();
  renderAccountBtn();
  recoverActiveTimer();
  state.ui.view = 'home';
  selectedId = null;
  setCalMode(calState.mode);
  scheduleSave();
  render();

  const skeleton = $('app-skeleton');
  if (skeleton) {
    skeleton.classList.add('hide');
    setTimeout(() => skeleton.remove(), 200);
  }
}

init();

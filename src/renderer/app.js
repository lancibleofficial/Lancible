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
  // Статусы принадлежат проекту: у каждого своя доска, и «Проверка» в одном
  // проекте ничего не значит в другом. Когда-то они были общими на всё
  // приложение — миграция развела их по проектам вместе с задачами, см.
  // core/migrate.js и тест «общие статусы старой версии разводятся».
  // Версии — тоже проекта. Общие на всё приложение только теги.
  statuses: [],
  tags: [],
  versions: [],
  // Документы — раздел «Документы»: тексты отдельно от задач, общие или
  // проекта. Формат текста тот же, что у заметок (core/doc.js).
  documents: [],
  activeTimer: null,
  ui: { view: 'home', projectId: null, navCollapsed: false },
  settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru', syncEnabled: true, syncResolvedFor: null },
};
let selectedId = null;

// Палитра, валюты и ключ имени проекта по умолчанию — в core/catalog.js:
// это свойства продукта, а не платформы, и лежали они в двух экземплярах.
const { DEFAULT_PROJECT_NAME_KEY, PALETTE, CURRENCIES, SYM2CODE } = Core;

// Словарь переводов, LOCALE_MAP и LANG_NAMES — в core/i18n.js: там на них
// есть тест, проверяющий, что набор ключей во всех языках одинаковый.
const { T, LOCALE_MAP, LANG_NAMES } = Core;
const HEARTBEAT_MS = 15000;

// Виды статусов, набор по умолчанию и разбор — в core/status.js.
const { STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES } = Core;


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
  chev: 'M4.3 6.2a.95.95 0 011.34 0L8 8.56l2.36-2.36a.95.95 0 111.34 1.34l-3.03 3.03a.95.95 0 01-1.34 0L4.3 7.54a.95.95 0 010-1.34z',
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
  tbTimer: $('tb-timer'), tbTimerTime: $('tb-timer-time'), tbTimerName: $('tb-timer-name'), tbTimerStop: $('tb-timer-stop'),
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
  authOnboardingTitle: $('auth-onboarding-title'), authConsentSub: $('auth-consent-sub'),
  authProfileFields: $('auth-profile-fields'), authConsentCheck: $('auth-consent-check'),
  authConsentText: $('auth-consent-text'), authConsentDecline: $('auth-consent-decline'),

  stTime: $('st-time'), stMoney: $('st-money'), stDone: $('st-done'),
  stToday: $('st-today'), stTodayMoney: $('st-today-money'), stWeek: $('st-week'), stWeekMoney: $('st-week-money'),
  kpiWeekLabel: $('kpi-week-label'), kpiMonthLabel: $('kpi-month-label'),
  dayTitle: $('day-title'), daySub: $('day-sub'), dayTrack: $('day-track'), dayHours: $('day-hours'),
  dayAddEntry: $('day-add-entry'), dayOpen: $('day-open'),
  homeProjects: $('home-projects'), homeProjGrid: $('home-proj-grid'), homeAllProjects: $('home-all-projects'),
  homeDueList: $('home-due-list'), homeDueEmpty: $('home-due-empty'), homeDueNote: $('home-due-note'),
  nowIsland: $('now-island'), nowLabel: $('now-label'), nowSince: $('now-since'), nowTitle: $('now-title'),
  nowProj: $('now-proj'), nowBtn: $('now-btn'), nowTime: $('now-time'), nowMoney: $('now-money'), nowOpen: $('now-open'),
  recentList: $('recent-list'), recentEmpty: $('recent-empty'),

  homeView: $('home-view'), projectsView: $('projects-view'), projectView: $('project-view'), timeView: $('time-view'),
  agTime: $('ag-time'), agMonth: $('ag-month'), agList: $('ag-list'),
  agDaynames: $('ag-daynames'), agAllday: $('ag-allday'), agAlldayRow: $('ag-allday-row'), agGutter: $('ag-gutter'),
  agCols: $('ag-cols'), agScroll: $('ag-scroll'), agTitle: $('time-title'),
  agModes: $('time-modes'), timeToday: $('time-today'), timePrev: $('time-prev'), timeNext: $('time-next'),
  timeStatsToggle: $('time-stats-toggle'), agMain: $('ag-main'), calMain: $('cal-main'),
  periodBar: $('period-bar'), periodBarRange: $('period-bar-range'), periodBarSum: $('period-bar-sum'), periodBarInfo: $('period-bar-info'),
  agCreate: $('ag-create'),
  settingsView: $('settings-view'), settingsProfile: $('settings-profile'),
  settingsLangRow: $('settings-lang-row'), settingsLangValue: $('settings-lang-value'),
  settingsDataLabel: $('settings-data-label'), settingsDataCard: $('settings-data-card'),
  settingsSyncToggle: $('settings-sync-toggle'),
  settingsRate: $('settings-rate'), settingsCurrency: $('settings-currency'),
  settingsAccountLabel: $('settings-account-label'), settingsAccountCard: $('settings-account-card'),
  settingsNameRow: $('settings-name-row'), settingsNameValue: $('settings-name-value'),
  settingsPasswordRow: $('settings-password-row'), settingsSignoutRow: $('settings-signout-row'),
  settingsDeleteRow: $('settings-delete-row'),
  modalLabel2: $('modal-label2'), modalInput2: $('modal-input2'), modalError: $('modal-error'),

  homeCount: $('home-count'), projectsTrack: $('projects-track'),
  recentSection: $('recent-section'), recentTrack: $('recent-track'),
  homeEmpty: $('home-empty'), createProjectBtn: $('create-project-btn'),

  phDot: $('ph-dot'), phName: $('ph-name'), projectMenuBtn: $('project-menu-btn'),
  projTabs: [...document.querySelectorAll('#proj-tabs button')], projList: $('proj-list'),
  projBoard: $('proj-board'), projVersions: $('proj-versions'), ptabVerCount: $('ptab-ver-count'),
  pverList: $('pver-list'), pverEmpty: $('pver-empty'), projBack: $('proj-back'), phDesc: $('ph-desc'),
  ppDone: $('pp-done'), ppOf: $('pp-of'), ppPct: $('pp-pct'), ppBar: $('pp-bar'), ppLegend: $('pp-legend'),
  projVersionsCard: $('proj-versions-card'), pvRows: $('pv-rows'), pvAll: $('pv-all'), psList: $('ps-list'), psEmpty: $('ps-empty'),
  taskView: $('task-view'), taskBack: $('task-back'), crumbProjects: $('crumb-projects'), crumbProject: $('crumb-project'), crumbTask: $('crumb-task'),
  taskDoneBtn: $('task-done-btn'), timerRate: $('timer-rate'),
  navProjects: $('nav-projects'), navNewProject: $('nav-new-project'),
  boardCols: $('board-cols'),
  boardStatuses: $('board-statuses'), stList: $('st-list'), stAdd: $('st-add'),
  pdlgTabs: [...document.querySelectorAll('#pdlg-tabs button')], pdlgLater: $('pdlg-later'),
  pdlgRate: $('pdlg-rate'), pdlgRateUnit: $('pdlg-rate-unit'), pdlgRateHint: $('pdlg-rate-hint'), pdlgCurrency: $('pdlg-currency'),
  pdlgTagList: $('pdlg-tag-list'), pdlgTagAdd: $('pdlg-tag-add'),
  verList: $('ver-list'), verAdd: $('ver-add'),
  boardEmpty: $('board-empty'),

  taskList: $('task-list'), sidebarEmpty: $('sidebar-empty'), newTaskBtn: $('new-task-btn'),
  projectEarned: $('project-earned'),

  tfStatus: [...document.querySelectorAll('.tf-status button')],

  detail: $('task-detail'),
  title: $('task-title'),
  taskTabs: [...document.querySelectorAll('.task-tabs button')], tabNotes: $('tab-notes'), taskProps: $('task-props'), tabHistory: $('tab-history'),
  // Узел параметров задачи ездит между вкладкой и модалкой с календаря.
  taskParams: document.querySelector('#task-props .task-params'),
  tmdlgBackdrop: $('tmdlg-backdrop'), tmdlgDot: $('tmdlg-dot'), tmdlgTitle: $('tmdlg-title'),
  tmdlgProj: $('tmdlg-proj'), tmdlgTot: $('tmdlg-tot'), tmdlgEntry: $('tmdlg-entry'),
  tmdlgDate: $('tmdlg-date'), tmdlgStart: $('tmdlg-start'), tmdlgEnd: $('tmdlg-end'),
  tmdlgDur: $('tmdlg-dur'), tmdlgDel: $('tmdlg-del'), tmdlgParams: $('tmdlg-params'),
  tmdlgOpen: $('tmdlg-open'), tmdlgDone: $('tmdlg-done'), tmdlgKicker: $('tmdlg-kicker'),
  tmdlgFound: $('tmdlg-found'), tmdlgFoundList: $('tmdlg-found-list'),
  timerDisplay: $('timer-display'), timerEarned: $('timer-earned'), timerSub: $('timer-sub'), timerBtn: $('timer-btn'),
  timerBtnIcon: $('timer-btn-icon'), timerBtnLabel: $('timer-btn-label'),
  deleteBtn: $('delete-task-btn'), exportTaskBtn: $('export-task-btn'),
  exportProjectBtn: $('export-project-btn'), exportCalendarBtn: $('export-calendar-btn'),
  spTime: $('sp-time'), spMoney: $('sp-money'),
  spMonth: $('sp-month'), spDone: $('sp-done'),
  tfVersion: $('tf-version'), tfVersionRow: $('task-filter-version'),
  sfProject: $('sf-project'), sfVersion: $('sf-version'), sfReset: $('sf-reset'),
  exportAllBtn: $('export-all-btn'),
  exportPeriodBtn: $('export-period-btn'),
  expdlgBackdrop: $('expdlg-backdrop'), expPills: $('exp-pills'), expRange: $('exp-range'),
  expFrom: $('exp-from'), expTo: $('exp-to'),
  expCalPrev: $('exp-cal-prev'), expCalNext: $('exp-cal-next'), expCalTitle: $('exp-cal-title'), expCalDays: $('exp-cal-days'),
  expdlgOk: $('expdlg-ok'), expdlgCancel: $('expdlg-cancel'),
  taskRate: $('task-rate'), rateUnit: $('rate-unit'), moneyCalc: $('money-calc'),
  taskStatus: $('task-status'), taskStatusDot: $('task-status-dot'),
  taskVersion: $('task-version'), taskVersionRow: $('task-version-row'),
  repeatRow: $('repeat-row'), taskRepeat: $('task-repeat'), repeatNext: $('repeat-next'),
  rpdlgBackdrop: $('rpdlg-backdrop'), rpEvery: $('rp-every'), rpUnit: $('rp-unit'),
  rpFreqSeg: $('rp-freq-seg'), rpDays: $('rp-days'), rpMonthSeg: $('rp-month-seg'),
  rpFromSeg: $('rp-from-seg'), rpEndsSeg: $('rp-ends-seg'),
  rpAfter: $('rp-after'), rpCount: $('rp-count'), rpUntilRow: $('rp-until-row'), rpUntil: $('rp-until'),
  rpHistory: $('rp-history'), rpPreview: $('rp-preview'),
  rpdlgOff: $('rpdlg-off'), rpdlgCancel: $('rpdlg-cancel'), rpdlgSave: $('rpdlg-save'),
  notifBtn: $('notif-btn'), notifBadge: $('notif-badge'), notifPanel: $('notif-panel'),
  settingsNotifToggle: $('settings-notif-toggle'), settingsNotifSystem: $('settings-notif-system'),
  settingsAboutUs: $('settings-about-us'), settingsAboutBlog: $('settings-about-blog'),
  settingsLegalPrivacy: $('settings-legal-privacy'), settingsLegalTerms: $('settings-legal-terms'),
  settingsLegalDocs: $('settings-legal-docs'),
  settingsNotifState: $('settings-notif-state'),
  notifList: $('notif-list'), notifEmpty: $('notif-empty'), notifSeen: $('notif-seen'),
  dueDateBtn: $('due-date-btn'), dueState: $('due-state'),
  dueRemind: $('due-remind'), dueClearBtn: $('due-clear-btn'), dueCustomRow: $('due-custom-row'),
  remindDateBtn: $('remind-date-btn'),
  editorWrap: $('editor-wrap'),
  docsView: $('docs-view'), docList: $('doc-list'), docListEmpty: $('doc-list-empty'), docSearch: $('doc-search'),
  docNewBtn: $('doc-new'), docFilterBtn: $('doc-filter'), docTitle: $('doc-title'), docProjectBtn: $('doc-project'),
  docPinBtn: $('doc-pin'), docMoreBtn: $('doc-more'), docEmpty: $('doc-empty'), docEmptyNew: $('doc-empty-new'),
  docMain: $('doc-main'), docEditorWrap: $('doc-editor-wrap'),
  sessionList: $('session-list'), sessionCount: $('session-count'),
  sessionEmpty: $('session-empty'), addSessionBtn: $('add-session-btn'),

  calModes: [],
  calTitle: $('time-title'), calDays: $('cal-days'),
  calWeekdays: $('cal-weekdays'),
  calPeriodToggle: $('cal-period-toggle'),
  rangeFrom: $('range-from'), rangeTo: $('range-to'),
  dpPop: $('dp-pop'), dpTitle: $('dp-title'), dpDays: $('dp-days'), dpPrev: $('dp-prev'), dpNext: $('dp-next'),
  dpTime: $('dp-time'), dpHours: $('dp-hours'), dpMinutes: $('dp-minutes'), dpHoursPick: $('dp-hours-pick'), dpMinutesPick: $('dp-minutes-pick'), dpDone: $('dp-done'),
  tpPop: $('tp-pop'), tpHours: $('tp-hours'), tpMinutes: $('tp-minutes'),
  calViewTot: $('cal-view-tot'),
  calDayHead: $('cal-day-head'), calDayTot: $('cal-day-tot'),
  calDayList: $('cal-day-list'), calDayEmpty: $('cal-day-empty'), calDayPanel: $('cal-day-panel'),

  toast: $('toast'), ctxMenu: $('ctx-menu'),
  modalBackdrop: $('modal-backdrop'), modalLabel: $('modal-label'),
  modalInput: $('modal-input'), modalOk: $('modal-ok'), modalCancel: $('modal-cancel'),
  confirmBackdrop: $('confirm-backdrop'), confirmTitle: $('confirm-title'), confirmText: $('confirm-text'),
  confirmOk: $('confirm-ok'), confirmCancel: $('confirm-cancel'),
  // Теги
  tagsList: $('tags-list'), tagsAdd: $('tags-add'),
  tagdlgBackdrop: $('tagdlg-backdrop'), tagdlgTitle: $('tagdlg-title'), tagdlgName: $('tagdlg-name'),
  tagdlgError: $('tagdlg-error'), tagdlgSwatches: $('tagdlg-swatches'), tagdlgDelete: $('tagdlg-delete'),
  tagdlgCancel: $('tagdlg-cancel'), tagdlgSave: $('tagdlg-save'),
  taskTags: $('task-tags'), taskTagsAdd: $('task-tags-add'),
  pdlgTags: $('pdlg-tags'), pdlgTagsAdd: $('pdlg-tags-add'), phTags: $('ph-tags'),
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
  const wasDone = !!task.done;
  task.statusId = s.id;
  // done означает именно «сделано», а не «закрыто»: отменённая задача тоже
  // уходит из работы, но записывать её в выполненные нельзя — счёт «сделано
  // 8 из 10» перестал бы быть правдой.
  task.done = s.kind === 'done';
  task.cancelled = s.kind === 'cancelled';
  task.doneAt = task.done ? (task.doneAt || new Date().toISOString()) : null;
  task.updatedAt = new Date().toISOString();
  afterTaskClosed(task, wasDone);
}

/** Обратная сторона: галочка «выполнено» в списке тоже должна двигать задачу
 *  по доске, иначе список и доска разойдутся. Если задача уже стоит в статусе
 *  нужного вида, он сохраняется — у пользователя может быть несколько
 *  завершающих статусов, и галочка не должна схлопывать их в один. */
// Что должно случиться по галочке, решает ядро: правило общее с телефоном
// (core/status.js, planTaskDone), а применяют его стороны по-разному — тут
// правкой объекта на месте, там заменой в сторе.
function setTaskDone(task, done) {
  if (!task) return;
  const plan = Core.planTaskDone(state.statuses, task, done);
  if (plan.moveTo) { setTaskStatus(task, plan.moveTo); return; }
  const wasDone = !!task.done;
  task.done = plan.setDone;
  task.doneAt = plan.setDone ? new Date().toISOString() : null;
  task.updatedAt = new Date().toISOString();
  afterTaskClosed(task, wasDone);
}

// --- Версии ----------------------------------------------------------------
// Теги живут ниже, своим разделом: они общие на всё приложение, а версии —
// принадлежат проекту.

// Отбор, порядок и подсчёт — в core/versions.js, здесь только подстановка state.
const getVersion = (id) => Core.getVersion(state.versions, id);
const versionsOf = (projectId) => Core.versionsOf(state.versions, projectId);
const versionUsage = (id) => Core.versionUsage(state.tasks, id);
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

let taskFilter = { status: 'all', versionId: 'all' };
// Фильтр «Статистики» — свой: там проектов сразу несколько, и проект
// приходится выбирать до версии. Держим его рядом с taskFilter, а не в
// state.ui: это способ смотреть, он не переживает перезагрузку и никуда
// не синхронизируется.
let statsFilter = { projectId: 'all', versionId: 'all' };
const isFilterActive = () => taskFilter.status !== 'all' || taskFilter.versionId !== 'all';

function filteredProjectTasks() {
  let list = visibleTasks();
  if (taskFilter.status === 'active') list = list.filter((t2) => !t2.done);
  else if (taskFilter.status === 'done') list = list.filter((t2) => t2.done);
  if (taskFilter.versionId !== 'all') list = Core.filterTasks(list, state.versions, { versionId: taskFilter.versionId });
  return list;
}

// Чистое форматирование живёт в core/format.js — оно тестируется отдельно,
// без браузера. Здесь остаются обёртки с прежними именами и сигнатурами:
// они подставляют то, что раньше бралось из state прямо внутри функции.
const { pad2, fmtClock, DUR_UNITS, fmtDate, fmtTime, dayKey, keyToDate, hoursOf, escapeHtml, capFirst, parseNum } = Core;
const taskElapsedMs = (task) => Core.taskElapsedMs(task, state.activeTimer, Date.now());
const fmtShort = (ms) => Core.fmtShort(ms, lang());
const fmtDur = (ms) => Core.fmtDur(ms, lang());

// Правило подписи — в ядре (core/format.js), общее с телефоном; здесь только
// подстановка локали, словаря и «сейчас».
const fmtWhen = (iso) => Core.fmtWhen(iso, locale(), t, Date.now());
const fmtDateShort = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const monthLabel = (y, m) => `${capFirst(new Date(y, m, 1).toLocaleDateString(locale(), { month: 'long' }))} ${y}`;


// ---------------------------------------------------------------------------
// Деньги
// ---------------------------------------------------------------------------

const moneyFmt = () => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 });

// Расчёт денег и сводки живут в core/money.js: там их можно проверить
// тестом, потому что ставка, идущий таймер и текущий момент приходят
// параметрами. Здесь — обёртки с прежними именами, подставляющие state.
const defaultRate = () => Number(state.settings && state.settings.hourlyRate) || 0;
/** Ставки для ядра: общая и свои у проектов (см. core/money.js). */
const rates = () => ({
  default: defaultRate(),
  byProject: Object.fromEntries(state.projects.filter((p) => p.rate !== null && p.rate !== undefined).map((p) => [p.id, p.rate])),
});
/** То же, но деньги считаются только по проектам в основной валюте — для
 *  общих итогов по всем проектам: складывать рубли с долларами нельзя. */
const ratesMain = () => ({ ...rates(), scope: Core.moneyScope(state.tasks, state.projects, state.settings.currency) });
const currencyOf = (projectId) => Core.projectCurrency(getProject(projectId), state.settings.currency);
const symOf = (code) => CURRENCIES[code] || code || '₽';
const effectiveRate = (task) => Core.effectiveRate(task, rates());
const hasOwnRate = Core.hasOwnRate;
const sessionMoney = (s, task) => Core.sessionMoney(s, task, rates());
const earnedOf = (task) => Core.earnedOf(task, rates(), state.activeTimer, Date.now());
const earnedShown = (task, earned) => Core.earnedShown(task, rates(), earned);
const allSessionPairs = () => Core.allSessionPairs(state.tasks);
const aggregateDays = () => Core.aggregateDays(state.tasks, ratesMain());
const rangeAgg = (from, to) => Core.rangeAgg(state.tasks, from, to, ratesMain());
const tasksDoneOnDay = (key) => Core.tasksDoneOnDay(state.tasks, key);
const projectMoney = (id) => Core.projectMoney(tasksOf(id), rates(), state.activeTimer, Date.now());
const projectMs = (id) => Core.projectMs(tasksOf(id), state.activeTimer, Date.now());
const reminderTime = Core.reminderTime;
const dueState = (task) => Core.dueState(task, Date.now());

/** Сумма с валютой: по умолчанию основной, у проекта — своей. */
const fmtMoney = (n, code) => `${moneyFmt().format(Math.round((n + Number.EPSILON) * 100) / 100)} ${symOf(code || state.settings.currency)}`;

const { REMIND_PRESETS, REMIND_LABEL } = Core;

/** Короткая подпись срока для списка: «просрочено» / «сегодня» / дата. */
const dueShort = (task) => Core.dueShort(task, Date.now(), t, fmtDateShort);


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
  !el.confirmBackdrop.hidden || !el.searchPanel.hidden || !el.expdlgBackdrop.hidden ||
  !el.tagdlgBackdrop.hidden || !el.rpdlgBackdrop.hidden ||
  !el.tmdlgBackdrop.hidden;

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
  renderCurrency();
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
/** Правовой документ на лендинге — на языке приложения. */
const openLegal = (doc) => openExternalLink(Core.legalUrl(LANDING_URL, doc, lang()));
el.settingsLegalPrivacy.addEventListener('click', () => openLegal('privacy'));
el.settingsLegalTerms.addEventListener('click', () => openLegal('terms'));
el.settingsLegalDocs.addEventListener('click', () => openLegal('legal'));
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
el.settingsDeleteRow.addEventListener('click', deleteAccount);
el.settingsCurrency.addEventListener('click', () => openCurrencyMenu(el.settingsCurrency));

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
  const name = currentUser ? (currentUser.name || currentUser.email) : t('auth.sign_in_nav');
  el.accountLabel.textContent = name;
  // Кружок с первой буквой — только у вошедшего: у гостя пилюля остаётся
  // кнопкой входа со значком.
  const avatar = el.accountBtn.querySelector('.tb-avatar');
  const icon0 = el.accountBtn.querySelector('.icon');
  if (currentUser) {
    if (!avatar) {
      const a = document.createElement('span');
      a.className = 'tb-avatar';
      el.accountBtn.insertBefore(a, el.accountLabel);
    }
    el.accountBtn.querySelector('.tb-avatar').textContent = (name || '?').trim().charAt(0).toUpperCase();
    if (icon0) icon0.hidden = true;
  } else {
    if (avatar) avatar.remove();
    if (icon0) icon0.hidden = false;
  }
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
/** Страница «Статистика»: четыре карточки, как на главной, и под ними
 *  календарь. Разбивки по проектам, статусам и задачам убраны — то же самое
 *  теперь видно в правой панели календаря, разложенное по проектам. */
/** Раздел «Время»: шапка с режимами, числа, сетка (часовая или итогов),
 *  справа день. Режим «Месяц» — сетка итогов статистики с выбором периода;
 *  остальные режимы — расписание (core/agenda.js). */
function renderTimePage() {
  const mode = timeMode();
  const month = mode === 'month';
  if (!month) agenda.mode = mode;
  el.agModes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  el.timeView.classList.toggle('stats-hidden', !!state.ui.timeStatsHidden);
  el.timeStatsToggle.setAttribute('aria-pressed', String(!!state.ui.timeStatsHidden));
  const hideLabel = t(state.ui.timeStatsHidden ? 'time.show_stats' : 'time.hide_stats');
  el.timeStatsToggle.title = hideLabel;
  el.timeStatsToggle.setAttribute('aria-label', hideLabel);
  el.agMain.hidden = month;
  el.calMain.hidden = !month;
  renderStatsPage();
  if (month) {
    calState.mode = 'month';
    el.calWeekdays.hidden = false;
    renderCalendar();
  } else {
    // Правая панель и итог «за неделю» идут за сеткой расписания.
    const anchor = new Date(agenda.anchor);
    if (mode === 'week') { calState.mode = 'week'; calState.weekStart = mondayOf(anchor); }
    else if (mode === 'agenda') { calState.mode = 'month'; calState.year = anchor.getFullYear(); calState.month = anchor.getMonth(); }
    else { calState.mode = 'day'; calState.day = startOfDay(anchor); calState.selected = dayKey(anchor); }
    renderAgendaPage();
    el.calViewTot.classList.remove('period');
    renderViewTotal();
    renderCalDayPanel();
  }
  el.periodBarInfo.hidden = !calState.periodOn;
}

function setTimeMode(mode) {
  state.ui.timeMode = mode;
  if (mode === 'month') { calState.mode = 'month'; if (calState.periodOn) seedRangeFromView(); }
  else agenda.mode = mode;
  render();
  scheduleSave();
}

function renderStatsPage() {
  renderFilterBar(statsNodes(), statsFilter, () => render());
  const tasks = statsTasks();

  const totalMs = tasks.reduce((a, t2) => a + taskElapsedMs(t2), 0);
  const totalMoney = tasks.reduce((a, t2) => a + Core.earnedOf(t2, statsRates(), state.activeTimer, Date.now()), 0);
  el.spTime.textContent = fmtDur(totalMs);
  el.spMoney.textContent = fmtMoney(totalMoney, statsCurrency());

  const now = new Date();
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  el.spMonth.textContent = fmtMoney(Core.rangeAgg(tasks, monthFrom, monthTo, statsRates()).money, statsCurrency());

  const done = tasks.filter((t2) => t2.done).length;
  el.spDone.textContent = tasks.length ? `${done} / ${tasks.length}` : '0';
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
  renderCurrency();

  renderTagsSettings();
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
/** Шаг после входа. 'full' — новый аккаунт: имя и назначение (оба
 *  необязательны) и согласие. 'consent' — профиль есть, но принятая
 *  редакция документов старая или её нет: только согласие. Дальше в обоих
 *  случаях — лишь с включённым переключателем согласия (core/legal.js). */
let onboardingMode = 'full';
function openOnboarding(mode) {
  onboardingMode = mode === 'consent' ? 'consent' : 'full';
  const consentOnly = onboardingMode === 'consent';
  selectedUseCase = null;
  el.authName.value = '';
  buildUsecaseButtons();
  el.authProfileFields.hidden = consentOnly;
  el.authConsentSub.hidden = !consentOnly;
  el.authOnboardingSkip.hidden = consentOnly;
  el.authOnboardingTitle.textContent = t(consentOnly ? 'auth.consent_title' : 'auth.onboarding_title');
  el.authOnboardingSave.textContent = t(consentOnly ? 'auth.consent_accept' : 'common.continue');
  renderConsentText();
  setConsent(false);
  showAuthStep('onboarding');
  // Шаг согласия открывается и при тихом восстановлении сессии на старте —
  // тогда окна входа на экране ещё нет.
  el.authBackdrop.hidden = false;
}
const consentGiven = () => el.authConsentCheck.getAttribute('aria-pressed') === 'true';
function setConsent(on) {
  el.authConsentCheck.setAttribute('aria-pressed', String(on));
  el.authOnboardingSave.disabled = !on;
  el.authOnboardingSkip.disabled = !on;
}
/** «Мне уже исполнилось 16 лет. Я принимаю Условия и Политику» — со ссылками
 *  на документы на языке приложения. */
function renderConsentText() {
  const link = (doc, key) => `<a href="${escapeHtml(Core.legalUrl(LANDING_URL, doc, lang()))}" data-legal="${doc}">${escapeHtml(t(key))}</a>`;
  el.authConsentText.innerHTML = escapeHtml(t('auth.consent_text', { age: Core.MIN_AGE, terms: '{terms}', privacy: '{privacy}' }))
    .replace('{terms}', link('terms', 'auth.consent_terms'))
    .replace('{privacy}', link('privacy', 'auth.consent_privacy'));
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
    const { data: row } = await sb.from('profiles').select('name, terms_version, age_confirmed').eq('id', user.id).maybeSingle();
    profile = row;
  } catch (err) { console.error('Не удалось прочитать профиль:', err); }
  if (!profile) {
    if (!silent) openOnboarding('full');
    return;
  }
  // Профиль есть, а согласия с нынешней редакцией нет — без него аккаунт
  // дальше не работает, даже при тихом восстановлении на старте.
  if (Core.needsConsent(profile)) {
    openOnboarding('consent');
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

/** Сохраняет шаг после входа и доводит вход до конца. withProfile=false —
 *  «Пропустить»: только согласие, без имени и назначения. Email в профиль
 *  не пишется: он и так есть в аккаунте, копия ни для чего не нужна. Без
 *  согласия не сохраняется ничего. */
async function saveOnboarding(withProfile = true) {
  if (!consentGiven()) return;
  try {
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    if (!user) return;
    const consent = Core.consentFields(Date.now());
    const { error } = onboardingMode === 'consent'
      ? await sb.from('profiles').update(consent).eq('id', user.id)
      : await sb.from('profiles').upsert({
        id: user.id,
        ...(withProfile ? { name: el.authName.value.trim() || null, use_case: selectedUseCase } : {}),
        ...consent,
      });
    if (error) throw error;
  } catch (err) {
    console.error('Не удалось сохранить профиль:', err);
    toast(t('auth.error_generic'));
    return;
  }
  // Профиль и согласие на месте — afterSignedIn закроет окно и запустит синк.
  await afterSignedIn();
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

/** Удаление аккаунта. Клиент держит только ключ anon и удалить пользователя
 *  сам не может — это делает функция delete_my_account в базе
 *  (supabase/legal.sql): стирает того, кто её вызвал, а профиль, проекты,
 *  задачи и синхронизация уходят следом каскадом. Копия данных на
 *  устройстве остаётся: приложение работает и без аккаунта. */
async function deleteAccount() {
  if (!currentUser) return;
  const ok = await confirmDialog(t('account.delete_confirm'), {
    title: t('account.delete_title'), okLabel: t('account.delete'), danger: true,
  });
  if (!ok) return;
  const { error } = await sb.rpc('delete_my_account');
  if (error) {
    console.error('Не удалось удалить аккаунт:', error);
    toast(t('account.delete_error'));
    return;
  }
  unsubscribeSyncRealtime();
  // Пользователя на сервере уже нет — выходим только здесь, без запроса.
  try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.error('Не удалось выйти:', err); }
  currentUser = null;
  renderAccountBtn();
  if (state.ui.view === 'settings') renderSettings();
  toast(t('account.deleted_toast'));
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
// Шаг согласия не закрывается ни щелчком мимо окна, ни Escape: иначе он
// обходится без ответа. Выйти из него — только «Выйти» или «Продолжить».
const authDismissible = () => el.authStepOnboarding.hidden;
el.authBackdrop.addEventListener('click', (e) => { if (e.target === el.authBackdrop && authDismissible()) closeAuthModal(); });
el.authBackdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape' && authDismissible()) closeAuthModal(); });
el.authConsentCheck.addEventListener('click', () => setConsent(!consentGiven()));
el.authConsentText.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-legal]');
  if (a) { e.preventDefault(); openLegal(a.dataset.legal); return; }
  setConsent(!consentGiven()); // подпись работает как <label>
});
el.authConsentDecline.addEventListener('click', async () => {
  try { await sb.auth.signOut(); } catch (err) { console.error('Не удалось выйти:', err); }
  currentUser = null;
  closeAuthModal();
  renderAccountBtn();
  toast(t('auth.signed_out_toast'));
});
el.authSubmit.addEventListener('click', handleAuthSubmit);
el.authSignupBtn.addEventListener('click', handleSignup);
el.authGoogleBtn.addEventListener('click', handleGoogleSignIn);
el.authOnboardingSave.addEventListener('click', () => saveOnboarding(true));
// «Пропустить» пропускает имя и назначение, но не согласие: строка профиля
// с отметкой о нём всё равно нужна — иначе шаг всплывал бы при каждом входе.
el.authOnboardingSkip.addEventListener('click', () => saveOnboarding(false));
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
    documents: state.documents || [],
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
  // Версии до «Документов» поля не шлют вовсе — своё тогда не трогаем
  // (правило в core/sync.js: pickDocuments).
  state.documents = Core.pickDocuments(state.documents, data);
  migrate();
  if (selectedId && !getTask(selectedId)) selectedId = null;
  if (state.ui.projectId && !getProject(state.ui.projectId)) {
    state.ui.view = 'home';
    state.ui.projectId = null;
  }
  lastSyncedJSON = JSON.stringify(syncPayload());
  render();
  refreshEditorsFromRemote();
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
  // Какую ветку выбрать — решает ядро (core/sync.js): это единственное
  // место, где ошибка стоит пользователю его данных, и правило обязано
  // совпадать с телефоном. Сами запросы и диалог остаются здесь.
  const plan = Core.planSignInSync({
    localHasData: Core.hasData(state),
    remoteHasData: Core.hasData(row && row.data),
    resolved: isSyncAlreadyResolved(),
  });
  if (plan === 'push') await pushSyncState();
  else if (plan === 'pull') applyRemoteData(row.data);
  else if (plan === 'ask') {
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
  // Отдельного вида «Доска» с 6 октября 2026 нет: доска — вкладка проекта.
  // Сохранённое когда-то «board» открывается как проект на этой вкладке.
  if (state.ui.view === 'board') {
    const pid = boardProjectId();
    state.ui.view = pid ? 'project' : 'home';
    if (pid) { state.ui.projectId = pid; state.ui.projectTab = 'board'; }
  }
  if (state.ui.view === 'project' && !getProject(state.ui.projectId)) state.ui.view = 'home';
  aliasTimeView();
  // Страница задачи без задачи — это её проект, а без проекта — «Сегодня».
  if (state.ui.view === 'task') {
    const task = getTask(selectedId);
    if (!task) state.ui.view = getProject(state.ui.projectId) ? 'project' : 'home';
    else state.ui.projectId = task.projectId;
  }
  const v = state.ui.view;

  document.body.classList.toggle('nav-collapsed', !!state.ui.navCollapsed);
  renderStats();
  renderNotifBadge();

  // Открытый проект подсвечен в меню сам — «Обзор» при этом не горит.
  el.navItems.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === v));
  renderNavProjects();

  const views = { home: el.homeView, projects: el.projectsView, project: el.projectView, task: el.taskView, docs: el.docsView, time: el.timeView, settings: el.settingsView };
  for (const [name, node] of Object.entries(views)) {
    const show = name === v;
    node.hidden = !show;
    if (show) { node.classList.remove('anim'); void node.offsetWidth; node.classList.add('anim'); }
  }

  if (v === 'home') renderHome();
  else if (v === 'projects') renderProjects();
  else if (v === 'project') renderProjectPage();
  else if (v === 'task') renderTaskPage();
  else if (v === 'docs') renderDocsPage();
  else if (v === 'time') renderTimePage();
  else if (v === 'settings') renderSettings();

  // Модалка задачи живёт поверх любой страницы, и общий render() про неё
  // сам не знает: без этой строки статус, поменянный в ней же, не обновлялся.
  if (!el.tmdlgBackdrop.hidden) renderTaskModal();
}

/** Старые имена экранов — «calendar» и «stats» — с 7 октября 2026 один
 *  раздел «Время»: календарь открывается в своём последнем режиме,
 *  статистика — месяцем. */
function aliasTimeView() {
  if (state.ui.view === 'calendar') {
    state.ui.view = 'time';
    if (timeMode() === 'month') state.ui.timeMode = AG_TIME_MODES.includes(agenda.mode) || agenda.mode === 'agenda' ? agenda.mode : 'week';
  } else if (state.ui.view === 'stats') {
    state.ui.view = 'time';
    state.ui.timeMode = 'month';
  }
}
const timeMode = () => state.ui.timeMode || 'week';

function openView(view) {
  flushEditor();
  closeMenu();
  closeSearch();
  state.ui.view = view;
  aliasTimeView();
  render();
  scheduleSave();
}

function toggleNav() {
  state.ui.navCollapsed = !state.ui.navCollapsed;
  document.body.classList.toggle('nav-collapsed', state.ui.navCollapsed);
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

function renderStats() {
  // Три числа «Сегодня»: день, неделя, месяц — время и деньги в основной
  // валюте. Всё время и все деньги за всю историю живут на «Времени».
  const now = new Date();
  const today = aggregateDays().get(dayKey(now)) || { ms: 0, money: 0 };
  const weekFrom = mondayOf(now);
  const weekTo = new Date(weekFrom.getTime() + 6 * 86400000);
  weekTo.setHours(23, 59, 59, 999);
  const week = rangeAgg(weekFrom, weekTo);
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const month = rangeAgg(monthFrom, monthTo);

  el.stToday.textContent = fmtDur(today.ms);
  el.stTodayMoney.textContent = fmtMoney(today.money);
  el.kpiWeekLabel.textContent = t('home.week_label', { range: `${fmtDateShort(weekFrom)}–${fmtDateShort(weekTo)}` });
  el.stWeek.textContent = fmtDur(week.ms);
  el.stWeekMoney.textContent = fmtMoney(week.money);
  el.kpiMonthLabel.textContent = monthLabel(now.getFullYear(), now.getMonth());
  el.stTime.textContent = fmtDur(month.ms);
  el.stMoney.textContent = fmtMoney(month.money);

  const total = state.tasks.length;
  const done = state.tasks.filter((t2) => t2.done).length;
  el.stDone.textContent = total ? `· ${t('home.tasks_done', { done, total })}` : '';
  renderTbTimer();
}

/** Капсула идущей задачи в шапке: время с начала записи и название. Без
 *  идущего таймера капсулы нет — пустая пилюля в шапке только путала бы. */
function renderTbTimer() {
  const at = state.activeTimer;
  const task = at && getTask(at.taskId);
  el.tbTimer.hidden = !task;
  if (!task) return;
  el.tbTimerTime.textContent = fmtClock(Date.now() - new Date(at.startedAt).getTime());
  el.tbTimerName.textContent = task.title || t('task.no_name');
}

// ---------------------------------------------------------------------------
// Сегодня
// ---------------------------------------------------------------------------

const SVG_PLAY = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6l8 5.4-8 5.4z"/></svg>';
const SVG_STOP = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>';
const hm = (d) => new Date(d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

function renderHome() {
  renderDayIsland();
  renderHomeProjects();
  renderHomeDue();
  renderNowIsland();
  renderRecentList();
}

/** Записи сегодняшнего дня вместе с идущей — для ленты по часам. */
function todaySessions() {
  const now = new Date();
  const key = dayKey(now);
  const out = [];
  for (const task of state.tasks) {
    for (const sess of task.sessions || []) {
      const start = new Date(sess.start);
      if (dayKey(start) !== key) continue;
      out.push({ task, start, end: new Date(sess.end || sess.start), running: false });
    }
  }
  const at = state.activeTimer;
  const rt = at && getTask(at.taskId);
  if (rt) {
    const start = new Date(at.startedAt);
    if (dayKey(start) === key) out.push({ task: rt, start, end: now, running: true });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** День: дата, записано, лента записей с 8 до 20 (шире, если записи были
 *  раньше или позже), идущая запись — акцентом, «сейчас» — красной линией. */
function renderDayIsland() {
  const now = new Date();
  const title = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  el.dayTitle.textContent = title.charAt(0).toUpperCase() + title.slice(1);
  const agg = aggregateDays().get(dayKey(now)) || { ms: 0, money: 0 };
  const at = state.activeTimer;
  const since = at ? ` · ${t('home.since', { time: hm(at.startedAt) })}` : '';
  el.daySub.innerHTML = `${escapeHtml(t('home.recorded'))} <b>${escapeHtml(fmtDur(agg.ms))}</b> · <b>${escapeHtml(fmtMoney(agg.money))}</b><span class="muted">${escapeHtml(since)}</span>`;

  const items = todaySessions();
  let h0 = 8;
  let h1 = 20;
  for (const it of items) {
    h0 = Math.min(h0, it.start.getHours());
    h1 = Math.max(h1, Math.min(24, it.end.getHours() + 1));
  }
  const span = (h1 - h0) * 60;
  const minOf = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 - h0 * 60;
  const pct = (m) => Math.max(0, Math.min(100, (m / span) * 100));
  el.dayTrack.innerHTML = `<div class="day-grid">${'<i></i>'.repeat(h1 - h0)}</div>`;
  for (const it of items) {
    const left = pct(minOf(it.start));
    const width = Math.max(0.4, pct(minOf(it.end)) - left);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day-blk' + (it.running ? ' run' : '');
    b.style.left = `${left}%`;
    b.style.width = `${width}%`;
    const name = it.task.title || t('task.no_name');
    b.title = `${name} · ${hm(it.start)}–${it.running ? '…' : hm(it.end)}`;
    b.setAttribute('aria-label', b.title);
    if (width > 6) b.textContent = it.running ? `${t('task.running_now')} · ${fmtShort(it.end - it.start)}` : name;
    b.addEventListener('click', () => { openProject(it.task.projectId); selectTask(it.task.id); });
    el.dayTrack.appendChild(b);
  }
  const nowMin = minOf(now);
  if (nowMin >= 0 && nowMin <= span) {
    const line = document.createElement('i');
    line.className = 'day-now';
    line.style.left = `${pct(nowMin)}%`;
    el.dayTrack.appendChild(line);
  }
  el.dayHours.innerHTML = Array.from({ length: h1 - h0 }, (_, i) => `<span>${pad2(h0 + i)}</span>`).join('');
}

/** Проекты по последней записи времени, свежие первыми. */
function recentProjects(limit) {
  const last = new Map();
  for (const task of state.tasks) {
    for (const sess of task.sessions || []) {
      const e = new Date(sess.end || sess.start).getTime();
      if (e > (last.get(task.projectId) || 0)) last.set(task.projectId, e);
    }
  }
  // Проекты с записями — по последней записи; без записей — после них, в
  // порядке создания (новые выше).
  return state.projects
    .map((p) => ({ p, last: last.get(p.id) || 0, created: new Date(p.createdAt || 0).getTime() }))
    .sort((a, b) => (b.last - a.last) || (b.created - a.created))
    .slice(0, limit)
    .map((x) => x.p);
}

function renderHomeProjects() {
  const list = recentProjects(3);
  el.homeProjects.hidden = list.length === 0;
  el.homeProjGrid.innerHTML = '';
  for (const p of list) {
    const tasks = tasksOf(p.id);
    const done = tasks.filter((t2) => t2.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hp-card';
    b.style.setProperty('--pc', p.color || PALETTE[0]);
    b.innerHTML = `<span class="hp-head"><i class="hp-dot"></i><span class="hp-name">${escapeHtml(p.name)}</span></span>`
      + `<span class="hp-figs"><span><b>${escapeHtml(fmtDur(projectMs(p.id)))}</b> · ${escapeHtml(fmtMoney(projectMoney(p.id), currencyOf(p.id)))}</span><span>${done}/${tasks.length}</span></span>`
      + `<span class="hp-bar"><i style="width:${pct}%"></i></span>`;
    b.addEventListener('click', () => openProject(p.id));
    el.homeProjGrid.appendChild(b);
  }
}

/** Сроки — та же лента, что в колокольчике: просроченное, ближайшее,
 *  сработавшие напоминания. */
function renderHomeDue() {
  const feed = notificationFeed().slice(0, 6);
  el.homeDueList.innerHTML = '';
  el.homeDueEmpty.hidden = feed.length > 0;
  const overdue = feed.filter((n) => n.kind === 'overdue').length;
  el.homeDueNote.textContent = overdue ? t('home.overdue_n', { n: overdue }) : '';
  el.homeDueNote.classList.toggle('danger', overdue > 0);
  for (const n of feed) {
    const p = getProject(n.task.projectId);
    const li = document.createElement('li');
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    li.innerHTML = `<span class="rl-main"><span class="rl-name">${escapeHtml(n.task.title || t('task.no_name'))}</span>`
      + `<span class="rl-sub"><i class="rl-dot"></i>${escapeHtml(p ? p.name : '')}${n.kind === 'reminder' ? ` · ${escapeHtml(t('notif.reminder'))}` : ''}</span></span>`
      + `<span class="rl-when${n.kind === 'overdue' ? ' overdue' : ''}">${escapeHtml(dueShort(n.task))}</span>`;
    li.addEventListener('click', () => { openProject(n.task.projectId); selectTask(n.task.id); });
    el.homeDueList.appendChild(li);
  }
}

/** Задача для острова «Сейчас идёт»: идущая, а если таймер стоит —
 *  последняя, чтобы продолжить одним нажатием. */
const nowTask = () => (state.activeTimer && getTask(state.activeTimer.taskId)) || recentTasks(1)[0] || null;

function renderNowIsland() {
  const at = state.activeTimer;
  const running = at && getTask(at.taskId);
  const task = running || recentTasks(1)[0] || null;
  el.nowIsland.hidden = !task;
  if (!task) return;
  const p = getProject(task.projectId);
  el.nowIsland.classList.toggle('idle', !running);
  el.nowLabel.textContent = running ? t('home.now_running') : t('home.now_idle');
  el.nowSince.textContent = running ? hm(at.startedAt) : t('home.continue');
  el.nowTitle.textContent = task.title || t('task.no_name');
  el.nowProj.innerHTML = `<i class="rl-dot" style="--pc:${p ? p.color : PALETTE[0]}"></i>${escapeHtml(p ? p.name : '')}`;
  el.nowBtn.className = 'sq-btn' + (running ? ' run' : '');
  el.nowBtn.innerHTML = running ? SVG_STOP : SVG_PLAY;
  el.nowBtn.setAttribute('aria-label', running ? t('timer.stop') : t('timer.start'));
  el.nowTime.textContent = fmtClock(taskElapsedMs(task));
  const earned = earnedOf(task);
  el.nowMoney.textContent = earnedShown(task, earned) ? fmtMoney(earned, currencyOf(task.projectId)) : '';
}

/** Когда по задаче последний раз шло время; 0 — записей не было. Недавнее
 *  — это то, над чем работали, а не то, что только что завели. */
function lastSessionAt(task) {
  let last = 0;
  for (const sess of task.sessions || []) last = Math.max(last, new Date(sess.end || sess.start).getTime());
  if (state.activeTimer && state.activeTimer.taskId === task.id) last = Math.max(last, Date.now());
  return last;
}
const whenLabel = (ms) => Core.fmtWhen(new Date(ms).toISOString(), locale(), t, Date.now());

function renderRecentList() {
  const recent = recentTasks(6);
  el.recentList.innerHTML = '';
  el.recentEmpty.hidden = recent.length > 0;
  for (const task of recent) {
    const p = getProject(task.projectId);
    const running = !!state.activeTimer && state.activeTimer.taskId === task.id;
    const li = document.createElement('li');
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    li.innerHTML = `<span class="rl-main"><span class="rl-name">${escapeHtml(task.title || t('task.no_name'))}</span>`
      + `<span class="rl-sub"><i class="rl-dot"></i>${escapeHtml(p ? p.name : '')} · ${escapeHtml(running ? t('task.running_now') : whenLabel(lastSessionAt(task)))}</span></span>`
      + `<button type="button" class="icon-btn rl-play${running ? ' run' : ''}" aria-label="${escapeHtml(running ? t('timer.stop') : t('timer.start'))}">${running ? SVG_STOP : SVG_PLAY}</button>`;
    li.querySelector('.rl-play').addEventListener('click', (e) => { e.stopPropagation(); if (running) stopTimer(); else startTimer(task.id); });
    li.addEventListener('click', () => { openProject(task.projectId); selectTask(task.id); });
    el.recentList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------

function renderProjects() {
  // Закреплённые — первыми, в порядке закрепления; остальные как есть.
  const projects = [...state.projects].sort((a, b) => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
    return a.pinnedAt && b.pinnedAt ? byPinned(a, b) : 0;
  });
  el.homeCount.textContent = state.projects.length ? `· ${state.projects.length}` : '';
  el.homeEmpty.hidden = state.projects.length > 0;
  fillNodes(el.projectsTrack, projects.map(projectTile));
  const recent = recentTasks(8);
  el.recentSection.hidden = recent.length === 0;
  el.recentTrack.innerHTML = '';
  recent.forEach((task) => el.recentTrack.appendChild(recentRow(task)));
}

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
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const nextDue = tasks.filter((t2) => !t2.done && t2.dueAt).map((t2) => t2.dueAt).sort()[0];

  const tile = document.createElement('article');
  tile.className = 'ptile';
  tile.style.setProperty('--pc', p.color || PALETTE[0]);
  tile.dataset.id = p.id;
  // Закрепление вынесено из меню на саму карточку: это единственное действие,
  // которое нажимают часто. Кнопка проявляется по наведению, чтобы не шуметь в
  // сетке, но у уже закреплённого проекта видна всегда — иначе нечем открепить.
  const pinTitle = p.pinnedAt ? t('project.unpin') : t('project.pin');
  tile.innerHTML = `
    <div class="ptile-head">
      <i class="ptile-dot"></i>
      <span class="ptile-name">${escapeHtml(p.name)}</span>
      <button class="ptile-pin icon-btn${p.pinnedAt ? ' on' : ''}" aria-label="${escapeHtml(pinTitle)}" title="${escapeHtml(pinTitle)}" aria-pressed="${p.pinnedAt ? 'true' : 'false'}" tabindex="-1">${icon('pin')}</button>
      <button class="ptile-menu icon-btn" aria-label="${escapeHtml(t('project.opts'))}" tabindex="-1"><svg class="icon" viewBox="0 0 16 16"><path d="M8 2.4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg></button>
    </div>
    <div class="ptile-desc">${escapeHtml(p.description || '')}</div>
    <div class="ptile-figs"><span class="ptile-time">${escapeHtml(fmtDur(projectMs(p.id)))}</span><span class="ptile-money">· ${escapeHtml(fmtMoney(projectMoney(p.id), currencyOf(p.id)))}</span><span class="ptile-note">${escapeHtml(t('home.total_label'))}</span></div>
    <span class="ptile-progress"><i style="width:${pct}%"></i></span>
    <div class="ptile-foot"><span>${escapeHtml(t('home.tasks_done', { done, total: tasks.length }))}</span><span>${escapeHtml(nextDue ? t('home.next_due', { date: fmtDateShort(nextDue) }) : t('home.no_due'))}</span></div>`;
  tile.addEventListener('click', () => openProject(p.id));
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

function recentTasks(limit) {
  return state.tasks
    .filter((t2) => !t2.done)
    .map((t2) => ({ t: t2, last: lastSessionAt(t2) }))
    .filter((x) => x.last > 0)
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Строка таблицы недавних задач: плей/стоп, задача с проектом, последняя
 *  запись, время, деньги. Строка — кнопка, плей внутри — не кнопка (кнопка в
 *  кнопке не бывает), а span с ролью. */
function recentRow(task) {
  const p = getProject(task.projectId);
  const running = !!state.activeTimer && state.activeTimer.taskId === task.id;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'recent-row';
  row.innerHTML = `<span class="icon-btn rl-play${running ? ' run' : ''}" role="button" tabindex="0" aria-label="${escapeHtml(running ? t('timer.stop') : t('timer.start'))}">${running ? SVG_STOP : SVG_PLAY}</span>`
    + `<span class="recent-main"><span class="recent-name">${escapeHtml(task.title || t('task.no_name'))}</span><span class="recent-sub"><i class="rl-dot" style="--pc:${p ? p.color : PALETTE[0]}"></i>${escapeHtml(p ? p.name : '')}</span></span>`
    + `<span class="recent-when${running ? ' run' : ''}">${escapeHtml(running ? t('task.running_now') : whenLabel(lastSessionAt(task)))}</span>`
    + `<span class="recent-num">${escapeHtml(fmtDur(taskElapsedMs(task)))}</span>`
    + `<span class="recent-num money">${escapeHtml(fmtMoney(earnedOf(task), currencyOf(task.projectId)))}</span>`;
  const play = row.querySelector('.rl-play');
  const toggle = (e) => { e.stopPropagation(); if (running) stopTimer(); else startTimer(task.id); };
  play.addEventListener('click', toggle);
  play.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  row.addEventListener('click', () => { openProject(task.projectId); selectTask(task.id); });
  return row;
}

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
  el.periodBarInfo.hidden = !calState.periodOn;
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

/** Открывает попап у anchor, показывая value ('YYYY-MM-DD' или null);
 *  onPick(key) вызывается при клике по дню.
 *
 *  С временем (opts.time = 'HH:MM', opts.onTime) под календарём появляется
 *  строка часов и минут, и окно не закрывается по выбору дня: дата и время
 *  задаются вместе, закрывает его «Готово» или щелчок мимо. */
function openDatePicker(anchorEl, value, onPick, opts) {
  closeTimePicker();
  dp.anchor = anchorEl;
  dp.value = value || null;
  dp.view = value ? keyToDate(value) : new Date();
  dp.onPick = onPick;
  dp.withTime = !!(opts && opts.time);
  dp.onTime = dp.withTime ? opts.onTime : null;
  el.dpTime.hidden = !dp.withTime;
  if (dp.withTime) {
    const [h, m] = opts.time.split(':');
    el.dpHours.value = h;
    el.dpMinutes.value = m;
  }
  dp.open = true;
  anchorEl.classList.add('on');
  renderDatePicker();
  placePopBelow(el.dpPop, anchorEl);
  setTimeout(() => document.addEventListener('pointerdown', dpOutside, true), 0);
}

/** Всплывающее окно под кнопкой, но в пределах экрана: кнопка срока стоит
 *  в правой колонке, и справа от неё места нет — окно сдвигается влево,
 *  а у нижнего края — поднимается над кнопкой. */
function placePopBelow(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pop.hidden = false;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - pw - 8));
  let top = Math.round(r.bottom + 6);
  if (top + ph > window.innerHeight - 8) top = Math.max(8, Math.round(r.top - ph - 6));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
function closeDatePicker() {
  if (!dp.open) return;
  dp.open = false;
  el.dpPop.hidden = true;
  if (dp.anchor) dp.anchor.classList.remove('on');
  document.removeEventListener('pointerdown', dpOutside, true);
}
function dpOutside(e) {
  // Список часов или минут — это общее меню поверх окна; щелчок по нему —
  // не «мимо».
  if (el.ctxMenu.contains(e.target)) return;
  if (!el.dpPop.contains(e.target) && e.target !== dp.anchor) closeDatePicker();
}

/** Время из полей, если оба числа в пределах суток; иначе null. */
function dpTimeValue() {
  const h = Number(el.dpHours.value);
  const m = Number(el.dpMinutes.value);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}
function dpCommitTime() {
  const v = dpTimeValue();
  if (!v || !dp.onTime) return;
  const [h, m] = v.split(':');
  el.dpHours.value = h;
  el.dpMinutes.value = m;
  dp.onTime(v);
}
/** Список значений для поля: часы — все 24, минуты — через пять. Руками
 *  можно вписать любую минуту. */
function dpPickFrom(btn, input, values) {
  openMenu(btn, values.map((v) => ({
    label: pad2(v),
    selected: Number(input.value) === v,
    onClick: () => { input.value = pad2(v); dpCommitTime(); },
  })));
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
      if (dp.withTime) renderDatePicker(); else closeDatePicker();
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
  placePopBelow(el.tpPop, anchorEl);
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
  const { ms, money } = calRangeAgg(from, toEnd);
  const label = calState.mode === 'month' ? t('calendar.for_month') : t('calendar.for_week');
  el.calViewTot.hidden = false;
  el.calViewTot.classList.remove('period');
  el.calViewTot.innerHTML = `<span>${escapeHtml(label)}</span><b>${fmtDur(ms)} · ${fmtMoney(money)}</b>`;
}

function renderCalendar() {
  if (calState.mode === 'day') { el.calViewTot.hidden = true; renderDayHours(); return; }
  renderViewTotal();

  const days = calAggregateDays();
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
    if (c == null) { cell.classList.add('empty'); cell.disabled = true; cell.setAttribute('aria-hidden', 'true'); el.calDays.appendChild(cell); continue; }
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
  const sessions = calSessionPairs()
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
  const items = calSessionPairs()
    .filter(({ s }) => dayKey(s.start) === key)
    .sort((a, b) => new Date(a.s.start) - new Date(b.s.start))
    .map(({ t: t2, s }) => ({ t: t2, s, ms: s.ms, money: sessionMoney(s, t2) }));

  const totalMs = items.reduce((a, r) => a + r.ms, 0);
  // Итог дня — только по проектам в основной валюте; строки — каждая в своей.
  const scope = Core.moneyScope(state.tasks, state.projects, state.settings.currency);
  const totalMoney = items.reduce((a, r) => a + (scope.has(r.t.id) ? r.money : 0), 0);

  // Записи разложены по проектам: за день их набирается из нескольких сразу,
  // и плоский список не отвечал на вопрос «сколько ушло на что».
  el.calDayList.innerHTML = '';
  for (const g of groupByProject(items)) {
    el.calDayList.appendChild(calGroupNode(g, ({ t: t2, s, money }) => {
      const row = document.createElement('li');
      row.style.setProperty('--pc', g.project ? g.project.color : PALETTE[0]);
      // Название проекта ушло в заголовок группы — в строке оно повторялось бы.
      row.innerHTML = `
        <div class="cdl-time">${fmtTime(s.start).slice(0, 5)}–${s.end ? fmtTime(s.end).slice(0, 5) : '…'}</div>
        <div class="cdl-dur">${fmtDur(s.ms)}</div>
        <div class="cdl-task">${escapeHtml(t2.title || t('task.no_name'))}</div>
        <div class="cdl-money">${fmtMoney(money, currencyOf(t2.projectId))}</div>`;
      row.addEventListener('click', () => { openProject(t2.projectId); selectTask(t2.id); });
      return row;
    }));
  }
  el.calDayTot.textContent = items.length ? `${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}` : '';
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
  for (const { t: t2, s } of calSessionPairs()) {
    const d = new Date(s.start);
    if (d < from || d > to) continue;
    let e = map.get(t2.id);
    if (!e) { e = { t: t2, ms: 0, money: 0 }; map.set(t2.id, e); }
    e.ms += s.ms;
    e.money += sessionMoney(s, t2);
  }
  const tasks = [...map.values()].sort((a, b) => b.ms - a.ms);
  const totalMs = tasks.reduce((a, x) => a + x.ms, 0);
  const scope = Core.moneyScope(state.tasks, state.projects, state.settings.currency);
  const totalMoney = tasks.reduce((a, x) => a + (scope.has(x.t.id) ? x.money : 0), 0);

  el.calDayTot.textContent = tasks.length ? `${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}` : '';
  el.periodBarRange.textContent = el.calDayHead.textContent;
  el.periodBarSum.textContent = `${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}`;
  el.calViewTot.hidden = false;
  el.calViewTot.classList.add('period');
  el.calViewTot.innerHTML = `<span>${escapeHtml(t('calendar.period_label'))}</span>`
    + `<b>${fmtDur(totalMs)} · ${fmtMoney(totalMoney)}</b>`;
  el.calDayEmpty.hidden = tasks.length > 0;

  el.calDayList.innerHTML = '';
  for (const g of groupByProject(tasks)) {
    el.calDayList.appendChild(calGroupNode(g, ({ t: t2, ms, money }) => {
      const row = document.createElement('li');
      row.style.setProperty('--pc', g.project ? g.project.color : PALETTE[0]);
      row.innerHTML = `
        <span class="pl-check${t2.done ? ' done' : ''}">${icon('check')}</span>
        <span><span class="pl-name">${escapeHtml(t2.title || t('task.no_name'))}</span></span>
        <span class="pl-right"><span class="pl-money">${fmtMoney(money, currencyOf(t2.projectId))}</span><span class="pl-time">${fmtDur(ms)}</span></span>`;
      row.addEventListener('click', () => { openProject(t2.projectId); selectTask(t2.id); });
      return row;
    }));
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
  if ((state.ui.view === 'project' || state.ui.view === 'task') && getProject(state.ui.projectId)) return state.ui.projectId;
  if (state.ui.boardProjectId && getProject(state.ui.boardProjectId)) return state.ui.boardProjectId;
  return state.projects[0] ? state.projects[0].id : null;
}

function renderBoardPage() {
  const pid = boardProjectId();
  state.ui.boardProjectId = pid;
  el.boardEmpty.hidden = !!pid;
  el.boardCols.hidden = !pid;
  if (!pid) { el.boardCols.innerHTML = ''; return; }
  renderBoard();
}

function renderBoard() {
  const pid = boardProjectId();
  const tasks = tasksOf(pid);
  el.boardCols.innerHTML = '';
  // Пока у проекта нет ни одной версии, доска остаётся ровно такой, какой
  // была: одна-единственная дорожка — это не дорожка, а лишняя полоса над
  // столбцами.
  const lanes = versionsOf(pid).length ? Core.boardLanes(state.versions, tasks, pid) : null;
  el.boardCols.classList.toggle('has-lanes', !!lanes);
  if (!lanes) {
    for (const st of orderedStatuses(pid)) el.boardCols.appendChild(boardColumn(pid, st, tasks, undefined));
    return;
  }
  for (const lane of lanes) el.boardCols.appendChild(boardLane(pid, lane));
  syncLaneWidth();
  syncLaneOffset();
}

/** Ширина видимой части доски — в переменную --lane-w, из неё заголовок
 *  дорожки берёт свою. Сама дорожка шире окна, когда столбцов много, и
 *  проценты в CSS считались бы от неё, а не от того, что видно. */
function syncLaneWidth() {
  const box = el.boardCols;
  const cs = getComputedStyle(box);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const next = Math.max(0, Math.round(box.clientWidth - pad)) + 'px';
  // Пишем только на изменение: наблюдатель ниже сработал бы на собственную
  // правку и закрутился бы.
  if (box.style.getPropertyValue('--lane-w') !== next) box.style.setProperty('--lane-w', next);
}

/** Гасит горизонтальный сдвиг доски у заголовков дорожек. position: sticky
 *  тут бессилен: он двигает элемент только внутри его дорожки, а заголовок
 *  теперь ровно её ширины — сдвигаться некуда. */
function syncLaneOffset() {
  const box = el.boardCols;
  const next = Math.round(box.scrollLeft) + 'px';
  if (box.style.getPropertyValue('--lane-x') !== next) box.style.setProperty('--lane-x', next);
}

// Доска меняет ширину не только вместе с окном: сворачивается боковая
// панель, открывается панель уведомлений. Наблюдатель ловит всё разом.
if (typeof ResizeObserver !== 'undefined' && el.boardCols) {
  new ResizeObserver(() => {
    if (el.boardCols.classList.contains('has-lanes')) syncLaneWidth();
  }).observe(el.boardCols);
}
if (el.boardCols) el.boardCols.addEventListener('scroll', syncLaneOffset, { passive: true });

// Полоса прокрутки у календарной сетки появляется и пропадает вместе с
// размером окна — ловим это тем же наблюдателем, что и доску.
if (typeof ResizeObserver !== 'undefined' && el.agScroll) {
  new ResizeObserver(() => syncAgendaScrollbar()).observe(el.agScroll);
}

/** Свёрнутость дорожки живёт в ui, а не в данных: это способ смотреть, и на
 *  второе устройство он уезжать не должен — как и выбор проекта на доске. */
const laneKey = (pid, version) => `${pid}:${version ? version.id : 'none'}`;

function laneCollapsed(pid, version) {
  const map = state.ui.lanesClosed || {};
  const key = laneKey(pid, version);
  // Выпущенная версия закрыта, и раскрывать её при каждом открытии доски
  // незачем. Но если её однажды развернули руками — так и останется.
  return key in map ? !!map[key] : !!(version && version.releasedAt);
}

function toggleLane(pid, version) {
  if (!state.ui.lanesClosed) state.ui.lanesClosed = {};
  state.ui.lanesClosed[laneKey(pid, version)] = !laneCollapsed(pid, version);
}

/** Дорожка версии: заголовок, под ним — обычные столбцы статусов. Столбцы
 *  повторяются в каждой дорожке, потому что иначе карточку некуда класть;
 *  заодно в заголовке столбца видно время по этой версии, а не по всему
 *  проекту. */
function boardLane(pid, lane) {
  const v = lane.version;
  const sec = document.createElement('section');
  sec.className = 'board-lane';
  sec.dataset.versionId = v ? v.id : '';
  const collapsed = laneCollapsed(pid, v);
  sec.classList.toggle('collapsed', collapsed);

  const ms = lane.tasks.reduce((a, t2) => a + taskElapsedMs(t2), 0);
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'board-lane-head' + (v && v.releasedAt ? ' released' : '');
  head.title = t('version.lane_toggle');
  head.setAttribute('aria-expanded', String(!collapsed));
  head.innerHTML = `
    <svg class="icon lane-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.3 6.2a.95.95 0 011.34 0L8 8.56l2.36-2.36a.95.95 0 111.34 1.34l-3.03 3.03a.95.95 0 01-1.34 0L4.3 7.54a.95.95 0 010-1.34z"/></svg>
    <span class="lane-name">${escapeHtml(v ? (v.name || t('task.no_name')) : t('version.none'))}</span>
    ${v && v.releasedAt ? `<span class="lane-released">${escapeHtml(t('version.released_on', { date: fmtDateShort(v.releasedAt) }))}</span>` : ''}
    <span class="board-count">${lane.tasks.length}</span>
    <span class="board-col-time">${fmtDur(ms)}</span>`;
  head.addEventListener('click', () => { toggleLane(pid, v); renderBoard(); scheduleSave(); });
  // Заголовок тоже принимает карточки, и это не украшение: у свёрнутой
  // дорожки столбцов на экране нет, и отправить туда задачу было бы нечем.
  laneDropTarget(head, v ? v.id : null);
  sec.appendChild(head);

  const row = document.createElement('div');
  row.className = 'board-lane-cols';
  for (const st of orderedStatuses(pid)) row.appendChild(boardColumn(pid, st, lane.tasks, v ? v.id : null));
  sec.appendChild(row);
  return sec;
}

/** Приём карточки на заголовок дорожки: меняется только версия, статус
 *  остаётся прежним. */
function laneDropTarget(node, versionId) {
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('over'); });
  node.addEventListener('dragleave', () => node.classList.remove('over'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('over');
    const task = getTask(e.dataTransfer.getData('text/plain'));
    if (!task || task.versionId === versionId) return;
    task.versionId = versionId;
    task.updatedAt = new Date().toISOString();
    render();
    scheduleSave();
  });
}

/** Один столбец доски.
 *
 *  @param {string|null|undefined} laneVersionId — версия дорожки, в которой
 *  стоит столбец. undefined значит «доска без дорожек»: версию задачи такой
 *  столбец не трогает вовсе. null — дорожка «Без версии»: перенос туда
 *  версию снимает. */
function boardColumn(pid, st, tasks, laneVersionId) {
  const col = document.createElement('section');
  col.className = 'board-col';
  col.dataset.statusId = st.id;
  col.style.setProperty('--sc', st.color);

  const inCol = tasks.filter((t2) => t2.statusId === st.id);
  const head = document.createElement('div');
  head.className = 'board-col-head';
  // Сумма времени по колонке — справа, у края. Она отвечает на вопрос, на
  // который счётчик задач не отвечает: сколько работы там реально лежит.
  const colMs = inCol.reduce((a, t2) => a + taskElapsedMs(t2), 0);
  head.innerHTML = `<span class="board-dot"></span><span class="board-col-name">${escapeHtml(st.name)}</span><span class="board-count">${inCol.length}</span><span class="board-col-time">${fmtDur(colMs)}</span>`;
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
  add.addEventListener('click', () => newTaskInStatus(pid, st.id, laneVersionId || null));
  body.appendChild(add);
  col.appendChild(body);

  // Подсветка столбца под курсором и сам перенос. На доске с дорожками
  // перенос меняет разом и статус, и версию — именно так задача и
  // переезжает из выпуска в выпуск.
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', () => col.classList.remove('over'));
  col.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('over');
    const task = getTask(e.dataTransfer.getData('text/plain'));
    if (!task) return;
    const moveVersion = laneVersionId !== undefined && task.versionId !== laneVersionId;
    if (task.statusId === st.id && !moveVersion) return;
    if (task.statusId !== st.id) setTaskStatus(task, st.id);
    if (moveVersion) {
      task.versionId = laneVersionId;
      task.updatedAt = new Date().toISOString();
    }
    render();
    scheduleSave();
  });

  return col;
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

// --- Теги -------------------------------------------------------------------
// Теги общие на всё приложение, а не свои у каждого проекта, как статусы: один
// и тот же тег живёт и на проекте, и на задаче в любом другом проекте.
// Отбор, поиск и подсчёт использований — в core/tags.js, здесь только то, что
// трогает разметку и состояние.

const getTag = (id) => Core.getTag(state.tags, id);
const tagsOf = (ids) => Core.tagsOf(state.tags, ids);
const tagUsage = (id) => Core.tagUsage(state.projects, state.tasks, id);

/** Подпись об использовании тега. Нулевые части не попадают в строку: «задач:
 *  0» — это не сведения, а шум, из-за которого приходится читать строку
 *  целиком, чтобы понять, что тег нигде не стоит. */
function tagUsageLabel(u) {
  const parts = [];
  if (u.projects) parts.push(t('tag.used_projects', { n: u.projects }));
  if (u.tasks) parts.push(t('tag.used_tasks', { n: u.tasks }));
  return parts.length ? parts.join(' · ') : t('tag.unused');
}

/** Разметка чипа — отдельно от сборки узла: доска рисуется строками, а
 *  редактор узлами, и двух описаний одного и того же чипа быть не должно. */
// Цветной точки внутри бейджа нет: цвет несёт сама подложка, и точка рядом с
// ней была бы вторым сообщением об одном и том же. Точка осталась там, где
// подложки нет — в списке настроек и в пикере.
const tagChipHtml = (tag) =>
  `<span class="tag-chip" data-id="${escapeHtml(tag.id)}" style="--sc:${escapeHtml(tag.color || PALETTE[0])}">`
  + `<span class="tag-name">${escapeHtml(tag.name || '')}</span></span>`;

/** Чипы сущности одной строкой — для мест, которые собираются через innerHTML. */
const tagChipsHtml = (ids) => tagsOf(ids).map(tagChipHtml).join('');

/** Чип тега. Если передан onRemove — у чипа появляется крестик. */
function tagChip(tag, onRemove) {
  const box = document.createElement('div');
  box.innerHTML = tagChipHtml(tag);
  const chip = box.firstElementChild;
  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tag-chip-x';
    x.title = t('common.delete');
    x.innerHTML = icon('x');
    x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(tag.id); });
    chip.appendChild(x);
  }
  return chip;
}

function renderTagChips(box, ids, onRemove) {
  box.innerHTML = '';
  for (const tag of tagsOf(ids)) box.appendChild(tagChip(tag, onRemove));
}

/** Теги в шапке: первые три, а если не помещаются рядом с названием —
 *  меньше, вплоть до одного «+N». Название важнее тегов, поэтому уступают
 *  они. Меряется после отрисовки: ширина зависит и от окна, и от имён. */
function fitHeaderTags(p) {
  let cap = 3;
  renderTagChipsCapped(el.phTags, p.tagIds, cap);
  while (cap > 0 && el.phTags.scrollWidth > el.phTags.clientWidth + 1) {
    cap -= 1;
    renderTagChipsCapped(el.phTags, p.tagIds, cap);
  }
  // Не помещается даже «+N» — лучше без тегов, чем с обрезанным чипом.
  if (el.phTags.scrollWidth > el.phTags.clientWidth + 1) el.phTags.hidden = true;
}

/** Первые max чипов и «+N» за остальные; имена остальных — подсказкой. */
function renderTagChipsCapped(box, ids, max) {
  box.innerHTML = '';
  const all = tagsOf(ids);
  for (const tag of all.slice(0, max)) box.appendChild(tagChip(tag));
  if (all.length > max) {
    const more = elt('span', 'tag-chip tag-more', `+${all.length - max}`);
    more.title = all.slice(max).map((tg) => tg.name).join(', ');
    box.appendChild(more);
  }
}

/** Список тегов в настройках. Счётчик использований здесь не украшение: по
 *  нему видно, какие теги живые, а какие можно убрать. */
function renderTagsSettings() {
  el.tagsList.innerHTML = '';
  const globalTags = state.tags.filter(Core.isGlobalTag);
  if (!globalTags.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row tags-empty';
    empty.innerHTML = `<span class="settings-row-label muted">${escapeHtml(t('tag.empty_hint'))}</span>`;
    el.tagsList.appendChild(empty);
    return;
  }
  for (const tag of globalTags) {
    const u = tagUsage(tag.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-row settings-row-btn';
    row.dataset.id = tag.id;
    row.innerHTML = `
      <span class="tag-dot" style="--sc:${escapeHtml(tag.color || PALETTE[0])}"></span>
      <span class="settings-row-label">${escapeHtml(tag.name || '')}</span>
      <span class="settings-row-value">${escapeHtml(tagUsageLabel(u))}</span>`;
    row.addEventListener('click', () => openTagDialog(tag));
    el.tagsList.appendChild(row);
  }
}

const tagdlg = { editing: null, color: PALETTE[0], after: null, projectId: null };

function buildTagSwatches() {
  el.tagdlgSwatches.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c === tagdlg.color ? ' sel' : '');
    b.style.background = c;
    b.addEventListener('click', () => { tagdlg.color = c; buildTagSwatches(); });
    el.tagdlgSwatches.appendChild(b);
  }
}

/** @param {object|null} tag — редактируемый тег или null для нового
 *  @param {string} [presetName] — имя, набранное в пикере
 *  @param {function} [after] — что сделать с созданным тегом (повесить его) */
/** @param {string|null} [projectId] — проект, которому принадлежит новый
 *  тег; пусто — общий. У существующего тега область не меняется. */
function openTagDialog(tag, presetName, after, projectId) {
  tagdlg.editing = tag || null;
  tagdlg.color = tag ? (tag.color || PALETTE[0]) : PALETTE[state.tags.length % PALETTE.length];
  tagdlg.after = after || null;
  tagdlg.projectId = tag ? (tag.projectId || null) : (projectId || null);
  const scopeProject = tagdlg.projectId ? getProject(tagdlg.projectId) : null;
  const title = tag ? t('tag.dialog_edit') : t('tag.dialog_new');
  el.tagdlgTitle.textContent = scopeProject ? `${title} · ${scopeProject.name}` : title;
  el.tagdlgName.value = tag ? (tag.name || '') : (presetName || '');
  el.tagdlgError.hidden = true;
  el.tagdlgDelete.hidden = !tag;
  buildTagSwatches();
  el.tagdlgBackdrop.hidden = false;
  el.tagdlgName.focus();
  el.tagdlgName.select();
}

function closeTagDialog() {
  el.tagdlgBackdrop.hidden = true;
  tagdlg.editing = null;
  tagdlg.after = null;
}

function saveTagDialog() {
  const name = el.tagdlgName.value.trim();
  if (!name) { el.tagdlgName.focus(); return; }
  // Два тега с одинаковым именем различить на глаз нельзя, и заводить оба
  // бессмысленно — поэтому отказ с объяснением, а не молчаливое создание.
  if (Core.nameTaken(state.tags, name, tagdlg.editing ? tagdlg.editing.id : null, tagdlg.projectId)) {
    el.tagdlgError.textContent = t('tag.name_taken');
    el.tagdlgError.hidden = false;
    el.tagdlgName.focus();
    return;
  }
  let created = null;
  if (tagdlg.editing) {
    Object.assign(tagdlg.editing, { name, color: tagdlg.color });
  } else {
    created = { id: uid(), name, color: tagdlg.color, projectId: tagdlg.projectId };
    state.tags.push(created);
  }
  const after = tagdlg.after;
  closeTagDialog();
  if (after) after(created);
  render();
  scheduleSave();
}

/** Удаление тега. Переносить его некуда — тег просто снимается со всех
 *  сущностей, поэтому предупреждение называет, скольких это коснётся. */
async function deleteTagFromDialog() {
  const tag = tagdlg.editing;
  if (!tag) return;
  const u = tagUsage(tag.id);
  const message = u.projects + u.tasks
    ? t('tag.delete_used', { name: tag.name, n: tagUsageLabel(u) })
    : t('tag.delete_confirm', { name: tag.name });
  const ok = await confirmDialog(message);
  if (!ok) return;
  state.tags = state.tags.filter((x) => x.id !== tag.id);
  for (const p of state.projects) p.tagIds = (p.tagIds || []).filter((id) => id !== tag.id);
  for (const task of state.tasks) task.tagIds = (task.tagIds || []).filter((id) => id !== tag.id);
  closeTagDialog();
  render();
  scheduleSave();
}

/** Пикер тегов — один на все места, где теги вешают. Поле ввода служит и
 *  поиском, и входом в создание: если набранного имени нет ни у одного тега,
 *  внизу появляется «Создать тег».
 *  @param {Element} anchor — у чего открыть
 *  @param {function} getIds — текущие теги сущности
 *  @param {function} setIds — куда записать новый набор */
/** @param {string|null} [projectId] — в каком проекте выбираем: видны общие
 *  теги и его собственные; новый тег из пикера заводится проектным. */
function openTagPicker(anchor, getIds, setIds, projectId) {
  document.querySelectorAll('.tag-pop').forEach((n) => n.remove());
  const visible = () => Core.tagsForProject(state.tags, projectId || null);
  const pop = document.createElement('div');
  pop.className = 'tag-pop';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'tag-pop-search';
  search.placeholder = t('tag.search_ph');
  const list = document.createElement('div');
  list.className = 'tag-pop-list';
  pop.append(search, list);

  const draw = () => {
    const ids = getIds();
    const query = search.value.trim();
    list.innerHTML = '';

    for (const tag of Core.searchTags(visible(), query)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tag-pop-item' + (ids.includes(tag.id) ? ' sel' : '');
      row.innerHTML = `<span class="tag-dot" style="--sc:${escapeHtml(tag.color || PALETTE[0])}"></span>`
        + `<span class="tag-pop-name">${escapeHtml(tag.name || '')}</span>`
        + (Core.isGlobalTag(tag) ? `<span class="tag-pop-scope">${escapeHtml(t('tag.scope_global'))}</span>` : '');
      row.addEventListener('click', () => { setIds(Core.toggleTag(getIds(), tag.id)); draw(); });
      list.appendChild(row);
    }

    if (query && !Core.exactMatch(visible(), query)) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'tag-pop-create';
      create.textContent = t('tag.create_named', { name: query });
      create.addEventListener('click', () => {
        pop.remove();
        openTagDialog(null, query, (made) => { if (made) setIds([...getIds(), made.id]); }, projectId || null);
      });
      list.appendChild(create);
    } else if (!visible().length) {
      const empty = document.createElement('div');
      empty.className = 'tag-pop-empty muted';
      empty.textContent = t('tag.none');
      list.appendChild(empty);
    }
  };

  search.addEventListener('input', draw);
  draw();
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  // Если внизу не помещается — открываем вверх, а не за краем. Внутри окна
  // край — низ самого окна: иначе список ложился поверх его кнопок, и
  // «Сохранить» приходилось искать под ним.
  const modal = anchor.closest('.modal');
  const floor = (modal ? modal.getBoundingClientRect().bottom : innerHeight) - 8;
  const below = r.bottom + 6;
  pop.style.top = below + pop.offsetHeight > floor
    ? `${Math.max(8, r.top - pop.offsetHeight - 6)}px`
    : `${below}px`;

  const away = (e) => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', away);
  };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
  search.focus();
}

/** Теги открытой задачи. */
function renderTaskTags(task) {
  renderTagChips(el.taskTags, task.tagIds, (id) => {
    task.tagIds = Core.toggleTag(task.tagIds, id);
    touchTask(task);
    render();
    scheduleSave();
  });
}

// --- Настройка статусов проекта --------------------------------------------

/** Набор статусов настраивается у каждого проекта отдельно, поэтому диалог
 *  открывается с доски — страницы, которая этим набором и живёт. */
/** Шестерёнка на доске и «Статусы и версии» в меню: то же окно проекта,
 *  открытое на статусах. */
function openStatusDialog() {
  const p = getProject(boardProjectId());
  if (p) openProjectDialog(p, 'statuses');
}

function renderStatusDialog() {
  const pid = pdlgProjectId();
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
  // Сами правила — в ядре: телефон удаляет статусы тем же кодом, и разойтись
  // они уже не могут.
  const plan = Core.planStatusDelete(state.statuses, state.tasks, st.id);
  if (plan.blocked === 'last') { toast(t('status.delete_last')); return; }
  if (plan.blocked === 'last_done') { toast(t('status.delete_last_done')); return; }
  if (plan.blocked) return;
  const { target, moving } = plan;
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
  const pid = pdlgProjectId();
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
function newTaskInStatus(projectId, statusId, versionId) {
  const now = new Date().toISOString();
  const task = {
    id: uid(), projectId, title: '', done: false, notes: null,
    totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
    statusId, tagIds: [], versionId: versionId || null, repeat: null, cancelled: false,
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
  // Время и деньги показываются всегда, даже нулевые: строка под названием
  // остаётся одной высоты, и карточки не прыгают, когда таймер тронули.
  // Время считается вместе с идущим таймером — иначе доска расходится с
  // карточкой задачи ровно на то время, которое идёт прямо сейчас.
  const chips = tagChipsHtml(task.tagIds);
  card.innerHTML = `
    <div class="bc-title">${escapeHtml(task.title || t('task.no_name'))}</div>
    ${chips ? `<div class="tag-chips bc-tags">${chips}</div>` : ''}
    <div class="bc-foot">
      <span class="bc-time">${icon('clock')} ${fmtDur(taskElapsedMs(task))}</span>
      <span class="bc-money">${escapeHtml(fmtMoney(earnedOf(task), currencyOf(task.projectId)))}</span>
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

const projectTab = () => (['board', 'versions'].includes(state.ui.projectTab) ? state.ui.projectTab : 'list');

/** Экран проекта: шапка и одна из трёх вкладок. */
function renderProjectPage() {
  renderProjectHeader();
  const tab = projectTab();
  el.projTabs.forEach((b) => b.classList.toggle('on', b.dataset.ptab === tab));
  el.projList.hidden = tab !== 'list';
  el.projBoard.hidden = tab !== 'board';
  el.projVersions.hidden = tab !== 'versions';
  if (tab === 'list') {
    renderSidebar();
    renderProjectSide();
  } else if (tab === 'board') {
    renderBoardPage();
  } else {
    renderVersionsTab();
  }
}

/** Шапка одной строкой: название, вкладки, итоги. Описание — подсказкой на
 *  названии: в строке ему места нет, а терять его не хочется. */
function renderProjectHeader() {
  const p = getProject(state.ui.projectId);
  if (!p) return;
  el.phName.textContent = p.name;
  el.phName.title = p.description || '';
  el.phDesc.textContent = p.description || '';
  el.phDesc.hidden = !p.description;
  el.phDot.style.background = p.color || PALETTE[0];
  // Теги проекта — рядом с названием. Здесь они только показываются: менять их
  // логично там же, где название и цвет, то есть в окне проекта.
  el.phTags.hidden = !tagsOf(p.tagIds).length;
  el.ptabVerCount.textContent = versionsOf(p.id).length || '';

  const tasks = visibleTasks();
  el.projectEarned.textContent = '';
  if (tasks.length) {
    const done = tasks.filter((t2) => t2.done).length;
    el.projectEarned.append(
      elt('b', null, fmtDur(projectMs(p.id))),
      elt('b', 'kpi-money', fmtMoney(projectMoney(p.id), currencyOf(p.id))),
      elt('span', null, t('project.done_of', { done, total: tasks.length })),
    );
  }
  // Теги меряются последними: они делят строку с числами проекта, и до
  // того, как числа встали, места у тегов больше, чем будет.
  fitHeaderTags(p);
}

/** Правая колонка проекта: прогресс по статусам, версии, последние записи. */
function renderProjectSide() {
  const pid = state.ui.projectId;
  const tasks = visibleTasks();
  const done = tasks.filter((t2) => t2.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  el.ppDone.textContent = String(done);
  el.ppOf.textContent = t('project.of_done', { total: tasks.length });
  el.ppPct.textContent = tasks.length ? `${pct}%` : '';
  // Полоса и легенда — по статусам проекта в порядке столбцов доски.
  el.ppBar.innerHTML = '';
  el.ppLegend.innerHTML = '';
  for (const st of orderedStatuses(pid)) {
    const n = tasks.filter((t2) => t2.statusId === st.id).length;
    if (!n) continue;
    const seg = document.createElement('i');
    seg.style.width = `${(n / tasks.length) * 100}%`;
    seg.style.background = st.color;
    el.ppBar.appendChild(seg);
    const li = document.createElement('span');
    li.innerHTML = `<i style="background:${escapeHtml(st.color)}"></i>${escapeHtml(st.name)} · ${n}`;
    el.ppLegend.appendChild(li);
  }

  const rows = Core.versionRows(state.tasks, state.versions, pid, { rates: rates(), activeTimer: state.activeTimer, now: Date.now() });
  el.projVersionsCard.hidden = versionsOf(pid).length === 0;
  el.pvRows.innerHTML = '';
  for (const r of rows.slice(0, 4)) {
    const row = document.createElement('div');
    row.className = 'pv-row';
    if (!r.id) {
      row.className = 'pv-none';
      row.textContent = `${t('version.none')} — ${t('project.of_done', { total: r.total }).replace(/^·\s*/, '')}`;
    } else {
      row.innerHTML = `<div class="pv-head"><span class="pv-name">${escapeHtml(r.name || t('task.no_name'))}</span><span class="pv-sum">${escapeHtml(t('project.done_of', { done: r.done, total: r.total }))} · ${escapeHtml(fmtDur(r.ms))}</span></div>`
        + `<span class="pv-bar"><i style="width:${r.total ? Math.round((r.done / r.total) * 100) : 0}%"></i></span>`;
      row.addEventListener('click', () => {
        taskFilter = { status: 'all', versionId: r.id };
        state.ui.projectTab = 'list';
        render();
        scheduleSave();
      });
    }
    el.pvRows.appendChild(row);
  }

  // Последние записи по всем задачам проекта.
  const recs = [];
  for (const task of tasksOf(pid)) {
    for (const sess of task.sessions || []) recs.push({ task, sess, at: new Date(sess.end || sess.start).getTime() });
  }
  recs.sort((a, b) => b.at - a.at);
  el.psList.innerHTML = '';
  el.psEmpty.hidden = recs.length > 0;
  for (const r of recs.slice(0, 5)) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rl-when">${escapeHtml(whenLabel(r.at))}</span>`
      + `<span class="rl-main"><span class="rl-name">${escapeHtml(r.task.title || t('task.no_name'))}</span></span>`
      + `<span class="rl-money">${escapeHtml(fmtDur(r.sess.ms))}</span>`;
    li.addEventListener('click', () => selectTask(r.task.id));
    el.psList.appendChild(li);
  }
}

/** Проекты в левом меню — в том же порядке, что на «Обзоре»: закреплённые
 *  сверху. Рядом — сколько задач ещё не готово. */
function renderNavProjects() {
  const pinned = state.projects.filter((p) => p.pinnedAt).sort(byPinned);
  const rest = state.projects.filter((p) => !p.pinnedAt);
  el.navProjects.textContent = '';
  for (const p of [...pinned, ...rest]) {
    const b = elt('button', 'nav-item nav-project');
    b.type = 'button';
    b.title = p.name;
    b.dataset.projectId = p.id;
    b.classList.toggle('active', (state.ui.view === 'project' || state.ui.view === 'task') && state.ui.projectId === p.id);
    const dot = elt('span', 'nav-pdot');
    dot.style.background = p.color || PALETTE[0];
    const open = tasksOf(p.id).filter((t2) => !t2.done).length;
    b.append(dot, elt('span', 'nav-label nav-pname', p.name), elt('span', 'nav-pcount', open ? String(open) : ''));
    b.addEventListener('click', () => openProject(p.id));
    el.navProjects.appendChild(b);
  }
}

/** Вкладка «Версии»: по каждой — готовые из всех, время и деньги. Что
 *  сколько стоит, считает ядро (versionRows); щелчок по версии открывает
 *  список, отфильтрованный по ней. */
function renderVersionsTab() {
  const pid = state.ui.projectId;
  const rows = Core.versionRows(state.tasks, state.versions, pid, {
    rates: rates(), activeTimer: state.activeTimer, now: Date.now(),
  });
  el.pverList.textContent = '';
  el.pverEmpty.hidden = versionsOf(pid).length > 0;
  for (const r of rows) {
    const li = elt('li', 'pver-row' + (r.released ? ' released' : ''));
    const head = elt('div', 'pver-head');
    head.append(
      elt('span', 'pver-name', r.id ? (r.name || t('task.no_name')) : t('version.none')),
      elt('span', 'pver-state', r.id ? (r.released ? t('version.released_on', { date: fmtDateShort(r.releasedAt) }) : t('version.in_progress')) : ''),
    );
    const bar = elt('div', 'pver-bar');
    const fill = elt('span', 'pver-fill');
    fill.style.width = `${r.total ? Math.round((r.done / r.total) * 100) : 0}%`;
    bar.appendChild(fill);
    const meta = elt('div', 'pver-meta');
    meta.append(
      elt('span', null, t('project.done_of', { done: r.done, total: r.total })),
      elt('span', null, fmtDur(r.ms)),
      elt('b', 'kpi-money', fmtMoney(r.money, currencyOf(pid))),
    );
    li.append(head, bar, meta);
    li.addEventListener('click', () => {
      taskFilter = { status: 'all', versionId: r.id || 'none' };
      state.ui.projectTab = 'list';
      render();
      scheduleSave();
    });
    el.pverList.appendChild(li);
  }
}


function renderSidebar() {
  el.tfStatus.forEach((b) => b.classList.toggle('on', b.dataset.status === taskFilter.status));
  renderTaskVersionFilter();
  el.taskList.innerHTML = '';

  // Группы — по статусам в порядке столбцов доски, закреплённые сверху;
  // решает ядро (projectListGroups). Фильтр сужает задачи, группы остаются.
  const list = isFilterActive() ? filteredProjectTasks() : visibleTasks();
  el.sidebarEmpty.innerHTML = list.length === 0 && visibleTasks().length > 0
    ? escapeHtml(t('sidebar.no_match'))
    : t('sidebar.empty_default');
  el.sidebarEmpty.hidden = list.length > 0;

  const groups = Core.projectListGroups(list, {
    statuses: state.statuses,
    projectId: state.ui.projectId,
    collapsed: state.ui.collapsedGroups || [],
    activeTimer: state.activeTimer,
    now: Date.now(),
  });
  let i = 0;
  for (const g of groups) {
    if (g.key !== 'all') el.taskList.appendChild(taskGroupHead(g));
    if (!g.collapsed) g.tasks.forEach((t2) => el.taskList.appendChild(taskItem(t2, i++)));
  }
}

/** Заголовок группы: цвет и имя статуса, сколько задач и сколько времени.
 *  Щелчок сворачивает группу; свёрнутые запоминаются. */
function taskGroupHead(g) {
  const li = elt('li', 'task-group' + (g.collapsed ? ' collapsed' : ''));
  li.dataset.group = g.key;
  const chev = elt('span', 'tg-chev');
  // Пустая колонка «срок» между именем и суммами — её занимает сетка.
  chev.innerHTML = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.3 6.2a.95.95 0 011.34 0L8 8.56l2.36-2.36a.95.95 0 111.34 1.34l-3.03 3.03a.95.95 0 01-1.34 0L4.3 7.54a.95.95 0 010-1.34z"/></svg>';
  const dot = elt('span', 'tg-dot');
  if (g.status) dot.style.background = g.status.color;
  else dot.hidden = true;
  const main = elt('span', 'tg-main');
  main.append(dot, elt('span', 'tg-name', g.status ? g.status.name : t('sep.pinned')), elt('span', 'tg-count', String(g.tasks.length)));
  const money = g.tasks.reduce((a, t2) => a + earnedOf(t2), 0);
  li.append(
    chev, main,
    elt('span', 'tg-time', fmtShort(g.ms)),
    elt('span', 'tg-money', money ? fmtMoney(money, currencyOf(state.ui.projectId)) : ''),
  );
  li.addEventListener('click', () => {
    const shut = new Set(state.ui.collapsedGroups || []);
    if (shut.has(g.key)) shut.delete(g.key); else shut.add(g.key);
    state.ui.collapsedGroups = [...shut];
    renderSidebar();
    scheduleSave();
  });
  return li;
}

/** Элемент с классом и текстом — то, из чего собраны строки задач и
 *  клетки календаря. Без него каждый значок занимал пять строк, и за ними
 *  терялось, что именно рисуется. */
function elt(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Всё, что нужно правилу строки задачи (core/views.js, taskRowView).
 *  Собирается заново на каждую строку: «сейчас» и выделение меняются. */
const taskRowCtx = () => ({
  statuses: state.statuses,
  versions: state.versions,
  tags: state.tags,
  selectedId,
  activeTimer: state.activeTimer,
  now: Date.now(),
  lang: lang(),
  t,
  fmtDateShort,
  repeatLabel,
});

/** Строка задачи в списке. Что показать — решает ядро (taskRowView), общее
 *  с телефоном; здесь только сборка DOM и обработчики. */
function taskItem(task, i) {
  const v = Core.taskRowView(task, taskRowCtx());

  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;
  li.style.animationDelay = `${Math.min(i, 12) * 16}ms`;
  if (v.selected) li.classList.add('selected');
  if (v.done) li.classList.add('done');
  if (v.pinned) li.classList.add('pinned');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'task-done';
  cb.setAttribute('aria-label', t('task.done_label'));
  cb.checked = v.done;
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => {
    setTaskDone(task, cb.checked);
    li.classList.toggle('done', task.done);
    renderStats();
    scheduleSave();
  });

  const name = elt('span', 'task-name', v.title);

  const pin = document.createElement('button');
  pin.className = 'task-pin';
  pin.innerHTML = icon('pin');
  pin.title = v.pinTitle;
  pin.addEventListener('click', (e) => { e.stopPropagation(); togglePinTask(task.id); });

  // Две строки: сверху название целиком (в узком списке ему нужна вся
  // ширина) и пин, снизу тихая мета — точки тегов, версия, повтор, срок,
  // время. Статус не повторяется: он уже сказан заголовком группы.
  const dots = elt('span', 'ti-tags');
  for (const tg of v.tags) {
    const d = elt('span', 'tag-dot');
    d.style.setProperty('--sc', tg.color);
    d.title = tg.name;
    dots.appendChild(d);
  }
  const meta = elt('span', 'ti-meta');
  if (v.version) meta.appendChild(elt('span', 'task-version' + (v.version.released ? ' released' : ''), v.version.name));
  if (v.repeat) {
    const rep = elt('span', 'task-repeat-mark', '↻');
    rep.title = v.repeat.title;
    meta.appendChild(rep);
  }
  if (v.running) meta.appendChild(elt('span', 'running-dot', '●'));

  // Колонки: галочка · название с метой · срок · время · деньги.
  const main = elt('div', 'ti-main');
  const top = elt('div', 'ti-top');
  top.append(name, pin);
  if (v.tags.length) meta.prepend(dots);
  main.append(top, meta);
  const due = elt('span', 'ti-due' + (v.due ? ` ${v.due.state}` : ''), v.due ? v.due.text : '');
  if (v.due) due.title = v.due.text;
  const money = earnedOf(task);
  li.append(cb, main, due, elt('span', 'task-time', v.time), elt('span', 'ti-money', money ? fmtMoney(money, currencyOf(task.projectId)) : ''));
  li.addEventListener('click', () => selectTask(task.id));
  return li;
}

// ---------------------------------------------------------------------------
// Деталь задачи
// ---------------------------------------------------------------------------

/** Строки «Срок» и «Напомнить» под ставкой. Время срока показывается
 *  только когда сама дата задана — до этого показывать «00:00» не о чем. */
/** Лента уведомлений — из ядра (core/due.js), общая с телефоном. */
const notificationFeed = () =>
  Core.notificationFeed(state.tasks, state.ui.notifSeenAt, Date.now());

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
  // Повторение считается от дедлайна: появился или исчез срок — строка
  // повторения должна это заметить.
  if (el.repeatRow) renderTaskRepeat(task);
  const has = !!task.dueAt;
  const due = has ? new Date(task.dueAt) : null;
  el.dueDateBtn.textContent = has ? `${fmtDpBtn(dayKey(due))}, ${pad2(due.getHours())}:${pad2(due.getMinutes())}` : t('due.set');
  el.dueDateBtn.classList.toggle('is-empty', !has);
  el.dueDateBtn.classList.toggle('muted-btn', !has);
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
    el.remindDateBtn.textContent = `${fmtDpBtn(dayKey(r))}, ${pad2(r.getHours())}:${pad2(r.getMinutes())}`;
  }
}

/** Страница задачи: крошки, название с тегами и редактор, справа таймер и
 *  свойства с историей. */
function renderTaskPage() {
  const task = getTask(selectedId);
  const p = getProject(task.projectId);
  el.crumbProject.textContent = p ? p.name : '';
  el.crumbTask.textContent = task.title || t('task.no_name');
  renderDetail();
}

function renderDetail() {
  const task = getTask(selectedId);
  if (!task) return;
  el.taskDoneBtn.textContent = task.done ? t('task.reopen') : t('filter.done');

  if (document.activeElement !== el.title) el.title.value = task.title || '';
  el.exportTaskBtn.disabled = !(task.sessions && task.sessions.length);

  renderTimer(task);
  renderTaskStatus(task);
  renderTaskVersion(task);
  renderTaskRepeat(task);
  renderTaskTags(task);
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
  el.rateUnit.textContent = `${symOf(currencyOf(task.projectId))}${t('rate.per_hour')}`;

  const rate = effectiveRate(task);
  const ms = taskElapsedMs(task);
  const mins = Math.round(ms / 60000);
  const minWord = { ru: 'мин', en: 'min', uk: 'хв', kk: 'мин' }[lang()] || 'мин';
  const time = mins < 60 ? `${mins} ${minWord}` : fmtShort(ms);
  el.moneyCalc.innerHTML = rate
    ? `${t('money.calc', { time, rate: moneyFmt().format(rate), cur: symOf(currencyOf(task.projectId)) })} <b>${fmtMoney(earnedOf(task), currencyOf(task.projectId))}</b>`
    : t('money.no_rate');
}

function renderTimer(task) {
  const running = state.activeTimer && state.activeTimer.taskId === task.id;
  el.timerDisplay.textContent = fmtClock(taskElapsedMs(task));
  // Заработанное — справа от времени, по его нижнему краю, без подписи:
  // рядом с часами сумма читается сама. Растёт вместе с идущим таймером.
  const earned = earnedOf(task);
  el.timerEarned.hidden = !earnedShown(task, earned);
  el.timerEarned.textContent = fmtMoney(earned, currencyOf(task.projectId));
  el.timerBtnIcon.innerHTML = running ? SVG_STOP : SVG_PLAY;
  el.timerBtnLabel.textContent = running ? t('timer.stop') : t('timer.start');
  el.timerBtn.setAttribute('aria-label', running ? t('timer.stop') : t('timer.start'));
  el.timerBtn.classList.toggle('run', running);
  const rate = effectiveRate(task);
  el.timerRate.textContent = rate ? `· ${moneyFmt().format(rate)} ${symOf(currencyOf(task.projectId))}${t('rate.per_hour')}` : '';
  if (running) {
    const sessionMs = Date.now() - new Date(state.activeTimer.startedAt).getTime();
    el.timerSub.textContent = t('timer.recording', { time: fmtClock(sessionMs) });
  } else if (state.activeTimer) {
    el.timerSub.textContent = t('timer.other_task');
  } else {
    el.timerSub.textContent = t('timer.sub_default');
  }
  // В полосе подпись нужна, только когда таймер где-то идёт: «общее время
  // по задаче» рядом с самим временем ничего не добавляло.
  el.timerSub.hidden = !state.activeTimer;
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
    right.className = 'session-side';

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
  // Вкладки «Настройки» с 6 октября 2026 нет: свойства задачи стоят фишками
  // под названием и видны всегда. Всё, кроме «Истории», — это «Заметки».
  if (tab !== 'history') tab = 'notes';
  activeTaskTab = tab;
  el.taskTabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  // Редактор виден всегда; вкладки переключают правую панель: свойства
  // или история.
  el.taskProps.hidden = tab !== 'notes';
  el.tabHistory.hidden = tab !== 'history';
}

/** Открыть задачу — своей страницей. */
function selectTask(id) {
  const task = getTask(id);
  if (!task) return;
  if (id === selectedId && state.ui.view === 'task') return;
  flushEditor();
  closeMenu();
  selectedId = id;
  state.ui.projectId = task.projectId;
  state.ui.view = 'task';
  loadEditor(task);
  setTaskTab('notes');
  render();
  scheduleSave();
  if (!task.title) { el.title.focus({ preventScroll: true }); el.title.select(); }
}

function newTask() {
  if (!state.ui.projectId || !['project', 'task'].includes(state.ui.view)) return;
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
  state.ui.view = 'task';
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
    selectedId = null;
    loadEditor(null);
    if (state.ui.view === 'task') state.ui.view = 'project';
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
  taskFilter = { status: 'all', versionId: 'all' };
  state.ui.view = 'project';
  state.ui.projectId = id;
  const first = sortedProjectTasks().all[0];
  selectedId = first ? first.id : null;
  loadEditor(getTask(selectedId));
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
  // Документы проекта не удаляются вместе с ним — становятся общими.
  for (const d of state.documents || []) if (d.projectId === id) d.projectId = null;
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
  if (money > 0) parts.push(fmtMoney(money, currencyOf(p.id)));
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
    const dot = it.dot ? `<span class="ctx-dot" style="--sc:${escapeHtml(it.dot)}"></span>` : '';
    b.innerHTML = `<span class="ctx-main">${dot}<span>${escapeHtml(it.label)}</span></span>` +
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
  // Статусы и версии — и в меню: на телефонной ширине шестерёнки в шапке нет.
  if (inProject) items.push({ label: t('board.statuses'), onClick: openStatusDialog });
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

const pdlg = { editing: null, color: PALETTE[0], tagIds: [] };

/** Теги в окне проекта. Правятся до сохранения, поэтому живут в pdlg, а не
 *  прямо в проекте: отмена должна отменять и их. */
function renderPdlgTags() {
  renderTagChips(el.pdlgTags, pdlg.tagIds, (id) => {
    pdlg.tagIds = Core.toggleTag(pdlg.tagIds, id);
    renderPdlgTags();
  });
}

const pdlgProjectId = () => (pdlg.editing ? pdlg.editing.id : null);

/** @param {object|null} project — null для нового
 *  @param {string} [sec] — раздел, с которого открыть: main, money, tags,
 *  statuses, versions. У нового проекта есть только первые два. */
function openProjectDialog(project, sec) {
  pdlg.editing = project || null;
  pdlg.color = project ? (project.color || PALETTE[0]) : PALETTE[state.projects.length % PALETTE.length];
  pdlg.rate = project && project.rate !== null && project.rate !== undefined ? project.rate : null;
  pdlg.currency = project ? (project.currency || null) : null;
  el.pdlgTitle.textContent = project ? t('status.dialog_title') : t('project.new_title');
  el.pdlgName.value = project ? project.name : '';
  el.pdlgDesc.value = project ? (project.description || '') : '';
  pdlg.tagIds = Core.keepKnown(state.tags, project ? project.tagIds : []);
  renderPdlgTags();
  buildSwatches();
  el.pdlgRate.value = pdlg.rate !== null ? String(pdlg.rate) : '';
  el.pdlgRate.placeholder = String(defaultRate() || 0);
  el.pdlgLater.hidden = !!project;
  setPdlgSection(project && ['money', 'tags', 'statuses', 'versions'].includes(sec) ? sec : (sec === 'money' ? 'money' : 'main'));
  el.pdlgBackdrop.hidden = false;
  if (!sec || sec === 'main') { el.pdlgName.focus(); el.pdlgName.select(); }
}

/** Разделы окна проекта. Теги, статусы и версии — только у существующего. */
function setPdlgSection(sec) {
  pdlg.sec = sec;
  const has = !!pdlg.editing;
  el.pdlgTabs.forEach((b) => {
    b.classList.toggle('on', b.dataset.sec === sec);
    b.hidden = !has && ['tags', 'statuses', 'versions'].includes(b.dataset.sec);
  });
  for (const name of ['main', 'money', 'tags', 'statuses', 'versions']) {
    document.getElementById(`pdlg-sec-${name}`).hidden = name !== sec;
  }
  if (sec === 'money') renderPdlgMoney();
  if (sec === 'tags') renderPdlgTagList();
  if (sec === 'statuses') renderStatusDialog();
  if (sec === 'versions') renderVersionDialog();
}

function renderPdlgMoney() {
  const main = state.settings.currency;
  const cur = pdlg.currency || main;
  el.pdlgRateUnit.textContent = `${symOf(cur)}${t('rate.per_hour')}`;
  el.pdlgRateHint.textContent = t('pdlg.rate_hint', { rate: `${moneyFmt().format(defaultRate())} ${symOf(main)}` });
  el.pdlgCurrency.textContent = pdlg.currency ? currencyLabel(pdlg.currency) : t('pdlg.currency_default', { cur: currencyLabel(main) });
  el.pdlgCurrency.classList.toggle('unset', !pdlg.currency);
}

/** Теги проекта — его собственные; общие заводятся в настройках. */
function renderPdlgTagList() {
  const pid = pdlgProjectId();
  el.pdlgTagList.innerHTML = '';
  const own = state.tags.filter((tg) => tg.projectId === pid);
  if (!own.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row tags-empty';
    empty.innerHTML = `<span class="settings-row-label muted">${escapeHtml(t('tag.project_empty'))}</span>`;
    el.pdlgTagList.appendChild(empty);
  }
  for (const tag of own) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-row settings-row-btn';
    row.dataset.id = tag.id;
    row.innerHTML = `
      <span class="tag-dot" style="--sc:${escapeHtml(tag.color || PALETTE[0])}"></span>
      <span class="settings-row-label">${escapeHtml(tag.name || '')}</span>
      <span class="settings-row-value">${escapeHtml(tagUsageLabel(tagUsage(tag.id)))}</span>`;
    row.addEventListener('click', () => openTagDialog(tag, '', () => renderPdlgTagList(), pid));
    el.pdlgTagList.appendChild(row);
  }
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
function closeProjectDialog() { el.pdlgBackdrop.hidden = true; closeDatePicker(); }
function saveProjectDialog() {
  const name = el.pdlgName.value.trim();
  if (!name) { setPdlgSection('main'); el.pdlgName.focus(); return; }
  const description = el.pdlgDesc.value.trim();
  const rateText = el.pdlgRate.value.trim();
  const rate = rateText === '' ? null : parseNum(rateText);
  const fields = { name, description, color: pdlg.color, tagIds: pdlg.tagIds.slice(), rate, currency: pdlg.currency };
  if (pdlg.editing) {
    Object.assign(pdlg.editing, fields);
    closeProjectDialog();
    render();
    scheduleSave();
  } else {
    const p = { id: uid(), createdAt: new Date().toISOString(), pinnedAt: null, ...fields };
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
/** Дата и два времени — в отрезок. Конец не позже начала значит «через
 *  полночь»: ночная запись иначе схлопывалась бы в ноль. Считают этим и
 *  окно правки записи, и модалка задачи с календаря. */
function spanFromParts(dateKey, startHm, endHm) {
  const dparts = (dateKey || '').split('-').map(Number);
  const sp = (startHm || '').split(':').map(Number);
  const ep = (endHm || '').split(':').map(Number);
  if (dparts.length !== 3 || sp.length < 2 || ep.length < 2 || dparts.some(Number.isNaN)) return null;
  const start = new Date(dparts[0], dparts[1] - 1, dparts[2], sp[0], sp[1]);
  let end = new Date(dparts[0], dparts[1] - 1, dparts[2], ep[0], ep[1]);
  if (end <= start) end = new Date(end.getTime() + 24 * 3_600_000);
  return { start, end, ms: end - start };
}

/** Записывает отрезок в задачу: index — правка записи, null — новая.
 *  Само правило — в ядре (core/money.js, planSessionEdit), здесь только
 *  применение к задаче. */
function applySessionEdit(task, index, span) {
  const upd = Core.planSessionEdit(task, index, span, rates(), Date.now());
  task.sessions = upd.sessions;
  task.totalMs = upd.totalMs;
  task.updatedAt = upd.updatedAt;
}

function sdlgTimes() { return spanFromParts(sdlg.date, sdlg.start, sdlg.end); }
function updateSdlgDur() {
  const tm = sdlgTimes();
  el.sdlgDur.textContent = tm ? t('sdlg.duration', { time: fmtClock(tm.ms) }) : t('sdlg.check_datetime');
}
function closeSessionDialog() { el.sdlgBackdrop.hidden = true; closeDatePicker(); closeTimePicker(); }
function saveSessionDialog() {
  const tm = sdlgTimes();
  if (!tm || tm.ms < 60_000) { toast(t('toast.invalid_interval')); return; }
  applySessionEdit(sdlg.task, sdlg.index, tm);
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

// Форма отчётов — в core/reports.js, общая с телефоном: строки, колонки и
// формулы там, а здесь только подстановка состояния. Подписи и
// форматирование передаются параметрами, потому что словарь и format у
// десктопа и телефона свои.
const reportsFor = (projectId) => Core.makeReports({
  t,
  cur: symOf(projectId ? currencyOf(projectId) : state.settings.currency),
  fmtClock,
  fmtDate,
  fmtTime,
  hoursOf,
  effectiveRate: (task) => Core.effectiveRate(task, projectId ? rates() : ratesMain()),
  sessionRate: (s, task) => Core.sessionRate(s, task, projectId ? rates() : ratesMain()),
  sessionMoney,
});

function buildTaskSheets(task) {
  return reportsFor(task.projectId).buildTaskSheets(task, getProject(task.projectId));
}

function buildProjectSheets(project, versionId) {
  const tasks = Core.filterTasks(tasksOf(project.id), state.versions, { versionId: versionId || 'all' });
  // Отбор по версии виден в самом отчёте: иначе две выгрузки одного
  // проекта различаются только числами, и какая из них за что — не
  // вспомнить.
  const meta = versionId && versionId !== 'all'
    ? [[{ t: t('xlsx.version'), s: 1 }, versionFilterLabel(project.id, versionId)]]
    : [];
  return reportsFor(project.id).buildProjectSheets(project, tasks, { meta });
}

function buildAllProjectsSheets() {
  return reportsFor(null).buildAllProjectsSheets(state.projects, tasksOf);
}

function buildPeriodSheets(from, to) {
  // statsTasks() уже учитывает фильтр по проекту на экране статистики,
  // поэтому ядру достаётся готовый список, а оно отбирает сессии по датам.
  return reportsFor(statsFilter.projectId !== 'all' ? statsFilter.projectId : null).buildPeriodSheets(statsTasks(), getProject, { from, to });
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
function exportProjectById(id, versionId) {
  const p = getProject(id);
  if (!p) return;
  const suffix = versionId && versionId !== 'all' ? ` — ${versionFilterLabel(id, versionId)}` : '';
  runExport(`${p.name} — ${t('export.all_tasks')}${suffix} — ${fmtDate(Date.now())}`, buildProjectSheets(p, versionId));
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
    line.className = 'exp-tab-row segmented-row';
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
  runExport(`Lancible — ${t('export.period')}${filterSuffix(statsFilter)} — ${fmtDate(from)} — ${fmtDate(to)}`, buildPeriodSheets(from, to));
});

function exportAllProjects() {
  runExport(`Lancible — ${t('export.all_projects')} — ${fmtDate(Date.now())}`, buildAllProjectsSheets());
}
/** Экспорт открытого проекта — та же выгрузка, что в контекстном меню
 *  плитки на главной, но доступная изнутри проекта (как в мобильном). */
function exportProject() {
  if (state.ui.projectId) exportProjectById(state.ui.projectId, taskFilter.versionId);
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
  runExport(`Lancible — ${t('export.period')}${filterSuffix(statsFilter)} — ${fmtDate(from)} — ${fmtDate(to)}`, buildPeriodSheets(from, to));
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
// Редактор — свой, на ProseMirror (исходники src/editor/, сборка editor.js)
// ---------------------------------------------------------------------------
//
// Два экземпляра одного редактора: заметки задачи и раздел «Документы». У
// обоих один формат (core/doc.js): контейнер { v, doc, comments, ink }. В
// задаче он лежит в notes рядом с Delta для старых версий приложения
// (writeNotes), у документа — в body как есть.
//
// Вид (ширина полосы, шрифт, режим фокуса) и настройки пера — в
// state.settings.editor: это настройки устройства, а не данные, и в
// синхронизацию они не уходят — планшет со стилусом и ноутбук с мышью
// настраивают по-разному.

let editor = null;      // заметки задачи
let docEditor = null;   // документ
let editorTaskId = null;
let editorLoadedJSON = null;
let docLoadedJSON = null;

// Токен входа для облачного хранилища картинок: хранилище спрашивает его
// синхронно, а supabase-js отдаёт сессию только через await.
let assetAuth = null;
sb.auth.onAuthStateChange((_event, session) => {
  assetAuth = session ? { token: session.access_token, userId: session.user.id } : null;
  if (assetAuth && editorAssets) editorAssets.flush();
});

const editorAssets = window.LancibleEditor ? LancibleEditor.createAssetStore({
  remote: () => (assetAuth && state.settings.syncEnabled !== false
    ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, accessToken: assetAuth.token, userId: assetAuth.userId }
    : null),
}) : null;

/** Что у редакторов общее: язык, автор комментариев, вид, картинки. */
function editorOptions(extra) {
  return Object.assign({
    lang,
    user: () => (currentUser ? { id: currentUser.id, name: currentUser.name || currentUser.email || '' } : null),
    settings: () => state.settings.editor || {},
    onSettings: (patch) => {
      state.settings.editor = Object.assign({}, state.settings.editor || {}, patch);
      scheduleSave();
      // Второй редактор подхватит вид, когда его откроют: настройки одни.
      for (const ed of [editor, docEditor]) if (ed) ed.applySettings();
    },
    assets: editorAssets,
    toast,
    openUrl: (href) => openExternalUrl(href),
    // Веб на телефоне — тот же режим, что в приложении для телефона: кнопки
    // крупнее, панель одной строкой, без ручки блока.
    mobile: !!(window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 760px)').matches),
  }, extra);
}

function openExternalUrl(href) {
  if (window.api && window.api.openExternal) window.api.openExternal(href);
  else window.open(href, '_blank', 'noopener');
}

/** Редактор заметок. Закрыт, пока не выбрана задача: писать некуда. */
function setupEditor() {
  if (!window.LancibleEditor) return;
  editor = LancibleEditor.create(el.editorWrap, editorOptions({
    ariaLabel: t('tabs.notes'),
    title: () => { const task = getTask(editorTaskId); return task ? task.title : ''; },
    onChange: (container) => persistNotes(container),
  }));
  editor.setEditable(false);
}

function persistNotes(container) {
  const task = getTask(editorTaskId);
  if (!task) return;
  task.notes = Core.writeNotes(container);
  editorLoadedJSON = JSON.stringify(task.notes);
  task.updatedAt = new Date().toISOString();
  scheduleSave();
}

function loadEditor(task) {
  if (!editor) return;
  editor.flush();
  editorTaskId = task ? task.id : null;
  editorLoadedJSON = task ? JSON.stringify(task.notes || null) : null;
  editor.setContent(task ? Core.readNotes(task.notes) : null);
  editor.setEditable(!!task);
}

/** Дописать в задачу то, что ещё не ушло из редактора (он ждёт 150 мс). */
function flushEditor() {
  if (editor) editor.flush();
  if (docEditor) docEditor.flush();
}

/** Пришли данные с другого устройства. Открытый текст перечитываем, если
 *  его поменяли там, а здесь в нём сейчас не пишут: иначе следующая буква
 *  отсюда затёрла бы чужую правку. */
function refreshEditorsFromRemote() {
  const task = editor && getTask(editorTaskId);
  if (task && JSON.stringify(task.notes || null) !== editorLoadedJSON && !editor.view.hasFocus()) loadEditor(task);
  const d = docEditor && getDocument(state.ui.docId);
  if (d && JSON.stringify(d.body || null) !== docLoadedJSON && !docEditor.view.hasFocus()) loadDocEditor(d);
}

// ---------------------------------------------------------------------------
// Документы
// ---------------------------------------------------------------------------

const getDocument = (id) => (state.documents || []).find((d) => d.id === id) || null;
let docQuery = '';
let docFilter = 'all'; // all | none | <projectId>

function setupDocEditor() {
  if (!window.LancibleEditor || docEditor) return;
  docEditor = LancibleEditor.create(el.docEditorWrap, editorOptions({
    ariaLabel: t('docs.title'),
    placeholder: t('docs.placeholder'),
    title: () => { const d = getDocument(state.ui.docId); return d ? docTitle(d) : ''; },
    onChange: (container) => persistDoc(container),
  }));
  docEditor.setEditable(false);
}

const docTitle = (d) => d.title || Core.docTitleGuess(Core.readNotes(d.body).doc) || t('docs.untitled');

function persistDoc(container) {
  const d = getDocument(state.ui.docId);
  if (!d) return;
  d.body = Core.normalizeContainer(container);
  docLoadedJSON = JSON.stringify(d.body);
  d.updatedAt = new Date().toISOString();
  renderDocList();
  scheduleSave();
}

function loadDocEditor(d) {
  setupDocEditor();
  if (!docEditor) return;
  docEditor.flush();
  docLoadedJSON = d ? JSON.stringify(d.body || null) : null;
  docEditor.setContent(d ? Core.readNotes(d.body) : null);
  docEditor.setEditable(!!d);
}

function openDocs(id) {
  flushEditor();
  closeMenu();
  closeSearch();
  if (id !== undefined) state.ui.docId = id;
  state.ui.view = 'docs';
  render();
  scheduleSave();
}

function renderDocsPage() {
  setupDocEditor();
  const docs = state.documents || [];
  if (!getDocument(state.ui.docId)) state.ui.docId = Core.sortDocuments(docs)[0] ? Core.sortDocuments(docs)[0].id : null;
  renderDocList();
  renderDocHead();
  const d = getDocument(state.ui.docId);
  if (docEditor && (docEditor.loadedFor !== (d ? d.id : null))) {
    loadDocEditor(d);
    docEditor.loadedFor = d ? d.id : null;
  }
  el.docEmpty.hidden = !!d;
  el.docMain.hidden = !d;
}

function docsShown() {
  let list = Core.sortDocuments(state.documents || []);
  if (docFilter === 'none') list = list.filter((d) => !d.projectId);
  else if (docFilter !== 'all') list = list.filter((d) => d.projectId === docFilter);
  return Core.searchDocuments(list, docQuery);
}

function renderDocList() {
  if (!el.docList) return;
  const list = docsShown();
  el.docFilterBtn.textContent = docFilter === 'all' ? t('docs.filter_all')
    : docFilter === 'none' ? t('docs.no_project') : ((getProject(docFilter) || {}).name || t('docs.filter_all'));
  el.docList.innerHTML = '';
  for (const d of list) {
    const p = d.projectId && getProject(d.projectId);
    const st = Core.docStats(Core.readNotes(d.body).doc);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'doc-item' + (d.id === state.ui.docId ? ' active' : '');
    b.dataset.id = d.id;
    b.innerHTML = `<span class="doc-item-title">${d.pinnedAt ? `<svg class="icon doc-pin" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS.pin || ''}"/></svg>` : ''}${escapeHtml(docTitle(d))}</span>`
      + `<span class="doc-item-meta">${p ? `<span class="ctx-dot" style="--sc:${escapeHtml(p.color || '')}"></span>${escapeHtml(p.name)} · ` : ''}${escapeHtml(t('docs.words_n', { n: st.words }))} · ${escapeHtml(fmtWhenShort(d.updatedAt))}</span>`;
    b.addEventListener('click', () => { if (d.id !== state.ui.docId) { flushEditor(); state.ui.docId = d.id; renderDocsPage(); scheduleSave(); } });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openDocMenu(d, b); });
    el.docList.appendChild(b);
  }
  el.docListEmpty.hidden = list.length > 0;
  el.docListEmpty.textContent = (state.documents || []).length ? t('docs.nothing_found') : t('docs.empty_list');
}

function fmtWhenShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    : d.toLocaleDateString(LOCALE_MAP[lang()] || 'ru-RU', { day: 'numeric', month: 'short' });
}

function renderDocHead() {
  const d = getDocument(state.ui.docId);
  if (!d) return;
  if (document.activeElement !== el.docTitle) el.docTitle.value = d.title || '';
  el.docTitle.placeholder = Core.docTitleGuess(Core.readNotes(d.body).doc) || t('docs.untitled');
  const p = d.projectId && getProject(d.projectId);
  el.docProjectBtn.textContent = p ? p.name : t('docs.no_project');
  el.docProjectBtn.classList.toggle('empty', !p);
  el.docPinBtn.classList.toggle('on', !!d.pinnedAt);
  el.docPinBtn.title = d.pinnedAt ? t('docs.unpin') : t('docs.pin');
}

function newDocument(projectId) {
  flushEditor();
  const d = Core.newDocument({
    id: uid(),
    projectId: projectId !== undefined ? projectId : (docFilter !== 'all' && docFilter !== 'none' ? docFilter : null),
  });
  state.documents = state.documents || [];
  state.documents.unshift(d);
  state.ui.docId = d.id;
  docQuery = '';
  if (el.docSearch) el.docSearch.value = '';
  openDocs(d.id);
  el.docTitle.focus();
}

async function deleteDocument(id) {
  const d = getDocument(id);
  if (!d) return;
  const ok = await confirmDialog(t('docs.delete_confirm', { name: docTitle(d) }));
  if (!ok) return;
  state.documents = state.documents.filter((x) => x.id !== id);
  if (state.ui.docId === id) { state.ui.docId = null; if (docEditor) docEditor.loadedFor = undefined; }
  render();
  scheduleSave();
}

function togglePinDocument(id) {
  const d = getDocument(id);
  if (!d) return;
  d.pinnedAt = d.pinnedAt ? null : new Date().toISOString();
  renderDocList();
  renderDocHead();
  scheduleSave();
}

function pickDocProject(d, anchor) {
  openMenu(anchor, [
    { label: t('docs.no_project'), selected: !d.projectId, onClick: () => { d.projectId = null; d.updatedAt = new Date().toISOString(); renderDocsPage(); scheduleSave(); } },
    ...state.projects.map((p) => ({
      label: p.name, dot: p.color, selected: d.projectId === p.id,
      onClick: () => { d.projectId = p.id; d.updatedAt = new Date().toISOString(); renderDocsPage(); scheduleSave(); },
    })),
  ]);
}

function openDocFilterMenu(anchor) {
  openMenu(anchor, [
    { label: t('docs.filter_all'), selected: docFilter === 'all', onClick: () => { docFilter = 'all'; renderDocList(); } },
    { label: t('docs.no_project'), selected: docFilter === 'none', onClick: () => { docFilter = 'none'; renderDocList(); } },
    ...state.projects.map((p) => ({ label: p.name, dot: p.color, selected: docFilter === p.id, onClick: () => { docFilter = p.id; renderDocList(); } })),
  ]);
}

function openDocMenu(d, anchor) {
  openMenu(anchor, [
    { label: d.pinnedAt ? t('docs.unpin') : t('docs.pin'), onClick: () => togglePinDocument(d.id) },
    { label: t('docs.duplicate'), onClick: () => duplicateDocument(d.id) },
    { sep: true },
    { label: t('docs.delete'), danger: true, onClick: () => deleteDocument(d.id) },
  ]);
}

function duplicateDocument(id) {
  const d = getDocument(id);
  if (!d) return;
  flushEditor();
  const copy = Object.assign(Core.newDocument({ id: uid(), projectId: d.projectId }), {
    title: d.title ? `${d.title} ${t('docs.copy_suffix')}` : '',
    body: JSON.parse(JSON.stringify(d.body || null)),
  });
  state.documents.unshift(copy);
  openDocs(copy.id);
}

function setupDocsView() {
  el.docNewBtn.addEventListener('click', () => newDocument());
  el.docEmptyNew.addEventListener('click', () => newDocument());
  el.docSearch.addEventListener('input', () => { docQuery = el.docSearch.value; renderDocList(); });
  el.docFilterBtn.addEventListener('click', () => openDocFilterMenu(el.docFilterBtn));
  el.docTitle.addEventListener('input', () => {
    const d = getDocument(state.ui.docId);
    if (!d) return;
    d.title = el.docTitle.value;
    d.updatedAt = new Date().toISOString();
    renderDocList();
    scheduleSave();
  });
  el.docTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (docEditor) docEditor.focus(); } });
  el.docProjectBtn.addEventListener('click', () => { const d = getDocument(state.ui.docId); if (d) pickDocProject(d, el.docProjectBtn); });
  el.docPinBtn.addEventListener('click', () => togglePinDocument(state.ui.docId));
  el.docMoreBtn.addEventListener('click', () => { const d = getDocument(state.ui.docId); if (d) openDocMenu(d, el.docMoreBtn); });
}

// ---------------------------------------------------------------------------
// Тик + heartbeat
// ---------------------------------------------------------------------------

setInterval(() => {
  if (!state.activeTimer) return;
  const task = getTask(state.activeTimer.taskId);
  if (state.ui.view === 'task' && task && task.id === selectedId) { renderTimer(task); renderMoney(task); }
  if (state.ui.view === 'project') {
    const li = el.taskList.querySelector(`.task-item[data-id="${state.activeTimer.taskId}"] .task-time`);
    if (li && task) li.textContent = fmtShort(taskElapsedMs(task));
    renderProjectHeader();
  }
  if (state.ui.view === 'home') { renderNowIsland(); renderDayIsland(); }
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

// Капсула ведёт на идущую задачу; стоп внутри неё останавливает таймер, не
// уводя с текущего экрана.
el.tbTimerStop.addEventListener('click', (e) => { e.stopPropagation(); stopTimer(); });
el.tbTimerStop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); stopTimer(); } });
el.tbTimer.addEventListener('click', () => {
  const task = state.activeTimer && getTask(state.activeTimer.taskId);
  if (!task) return;
  openProject(task.projectId);
  selectTask(task.id);
});
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
el.createProjectBtn.addEventListener('click', () => openProjectDialog(null));
el.homeAllProjects.addEventListener('click', () => openView('projects'));
el.dayAddEntry.addEventListener('click', () => {
  const start = Core.snapMinutes(Date.now(), AG_SNAP_MIN);
  openAgendaDraft({ start, end: start + 3_600_000 });
});
el.dayOpen.addEventListener('click', () => { openAgendaDay(Date.now()); openView('time'); });
el.nowBtn.addEventListener('click', () => {
  const task = nowTask();
  if (!task) return;
  if (state.activeTimer && state.activeTimer.taskId === task.id) stopTimer();
  else startTimer(task.id);
});
const openNowTask = () => { const task = nowTask(); if (task) { openProject(task.projectId); selectTask(task.id); } };
el.nowTitle.addEventListener('click', openNowTask);
el.nowOpen.addEventListener('click', openNowTask);
el.boardStatuses.addEventListener('click', openStatusDialog);
el.stAdd.addEventListener('click', addStatus);

// --- Теги ---
el.tagsAdd.addEventListener('click', () => openTagDialog(null));
el.tagdlgSave.addEventListener('click', saveTagDialog);
el.tagdlgCancel.addEventListener('click', closeTagDialog);
el.tagdlgDelete.addEventListener('click', deleteTagFromDialog);
el.tagdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.tagdlgBackdrop) closeTagDialog(); });
el.tagdlgName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveTagDialog(); }
  if (e.key === 'Escape') closeTagDialog();
});
// Набранное имя перестало быть занятым — убираем сообщение, не дожидаясь
// повторного нажатия на «Сохранить».
el.tagdlgName.addEventListener('input', () => { el.tagdlgError.hidden = true; });

el.taskTagsAdd.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  openTagPicker(el.taskTagsAdd, () => task.tagIds || [], (ids) => {
    task.tagIds = ids;
    touchTask(task);
    render();
    scheduleSave();
  }, task.projectId);
});

el.pdlgTagsAdd.addEventListener('click', () => {
  openTagPicker(el.pdlgTagsAdd, () => pdlg.tagIds, (ids) => {
    pdlg.tagIds = ids;
    renderPdlgTags();
  }, pdlgProjectId());
});
el.pdlgTabs.forEach((b) => b.addEventListener('click', () => setPdlgSection(b.dataset.sec)));
el.pdlgCurrency.addEventListener('click', () => {
  const main = state.settings.currency;
  openMenu(el.pdlgCurrency, [
    { label: t('pdlg.currency_default', { cur: currencyLabel(main) }), selected: !pdlg.currency, onClick: () => { pdlg.currency = null; renderPdlgMoney(); } },
    { sep: true },
    ...Object.keys(CURRENCIES).map((code) => ({
      label: currencyLabel(code), selected: code === pdlg.currency, onClick: () => { pdlg.currency = code; renderPdlgMoney(); },
    })),
  ]);
});
el.pdlgTagAdd.addEventListener('click', () => openTagDialog(null, '', () => renderPdlgTagList(), pdlgProjectId()));

el.projTabs.forEach((b) => b.addEventListener('click', () => {
  flushEditor();
  closeMenu();
  state.ui.projectTab = b.dataset.ptab;
  render();
  scheduleSave();
}));
el.navNewProject.addEventListener('click', () => openProjectDialog(null));
window.addEventListener('resize', () => { if (state.ui.view === 'project') renderProjectHeader(); });
el.projBack.addEventListener('click', () => openView('projects'));
el.crumbProjects.addEventListener('click', () => openView('projects'));
const backToProject = () => { flushEditor(); state.ui.view = 'project'; render(); scheduleSave(); };
el.taskBack.addEventListener('click', backToProject);
el.crumbProject.addEventListener('click', backToProject);
el.taskDoneBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  setTaskDone(task, !task.done);
  render();
  scheduleSave();
});
el.pvAll.addEventListener('click', () => { state.ui.projectTab = 'versions'; render(); scheduleSave(); });

el.projectMenuBtn.addEventListener('click', (e) => {
  const p = getProject(state.ui.projectId);
  if (p) openProjectMenu(p, e.currentTarget);
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

/** Дата и время дедлайна — одним окном. Пока даты нет, время по умолчанию
 *  18:00: срок обычно «к концу дня», а не к полуночи. */
el.dueDateBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  const cur = task.dueAt ? new Date(task.dueAt) : null;
  openDatePicker(el.dueDateBtn, cur ? dayKey(cur) : dayKey(new Date()), (key) => {
    const prev = task.dueAt ? new Date(task.dueAt) : null;
    const d = keyToDate(key);
    d.setHours(prev ? prev.getHours() : 18, prev ? prev.getMinutes() : 0, 0, 0);
    task.dueAt = d.toISOString();
    touchTask(task);
  }, {
    time: cur ? `${pad2(cur.getHours())}:${pad2(cur.getMinutes())}` : '18:00',
    onTime: (val) => {
      const [h, m] = val.split(':').map(Number);
      const d = task.dueAt ? new Date(task.dueAt) : keyToDate(dp.value || dayKey(new Date()));
      d.setHours(h, m, 0, 0);
      task.dueAt = d.toISOString();
      touchTask(task);
    },
  });
});
el.dpHours.addEventListener('change', dpCommitTime);
el.dpMinutes.addEventListener('change', dpCommitTime);
for (const input of [el.dpHours, el.dpMinutes]) {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { dpCommitTime(); closeDatePicker(); } });
}
el.dpHoursPick.addEventListener('click', () => dpPickFrom(el.dpHoursPick, el.dpHours, Array.from({ length: 24 }, (_, i) => i)));
el.dpMinutesPick.addEventListener('click', () => dpPickFrom(el.dpMinutesPick, el.dpMinutes, Array.from({ length: 12 }, (_, i) => i * 5)));
el.dpDone.addEventListener('click', () => { dpCommitTime(); closeDatePicker(); });
el.dueClearBtn.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  task.dueAt = null;
  task.remindAt = null;
  task.remindOffsetMin = null;
  touchTask(task);
});
/** Ключ текущего варианта напоминания: 'null' | 'custom' | число минут. */
const remindKey = Core.remindKey;
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
  const cur = new Date(task.remindAt);
  openDatePicker(el.remindDateBtn, dayKey(cur), (key) => {
    const prev = new Date(task.remindAt);
    const d = keyToDate(key);
    d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    task.remindAt = d.toISOString();
    touchTask(task);
  }, {
    time: `${pad2(cur.getHours())}:${pad2(cur.getMinutes())}`,
    onTime: (val) => {
      const [h, m] = val.split(':').map(Number);
      const d = new Date(task.remindAt);
      d.setHours(h, m, 0, 0);
      task.remindAt = d.toISOString();
      touchTask(task);
    },
  });
});
el.exportProjectBtn.addEventListener('click', exportProject);
el.exportCalendarBtn.addEventListener('click', exportCalendar);
el.exportAllBtn.addEventListener('click', exportAllProjects);
el.exportPeriodBtn.addEventListener('click', openExportPeriodDialog);
el.addSessionBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSessionDialog(getTask(selectedId), null); });


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
  renderProjectHeader();
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
el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (editor) editor.focus(); } });

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
  if (e.key === 'Escape' && !el.tmdlgBackdrop.hidden) { closeTaskModal(true); return; }
  // Ctrl+F внутри редактора — его собственный поиск по тексту (он уже
  // обработал клавишу и отменил действие по умолчанию).
  if ((e.ctrlKey || e.metaKey) && k === 'f' && !e.defaultPrevented) {
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

const currencyLabel = (code) => `${code} ${CURRENCIES[code] || ''}`.trim();

/** Валюта выбирается своим списком, как проект, статус, версия и
 *  повторение. Системный <select> был здесь последним: он не умеет ни
 *  нашей темы, ни наших шрифтов, а на macOS рисуется вовсе по-своему. */
function openCurrencyMenu(anchor) {
  openMenu(anchor, Object.keys(CURRENCIES).map((code) => ({
    label: currencyLabel(code),
    selected: code === state.settings.currency,
    onClick: () => {
      state.settings.currency = code;
      render();
      scheduleSave();
    },
  })));
}

/** Обе кнопки показывают одно и то же — валюта в приложении одна. */
function renderCurrency() {
  const label = currencyLabel(state.settings.currency);
  for (const btn of [el.settingsCurrency]) {
    btn.textContent = label;
    btn.title = t('currency.title');
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
    // Поля интерфейса десктопа: свёрнутая левая панель и отметка «панель
    // уведомлений открывали в такой-то момент». У телефона на этом месте
    // своё — положение доски и подсказка про свайп, — поэтому ядро их не
    // знает и знать не должно.
    ui: () => {
      if (typeof state.ui.navCollapsed !== 'boolean') state.ui.navCollapsed = false;
      if (typeof state.ui.notifSeenAt !== 'string') state.ui.notifSeenAt = null;
    },
  });
}

async function init() {
  setupEditor();
  setupDocsView();
  renderCurrency();
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
  renderCurrency();
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

// --- Версии проекта ---------------------------------------------------------
// Версия принадлежит проекту, как статусы, а не всему приложению, как теги:
// «v1.2» одного проекта не имеет ничего общего с «v1.2» другого. Поэтому и
// настраиваются версии там же, где статусы, — по шестерёнке на доске.

/** Версия задачи в редакторе. Строка прячется, пока в проекте нет ни одной
 *  версии: пустой выбор в каждой задаче только занимал бы место, а завести
 *  версию всё равно можно только в настройках проекта. */
function renderTaskVersion(task) {
  const list = versionsOf(task.projectId);
  el.taskVersionRow.hidden = !list.length;
  if (!list.length) return;
  const cur = task.versionId ? getVersion(task.versionId) : null;
  el.taskVersion.textContent = cur ? (cur.name || t('task.no_name')) : t('version.none');
  el.taskVersion.classList.toggle('unset', !cur);
}

function setTaskVersion(task, versionId) {
  if (task.versionId === versionId) return;
  task.versionId = versionId;
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

function versionLabel(v) {
  const name = v.name || t('task.no_name');
  return v.releasedAt ? `${name} · ${t('version.released_on', { date: fmtDateShort(v.releasedAt) })}` : name;
}

el.taskVersion.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  const items = [{
    label: t('version.none'),
    selected: !task.versionId,
    onClick: () => setTaskVersion(task, null),
  }];
  for (const v of versionsOf(task.projectId)) {
    items.push({ label: versionLabel(v), selected: v.id === task.versionId, onClick: () => setTaskVersion(task, v.id) });
  }
  items.push({ sep: true });
  items.push({
    label: t('version.manage'),
    onClick: () => openProjectDialog(getProject(task.projectId), 'versions'),
  });
  openMenu(el.taskVersion, items);
});

function renderVersionDialog() {
  const pid = pdlgProjectId();
  const list = versionsOf(pid);
  el.verList.innerHTML = '';

  if (!list.length) {
    const hint = document.createElement('div');
    hint.className = 'st-hint muted';
    hint.textContent = t('version.empty_hint');
    el.verList.appendChild(hint);
    return;
  }

  list.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'st-row ver-row';
    const used = versionUsage(v.id);
    row.innerHTML = `
      <input class="st-name" type="text" value="${escapeHtml(v.name)}" data-i18n-ph="version.name_ph" placeholder="Название версии" />
      <button type="button" class="dp-btn ver-rel${v.releasedAt ? ' released' : ''}" data-act="rel">${escapeHtml(v.releasedAt ? t('version.released_on', { date: fmtDateShort(v.releasedAt) }) : t('version.in_progress'))}</button>
      <span class="ver-use muted">${escapeHtml(t('version.tasks_n', { n: used }))}</span>
      <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} data-i18n-title="common.back" title="Выше">
        <svg class="icon" viewBox="0 0 16 16"><path d="M8 3.6l5.2 5.2-1.4 1.4L8 6.4l-3.8 3.8-1.4-1.4z"/></svg>
      </button>
      <button type="button" class="icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} data-i18n-title="common.forward" title="Ниже">
        <svg class="icon" viewBox="0 0 16 16"><path d="M8 12.4L2.8 7.2l1.4-1.4L8 9.6l3.8-3.8 1.4 1.4z"/></svg>
      </button>
      <button type="button" class="icon-btn st-del" data-act="del" data-i18n-title="common.delete" title="Удалить">
        <svg class="icon" viewBox="0 0 16 16"><path d="M6.2 1.6h3.6l.5 1.2h3.1v1.6H2.6V2.8h3.1zM3.6 5.6h8.8l-.6 8.2a1 1 0 01-1 .93H5.2a1 1 0 01-1-.93z"/></svg>
      </button>`;

    const nameInput = row.querySelector('.st-name');
    // Про одинаковые названия предупреждаем, но не запрещаем: у статусов
    // ограничения нет, и заводить его только здесь было бы странно. Двух
    // «v1.2» в одном проекте всё равно не различить на глаз.
    const markDuplicate = () => {
      const dup = Core.versionNameTaken(state.versions, pid, nameInput.value, v.id);
      row.classList.toggle('dup', dup);
      nameInput.title = dup ? t('version.name_taken') : '';
    };
    markDuplicate();
    nameInput.addEventListener('input', (e) => {
      v.name = e.target.value;
      markDuplicate();
      render();
      scheduleSave();
    });

    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'rel') { openReleaseMenu(b, v); return; }
      if (act === 'up' || act === 'down') {
        const other = list[act === 'up' ? i - 1 : i + 1];
        if (!other) return;
        [v.order, other.order] = [other.order, v.order];
        renderVersionDialog();
        render();
        scheduleSave();
        return;
      }
      if (act === 'del') deleteVersion(v);
    });

    el.verList.appendChild(row);
  });
  applyStaticTranslations();
}

/** Выпущена версия или ещё в работе. Дату спрашиваем обычным выбором даты —
 *  тем же, что у срока задачи. */
function openReleaseMenu(anchor, v) {
  openMenu(anchor, [
    {
      label: t('version.mark_open'),
      selected: !v.releasedAt,
      onClick: () => {
        v.releasedAt = null;
        renderVersionDialog();
        render();
        scheduleSave();
      },
    },
    {
      label: t('version.mark_released'),
      selected: !!v.releasedAt,
      onClick: () => {
        openDatePicker(anchor, dayKey(v.releasedAt ? new Date(v.releasedAt) : new Date()), (key) => {
          v.releasedAt = keyToDate(key).toISOString();
          renderVersionDialog();
          render();
          scheduleSave();
        });
      },
    },
  ]);
}

function addVersion() {
  const pid = pdlgProjectId();
  if (!pid) return;
  const list = versionsOf(pid);
  state.versions.push({
    id: uid(), projectId: pid, name: t('version.add'), releasedAt: null, order: list.length,
  });
  renderVersionDialog();
  render();
  scheduleSave();
  const last = el.verList.querySelector('.ver-row:last-child .st-name');
  if (last) { last.focus(); last.select(); }
}

/** Удаление версии задачи не трогает — в отличие от удаления статуса, где
 *  задаче некуда деться. Версии у задачи может не быть вовсе, поэтому она
 *  просто снимается, и задача уезжает в дорожку «Без версии». */
async function deleteVersion(v) {
  const used = versionUsage(v.id);
  const name = v.name || t('task.no_name');
  const ok = await confirmDialog(used
    ? t('version.delete_used', { name, n: used })
    : t('version.delete_confirm', { name }));
  if (!ok) return;
  for (const task of state.tasks) {
    if (task.versionId !== v.id) continue;
    task.versionId = null;
    task.updatedAt = new Date().toISOString();
  }
  state.versions = state.versions.filter((x) => x.id !== v.id);
  versionsOf(v.projectId).forEach((x, i) => { x.order = i; });
  renderVersionDialog();
  render();
  scheduleSave();
}

el.verAdd.addEventListener('click', addVersion);


// --- Фильтр по проекту и версии ---------------------------------------------
// Список задач знает свой проект, поэтому там выбирается только версия. На
// объединённой «Статистике» проектов сразу несколько, и выбирать приходится
// по очереди: сначала проект, потом его версию — «v1.2» разных проектов не
// имеют друг к другу отношения.

/** Пункты меню выбора версии. Пока проект не выбран, предлагать нечего —
 *  остаётся один пункт «Все версии». */
function versionMenuItems(projectId, current, onPick) {
  const items = [{ label: t('version.all'), selected: current === 'all', onClick: () => onPick('all') }];
  if (!projectId || projectId === 'all') return items;
  for (const v of versionsOf(projectId)) {
    items.push({ label: versionLabel(v), selected: current === v.id, onClick: () => onPick(v.id) });
  }
  items.push({ sep: true });
  items.push({ label: t('version.none'), selected: current === 'none', onClick: () => onPick('none') });
  return items;
}

/** Подпись кнопки: сама версия, «Без версии» или «Все версии». В кнопке
 *  только название — дата выпуска видна в меню, а в узкой кнопке она
 *  вытеснила бы сам номер версии. */
function versionFilterLabel(projectId, versionId) {
  if (versionId === 'none') return t('version.none');
  if (versionId && versionId !== 'all') {
    const v = getVersion(versionId);
    if (v) return v.name || t('task.no_name');
  }
  return t('version.all');
}

/** Хвост к имени файла выгрузки, когда она ограничена фильтром: иначе по
 *  имени не отличить полную выгрузку от урезанной. */
function filterSuffix(filter) {
  if (!Core.filterActive(filter)) return '';
  const p = filter.projectId === 'all' ? null : getProject(filter.projectId);
  const parts = [];
  if (p) parts.push(p.name);
  if (filter.versionId && filter.versionId !== 'all') parts.push(versionFilterLabel(filter.projectId, filter.versionId));
  return parts.length ? ` — ${parts.join(' · ')}` : '';
}

// --- Список задач проекта ---

/** Выбор версии стоит под названием проекта — там же, где описание и теги:
 *  это свойство того, на что смотришь, а не третья пилюля к статусам.
 *  Шеврон обязателен: без него кнопка читалась подписью, а не выбором. */
function renderTaskVersionFilter() {
  const pid = state.ui.projectId;
  const has = !!pid && versionsOf(pid).length > 0;
  el.tfVersionRow.hidden = !has;
  if (!has) return;
  el.tfVersion.innerHTML = `<span class="ph-version-name">${escapeHtml(versionFilterLabel(pid, taskFilter.versionId))}</span>${icon('chev')}`;
  el.tfVersion.classList.toggle('on', taskFilter.versionId !== 'all');
}

el.tfVersion.addEventListener('click', () => {
  openMenu(el.tfVersion, versionMenuItems(state.ui.projectId, taskFilter.versionId, (id) => {
    taskFilter.versionId = id;
    renderSidebar();
  }));
});

// --- Статистика вместе с календарём ---

function projectMenuItems(current, onPick) {
  const items = [{ label: t('filter.all_projects'), selected: current === 'all', onClick: () => onPick('all') }];
  for (const p of state.projects) {
    items.push({ label: p.name, dot: p.color || PALETTE[0], selected: current === p.id, onClick: () => onPick(p.id) });
  }
  return items;
}

/** Пара кнопок «проект → версия» и сброс. Обработчики вешаются присваиванием,
 *  а не addEventListener: полоска перерисовывается на каждый показ страницы,
 *  и подписчики копились бы.
 *
 *  @param {{project: Element, version: Element, reset: Element}} nodes
 *  @param {object} filter — меняется на месте
 *  @param {Function} onChange — что перерисовать после выбора */
function renderFilterBar(nodes, filter, onChange) {
  const p = filter.projectId === 'all' ? null : getProject(filter.projectId);
  // Проект мог исчезнуть, пока фильтр держал на него ссылку.
  if (filter.projectId !== 'all' && !p) { filter.projectId = 'all'; filter.versionId = 'all'; }

  const chip = (label, dotColor, value) => `<span class="fchip-k">${escapeHtml(label)}</span>`
    + (dotColor ? `<span class="tag-dot" style="--sc:${escapeHtml(dotColor)}"></span>` : '')
    + `<span class="fchip-v">${escapeHtml(value)}</span>${icon('chev')}`;
  nodes.project.innerHTML = chip(t('filter.project'), p ? (p.color || PALETTE[0]) : null, p ? p.name : t('filter.all_projects'));
  nodes.project.classList.toggle('on', !!p);

  // Версия появляется, только когда проект выбран и версии у него есть.
  const versions = p ? versionsOf(p.id) : [];
  nodes.version.hidden = !versions.length;
  if (versions.length) {
    nodes.version.innerHTML = chip(t('version.label'), null, versionFilterLabel(filter.projectId, filter.versionId));
    nodes.version.classList.toggle('on', filter.versionId !== 'all');
  }
  nodes.reset.hidden = !Core.filterActive(filter);

  nodes.project.onclick = () => openMenu(nodes.project, projectMenuItems(filter.projectId, (id) => {
    filter.projectId = id;
    // Версия принадлежит проекту: со сменой проекта прежняя ссылка теряет
    // смысл, и оставить её значило бы показать пустой экран.
    filter.versionId = 'all';
    onChange();
  }));
  nodes.version.onclick = () => openMenu(nodes.version, versionMenuItems(filter.projectId, filter.versionId, (id) => {
    filter.versionId = id;
    onChange();
  }));
  nodes.reset.onclick = () => {
    filter.projectId = 'all';
    filter.versionId = 'all';
    onChange();
  };
}

const statsNodes = () => ({ project: el.sfProject, version: el.sfVersion, reset: el.sfReset });

// Календарь живёт на той же странице, поэтому фильтр у них один: два разных
// ответа на вопрос «за какой проект смотрим» на одном экране сбивали бы.
const statsTasks = () => Core.filterTasks(state.tasks, state.versions, statsFilter);
/** Выбран один проект — считаем в его валюте и по его ставкам; все —
 *  в основной, и чужие валюты в деньги не входят. */
const statsRates = () => (statsFilter.projectId !== 'all' ? rates() : ratesMain());
const statsCurrency = () => (statsFilter.projectId !== 'all' ? currencyOf(statsFilter.projectId) : state.settings.currency);
const calAggregateDays = () => Core.aggregateDays(statsTasks(), statsRates());
const calRangeAgg = (from, to) => Core.rangeAgg(statsTasks(), from, to, statsRates());
const calSessionPairs = () => Core.allSessionPairs(statsTasks());

// --- Правая панель: записи, разложенные по проектам ---

/** Свёрнутые проекты в правой панели. Как и свёрнутые дорожки на доске —
 *  способ смотреть, в данных ему делать нечего. */
const calGroupsClosed = new Set();

function toggleCalGroup(projectId) {
  if (calGroupsClosed.has(projectId)) calGroupsClosed.delete(projectId);
  else calGroupsClosed.add(projectId);
  renderCalDayPanel();
}

function renderCalDayPanel() {
  if (calState.periodOn) renderPeriodSummary();
  else renderCalDay();
}

/** Раскладывает строки по проектам, сохраняя порядок первого появления: так
 *  проект, с которого начался день, и стоит первым.
 *  @param {Array<{t: object, ms: number, money: number}>} rows */
function groupByProject(rows) {
  const groups = new Map();
  for (const r of rows) {
    const pid = r.t.projectId;
    let g = groups.get(pid);
    if (!g) { g = { id: pid || '', project: getProject(pid), ms: 0, money: 0, rows: [] }; groups.set(pid, g); }
    g.rows.push(r);
    g.ms += r.ms;
    g.money += r.money;
  }
  return [...groups.values()];
}

/** Заголовок проекта в правой панели — он же кнопка сворачивания. */
function calGroupHead(g) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cdl-group-head';
  b.style.setProperty('--pc', g.project ? g.project.color : PALETTE[0]);
  b.setAttribute('aria-expanded', String(!calGroupsClosed.has(g.id)));
  b.innerHTML = `
    <svg class="icon cdl-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.3 6.2a.95.95 0 011.34 0L8 8.56l2.36-2.36a.95.95 0 111.34 1.34l-3.03 3.03a.95.95 0 01-1.34 0L4.3 7.54a.95.95 0 010-1.34z"/></svg>
    <span class="cdl-group-dot"></span>
    <span class="cdl-group-name">${escapeHtml(g.project ? g.project.name : t('xlsx.no_project'))}</span>
    <span class="cdl-group-tot">${fmtDur(g.ms)} · ${fmtMoney(g.money, currencyOf(g.project ? g.project.id : null))}</span>`;
  b.addEventListener('click', () => toggleCalGroup(g.id));
  return b;
}

/** Обёртка группы: заголовок плюс вложенный список её строк. */
function calGroupNode(g, buildRow) {
  const li = document.createElement('li');
  li.className = 'cdl-group';
  li.classList.toggle('closed', calGroupsClosed.has(g.id));
  li.appendChild(calGroupHead(g));
  const inner = document.createElement('ul');
  inner.className = 'cdl-rows';
  for (const r of g.rows) inner.appendChild(buildRow(r, g));
  li.appendChild(inner);
  return li;
}


// --- Календарь-расписание ---------------------------------------------------
// Отдельная страница с часовой сеткой: записи времени блоками, дедлайны
// полосой «весь день», проекты слева играют роль календарей. Записи можно
// заводить протягиванием, двигать и растягивать — поэтому здесь же лежат
// правила, по которым перетаскивание меняет данные.
//
// Календарь в «Статистике» остался прежним: он про деньги и итоги, этот —
// про расписание.

const AG_SNAP_MIN = 15;   // шаг прилипания при перетаскивании
const AG_MIN_MIN = 15;    // короче этого запись не сделать: её нечем ухватить
const AG_TIME_MODES = ['day', 'days4', 'week'];

const agenda = {
  mode: 'week',
  anchor: Core.startOfDayMs(Date.now()),
  miniMonth: Core.startOfDayMs(Date.now()),
  scrolled: false,
};

// Расписание слушает тот же фильтр проекта и версии, что и числа.
const agendaTasks = () => statsTasks();
const agendaSpan = () => Core.agendaRange(agenda.mode, agenda.anchor);
const agendaProjectColor = (projectId) => {
  const p = getProject(projectId);
  return p ? (p.color || PALETTE[0]) : PALETTE[0];
};

/** Переписывает время записи, сохраняя всё остальное: ставку и пометки о
 *  ручном вводе и восстановлении. Происхождение записи не меняется от того,
 *  что её подвинули. */
function setSessionSpan(task, index, startMs, endMs) {
  const old = task.sessions && task.sessions[index];
  if (!old) return;
  const ms = endMs - startMs;
  task.totalMs = Math.max(0, (task.totalMs || 0) - (old.ms || 0) + ms);
  task.sessions[index] = Object.assign({}, old, {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    ms,
  });
  task.updatedAt = new Date().toISOString();
}

/** Новая запись, заведённая прямо на сетке. Ставка запоминается такой, какая
 *  сейчас, — ровно как в окне правки записи. */
function addSessionSpan(task, startMs, endMs) {
  const ms = endMs - startMs;
  task.sessions = task.sessions || [];
  task.sessions.push({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    ms,
    rate: effectiveRate(task),
    manual: true,
  });
  task.totalMs = (task.totalMs || 0) + ms;
  task.updatedAt = new Date().toISOString();
}

// --- Отрисовка --------------------------------------------------------------

function renderAgendaPage() {
  renderAgendaHead();
  const timeGrid = AG_TIME_MODES.includes(agenda.mode);
  el.agTime.hidden = !timeGrid;
  el.agList.hidden = agenda.mode !== 'agenda';
  if (timeGrid) { renderAgendaTime(); syncAgendaScrollbar(); }
  else renderAgendaList();
}

function agendaTitle() {
  const { from, to } = agendaSpan();
  const a = new Date(from);
  const b = new Date(to - 1);
  if (agenda.mode === 'month') {
    const d = new Date(agenda.anchor);
    return monthLabel(d.getFullYear(), d.getMonth());
  }
  if (agenda.mode === 'day') {
    return capFirst(a.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }));
  }
  const left = a.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const right = b.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  return `${left} – ${right}`;
}

function renderAgendaHead() {
  el.agModes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === agenda.mode));
  el.agTitle.textContent = agendaTitle();
}

/** Сетка живёт в прокручиваемой области и теряет ширину её полосы, а шапка
 *  дней и строка «весь день» — нет. Из-за этого их границы расходились с
 *  линиями сетки тем сильнее, чем правее столбец: к воскресенью набегало
 *  девять пикселей. Меряем полосу и резервируем ровно столько же.
 *
 *  Ширина полосы не константа: её задаёт система, а в вебе она ещё и
 *  пропадает, когда сетка целиком помещается в окно. */
function syncAgendaScrollbar() {
  const box = el.agScroll;
  if (!box) return;
  const grid = Math.max(0, box.offsetWidth - box.clientWidth);
  // У строки «весь день» бывает своя полоса: дедлайнов на день больше, чем
  // в неё помещается. Тогда её содержимое и так уже сетки, и запас нужен
  // меньший — иначе вычтем полосу дважды и колонки уедут влево.
  const row = el.agAlldayRow ? Math.max(0, el.agAlldayRow.offsetWidth - el.agAlldayRow.clientWidth) : 0;
  const put = (name, px) => {
    const next = px + 'px';
    if (el.agTime.style.getPropertyValue(name) !== next) el.agTime.style.setProperty(name, next);
  };
  put('--ag-sb', grid);
  put('--ag-sb-row', Math.max(0, grid - row));
}
/** Часовая сетка: день, четыре дня или неделя. */
/** Всё, что нужно правилам календаря (core/views.js). */
const agendaCtx = () => {
  const { from, days } = agendaSpan();
  return {
    from,
    days,
    anchor: agenda.anchor,
    now: Date.now(),
    t,
    fmtTime,
    locale: locale(),
    projectColor: agendaProjectColor,
  };
};

/** День из календаря открывается во весь экран: клик по числу. */
const openAgendaDay = (start) => { agenda.anchor = Core.startOfDayMs(start); agenda.mode = 'day'; state.ui.timeMode = 'day'; };

/** Часовая сетка — день, четыре дня или неделя. Что показать — решает
 *  ядро (agendaTimeView); здесь сборка DOM, черта «сейчас» и прокрутка. */
function renderAgendaTime() {
  const v = Core.agendaTimeView(agendaTasks(), agendaCtx());

  for (const node of [el.agDaynames, el.agAllday, el.agCols]) node.style.setProperty('--ag-days', String(v.days.length));

  el.agDaynames.innerHTML = '';
  el.agAllday.innerHTML = '';
  for (const d of v.days) {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ag-dayname' + (d.today ? ' today' : '');
    head.innerHTML = `<span class="ag-dow">${escapeHtml(d.weekday)}</span>`
      + `<span class="ag-dnum">${d.date}</span>`;
    head.addEventListener('click', () => openAgendaDay(d.start));
    el.agDaynames.appendChild(head);

    const cell = elt('div', 'ag-allday-cell');
    for (const dl of d.deadlines) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ag-dl' + (dl.done ? ' done' : '') + (dl.ghost ? ' ghost' : '');
      chip.style.setProperty('--pc', dl.color);
      chip.title = dl.tooltip;
      chip.textContent = dl.label;
      chip.addEventListener('click', () => openTaskModal(getTask(dl.taskId), null));
      cell.appendChild(chip);
    }
    el.agAllday.appendChild(cell);
  }

  el.agGutter.innerHTML = '';
  for (const label of v.hours) el.agGutter.appendChild(elt('span', 'ag-hour', label));

  el.agCols.innerHTML = '';
  for (const d of v.days) {
    const col = elt('div', 'ag-col' + (d.today ? ' today' : ''));
    col.dataset.dayIndex = String(d.index);
    col.dataset.dayStart = String(d.start);
    for (const ln of v.lines) {
      const line = elt('div', 'ag-line' + (ln.half ? ' half' : ''));
      line.style.top = `${ln.top}%`;
      col.appendChild(line);
    }
    for (const seg of d.blocks) col.appendChild(agendaBlock(seg));
    el.agCols.appendChild(col);
  }

  renderAgendaNow();

  // При первом показе прокручиваем к утру: иначе сетка открывается на
  // полуночи, где обычно пусто.
  if (!agenda.scrolled) {
    agenda.scrolled = true;
    el.agScroll.scrollTop = el.agScroll.scrollHeight * (7.5 / 24);
  }
}

function agendaBlock(seg) {
  const task = getTask(seg.taskId);
  const node = document.createElement('div');
  node.className = 'ag-ev' + (seg.crossesDay ? ' cross' : '');
  node.style.setProperty('--pc', agendaProjectColor(seg.projectId));
  node.style.top = `${Core.dayFraction(seg.start) * 100}%`;
  node.style.height = `${(seg.ms / Core.DAY) * 100}%`;
  node.style.left = `calc(${(seg.col / seg.cols) * 100}% + 1px)`;
  node.style.width = `calc(${(1 / seg.cols) * 100}% - 3px)`;
  node.dataset.taskId = seg.taskId;
  node.dataset.index = String(seg.index);
  node.innerHTML = `<span class="ag-ev-time">${fmtTime(seg.start).slice(0, 5)}–${fmtTime(seg.end).slice(0, 5)}</span>`
    + `<span class="ag-ev-name">${escapeHtml(task ? (task.title || t('task.no_name')) : '')}</span>`
    + '<span class="ag-ev-grip" aria-hidden="true"></span>';
  return node;
}

/** Красная черта «сейчас» — только в столбце сегодняшнего дня. */
function renderAgendaNow() {
  el.agCols.querySelectorAll('.ag-now').forEach((n) => n.remove());
  if (!AG_TIME_MODES.includes(agenda.mode)) return;
  const now = Date.now();
  const { from, days } = agendaSpan();
  const idx = Math.floor((Core.startOfDayMs(now) - from) / Core.DAY);
  if (idx < 0 || idx >= days) return;
  const col = el.agCols.children[idx];
  if (!col) return;
  const line = document.createElement('div');
  line.className = 'ag-now';
  line.style.top = `${Core.dayFraction(now) * 100}%`;
  line.title = t('agenda.now');
  col.appendChild(line);
}

/** Месяц: клетки с короткими чипами, как в Google. Что показать —
 *  решает ядро (agendaMonthView); здесь только сборка DOM. */
function renderAgendaList() {
  const { from, to } = agendaSpan();
  const tasks = agendaTasks();
  const segments = Core.sessionSegments(tasks, from, to);
  const deadlines = Core.deadlineItems(tasks, from, to).concat(repeatGhosts(tasks, from, to));

  el.agList.innerHTML = '';
  const byDay = new Map();
  const put = (dayIndex, row) => {
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, []);
    byDay.get(dayIndex).push(row);
  };
  for (const dl of deadlines) put(dl.dayIndex, { kind: 'dl', at: dl.at, dl });
  for (const seg of segments) put(seg.dayIndex, { kind: 'seg', at: seg.start, seg });

  const keys = [...byDay.keys()].sort((a, b) => a - b);
  if (!keys.length) {
    const empty = document.createElement('p');
    empty.className = 'muted ag-empty';
    empty.textContent = t('agenda.empty');
    el.agList.appendChild(empty);
    return;
  }

  for (const dayIndex of keys) {
    const d = new Date(from + dayIndex * Core.DAY);
    const group = document.createElement('div');
    group.className = 'ag-list-day';
    group.innerHTML = `<div class="ag-list-date">${escapeHtml(capFirst(d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })))}</div>`;
    const rows = byDay.get(dayIndex).sort((a, b) => a.at - b.at);
    for (const row of rows) {
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'ag-list-row' + (row.kind === 'dl' ? ' dl' : '') + (row.dl && row.dl.ghost ? ' ghost' : '');
      if (row.kind === 'dl') {
        const task = getTask(row.dl.taskId);
        line.style.setProperty('--pc', agendaProjectColor(row.dl.projectId));
        line.innerHTML = `<span class="ag-list-time">${fmtTime(row.dl.at).slice(0, 5)}</span>`
          + `<span class="ag-list-name">${escapeHtml(task ? (task.title || t('task.no_name')) : '')}</span>`
          + `<span class="ag-list-tag">${escapeHtml(t('agenda.deadline'))}</span>`;
        line.addEventListener('click', () => openTaskModal(getTask(row.dl.taskId), null));
      } else {
        const task = getTask(row.seg.taskId);
        line.style.setProperty('--pc', agendaProjectColor(row.seg.projectId));
        line.innerHTML = `<span class="ag-list-time">${fmtTime(row.seg.start).slice(0, 5)}–${fmtTime(row.seg.end).slice(0, 5)}</span>`
          + `<span class="ag-list-name">${escapeHtml(task ? (task.title || t('task.no_name')) : '')}</span>`
          + `<span class="ag-list-dur">${fmtDur(row.seg.ms)}</span>`;
        line.addEventListener('click', () => { if (task) openTaskModal(task, row.seg.index); });
      }
      group.appendChild(line);
    }
    el.agList.appendChild(group);
  }
}

// --- Перетаскивание ---------------------------------------------------------

const agDrag = { kind: null, taskId: null, index: null, dayStart: 0, start: 0, end: 0, grab: 0, node: null, moved: false, pointerId: null };

/** Время под курсором: столбец даёт день, высота — время внутри суток. */
function agendaPointAt(clientX, clientY) {
  const rect = el.agCols.getBoundingClientRect();
  const { from, days } = agendaSpan();
  const colW = rect.width / days;
  const dayIndex = Math.max(0, Math.min(days - 1, Math.floor((clientX - rect.left) / colW)));
  const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const dayStart = from + dayIndex * Core.DAY;
  return { dayIndex, dayStart, ms: dayStart + frac * Core.DAY };
}

function agendaPaintDrag() {
  const node = agDrag.node;
  if (!node) return;
  const day = Core.startOfDayMs(agDrag.start);
  node.style.top = `${Core.dayFraction(agDrag.start) * 100}%`;
  node.style.height = `${((agDrag.end - agDrag.start) / Core.DAY) * 100}%`;
  const label = node.querySelector('.ag-ev-time');
  if (label) label.textContent = `${fmtTime(agDrag.start).slice(0, 5)}–${fmtTime(agDrag.end).slice(0, 5)}`;
  // Блок мог переехать в другой день — тогда он меняет столбец.
  const { from, days } = agendaSpan();
  const idx = Math.round((day - from) / Core.DAY);
  if (idx >= 0 && idx < days && el.agCols.children[idx] && node.parentElement !== el.agCols.children[idx]) {
    el.agCols.children[idx].appendChild(node);
  }
}

el.agCols.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const point = agendaPointAt(e.clientX, e.clientY);
  const block = e.target.closest ? e.target.closest('.ag-ev') : null;

  if (block && !block.classList.contains('ag-ghost')) {
    const task = getTask(block.dataset.taskId);
    const s = task && task.sessions ? task.sessions[Number(block.dataset.index)] : null;
    if (!s) return;
    const a = new Date(s.start).getTime();
    const b = s.end ? new Date(s.end).getTime() : a + (s.ms || 0);
    agDrag.kind = e.target.classList.contains('ag-ev-grip') ? 'resize' : 'move';
    agDrag.taskId = task.id;
    agDrag.index = Number(block.dataset.index);
    agDrag.start = a;
    agDrag.end = b;
    agDrag.grab = point.ms - a;
    agDrag.node = block;
    block.classList.add('dragging');
  } else {
    agDrag.kind = 'create';
    agDrag.dayStart = point.dayStart;
    agDrag.start = Core.snapMinutes(point.ms, AG_SNAP_MIN);
    agDrag.end = agDrag.start;
    const ghost = document.createElement('div');
    ghost.className = 'ag-ev ag-ghost';
    ghost.innerHTML = '<span class="ag-ev-time"></span>';
    const { from } = agendaSpan();
    const col = el.agCols.children[Math.round((point.dayStart - from) / Core.DAY)];
    if (!col) { agDrag.kind = null; return; }
    col.appendChild(ghost);
    agDrag.node = ghost;
  }

  agDrag.moved = false;
  agDrag.pointerId = e.pointerId;
  el.agCols.setPointerCapture(e.pointerId);
  e.preventDefault();
});

el.agCols.addEventListener('pointermove', (e) => {
  if (!agDrag.kind) return;
  const point = agendaPointAt(e.clientX, e.clientY);
  agDrag.moved = true;

  if (agDrag.kind === 'create') {
    const edge = Core.snapMinutes(point.ms, AG_SNAP_MIN);
    const a = Math.min(agDrag.dayStart + Core.DAY, Math.max(agDrag.dayStart, Math.min(edge, agDrag.start)));
    const b = Math.min(agDrag.dayStart + Core.DAY, Math.max(edge, agDrag.start));
    agDrag.start = a;
    agDrag.end = b;
  } else if (agDrag.kind === 'resize') {
    const span = Core.clampSpan(Core.startOfDayMs(agDrag.start), agDrag.start, Core.snapMinutes(point.ms, AG_SNAP_MIN), AG_MIN_MIN);
    agDrag.start = span.start;
    agDrag.end = span.end;
  } else {
    const dur = agDrag.end - agDrag.start;
    const start = Core.snapMinutes(point.ms - agDrag.grab, AG_SNAP_MIN);
    const span = Core.clampSpan(point.dayStart, start, start + dur, AG_MIN_MIN);
    agDrag.start = span.start;
    agDrag.end = span.end;
  }
  agendaPaintDrag();
});

function agendaEndDrag(e) {
  if (!agDrag.kind) return;
  const kind = agDrag.kind;
  const moved = agDrag.moved;
  const node = agDrag.node;
  agDrag.kind = null;
  if (agDrag.pointerId != null && el.agCols.hasPointerCapture(agDrag.pointerId)) {
    el.agCols.releasePointerCapture(agDrag.pointerId);
  }
  agDrag.pointerId = null;

  if (kind === 'create') {
    if (node) node.remove();
    let { start, end } = agDrag;
    // Простой щелчок по пустому месту — час с этой отметки, как в Google.
    if (!moved || end - start < AG_MIN_MIN * 60000) end = start + 3_600_000;
    openAgendaDraft(Core.clampSpan(agDrag.dayStart, start, end, AG_MIN_MIN));
    return;
  }

  const task = getTask(agDrag.taskId);
  if (node) node.classList.remove('dragging');
  if (!task) { renderAgendaPage(); return; }
  if (!moved) {
    // Клик без протягивания — это открыть запись, а не подвинуть её.
    openTaskModal(task, agDrag.index);
    renderAgendaPage();
    return;
  }
  setSessionSpan(task, agDrag.index, agDrag.start, agDrag.end);
  render();
  scheduleSave();
}

el.agCols.addEventListener('pointerup', agendaEndDrag);
el.agCols.addEventListener('pointercancel', () => {
  if (!agDrag.kind) return;
  if (agDrag.kind === 'create' && agDrag.node) agDrag.node.remove();
  agDrag.kind = null;
  renderAgendaPage();
});

/** Задача, заведённая прямо с календаря. В отличие от newTask() никуда не
 *  уводит: мы остаёмся на сетке и должны увидеть на ней новую запись. */
function newTaskOnAgenda(projectId, title) {
  const now = new Date().toISOString();
  const task = {
    id: uid(), projectId, title, done: false, notes: null,
    totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
    statusId: defaultStatusId(projectId, false), tagIds: [], versionId: null, repeat: null, cancelled: false,
    dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
  };
  state.tasks.unshift(task);
  return task;
}

/** Проект для новой записи: тот, что выбирали в прошлый раз, иначе открытый
 *  проект, иначе первый видимый. */
function agendaDefaultProject() {
  const alive = (id) => id && state.projects.some((p) => p.id === id);
  if (alive(agenda.lastProjectId)) return agenda.lastProjectId;
  if (alive(state.ui.projectId)) return state.ui.projectId;
  const shown = state.projects.find((p) => statsFilter.projectId === 'all' || p.id === statsFilter.projectId);
  return (shown || state.projects[0]).id;
}

/** Запись завели в проекте, который фильтр прячет, — иначе создание выглядит
 *  как «ничего не произошло»: задача есть, а блока на сетке нет. */
function revealProjectOnTime(projectId) {
  if (statsFilter.projectId === 'all' || statsFilter.projectId === projectId) return;
  statsFilter.projectId = 'all';
  statsFilter.versionId = 'all';
}

/** Новая запись. Черновик задачи заводится сразу: только так окно может
 *  показать все её настройки — они работают с настоящей задачей из state,
 *  а не с выдуманной заготовкой. «Отмена» убирает черновик целиком. */
function openAgendaDraft(span) {
  if (!state.projects.length) { toast(t('agenda.no_projects')); return; }
  const task = newTaskOnAgenda(agendaDefaultProject(), '');
  addSessionSpan(task, span.start, span.end);
  revealProjectOnTime(task.projectId);
  render();
  openTaskModal(task, 0, { fresh: true });
}

// --- Задача с календаря -----------------------------------------------------

/** Настройки задачи в модалке не написаны заново: сюда на время переезжает
 *  тот же узел .task-params, что живёт под названием задачи (#task-props). Значит совпадение
 *  окна и вкладки не нужно поддерживать — оно устроено так по построению, а
 *  все обработчики (статус, теги, ставка, срок, повторение) работают как
 *  были: они берут задачу из selectedId, который мы и подменяем. */
const tmdlg = { taskId: null, index: null, date: null, start: null, end: null, fresh: false };

function openTaskModal(task, index, opts) {
  if (!task) return;
  closeMenu();
  tmdlg.taskId = task.id;
  tmdlg.fresh = !!(opts && opts.fresh);
  tmdlg.index = index != null ? index : null;
  selectedId = task.id;
  el.tmdlgParams.appendChild(el.taskParams);

  const s = tmdlg.index != null ? (task.sessions || [])[tmdlg.index] : null;
  el.tmdlgEntry.hidden = !s;
  if (s) {
    const start = new Date(s.start);
    const end = s.end ? new Date(s.end) : new Date();
    tmdlg.date = dayKey(start);
    tmdlg.start = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
    tmdlg.end = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
  }
  renderTaskModal();
  el.tmdlgBackdrop.hidden = false;
  if (tmdlg.fresh) el.tmdlgTitle.focus();
}

/** discard — только для черновика: закрыть, не оставив задачи. Готовую
 *  задачу окно не удаляет никогда, чем бы его ни закрыли. */
function closeTaskModal(discard) {
  if (el.tmdlgBackdrop.hidden) return;
  const draftId = tmdlg.fresh && discard ? tmdlg.taskId : null;
  el.tmdlgBackdrop.hidden = true;
  // Узел возвращается под название задачи. Не вернуть — и страница задачи
  // останется без свойств до перезагрузки.
  el.taskProps.insertBefore(el.taskParams, el.taskProps.firstChild);
  tmdlg.taskId = null;
  tmdlg.fresh = false;
  closeDatePicker();
  closeTimePicker();
  if (draftId) {
    state.tasks = state.tasks.filter((x) => x.id !== draftId);
    if (selectedId === draftId) selectedId = null;
    render();
    scheduleSave();
  }
}

const tmdlgTimes = () => spanFromParts(tmdlg.date, tmdlg.start, tmdlg.end);

function renderTaskModal() {
  const task = getTask(tmdlg.taskId);
  if (!task) { closeTaskModal(); return; }

  if (document.activeElement !== el.tmdlgTitle) el.tmdlgTitle.value = task.title || '';
  el.tmdlgTitle.placeholder = t(tmdlg.fresh ? 'agenda.task_name_ph' : 'task.no_name');
  el.tmdlgKicker.hidden = !tmdlg.fresh;
  const project = getProject(task.projectId);
  el.tmdlgDot.style.setProperty('--pc', agendaProjectColor(task.projectId));
  el.tmdlgProj.textContent = project ? project.name : '';
  // Проект меняют только у черновика: у заведённой задачи за ним тянутся
  // её статус и версия, и переезд был бы не переключателем, а переносом.
  el.tmdlgProj.disabled = !tmdlg.fresh;
  el.tmdlgTot.textContent = `${fmtDur(taskElapsedMs(task))} · ${fmtMoney(earnedOf(task), currencyOf(task.projectId))}`;
  el.tmdlgOpen.textContent = t(tmdlg.fresh ? 'common.cancel' : 'agenda.open_task');
  el.tmdlgDone.textContent = t(tmdlg.fresh ? 'agenda.create_btn' : 'common.done');
  renderTmdlgFound();

  if (!el.tmdlgEntry.hidden) {
    el.tmdlgDate.textContent = fmtDpBtn(tmdlg.date);
    el.tmdlgStart.textContent = tmdlg.start;
    el.tmdlgEnd.textContent = tmdlg.end;
    const span = tmdlgTimes();
    el.tmdlgDur.textContent = span ? fmtDur(span.ms) : t('sdlg.check_datetime');
  }

  // Те же отрисовщики, что у вкладки задачи. renderDetail() сюда не годится:
  // он требует, чтобы задача была из открытого проекта, а с календаря она
  // может быть из любого.
  renderTaskStatus(task);
  renderTaskVersion(task);
  renderTaskRepeat(task);
  renderTaskTags(task);
  renderMoney(task);
  renderDue(task);
}

/** Пока имя набирается, под ним показываются подходящие существующие
 *  задачи: то же время можно дописать к уже заведённой, не открывая
 *  второго окна. Вид взят у пикера тегов — это тот же приём «набери или
 *  выбери», и заводить под него второй стиль незачем. */
function renderTmdlgFound() {
  const q = tmdlg.fresh ? el.tmdlgTitle.value.trim().toLowerCase() : '';
  const items = q
    ? state.tasks
      .filter((t2) => t2.id !== tmdlg.taskId && (t2.title || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 5)
    : [];
  el.tmdlgFound.hidden = !items.length;
  el.tmdlgFoundList.innerHTML = '';
  for (const task of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag-pop-item';
    b.innerHTML = `<span class="tag-dot" style="--sc:${escapeHtml(agendaProjectColor(task.projectId))}"></span>`
      + `<span class="tag-pop-name">${escapeHtml(task.title || t('task.no_name'))}</span>`;
    b.addEventListener('click', () => attachToExisting(task));
    el.tmdlgFoundList.appendChild(b);
  }
}

/** Время уходит к выбранной задаче, а черновик исчезает. */
function attachToExisting(task) {
  const span = tmdlgTimes();
  closeTaskModal(true);
  if (!task || !span) return;
  addSessionSpan(task, span.start.getTime(), span.end.getTime());
  agenda.lastProjectId = task.projectId;
  revealProjectOnTime(task.projectId);
  render();
  scheduleSave();
  toast(t('agenda.new_entry'));
}

/** Правка отрезка сохраняется сразу, без кнопки: слишком короткий просто не
 *  записывается, и об этом говорит подпись длительности. */
function commitTmdlgEntry() {
  const task = getTask(tmdlg.taskId);
  const span = tmdlgTimes();
  renderTaskModal();
  if (!task || tmdlg.index == null || !span || span.ms < 60_000) return;
  applySessionEdit(task, tmdlg.index, span);
  render();
  scheduleSave();
}

el.tmdlgDate.addEventListener('click', () => openDatePicker(el.tmdlgDate, tmdlg.date, (key) => {
  tmdlg.date = key; commitTmdlgEntry();
}));
el.tmdlgStart.addEventListener('click', () => openTimePicker(el.tmdlgStart, tmdlg.start, (val) => {
  tmdlg.start = val; commitTmdlgEntry();
}));
el.tmdlgEnd.addEventListener('click', () => openTimePicker(el.tmdlgEnd, tmdlg.end, (val) => {
  tmdlg.end = val; commitTmdlgEntry();
}));

el.tmdlgTitle.addEventListener('input', () => {
  const task = getTask(tmdlg.taskId);
  if (!task) return;
  task.title = el.tmdlgTitle.value;
  task.updatedAt = new Date().toISOString();
  render();
  renderTmdlgFound();
  scheduleSave();
});
el.tmdlgTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && tmdlg.fresh) { e.preventDefault(); closeTaskModal(false); }
});

el.tmdlgProj.addEventListener('click', () => {
  const task = getTask(tmdlg.taskId);
  if (!task || !tmdlg.fresh) return;
  openMenu(el.tmdlgProj, state.projects.map((p) => ({
    label: p.name,
    selected: p.id === task.projectId,
    onClick: () => {
      // Статусы и версии у проектов свои, прежние ссылки теряют смысл.
      task.projectId = p.id;
      task.statusId = defaultStatusId(p.id, false);
      task.versionId = null;
      task.updatedAt = new Date().toISOString();
      agenda.lastProjectId = p.id;
      revealProjectOnTime(p.id);
      render();
      el.tmdlgTitle.focus();
    },
  })));
});

el.tmdlgDel.addEventListener('click', () => {
  const task = getTask(tmdlg.taskId);
  if (!task || tmdlg.index == null) return;
  const s = (task.sessions || [])[tmdlg.index];
  if (!s) return;
  task.totalMs = Math.max(0, (task.totalMs || 0) - s.ms);
  task.sessions.splice(tmdlg.index, 1);
  task.updatedAt = new Date().toISOString();
  // Записи больше нет — править нечего, а сама задача остаётся открытой.
  tmdlg.index = null;
  el.tmdlgEntry.hidden = true;
  renderTaskModal();
  render();
  scheduleSave();
});

el.tmdlgOpen.addEventListener('click', () => {
  // У черновика эта кнопка — «Отмена».
  if (tmdlg.fresh) { closeTaskModal(true); return; }
  const id = tmdlg.taskId;
  closeTaskModal(false);
  const task = getTask(id);
  if (!task) return;
  openProject(task.projectId);
  selectTask(task.id);
});

el.tmdlgDone.addEventListener('click', () => closeTaskModal(false));
el.tmdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.tmdlgBackdrop) closeTaskModal(true); });

// --- Управление -------------------------------------------------------------

function agendaGo(dir) {
  agenda.anchor = Core.shiftAnchor(agenda.mode, agenda.anchor, dir);
  agenda.miniMonth = Core.startOfDayMs(agenda.anchor);
  renderAgendaPage();
}

function agendaSetMode(mode) {
  setTimeMode(mode);
}

// Одна шапка на все режимы: месяц листает сетку итогов, остальные — расписание.
el.agModes.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setTimeMode(b.dataset.mode);
});
el.timePrev.addEventListener('click', () => { if (timeMode() === 'month') calShift(-1); else agendaGo(-1); renderTimePage(); });
el.timeNext.addEventListener('click', () => { if (timeMode() === 'month') calShift(1); else agendaGo(1); renderTimePage(); });
el.timeToday.addEventListener('click', () => {
  const n = new Date();
  agenda.anchor = Core.startOfDayMs(n.getTime());
  calState.year = n.getFullYear();
  calState.month = n.getMonth();
  calState.weekStart = mondayOf(n);
  calState.day = startOfDay(n);
  calState.selected = dayKey(n);
  if (calState.periodOn) seedRangeFromView();
  renderTimePage();
});
el.timeStatsToggle.addEventListener('click', () => {
  state.ui.timeStatsHidden = !state.ui.timeStatsHidden;
  renderTimePage();
  scheduleSave();
});
el.agCreate.addEventListener('click', (e) => {
  // Час с ближайшей четверти: начинать запись с «сейчас» удобнее, чем с
  // произвольного места сетки.
  const start = Core.snapMinutes(Date.now(), AG_SNAP_MIN);
  openAgendaDraft({ start, end: start + 3_600_000 });
});

// Горячие клавиши как в Google: режимы цифрами и буквами, T — сегодня,
// стрелки — шаг по времени. Работают только на этой странице и не мешают
// набору текста.
document.addEventListener('keydown', (e) => {
  if (state.ui.view !== 'time') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (anyDialogOpen()) return;
  const node = document.activeElement;
  if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)) return;
  const key = e.key.toLowerCase();
  const modes = { 1: 'day', d: 'day', 2: 'week', w: 'week', 3: 'month', m: 'month', 4: 'days4', x: 'days4', 5: 'agenda', a: 'agenda' };
  if (modes[key]) { e.preventDefault(); setTimeMode(modes[key]); return; }
  if (key === 't' || key === 'е') { e.preventDefault(); el.timeToday.click(); return; }
  if (key === 'arrowleft' || key === 'k') { e.preventDefault(); el.timePrev.click(); return; }
  if (key === 'arrowright' || key === 'j') { e.preventDefault(); el.timeNext.click(); }
});

// Черта «сейчас» ползёт сама, пока страница открыта.
setInterval(() => {
  if (state.ui.view === 'time' && timeMode() !== 'month' && AG_TIME_MODES.includes(agenda.mode)) renderAgendaNow();
}, 60_000);


// --- Повторение задач -------------------------------------------------------
// Правило лежит в task.repeat, разбор и расчёт следующего срока — в
// core/repeat.js. Здесь связь с интерфейсом и то, что происходит с задачей,
// когда её закрывают.

const WEEKDAY_KEYS = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
const REPEAT_UNIT_KEY = { day: 'repeat.unit_day', week: 'repeat.unit_week', month: 'repeat.unit_month', year: 'repeat.unit_year' };
const REPEAT_PRESET_KEY = { day: 'repeat.daily', week: 'repeat.weekly', month: 'repeat.monthly', year: 'repeat.yearly' };

const weekdayName = (d) => t(WEEKDAY_KEYS[d % 7]);

/** Человеческая подпись правила. Ядро отдаёт ключ и подстановки — перевод и
 *  склейка дней недели делаются здесь, где известен язык. */
function repeatLabel(rule) {
  const d = Core.describeRepeat(rule);
  if (!d) return t('repeat.none');
  const vars = { ...d.vars };
  if (Array.isArray(vars.days)) vars.days = vars.days.map(weekdayName).join(', ');
  return capFirst(t(d.key, vars));
}

/** Строка повторения в настройках задачи. Прячется без дедлайна: повторение
 *  считается от него, и предлагать его раньше было бы обманом. */
function renderTaskRepeat(task) {
  const has = !!task.dueAt;
  el.repeatRow.hidden = !has;
  if (!has) return;
  const rule = Core.normalizeRepeat(task.repeat);
  el.taskRepeat.textContent = rule ? repeatLabel(rule) : t('repeat.none');
  // Без повторения фишка тихая — как пустой срок.
  el.taskRepeat.classList.toggle('is-empty', !rule);
  // Класс .on тут не годится: у dp-btn он значит «список открыт».
  // Что повторение включено, видно по самой подписи.

  if (!rule || Core.repeatFinished(rule)) {
    el.repeatNext.hidden = true;
    return;
  }
  const next = Core.nextDue(rule, new Date(task.dueAt).getTime());
  el.repeatNext.hidden = next == null;
  if (next != null) el.repeatNext.textContent = t('repeat.next', { date: fmtDateShort(next) });
}

/** Готовое правило из пресета меню. */
function presetRule(freq, weekdays) {
  return {
    freq,
    every: 1,
    weekdays: weekdays || [],
    monthMode: 'day',
    from: 'schedule',
    keepHistory: false,
    ends: { kind: 'never', count: 10, at: null },
    done: 0,
  };
}

function setTaskRepeat(task, rule) {
  task.repeat = rule ? Core.normalizeRepeat(rule) : null;
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

el.taskRepeat.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (!task) return;
  if (!task.dueAt) { toast(t('repeat.needs_due')); return; }
  const cur = Core.normalizeRepeat(task.repeat);
  const isPreset = (freq, days) => cur && cur.freq === freq && cur.every === 1
    && cur.ends.kind === 'never' && !cur.keepHistory && cur.from === 'schedule'
    && JSON.stringify(cur.weekdays) === JSON.stringify(days || []);

  const items = [
    { label: t('repeat.none'), selected: !cur, onClick: () => setTaskRepeat(task, null) },
    { label: t('repeat.daily'), selected: isPreset('day'), onClick: () => setTaskRepeat(task, presetRule('day')) },
    { label: t('repeat.weekly'), selected: isPreset('week'), onClick: () => setTaskRepeat(task, presetRule('week')) },
    { label: t('repeat.weekdays_preset'), selected: isPreset('week', [1, 2, 3, 4, 5]), onClick: () => setTaskRepeat(task, presetRule('week', [1, 2, 3, 4, 5])) },
    { label: t('repeat.monthly'), selected: isPreset('month'), onClick: () => setTaskRepeat(task, presetRule('month')) },
    { label: t('repeat.yearly'), selected: isPreset('year'), onClick: () => setTaskRepeat(task, presetRule('year')) },
    { sep: true },
    { label: t('repeat.custom'), onClick: () => openRepeatDialog(task) },
  ];
  openMenu(el.taskRepeat, items);
});

// --- Окно тонкой настройки --------------------------------------------------

const rpdlg = { task: null, rule: null };

function openRepeatDialog(task) {
  rpdlg.task = task;
  rpdlg.rule = Core.normalizeRepeat(task.repeat) || presetRule('week');
  renderRepeatDialog();
  el.rpdlgBackdrop.hidden = false;
}
function closeRepeatDialog() {
  el.rpdlgBackdrop.hidden = true;
  rpdlg.task = null;
  closeDatePicker();
}

/** Отмечает выбранную кнопку в сегментной группе — тем же приёмом, что у
 *  режимов календаря и фильтра задач. */
function markSegment(group, attr, value) {
  group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
}

function renderRepeatDialog() {
  const r = rpdlg.rule;

  markSegment(el.rpFreqSeg, 'freq', r.freq);
  if (document.activeElement !== el.rpEvery) el.rpEvery.value = String(r.every);
  el.rpUnit.textContent = t(REPEAT_UNIT_KEY[r.freq]);

  el.rpDays.hidden = r.freq !== 'week';
  if (r.freq === 'week') {
    el.rpDays.innerHTML = '';
    // Неделя начинается с понедельника — как во всём приложении.
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rp-day' + (r.weekdays.includes(d) ? ' on' : '');
      b.dataset.day = String(d);
      b.textContent = weekdayName(d);
      b.addEventListener('click', () => {
        r.weekdays = r.weekdays.includes(d)
          ? r.weekdays.filter((x) => x !== d)
          : [...r.weekdays, d].sort((a, b2) => a - b2);
        renderRepeatDialog();
      });
      el.rpDays.appendChild(b);
    }
  }

  el.rpMonthSeg.hidden = r.freq !== 'month';
  markSegment(el.rpMonthSeg, 'mode', r.monthMode);
  markSegment(el.rpFromSeg, 'from', r.from);
  markSegment(el.rpEndsSeg, 'ends', r.ends.kind);

  el.rpAfter.hidden = r.ends.kind !== 'after';
  el.rpUntilRow.hidden = r.ends.kind !== 'on';
  if (r.ends.kind === 'after' && document.activeElement !== el.rpCount) el.rpCount.value = String(r.ends.count);
  if (r.ends.kind === 'on') el.rpUntil.textContent = fmtDpBtn(r.ends.at || dayKey(new Date()));

  el.rpHistory.classList.toggle('on', !!r.keepHistory);
  el.rpHistory.setAttribute('aria-pressed', String(!!r.keepHistory));

  // Сводка: правило словами и ближайшие сроки. Без неё «каждый второй
  // вторник месяца» проверить нечем — приходится закрывать окно и смотреть.
  const base = rpdlg.task && rpdlg.task.dueAt ? new Date(rpdlg.task.dueAt).getTime() : Date.now();
  const soon = Core.upcomingDue(r, base, base + (400 * 86400000), 3);
  el.rpPreview.innerHTML = '<span class="rp-summary-mark">↻</span>'
    + `<span class="rp-summary-main"><b>${escapeHtml(repeatLabel(r))}</b>`
    + (soon.length ? `<span class="rp-summary-dates">${soon.map((ms) => escapeHtml(fmtDateShort(ms))).join(' · ')}</span>` : '')
    + '</span>';
  applyStaticTranslations();
}

el.rpEvery.addEventListener('input', () => {
  const n = parseInt(el.rpEvery.value.replace(/\D/g, ''), 10);
  rpdlg.rule.every = Number.isFinite(n) && n > 0 ? Math.min(99, n) : 1;
  renderRepeatDialog();
});
el.rpCount.addEventListener('input', () => {
  const n = parseInt(el.rpCount.value.replace(/\D/g, ''), 10);
  rpdlg.rule.ends.count = Number.isFinite(n) && n > 0 ? Math.min(999, n) : 1;
  renderRepeatDialog();
});
el.rpFreqSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-freq]');
  if (!b) return;
  rpdlg.rule.freq = b.dataset.freq;
  renderRepeatDialog();
});
el.rpMonthSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  rpdlg.rule.monthMode = b.dataset.mode;
  renderRepeatDialog();
});
el.rpFromSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-from]');
  if (!b) return;
  rpdlg.rule.from = b.dataset.from;
  renderRepeatDialog();
});
el.rpEndsSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ends]');
  if (!b) return;
  rpdlg.rule.ends.kind = b.dataset.ends;
  if (b.dataset.ends === 'on' && !rpdlg.rule.ends.at) {
    rpdlg.rule.ends.at = dayKey(new Date(Date.now() + (90 * 86400000)));
  }
  renderRepeatDialog();
});
el.rpUntil.addEventListener('click', () => {
  openDatePicker(el.rpUntil, rpdlg.rule.ends.at || dayKey(new Date()), (key) => {
    rpdlg.rule.ends.at = key;
    renderRepeatDialog();
  });
});
el.rpHistory.addEventListener('click', () => {
  rpdlg.rule.keepHistory = !rpdlg.rule.keepHistory;
  renderRepeatDialog();
});
el.rpdlgCancel.addEventListener('click', closeRepeatDialog);
el.rpdlgOff.addEventListener('click', () => { const task = rpdlg.task; closeRepeatDialog(); setTaskRepeat(task, null); });
el.rpdlgSave.addEventListener('click', () => {
  const task = rpdlg.task;
  const rule = rpdlg.rule;
  // Неделя без выбранных дней — это просто «раз в N недель», и такое правило
  // тоже осмысленно: пусть остаётся как есть.
  closeRepeatDialog();
  setTaskRepeat(task, rule);
});
el.rpdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.rpdlgBackdrop) closeRepeatDialog(); });


// --- Что происходит при закрытии задачи -------------------------------------

/** Единая точка «задачу только что закрыли»: повторение должно срабатывать и
 *  с галочки в списке, и с переноса на доске, и из меню статуса. */
function afterTaskClosed(task, wasDone) {
  if (!task || wasDone || !task.done) return;
  rollRepeat(task);
}

/** Переводит повторяющуюся задачу на следующий срок. */
// Решение о перекате — в ядре (core/repeat.js, planRepeatRoll), общее с
// телефоном; здесь только применение к задаче и тосты.
function rollRepeat(task) {
  const plan = Core.planRepeatRoll(task.repeat, task.dueAt, Date.now());
  if (!plan) return;

  if (plan.finished) {
    task.repeat = plan.repeat;
    task.updatedAt = new Date().toISOString();
    toast(t('repeat.series_done'));
    return;
  }
  const next = plan.nextDue;

  if (plan.keepHistory) {
    // Выполненная копия остаётся в списке со своим временем, а сама задача
    // уезжает на следующий срок с чистого листа.
    const copy = {
      ...task,
      id: uid(),
      repeat: null,
      tagIds: [...(task.tagIds || [])],
      sessions: (task.sessions || []).map((s) => ({ ...s })),
      pinnedAt: null,
      updatedAt: new Date().toISOString(),
    };
    state.tasks.push(copy);
    task.sessions = [];
    task.totalMs = 0;
  }

  task.repeat = plan.repeat;
  task.dueAt = new Date(next).toISOString();
  task.doneAt = null;
  task.notifiedAt = null;
  const back = defaultStatusId(task.projectId, false);
  if (back) setTaskStatus(task, back);
  else { task.done = false; task.cancelled = false; }
  task.updatedAt = new Date().toISOString();
  toast(t('repeat.moved', { date: fmtDateShort(next) }));
}

/** Будущие сроки повторений — призраками на календаре (core/agenda.js). */
const repeatGhosts = Core.repeatGhosts;


init();

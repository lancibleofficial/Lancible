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
  // Заголовок — по экрану (syncRoute), а не «Lancible»: эту функцию зовут и
  // диалоги, пока человек на своём экране.
  document.title = routeReady ? routeTitle(currentRoute()) : 'Lancible';
}

// ---------------------------------------------------------------------------
// Иконки — Solar Bold, общий словарь в core/icons.js (его же читают телефон,
// редактор и HTML). cls — класс <svg>, по умолчанию icon.
// ---------------------------------------------------------------------------

const icon = (name, cls) => Core.iconSvg(name, cls);

// ---------------------------------------------------------------------------
// Пустые экраны — сценки из core/illustrations.js. В разметке лежит пустой
// <svg data-art="имя">, сценку в него вписывает paintArt() при запуске;
// пустой экран, слова которого зависят от данных, собирает код —
// emptyState() (в новом узле или в готовом из разметки) и fillEmpty() (в
// списке, который перерисовывается целиком). Вид — .empty-state в styles.css.
// ---------------------------------------------------------------------------

function paintArt() {
  document.querySelectorAll('svg[data-art]').forEach((n) => { n.innerHTML = Core.artShapes(n.dataset.art); });
}

/** Сценка, заголовок, строка пояснения и — если действие очевидно — кнопка.
 *  action: { label, onClick, soft, icon } — soft, когда акцентная кнопка у
 *  экрана уже есть (она одна на экран); icon — значок вместо «+». small —
 *  компактный вид для панелей; row — компактный в строку (сценка слева) для
 *  выпадашек и списков в окне, где строка создания стоит сразу под ним.
 *
 *  box — готовый узел из разметки (пустой экран с id, который экран прячет и
 *  показывает): тогда вид собирается в нём. Те же слова — узел не трогается:
 *  перерисовка на месте (тик, галочка, каждый символ в поиске) не
 *  переигрывает появление сценки. */
const emptyKeys = new WeakMap();
function emptyState({ art, title, text, action, small, row }, box) {
  box = box || elt('div');
  const key = JSON.stringify([art, title, text || '', action ? action.label : '', !!small, !!row]);
  if (emptyKeys.get(box) === key) return box;
  emptyKeys.set(box, key);
  box.classList.add('empty-state');
  box.classList.toggle('empty-state-sm', !!(small || row));
  box.classList.toggle('empty-state-row', !!row);
  box.textContent = '';
  box.insertAdjacentHTML('beforeend', Core.artSvg(art));
  const words = row ? elt('div', 'empty-state-body') : box;
  words.append(elt(small || row ? 'p' : 'h2', 'empty-state-title', title));
  if (text) words.append(elt('p', 'empty-state-text', text));
  if (row) box.append(words);
  if (action) {
    const b = elt('button', action.soft ? 'btn-soft' : 'btn-accent');
    b.type = 'button';
    b.innerHTML = icon(action.icon || 'plus');
    b.append(elt('span', '', action.label));
    b.addEventListener('click', action.onClick);
    box.append(b);
  }
  return box;
}

/** Пустой экран единственным содержимым списка, который перерисовывается
 *  целиком: тот же вид, что уже стоит, остаётся на месте — иначе сценка
 *  появлялась бы заново на каждую перерисовку. */
function fillEmpty(list, opts) {
  const only = list.childElementCount === 1 && list.firstElementChild.classList.contains('empty-state') ? list.firstElementChild : null;
  const box = emptyState(opts, only || undefined);
  if (box !== only) list.replaceChildren(box);
  return box;
}

// ---------------------------------------------------------------------------
// Свойства задачи — разметка
// ---------------------------------------------------------------------------
// С 13 октября 2026 — как на телефоне: статус и версия чипами, теги бейджами
// и «+ теги», дальше группы строк «название · значение ›» (.sgroup, .srow):
// «Когда» — дедлайн, время работы, повторение; «Напоминания» — строка на
// каждое и «Добавить»; «Ещё» — ставка. Каждая строка открывает своё окно.
// Разметка одна на десктоп и веб: в обоих index.html стоит пустой
// #task-params, а наполняет его эта функция — до того, как ниже соберётся
// el. Тот же узел одалживает окно задачи из календаря (#tmdlg-params).

/** Строка настройки: значок · название · значение (и тихая подстрока под ним)
 *  · шеврон. Слова — data-i18n, их ставит applyStaticTranslations. */
function srowHtml(id, iconName, labelKey, valueId, subId) {
  return `<button type="button" class="srow" id="${id}">${icon(iconName)}`
    + `<span class="srow-label" data-i18n="${labelKey}"></span>`
    + `<span class="srow-box"><span class="srow-value" id="${valueId}"></span>`
    + (subId ? `<span class="srow-sub" id="${subId}" hidden></span>` : '')
    + `</span>${icon('chevron-right', 'icon srow-chev')}</button>`;
}

function taskParamsHtml() {
  return [
    // «Другая версия ›» — пусто и спрятано, пока у задачи нет конфликта
    // (renderTaskConflicts, раздел «Конфликты»).
    '<div class="sgroup" id="task-conflicts" hidden></div>',
    '<div class="sgroup-label" data-i18n="task.status_label"></div>',
    '<div class="tp-chips" id="task-statuses" role="group" data-i18n-aria="task.status_label"></div>',
    '<div class="sgroup-label" id="task-version-label" data-i18n="version.label" hidden></div>',
    '<div class="tp-chips" id="task-version-row" role="group" data-i18n-aria="version.label" hidden></div>',
    '<div class="sgroup-label" data-i18n="tag.pick"></div>',
    '<div class="tp-chips" id="task-tags-row"><div class="tag-chips" id="task-tags"></div>'
      + `<button type="button" class="dp-btn is-empty tp-tag-add" id="task-tags-add" data-i18n-title="tag.pick">${icon('plus')}<span data-i18n="tag.pick"></span></button></div>`,
    '<div class="sgroup-label" data-i18n="task.group_when"></div>',
    '<div class="sgroup" id="task-when">',
    srowHtml('due-date-btn', 'calendar', 'due.label', 'due-value'),
    srowHtml('slots-row', 'clock', 'slot.label', 'slots-value'),
    srowHtml('task-repeat', 'refresh', 'repeat.label', 'repeat-value', 'repeat-next'),
    '</div>',
    '<div class="sgroup-label" data-i18n="remind.label"></div>',
    '<div class="sgroup" id="remind-row"></div>',
    '<div class="sgroup-label" id="task-more-label" data-i18n="task.group_more"></div>',
    '<div class="sgroup" id="task-more-group">',
    srowHtml('rate-row', 'wallet', 'money.rate_label', 'rate-value'),
    '</div>',
  ].join('');
}
document.getElementById('task-params').innerHTML = taskParamsHtml();

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
  tbTimer: $('tb-timer'), tbTimerTime: $('tb-timer-time'), tbTimerName: $('tb-timer-name'), tbTimerStop: $('tb-timer-stop'), tbStart: $('tb-start'),
  mobileTabbar: $('mobile-tabbar'),
  mobileBackToList: $('mobile-back-to-list'),
  authBackdrop: $('auth-backdrop'),
  authStepCredentials: $('auth-step-credentials'), authStepOnboarding: $('auth-step-onboarding'),

  authGoogleBtn: $('auth-google-btn'),
  authEmail: $('auth-email'), authPassword: $('auth-password'), authError: $('auth-error'),
  authTitle: $('auth-title'), authSub: $('auth-sub'), authAddNote: $('auth-add-note'),
  authSwitchText: $('auth-switch-text'), authSwitchBtn: $('auth-switch-btn'),
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
  settingsRoot: $('settings-root'), settingsSections: $('settings-sections'),
  settingsPages: [...document.querySelectorAll('#settings-view .settings-page[data-section]')],
  settingsLangRow: $('settings-lang-row'), settingsLangValue: $('settings-lang-value'),
  settingsVersion: $('settings-version'), settingsUpdateCheck: $('settings-update-check'),
  settingsSyncToggle: $('settings-sync-toggle'),
  settingsRate: $('settings-rate'),
  settingsCurrencyRow: $('settings-currency-row'), settingsCurrencyValue: $('settings-currency-value'),
  settingsAccountCard: $('settings-account-card'), settingsAccountGuest: $('settings-account-guest'),
  settingsNameRow: $('settings-name-row'), settingsNameValue: $('settings-name-value'), settingsEmailValue: $('settings-email-value'),
  settingsPasswordRow: $('settings-password-row'), settingsSignoutRow: $('settings-signout-row'),
  settingsDeleteRow: $('settings-delete-row'), settingsDanger: $('settings-danger'), settingsDangerLabel: $('settings-danger-label'),
  settingsAccounts: $('settings-accounts'), settingsAccountsLabel: $('settings-accounts-label'), settingsCurrentLabel: $('settings-current-label'),
  settingsRelogin: $('settings-relogin'), settingsDevice: $('settings-device'), settingsDeviceLabel: $('settings-device-label'), settingsForgetRow: $('settings-forget-row'), settingsMoveGuestRow: $('settings-move-guest-row'),
  settingsExportRow: $('settings-export-row'), settingsLegalCookies: $('settings-legal-cookies'),
  settingsUsage: $('settings-usage'), settingsUsageToggle: $('settings-usage-toggle'), settingsUsageHint: $('settings-usage-hint'),
  settingsSyncData: $('settings-sync-data'), settingsSyncDataLabel: $('settings-sync-data-label'),
  settingsConflictsRow: $('settings-conflicts-row'), settingsConflictsValue: $('settings-conflicts-value'),
  settingsTrashRow: $('settings-trash-row'), settingsTrashValue: $('settings-trash-value'),
  syncdlgBackdrop: $('syncdlg-backdrop'), syncdlgTitle: $('syncdlg-title'), syncdlgBody: $('syncdlg-body'),
  syncdlgBack: $('syncdlg-back'), syncdlgClose: $('syncdlg-close'),
  taskConflicts: $('task-conflicts'), pdlgConflicts: $('pdlg-conflicts'),
  settingsMode: $('settings-mode'), settingsModeHint: $('settings-mode-hint'),
  settingsTimerToggle: $('settings-timer-toggle'), settingsEarningsToggle: $('settings-earnings-toggle'),
  settingsHoursValue: $('settings-hours-value'), settingsWorkHint: $('settings-work-hint'),
  settingsHoursStartRow: $('settings-hours-start-row'), settingsHoursStart: $('settings-hours-start'),
  settingsHoursEndRow: $('settings-hours-end-row'), settingsHoursEnd: $('settings-hours-end'),
  settingsHoursDays: $('settings-hours-days'),
  taskMoreLabel: $('task-more-label'), taskMoreGroup: $('task-more-group'),
  fbForm: $('fb-form'), fbKind: $('fb-kind'), fbText: $('fb-text'), fbCount: $('fb-count'),
  fbAttach: $('fb-attach'), fbAttachSub: $('fb-attach-sub'), fbShot: $('fb-shot'), fbThumb: $('fb-thumb'), fbThumbImg: $('fb-thumb-img'), fbThumbX: $('fb-thumb-x'), fbFile: $('fb-file'),
  fbHint: $('fb-hint'), fbError: $('fb-error'), fbErrorText: $('fb-error-text'), fbRetry: $('fb-retry'), fbSend: $('fb-send'),
  modalLabel2: $('modal-label2'), modalInput2: $('modal-input2'), modalError: $('modal-error'),

  homeCount: $('home-count'), projectsTrack: $('projects-track'),
  recentSection: $('recent-section'), recentTrack: $('recent-track'),
  homeEmpty: $('home-empty'), homeEmptyCreate: $('home-empty-create'), createProjectBtn: $('create-project-btn'),

  phDot: $('ph-dot'), phName: $('ph-name'), projectMenuBtn: $('project-menu-btn'),
  projTabs: [...document.querySelectorAll('#proj-tabs button')], projList: $('proj-list'),
  projBoard: $('proj-board'), projVersions: $('proj-versions'), ptabVerCount: $('ptab-ver-count'),
  projDocs: $('proj-docs'), ptabDocCount: $('ptab-doc-count'), pdocList: $('pdoc-list'), pdocEmpty: $('pdoc-empty'), pdocNew: $('pdoc-new'), pdocEmptyNew: $('pdoc-empty-new'),
  pverList: $('pver-list'), pverEmpty: $('pver-empty'), pverEmptyNew: $('pver-empty-new'), projBack: $('proj-back'), phDesc: $('ph-desc'),
  ppDone: $('pp-done'), ppOf: $('pp-of'), ppPct: $('pp-pct'), ppBar: $('pp-bar'), ppLegend: $('pp-legend'),
  projVersionsCard: $('proj-versions-card'), pvRows: $('pv-rows'), pvAll: $('pv-all'), psList: $('ps-list'), psEmpty: $('ps-empty'),
  taskView: $('task-view'), taskBack: $('task-back'), crumbProjects: $('crumb-projects'), crumbProject: $('crumb-project'), crumbTask: $('crumb-task'),
  taskDoneBtn: $('task-done-btn'), timerRate: $('timer-rate'),
  navProjects: $('nav-projects'), navNewProject: $('nav-new-project'),
  navPinned: $('nav-pinned'), navPinnedHead: $('nav-pinned-head'),
  boardCols: $('board-cols'),
  boardStatuses: $('board-statuses'), stList: $('st-list'), stAdd: $('st-add'),
  pdlgBody: $('pdlg-body'), pdlgLater: $('pdlg-later'),
  pdlgRate: $('pdlg-rate'), pdlgRateUnit: $('pdlg-rate-unit'), pdlgRateHint: $('pdlg-rate-hint'), pdlgCurrency: $('pdlg-currency'),
  pdlgTagList: $('pdlg-tag-list'), pdlgTagAdd: $('pdlg-tag-add'),
  verList: $('ver-list'), verAdd: $('ver-add'),

  taskList: $('task-list'), sidebarEmpty: $('sidebar-empty'), newTaskBtn: $('new-task-btn'),
  projectEarned: $('project-earned'),

  tfStatus: [...document.querySelectorAll('.tf-status button')],

  detail: $('task-detail'),
  title: $('task-title'),
  taskTabs: [...document.querySelectorAll('.task-tabs button')], tabNotes: $('tab-notes'), taskProps: $('task-props'), tabHistory: $('tab-history'),
  // Узел параметров задачи ездит между вкладкой и модалкой с календаря.
  taskParams: $('task-params'), taskMore: $('task-more'),
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
  exportPeriodBtn: $('export-period-btn'),
  expdlgBackdrop: $('expdlg-backdrop'), expPeriod: $('exp-period'), expRangeText: $('exp-range-text'), expDates: $('exp-dates'),
  expFrom: $('exp-from'), expTo: $('exp-to'), expProjects: $('exp-projects'), expSummary: $('exp-summary'),
  expdlgOk: $('expdlg-ok'), expdlgCancel: $('expdlg-cancel'),
  rateRow: $('rate-row'), rateValue: $('rate-value'),
  taskStatuses: $('task-statuses'),
  taskVersionLabel: $('task-version-label'), taskVersionRow: $('task-version-row'),
  taskRepeat: $('task-repeat'), repeatValue: $('repeat-value'), repeatNext: $('repeat-next'),
  rpdlgBackdrop: $('rpdlg-backdrop'), rpEvery: $('rp-every'), rpUnit: $('rp-unit'),
  rpFreqSeg: $('rp-freq-seg'), rpDays: $('rp-days'), rpDaysBlock: $('rp-days-block'),
  rpMonthSeg: $('rp-month-seg'), rpMonthBlock: $('rp-month-block'),
  rpFromSeg: $('rp-from-seg'), rpEndsSeg: $('rp-ends-seg'),
  rpAfter: $('rp-after'), rpCount: $('rp-count'), rpUntilRow: $('rp-until-row'), rpUntil: $('rp-until'),
  rpHistory: $('rp-history'), rpPreview: $('rp-preview'),
  rpFromField: $('rp-from-field'),
  rpdlgOff: $('rpdlg-off'), rpdlgCancel: $('rpdlg-cancel'), rpdlgSave: $('rpdlg-save'),
  slotsRow: $('slots-row'), slotsValue: $('slots-value'),
  sldlgBackdrop: $('sldlg-backdrop'), sldlgDateBtn: $('sldlg-date-btn'), sldlgDate: $('sldlg-date'),
  sldlgStartBtn: $('sldlg-start-btn'), sldlgStart: $('sldlg-start'),
  sldlgEndBtn: $('sldlg-end-btn'), sldlgEnd: $('sldlg-end'), sldlgDur: $('sldlg-dur'),
  sldlgRepeatRow: $('sldlg-repeat-row'), sldlgRepeatNote: $('sldlg-repeat-note'),
  sldlgDelete: $('sldlg-delete'), sldlgCancel: $('sldlg-cancel'), sldlgSave: $('sldlg-save'),
  remindRow: $('remind-row'),
  rmdlgBackdrop: $('rmdlg-backdrop'), rmKindSeg: $('rm-kind-seg'), rmNeedAnchor: $('rm-need-anchor'),
  rmBefore: $('rm-before'), rmAnchorSeg: $('rm-anchor-seg'), rmPresets: $('rm-presets'),
  rmN: $('rm-n'), rmUnitSeg: $('rm-unit-seg'),
  rmAt: $('rm-at'), rmAtBtn: $('rm-at-btn'),
  rmRepeat: $('rm-repeat'), rmFreqSeg: $('rm-freq-seg'), rmDays: $('rm-days'),
  rmMonthLine: $('rm-month-line'), rmMonthDay: $('rm-monthday'), rmTimeBtn: $('rm-time-btn'),
  rmError: $('rm-error'), rmdlgDelete: $('rmdlg-delete'), rmdlgCancel: $('rmdlg-cancel'), rmdlgSave: $('rmdlg-save'),
  notifBtn: $('notif-btn'), notifBadge: $('notif-badge'), notifPanel: $('notif-panel'),
  aiBtn: $('ai-btn'), aiPanel: $('ai-panel'), aiQuota: $('ai-quota'), aiMore: $('ai-more'), aiClose: $('ai-close'),
  aiBack: $('ai-back'), aiTitle: $('ai-title'), aiSignin: $('ai-signin'), aiSigninBtn: $('ai-signin-btn'),
  aiBody: $('ai-body'), aiHello: $('ai-hello'), aiPhrase: $('ai-phrase'), mobileAiBtn: $('mobile-ai-btn'),
  aiList: $('ai-list'), aiListLabel: $('ai-list-label'), aiChats: $('ai-chats'), aiLog: $('ai-log'), navrail: $('navrail'),
  aiCompose: $('ai-compose'), aiInput: $('ai-input'), aiSend: $('ai-send'), aiAttach: $('ai-attach'), aiFile: $('ai-file'),
  aiAttachList: $('ai-attach-list'), aiAttachError: $('ai-attach-error'),
  aiWait: $('ai-wait'), aiLocked: $('ai-locked'), aiRequest: $('ai-request'), aiRequestError: $('ai-request-error'),
  aiRequestErrorText: $('ai-request-error-text'), aiRequestRetry: $('ai-request-retry'),
  settingsNotifToggle: $('settings-notif-toggle'), settingsNotifSystem: $('settings-notif-system'),
  settingsAboutUs: $('settings-about-us'), settingsAboutBlog: $('settings-about-blog'),
  settingsLegalPrivacy: $('settings-legal-privacy'), settingsLegalTerms: $('settings-legal-terms'),
  settingsLegalDocs: $('settings-legal-docs'),
  settingsNotifState: $('settings-notif-state'),
  notifList: $('notif-list'), notifEmpty: $('notif-empty'), notifSeen: $('notif-seen'),
  dueDateBtn: $('due-date-btn'), dueValue: $('due-value'),
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
  dpTime: $('dp-time'), dpTimeBtn: $('dp-time-btn'), dpClear: $('dp-clear'), dpDone: $('dp-done'),
  tpPop: $('tp-pop'), tpInput: $('tp-input'), tpList: $('tp-list'),
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
/** Проект поменяли — он сам (имя, цвет, описание, ставка, теги) или его
 *  статусы и версии: отметка свежести, по ней «Проекты» и списки проектов
 *  ставят его первым (Core.projectsByActivity, 19 октября 2026). updatedAt —
 *  тихое поле журнала правок (core/oplog.js, QUIET): две отметки с разных
 *  устройств не спорят, побеждает поздняя. */
function touchProject(id) {
  const p = getProject(id);
  if (p) p.updatedAt = new Date().toISOString();
}
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
  for (const row of Core.makeProjectStatuses(projectId, (key) => t(`status.default_${key}`))) {
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
  // Открыли руками — ждать дня возврата больше нечего, и засчитанный
  // закрытием раз серии снимается (core/slots.js, planUntick).
  if (!task.done) Object.assign(task, Core.planUntick(task));
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
  if (!plan.setDone) Object.assign(task, Core.planUntick(task));
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
const dueState = (task) => Core.dueState(task, Date.now());

/** Сумма с валютой: по умолчанию основной, у проекта — своей. */
const fmtMoney = (n, code) => `${moneyFmt().format(Math.round((n + Number.EPSILON) * 100) / 100)} ${symOf(code || state.settings.currency)}`;
/** Режим (core/modes.js, 17 октября 2026): что показывать — деньги, счётчики
 *  заработка, кнопки таймера. Экраны читают только эти флаги, не
 *  settings.mode напрямую. */
const modeFlags = () => Core.modeFlags(state.settings);
/** «2 ч 30 мин · 4 000 ₽» — а в «личном» режиме только время. */
const fmtDurMoney = (ms, money, code) => (modeFlags().money ? `${fmtDur(ms)} · ${fmtMoney(money, code)}` : fmtDur(ms));

/** Короткая подпись срока для списка: «просрочено» / «сегодня» / дата. */
const dueShort = (task) => Core.dueShort(task, Date.now(), t, fmtDateShort);


// ---------------------------------------------------------------------------
// Тост
// ---------------------------------------------------------------------------

let toastTimer = null;
/** Тост, который висит, пока его не снимут (opts.sticky): обычный тост
 *  показывается поверх и, погаснув, уступает место ему снова. */
let toastSticky = null;
/** Тост: строка внизу, гаснет сама через 3,2 с. opts.action — кнопка справа
 *  ({ label, onClick }, .btn-soft), opts.sticky — не гаснет. */
function toast(message, opts) {
  const o = opts || {};
  if (o.sticky) toastSticky = { message, action: o.action || null };
  paintToast(message, o.action || null);
  clearTimeout(toastTimer);
  if (o.sticky) return;
  toastTimer = setTimeout(() => {
    if (toastSticky) paintToast(toastSticky.message, toastSticky.action);
    else el.toast.hidden = true;
  }, 3200);
}
function paintToast(message, action) {
  el.toast.classList.toggle('has-action', !!action);
  if (action) {
    const btn = elt('button', 'btn-soft toast-action', action.label);
    btn.type = 'button';
    btn.addEventListener('click', action.onClick);
    el.toast.replaceChildren(elt('span', 'toast-text', message), btn);
  } else el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
}

const anyDialogOpen = () =>
  !el.modalBackdrop.hidden || !el.pdlgBackdrop.hidden || !el.sdlgBackdrop.hidden ||
  !el.confirmBackdrop.hidden || !el.searchPanel.hidden || !el.expdlgBackdrop.hidden ||
  !el.tagdlgBackdrop.hidden || !el.rpdlgBackdrop.hidden || !el.sldlgBackdrop.hidden ||
  !el.rmdlgBackdrop.hidden || !el.tmdlgBackdrop.hidden || !el.syncdlgBackdrop.hidden;

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
function promptDialog({ label, value = '', type = 'text', label2 = null, okLabel = null, validate = null, placeholder = '' }) {
  el.modalLabel.textContent = label;
  el.modalInput.type = type;
  el.modalInput.value = value;
  // Серая подсказка в пустом поле: у ставки задачи — откуда ставка берётся, пока своей нет.
  el.modalInput.placeholder = placeholder;
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
  // Окно ввода бывает поверх другого (ставка — из окна задачи с календаря):
  // Esc и Enter достаются только ему, окно под ним остаётся.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePrompt(null); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
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

/** Любой CSS-цвет → #rrggbb: холст разбирает формат сам. */
function cssColorToHex(value) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value;
  return ctx.fillStyle;
}

/** Цвета нативных кнопок окна (Windows и Linux рисуют их поверх страницы).
 *  Подложка — фон той поверхности, что лежит под кнопками: полноэкранный
 *  редактор закрывает шапку, и тогда это его панель; иначе — шапка. Фон
 *  берётся с первого непрозрачного предка, а текст кнопок — из токена
 *  --text-dim. Своих цветов у main-процесса нет: всё, что он красит, пришло
 *  отсюда, поэтому подложка совпадает с токенами обеих тем сама. */
function titlebarColors() {
  const surface = document.querySelector('.led.led-fullscreen .led-toolbar') || document.getElementById('titlebar');
  let paint = 'transparent';
  for (let node = surface; node; node = node.parentElement) {
    paint = getComputedStyle(node).backgroundColor;
    if (!/^(transparent|rgba\(.*,\s*0\))$/.test(paint)) break;
  }
  return {
    color: cssColorToHex(paint),
    symbolColor: cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim()),
  };
}

/** Сообщить main-процессу тему и цвета кнопок окна. Звать после всего, что
 *  меняет поверхность под ними: смены темы, входа в полноэкранный редактор
 *  и выхода из него. Тему берёт из разметки, а не из state: на старте state
 *  ещё не загружен, а data-theme уже выставил theme-boot.js. */
function syncTitlebarOverlay() {
  const theme = document.documentElement.getAttribute('data-theme') || 'system';
  window.api.setTitlebarOverlay(theme, titlebarColors()).catch(() => {});
}

function applyTheme() {
  const theme = (state.settings && state.settings.theme) || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  // Копия выбора для theme-boot.js: на следующем запуске тема встанет до
  // первой отрисовки, и скелетон загрузки не мелькнёт чужой темой.
  try { localStorage.setItem('lancible.theme', theme); } catch (e) { /* хранилище закрыто */ }

  for (const btn of el.themeTabs) btn.classList.toggle('on', btn.dataset.theme === theme);
  syncTitlebarOverlay();
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
    syncTitlebarOverlay();
  }
});
// Кнопки окна нужны с первого кадра: main-процесс не показывает окно, пока
// не получит их цвета. Тема уже стоит (theme-boot.js), загрузки данных ждать
// незачем — applyTheme() повторит то же, когда данные придут.
syncTitlebarOverlay();

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
  openMenu(anchor || el.langToggle, items, { toggle: true });
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
// Имя и пароль — только своим сеансом: отставшая вкладка не спрашивает, а
// сеанс в хранилище сверяется после ввода (foreignSession).
el.settingsNameRow.addEventListener('click', async () => {
  if (!currentUser || staleGuard()) return;
  const res = await promptDialog({ label: t('profile.name_label'), value: currentUser.name || '', okLabel: t('common.save') });
  if (!res || await foreignSession()) return;
  const ok = await updateProfileName(res.value);
  toast(t(ok ? 'profile.name_updated' : 'profile.update_failed'));
  renderAccountBtn();
  renderSettings();
});
el.settingsPasswordRow.addEventListener('click', async () => {
  if (staleGuard()) return;
  const res = await promptDialog({
    label: t('profile.new_password'), type: 'password', label2: t('profile.confirm_password'), okLabel: t('common.save'),
    validate: (a, b) => (a.length < 6 ? t('profile.password_too_short') : a !== b ? t('profile.password_mismatch') : null),
  });
  if (!res || await foreignSession()) return;
  const ok = await changePassword(res.value);
  toast(t(ok ? 'profile.password_updated' : 'profile.update_failed'));
});
el.settingsSignoutRow.addEventListener('click', signOut);
el.settingsDeleteRow.addEventListener('click', deleteAccount);
el.settingsCurrencyRow.addEventListener('click', () => openCurrencyMenu(el.settingsCurrencyRow));
el.settingsLegalCookies.addEventListener('click', () => openLegal('cookies'));
el.settingsExportRow.addEventListener('click', openExportPeriodDialog);
// «Статистика экранов» — настройка области аккаунта, как остальные; счётчик
// читает её при каждом открытии экрана (usageAllowed).
el.settingsUsageToggle.addEventListener('click', () => {
  state.settings.usageStats = state.settings.usageStats === false;
  render();
  scheduleSave();
});
for (const row of el.settingsSections.querySelectorAll('.srow[data-section]')) {
  row.addEventListener('click', () => openSettings(row.dataset.section));
}
// Верхний блок: вошедшему (и открытому без сеанса) — раздел «Аккаунт», гостю — вход.
el.settingsProfile.addEventListener('click', () => {
  if (el.settingsProfile.dataset.go === 'signin') openAuthModal('signin');
  else openSettings('account');
});
// «Назад» из раздела — тот же шаг, что «назад» браузера; пришли ссылкой прямо
// в раздел — в список разделов.
for (const back of el.settingsView.querySelectorAll('.settings-back')) {
  back.addEventListener('click', () => routeBack(() => openSettings(null)));
}

// Режим и переключатели «Работы» (core/modes.js). Режим — пресет: «личное»
// прячет деньги целиком, переключатель заработка в нём не действует и не
// показан. Выключили таймер, пока он идёт, — запись сохраняется и таймер
// останавливается: кнопки остановить его уже не будет.
for (const b of el.settingsMode.querySelectorAll(':scope > button')) {
  b.addEventListener('click', () => {
    state.settings.mode = Core.normalizeMode(b.dataset.mode);
    render();
    scheduleSave();
  });
}
el.settingsTimerToggle.addEventListener('click', () => {
  const on = !modeFlags().timer;
  if (!on && state.activeTimer) stopTimer();
  state.settings.showTimer = on;
  render();
  scheduleSave();
});
el.settingsEarningsToggle.addEventListener('click', () => {
  state.settings.showEarnings = state.settings.showEarnings === false;
  render();
  scheduleSave();
});

/** Классы режима на <body>: .if-money, .if-earnings и .if-timer в разметке и
 *  в собранных строках прячет одно правило styles.css (слой «Каркас»).
 *  Группа «Ещё» панели задачи — одна ставка: без денег её нет целиком. */
function applyModeFlags() {
  const f = modeFlags();
  document.body.classList.toggle('no-money', !f.money);
  document.body.classList.toggle('no-earnings', !f.earnings);
  document.body.classList.toggle('no-timer', !f.timer);
  el.taskMoreLabel.hidden = !f.money;
  el.taskMoreGroup.hidden = !f.money;
}

// ---------------------------------------------------------------------------
// Обратная связь (17 октября 2026)
//
// Форма одна на веб и десктоп, как на телефоне: вид, текст до 4000, снимок
// экрана файлом с диска (в Electron нет desktopCapturer в preload — тоже
// файл), «Отправить». Платформа, версия, язык и браузер уходят сами. Гость
// шлёт без user_id. Строка — в таблицу feedback (supabase/feedback.sql),
// снимок — в приватный бакет feedback по пути <id>.<тип>; id записи заводит
// клиент, один на попытку и её повторы: «Повторить» не создаст второй строки
// и второго файла. Ошибка — строка с «Повторить», текст остаётся в поле.
//
// С 19 октября 2026 — сначала строка, потом снимок: бакет примет только файл,
// названный в screenshot_path строки не старше 15 минут, а частоту строк
// держит база (5 за 10 минут и 20 за сутки с аккаунта, 30 в час на всех
// гостей; отказ — 'feedback rate', P0001). Дошедшая строка второй раз не
// уходит: отказала только загрузка — «Повторить» догружает снимок.
// ---------------------------------------------------------------------------

const FB_MAX = 4000;
const FB_BUCKET = 'feedback';
const FB_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const FB_MAX_BYTES = 5 * 1024 * 1024; // как file_size_limit бакета
// id — запись этой попытки; sent — строка дошла; shot — путь снимка, который
// она назвала; uploaded — путь, уже лежащий в бакете.
const fb = { kind: 'bug', file: null, url: null, id: null, sent: false, shot: null, uploaded: null, sending: false };

/** uuid v4: crypto.randomUUID есть не везде (страница не по https). */
function fbUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function renderFeedback() {
  for (const b of el.fbKind.querySelectorAll(':scope > button')) {
    const on = b.dataset.kind === fb.kind;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  el.fbText.dataset.i18nPh = `feedback.ph_${fb.kind}`;
  el.fbText.placeholder = t(el.fbText.dataset.i18nPh);
  el.fbCount.textContent = t('feedback.count', { n: el.fbText.value.length, max: FB_MAX });
  // Снимок: блок со скрепкой; выбранный — миниатюрой с крестиком, вместо
  // подсказки о форматах — имя файла.
  el.fbShot.classList.toggle('has-file', !!fb.file);
  el.fbThumb.hidden = !fb.file;
  if (fb.file && el.fbThumbImg.getAttribute('src') !== fb.url) el.fbThumbImg.src = fb.url;
  el.fbThumbImg.alt = fb.file ? fb.file.name : '';
  if (fb.file) { delete el.fbAttachSub.dataset.i18n; el.fbAttachSub.textContent = fb.file.name; }
  else setI18nText(el.fbAttachSub, 'feedback.attach_hint');
  setI18nText(el.fbHint, IS_WEB ? 'feedback.meta_hint_web' : 'feedback.meta_hint_desktop');
  el.fbSend.disabled = fb.sending || !el.fbText.value.trim();
}

/** Строка таблицы feedback: всё, что форма знает сама. opts — строка не из
 *  формы (запрос доступа к агенту, 21 октября 2026): свои id и вид, аккаунт
 *  на момент нажатия (userId). */
async function feedbackRow(text, screenshotPath, opts = {}) {
  let version = appVersion;
  if (!version) {
    try { version = await window.api.getVersion(); } catch { version = null; }
  }
  const row = {
    id: opts.id || fb.id,
    kind: opts.kind || fb.kind,
    text: text.slice(0, FB_MAX),
    platform: IS_WEB ? 'web' : 'desktop',
    app_version: version ? String(version).slice(0, 40) : null,
    lang: lang(),
    device: String(navigator.userAgent || '').slice(0, 200) || null,
    screenshot_path: screenshotPath,
  };
  const userId = 'userId' in opts ? opts.userId : currentUser && currentUser.id;
  if (userId) row.user_id = userId;
  return row;
}

/** Строка — в таблицу; строку назад не просим — гостю её не прочитать.
 *  23505 — строка с этим id уже есть: прошлая попытка дошла, а ответ нет.
 *  Прочие отказы бросает (частота — fbRateLimited). */
async function fbInsert(row) {
  const { error } = await sb.from('feedback').insert(row);
  if (error && error.code !== '23505') throw error;
}

/** Отказ базы «слишком много подряд» (триггер feedback_rate в feedback.sql). */
function fbRateLimited(err) {
  return !!err && err.code === 'P0001' && /feedback rate/i.test(String(err.message || ''));
}

/** Строка ошибки над «Повторить»: feedback.failed, .rate или .shot_failed. */
function fbShowError(key) {
  setI18nText(el.fbErrorText, key);
  el.fbError.hidden = false;
}

async function sendFeedback() {
  const text = el.fbText.value.trim();
  // Отставшая вкладка не шлёт: сеанс в хранилище — другого аккаунта.
  if (!text || fb.sending || staleGuard()) return;
  fb.sending = true;
  el.fbError.hidden = true;
  renderFeedback();
  if (!fb.id) fb.id = fbUuid();
  let stage = 'row';
  try {
    // Вошедший шлёт со своим user_id — и только своим сеансом. Текст
    // остаётся в поле.
    if (await foreignSession()) return;
    // Сначала строка: бакет примет только снимок, который она назвала.
    if (!fb.sent) {
      fb.shot = fb.file ? `${fb.id}.${FB_TYPES[fb.file.type]}` : null;
      await fbInsert(await feedbackRow(text, fb.shot));
      fb.sent = true;
    }
    stage = 'shot';
    if (fb.shot && fb.uploaded !== fb.shot) {
      const { error } = await sb.storage.from(FB_BUCKET).upload(fb.shot, fb.file, { contentType: fb.file.type, upsert: false });
      // Файл с этим именем уже лежит — это наш, от прошлой попытки.
      if (error && !/exist|duplicate/i.test(`${error.message || ''} ${error.error || ''}`)) throw error;
      fb.uploaded = fb.shot;
    }
    resetFeedback();
    toast(t('feedback.sent'));
  } catch (err) {
    console.error('feedback', err);
    // Строка дошла, а снимок нет — сообщение уже у нас, «Повторить» догрузит
    // снимок. Отказ по частоте — своя строка; текст в поле в обоих случаях.
    if (stage === 'shot') fbShowError('feedback.shot_failed');
    else fbShowError(fbRateLimited(err) ? 'feedback.rate' : 'feedback.failed');
  } finally {
    fb.sending = false;
    renderFeedback();
  }
}

/** Снимок убран (крестик, сброс формы): миниатюра освобождается. */
function fbDropShot() {
  if (fb.url) URL.revokeObjectURL(fb.url);
  fb.file = null;
  fb.url = null;
  el.fbFile.value = '';
  el.fbThumbImg.removeAttribute('src');
}

/** Снимок сменили или убрали. Строка ещё не ушла — та же попытка: путь
 *  возьмётся из нового файла. Ушла — это уже новое сообщение: у прежней
 *  строки снимок назван по старому файлу (так же на телефоне). */
function fbShotChanged() {
  if (!fb.sent) return;
  Object.assign(fb, { id: null, sent: false, shot: null, uploaded: null });
  el.fbError.hidden = true;
}

function resetFeedback() {
  fbDropShot();
  Object.assign(fb, { kind: 'bug', id: null, sent: false, shot: null, uploaded: null });
  el.fbText.value = '';
  el.fbFile.value = '';
  el.fbError.hidden = true;
}

for (const b of el.fbKind.querySelectorAll(':scope > button')) {
  b.addEventListener('click', () => { fb.kind = b.dataset.kind; renderFeedback(); });
}
el.fbText.addEventListener('input', renderFeedback);
// Весь блок — выбор картинки (и замена выбранной); крестик — убрать.
el.fbAttach.addEventListener('click', () => el.fbFile.click());
el.fbThumbX.addEventListener('click', () => {
  fbShotChanged();
  fbDropShot();
  renderFeedback();
  el.fbAttach.focus({ preventScroll: true });
});
el.fbFile.addEventListener('change', () => {
  const file = el.fbFile.files && el.fbFile.files[0];
  if (!file) return;
  if (!FB_TYPES[file.type] || file.size > FB_MAX_BYTES) {
    el.fbFile.value = '';
    toast(t('feedback.bad_file'));
    return;
  }
  fbShotChanged();
  if (fb.url) URL.revokeObjectURL(fb.url);
  fb.file = file;
  fb.url = URL.createObjectURL(file);
  renderFeedback();
});
el.fbForm.addEventListener('submit', (e) => { e.preventDefault(); sendFeedback(); });
el.fbRetry.addEventListener('click', sendFeedback);

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
let updateCheck = 'idle'; // idle | checking | latest | failed — ручная проверка из Настроек

function renderUpdateBtn() {
  el.updateBtn.hidden = updateState === 'idle';
  el.updateBtn.classList.toggle('downloading', updateState === 'downloading');
  const key = updateState === 'ready' ? 'update.ready'
    : updateState === 'downloading' ? 'update.downloading'
    : 'update.available';
  el.updateBtnLabel.textContent = t(key);
  renderUpdateCheck();
}

// Ссылка в подвале Настроек. Нашлось обновление — дальше работает кнопка в
// панели, а подпись здесь повторяет её состояние (и «ready» так же ставит).
function renderUpdateCheck() {
  const key = updateState === 'ready' ? 'update.ready'
    : updateState === 'downloading' ? 'update.downloading'
    : updateCheck === 'checking' ? 'update.checking'
    : updateCheck === 'latest' ? 'update.latest'
    : updateCheck === 'failed' ? 'update.check_failed'
    : 'update.check';
  el.settingsUpdateCheck.textContent = t(key);
  el.settingsUpdateCheck.disabled = updateState === 'downloading' || updateCheck === 'checking';
}

// Состояние обновления держит main (src/main.js), окно его только рисует.
// Спрашиваем на старте и после ошибки: так кнопка переживает перезагрузку
// окна и событие, пришедшее раньше, чем окно успело подписаться.
function applyUpdateStatus(s) {
  updateState = s.phase === 'ready' || s.phase === 'downloading' ? s.phase : 'idle';
  barFill(el.updateProgress, Math.round(s.percent || 0));
  renderUpdateBtn();
}
const syncUpdateStatus = () => window.api.getUpdateStatus().then(applyUpdateStatus).catch(() => {});

// В вебе обновлений нет вовсе: страница и так всегда свежая, а window.api там
// этих методов не предоставляет (см. web/api-shim.js). Проверка на их наличие
// заодно и есть проверка «мы в десктопе».
if (window.api.onUpdateAvailable) {
  // Скачивание начинается само (autoDownload в src/main.js), поэтому «доступно»
  // и «скачивается» для пользователя — одно и то же состояние: ходить и
  // нажимать «скачать» больше не нужно, нажатие остаётся ровно одно — «Установить».
  window.api.onUpdateAvailable(() => { updateState = 'downloading'; renderUpdateBtn(); });
  window.api.onUpdateProgress(({ percent }) => { barFill(el.updateProgress, Math.round(percent || 0)); });
  window.api.onUpdateReady(() => { updateState = 'ready'; renderUpdateBtn(); });
  window.api.onUpdateError(syncUpdateStatus);
  syncUpdateStatus();
  el.settingsUpdateCheck.hidden = false;
  renderUpdateCheck();
}

el.updateBtn.addEventListener('click', () => {
  // Пока идёт скачивание, кнопка только показывает прогресс — нажимать нечего.
  if (updateState === 'ready') window.api.installUpdate();
});
el.settingsUpdateCheck.addEventListener('click', async () => {
  if (updateState === 'ready') { window.api.installUpdate(); return; }
  updateCheck = 'checking';
  renderUpdateCheck();
  let res;
  try { res = await window.api.checkForUpdate(); } catch { res = { ok: false }; }
  // Нашлось — подпись возьмёт состояние скачивания, «последней версии» не будет.
  updateCheck = !res.ok ? 'failed' : res.available ? 'idle' : 'latest';
  await syncUpdateStatus();
  renderUpdateCheck();
});

// Версия — одна строка на обеих поверхностях: десктоп спрашивает main
// (app.getVersion()), веб берёт её из корневого package.json при сборке
// (web/version.js). Как на телефоне: «Lancible · 0.4.2».
if (window.api.getVersion) {
  window.api.getVersion().then((v) => {
    if (!v) return;
    appVersion = String(v);
    el.settingsVersion.textContent = `Lancible · ${v}`;
    if (state.ui.view === 'settings') renderSettings();
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Аккаунт: вход/регистрация (email+пароль) и онбординг. Вход опционален —
// приложение полностью работает офлайн без него; синхронизация данных
// (заливка/подтяжка проектов и задач) — отдельный, более поздний этап.
// ---------------------------------------------------------------------------

let currentUser = null; // { id, email, name } | null
/** Чьё согласие с нынешней редакцией документов проверено при этом входе
 *  (afterSignedIn): uid или null. Без него счётчик экранов молчит. */
let consentOkFor = null;
const USE_CASES = ['personal', 'freelance', 'team', 'other'];
let selectedUseCase = null;

// ---------------------------------------------------------------------------
// Несколько аккаунтов на устройстве (17 октября 2026). Правила — в ядре
// (core/accounts.js, общее с телефоном): где лежат данные каждого, список с
// токенами, план переключения. Здесь — сеансы supabase-js и перерисовка.
//
// У каждого аккаунта своя область данных (window.api.setDataScope: веб —
// lancible:data:<uid>, десктоп — data-<uid>.json); гость — прежние
// lancible:data и data.json, его данные никуда не переезжают и ни во что не
// вливаются. Таймер, настройки синхронизации (syncResolvedFor) и язык — тоже
// часть области: переключение их не трогает, вернулись — всё на месте.
//
// Сеанс текущего аккаунта supabase-js держит сам (sb-…-auth-token), список
// хранит сеансы неактивных (window.api.accountsLoad/accountsSave). Refresh-
// токены ротируются, поэтому каждый SIGNED_IN/TOKEN_REFRESHED переписывает
// запись своего аккаунта: иначе при возврате старый токен дал бы
// refresh_token_already_used.
// ---------------------------------------------------------------------------

/** Список аккаунтов устройства: { list, current } (core/accounts.js). */
let accounts = Core.normalizeAccounts(null);
/** Список прочитан: до этого писать его нельзя — затёрли бы пустым. */
let accountsLoaded = false;
/** Чья область данных открыта: uid аккаунта или null — гость. Пока сеанс
 *  жив, совпадает с currentUser.id; без сеанса (токен протух, нет сети)
 *  данные аккаунта открыты, а currentUser — null: без синхронизации. */
let scopeUid = null;
/** Области на устройстве (window.api.dataScopes): гость и аккаунты, в том
 *  числе те, из которых вышли, — их копия лежит до «Удалить данные». */
let deviceScopes = [];
/** Идёт смена области: сохранение молчит, иначе прежнее состояние легло бы
 *  в новую область (сердцебиение таймера не ждёт, пока загрузка кончится).
 *  До первой загрузки — тоже: пока init() узнаёт, чья область открыта
 *  (сеанс, список), отложенное сохранение пустого начального состояния
 *  затёрло бы данные гостя — так и было в первой версии. */
let scopeSwitching = true;
/** Смены области идут строго по очереди (openScope): следующая ждёт, пока
 *  прежняя не кончится целиком. Одного булева scopeSwitching не хватало: две
 *  смены разом (колбэк входа через Google посреди переключения, тихий вход
 *  на старте) шли вперемешку — данные одной области ложились с пачкой
 *  журнала другой, а сохранение без пачки теряло очередь, корзину и
 *  конфликты. Очередь открывает init(), когда первая область загружена. */
let scopeQueueOpen = null;
let scopeQueue = new Promise((resolve) => { scopeQueueOpen = resolve; });
/** Номер открытой области: растёт с каждой сменой. Ответ, которого ждали при
 *  прежнем номере (профиль в afterSignedIn), к новой области не применяется. */
let scopeGen = 0;
/** Переключение уже идёт — второй щелчок его не начинает. */
let accountSwitchBusy = false;
/** Другая вкладка открыла другой аккаунт (веб: список аккаунтов и сеанс
 *  supabase-js в localStorage общие у вкладок, а область — у каждой своя).
 *  До перезагрузки эта вкладка работает со своей областью только локально:
 *  синхронизация, список аккаунтов и сеансы — уже чужие. См.
 *  onAccountsElsewhere. */
let scopeStale = false;
/** Сколько цветов у аватара — столько [data-c] в «Странице настроек». */
const AVATAR_COLORS = 6;

async function saveAccounts() {
  // Отставшая вкладка список не пишет: затёрла бы им выбор другой вкладки.
  if (!accountsLoaded || scopeStale || !window.api.accountsSave) return;
  try { await window.api.accountsSave(accounts); } catch (err) { console.error('Не удалось сохранить список аккаунтов:', err); }
}

async function refreshDeviceScopes() {
  if (!window.api.dataScopes) { deviceScopes = []; return; }
  try { deviceScopes = (await window.api.dataScopes()) || []; } catch (err) { console.error('Не удалось прочитать области данных:', err); deviceScopes = []; }
}

/** Есть ли что-то в записи «Без аккаунта». Открыт гость — смотрим живое. */
function guestHasData() {
  if (scopeUid === null) return Core.hasData(state);
  const g = deviceScopes.find((d) => d.uid === null);
  return !!(g && g.hasData);
}

/** Запись открытой области; гость или чужой — null. */
const scopeEntry = () => (scopeUid ? Core.findAccount(accounts, scopeUid) : null);

/** Свежие токены сеанса — в запись его аккаунта. Только для тех, кто уже в
 *  списке: новый заводит вход (enterSignedInAccount). */
function rememberSessionTokens(session) {
  const uid = session && session.user && session.user.id;
  if (!accountsLoaded || !uid || !session.refresh_token) return;
  const prev = Core.findAccount(accounts, uid);
  if (!prev) return;
  if (prev.refreshToken === session.refresh_token && prev.accessToken === session.access_token) return;
  accounts = Core.upsertAccount(accounts, {
    uid, accessToken: session.access_token || '', refreshToken: session.refresh_token,
    ...(session.user.email ? { email: session.user.email } : {}),
  });
  saveAccounts();
}
sb.auth.onAuthStateChange((event, session) => {
  if (!session || !(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) return;
  // supabase-js рассылает события всем вкладкам: сеанс, поднятый в другой
  // вкладке для другого аккаунта, сюда не пишем. Свои чужие сеансы — при
  // переключении (accountSwitchBusy) и входе — эта вкладка запоминает сама
  // (resumeSession, enterSignedInAccount).
  const uid = session.user && session.user.id;
  if (scopeStale || (uid !== scopeUid && !accountSwitchBusy)) return;
  rememberSessionTokens(session);
});

/** Список аккаунтов переписала другая вкладка (window.api.onAccountsChanged —
 *  только на вебе). Там открыт уже не тот аккаунт — эта вкладка отстала:
 *  синхронизация встаёт (сеанс в общем хранилище теперь чужой, и правки ушли
 *  бы не тем сеансом), список и сеансы она больше не пишет, а тост с
 *  «Обновить» висит до перезагрузки. Свои правки по-прежнему ложатся в свою
 *  область: ключ хранилища у вкладки свой (setDataScope), и после
 *  перезагрузки они на месте — в записи этого аккаунта. */
function onAccountsElsewhere(raw) {
  if (scopeStale || !accountsLoaded) return;
  // Список — каким его оставила другая вкладка, при любой его правке, а не
  // только при смене текущего: там могли стереть аккаунт с устройства или
  // выйти из него. Иначе ближайшая запись отсюда (свежие токены, вход)
  // вернула бы старый список — с аккаунтом, которого уже нет, и с его
  // отозванными токенами.
  accounts = Core.normalizeAccounts(raw);
  if (!Core.accountChangedElsewhere(raw, scopeUid)) {
    // Перерисовать только строки аккаунтов: вся страница настроек сбросила
    // бы набранное в её полях (список переписывают и свежие токены).
    if (state.ui.view === 'settings') renderAccountsGroup();
    return;
  }
  scopeStale = true;
  unsubscribeSyncRealtime();
  stopSyncTimers();
  assetsPaused = true;
  closeMenu();
  showStaleNotice();
}
function showStaleNotice() {
  toast(t('accounts.other_tab'), { sticky: true, action: { label: t('accounts.other_tab_reload'), onClick: () => location.reload() } });
}
/** Отставшая вкладка аккаунты не трогает: переключение, вход и выход сняли
 *  или подменили бы сеанс другой вкладки, а удаление аккаунта, пароль, имя,
 *  агент и отзыв ушли бы её сеансом — от имени другого аккаунта. Вместо
 *  действия — снова тост «Обновить». */
function staleGuard() {
  if (!scopeStale) return false;
  showStaleNotice();
  return true;
}

/** Чей сеанс сейчас в хранилище supabase-js: id пользователя или null. */
async function sessionUid() {
  try {
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.user && data.session.user.id) || null;
  } catch (err) {
    console.error('Не удалось прочитать сеанс:', err);
    return null;
  }
}

/** Действие от имени вошедшего — удалить аккаунт, сменить пароль или имя,
 *  позвать агента, отправить отзыв — идёт только его сеансом. Сеанс
 *  supabase-js на вебе общий у вкладок, и запросы берут его из хранилища:
 *  другая вкладка могла открыть другой аккаунт, а событие о списке сюда ещё
 *  не дошло (или его не было вовсе — вход подменяет сеанс, не трогая
 *  списка). Тогда функция delete-account удалила бы тот аккаунт, чей сеанс,
 *  а не тот, что на экране, и пароль сменился бы ему же.
 *
 *  true — действовать нельзя: вкладка отстала или сеанс в хранилище не того,
 *  кто на экране (тост «Обновить» уже показан). Сеанса нет вовсе — не повод:
 *  без него запрос чужого аккаунта не тронет и откажет сам. Пока идёт своё
 *  переключение (accountSwitchBusy), сеанс меняется законно — отказ без
 *  тоста. */
async function foreignSession() {
  if (staleGuard()) return true;
  if (!currentUser) return false;
  const uid = currentUser.id;
  const sid = await sessionUid();
  if (staleGuard()) return true;
  // Пока читали сеанс, аккаунт сменился здесь же — действие было не про него.
  if (!currentUser || currentUser.id !== uid) return true;
  if (!sid || sid === uid) return false;
  if (!accountSwitchBusy) showStaleNotice();
  return true;
}
if (window.api.onAccountsChanged) window.api.onAccountsChanged(onAccountsElsewhere);

/** Токены текущего сеанса — в его запись: сейчас сеанс сменится. */
async function snapshotSessionTokens() {
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) rememberSessionTokens(data.session);
  } catch (err) { console.error('Не удалось прочитать сеанс:', err); }
}

/** Ошибка сети, а не отказ: токен, может быть, ещё жив. */
const isRetryableAuthError = (err) => !!err && (err.name === 'AuthRetryableFetchError' || err instanceof TypeError || err.status === 0);

/** Снять сеанс только на этом устройстве, без единого запроса к серверу.
 *
 *  Почему не signOut({ scope: 'local' }). «local» у GoTrue — не «только в
 *  браузере», а «только этот сеанс»: supabase-js шлёт POST
 *  /auth/v1/logout?scope=local, и сервер удаляет сеанс вместе с его
 *  refresh-токенами. Токен, сохранённый в списке аккаунтов, после этого
 *  мёртв, и вернуться в аккаунт без пароля было бы нечем — ради этого
 *  список и держит сеансы неактивных. Поэтому при переключении сеанс не
 *  отзывается, а только убирается из хранилища клиента; отзывают его «Выйти»
 *  и «Удалить данные с устройства» — там токен и правда больше не нужен.
 *
 *  Как. _removeSession — ровно то, что signOut делает после ответа
 *  сервера: стирает сеанс из хранилища и говорит подписчикам SIGNED_OUT
 *  (realtime и хранилище картинок снимают токен). Метод приватный: в новой
 *  версии supabase-js его может не стать — тогда резерв: стереть записи
 *  сеанса из хранилища самим, тем ключом, что у клиента
 *  (sb-<ref>-auth-token, sb.auth.storageKey), и его спутники -user и
 *  -code-verifier. Запроса /logout нет ни в одной ветке — это сторожит
 *  tests/e2e/accounts.spec.js. */
async function dropLocalSession() {
  try {
    if (typeof sb.auth._removeSession === 'function') { await sb.auth._removeSession(); return; }
  } catch (err) { console.error('Не удалось снять сеанс:', err); }
  const key = sb.auth.storageKey;
  if (!key) return;
  for (const k of [key, `${key}-user`, `${key}-code-verifier`]) {
    try { localStorage.removeItem(k); } catch (err) { console.error('Не удалось снять сеанс:', err); }
  }
}

/** Поднять сеанс аккаунта из списка. Сеанс — удалось; null — нет сети,
 *  токены не трогаем; false — отказ: токен протух или отозван. */
async function resumeSession(entry) {
  try {
    const { data, error } = entry.accessToken
      ? await sb.auth.setSession({ access_token: entry.accessToken, refresh_token: entry.refreshToken })
      : await sb.auth.refreshSession({ refresh_token: entry.refreshToken });
    if (error) throw error;
    const session = data && data.session;
    if (!session || !session.user) throw new Error('сеанс не поднялся');
    if (session.user.id !== entry.uid) { await dropLocalSession(); throw new Error('сеанс другого аккаунта'); }
    rememberSessionTokens(session);
    return session;
  } catch (err) {
    console.error('Сеанс аккаунта не поднялся:', err);
    return isRetryableAuthError(err) ? null : false;
  }
}

/** Перед входом в другой аккаунт: своё — на диск и в облако своим же
 *  сеансом, его свежие токены — в список. Вход заменит сеанс в хранилище. */
async function beforeSessionChange() {
  flushEditor();
  savePending = true;
  await saveNow();
  if (currentUser) await flushSync();
  await snapshotSessionTokens();
}

/** Открыть область uid (null — гость): сохранить уходящую, загрузить
 *  приходящую, перерисовать. Сеансы здесь не трогаются — это дело
 *  switchAccount и входа; синхронизация уходящей уже закончена: currentUser
 *  снимается до сохранения, и в облако отсюда ничего не уходит. Смены идут
 *  по очереди (scopeQueue): вторая начинается, когда первая кончилась. */
function openScope(uid) {
  const run = scopeQueue.then(() => openScopeNow(uid));
  scopeQueue = run.catch(() => {});
  return run;
}
async function openScopeNow(uid) {
  const next = Core.isValidUid(uid) ? uid : null;
  scopeGen += 1;
  flushEditor();
  closeMenu();
  currentUser = null;
  unsubscribeSyncRealtime();
  stopSyncTimers();
  savePending = true;
  await saveNow();
  const prev = state;
  const keepSection = prev.ui && prev.ui.view === 'settings' ? (prev.ui.settingsSection || null) : undefined;
  scopeSwitching = true;
  try {
    // Пачка журнала — у каждой области своя: прежняя уже на диске.
    syncBundle = null;
    syncExtra = freshSyncExtra();
    scopeUid = next;
    if (next) accounts = Core.upsertAccount(accounts, { uid: next, lastUsedAt: Date.now() });
    accounts = Core.setCurrentAccount(accounts, next);
    await saveAccounts();
    let loaded = null;
    try {
      if (window.api.setDataScope) await window.api.setDataScope(next);
      loaded = await window.api.load();
    } catch (err) {
      console.error('Не удалось загрузить данные:', err);
      toast(t('toast.load_error'));
    }
    state = loaded && typeof loaded === 'object' ? loaded : { tasks: [], activeTimer: null };
    takeSync2(state, next);
    // Новая область — как первый запуск, но язык и тема — того, кто сидит за
    // устройством: добавили аккаунт — интерфейс не должен сменить язык.
    if (!state.settings || typeof state.settings !== 'object') {
      const s = (prev && prev.settings) || {};
      state.settings = { lang: s.lang, theme: s.theme };
    }
    migrate();
    reopenDueTasks(Date.now());
  } finally {
    scopeSwitching = false;
  }
  // Таймер — часть данных области: он идёт по меткам времени и не
  // восстанавливается, как после перезапуска, — вернулись, он на месте.
  selectedId = null;
  docFilter = 'all';
  docQuery = '';
  // Открытые тексты — прежней области: редакторы пустеют (их правки уже
  // дописаны flushEditor в начале).
  if (editor) loadEditor(null);
  if (docEditor) loadDocEditor(null);
  el.langLabel.textContent = LANG_NAMES[state.settings.lang] || state.settings.lang;
  document.body.classList.toggle('nav-collapsed', !!state.ui.navCollapsed);
  applyStaticTranslations();
  paintArt();
  applyTheme();
  renderCurrency();
  renderAccountBtn();
  await refreshDeviceScopes();
  if (keepSection !== undefined) openSettings(keepSection);
  else openView('home');
}

/** Вошли в аккаунт (паролем, через Google, тихо на старте): он — в список
 *  со свежими токенами и открыт своей областью. Тот же, что открыт, —
 *  данные не трогаются (вход заново после протухшего токена). Данные гостя
 *  в новый аккаунт сами не вливаются: его область на устройстве пуста, и
 *  синхронизация возьмёт облачное (linkAccount); перенос — только с
 *  согласия (offerGuestMove). */
async function enterSignedInAccount(user) {
  if (!user || !Core.isValidUid(user.id)) return;
  let session = null;
  try {
    const { data } = await sb.auth.getSession();
    session = data && data.session && data.session.user && data.session.user.id === user.id ? data.session : null;
  } catch (err) { console.error('Не удалось прочитать сеанс:', err); }
  accounts = Core.upsertAccount(accounts, {
    uid: user.id,
    lastUsedAt: Date.now(),
    ...(user.email ? { email: user.email } : {}),
    ...(session ? { accessToken: session.access_token || '', refreshToken: session.refresh_token || '' } : {}),
  });
  if (user.id === scopeUid) {
    accounts = Core.setCurrentAccount(accounts, user.id);
    await saveAccounts();
    return;
  }
  // Свежие токены — в список сразу, не дожидаясь смены области: пока она
  // сохраняет уходящую, другая вкладка может переписать список, и тогда
  // (onAccountsElsewhere) эта запись пропала бы. Текущий пока прежний.
  await saveAccounts();
  // Попробовал без аккаунта, потом вошёл: данные гостя — скорее всего его.
  // Аккаунт на этом устройстве пуст — спросим, перенести ли их (afterSignedIn,
  // до синхронизации). Молча не переносим: «Без аккаунта» может быть и чужим.
  const guestHad = scopeUid === null && !currentUser && Core.hasData(state);
  await openScope(user.id);
  if (guestHad && !Core.hasData(state)) guestOfferFor = user.id;
}

/** Кому предложить перенос данных «Без аккаунта» при этом входе. */
let guestOfferFor = null;

/** Перенести данные «Без аккаунта» в открытый аккаунт; гость пустеет — это
 *  перенос, а не копия. В пустой аккаунт переезжают и настройки гостя
 *  (ставка, валюта, режим): аккаунт только что заведён, и они — его.
 *
 *  Слияние — журналом, без потерь (core/oplog.js, adoptGuestState): новое
 *  у гостя приходит в аккаунт правками создания, общее с аккаунтом (то же
 *  id: устройство когда-то синхронизировалось, вышло и работало без входа)
 *  — по полям, более свежая сторона показывается, другая версия остаётся
 *  рядом. Аккаунт ещё не связан с журналом (первый вход) — сейчас просто
 *  объединение без дублей (mergeScopeData), а слияние сделает связь
 *  (linkAccount): при совпадении id гостевое ждёт её в пачке области. */
async function moveGuestData() {
  if (!scopeUid || !window.api.dataPeek || !window.api.dataWrite) return false;
  flushEditor();
  let guest = null;
  try { guest = await window.api.dataPeek(null); } catch (err) { console.error('Не удалось прочитать данные без аккаунта:', err); }
  if (!Core.hasData(guest)) return false;
  const fresh = !Core.hasData(state);
  // Таймер в области один. Идёт и у гостя, и в аккаунте — гостевой
  // закрывается записью времени на своей задаче (core/accounts.js): на пути
  // с журналом правок (adoptGuestState) он иначе пропал бы вместе со
  // временем. В аккаунте таймер не идёт — гостевой переезжает как есть.
  guest = Core.settleGuestTimer(state, guest, { now: Date.now() });
  const guestLists = listsCopy(guest);
  if (syncBundle) {
    commitLive();
    const res = Core.adoptGuestState(syncBundle, guestLists, { deviceId, at: new Date().toISOString() });
    syncBundle = res.bundle;
    syncMarksChanged();
    Object.assign(state, listsCopy(syncBundle.state));
    if (!state.activeTimer && guest.activeTimer) state.activeTimer = guest.activeTimer;
  } else {
    const ids = new Set(SYNC_LISTS.flatMap((k) => (state[k] || []).map((x) => `${k}:${x && x.id}`)));
    const shared = SYNC_LISTS.some((k) => guestLists[k].some((x) => ids.has(`${k}:${x && x.id}`)));
    state = Core.mergeScopeData(state, guest);
    if (shared) syncExtra = Object.assign({}, syncExtra, { adopt: syncExtra.adopt.concat([guestLists]) });
  }
  if (fresh && guest.settings && typeof guest.settings === 'object') {
    const own = state.settings || {};
    const r = guest.settings.syncResolvedFor;
    state.settings = {
      ...guest.settings,
      account: own.account,
      syncResolvedFor: r && r.userId === scopeUid ? r : own.syncResolvedFor || null,
    };
  }
  migrate();
  // Картинки из заметок гостя — тоже аккаунту: в очереди выгрузки они
  // гостевые (owner null) и сами в облако не уходят (src/editor/assets.js).
  if (editorAssets && editorAssets.adoptGuest) {
    try { if (await editorAssets.adoptGuest(scopeUid)) editorAssets.flush(); } catch (err) { console.error('Не удалось передать картинки аккаунту:', err); }
  }
  try { await window.api.dataWrite(null, Core.emptiedScopeData(guest)); } catch (err) { console.error('Не удалось очистить данные без аккаунта:', err); }
  render();
  savePending = true;
  await saveNow();
  await refreshDeviceScopes();
  if (state.ui.view === 'settings') renderSettings();
  return true;
}

/** Спросить про перенос. «Оставить отдельно» — данные гостя остаются в
 *  записи «Без аккаунта», как были. */
async function offerGuestMove() {
  const ok = await confirmDialog(t('accounts.move_text'), {
    title: t('accounts.move_title'), okLabel: t('accounts.move_ok'), cancelLabel: t('accounts.move_keep'), danger: false,
  });
  if (!ok) return false;
  const moved = await moveGuestData();
  if (moved) toast(t('accounts.moved_toast'));
  return moved;
}

/** Имя и почта вошедшего — в его запись списка и в саму область
 *  (settings.account): по ней строка «Удалить данные с устройства»
 *  подписывает копию аккаунта, из которого уже вышли. */
function noteAccountProfile() {
  if (!currentUser || !Core.isValidUid(currentUser.id)) return;
  accounts = Core.upsertAccount(accounts, {
    uid: currentUser.id,
    name: currentUser.name || '',
    ...(currentUser.email ? { email: currentUser.email } : {}),
  });
  saveAccounts();
  if (scopeUid !== currentUser.id) return;
  const label = { email: currentUser.email || '', name: currentUser.name || '' };
  const was = state.settings.account || {};
  if (was.email !== label.email || was.name !== label.name) {
    state.settings.account = label;
    scheduleSave();
  }
}

/** Переключиться на аккаунт uid (null — «Без аккаунта»). Порядок: текст из
 *  редактора и данные — на диск, в облако — своим сеансом, свежие токены — в
 *  список, сеанс снят только здесь, поднят сеанс следующего, его данные
 *  открыты, синхронизация — своя. Сеанс не поднялся — аккаунт остаётся в
 *  списке «нужно войти заново», данные открываются без синхронизации. */
async function switchAccount(uid) {
  if (staleGuard()) return;
  const plan = Core.planSwitch(accounts, uid);
  if (accountSwitchBusy || plan.sameAccount) return;
  accountSwitchBusy = true;
  try {
    await beforeSessionChange();
    await dropLocalSession();
    const entry = plan.load ? Core.findAccount(accounts, plan.load) : null;
    let session = null;
    let lost = false;
    if (entry && plan.canResume) {
      const res = await resumeSession(entry);
      if (res) session = res;
      else if (res === false) lost = true;
    } else if (entry) lost = true;
    if (lost) accounts = Core.markNeedsSignIn(accounts, plan.load);
    await openScope(plan.load);
    const name = entry ? Core.accountLabel(entry, t) : '';
    if (!plan.load) toast(t('accounts.guest_toast'));
    else if (lost) toast(t('accounts.session_lost_toast', { name }));
    else toast(t('accounts.switched_toast', { name }));
    if (session) await afterSignedIn({ silent: true });
  } finally {
    accountSwitchBusy = false;
  }
}

/** Аккаунт ушёл из списка («Выйти», удаление): сеанс уже снят. Был открыт —
 *  открывается следующий по времени с живым сеансом, иначе гость. Копию
 *  данных «Выйти» не стирает. */
async function leaveAccount(uid) {
  const wasOpen = scopeUid === uid;
  accounts = Core.removeAccount(accounts, uid);
  await saveAccounts();
  if (!wasOpen) {
    renderAccountBtn();
    if (state.ui.view === 'settings') renderSettings();
    return;
  }
  const next = Core.nextAccount(accounts, uid);
  if (next) await switchAccount(next);
  else await openScope(null);
}

/** Строки списка аккаунтов — одни для раздела «Аккаунт» и меню профиля:
 *  аккаунты списка; вошедший, которого в списке ещё нет (мгновение между
 *  входом и записью); «Без аккаунта» — если у гостя есть данные или он
 *  открыт. */
function accountRows() {
  const rows = accounts.list.map((e) => ({
    uid: e.uid,
    entry: e,
    label: Core.accountLabel(e, t),
    email: e.name ? e.email : '',
    current: currentUser ? currentUser.id === e.uid : scopeUid === e.uid,
    needsSignIn: !(currentUser && currentUser.id === e.uid) && (e.needsSignIn || scopeUid === e.uid),
  }));
  if (currentUser && !rows.some((r) => r.uid === currentUser.id)) {
    const e = { uid: currentUser.id, name: currentUser.name || '', email: currentUser.email || '' };
    rows.unshift({ uid: e.uid, entry: e, label: Core.accountLabel(e, t), email: e.name ? e.email : '', current: true, needsSignIn: false });
  }
  if ((scopeUid === null && !currentUser) || guestHasData()) {
    rows.push({ uid: null, entry: null, label: t('accounts.guest'), email: '', current: scopeUid === null && !currentUser, needsSignIn: false });
  }
  return rows;
}

/** Кружок с буквой: цвет — от uid (core/accounts.js), сам цвет — токеном
 *  палитры в «Странице настроек» ([data-c]). Гость — «?». */
function accountAvatar(entry, cls) {
  const a = elt('span', `${cls}${entry ? '' : ' guest'}`, Core.accountInitial(entry));
  if (entry) a.dataset.c = String(Core.accountColorIndex(entry.uid, AVATAR_COLORS));
  return a;
}

/** Группа «Аккаунты» раздела «Аккаунт»: строка на аккаунт (аватар, имя,
 *  почта, галочка у текущего), «Без аккаунта», «Добавить аккаунт». Пока
 *  аккаунтов нет, группы нет: гостю — прежний пустой экран со входом. */
function renderAccountsGroup() {
  const rows = accountRows();
  const any = rows.some((r) => r.uid !== null);
  el.settingsAccountsLabel.hidden = !any;
  el.settingsAccounts.hidden = !any;
  el.settingsCurrentLabel.hidden = !(any && currentUser);
  el.settingsAccounts.innerHTML = '';
  if (!any) return;
  for (const r of rows) {
    const b = elt('button', 'srow acc-row');
    b.type = 'button';
    b.dataset.uid = r.uid || '';
    if (r.current) b.setAttribute('aria-current', 'true');
    b.append(accountAvatar(r.entry, 'acc-avatar'), elt('span', 'srow-label', r.label));
    const box = elt('span', 'srow-box');
    if (r.email) box.append(elt('span', 'srow-value', r.email));
    if (r.uid === null) box.append(elt('span', 'srow-sub', t('accounts.guest_sub')));
    else if (r.needsSignIn) box.append(elt('span', 'srow-sub', t('accounts.needs_sign_in')));
    b.append(box);
    if (r.current) b.insertAdjacentHTML('beforeend', icon('check', 'icon srow-check'));
    b.addEventListener('click', () => {
      if (!r.current) { switchAccount(r.uid); return; }
      if (r.needsSignIn) openAuthModal('signin', { email: r.entry && r.entry.email });
    });
    el.settingsAccounts.appendChild(b);
  }
  const add = elt('button', 'srow srow-add');
  add.type = 'button';
  add.id = 'settings-account-add';
  add.insertAdjacentHTML('beforeend', icon('plus'));
  add.append(elt('span', 'srow-label', t('accounts.add')));
  add.addEventListener('click', addAccount);
  el.settingsAccounts.appendChild(add);
}

/** Открыт аккаунт без сеанса: «Войти заново» и «Выйти». */
function renderReloginGroup() {
  const entry = !currentUser ? scopeEntry() : null;
  el.settingsRelogin.hidden = !entry;
  el.settingsRelogin.innerHTML = '';
  if (!entry) return;
  const again = elt('button', 'srow');
  again.type = 'button';
  again.id = 'settings-relogin-row';
  again.insertAdjacentHTML('beforeend', icon('account'));
  again.append(elt('span', 'srow-label', t('accounts.sign_in_again')));
  const box = elt('span', 'srow-box');
  if (entry.email) box.append(elt('span', 'srow-value', entry.email));
  box.append(elt('span', 'srow-sub', t('accounts.offline_hint')));
  again.append(box);
  again.insertAdjacentHTML('beforeend', icon('chevron-right', 'icon srow-chev'));
  again.addEventListener('click', () => openAuthModal('signin', { email: entry.email }));
  const out = elt('button', 'srow srow-danger');
  out.type = 'button';
  out.id = 'settings-relogin-signout';
  out.insertAdjacentHTML('beforeend', icon('logout'));
  out.append(elt('span', 'srow-label', t('auth.sign_out')));
  out.addEventListener('click', signOut);
  el.settingsRelogin.append(again, out);
}

/** Аккаунты, у которых на устройстве есть копия данных: из списка и те, из
 *  которых вышли. Подпись — из списка, иначе из самой области. */
function deviceAccounts() {
  const out = new Map();
  for (const e of accounts.list) out.set(e.uid, { uid: e.uid, label: Core.accountLabel(e, t) });
  for (const d of deviceScopes) {
    if (!d.uid || out.has(d.uid)) continue;
    out.set(d.uid, { uid: d.uid, label: d.name || d.email || t('accounts.signed_out_account') });
  }
  if (scopeUid && !out.has(scopeUid)) out.set(scopeUid, { uid: scopeUid, label: t('accounts.signed_out_account') });
  return [...out.values()];
}

/** Отозвать на сервере сеанс аккаунта, который сейчас не открыт: его копию
 *  стирают с устройства, токены из списка больше не нужны — пусть и не
 *  действуют. Отдельный клиент без сохранения сеанса (persistSession и
 *  autoRefreshToken выключены, свой storageKey): основной sb держит сеанс
 *  открытого аккаунта, его трогать нельзя. setSession проверяет токены у
 *  сервера (просрочен доступ — обновит refresh-токеном), signOut({ scope:
 *  'local' }) — один POST /logout этим сеансом, как «Выйти» у открытого.
 *  Нет сети или токен уже мёртв — не беда: копия стирается всё равно, а
 *  сеанс без refresh-токена на устройстве сам истечёт. */
async function revokeAccountSession(entry) {
  if (!entry || !entry.refreshToken || entry.needsSignIn || !window.supabase) return;
  try {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `lancible-revoke-${entry.uid}` },
    });
    const { error } = entry.accessToken
      ? await client.auth.setSession({ access_token: entry.accessToken, refresh_token: entry.refreshToken })
      : await client.auth.refreshSession({ refresh_token: entry.refreshToken });
    if (error) throw error;
    const out = await client.auth.signOut({ scope: 'local' });
    if (out && out.error) throw out.error;
  } catch (err) {
    console.error('Не удалось отозвать сеанс аккаунта:', err);
  }
}

/** «Удалить данные аккаунта с устройства»: копия стирается, аккаунт уходит
 *  из списка; был открыт — сеанс снимается, открывается гость; не открыт —
 *  его сеанс отзывается на сервере отдельным клиентом (revokeAccountSession),
 *  не дожидаясь ответа: сеть копии не держит. */
async function forgetDeviceData(uid, label) {
  if (staleGuard()) return;
  const ok = await confirmDialog(t('accounts.forget_confirm', { name: label }), {
    title: t('accounts.forget_title'), okLabel: t('common.delete'), danger: true,
  });
  if (!ok) return;
  if (uid === scopeUid) {
    flushEditor();
    savePending = true;
    await saveNow();
    if (currentUser) await flushSync();
    unsubscribeSyncRealtime();
    stopSyncTimers();
    // Токены уходят вместе с данными — сеанс этого устройства можно и
    // отозвать: возвращаться в него нечем.
    if (currentUser) { try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.error('Не удалось выйти:', err); } } else await dropLocalSession();
    // Дальше — как после «Выйти»: следующий аккаунт с живым сеансом, иначе
    // гость. Так же делает телефон (useAuthStore.forgetDeviceData).
    accounts = Core.removeAccount(accounts, uid);
    // Список без него — сразу на диск: пока открывается следующий, другая
    // вкладка может переписать список (onAccountsElsewhere), и стёртый
    // вернулся бы в него.
    await saveAccounts();
    const next = Core.nextAccount(accounts, uid);
    if (next) await switchAccount(next);
    else await openScope(null);
  } else {
    revokeAccountSession(Core.findAccount(accounts, uid));
    accounts = Core.removeAccount(accounts, uid);
    await saveAccounts();
  }
  try { await window.api.dataRemove(uid); } catch (err) { console.error('Не удалось стереть данные:', err); }
  // С копией уходит и остальное, что лежит на устройстве про этот аккаунт:
  // чаты агента (только в localStorage, в область данных не входят) и
  // картинки и PDF из заметок — и ждущие выгрузки, и скачанные копии.
  aiForgetAccount(uid);
  await forgetAccountAssets(uid);
  await refreshDeviceScopes();
  renderAccountBtn();
  if (state.ui.view === 'settings') renderSettings();
  toast(t('accounts.forgot_toast'));
}

function openForgetMenu(anchor) {
  const list = deviceAccounts();
  if (!list.length) { toast(t('accounts.forget_none')); return; }
  openMenu(anchor, list.map((a) => ({
    label: a.label,
    selected: a.uid === scopeUid,
    onClick: () => forgetDeviceData(a.uid, a.label),
  })), { toggle: true });
}

function addAccount() {
  if (staleGuard()) return;
  openAuthModal('signin', { add: true });
}

/** Меню профиля в рейле: те же строки для быстрого переключения, «Добавить
 *  аккаунт», синхронизация и «Выйти» — для открытого. */
function openAccountMenu() {
  const items = accountRows().map((r) => ({
    label: r.needsSignIn && r.uid !== null ? `${r.label} · ${t('accounts.needs_sign_in')}` : r.label,
    selected: r.current,
    onClick: () => {
      if (!r.current) switchAccount(r.uid);
      else if (r.needsSignIn) openAuthModal('signin', { email: r.entry && r.entry.email });
    },
  }));
  items.push({ label: t('accounts.add'), icon: 'plus', onClick: addAccount });
  if (currentUser) {
    items.push({ sep: true }, { label: t('sync.toggle_label'), selected: state.settings.syncEnabled !== false, onClick: toggleSyncEnabled });
  }
  if (currentUser || scopeUid) items.push({ sep: true }, { label: t('auth.sign_out'), danger: true, onClick: signOut });
  openMenu(el.accountBtn, items);
}

/** Старт: список → чья область → её данные. Сеанс в хранилище — того, кто
 *  вошёл последним (так приходит и вход через Google на вебе, и версия до
 *  списка аккаунтов): он и открыт. Сеанса нет, а в списке есть текущий —
 *  поднимаем его сеанс; не поднялся — данные открываются без синхронизации.
 *  Возвращает сеанс, если он есть. */
async function prepareAccountsOnStart() {
  if (window.api.accountsLoad) {
    try { accounts = Core.normalizeAccounts(await window.api.accountsLoad()); } catch (err) { console.error('Не удалось прочитать список аккаунтов:', err); }
  }
  accountsLoaded = true;
  let session = null;
  let sessionError = null;
  try {
    const { data, error } = await sb.auth.getSession();
    session = (data && data.session) || null;
    sessionError = error || null;
  } catch (err) { sessionError = err; }
  const sid = session && session.user && Core.isValidUid(session.user.id) ? session.user.id : null;
  let scope = accounts.current;
  // В прошлый раз был открыт гость, а сеанс есть: вход через Google с
  // возвратом на страницу или вход ещё в версии без списка аккаунтов (тогда
  // всё, что на устройстве, лежит под гостем). Область аккаунта пуста, а у
  // гостя есть данные — предложим перенос, как при входе паролем.
  if (sid && !accounts.current) {
    await refreshDeviceScopes();
    const g = deviceScopes.find((d) => d.uid === null);
    const own = deviceScopes.find((d) => d.uid === sid);
    if (g && g.hasData && !(own && own.hasData)) guestOfferFor = sid;
  }
  if (sid) {
    accounts = Core.upsertAccount(accounts, {
      uid: sid, lastUsedAt: Date.now(), accessToken: session.access_token || '', refreshToken: session.refresh_token || '',
      ...(session.user.email ? { email: session.user.email } : {}),
    });
    scope = sid;
  } else if (scope) {
    const entry = Core.findAccount(accounts, scope);
    if (entry && !entry.needsSignIn && !isRetryableAuthError(sessionError)) {
      const res = await resumeSession(entry);
      if (res) session = res;
      else if (res === false) accounts = Core.markNeedsSignIn(accounts, scope);
    }
  }
  accounts = Core.setCurrentAccount(accounts, scope);
  scopeUid = accounts.current;
  await saveAccounts();
  if (window.api.setDataScope) await window.api.setDataScope(scopeUid);
  return session;
}

function renderAccountBtn() {
  // Открыт аккаунт без сеанса — его имя и буква: данные его, а войти заново
  // можно из меню профиля.
  const entry = currentUser ? null : scopeEntry();
  const who = currentUser || entry;
  const name = currentUser ? (currentUser.name || currentUser.email) : entry ? Core.accountLabel(entry, t) : t('auth.sign_in_nav');
  el.accountLabel.textContent = name;
  // Кружок с первой буквой — только у вошедшего: у гостя пилюля остаётся
  // кнопкой входа со значком.
  const avatar = el.accountBtn.querySelector('.nav-avatar');
  const icon0 = el.accountBtn.querySelector('.icon');
  // В свёрнутой панели подписи не видно — имя всплывает подсказкой.
  el.accountBtn.title = name;
  if (who) {
    if (!avatar) {
      const a = document.createElement('span');
      a.className = 'nav-avatar';
      el.accountBtn.insertBefore(a, el.accountLabel);
    }
    el.accountBtn.querySelector('.nav-avatar').textContent = (name || '?').trim().charAt(0).toUpperCase();
    // У SVG нет свойства hidden — только атрибут. Через свойство значок не
    // прятался, и у вошедшего в пилюле стояли и человечек, и буква.
    if (icon0) icon0.setAttribute('hidden', '');
  } else {
    if (avatar) avatar.remove();
    if (icon0) icon0.removeAttribute('hidden');
  }
  // Вход, выход и смена языка — панель агента перечитывает историю своего
  // аккаунта и свои слова.
  aiAccountChanged();
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
/** Раздел «Статистика»: шапка с режимами, числа, сетка (часовая или итогов),
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

/** Режим выставляется отдельно от перерисовки: из адреса он приходит вместе с
 *  переходом на экран, и рисовать дважды незачем. */
function applyTimeMode(mode) {
  state.ui.timeMode = mode;
  if (mode === 'month') { calState.mode = 'month'; if (calState.periodOn) seedRangeFromView(); }
  else agenda.mode = mode;
}

function setTimeMode(mode) {
  applyTimeMode(mode);
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

/** Настройки по разделам (17 октября 2026). Страница «Настройки» — профиль и
 *  строки-разделы со сводкой справа; раздел — своя страница
 *  (#/settings/<раздел>, core/route.js), стрелка «назад» — routeBack, как у
 *  задачи и проекта: на список. Набор и порядок разделов — как в меню
 *  телефона. Открытый раздел — state.ui.settingsSection, null — список. */
const settingsSection = () => (Core.ROUTE_SETTINGS_SECTIONS.includes(state.ui.settingsSection) ? state.ui.settingsSection : null);

function openSettings(section) {
  flushEditor();
  closeMenu();
  closeSearch();
  state.ui.view = 'settings';
  state.ui.settingsSection = Core.ROUTE_SETTINGS_SECTIONS.includes(section) ? section : null;
  render();
  scheduleSave();
}

/** Версия приложения — для подвала «О приложении», сводки раздела и отзыва. */
let appVersion = null;

/** Рабочие часы (state.settings.workHours, с 18 октября 2026 правятся в
 *  «Работе»): { start, end, days } — настройка устройства, в облако не уходит.
 *  По ним агент ищет свободное время, и только: время задачи и её отрезков
 *  они не ограничивают. Читаются правилом ядра агента (Core.aiWorkHours);
 *  пока его нет — тем же правилом здесь: неразобранное — умолчание
 *  Core.AI_WORK_HOURS (Пн–Пт, 09:00–18:00). */
function workHours() {
  if (typeof Core.aiWorkHours === 'function') return Core.aiWorkHours(state.settings);
  const def = Core.AI_WORK_HOURS;
  const raw = state.settings && state.settings.workHours;
  const w = raw && typeof raw === 'object' ? raw : {};
  const clock = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  const days = Array.isArray(w.days) ? [...new Set(w.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  return { start: clock(w.start) || def.start, end: clock(w.end) || def.end, days: days.length ? days : def.days.slice() };
}

/** Рабочие часы целиком: патч поверх нынешних. */
function setWorkHours(patch) {
  state.settings.workHours = { ...workHours(), ...patch };
  renderSettings();
  scheduleSave();
}

/** Группа «Рабочие часы»: сводка словами, начало, конец и дни — квадратами
 *  окна повторения (.rp-day), с понедельника. */
function renderWorkHours() {
  const w = workHours();
  el.settingsHoursValue.textContent = workHoursText(w);
  el.settingsHoursStart.textContent = w.start;
  el.settingsHoursEnd.textContent = w.end;
  if (!el.settingsHoursDays.children.length) {
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rp-day';
      b.dataset.day = String(d);
      el.settingsHoursDays.appendChild(b);
    }
  }
  for (const b of el.settingsHoursDays.children) {
    const on = w.days.includes(Number(b.dataset.day));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = weekdayName(Number(b.dataset.day));
  }
}

// Начало и конец — общим выбором времени; конец позже начала, иначе агенту
// искать негде. Дни — щелчком, последний день не снимается.
el.settingsHoursStartRow.addEventListener('click', () => openTimePicker(el.settingsHoursStartRow, workHours().start, (val) => {
  if (val >= workHours().end) { toast(t('slot.end_before_start')); return; }
  setWorkHours({ start: val });
}));
el.settingsHoursEndRow.addEventListener('click', () => openTimePicker(el.settingsHoursEndRow, workHours().end, (val) => {
  if (val <= workHours().start) { toast(t('slot.end_before_start')); return; }
  setWorkHours({ end: val });
}));
el.settingsHoursDays.addEventListener('click', (e) => {
  const b = e.target.closest('.rp-day');
  if (!b) return;
  const d = Number(b.dataset.day);
  const { days } = workHours();
  if (!days.includes(d)) { setWorkHours({ days: mondayFirst([...days, d]) }); return; }
  if (days.length === 1) { toast(t('settings.work_days_min')); return; }
  setWorkHours({ days: days.filter((x) => x !== d) });
});

/** Рабочие часы словами: «Пн–Пт, 09:00–18:00», «Пн, Ср, Сб, 10:00–19:00». */
function workHoursText(w = workHours()) {
  const days = mondayFirst(w.days);
  const run = days.length > 2 && days.every((d, i) => i === 0 || (days[i - 1] + 1) % 7 === d);
  const dayText = run ? `${weekdayName(days[0])}–${weekdayName(days[days.length - 1])}` : days.map(weekdayName).join(', ');
  return `${dayText}, ${w.start}–${w.end}`;
}

/** Верхний блок списка разделов — аккаунт целиком (19 октября 2026): аватар,
 *  имя и почта, справа шеврон; щелчок открывает раздел «Аккаунт» (отдельной
 *  строки «Аккаунт» в списке нет). Гостю — «Гость» и вход тем же щелчком. */
function renderSettingsProfile() {
  const entry = currentUser ? null : scopeEntry();
  const chev = icon('chevron-right', 'icon srow-chev');
  if (currentUser || entry) {
    const who = currentUser ? { uid: currentUser.id, name: currentUser.name || '', email: currentUser.email || '' } : entry;
    const sub = !currentUser ? t('accounts.needs_sign_in') : who.name ? who.email : '';
    const c = Core.isValidUid(who.uid) ? Core.accountColorIndex(who.uid, AVATAR_COLORS) : 0;
    el.settingsProfile.innerHTML = `
      <span class="settings-avatar" data-c="${c}">${escapeHtml(Core.accountInitial(who))}</span>
      <span class="settings-profile-main">
        <span class="settings-profile-name">${escapeHtml(Core.accountLabel(who, t))}</span>
        ${sub ? `<span class="settings-profile-sub">${escapeHtml(sub)}</span>` : ''}
      </span>${chev}`;
    el.settingsProfile.dataset.go = 'account';
  } else {
    el.settingsProfile.innerHTML = `
      <span class="settings-avatar guest">?</span>
      <span class="settings-profile-main">
        <span class="settings-profile-name">${escapeHtml(t('profile.guest'))}</span>
        <span class="settings-profile-sub">${escapeHtml(t('profile.guest_sub'))}</span>
      </span>${chev}`;
    el.settingsProfile.dataset.go = 'signin';
  }
  el.settingsProfile.setAttribute('aria-label', `${el.settingsProfile.querySelector('.settings-profile-name').textContent} · ${t(currentUser || entry ? 'settings.section_account' : 'auth.sign_in')}`);
}

function renderSettings() {
  const section = settingsSection();
  el.settingsRoot.hidden = !!section;
  for (const p of el.settingsPages) p.hidden = p.dataset.section !== section;
  const f = modeFlags();
  const code = (state.settings && state.settings.lang) || 'ru';

  // Список разделов: сводка справа — то, что в разделе главное.
  if (!section) renderSettingsProfile();
  const rate = Number(state.settings.hourlyRate) || 0;
  const summary = {
    main: `${LANG_NAMES[code]} · ${t(f.money ? 'mode.freelance' : 'mode.personal')}`,
    work: f.money ? (rate ? `${fmtMoney(rate)}${t('rate.per_hour')}` : currencyLabel(state.settings.currency)) : '',
    data: '',
    about: appVersion || '',
    feedback: '',
  };
  for (const [name, text] of Object.entries(summary)) {
    const node = $(`settings-sec-${name}-value`);
    if (node) node.textContent = text;
  }

  // Основное: язык, тема, режим; уведомления.
  el.settingsLangValue.textContent = LANG_NAMES[code];
  for (const b of el.settingsMode.querySelectorAll(':scope > button')) {
    const on = b.dataset.mode === f.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  el.settingsModeHint.textContent = t(f.money ? 'mode.hint_freelance' : 'mode.hint_personal');
  const notifyOn = state.settings.notifyEnabled !== false;
  el.settingsNotifToggle.setAttribute('aria-pressed', String(notifyOn));
  // На десктопе ведём в системные настройки, в браузере — показываем
  // состояние разрешения и предлагаем выдать его, если ещё не спрашивали.
  const perm = typeof Notification === 'undefined' ? 'denied' : Notification.permission;
  el.settingsNotifState.textContent = t(perm === 'granted' ? 'notif.perm_granted' : perm === 'denied' ? 'notif.perm_denied' : 'notif.perm_ask');

  // Работа: ставка и валюта (только с деньгами), таймер, заработок, часы.
  if (document.activeElement !== el.settingsRate) {
    el.settingsRate.value = state.settings.hourlyRate ? String(state.settings.hourlyRate) : '';
  }
  renderCurrency();
  el.settingsTimerToggle.setAttribute('aria-pressed', String(f.timer));
  el.settingsEarningsToggle.setAttribute('aria-pressed', String(state.settings.showEarnings !== false));
  renderWorkHours();
  el.settingsWorkHint.textContent = f.money ? `${t('settings.timer_hint')} ${t('settings.earnings_hint')}` : t('settings.timer_hint');
  renderTagsSettings();

  // Аккаунт: список аккаунтов устройства; вошедшему — профиль, пароль,
  // синхронизация, выход; открытому без сеанса — «Войти заново»; гостю без
  // аккаунтов — вход.
  renderAccountsGroup();
  renderReloginGroup();
  const guestOnly = !currentUser && !scopeUid && el.settingsAccounts.hidden;
  el.settingsAccountCard.hidden = !currentUser;
  el.settingsAccountGuest.hidden = !guestOnly;
  if (currentUser) {
    el.settingsNameValue.textContent = currentUser.name || t('profile.no_name');
    el.settingsEmailValue.textContent = currentUser.email || '';
    el.settingsSyncToggle.setAttribute('aria-pressed', String(state.settings.syncEnabled !== false));
  } else if (guestOnly) {
    emptyState({
      art: 'tasks', title: t('settings.guest_title'), text: t('profile.guest_sub'), small: true,
      action: { label: t('auth.sign_in'), icon: 'account', onClick: () => openAuthModal('signin') },
    }, el.settingsAccountGuest);
  }

  // Данные: копии аккаунтов на устройстве — любому, у кого они есть;
  // удалить аккаунт может только вошедший.
  const onDevice = deviceAccounts().length > 0;
  const canMove = !!currentUser && scopeUid === currentUser.id && guestHasData();
  el.settingsMoveGuestRow.hidden = !canMove;
  el.settingsForgetRow.hidden = !onDevice;
  el.settingsDeviceLabel.hidden = !(onDevice || canMove);
  el.settingsDevice.hidden = !(onDevice || canMove);
  el.settingsDangerLabel.hidden = !currentUser;
  el.settingsDanger.hidden = !currentUser;
  // Статистика экранов — у области аккаунта (и открытой без сеанса: её можно
  // снять до входа заново); гость ничего не шлёт, ему выключатель не нужен.
  const usageRow = !!currentUser || !!scopeUid;
  el.settingsUsage.hidden = !usageRow;
  el.settingsUsageHint.hidden = !usageRow;
  el.settingsUsageToggle.setAttribute('aria-pressed', String(state.settings.usageStats !== false));
  renderSyncSettings();

  renderFeedback();
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
  el.authStepOnboarding.hidden = step !== 'onboarding';
}
/** Текст с ключом перевода: ключ запоминается в data-i18n, чтобы смена языка
 *  при открытом окне переписала и его. */
function setI18nText(node, key) {
  node.dataset.i18n = key;
  node.textContent = t(key);
}
/** Окно входа одно на два режима: 'signin' и 'signup'. Режим меняет заголовок,
 *  подпись главной кнопки, подсказку для менеджера паролей и строку-переключатель
 *  внизу. Почта и пароль остаются как были — человек не перепечатывает их. */
let authMode = 'signin';
/** Окно открыто «Добавить аккаунт»: открытый аккаунт остаётся в списке. */
let authAdd = false;
function setAuthMode(mode) {
  authMode = mode === 'signup' ? 'signup' : 'signin';
  const up = authMode === 'signup';
  el.authError.hidden = true;
  setI18nText(el.authTitle, up ? 'auth.signup_title' : authAdd ? 'accounts.add' : 'auth.title');
  setI18nText(el.authSub, up ? 'auth.signup_subtitle' : 'auth.subtitle');
  setI18nText(el.authSubmit, up ? 'auth.create_account' : 'auth.sign_in');
  setI18nText(el.authSwitchText, up ? 'auth.have_account' : 'auth.no_account_q');
  setI18nText(el.authSwitchBtn, up ? 'auth.sign_in' : 'auth.create_account');
  el.authPassword.autocomplete = up ? 'new-password' : 'current-password';
}
/** Чьи данные останутся где были: у каждого аккаунта своя область, и вход
 *  ничего в неё не переносит. Гость с данными — его запись остаётся «Без
 *  аккаунта»; открыт аккаунт — он остаётся в списке. */
function renderAuthAddNote() {
  const entry = scopeEntry();
  let text = '';
  if (scopeUid === null && !currentUser && guestHasData()) text = t('accounts.add_note_guest');
  else if (authAdd && (currentUser || entry)) {
    text = t('accounts.add_note', { name: currentUser ? (currentUser.name || currentUser.email) : Core.accountLabel(entry, t) });
  }
  el.authAddNote.textContent = text;
  el.authAddNote.hidden = !text;
}
/** opts.add — «Добавить аккаунт»; opts.email — почта заранее (войти заново).
 *  Отставшая вкладка окна входа не открывает: вход подменил бы общий сеанс
 *  другой вкладки, и та узнала бы об этом, только когда её запросы ушли бы
 *  чужим сеансом. */
function openAuthModal(mode, opts = {}) {
  if (staleGuard()) return;
  authAdd = !!(opts && opts.add);
  setAuthMode(mode);
  renderAuthAddNote();
  el.authEmail.value = (opts && opts.email) || '';
  el.authPassword.value = '';
  showAuthStep('credentials');
  el.authBackdrop.hidden = false;
  // Фокус на почту — отложенно, и только если за эти 30 мс человек (или менеджер
  // паролей) не встал в другое поле окна: иначе таймер отнимет у него ввод, и
  // пароль уйдёт в поле почты.
  setTimeout(() => { if (!el.authBackdrop.contains(document.activeElement)) el.authEmail.focus(); }, 30);
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
  if (scopeStale) return;
  // Пока ждём сервер, область могут сменить (переключение в меню профиля,
  // другой вход, колбэк Google): тогда этот ответ уже не про то, что
  // открыто, и ничего не применяется — currentUser не меняется, окно
  // согласия не открывается, синхронизация не начинается. Сверка — по
  // номеру области (scopeGen).
  const gen0 = scopeGen;
  const { data } = await sb.auth.getUser();
  const user = data && data.user;
  if (!user || scopeStale || scopeGen !== gen0) return;
  // Вошли в другой аккаунт, чем открыт, — сначала его область: проверка
  // профиля и синхронизация идут уже с его данными.
  await enterSignedInAccount(user);
  const gen = scopeGen;
  let profile = null;
  try {
    const { data: row } = await sb.from('profiles').select('name, terms_version, age_confirmed').eq('id', user.id).maybeSingle();
    profile = row;
  } catch (err) { console.error('Не удалось прочитать профиль:', err); }
  if (scopeStale || scopeGen !== gen) return;
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
  consentOkFor = user.id;
  currentUser = { id: user.id, email: user.email, name: profile.name };
  noteAccountProfile();
  renderAccountBtn();
  if (state.ui.view === 'settings') renderSettings();
  // Экран, на котором человек вошёл (или открыл приложение), — первый
  // просмотр этого входа.
  usageNoteView();
  // Окно входа закрывается сразу, ДО синхронизации. Раньше закрытие стояло
  // после неё, а синхронизация умеет спрашивать про конфликт данных и умеет
  // падать на сетевой ошибке — в обоих случаях окно оставалось висеть на
  // экране, хотя вход давно прошёл. Своё дело оно сделало, как только
  // аутентификация удалась.
  if (!silent) {
    closeAuthModal();
    toast(t('auth.signed_in_toast'));
  }
  // Первый вход в этот аккаунт после работы без него — перенести ли данные.
  // До синхронизации: связь с журналом (linkAccount) сольёт перенесённое с
  // облачным без потерь и ни о чём не спросит.
  if (guestOfferFor === user.id) {
    guestOfferFor = null;
    await offerGuestMove();
  }
  if (scopeStale || scopeGen !== gen) return;
  await syncOnSignIn();
}

/** Главная кнопка и Enter: вход или регистрация, смотря какой режим. */
async function handleAuthSubmit() {
  // Окно открыли до того, как вкладка отстала, — вход и регистрация всё
  // равно не идут (openAuthModal).
  if (staleGuard()) return;
  if (authMode === 'signup') { await handleSignup(); return; }
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!email || !password) return;
  el.authError.hidden = true;
  el.authSubmit.disabled = true;
  try {
    await beforeSessionChange();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      // Неверная пара — это и опечатка в пароле, и «аккаунта ещё нет», сервер
      // их не различает. Поэтому ошибка красным, как у любой другой неудачи, а
      // рядом — предложение создать аккаунт: тот же переключатель внизу, но с
      // подсказкой, как на телефоне. Одной подсказки мало: человек с опечаткой
      // не увидел бы, что вход не удался.
      if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message || '')) {
        showAuthError('auth.error_invalid');
        setI18nText(el.authSwitchText, 'auth.no_account');
      } else showAuthError('auth.error_generic');
      return;
    }
    await afterSignedIn();
  } catch {
    showAuthError('auth.error_generic');
  } finally {
    el.authSubmit.disabled = false;
  }
}

/** Ответ signUp понятными словами. Аккаунт уже есть — переключаем на вход, не
 *  стирая почту и пароль. supabase-js отдаёт код в error.code (новый сервер) или
 *  только текст 'User already registered' (старый); слабый пароль — код
 *  weak_password. Если подтверждение почты включено, а адрес занят, сервер не
 *  ошибается, а отдаёт «пустого» пользователя без identities. */
function signupFailed(error, data) {
  const code = (error && error.code) || '';
  const text = (error && error.message) || '';
  const exists = code === 'user_already_exists' || /already registered/i.test(text)
    || (!error && data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
  if (exists) { setAuthMode('signin'); showAuthError('auth.error_exists'); return true; }
  if (!error) return false;
  showAuthError(code === 'weak_password' || /password should be at least/i.test(text) ? 'auth.error_weak_password' : 'auth.error_generic');
  return true;
}

async function handleSignup() {
  if (staleGuard()) return;
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!email || !password) return;
  el.authError.hidden = true;
  el.authSubmit.disabled = true;
  try {
    await beforeSessionChange();
    const { data, error } = await sb.auth.signUp({ email, password });
    if (signupFailed(error, data)) return;
    // Подтверждения почты нет: логин и пароль — и сразу внутри. Сервер без
    // сессии — входим тем же паролем; не вышло — ошибка в форме.
    if (!data.session) {
      const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
      if (signInError) { showAuthError('auth.error_generic'); return; }
    }
    await afterSignedIn();
  } catch {
    showAuthError('auth.error_generic');
  } finally {
    el.authSubmit.disabled = false;
  }
}

/** Сохраняет шаг после входа и доводит вход до конца. withProfile=false —
 *  «Пропустить»: только согласие, без имени и назначения. Email в профиль
 *  не пишется: он и так есть в аккаунте, копия ни для чего не нужна. Без
 *  согласия не сохраняется ничего. */
async function saveOnboarding(withProfile = true) {
  if (!consentGiven() || staleGuard()) return;
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
    // Профиль — того, кто на экране: сервер ответил про чужой сеанс — не он.
    if (!user || !currentUser || user.id !== currentUser.id) return false;
    const { error } = await sb.from('profiles').update({ name: clean }).eq('id', user.id);
    if (error) throw error;
    currentUser = { ...currentUser, name: clean };
    noteAccountProfile();
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

/** «Выйти»: аккаунт уходит из списка вместе с сеансом, копия его данных
 *  остаётся на устройстве (стереть — «Удалить данные аккаунта с
 *  устройства»). Дальше открывается следующий аккаунт или гость. Сеанс
 *  снимается только на этом устройстве: телефон того же аккаунта не
 *  выходит. */
async function signOut() {
  if (staleGuard()) return;
  const ok = await confirmDialog(t('auth.sign_out_confirm'), {
    title: t('auth.sign_out'), okLabel: t('auth.sign_out'), danger: true,
  });
  if (!ok) return;
  const uid = scopeUid || (currentUser && currentUser.id) || null;
  flushEditor();
  savePending = true;
  await saveNow();
  if (currentUser) await flushSync();
  unsubscribeSyncRealtime();
  stopSyncTimers();
  if (currentUser) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.error('Не удалось выйти:', err); }
  } else await dropLocalSession();
  currentUser = null;
  if (uid) await leaveAccount(uid);
  renderAccountBtn();
  // Страница настроек показывает карточку профиля и раздел «Аккаунт» —
  // без этого после выхода она продолжала показывать вошедшего.
  if (state.ui.view === 'settings') renderSettings();
  toast(t('auth.signed_out_toast'));
}

// Картинки редактора в облаке лежат в doc-assets/<id пользователя>/ и
// каскадом за пользователем не уходят: байты живут в хранилище, и стереть их
// можно только через Storage API, не SQL. Страж guard_account_assets в базе
// (supabase/storage.sql) не даёт удалить аккаунт, пока в папке что-то есть, —
// поэтому папка стирается раньше, чем зовётся delete_my_account.
const ASSET_BUCKET = 'doc-assets';

/** Стереть свою папку картинок до пустоты. Бросает, если хранилище ответило
 *  ошибкой — или ничего не стёрло: правило доступа, не пустившее удаление,
 *  ошибкой не отвечает, и без этой проверки цикл не кончился бы.
 *  removedIds — сюда складываются id картинок, которые ушли из облака: если
 *  аккаунт в итоге останется, их надо вернуть (см. deleteAccount). */
async function clearCloudAssets(uid, removedIds) {
  const bucket = sb.storage.from(ASSET_BUCKET);
  for (;;) {
    const { data, error } = await bucket.list(uid, { limit: 1000 });
    if (error) throw error;
    const files = (data || []).filter((o) => o.id);
    if (!files.length) return;
    const { data: removed, error: removeError } = await bucket.remove(files.map((o) => `${uid}/${o.name}`));
    if (removeError) throw removeError;
    if (!removed || !removed.length) throw new Error(`хранилище не стёрло ни одного из ${files.length} файлов`);
    removedIds.push(...files.map((o) => o.name));
  }
}

/** Имена всех файлов своей папки картинок — страницами по 1000. Бросает,
 *  если хранилище ответило ошибкой. */
async function listCloudAssets(uid) {
  const bucket = sb.storage.from(ASSET_BUCKET);
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(uid, { limit: 1000, offset });
    if (error) throw error;
    const page = data || [];
    ids.push(...page.filter((o) => o.id).map((o) => o.name));
    if (page.length < 1000) return ids;
  }
}

/** Старый путь удаления — для случая, когда функции delete-account нет или
 *  до неё не дошли: клиент сам стирает папку и зовёт delete_my_account в
 *  базе (supabase/legal.sql). removedIds — сюда складываются id стёртых
 *  картинок. Возвращает { error, assetsFailed }. */
async function deleteAccountLegacy(uid, removedIds) {
  let error = null;
  // Отказ из-за картинок — и ошибка самого стирания, и страж, который не
  // пустил и после повтора.
  let assetsFailed = false;
  try {
    // Загрузка, начатая до паузы, всё равно может успеть положить файл между
    // стиранием и удалением — тогда страж отвечает «account assets remain».
    // На это — один повтор, не больше.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await clearCloudAssets(uid, removedIds);
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
  return { error, assetsFailed };
}

/** Код ответа функции delete-account; null — до функции не дошли. */
function functionStatus(error) {
  if (!error) return 200;
  return error.context && typeof error.context.status === 'number' ? error.context.status : null;
}

/** Удаление аккаунта. Клиент держит только ключ anon и удалить пользователя
 *  сам не может. Делает это Edge Function delete-account
 *  (supabase/functions/delete-account): со служебным ключом стирает папку
 *  картинок и пользователя, а профиль, проекты, задачи и синхронизация
 *  уходят каскадом. Ответы: 200 — удалено; 409 — картинки стереть не вышло,
 *  аккаунт цел; 500 — картинки стёрты, аккаунт цел. Нет функции (404) или
 *  нет связи с ней — старый путь, deleteAccountLegacy.
 *
 *  На устройстве удалённый аккаунт только уходит из списка аккаунтов
 *  (leaveAccount): открывается следующий или гость, а копия его данных,
 *  чаты агента и картинки из заметок на этом устройстве остаются — так
 *  обещают account.delete_confirm и landing/delete-account.html, так делает
 *  телефон. Стереть их — отдельное действие «Удалить данные аккаунта с
 *  устройства» (forgetDeviceData). Данные гостя и других аккаунтов не
 *  трогаются.
 *
 *  Функция удаляет того, чей сеанс, а не того, кто на экране, — поэтому
 *  сеанс сверяется с вошедшим после подтверждения (foreignSession), а
 *  отставшая вкладка не удаляет вовсе. */
async function deleteAccount() {
  if (!currentUser || staleGuard()) return;
  const ok = await confirmDialog(t('account.delete_confirm'), {
    title: t('account.delete_title'), okLabel: t('account.delete'), danger: true,
  });
  if (!ok || !currentUser || await foreignSession()) return;
  const uid = currentUser.id;
  // Пока папка стирается, картинки в облако не уходят: иначе файл из очереди
  // доехал бы в уже пустую папку и аккаунт не удалился бы.
  assetsPaused = true;
  let error = null;
  // 'assets' — аккаунт не удалён из-за картинок (account.delete_assets_error,
  // как на телефоне); 'delete' — любая другая причина (account.delete_error).
  let reason = 'delete';
  // Что вернуть в облако, если аккаунт остался, а картинки уже стёрты.
  let requeueIds = [];
  try {
    // Что лежит в облаке — заранее: функция в ответах 409 и 500 не говорит,
    // что успела стереть, а при 409 часть картинок уже может быть стёрта.
    // Не прочитали — функцию не зовём: вернуть стёртое было бы нечем.
    const listed = await listCloudAssets(uid);
    let fnError = null;
    let status = null;
    try {
      ({ error: fnError } = await sb.functions.invoke('delete-account'));
      status = functionStatus(fnError);
    } catch (err) {
      fnError = err;
    }
    if (status === 200) {
      error = null;
    } else if (status === 404 || status === null) {
      // Функции нет или до неё не дошли — старый путь.
      const removedIds = [];
      const legacy = await deleteAccountLegacy(uid, removedIds);
      error = legacy.error;
      reason = legacy.assetsFailed ? 'assets' : 'delete';
      requeueIds = removedIds;
    } else {
      error = fnError;
      if (status === 409) reason = 'assets';
      // 409 и 5xx: сервер мог стереть часть картинок или все — возвращаем
      // весь прочитанный список. Лишнее безвредно: requeue пропускает то,
      // чего нет на устройстве, а выгрузка идёт с перезаписью.
      if (status === 409 || status >= 500) requeueIds = listed;
    }
  } catch (err) {
    // Сюда попадает только ошибка чтения папки: функцию не звали.
    error = err;
  }
  assetsPaused = false;
  if (error) {
    console.error('Не удалось удалить аккаунт:', error);
    toast(t(reason === 'assets' ? 'account.delete_assets_error' : 'account.delete_error'));
    // Аккаунт остался, а папка в облаке уже стёрта целиком или частью: без
    // возврата картинки пропали бы на других устройствах. Те, что есть на
    // этом, снова встают в очередь и уходят в облако следующим flush.
    if (editorAssets) {
      if (requeueIds.length) await editorAssets.requeue(requeueIds);
      editorAssets.flush();
    }
    return;
  }
  unsubscribeSyncRealtime();
  stopSyncTimers();
  // Пользователя на сервере уже нет — выходим только здесь, без запроса.
  try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.error('Не удалось выйти:', err); }
  currentUser = null;
  // Аккаунт уходит из списка, открывается следующий или гость. Копия его
  // данных на этом устройстве остаётся — так обещает текст подтверждения
  // (account.delete_confirm) и landing/delete-account.html, и так делает
  // телефон: стереть её — отдельное действие в «Данных», «Удалить данные
  // аккаунта с устройства».
  await leaveAccount(uid);
  await refreshDeviceScopes();
  renderAccountBtn();
  if (state.ui.view === 'settings') renderSettings();
  toast(t('account.deleted_toast'));
}

async function handleGoogleSignIn() {
  if (staleGuard()) return;
  el.authGoogleBtn.disabled = true;
  el.authError.hidden = true;
  try {
    // Веб уходит со страницы на Google — своё должно лечь на диск раньше.
    await beforeSessionChange();
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
    if (!code || staleGuard()) return;
    try {
      await beforeSessionChange();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { showAuthError('auth.error_generic'); return; }
      await afterSignedIn();
    } catch {
      showAuthError('auth.error_generic');
    }
  });
}

el.accountBtn.addEventListener('click', () => {
  // Аккаунтов на устройстве нет — кнопка, как и была, открывает вход.
  if (currentUser || scopeUid || accounts.list.length) openAccountMenu();
  else openAuthModal('signin');
});
el.settingsForgetRow.addEventListener('click', () => openForgetMenu(el.settingsForgetRow));
el.settingsConflictsRow.addEventListener('click', openConflictList);
el.settingsTrashRow.addEventListener('click', openTrash);
el.syncdlgClose.addEventListener('click', closeSyncDialog);
el.syncdlgBack.addEventListener('click', openConflictList);
el.syncdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.syncdlgBackdrop) closeSyncDialog(); });
el.settingsMoveGuestRow.addEventListener('click', () => offerGuestMove());
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
  // Без согласия аккаунт не работает: выход, как «Выйти», — аккаунт уходит
  // из списка, открывается следующий или гость. Отставшая вкладка не
  // выходит: сеанс в хранилище — уже другой вкладки.
  if (staleGuard()) return;
  const uid = scopeUid;
  try { await sb.auth.signOut(); } catch (err) { console.error('Не удалось выйти:', err); }
  currentUser = null;
  closeAuthModal();
  if (uid) await leaveAccount(uid);
  renderAccountBtn();
  toast(t('auth.signed_out_toast'));
});
el.authSubmit.addEventListener('click', handleAuthSubmit);
el.authSwitchBtn.addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'signin' : 'signup'));
el.authGoogleBtn.addEventListener('click', handleGoogleSignIn);
el.authOnboardingSave.addEventListener('click', () => saveOnboarding(true));
// «Пропустить» пропускает имя и назначение, но не согласие: строка профиля
// с отметкой о нём всё равно нужна — иначе шаг всплывал бы при каждом входе.
el.authOnboardingSkip.addEventListener('click', () => saveOnboarding(false));
[el.authEmail, el.authPassword].forEach((input) => {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
});

// Первая синхронизация после запуска. Её ждёт startRoute(): ссылка на проект
// или задачу, которых на этом устройстве ещё нет, — не повод отправлять на
// «Сегодня», пока облако не ответило. Выполняется и тогда, когда входа нет, и
// когда синхронизация упала: ждать больше нечего.
let firstSyncDone;
const firstSync = new Promise((resolve) => { firstSyncDone = resolve; });
// Сеанс поднимается в init(): сначала список аккаунтов и область данных
// (prepareAccountsOnStart), потом загрузка, и только потом afterSignedIn —
// иначе синхронизация увидела бы данные чужой области.

// ---------------------------------------------------------------------------
// Синхронизация — журнал правок (17 октября 2026)
// ---------------------------------------------------------------------------
// Единица синхронизации — правка одного поля одной сущности, а не весь набор
// данных: правила — в ядре (core/oplog.js, общее с телефоном), как это
// устроено целиком — ARCHITECTURE.md, «Синхронизация». Сервер хранит журнал
// (таблица changes, supabase/sync2.sql) и ничего в нём не стирает; устройство
// сливает чужие правки со своими по полям. Две правки одного поля спорят,
// только если каждая сделана, не видя другую: тогда показывается одна, другая
// лежит рядом («Другая версия», раздел «Конфликты» ниже), и ничего не
// спрашивается в момент слияния.
//
// Пачка (bundle, core/oplog.js) — всё, что устройство знает о журнале своего
// аккаунта: очередь своих неотправленных правок, докуда прочитан журнал,
// конфликты, корзина, история полей. Лежит в том же файле (ключе) области,
// что и данные, — полем sync2 (packSync2): данные без своих неотправленных
// правок были бы потерей, а две записи вместо одной могли бы разойтись при
// сбое между ними. Состояние пачки — сами списки области: каждое сохранение
// сначала сводит живое состояние в пачку (commitLive), поэтому сохранённые
// списки и есть то, с чем пачка сверится в следующий раз.
//
// Гость и область аккаунта, ещё не связанная с журналом на этом устройстве,
// пачки не держат: копить очередь из каждой буквы, которая никуда не уйдёт,
// незачем. Их данные уходят в журнал при первой связи целиком
// (linkAccount → adoptGuestState): правками baseSeq 0, общее с аккаунтом —
// по полям, расхождения — пометками; ничего не затирается.
//
// activeTimer, settings и ui в журнал не уходят: это данные устройства.
//
// Старые клиенты (десктоп ≤ 0.4.4, телефон ≤ 1.2.3) живут на sync_state —
// мост. После слияния состояние зеркалится туда (writeMirror: updated_by
// 'oplog:<устройство>', mirror_seq), а чужая запись старого клиента
// превращается в правки (bridgeLegacy). Мост живёт один релиз.
// ---------------------------------------------------------------------------

const SYNC_LISTS = ['projects', 'tasks', 'statuses', 'tags', 'versions', 'documents'];
/** Строк журнала за один запрос — чтение страницами. */
const SYNC_PAGE = 1000;
/** Своих правок за одну отправку. Одна вставка — одна транзакция: проект и
 *  его статусы приходят к другим вместе, и их миграция не заводит своих. */
const SYNC_SEND_MAX = 2000;
/** Слепок — когда журнал ушёл от прошлого дальше, чем на столько правок. */
const SNAPSHOT_EVERY = 1000;
/** Сколько дней удалённое лежит в корзине. */
const TRASH_DAYS = 30;
/** Пауза перед зеркалом для старых клиентов: правки идут пачками. */
const MIRROR_DELAY_MS = 1500;
/** Запись старого клиента, посчитанную от зеркала, которого это устройство
 *  не знает, сначала ждёт устройство, которое его писало. */
const LEGACY_GRACE_MS = 120000;
/** Повторы после сбоя сети: всё реже, до минуты. */
const SYNC_BACKOFF_MS = [2000, 5000, 15000, 30000, 60000];
/** Тихая сверка с журналом, пока страница на виду: realtime может молча
 *  отвалиться, а пропущенная правка не должна ждать перезапуска. */
const SYNC_POLL_MS = 60000;

/** Пачка открытой области; null — область с журналом не связана. */
let syncBundle = null;
/** Служебное рядом с пачкой, ядру не нужное (freshSyncExtra). */
let syncExtra = freshSyncExtra();
/** Случайный id установки (не области): так ядро отличает свои правки от
 *  чужих, а окно конфликта — с какого устройства версия. */
let deviceId = null;
let syncChannel = null;
let syncRetryTimer = null;
let syncFails = 0;
let syncSendBusy = false;
let syncSendAgain = false;
let syncPullBusy = false;
let syncPullAgain = false;
let mirrorTimer = null;
let legacyTimer = null;
let syncPollTimer = null;
/** Правки в полёте: их нельзя ни сжать, ни отправить второй раз сразу. */
const syncInflight = new Set();
/** Ушли на сервер, но ещё не подтверждены (повтор отбит, строки в ответе
 *  нет): подтвердит чтение журнала, повторять сразу незачем. */
const syncSent = new Set();

/** extra: mirror — последнее увиденное зеркало sync_state {seq, data, json};
 *  snapSeq — seq последнего слепка; bridged — updated_at последней записи
 *  старого клиента, уже переведённой в правки; adopt — данные, ждущие
 *  первой связи с журналом (перенос «Без аккаунта» до неё). */
function freshSyncExtra() {
  return { mirror: null, snapSeq: 0, bridged: null, adopt: [] };
}

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

/** Глубокая копия шести списков: пачка и живое состояние никогда не делят
 *  объекты — app.js правит свои на месте. */
function listsCopy(src) {
  const out = {};
  for (const k of SYNC_LISTS) out[k] = Array.isArray(src && src[k]) ? JSON.parse(JSON.stringify(src[k])) : [];
  return out;
}

const hasAnyLists = (lists) => !!lists && SYNC_LISTS.some((k) => Array.isArray(lists[k]) && lists[k].length > 0);

/** Пачка → поле sync2 в данных области. state не пишется: им служат сами
 *  списки области (commitLive сводит их в пачку перед каждой записью).
 *  Зеркало, совпавшее с ними, — пометкой base, а не второй копией данных. */
function packSync2(bundle, extra, uid) {
  const out = { v: 1, uid };
  const x = extra || {};
  if (bundle) {
    Object.assign(out, {
      linked: true,
      pending: bundle.pending || [],
      lastSeq: bundle.lastSeq || 0,
      conflicts: bundle.conflicts || [],
      trash: bundle.trash || [],
      meta: bundle.meta || {},
      deferred: bundle.deferred || [],
    });
  }
  if (x.mirror) {
    const json = x.mirror.json || JSON.stringify(x.mirror.data);
    const base = bundle ? JSON.stringify(Core.mirrorSyncState(bundle.state)) : null;
    out.mirror = json === base ? { seq: x.mirror.seq, base: true } : { seq: x.mirror.seq, data: x.mirror.data };
  }
  if (x.snapSeq) out.snapSeq = x.snapSeq;
  if (x.bridged) out.bridged = x.bridged;
  if (Array.isArray(x.adopt) && x.adopt.length) out.adopt = x.adopt;
  return out;
}

/** Поле sync2 из загруженных данных области uid → { bundle, extra }; поле из
 *  данных снимается. Чужая область, гость, незнакомый вид — пачки нет. */
function unpackSync2(loaded, uid) {
  const raw = loaded && typeof loaded === 'object' ? loaded.sync2 : null;
  if (loaded && typeof loaded === 'object') delete loaded.sync2;
  const extra = freshSyncExtra();
  if (!uid || !raw || typeof raw !== 'object' || raw.v !== 1 || raw.uid !== uid) return { bundle: null, extra };
  const arr = (v) => (Array.isArray(v) ? v : []);
  extra.snapSeq = Number(raw.snapSeq) || 0;
  extra.bridged = raw.bridged || null;
  extra.adopt = arr(raw.adopt);
  const bundle = raw.linked ? {
    state: listsCopy(loaded),
    pending: arr(raw.pending),
    lastSeq: Number(raw.lastSeq) || 0,
    conflicts: arr(raw.conflicts),
    trash: arr(raw.trash),
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    deferred: arr(raw.deferred),
  } : null;
  if (raw.mirror && Number.isFinite(Number(raw.mirror.seq))) {
    const data = raw.mirror.base ? (bundle ? Core.mirrorSyncState(bundle.state) : null) : raw.mirror.data;
    if (data) extra.mirror = { seq: Number(raw.mirror.seq), data, json: null };
  }
  return { bundle, extra };
}

/** Служебные поля правки, которые не сжимаются: создание, удаление,
 *  пометки и записи времени. */
const COALESCE_KEEP = new Set(['*', 'deleted', 'conflict', 'resolved', 'sessions+', 'sessions-', 'sessions~']);

/** Своя неотправленная правка поля, которую перекрыла следующая своя правка
 *  того же поля, никому уже не нужна: её значения нет ни в состоянии, ни в
 *  истории поля (верхняя там — новая). Без сжатия офлайн-заметка уходила бы
 *  в журнал целиком на каждую паузу в наборе. Убираются только такие: не в
 *  полёте и без записи о конфликте поля (её версии ссылаются на id правок). */
function coalescePending(bundle, fresh, inflight) {
  if (!bundle || !Array.isArray(fresh) || !fresh.length) return bundle;
  const keyOf = (op) => `${op.entity}:${op.entityId}:${op.field}`;
  const newest = new Map();
  for (const op of fresh) if (op && !COALESCE_KEEP.has(op.field)) newest.set(keyOf(op), op.id);
  if (!newest.size) return bundle;
  const drop = new Set();
  for (const op of bundle.pending || []) {
    if (!op || COALESCE_KEEP.has(op.field)) continue;
    const keep = newest.get(keyOf(op));
    if (!keep || keep === op.id || (inflight && inflight.has(op.id))) continue;
    if (op.seq !== null && op.seq !== undefined) continue;
    const m = bundle.meta && bundle.meta[`${op.entity}:${op.entityId}`];
    if (m && m.k && m.k[op.field]) continue;
    drop.add(op.id);
  }
  if (!drop.size) return bundle;
  return Object.assign({}, bundle, { pending: bundle.pending.filter((op) => !drop.has(op.id)) });
}

/** Записям времени без id — их ключ (core/oplog.js, stampSessionIds): тогда
 *  сдвиг начала записи остаётся правкой той же записи. На месте: объекты
 *  задач остаются теми же, на них держатся окна и выделение. */
function stampLive() {
  const st = Core.stampSessionIds({ tasks: state.tasks });
  if (!st || st.tasks === state.tasks) return;
  st.tasks.forEach((task, i) => {
    const live = state.tasks[i];
    if (live && task !== live) live.sessions = task.sessions;
  });
}

/** Живое состояние → пачка: что поменялось с прошлого раза — правками в
 *  очередь, удалённое — в корзину. Возвращает новые правки. */
function commitLive() {
  stampLive();
  if (!syncBundle) return [];
  const r = Core.commitLocal(syncBundle, syncPayload(), { deviceId, at: new Date().toISOString() });
  syncBundle = coalescePending(r.bundle, r.ops, syncInflight);
  if (r.ops.length) syncMarksChanged();
  return r.ops;
}

/** Что ложится на диск: состояние и, у области аккаунта, его пачка. */
function persistData() {
  commitLive();
  if (!scopeUid) return state;
  const sync2 = packSync2(syncBundle, syncExtra, scopeUid);
  if (!syncBundle && !sync2.adopt && !sync2.mirror) return state;
  return Object.assign({}, state, { sync2 });
}

/** Пачка только что загруженной области (зовут openScope и init): снять
 *  sync2 с данных, вычистить корзину старше 30 дней. */
function takeSync2(loaded, uid) {
  const { bundle, extra } = unpackSync2(loaded, uid);
  syncBundle = bundle ? Core.trashSweep(bundle, Date.now(), TRASH_DAYS) : null;
  syncExtra = extra;
  syncSent.clear();
  syncInflight.clear();
  syncFails = 0;
  conflictIndexFor = null;
}

/** Установка — одна на устройство, и id у неё один на все аккаунты. Нет
 *  моста к хранилищу (старый preload) — id на время сеанса. */
async function loadDeviceId() {
  try { if (window.api.deviceId) deviceId = await window.api.deviceId(); } catch (err) { console.error('Не удалось прочитать id установки:', err); }
  if (!deviceId) deviceId = `${IS_WEB ? 'web' : 'app'}-${uid()}`;
}

/** Синхронизация всё ещё про того же: пока ждали сеть, могли переключить
 *  аккаунт, и ответ про прежний нельзя применять к данным следующего. */
const syncStillFor = (uid) => !!(!scopeStale && currentUser && currentUser.id === uid && (scopeUid === uid || scopeUid === null));
/** То же для журнала: его пачка — у области, поэтому область — та же. */
const syncFor = (uid) => !!(!scopeStale && currentUser && currentUser.id === uid && scopeUid === uid);
/** Можно ли сейчас говорить с журналом. */
const syncLive = () => !!(!scopeStale && currentUser && scopeUid === currentUser.id && state.settings.syncEnabled !== false && deviceId);

function scheduleSyncRetry() {
  clearTimeout(syncRetryTimer);
  const ms = SYNC_BACKOFF_MS[Math.min(syncFails, SYNC_BACKOFF_MS.length - 1)];
  syncFails += 1;
  syncRetryTimer = setTimeout(() => { syncRetryTimer = null; syncNow(); }, ms);
}

/** Всё, что журналу сейчас нужно: связь, чтение, отправка. Его зовут
 *  повтор после сбоя, «online», возврат на вкладку и тихая сверка. */
async function syncNow() {
  if (!syncLive()) return;
  if (!syncBundle) { await syncOnSignIn(); return; }
  await pullChanges();
  await sendPending();
}
window.addEventListener('online', () => { syncFails = 0; syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

function startSyncPoll() {
  clearInterval(syncPollTimer);
  syncPollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, SYNC_POLL_MS);
}
function stopSyncTimers() {
  clearInterval(syncPollTimer);
  syncPollTimer = null;
  clearTimeout(syncRetryTimer);
  syncRetryTimer = null;
  clearTimeout(mirrorTimer);
  mirrorTimer = null;
  clearTimeout(legacyTimer);
  legacyTimer = null;
}

/** Свои правки — в журнал: insert с игнором повторов (on_conflict
 *  user_id,op_id) → ackPending. Сеть упала — очередь лежит в пачке на диске
 *  и уйдёт повтором, хоть после перезапуска. */
async function sendPending() {
  if (!syncLive() || !syncBundle) return;
  if (syncSendBusy) { syncSendAgain = true; return; }
  const uid = currentUser.id;
  const batch = syncBundle.pending.slice(0, SYNC_SEND_MAX);
  if (!batch.length) return;
  syncSendBusy = true;
  syncSendAgain = false;
  for (const op of batch) syncInflight.add(op.id);
  let ok = false;
  try {
    const { data, error } = await sb.from('changes')
      .upsert(batch.map((op) => Core.opToRow(op, uid)), { onConflict: 'user_id,op_id', ignoreDuplicates: true })
      .select();
    if (!syncFor(uid) || !syncBundle) return;
    if (error) throw error;
    syncBundle = Core.ackPending(syncBundle, Array.isArray(data) ? data : [], { deviceId, now: Date.now() });
    for (const op of batch) syncSent.add(op.id);
    syncFails = 0;
    ok = true;
    savePending = true;
    scheduleSave();
  } catch (err) {
    console.error('Не удалось отправить правки:', err);
    if (syncFor(uid)) scheduleSyncRetry();
  } finally {
    syncSendBusy = false;
    syncInflight.clear();
  }
  if (!ok) return;
  // ack не двигает lastSeq: журнал до своих правок мог быть не прочитан.
  // Там же подтвердятся правки, которые сервер уже знал.
  await pullChanges();
  if (!syncLive() || !syncBundle) return;
  const ids = new Set(syncBundle.pending.map((p) => p.id));
  for (const id of [...syncSent]) if (!ids.has(id)) syncSent.delete(id);
  if (syncSendAgain || syncBundle.pending.some((p) => !syncSent.has(p.id))) sendPending();
  else if (syncBundle.pending.length) scheduleSyncRetry();
}

/** Чтение журнала: на событие realtime не берём строку из события, а
 *  читаем всё после lastSeq по порядку (строка из события могла обогнать
 *  соседку).
 *
 *  Строки всех страниц сначала собираются, а сливаются разом, после
 *  последней, — одним синхронным шагом: своё несохранённое в очередь
 *  (commitLive), приём (mergeIncoming), результат в живое состояние
 *  (applyRemoteData). Между ними нет ни одного await, и правка, сделанная,
 *  пока грузилась следующая страница, не теряется: раньше страницы
 *  сливались по одной, своё сводилось в очередь только перед первой, а
 *  живое затиралось в конце. Звать commitLive перед каждой страницей тоже
 *  нельзя: пачка после первой страницы уже со слитым, а живое — ещё без
 *  него, и разница ушла бы своими правками, откатывающими чужие. В живое
 *  состояние результат по-прежнему ложится один раз: миграция между
 *  страницами завела бы проекту, чьи статусы на следующей странице, свои.
 *  Страница упала — сливается то, что успели прочитать: строки идут по
 *  порядку, следующий приём продолжит с последней. */
async function pullChanges() {
  if (!syncLive() || !syncBundle) return;
  if (syncPullBusy) { syncPullAgain = true; return; }
  syncPullBusy = true;
  syncPullAgain = false;
  const uid = currentUser.id;
  let before = null;
  let events = [];
  let merged = false;
  let foreign = false;
  let failed = false;
  const rows = [];
  try {
    try {
      let after = syncBundle.lastSeq;
      for (;;) {
        const { data, error } = await sb.from('changes').select('*')
          .eq('user_id', uid).gt('seq', after)
          .order('seq', { ascending: true }).limit(SYNC_PAGE);
        if (!syncFor(uid) || !syncBundle) return;
        if (error) throw error;
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < SYNC_PAGE) break;
        after = Number(page[page.length - 1].seq);
      }
      syncFails = 0;
    } catch (err) {
      console.error('Не удалось прочитать журнал правок:', err);
      failed = true;
      if (syncFor(uid)) scheduleSyncRetry();
    }
    if (rows.length && syncFor(uid) && syncBundle) {
      flushEditor();
      commitLive(); // своё несохранённое — в очередь до приёма
      before = syncBundle.state;
      const out = Core.mergeIncoming(syncBundle, rows, { deviceId, now: Date.now() });
      events = out.events || [];
      syncBundle = stripMerge(out);
      merged = true;
      foreign = rows.some((r) => r.device_id !== deviceId);
    }
  } finally {
    syncPullBusy = false;
  }
  if (!syncFor(uid) || !syncBundle) return;
  if (merged) {
    // Своё, вернувшееся из журнала, состояния обычно не меняет — тогда
    // перерисовывать нечего, достаточно запомнить, докуда прочитано.
    const touched = SYNC_LISTS.some((k) => syncBundle.state[k] !== before[k]);
    if (foreign || touched || events.length) applyRemoteData(listsCopy(syncBundle.state));
    else { savePending = true; scheduleSave(); }
    syncMarksChanged();
    syncToasts(events, foreign);
  }
  if (syncPullAgain) { syncPullAgain = false; await pullChanges(); return; }
  if (failed) return;
  maybeSnapshot(uid);
  scheduleMirror();
  // В очереди могли появиться пометки о конфликтах — их тоже отправить.
  if (syncBundle.pending.some((p) => !syncSent.has(p.id))) sendPending();
}

const stripMerge = (out) => {
  const b = Object.assign({}, out);
  delete b.restored; delete b.events;
  return b;
};

/** Все строки журнала после seq — страницами. */
async function readChangesAfter(uid, seq) {
  const rows = [];
  let from = seq;
  for (;;) {
    const { data, error } = await sb.from('changes').select('*')
      .eq('user_id', uid).gt('seq', from).order('seq', { ascending: true }).limit(SYNC_PAGE);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < SYNC_PAGE) return rows;
    from = Number(page[page.length - 1].seq);
  }
}

const SYNC_STATE_COLS = 'data, updated_at, updated_by, mirror_seq';

/** Первая связь области аккаунта с журналом на этом устройстве: последний
 *  слепок и правки после него; слепка нет — sync_state как слепок seq 0 (и
 *  он же, если журнал пуст, ложится в snapshots: следующие устройства
 *  начнут с него, а не с пустоты). Своё, что лежало в области до связи, и
 *  ждущий перенос «Без аккаунта» — adoptGuestState: правками baseSeq 0,
 *  общее с аккаунтом — по полям, с пометками; ничего не затирается. Вопроса
 *  «какие данные оставить» больше нет. */
async function linkAccount(uid) {
  try {
    const snapRes = await sb.from('snapshots').select('seq, data').eq('user_id', uid).order('seq', { ascending: false }).limit(1);
    if (snapRes.error) throw snapRes.error;
    let snap = (Array.isArray(snapRes.data) && snapRes.data[0]) || null;
    const rowRes = await sb.from('sync_state').select(SYNC_STATE_COLS).eq('user_id', uid).maybeSingle();
    if (rowRes.error) throw rowRes.error;
    const row = rowRes.data || null;
    const fromRow = !snap;
    if (!snap) snap = { seq: 0, data: (row && row.data) || {} };
    const ops = await readChangesAfter(uid, Number(snap.seq) || 0);
    if (!syncFor(uid)) return false;
    if (syncBundle) return true; // связал параллельный вызов
    if (fromRow && row && !ops.length) {
      const { error } = await sb.from('snapshots').insert({ user_id: uid, seq: 0, data: row.data || {} });
      if (error && error.code !== '23505') console.error('Не удалось положить слепок sync_state:', error);
    }
    if (!syncFor(uid) || syncBundle) return !!syncBundle;
    flushEditor();
    stampLive();
    const at = new Date().toISOString();
    let b = stripMerge(Core.bootstrapFromSnapshot({ seq: Number(snap.seq) || 0, data: snap.data || {} }, ops, { deviceId, now: Date.now() }));
    const events = [];
    for (const lists of [listsCopy(state), ...syncExtra.adopt]) {
      if (!hasAnyLists(lists)) continue;
      const res = Core.adoptGuestState(b, lists, { deviceId, at });
      b = res.bundle;
      events.push(...(res.events || []));
    }
    syncBundle = b;
    const extra = Object.assign(freshSyncExtra(), { snapSeq: Number(snap.seq) || 0 });
    if (row) {
      // Зеркало, от которого считают старые клиенты: запись нового
      // устройства — как есть; запись старого, взятая за слепок, — она же
      // и есть то, что в пачке.
      if (isOplogRow(row) || fromRow) extra.mirror = { seq: rowMirrorSeq(row), data: row.data || {}, json: null };
      if (!isOplogRow(row) && fromRow) extra.bridged = row.updated_at || null;
    }
    syncExtra = extra;
    syncSent.clear();
    applyRemoteData(listsCopy(syncBundle.state));
    syncMarksChanged();
    syncToasts(events, false);
    savePending = true;
    await saveNow();
    return true;
  } catch (err) {
    console.error('Не удалось связаться с журналом правок:', err);
    if (syncFor(uid)) scheduleSyncRetry();
    return false;
  }
}

/** Пришло слитое состояние (приём журнала, связь, выбор версии, корзина):
 *  глубокая копия — в живое, миграция, перерисовка. Своё несохранённое к
 *  этому моменту уже сведено в пачку (commitLive) и в data есть. То, что
 *  поменяют миграция и возврат задач, — свои правки этого устройства: они
 *  уйдут следующим сохранением, как любые другие. */
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
  reopenDueTasks(Date.now());
  if (selectedId && !getTask(selectedId)) selectedId = null;
  if (state.ui.projectId && !getProject(state.ui.projectId)) {
    state.ui.view = 'home';
    state.ui.projectId = null;
  }
  render();
  refreshEditorsFromRemote();
  if (!el.syncdlgBackdrop.hidden) renderSyncDialog();
  scheduleSave();
}

/** Тосты слияния: спасённое от удаления, другая версия, просто обновление. */
function syncToasts(events, foreign) {
  const list = Array.isArray(events) ? events : [];
  const restored = list.find((e) => e.type === 'restored');
  const conflict = list.find((e) => e.type === 'conflict');
  if (restored) toast(t('sync.restored_toast', { name: entityName(restored.entity, restored.entityId) }));
  else if (conflict) toast(t('sync.conflict_toast', { name: entityName(conflict.entity, conflict.entityId) }));
  else if (foreign) toast(t('sync.updated_toast'));
}

/** Слепок для новых устройств: журнал ушёл от прошлого дальше, чем на
 *  SNAPSHOT_EVERY правок, и своих неотправленных нет (иначе слепок соврал
 *  бы). Два устройства на одном seq — второй отбит ключом, это нормально. */
async function maybeSnapshot(uid) {
  if (!syncFor(uid) || !syncBundle || syncBundle.pending.length) return;
  if (syncBundle.lastSeq - (syncExtra.snapSeq || 0) <= SNAPSHOT_EVERY) return;
  const snap = Core.compactSnapshot(syncBundle);
  if (!snap) return;
  try {
    const { error } = await sb.from('snapshots').insert({ user_id: uid, seq: snap.seq, data: snap.data });
    if (error && error.code !== '23505') throw error;
    if (!syncFor(uid)) return;
    syncExtra = Object.assign({}, syncExtra, { snapSeq: snap.seq });
    savePending = true;
    scheduleSave();
  } catch (err) {
    console.error('Не удалось положить слепок:', err);
  }
}

// --- Мост к старым клиентам (sync_state) -------------------------------------

const isOplogRow = (row) => !!(row && typeof row.updated_by === 'string' && row.updated_by.startsWith('oplog:'));
const rowMirrorSeq = (row) => (row && row.mirror_seq !== null && row.mirror_seq !== undefined ? Number(row.mirror_seq) || 0 : 0);
const mirrorJson = (m) => {
  if (!m) return null;
  if (!m.json) m.json = JSON.stringify(m.data);
  return m.json;
};

function scheduleMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { mirrorTimer = null; writeMirror(); }, MIRROR_DELAY_MS);
}

/** Зеркало для старых клиентов: после слияния — состояние в sync_state, с
 *  mirror_seq (на каком seq журнала это зеркало) и updated_by 'oplog:…' (по
 *  нему новые устройства отличают зеркало от записи старого клиента).
 *  Сначала — свежая запись: если там непереведённая правка старого клиента,
 *  зеркало её затёрло бы, — сперва мост. */
async function writeMirror() {
  if (!syncLive() || !syncBundle || syncBundle.pending.length) return;
  const uid = currentUser.id;
  const data = Core.mirrorSyncState(syncBundle);
  const json = JSON.stringify(data);
  const seq = syncBundle.lastSeq;
  const m = syncExtra.mirror;
  if (m && m.seq === seq && mirrorJson(m) === json) return;
  try {
    const { data: row, error: readError } = await sb.from('sync_state').select(SYNC_STATE_COLS).eq('user_id', uid).maybeSingle();
    if (readError) throw readError;
    if (!syncFor(uid) || !syncBundle) return;
    if (row && !isOplogRow(row) && row.updated_at !== syncExtra.bridged) { await bridgeLegacy(row); return; }
    if (syncBundle.pending.length || syncBundle.lastSeq !== seq) return; // пока ждали, пришло новое — следующим разом
    const { error } = await sb.from('sync_state').upsert({
      user_id: uid,
      data,
      updated_at: new Date().toISOString(),
      updated_by: `oplog:${deviceId}`,
      mirror_seq: seq,
    });
    if (error) throw error;
    if (!syncFor(uid)) return;
    syncExtra = Object.assign({}, syncExtra, { mirror: { seq, data, json } });
    savePending = true;
    scheduleSave();
  } catch (err) {
    console.error('Не удалось обновить sync_state для старых версий:', err);
  }
}

/** Запись sync_state (realtime или чтение): зеркало другого нового
 *  устройства — запомнить как последнее увиденное; запись старого клиента
 *  — в правки. */
async function onSyncStateRow(row) {
  if (!row || !syncLive() || !syncBundle) return;
  if (row.user_id && row.user_id !== currentUser.id) return;
  if (isOplogRow(row)) {
    if (row.updated_by !== `oplog:${deviceId}`) syncExtra = Object.assign({}, syncExtra, { mirror: { seq: rowMirrorSeq(row), data: row.data || {}, json: null } });
    return;
  }
  await bridgeLegacy(row);
}

/** Запись старого клиента → правки устройства 'legacy' (legacyBridgeOps):
 *  разница с зеркалом, от которого он считал (его seq — mirror_seq строки:
 *  старый клиент колонку не знает и не трогает), с baseSeq этого зеркала —
 *  то, что журнал после него менял, против неё параллельно, а не затёрто.
 *  id правок — от updated_at: все новые устройства дают одни и те же, и
 *  повтор отбивает сервер. Зеркала нет у этого устройства — сначала ждём
 *  то, которое его писало; не дождались — берём ближайшее известное
 *  (лишнее станет «другой версией», а не потерей). */
async function bridgeLegacy(row) {
  if (!syncLive() || !syncBundle) return;
  const uid = currentUser.id;
  const stamp = row.updated_at || null;
  if (!stamp || syncExtra.bridged === stamp) return;
  const base = rowMirrorSeq(row);
  const m = syncExtra.mirror;
  if (!m || m.seq !== base) {
    const wait = LEGACY_GRACE_MS - (Date.now() - Date.parse(stamp));
    if (wait > 0) {
      clearTimeout(legacyTimer);
      legacyTimer = setTimeout(() => { legacyTimer = null; writeMirror(); }, wait + 1000);
      return;
    }
  }
  const prev = m ? m.data : Core.mirrorSyncState(syncBundle);
  const ops = Core.legacyBridgeOps(prev, row.data || {}, { at: stamp, baseSeq: base, stamp });
  try {
    if (ops.length) {
      const { error } = await sb.from('changes')
        .upsert(ops.map((op) => Core.opToRow(op, uid)), { onConflict: 'user_id,op_id', ignoreDuplicates: true });
      if (error) throw error;
    }
  } catch (err) {
    console.error('Не удалось перевести запись старой версии в правки:', err);
    if (syncFor(uid)) scheduleSyncRetry();
    return;
  }
  if (!syncFor(uid) || !syncBundle) return;
  syncExtra = Object.assign({}, syncExtra, { bridged: stamp, mirror: { seq: base, data: row.data || {}, json: null } });
  savePending = true;
  scheduleSave();
  await pullChanges();
}

// --- Вход и подписка ----------------------------------------------------------

let syncInFlightFor = null;

/** После входа (и на старте с живым сеансом): связь с журналом, если её
 *  ещё нет, подписка, чтение, мост, отправка. Защита от почти одновременных
 *  повторных вызовов (см. afterSignedIn). */
async function syncOnSignIn() {
  if (!syncLive()) return;
  if (syncInFlightFor === currentUser.id) return;
  syncInFlightFor = currentUser.id;
  try {
    await syncOnSignInInner();
  } finally {
    syncInFlightFor = null;
  }
}

async function syncOnSignInInner() {
  const uid = currentUser.id;
  if (!syncBundle && !(await linkAccount(uid))) return;
  if (!syncFor(uid)) return;
  subscribeSyncRealtime();
  startSyncPoll();
  await pullChanges();
  if (!syncFor(uid)) return;
  // Пока устройства не было, старый клиент мог записать sync_state.
  try {
    const { data: row, error } = await sb.from('sync_state').select(SYNC_STATE_COLS).eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (row && syncFor(uid)) await onSyncStateRow(Object.assign({ user_id: uid }, row));
  } catch (err) {
    console.error('Не удалось прочитать sync_state:', err);
  }
  await sendPending();
  scheduleMirror();
}

/** Свои правки — в журнал своим же сеансом: перед сменой аккаунта, выходом
 *  и стиранием копии. Не вышло — очередь лежит в пачке области. */
async function flushSync() {
  if (!syncLive() || !syncBundle) return;
  await sendPending();
}

let pullSoonTimer = null;
/** Событие realtime — только повод перечитать журнал; пачка строк одной
 *  вставки — одно чтение. */
function pullSoon(uid) {
  clearTimeout(pullSoonTimer);
  pullSoonTimer = setTimeout(() => { if (syncFor(uid)) pullChanges(); }, 60);
}

function subscribeSyncRealtime() {
  unsubscribeSyncRealtime();
  if (!syncLive()) return;
  const uid = currentUser.id;
  syncChannel = sb
    .channel('sync2:' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'changes', filter: `user_id=eq.${uid}` }, () => pullSoon(uid))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_state', filter: `user_id=eq.${uid}` }, (payload) => {
      if (syncFor(uid)) onSyncStateRow(payload && payload.new);
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') pullSoon(uid); });
}
function unsubscribeSyncRealtime() {
  if (syncChannel) { sb.removeChannel(syncChannel); syncChannel = null; }
  clearTimeout(pullSoonTimer);
}

/** Пункт меню аккаунта — источник данных: пользователь может полностью
 * отключить облачную синхронизацию для этого устройства (данные остаются
 * только локально, даже будучи залогиненным), не выходя из аккаунта. Правки
 * тем временем копятся в очереди и уйдут, когда её включат снова. */
function toggleSyncEnabled() {
  const next = !(state.settings.syncEnabled !== false);
  state.settings.syncEnabled = next;
  scheduleSave();
  if (next) { if (currentUser) syncOnSignIn(); } else { unsubscribeSyncRealtime(); stopSyncTimers(); }
  toast(next ? t('sync.enabled_toast') : t('sync.disabled_toast'));
}

// ---------------------------------------------------------------------------
// Конфликты — «Другая версия» (17 октября 2026)
// ---------------------------------------------------------------------------
// Конфликт — две правки одного поля, сделанные не видя друг друга. Ядро уже
// показывает одну (позднюю), другая лежит в syncBundle.conflicts. Здесь —
// значок у задачи в строке, карточке и на доске (.conflict-mark), строка
// «Другая версия ›» в свойствах задачи, окне проекта и меню документа,
// список всех в «Данных» и окно выбора: поле, версии с устройством и
// временем, «Оставить эту» (resolveConflict — обычная правка выбранным
// значением плюс 'resolved'; обе версии остаются в журнале).

/** Индекс конфликтов по сущности — пересобирается, когда меняется пачка. */
let conflictIndexFor = null;
let conflictIndex = new Map();

function syncMarksChanged() {
  conflictIndexFor = null;
}

function conflictsOf(kind, id) {
  if (!syncBundle) return [];
  if (conflictIndexFor !== syncBundle) {
    conflictIndex = new Map();
    for (const c of syncBundle.conflicts || []) {
      const key = `${c.entity}:${c.entityId}`;
      if (!conflictIndex.has(key)) conflictIndex.set(key, []);
      conflictIndex.get(key).push(c);
    }
    conflictIndexFor = syncBundle;
  }
  return conflictIndex.get(`${kind}:${id}`) || [];
}

const allConflicts = () => (syncBundle ? syncBundle.conflicts || [] : []);

/** Значок «есть другая версия» — один на строку списка, карточку проекта и
 *  доску. null — конфликтов нет. */
function conflictMark(kind, id) {
  const n = conflictsOf(kind, id).length;
  if (!n) return null;
  const m = elt('span', 'conflict-mark');
  m.innerHTML = icon('copy');
  m.title = t('sync.conflict_badge');
  m.setAttribute('aria-label', t('sync.conflict_badge'));
  return m;
}
const conflictMarkHtml = (kind, id) => {
  const m = conflictMark(kind, id);
  return m ? m.outerHTML : '';
};

/** Строка «Другая версия · N ›» (srow) — в свойствах задачи, окне проекта. */
function conflictRowHtml(id) {
  return `<button type="button" class="srow" id="${id}">${icon('copy')}`
    + `<span class="srow-label">${escapeHtml(t('sync.other_version'))}</span>`
    + `<span class="srow-box"><span class="srow-value"></span></span>${icon('chevron-right', 'icon srow-chev')}</button>`;
}

/** Группа с этой строкой в host: нет конфликтов — группа прячется. */
function renderConflictRow(host, kind, id) {
  if (!host) return;
  const list = conflictsOf(kind, id);
  host.hidden = !list.length;
  if (!list.length) { host.innerHTML = ''; return; }
  if (!host.firstElementChild) {
    host.innerHTML = conflictRowHtml(`${host.id}-row`);
    host.firstElementChild.addEventListener('click', () => openConflictDialog(host.dataset.kind, host.dataset.id));
  }
  host.dataset.kind = kind;
  host.dataset.id = id;
  host.querySelector('.srow-label').textContent = t('sync.other_version');
  host.querySelector('.srow-value').textContent = fieldsLabel(list);
}

function renderTaskConflicts(task) {
  renderConflictRow(el.taskConflicts, 'task', task.id);
}

/** Поля конфликтов словами: «Название, Заметки». */
function fieldsLabel(list) {
  return [...new Set(list.map((c) => fieldLabel(c.entity, c.field)))].join(', ');
}

const FIELD_KEYS = {
  title: 'sync.f_title', name: 'sync.f_name', notes: 'sync.f_notes', body: 'sync.f_body', description: 'sync.f_description',
  color: 'sync.f_color', sessions: 'sync.f_session', done: 'sync.f_done', projectId: 'sync.f_project',
  dueAt: 'due.label', statusId: 'task.status_label', versionId: 'version.label', tagIds: 'tag.pick', rate: 'money.rate_label',
  repeat: 'repeat.label', reminders: 'remind.label', slots: 'slot.label', currency: 'sync.f_currency', releasedAt: 'sync.f_released',
};

function fieldLabel(kind, field) {
  if (kind === 'document' && field === 'title') return t('sync.f_title');
  const key = FIELD_KEYS[field];
  return key ? t(key) : field;
}

const ENTITY_KEYS = {
  project: 'sync.k_project', task: 'sync.k_task', document: 'sync.k_document', status: 'sync.k_status', tag: 'sync.k_tag', version: 'sync.k_version',
};

/** Сущность из живого состояния или из корзины. */
function findEntity(kind, id) {
  const list = { project: state.projects, task: state.tasks, status: state.statuses, tag: state.tags, version: state.versions, document: state.documents }[kind] || [];
  const live = list.find((x) => x && String(x.id) === String(id));
  if (live) return live;
  const tr = syncBundle && (syncBundle.trash || []).find((x) => x.entity === kind && String(x.entityId) === String(id));
  return tr ? tr.data : null;
}

function entityName(kind, id) {
  const e = findEntity(kind, id);
  if (!e) return t('task.no_name');
  if (kind === 'task') return e.title || t('task.no_name');
  if (kind === 'document') return docTitle(e);
  return e.name || t('task.no_name');
}

/** С какого устройства версия: это, старая версия приложения или другое —
 *  по началу id установки (web-, win-, mac-, android-, ios-). */
function deviceLabel(id) {
  if (!id) return t('sync.device_other');
  if (id === deviceId) return t('sync.device_this');
  if (id === 'legacy') return t('sync.device_legacy');
  const kind = String(id).split('-')[0];
  const known = { web: 'sync.device_web', win: 'sync.device_win', mac: 'sync.device_mac', linux: 'sync.device_linux', android: 'sync.device_android', ios: 'sync.device_ios' }[kind];
  return known ? t(known) : t('sync.device_other');
}

function syncWhen(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${fmtDateShort(d.toISOString())}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Значение версии словами — для окна выбора. Текст заметки и документа —
 *  целиком, простым текстом (docPlainText), его окно прокручивается. */
function versionValueNode(c, value) {
  const field = c.field;
  if (value === null || value === undefined || value === '') {
    return elt('span', 'syncdlg-empty', t(c.sessionId ? 'sync.session_removed' : 'sync.value_empty'));
  }
  if (field === 'notes' || field === 'body') {
    const text = Core.docPlainText(Core.readNotes(value).doc).trim();
    return elt('div', 'syncdlg-text', text || t('sync.value_empty'));
  }
  if (c.sessionId || field === 'sessions') {
    const s = value || {};
    const ms = Number(s.ms) || 0;
    return elt('span', 'syncdlg-val', `${syncWhen(s.start)}${s.end ? `–${syncWhen(s.end).split(', ').pop()}` : ''} · ${fmtShort(ms)}`);
  }
  if (field === 'color') {
    const box = elt('span', 'syncdlg-val');
    const dot = elt('i', 'st-swatch');
    dot.style.setProperty('--sc', String(value));
    box.append(dot, ` ${value}`);
    return box;
  }
  let text;
  if (field === 'statusId') text = (getStatus(value) || {}).name;
  else if (field === 'projectId') text = (getProject(value) || {}).name;
  else if (field === 'versionId') text = ((state.versions || []).find((v) => v.id === value) || {}).name;
  else if (field === 'tagIds' && Array.isArray(value)) text = value.map((id) => ((state.tags || []).find((g) => g.id === id) || {}).name).filter(Boolean).join(', ');
  else if (field === 'repeat') text = repeatLabel(Core.normalizeRepeat(value));
  else if (/At$/.test(field) && typeof value === 'string') text = syncWhen(value);
  else if (typeof value === 'boolean') text = t(value ? 'sync.value_yes' : 'sync.value_no');
  else if (typeof value === 'string' || typeof value === 'number') text = String(value);
  else if (Array.isArray(value)) text = t('sync.value_items', { n: value.length });
  else text = JSON.stringify(value);
  return elt('span', 'syncdlg-val', text || t('sync.value_empty'));
}

/** Окно синхронизации: одно на три вида — конфликты сущности, список всех
 *  конфликтов, корзина. */
const syncdlg = { mode: null, kind: null, id: null, from: null };

/** Конфликты сущности. from — 'all', если пришли из списка: тогда у окна
 *  стрелка назад, к списку. */
function openConflictDialog(kind, id, from) {
  if (!conflictsOf(kind, id).length) return;
  closeMenu();
  syncdlg.mode = 'entity';
  syncdlg.kind = kind;
  syncdlg.id = id;
  syncdlg.from = from || null;
  renderSyncDialog();
  if (el.syncdlgBackdrop.hidden) usageSend('conflicts');
  el.syncdlgBackdrop.hidden = false;
}

function openConflictList() {
  syncdlg.mode = 'all';
  syncdlg.from = null;
  renderSyncDialog();
  if (el.syncdlgBackdrop.hidden) usageSend('conflicts');
  el.syncdlgBackdrop.hidden = false;
}

function openTrash() {
  syncdlg.mode = 'trash';
  syncdlg.from = null;
  renderSyncDialog();
  if (el.syncdlgBackdrop.hidden) usageSend('trash');
  el.syncdlgBackdrop.hidden = false;
}

function closeSyncDialog() {
  el.syncdlgBackdrop.hidden = true;
  syncdlg.mode = null;
  if (state.ui.view === 'settings') renderSyncSettings();
}

function renderSyncDialog() {
  const body = el.syncdlgBody;
  body.innerHTML = '';
  el.syncdlgBack.hidden = true;
  if (syncdlg.mode === 'entity') {
    const list = conflictsOf(syncdlg.kind, syncdlg.id);
    if (!list.length) {
      // Решили последний: из списка — обратно в список, иначе окно закрыто.
      if (syncdlg.from === 'all' && allConflicts().length) { openConflictList(); return; }
      closeSyncDialog();
      return;
    }
    el.syncdlgTitle.textContent = t('sync.other_version');
    el.syncdlgBack.hidden = syncdlg.from !== 'all';
    body.appendChild(elt('p', 'syncdlg-sub', `${t(ENTITY_KEYS[syncdlg.kind] || 'sync.k_task')} · ${entityName(syncdlg.kind, syncdlg.id)}`));
    for (const c of list) body.appendChild(conflictBlock(c));
    return;
  }
  if (syncdlg.mode === 'all') {
    el.syncdlgTitle.textContent = t('sync.conflicts');
    const groups = new Map();
    for (const c of allConflicts()) {
      const key = `${c.entity}:${c.entityId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    if (!groups.size) {
      body.appendChild(emptyState({ art: 'tasks', title: t('sync.conflicts_empty'), text: t('sync.conflicts_empty_text'), small: true }));
      return;
    }
    const grp = elt('div', 'sgroup');
    for (const list of groups.values()) {
      const c = list[0];
      const row = elt('button', 'srow');
      row.type = 'button';
      row.dataset.kind = c.entity;
      row.dataset.id = c.entityId;
      row.innerHTML = `${icon('copy')}<span class="srow-label"></span><span class="srow-box"><span class="srow-value"></span></span>${icon('chevron-right', 'icon srow-chev')}`;
      row.querySelector('.srow-label').textContent = `${entityName(c.entity, c.entityId)}`;
      row.querySelector('.srow-value').textContent = `${t(ENTITY_KEYS[c.entity] || 'sync.k_task')} · ${fieldsLabel(list)}`;
      row.addEventListener('click', () => openConflictDialog(c.entity, c.entityId, 'all'));
      grp.appendChild(row);
    }
    body.appendChild(grp);
    return;
  }
  if (syncdlg.mode === 'trash') {
    el.syncdlgTitle.textContent = t('sync.trash');
    const rows = trashRows();
    if (!rows.length) {
      body.appendChild(emptyState({ art: 'tasks', title: t('sync.trash_empty'), text: t('sync.trash_empty_text', { days: TRASH_DAYS }), small: true }));
      return;
    }
    body.appendChild(elt('p', 'syncdlg-sub', t('sync.trash_note', { days: TRASH_DAYS })));
    const grp = elt('div', 'sgroup');
    for (const tr of rows) {
      const row = elt('div', 'srow srow-static trash-row');
      row.dataset.kind = tr.entity;
      row.dataset.id = tr.entityId;
      row.innerHTML = `${icon('trash')}<span class="srow-label"></span><span class="srow-box"><span class="srow-value"></span><span class="srow-sub"></span></span>`;
      row.querySelector('.srow-label').textContent = trashName(tr);
      row.querySelector('.srow-value').textContent = t(ENTITY_KEYS[tr.entity] || 'sync.k_task');
      row.querySelector('.srow-sub').textContent = t('sync.deleted_on', { date: syncWhen(tr.deletedAt) });
      const btn = elt('button', 'btn-soft trash-restore', t('sync.restore'));
      btn.type = 'button';
      btn.addEventListener('click', () => restoreTrashItem(tr.entity, tr.entityId));
      row.appendChild(btn);
      grp.appendChild(row);
    }
    body.appendChild(grp);
  }
}

/** Конфликт одного поля: подпись поля и версии — значение, устройство,
 *  время, «сейчас показана» и «Оставить эту». */
function conflictBlock(c) {
  const box = elt('div', 'syncdlg-field');
  box.dataset.conflict = c.id;
  box.appendChild(elt('div', 'sgroup-label', c.sessionId ? t('sync.f_session') : fieldLabel(c.entity, c.field)));
  const shownId = c.shownId || (c.shown === 'ours' ? c.ours && c.ours.opId : c.theirs && c.theirs.opId);
  const versions = (c.versions || []).slice().sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  for (const v of versions) {
    const card = elt('div', 'syncdlg-version');
    card.dataset.op = v.opId;
    if (v.opId === shownId) card.classList.add('shown');
    card.appendChild(versionValueNode(c, v.value));
    const foot = elt('div', 'syncdlg-foot');
    const who = elt('span', 'syncdlg-who', `${deviceLabel(v.deviceId)} · ${syncWhen(v.at)}`);
    foot.appendChild(who);
    if (v.opId === shownId) foot.appendChild(elt('span', 'syncdlg-shown', t('sync.shown_now')));
    const keep = elt('button', 'btn-soft syncdlg-keep', t('sync.keep_this'));
    keep.type = 'button';
    keep.addEventListener('click', () => chooseVersion(c.id, v.opId));
    foot.appendChild(keep);
    card.appendChild(foot);
    box.appendChild(card);
  }
  return box;
}

/** «Оставить эту»: правка поля выбранным значением и 'resolved' — в
 *  очередь, значение — в живое состояние, отправка сразу. */
function chooseVersion(conflictId, opId) {
  if (!syncBundle) return;
  flushEditor();
  commitLive();
  const r = Core.resolveConflict(syncBundle, conflictId, opId, { deviceId, at: new Date().toISOString() });
  if (!r.ops.length) return;
  syncBundle = r.bundle;
  syncMarksChanged();
  applyRemoteData(listsCopy(syncBundle.state));
  savePending = true;
  saveNow();
  sendPending();
  toast(t('sync.kept_toast'));
}

// ---------------------------------------------------------------------------
// Корзина (17 октября 2026)
// ---------------------------------------------------------------------------
// Удалённое лежит рядом с состоянием (syncBundle.trash) 30 дней — и своё, и
// пришедшее с других устройств; trashSweep чистит старое при открытии
// области. В списке — то, что удаляли сами: статусы, версии и теги,
// ушедшие вместе со своим проектом, не показываются отдельно и
// возвращаются с ним; задача удалённого проекта возвращает и проект.

const TRASH_KINDS_WITH_PROJECT = ['task', 'status', 'version', 'tag', 'document'];
const TRASH_TOGETHER_MS = 10000;

function trashList() {
  return syncBundle ? (syncBundle.trash || []).filter((x) => x && x.entity && x.data) : [];
}

/** Ушла ли запись вместе со своим проектом (одним удалением). */
function trashedWithProject(tr, all) {
  if (!TRASH_KINDS_WITH_PROJECT.includes(tr.entity) || !tr.data.projectId) return null;
  const p = all.find((x) => x.entity === 'project' && String(x.entityId) === String(tr.data.projectId));
  if (!p) return null;
  return Math.abs((Date.parse(p.deletedAt) || 0) - (Date.parse(tr.deletedAt) || 0)) <= TRASH_TOGETHER_MS ? p : null;
}

function trashRows() {
  const all = trashList();
  return all.filter((tr) => !trashedWithProject(tr, all))
    .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
}

function trashName(tr) {
  const e = tr.data || {};
  if (tr.entity === 'task') return e.title || t('task.no_name');
  if (tr.entity === 'document') return docTitle(e);
  return e.name || t('task.no_name');
}

/** «Восстановить»: возврат — правками ('deleted' = null и '*', ядро
 *  restoreFromTrash), вместе с тем, что ушло с проектом, и с проектом
 *  задачи, если он тоже в корзине. */
function restoreTrashItem(kind, id) {
  if (!syncBundle) return;
  flushEditor();
  commitLive();
  const all = trashList();
  const item = all.find((x) => x.entity === kind && String(x.entityId) === String(id));
  if (!item) return;
  const group = [item];
  if (kind === 'project') group.push(...all.filter((x) => x !== item && trashedWithProject(x, all) === item));
  else if (item.data.projectId) {
    const p = all.find((x) => x.entity === 'project' && String(x.entityId) === String(item.data.projectId));
    if (p) group.unshift(p);
  }
  const at = new Date().toISOString();
  for (const g of group) {
    const r = Core.restoreFromTrash(syncBundle, g.entity, g.entityId, { deviceId, at });
    syncBundle = r.bundle;
  }
  syncMarksChanged();
  applyRemoteData(listsCopy(syncBundle.state));
  savePending = true;
  saveNow();
  sendPending();
  toast(t('sync.restored_one', { name: trashName(item) }));
}

/** Группа «Синхронизация» в «Данных»: «Конфликты · N ›», «Корзина · N ›».
 *  Только у области, связанной с журналом. */
function renderSyncSettings() {
  const on = !!syncBundle;
  el.settingsSyncDataLabel.hidden = !on;
  el.settingsSyncData.hidden = !on;
  if (!on) return;
  el.settingsConflictsValue.textContent = String(allConflicts().length);
  el.settingsTrashValue.textContent = String(trashRows().length);
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
  // Идёт смена области (openScope): прежнее состояние легло бы в новую.
  // savePending остаётся — новое состояние сохранится следующим разом.
  if (!savePending || scopeSwitching) return;
  savePending = false;
  try {
    // Сначала живое — в пачку (commitLive): на диск ложатся данные вместе
    // со своими неотправленными правками, одной записью.
    await window.api.save(persistData());
    // Отправка не держит локальное сохранение сетью.
    if (syncBundle && syncBundle.pending.some((p) => !syncSent.has(p.id))) sendPending();
  } catch (err) {
    console.error('Не удалось сохранить данные:', err);
    toast(t('toast.save_error'));
    savePending = true;
  }
}
window.addEventListener('beforeunload', () => { if (savePending && !scopeSwitching) window.api.save(persistData()); });

// ---------------------------------------------------------------------------
// Рендер — маршрутизатор
// ---------------------------------------------------------------------------

/** Какой экран показан сейчас: вид и его проект или задача. */
let shownScreen = '';
let settleTimer = 0;

function render() {
  // Где стояли строки, у которых порядок может поменяться (см. «Порядок
  // строк»): замер — до того, как страница перерисуется.
  const flipBefore = flipSnapshot();
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
  applyModeFlags();
  renderStats();
  renderNotifBadge();

  // Открытый проект подсвечен в меню сам — «Обзор» при этом не горит.
  el.navItems.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === v));
  renderNavProjects();

  // Анимация — только переход: другой экран, другой проект или другая
  // задача. Перерисовка на месте (таймер, галочка, синхронизация) экран не
  // переигрывает — раньше он на каждой мигал прозрачностью.
  const views = { home: el.homeView, projects: el.projectsView, project: el.projectView, task: el.taskView, docs: el.docsView, time: el.timeView, settings: el.settingsView };
  const shown = `${v}:${v === 'task' ? selectedId : v === 'project' ? state.ui.projectId : v === 'settings' ? settingsSection() || '' : ''}`;
  const entering = shown !== shownScreen;
  shownScreen = shown;
  // Новый экран — порядок строк считается заново, без заморозки и без
  // переезда: человек ушёл и вернулся, а не смотрел, как строка едет.
  // Шкалы на новом экране натекают от нуля, отмеченные строки не держатся.
  if (entering) { orderHold = null; shownOrder.clear(); flipArm = null; flipAll = false; deckOrder = null; rowsForget(); barForget(); }
  for (const [name, node] of Object.entries(views)) {
    const show = name === v;
    node.hidden = !show;
    if (show && entering) enterView(node);
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

  flipPlay(entering ? null : flipBefore);
  syncRoute();
}

/** Переход на экран: он въезжает (viewIn), строки и карточки — лесенкой
 *  (tileIn). Когда въезд закончился, экран «оседает» (.settled): новые
 *  строки от перерисовки на месте появляются без анимации. */
function enterView(node) {
  node.classList.remove('anim', 'settled');
  void node.offsetWidth;
  node.classList.add('anim');
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => node.classList.add('settled'), 600);
}

/** Старые имена экранов — «calendar» и «stats» — с 7 октября 2026 один
 *  раздел «Статистика»: календарь открывается в своём последнем режиме,
 *  статистика — месяцем. */
function aliasTimeView() {
  if (state.ui.view === 'calendar') {
    state.ui.view = 'time';
    if (timeMode() === 'month') state.ui.timeMode = TIME_MODES.includes(agenda.mode) && agenda.mode !== 'month' ? agenda.mode : 'week';
  } else if (state.ui.view === 'stats') {
    state.ui.view = 'time';
    state.ui.timeMode = 'month';
  }
}
// «4 дня» убраны 9 октября 2026: сохранённый когда-то режим открывается неделей.
const TIME_MODES = ['day', 'week', 'month', 'agenda'];
const timeMode = () => (TIME_MODES.includes(state.ui.timeMode) ? state.ui.timeMode : 'week');

function openView(view) {
  flushEditor();
  closeMenu();
  closeSearch();
  // Вход на «Проекты»: идущая задача встаёт в своей карточке первой.
  if (view === 'projects') deckPin = state.activeTimer ? state.activeTimer.taskId : null;
  if (view === 'settings') state.ui.settingsSection = null;
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
// Адреса экранов
//
// Экран и открытая сущность отражаются в хэше (core/route.js): обновление
// страницы остаётся на месте, а у проекта, задачи и документа есть ссылка.
// Адрес пишет сам render() — через syncRoute(), в самом конце, когда вид уже
// приведён в порядок, — поэтому ни один из десятка переходов в коде не знает
// про историю браузера. В обратную сторону работает openRoute(): назад и
// вперёд, ручная правка адреса, запуск и lancible://.
// ---------------------------------------------------------------------------

/** Пока адрес не разобран на запуске, он не пишется: иначе первый же render()
 *  затёр бы ссылку, по которой человека сюда привели. */
let routeReady = false;
/** Идёт переход из адреса: исправления адреса при этом — замена записи в
 *  истории, а не новая запись. */
let routeApplying = false;
/** Экран последней записи в истории (core/route.js: routeKey) — по нему
 *  отличается новый экран от вкладки или режима внутри прежнего. */
let lastRouteKey = null;
/** Ссылка lancible://, пришедшая раньше, чем окно закончило запуск. */
let pendingDeepRoute = null;
/** Адрес, с которым экран уже согласован: на «назад» браузер шлёт popstate и
 *  hashchange подряд, и второй раз переходить незачем. */
let lastRouteHash = '';
/** Номер записи истории, на которой стоит приложение: 0 — первая его запись
 *  в этой вкладке. Лежит и в самой записи (history.state.lcbIdx), поэтому
 *  переживает перезагрузку и находится сам на «назад» и «вперёд». По нему
 *  стрелка «назад» в шапке знает, есть ли куда возвращаться. */
let routeIdx = 0;
/** Следующая запись адреса — заменой, а не новой записью: экран, с которого
 *  уходим, исчез (удалили задачу или проект, на странице которого стояли), и
 *  «назад» на него вело бы на «Сегодня». */
let routeReplaceNext = false;
/** Номер записи из самой записи истории; null — запись не наша (ручная
 *  правка адреса, первая загрузка). */
const historyIdx = () => (history.state && Number.isInteger(history.state.lcbIdx) ? history.state.lcbIdx : null);

/** Сколько ждать первую синхронизацию, прежде чем решить, что сущности по
 *  ссылке нет. Облако отвечает за секунду-две; потолок нужен, чтобы
 *  зависшая сеть не оставила человека перед заставкой. */
const FIRST_SYNC_WAIT_MS = 8000;

/** Адрес веб-версии: десктоп копирует ссылки на неё. На вебе ссылка идёт от
 *  страницы, на которой человек сидит, — так её открывает и боевой сайт
 *  (/app/), и локальный сервер, где приложение лежит в корне. */
const WEB_APP_URL = 'https://lancible.vercel.app/app/';

/** Маршрут того, что на экране. Звать после того, как render() привёл вид в
 *  порядок: нет проекта — «Сегодня», нет задачи — её проект. */
function currentRoute() {
  const v = state.ui.view;
  if (v === 'project') return { view: v, id: state.ui.projectId, tab: projectTab() };
  if (v === 'task') return { view: v, id: selectedId };
  if (v === 'docs') return { view: v, id: state.ui.docId || undefined };
  if (v === 'time') return { view: v, mode: timeMode() };
  if (v === 'settings') return settingsSection() ? { view: v, section: settingsSection() } : { view: v };
  return { view: v };
}

/** Есть ли у нас то, на что указывает маршрут. Экранам без сущности — да. */
function routeFound(route) {
  if (route.view === 'project') return !!getProject(route.id);
  if (route.view === 'task') return !!getTask(route.id);
  if (route.view === 'docs' && route.id) return !!getDocument(route.id);
  return true;
}

/** Заголовок вкладки браузера (и окна десктопа): что открыто. */
function routeTitle(route) {
  let name = null;
  if (route.view === 'project') name = (getProject(route.id) || {}).name;
  else if (route.view === 'task') { const task = getTask(route.id); name = task && (task.title || t('task.no_name')); }
  else if (route.view === 'docs' && route.id) { const d = getDocument(route.id); name = d && docTitle(d); }
  else if (route.view === 'settings' && route.section) name = t(`settings.section_${route.section}`);
  else name = t({ projects: 'nav.projects', docs: 'nav.docs', time: 'nav.time', settings: 'nav.settings' }[route.view] || 'nav.home');
  return name ? `${name} — Lancible` : 'Lancible';
}

/** Адрес и заголовок — по тому, что на экране. Новый экран — новая запись
 *  истории (назад ходит по экранам); вкладка проекта, режим «Времени» и всё,
 *  что поправлено при переходе из самого адреса, — замена текущей. На
 *  десктопе последний экран ещё и запоминается для следующего запуска. */
function syncRoute() {
  if (!routeReady) return;
  const route = currentRoute();
  const hash = Core.buildRoute(route);
  const key = Core.routeKey(route);
  const title = routeTitle(route);
  if (document.title !== title) document.title = title;
  const replace = routeApplying || routeReplaceNext || key === lastRouteKey;
  routeReplaceNext = false;
  // Токены входа в хэше разбирает клиент базы — его адрес не трогаем.
  if (!Core.isAuthHash(location.hash)) {
    if (location.hash !== hash) {
      if (!replace) routeIdx += 1;
      history[replace ? 'replaceState' : 'pushState']({ lcbIdx: routeIdx }, '', hash);
    } else if (historyIdx() !== routeIdx) {
      // Адрес уже верный (правка руками, первая загрузка), но запись ещё не
      // знает своего номера.
      history.replaceState({ lcbIdx: routeIdx }, '', hash);
    }
  }
  lastRouteKey = key;
  lastRouteHash = location.hash;
  if (!IS_WEB && state.ui.route !== hash) {
    state.ui.route = hash;
    scheduleSave();
  }
  usageNoteView();
}

/** Привести приложение к маршруту. Нет такой сущности (чужой id, удалена,
 *  кривая ссылка) — «Сегодня», и адрес заменяется на него.
 *  @param fresh — переход по ссылке изнутри работающего приложения
 *    (lancible:// на десктопе): новый экран — новая запись истории, как
 *    щелчок. Без него (назад, вперёд, правка адреса, запуск) запись уже
 *    есть, и адрес только приводится к виду — заменой. */
function openRoute(route, fresh) {
  if (!routeFound(route)) route = { view: 'home' };
  routeApplying = !fresh;
  try {
    if (route.view === 'project') {
      state.ui.projectTab = route.tab;
      if (state.ui.view === 'project' && state.ui.projectId === route.id) {
        // Тот же проект, другая вкладка: переход не нужен, только перерисовка.
        flushEditor();
        closeMenu();
        render();
        scheduleSave();
      } else openProject(route.id);
    } else if (route.view === 'task') {
      selectTask(route.id); // задача уже открыта — он сам ничего не делает
    } else if (route.view === 'docs') {
      // Список документов может быть отфильтрован так, что открываемого в нём
      // нет, — тогда фильтр и поиск сбрасываются.
      if (route.id && !docsShown().some((d) => d.id === route.id)) {
        docFilter = 'all';
        docQuery = '';
        if (el.docSearch) el.docSearch.value = '';
      }
      openDocs(route.id);
    } else if (route.view === 'time') {
      if (route.mode) applyTimeMode(route.mode);
      openView('time');
    } else if (route.view === 'settings') openSettings(route.section);
    else openView(route.view);
    syncRoute(); // экран не менялся (уже там) — адрес всё равно приводится к виду
  } finally {
    routeApplying = false;
  }
}

/** Запуск и обновление страницы: экран берётся из адреса. Пустой адрес — на
 *  десктопе последний экран, на вебе «Сегодня». Если сущности по ссылке нет
 *  у нас, а человек вошёл в аккаунт, ждём первую синхронизацию: на новом
 *  устройстве его проект приедет только с ней. */
async function startRoute() {
  const hash = location.hash;
  let route = hash && hash !== '#' ? Core.parseRoute(hash)
    : IS_WEB ? { view: 'home' } : Core.parseRoute(state.ui.route);
  if (pendingDeepRoute) route = pendingDeepRoute;
  if (!routeFound(route)) {
    await Promise.race([firstSync, new Promise((resolve) => setTimeout(resolve, FIRST_SYNC_WAIT_MS))]);
    // Ссылка lancible:// могла прийти, пока ждали, — она новее адреса.
    if (pendingDeepRoute) route = pendingDeepRoute;
  }
  pendingDeepRoute = null;
  routeReady = true;
  // Перезагрузка оставляет вкладку на той же записи истории — номер берётся
  // из неё, и стрелка «назад» после обновления страницы помнит, откуда пришли.
  const idx = historyIdx();
  routeIdx = idx == null ? 0 : idx;
  openRoute(route);
}

// Назад, вперёд и правка адреса руками. popstate и hashchange приходят парой
// (на ручную правку и на «назад» по хэшу — оба): второй видит адрес, с которым
// экран уже согласован, и ничего не делает.
function onRouteChange() {
  if (!routeReady || Core.isAuthHash(location.hash)) return;
  const idx = historyIdx();
  if (location.hash === lastRouteHash) {
    // Экран тот же. Если это шаг по истории на запись с тем же адресом (два
    // одинаковых экрана подряд остались от прежних версий), «назад» не должен
    // молча стоять на месте — идём дальше в ту же сторону.
    if (idx != null && idx !== routeIdx) {
      const back = idx < routeIdx;
      routeIdx = idx;
      if (back && idx > 0) history.back();
      else if (!back) history.forward();
    }
    return;
  }
  // Ручная правка адреса — новая запись без номера: она стоит за прежней.
  routeIdx = idx == null ? routeIdx + 1 : idx;
  openRoute(Core.parseRoute(location.hash));
}
window.addEventListener('popstate', onRouteChange);
window.addEventListener('hashchange', onRouteChange);

/** Стрелка «назад» в шапке задачи и проекта — тот же шаг, что «назад»
 *  браузера: на экран, с которого пришли («Сегодня», календарь, поиск,
 *  доска). Раньше стрелка задачи всегда открывала её проект новой записью, а
 *  стрелка проекта — «Проекты», и «назад» браузера после неё возвращал на
 *  ту же задачу. Пришли не из приложения (ссылка, новая вкладка) — туда, куда
 *  стрелка ведёт по смыслу: fallback. */
function routeBack(fallback) {
  flushEditor();
  closeMenu();
  if (routeReady && routeIdx > 0) history.back();
  else fallback();
}

// Десктоп: lancible://project/<id> присылает главный процесс (src/main.js).
// Ссылка, пришедшая в работающее окно, — новый шаг: «назад» вернёт туда, где
// стояли до неё.
if (window.api.onRouteOpen) {
  window.api.onRouteOpen(({ route }) => {
    if (!route) return;
    if (routeReady) openRoute(route, true);
    else pendingDeepRoute = route;
  });
}

/** Ссылка на экран: её можно отправить, и она откроет то же самое. */
function routeUrl(route) {
  const base = IS_WEB ? location.origin + location.pathname.replace(/index\.html$/, '') : WEB_APP_URL;
  return Core.routeLink(base, route);
}

async function copyRouteLink(route) {
  try { await window.api.copy(routeUrl(route)); toast(t('toast.link_copied')); }
  catch { toast(t('toast.copy_failed')); }
}

// ---------------------------------------------------------------------------
// Счётчик экранов (23 октября 2026)
//
// Какие экраны открывают — для админ-панели: чем пользуются, а что не
// открывают вовсе. Уходят только имя экрана и платформа (rpc track_screen,
// supabase/admin.sql: просмотры за день на пользователя) — ни названий, ни
// id, ни содержимого. Шлёт только вошедший, принявший нынешнюю редакцию
// документов, с включённым выключателем «Статистика экранов»
// (state.settings.usageStats, по умолчанию включён); гость не шлёт ничего.
// Отставшая вкладка и чужой сеанс в хранилище — тоже нет: просмотр ушёл бы
// на другой аккаунт. Ошибки глотаются молча — счётчик ничему не мешает.
//
// Имя экрана — имя в адресе (core/route.js), а вкладка проекта, режим
// статистики и раздел настроек — через точку; панели и окна поверх экрана —
// свои имена. Полный список — USAGE_SCREENS (он же в DESIGN.md, «Счётчик
// экранов», и в admin/screens.js). Экран считается, когда его открыли:
// перерисовка на месте (таймер, синхронизация) — не открытие, закрытая
// панель не открывает заново экран под ней, а один и тот же экран уходит
// не чаще раза в USAGE_EVERY_MS.
// ---------------------------------------------------------------------------

const USAGE_SCREENS = [
  'today', 'projects', 'project', 'project.board', 'project.versions', 'project.docs', 'project.settings', 'project.new',
  'task', 'task.modal', 'docs', 'doc',
  'stats.day', 'stats.week', 'stats.month', 'stats.agenda',
  'settings', 'settings.main', 'settings.work', 'settings.account', 'settings.data', 'settings.about', 'settings.feedback',
  'agent', 'agent.chat', 'search', 'notifications', 'export', 'conflicts', 'trash',
];
const USAGE_EVERY_MS = 2000;
/** base — экран под панелями, который уже учтён (аккаунт и адрес); sent —
 *  когда какой экран ушёл последний раз. */
const usage = { base: '', sent: new Map() };

/** Можно ли сейчас считать: вошедший с принятой редакцией, выключатель не
 *  снят, вкладка не отстала, область не меняется. */
function usageAllowed() {
  return !!currentUser && consentOkFor === currentUser.id && state.settings.usageStats !== false
    && !scopeStale && !scopeSwitching;
}

/** Экран открыт — в базу, если можно и если этот экран не уходил только что. */
function usageSend(screen) {
  if (!USAGE_SCREENS.includes(screen) || !usageAllowed()) return;
  const now = Date.now();
  const last = usage.sent.get(screen);
  // Часы могли переставить назад — тогда разница отрицательная, и без abs
  // экран молчал бы до тех пор, пока время не догонит.
  if (last !== undefined && Math.abs(now - last) < USAGE_EVERY_MS) return;
  usage.sent.set(screen, now);
  const uid = currentUser.id;
  (async () => {
    try {
      // Сеанс в хранилище supabase-js на вебе общий у вкладок: просмотр идёт
      // только сеансом того, кто на экране (как foreignSession, но без тоста).
      const { data } = await sb.auth.getSession();
      const sid = data && data.session && data.session.user && data.session.user.id;
      if (sid !== uid || scopeStale || !currentUser || currentUser.id !== uid) return;
      await sb.rpc('track_screen', { p_screen: screen, p_platform: IS_WEB ? 'web' : 'desktop' });
    } catch { /* счётчик молчит: сеть, база, нет функции — не дело человека */ }
  })();
}

/** Имя экрана под панелями — по его маршруту (currentRoute). */
function usageScreenOf(route) {
  if (route.view === 'project') return route.tab && route.tab !== 'list' ? `project.${route.tab}` : 'project';
  if (route.view === 'docs') return route.id ? 'doc' : 'docs';
  if (route.view === 'time') return `stats.${route.mode || timeMode()}`;
  if (route.view === 'settings') return route.section ? `settings.${route.section}` : 'settings';
  return { home: 'today', projects: 'projects', task: 'task' }[route.view] || 'today';
}

/** Экран под панелями сменился — учесть. Зовёт syncRoute (адрес уже
 *  согласован с экраном) и вход в аккаунт. Пока считать нельзя, учтённый
 *  экран не сдвигается: включили выключатель или вошли — уйдёт тот, что на
 *  экране. Другой проект, задача или документ — новое открытие. */
function usageNoteView() {
  if (!routeReady || !usageAllowed()) return;
  const route = currentRoute();
  const key = `${currentUser.id}|${Core.buildRoute(route)}`;
  if (key === usage.base) return;
  usage.base = key;
  usageSend(usageScreenOf(route));
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
  const weekTo = new Date(Core.addDaysMs(weekFrom, 6));
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

/** Что запускает «▶ Старт» в шапке: всегда последнюю задачу, по которой шло
 *  время; если записей ещё не было — последнюю изменённую из невыполненных. */
function startableTask() {
  const last = recentTasks(1)[0];
  if (last) return last;
  const updMs = (x) => (x.updatedAt ? new Date(x.updatedAt).getTime() : 0);
  return state.tasks.filter((x) => !x.done).sort((a, b) => updMs(b) - updMs(a))[0] || null;
}

/** Капсула идущей задачи в шапке: время с начала записи и название. Без
 *  идущего таймера капсулы нет — пустая пилюля в шапке только путала бы. */
function renderTbTimer() {
  const at = state.activeTimer;
  const task = at && getTask(at.taskId);
  const next = task ? null : startableTask();
  // Смена «стоит ↔ идёт» — перелив (tbPour); первая отрисовка — без него.
  const was = tbRunning;
  tbRunning = !!task;
  const pour = was === null || was === tbRunning ? null : task ? 'in' : 'out';
  // «Старт» мерим, пока он на месте: из его ширины капсула и растекается.
  const fromW = pour === 'in' ? el.tbStart.offsetWidth : 0;
  // Стекающая капсула видна, пока не стечёт.
  const draining = pour === 'out' ? !reducedMotion() : el.tbTimer.classList.contains('liq-shrink');
  el.tbTimer.hidden = !task && !draining;
  el.tbStart.hidden = !next;
  if (next) el.tbStart.title = t('timer.start_last', { name: next.title || t('task.no_name') });
  if (task) {
    el.tbTimerTime.textContent = fmtClock(Date.now() - new Date(at.startedAt).getTime());
    el.tbTimerName.textContent = task.title || t('task.no_name');
  }
  if (pour) tbPour(pour, pour === 'in' ? fromW : el.tbStart.offsetWidth);
}

// ---------------------------------------------------------------------------
// Сегодня
// ---------------------------------------------------------------------------

const SVG_PLAY = icon('play');
const SVG_STOP = icon('stop');
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
 *  раньше или позже), запись — цветом проекта своей задачи, идущая — акцентом,
 *  «сейчас» — красной линией.
 *
 *  Зовётся из тика каждые 250 мс, пока на «Сегодня» идёт таймер. Идущая запись
 *  и красная линия за это время сдвигаются на тысячные доли процента, поэтому
 *  сначала описывается всё, что рисуется (положения — с точностью до сотой
 *  процента, меньше пикселя), и DOM пересобирается, только когда описание
 *  изменилось: раз в несколько секунд, а не четыре раза в секунду. Иначе
 *  каждый тик стирал и заводил заново десяток узлов, а наблюдатели за <body>
 *  разбирали их каждый раз. */
let dayIslandKey = '';
function renderDayIsland() {
  const now = new Date();
  const title = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const titleText = title.charAt(0).toUpperCase() + title.slice(1);
  const agg = aggregateDays().get(dayKey(now)) || { ms: 0, money: 0 };
  const at = state.activeTimer;
  const since = at ? ` · ${t('home.since', { time: hm(at.startedAt) })}` : '';
  const earned = modeFlags().earnings ? ` · <b>${escapeHtml(fmtMoney(agg.money))}</b>` : '';
  const subHtml = `${escapeHtml(t('home.recorded'))} <b>${escapeHtml(fmtDur(agg.ms))}</b>${earned}<span class="muted">${escapeHtml(since)}</span>`;

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
  const hundredth = (v) => Math.round(v * 100) / 100;
  const blocks = items.map((it) => {
    const left = pct(minOf(it.start));
    const width = Math.max(0.4, pct(minOf(it.end)) - left);
    const proj = getProject(it.task.projectId);
    const name = it.task.title || t('task.no_name');
    return {
      it, left: hundredth(left), width: hundredth(width), color: proj ? proj.color : PALETTE[0],
      title: `${name} · ${hm(it.start)}–${it.running ? '…' : hm(it.end)}`,
      label: width > 6 ? (it.running ? `${t('task.running_now')} · ${fmtShort(it.end - it.start)}` : name) : '',
    };
  });
  const nowMin = minOf(now);
  const nowAt = nowMin >= 0 && nowMin <= span ? hundredth(pct(nowMin)) : null;
  const key = JSON.stringify([titleText, subHtml, h0, h1, nowAt,
    blocks.map((b) => [b.it.task.id, b.it.task.projectId, b.it.running, b.left, b.width, b.color, b.title, b.label])]);
  if (key === dayIslandKey && el.dayTrack.firstChild) return;
  dayIslandKey = key;

  el.dayTitle.textContent = titleText;
  el.daySub.innerHTML = subHtml;
  el.dayTrack.innerHTML = `<div class="day-grid">${'<i></i>'.repeat(h1 - h0)}</div>`;
  for (const blk of blocks) {
    const { it } = blk;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day-blk' + (it.running ? ' run' : '');
    b.style.setProperty('--pc', blk.color);
    b.style.left = `${blk.left}%`;
    b.style.width = `${blk.width}%`;
    b.title = blk.title;
    b.setAttribute('aria-label', blk.title);
    if (blk.label) b.textContent = blk.label;
    b.addEventListener('click', () => openTask(it.task.id));
    el.dayTrack.appendChild(b);
  }
  if (nowAt !== null) {
    const line = document.createElement('i');
    line.className = 'day-now';
    line.style.left = `${nowAt}%`;
    el.dayTrack.appendChild(line);
  }
  el.dayHours.innerHTML = Array.from({ length: h1 - h0 }, (_, i) => `<span>${pad2(h0 + i)}</span>`).join('');
}

/** Проекты по свежести (19 октября 2026 — одно правило со всеми списками
 *  проектов, Core.projectsByActivity): последнее изменение в самом проекте,
 *  в его задачах или конец записи времени; свежие первыми. */
function recentProjects(limit) {
  return Core.projectsByActivity(state.projects, state.tasks).slice(0, limit);
}

function renderHomeProjects() {
  const list = listRows('home-projects', recentProjects(3));
  el.homeProjects.hidden = list.length === 0;
  el.homeProjGrid.innerHTML = '';
  for (const p of list) {
    const tasks = tasksOf(p.id);
    const done = tasks.filter((t2) => t2.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hp-card';
    flipTag(b, 'home-projects', p.id);
    b.style.setProperty('--pc', p.color || PALETTE[0]);
    b.innerHTML = `<span class="hp-head"><i class="hp-dot"></i><span class="hp-name">${escapeHtml(p.name)}</span></span>`
      + `<span class="hp-figs"><span><b>${escapeHtml(fmtDur(projectMs(p.id)))}</b>${modeFlags().money ? ` · ${escapeHtml(fmtMoney(projectMoney(p.id), currencyOf(p.id)))}` : ''}</span><span>${done}/${tasks.length}</span></span>`
      + '<span class="hp-bar"><i></i></span>';
    barFill(b.querySelector('.hp-bar i'), pct, `hp:${p.id}`);
    b.addEventListener('click', () => openProject(p.id));
    el.homeProjGrid.appendChild(b);
  }
}

/** Сроки — та же лента, что в колокольчике: просроченное, ближайшее,
 *  сработавшие напоминания. */
function renderHomeDue() {
  // Остров называется «Дедлайны»: напоминания отрезков «времени работы» —
  // не про сроки, они живут в колокольчике.
  const feed = notificationFeed().filter((n) => n.kind !== 'slot').slice(0, 6);
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
      + `<span class="rl-when${n.kind === 'overdue' ? ' overdue' : ''}">${escapeHtml(notifWhen(n))}</span>`;
    li.addEventListener('click', () => openTask(n.task.id));
    el.homeDueList.appendChild(li);
  }
}

/** Задача для острова «Сейчас идёт»: идущая, а если таймер стоит —
 *  последняя, чтобы продолжить одним нажатием. */
const nowTask = () => (state.activeTimer && getTask(state.activeTimer.taskId)) || recentTasks(1)[0] || null;

let nowProjHtml = '';
function renderNowIsland() {
  const at = state.activeTimer;
  const running = at && getTask(at.taskId);
  const task = running || recentTasks(1)[0] || null;
  el.nowIsland.hidden = !task;
  if (!task) return;
  const p = getProject(task.projectId);
  el.nowIsland.classList.toggle('idle', !running);
  el.nowLabel.textContent = running ? t('home.now_running') : t('home.now_idle');
  // Без таймера справа пусто: подпись «Продолжить» ничего не добавляла к
  // кнопке плей под ней.
  el.nowSince.textContent = running ? hm(at.startedAt) : '';
  el.nowTitle.textContent = task.title || t('task.no_name');
  // Остров перерисовывается каждые 250 мс; точка проекта в DOM заводится заново,
  // только когда проект другой (иначе наблюдатели за <body> разбирали бы её
  // четыре раза в секунду).
  const projHtml = `<i class="rl-dot" style="--pc:${escapeHtml(p ? p.color : PALETTE[0])}"></i>${escapeHtml(p ? p.name : '')}`;
  if (projHtml !== nowProjHtml) {
    nowProjHtml = projHtml;
    el.nowProj.innerHTML = projHtml;
  }
  // Классом, а не className целиком: остров перерисовывается каждые 250 мс,
  // и налив кнопки (.liq-fill) не должен слетать посреди анимации.
  el.nowBtn.classList.toggle('run', !!running);
  setPlayIcon(el.nowBtn, running);
  liqMark(el.nowBtn, task.id);
  el.nowBtn.setAttribute('aria-label', running ? t('timer.stop') : t('timer.start'));
  el.nowTime.textContent = fmtClock(taskElapsedMs(task));
  const earned = earnedOf(task);
  el.nowMoney.textContent = modeFlags().earnings && earnedShown(task, earned) ? fmtMoney(earned, currencyOf(task.projectId)) : '';
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
  const recent = listRows('recent', recentTasks(6));
  el.recentList.innerHTML = '';
  el.recentEmpty.hidden = recent.length > 0;
  // Проектов нет вовсе — весь экран из пустых островов, и начать можно только
  // с проекта: кнопка акцентная, другой акцентной на «Сегодня» нет.
  if (!recent.length) {
    emptyState(state.projects.length
      ? { art: 'timer', title: t('empty.recent_title'), text: t('home.recent_empty'), small: true }
      : {
        art: 'projects', title: t('empty.start_project'), text: t('empty.start_project_text'), small: true,
        action: { label: t('project.new_title'), onClick: () => openProjectDialog(null) },
      }, el.recentEmpty);
  }
  for (const task of recent) {
    const p = getProject(task.projectId);
    const running = !!state.activeTimer && state.activeTimer.taskId === task.id;
    const li = flipTag(document.createElement('li'), 'recent', task.id);
    li.style.setProperty('--pc', p ? p.color : PALETTE[0]);
    li.innerHTML = `<span class="rl-main"><span class="rl-name">${escapeHtml(task.title || t('task.no_name'))}</span>`
      + `<span class="rl-sub"><i class="rl-dot"></i>${escapeHtml(p ? p.name : '')} · ${escapeHtml(running ? t('task.running_now') : whenLabel(lastSessionAt(task)))}</span></span>`
      + `<button type="button" class="icon-btn rl-play${running ? ' run' : ''}" aria-label="${escapeHtml(running ? t('timer.stop') : t('timer.start'))}">${running ? SVG_STOP : SVG_PLAY}</button>`;
    const play = li.querySelector('.rl-play');
    play.addEventListener('click', (e) => { e.stopPropagation(); if (running) stopTimer(); else startTimer(task.id); });
    liqMark(play, task.id);
    li.addEventListener('click', () => openTask(task.id));
    el.recentList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------

/** Идущая задача, закреплённая первой в карточках на входе на страницу
 *  (Core.deckPinTop): запуск таймера с карточки её не переставляет. */
let deckPin = null;
/** Набранное в полях новых задач: страница перерисовывается целиком (таймер,
 *  синхронизация), и без этого текст пропадал бы на полуслове. */
const deckDrafts = new Map();
/** Порядок карточек на экране (id). Карточки стоят по свежести
 *  (Core.projectsByActivity), но, пока экран открыт, не переставляются под
 *  рукой: добавили задачу в третью карточку — она не прыгает первой.
 *  Порядок берётся заново на входе на экран (render: entering); новый проект
 *  встаёт по правилу — первым (Core.holdOrder), удалённый уходит. */
let deckOrder = null;

function renderProjects() {
  // Свежие первыми (19 октября 2026). Закрепление порядок здесь не меняет:
  // закреплённые — группа «Быстрый доступ» левой панели.
  const fresh = Core.projectsByActivity(state.projects, state.tasks);
  deckOrder = Core.holdOrder(deckOrder, fresh.map((p) => p.id));
  const byId = new Map(fresh.map((p) => [p.id, p]));
  const projects = deckOrder.map((id) => byId.get(id));
  el.homeCount.textContent = state.projects.length ? `· ${state.projects.length}` : '';
  el.homeEmpty.hidden = state.projects.length > 0;
  // Акцентная кнопка — одна на экран: пока проектов нет, она по центру.
  el.createProjectBtn.hidden = state.projects.length === 0;
  deckPin = Core.deckPinTop(deckPin, state.activeTimer);

  // Перерисовка не должна сбрасывать то, что человек трогал: ряд, прокрутку
  // списков в карточках, фокус в поле новой задачи.
  const track = el.projectsTrack;
  const left = track.scrollLeft;
  const lists = new Map([...track.querySelectorAll('.ptile')].map((n) => [n.dataset.id, n.querySelector('.ptile-tasks').scrollTop]));
  const focused = document.activeElement && document.activeElement.closest('#projects-track .ptile');
  const focusId = focused && document.activeElement.classList.contains('ptile-qa-in') ? focused.dataset.id : null;
  fillNodes(track, projects.map(projectTile));
  track.scrollLeft = left;
  for (const n of track.querySelectorAll('.ptile')) {
    if (lists.has(n.dataset.id)) n.querySelector('.ptile-tasks').scrollTop = lists.get(n.dataset.id);
    if (n.dataset.id === focusId) n.querySelector('.ptile-qa-in').focus({ preventScroll: true });
  }

  const recent = listRows('recent', recentTasks(8));
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

/** Карточка проекта — как колода на телефоне: шапка (открывает проект),
 *  «✓ готово/всего» и ближайший дедлайн его цветом, время и деньги, шкала
 *  прогресса, поле новой задачи, задачи со своей прокруткой, внизу —
 *  «Перейти в проект». */
function projectTile(p) {
  const tasks = tasksOf(p.id);
  const done = tasks.filter((t2) => t2.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const nextDue = tasks.filter((t2) => !t2.done && t2.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  const due = nextDue ? dueState(nextDue) : null;

  const tile = document.createElement('article');
  tile.className = 'ptile';
  tile.style.setProperty('--pc', p.color || PALETTE[0]);
  tile.dataset.id = p.id;
  tile.innerHTML = `
    <div class="ptile-head" role="button" tabindex="0">
      <i class="ptile-dot"></i>
      <span class="ptile-title">
        <span class="ptile-name">${escapeHtml(p.name)}</span>
        <span class="ptile-sub">${icon('check')}<span class="ptile-count">${done}/${tasks.length}</span>${nextDue ? `<span class="ptile-due ${due}">· ${escapeHtml(dueShort(nextDue))}</span>` : ''}</span>
      </span>
      <button type="button" class="ptile-menu icon-btn" aria-label="${escapeHtml(t('project.opts'))}">${icon('kebab')}</button>
      <span class="ptile-chev">${icon('chevron-right')}</span>
    </div>
    <div class="ptile-figs"><span class="ptile-time">${escapeHtml(fmtDur(projectMs(p.id)))}</span><span class="ptile-money if-money">${escapeHtml(fmtMoney(projectMoney(p.id), currencyOf(p.id)))}</span></div>
    <span class="ptile-progress"><i></i></span>
    <form class="ptile-qa">
      <input class="field ptile-qa-in" type="text" maxlength="200" placeholder="${escapeHtml(t('deck.new_ph'))}" aria-label="${escapeHtml(t('deck.new_ph'))}">
      <button type="submit" class="btn-soft">${escapeHtml(t('agenda.create_btn'))}</button>
    </form>
    <ul class="row-list ptile-tasks"></ul>
    <button type="button" class="ptile-open">${escapeHtml(t('deck.open'))}${icon('chevron-right')}</button>`;

  barFill(tile.querySelector('.ptile-progress > i'), pct, `ptile:${p.id}`);

  const head = tile.querySelector('.ptile-head');
  head.addEventListener('click', () => openProject(p.id));
  head.addEventListener('keydown', (e) => { if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProject(p.id); } });
  tile.querySelector('.ptile-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectMenu(p, e.currentTarget);
  });
  tile.querySelector('.ptile-open').addEventListener('click', () => openProject(p.id));

  // Новая задача — сразу её страница, как на телефоне.
  const input = tile.querySelector('.ptile-qa-in');
  input.value = deckDrafts.get(p.id) || '';
  input.addEventListener('input', () => deckDrafts.set(p.id, input.value));
  tile.querySelector('.ptile-qa').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    deckDrafts.delete(p.id);
    const task = newTaskOnAgenda(p.id, title);
    scheduleSave();
    selectTask(task.id);
  });

  // Как на телефоне (13 октября 2026): сверху открытые (порядок —
  // Core.deckTasks), под ними выполненные — серые и зачёркнутые, в самом низу
  // отменённые; закрытые — свежие выше. Только что отмеченная стоит, где
  // стояла, пока её держат (placedAs, «Галочка»), а рисуется настоящей.
  const list = tile.querySelector('.ptile-tasks');
  const placed = tasks.map(placedAs);
  const own = listRows(`deck:${p.id}`, Core.deckTasks(placed.filter((t2) => !isCancelledTask(t2)), deckPin));
  const finished = byFresh(placed.filter((t2) => t2.done));
  const cancelled = byFresh(placed.filter(isCancelledTask));
  if (!own.length && !finished.length && !cancelled.length) {
    // Задач нет — компактный пустой экран посередине карточки; поле новой
    // задачи прямо над ним, поэтому без кнопки.
    const empty = elt('li', 'ptile-empty');
    empty.append(emptyState({ art: 'tasks', title: t('deck.no_tasks'), text: t('empty.tasks_text'), small: true }));
    list.appendChild(empty);
  }
  for (const t2 of [...own, ...finished, ...cancelled]) list.appendChild(deckRow(getTask(t2.id) || t2));
  return tile;
}

/** Отменена ли задача: закрыта, но не выполнена — вид статуса «отменено», а
 *  без статуса — флаг задачи. Выполненная отменённой не бывает. То же
 *  правило, что isCancelled на телефоне (mobile/src/lib/statuses.js). */
function isCancelledTask(task) {
  if (!task || task.done) return false;
  const st = task.statusId ? getStatus(task.statusId) : null;
  return st ? st.kind === 'cancelled' : !!task.cancelled;
}

/** Закрытые задачи в карточке — свежеизменённые выше. */
const byFresh = (list) => list.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

/** Строка задачи в карточке: галочка, название, тихая мета (статус или
 *  «идёт сейчас», дедлайн, время), справа плей/стоп. Что показать — решает
 *  ядро (taskRowView), как в списке проекта. Отмеченная галочка наливается и
 *  брызгает, строка немного стоит и уезжает вниз, к выполненным (rowCheck,
 *  «Галочка»). Закрытая строка тише и без плея; у выполненной галочка стоит
 *  (снять — вернуть в работу), у отменённой на её месте серый крестик. */
function deckRow(task) {
  const v = Core.taskRowView(task, taskRowCtx());
  const closed = task.done ? 'done' : isCancelledTask(task) ? 'cancelled' : null;
  const li = document.createElement('li');
  li.className = 'ptile-task' + (v.running ? ' run' : '') + (closed ? ` ${closed}` : '');
  li.dataset.id = task.id;
  flipTag(li, `deck:${task.projectId}`, task.id);
  const cb = rowCheck(task);

  const main = elt('span', 'rl-main');
  main.appendChild(elt('span', 'rl-name', v.title));
  const sub = elt('span', 'rl-sub');
  const part = (cls, text) => {
    if (sub.childNodes.length) sub.appendChild(elt('span', 'ptile-sep', '·'));
    sub.appendChild(elt('span', cls, text));
  };
  if (v.running) part('ptile-running', t('task.running_now'));
  else if (v.status) {
    const st = elt('span', 'ptile-status');
    const dot = elt('i', 'st-swatch');
    dot.style.setProperty('--sc', v.status.color);
    st.append(dot, v.status.name);
    sub.appendChild(st);
  }
  if (v.due) part(`ptile-due ${v.due.state}`, v.due.text);
  if (v.running || taskElapsedMs(task) > 0) part('task-time', v.time);
  // Значок другой версии — первым в мете, без точки-разделителя за ним.
  const mark = conflictMark('task', task.id);
  if (mark) sub.prepend(mark);
  if (sub.childNodes.length) main.appendChild(sub);

  const play = elt('button', `icon-btn rl-play${v.running ? ' run' : ''}`);
  play.type = 'button';
  play.setAttribute('aria-label', t(v.running ? 'timer.stop' : 'timer.start'));
  play.innerHTML = v.running ? SVG_STOP : SVG_PLAY;
  play.addEventListener('click', (e) => {
    e.stopPropagation();
    if (v.running) stopTimer(); else startTimer(task.id);
  });
  liqMark(play, task.id);

  li.append(cb, main);
  if (!closed) li.append(play);
  li.addEventListener('click', () => selectTask(task.id));
  li.addEventListener('contextmenu', (e) => { e.preventDefault(); openTaskMenu(task, li); });
  return li;
}

/** Пока таймер идёт — время задачи и проекта на карточке ползёт само. */
function tickProjects() {
  const at = state.activeTimer;
  const task = at && getTask(at.taskId);
  if (!task) return;
  const tile = el.projectsTrack.querySelector(`.ptile[data-id="${task.projectId}"]`);
  if (!tile) return;
  const time = tile.querySelector(`.ptile-task[data-id="${task.id}"] .task-time`);
  if (time) time.textContent = fmtShort(taskElapsedMs(task));
  tile.querySelector('.ptile-time').textContent = fmtDur(projectMs(task.projectId));
  tile.querySelector('.ptile-money').textContent = fmtMoney(projectMoney(task.projectId), currencyOf(task.projectId));
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
  flipTag(row, 'recent', task.id);
  row.innerHTML = `<span class="icon-btn rl-play${running ? ' run' : ''}" role="button" tabindex="0" aria-label="${escapeHtml(running ? t('timer.stop') : t('timer.start'))}">${running ? SVG_STOP : SVG_PLAY}</span>`
    + `<span class="recent-main"><span class="recent-name">${escapeHtml(task.title || t('task.no_name'))}</span><span class="recent-sub"><i class="rl-dot" style="--pc:${escapeHtml(p ? p.color : PALETTE[0])}"></i>${escapeHtml(p ? p.name : '')}</span></span>`
    + `<span class="recent-when${running ? ' run' : ''}">${escapeHtml(running ? t('task.running_now') : whenLabel(lastSessionAt(task)))}</span>`
    + `<span class="recent-num">${escapeHtml(fmtDur(taskElapsedMs(task)))}</span>`
    + `<span class="recent-num money if-money">${escapeHtml(fmtMoney(earnedOf(task), currencyOf(task.projectId)))}</span>`;
  const play = row.querySelector('.rl-play');
  const toggle = (e) => { e.stopPropagation(); if (running) stopTimer(); else startTimer(task.id); };
  play.addEventListener('click', toggle);
  play.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  liqMark(play, task.id);
  row.addEventListener('click', () => openTask(task.id));
  return row;
}

// ---------------------------------------------------------------------------
// Поиск
// ---------------------------------------------------------------------------

function openSearch() {
  const r = el.tbSearch.getBoundingClientRect();
  el.searchPanel.style.left = `${Math.round(r.left)}px`;
  el.searchPanel.style.width = `${Math.max(320, Math.round(r.width))}px`;
  // Фокус в уже открытом поиске зовёт сюда же — это не новое открытие.
  if (el.searchPanel.hidden) usageSend('search');
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
  // Пусто — компактный пустой экран; пока слова те же (каждый следующий
  // символ мимо), он стоит на месте, а не появляется заново.
  if (!q) {
    fillEmpty(el.searchResults, { art: 'search', title: t('empty.search_start'), text: t('empty.search_start_text'), small: true });
    return;
  }
  const projects = Core.projectsByActivity(state.projects, state.tasks)
    .filter((p) => (p.name + ' ' + (p.description || '')).toLowerCase().includes(q))
    .slice(0, 6);
  const tasks = state.tasks
    .filter((t2) => (t2.title || '').toLowerCase().includes(q))
    .slice(0, 10);
  // Чаты агента (19 октября 2026) — по названию и тексту сообщений; лежат
  // только на этом устройстве, у каждого аккаунта свои (aiSearchChats).
  const chats = aiSearchChats(q);

  if (!projects.length && !tasks.length && !chats.length) {
    fillEmpty(el.searchResults, { art: 'search', title: t('search.nothing_found'), text: t('empty.search_text'), small: true });
    return;
  }
  el.searchResults.innerHTML = '';

  const addItem = (opts) => {
    const b = document.createElement('button');
    b.className = 'sr-item';
    b.innerHTML =
      (opts.icon ? `<span class="sr-icon">${icon(opts.icon)}</span>` : `<span class="sr-dot" style="background:${escapeHtml(opts.color)}"></span>`) +
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
        onClick: () => openTask(t2.id),
      });
    }
  }
  if (chats.length) {
    const g = document.createElement('div');
    g.className = 'sr-group';
    g.textContent = `${t('search.chats_group')} · ${chats.length}`;
    el.searchResults.appendChild(g);
    for (const c of chats) {
      const item = addItem({
        icon: 'comments',
        title: c.title || t('ai.new_chat'),
        sub: c.snippet,
        meta: aiChatWhen(c.updatedAt),
        onClick: () => aiShowChat(c.id),
      });
      item.dataset.chatId = c.id;
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
    calState.weekStart = new Date(Core.addDaysMs(calState.weekStart, delta * 7));
  } else {
    calState.day = new Date(Core.addDaysMs(calState.day, delta));
    calState.selected = dayKey(calState.day);
  }
  renderCalendar();
}

/** Границы текущего вида (для авто-заполнения диапазона периода). */
function currentViewBounds() {
  if (calState.mode === 'month') return [new Date(calState.year, calState.month, 1), new Date(calState.year, calState.month + 1, 0)];
  if (calState.mode === 'week') return [new Date(calState.weekStart), new Date(Core.addDaysMs(calState.weekStart, 6))];
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
 *  строка «Время» с кнопкой часов — она открывает общий выбор времени
 *  (openTimePicker) поверх окна, — и окно не закрывается по выбору дня: дата
 *  и время задаются вместе, закрывает его «Готово» или щелчок мимо.
 *  opts.onClear — ещё и кнопка «Убрать» рядом с «Готово» (дедлайн). */
function openDatePicker(anchorEl, value, onPick, opts) {
  closeTimePicker();
  dp.anchor = anchorEl;
  dp.value = value || null;
  dp.view = value ? keyToDate(value) : new Date();
  dp.onPick = onPick;
  dp.withTime = !!(opts && opts.time);
  dp.onTime = dp.withTime ? opts.onTime : null;
  dp.onClear = (opts && opts.onClear) || null;
  el.dpTime.hidden = !dp.withTime;
  if (dp.withTime) el.dpTimeBtn.textContent = opts.time;
  el.dpClear.hidden = !dp.onClear;
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
  // Выбор времени, открытый из этого окна, уходит вместе с ним.
  if (tp.open && tp.stacked) closeTimePicker();
  dp.open = false;
  el.dpPop.hidden = true;
  if (dp.anchor) dp.anchor.classList.remove('on');
  document.removeEventListener('pointerdown', dpOutside, true);
}
function dpOutside(e) {
  // Меню и выбор времени поверх окна — не «мимо».
  if (el.ctxMenu.contains(e.target) || el.tpPop.contains(e.target)) return;
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
      if (dp.withTime) renderDatePicker(); else closeDatePicker();
      if (dp.onPick) dp.onPick(key);
    });
    el.dpDays.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Выбор времени — поле и подсказки (13 октября 2026), один на все места:
// запись времени, отрезок, напоминание, дедлайн. Двух колёс «часы | минуты»
// больше нет: время вписывается руками в любом привычном виде, а под полем —
// подсказки через 15 минут на два часа в обе стороны от значения.
// ---------------------------------------------------------------------------

const TP_STEP = 15;           // шаг подсказок и стрелок, минуты
const TP_SPAN = 120;          // подсказки — на два часа в обе стороны
const TP_LAST = 24 * 60 - 1;  // 23:59
const tp = { open: false, anchor: null, value: 0, cur: 0, onPick: null, stacked: false };

/** Время, вписанное руками, — в минуты от полуночи; не разобрать — null.
 *  Понимает «9:30», «09:30», «9.30», «21.15», «9 30», «0930», «930», «9»,
 *  «21». */
function parseTimeInput(text) {
  const s = String(text == null ? '' : text).trim();
  let h;
  let m;
  const g = s.match(/^(\d{1,2})\s*[:.,\s]\s*(\d{1,2})$/);
  if (g) { h = +g[1]; m = +g[2]; }
  else if (/^\d{3,4}$/.test(s)) { const d = s.padStart(4, '0'); h = +d.slice(0, 2); m = +d.slice(2); }
  else if (/^\d{1,2}$/.test(s)) { h = +s; m = 0; }
  else return null;
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}
const tpText = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** Открывает выбор времени у anchor: поле с value ('HH:MM') и подсказки.
 *  onPick('HH:MM') зовётся один раз — когда время выбрано: Enter в поле или
 *  щелчок по подсказке. Esc и щелчок мимо закрывают без выбора. ↑/↓ — шаг
 *  15 минут по подсказкам (вниз — позже). Открытый из окна даты (дедлайн,
 *  напоминание «один раз») встаёт поверх него, окно даты остаётся. */
function openTimePicker(anchorEl, value, onPick) {
  closeTimePicker();
  tp.stacked = el.dpPop.contains(anchorEl);
  if (!tp.stacked) closeDatePicker();
  const v = parseTimeInput(value);
  tp.anchor = anchorEl;
  tp.value = v == null ? 9 * 60 : v;
  tp.cur = tp.value;
  tp.onPick = onPick;
  tp.open = true;
  anchorEl.classList.add('on');
  el.tpInput.value = tpText(tp.value);
  el.tpInput.classList.remove('bad');
  // Сначала подсказки, потом место: окно меряется уже с ними, иначе у нижнего
  // края экрана оно уходило бы за край.
  el.tpPop.hidden = false;
  renderTimePicker();
  placePopBelow(el.tpPop, anchorEl);
  el.tpInput.focus({ preventScroll: true });
  el.tpInput.select();
  setTimeout(() => document.addEventListener('pointerdown', tpOutside, true), 0);
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
/** Подсказки вокруг того, что сейчас в поле (в пределах суток): выбранное
 *  при открытии — заливкой, подсвеченное стрелками или вписанное —
 *  подложкой. Список встаёт так, чтобы текущее было посередине. */
function renderTimePicker() {
  const center = Math.min(TP_LAST - (TP_LAST % TP_STEP), Math.round(tp.cur / TP_STEP) * TP_STEP);
  const from = Math.max(0, center - TP_SPAN);
  const to = Math.min(TP_LAST, center + TP_SPAN);
  el.tpList.innerHTML = '';
  let mid = null;
  for (let min = from; min <= to; min += TP_STEP) {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = `tp-opt${min === tp.value ? ' sel' : ''}${min === tp.cur ? ' cur' : ''}`;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(min === tp.cur));
    b.dataset.min = String(min);
    b.textContent = tpText(min);
    b.addEventListener('click', () => pickTime(min));
    if (min === center) mid = b;
    el.tpList.appendChild(b);
  }
  if (mid) el.tpList.scrollTop = mid.offsetTop - (el.tpList.clientHeight - mid.offsetHeight) / 2;
}
function pickTime(min) {
  const done = tp.onPick;
  closeTimePicker();
  if (done) done(tpText(min));
}
el.tpInput.addEventListener('input', () => {
  const v = parseTimeInput(el.tpInput.value);
  el.tpInput.classList.toggle('bad', v == null && el.tpInput.value.trim() !== '');
  if (v == null) return;
  tp.cur = v;
  renderTimePicker();
});
el.tpInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const typed = parseTimeInput(el.tpInput.value);
    const base = typed == null ? tp.cur : typed;
    // С ровной четверти — на шаг; с неровной («9:07») — до ближайшей
    // четверти в ту сторону.
    const next = e.key === 'ArrowDown'
      ? Math.floor(base / TP_STEP) * TP_STEP + TP_STEP
      : Math.ceil(base / TP_STEP) * TP_STEP - TP_STEP;
    tp.cur = Math.max(0, Math.min(TP_LAST, next));
    el.tpInput.value = tpText(tp.cur);
    el.tpInput.classList.remove('bad');
    renderTimePicker();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const v = parseTimeInput(el.tpInput.value);
    if (v == null) { el.tpInput.classList.add('bad'); return; }
    pickTime(v);
  } else if (e.key === 'Escape') {
    // Закрывается только выбор времени — окно под ним (дата, запись) остаётся.
    e.preventDefault();
    e.stopPropagation();
    closeTimePicker();
  } else if (e.key === 'Tab') {
    closeTimePicker();
  }
});

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
  el.calViewTot.innerHTML = `<span>${escapeHtml(label)}</span><b>${escapeHtml(fmtDurMoney(ms, money))}</b>`;
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
    const we = new Date(Core.addDaysMs(ws, 6));
    el.calTitle.textContent = `${ws.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(Core.addDaysMs(ws, i));
      cells.push({ key: dayKey(d), day: d.getDate() });
    }
  }

  const range = calState.periodOn ? rangeBounds() : null;
  el.calDays.innerHTML = '';
  const todayKey = dayKey(new Date());
  // «Время работы» в месяце — те же плановые куски, что у недели и дня
  // (Core.slotItems), меткой в клетке: первая по началу и «+N».
  const firstKey = (cells.find(Boolean) || {}).key;
  const planFrom = firstKey ? keyToDate(firstKey).getTime() : 0;
  const plans = calState.mode === 'month' && firstKey
    ? Core.slotDayMarks(statsTasks(), planFrom, cells.filter(Boolean).length, 1) : [];
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
    if (agg) html += `<span class="cc-time">${fmtDur(agg.ms)}</span><span class="cc-money if-money">${fmtMoney(agg.money)}</span>`;
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
    const plan = plans[Core.daysBetween(planFrom, keyToDate(c.key).getTime())];
    if (plan && plan.all.length) html += calPlanMarks(plan);
    cell.innerHTML = html;
    if (agg) {
      const bar = document.createElement('i');
      bar.className = 'cc-bar';
      barFill(bar, (agg.ms / (8 * 3_600_000)) * 100, `cc:${c.key}`);
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

/** Метки «времени работы» в клетке месяца: промежуток первого куска пунктиром
 *  цвета проекта (как плановый блок недели, .ag-plan) и «+N»; подсказка —
 *  все куски дня с задачами. Сплошной текст клетки — записи времени. */
function calPlanMarks(plan) {
  const range = (p) => `${fmtTime(p.start).slice(0, 5)}–${fmtTime(p.end).slice(0, 5)}`;
  const name = (p) => { const task = getTask(p.taskId); return task ? (task.title || t('task.no_name')) : ''; };
  const tip = `${t('agenda.planned')}: ${plan.all.map((p) => `${range(p)} ${name(p)}`).join('; ')}`;
  const marks = plan.marks.map((p) =>
    `<span class="cc-plan" style="--pc:${escapeHtml(agendaProjectColor(p.projectId))}">${range(p)}</span>`).join('');
  const more = plan.more ? `<span class="cc-plan-more">+${plan.more}</span>` : '';
  return `<span class="cc-plans" title="${escapeHtml(tip)}">${marks}${more}</span>`;
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
      return `<button class="hour-chip" style="--pc:${escapeHtml(p ? p.color : PALETTE[0])}">` +
        `<b>${escapeHtml(t2.title || t('task.no_name'))}</b>` +
        `<span>${fmtTime(s.start).slice(0, 5)}–${s.end ? fmtTime(s.end).slice(0, 5) : '…'} · ${fmtDur(s.ms)}</span></button>`;
    }).join('');
    row.innerHTML = `<span class="hour-label">${pad2(h)}:00</span><div class="hour-chips">${chips}</div>`;
    row.querySelectorAll('.hour-chip').forEach((btn, i) => {
      btn.addEventListener('click', () => { const { t: t2 } = items[i]; openTask(t2.id); });
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
      // Название проекта ушло в заголовок группы — в строке оно повторялось бы.
      // Порядок — как читается: задача и длительность, под ними интервал и деньги.
      row.innerHTML = `
        <div class="cdl-task">${escapeHtml(t2.title || t('task.no_name'))}</div>
        <div class="cdl-dur">${fmtDur(s.ms)}</div>
        <div class="cdl-time">${fmtTime(s.start).slice(0, 5)}–${s.end ? fmtTime(s.end).slice(0, 5) : '…'}</div>
        <div class="cdl-money if-money">${fmtMoney(money, currencyOf(t2.projectId))}</div>`;
      row.addEventListener('click', () => openTask(t2.id));
      return row;
    }));
  }
  el.calDayTot.textContent = items.length ? fmtDurMoney(totalMs, totalMoney) : '';
  el.calDayEmpty.hidden = items.length > 0;
  if (!items.length) emptyState({ art: 'time', title: t('calendar.day_empty'), text: t('empty.day_text'), small: true }, el.calDayEmpty);
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

  el.calDayTot.textContent = tasks.length ? fmtDurMoney(totalMs, totalMoney) : '';
  el.periodBarRange.textContent = el.calDayHead.textContent;
  el.periodBarSum.textContent = fmtDurMoney(totalMs, totalMoney);
  el.calViewTot.hidden = false;
  el.calViewTot.classList.add('period');
  el.calViewTot.innerHTML = `<span>${escapeHtml(t('calendar.period_label'))}</span>`
    + `<b>${escapeHtml(fmtDurMoney(totalMs, totalMoney))}</b>`;
  el.calDayEmpty.hidden = tasks.length > 0;
  if (!tasks.length) emptyState({ art: 'time', title: t('agenda.empty'), text: t('empty.period_text'), small: true }, el.calDayEmpty);

  el.calDayList.innerHTML = '';
  for (const g of groupByProject(tasks)) {
    el.calDayList.appendChild(calGroupNode(g, ({ t: t2, ms, money }) => {
      const row = document.createElement('li');
      // Длительность над деньгами — как в записях дня.
      row.innerHTML = `
        <span class="pl-check${t2.done ? ' done' : ''}">${icon('check')}</span>
        <span><span class="pl-name">${escapeHtml(t2.title || t('task.no_name'))}</span></span>
        <span class="pl-right"><span class="pl-time">${fmtDur(ms)}</span><span class="pl-money if-money">${fmtMoney(money, currencyOf(t2.projectId))}</span></span>`;
      row.addEventListener('click', () => openTask(t2.id));
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
  // Доска — вкладка проекта, так что без проекта её не открыть; пустого
  // экрана «Сначала создайте проект» поэтому нет (опись пустых экранов, № 23).
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
    ${icon('chevron-down', 'icon lane-chev')}
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
    x.title = t('tag.remove');
    x.setAttribute('aria-label', t('tag.remove'));
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
    // Без кнопки: строка «Новый тег» стоит сразу под ним.
    const empty = emptyState({ art: 'tags', title: t('empty.tags_title'), text: t('tag.empty_hint'), small: true });
    empty.classList.add('tags-empty');
    el.tagsList.appendChild(empty);
    return;
  }
  for (const tag of globalTags) {
    const u = tagUsage(tag.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'srow';
    row.dataset.id = tag.id;
    row.innerHTML = `<span class="tag-dot" style="--sc:${escapeHtml(tag.color || PALETTE[0])}"></span>`
      + `<span class="srow-label">${escapeHtml(tag.name || '')}</span>`
      + `<span class="srow-box"><span class="srow-value">${escapeHtml(tagUsageLabel(u))}</span></span>${icon('chevron-right', 'icon srow-chev')}`;
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
  // Собственный тег проекта — часть проекта: завели, переименовали,
  // перекрасили — проект свежий (как на телефоне). Общий тег — ничей.
  if (tagdlg.projectId) touchProject(tagdlg.projectId);
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
  if (tag.projectId) touchProject(tag.projectId);
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
        + `<span class="tag-pop-scope">${Core.isGlobalTag(tag) ? escapeHtml(t('tag.scope_global')) : ''}</span>`;
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
      // В строку: тег создаётся из поля над списком.
      const empty = emptyState({ art: 'tags', title: t('tag.none'), text: t('empty.tag_pick_text'), row: true });
      empty.classList.add('tag-pop-empty');
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
      <button type="button" class="st-color" style="--sc:${escapeHtml(st.color)}" data-act="color" data-i18n-title="project.color" title="Цвет"></button>
      <input class="field-sm st-name" type="text" value="${escapeHtml(st.name)}" data-i18n-ph="status.name_ph" placeholder="Название" />
      <button type="button" class="dp-btn st-kind" data-act="kind">${escapeHtml(t(`status.kind_${st.kind}`))}</button>
      <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} data-i18n-title="common.back" title="Выше">
        ${icon('chevron-up')}
      </button>
      <button type="button" class="icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} data-i18n-title="common.forward" title="Ниже">
        ${icon('chevron-down')}
      </button>
      <button type="button" class="icon-btn st-del" data-act="del" data-i18n-title="common.delete" title="Удалить">
        ${icon('trash')}
      </button>`;

    row.querySelector('.st-name').addEventListener('input', (e) => {
      st.name = e.target.value;
      touchProject(st.projectId);
      scheduleSave();
    });
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'color') { openColorPicker(b, (c) => { st.color = c; touchProject(st.projectId); renderStatusDialog(); scheduleSave(); }); return; }
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
            touchProject(st.projectId);
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
        touchProject(st.projectId);
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
  touchProject(pid);
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
  touchProject(pid);
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
    dueAt: null, reminders: [], remindOffsetMin: null, remindAt: null, notifiedAt: null,
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
    <div class="bc-title">${conflictMarkHtml('task', task.id)}${escapeHtml(task.title || t('task.no_name'))}</div>
    ${chips ? `<div class="tag-chips bc-tags">${chips}</div>` : ''}
    <div class="bc-foot">
      <span class="bc-time">${icon('clock')} ${fmtDur(taskElapsedMs(task))}</span>
      <span class="bc-money if-money">${escapeHtml(fmtMoney(earnedOf(task), currencyOf(task.projectId)))}</span>
      ${due ? `<span class="task-due ${due}">${escapeHtml(dueShort(task))}</span>` : ''}
    </div>`;
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  // Клик по карточке открывает задачу её страницей — доска для раскладки, а
  // редактор всё равно один. Раньше тут стояло «вид — проект, выбрана задача»:
  // со времён, когда задача жила справа от списка. С 6 октября доска —
  // вкладка проекта, и тот же вид просто перерисовывал доску, не открывая
  // ничего.
  card.addEventListener('click', () => selectTask(task.id));
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); openTaskMenu(task, card); });
  return card;
}

const projectTab = () => (['board', 'versions', 'docs'].includes(state.ui.projectTab) ? state.ui.projectTab : 'list');

/** Экран проекта: шапка и одна из трёх вкладок. */
function renderProjectPage() {
  renderProjectHeader();
  const tab = projectTab();
  el.projTabs.forEach((b) => b.classList.toggle('on', b.dataset.ptab === tab));
  el.projList.hidden = tab !== 'list';
  el.projBoard.hidden = tab !== 'board';
  el.projVersions.hidden = tab !== 'versions';
  el.projDocs.hidden = tab !== 'docs';
  if (tab === 'list') {
    renderSidebar();
    renderProjectSide();
  } else if (tab === 'board') {
    renderBoardPage();
  } else if (tab === 'docs') {
    renderProjectDocs();
  } else {
    renderVersionsTab();
  }
}

/** Документы проекта, свежие сверху (закреплённые — первыми, как в разделе). */
function docsOfProject(pid) {
  return Core.sortDocuments((state.documents || []).filter((d) => d.projectId === pid));
}

/** Открыть документ проекта: раздел «Документы» с фильтром по этому проекту
 *  — рядом в списке окажутся его соседи, а не все документы подряд. */
function openProjectDoc(d) {
  docFilter = d.projectId || 'all';
  docQuery = '';
  if (el.docSearch) el.docSearch.value = '';
  openDocs(d.id);
}

/** Вкладка «Документы» проекта — те же строки .doc-item, что в разделе. */
function renderProjectDocs() {
  const pid = state.ui.projectId;
  const list = docsOfProject(pid);
  el.pdocList.textContent = '';
  for (const d of list) {
    const st = Core.docStats(Core.readNotes(d.body).doc);
    const b = elt('button', 'doc-item pdoc-item');
    b.type = 'button';
    b.dataset.id = d.id;
    b.append(
      elt('span', 'doc-item-title', docTitle(d)),
      elt('span', 'doc-item-meta', `${t('docs.words_n', { n: st.words })} · ${fmtWhenShort(d.updatedAt)}`),
    );
    b.addEventListener('click', () => openProjectDoc(d));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openDocMenu(d, b); });
    el.pdocList.appendChild(b);
  }
  el.pdocEmpty.hidden = list.length > 0;
  // Пока документов нет, создают их кнопкой по центру — «Новый документ» в
  // шапке вкладки её не повторяет.
  el.pdocNew.hidden = !list.length;
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
  el.ptabDocCount.textContent = docsOfProject(p.id).length || '';

  const tasks = visibleTasks();
  el.projectEarned.textContent = '';
  if (tasks.length) {
    const done = tasks.filter((t2) => t2.done).length;
    el.projectEarned.append(
      elt('b', null, fmtDur(projectMs(p.id))),
      elt('b', 'kpi-money if-money', fmtMoney(projectMoney(p.id), currencyOf(p.id))),
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
    barFill(seg, (n / tasks.length) * 100, `pp:${pid}:${st.id}`);
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
        + '<span class="pv-bar"><i></i></span>';
      barFill(row.querySelector('.pv-bar i'), r.total ? Math.round((r.done / r.total) * 100) : 0, `pv:${r.id}`);
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

/** Проекты в левом меню: закреплённые — своей группой «Быстрый доступ» над
 *  остальными, в порядке закрепления; остальные — по свежести
 *  (Core.projectsByActivity, 19 октября 2026). Рядом — сколько задач ещё не
 *  готово. */
function renderNavProjects() {
  const pinned = state.projects.filter((p) => p.pinnedAt).sort(byPinned);
  const rest = Core.projectsByActivity(state.projects.filter((p) => !p.pinnedAt), state.tasks);
  el.navPinnedHead.hidden = el.navPinned.hidden = pinned.length === 0;
  el.navPinned.replaceChildren(...pinned.flatMap(navProjectItems));
  el.navProjects.replaceChildren(...rest.flatMap(navProjectItems));
}

const NAV_DOCS_MAX = 6;

/** Строка проекта в левом меню, а под открытым проектом — его документы
 *  (круг 5): свежие, не больше шести, дальше — «Ещё N» на вкладку проекта. */
function navProjectItems(p) {
  const items = [navProjectItem(p)];
  const cur = getDocument(state.ui.docId);
  const open = ((state.ui.view === 'project' || state.ui.view === 'task') && state.ui.projectId === p.id)
    || (state.ui.view === 'docs' && cur && cur.projectId === p.id);
  if (!open) return items;
  const docs = docsOfProject(p.id);
  for (const d of docs.slice(0, NAV_DOCS_MAX)) {
    const b = elt('button', 'nav-item nav-doc');
    b.type = 'button';
    b.title = docTitle(d);
    b.classList.toggle('active', state.ui.view === 'docs' && state.ui.docId === d.id);
    b.innerHTML = icon('doc');
    b.append(elt('span', 'nav-label', docTitle(d)));
    b.addEventListener('click', () => openProjectDoc(d));
    items.push(b);
  }
  if (docs.length > NAV_DOCS_MAX) {
    const more = elt('button', 'nav-item nav-doc nav-doc-more');
    more.type = 'button';
    more.append(elt('span', 'nav-label', t('docs.more_n', { n: docs.length - NAV_DOCS_MAX })));
    more.addEventListener('click', () => { openProject(p.id); state.ui.projectTab = 'docs'; render(); scheduleSave(); });
    items.push(more);
  }
  return items;
}

function navProjectItem(p) {
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
  return b;
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
  // Версий нет — пустой экран вместо строк: одна строка «Без версии» со всеми
  // задачами проекта ничего не говорила бы.
  const none = !versionsOf(pid).length;
  el.pverEmpty.hidden = !none;
  if (none) return;
  for (const r of rows) {
    const li = elt('li', 'pver-row' + (r.released ? ' released' : ''));
    const head = elt('div', 'pver-head');
    head.append(
      elt('span', 'pver-name', r.id ? (r.name || t('task.no_name')) : t('version.none')),
      elt('span', 'pver-state', r.id ? (r.released ? t('version.released_on', { date: fmtDateShort(r.releasedAt) }) : t('version.in_progress')) : ''),
    );
    const bar = elt('div', 'pver-bar');
    const fill = elt('span', 'pver-fill');
    barFill(fill, r.total ? Math.round((r.done / r.total) * 100) : 0, `pver:${pid}:${r.id || 'none'}`);
    bar.appendChild(fill);
    const meta = elt('div', 'pver-meta');
    meta.append(
      elt('span', null, t('project.done_of', { done: r.done, total: r.total })),
      elt('span', null, fmtDur(r.ms)),
      elt('b', 'kpi-money if-money', fmtMoney(r.money, currencyOf(pid))),
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


/** «Показать все» у отбора, который ничего не оставил: статус «Все» и любая
 *  версия — как при открытии проекта. */
function showAllTasks() {
  taskFilter = { status: 'all', versionId: 'all' };
  render();
}

function renderSidebar() {
  el.tfStatus.forEach((b) => b.classList.toggle('on', b.dataset.status === taskFilter.status));
  renderTaskVersionFilter();
  el.taskList.innerHTML = '';

  // Группы — по статусам в порядке столбцов доски, закреплённые сверху;
  // решает ядро (projectListGroups). Фильтр сужает задачи, группы остаются.
  const list = isFilterActive() ? filteredProjectTasks() : visibleTasks();
  // Пусто: задач нет совсем — большой пустой экран и «Новая задача» (та же,
  // что «+ Задача» в шапке, поэтому тихая); фильтр ничего не оставил —
  // компактный и «Показать все». Заголовки колонок на это время прячет CSS.
  el.sidebarEmpty.hidden = list.length > 0;
  if (!list.length) {
    emptyState(visibleTasks().length
      ? {
        art: 'filter', title: t('empty.filter_title'), text: t('empty.filter_text'), small: true,
        action: { label: t('empty.show_all'), soft: true, icon: 'eye', onClick: showAllTasks },
      }
      : {
        art: 'tasks', title: t('deck.no_tasks'), text: t('empty.project_tasks_text'),
        action: { label: t('empty.new_task'), soft: true, onClick: () => el.newTaskBtn.click() },
      }, el.sidebarEmpty);
  }

  const groups = Core.projectListGroups(list.map(placedAs), {
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
  // Заголовки едут вместе со строками, когда отмеченная уходит в другую группу.
  flipTag(li, `list:${state.ui.projectId}`, `group:${g.key}`, true);
  const chev = elt('span', 'tg-chev');
  // Пустая колонка «срок» между именем и суммами — её занимает сетка.
  chev.innerHTML = icon('chevron-down');
  const dot = elt('span', 'tg-dot');
  if (g.status) dot.style.background = g.status.color;
  else dot.hidden = true;
  const main = elt('span', 'tg-main');
  main.append(dot, elt('span', 'tg-name', g.status ? g.status.name : t('sep.pinned')), elt('span', 'tg-count', String(g.tasks.length)));
  const money = g.tasks.reduce((a, t2) => a + earnedOf(t2), 0);
  li.append(
    chev, main,
    elt('span', 'tg-time', fmtShort(g.ms)),
    elt('span', 'tg-money if-money', money ? fmtMoney(money, currencyOf(state.ui.projectId)) : ''),
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
  // Группы раскладывают задачу по placedAs (только что отмеченная — по себе
  // до нажатия), а строка рисует настоящую.
  task = getTask(task.id) || task;
  const v = Core.taskRowView(task, taskRowCtx());

  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;
  li.style.animationDelay = `${Math.min(i, 12) * 16}ms`;
  flipTag(li, `list:${task.projectId}`, task.id, true);
  if (v.selected) li.classList.add('selected');
  if (v.done) li.classList.add('done');
  if (isCancelledTask(task)) li.classList.add('cancelled');
  if (v.pinned) li.classList.add('pinned');

  const cb = rowCheck(task);

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
  const mark = conflictMark('task', task.id);
  if (mark) meta.prepend(mark);

  // Колонки: галочка · название с метой · срок · время · деньги.
  const main = elt('div', 'ti-main');
  const top = elt('div', 'ti-top');
  top.append(name, pin);
  if (v.tags.length) meta.prepend(dots);
  main.append(top, meta);
  const due = elt('span', 'ti-due' + (v.due ? ` ${v.due.state}` : ''), v.due ? v.due.text : '');
  if (v.due) due.title = v.due.text;
  const money = earnedOf(task);
  li.append(cb, main, due, elt('span', 'task-time', v.time), elt('span', 'ti-money if-money', money ? fmtMoney(money, currencyOf(task.projectId)) : ''));
  li.addEventListener('click', () => selectTask(task.id));
  li.addEventListener('contextmenu', (e) => { e.preventDefault(); openTaskMenu(task, li); });
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
  ringBell(unread);
}

/** Сколько непрочитанных было при прошлой отрисовке; null — ещё не рисовали. */
let bellUnread = null;

/** Колокольчик звенит, когда непрочитанных стало больше (и при запуске, если
 *  они есть): три коротких звона с паузой — в styles.css. Прочитали — молчит. */
function ringBell(unread) {
  const prev = bellUnread;
  bellUnread = unread;
  const btn = el.notifBtn;
  if (!unread) { btn.classList.remove('ring'); return; }
  if (prev !== null && unread <= prev) return;
  if (reducedMotion()) return;
  restartClass(btn, 'ring');
}
el.notifBtn.addEventListener('animationend', (e) => {
  if (e.animationName === 'bellRing') el.notifBtn.classList.remove('ring');
});

/** Подпись справа у записи ленты. У отрезка «времени работы» — его часы, у
 *  напоминания без дедлайна рядом («один раз», «повторять», голое) — момент
 *  срабатывания, у остальных — срок. Дата добавляется, только если это не
 *  сегодня. */
function notifWhen(n) {
  const clock = (ms) => fmtTime(ms).slice(0, 5);
  const day = (ms) => (Core.startOfDayMs(ms) === Core.startOfDayMs(Date.now()) ? '' : `${fmtDateShort(ms)}, `);
  if (n.kind === 'slot') return `${day(n.due)}${clock(n.due)}–${clock(n.end)}`;
  if (!n.task.dueAt || (n.kind === 'reminder' && n.due === null)) return `${day(n.at)}${clock(n.at)}`;
  return dueShort(n.task);
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
      + `<span class="notif-when ${when}">${escapeHtml(notifWhen(n))}</span>`;
    li.dataset.key = n.key;
    li.addEventListener('click', () => { closeNotifPanel(); openTask(n.task.id); });
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
  usageSend('notifications');
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

/** Слова системного уведомления о сработавшем напоминании: «Через 15 мин
 *  начало: …», «Дедлайн через 1 ч: …», «Напоминание: …». Для «до начала» в
 *  теле уведомления — часы вхождения. */
function remindNotice(task, item) {
  const title = task.title || t('task.no_name');
  const rem = Core.remindersOf(task).find((r) => r.id === item.reminderId);
  const d = rem ? Core.describeReminder(rem) : null;
  if (!d || d.kind !== 'before') return { text: t('notif.reminder_text', { title }), body: '' };
  const side = d.anchor === 'start' ? 'start' : 'due';
  const text = d.offsetMin === 0
    ? t(`notif.at_${side}`, { title })
    : t(`notif.before_${side}`, { n: d.n, unit: remindUnit(d.unit, d.n), title });
  return { text, body: side === 'start' ? `${hhmm(item.start)}–${hhmm(item.end)}` : '' };
}

/** Раз в полминуты проверяем, не пора ли напомнить (core/reminders.js).
 *  Отметка «уже напомнили» пишется в само напоминание задачи и
 *  синхронизируется, поэтому второе устройство про это же вхождение молчит. */
function checkReminders() {
  const now = Date.now();
  let fired = false;
  // Сначала возвращаем задачи, чей день настал: открытая задача и напоминать
  // может, закрытая — нет.
  const reopened = reopenDueTasks(now);
  for (const item of Core.remindersDue(state.tasks, now)) {
    const task = getTask(item.taskId);
    const patch = task && Core.markFired(task, item);
    if (!patch) continue;
    const notice = remindNotice(task, item);
    Object.assign(task, patch);
    task.updatedAt = new Date().toISOString();
    fired = true;
    notifyOS(notice.text, notice.body);
  }
  if (fired || reopened) scheduleSave();
  if (reopened) render();
  renderNotifBadge();
}

function renderDue(task) {
  // «Другая версия ›» — первой строкой свойств, если у задачи есть конфликт.
  renderTaskConflicts(task);
  // Повторение считается от дедлайна: появился или исчез срок — строка
  // повторения должна это заметить.
  renderTaskRepeat(task);
  renderTaskSlots(task);
  renderTaskReminders(task);
  // Строка «Дедлайн · 12 июн. 2026, 18:00 ›»: заданный срок — жирным и цветом
  // своего состояния (просрочен, в пределах суток), как в строках задач.
  const has = !!task.dueAt;
  const due = has ? new Date(task.dueAt) : null;
  const st = has ? dueState(task) : null;
  el.dueValue.textContent = has ? `${fmtDpBtn(dayKey(due))}, ${pad2(due.getHours())}:${pad2(due.getMinutes())}` : t('due.none');
  el.dueValue.className = `srow-value${has ? ' set' : ''}${st === 'soon' || st === 'overdue' ? ` ${st}` : ''}`;
  el.dueValue.title = st === 'soon' || st === 'overdue' ? dueShort(task) : '';
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

/** Статус задачи — чипами (как на телефоне): весь короткий список статусов
 *  проекта на виду, выбранный отмечен. Щелчок ставит статус сразу. */
function renderTaskStatus(task) {
  el.taskStatuses.innerHTML = '';
  for (const st of orderedStatuses(task.projectId)) {
    const on = st.id === task.statusId;
    const chip = elt('button', `dp-btn${on ? ' on' : ''}`);
    chip.type = 'button';
    chip.dataset.statusId = st.id;
    chip.setAttribute('aria-pressed', String(on));
    const dot = elt('i', 'st-swatch');
    dot.style.setProperty('--sc', st.color);
    chip.append(dot, elt('span', 'tp-chip-name', st.name));
    chip.addEventListener('click', () => {
      if (task.statusId === st.id) return;
      setTaskStatus(task, st.id);
      render();
      scheduleSave();
    });
    el.taskStatuses.appendChild(chip);
  }
}

/** Ставка задачи словами — значение строки «Ставка»: своя — «5 000 ₽/ч»,
 *  иначе откуда она берётся — «как у проекта — …» или «общая — …». */
function rateValueText(task) {
  const perHour = (n) => `${fmtMoney(n, currencyOf(task.projectId))}${t('rate.per_hour')}`;
  if (hasOwnRate(task)) return perHour(Number(task.rate));
  const base = Core.baseRate(task, rates());
  const p = getProject(task.projectId);
  if (p && p.rate !== null && p.rate !== undefined && p.rate !== '') return t('task.rate_project', { rate: perHour(base) });
  return base ? t('rate.shared', { rate: perHour(base) }) : t('rate.none');
}

function renderMoney(task) {
  el.rateValue.textContent = rateValueText(task);
}

function renderTimer(task) {
  const running = state.activeTimer && state.activeTimer.taskId === task.id;
  el.timerDisplay.textContent = fmtClock(taskElapsedMs(task));
  // Заработанное — справа от времени, по его нижнему краю, без подписи:
  // рядом с часами сумма читается сама. Растёт вместе с идущим таймером.
  const earned = earnedOf(task);
  el.timerEarned.hidden = !earnedShown(task, earned);
  el.timerEarned.textContent = fmtMoney(earned, currencyOf(task.projectId));
  setPlayIcon(el.timerBtnIcon, running);
  el.timerBtnLabel.textContent = running ? t('timer.stop') : t('timer.start');
  el.timerBtn.setAttribute('aria-label', running ? t('timer.stop') : t('timer.start'));
  el.timerBtn.classList.toggle('run', !!running);
  liqMark(el.timerBtn, task.id);
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

/** Открыть задачу откуда угодно — с «Сегодня», из поиска, уведомлений,
 *  календаря, капсулы таймера, окна задачи — одним шагом истории. Раньше эти
 *  места звали openProject и selectTask подряд: каждый рисовал экран, и в
 *  истории вставали две записи — проект и задача. «Назад» с задачи вело в её
 *  проект, где человек не был, и только второе «назад» — туда, откуда пришёл.
 *  Фильтр списка проекта сбрасывается, как при входе в проект: задача должна
 *  быть видна в нём, когда вернёмся к проекту. */
function openTask(id) {
  const task = getTask(id);
  if (!task) return;
  closeSearch();
  if (state.ui.view === 'task' && selectedId === id) { closeMenu(); return; }
  taskFilter = { status: 'all', versionId: 'all' };
  selectTask(id);
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

/** Дублировать задачу: всё, кроме записей времени и отметки «выполнено» (см.
 *  core/duplicate.js). Копия встаёт в список сразу за оригиналом и
 *  открывается. */
function duplicateTask(id) {
  const task = getTask(id);
  if (!task) return;
  flushEditor();
  const copy = Core.duplicateTask(state, id, { uid, now: new Date().toISOString(), suffix: t('docs.copy_suffix') });
  if (!copy) return;
  state.tasks.splice(state.tasks.indexOf(task) + 1, 0, copy);
  selectTask(copy.id);
}

/** Меню задачи — правой кнопкой по строке списка, карточке доски и строке
 *  в карточке проекта, и кнопкой «⋯» на странице задачи (opts — как у
 *  openMenu: у кнопки повторный щелчок закрывает меню). */
function openTaskMenu(task, anchor, opts) {
  openMenu(anchor, [
    { label: t(task.pinnedAt ? 'task.unpin_short' : 'task.pin_short'), onClick: () => togglePinTask(task.id) },
    { label: t('task.duplicate'), icon: 'copy', onClick: () => duplicateTask(task.id) },
    { label: t('link.copy'), icon: 'link', onClick: () => copyRouteLink({ view: 'task', id: task.id }) },
    { sep: true },
    { label: t('task.delete_title'), danger: true, onClick: () => deleteTask(task.id) },
  ], opts);
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
    // Страницы задачи больше нет — её запись в истории занимает проект:
    // иначе «назад» с проекта вело бы на удалённую задачу, а оттуда — на
    // «Сегодня».
    if (state.ui.view === 'task') { state.ui.view = 'project'; routeReplaceNext = true; }
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
    // Уходим, только если стояли в самом проекте или его задаче, — и на
    // «Проекты», где он был в списке, заменой записи: страницы больше нет.
    // Раньше удаление из меню карточки на «Проектах» уводило на «Сегодня»,
    // если этот проект открывали когда-то раньше.
    if (['project', 'task'].includes(state.ui.view)) { state.ui.view = 'projects'; routeReplaceNext = true; }
    state.ui.projectId = state.projects[0] ? state.projects[0].id : null;
    selectedId = null;
    loadEditor(null);
  }
  render();
  scheduleSave();
}

/** Дублировать проект: настройки, статусы, версии, теги проекта, все задачи и
 *  документы — всё, кроме записей времени. Что и как копируется, решает ядро
 *  (core/duplicate.js); здесь копия встаёт в список сразу за оригиналом и
 *  открывается. Уйдёт в облако вместе со всем остальным: синхронизация шлёт
 *  состояние целиком, отдельных записей у неё нет. */
function duplicateProject(id) {
  const p = getProject(id);
  if (!p) return;
  flushEditor(); // текст открытой задачи ещё может сидеть в редакторе
  const copy = Core.duplicateProject(state, id, { uid, now: new Date().toISOString(), suffix: t('docs.copy_suffix') });
  if (!copy) return;
  state.projects.splice(state.projects.indexOf(p) + 1, 0, copy.project);
  state.statuses.push(...copy.statuses);
  state.versions.push(...copy.versions);
  state.tags.push(...copy.tags);
  state.tasks.push(...copy.tasks);
  state.documents.push(...copy.documents);
  seedProjectStatuses(copy.project.id); // у оригинала статусов не было — набор по умолчанию, как у нового
  openProject(copy.project.id);
}

async function copyProjectSummary(p) {
  const tasks = tasksOf(p.id);
  const done = tasks.filter((t2) => t2.done).length;
  const n = tasks.length;
  const parts = [p.name, fmtDur(projectMs(p.id)), `${n} ${pluralForm(n, 'plural.task')}, ${done} ${t('xlsx.done').toLowerCase()}`];
  const money = projectMoney(p.id);
  if (money > 0 && modeFlags().money) parts.push(fmtMoney(money, currencyOf(p.id)));
  try { await window.api.copy(parts.join(' · ')); toast(t('toast.summary_copied')); }
  catch { toast(t('toast.copy_failed')); }
}

// ---------------------------------------------------------------------------
// Плавающее меню
// ---------------------------------------------------------------------------

let menuCleanup = null;
/** opts.compact — узкий короткий список с прокруткой (часы, минуты).
 *  opts.toggle — кнопка-выпадашка: повторный щелчок по ней закрывает меню, а
 *  не открывает его заново. Без этого нажатие снаружи закрывало меню, а тот
 *  же щелчок по кнопке тут же открывал его снова. Меню, вызванные правой
 *  кнопкой на строке, флаг не берут: щелчок по такой строке должен её
 *  открыть.
 *  opts.width — ширина меню в пикселях (обычно ширина кнопки): названия,
 *  которые в неё не помещаются, обрезаются многоточием.
 *  opts.refresh — для пунктов-галочек (keep): возвращает список пунктов
 *  заново, уже с новым выбором; им меню перерисовывается на месте.
 *  Пункт: label, onClick, danger, selected, dot (цвет кружка) и icon — имя
 *  значка из core/icons.js; он стоит справа, на месте галочки выбранного, —
 *  так подписи остаются в один столбец у пунктов со значком и без него.
 *  keep — мультивыбор: клик не закрывает меню (см. opts.refresh). */
function openMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = el.ctxMenu;
  m.innerHTML = '';
  m.classList.toggle('compact', !!opts.compact);
  // Меню шириной с кнопку: длинные названия в нём не тянут его вширь, а
  // обрезаются многоточием (#ctx-menu.fit).
  m.classList.toggle('fit', !!opts.width);
  m.style.width = opts.width ? `${opts.width}px` : '';
  const fill = (list) => {
    m.innerHTML = '';
    list.forEach((it, i) => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); return; }
      const b = document.createElement('button');
      b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.selected ? ' sel' : '');
      const dot = it.dot ? `<span class="ctx-dot" style="--sc:${escapeHtml(it.dot)}"></span>` : '';
      b.innerHTML = `<span class="ctx-main">${dot}<span class="ctx-label">${escapeHtml(it.label)}</span></span>` +
        (it.selected ? icon('check', 'icon ctx-check') : '') +
        (it.icon ? icon(it.icon, 'icon ctx-icon') : '');
      b.addEventListener('click', () => {
        if (!it.keep) { closeMenu(); it.onClick(); return; }
        // Пункт-галочка: меню остаётся, выбор рисуется заново — клик по «Все
        // проекты» меняет и соседей. Прокрутка и фокус остаются на месте.
        const top = m.scrollTop;
        const focused = document.activeElement === b;
        it.onClick();
        if (opts.refresh) fill(opts.refresh());
        m.scrollTop = top;
        if (focused && m.children[i]) m.children[i].focus({ preventScroll: true });
      });
      m.appendChild(b);
    });
  };
  fill(items);
  m.hidden = false;
  m.scrollTop = 0;
  const sel = m.querySelector('.ctx-item.sel');
  if (sel) m.scrollTop = sel.offsetTop - (m.clientHeight - sel.offsetHeight) / 2;
  const r = anchor.getBoundingClientRect();
  const x = Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8);
  let y = r.bottom + 4;
  if (y + m.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - m.offsetHeight - 4);
  m.style.left = `${Math.max(8, x)}px`;
  m.style.top = `${y}px`;
  anchor.classList.add('open');
  // У кнопки-выпадашки нажатие закрывать не надо: меню закроет её же щелчок
  // (onAnchorClick), и тот не дойдёт до её обработчика, который открыл бы меню
  // заново.
  const onDown = (e) => {
    if (m.contains(e.target) || (opts.toggle && anchor.contains(e.target))) return;
    closeMenu();
  };
  const onAnchorClick = (e) => {
    if (!anchor.contains(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    closeMenu();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  // Прокрутка страницы закрывает меню, а своя — нет: длинный список
  // прокручивается внутри.
  const onScroll = (e) => { if (e.target !== m) closeMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    if (opts.toggle) document.addEventListener('click', onAnchorClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMenu);
  }, 0);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onAnchorClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', closeMenu);
    anchor.classList.remove('open');
  };
}
/** Ширина меню выбора проекта: как у кнопки, но не уже 220 и не шире 320 px.
 *  Без этого меню тянулось по самому длинному названию проекта («километровое»
 *  под узкой кнопкой фильтра); теперь длинное кончается многоточием
 *  (#ctx-menu.fit), а цветная точка остаётся на месте. */
function pickerWidth(anchor) {
  return Math.min(320, Math.max(220, Math.round(anchor.getBoundingClientRect().width)));
}

function closeMenu() {
  el.ctxMenu.hidden = true;
  if (menuCleanup) { menuCleanup(); menuCleanup = null; }
}

function openProjectMenu(p, anchor) {
  const inProject = state.ui.view === 'project' && state.ui.projectId === p.id;
  const items = [];
  if (!inProject) items.push({ label: t('project.open'), onClick: () => openProject(p.id) });
  // «Редактировать…» и «Статусы и версии» убраны 13 октября 2026: настройки
  // проекта — шестерёнкой в его шапке и на доске.
  // Закреплённый проект встаёт в левое меню группой «Быстрый доступ».
  items.push({ label: t(p.pinnedAt ? 'project.unpin' : 'project.pin'), onClick: () => togglePinProject(p.id) });
  items.push({ label: t('project.duplicate'), icon: 'copy', onClick: () => duplicateProject(p.id) });
  items.push({ label: t('link.copy'), icon: 'link', onClick: () => copyRouteLink({ view: 'project', id: p.id }) });
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
 *  @param {string} [sec] — к какому разделу сразу прокрутить: main, money,
 *  tags, versions, statuses. Окно одно, разделы лежат в нём одним списком;
 *  у нового проекта есть только первые два. */
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
  if (project) renderConflictRow(el.pdlgConflicts, 'project', project.id);
  else el.pdlgConflicts.hidden = true;
  renderPdlgSections();
  if (el.pdlgBackdrop.hidden) usageSend(project ? 'project.settings' : 'project.new');
  el.pdlgBackdrop.hidden = false;
  el.pdlgBody.scrollTop = 0;
  if (!sec || sec === 'main') { el.pdlgName.focus(); el.pdlgName.select(); return; }
  // Прокрутка — по offsetTop, а не по рамке: окно ещё въезжает с масштабом.
  const target = document.getElementById(`pdlg-sec-${sec}`);
  if (target && !target.hidden) el.pdlgBody.scrollTop = target.offsetTop;
}

/** Разделы окна проекта — все сразу, одним списком (как на телефоне).
 *  Теги, версии и статусы — только у существующего: новому проекту они
 *  появятся после создания, а пока вместо них — подсказка. */
function renderPdlgSections() {
  const has = !!pdlg.editing;
  for (const name of ['tags', 'versions', 'statuses']) document.getElementById(`pdlg-sec-${name}`).hidden = !has;
  renderPdlgMoney();
  if (!has) return;
  renderPdlgTagList();
  renderVersionDialog();
  renderStatusDialog();
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
    // В строку: «Новый тег проекта» стоит сразу под ним.
    const empty = emptyState({ art: 'tags', title: t('tag.project_empty'), text: t('empty.project_tags_text'), row: true });
    empty.classList.add('tags-empty');
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
  if (!name) { el.pdlgBody.scrollTop = 0; el.pdlgName.focus(); return; }
  const description = el.pdlgDesc.value.trim();
  const rateText = el.pdlgRate.value.trim();
  const rate = rateText === '' ? null : parseNum(rateText);
  const fields = { name, description, color: pdlg.color, tagIds: pdlg.tagIds.slice(), rate, currency: pdlg.currency };
  if (pdlg.editing) {
    Object.assign(pdlg.editing, fields, { updatedAt: new Date().toISOString() });
    closeProjectDialog();
    render();
    scheduleSave();
  } else {
    const now = new Date().toISOString();
    const p = { id: uid(), createdAt: now, updatedAt: now, pinnedAt: null, ...fields };
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
  // Следующий день — по календарю: в день перевода часов «плюс 24 часа»
  // промахивается на час, и запись 23:30–00:30 схлопывалась бы в ноль.
  if (end <= start) end = new Date(dparts[0], dparts[1] - 1, dparts[2] + 1, ep[0], ep[1]);
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
//
// «Личное» (core/modes.js): денег в выгрузке нет. Ядро получает money: false
// и собирает листы сразу без колонок «Ставка» и «Сумма» и без строк «ставка» и
// «заработано» — вырезать их из готовых листов не нужно, и формулы в таких
// листах уже на своих местах.
const reportsFor = (projectId) => Core.makeReports({
  money: modeFlags().money,
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
/** Окно «Экспорт в Excel»: период и проекты — двумя выпадашками, под ними
 *  сводка того, что уйдёт в файл. Правила — в core/export.js: что значит
 *  период, как отмечаются проекты, сколько записей наберётся. Здесь только
 *  окно и сборка листов.
 *
 *  «Всё время» уходит в сводку по проектам (buildAllProjectsSheets: итоги и
 *  по листу на проект), остальные периоды — в один лист сессий
 *  (buildPeriodSheets), как решает onExportRange на телефоне.
 *
 *  Период помнится между открытиями, проекты — нет: они берутся с экрана, с
 *  которого окно открыли. versionId — отбор по версии, оставшийся от фильтра
 *  статистики; любая отметка в списке проектов его снимает.
 *
 *  Своя пара дат — две кнопки «С» и «По» с обычным выбором даты, а не
 *  встроенный календарь: две даты проще выбрать двумя щелчками, чем набирать
 *  диапазон по сетке. */
const expdlg = { period: 'all', from: null, to: null, projects: null, versionId: 'all' };

const expdlgRange = () => Core.exportRange(expdlg.period, new Date(), { from: expdlg.from, to: expdlg.to });
const expdlgTasks = () => Core.exportTasks(Core.filterTasks(state.tasks, state.versions, { versionId: expdlg.versionId }), expdlg.projects);

/** Дата для подписей окна: «1 окт.» и «1 окт. 2026». Год дописывается сам, а
 *  не берётся из toLocaleDateString: тот ставит к нему «г.», «р.», «ж.», а у
 *  казахского ещё и в начало строки. */
function fmtExpDate(d, withYear) {
  const day = d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  if (!withYear) return day;
  return lang() === 'en' ? `${day}, ${d.getFullYear()}` : `${day} ${d.getFullYear()}`;
}

/** Подпись кнопки проектов; отбор по версии дописывается к ней, чтобы было
 *  видно, что выгрузка уже. */
function expdlgProjectsText() {
  const base = Core.exportProjectsLabel(expdlg.projects, state.projects, {
    all: t('filter.all_projects'),
    many: (n) => t('export.projects_n', { n, plural: pluralForm(n, 'plural.project') }),
  });
  return expdlg.versionId === 'all' ? base : `${base} · ${versionFilterLabel(null, expdlg.versionId)}`;
}

const selectHtml = (text) => `<span class="dp-select-name">${escapeHtml(text)}</span>${icon('chevron-down')}`;

function renderExpdlg() {
  const tasks = expdlgTasks();
  const range = expdlgRange();
  const custom = expdlg.period === 'custom';

  el.expPeriod.innerHTML = selectHtml(t(`export.period_${expdlg.period}`));
  const projectsText = expdlgProjectsText();
  el.expProjects.innerHTML = selectHtml(projectsText);
  el.expProjects.title = projectsText;

  // Под полем — точные даты. У «Всего времени» границ нет, и показано то, что
  // за ним лежит: от первой записи до последней. У своего периода эти даты
  // уже на кнопках ниже.
  const shown = range || Core.exportSpan(tasks);
  el.expRangeText.hidden = custom;
  el.expRangeText.textContent = shown ? Core.exportRangeLabel(shown, fmtExpDate) : '';
  el.expDates.hidden = !custom;
  el.expFrom.textContent = fmtExpDate(keyToDate(expdlg.from), true);
  el.expTo.textContent = fmtExpDate(keyToDate(expdlg.to), true);

  const sum = Core.exportSummary(tasks, range);
  el.expSummary.classList.toggle('empty', sum.empty);
  el.expSummary.textContent = sum.empty
    ? t('export.empty')
    : t('export.summary', { n: sum.count, plural: pluralForm(sum.count, 'plural.entry'), time: fmtDur(sum.ms) });
  // Выгружать нечего — кнопка гаснет, а подсказка при наведении та же, что в
  // строке: иначе гаснущая кнопка ничего не объясняет.
  el.expdlgOk.disabled = sum.empty;
  el.expdlgOk.title = sum.empty ? t('export.empty') : '';
}

// Ширина меню — по offsetWidth, а не по рамке: окно ещё въезжает с масштабом, и рамка
// кнопки в первые 160 мс меньше настоящей.
function openExpdlgPeriodMenu() {
  openMenu(el.expPeriod, Core.EXPORT_PERIODS.map((p) => ({
    label: t(`export.period_${p}`),
    selected: expdlg.period === p,
    onClick: () => { expdlg.period = p; renderExpdlg(); },
  })), { toggle: true, width: el.expPeriod.offsetWidth });
}

/** Проекты с галочками: «Все проекты» наверху, ниже — по строке на проект.
 *  Меню не закрывается на отметке (keep) и перерисовывается этой же
 *  функцией (refresh). */
function expdlgProjectItems() {
  const ids = state.projects.map((p) => p.id);
  const picked = expdlg.projects;
  const change = (next) => { expdlg.projects = next; expdlg.versionId = 'all'; renderExpdlg(); };
  return [
    { label: t('filter.all_projects'), selected: !picked, keep: true, onClick: () => change(null) },
    ...(state.projects.length ? [{ sep: true }] : []),
    ...state.projects.map((p) => ({
      label: p.name,
      dot: p.color || PALETTE[0],
      selected: !!picked && picked.includes(p.id),
      keep: true,
      onClick: () => change(Core.toggleExportProject(picked, p.id, ids)),
    })),
  ];
}
function openExpdlgProjectsMenu() {
  openMenu(el.expProjects, expdlgProjectItems(), {
    toggle: true,
    width: el.expProjects.offsetWidth,
    refresh: expdlgProjectItems,
  });
}

// Кнопка, с которой окно открыли: после закрытия фокус возвращается ей, а не
// остаётся на невидимом.
let expdlgOpener = null;
function openExportPeriodDialog() {
  const today = dayKey(new Date());
  if (!expdlg.from) expdlg.from = today;
  if (!expdlg.to) expdlg.to = today;
  // Открыли с экрана, где выбран проект (фильтр статистики), — он и предвыбран,
  // вместе с версией, если она там выбрана.
  const fromFilter = statsFilter.projectId !== 'all' && !!getProject(statsFilter.projectId);
  expdlg.projects = Core.normalizeExportProjects(fromFilter ? [statsFilter.projectId] : null, state.projects.map((p) => p.id));
  expdlg.versionId = fromFilter ? statsFilter.versionId || 'all' : 'all';
  renderExpdlg();
  expdlgOpener = document.activeElement === document.body ? null : document.activeElement;
  if (el.expdlgBackdrop.hidden) usageSend('export');
  el.expdlgBackdrop.hidden = false;
  el.expPeriod.focus();
}
function closeExpdlg() {
  const opener = expdlgOpener && expdlgOpener.isConnected ? expdlgOpener : el.exportPeriodBtn;
  expdlgOpener = null;
  el.expdlgBackdrop.hidden = true;
  closeDatePicker();
  closeMenu();
  opener.focus();
}

el.expPeriod.addEventListener('click', openExpdlgPeriodMenu);
el.expProjects.addEventListener('click', openExpdlgProjectsMenu);
// Границы не расходятся: дальше «по» — «с» подтягивает её за собой, и наоборот.
el.expFrom.addEventListener('click', () => openDatePicker(el.expFrom, expdlg.from, (key) => {
  expdlg.from = key;
  if (expdlg.to < key) expdlg.to = key;
  renderExpdlg();
}));
el.expTo.addEventListener('click', () => openDatePicker(el.expTo, expdlg.to, (key) => {
  expdlg.to = key;
  if (expdlg.from > key) expdlg.from = key;
  renderExpdlg();
}));
el.expdlgCancel.addEventListener('click', closeExpdlg);
el.expdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.expdlgBackdrop) closeExpdlg(); });
// Escape закрывает окно — но не поверх открытого меню или календаря: тем
// закрыться первыми, а окну остаться. Меню гасит себя своим обработчиком в
// фазе перехвата, и обычный слушатель документа увидел бы его уже закрытым;
// поэтому этот стоит в той же фазе и зарегистрирован раньше любого меню.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || el.expdlgBackdrop.hidden || !el.ctxMenu.hidden || dp.open) return;
  e.preventDefault();
  closeExpdlg();
}, true);
el.expdlgOk.addEventListener('click', () => {
  const tasks = expdlgTasks();
  const range = expdlgRange();
  if (Core.exportSummary(tasks, range).empty) return;
  const ids = expdlg.projects;
  const projects = ids ? state.projects.filter((p) => ids.includes(p.id)) : state.projects;
  // Один проект — в его валюте и по его ставкам, несколько — в основной.
  const rep = reportsFor(projects.length === 1 ? projects[0].id : null);
  const scope = expdlgProjectsText();
  closeExpdlg();
  if (!range) {
    runExport(`Lancible — ${ids ? scope : t('export.all_projects')} — ${fmtDate(Date.now())}`,
      rep.buildAllProjectsSheets(projects, (id) => tasks.filter((x) => x.projectId === id)));
    return;
  }
  runExport(`Lancible — ${t('export.period')}${ids ? ` — ${scope}` : ''} — ${fmtDate(range.from)} — ${fmtDate(range.to)}`,
    rep.buildPeriodSheets(tasks, getProject, range));
});

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
  // Выключенный таймер (core/modes.js): кнопок нет, и горячие клавиши и
  // «Старт» в шапке тоже ничего не запускают.
  if (!modeFlags().timer) return;
  if (state.activeTimer) stopTimer();
  const now = new Date().toISOString();
  state.activeTimer = { taskId: id, startedAt: now, heartbeatAt: now };
  holdOrders(id);
  liqKick(id, 'fill');
  savePending = true;
  saveNow();
  render();
}
function stopTimer() {
  if (!state.activeTimer) return;
  const { taskId, startedAt } = state.activeTimer;
  liqKick(taskId, 'drain');
  releaseOrders(taskId);
  const task = getTask(taskId);
  const end = new Date();
  const ms = Math.max(0, end.getTime() - new Date(startedAt).getTime());
  if (task && ms >= 1000) {
    task.sessions = task.sessions || [];
    // id — сразу: журнал правок знает запись по нему (core/oplog.js), и
    // сдвиг её начала остаётся правкой той же записи.
    task.sessions.push({ id: uid(), start: startedAt, end: end.toISOString(), ms, rate: effectiveRate(task) });
    task.totalMs = (task.totalMs || 0) + ms;
    task.updatedAt = end.toISOString();
  }
  state.activeTimer = null;
  savePending = true;
  saveNow();
  render();
}

// ---------------------------------------------------------------------------
// Порядок строк: на запуске не прыгает, на остановке плавно переезжает
// ---------------------------------------------------------------------------
//
// «Недавние задачи», проекты и карточки «Проектов» стоят по свежести, и у
// идущей задачи она — «сейчас», то есть первая. Раньше строка выпрыгивала
// вверх в момент нажатия. Теперь запуск порядок не трогает: startTimer
// запоминает, как списки стояли на экране (shownOrder), и listRows держит
// этот порядок, пока таймер идёт (Core.holdOrder). Остановили — заморозка
// снята, порядок обычный, и строки переезжают на новые места: flipSnapshot
// замеряет, где каждая стояла, flipPlay — где встала, и строка едет оттуда
// сюда (FLIP: .flip-move, --flip-x/--flip-y). Ушли с экрана и вернулись —
// порядок считается заново, без заморозки и без движения (render()).
//
// В переезде участвуют только строки с flipTag: ключ списка и id. Перерисовка
// посреди переезда (синхронизация, переключение таймера) его не сбрасывает:
// замер берёт строки там, где они видны сейчас, и новый переезд идёт оттуда.
// Без движения (prefers-reduced-motion) строки встают сразу.

/** Как списки стояли на экране в последней отрисовке: ключ → id строк. */
const shownOrder = new Map();
/** Заморозка: { taskId, orders } — пока идёт таймер этой задачи, списки
 *  держат порядок orders (ключ → id строк). */
let orderHold = null;
/** Остановленная задача: при ближайшей перерисовке её строки едут на место. */
let flipArm = null;
/** Перерисовку взвела правка строк (галочка, агент — flipSoon), а не
 *  таймер: тогда едут и списки со своим порядком (flipTag, own). */
let flipAll = false;

/** Строки списка в показанном порядке. rows — объекты с id в обычном
 *  порядке; пока идёт заморозка, порядок тот, что был на экране. */
function listRows(key, rows) {
  const frozen = orderHold && state.activeTimer && state.activeTimer.taskId === orderHold.taskId;
  const ids = Core.holdOrder(frozen ? orderHold.orders.get(key) : null, rows.map((r) => r.id));
  shownOrder.set(key, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id));
}

function holdOrders(taskId) { orderHold = { taskId, orders: new Map(shownOrder) }; }
function releaseOrders(taskId) { orderHold = null; flipArm = taskId; }

/** Пометить строку как участницу переезда: key — список, id — строка в нём.
 *  own — у списка свой, хранимый порядок (список проекта): от таймера он не
 *  зависит и едет только после правки строк (flipSoon). */
function flipTag(node, key, id, own) {
  node.dataset.flip = key;
  node.dataset.flipId = id;
  if (own) node.dataset.flipOwn = '1';
  return node;
}
const flipKey = (node) => `${node.dataset.flip}|${node.dataset.flipId}`;

/** Где сейчас стоят строки — пока перерисовка их не заменила. Нужен, только
 *  если кого-то остановили или переезд ещё идёт; иначе null. Прямоугольник
 *  берётся вместе с идущей анимацией, поэтому прерванный переезд продолжается
 *  с того места, где строка была видна; у едущей строки запоминается ещё, на
 *  сколько она сдвинута, откуда ехала и сколько уже проехала. */
function flipSnapshot() {
  if (!flipArm && !document.querySelector('.flip-move')) return null;
  const before = new Map();
  for (const node of document.querySelectorAll('[data-flip]')) {
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const was = { rect, live: node.classList.contains('flip-move'), lead: node.classList.contains('flip-lead') };
    if (was.live) {
      const shift = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      const run = node.getAnimations().find((a) => a.animationName === 'flipMove');
      Object.assign(was, {
        tx: shift.m41, ty: shift.m42,
        x: node.style.getPropertyValue('--flip-x'), y: node.style.getPropertyValue('--flip-y'),
        at: run ? run.effect.getComputedTiming().localTime - run.effect.getComputedTiming().delay : 0,
      });
    }
    before.set(flipKey(node), was);
  }
  return before;
}

/** Строки, что встали не там, где стояли, едут на новое место. Остановленная
 *  поднимается над остальными (.flip-lead). Перерисовка посреди переезда не
 *  сбрасывает его: если место, куда строка ехала, не сменилось, новая строка
 *  доигрывает ту же анимацию с того же момента (--flip-t — отрицательная
 *  задержка, как у --liq-t); сменилось — едет оттуда, где была видна. */
function flipPlay(before) {
  const armed = flipArm;
  const all = flipAll;
  flipArm = null;
  flipAll = false;
  if (!before || reducedMotion()) return;
  for (const node of document.querySelectorAll('[data-flip]')) {
    const was = before.get(flipKey(node));
    const own = !!node.dataset.flipOwn;
    if (!was) {
      // Новая в списке после правки (группа «Готово», куда только что
      // уехала первая выполненная) проявляется, а не выскакивает.
      if (armed && (all || !own)) flipNew(node);
      continue;
    }
    if (own && !all && !was.live) continue;
    const now = node.getBoundingClientRect();
    if (!now.width && !now.height) continue;
    const dx = Math.round(was.rect.left - now.left);
    const dy = Math.round(was.rect.top - now.top);
    if (was.live && Math.abs(dx - was.tx) < 1 && Math.abs(dy - was.ty) < 1) {
      node.style.setProperty('--flip-x', was.x);
      node.style.setProperty('--flip-y', was.y);
      node.style.setProperty('--flip-t', `${-Math.round(was.at)}ms`);
    } else if (dx || dy) {
      node.style.setProperty('--flip-x', `${dx}px`);
      node.style.setProperty('--flip-y', `${dy}px`);
    } else continue;
    node.classList.toggle('flip-lead', was.lead || node.dataset.flipId === armed);
    // Лесенка въезда строк (animationDelay у списка проекта) переезд не ждёт.
    node.style.animationDelay = '';
    node.classList.add('flip-move');
    node.addEventListener('animationend', (e) => {
      if (e.target === node && e.animationName === 'flipMove') node.classList.remove('flip-move', 'flip-lead');
    });
  }
}

function flipNew(node) {
  node.classList.add('flip-new');
  node.addEventListener('animationend', (e) => {
    if (e.target === node && e.animationName === 'flipNew') node.classList.remove('flip-new');
  });
}

/** Ближайшая перерисовка переставит строки плавно: правка, после которой
 *  строки встанут иначе, — галочка, предложение агента. id — строка, что
 *  едет над остальными (.flip-lead); без него все равны. */
function flipSoon(id) {
  if (reducedMotion()) return;
  flipArm = id || true;
  flipAll = true;
}

// ---------------------------------------------------------------------------
// Галочка «выполнено»: налив, брызги, строка держит место (18 октября 2026)
// ---------------------------------------------------------------------------
//
// Как на телефоне (LiquidCheck, useOrderHold.markNow): задача отмечается в
// тот же миг — счётчики, шкалы и мета не ждут, — а строка ещё HOLD_DONE_MS
// стоит, где стояла: галочка наливается, из неё брызгают капли. Потом строка
// уезжает вниз, к выполненным, — тем же переездом, что после остановки
// таймера (flipSoon, «Порядок строк»). Сняли галочку или вернули отменённую
// с крестика — то же без капель и быстрее, обратно наверх. Раньше строка
// таяла и пропадала, а задача появлялась внизу уже без неё.
//
// Пока строку держат, нажатия на её галочку ничего не делают: двойной щелчок
// не отменяет отметку и не путает порядок (так и на телефоне). Раскладывают
// строку по задаче до нажатия (placedAs), рисуют — по настоящей. Перерисованная
// посреди налива галочка продолжает его с того же места (checkKicks, --chk-t —
// как liqKicks у кнопки запуска); задача, что закрылась не галочкой (агент,
// синхронизация), наливается или прорисовывает крестик тоже, но без капель.
// Без движения — ни налива, ни капель, ни задержки: строка сразу на месте.
// Вид — «Галочка задачи» в компонентах styles.css.

/** Сколько строка стоит после галочки — налив и брызги видны целиком. */
const HOLD_DONE_MS = 600;
/** Снятая галочка и крестик: брызг нет, ждать нечего. */
const HOLD_OPEN_MS = 320;
/** Чуть дольше самой длинной анимации галочки (поп кончается к 0,47 с). */
const CHECK_WINDOW_MS = 520;
const CHECK_DROPS = 7;
/** id задачи → { was: поля до нажатия, timer } — строки, что держат место. */
const rowHolds = new Map();
/** id задачи → { kind: 'check' | 'uncheck' | 'cross' | 'uncross', at, seen }. */
const checkKicks = new Map();
/** id задачи → вид строки в прошлой отрисовке: 'open' | 'done' | 'cancelled'. */
const rowSeen = new Map();

const rowKind = (task) => (task.done ? 'done' : isCancelledTask(task) ? 'cancelled' : 'open');

/** Задача, какой её раскладывать по спискам: только что отмеченная стоит,
 *  где стояла до нажатия. */
function placedAs(task) {
  const h = rowHolds.get(task.id);
  return h ? { ...task, ...h.was } : task;
}

/** Галочка строки задачи — или серый крестик у отменённой («Вернуть в
 *  работу»). Одна на карточки «Проектов» и список проекта. */
function rowCheck(task) {
  let node;
  if (isCancelledTask(task)) {
    node = elt('button', 'task-x');
    node.type = 'button';
    node.innerHTML = icon('x');
    node.title = `${t('status.kind_cancelled')} · ${t('task.reopen')}`;
    node.setAttribute('aria-label', t('task.reopen'));
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const back = defaultStatusId(task.projectId, false);
      if (back) holdRow(task, () => setTaskStatus(task, back), 'uncross');
    });
  } else {
    node = document.createElement('input');
    node.type = 'checkbox';
    node.className = 'task-done';
    node.checked = !!task.done;
    node.setAttribute('aria-label', t('task.done_label'));
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (rowHolds.has(task.id)) e.preventDefault();
    });
    node.addEventListener('change', () => {
      const on = node.checked;
      holdRow(task, () => setTaskDone(task, on), on ? 'check' : 'uncheck', node);
    });
  }
  checkMark(node, task);
  return node;
}

/** Правка галочкой или крестиком: change — сама правка, сразу; строка
 *  держит место и потом переезжает. box — галочка, из которой брызгать. */
function holdRow(task, change, kind, box) {
  if (rowHolds.has(task.id)) return;
  if (reducedMotion()) {
    change();
    render();
    scheduleSave();
    return;
  }
  const was = { done: task.done, cancelled: task.cancelled, statusId: task.statusId, updatedAt: task.updatedAt };
  if (kind === 'check' && box) checkBurst(box);
  change();
  checkKick(task.id, kind);
  const ms = kind === 'check' ? HOLD_DONE_MS : HOLD_OPEN_MS;
  rowHolds.set(task.id, { was, timer: setTimeout(() => releaseRow(task.id), ms) });
  render();
  scheduleSave();
}

/** Строку отпустили — она едет на своё новое место. */
function releaseRow(id) {
  if (!rowHolds.delete(id)) return;
  flipSoon(id);
  render();
}

/** Новый экран: строки встают сразу, держать и доигрывать нечего. */
function rowsForget() {
  for (const h of rowHolds.values()) clearTimeout(h.timer);
  rowHolds.clear();
  rowSeen.clear();
}

function checkKick(id, kind) {
  if (!reducedMotion()) checkKicks.set(id, { kind, at: animNow(), seen: new WeakSet() });
}

/** Галочке или крестику строки — налив, слив или прорисовку, если задачу
 *  только что тронули. Заодно замечает, что строка сменила вид не галочкой
 *  (агент, синхронизация), — тогда играет то же, только без брызг. */
function checkMark(node, task) {
  const kind = rowKind(task);
  const prev = rowSeen.get(task.id);
  rowSeen.set(task.id, kind);
  let k = checkKicks.get(task.id);
  if (k && animNow() - k.at > CHECK_WINDOW_MS) { checkKicks.delete(task.id); k = null; }
  if (!k && prev && prev !== kind) {
    checkKick(task.id, kind === 'done' ? 'check' : kind === 'cancelled' ? 'cross' : prev === 'cancelled' ? 'uncross' : 'uncheck');
    k = checkKicks.get(task.id);
  }
  if (!k || k.seen.has(node)) return;
  const fits = node.classList.contains('task-x') ? k.kind === 'cross'
    : k.kind === 'check' ? node.checked : k.kind !== 'cross' && !node.checked;
  if (!fits) return;
  k.seen.add(node);
  const cls = `liq-${k.kind}`;
  node.style.setProperty('--chk-t', `${-Math.round(animNow() - k.at)}ms`);
  node.classList.add(cls);
  liqSettle(node, () => node.classList.remove(cls));
}

/** Брызги галочки: капли акцента разлетаются из её центра и тают, как
 *  LiquidDrops телефона (dropAt: по кругу с разбросом, дальше и мельче к
 *  концу). Слой — на <body>: строку перерисуют сразу, а капли долетят. */
function checkBurst(box) {
  const r = box.getBoundingClientRect();
  if (!r.width) return;
  const burst = elt('span', 'task-drops');
  burst.setAttribute('aria-hidden', 'true');
  burst.style.left = `${Math.round(r.left + r.width / 2)}px`;
  burst.style.top = `${Math.round(r.top + r.height / 2)}px`;
  const px = (v) => `${v.toFixed(1)}px`;
  for (let i = 0; i < CHECK_DROPS; i += 1) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / CHECK_DROPS + (i % 2 ? 0.22 : -0.12);
    const near = r.width * 0.32;
    const far = r.width * 0.5 + 9 + (i % 3) * 2.5;
    const drop = elt('i');
    drop.style.setProperty('--x0', px(Math.cos(a) * near));
    drop.style.setProperty('--y0', px(Math.sin(a) * near));
    drop.style.setProperty('--dx', px(Math.cos(a) * far));
    drop.style.setProperty('--dy', px(Math.sin(a) * far));
    drop.style.setProperty('--ds', px(4 + (i % 3) * 0.9));
    burst.append(drop);
  }
  document.body.append(burst);
  liqSettle(burst, () => burst.remove());
}

// ---------------------------------------------------------------------------
// Шкалы: заливка натекает до значения (18 октября 2026)
// ---------------------------------------------------------------------------
//
// Как ProgressBar телефона: показанная шкала натекает от нуля, новое
// значение — от того места, где заливка сейчас, пружиной --spring-flow
// (LIQUID.flow: ζ ≈ 0.65, перехлёст ~6,6%) за 0,7 с. Строки и карточки
// перерисовываются целиком, поэтому шкала помнит себя не узлом, а ключом
// места (barShown): перерисовка с тем же значением заново не играет, а
// перерисовка на ходу доигрывает с того же момента. Новый экран (render(),
// entering) память стирает: шкалы там снова натекают от нуля. Шкала вне
// экранов (загрузка обновления) помнит себя узлом. Без движения — ширина
// сразу. Вид — «Шкала» в компонентах styles.css.

const BAR_MS = 700;
/** Ключ шкалы (строка места или сам узел) → { from, to, anim }. */
const barShown = new Map();
let barEase = '';

/** Пружина шкал — из токена; браузер без linear() возьмёт --ease. */
function barEasing() {
  if (!barEase) barEase = getComputedStyle(document.documentElement).getPropertyValue('--spring-flow').trim() || 'ease-out';
  return barEase;
}

/** Где заливка сейчас, %: если едет — по ходу пружины, иначе её цель. */
function barNow(rec) {
  if (!rec.anim || rec.anim.playState !== 'running') return rec.to;
  const p = rec.anim.effect.getComputedTiming().progress;
  return p === null ? rec.to : rec.from + (rec.to - rec.from) * p;
}

/** Заливка шкалы — pct процентов (0–100). key — какая это шкала на экране
 *  (`ptile:<id проекта>`); без ключа шкала помнит себя узлом. */
function barFill(fill, pct, key) {
  const to = Math.max(0, Math.min(100, Number(pct) || 0));
  fill.classList.add('bar-fill');
  fill.style.width = `${to}%`;
  const k = key || fill;
  const was = barShown.get(k);
  const live = !!was && !!was.anim && was.anim.playState === 'running';
  // Тот же узел и то же значение — пусть едет, как ехал.
  if (live && was.to === to && was.anim.effect.target === fill) return fill;
  const rec = { from: to, to, anim: null };
  barShown.set(k, rec);
  if (reducedMotion() || typeof fill.animate !== 'function') return fill;
  let from = was ? barNow(was) : 0;
  let at = 0;
  if (live && was.to === to) { from = was.from; at = was.anim.currentTime || 0; }
  if (live && was.anim.effect.target === fill) was.anim.cancel();
  if (!at && Math.abs(from - to) < 0.1) return fill;
  rec.from = from;
  const frames = [{ width: `${from}%` }, { width: `${to}%` }];
  try {
    rec.anim = fill.animate(frames, { duration: BAR_MS, easing: barEasing() });
  } catch {
    rec.anim = fill.animate(frames, { duration: BAR_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });
  }
  if (at) rec.anim.currentTime = at;
  return fill;
}

/** Новый экран — шкалы на нём натекают заново; узловые помнят себя. */
function barForget() {
  for (const k of [...barShown.keys()]) if (typeof k === 'string') barShown.delete(k);
}

// ---------------------------------------------------------------------------
// Жидкий старт: кнопка запуска наливается, капсула шапки перетекает
// ---------------------------------------------------------------------------
//
// Запустили задачу — каждая её кнопка запуска на экране «наливается»
// (.liq-fill), остановили — «стекает» (.liq-drain); вид и время — в
// styles.css, «Кнопка запуска». Строки перерисовываются целиком, поэтому
// кнопка не помнит, что её только что нажали: помнит liqKicks — какую задачу
// и когда тронули, — а каждое место, которое рисует кнопку запуска, зовёт
// liqMark. Перерисованная посреди анимации кнопка подхватывает её с того же
// места (--liq-t), а не начинает заново. Время — по часам анимаций
// (document.timeline), а не Date.now(): их и догоняем.
//
// Без движения (prefers-reduced-motion) ничего этого нет: кнопки и капсула
// меняются сразу.

function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function animNow() { return (document.timeline && document.timeline.currentTime) || performance.now(); }
/** Сколько после нажатия новая кнопка ещё подхватывает анимацию: чуть
 *  дольше самой длинной из них (0.62 с). */
const LIQ_WINDOW_MS = 700;
const liqKicks = new Map(); // id задачи → { kind: 'fill' | 'drain', at, seen: WeakSet }

function liqKick(taskId, kind) {
  if (!taskId || reducedMotion()) return;
  liqKicks.set(taskId, { kind, at: animNow(), seen: new WeakSet() });
}

/** Кнопке запуска задачи — налив или слив, если задачу только что тронули.
 *  Одна кнопка играет его один раз: «Сейчас идёт» и таймер страницы задачи
 *  перерисовываются каждые 250 мс, и без этого анимация шла бы по кругу. */
function liqMark(btn, taskId) {
  const k = liqKicks.get(taskId);
  if (!k || k.seen.has(btn)) return;
  const age = animNow() - k.at;
  if (age > LIQ_WINDOW_MS) { liqKicks.delete(taskId); return; }
  k.seen.add(btn);
  const cls = `liq-${k.kind}`;
  btn.classList.remove('liq-fill', 'liq-drain');
  btn.style.setProperty('--liq-t', `${-Math.round(age)}ms`);
  btn.classList.add(cls);
  liqSettle(btn, () => btn.classList.remove(cls));
}

/** Позвать done, когда все анимации узла (с потомками и ::before/::after)
 *  кончились или сорвались. Строку собирают до вставки в страницу, поэтому
 *  смотрим в микрозадаче, когда она уже на месте; анимаций нет (выключены
 *  стилями, узел не на экране) — done сразу. */
function liqSettle(node, done) {
  queueMicrotask(() => {
    const anims = node.isConnected ? node.getAnimations({ subtree: true }) : [];
    Promise.allSettled(anims.map((a) => a.finished)).then(done);
  });
}

/** Значок плея или стопа — только когда он правда сменился: перерисовка раз в
 *  250 мс не должна заново запускать выпрыгивание значка. */
function setPlayIcon(node, running) {
  const kind = running ? 'stop' : 'play';
  if (node.dataset.ico === kind) return;
  node.dataset.ico = kind;
  node.innerHTML = running ? SVG_STOP : SVG_PLAY;
}

/** Слой капли под содержимым капсулы и SVG-фильтр, который делает из двух
 *  пятен одну жидкость: размыть и снова обрезать по прозрачности. */
function setupLiquid() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'liq-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.innerHTML = '<filter id="liq-goo" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB">'
    + '<feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>'
    + '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -9"/></filter>';
  document.body.append(svg);
  const goo = elt('span', 'liq-goo');
  goo.setAttribute('aria-hidden', 'true');
  goo.append(elt('i', 'liq-drop'), elt('i', 'liq-bead'));
  el.tbTimer.prepend(goo);
}

/** Шла ли запись при прошлой отрисовке шапки; null — шапку ещё не рисовали
 *  (на первой отрисовке переливаться нечему). */
let tbRunning = null;

/** Где в капсуле капля «Стопа» и куда катится бусина — от вёрстки капсулы,
 *  какой она будет (или была). fromW — ширина «Старта». */
function tbLiquidGeometry(fromW) {
  const t = el.tbTimer;
  const stop = el.tbTimerStop;
  const dot = t.querySelector('.tb-timer-dot');
  const drop = t.querySelector('.liq-drop');
  const bead = t.querySelector('.liq-bead');
  t.style.setProperty('--liq-from', `${Math.round(fromW || t.offsetHeight)}px`);
  drop.style.left = `${stop.offsetLeft}px`;
  drop.style.top = `${stop.offsetTop}px`;
  drop.style.width = `${stop.offsetWidth}px`;
  drop.style.height = `${stop.offsetHeight}px`;
  // Бусина начинает, наполовину сидя в капле, и кончает на месте точки.
  const size = bead.offsetWidth;
  const from = stop.offsetLeft - size / 2;
  const to = dot.offsetLeft + dot.offsetWidth / 2 - size / 2;
  bead.style.left = `${from}px`;
  bead.style.top = `${t.clientHeight / 2 - size / 2}px`;
  t.style.setProperty('--liq-run', `${Math.round(to - from)}px`);
}

/** Перезапустить класс-анимацию: снять, дать стилям увидеть, поставить. */
function restartClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** Перелив шапки. 'in' — «Старт» растекается в капсулу; 'out' — капсула
 *  стекает в «Старт»: на это время она остаётся видимой поверх него
 *  (renderTbTimer её не прячет), а прячется, когда анимация кончилась. */
function tbPour(dir, fromW) {
  const t = el.tbTimer;
  const start = el.tbStart;
  t.classList.remove('liq-grow', 'liq-shrink');
  start.classList.remove('liq-settle');
  if (reducedMotion()) return;
  // Сначала класс, потом замеры: слой капли виден (и меряется) только с ним.
  if (dir === 'in') {
    restartClass(t, 'liq-grow');
    tbLiquidGeometry(fromW);
    liqSettle(t, () => t.classList.remove('liq-grow'));
    return;
  }
  restartClass(t, 'liq-shrink');
  tbLiquidGeometry(fromW);
  if (!start.hidden) restartClass(start, 'liq-settle');
  liqSettle(t, () => {
    if (!t.classList.contains('liq-shrink')) return; // её уже перебил новый запуск
    t.classList.remove('liq-shrink');
    t.hidden = !tbRunning;
  });
  liqSettle(start, () => start.classList.remove('liq-settle'));
}

// ---------------------------------------------------------------------------
// Сегментный переключатель: подложка выбранной кнопки переезжает
// ---------------------------------------------------------------------------
//
// Выбранная кнопка .segmented — .on, и ставят её в десятке мест (вкладки
// проекта и задачи, режимы «Статистики», фильтр статусов, тема, повторение,
// настройки редактора). Чтобы не трогать каждое, подложка следит за классом
// кнопок сама: MutationObserver увидел новую .on — общий .seg-pill едет к ней
// (положение и ширина, пружина — в styles.css). Размер кнопок поменялся
// (язык, ширина окна, переключатель показали) — ResizeObserver ставит подложку
// на место без анимации. Новые переключатели (редактор) подхватывает
// watchSegmented.

const segAreas = new WeakMap(); // .segmented → { pill, on, box, ro }

function attachSegGlide(seg) {
  if (segAreas.has(seg) || !seg.querySelector(':scope > button')) return;
  const pill = elt('span', 'seg-pill still none');
  pill.setAttribute('aria-hidden', 'true');
  seg.prepend(pill);
  seg.classList.add('seg-glide');
  const area = { seg, pill, on: null, box: null, ro: new ResizeObserver(() => segPlace(area, false)) };
  segAreas.set(seg, area);
  const watch = () => { for (const b of seg.children) if (b !== pill) area.ro.observe(b); };
  area.ro.observe(seg);
  watch();
  new MutationObserver((list) => {
    if (list.some((m) => m.type === 'childList')) watch();
    segPlace(area, true);
  }).observe(seg, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  segPlace(area, false);
}

/** Поставить подложку под выбранную кнопку. glide — ехать, если выбранная
 *  сменилась на видимом переключателе; иначе — встать сразу. Координаты — в
 *  раскладке переключателя: масштаб окна, которое ещё раскрывается (popIn),
 *  делится обратно, прокрутка ряда (узкий веб) прибавляется. */
function segPlace(area, glide) {
  const { seg, pill } = area;
  const on = seg.querySelector(':scope > button.on');
  pill.classList.toggle('none', !on);
  if (!on || !seg.isConnected || !seg.offsetWidth || !on.offsetWidth) {
    // Нечего выделять или переключатель не на экране: встанет, когда покажут.
    area.on = null;
    area.box = null;
    return;
  }
  const s = seg.getBoundingClientRect();
  const r = on.getBoundingClientRect();
  const k = s.width / seg.offsetWidth || 1;
  const box = {
    x: (r.left - s.left) / k - seg.clientLeft + seg.scrollLeft,
    y: (r.top - s.top) / k - seg.clientTop + seg.scrollTop,
    w: r.width / k,
    h: r.height / k,
  };
  const same = area.box && area.on === on && ['x', 'y', 'w', 'h'].every((p) => Math.abs(area.box[p] - box[p]) < 0.5);
  if (same) return;
  const move = glide && area.on && area.on !== on && !reducedMotion();
  pill.classList.toggle('still', !move);
  pill.style.transform = `translate(${box.x}px, ${box.y}px)`;
  pill.style.width = `${box.w}px`;
  pill.style.height = `${box.h}px`;
  area.on = on;
  area.box = box;
}

/** Переключатели, что уже есть, и те, что появятся (настройки редактора). */
function watchSegmented() {
  const find = (root) => {
    if (root.classList.contains('segmented')) attachSegGlide(root);
    // Внутри — ни одного элемента: искать в поддереве нечего.
    if (root.firstElementChild) for (const seg of root.getElementsByClassName('segmented')) attachSegGlide(seg);
  };
  find(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      // Переключатель в переключателе не бывает: то, что вставлено внутрь него
      // (кнопки, подложка при подключении), не разбираем. Текстовые узлы и
      // накладные дорожки (они лежат в <body>) — тоже.
      if (m.target.closest('.segmented')) continue;
      for (const n of m.addedNodes) if (n.nodeType === 1 && !ovsTracks.has(n)) find(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
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
// Пауза облака картинок: пока удаляется аккаунт (deleteAccount), хранилище
// считается недоступным, и ни вставка, ни докачка в облако не идут.
let assetsPaused = false;
sb.auth.onAuthStateChange((_event, session) => {
  assetAuth = session ? { token: session.access_token, userId: session.user.id } : null;
  if (assetAuth && editorAssets) editorAssets.flush();
});

const editorAssets = window.LancibleEditor ? LancibleEditor.createAssetStore({
  // Чья вставленная картинка (src/editor/assets.js, очередь по аккаунтам): того
  // аккаунта, чья область открыта, — даже без сеанса (уйдёт, когда он
  // вернётся); гость — null, такие уезжают только переносом (adoptGuest).
  // Не assetAuth: его меняют и события сеанса из других вкладок.
  owner: () => scopeUid || null,
  remote: () => (assetAuth && !assetsPaused && state.settings.syncEnabled !== false
    ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, accessToken: assetAuth.token, userId: assetAuth.userId }
    : null),
}) : null;

/** «Удалить данные аккаунта с устройства»: картинки и PDF из заметок
 *  аккаунта uid — записи хранилища редактора с owner: uid (src/editor/
 *  assets.js), и ждущие выгрузки, и скачанные копии. Стирает само хранилище
 *  (forget): из IndexedDB и из своих кэшей в памяти, с освобождением адресов
 *  blob: — без перезагрузки картинка уже не отдаётся. Облако не трогается.
 *  Гостевые (owner null), чужие и записи без поля owner (до 17 октября)
 *  остаются. Возвращает, сколько записей стёрто. */
async function forgetAccountAssets(uid) {
  if (!uid) return 0;
  if (editorAssets && typeof editorAssets.forget === 'function') {
    try { return await editorAssets.forget(uid); } catch (err) { console.error('Хранилище картинок не стёрло записи аккаунта:', err); }
  }
  return forgetAssetsInDb(uid);
}

/** Запасной путь forgetAccountAssets: редактора нет (не загрузился) или его
 *  хранилище не справилось — записи стираются прямо в IndexedDB, по тем же
 *  имени базы, хранилищу и полю owner; десктоп держит ту же IndexedDB
 *  рендерера. Базы ещё нет — её и не заводим: открытие завело бы пустую,
 *  без хранилища, и редактор потом не смог бы её дополнить. */
const ASSET_DB = 'lancible-assets';
const ASSET_STORE = 'blobs';
function forgetAssetsInDb(uid) {
  if (!uid || typeof indexedDB === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(ASSET_DB); } catch (err) { console.error('Не удалось открыть хранилище картинок:', err); resolve(0); return; }
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* уже отменено */ } };
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      const done = (n) => { db.close(); resolve(n); };
      if (!db.objectStoreNames.contains(ASSET_STORE)) { done(0); return; }
      let n = 0;
      let tx;
      try { tx = db.transaction(ASSET_STORE, 'readwrite'); } catch (err) { console.error('Не удалось стереть картинки:', err); done(0); return; }
      const cursor = tx.objectStore(ASSET_STORE).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (c.value && c.value.owner === uid) { c.delete(); n += 1; }
        c.continue();
      };
      tx.oncomplete = () => done(n);
      tx.onabort = () => { console.error('Не удалось стереть картинки:', tx.error); done(0); };
    };
  });
}

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
    // Полноэкранный редактор ложится поверх шапки, а с ней и поверх кнопок
    // окна: их подложка должна стать цветом его панели и вернуться обратно.
    onFullscreen: () => syncTitlebarOverlay(),
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

/** Редактор не смог открыть или сохранить заметку. Задача и проект всё
 *  равно открываются (до 7 октября 2026 ошибка здесь обрывала selectTask и
 *  openProject — «нажимаю, и ничего»), а сама заметка не трогается: редактор
 *  только для чтения и ничего не пишет. Текст ошибки — на экране, чтобы его
 *  можно было прислать. */
function editorFailed(e, what) {
  console.error(`[editor] ${what}`, e);
  toast(`${t('editor.load_failed')} ${(e && e.message) || e}`);
}

function loadEditor(task) {
  if (!editor) return;
  try { editor.flush(); } catch (e) { editorFailed(e, 'flush'); }
  editorTaskId = null;
  editorLoadedJSON = task ? JSON.stringify(task.notes || null) : null;
  try {
    editor.setContent(task ? Core.readNotes(task.notes) : null);
  } catch (e) {
    editorFailed(e, 'load');
    try { editor.setContent(null); } catch { /* пустой тоже не встал — оставляем как есть */ }
    editor.setEditable(false);
    return;
  }
  editorTaskId = task ? task.id : null;
  editor.setEditable(!!task);
}

/** Дописать в задачу то, что ещё не ушло из редактора (он ждёт 150 мс). */
function flushEditor() {
  if (editor) editor.flush();
  if (docEditor) docEditor.flush();
}

/** Пришли данные с другого устройства. Открытый текст перечитываем, если
 *  его поменяли там: иначе следующая буква отсюда затёрла бы чужую правку.
 *
 *  С журналом правок (17 октября 2026) — и тогда, когда в редакторе стоит
 *  курсор. Перед приёмом редактор дописан (flushEditor) и его текст уже в
 *  очереди своей правкой: набранное здесь либо показано (оно позже), либо
 *  лежит «другой версией» — не теряется. Раньше перечитывание при фокусе
 *  пропускалось, и окно, оставленное с курсором в заметке, молча затирало
 *  чужой текст первой же буквой. Фокус возвращается на место. */
function refreshEditorsFromRemote() {
  const task = editor && getTask(editorTaskId);
  if (task && JSON.stringify(task.notes || null) !== editorLoadedJSON) {
    const focused = editor.view.hasFocus();
    loadEditor(task);
    if (focused) editor.view.focus();
  }
  const d = docEditor && getDocument(state.ui.docId);
  if (d && JSON.stringify(d.body || null) !== docLoadedJSON) {
    const focused = docEditor.view.hasFocus();
    loadDocEditor(d);
    if (focused) docEditor.view.focus();
  }
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
  // Пишем только в тот документ, что редактор действительно открыл: не
  // открылся — его тело остаётся как было.
  if (!d || d.id !== docEditorFor) return;
  d.body = Core.normalizeContainer(container);
  docLoadedJSON = JSON.stringify(d.body);
  d.updatedAt = new Date().toISOString();
  renderDocList();
  scheduleSave();
}

let docEditorFor = null;

function loadDocEditor(d) {
  setupDocEditor();
  if (!docEditor) return;
  try { docEditor.flush(); } catch (e) { editorFailed(e, 'flush doc'); }
  docLoadedJSON = d ? JSON.stringify(d.body || null) : null;
  docEditorFor = null;
  try {
    docEditor.setContent(d ? Core.readNotes(d.body) : null);
  } catch (e) {
    editorFailed(e, 'load doc');
    try { docEditor.setContent(null); } catch { /* см. loadEditor */ }
    docEditor.setEditable(false);
    return;
  }
  docEditorFor = d ? d.id : null;
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
  // Акцентная кнопка — одна на экран: пока документов нет, она по центру.
  el.docNewBtn.hidden = !docs.length;
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
  const filterName = docFilter === 'all' ? t('docs.filter_all')
    : docFilter === 'none' ? t('docs.no_project') : ((getProject(docFilter) || {}).name || t('docs.filter_all'));
  // Название и стрелка вниз — по ней видно, что это выпадающий список.
  el.docFilterBtn.innerHTML = `<span class="dp-select-name">${escapeHtml(filterName)}</span>${icon('chevron-down')}`;
  el.docFilterBtn.title = filterName;
  el.docList.innerHTML = '';
  for (const d of list) {
    const p = d.projectId && getProject(d.projectId);
    const st = Core.docStats(Core.readNotes(d.body).doc);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'doc-item' + (d.id === state.ui.docId ? ' active' : '');
    b.dataset.id = d.id;
    b.innerHTML = `<span class="doc-item-title">${d.pinnedAt ? icon('pin', 'icon doc-pin') : ''}${escapeHtml(docTitle(d))}</span>`
      + `<span class="doc-item-meta">${p ? `<span class="ctx-dot" style="--sc:${escapeHtml(p.color || '')}"></span>${escapeHtml(p.name)} · ` : ''}${escapeHtml(t('docs.words_n', { n: st.words }))} · ${escapeHtml(fmtWhenShort(d.updatedAt))}</span>`;
    b.addEventListener('click', () => { if (d.id !== state.ui.docId) { flushEditor(); state.ui.docId = d.id; renderDocsPage(); syncRoute(); scheduleSave(); } });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openDocMenu(d, b); });
    el.docList.appendChild(b);
  }
  // Документов нет совсем — об этом говорит пустой экран справа, список
  // молчит, чтобы не повторять его слово в слово. Есть, но поиск или фильтр
  // мимо — компактный пустой экран в самом списке.
  el.docListEmpty.hidden = list.length > 0 || !(state.documents || []).length;
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
  ], { width: pickerWidth(anchor) });
}

function openDocFilterMenu(anchor) {
  openMenu(anchor, [
    { label: t('docs.filter_all'), selected: docFilter === 'all', onClick: () => { docFilter = 'all'; renderDocList(); } },
    { label: t('docs.no_project'), selected: docFilter === 'none', onClick: () => { docFilter = 'none'; renderDocList(); } },
    ...state.projects.map((p) => ({ label: p.name, dot: p.color, selected: docFilter === p.id, onClick: () => { docFilter = p.id; renderDocList(); } })),
  ], { toggle: true, width: pickerWidth(anchor) });
}

function openDocMenu(d, anchor) {
  const conflicts = conflictsOf('document', d.id).length;
  openMenu(anchor, [
    // Конфликт документа — та же «Другая версия», что у задачи: у документа
    // нет панели свойств, его настройки — это меню.
    ...(conflicts ? [{ label: `${t('sync.other_version')} · ${conflicts}`, icon: 'copy', onClick: () => openConflictDialog('document', d.id) }, { sep: true }] : []),
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
  if (state.ui.view === 'projects') tickProjects();
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
    task.sessions.push({ id: uid(), start: at.startedAt, end: endIso, ms, rate: effectiveRate(task), recovered: true });
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

el.navItems.forEach((tab) => tab.addEventListener('click', () => {
  // Узкий веб: чат лежит поверх во всю ширину — вкладка экрана его закрывает.
  if (aiNarrow()) closeAiPanel();
  openView(tab.dataset.view);
}));
el.navCollapse.addEventListener('click', toggleNav);

// Капсула ведёт на идущую задачу; стоп внутри неё останавливает таймер, не
// уводя с текущего экрана.
el.tbTimerStop.addEventListener('click', (e) => { e.stopPropagation(); stopTimer(); });
el.tbTimerStop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); stopTimer(); } });
el.tbStart.addEventListener('click', () => {
  const task = startableTask();
  if (task) startTimer(task.id);
});
el.tbTimer.addEventListener('click', () => {
  const task = state.activeTimer && getTask(state.activeTimer.taskId);
  if (!task) return;
  openTask(task.id);
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
el.homeEmptyCreate.addEventListener('click', () => openProjectDialog(null));
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
const openNowTask = () => { const task = nowTask(); if (task) openTask(task.id); };
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

el.pdocNew.addEventListener('click', () => {
  docFilter = state.ui.projectId || 'all';
  newDocument(state.ui.projectId);
});
// Кнопки пустых экранов вкладок проекта — те же действия, что у их «+».
el.pdocEmptyNew.addEventListener('click', () => el.pdocNew.click());
el.pverEmptyNew.addEventListener('click', () => openProjectDialog(getProject(state.ui.projectId), 'versions'));
el.projTabs.forEach((b) => b.addEventListener('click', () => {
  flushEditor();
  closeMenu();
  state.ui.projectTab = b.dataset.ptab;
  render();
  scheduleSave();
}));
el.navNewProject.addEventListener('click', () => openProjectDialog(null));
window.addEventListener('resize', () => { if (state.ui.view === 'project') renderProjectHeader(); });
// Стрелки — «назад» по истории (routeBack); крошки — переход вперёд, на
// экран, который они называют.
el.projBack.addEventListener('click', () => routeBack(() => openView('projects')));
el.crumbProjects.addEventListener('click', () => openView('projects'));
const backToProject = () => { flushEditor(); state.ui.view = 'project'; render(); scheduleSave(); };
el.taskBack.addEventListener('click', () => routeBack(backToProject));
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
// «Дублировать» на странице задачи — пунктом её меню «⋯» (13 октября 2026):
// отдельная кнопка внизу панели убрана, меню то же, что на строке списка.
el.taskMore.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (task) openTaskMenu(task, el.taskMore, { toggle: true });
});
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

// ---------- Накладные полосы прокрутки ----------
// Нативная полоса занимает место и двигает содержимое: список, выросший за край
// окна, на её ширину сужался. Поэтому у прокручиваемых областей приложения она
// скрыта (атрибут data-ovs, вид — «Скроллбар» в styles.css), а поверх
// содержимого, у правого края области, рисуется своя: дорожка .ovs-track с
// бегунком. Дорожки лежат в <body> и в разметку областей не вмешиваются:
// перерисовка списка их не стирает, а раскладка о них не знает. Вбок полосы
// нет совсем: ленты, что листаются вбок, — «края ленты», см. ниже.
//
// Дорожка видна, пока область крутят или над ней (или над самим бегунком)
// мышь, и гаснет через секунду тишины. Бегунок тянется, колесо над ним крутит
// область. Сама дорожка мышь не ловит (pointer-events: none): она лежит поверх
// содержимого, и щелчок в правых 10 px строки списка или пункта длинного меню
// должен дойти до строки или пункта; поэтому листания страницами щелчком по
// дорожке нет — как и у всякой накладной полосы, что делит место с
// содержимым. Размер и положение бегунка — от scrollHeight, clientHeight и
// scrollTop; прокручивать нечего — дорожки нет. Рисуется она, только если в точке рядом с ней сверху лежит сама
// область: закрытая окном или меню, обрезанная прокручиваемым предком — молчит.
//
// Области — списком селекторов (и текстовые поля: <textarea> с длинным текстом
// тоже листается): новые подхватывает MutationObserver, в том числе меню и
// окна, которых при загрузке ещё нет. Внутренности текста
// редактора (блоки кода, таблицы) и его подсказки сюда не входят — их скролл
// остаётся нативным, а прокручиваемая страница документа (.led-scroll) здесь.
// Что любой overflow: auto из styles.css есть в этом списке, сторожит
// tests/unit/overlay-scroll.test.js.
const OVS_AREAS = [
  '.nav-projects', '#search-results', '#notif-list', '#settings-view', '#projects-view',
  '.ptile-tasks', '.home-main', '.home-side', '.proj-side', '.proj-versions',
  '.proj-docs', '#task-list', '#tab-history', '.task-side', '.doc-list', '.led-scroll',
  '.cal-main', '.cal-days', '.cal-day', '.tp-list', '.board-cols', '.board-col-body',
  '.ag-scroll', '.ag-list', '.ag-allday-row', '.pjdlg-body', '.tmdlg', '.rpdlg',
  '.tag-pop-list', '.ctx-menu', '.ai-log', '.ai-chats', 'textarea', '.syncdlg-body', '.syncdlg-text',
].join(', ');
const OVS_IDLE = 1000;
const OVS_MIN_THUMB = 28;
const ovsAreas = new Map();      // область → её состояние
const ovsShown = new Set();      // области, у которых дорожка сейчас на экране
const ovsPending = new Set();    // области, которые пересчитать в ближайшем кадре
const ovsTracks = new WeakMap(); // дорожка → её полоса (с областью внутри)
let ovsFrame = 0;
let ovsThick = 0;

function attachOverlayScroll(box) {
  if (ovsAreas.has(box)) return;
  const area = { box, bar: null, until: 0, hot: false, drag: false, timer: 0 };
  box.setAttribute('data-ovs', '');
  // Размер области или её содержимого поменялся — положение бегунка тоже.
  area.ro = new ResizeObserver(() => ovsSchedule(area));
  area.ro.observe(box);
  area.mo = new MutationObserver(() => ovsSchedule(area));
  area.mo.observe(box, { childList: true });
  ovsAreas.set(box, area);
}

function ovsDrop(area) {
  clearTimeout(area.timer);
  area.ro.disconnect();
  area.mo.disconnect();
  if (area.bar) area.bar.track.remove();
  ovsAreas.delete(area.box);
  ovsShown.delete(area);
  ovsPending.delete(area);
}

/** Пересчёт — раз в кадр, сколько бы событий ни пришло. Заодно уходят области,
 *  которых уже нет на странице (закрытые окна и меню). */
function ovsSchedule(area) {
  if (area) ovsPending.add(area);
  if (ovsFrame) return;
  ovsFrame = requestAnimationFrame(() => {
    ovsFrame = 0;
    const todo = new Set([...ovsShown, ...ovsPending]);
    ovsPending.clear();
    for (const a of todo) ovsSync(a);
    for (const a of ovsAreas.values()) if (!a.box.isConnected) ovsDrop(a);
  });
}

/** Область потревожили (крутят, мышь над ней): показать и отсчитать секунду. */
function ovsTouch(area, resync = true) {
  area.until = performance.now() + OVS_IDLE;
  if (resync || !ovsShown.has(area)) ovsSchedule(area);
  if (area.timer) return;
  const tick = () => {
    area.timer = 0;
    const left = area.until - performance.now();
    if (left > 0) area.timer = setTimeout(tick, left);
    else ovsSchedule(area);
  };
  area.timer = setTimeout(tick, OVS_IDLE);
}

/** Дорожка области: создаётся, когда понадобилась впервые. */
function ovsBar(area) {
  if (area.bar) return area.bar;
  const { box } = area;
  const track = document.createElement('div');
  track.className = 'ovs-track';
  const thumb = document.createElement('i');
  thumb.className = 'ovs-thumb';
  track.appendChild(thumb);
  document.body.appendChild(track);
  const bar = { track, thumb, area, len: 0, thumbLen: 0, sig: '', grab: null };
  area.bar = bar;
  ovsTracks.set(track, bar);

  track.addEventListener('pointerenter', () => { area.hot = true; ovsSchedule(area); });
  track.addEventListener('pointerleave', () => { area.hot = false; ovsTouch(area); });
  // Нажатие на бегунок (его зовёт общий перехват ниже, а не он сам): пройденный
  // им путь пересчитывается в путь области. Мышь ловит только бегунок, поэтому
  // сюда доходит лишь он. Захват — на нём же: события идут ему, куда бы мышь ни
  // ушла, и всплывают к дорожке, где их слушают.
  bar.down = (e) => {
    if (e.button !== 0) return;
    bar.grab = { at: e.clientY, from: box.scrollTop, k: (box.scrollHeight - box.clientHeight) / Math.max(1, bar.len - bar.thumbLen) };
    area.drag = true;
    track.classList.add('drag');
    document.body.classList.add('ovs-dragging');
    thumb.setPointerCapture(e.pointerId);
  };
  track.addEventListener('pointermove', (e) => {
    if (bar.grab) box.scrollTop = bar.grab.from + (e.clientY - bar.grab.at) * bar.grab.k;
  });
  const release = () => {
    if (!bar.grab) return;
    bar.grab = null;
    area.drag = false;
    track.classList.remove('drag');
    document.body.classList.remove('ovs-dragging');
    ovsTouch(area);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('lostpointercapture', release);
  // Колесо над бегунком — не над областью, и само оно её не покрутит.
  track.addEventListener('wheel', (e) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
    box.scrollBy(e.deltaX * unit, e.deltaY * unit);
  }, { passive: true });
  return bar;
}

/** Положение и размер дорожки области. Пока её не показывают — ничего не мерит. */
function ovsSync(area) {
  const { box } = area;
  const live = box.isConnected && (area.drag || area.hot || performance.now() < area.until);
  const len = box.clientHeight;
  let on = live && box.scrollHeight - len > 1 && len > 0;
  let x = 0;
  let y = 0;
  if (on) {
    if (!ovsThick) ovsThick = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 10;
    const r = box.getBoundingClientRect();
    x = r.left + box.clientLeft + box.clientWidth - ovsThick;
    y = r.top + box.clientTop;
    const hit = document.elementFromPoint(x - 2, y + len / 2);
    on = !!hit && box.contains(hit);
  }
  if (!on) {
    if (area.bar) area.bar.track.classList.remove('on');
    ovsShown.delete(area);
    return;
  }
  const bar = ovsBar(area);
  const full = box.scrollHeight;
  const range = full - len;
  const thumbLen = Math.min(len, Math.max(OVS_MIN_THUMB, Math.round(len * len / full)));
  const off = Math.round(Math.min(1, Math.max(0, box.scrollTop / range)) * (len - thumbLen));
  bar.len = len;
  bar.thumbLen = thumbLen;
  const sig = [x, y, len, thumbLen, off].map(Math.round).join();
  const moved = sig !== bar.sig;
  if (moved) {
    bar.sig = sig;
    bar.track.style.left = `${Math.round(x)}px`;
    bar.track.style.top = `${Math.round(y)}px`;
    bar.track.style.height = `${Math.round(len)}px`;
    bar.thumb.style.height = `${thumbLen}px`;
    bar.thumb.style.transform = `translateY(${off}px)`;
  }
  bar.track.classList.add('on');
  ovsShown.add(area);
  // Дорожку что-то сдвинуло (прокрутка, анимация окна) — посмотрим и в следующем кадре.
  if (moved) ovsSchedule();
}

/** Подключить области, что уже есть на странице, и следить за новыми (меню, окна).
 *  Зовётся первым делом в init(): до этого нативная полоса успела бы мелькнуть. */
function watchOverlayAreas() {
  const find = (root) => {
    if (root.matches(OVS_AREAS)) attachOverlayScroll(root);
    // Внутри — ни одного элемента: искать в поддереве нечего.
    if (root.firstElementChild) root.querySelectorAll(OVS_AREAS).forEach(attachOverlayScroll);
  };
  find(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        // Текстовые узлы и собственные дорожки (они лежат в <body> и областью
        // быть не могут) не разбираем.
        if (n.nodeType === 1 && !ovsTracks.has(n)) find(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Мышь над областью или над её дорожкой — показать область и всех прокручиваемых
// предков: вложенный список лежит в странице, и у каждого своя полоса.
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  let n = e.target instanceof Element ? e.target : null;
  const own = n && n.closest('.ovs-track');
  if (own) n = ovsTracks.get(own)?.area.box || null;
  for (; n; n = n.parentElement) {
    const area = ovsAreas.get(n);
    if (area) ovsTouch(area, false);
  }
}, { passive: true });
// Меню, подсказки и пикеры закрываются щелчком «снаружи», а дорожка лежит в
// <body>, а не в них: схватить бегунок меню значило бы его закрыть. Поэтому
// события бегунка гасятся раньше всех (захват на window), а его нажатие
// обрабатывается тут же. Фокус щелчок по бегунку не уводит.
for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
  window.addEventListener(type, (e) => {
    const bar = e.target instanceof Element && ovsTracks.get(e.target.closest('.ovs-track'));
    if (!bar) return;
    e.stopPropagation();
    if (type === 'mousedown') e.preventDefault();
    if (type === 'pointerdown') bar.down(e);
  }, true);
}
// scroll не всплывает — слушаем на погружении, один обработчик на все области.
// Прокрутка предка двигает и вложенные области: показанные пересчитываем все.
document.addEventListener('scroll', (e) => {
  const area = ovsAreas.get(e.target);
  if (area) ovsTouch(area);
  if (ovsShown.size) ovsSchedule();
}, { capture: true, passive: true });
window.addEventListener('resize', () => { if (ovsShown.size) ovsSchedule(); });

// ---------- Края лент ----------
// Вбок листаются три области: лента карточек «Проектов», дорожки доски и
// переключатель режимов «Времени» на узкой ширине. Полосы вбок у них нет —
// ни накладной, ни нативной. Вместо неё край, за которым есть что листать,
// растворяется (маска на самой ленте), а у края стоит кнопка-стрелка на
// подложке; вид — «Край ленты» в styles.css. attachScrollEdges ставит на ленту
// класс .edge-scroll и атрибут data-edge — «l», «r» или «l r», с какой стороны
// есть что листать (нечего — атрибута нет) — и, если лента лежит в обёртке
// .edge-host, вписывает в неё кнопки: стрелка листает на одну карточку или
// колонку. Колесо с Shift, тачпад и перетаскивание остаются нативной
// прокруткой. Что любая лента с overflow-x есть в этом списке, сторожит
// tests/unit/overlay-scroll.test.js.
const EDGE_AREAS = [
  { box: '.projects-deck', item: '.ptile', arrows: true },
  { box: '.board-cols', item: '.board-col', arrows: true },
  { box: '.time-modes', arrows: false },
];
const edgeAreas = new Map();   // лента → её состояние
const edgePending = new Set(); // ленты, которые пересчитать в ближайшем кадре
let edgeFrame = 0;

/** Кнопка-стрелка у края ленты. side — 'l' или 'r'. Подпись переводится вместе
 *  со всей разметкой (data-i18n-aria). */
function edgeButton(side) {
  const key = side === 'l' ? 'common.scroll_left' : 'common.scroll_right';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'edge-btn';
  btn.dataset.side = side;
  btn.dataset.i18nAria = key;
  btn.setAttribute('aria-label', t(key));
  btn.innerHTML = icon(side === 'l' ? 'chevron-left' : 'chevron-right');
  return btn;
}

function attachScrollEdges(box, { item = '', arrows = false } = {}) {
  if (edgeAreas.has(box)) return;
  const area = { box, item, prev: null, next: null };
  box.classList.add('edge-scroll');
  const host = arrows && box.parentElement && box.parentElement.classList.contains('edge-host') ? box.parentElement : null;
  if (host) {
    area.prev = edgeButton('l');
    area.next = edgeButton('r');
    area.prev.addEventListener('click', () => edgeStep(area, -1));
    area.next.addEventListener('click', () => edgeStep(area, 1));
    host.insertBefore(area.prev, box);
    host.appendChild(area.next);
  }
  // Размер ленты или её содержимого поменялся (окно, боковая панель, новые
  // карточки) или её листают — края пересчитать.
  new ResizeObserver(() => edgeSchedule(area)).observe(box);
  new MutationObserver(() => edgeSchedule(area)).observe(box, { childList: true });
  box.addEventListener('scroll', () => edgeSchedule(area), { passive: true });
  edgeAreas.set(box, area);
  edgeSchedule(area);
}

/** Пересчёт — раз в кадр, сколько бы событий ни пришло. */
function edgeSchedule(area) {
  edgePending.add(area);
  if (edgeFrame) return;
  edgeFrame = requestAnimationFrame(() => {
    edgeFrame = 0;
    const todo = [...edgePending];
    edgePending.clear();
    todo.forEach(edgeSync);
  });
}

/** С каких сторон есть что листать: атрибут на ленте (от него маска) и
 *  кнопки (видна та, за которой есть карточки). */
function edgeSync(area) {
  const { box } = area;
  const room = box.scrollWidth - box.clientWidth;
  const left = room > 1 && box.scrollLeft > 1;
  const right = room > 1 && box.scrollLeft < room - 1;
  const sides = left && right ? 'l r' : left ? 'l' : right ? 'r' : '';
  if (sides) { if (box.dataset.edge !== sides) box.dataset.edge = sides; } else box.removeAttribute('data-edge');
  if (!area.prev) return;
  const focused = document.activeElement;
  area.prev.classList.toggle('on', left);
  area.next.classList.toggle('on', right);
  // Долистали — стрелка гаснет, а фокус с клавиатуры не должен пропасть вместе
  // с ней: он переходит к стрелке в обратную сторону.
  if (focused === area.next && !right && left) area.prev.focus({ preventScroll: true });
  else if (focused === area.prev && !left && right) area.next.focus({ preventScroll: true });
}

/** Листнуть ленту на одну карточку (колонку): к ближайшему левому краю
 *  карточки за текущим сдвигом, с тем же полем слева, что у ленты. */
function edgeStep(area, dir) {
  const { box } = area;
  const room = box.scrollWidth - box.clientWidth;
  const inner = box.getBoundingClientRect().left + box.clientLeft + (parseFloat(getComputedStyle(box).paddingLeft) || 0);
  const here = box.scrollLeft;
  // Левые края карточек — в координатах прокрутки; у доски с дорожками в
  // каждой дорожке свои столбцы, но стоят они в одних и тех же местах. У
  // свёрнутой дорожки столбцов на экране нет (display: none) — они не в счёт.
  const shown = [...box.querySelectorAll(area.item)].filter((n) => n.getClientRects().length);
  const stops = [...new Set(shown.map((n) => Math.round(n.getBoundingClientRect().left - inner + here)))].sort((a, b) => a - b);
  const stop = dir > 0 ? stops.find((x) => x > here + 4) : stops.reverse().find((x) => x < here - 4);
  const to = stop === undefined ? here + dir * box.clientWidth * 0.8 : stop;
  box.scrollTo({ left: Math.min(room, Math.max(0, to)), behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Подключить ленты, что лежат на странице. Зовётся первым делом в init():
 *  до этого нативная полоса успела бы мелькнуть. */
function watchScrollEdges() {
  for (const { box, ...opts } of EDGE_AREAS) {
    const n = document.querySelector(box);
    if (n) attachScrollEdges(n, opts);
  }
}
setInterval(checkReminders, 30000);

/** Строка «Дедлайн» — дата и время одним окном. Пока даты нет, время по
 *  умолчанию 18:00: срок обычно «к концу дня», а не к полуночи. «Убрать
 *  дедлайн» — в том же окне, рядом с «Готово». */
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
    // Напоминания «до дедлайна» остаются в списке и ждут нового срока
    // (строка тише); «один раз» и «повторять» от срока не зависят.
    onClear: cur ? () => { task.dueAt = null; touchTask(task); } : null,
  });
});
el.dpTimeBtn.addEventListener('click', () => {
  if (!dp.open || !dp.onTime) return;
  openTimePicker(el.dpTimeBtn, el.dpTimeBtn.textContent, (val) => {
    el.dpTimeBtn.textContent = val;
    dp.onTime(val);
  });
});
el.dpDone.addEventListener('click', closeDatePicker);
el.dpClear.addEventListener('click', () => {
  const clear = dp.onClear;
  closeDatePicker();
  if (clear) clear();
});
el.exportProjectBtn.addEventListener('click', exportProject);
el.exportCalendarBtn.addEventListener('click', exportCalendar);
el.exportPeriodBtn.addEventListener('click', openExportPeriodDialog);
el.addSessionBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSessionDialog(getTask(selectedId), null); });

/** Строка «Ставка» — маленьким окном (общее окно ввода): своя ставка задачи
 *  числом; пусто — как у проекта или общая из настроек, это и написано в
 *  поле серым. */
el.rateRow.addEventListener('click', async () => {
  const task = getTask(selectedId);
  if (!task) return;
  const unit = `${symOf(currencyOf(task.projectId))}${t('rate.per_hour')}`;
  const inherited = { ...task, rate: null };
  const res = await promptDialog({
    label: t('task.rate_dialog', { unit }),
    value: hasOwnRate(task) ? String(task.rate) : '',
    placeholder: rateValueText(inherited),
    okLabel: t('common.save'),
    validate: (v) => (v.trim() === '' || /^\d[\d\s]*([.,]\d+)?$/.test(v.trim()) ? null : t('remind.bad_number')),
  });
  if (!res || !getTask(task.id)) return;
  const v = res.value.trim();
  task.rate = v === '' ? null : parseNum(v);
  task.updatedAt = new Date().toISOString();
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
  // Выбор времени бывает открыт поверх окна даты — закрывается верхний.
  if (e.key === 'Escape' && tp.open) { closeTimePicker(); return; }
  if (e.key === 'Escape' && dp.open) { closeDatePicker(); return; }
  // Окно повторения лежит поверх окна времени работы, а оно — поверх окна
  // задачи: закрывается самое верхнее.
  // Окно «Другая версия» зовут и из окна задачи с календаря — оно выше.
  if (e.key === 'Escape' && !el.syncdlgBackdrop.hidden && el.confirmBackdrop.hidden) { closeSyncDialog(); return; }
  if (e.key === 'Escape' && !el.rpdlgBackdrop.hidden) { closeRepeatDialog(); return; }
  if (e.key === 'Escape' && !el.rmdlgBackdrop.hidden) { closeReminderDialog(); return; }
  // Esc, закрывший вопрос поверх окна (confirmDialog гасит его сам), окно
  // под вопросом не закрывает.
  if (e.key === 'Escape' && !el.sldlgBackdrop.hidden) { if (!e.defaultPrevented) closeSlotDialog(); return; }
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
// ИИ-агент — чат в острове рейла, с любого экрана (17–19 октября 2026)
// ---------------------------------------------------------------------------
// Агент предлагает, человек подтверждает. Правила — в core/ai.js: снимок
// данных для модели, свободные окна и записанное время (их модель зовёт как
// инструменты), проверка, применение и отмена предложения, пересечения, разбор
// потока, проверка и блоки вложений, фраза главного экрана (aiGreeting) и
// поиск по чатам (aiChatSearch). Здесь — сама панель: главный экран (фраза,
// поле посередине, чаты под ним) и страница чата (лента, карточки
// предложений, то же поле внизу), вызов
// функции ai-chat (supabase/functions/ai-chat — ключ модели и промпт живут
// там) и круг инструментов. Чаты лежат только в localStorage этого
// устройства, свои у каждого аккаунта: список — lancible:ai:<uid>:chats,
// сообщения чата — lancible:ai:<uid>:chat:<id>; в state и в синхронизацию они
// не попадают. Вложения не хранятся нигде: байты уходят только в тех вызовах
// хода, к которому приложены, после хода история сжимается
// (Core.aiCompactHistory), а в ленте остаётся плашка «имя · тип · размер».
// С 21 октября 2026 агент — по приглашению: без доступа вместо главного
// экрана, чата и чатов — «закрытый тест» (см. «доступ» ниже).
// Вид — «Агент» в styles.css.

const AI_URL = `${SUPABASE_URL}/functions/v1/ai-chat`;
/** Кругов инструментов подряд после одного сообщения человека. */
const AI_MAX_ROUNDS = 4;
/** Сообщений в истории чата (формат Anthropic) и строк ленты. */
const AI_HISTORY_MAX = 40;
const AI_ITEMS_MAX = 120;
/** Инструменты, которые считает ядро на месте: имя → суффикс строк шага. */
const AI_STEPS = { free_windows: 'windows', time_spent: 'spent' };
const AI_EXAMPLES = ['ai.example_1', 'ai.example_2', 'ai.example_3'];
/** Превью последнего ответа в строке списка. */
const AI_PREVIEW_MAX = 140;

const ai = {
  uid: null,        // чьи чаты сейчас загружены
  chats: [],        // список: { id, title, createdAt, updatedAt, preview, count }, свежие сверху
  chat: null,       // последний открытый чат: { id, title, createdAt, messages, items, draft }
  page: 'home',     // 'home' — главный экран (фраза, поле, чаты) | 'chat'
  pageIn: null,     // 'fwd' | 'back' — въезд страницы при следующей отрисовке
  home: { draft: null }, // набранное на главном, пока открыт чат: { text, attach, err }
  greet: null,      // фраза над полем: { key, vars } ядра (aiGreeting)
  greetSeed: Math.floor(Math.random() * 1e6), // счётчик входов на главный: фраза каждый раз другая
  closing: 0,       // таймер: панель прячется, когда рейл свернулся
  busy: false,      // идёт ответ — поле и кнопка недоступны
  busyChat: null,   // чей это ответ: человек мог уйти в список или в другой чат
  waiting: false,   // ждём слов ответа — три точки
  live: null,       // строка ленты, в которую сейчас пишет поток
  liveNode: null,
  ctrl: null,       // AbortController текущего вызова
  run: 0,           // номер разговора: aiStop() обрывает всё, что было до него
  needAuth: false,  // функция ответила 401 — показать вход
  remaining: null, limit: null, limitUntil: 0,
  born: new WeakMap(), // строка ленты → когда появилась (0 — история, без появления)
  typingAt: 0,      // когда показались три точки (волна не сбивается перерисовкой)
  followRaf: 0, followUntil: 0, // лента едет за растущим ответом
  attach: [],       // вложения в поле: { id, name, size, kind, mediaType, bytes, data, text, url }
  attachErr: null,  // { key, params } — строка у поля
  attachBusy: 0,    // сколько файлов ещё читается
  attachGen: 0,     // поле очистили — недочитанное в него уже не ляжет
  asking: new WeakSet(), // карточки, по которым открыт вопрос о пересечениях
  dragDepth: 0,     // перетаскивание файлов над панелью
  access: new Map(), // uid → true | false | null: ответ ai_has_access в этот запуск (null — сеть не ответила)
  accessAsk: null,  // { uid, p } — идущий вопрос
  accessFocus: false, // панель открылась раньше ответа: поле получит фокус, когда он придёт
  req: { uid: null, id: null, sending: false, err: null }, // «Запросить доступ»: id — один на попытку и её повторы
};
/** Дольше самого долгого появления в ленте (карточка — 0,3 с). */
const AI_IN_MS = 320;

const aiIndexKey = (id) => `lancible:ai:${id}:chats`;
const aiChatKey = (id, chatId) => `lancible:ai:${id}:chat:${chatId}`;
/** Одиночная история до 18 октября 2026 — переносится первым чатом. */
const aiLegacyKey = (id) => `lancible:ai:${id}`;
const aiSignedIn = () => !!currentUser && !ai.needAuth;
const aiBlocks = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);
const aiHasText = (m) => aiBlocks(m.content).some((b) => b && b.type === 'text' && String(b.text || '').trim());
const aiIsAttachBlock = (b) => !!b && (b.type === 'image' || b.type === 'document');
const aiTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

// --- чаты: хранение -------------------------------------------------------------

function aiRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { console.warn('Чат агента не прочитался:', err); return null; }
}

function aiWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { console.warn('Чат агента не сохранился:', err); return false; }
}

function aiForget(key) {
  try { localStorage.removeItem(key); } catch { /* хранилище недоступно */ }
}

/** «Удалить данные аккаунта с устройства»: все чаты аккаунта id — список,
 *  сообщения каждого чата (и тех, что выпали из списка, но остались),
 *  одиночная история до 18 октября и отметка «запрос доступа ушёл». Чаты
 *  этого аккаунта открыты в панели — она пустеет. */
function aiForgetAccount(id) {
  if (!id) return;
  const prefix = aiChatKey(id, '');
  const keys = [aiIndexKey(id), aiLegacyKey(id), aiRequestedKey(id)];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
  } catch { /* хранилище недоступно */ }
  for (const k of keys) aiForget(k);
  if (ai.uid === id) {
    aiStop();
    aiLoad(null);
  }
}

/** Список по правилам ядра (aiChatsNormalize: свежие сверху, не больше ста)
 *  и сразу в хранилище. Выпавшие из списка чаты уходят и из хранилища — иначе
 *  их сообщения лежали бы ничьими. Ядро не разобрало — список как есть. */
function aiSetChats(list) {
  let next;
  try { next = Core.aiChatsNormalize(list) || []; } catch (err) {
    console.error('Список чатов не разобрался:', err);
    ai.chats = list.filter((c) => c && c.id);
    return;
  }
  const keep = new Set(next.map((c) => c.id));
  for (const c of list) if (c && c.id && !keep.has(c.id)) aiForget(aiChatKey(ai.uid, c.id));
  ai.chats = next;
  if (ai.uid) aiWrite(aiIndexKey(ai.uid), next);
}

/** Строка списка: название, превью последнего ответа (нет ответа — своего
 *  сообщения), сколько сообщений и когда. */
function aiIndexEntry(chat, at) {
  const msgs = chat.items.filter((it) => it.kind === 'msg');
  const said = [...msgs].reverse();
  const last = said.find((it) => it.role !== 'user' && String(it.text || '').trim()) || said.find((it) => String(it.text || '').trim());
  return { id: chat.id, title: chat.title, createdAt: chat.createdAt || at, updatedAt: at, preview: aiPreview(last ? last.text : ''), count: msgs.length };
}

/** Превью — одной строкой: без разметки списков и выделения, без управляющих
 *  символов (aiCleanText). */
function aiPreview(text) {
  const plain = String(text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*- /gm, '').replace(/\s+/g, ' ').trim();
  try { return Core.aiCleanText(plain, AI_PREVIEW_MAX); } catch { return plain.slice(0, AI_PREVIEW_MAX); }
}

/** Название чата — из первого сообщения (Core.aiChatTitle); без текста —
 *  по первому вложению. */
function aiTitleOf(text, files) {
  const pick = (s) => { try { return Core.aiChatTitle(s) || ''; } catch { return ''; } };
  return pick(text || '') || (files && files[0] ? pick(files[0].name) : '');
}

/** Сообщения для localStorage: байтов вложений там нет никогда. Завершённые
 *  ходы сжимает ядро (aiCompactHistory); вложения хода, который ещё идёт,
 *  остаются только в памяти — в хранилище вместо них отметка. */
function aiStorable(messages) {
  let out = messages;
  try { out = Core.aiCompactHistory(messages) || messages; } catch (err) { console.warn('История агента не сжалась:', err); }
  return out.map((m) => {
    const blocks = aiBlocks(m.content);
    if (!blocks.some(aiIsAttachBlock)) return m;
    return { ...m, content: blocks.map((b) => (aiIsAttachBlock(b) ? { type: 'text', text: `[вложение «${b.title || ''}» не сохранено — его нужно приложить заново]` } : b)) };
  });
}

/** Чаты аккаунта и перенос прежней одиночной истории. */
function aiLoad(id) {
  aiDropDraft(ai.home);
  aiDropDraft(ai.chat);
  aiSearchCache.clear();
  ai.uid = id;
  ai.chats = [];
  ai.chat = null;
  ai.page = 'home';
  ai.pageIn = null;
  if (!id) return;
  const raw = aiRead(aiIndexKey(id));
  let list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.chats) ? raw.chats : [];
  const legacy = aiRead(aiLegacyKey(id));
  if (legacy) list = aiMigrate(id, legacy, list);
  aiSetChats(list);
}

/** Прежняя одиночная история (до 18 октября 2026) — первым чатом списка; сама
 *  она уходит. Не записалось (хранилище полно) — остаётся до следующего раза. */
function aiMigrate(id, legacy, list) {
  const messages = Array.isArray(legacy.messages) ? legacy.messages : [];
  const items = Array.isArray(legacy.items) ? legacy.items.filter((it) => it && it.kind !== 'error') : [];
  if (!messages.length && !items.length) { aiForget(aiLegacyKey(id)); return list; }
  const at = Number.isNaN(Date.parse(legacy.updatedAt)) ? new Date().toISOString() : new Date(legacy.updatedAt).toISOString();
  const first = items.find((it) => it.kind === 'msg' && it.role === 'user');
  const chat = { id: uid(), title: aiTitleOf(first ? first.text : ''), createdAt: at, messages, items };
  if (!aiWrite(aiChatKey(id, chat.id), { title: chat.title, createdAt: at, updatedAt: at, messages: aiStorable(messages), items })) return list;
  const next = [...list, aiIndexEntry(chat, at)];
  if (!aiWrite(aiIndexKey(id), next)) { aiForget(aiChatKey(id, chat.id)); return list; }
  aiForget(aiLegacyKey(id));
  return next;
}

/** Тексты чатов для поиска в шапке: id → { at, texts } — прочитанное из
 *  хранилища помнится, пока у чата тот же updatedAt, и каждая буква запроса
 *  не разбирает все чаты заново. */
const aiSearchCache = new Map();

/** Чаты текущего аккаунта, где встретился запрос, — по названию и тексту
 *  сообщений (Core.aiChatSearch). Чаты лежат только на этом устройстве.
 *  Агент закрыт (или ответа о доступе ещё нет — тогда вопрос уходит, и поиск
 *  перерисуется с ответом) — чаты не находятся. */
function aiSearchChats(q) {
  if (!ai.uid || !ai.chats.length) return [];
  const access = aiAccess();
  if (access === 'wait') aiCheckAccess();
  if (access !== 'open') return [];
  const list = ai.chats.map((c) => {
    let hit = aiSearchCache.get(c.id);
    if (!hit || hit.at !== c.updatedAt) {
      const chat = aiChatById(c.id);
      const texts = chat ? chat.items.filter((it) => it.kind === 'msg' && it.text).map((it) => String(it.text)) : [];
      hit = { at: c.updatedAt, texts };
      aiSearchCache.set(c.id, hit);
    }
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, texts: hit.texts };
  });
  try { return Core.aiChatSearch(list, q) || []; } catch (err) { console.warn('Поиск по чатам не вышел:', err); return []; }
}

/** Чат из хранилища. Тот, на который сейчас идёт ответ, — живой, из памяти. */
function aiChatById(id) {
  if (ai.busyChat && ai.busyChat.id === id) return ai.busyChat;
  if (ai.chat && ai.chat.id === id) return ai.chat;
  const entry = ai.chats.find((c) => c.id === id);
  if (!entry) return null;
  const rec = aiRead(aiChatKey(ai.uid, id)) || {};
  return {
    id,
    title: entry.title || rec.title || '',
    createdAt: entry.createdAt || rec.createdAt || null,
    messages: Array.isArray(rec.messages) ? rec.messages : [],
    items: Array.isArray(rec.items) ? rec.items.filter((it) => it && it.kind !== 'error') : [],
  };
}

/** История чата не длиннее AI_HISTORY_MAX сообщений. Начинается она всегда с
 *  сообщения человека с текстом и без tool_result: ответ на инструмент, чей
 *  вызов срезан, модель не примет. */
function aiTrim(chat) {
  const m = chat.messages;
  let start = Math.max(0, m.length - AI_HISTORY_MAX);
  while (start < m.length - 1 && !(m[start].role === 'user' && aiHasText(m[start]))) start += 1;
  if (start > 0) {
    chat.messages = m.slice(start);
    const first = chat.messages[0];
    if (first.role === 'user') first.content = aiBlocks(first.content).filter((b) => b && b.type !== 'tool_result');
  }
  if (chat.items.length > AI_ITEMS_MAX) chat.items = chat.items.slice(-AI_ITEMS_MAX);
}

/** Чат — в хранилище, его строка — наверх списка. Черновик (ещё ничего не
 *  отправлено) не хранится. */
function aiSave(chat) {
  const c = chat || ai.chat;
  if (!ai.uid || !c || !c.id) return;
  aiTrim(c);
  const at = new Date().toISOString();
  const items = c.items.filter((it) => it.kind !== 'error');
  aiWrite(aiChatKey(ai.uid, c.id), { title: c.title, createdAt: c.createdAt, updatedAt: at, messages: aiStorable(c.messages), items });
  aiSetChats([aiIndexEntry(c, at), ...ai.chats.filter((x) => x.id !== c.id)]);
  if (!el.aiPanel.hidden && ai.page === 'home' && aiReady()) aiRenderList();
}

/** Вход, выход, смена языка (зовёт renderAccountBtn). Другой аккаунт — свои
 *  чаты; выход их не стирает, панель просто встаёт в состояние входа.
 *  Доступ нового аккаунта спрашивается сразу, если панель открыта или у него
 *  есть чаты на устройстве (поиск); иначе — при открытии панели. */
function aiAccountChanged() {
  const id = currentUser ? currentUser.id : null;
  if (id !== ai.uid) {
    aiStop();
    aiClearAttach();
    el.aiInput.value = '';
    aiLoad(id);
    ai.remaining = null;
    ai.limit = null;
    ai.limitUntil = 0;
    if (id && (aiOpen() || ai.chats.length)) aiCheckAccess();
  }
  ai.needAuth = false;
  aiRender();
}

/** Что уже лежит в ленте — история: при открытии чата и смене аккаунта она
 *  стоит сразу, появляется только новое (aiAppear). */
function aiHush(chat) {
  const c = chat || ai.chat;
  if (!c) return;
  for (const it of c.items) if (!ai.born.has(it)) ai.born.set(it, 0);
}

/** Оборвать текущий ответ: вызов, поток и круг инструментов. */
function aiStop() {
  ai.run += 1;
  if (ai.ctrl) { try { ai.ctrl.abort(); } catch { /* уже оборван */ } }
  ai.ctrl = null;
  if (ai.live && ai.busyChat) ai.busyChat.items = ai.busyChat.items.filter((it) => it !== ai.live);
  ai.live = null;
  ai.liveNode = null;
  ai.waiting = false;
  ai.busy = false;
  ai.busyChat = null;
}

// --- доступ: закрытый тест (21 октября 2026) ----------------------------------------
//
// Доступ выдаёт владелец строкой с почтой в public.ai_access
// (supabase/ai-access.sql). Клиент узнаёт его RPC ai_has_access(): при
// открытии панели, после входа и смены аккаунта — если панель открыта или у
// аккаунта есть чаты на устройстве (их ищет поиск в шапке). Ответ помнится по
// аккаунту в памяти (ai.access): следующее открытие сразу рисует прежнее, а
// вопрос уходит снова тихо; ответа ещё не было — скелет #ai-wait, не поле.
// Функция ai-chat проверяет то же сама: 403 no access посреди чата — тоже
// «закрытый тест». Без доступа вместо главного экрана, чата и чатов — #ai-locked
// с «Запросить доступ»: строка feedback (kind other, почта аккаунта) тем же
// путём, что форма обратной связи (feedbackRow, fbInsert, проверки вкладки и
// сеанса); ушедший запрос помнится по аккаунту на устройстве. Чаты на
// устройстве не стираются — вернутся вместе с доступом. Гостю агент, как и
// раньше, предлагает войти.

const aiRequestedKey = (id) => `lancible:ai:${id}:access-requested`;

/** Доступ текущего аккаунта: 'open' | 'locked' | 'wait' (ответа ещё не было).
 *  Сеть не ответила — агент как раньше: решит сама функция (403 → 'locked'). */
function aiAccess() {
  const id = currentUser && currentUser.id;
  if (!id || !ai.access.has(id)) return 'wait';
  return ai.access.get(id) === false ? 'locked' : 'open';
}
/** Вошёл и агент ему открыт: главный экран, чат, поле и вложения. */
const aiReady = () => aiSignedIn() && aiAccess() === 'open';

/** Спросить базу (ai_has_access) про текущий аккаунт; один вопрос на аккаунт
 *  за раз. База ответила отказом (4xx: функции ещё нет — закрыто для всех,
 *  как у ai-chat) — доступа нет; не ответила (нет сети, 5xx) — прежний ответ
 *  остаётся, а без него агент открыт (решит функция); 401 — вход. Вкладка
 *  отстала или сеанс в хранилище чужой — не спрашиваем: ответ был бы про
 *  другой аккаунт (а агент такой вкладке и так откажет — aiCall). */
function aiCheckAccess() {
  const id = currentUser && currentUser.id;
  if (!id) return Promise.resolve();
  if (ai.accessAsk && ai.accessAsk.uid === id) return ai.accessAsk.p;
  const ask = { uid: id, p: null };
  ask.p = (async () => {
    let ok = null;
    let signin = false;
    try {
      const sid = scopeStale ? null : await sessionUid();
      if (scopeStale || (sid && sid !== id)) throw new Error('сеанс другого аккаунта');
      const { data, error, status } = await sb.rpc('ai_has_access');
      if (!error) ok = data === true;
      else if (status === 401) signin = true;
      else if (status >= 400 && status < 500) ok = false;
      else console.warn('Доступ к агенту не узнать:', error);
    } catch (err) { console.warn('Доступ к агенту не узнать:', err); }
    if (ai.accessAsk === ask) ai.accessAsk = null;
    const mine = !!currentUser && currentUser.id === id;
    if (signin) { if (mine) { ai.needAuth = true; aiRender(); } return; }
    if (ok === null && ai.access.has(id)) return;
    aiSetAccess(id, ok);
  })();
  ai.accessAsk = ask;
  return ask.p;
}

/** Ответ про доступ аккаунта id. Сменился у того, кто на экране, — панель и
 *  поиск перерисовываются; закрылся посреди ответа — ответ обрывается. */
function aiSetAccess(id, ok) {
  const mine = () => !!currentUser && currentUser.id === id;
  const was = mine() ? aiAccess() : null;
  ai.access.set(id, ok);
  if (!mine()) return;
  const now = aiAccess();
  if (now === was) return;
  if (now === 'locked') aiStop();
  aiRender(true);
  if (now === 'open' && !el.aiPanel.hidden) {
    aiHelloIn();
    // Панель открылась раньше ответа: фокус — в поле, если человек не ушёл.
    const a = document.activeElement;
    if (ai.accessFocus && (!a || a === document.body || aiButtons().includes(a) || el.aiPanel.contains(a))) el.aiInput.focus({ preventScroll: true });
  }
  ai.accessFocus = false;
  if (!el.searchPanel.hidden) renderSearch(el.searchInput.value);
}

/** Запрос этого аккаунта уже ушёл (с этого устройства). */
const aiRequested = () => !!currentUser && !!aiRead(aiRequestedKey(currentUser.id));

/** «Закрытый тест»: запрос ушёл — «Запрос отправлен», кнопка неактивна;
 *  ошибка — строкой с «Повторить» (feedback.rate или ai.request_failed: на этом
 *  экране нет поля, и «Текст сохранён» из feedback.failed был бы неправдой). */
function aiRenderLocked() {
  const sent = aiRequested();
  const err = !sent && currentUser && ai.req.uid === currentUser.id ? ai.req.err : null;
  setI18nText(el.aiRequest, sent ? 'ai.request_sent' : 'ai.request_access');
  el.aiRequest.disabled = sent || ai.req.sending;
  el.aiRequestError.hidden = !err;
  if (err) setI18nText(el.aiRequestErrorText, err);
  el.aiRequestRetry.disabled = ai.req.sending;
}

/** «Запросить доступ»: строка feedback «Запрос доступа к ИИ-агенту: <почта>»
 *  от вошедшего — тем же путём, что форма обратной связи: отставшая вкладка
 *  и чужой сеанс не шлют, повтор — та же запись (23505), частоту держит база. */
async function aiRequestAccess() {
  const who = currentUser;
  if (!who || ai.req.sending || aiRequested() || staleGuard()) return;
  if (ai.req.uid !== who.id) Object.assign(ai.req, { uid: who.id, id: null, err: null });
  if (!ai.req.id) ai.req.id = fbUuid();
  ai.req.sending = true;
  ai.req.err = null;
  aiRenderLocked();
  try {
    if (await foreignSession()) return;
    await fbInsert(await feedbackRow(`Запрос доступа к ИИ-агенту: ${who.email || ''}`, null, { id: ai.req.id, kind: 'other', userId: who.id }));
    aiWrite(aiRequestedKey(who.id), new Date().toISOString());
    if (ai.req.uid === who.id) ai.req.id = null;
  } catch (err) {
    console.error('Запрос доступа к агенту не ушёл:', err);
    if (ai.req.uid === who.id) ai.req.err = fbRateLimited(err) ? 'feedback.rate' : 'ai.request_failed';
  } finally {
    ai.req.sending = false;
    if (!el.aiPanel.hidden && !el.aiLocked.hidden) aiRenderLocked();
  }
}

// --- главный экран, чат и переходы ------------------------------------------------
//
// Страниц две: главный экран (ai.page 'home') — сценка и фраза над полем,
// поле посередине, под ним чаты; и чат ('chat') — лента и то же поле внизу.
// Поле одно: уходя со страницы, её набранное и вложения уезжают с ней
// (aiStash), приходя — возвращаются (aiUnstash). Отправка с главного заводит
// новый чат и открывает его без въезда (aiFlowIn); из списка — въезд справа.

/** Фраза над полем — ядра (Core.aiGreeting): каждый вход на главный экран —
 *  следующий seed, фраза другая; имя — из профиля. */
function aiNextGreeting() {
  ai.greetSeed += 1;
  try {
    ai.greet = Core.aiGreeting({ now: Date.now(), name: (currentUser && currentUser.name) || '', seed: ai.greetSeed });
  } catch (err) {
    console.warn('Фраза агента не собралась:', err);
    ai.greet = null;
  }
}

/** Сценка главного экрана «дышит» при каждом входе (.ai-breathe, вид —
 *  «Агент» в styles.css); без движения — стоит. */
function aiHelloIn() {
  el.aiHello.classList.remove('ai-breathe');
  if (el.aiPanel.hidden || el.aiHello.hidden || reducedMotion()) return;
  void el.aiHello.offsetWidth;
  el.aiHello.classList.add('ai-breathe');
}

/** Набранное и вложения уходящей страницы — с ней (owner — ai.home или чат). */
function aiStash(owner) {
  if (!owner) return;
  owner.draft = { text: el.aiInput.value, attach: ai.attach, err: ai.attachErr };
  ai.attach = [];
  ai.attachErr = null;
  ai.attachBusy = 0;
  ai.attachGen += 1;
  el.aiInput.value = '';
}

/** Своё набранное и вложения — в поле пришедшей страницы. */
function aiUnstash(owner) {
  const d = owner && owner.draft;
  if (owner) owner.draft = null;
  el.aiInput.value = d ? d.text : '';
  ai.attach = d ? d.attach : [];
  ai.attachErr = d ? d.err : null;
}

/** Черновик больше не нужен (открыли другой чат, удалили этот, сменился
 *  аккаунт): миниатюры его вложений освобождаются. */
function aiDropDraft(owner) {
  const d = owner && owner.draft;
  if (d) for (const it of d.attach) if (it.url) URL.revokeObjectURL(it.url);
  if (owner) owner.draft = null;
}

/** Чат из списка или из поиска — въезд справа. Набранное на главном ждёт
 *  там; у чата — своё, если в нём уже что-то набирали. */
function aiOpenChat(id) {
  // Без доступа чат не открывается: на его месте — «закрытый тест».
  if (!aiReady()) { aiRender(); return; }
  const chat = aiChatById(id);
  if (!chat) return;
  if (ai.page === 'chat' && ai.chat === chat) return;
  aiStash(ai.page === 'chat' ? ai.chat : ai.home);
  if (ai.chat && ai.chat !== chat) aiDropDraft(ai.chat);
  ai.chat = chat;
  aiUnstash(chat);
  aiHush(chat);
  aiGo('chat');
  usageSend('agent.chat');
  if (!ai.busy) el.aiInput.focus({ preventScroll: true });
}

/** Назад, на главный экран. Чат остаётся в памяти: вернулись в него — поле и
 *  вложения на месте. Фокус — на строку чата, из которого ушли. */
function aiBack() {
  const from = ai.chat && ai.chat.id;
  aiGoHome();
  const row = from && el.aiChats.querySelector(`.ai-row[data-id="${CSS.escape(from)}"] .ai-row-open`);
  (row || el.aiInput).focus({ preventScroll: true });
}

/** С чата на главный экран — въезд слева, фраза новая. */
function aiGoHome() {
  if (ai.page === 'chat') aiStash(ai.chat);
  aiUnstash(ai.home);
  aiNextGreeting();
  aiGo('home');
  aiHelloIn();
  usageSend('agent');
}

/** Страница панели и её въезд: в чат — справа, на главный — слева. */
function aiGo(page) {
  ai.pageIn = page === ai.page ? null : page === 'chat' ? 'fwd' : 'back';
  ai.page = page;
  aiRender(true);
}

/** С поля главного экрана — в только что заведённый чат, без въезда
 *  страницы: лента проявляется, поле едет вниз со своего прежнего места top0
 *  (.ai-log-in, .ai-compose-down с --ai-dy; вид — «Агент» в styles.css). */
function aiFlowIn(top0) {
  el.aiLog.classList.remove('ai-log-in');
  el.aiCompose.classList.remove('ai-compose-down');
  if (reducedMotion() || el.aiLog.hidden) return;
  const dy = top0 - el.aiCompose.getBoundingClientRect().top;
  void el.aiLog.offsetWidth;
  el.aiLog.classList.add('ai-log-in');
  if (Math.abs(dy) < 1) return;
  el.aiCompose.style.setProperty('--ai-dy', `${Math.round(dy)}px`);
  el.aiCompose.classList.add('ai-compose-down');
}

async function aiDeleteChat(id) {
  const entry = ai.chats.find((c) => c.id === id);
  if (!entry) return;
  const ok = await confirmDialog(t('ai.delete_chat_text', { name: entry.title || t('ai.new_chat') }), { title: t('ai.delete_chat_q') });
  if (!ok || !ai.chats.some((c) => c.id === id)) return;
  if (ai.busyChat && ai.busyChat.id === id) aiStop();
  aiForget(aiChatKey(ai.uid, id));
  aiSearchCache.delete(id);
  aiSetChats(ai.chats.filter((c) => c.id !== id));
  if (ai.chat && ai.chat.id === id) {
    const open = ai.page === 'chat';
    aiDropDraft(ai.chat);
    ai.chat = null;
    if (open) {
      aiClearAttach();
      el.aiInput.value = '';
      aiGoHome();
      el.aiInput.focus({ preventScroll: true });
      return;
    }
  }
  aiRender();
}

/** «сегодня 14:20», «вчера», «12 окт.»; прошлый год — с годом. */
function aiChatWhen(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 86400000);
  if (ago === 0) return t('ai.when_today', { time: hhmm(ms) });
  if (ago === 1) return t('ai.when_yesterday');
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(locale(), opts);
}

/** Чаты под полем главного экрана; чатов нет — что умеет агент и примеры. */
function aiRenderList() {
  if (el.aiList.hidden) return;
  el.aiListLabel.hidden = !ai.chats.length;
  if (!ai.chats.length) { el.aiChats.replaceChildren(aiExamplesNode()); return; }
  el.aiChats.replaceChildren(...ai.chats.map(aiChatRow));
}

/** Строка чата: название и время, под ними превью и число сообщений; «⋯» —
 *  удалить (с подтверждением). */
function aiChatRow(c) {
  const row = elt('div', 'ai-row');
  row.dataset.id = c.id;
  const open = elt('button', 'ai-row-open');
  open.type = 'button';
  const top = elt('span', 'ai-row-top');
  top.append(elt('span', 'ai-row-title', c.title || t('ai.new_chat')), elt('span', 'ai-row-when', aiChatWhen(c.updatedAt)));
  const sub = elt('span', 'ai-row-sub');
  const n = Number(c.count) || 0;
  sub.append(elt('span', 'ai-row-preview', c.preview || ''), elt('span', 'ai-row-count', t('ai.chat_count', { n, plural: pluralForm(n, 'plural.message') })));
  open.append(top, sub);
  open.addEventListener('click', () => aiOpenChat(c.id));
  const more = elt('button', 'icon-btn ai-row-more');
  more.type = 'button';
  more.title = t('ai.menu');
  more.setAttribute('aria-label', t('ai.menu'));
  more.innerHTML = icon('kebab');
  more.addEventListener('click', () => openMenu(more, [{ label: t('ai.delete_chat'), danger: true, onClick: () => aiDeleteChat(c.id) }], { toggle: true }));
  row.append(open, more);
  return row;
}

// --- панель ------------------------------------------------------------------

/** Кнопки агента: в рейле и — на узком вебе, где рейла нет, — в нижней плашке. */
const aiButtons = () => [el.aiBtn, el.mobileAiBtn].filter(Boolean);
/** Узкий веб: чат поверх во всю ширину (web/responsive.css). */
const aiNarrow = () => IS_WEB && window.matchMedia('(max-width: 560px)').matches;
const aiOpen = () => document.body.classList.contains('ai-open');

/** Чат открывается на главном экране: остров рейла раскрывается вправо
 *  (body.ai-open, вид — «Каркас» и «Агент» в styles.css), панель — в нём. */
function openAiPanel() {
  clearTimeout(ai.closing);
  ai.closing = 0;
  el.aiPanel.inert = false;
  el.aiPanel.hidden = false;
  document.body.classList.add('ai-open');
  for (const b of aiButtons()) {
    b.classList.add('on');
    b.setAttribute('aria-expanded', 'true');
  }
  if (ai.page === 'chat') { aiStash(ai.chat); aiUnstash(ai.home); }
  ai.page = 'home';
  ai.pageIn = null;
  aiNextGreeting();
  aiRender(true);
  aiHelloIn();
  // Доступ — при каждом открытии: прежний ответ уже нарисован, новый
  // перерисует, только если он другой (aiSetAccess).
  ai.accessFocus = aiSignedIn() && aiAccess() === 'wait';
  if (aiReady()) el.aiInput.focus({ preventScroll: true });
  if (currentUser) aiCheckAccess();
  usageSend('agent');
}

/** Закрыть: рейл сворачивается тем же ходом, панель прячется, когда он
 *  доехал (без движения и на узком вебе — сразу), а пока едет — inert. */
function closeAiPanel() {
  if (!aiOpen()) return;
  const inside = el.aiPanel.contains(document.activeElement);
  document.body.classList.remove('ai-open');
  el.aiPanel.classList.remove('ai-drop');
  ai.dragDepth = 0;
  for (const b of aiButtons()) {
    b.classList.remove('on');
    b.setAttribute('aria-expanded', 'false');
  }
  el.aiPanel.inert = true;
  const hide = () => { ai.closing = 0; el.aiPanel.hidden = true; el.aiPanel.inert = false; };
  const rides = parseFloat(getComputedStyle(el.navrail).transitionDuration) > 0;
  clearTimeout(ai.closing);
  if (reducedMotion() || aiNarrow() || !rides) hide();
  else ai.closing = setTimeout(hide, 260);
  if (inside) (aiNarrow() && el.mobileAiBtn ? el.mobileAiBtn : el.aiBtn).focus({ preventScroll: true });
}

const toggleAiPanel = () => (aiOpen() ? closeAiPanel() : openAiPanel());

/** Чат из поиска в шапке: панель открывается, если закрыта, и в ней — чат. */
function aiShowChat(id) {
  if (!aiOpen()) openAiPanel();
  aiOpenChat(id);
}

/** Панель целиком: вход, скелет (ждём ответа о доступе), «закрытый тест»,
 *  главный экран или чат. Закрытая — не рисуется. */
function aiRender(stick) {
  if (el.aiPanel.hidden) return;
  const signed = aiSignedIn();
  const access = signed ? aiAccess() : null;
  const ready = access === 'open';
  if (ai.page === 'chat' && !ai.chat) ai.page = 'home';
  const chat = ready && ai.page === 'chat' ? ai.chat : null;
  const home = ready && !chat;
  el.aiSignin.hidden = signed;
  el.aiWait.hidden = access !== 'wait';
  el.aiLocked.hidden = access !== 'locked';
  el.aiBody.hidden = !ready;
  el.aiBody.dataset.page = chat ? 'chat' : 'home';
  el.aiHello.hidden = !home;
  el.aiList.hidden = !home;
  el.aiLog.hidden = !chat;
  el.aiBack.hidden = !chat;
  el.aiMore.hidden = !chat || !chat.id;
  el.aiTitle.textContent = chat ? chat.title || t('ai.new_chat') : t('ai.title');
  el.aiPanel.dataset.drop = t('ai.drop_hint');
  aiRenderQuota();
  if (chat) aiRenderLog(stick);
  else if (home) { aiRenderHello(); aiRenderList(); }
  if (ready) { aiRenderAttach(); aiSyncCompose(); }
  if (access === 'locked') aiRenderLocked();
  aiPageIn();
}

/** Фраза над полем: ключ — ядра, слова — языка интерфейса. */
function aiRenderHello() {
  if (!ai.greet) aiNextGreeting();
  el.aiPhrase.textContent = ai.greet ? t(ai.greet.key, ai.greet.vars) : t('ai.title');
}

/** Въезд страницы (.ai-page-fwd / .ai-page-back, вид — «Агент» в styles.css);
 *  без движения — сразу на месте. */
function aiPageIn() {
  const dir = ai.pageIn;
  ai.pageIn = null;
  el.aiBody.classList.remove('ai-page-fwd', 'ai-page-back');
  if (!dir || el.aiBody.hidden || reducedMotion()) return;
  el.aiLog.classList.remove('ai-log-in');
  el.aiCompose.classList.remove('ai-compose-down');
  void el.aiBody.offsetWidth;
  el.aiBody.classList.add(dir === 'fwd' ? 'ai-page-fwd' : 'ai-page-back');
}

/** «47 из 50 сегодня» — после первого ответа функции; в шапке и списка, и чата. */
function aiRenderQuota() {
  const show = aiReady() && ai.remaining !== null && ai.limit !== null;
  el.aiQuota.hidden = !show;
  if (show) el.aiQuota.textContent = t('ai.quota', { remaining: ai.remaining, limit: ai.limit });
}

/** Поле растёт с текстом до шести строк (потолок — max-height в стилях).
 *  Отправить можно текст, вложения или то и другое; пока файлы читаются —
 *  нельзя. */
function aiSyncCompose() {
  el.aiInput.disabled = ai.busy;
  el.aiAttach.disabled = ai.busy;
  el.aiSend.disabled = ai.busy || ai.attachBusy > 0 || (!el.aiInput.value.trim() && !ai.attach.length);
  if (el.aiPanel.hidden || el.aiBody.hidden) return;
  el.aiInput.style.height = 'auto';
  el.aiInput.style.height = `${el.aiInput.scrollHeight}px`;
}

function aiSetBusy(on) {
  ai.busy = on;
  if (!on) { ai.waiting = false; ai.busyChat = null; }
  aiSyncCompose();
  aiRenderLog();
  // Поле было недоступно и фокус потеряло — вернуть, если человек не ушёл.
  if (!on && !el.aiPanel.hidden && !el.aiBody.hidden && aiReady()
    && (document.activeElement === document.body || el.aiPanel.contains(document.activeElement))) {
    el.aiInput.focus({ preventScroll: true });
  }
}

// --- лента -------------------------------------------------------------------

/** Текст модели — только текстом: экранируется весь, абзацы — по пустой
 *  строке, строки «- …» — списком, звёздочки выделения снимаются. Никакой
 *  разметки из ответа на страницу не попадает. */
function aiTextHtml(text) {
  const out = [];
  for (const block of String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let para = [];
    let list = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
    const flushList = () => { if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`); list = []; };
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const clean = escapeHtml(line.replace(/\*\*(.+?)\*\*/g, '$1'));
      const item = line.match(/^\s*- (.*)$/);
      if (item) { flushPara(); list.push(escapeHtml(item[1].replace(/\*\*(.+?)\*\*/g, '$1'))); } else { flushList(); para.push(clean); }
    }
    flushPara();
    flushList();
  }
  return out.join('');
}

function aiRenderLog(stick) {
  if (el.aiPanel.hidden || el.aiLog.hidden || !ai.chat) return;
  const chat = ai.chat;
  const answering = ai.busy && ai.busyChat === chat;
  const log = el.aiLog;
  const atEnd = stick || log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  ai.liveNode = null;
  const nodes = [];
  const lastApplied = aiLastApplied(chat);
  for (const it of chat.items) {
    const n = aiItemNode(it, lastApplied);
    if (n) nodes.push(aiAppear(n, it));
  }
  if (answering && ai.waiting) nodes.push(aiTypingNode());
  else ai.typingAt = 0;
  log.replaceChildren(...nodes);
  if (atEnd) log.scrollTop = log.scrollHeight;
}

/** Новое в ленте появляется (.ai-in, вид — «Агент» в styles.css): человек
 *  справа снизу, модель слева, карточка поднимается. Лента перерисовывается
 *  целиком, поэтому строка помнит не узел, а когда появилась (ai.born):
 *  перерисованная посреди появления доигрывает его с того же места (--ai-t),
 *  после — стоит. История (aiHush) и «без движения» — сразу на месте. */
function aiAppear(node, it) {
  let at = ai.born.get(it);
  if (at === undefined) {
    at = reducedMotion() ? 0 : animNow();
    ai.born.set(it, at);
  }
  const age = animNow() - at;
  if (at && age < AI_IN_MS) {
    node.classList.add('ai-in');
    node.style.setProperty('--ai-t', `${-Math.round(age)}ms`);
  }
  return node;
}

/** Чатов ещё нет: под полем главного экрана — что умеет агент и три
 *  примера; щелчок подставляет пример в поле. */
function aiExamplesNode() {
  const box = elt('div', 'ai-intro');
  box.append(elt('p', 'ai-hint', t('ai.empty_hint')));
  const list = elt('div', 'ai-examples');
  for (const key of AI_EXAMPLES) {
    const b = elt('button', 'ghost', t(key));
    b.type = 'button';
    b.addEventListener('click', () => {
      el.aiInput.value = t(key);
      aiSyncCompose();
      el.aiInput.focus({ preventScroll: true });
    });
    list.append(b);
  }
  box.append(list);
  return box;
}

function aiTypingNode() {
  const n = elt('div', 'ai-typing');
  n.setAttribute('role', 'status');
  n.setAttribute('aria-label', t('ai.thinking'));
  n.title = t('ai.thinking');
  n.append(elt('i'), elt('i'), elt('i'));
  // Волна точек идёт от их появления, а не от каждой перерисовки ленты.
  if (!reducedMotion()) {
    if (!ai.typingAt) ai.typingAt = animNow();
    const age = animNow() - ai.typingAt;
    n.style.setProperty('--ai-t', `${-Math.round(age)}ms`);
    if (age < AI_IN_MS) n.classList.add('ai-in');
  }
  return n;
}

/** Сообщение человека: плашки вложений («имя · тип · размер», без
 *  миниатюр — байтов в истории нет) и текст. */
function aiUserNode(it) {
  const n = elt('div', 'ai-msg me');
  const files = Array.isArray(it.files) ? it.files : [];
  if (files.length) {
    const box = elt('div', 'ai-files');
    for (const f of files) {
      const plate = elt('div', 'ai-file');
      plate.innerHTML = icon(f.kind === 'image' ? 'image' : 'doc');
      plate.append(elt('span', 'ai-file-name', f.name || ''), elt('span', 'ai-file-meta', ['', f.type, aiSize(f.size)].filter((x, i) => !i || x).join(' · ').trim()));
      box.append(plate);
    }
    n.append(box);
  }
  if (it.text) n.append(it.text);
  return n;
}

function aiItemNode(it, lastApplied) {
  if (it.kind === 'msg' && it.role === 'user') return aiUserNode(it);
  if (it.kind === 'msg') {
    const n = elt('div', 'ai-msg');
    n.innerHTML = aiTextHtml(it.text);
    if (it === ai.live) {
      ai.liveNode = n;
      // Доросла — высота снова своя: дальше строку раскладывает текст.
      n.addEventListener('transitionend', (e) => {
        if (e.target === n && e.propertyName === 'height') n.style.height = '';
      });
    }
    return n;
  }
  if (it.kind === 'step') {
    const name = AI_STEPS[it.tool];
    if (!name) return null;
    const done = it.done && !it.failed;
    const text = !done ? t(`ai.step_${name}`)
      : name === 'windows' ? t('ai.step_windows_done', { range: it.range || '' })
      : t('ai.step_spent_done', { time: it.time || '' });
    return elt('div', 'ai-step', text);
  }
  if (it.kind === 'notice') return elt('div', 'ai-step', t(it.key));
  if (it.kind === 'card') return aiCardNode(it, lastApplied);
  if (it.kind === 'error') {
    const n = elt('div', 'ai-error');
    n.append(elt('span', '', t(it.key, it.params)));
    if (it.retry) {
      const b = elt('button', 'linklike', t('ai.retry'));
      b.type = 'button';
      // «Подождите N с» — повторить можно, когда время вышло.
      b.disabled = !!it.retryAt && performance.now() < it.retryAt;
      b.addEventListener('click', aiRetry);
      n.append(b);
    }
    return n;
  }
  return null;
}

/** Ошибка — строкой в ленту своего чата (ответ мог прийти в чат, из которого
 *  человек уже ушёл). waitMs — «Повторить» откроется через столько. */
function aiError(key, retry, chat, params, waitMs) {
  const c = chat || ai.chat;
  if (!c) return;
  const it = { kind: 'error', key, retry: !!retry };
  if (params) it.params = params;
  if (waitMs > 0) {
    it.retryAt = performance.now() + waitMs;
    setTimeout(() => { if (c === ai.chat && c.items.includes(it)) aiRenderLog(); }, waitMs + 20);
  }
  c.items.push(it);
  if (c === ai.chat) aiRenderLog(true);
}

// --- вложения ------------------------------------------------------------------
//
// Скрепка, перетаскивание на панель и вставка картинки из буфера — один путь
// (aiAddFiles): байты (FileReader → Uint8Array) проверяет ядро
// (aiCheckAttachment — по сигнатурам, а не по имени; aiCheckAttachments —
// число и сумма), картинка перекодируется на устройстве, текст читается
// строгим UTF-8. Отправка — блоками ядра (aiAttachmentBlocks) перед текстом
// сообщения.

/** Пределы вложений — ядра (AI_ATTACH). */
const aiLimits = () => Core.AI_ATTACH;

/** Размер для людей: «512 Б», «240 КБ», «4,2 МБ». */
function aiSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return t('ai.size_b', { n });
  if (n < 1024 * 1024) return t('ai.size_kb', { n: Math.max(1, Math.round(n / 1024)) });
  const mb = n / (1024 * 1024);
  return t('ai.size_mb', { n: mb.toLocaleString(locale(), { maximumFractionDigits: mb < 10 ? 1 : 0 }) });
}

/** Тип на плашке: PNG, JPEG, PDF; у текста — расширение (TXT, MD, CSV). */
function aiTypeLabel(item) {
  if (item.kind === 'text') {
    const ext = (String(item.name || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1];
    return ext && /^(txt|md|markdown|csv)$/i.test(ext) ? ext.toUpperCase().replace('MARKDOWN', 'MD') : 'TXT';
  }
  return (String(item.mediaType || '').split('/')[1] || '').toUpperCase();
}

/** Байты файла: FileReader → Uint8Array (одинаково в браузере и в Electron). */
function aiReadBytes(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsArrayBuffer(blob);
  });
}

/** base64 без переполнения стека на больших файлах — кусками. */
function aiBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Картинка перекодируется на устройстве: поворот по EXIF, длинная сторона ≤
 *  AI_ATTACH.imageSide (1568 px), JPEG с качеством imageQuality (0,85), с
 *  прозрачностью — PNG. Так из файла уходят метаданные (EXIF, GPS) и всё,
 *  что спрятано рядом с картинкой. */
async function aiReencode(blob, mediaType) {
  const lim = aiLimits();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, lim.imageSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const alpha = mediaType !== 'image/jpeg' && aiHasAlpha(ctx, w, h);
    const out = await new Promise((r) => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', lim.imageQuality));
    if (!out) throw new Error('encode failed');
    return out;
  } finally {
    if (bmp.close) bmp.close();
  }
}

/** Есть ли в картинке хоть один не совсем непрозрачный пиксель. */
function aiHasAlpha(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

/** Ошибка вложения строкой. Ключи ошибок — ядра (ai.err_file_*), пределы в
 *  тексте — из AI_ATTACH, размером для людей. */
function aiAttachText(err) {
  const lim = aiLimits();
  const p = err.params || {};
  return t(err.key, {
    name: p.name || '',
    max: err.key === 'ai.err_file_count' ? lim.maxCount : aiSize(lim.totalBytes),
    image: aiSize(lim.imageBytes),
    pdf: aiSize(lim.pdfBytes),
    text: aiSize(lim.textBytes),
  });
}

/** Отказ ядра → { key, params }: у файла — { ok: false, error, params }, у
 *  списка ошибка бывает и строкой, и объектом. */
function aiAttachErrOf(res, name) {
  const e = res && res.error;
  const key = typeof e === 'string' ? e : e && (e.error || e.key);
  const params = (e && typeof e === 'object' && e.params) || (res && res.params) || {};
  return { key: /^ai\.err_file_/.test(key || '') ? key : 'ai.err_file_type', params: { ...params, name: name || params.name || '' } };
}

function aiSetAttachErr(err) {
  ai.attachErr = err;
  aiRenderAttach();
}

/** Что уходит в проверку ядра и в его блоки. */
const aiCheckInput = (it) => ({ name: it.name, size: it.size, bytes: it.bytes, kind: it.kind, mediaType: it.mediaType, text: it.text, data: it.data });

/** Файл → вложение или отказ ({ key, params }). Больше самого большого
 *  предела — отказ по размеру, файл даже не читается. */
async function aiPrepareFile(file) {
  const lim = aiLimits();
  const raw = String(file.name || '');
  if (file.size > Math.max(lim.imageBytes, lim.pdfBytes, lim.textBytes)) throw aiAttachErrOf(Core.aiCheckAttachment({ name: raw, size: file.size }), '');
  let bytes;
  try { bytes = await aiReadBytes(file); } catch { throw { key: 'ai.err_file_read', params: { name: raw } }; }
  const check = Core.aiCheckAttachment({ name: raw, size: file.size, bytes });
  if (!check || !check.ok) throw aiAttachErrOf(check, '');
  const name = check.name || raw;
  const fail = (key) => ({ key, params: { name } });
  const item = { id: uid(), name, kind: check.kind, mediaType: check.mediaType, size: bytes.length, bytes };
  if (check.kind === 'image') {
    let blob;
    try { blob = await aiReencode(new Blob([bytes], { type: check.mediaType }), check.mediaType); } catch { throw fail('ai.err_file_read'); }
    const out = await aiReadBytes(blob);
    const again = Core.aiCheckAttachment({ name, size: out.length, bytes: out });
    if (!again || !again.ok) throw aiAttachErrOf(again, name);
    Object.assign(item, { mediaType: again.mediaType, size: out.length, bytes: out, blob });
  } else if (check.kind === 'text') {
    try { item.text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('ai.err_file_type'); }
  }
  if (item.kind !== 'text') item.data = aiBase64(item.bytes);
  return item;
}

/** Файлы со скрепки, перетаскивания или из буфера — в поле той страницы, что
 *  открыта (на главном — к первому сообщению нового чата). Больше
 *  AI_ATTACH.maxCount — отказ строкой у поля. */
async function aiAddFiles(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length || !aiReady() || ai.busy) return;
  const gen = ai.attachGen;
  ai.attachErr = null;
  const max = (aiLimits() || {}).maxCount || 0;
  for (const file of list) {
    if (gen !== ai.attachGen) return;
    if (ai.attach.length + ai.attachBusy >= max) { aiSetAttachErr({ key: 'ai.err_file_count', params: {} }); break; }
    ai.attachBusy += 1;
    aiSyncCompose();
    try {
      const item = await aiPrepareFile(file);
      if (gen !== ai.attachGen) continue;
      const all = Core.aiCheckAttachments([...ai.attach, item].map(aiCheckInput));
      if (!all || !all.ok) aiSetAttachErr(aiAttachErrOf(all, item.name));
      else {
        if (item.blob) item.url = URL.createObjectURL(item.blob);
        delete item.blob;
        ai.attach.push(item);
      }
    } catch (err) {
      if (gen !== ai.attachGen) continue;
      if (err && err.key) aiSetAttachErr(err);
      else { console.warn('Вложение не прочиталось:', err); aiSetAttachErr({ key: 'ai.err_file_read', params: { name: file.name || '' } }); }
    } finally {
      if (gen === ai.attachGen) ai.attachBusy -= 1;
      aiRenderAttach();
      aiSyncCompose();
    }
  }
}

function aiRemoveAttach(item) {
  ai.attach = ai.attach.filter((x) => x !== item);
  if (item.url) URL.revokeObjectURL(item.url);
  ai.attachErr = null;
  aiRenderAttach();
  aiSyncCompose();
  el.aiInput.focus({ preventScroll: true });
}

/** Поле без вложений: миниатюры освобождаются, недочитанное отбрасывается. */
function aiClearAttach() {
  for (const it of ai.attach) if (it.url) URL.revokeObjectURL(it.url);
  ai.attach = [];
  ai.attachErr = null;
  ai.attachBusy = 0;
  ai.attachGen += 1;
  if (!el.aiPanel.hidden && !el.aiBody.hidden) aiRenderAttach();
}

/** Плашки над полем и под ними строка ошибки. */
function aiRenderAttach() {
  el.aiAttachList.hidden = !ai.attach.length;
  el.aiAttachList.replaceChildren(...ai.attach.map(aiChipNode));
  el.aiAttachError.hidden = !ai.attachErr;
  el.aiAttachError.textContent = ai.attachErr ? aiAttachText(ai.attachErr) : '';
}

/** Плашка вложения: у картинки — миниатюра из перекодированных байтов, у
 *  файла — значок, имя и размер; крестик убирает. */
function aiChipNode(it) {
  const chip = elt('div', it.url ? 'ai-chip ai-chip-img' : 'ai-chip');
  chip.title = `${it.name} · ${aiTypeLabel(it)} · ${aiSize(it.size)}`;
  if (it.url) {
    const img = elt('img', 'ai-chip-thumb');
    img.src = it.url;
    img.alt = it.name;
    chip.append(img);
  } else {
    chip.insertAdjacentHTML('beforeend', icon('doc'));
    const words = elt('span', 'ai-chip-words');
    words.append(elt('span', 'ai-chip-name', it.name), elt('span', 'ai-chip-size', aiSize(it.size)));
    chip.append(words);
  }
  const x = elt('button', 'ai-chip-x');
  x.type = 'button';
  x.title = t('ai.attach_remove');
  x.setAttribute('aria-label', `${t('ai.attach_remove')}: ${it.name}`);
  x.innerHTML = icon('x');
  x.addEventListener('click', () => aiRemoveAttach(it));
  chip.append(x);
  return chip;
}

/** Что остаётся от вложения в ленте и истории: имя, тип и размер. */
const aiFileMeta = (it) => ({ name: it.name, kind: it.kind, type: aiTypeLabel(it), size: it.size });

/** Сервер не принял вложения (400 bad attachment, 413): из неотвеченного
 *  сообщения они уходят, строка — у сообщения. Остался текст — «Повторить»
 *  отправит его без них. */
function aiRejectAttachments(chat) {
  const last = chat.messages[chat.messages.length - 1];
  let retry = false;
  if (last && last.role === 'user') {
    last.content = aiBlocks(last.content).filter((b) => !aiIsAttachBlock(b));
    if (aiHasText(last)) retry = true;
    else if (!last.content.length) chat.messages.pop();
  }
  aiSave(chat);
  aiError('ai.err_attach_server', retry, chat);
}

// --- карточка предложения ------------------------------------------------------

/** Последняя применённая карточка чата — «Отменить» только у неё. */
function aiLastApplied(chat) {
  const items = (chat || ai.chat || { items: [] }).items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind === 'card' && it.state === 'applied' && it.undo) return it;
  }
  return null;
}

/** Дата для подстроки: «17 окт.», а если время не полночь — «17 окт., 18:00». */
function aiWhen(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);
  const hm = hhmm(ms);
  return hm === '00:00' ? fmtDateShort(iso) : `${fmtDateShort(iso)}, ${hm}`;
}

/** Подстрока строки предложения: проект · статус · версия · теги · дедлайн ·
 *  время работы · повтор. Имена ядро уже подставило, даты — сырые. */
function aiOpSub(sub) {
  if (!sub) return '';
  const name = (v) => (v && typeof v === 'object' ? v.name || v.title || '' : v || '');
  const parts = [name(sub.project), name(sub.status), name(sub.version)];
  if (Array.isArray(sub.tags)) parts.push(sub.tags.map(name).filter(Boolean).join(', '));
  if (sub.dueAt) parts.push(t('home.next_due', { date: aiWhen(sub.dueAt) }));
  const slots = Array.isArray(sub.slots) ? sub.slots.filter((s) => s && !Number.isNaN(Date.parse(s.start)) && !Number.isNaN(Date.parse(s.end))) : [];
  if (slots.length) parts.push(slotsSummary(slots, null));
  // Повтор ядро отдаёт описанием ({key, vars} от describeRepeat).
  if (sub.repeat) parts.push(typeof sub.repeat === 'string' ? sub.repeat : repeatWords(sub.repeat));
  if (sub.done === true) parts.push(t('task.done_label'));
  if (sub.done === false) parts.push(t('task.reopen'));
  if (sub.notes) parts.push(t('tabs.notes'));
  return parts.filter(Boolean).join(' · ');
}

/** Куда ведёт строка применённого предложения: созданная или изменённая
 *  задача, созданный проект — если они ещё есть. */
function aiLinkOf(card, i) {
  const l = card.links && card.links[i];
  if (!l || !l.id) return null;
  if (l.kind === 'task' && getTask(l.id)) return l;
  if (l.kind === 'project' && getProject(l.id)) return l;
  return null;
}

function aiOpenLink(l) {
  // На телефонной ширине панель закрывает экран целиком — уступает ему место.
  if (window.innerWidth <= 480) closeAiPanel();
  if (l.kind === 'task') selectTask(l.id);
  else openProject(l.id);
}

/** Созданные id по порядку операций: ядро отдаёт их списками по видам. */
function aiLinks(ops, created) {
  const queue = {
    create_task: [...((created && created.tasks) || [])],
    create_project: [...((created && created.projects) || [])],
  };
  return ops.map((op) => {
    if (!op) return null;
    if (op.op === 'create_task') return { kind: 'task', id: queue.create_task.shift() || null };
    if (op.op === 'create_project') return { kind: 'project', id: queue.create_project.shift() || null };
    if (op.op === 'update_task') return { kind: 'task', id: op.id || null };
    return null;
  });
}

/** Пересечения предложенных отрезков с тем, что уже стоит в календаре, и
 *  между собой (Core.aiSlotConflicts). Пересекаться можно: человек видит
 *  предупреждение у строки и подтверждает «Применить». Одно и то же
 *  пересечение (задача и время) — один раз. */
function aiConflicts(card) {
  let list = [];
  try { list = Core.aiSlotConflicts(state, card.ops) || []; } catch (err) { console.error('Пересечения не посчитались:', err); }
  const seen = new Set();
  return list.filter((c) => {
    if (!c) return false;
    const key = `${c.index}|${c.taskId || c.title}|${c.start}|${c.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** «10:00–11:00»; не в тот же день, что предложенный отрезок, — с датой. */
function aiConflictTime(c) {
  const s = Date.parse(c.start);
  const e = Date.parse(c.end);
  if (Number.isNaN(s) || Number.isNaN(e)) return '';
  const range = `${hhmm(s)}–${hhmm(e)}`;
  const at = c.slot ? Date.parse(c.slot.start) : NaN;
  return !Number.isNaN(at) && new Date(at).toDateString() === new Date(s).toDateString() ? range : `${fmtDateShort(c.start)}, ${range}`;
}

function aiOpNode(row, card, i, conflicts) {
  const kind = row.kind || (card.ops[i] && card.ops[i].op) || '';
  const li = elt('li', 'ai-op');
  // Тег или версия с занятым именем заново не заводятся — ссылка идёт на
  // существующие (exists): галочка и слово без «нового».
  const known = !!row.exists;
  li.innerHTML = icon(known ? 'check' : /^update/.test(kind) ? 'pen-line' : 'plus');
  const main = elt('div', 'ai-op-main');
  const title = elt('div', 'ai-op-title');
  const word = known ? t(kind === 'create_version' ? 'version.label' : 'tag.dialog_edit') : t(`ai.op_${kind}`);
  title.append(elt('span', 'ai-op-kind', word), ' ');
  const name = row.title || t('task.no_name');
  const link = card.state === 'applied' ? aiLinkOf(card, i) : null;
  if (link) {
    const b = elt('button', 'ai-op-link', name);
    b.type = 'button';
    b.addEventListener('click', () => aiOpenLink(link));
    title.append(b);
  } else {
    title.append(elt('span', 'ai-op-name', name));
  }
  main.append(title);
  const sub = aiOpSub(row.sub);
  if (sub) main.append(elt('div', 'ai-op-sub', sub));
  for (const c of conflicts || []) {
    if (c.index !== i) continue;
    const warn = elt('div', 'ai-op-warn');
    warn.innerHTML = icon('danger');
    warn.append(elt('span', '', t('ai.conflict', { title: c.title || t('task.no_name'), time: aiConflictTime(c) })));
    main.append(warn);
  }
  li.append(main);
  return li;
}

/** Ошибки проверки (aiValidate) — ключи перевода с подстановками, у каждой
 *  номер строки предложения: строка подписывается своим названием. failed —
 *  проверка прошла, а применить не вышло (данные успели измениться). */
function aiCardErrors(errors, rows, failed) {
  const box = elt('div', 'ai-card-error');
  if (failed) box.append(elt('div', '', t('ai.apply_failed')));
  const list = elt('ul');
  for (const e of errors || []) {
    const msg = t((e && e.message) || 'ai.invalid', (e && e.params) || undefined);
    const row = e && Number.isInteger(e.index) && e.index >= 0 ? rows[e.index] : null;
    list.append(elt('li', '', row && row.title ? `${row.title}: ${msg}` : msg));
  }
  if (list.childElementCount) box.append(list);
  return box;
}

function aiCardNode(card, lastApplied) {
  const box = elt('div', 'ai-card');
  box.dataset.id = card.id;
  if (card.summary) box.append(elt('div', 'ai-card-title', card.summary));
  let rows = [];
  try {
    rows = Core.aiProposalRows(state, card.ops, { statusName: (k) => t(`status.default_${k}`) }) || [];
  } catch (err) { console.error('Строки предложения не собрались:', err); }
  const conflicts = card.state === 'open' ? aiConflicts(card) : [];
  const list = elt('ul', 'ai-ops');
  rows.forEach((row, i) => list.append(aiOpNode(row, card, i, conflicts)));
  box.append(list);
  if (card.state === 'open') {
    let check = { ok: true, errors: [] };
    try { check = Core.aiValidate(state, card.ops); } catch (err) { console.error('Предложение не проверилось:', err); check = { ok: false, errors: [] }; }
    if (!check.ok || card.failed) box.append(aiCardErrors(check.ok ? [] : check.errors, rows, card.failed && check.ok));
    // Разговор ушёл дальше, а решения нет — модель знает, что карточка ждёт.
    if (card.sent) box.append(elt('div', 'ai-card-note', t('ai.pending')));
    const actions = elt('div', 'ai-card-actions');
    const apply = elt('button', 'btn-accent', t('ai.apply'));
    apply.type = 'button';
    apply.dataset.act = 'apply';
    apply.disabled = !check.ok;
    apply.addEventListener('click', () => aiApplyCard(card));
    const decline = elt('button', 'ghost', t('ai.decline'));
    decline.type = 'button';
    decline.dataset.act = 'decline';
    decline.addEventListener('click', () => aiDeclineCard(card));
    actions.append(apply, decline);
    box.append(actions);
  } else {
    const st = elt('div', 'ai-card-state');
    const label = card.state === 'applied' ? t('ai.applied', { n: card.ops.length })
      : card.state === 'undone' ? t('ai.undone') : t('ai.declined');
    st.append(elt('span', '', label));
    if (card === lastApplied) {
      const undo = elt('button', 'linklike', t('ai.undo'));
      undo.type = 'button';
      undo.dataset.act = 'undo';
      undo.addEventListener('click', () => aiUndoCard(card));
      st.append(undo);
    }
    box.append(st);
  }
  return box;
}

/** «Применить». Отрезки пересекаются с другими задачами — сначала вопрос
 *  «Поставить в то же время?»; «Отмена» оставляет карточку как была. */
async function aiApplyCard(card) {
  if (card.state !== 'open' || ai.asking.has(card)) return;
  const chat = ai.chat;
  let check;
  try { check = Core.aiValidate(state, card.ops); } catch (err) { console.error('Предложение не проверилось:', err); check = { ok: false, errors: [] }; }
  if (!check.ok) { aiRenderLog(); return; }
  const conflicts = aiConflicts(card);
  if (conflicts.length) {
    const shown = conflicts.slice(0, 5).map((c) => `«${c.title || t('task.no_name')}» ${aiConflictTime(c)}`);
    if (conflicts.length > 5) shown.push('…');
    ai.asking.add(card);
    const ok = await confirmDialog(t('ai.conflict_confirm', { list: shown.join(', ') }), {
      title: t('ai.conflict_title'), okLabel: t('ai.conflict_ok'), cancelLabel: t('common.cancel'), danger: false,
    });
    ai.asking.delete(card);
    if (!ok || card.state !== 'open') return;
    try { check = Core.aiValidate(state, card.ops); } catch { check = { ok: false, errors: [] }; }
    if (!check.ok) { aiRenderLog(); return; }
  }
  flushEditor();
  let res;
  try {
    // Ядро проверяет ops само и ждёт исходные: нормализованные — для его
    // внутреннего применения, а не для повторной проверки.
    res = Core.aiApply(state, card.ops, { uid, now: new Date().toISOString(), statusName: (k) => t(`status.default_${k}`) });
  } catch (err) {
    console.error('Предложение агента не применилось:', err);
    res = null;
  }
  if (!res || res.ok === false) {
    card.failed = true;
    aiRenderLog();
    return;
  }
  card.state = 'applied';
  card.failed = false;
  card.undo = res.undo || null;
  card.links = aiLinks(card.ops, res.created);
  // Закрытые предложением задачи с повтором переходят дальше, как с галочки.
  for (const id of res.closed || []) afterTaskClosed(getTask(id), false);
  refreshEditorsFromRemote();
  // Панель не модалка: закрытые предложением строки на странице под ней
  // уезжают к выполненным и отменённым тем же переездом, что с галочки.
  flipSoon();
  render();
  scheduleSave();
  toast(t('ai.applied', { n: card.ops.length }));
  aiSave(chat);
  aiRenderLog();
}

function aiDeclineCard(card) {
  if (card.state !== 'open') return;
  card.state = 'declined';
  aiSave(ai.chat);
  aiRenderLog();
}

function aiUndoCard(card) {
  if (card.state !== 'applied' || !card.undo) return;
  flushEditor();
  let res;
  try { res = Core.aiUndo(state, card.undo); } catch (err) { console.error('Предложение агента не отменилось:', err); return; }
  card.state = 'undone';
  card.undo = null;
  refreshEditorsFromRemote();
  flipSoon();
  render();
  scheduleSave();
  // Что задачу уже меняли после применения (поле правили, по ней записано
  // время), ядро не отменяет и называет в kept: отмена вышла не полной, и
  // человек должен это знать. Ядро без kept — обычный тост.
  const kept = !!(res && Array.isArray(res.kept) && res.kept.length);
  toast(t(kept ? 'ai.undo_kept' : 'ai.undone'));
  aiSave(ai.chat);
  aiRenderLog();
}

// --- инструменты ---------------------------------------------------------------

function aiAddCard(block, chat) {
  if (chat.items.some((it) => it.kind === 'card' && it.id === block.id)) return;
  const input = block.input || {};
  chat.items.push({
    kind: 'card', id: block.id, summary: String(input.summary || ''),
    ops: Array.isArray(input.ops) ? input.ops : [], state: 'open', sent: false,
  });
}

function aiAddStep(block, chat) {
  let step = chat.items.find((it) => it.kind === 'step' && it.id === block.id);
  if (!step) {
    step = { kind: 'step', id: block.id, tool: block.name, done: false };
    chat.items.push(step);
  }
  return step;
}

/** «17 окт. – 31 окт.» — период, в котором искали окна. */
function aiRange(from, to) {
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return '';
  return `${fmtDateShort(from)} – ${fmtDateShort(to)}`;
}

/** Часы, в которых искались окна, — для ответа модели: рабочие часы из
 *  настроек (base, Core.aiWorkHours), а поля, которые модель передала в
 *  hours («вечером», «в выходные»), — вместо них. Сами окна считает ядро по
 *  тем же двум входам. */
function aiToolHours(base, hours) {
  if (!hours || typeof hours !== 'object') return base;
  return {
    start: typeof hours.start === 'string' ? hours.start : base.start,
    end: typeof hours.end === 'string' ? hours.end : base.end,
    days: Array.isArray(hours.days) ? hours.days : base.days,
  };
}

/** Инструмент, который считает ядро: свободные окна или записанное время.
 *  now — «сейчас» того же круга, что ушёл модели. */
function aiRunTool(block, now, chat) {
  const step = aiAddStep(block, chat);
  const input = block.input || {};
  try {
    let out;
    if (block.name === 'free_windows') {
      const base = Core.aiWorkHours(state.settings);
      out = {
        windows: Core.aiFreeWindows(state, { from: input.from, to: input.to, minMinutes: input.minMinutes, now, workHours: base, hours: input.hours }),
        workHours: aiToolHours(base, input.hours),
      };
      step.range = aiRange(input.from, input.to);
    } else {
      out = Core.aiTimeSpent(state, { from: input.from, to: input.to, projectId: input.projectId, now });
      step.time = fmtShort(Math.round(Number(out && out.totalMin) || 0) * 60000);
    }
    step.done = true;
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) };
  } catch (err) {
    console.error('Инструмент агента не посчитался:', err);
    step.done = true;
    step.failed = true;
    return { type: 'tool_result', tool_use_id: block.id, content: String((err && err.message) || err), is_error: true };
  }
}

/** Ответ на propose_changes — решение человека; нет решения — pending, и
 *  карточка остаётся с кнопками. */
function aiCardResult(id, chat) {
  const card = chat.items.find((it) => it.kind === 'card' && it.id === id);
  if (card) card.sent = true;
  const status = !card || card.state === 'open' ? 'pending' : card.state === 'applied' ? 'applied' : 'declined';
  return { type: 'tool_result', tool_use_id: id, content: status };
}

function aiResultFor(block, now, chat) {
  if (block.name === 'propose_changes') return aiCardResult(block.id, chat);
  if (AI_STEPS[block.name]) return aiRunTool(block, now || new Date().toISOString(), chat);
  return { type: 'tool_result', tool_use_id: block.id, content: `unknown tool: ${block.name}`, is_error: true };
}

/** Ответы на инструменты из последнего ответа модели, которые ещё не ушли:
 *  карточки — решением человека, остальные — посчитанные на месте. */
function aiOpenResults(chat) {
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== 'assistant') return [];
  return aiBlocks(last.content).filter((b) => b && b.type === 'tool_use').map((b) => aiResultFor(b, null, chat));
}

// --- вызов функции -------------------------------------------------------------

/** Текст ответа по мере прихода — в живую строку ленты. */
function aiAccText(acc) {
  const parts = ((acc && acc.blocks) || []).filter((b) => b && b.type === 'text' && b.text).map((b) => b.text);
  return parts.length ? parts.join('\n\n') : String((acc && acc.text) || '');
}

/** Живая строка ответа — в своём чате; рисуется, только если он открыт. */
function aiLiveText(acc, chat) {
  const c = chat || ai.busyChat || ai.chat;
  const text = aiAccText(acc);
  if (!text || !c) return;
  if (!ai.live) {
    ai.live = { kind: 'msg', role: 'assistant', text };
    c.items.push(ai.live);
    ai.waiting = false;
    aiRenderLog();
    return;
  }
  ai.live.text = text;
  if (c !== ai.chat) return;
  if (ai.waiting) { ai.waiting = false; aiRenderLog(); return; }
  if (!ai.liveNode || !ai.liveNode.isConnected) { aiRenderLog(); return; }
  aiGrowLive(ai.liveNode, aiTextHtml(text));
}

/** Ответ дописывается: строка растёт плавно, а не прыжком на высоту новой
 *  строки — высота едет от прежней к новой (.ai-grow, переход height), и
 *  лента едет за ней вниз, если человек и так был внизу. Прокрутил вверх —
 *  читать не мешаем. Без движения — сразу. */
function aiGrowLive(node, html) {
  const log = el.aiLog;
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const from = node.getBoundingClientRect().height;
  node.style.height = '';
  node.innerHTML = html;
  if (!reducedMotion()) {
    node.classList.add('ai-grow');
    const to = node.getBoundingClientRect().height;
    if (to > from + 0.5 && parseFloat(getComputedStyle(node).transitionDuration) > 0) {
      node.style.height = `${from}px`;
      void node.offsetHeight;
      node.style.height = `${to}px`;
    }
  }
  if (atEnd) aiFollow();
}

/** Лента стоит у низа, пока живой ответ растёт: каждый кадр, ещё ~0,26 с
 *  после последней строки. Человек прокрутил вверх — перестаёт. */
function aiFollow() {
  const log = el.aiLog;
  if (reducedMotion()) { log.scrollTop = log.scrollHeight; return; }
  ai.followUntil = animNow() + 260;
  if (ai.followRaf) return;
  let last = log.scrollTop;
  const step = () => {
    if (el.aiPanel.hidden || log.scrollTop < last - 1 || animNow() > ai.followUntil) { ai.followRaf = 0; return; }
    log.scrollTop = log.scrollHeight;
    last = log.scrollTop;
    ai.followRaf = requestAnimationFrame(step);
  };
  step();
}

function aiOnEvent(ev, acc, chat) {
  const d = ev && ev.data && typeof ev.data === 'object' ? ev.data : {};
  const type = (ev && ev.event) === 'lancible' ? 'lancible' : d.type || (ev && ev.event);
  if (type === 'lancible') {
    const remaining = acc && acc.remaining !== null && acc.remaining !== undefined ? acc.remaining : d.remaining;
    const limit = acc && acc.limit !== null && acc.limit !== undefined ? acc.limit : d.limit;
    if (Number.isFinite(remaining) && Number.isFinite(limit)) { ai.remaining = remaining; ai.limit = limit; aiRenderQuota(); }
    return;
  }
  if (type === 'content_block_start' && d.content_block && d.content_block.type === 'tool_use') {
    if (AI_STEPS[d.content_block.name]) aiAddStep(d.content_block, chat);
    ai.waiting = true;
    aiRenderLog();
    return;
  }
  if (type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') aiLiveText(acc, chat);
}

/** Снимок данных и «сейчас» на один круг: все вызовы круга инструментов
 *  уходят с тем же context и now, что первый, — модель считает от одной
 *  картины (и кеш промпта на сервере её не теряет). */
function aiFrame() {
  const now = new Date().toISOString();
  const tz = aiTimeZone();
  const context = Core.aiSnapshot(state, {
    now, tz, lang: lang(), focus: { view: state.ui.view, projectId: state.ui.projectId, taskId: selectedId },
  });
  return { now, tz, lang: lang(), context };
}

/** Один вызов функции: поток ответа, ошибки. Возвращает собранный ответ
 *  (acc ядра) или null — тогда ошибка уже в ленте чата. */
async function aiCall(run, frame, chat) {
  ai.live = null;
  ai.liveNode = null;
  ai.waiting = true;
  aiRenderLog(true);
  let token = null;
  let sid = null;
  try {
    const { data } = await sb.auth.getSession();
    token = data && data.session && data.session.access_token;
    sid = data && data.session && data.session.user ? data.session.user.id : null;
  } catch (err) { console.error('Нет сессии для агента:', err); }
  if (run !== ai.run) return null;
  // Вкладка отстала или сеанс в общем хранилище — другого аккаунта: вызов
  // ушёл бы его токеном и тратил бы его лимит (foreignSession).
  if (scopeStale || (token && sid && currentUser && sid !== currentUser.id)) {
    showStaleNotice();
    aiError('accounts.other_tab', false, chat);
    return null;
  }
  if (!token) { ai.needAuth = true; aiRender(); return null; }
  if (ai.limitUntil > Date.now() && Core.aiCountsAsMessage(chat.messages)) { aiError('ai.limit_reached', false, chat); return null; }

  let res;
  const ctrl = new AbortController();
  ai.ctrl = ctrl;
  try {
    res = await fetch(AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chat.messages, context: frame.context, lang: frame.lang, tz: frame.tz, now: frame.now }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (run === ai.run) { console.warn('Агент недоступен по сети:', err); aiError('ai.error_network', true, chat); }
    return null;
  }
  if (run !== ai.run) return null;
  if (!res.ok) {
    if (res.status === 401) { ai.needAuth = true; aiRender(); return null; }
    if (res.status === 404) { aiError('ai.unavailable', false, chat); return null; }
    if (res.status === 403) {
      const j = await res.json().catch(() => ({}));
      if (run !== ai.run) return null;
      // Доступ забрали (или его не было, а ответа ai_has_access не дождались):
      // «закрытый тест»; сообщение остаётся в истории чата.
      if (j && j.error === 'no access') {
        if (currentUser) aiSetAccess(currentUser.id, false);
        return null;
      }
    }
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      if (run !== ai.run) return null;
      // Частота: не больше нескольких сообщений в минуту — «Подождите N с» и
      // «Повторить», когда время выйдет. Суточный лимит — ниже.
      if (j && j.error === 'rate') {
        const sec = Math.max(1, Math.ceil(Number(j.retryAfter) || Number(res.headers.get('retry-after')) || 10));
        aiError('ai.rate_wait', true, chat, { n: sec }, sec * 1000);
        return null;
      }
      // Суточный бюджет по цене (19 октября 2026): до полуночи UTC повтор
      // упадёт так же — без «Повторить». Счётчик сообщений не трогаем: он о
      // другом, сообщения могли и остаться.
      if (j && j.error === 'budget') {
        aiError('ai.budget', false, chat);
        return null;
      }
      ai.remaining = 0;
      if (Number.isFinite(j && j.limit)) ai.limit = j.limit;
      ai.limitUntil = Date.parse(j && j.resetAt) || 0;
      aiRenderQuota();
      aiError('ai.limit_reached', false, chat);
      return null;
    }
    if (res.status === 400 || res.status === 413) {
      const j = await res.json().catch(() => ({}));
      if (run !== ai.run) return null;
      if (res.status === 413 || (j && j.error === 'bad attachment')) {
        console.warn('Сервер не принял вложение:', j && j.detail);
        aiRejectAttachments(chat);
        return null;
      }
      // Переписка длиннее общего предела текста функции: повтор упадёт так
      // же — без «Повторить», с советом начать новый чат.
      if (j && j.error === 'too long') {
        aiError('ai.too_long', false, chat);
        return null;
      }
    }
    aiError('ai.error_network', true, chat);
    return null;
  }

  let acc = Core.aiStreamStep(null, null); // чистый acc ядра
  let stopped = false;
  let buf = '';
  const feed = (chunk, end) => {
    buf += chunk;
    // Последний кадр без пустой строки после него — тоже кадр.
    const { events, rest } = Core.aiParseSse(end ? `${buf}\n\n` : buf);
    buf = end ? '' : rest;
    for (const ev of events) {
      acc = Core.aiStreamStep(acc, ev);
      if (acc.done || ev.event === 'message_stop') stopped = true;
      aiOnEvent(ev, acc, chat);
    }
  };
  try {
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (run !== ai.run) { reader.cancel().catch(() => {}); return null; }
        if (done) { feed(dec.decode(), true); break; }
        feed(dec.decode(value, { stream: true }), false);
      }
    } else {
      feed(await res.text(), true);
    }
  } catch (err) {
    if (run === ai.run) { console.warn('Поток агента оборвался:', err); aiDropLive(chat); aiError('ai.error_network', true, chat); }
    return null;
  }
  if (run !== ai.run) return null;
  ai.ctrl = null;
  if (acc.error || !stopped) {
    if (acc.error) console.warn('Агент ответил ошибкой:', acc.error);
    aiDropLive(chat);
    aiError('ai.error_network', true, chat);
    return null;
  }
  if (ai.live) ai.live.text = aiAccText(acc);
  ai.live = null;
  ai.liveNode = null;
  return acc;
}

/** Ответ оборвался — недописанный текст уходит: «Повторить» спросит заново. */
function aiDropLive(chat) {
  if (ai.live && chat) chat.items = chat.items.filter((it) => it !== ai.live);
  ai.live = null;
  ai.liveNode = null;
}

/** Ход кончился: вложения сделали своё — в истории вместо них отметка
 *  (Core.aiCompactHistory), байты больше никуда не уходят. */
function aiEndTurn(chat) {
  try { chat.messages = Core.aiCompactHistory(chat.messages) || chat.messages; } catch (err) { console.warn('История агента не сжалась:', err); }
  aiSave(chat);
}

/** Ответ модели и круг инструментов: свободные окна и записанное время
 *  считаются на месте и сразу уходят следующим вызовом — не больше
 *  AI_MAX_ROUNDS кругов подряд; предложение ждёт решения человека. Ответ
 *  пишется в свой чат, даже если человек ушёл в список или в другой. */
async function aiRun(chat) {
  const c = chat || ai.chat;
  if (ai.busy || !c || !aiReady()) return;
  const run = ai.run;
  ai.busyChat = c;
  aiSetBusy(true);
  try {
    if (typeof Core.aiSnapshot !== 'function') { aiError('ai.unavailable', false, c); return; }
    let frame;
    try { frame = aiFrame(); } catch (err) { console.error('Снимок для агента не собрался:', err); aiError('ai.unavailable', false, c); return; }
    for (let round = 0; ; round += 1) {
      const acc = await aiCall(run, frame, c);
      if (!acc || run !== ai.run) return;
      // Блоки — как отдало ядро, thinking с подписью тоже: модели их надо
      // вернуть неизменными. Пустой ответ в историю не кладётся.
      const msg = Core.aiAssistantMessage(acc);
      const content = aiBlocks(msg && msg.content);
      if (acc.stopReason === 'refusal') {
        // Отказ модели. Без слов — вопрос человека из истории уходит: иначе
        // он ушёл бы снова со следующим сообщением и получил бы тот же отказ.
        if (content.length) c.messages.push(msg);
        else if (c.messages.length && c.messages[c.messages.length - 1].role === 'user') c.messages.pop();
        c.items.push({ kind: 'notice', key: 'ai.refused' });
        aiEndTurn(c);
        return;
      }
      if (!content.length) { aiEndTurn(c); return; }
      c.messages.push(msg);
      const uses = content.filter((b) => b && b.type === 'tool_use');
      for (const b of uses) if (b.name === 'propose_changes') aiAddCard(b, c);
      const more = uses.some((b) => b.name !== 'propose_changes');
      if (!more || round >= AI_MAX_ROUNDS) { aiEndTurn(c); return; }
      c.messages.push({ role: 'user', content: uses.map((b) => aiResultFor(b, frame.now, c)) });
      aiSave(c);
    }
  } finally {
    if (run === ai.run) aiSetBusy(false);
  }
}

/** Сообщение человека: ответы на открытые инструменты, блоки вложений, текст.
 *  С главного экрана — первое сообщение нового чата: чат заводится в списке и
 *  открывается без въезда, поле съезжает вниз (aiFlowIn). */
function aiSend(raw) {
  const text = String(raw || '').trim();
  const fromHome = ai.page !== 'chat';
  let chat = fromHome ? null : ai.chat;
  const files = ai.attach.slice();
  if ((!text && !files.length) || ai.busy || ai.attachBusy || (!fromHome && !chat)) return;
  if (!aiSignedIn()) { aiRender(); return; }
  // Отставшая вкладка агента не зовёт: набранное остаётся в поле.
  if (staleGuard()) return;
  // Агент закрыт (или ответа о доступе ещё нет) — ai-chat не зовётся.
  if (!aiReady()) { aiRender(); return; }
  let blocks = [];
  if (files.length) {
    const check = Core.aiCheckAttachments(files.map(aiCheckInput));
    if (!check || !check.ok) { aiSetAttachErr(aiAttachErrOf(check, '')); return; }
    try { blocks = Core.aiAttachmentBlocks(files.map(aiCheckInput)) || []; } catch (err) {
      console.error('Вложения не собрались в блоки:', err);
      aiSetAttachErr({ key: 'ai.err_file_type', params: { name: files[0].name } });
      return;
    }
  }
  const top0 = fromHome ? el.aiCompose.getBoundingClientRect().top : 0;
  if (fromHome) {
    if (ai.chat) aiDropDraft(ai.chat);
    chat = { id: uid(), title: aiTitleOf(text, files), createdAt: new Date().toISOString(), messages: [], items: [], draft: null };
    ai.chat = chat;
  }
  chat.items = chat.items.filter((it) => it.kind !== 'error');
  const said = [...blocks, ...(text ? [{ type: 'text', text }] : [])];
  const last = chat.messages[chat.messages.length - 1];
  // Прошлый вызов не дошёл — сообщение человека уже в истории: новое
  // дописывается к нему, роли должны чередоваться.
  if (last && last.role === 'user') last.content = [...aiBlocks(last.content), ...said];
  else chat.messages.push({ role: 'user', content: [...aiOpenResults(chat), ...said] });
  const item = { kind: 'msg', role: 'user', text };
  if (files.length) item.files = files.map(aiFileMeta);
  chat.items.push(item);
  el.aiInput.value = '';
  aiClearAttach();
  aiSave(chat);
  if (fromHome) {
    ai.page = 'chat';
    ai.pageIn = null;
    aiRender(true);
    aiFlowIn(top0);
    usageSend('agent.chat');
  } else aiRender(true);
  aiRun(chat);
}

function aiRetry() {
  const chat = ai.chat;
  if (ai.busy || !chat) return;
  chat.items = chat.items.filter((it) => it.kind !== 'error');
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== 'user') { aiRenderLog(); return; }
  aiRun(chat);
}

for (const b of aiButtons()) b.addEventListener('click', toggleAiPanel);
el.aiClose.addEventListener('click', closeAiPanel);
el.aiBack.addEventListener('click', aiBack);
// Классы перехода с главного в новый чат снимаются, когда он доиграл: иначе
// следующий раз их нечем было бы перезапустить.
el.aiLog.addEventListener('animationend', (e) => { if (e.target === el.aiLog) el.aiLog.classList.remove('ai-log-in'); });
el.aiCompose.addEventListener('animationend', (e) => { if (e.target === el.aiCompose) el.aiCompose.classList.remove('ai-compose-down'); });
el.aiHello.addEventListener('animationend', (e) => { if (e.target.classList.contains('es-art')) el.aiHello.classList.remove('ai-breathe'); });
el.aiMore.addEventListener('click', () => {
  const id = ai.chat && ai.chat.id;
  if (id) openMenu(el.aiMore, [{ label: t('ai.delete_chat'), danger: true, onClick: () => aiDeleteChat(id) }], { toggle: true });
});
el.aiSigninBtn.addEventListener('click', () => openAuthModal('signin'));
el.aiRequest.addEventListener('click', aiRequestAccess);
el.aiRequestRetry.addEventListener('click', aiRequestAccess);
/** Enter — отправить, Shift+Enter — перенос строки. */
function aiOnKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); aiSend(el.aiInput.value); }
}
function aiOnSubmit(e) {
  e.preventDefault();
  aiSend(el.aiInput.value);
}
el.aiCompose.addEventListener('submit', aiOnSubmit);
el.aiInput.addEventListener('input', aiSyncCompose);
el.aiInput.addEventListener('keydown', aiOnKey);
// Скрепка — системное окно выбора файла (в нём — расширения из AI_ATTACH);
// выбранное — тем же путём, что перетаскивание и буфер.
function aiOnFilePicked() {
  const files = [...(el.aiFile.files || [])];
  el.aiFile.value = '';
  aiAddFiles(files);
}
// Ctrl+V с картинкой (или файлом) в буфере — вложение; текст вставляется как
// всегда.
function aiOnPaste(e) {
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  const files = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  aiAddFiles(files);
}
// Файлы, перетащенные на панель: пока они над ней — подсказка поверх
// (.ai-drop); отпустили — во вложения поля открытой страницы.
function aiDragsFiles(e) {
  return aiReady() && !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}
function aiOnDrag(e) {
  if (!aiDragsFiles(e)) return;
  if (e.type === 'dragleave') {
    ai.dragDepth = Math.max(0, ai.dragDepth - 1);
    if (!ai.dragDepth) el.aiPanel.classList.remove('ai-drop');
    return;
  }
  e.preventDefault();
  if (e.type === 'dragover') { e.dataTransfer.dropEffect = 'copy'; return; }
  if (e.type === 'dragenter') { ai.dragDepth += 1; el.aiPanel.classList.add('ai-drop'); return; }
  ai.dragDepth = 0;
  el.aiPanel.classList.remove('ai-drop');
  aiAddFiles(e.dataTransfer.files);
}
el.aiFile.accept = Core.AI_ATTACH.accept;
el.aiAttach.addEventListener('click', () => el.aiFile.click());
el.aiFile.addEventListener('change', aiOnFilePicked);
el.aiInput.addEventListener('paste', aiOnPaste);
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) el.aiPanel.addEventListener(type, aiOnDrag);
// Esc при фокусе внутри панели — закрыть её. Открытое меню («⋯») и окно
// подтверждения закрываются первыми: их ловят свои обработчики, а этот до
// них ещё не дошёл бы.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !aiOpen() || !el.aiPanel.contains(document.activeElement)) return;
  if (!el.ctxMenu.hidden || !el.confirmBackdrop.hidden) return;
  closeAiPanel();
}, true);

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
  })), { toggle: true });
}

/** Строка «Валюта · RUB ₽» в настройках — та же строка-кнопка, что «Язык»
 *  (13 октября 2026): значение справа, щелчок открывает тот же список. */
function renderCurrency() {
  el.settingsCurrencyValue.textContent = currencyLabel(state.settings.currency);
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
  watchOverlayAreas();
  watchScrollEdges();
  watchSegmented();
  setupLiquid();
  setupEditor();
  setupDocsView();
  renderCurrency();
  buildSwatches();

  // Чья область открыта — до загрузки: у каждого аккаунта свои данные.
  let session = null;
  await loadDeviceId();
  try {
    session = await prepareAccountsOnStart();
  } catch (err) {
    console.error('Не удалось открыть аккаунт:', err);
  }
  try {
    const loaded = await window.api.load();
    if (loaded && typeof loaded === 'object') state = loaded;
  } catch (err) {
    console.error('Не удалось загрузить данные:', err);
    toast(t('toast.load_error'));
  }
  // Пачка журнала области: очередь своих правок пережила перезапуск.
  takeSync2(state, scopeUid);
  scopeSwitching = false;
  // Первая область загружена — смены области (openScope) больше не ждут.
  scopeQueueOpen();

  migrate();
  reopenDueTasks(Date.now());
  el.langLabel.textContent = LANG_NAMES[state.settings.lang] || state.settings.lang;
  applyStaticTranslations();
  paintArt();
  applyTheme();
  renderCurrency();
  renderAccountBtn();
  recoverActiveTimer();
  // Пока адрес не разобран, на экране «Сегодня»: сохранённый когда-то вид не
  // должен мелькнуть и не должен подсунуть задачу, которой уже нет.
  state.ui.view = 'home';
  selectedId = null;
  setCalMode(calState.mode);
  scheduleSave();
  refreshDeviceScopes();
  // Первая синхронизация — уже с данными своей области. Её ждёт startRoute.
  (session ? afterSignedIn({ silent: true }) : Promise.resolve())
    .catch((err) => console.error('Не удалось восстановить сессию:', err))
    .finally(firstSyncDone);
  await startRoute(); // открывает экран из адреса и рисует его

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

/** Версия задачи — чипами, как на телефоне: «Без версии» и версии проекта,
 *  выбранная отмечена. Группа прячется, пока в проекте нет ни одной версии:
 *  пустой выбор в каждой задаче только занимал бы место, а завести версию
 *  можно только в настройках проекта. У вышедшей версии дата — подсказкой. */
function renderTaskVersion(task) {
  const list = versionsOf(task.projectId);
  el.taskVersionRow.hidden = !list.length;
  el.taskVersionLabel.hidden = !list.length;
  el.taskVersionRow.innerHTML = '';
  if (!list.length) return;
  const chip = (label, id, title) => {
    const on = (task.versionId || null) === id;
    const b = elt('button', `dp-btn${on ? ' on' : ''}${id ? '' : ' unset'}`);
    b.type = 'button';
    b.dataset.versionId = id || '';
    b.setAttribute('aria-pressed', String(on));
    if (title) b.title = title;
    b.append(elt('span', 'tp-chip-name', label));
    b.addEventListener('click', () => setTaskVersion(task, id));
    el.taskVersionRow.appendChild(b);
  };
  chip(t('version.none'), null);
  for (const v of list) chip(v.name || t('task.no_name'), v.id, v.releasedAt ? versionLabel(v) : '');
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

function renderVersionDialog() {
  const pid = pdlgProjectId();
  const list = versionsOf(pid);
  el.verList.innerHTML = '';

  if (!list.length) {
    // В строку: «Новая версия» стоит сразу под списком.
    el.verList.appendChild(emptyState({ art: 'versions', title: t('empty.versions_title'), text: t('empty.versions_text'), row: true }));
    return;
  }

  list.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'st-row ver-row';
    const used = versionUsage(v.id);
    row.innerHTML = `
      <input class="field-sm st-name" type="text" value="${escapeHtml(v.name)}" data-i18n-ph="version.name_ph" placeholder="Название версии" />
      <button type="button" class="dp-btn ver-rel${v.releasedAt ? ' released' : ''}" data-act="rel">${escapeHtml(v.releasedAt ? t('version.released_on', { date: fmtDateShort(v.releasedAt) }) : t('version.in_progress'))}</button>
      <span class="ver-use muted">${escapeHtml(t('version.tasks_n', { n: used }))}</span>
      <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} data-i18n-title="common.back" title="Выше">
        ${icon('chevron-up')}
      </button>
      <button type="button" class="icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} data-i18n-title="common.forward" title="Ниже">
        ${icon('chevron-down')}
      </button>
      <button type="button" class="icon-btn st-del" data-act="del" data-i18n-title="common.delete" title="Удалить">
        ${icon('trash')}
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
      touchProject(v.projectId);
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
        touchProject(v.projectId);
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
        touchProject(v.projectId);
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
          touchProject(v.projectId);
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
  touchProject(pid);
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
  touchProject(v.projectId);
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
  el.tfVersion.innerHTML = `<span class="ph-version-name">${escapeHtml(versionFilterLabel(pid, taskFilter.versionId))}</span>${icon('chevron-down')}`;
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
    + `<span class="fchip-v">${escapeHtml(value)}</span>${icon('chevron-down')}`;
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
  }), { width: pickerWidth(nodes.project) });
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

/** Сворачивает проект на месте, без перерисовки списка: новые узлы переход
 *  не играют (им не из чего), и группа схлопнулась бы рывком. Перерисовка
 *  же — смена дня, периода, новые данные — берёт состояние из набора и
 *  рисует сразу итог, без движения. */
function toggleCalGroup(projectId, node, head) {
  const shut = !calGroupsClosed.has(projectId);
  if (shut) calGroupsClosed.add(projectId);
  else calGroupsClosed.delete(projectId);
  node.classList.toggle('closed', shut);
  head.setAttribute('aria-expanded', String(!shut));
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

/** Заголовок проекта в правой панели — он же кнопка сворачивания. Цвет
 *  проекта (--pc) приходит от обёртки группы: им же закрашена её полоса. */
function calGroupHead(g) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cdl-group-head';
  b.setAttribute('aria-expanded', String(!calGroupsClosed.has(g.id)));
  b.innerHTML = `
    ${icon('chevron-down', 'icon cdl-chev')}
    <span class="cdl-group-dot"></span>
    <span class="cdl-group-name">${escapeHtml(g.project ? g.project.name : t('xlsx.no_project'))}</span>
    <span class="cdl-group-tot">${escapeHtml(fmtDurMoney(g.ms, g.money, currencyOf(g.project ? g.project.id : null)))}</span>`;
  b.addEventListener('click', () => toggleCalGroup(g.id, b.closest('.cdl-group'), b));
  return b;
}

/** Обёртка группы: заголовок плюс вложенный список её строк. Цвет проекта —
 *  переменной на обёртке: от него красятся и метка в заголовке, и полоса,
 *  что связывает группу слева. */
function calGroupNode(g, buildRow) {
  const li = document.createElement('li');
  li.className = 'cdl-group';
  li.style.setProperty('--pc', g.project ? g.project.color : PALETTE[0]);
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
const AG_TIME_MODES = ['day', 'week'];

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
    id: uid(),
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
    // Плановые блоки — до записей: те ложатся поверх.
    for (const p of d.planned) col.appendChild(agendaPlan(p));
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

/** Плановый блок «времени работы»: полоса под записями — во всю ширину
 *  столбца, а с другими планами в тот же час — колонками (col, cols из
 *  views.js), как записи. Поля по 1 px. Клик открывает задачу (см.
 *  agendaEndDrag): протянуть по нему можно, как по пустому месту, — запись
 *  заведётся. */
function agendaPlan(p) {
  const node = document.createElement('div');
  node.className = 'ag-plan';
  node.style.setProperty('--pc', p.color);
  node.style.top = `${Core.dayFraction(p.start) * 100}%`;
  node.style.height = `${((p.end - p.start) / Core.DAY) * 100}%`;
  const cols = p.cols || 1;
  node.style.left = `calc(${((p.col || 0) / cols) * 100}% + 1px)`;
  node.style.width = `calc(${(1 / cols) * 100}% - 2px)`;
  node.dataset.taskId = p.taskId;
  node.dataset.slotId = p.slotId || '';
  const range = `${fmtTime(p.start).slice(0, 5)}–${fmtTime(p.end).slice(0, 5)}`;
  node.title = `${t('agenda.planned')} · ${range}`;
  node.innerHTML = `<span class="ag-plan-time">${range}</span><span class="ag-plan-name">${escapeHtml(p.title)}</span>`;
  return node;
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
  const idx = Core.daysBetween(from, now);
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
  for (const plan of Core.slotItems(tasks, from, to)) put(plan.dayIndex, { kind: 'plan', at: plan.start, plan });

  const keys = [...byDay.keys()].sort((a, b) => a - b);
  el.agList.classList.toggle('is-empty', !keys.length);
  if (!keys.length) {
    // Кнопка — та же «+ Запись», что в шапке; акцентная там, поэтому здесь
    // тихая. Проектов нет — запись завести некуда, и кнопка заводит проект.
    const hasProjects = state.projects.length > 0;
    el.agList.appendChild(emptyState({
      art: 'time',
      title: t('agenda.empty'),
      text: t(hasProjects ? 'agenda.empty_text' : 'agenda.no_projects'),
      action: hasProjects
        ? { label: t('agenda.new_entry'), soft: true, onClick: () => el.agCreate.click() }
        : { label: t('project.new_title'), soft: true, onClick: () => openProjectDialog(null) },
    }));
    return;
  }

  for (const dayIndex of keys) {
    const d = new Date(Core.addDaysMs(from, dayIndex));
    const group = document.createElement('div');
    group.className = 'ag-list-day';
    group.innerHTML = `<div class="ag-list-date">${escapeHtml(capFirst(d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })))}</div>`;
    const rows = byDay.get(dayIndex).sort((a, b) => a.at - b.at);
    for (const row of rows) {
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'ag-list-row' + (row.kind === 'dl' ? ' dl' : '') + (row.kind === 'plan' ? ' plan' : '') + (row.dl && row.dl.ghost ? ' ghost' : '');
      if (row.kind === 'plan') {
        const task = getTask(row.plan.taskId);
        line.style.setProperty('--pc', agendaProjectColor(row.plan.projectId));
        line.innerHTML = `<span class="ag-list-time">${fmtTime(row.plan.start).slice(0, 5)}–${fmtTime(row.plan.end).slice(0, 5)}</span>`
          + `<span class="ag-list-name">${escapeHtml(task ? (task.title || t('task.no_name')) : '')}</span>`
          + `<span class="ag-list-tag">${escapeHtml(t('agenda.planned'))}</span>`;
        line.addEventListener('click', () => openTaskModal(task, null));
      } else if (row.kind === 'dl') {
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

const agDrag = { kind: null, taskId: null, index: null, dayStart: 0, start: 0, end: 0, grab: 0, node: null, moved: false, pointerId: null, planTaskId: null };

/** Время под курсором: столбец даёт день, высота — время внутри суток. */
function agendaPointAt(clientX, clientY) {
  const rect = el.agCols.getBoundingClientRect();
  const { from, days } = agendaSpan();
  const colW = rect.width / days;
  const dayIndex = Math.max(0, Math.min(days - 1, Math.floor((clientX - rect.left) / colW)));
  const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const dayStart = Core.addDaysMs(from, dayIndex);
  return { dayIndex, dayStart, ms: Core.atDayFraction(dayStart, frac) };
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
  const idx = Core.daysBetween(from, day);
  if (idx >= 0 && idx < days && el.agCols.children[idx] && node.parentElement !== el.agCols.children[idx]) {
    el.agCols.children[idx].appendChild(node);
  }
}

el.agCols.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const point = agendaPointAt(e.clientX, e.clientY);
  const block = e.target.closest ? e.target.closest('.ag-ev') : null;
  const plan = e.target.closest ? e.target.closest('.ag-plan') : null;
  agDrag.planTaskId = !block && plan ? plan.dataset.taskId : null;

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
    const col = el.agCols.children[Core.daysBetween(from, point.dayStart)];
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
    const dayEnd = Core.addDaysMs(agDrag.dayStart, 1);
    const a = Math.min(dayEnd, Math.max(agDrag.dayStart, Math.min(edge, agDrag.start)));
    const b = Math.min(dayEnd, Math.max(edge, agDrag.start));
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
    // Щелчок по плановому блоку открывает его задачу, а не заводит запись.
    if (!moved && agDrag.planTaskId) { openTaskModal(getTask(agDrag.planTaskId), null); return; }
    let { start, end } = agDrag;
    // Простой щелчок по пустому месту — час с этой отметки, как в Google.
    if (!moved || end - start < AG_MIN_MIN * 60000) end = start + 3_600_000;
    createOnAgenda(Core.clampSpan(agDrag.dayStart, start, end, AG_MIN_MIN));
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
    dueAt: null, reminders: [], remindOffsetMin: null, remindAt: null, notifiedAt: null,
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

/** Новое с сетки — в любой час и любой день. Стоит в этом промежутке чужой
 *  план — сначала вопрос (confirmSlotOverlap); «Отмена» — как будто и не
 *  тянули. */
async function createOnAgenda(span) {
  const overlaps = Core.slotOverlaps(state.tasks, span, null);
  if (overlaps.length && !(await confirmSlotOverlap(overlaps, false))) return;
  openAgendaDraft(span);
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
  if (el.tmdlgBackdrop.hidden) usageSend('task.modal');
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
  el.tmdlgTot.textContent = fmtDurMoney(taskElapsedMs(task), earnedOf(task), currencyOf(task.projectId));
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
  })), { width: pickerWidth(el.tmdlgProj) });
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
  openTask(task.id);
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
  const modes = { 1: 'day', d: 'day', 2: 'week', w: 'week', 3: 'month', m: 'month', 4: 'agenda', 5: 'agenda', a: 'agenda' };
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

const weekdayName = (d) => t(WEEKDAY_KEYS[d % 7]);

/** Человеческая подпись правила. Ядро отдаёт ключ и подстановки — перевод и
 *  склейка дней недели делаются здесь, где известен язык. */
function repeatLabel(rule) {
  return rule ? capFirst(repeatPhrase(rule)) : t('repeat.none');
}

/** То же правило словами для середины фразы: «каждую неделю», «по Пн, Ср». */
function repeatPhrase(rule) {
  return repeatWords(Core.describeRepeat(rule));
}

/** Описание правила от ядра ({key, vars}, describeRepeat) словами текущего
 *  языка — его же отдаёт строка предложения агента (aiProposalRows). */
function repeatWords(d) {
  if (!d || !d.key) return '';
  const vars = { ...d.vars };
  if (Array.isArray(vars.days)) vars.days = vars.days.map(weekdayName).join(', ');
  return t(d.key, vars);
}

/** Строка «Повторение · Каждую неделю ›» в свойствах задачи, под значением
 *  тихо — когда следующий раз или «Вернётся 18 окт». Дедлайн для неё не
 *  нужен: без него отсчёт идёт от разового отрезка «времени работы», а без
 *  отрезка — от закрытия (core/slots.js, planTaskRoll). */
function renderTaskRepeat(task) {
  const rule = Core.normalizeRepeat(task.repeat);
  el.repeatValue.textContent = rule ? repeatLabel(rule) : t('repeat.none');

  if (!rule || Core.repeatFinished(rule)) {
    el.repeatNext.hidden = true;
    return;
  }
  // Закрытая задача без дат ждёт своего дня: «Вернётся 18 окт».
  const back = task.done && task.reopenAt ? Date.parse(task.reopenAt) : NaN;
  if (Number.isFinite(back)) {
    el.repeatNext.hidden = false;
    el.repeatNext.textContent = t('repeat.returns', { date: fmtDateShort(back) });
    return;
  }
  const anchor = Core.rollAnchor(task);
  const next = anchor ? Core.nextDue(rule, new Date(anchor).getTime()) : null;
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
  // Правило сняли — ждать возврата больше нечего.
  if (!rule) task.reopenAt = null;
  task.updatedAt = new Date().toISOString();
  render();
  // Окно повторения можно открыть из окна отрезка — оно под ним, и его
  // подпись «повторяется вместе с задачей» должна подхватить новое правило.
  if (!el.sldlgBackdrop.hidden) renderSlotDialog();
  scheduleSave();
}

// Строка «Повторение» открывает окно повторения задачи (#rpdlg) — с 13
// октября 2026 сразу, без меню готовых правил: как и остальные строки
// свойств, она открывает окно своей настройки.
el.taskRepeat.addEventListener('click', () => {
  const task = getTask(selectedId);
  if (task) openRepeatDialog(task);
});

// --- Окно тонкой настройки --------------------------------------------------

// Правило одно на задачу: у отрезка «времени работы» своего повтора нет, все
// его отрезки повторяются по правилу задачи. Окно зовут и из строки задачи, и
// из окна отрезка (ссылка «Повторение задачи…») — тогда оно лежит поверх него.
const rpdlg = { taskId: null, rule: null };

/** Задача окна — по id, в момент действия. Окна повторения, отрезка и
 *  напоминания держат id, а не саму задачу, как окно задачи (tmdlg): приём
 *  облака (applyRemoteData) заменяет state.tasks целиком, и «Сохранить» после
 *  него писало бы в объект, которого в списке уже нет. Задачи не стало —
 *  окно закрывается с тем же тостом, что и при приёме облака.
 *  @returns задача или null */
function dialogTask(id, close) {
  const task = id ? getTask(id) : null;
  if (id && !task) {
    close();
    toast(t('sync.updated_toast'));
  }
  return task;
}

function openRepeatDialog(task) {
  rpdlg.taskId = task.id;
  rpdlg.rule = Core.normalizeRepeat(task.repeat) || Core.normalizeRepeat(presetRule('week'));
  // Дата окончания — день («2026-12-31»): так её читает nextDue ядра. Правило
  // с телефона приходит с моментом времени (ISO) — окно приводит его к дню.
  const at = rpdlg.rule.ends.at;
  if (at && at.includes('T') && Number.isFinite(Date.parse(at))) rpdlg.rule.ends.at = dayKey(new Date(at));
  renderRepeatDialog();
  el.rpdlgBackdrop.hidden = false;
}

/** Правка правила в окне — как patch листа телефона (RepeatSheet): каждое
 *  изменение проходит через normalizeRepeat ядра, поэтому окно всегда
 *  показывает то правило, которое уйдёт по «Готово», а не черновик, который
 *  ядро потом поправит молча (дни недели у «дня», число вне 1…99). */
function patchRepeatRule(next) {
  rpdlg.rule = Core.normalizeRepeat({ ...rpdlg.rule, ...next });
  renderRepeatDialog();
}
function closeRepeatDialog() {
  el.rpdlgBackdrop.hidden = true;
  rpdlg.taskId = null;
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

  // Дни недели — только у недели, как WeekdayChips на телефоне.
  el.rpDaysBlock.hidden = r.freq !== 'week';
  if (r.freq === 'week') {
    el.rpDays.innerHTML = '';
    // Неделя начинается с понедельника — как во всём приложении.
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const on = r.weekdays.includes(d);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rp-day' + (on ? ' on' : '');
      b.dataset.day = String(d);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = weekdayName(d);
      b.addEventListener('click', () => {
        patchRepeatRule({ weekdays: on ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d] });
      });
      el.rpDays.appendChild(b);
    }
  }

  el.rpMonthBlock.hidden = r.freq !== 'month';
  markSegment(el.rpMonthSeg, 'mode', r.monthMode);
  markSegment(el.rpFromSeg, 'from', r.from);
  markSegment(el.rpEndsSeg, 'ends', r.ends.kind);
  // «Отсчёт» осмыслен, только когда есть от чего считать: от дедлайна или
  // отрезка «времени работы». Без них задача считает от закрытия, и выбирать
  // нечего.
  const task = getTask(rpdlg.taskId);
  const anchor = task ? Core.rollAnchor(task) : null;
  el.rpFromField.hidden = !anchor;

  el.rpAfter.hidden = r.ends.kind !== 'after';
  el.rpUntilRow.hidden = r.ends.kind !== 'on';
  if (r.ends.kind === 'after' && document.activeElement !== el.rpCount) el.rpCount.value = String(r.ends.count);
  if (r.ends.kind === 'on') el.rpUntil.textContent = fmtDpBtn(r.ends.at || dayKey(new Date()));

  el.rpHistory.setAttribute('aria-pressed', String(!!r.keepHistory));

  // Сводка — как InfoRow листа телефона: значок повтора, правило словами
  // (describeRepeat ядра) и ближайшие сроки. Без неё «каждый второй вторник
  // месяца» проверить нечем — приходится закрывать окно и смотреть.
  const base = anchor ? new Date(anchor).getTime() : Date.now();
  const soon = Core.upcomingDue(r, base, base + (400 * 86400000), 3);
  el.rpPreview.innerHTML = icon('refresh', 'icon rp-summary-mark')
    + `<span class="rp-summary-main"><span class="rp-summary-text">${escapeHtml(repeatLabel(r))}</span>`
    + (soon.length ? `<span class="rp-summary-dates">${soon.map((ms) => escapeHtml(fmtDateShort(ms))).join(' · ')}</span>` : '')
    + '</span>';
  applyStaticTranslations();
}

el.rpEvery.addEventListener('input', () => {
  const n = parseInt(el.rpEvery.value.replace(/\D/g, ''), 10);
  patchRepeatRule({ every: Number.isFinite(n) && n > 0 ? n : 1 });
});
// Пустое поле или ноль, пока его правят, — 1, но в самом поле это видно
// только после ухода из него: стирать цифру, чтобы набрать другую, можно.
el.rpEvery.addEventListener('blur', () => { el.rpEvery.value = String(rpdlg.rule.every); });
el.rpCount.addEventListener('input', () => {
  const n = parseInt(el.rpCount.value.replace(/\D/g, ''), 10);
  patchRepeatRule({ ends: { ...rpdlg.rule.ends, count: Number.isFinite(n) && n > 0 ? n : 1 } });
});
el.rpCount.addEventListener('blur', () => { el.rpCount.value = String(rpdlg.rule.ends.count); });
el.rpFreqSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-freq]');
  if (!b) return;
  patchRepeatRule({ freq: b.dataset.freq });
});
el.rpMonthSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  patchRepeatRule({ monthMode: b.dataset.mode });
});
el.rpFromSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-from]');
  if (!b) return;
  patchRepeatRule({ from: b.dataset.from });
});
el.rpEndsSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ends]');
  if (!b) return;
  const ends = { ...rpdlg.rule.ends, kind: b.dataset.ends };
  if (ends.kind === 'on' && !ends.at) ends.at = dayKey(new Date(Core.addDaysMs(Date.now(), 90)));
  patchRepeatRule({ ends });
});
el.rpUntil.addEventListener('click', () => {
  openDatePicker(el.rpUntil, rpdlg.rule.ends.at || dayKey(new Date()), (key) => {
    patchRepeatRule({ ends: { ...rpdlg.rule.ends, at: key } });
  });
});
el.rpHistory.addEventListener('click', () => {
  patchRepeatRule({ keepHistory: !rpdlg.rule.keepHistory });
});
el.rpdlgCancel.addEventListener('click', closeRepeatDialog);
el.rpdlgOff.addEventListener('click', () => {
  const task = dialogTask(rpdlg.taskId, closeRepeatDialog);
  if (!task) return;
  closeRepeatDialog();
  setTaskRepeat(task, null);
});
el.rpdlgSave.addEventListener('click', () => {
  const task = dialogTask(rpdlg.taskId, closeRepeatDialog);
  if (!task) return;
  // Неделя без выбранных дней — это просто «раз в N недель», и такое правило
  // тоже осмысленно: пусть остаётся как есть.
  closeRepeatDialog();
  setTaskRepeat(task, rpdlg.rule);
});
el.rpdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.rpdlgBackdrop) closeRepeatDialog(); });


// --- Что происходит при закрытии задачи -------------------------------------

/** Единая точка «задачу только что закрыли»: повторение должно срабатывать и
 *  с галочки в списке, и с переноса на доске, и из меню статуса. */
function afterTaskClosed(task, wasDone) {
  if (!task || wasDone || !task.done) return;
  rollRepeat(task);
}

/** Переводит повторяющуюся задачу дальше. */
// Решение о перекате — в ядре (core/slots.js, planTaskRoll), общее с
// телефоном; здесь только применение к задаче и тосты.
function rollRepeat(task) {
  const plan = Core.planTaskRoll(task, Date.now());
  if (!plan) return;

  if (plan.finished) {
    task.repeat = plan.repeat;
    task.updatedAt = new Date().toISOString();
    toast(t('repeat.series_done'));
    return;
  }
  applyRollPlan(task, plan);
  const date = fmtDateShort(plan.nextDue);
  if (!plan.open) toast(t('repeat.returns', { date }));
  else toast(t(task.dueAt ? 'repeat.moved' : 'repeat.moved_slot', { date }));
}

/** Применяет решение ядра (planTaskRoll или planReopen) к задаче на месте.
 *  open: true — задача открывается сразу (статус по умолчанию, чистые
 *  doneAt и notifiedAt); open: false — остаётся закрытой и ждёт reopenAt. */
function applyRollPlan(task, plan) {
  if (!plan.open) {
    Object.assign(task, plan.patch);
    task.updatedAt = new Date().toISOString();
    return;
  }
  if (plan.keepHistory) {
    // Выполненная копия остаётся в списке со своим временем, а сама задача
    // возвращается с чистого листа.
    state.tasks.push(Core.historyCopy(task, uid(), Date.now()));
    task.sessions = [];
    task.totalMs = 0;
  }
  Object.assign(task, plan.patch);
  task.doneAt = null;
  task.notifiedAt = null;
  const back = defaultStatusId(task.projectId, false);
  if (back) setTaskStatus(task, back);
  else { task.done = false; task.cancelled = false; }
  task.updatedAt = new Date().toISOString();
}

/** Возвращает закрытые повторяющиеся задачи, чей день настал (core/slots.js,
 *  planReopen). Зовётся на старте, по таймеру и после приёма облака; true —
 *  что-то изменилось, и пора перерисовать и сохранить. */
function reopenDueTasks(now) {
  const plans = Core.planReopen(state.tasks, now);
  for (const plan of plans) {
    const task = getTask(plan.taskId);
    if (task) applyRollPlan(task, plan);
  }
  return plans.length > 0;
}

// --- Время работы -----------------------------------------------------------
// Дедлайн — срок закрытия, а «время работы» — когда этим заниматься: у задачи
// может быть несколько отрезков (task.slots, core/slots.js). Свой повтор у
// отрезка не хранится: правило одно, task.repeat, и если оно есть, каждый
// отрезок повторяется по нему вместе с задачей. На календаре они лежат
// полосами под записями времени, а напоминание срабатывает на каждое
// вхождение.

const hhmm = (ms) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;

/** Подпись отрезка в списке отрезков: день недели с датой и часы. Повтор
 *  здесь не пишется — он общий у задачи и виден в строке «Повторение». */
function slotLabel(slot) {
  const day = capFirst(new Date(slot.start).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }));
  return `${day} · ${hhmm(Date.parse(slot.start))}–${hhmm(Date.parse(slot.end))}`;
}

/** Время работы одной строкой — значение строки «Время работы»: первый
 *  отрезок и сколько ещё («Пн, Ср 10:00–12:00 +1», «Сб, 17 окт. 10:00–12:00»).
 *  Как на телефоне (slotsSummary в mobile/src/lib/slotText.js): у задачи,
 *  что повторяется каждую неделю по дням, — дни, иначе дата первого отрезка;
 *  само правило видно своей строкой «Повторение». */
function slotsSummary(slots, rule) {
  const first = slots[0];
  const weekly = rule && rule.freq === 'week' && (rule.every || 1) === 1 && rule.weekdays && rule.weekdays.length;
  const when = weekly
    ? mondayFirst(rule.weekdays).map(weekdayName).join(', ')
    : capFirst(new Date(first.start).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }));
  const more = slots.length > 1 ? ` +${slots.length - 1}` : '';
  return `${when} ${hhmm(Date.parse(first.start))}–${hhmm(Date.parse(first.end))}${more}`;
}

function renderTaskSlots(task) {
  const slots = Core.slotsOf(task);
  el.slotsValue.textContent = slots.length ? slotsSummary(slots, Core.slotRule(task)) : t('slot.none');
}

/** Строка «Время работы»: отрезков нет — сразу окно нового; есть — их список
 *  (как лист списка отрезков на телефоне) и «Добавить время». Отрезок в
 *  списке открывает своё окно, там же он и удаляется. */
function openSlotsList(task) {
  if (!task) return;
  const slots = Core.slotsOf(task);
  if (!slots.length) { openSlotDialog(task, null); return; }
  openMenu(el.slotsRow, [
    ...slots.map((slot) => ({ label: slotLabel(slot), onClick: () => openSlotDialog(task, slot) })),
    { sep: true },
    { label: t('slot.add'), icon: 'plus', onClick: () => openSlotDialog(task, null) },
  ], { toggle: true });
}
el.slotsRow.addEventListener('click', () => openSlotsList(getTask(selectedId)));

/** Записывает отрезки в задачу: хранится то, что лежало, а заменяется или
 *  добавляется только свой — чужие и непонятные записи не теряются. */
function putSlot(task, slot) {
  const raw = Array.isArray(task.slots) ? task.slots : [];
  const at = raw.findIndex((x) => x && x.id === slot.id);
  task.slots = at >= 0 ? raw.map((x, i) => (i === at ? slot : x)) : [...raw, slot];
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

/** Время задачи ничем не ограничено (18 октября 2026): ни рабочими часами, ни
 *  днями, и два дела в один час — можно. Но это повод спросить: «В этом
 *  промежутке уже есть задача «X» (10:00–11:00). Создать в то же время?»;
 *  несколько — до трёх по имени и «и ещё N». overlaps — ответ
 *  Core.slotOverlaps; edit — правка заведённого отрезка («Сохранить»), иначе
 *  создание («Создать»).
 *  @returns Promise<boolean> — ставить в то же время */
function confirmSlotOverlap(overlaps, edit) {
  const seen = new Set();
  const list = overlaps.filter((o) => {
    const key = `${o.taskId}|${o.start}|${o.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const item = (o) => t('slot.overlap_item', {
    title: o.title || t('task.no_name'),
    time: `${hhmm(Date.parse(o.start))}–${hhmm(Date.parse(o.end))}`,
  });
  const shown = list.slice(0, 3).map(item).join(', ');
  const rest = list.length - 3;
  const what = list.length === 1
    ? t('slot.overlap_one', { item: item(list[0]) })
    : t('slot.overlap_many', { list: rest > 0 ? `${shown} ${t('slot.overlap_more', { n: rest })}` : shown });
  return confirmDialog(`${what} ${t(edit ? 'slot.overlap_q_save' : 'slot.overlap_q_create')}`, {
    title: t('slot.overlap_title'),
    okLabel: t(edit ? 'common.save' : 'agenda.create_btn'),
    danger: false,
  });
}

function deleteSlot(task, id) {
  task.slots = (Array.isArray(task.slots) ? task.slots : []).filter((x) => !(x && x.id === id));
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

// Окно отрезка — как лист отрезка на телефоне (13 октября 2026): строки
// «Дата», «Начало», «Конец» (под концом — длительность) и ниже «Повторение
// задачи». start и end — числа (первое вхождение); правит их окно, а в задачу
// они попадают на «Сохранить». Повтора у отрезка нет — строка говорит,
// повторяется ли задача, и открывает её окно повторения. Напоминания о начале —
// общий список задачи (см. «Напоминания» ниже).
// Задача — по id (dialogTask): приём облака заменяет state.tasks целиком.
const sldlg = { taskId: null, old: null, id: null, start: 0, end: 0 };

function openSlotDialog(task, slot) {
  if (!task) return;
  sldlg.taskId = task.id;
  sldlg.old = slot || null;
  sldlg.id = (slot && slot.id) || uid();
  if (slot) {
    sldlg.start = Date.parse(slot.start);
    sldlg.end = Date.parse(slot.end);
  } else {
    // Новый отрезок — ближайший ровный час, на час.
    const d = new Date(Date.now());
    d.setHours(d.getHours() + 1, 0, 0, 0);
    sldlg.start = d.getTime();
    sldlg.end = sldlg.start + 3600000;
  }
  el.sldlgDelete.hidden = !slot;
  renderSlotDialog();
  el.sldlgBackdrop.hidden = false;
}

function closeSlotDialog() {
  el.sldlgBackdrop.hidden = true;
  sldlg.taskId = null;
  closeDatePicker();
  closeTimePicker();
}

function renderSlotDialog() {
  el.sldlgDate.textContent = fmtDpBtn(dayKey(new Date(sldlg.start)));
  el.sldlgStart.textContent = hhmm(sldlg.start);
  el.sldlgEnd.textContent = hhmm(sldlg.end);
  const ok = sldlg.end > sldlg.start;
  el.sldlgDur.textContent = ok ? t('sdlg.duration', { time: fmtClock(sldlg.end - sldlg.start) }) : t('slot.end_before_start');
  el.sldlgDur.classList.toggle('bad', !ok);
  // Отрезок повторяется только вместе с задачей: правило берём у неё, ровно
  // то же, по которому он ложится на календарь (серия кончилась — разовый).
  const rule = Core.slotRule(getTask(sldlg.taskId));
  el.sldlgRepeatNote.textContent = rule ? t('slot.with_task_repeat', { rule: repeatPhrase(rule) }) : t('repeat.none');
}

function saveSlotDialog() {
  const task = dialogTask(sldlg.taskId, closeSlotDialog);
  if (!task) return;
  if (!(sldlg.end > sldlg.start)) { toast(t('slot.end_before_start')); return; }
  const slot = Core.normalizeSlot({
    ...(sldlg.old || {}),
    id: sldlg.id,
    start: new Date(sldlg.start).toISOString(),
    end: new Date(sldlg.end).toISOString(),
  });
  // Чужой план в этом промежутке — вопрос, а не запрет; «Отмена» оставляет
  // окно как было. Правка, не сдвинувшая время, заново не спрашивает.
  const moved = !sldlg.old || Date.parse(sldlg.old.start) !== sldlg.start || Date.parse(sldlg.old.end) !== sldlg.end;
  const overlaps = moved ? Core.slotOverlaps(state.tasks, slot, task.id) : [];
  if (!overlaps.length) {
    closeSlotDialog();
    putSlot(task, slot);
    return;
  }
  const { id, taskId } = sldlg;
  return confirmSlotOverlap(overlaps, !!sldlg.old).then((ok) => {
    // Пока висел вопрос, окно могли закрыть, а приём облака — заменить задачи.
    if (!ok || el.sldlgBackdrop.hidden || sldlg.taskId !== taskId || sldlg.id !== id) return;
    const live = dialogTask(taskId, closeSlotDialog);
    if (!live) return;
    closeSlotDialog();
    putSlot(live, slot);
  });
}

el.sldlgSave.addEventListener('click', saveSlotDialog);
el.sldlgCancel.addEventListener('click', closeSlotDialog);
el.sldlgDelete.addEventListener('click', () => {
  const task = dialogTask(sldlg.taskId, closeSlotDialog);
  if (!task) return;
  const { id } = sldlg;
  closeSlotDialog();
  deleteSlot(task, id);
});
el.sldlgBackdrop.addEventListener('click', (e) => { if (e.target === el.sldlgBackdrop) closeSlotDialog(); });

/** Начало и конец отрезка — в часах и минутах от полуночи его дня. */
const slotDayAt = (val) => {
  const [h, m] = val.split(':').map(Number);
  const d = new Date(sldlg.start);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
// Дата двигает весь отрезок: часы и длительность остаются, как в календарях.
el.sldlgDateBtn.addEventListener('click', () => openDatePicker(el.sldlgDateBtn, dayKey(new Date(sldlg.start)), (key) => {
  const d = keyToDate(key);
  const cur = new Date(sldlg.start);
  d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
  const dur = sldlg.end - sldlg.start;
  sldlg.start = d.getTime();
  sldlg.end = sldlg.start + dur;
  renderSlotDialog();
}));
// Сдвиг начала двигает и конец: длительность остаётся.
el.sldlgStartBtn.addEventListener('click', () => openTimePicker(el.sldlgStartBtn, hhmm(sldlg.start), (val) => {
  const dur = sldlg.end - sldlg.start;
  sldlg.start = slotDayAt(val);
  sldlg.end = sldlg.start + dur;
  renderSlotDialog();
}));
// Конец — только время: он в тот же день, что и начало, а позже начала быть
// обязан (slot.end_before_start).
el.sldlgEndBtn.addEventListener('click', () => openTimePicker(el.sldlgEndBtn, hhmm(sldlg.end), (val) => {
  sldlg.end = slotDayAt(val);
  renderSlotDialog();
}));
// Правило — задачи, а не отрезка: окно повторения задачи ложится поверх окна
// отрезка (слой 102 над 101), черновик отрезка под ним не теряется.
el.sldlgRepeatRow.addEventListener('click', () => {
  const task = dialogTask(sldlg.taskId, closeSlotDialog);
  if (task) openRepeatDialog(task);
});

// --- Напоминания ------------------------------------------------------------
// У задачи их список (task.reminders, core/reminders.js): «до начала» и «до
// дедлайна» (за N мин, ч, дн.), «один раз» в своё время и «повторять» по дням,
// неделям и месяцам. Список читается только через Core.remindersOf и правится
// только через Core.withReminders: его патч несёт и зеркало старых полей — для
// приложений прежних версий. Окно одно на все три вида (#rmdlg-backdrop).

const REMIND_UNIT_KEY = { min: 'remind.unit_min', hour: 'remind.unit_hour', day: 'remind.unit_day' };
/** Единица смещения рядом с числом: «мин» и «ч» сокращены, дни — словом по
 *  числу («1 день», «2 дня», «5 дней»). Переключатель единиц в окне берёт
 *  сокращения напрямую, без числа. */
const remindUnit = (unit, n) => (unit === 'day' ? pluralForm(n, 'plural.day') : t(REMIND_UNIT_KEY[unit]));

/** Дни недели с понедельника — как во всём приложении (0 — воскресенье). */
const mondayFirst = (days) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

/** Подпись напоминания в свойствах: «За 15 мин до начала», «В момент
 *  дедлайна», «12 июн., 09:00», «По Пн, Ср в 09:00», «Каждый день в 09:00»,
 *  «Каждый месяц 5-го в 09:00». Ядро отдаёт структуру, слова — здесь. */
function remindLabel(rem) {
  const d = Core.describeReminder(rem);
  if (!d) return '';
  if (d.kind === 'before') {
    const side = d.anchor === 'start' ? 'start' : 'due';
    if (d.offsetMin === 0) return t(`remind.at_${side}`);
    return t(`remind.before_${side}_n`, { n: d.n, unit: remindUnit(d.unit, d.n) });
  }
  if (d.kind === 'at') {
    const sameYear = new Date(d.at).getFullYear() === new Date().getFullYear();
    return `${sameYear ? fmtDateShort(d.at) : fmtDpBtn(dayKey(new Date(d.at)))}, ${hhmm(d.at)}`;
  }
  if (d.freq === 'day') return t('remind.daily_at', { time: d.time });
  if (d.freq === 'week') {
    const days = d.weekdays.length ? d.weekdays : [new Date(rem.start).getDay()];
    return t('remind.weekly_at', { days: mondayFirst(days).map(weekdayName).join(', '), time: d.time });
  }
  if (d.freq === 'month') return t('remind.monthly_at', { day: d.monthDay, time: d.time });
  return `${repeatLabel(rem.rule)}, ${d.time}`;
}

/** Группа «Напоминания» в свойствах: строка на каждое (щелчок — его окно,
 *  там же и удаление) и последней «Добавить». «До начала» без времени работы
 *  и «до дедлайна» без дедлайна ничего не дождутся — строка у них тише, а
 *  вернётся срок — заговорят. */
function renderTaskReminders(task) {
  el.remindRow.innerHTML = '';
  const live = { start: Core.slotsOf(task).length > 0, due: !!task.dueAt };
  for (const rem of Core.remindersOf(task)) {
    const idle = rem.kind === 'before' && !live[rem.anchor];
    const row = elt('button', `srow remind-item${idle ? ' dim' : ''}`);
    row.type = 'button';
    row.dataset.reminderId = rem.id;
    if (idle) row.title = t('remind.need_anchor');
    row.innerHTML = `${icon('bell')}<span class="srow-label">${escapeHtml(remindLabel(rem))}</span>${icon('chevron-right', 'icon srow-chev')}`;
    row.addEventListener('click', () => openReminderDialog(task, rem));
    el.remindRow.appendChild(row);
  }
  const add = elt('button', 'srow srow-add');
  add.type = 'button';
  add.id = 'remind-add';
  add.innerHTML = `${icon('plus')}<span class="srow-label">${escapeHtml(t('remind.add'))}</span>`;
  add.addEventListener('click', () => openReminderDialog(task, null));
  el.remindRow.appendChild(add);
}

/** Записывает новый список целиком: ядро решает, какие отметки «уже
 *  напомнили» остаются, и дописывает зеркало старых полей. */
function applyReminders(task, list) {
  Object.assign(task, Core.withReminders(task, list));
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

function deleteReminder(task, id) {
  applyReminders(task, Core.remindersOf(task).filter((r) => r.id !== id));
}

// Окно напоминания. Поля черновика живут здесь, в задачу они попадают на
// «Сохранить». n — число из поля как строка (его печатают), unit — единица.
// Задача — по id (dialogTask): приём облака заменяет state.tasks целиком.
const rmdlg = {
  taskId: null, old: null, id: null, live: { start: false, due: false },
  kind: 'before', anchor: 'start', n: '15', unit: 'min', over: false,
  at: 0, freq: 'day', weekdays: [], monthDay: '1', time: '09:00',
};

/** Минуты смещения из полей окна; null — число не разобрано. */
function rmOffset() {
  const raw = String(rmdlg.n).replace(',', '.').trim();
  return raw === '' ? null : Core.toOffsetMin(raw, rmdlg.unit);
}

/** Больше предела (60 суток) прижимается к нему, и окно говорит об этом —
 *  до следующей правки: renderReminderDialog зовёт это при каждой отрисовке. */
function rmCapOffset() {
  const v = Number(String(rmdlg.n).replace(',', '.'));
  const mult = Core.REMIND_UNITS[rmdlg.unit];
  rmdlg.over = Number.isFinite(v) && v * mult > Core.REMIND_MAX_OFFSET_MIN;
  if (rmdlg.over) rmdlg.n = String(Core.REMIND_MAX_OFFSET_MIN / mult);
}

const rmMonthDayOk = () => { const n = Number(rmdlg.monthDay); return Number.isInteger(n) && n >= 1 && n <= 31; };

function openReminderDialog(task, rem) {
  if (!task) return;
  const d = rem ? Core.describeReminder(rem) : null;
  const before = d && d.kind === 'before' ? d : null;
  const rep = d && d.kind === 'repeat' ? d : null;
  const now = new Date();
  rmdlg.taskId = task.id;
  rmdlg.old = rem || null;
  rmdlg.id = rem ? rem.id : uid();
  // Якоря, которого у задачи сейчас нет, новое напоминание не получит; у
  // заведённого он остаётся, чтобы его можно было поправить.
  rmdlg.live = { start: Core.slotsOf(task).length > 0, due: !!task.dueAt };
  if (before) rmdlg.live[before.anchor] = true;
  rmdlg.kind = d ? d.kind : (rmdlg.live.start || rmdlg.live.due ? 'before' : 'at');
  rmdlg.anchor = before ? before.anchor : (rmdlg.live.start ? 'start' : 'due');
  rmdlg.n = before ? String(before.n) : '15';
  rmdlg.unit = before ? before.unit : 'min';
  // Новое «один раз» — ближайший ровный час.
  const hour = new Date(now);
  hour.setHours(now.getHours() + 1, 0, 0, 0);
  rmdlg.at = d && d.kind === 'at' ? d.at : hour.getTime();
  rmdlg.freq = rep && ['day', 'week', 'month'].includes(rep.freq) ? rep.freq : 'day';
  rmdlg.weekdays = rep && rep.weekdays.length ? rep.weekdays.slice() : [rep ? new Date(rem.start).getDay() : now.getDay()];
  rmdlg.monthDay = String(rep && rep.monthDay ? rep.monthDay : now.getDate());
  rmdlg.time = rep ? rep.time : '09:00';
  el.rmdlgDelete.hidden = !rem;
  renderReminderDialog();
  el.rmdlgBackdrop.hidden = false;
  const on = el.rmKindSeg.querySelector('button.on');
  if (on) on.focus();
}

function closeReminderDialog() {
  el.rmdlgBackdrop.hidden = true;
  rmdlg.taskId = null;
  closeDatePicker();
  closeTimePicker();
}

function renderReminderDialog() {
  rmCapOffset();
  const live = rmdlg.live;
  const noAnchor = !live.start && !live.due;
  markSegment(el.rmKindSeg, 'kind', rmdlg.kind);
  // «До…» без якоря не от чего отсчитывать: вид гаснет, под ним подсказка.
  el.rmKindSeg.querySelector('[data-kind="before"]').disabled = noAnchor;
  el.rmNeedAnchor.hidden = !noAnchor;
  el.rmBefore.hidden = rmdlg.kind !== 'before';
  el.rmAt.hidden = rmdlg.kind !== 'at';
  el.rmRepeat.hidden = rmdlg.kind !== 'repeat';

  // «До…»: показывается только тот якорь, что есть у задачи.
  el.rmAnchorSeg.querySelectorAll('button').forEach((b) => { b.hidden = !live[b.dataset.anchor]; });
  markSegment(el.rmAnchorSeg, 'anchor', rmdlg.anchor);
  markSegment(el.rmUnitSeg, 'unit', rmdlg.unit);
  const off = rmOffset();
  // Кнопки создаются один раз, дальше меняются на месте: перерисованная
  // кнопка теряла бы фокус, и с клавиатуры не выбрать два значения подряд.
  if (el.rmPresets.children.length !== Core.REMIND_PRESETS.length) {
    el.rmPresets.innerHTML = '';
    for (const p of Core.REMIND_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.min = String(p);
      el.rmPresets.appendChild(b);
    }
  }
  Core.REMIND_PRESETS.forEach((p, i) => {
    const b = el.rmPresets.children[i];
    const s = Core.splitOffset(p);
    b.className = `dp-btn${off === p ? ' on' : ''}`;
    b.textContent = p === 0 ? t(`remind.at_${rmdlg.anchor}`) : `${s.n} ${remindUnit(s.unit, s.n)}`;
  });
  if (el.rmN.value !== rmdlg.n) el.rmN.value = rmdlg.n;

  // «Один раз».
  el.rmAtBtn.textContent = `${fmtDpBtn(dayKey(new Date(rmdlg.at)))}, ${hhmm(rmdlg.at)}`;

  // «Повторять».
  markSegment(el.rmFreqSeg, 'freq', rmdlg.freq);
  el.rmDays.hidden = rmdlg.freq !== 'week';
  if (rmdlg.freq === 'week') {
    if (!el.rmDays.children.length) {
      for (const d of [1, 2, 3, 4, 5, 6, 0]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.day = String(d);
        el.rmDays.appendChild(b);
      }
    }
    for (const b of el.rmDays.children) {
      const d = Number(b.dataset.day);
      b.className = `rp-day${rmdlg.weekdays.includes(d) ? ' on' : ''}`;
      b.textContent = weekdayName(d);
    }
  }
  el.rmMonthLine.hidden = rmdlg.freq !== 'month';
  if (el.rmMonthDay.value !== rmdlg.monthDay) el.rmMonthDay.value = rmdlg.monthDay;
  el.rmTimeBtn.textContent = rmdlg.time;

  // Что не так с полями: сохранить можно, только когда всё разобрано. Число
  // больше предела уже прижато — сказать об этом, но не мешать.
  const bad = (rmdlg.kind === 'before' && off === null)
    || (rmdlg.kind === 'repeat' && rmdlg.freq === 'month' && !rmMonthDayOk());
  const note = bad ? t('remind.bad_number') : (rmdlg.kind === 'before' && rmdlg.over ? t('remind.too_long') : '');
  el.rmError.textContent = note;
  el.rmError.hidden = !note;
  el.rmdlgSave.disabled = bad;
}

/** От какого момента считается правило «повторять». Каждый день и неделю —
 *  с этой минуты: сегодняшнее время, уже прошедшее, молчит. Каждый месяц — с
 *  ближайшей даты с нужным числом (31-го бывает не в каждом месяце). Пока
 *  правило то же, прежняя точка отсчёта остаётся — иначе отметка «уже
 *  напомнили» сбросилась бы зря. */
function remindRepeatStart(rule) {
  const old = rmdlg.old;
  const day = Number(rmdlg.monthDay);
  if (old && old.kind === 'repeat' && old.time === rmdlg.time && JSON.stringify(old.rule) === JSON.stringify(rule)
    && (rule.freq !== 'month' || new Date(old.start).getDate() === day)) return old.start;
  const now = new Date();
  if (rule.freq !== 'month') return now.toISOString();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (let k = 0; k < 14; k += 1) {
    const c = new Date(now.getFullYear(), now.getMonth() + k, day);
    if (c.getDate() !== day || c.getTime() < today) continue;
    return (c.getTime() === today ? now : c).toISOString();
  }
  return now.toISOString();
}

/** Напоминание из полей окна; null — поля не разобраны. */
function reminderFromDialog() {
  if (rmdlg.kind === 'before') {
    const off = rmOffset();
    return off === null ? null : { kind: 'before', anchor: rmdlg.anchor, offsetMin: off, unit: rmdlg.unit };
  }
  if (rmdlg.kind === 'at') return { kind: 'at', at: new Date(rmdlg.at).toISOString() };
  if (rmdlg.freq === 'month' && !rmMonthDayOk()) return null;
  const rule = Core.normalizeRepeat(presetRule(rmdlg.freq, rmdlg.freq === 'week' ? rmdlg.weekdays : []));
  return { kind: 'repeat', rule, time: rmdlg.time, start: remindRepeatStart(rule) };
}

function saveReminderDialog() {
  const task = dialogTask(rmdlg.taskId, closeReminderDialog);
  const rem = task ? reminderFromDialog() : null;
  if (!rem) return;
  // Чужие ключи остаются, пока вид тот же; отметки «уже напомнили» решает
  // withReminders по времени срабатывания.
  const old = rmdlg.old;
  const next = { ...(old && old.kind === rem.kind ? old : {}), ...rem, id: rmdlg.id };
  const list = Core.remindersOf(task);
  const at = list.findIndex((r) => r.id === rmdlg.id);
  ensureNotifPermission();
  closeReminderDialog();
  applyReminders(task, at >= 0 ? list.map((r, i) => (i === at ? next : r)) : [...list, next]);
}

el.rmdlgSave.addEventListener('click', saveReminderDialog);
el.rmdlgCancel.addEventListener('click', closeReminderDialog);
el.rmdlgDelete.addEventListener('click', () => {
  const task = dialogTask(rmdlg.taskId, closeReminderDialog);
  if (!task) return;
  const { id } = rmdlg;
  closeReminderDialog();
  deleteReminder(task, id);
});
el.rmdlgBackdrop.addEventListener('click', (e) => { if (e.target === el.rmdlgBackdrop) closeReminderDialog(); });

el.rmKindSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b || b.disabled) return;
  rmdlg.kind = b.dataset.kind;
  renderReminderDialog();
});
el.rmAnchorSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-anchor]');
  if (!b) return;
  rmdlg.anchor = b.dataset.anchor;
  renderReminderDialog();
});
el.rmPresets.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-min]');
  if (!b) return;
  const s = Core.splitOffset(Number(b.dataset.min));
  rmdlg.n = String(s.n);
  rmdlg.unit = s.unit;
  renderReminderDialog();
});
el.rmN.addEventListener('input', () => {
  rmdlg.n = el.rmN.value.replace(/[^\d.,]/g, '');
  renderReminderDialog();
});
el.rmUnitSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-unit]');
  if (!b) return;
  rmdlg.unit = b.dataset.unit;
  renderReminderDialog();
});

el.rmAtBtn.addEventListener('click', () => {
  const move = (d) => { rmdlg.at = d.getTime(); renderReminderDialog(); };
  openDatePicker(el.rmAtBtn, dayKey(new Date(rmdlg.at)), (key) => {
    const d = keyToDate(key);
    const cur = new Date(rmdlg.at);
    d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
    move(d);
  }, {
    time: hhmm(rmdlg.at),
    onTime: (val) => {
      const [h, m] = val.split(':').map(Number);
      const d = new Date(rmdlg.at);
      d.setHours(h, m, 0, 0);
      move(d);
    },
  });
});

el.rmFreqSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-freq]');
  if (!b) return;
  rmdlg.freq = b.dataset.freq;
  renderReminderDialog();
});
el.rmDays.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-day]');
  if (!b) return;
  const d = Number(b.dataset.day);
  // Хотя бы один день остаётся: неделя без дней — не «раз в неделю», а ничего.
  if (!rmdlg.weekdays.includes(d)) rmdlg.weekdays = [...rmdlg.weekdays, d].sort((a, c) => a - c);
  else if (rmdlg.weekdays.length > 1) rmdlg.weekdays = rmdlg.weekdays.filter((x) => x !== d);
  renderReminderDialog();
});
el.rmMonthDay.addEventListener('input', () => {
  const digits = el.rmMonthDay.value.replace(/\D/g, '').slice(0, 2);
  rmdlg.monthDay = Number(digits) > 31 ? '31' : digits;
  renderReminderDialog();
});
el.rmTimeBtn.addEventListener('click', () => openTimePicker(el.rmTimeBtn, rmdlg.time, (val) => {
  rmdlg.time = val;
  renderReminderDialog();
}));
for (const input of [el.rmN, el.rmMonthDay]) {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveReminderDialog(); } });
}

/** Будущие сроки повторений — призраками на календаре (core/agenda.js). */
const repeatGhosts = Core.repeatGhosts;


init();

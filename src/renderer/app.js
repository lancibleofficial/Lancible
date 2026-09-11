'use strict';

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

let state = {
  projects: [],
  tasks: [],
  activeTimer: null,
  ui: { view: 'home', projectId: null, navCollapsed: false },
  settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru' },
};
let selectedId = null;
let quill = null;

const DEFAULT_PROJECT_NAME_KEY = 'app.default_project_name';
const HEARTBEAT_MS = 15000;
const PALETTE = ['#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#f58cc0', '#a4c2a8', '#8a93a5'];
const TEXT_COLORS = ['', '#ecedef', '#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#a4c2a8', '#767b86'];
const FILL_COLORS = ['', '#3a4a34', '#2f4653', '#43385a', '#544a30', '#5a3a37', '#3e4a40'];

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
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});

// ---------------------------------------------------------------------------
// Интернационализация (i18n)
// ---------------------------------------------------------------------------

const LOCALE_MAP = { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', kk: 'kk-KZ' };
const LANG_NAMES = { ru: 'Русский', en: 'English', uk: 'Українська', kk: 'Қазақша' };

const T = {
  ru: {
    'app.default_project_name': 'Мои задачи',
    'search.placeholder': 'Поиск (Ctrl+F)',
    'search.start_typing': 'Начни вводить название проекта или задачи',
    'search.nothing_found': 'Ничего не найдено',
    'search.projects_group': 'Проекты',
    'search.tasks_group': 'Задачи',
    'search.project_sub': '{n} {plural}',
    'search.task_sub': 'проект: {name}',
    'nav.home': 'Обзор', 'nav.calendar': 'Календарь', 'nav.collapse': 'Свернуть',
    'nav.language': 'Язык',
    'update.available': 'Доступно обновление', 'update.downloading': 'Скачивание…', 'update.ready': 'Перезапустить',
    'nav.theme_system': 'Системная', 'nav.theme_light': 'Светлая', 'nav.theme_dark': 'Тёмная',
    'stats.worked': 'всего проработано', 'stats.earned': 'всего заработано',
    'stats.month': 'заработано в этом месяце', 'stats.done': 'задач выполнено',
    'home.title': 'Проекты', 'home.create': 'Создать проект', 'home.pinned': 'Закреплённые',
    'home.other': 'Остальные', 'home.recent': 'Недавние задачи',
    'home.empty': 'Пока нет ни одного проекта. Создай первый.', 'home.calendar_link': 'Календарь',
    'home.created_on': 'создан {date}', 'home.new_project_title': 'Создать проект',
    'weekday.mon': 'Пн', 'weekday.tue': 'Вт', 'weekday.wed': 'Ср', 'weekday.thu': 'Чт',
    'weekday.fri': 'Пт', 'weekday.sat': 'Сб', 'weekday.sun': 'Вс',
    'project.all': 'Все проекты', 'project.tasks': 'Задачи',
    'project.new_task_title': 'Новая задача (Ctrl+N)', 'project.pick_task': 'Выбери задачу слева или создай новую.',
    'project.opts': 'Опции', 'project.opts_menu': 'Опции проекта',
    'project.open': 'Открыть', 'project.edit': 'Редактировать…', 'project.pin': 'Закрепить на главной',
    'project.unpin': 'Открепить с главной', 'project.excel': 'Скачать Excel',
    'project.copy_summary': 'Скопировать сводку', 'project.delete': 'Удалить проект',
    'project.new_title': 'Новый проект', 'project.edit_title': 'Редактировать проект',
    'project.summary': 'Проект: {time} · {money}',
    'filter.all': 'Все', 'filter.active': 'В работе', 'filter.done': 'Готово',
    'sidebar.empty_default': 'В этом проекте пока нет задач.<br />Нажми «+ Новая».',
    'sidebar.no_match': 'Ничего не подходит под фильтр.',
    'sep.pinned': 'Закреплённые', 'sep.rest': 'Остальные', 'sep.done': 'Выполненные',
    'rate.default_label': 'Ставка по умолчанию', 'rate.per_hour': '/ч',
    'task.title_ph': 'Название задачи', 'task.pin_title': 'Закрепить задачу',
    'task.unpin_title': 'Открепить задачу', 'task.delete_title': 'Удалить задачу',
    'task.pin_short': 'Закрепить наверх', 'task.unpin_short': 'Открепить',
    'task.no_name': 'Без названия',
    'tabs.notes': 'Заметки', 'tabs.history': 'История',
    'timer.sub_default': 'общее время по задаче', 'timer.start': 'Старт', 'timer.stop': 'Стоп',
    'timer.recording': 'идёт запись · сессия {time}', 'timer.other_task': 'таймер идёт по другой задаче',
    'money.rate_label': 'Ставка', 'money.no_rate': 'ставка не задана', 'money.default_suffix': ' · по умолчанию',
    'money.calc': '{time} × {rate} {cur}/ч =',
    'editor.placeholder': 'Заметки, шаги, чеклист, таблица…',
    'table.insert_title': 'Вставить таблицу 3×3',
    'table.add_row': '+ строка', 'table.add_col': '+ столбец', 'table.del_row': '− строка', 'table.del_col': '− столбец',
    'table.fill_label': 'залить:', 'table.scope_cell': 'ячейку', 'table.scope_row': 'строку', 'table.scope_col': 'столбец',
    'table.del_table': 'удалить таблицу', 'table.fill_title': 'Залить', 'table.unfill_title': 'Убрать заливку',
    'history.title': 'Записи времени', 'history.add': '+ Добавить запись', 'history.excel': '⬇ Excel',
    'history.excel_title': 'Выгрузить логи времени этой задачи в Excel',
    'history.empty': 'Ещё не было ни одного запуска таймера.',
    'session.recovered': ' · восстановлено', 'session.manual': ' · вручную',
    'session.edit_title': 'Изменить запись', 'session.delete_title': 'Удалить запись', 'session.today': 'сегодня {time}',
    'calendar.month': 'Месяц', 'calendar.week': 'Неделя', 'calendar.day': 'День', 'calendar.today': 'Сегодня',
    'calendar.choose_period': 'Выбрать период', 'calendar.pick_day': 'Выбери день',
    'calendar.day_empty': 'В этот день записей не было.', 'calendar.pick_date': 'Выбрать дату',
    'calendar.for_month': 'За месяц', 'calendar.for_week': 'За неделю',
    'calendar.for_period': 'За период: {time} · {money}',
    'common.back': 'Назад', 'common.forward': 'Вперёд', 'common.cancel': 'Отмена', 'common.ok': 'ОК',
    'common.skip': 'Пропустить', 'common.continue': 'Продолжить',
    'auth.title': 'Вход', 'auth.subtitle': 'Необязательно — приложение и так работает офлайн. Войдите, чтобы синхронизировать данные между устройствами.',
    'auth.email_label': 'Email', 'auth.password_label': 'Пароль',
    'auth.no_account': 'Нет аккаунта с таким email.', 'auth.create_account': 'Создать аккаунт',
    'auth.sign_in': 'Войти', 'auth.sign_in_nav': 'Войти', 'auth.sign_out': 'Выйти',
    'auth.onboarding_title': 'Расскажите о себе', 'auth.name_label': 'Как вас зовут?',
    'auth.usecase_label': 'Для чего будете использовать Lancible?',
    'auth.usecase_personal': 'Личные задачи', 'auth.usecase_freelance': 'Фриланс / клиенты',
    'auth.usecase_team': 'Работа в команде', 'auth.usecase_other': 'Другое',
    'auth.error_invalid': 'Неверный email или пароль.', 'auth.error_generic': 'Что-то пошло не так. Попробуйте ещё раз.',
    'auth.signed_in_toast': 'Вход выполнен', 'auth.signed_out_toast': 'Вы вышли из аккаунта',
    'auth.confirm_title': 'Проверьте почту', 'auth.confirm_text': 'Мы отправили письмо на {email} — перейдите по ссылке в нём, потом войдите тем же паролем.',
    'auth.google_btn': 'Войти через Google', 'auth.or_divider': 'или',
    'sync.conflict_title': 'Какие данные оставить?',
    'sync.conflict_text': 'На сервере уже есть сохранённые данные, а на этом компьютере — свои. Какие использовать?',
    'sync.use_server': 'С сервера', 'sync.use_local': 'С этого компьютера',
    'sync.updated_toast': 'Данные обновлены с другого устройства',
    'common.save': 'Сохранить', 'common.delete_q': 'Удалить?', 'common.delete': 'Удалить',
    'confirm.delete_task_named': 'Удалить «{name}»? Отменить нельзя.',
    'confirm.delete_task': 'Удалить эту задачу? Отменить нельзя.',
    'confirm.delete_project_with_tasks': 'Удалить проект «{name}» и {n} {plural}? Отменить нельзя.',
    'confirm.delete_project': 'Удалить проект «{name}»?',
    'toast.summary_copied': 'Сводка скопирована', 'toast.copy_failed': 'Не удалось скопировать',
    'toast.save_error': 'Ошибка сохранения данных', 'toast.load_error': 'Не удалось загрузить сохранённые данные',
    'toast.file_saved': 'Файл сохранён', 'toast.save_failed': 'Не удалось сохранить: {err}',
    'toast.export_failed': 'Экспорт не удался', 'toast.invalid_interval': 'Некорректный интервал',
    'toast.put_cursor_table': 'Поставь курсор в таблицу',
    'toast.timer_recovered': 'Таймер задачи «{name}» остановлен при закрытии (+{time})',
    'pdlg.name_label': 'Название', 'pdlg.name_ph': 'Название проекта', 'pdlg.desc_label': 'Описание',
    'pdlg.desc_ph': 'Необязательно', 'pdlg.color_label': 'Цвет',
    'sdlg.add_title': 'Добавить запись', 'sdlg.edit_title': 'Изменить запись',
    'sdlg.date_label': 'Дата', 'sdlg.start_label': 'Начало', 'sdlg.end_label': 'Конец',
    'sdlg.duration': 'Длительность: {time}', 'sdlg.check_datetime': 'Проверь дату и время',
    'currency.title': 'Валюта',
    'plural.task': ['задача', 'задачи', 'задач'],
    'xlsx.task': 'Задача', 'xlsx.project': 'Проект', 'xlsx.total_time': 'Всего времени', 'xlsx.sessions': 'Сессий',
    'xlsx.rate_now': 'Ставка сейчас, {cur}/ч', 'xlsx.earned': 'Заработано, {cur}', 'xlsx.exported': 'Выгружено',
    'xlsx.num': '#', 'xlsx.date': 'Дата', 'xlsx.start': 'Начало', 'xlsx.end': 'Конец', 'xlsx.duration': 'Длительность',
    'xlsx.hours': 'Часы', 'xlsx.rate': 'Ставка, {cur}/ч', 'xlsx.sum': 'Сумма, {cur}', 'xlsx.note': 'Примечание',
    'xlsx.recovered': 'восстановлено', 'xlsx.manual': 'вручную', 'xlsx.total': 'Итого',
    'xlsx.status': 'Статус', 'xlsx.done': 'Готово', 'xlsx.active': 'В работе', 'xlsx.first_entry': 'Первая запись',
    'xlsx.last_entry': 'Последняя запись', 'xlsx.description': 'Описание',
    'xlsx.sheet_tasks': 'Задачи', 'xlsx.sheet_sessions': 'Сессии', 'xlsx.default_task_sheet': 'Задача',
    'xlsx.no_project': '—', 'xlsx.no_title': 'Без названия',
    'export.project_fallback': 'Проект', 'export.task_fallback': 'задача', 'export.all_tasks': 'все задачи',
  },
  en: {
    'app.default_project_name': 'My tasks',
    'search.placeholder': 'Search (Ctrl+F)',
    'search.start_typing': 'Start typing a project or task name',
    'search.nothing_found': 'Nothing found',
    'search.projects_group': 'Projects',
    'search.tasks_group': 'Tasks',
    'search.project_sub': '{n} {plural}',
    'search.task_sub': 'project: {name}',
    'nav.home': 'Overview', 'nav.calendar': 'Calendar', 'nav.collapse': 'Collapse',
    'nav.language': 'Language',
    'update.available': 'Update available', 'update.downloading': 'Downloading…', 'update.ready': 'Restart to update',
    'nav.theme_system': 'System', 'nav.theme_light': 'Light', 'nav.theme_dark': 'Dark',
    'stats.worked': 'total worked', 'stats.earned': 'total earned',
    'stats.month': 'earned this month', 'stats.done': 'tasks done',
    'home.title': 'Projects', 'home.create': 'Create project', 'home.pinned': 'Pinned',
    'home.other': 'Other', 'home.recent': 'Recent tasks',
    'home.empty': 'No projects yet. Create the first one.', 'home.calendar_link': 'Calendar',
    'home.created_on': 'created {date}', 'home.new_project_title': 'Create project',
    'weekday.mon': 'Mo', 'weekday.tue': 'Tu', 'weekday.wed': 'We', 'weekday.thu': 'Th',
    'weekday.fri': 'Fr', 'weekday.sat': 'Sa', 'weekday.sun': 'Su',
    'project.all': 'All projects', 'project.tasks': 'Tasks',
    'project.new_task_title': 'New task (Ctrl+N)', 'project.pick_task': 'Pick a task on the left or create a new one.',
    'project.opts': 'Options', 'project.opts_menu': 'Project options',
    'project.open': 'Open', 'project.edit': 'Edit…', 'project.pin': 'Pin to home',
    'project.unpin': 'Unpin from home', 'project.excel': 'Download Excel',
    'project.copy_summary': 'Copy summary', 'project.delete': 'Delete project',
    'project.new_title': 'New project', 'project.edit_title': 'Edit project',
    'project.summary': 'Project: {time} · {money}',
    'filter.all': 'All', 'filter.active': 'Active', 'filter.done': 'Done',
    'sidebar.empty_default': 'No tasks in this project yet.<br />Click "+ New".',
    'sidebar.no_match': 'Nothing matches the filter.',
    'sep.pinned': 'Pinned', 'sep.rest': 'Other', 'sep.done': 'Done',
    'rate.default_label': 'Default rate', 'rate.per_hour': '/h',
    'task.title_ph': 'Task name', 'task.pin_title': 'Pin task',
    'task.unpin_title': 'Unpin task', 'task.delete_title': 'Delete task',
    'task.pin_short': 'Pin to top', 'task.unpin_short': 'Unpin',
    'task.no_name': 'Untitled',
    'tabs.notes': 'Notes', 'tabs.history': 'History',
    'timer.sub_default': 'total time on task', 'timer.start': 'Start', 'timer.stop': 'Stop',
    'timer.recording': 'recording · session {time}', 'timer.other_task': 'timer is running on another task',
    'money.rate_label': 'Rate', 'money.no_rate': 'no rate set', 'money.default_suffix': ' · default',
    'money.calc': '{time} × {rate} {cur}/h =',
    'editor.placeholder': 'Notes, steps, checklist, table…',
    'table.insert_title': 'Insert 3×3 table',
    'table.add_row': '+ row', 'table.add_col': '+ column', 'table.del_row': '− row', 'table.del_col': '− column',
    'table.fill_label': 'fill:', 'table.scope_cell': 'cell', 'table.scope_row': 'row', 'table.scope_col': 'column',
    'table.del_table': 'delete table', 'table.fill_title': 'Fill', 'table.unfill_title': 'Clear fill',
    'history.title': 'Time entries', 'history.add': '+ Add entry', 'history.excel': '⬇ Excel',
    'history.excel_title': 'Export this task’s time log to Excel',
    'history.empty': 'The timer hasn’t been started yet.',
    'session.recovered': ' · recovered', 'session.manual': ' · manual',
    'session.edit_title': 'Edit entry', 'session.delete_title': 'Delete entry', 'session.today': 'today {time}',
    'calendar.month': 'Month', 'calendar.week': 'Week', 'calendar.day': 'Day', 'calendar.today': 'Today',
    'calendar.choose_period': 'Pick a period', 'calendar.pick_day': 'Pick a day',
    'calendar.day_empty': 'No entries on this day.', 'calendar.pick_date': 'Pick a date',
    'calendar.for_month': 'This month', 'calendar.for_week': 'This week',
    'calendar.for_period': 'Period: {time} · {money}',
    'common.back': 'Back', 'common.forward': 'Forward', 'common.cancel': 'Cancel', 'common.ok': 'OK',
    'common.skip': 'Skip', 'common.continue': 'Continue',
    'auth.title': 'Sign in', 'auth.subtitle': 'Optional — the app works offline either way. Sign in to sync your data across devices.',
    'auth.email_label': 'Email', 'auth.password_label': 'Password',
    'auth.no_account': 'No account with this email yet.', 'auth.create_account': 'Create account',
    'auth.sign_in': 'Sign in', 'auth.sign_in_nav': 'Sign in', 'auth.sign_out': 'Sign out',
    'auth.onboarding_title': 'Tell us about yourself', 'auth.name_label': "What's your name?",
    'auth.usecase_label': 'What will you use Lancible for?',
    'auth.usecase_personal': 'Personal tasks', 'auth.usecase_freelance': 'Freelance / clients',
    'auth.usecase_team': 'Team work', 'auth.usecase_other': 'Other',
    'auth.error_invalid': 'Wrong email or password.', 'auth.error_generic': 'Something went wrong. Please try again.',
    'auth.signed_in_toast': 'Signed in', 'auth.signed_out_toast': 'Signed out',
    'auth.confirm_title': 'Check your email', 'auth.confirm_text': "We've sent a confirmation link to {email} — follow it, then sign in with the same password.",
    'auth.google_btn': 'Sign in with Google', 'auth.or_divider': 'or',
    'sync.conflict_title': 'Which data should we keep?',
    'sync.conflict_text': 'There is already saved data on the server, and this computer has its own too. Which should we use?',
    'sync.use_server': 'From the server', 'sync.use_local': 'From this computer',
    'sync.updated_toast': 'Data updated from another device',
    'common.save': 'Save', 'common.delete_q': 'Delete?', 'common.delete': 'Delete',
    'confirm.delete_task_named': 'Delete "{name}"? This can’t be undone.',
    'confirm.delete_task': 'Delete this task? This can’t be undone.',
    'confirm.delete_project_with_tasks': 'Delete project "{name}" and {n} {plural}? This can’t be undone.',
    'confirm.delete_project': 'Delete project "{name}"?',
    'toast.summary_copied': 'Summary copied', 'toast.copy_failed': 'Couldn’t copy',
    'toast.save_error': 'Failed to save data', 'toast.load_error': 'Failed to load saved data',
    'toast.file_saved': 'File saved', 'toast.save_failed': 'Failed to save: {err}',
    'toast.export_failed': 'Export failed', 'toast.invalid_interval': 'Invalid interval',
    'toast.put_cursor_table': 'Place the cursor inside a table',
    'toast.timer_recovered': 'Timer for "{name}" was stopped on close (+{time})',
    'pdlg.name_label': 'Name', 'pdlg.name_ph': 'Project name', 'pdlg.desc_label': 'Description',
    'pdlg.desc_ph': 'Optional', 'pdlg.color_label': 'Color',
    'sdlg.add_title': 'Add entry', 'sdlg.edit_title': 'Edit entry',
    'sdlg.date_label': 'Date', 'sdlg.start_label': 'Start', 'sdlg.end_label': 'End',
    'sdlg.duration': 'Duration: {time}', 'sdlg.check_datetime': 'Check the date and time',
    'currency.title': 'Currency',
    'plural.task': ['task', 'tasks', 'tasks'],
    'xlsx.task': 'Task', 'xlsx.project': 'Project', 'xlsx.total_time': 'Total time', 'xlsx.sessions': 'Sessions',
    'xlsx.rate_now': 'Current rate, {cur}/h', 'xlsx.earned': 'Earned, {cur}', 'xlsx.exported': 'Exported',
    'xlsx.num': '#', 'xlsx.date': 'Date', 'xlsx.start': 'Start', 'xlsx.end': 'End', 'xlsx.duration': 'Duration',
    'xlsx.hours': 'Hours', 'xlsx.rate': 'Rate, {cur}/h', 'xlsx.sum': 'Amount, {cur}', 'xlsx.note': 'Note',
    'xlsx.recovered': 'recovered', 'xlsx.manual': 'manual', 'xlsx.total': 'Total',
    'xlsx.status': 'Status', 'xlsx.done': 'Done', 'xlsx.active': 'Active', 'xlsx.first_entry': 'First entry',
    'xlsx.last_entry': 'Last entry', 'xlsx.description': 'Description',
    'xlsx.sheet_tasks': 'Tasks', 'xlsx.sheet_sessions': 'Sessions', 'xlsx.default_task_sheet': 'Task',
    'xlsx.no_project': '—', 'xlsx.no_title': 'Untitled',
    'export.project_fallback': 'Project', 'export.task_fallback': 'task', 'export.all_tasks': 'all tasks',
  },
  uk: {
    'app.default_project_name': 'Мої завдання',
    'search.placeholder': 'Пошук (Ctrl+F)',
    'search.start_typing': 'Почни вводити назву проєкту або завдання',
    'search.nothing_found': 'Нічого не знайдено',
    'search.projects_group': 'Проєкти',
    'search.tasks_group': 'Завдання',
    'search.project_sub': '{n} {plural}',
    'search.task_sub': 'проєкт: {name}',
    'nav.home': 'Огляд', 'nav.calendar': 'Календар', 'nav.collapse': 'Згорнути',
    'nav.language': 'Мова',
    'update.available': 'Доступне оновлення', 'update.downloading': 'Завантаження…', 'update.ready': 'Перезапустити',
    'nav.theme_system': 'Системна', 'nav.theme_light': 'Світла', 'nav.theme_dark': 'Темна',
    'stats.worked': 'всього відпрацьовано', 'stats.earned': 'всього зароблено',
    'stats.month': 'зароблено цього місяця', 'stats.done': 'завдань виконано',
    'home.title': 'Проєкти', 'home.create': 'Створити проєкт', 'home.pinned': 'Закріплені',
    'home.other': 'Інші', 'home.recent': 'Недавні завдання',
    'home.empty': 'Ще немає жодного проєкту. Створи перший.', 'home.calendar_link': 'Календар',
    'home.created_on': 'створено {date}', 'home.new_project_title': 'Створити проєкт',
    'weekday.mon': 'Пн', 'weekday.tue': 'Вт', 'weekday.wed': 'Ср', 'weekday.thu': 'Чт',
    'weekday.fri': 'Пт', 'weekday.sat': 'Сб', 'weekday.sun': 'Нд',
    'project.all': 'Усі проєкти', 'project.tasks': 'Завдання',
    'project.new_task_title': 'Нове завдання (Ctrl+N)', 'project.pick_task': 'Вибери завдання зліва або створи нове.',
    'project.opts': 'Опції', 'project.opts_menu': 'Опції проєкту',
    'project.open': 'Відкрити', 'project.edit': 'Редагувати…', 'project.pin': 'Закріпити на головній',
    'project.unpin': 'Відкріпити з головної', 'project.excel': 'Завантажити Excel',
    'project.copy_summary': 'Скопіювати підсумок', 'project.delete': 'Видалити проєкт',
    'project.new_title': 'Новий проєкт', 'project.edit_title': 'Редагувати проєкт',
    'project.summary': 'Проєкт: {time} · {money}',
    'filter.all': 'Усі', 'filter.active': 'В роботі', 'filter.done': 'Готово',
    'sidebar.empty_default': 'У цьому проєкті ще немає завдань.<br />Натисни «+ Нове».',
    'sidebar.no_match': 'Нічого не підходить під фільтр.',
    'sep.pinned': 'Закріплені', 'sep.rest': 'Інші', 'sep.done': 'Виконані',
    'rate.default_label': 'Ставка за замовчуванням', 'rate.per_hour': '/год',
    'task.title_ph': 'Назва завдання', 'task.pin_title': 'Закріпити завдання',
    'task.unpin_title': 'Відкріпити завдання', 'task.delete_title': 'Видалити завдання',
    'task.pin_short': 'Закріпити вгорі', 'task.unpin_short': 'Відкріпити',
    'task.no_name': 'Без назви',
    'tabs.notes': 'Нотатки', 'tabs.history': 'Історія',
    'timer.sub_default': 'загальний час по завданню', 'timer.start': 'Старт', 'timer.stop': 'Стоп',
    'timer.recording': 'триває запис · сесія {time}', 'timer.other_task': 'таймер працює на іншому завданні',
    'money.rate_label': 'Ставка', 'money.no_rate': 'ставку не задано', 'money.default_suffix': ' · за замовчуванням',
    'money.calc': '{time} × {rate} {cur}/год =',
    'editor.placeholder': 'Нотатки, кроки, чекліст, таблиця…',
    'table.insert_title': 'Вставити таблицю 3×3',
    'table.add_row': '+ рядок', 'table.add_col': '+ стовпець', 'table.del_row': '− рядок', 'table.del_col': '− стовпець',
    'table.fill_label': 'залити:', 'table.scope_cell': 'комірку', 'table.scope_row': 'рядок', 'table.scope_col': 'стовпець',
    'table.del_table': 'видалити таблицю', 'table.fill_title': 'Залити', 'table.unfill_title': 'Прибрати заливку',
    'history.title': 'Записи часу', 'history.add': '+ Додати запис', 'history.excel': '⬇ Excel',
    'history.excel_title': 'Вивантажити журнал часу цього завдання в Excel',
    'history.empty': 'Таймер ще жодного разу не запускали.',
    'session.recovered': ' · відновлено', 'session.manual': ' · вручну',
    'session.edit_title': 'Змінити запис', 'session.delete_title': 'Видалити запис', 'session.today': 'сьогодні {time}',
    'calendar.month': 'Місяць', 'calendar.week': 'Тиждень', 'calendar.day': 'День', 'calendar.today': 'Сьогодні',
    'calendar.choose_period': 'Обрати період', 'calendar.pick_day': 'Обери день',
    'calendar.day_empty': 'Цього дня записів не було.', 'calendar.pick_date': 'Обрати дату',
    'calendar.for_month': 'За місяць', 'calendar.for_week': 'За тиждень',
    'calendar.for_period': 'За період: {time} · {money}',
    'common.back': 'Назад', 'common.forward': 'Вперед', 'common.cancel': 'Скасувати', 'common.ok': 'ОК',
    'common.skip': 'Пропустити', 'common.continue': 'Продовжити',
    'auth.title': 'Вхід', 'auth.subtitle': 'Необов’язково — застосунок і так працює офлайн. Увійдіть, щоб синхронізувати дані між пристроями.',
    'auth.email_label': 'Email', 'auth.password_label': 'Пароль',
    'auth.no_account': 'Немає акаунта з таким email.', 'auth.create_account': 'Створити акаунт',
    'auth.sign_in': 'Увійти', 'auth.sign_in_nav': 'Увійти', 'auth.sign_out': 'Вийти',
    'auth.onboarding_title': 'Розкажіть про себе', 'auth.name_label': 'Як вас звати?',
    'auth.usecase_label': 'Для чого будете використовувати Lancible?',
    'auth.usecase_personal': 'Особисті завдання', 'auth.usecase_freelance': 'Фриланс / клієнти',
    'auth.usecase_team': 'Робота в команді', 'auth.usecase_other': 'Інше',
    'auth.error_invalid': 'Невірний email або пароль.', 'auth.error_generic': 'Щось пішло не так. Спробуйте ще раз.',
    'auth.signed_in_toast': 'Вхід виконано', 'auth.signed_out_toast': 'Ви вийшли з акаунта',
    'auth.confirm_title': 'Перевірте пошту', 'auth.confirm_text': 'Ми надіслали лист на {email} — перейдіть за посиланням у ньому, потім увійдіть тим самим паролем.',
    'auth.google_btn': 'Увійти через Google', 'auth.or_divider': 'або',
    'sync.conflict_title': 'Які дані залишити?',
    'sync.conflict_text': 'На сервері вже є збережені дані, а на цьому комп’ютері — свої. Які використати?',
    'sync.use_server': 'З сервера', 'sync.use_local': 'З цього комп’ютера',
    'sync.updated_toast': 'Дані оновлено з іншого пристрою',
    'common.save': 'Зберегти', 'common.delete_q': 'Видалити?', 'common.delete': 'Видалити',
    'confirm.delete_task_named': 'Видалити «{name}»? Скасувати не можна.',
    'confirm.delete_task': 'Видалити це завдання? Скасувати не можна.',
    'confirm.delete_project_with_tasks': 'Видалити проєкт «{name}» і {n} {plural}? Скасувати не можна.',
    'confirm.delete_project': 'Видалити проєкт «{name}»?',
    'toast.summary_copied': 'Підсумок скопійовано', 'toast.copy_failed': 'Не вдалося скопіювати',
    'toast.save_error': 'Помилка збереження даних', 'toast.load_error': 'Не вдалося завантажити збережені дані',
    'toast.file_saved': 'Файл збережено', 'toast.save_failed': 'Не вдалося зберегти: {err}',
    'toast.export_failed': 'Експорт не вдався', 'toast.invalid_interval': 'Некоректний інтервал',
    'toast.put_cursor_table': 'Постав курсор у таблицю',
    'toast.timer_recovered': 'Таймер завдання «{name}» зупинено під час закриття (+{time})',
    'pdlg.name_label': 'Назва', 'pdlg.name_ph': 'Назва проєкту', 'pdlg.desc_label': 'Опис',
    'pdlg.desc_ph': 'Необов’язково', 'pdlg.color_label': 'Колір',
    'sdlg.add_title': 'Додати запис', 'sdlg.edit_title': 'Змінити запис',
    'sdlg.date_label': 'Дата', 'sdlg.start_label': 'Початок', 'sdlg.end_label': 'Кінець',
    'sdlg.duration': 'Тривалість: {time}', 'sdlg.check_datetime': 'Перевір дату й час',
    'currency.title': 'Валюта',
    'plural.task': ['завдання', 'завдання', 'завдань'],
    'xlsx.task': 'Завдання', 'xlsx.project': 'Проєкт', 'xlsx.total_time': 'Загальний час', 'xlsx.sessions': 'Сесій',
    'xlsx.rate_now': 'Ставка зараз, {cur}/год', 'xlsx.earned': 'Зароблено, {cur}', 'xlsx.exported': 'Вивантажено',
    'xlsx.num': '#', 'xlsx.date': 'Дата', 'xlsx.start': 'Початок', 'xlsx.end': 'Кінець', 'xlsx.duration': 'Тривалість',
    'xlsx.hours': 'Години', 'xlsx.rate': 'Ставка, {cur}/год', 'xlsx.sum': 'Сума, {cur}', 'xlsx.note': 'Примітка',
    'xlsx.recovered': 'відновлено', 'xlsx.manual': 'вручну', 'xlsx.total': 'Разом',
    'xlsx.status': 'Статус', 'xlsx.done': 'Готово', 'xlsx.active': 'В роботі', 'xlsx.first_entry': 'Перший запис',
    'xlsx.last_entry': 'Останній запис', 'xlsx.description': 'Опис',
    'xlsx.sheet_tasks': 'Завдання', 'xlsx.sheet_sessions': 'Сесії', 'xlsx.default_task_sheet': 'Завдання',
    'xlsx.no_project': '—', 'xlsx.no_title': 'Без назви',
    'export.project_fallback': 'Проєкт', 'export.task_fallback': 'завдання', 'export.all_tasks': 'усі завдання',
  },
  kk: {
    'app.default_project_name': 'Менің тапсырмаларым',
    'search.placeholder': 'Іздеу (Ctrl+F)',
    'search.start_typing': 'Жоба немесе тапсырма атауын тере баста',
    'search.nothing_found': 'Ештеңе табылмады',
    'search.projects_group': 'Жобалар',
    'search.tasks_group': 'Тапсырмалар',
    'search.project_sub': '{n} {plural}',
    'search.task_sub': 'жоба: {name}',
    'nav.home': 'Шолу', 'nav.calendar': 'Күнтізбе', 'nav.collapse': 'Жию',
    'nav.language': 'Тіл',
    'update.available': 'Жаңарту бар', 'update.downloading': 'Жүктелуде…', 'update.ready': 'Қайта іске қосу',
    'nav.theme_system': 'Жүйелік', 'nav.theme_light': 'Ашық', 'nav.theme_dark': 'Қараңғы',
    'stats.worked': 'барлығы істелген уақыт', 'stats.earned': 'барлығы табылған',
    'stats.month': 'осы айда табылды', 'stats.done': 'тапсырма орындалды',
    'home.title': 'Жобалар', 'home.create': 'Жоба құру', 'home.pinned': 'Бекітілген',
    'home.other': 'Басқалары', 'home.recent': 'Соңғы тапсырмалар',
    'home.empty': 'Әзірге жоба жоқ. Біріншісін құр.', 'home.calendar_link': 'Күнтізбе',
    'home.created_on': 'құрылды {date}', 'home.new_project_title': 'Жоба құру',
    'weekday.mon': 'Дс', 'weekday.tue': 'Сс', 'weekday.wed': 'Ср', 'weekday.thu': 'Бс',
    'weekday.fri': 'Жм', 'weekday.sat': 'Сб', 'weekday.sun': 'Жс',
    'project.all': 'Барлық жобалар', 'project.tasks': 'Тапсырмалар',
    'project.new_task_title': 'Жаңа тапсырма (Ctrl+N)', 'project.pick_task': 'Сол жақтан тапсырманы таңда немесе жаңасын құр.',
    'project.opts': 'Опциялар', 'project.opts_menu': 'Жоба опциялары',
    'project.open': 'Ашу', 'project.edit': 'Өңдеу…', 'project.pin': 'Басты бетке бекіту',
    'project.unpin': 'Басты беттен алып тастау', 'project.excel': 'Excel жүктеу',
    'project.copy_summary': 'Қорытындыны көшіру', 'project.delete': 'Жобаны жою',
    'project.new_title': 'Жаңа жоба', 'project.edit_title': 'Жобаны өңдеу',
    'project.summary': 'Жоба: {time} · {money}',
    'filter.all': 'Барлығы', 'filter.active': 'Жұмыста', 'filter.done': 'Дайын',
    'sidebar.empty_default': 'Бұл жобада әлі тапсырма жоқ.<br />«+ Жаңа» түймесін бас.',
    'sidebar.no_match': 'Сүзгіге сәйкес ештеңе жоқ.',
    'sep.pinned': 'Бекітілген', 'sep.rest': 'Басқалары', 'sep.done': 'Орындалған',
    'rate.default_label': 'Әдепкі баға', 'rate.per_hour': '/сағ',
    'task.title_ph': 'Тапсырма атауы', 'task.pin_title': 'Тапсырманы бекіту',
    'task.unpin_title': 'Бекітуден алу', 'task.delete_title': 'Тапсырманы жою',
    'task.pin_short': 'Жоғарыға бекіту', 'task.unpin_short': 'Бекітуден алу',
    'task.no_name': 'Атаусыз',
    'tabs.notes': 'Жазбалар', 'tabs.history': 'Тарих',
    'timer.sub_default': 'тапсырма бойынша жалпы уақыт', 'timer.start': 'Старт', 'timer.stop': 'Тоқтату',
    'timer.recording': 'жазылуда · сессия {time}', 'timer.other_task': 'таймер басқа тапсырмада жүріп жатыр',
    'money.rate_label': 'Баға', 'money.no_rate': 'баға белгіленбеген', 'money.default_suffix': ' · әдепкі',
    'money.calc': '{time} × {rate} {cur}/сағ =',
    'editor.placeholder': 'Жазбалар, қадамдар, чек-лист, кесте…',
    'table.insert_title': '3×3 кесте кірістіру',
    'table.add_row': '+ жол', 'table.add_col': '+ баған', 'table.del_row': '− жол', 'table.del_col': '− баған',
    'table.fill_label': 'бояу:', 'table.scope_cell': 'ұяшық', 'table.scope_row': 'жол', 'table.scope_col': 'баған',
    'table.del_table': 'кестені жою', 'table.fill_title': 'Бояу', 'table.unfill_title': 'Бояуды өшіру',
    'history.title': 'Уақыт жазбалары', 'history.add': '+ Жазба қосу', 'history.excel': '⬇ Excel',
    'history.excel_title': 'Осы тапсырманың уақыт журналын Excel-ге жүктеу',
    'history.empty': 'Таймер әлі бір рет те іске қосылмаған.',
    'session.recovered': ' · қалпына келтірілді', 'session.manual': ' · қолмен',
    'session.edit_title': 'Жазбаны өзгерту', 'session.delete_title': 'Жазбаны жою', 'session.today': 'бүгін {time}',
    'calendar.month': 'Ай', 'calendar.week': 'Апта', 'calendar.day': 'Күн', 'calendar.today': 'Бүгін',
    'calendar.choose_period': 'Кезеңді таңдау', 'calendar.pick_day': 'Күнді таңда',
    'calendar.day_empty': 'Бұл күні жазба болған жоқ.', 'calendar.pick_date': 'Күнді таңдау',
    'calendar.for_month': 'Ай бойынша', 'calendar.for_week': 'Апта бойынша',
    'calendar.for_period': 'Кезең бойынша: {time} · {money}',
    'common.back': 'Артқа', 'common.forward': 'Алға', 'common.cancel': 'Бас тарту', 'common.ok': 'ОК',
    'common.skip': 'Өткізіп жіберу', 'common.continue': 'Жалғастыру',
    'auth.title': 'Кіру', 'auth.subtitle': 'Міндетті емес — қолданба офлайн жұмыс істей береді. Құрылғылар арасында деректерді синхрондау үшін кіріңіз.',
    'auth.email_label': 'Email', 'auth.password_label': 'Құпия сөз',
    'auth.no_account': 'Бұл email-мен аккаунт жоқ.', 'auth.create_account': 'Аккаунт құру',
    'auth.sign_in': 'Кіру', 'auth.sign_in_nav': 'Кіру', 'auth.sign_out': 'Шығу',
    'auth.onboarding_title': 'Өзіңіз туралы айтыңыз', 'auth.name_label': 'Атыңыз кім?',
    'auth.usecase_label': 'Lancible-ды не үшін пайдаланасыз?',
    'auth.usecase_personal': 'Жеке тапсырмалар', 'auth.usecase_freelance': 'Фриланс / клиенттер',
    'auth.usecase_team': 'Команда жұмысы', 'auth.usecase_other': 'Басқа',
    'auth.error_invalid': 'Email немесе құпия сөз қате.', 'auth.error_generic': 'Бірдеңе дұрыс болмады. Қайталап көріңіз.',
    'auth.signed_in_toast': 'Кіру сәтті өтті', 'auth.signed_out_toast': 'Аккаунттан шықтыңыз',
    'auth.confirm_title': 'Поштаны тексеріңіз', 'auth.confirm_text': '{email} мекенжайына хат жібердік — сілтеме бойынша өтіп, содан кейін сол құпия сөзбен кіріңіз.',
    'auth.google_btn': 'Google арқылы кіру', 'auth.or_divider': 'немесе',
    'sync.conflict_title': 'Қай деректерді қалдырамыз?',
    'sync.conflict_text': 'Серверде деректер бар, осы компьютерде де өз деректері бар. Қайсысын пайдаланамыз?',
    'sync.use_server': 'Сервердегі', 'sync.use_local': 'Осы компьютердегі',
    'sync.updated_toast': 'Деректер басқа құрылғыдан жаңартылды',
    'common.save': 'Сақтау', 'common.delete_q': 'Жою керек пе?', 'common.delete': 'Жою',
    'confirm.delete_task_named': '«{name}» жойылсын ба? Қайтару мүмкін емес.',
    'confirm.delete_task': 'Бұл тапсырма жойылсын ба? Қайтару мүмкін емес.',
    'confirm.delete_project_with_tasks': '«{name}» жобасы және {n} {plural} жойылсын ба? Қайтару мүмкін емес.',
    'confirm.delete_project': '«{name}» жобасы жойылсын ба?',
    'toast.summary_copied': 'Қорытынды көшірілді', 'toast.copy_failed': 'Көшіру мүмкін болмады',
    'toast.save_error': 'Деректерді сақтау қатесі', 'toast.load_error': 'Сақталған деректерді жүктеу мүмкін болмады',
    'toast.file_saved': 'Файл сақталды', 'toast.save_failed': 'Сақтау мүмкін болмады: {err}',
    'toast.export_failed': 'Экспорт сәтсіз аяқталды', 'toast.invalid_interval': 'Интервал дұрыс емес',
    'toast.put_cursor_table': 'Курсорды кестеге қой',
    'toast.timer_recovered': '«{name}» тапсырмасының таймері жабу кезінде тоқтатылды (+{time})',
    'pdlg.name_label': 'Атауы', 'pdlg.name_ph': 'Жоба атауы', 'pdlg.desc_label': 'Сипаттама',
    'pdlg.desc_ph': 'Міндетті емес', 'pdlg.color_label': 'Түс',
    'sdlg.add_title': 'Жазба қосу', 'sdlg.edit_title': 'Жазбаны өзгерту',
    'sdlg.date_label': 'Күні', 'sdlg.start_label': 'Басы', 'sdlg.end_label': 'Соңы',
    'sdlg.duration': 'Ұзақтығы: {time}', 'sdlg.check_datetime': 'Күні мен уақытын тексер',
    'currency.title': 'Валюта',
    'plural.task': ['тапсырма', 'тапсырма', 'тапсырма'],
    'xlsx.task': 'Тапсырма', 'xlsx.project': 'Жоба', 'xlsx.total_time': 'Жалпы уақыт', 'xlsx.sessions': 'Сессиялар',
    'xlsx.rate_now': 'Қазіргі баға, {cur}/сағ', 'xlsx.earned': 'Табылды, {cur}', 'xlsx.exported': 'Жүктелген күні',
    'xlsx.num': '#', 'xlsx.date': 'Күні', 'xlsx.start': 'Басы', 'xlsx.end': 'Соңы', 'xlsx.duration': 'Ұзақтығы',
    'xlsx.hours': 'Сағат', 'xlsx.rate': 'Баға, {cur}/сағ', 'xlsx.sum': 'Сома, {cur}', 'xlsx.note': 'Ескертпе',
    'xlsx.recovered': 'қалпына келтірілді', 'xlsx.manual': 'қолмен', 'xlsx.total': 'Жиыны',
    'xlsx.status': 'Күйі', 'xlsx.done': 'Дайын', 'xlsx.active': 'Жұмыста', 'xlsx.first_entry': 'Алғашқы жазба',
    'xlsx.last_entry': 'Соңғы жазба', 'xlsx.description': 'Сипаттама',
    'xlsx.sheet_tasks': 'Тапсырмалар', 'xlsx.sheet_sessions': 'Сессиялар', 'xlsx.default_task_sheet': 'Тапсырма',
    'xlsx.no_project': '—', 'xlsx.no_title': 'Атаусыз',
    'export.project_fallback': 'Жоба', 'export.task_fallback': 'тапсырма', 'export.all_tasks': 'барлық тапсырмалар',
  },
};

/** Текущий язык интерфейса. */
const lang = () => (state.settings && state.settings.lang) || 'ru';
const locale = () => LOCALE_MAP[lang()] || 'ru-RU';

/** t('key', {a:1}) — перевод строки с подстановкой {a}; откат на русский, затем на сам ключ. */
function t(key, vars) {
  const dict = T[lang()] || T.ru;
  let s = dict[key] !== undefined ? dict[key] : (T.ru[key] !== undefined ? T.ru[key] : key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Число + правильная форма слова "задача" под текущий язык. */
function pluralForm(n, baseKey) {
  const forms = (T[lang()] && T[lang()][baseKey]) || T.ru[baseKey];
  const l = lang();
  if (l === 'en') return forms[n === 1 ? 0 : 1];
  if (l === 'kk') return forms[0];
  // ru / uk — общее славянское правило
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

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

  homeCount: $('home-count'),
  pinnedSection: $('pinned-section'), pinnedTrack: $('pinned-track'),
  projectsTrack: $('projects-track'), allLabel: $('all-label'),
  recentSection: $('recent-section'), recentTrack: $('recent-track'),
  homeEmpty: $('home-empty'), createProjectBtn: $('create-project-btn'),

  miniCalTitle: $('mini-cal-title'), miniCalTot: $('mini-cal-tot'),
  miniCal: $('mini-cal'), sideToday: $('side-today'), openCalendarBtn: $('open-calendar'),

  backHome: $('back-home'), phDot: $('ph-dot'), phName: $('ph-name'),
  phDesc: $('ph-desc'), projectMenuBtn: $('project-menu-btn'),

  taskList: $('task-list'), sidebarEmpty: $('sidebar-empty'), newTaskBtn: $('new-task-btn'),
  defaultRate: $('default-rate'), currency: $('currency'), projectEarned: $('project-earned'),

  tfStatus: [...document.querySelectorAll('.tf-status button')],

  emptyState: $('empty-state'), detail: $('task-detail'),
  title: $('task-title'), pinTaskBtn: $('pin-task-btn'),
  taskTabs: [...document.querySelectorAll('.task-tabs button')], tabNotes: $('tab-notes'), tabHistory: $('tab-history'),
  timerDisplay: $('timer-display'), timerSub: $('timer-sub'), timerBtn: $('timer-btn'),
  timerBtnIcon: $('timer-btn-icon'), timerBtnLabel: $('timer-btn-label'),
  deleteBtn: $('delete-task-btn'), exportTaskBtn: $('export-task-btn'),
  taskRate: $('task-rate'), rateUnit: $('rate-unit'), moneyCalc: $('money-calc'),
  tableTools: $('table-tools'), ttSwatches: $('tt-swatches'),
  sessionList: $('session-list'), sessionCount: $('session-count'),
  sessionEmpty: $('session-empty'), addSessionBtn: $('add-session-btn'),

  calModes: [...document.querySelectorAll('.cal-modes button')],
  calPrev: $('cal-prev'), calNext: $('cal-next'), calToday: $('cal-today'),
  calTitle: $('cal-title'), calPeriodTot: $('cal-period-tot'), calDays: $('cal-days'),
  calWeekdays: $('cal-weekdays'),
  calPeriodToggle: $('cal-period-toggle'), calRange: $('cal-range'),
  rangeFromBtn: $('range-from-btn'), rangeToBtn: $('range-to-btn'),
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

function taskElapsedMs(task) {
  let ms = task.totalMs || 0;
  if (state.activeTimer && state.activeTimer.taskId === task.id) {
    ms += Date.now() - new Date(state.activeTimer.startedAt).getTime();
  }
  return ms;
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}
const DUR_UNITS = {
  ru: { h: 'ч', m: 'м' }, en: { h: 'h', m: 'm' }, uk: { h: 'г', m: 'хв' }, kk: { h: 'сағ', m: 'мин' },
};
function fmtShort(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const u = DUR_UNITS[lang()] || DUR_UNITS.ru;
  if (h === 0) return `${m}${u.m}`;
  return m === 0 ? `${h}${u.h}` : `${h}${u.h} ${m}${u.m}`;
}
const fmtDur = (ms) => (fmtShort(ms) === '—' ? `0${(DUR_UNITS[lang()] || DUR_UNITS.ru).m}` : fmtShort(ms));

function fmtWhen(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t('session.today', { time });
  return `${d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })} ${time}`;
}
const fmtDateShort = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const monthLabel = (y, m) => `${capFirst(new Date(y, m, 1).toLocaleDateString(locale(), { month: 'long' }))} ${y}`;
const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const fmtTime = (iso) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const dayKey = (d) => {
  d = new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const hoursOf = (ms) => ms / 3_600_000;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Деньги
// ---------------------------------------------------------------------------

const moneyFmt = () => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 });

function parseNum(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const currencySym = () => {
  const c = state.settings && state.settings.currency;
  return CURRENCIES[c] || c || '₽';
};

function effectiveRate(task) {
  const own = task.rate;
  if (own !== null && own !== undefined && own !== '' && Number.isFinite(Number(own))) return Number(own);
  return Number(state.settings && state.settings.hourlyRate) || 0;
}
const hasOwnRate = (task) =>
  task.rate !== null && task.rate !== undefined && task.rate !== '' && Number.isFinite(Number(task.rate));

function sessionRate(s, task) {
  const r = s && s.rate;
  return r !== null && r !== undefined && Number.isFinite(Number(r)) ? Number(r) : effectiveRate(task);
}
const sessionMoney = (s, task) => hoursOf(s.ms) * sessionRate(s, task);

function earnedOf(task) {
  let money = (task.sessions || []).reduce((a, s) => a + sessionMoney(s, task), 0);
  if (state.activeTimer && state.activeTimer.taskId === task.id) {
    const runMs = Date.now() - new Date(state.activeTimer.startedAt).getTime();
    money += hoursOf(runMs) * effectiveRate(task);
  }
  return money;
}

const fmtMoney = (n) => `${moneyFmt().format(Math.round((n + Number.EPSILON) * 100) / 100)} ${currencySym()}`;
const projectMoney = (id) => tasksOf(id).reduce((a, t2) => a + earnedOf(t2), 0);
const projectMs = (id) => tasksOf(id).reduce((a, t2) => a + taskElapsedMs(t2), 0);

function allSessionPairs() {
  const out = [];
  for (const t2 of state.tasks) for (const s of t2.sessions || []) out.push({ t: t2, s });
  return out;
}
function aggregateDays() {
  const map = new Map();
  for (const { t: t2, s } of allSessionPairs()) {
    const k = dayKey(s.start);
    let e = map.get(k);
    if (!e) { e = { ms: 0, money: 0, count: 0 }; map.set(k, e); }
    e.ms += s.ms;
    e.money += sessionMoney(s, t2);
    e.count += 1;
  }
  return map;
}
/** Сумма за диапазон дат [from, to] включительно (Date). */
function rangeAgg(from, to) {
  let ms = 0;
  let money = 0;
  for (const { t: t2, s } of allSessionPairs()) {
    const d = new Date(s.start);
    if (d >= from && d <= to) { ms += s.ms; money += sessionMoney(s, t2); }
  }
  return { ms, money };
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
  !el.confirmBackdrop.hidden || !el.searchPanel.hidden;

// ---------------------------------------------------------------------------
// Диалог подтверждения (замена системного confirm())
// ---------------------------------------------------------------------------

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
function openLangMenu() {
  const items = Object.keys(LANG_NAMES).map((code) => ({
    label: LANG_NAMES[code],
    selected: code === ((state.settings && state.settings.lang) || 'ru'),
    onClick: () => setLang(code),
  }));
  openMenu(el.langToggle, items);
}
el.langToggle.addEventListener('click', openLangMenu);

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

if (window.api.onUpdateAvailable) {
  window.api.onUpdateAvailable(() => { updateState = 'available'; renderUpdateBtn(); });
  window.api.onUpdateProgress(({ percent }) => { el.updateProgress.style.width = `${Math.round(percent || 0)}%`; });
  window.api.onUpdateReady(() => { updateState = 'ready'; renderUpdateBtn(); });
  window.api.onUpdateError(() => { updateState = 'idle'; renderUpdateBtn(); });
}

el.updateBtn.addEventListener('click', async () => {
  if (updateState === 'available') {
    updateState = 'downloading';
    renderUpdateBtn();
    try {
      const r = await window.api.downloadUpdate();
      if (!r || !r.ok) { updateState = 'available'; renderUpdateBtn(); }
    } catch {
      updateState = 'available';
      renderUpdateBtn();
    }
  } else if (updateState === 'ready') {
    window.api.installUpdate();
  }
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
  await syncOnSignIn();
  if (!silent) {
    closeAuthModal();
    toast(t('auth.signed_in_toast'));
  }
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

async function signOut() {
  await sb.auth.signOut();
  unsubscribeSyncRealtime();
  currentUser = null;
  renderAccountBtn();
  toast(t('auth.signed_out_toast'));
}

async function handleGoogleSignIn() {
  el.authGoogleBtn.disabled = true;
  el.authError.hidden = true;
  try {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'lancible://auth-callback', skipBrowserRedirect: true },
    });
    if (error || !data || !data.url) { showAuthError('auth.error_generic'); return; }
    await window.api.openExternal(data.url);
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

el.accountBtn.addEventListener('click', () => {
  if (currentUser) openMenu(el.accountBtn, [{ label: t('auth.sign_out'), danger: true, onClick: signOut }]);
  else openAuthModal();
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
  return { projects: state.projects, tasks: state.tasks };
}

async function pushSyncState() {
  if (!currentUser) return;
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
  if (selectedId && !getTask(selectedId)) selectedId = null;
  if (state.ui.projectId && !getProject(state.ui.projectId)) {
    state.ui.view = 'home';
    state.ui.projectId = null;
  }
  lastSyncedJSON = JSON.stringify(syncPayload());
  render();
  scheduleSave(); // сохраняем локально; pushSyncState сам не отправит лишнего — см. lastSyncedJSON
}

/** При входе: если на сервере ничего нет — заливаем локальные данные; если
 * локально пусто — просто подтягиваем с сервера; если данные есть и там, и
 * там — спрашиваем пользователя (нетривиальный случай первого мерджа, который
 * план изначально откладывал на этот момент). */
async function syncOnSignIn() {
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
  } else {
    const useServer = await confirmDialog(t('sync.conflict_text'), {
      title: t('sync.conflict_title'),
      okLabel: t('sync.use_server'),
      cancelLabel: t('sync.use_local'),
      danger: false,
    });
    if (useServer) applyRemoteData(row.data);
    else await pushSyncState();
  }
  subscribeSyncRealtime();
}

function subscribeSyncRealtime() {
  unsubscribeSyncRealtime();
  if (!currentUser) return;
  syncChannel = sb
    .channel('sync_state:' + currentUser.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_state', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
      const row = payload.new;
      if (!row || row.updated_by === SYNC_CLIENT_ID) return; // эхо нашей же записи
      applyRemoteData(row.data);
      toast(t('sync.updated_toast'));
    })
    .subscribe();
}
function unsubscribeSyncRealtime() {
  if (syncChannel) { sb.removeChannel(syncChannel); syncChannel = null; }
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
  renderStats();
  el.topbar.hidden = v !== 'home';

  el.navItems.forEach((tab) => {
    const active = tab.dataset.view === v || (tab.dataset.view === 'home' && v === 'project');
    tab.classList.toggle('active', active);
  });

  const views = { home: el.homeView, project: el.projectView, calendar: el.calendarView };
  for (const [name, node] of Object.entries(views)) {
    const show = name === v;
    node.hidden = !show;
    if (show) { node.classList.remove('anim'); void node.offsetWidth; node.classList.add('anim'); }
  }

  if (v === 'home') renderHome();
  else if (v === 'project') { renderProjectHeader(); renderSidebar(); renderDetail(); renderFooter(); }
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
  tile.innerHTML = `
    <button class="ptile-menu icon-btn" aria-label="${escapeHtml(t('project.opts'))}" tabindex="-1">
      <svg class="icon" viewBox="0 0 16 16"><path d="M8 2.4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.1a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>
    </button>
    <div class="ptile-main">
      <div class="ptile-name">${escapeHtml(p.name)}${p.pinnedAt ? `<span class="ptile-badge">${icon('pin')}</span>` : ''}</div>
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
    task.done = cb.checked;
    task.updatedAt = new Date().toISOString();
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
  updateRangeBtns();
}

function togglePeriod() {
  calState.periodOn = !calState.periodOn;
  el.calPeriodToggle.setAttribute('aria-pressed', String(calState.periodOn));
  if (calState.periodOn) {
    seedRangeFromView();
    el.calRange.hidden = false;
    el.calRange.classList.remove('anim');
    void el.calRange.offsetWidth;
    el.calRange.classList.add('anim');
  } else {
    el.calRange.hidden = true;
    closeDatePicker();
  }
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
  updateRangeBtns();
  renderCalendar();
}

// ---------------------------------------------------------------------------
// Кастомный выбор даты — переиспользуемый попап (период в календаре, диалог
// записи времени) вместо системного календаря у <input type="date">.
// ---------------------------------------------------------------------------

const dp = { open: false, anchor: null, value: null, view: new Date(), onPick: null };

function fmtDpBtn(key) {
  if (!key) return t('calendar.pick_date');
  return keyToDate(key).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}
function updateRangeBtns() {
  el.rangeFromBtn.textContent = fmtDpBtn(calState.rangeFrom);
  el.rangeToBtn.textContent = fmtDpBtn(calState.rangeTo);
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
  el.calPeriodTot.textContent = t('calendar.for_period', { time: fmtDur(totalMs), money: fmtMoney(totalMoney) });
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
    task.done = cb.checked;
    task.updatedAt = new Date().toISOString();
    li.classList.toggle('done', task.done);
    renderStats();
    scheduleSave();
  });

  const name = document.createElement('span');
  name.className = 'task-name';
  name.textContent = task.title || t('task.no_name');

  const meta = document.createElement('span');
  meta.className = 'task-meta';

  const pin = document.createElement('button');
  pin.className = 'task-pin';
  pin.innerHTML = icon('pin');
  pin.title = task.pinnedAt ? t('task.unpin_short') : t('task.pin_short');
  pin.addEventListener('click', (e) => { e.stopPropagation(); togglePinTask(task.id); });
  meta.appendChild(pin);

  if (state.activeTimer && state.activeTimer.taskId === task.id) {
    const dot = document.createElement('span');
    dot.className = 'running-dot';
    dot.textContent = '●';
    meta.appendChild(dot);
  }
  const time = document.createElement('span');
  time.className = 'task-time';
  time.textContent = fmtShort(taskElapsedMs(task));
  meta.appendChild(time);

  li.append(cb, name, meta);
  li.addEventListener('click', () => selectTask(task.id));
  return li;
}

// ---------------------------------------------------------------------------
// Деталь задачи
// ---------------------------------------------------------------------------

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
  renderMoney(task);
  renderSessions(task);
}

function renderMoney(task) {
  const own = hasOwnRate(task);
  if (document.activeElement !== el.taskRate) el.taskRate.value = own ? String(task.rate) : '';
  const def = Number(state.settings.hourlyRate) || 0;
  el.taskRate.placeholder = def ? String(def) : '0';
  el.rateUnit.textContent = `${currencySym()}${t('rate.per_hour')}${own ? '' : t('money.default_suffix')}`;

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
  items.push({ label: p.pinnedAt ? t('project.unpin') : t('project.pin'), onClick: () => togglePinProject(p.id) });
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
    const p = { id: uid(), name, description, color: pdlg.color, createdAt: new Date().toISOString(), pinnedAt: null };
    state.projects.push(p);
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
el.rangeFromBtn.addEventListener('click', () => {
  if (dp.open && dp.anchor === el.rangeFromBtn) { closeDatePicker(); return; }
  openDatePicker(el.rangeFromBtn, calState.rangeFrom, (key) => {
    calState.rangeFrom = key; calState.picking = false; updateRangeBtns(); renderCalendar();
  });
});
el.rangeToBtn.addEventListener('click', () => {
  if (dp.open && dp.anchor === el.rangeToBtn) { closeDatePicker(); return; }
  openDatePicker(el.rangeToBtn, calState.rangeTo, (key) => {
    calState.rangeTo = key; calState.picking = false; updateRangeBtns(); renderCalendar();
  });
});
el.dpPrev.addEventListener('click', () => { dp.view = new Date(dp.view.getFullYear(), dp.view.getMonth() - 1, 1); renderDatePicker(); });
el.dpNext.addEventListener('click', () => { dp.view = new Date(dp.view.getFullYear(), dp.view.getMonth() + 1, 1); renderDatePicker(); });

el.tfStatus.forEach((b) => b.addEventListener('click', () => { taskFilter.status = b.dataset.status; renderSidebar(); }));
el.taskTabs.forEach((b) => b.addEventListener('click', () => setTaskTab(b.dataset.tab)));

el.newTaskBtn.addEventListener('click', newTask);
el.timerBtn.addEventListener('click', toggleTimer);
el.deleteBtn.addEventListener('click', () => deleteTask(selectedId));
el.exportTaskBtn.addEventListener('click', exportTask);
el.pinTaskBtn.addEventListener('click', () => selectedId && togglePinTask(selectedId));
el.addSessionBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSessionDialog(getTask(selectedId), null); });

el.stRunning.addEventListener('click', () => {
  const task = state.activeTimer && getTask(state.activeTimer.taskId);
  if (!task) return;
  openProject(task.projectId);
  selectTask(task.id);
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
  const cur = el.currency.value;
  el.currency.innerHTML = '';
  for (const [code, sym] of Object.entries(CURRENCIES)) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = `${code} ${sym}`;
    el.currency.appendChild(o);
  }
  el.currency.title = t('currency.title');
  if (cur) el.currency.value = cur;
}

function migrate() {
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (!Number.isFinite(Number(state.settings.hourlyRate))) state.settings.hourlyRate = 0;
  if (typeof state.ui.navCollapsed !== 'boolean') state.ui.navCollapsed = false;
  if (!['system', 'light', 'dark'].includes(state.settings.theme)) state.settings.theme = 'system';
  if (!T[state.settings.lang]) state.settings.lang = 'ru';

  let cur = state.settings.currency || 'RUB';
  if (SYM2CODE[cur]) cur = SYM2CODE[cur];
  if (!CURRENCIES[cur]) cur = 'RUB';
  state.settings.currency = cur;

  state.projects.forEach((p, i) => {
    if (!p.color) p.color = PALETTE[i % PALETTE.length];
    if (typeof p.description !== 'string') p.description = '';
    if (p.pinnedAt === undefined) p.pinnedAt = null;
  });
  state.tasks.forEach((t2) => {
    if (t2.pinnedAt === undefined) t2.pinnedAt = null;
    if (t2.rate === undefined) t2.rate = null;
  });

  if (state.projects.length === 0 && state.tasks.length > 0) {
    state.projects.push({
      id: uid(), name: t(DEFAULT_PROJECT_NAME_KEY), createdAt: new Date().toISOString(),
      color: PALETTE[0], description: '', pinnedAt: null,
    });
  }
  const known = new Set(state.projects.map((p) => p.id));
  const fallback = state.projects[0] ? state.projects[0].id : null;
  for (const t2 of state.tasks) if (!t2.projectId || !known.has(t2.projectId)) t2.projectId = fallback;
  if (!known.has(state.ui.projectId)) state.ui.projectId = fallback;
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
}

init();

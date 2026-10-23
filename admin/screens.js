/* Известные экраны по платформам — для раздела «Экраны» админки: что ни разу
 * не открывали, видно только против полного списка.
 *
 * Клиент шлёт rpc('track_screen', { p_screen, p_platform }) при открытии
 * экрана; идентификатор — короткий латинский, как здесь (проверка в базе:
 * ^[a-z][a-z0-9_.-]{0,39}$). Списки — те же, что у клиентов:
 *   веб и десктоп — USAGE_SCREENS в src/renderer/app.js;
 *   телефон (Android и iOS) — PHONE_SCREENS в mobile/src/lib/screenStats.js.
 * Совпадение сверяет tests/admin/screens.spec.js. Новый экран в приложении —
 * строка и сюда, иначе админка покажет его с пометкой «нет в списке».
 * Подписи — для админа, на русском.
 *
 * Файл читают и браузер (window.AdminScreens), и Node (require). */
(function (global) {
  /** Подписи всех экранов; у одинаковых экранов разных платформ имя одно. */
  const LABELS = {
    today: 'Сегодня',
    projects: 'Проекты',
    project: 'Проект',
    'project.board': 'Проект: доска',
    'project.versions': 'Проект: версии',
    'project.docs': 'Проект: документы',
    'project.statuses': 'Проект: статусы',
    'project.settings': 'Проект: настройки',
    'project.new': 'Новый проект',
    tasks: 'Задачи',
    task: 'Задача',
    'task.modal': 'Задача: окно',
    docs: 'Документы',
    doc: 'Документ',
    stats: 'Цифры',
    'stats.day': 'Время: день',
    'stats.week': 'Время: неделя',
    'stats.month': 'Время: месяц',
    'stats.agenda': 'Время: расписание',
    settings: 'Настройки',
    'settings.main': 'Настройки: основное',
    'settings.work': 'Настройки: работа',
    'settings.account': 'Настройки: аккаунт',
    'settings.data': 'Настройки: данные',
    'settings.about': 'Настройки: о приложении',
    'settings.feedback': 'Обратная связь',
    agent: 'Агент',
    'agent.chat': 'Агент: чат',
    search: 'Поиск',
    notifications: 'Уведомления',
    tags: 'Теги',
    menu: 'Меню',
    export: 'Экспорт',
    conflicts: 'Другие версии',
    trash: 'Корзина',
  };

  // Десктоп и веб — одно приложение: экраны общие (USAGE_SCREENS).
  const APP = [
    'today', 'projects', 'project', 'project.board', 'project.versions', 'project.docs', 'project.settings', 'project.new',
    'task', 'task.modal', 'docs', 'doc',
    'stats.day', 'stats.week', 'stats.month', 'stats.agenda',
    'settings', 'settings.main', 'settings.work', 'settings.account', 'settings.data', 'settings.about', 'settings.feedback',
    'agent', 'agent.chat', 'search', 'notifications', 'export', 'conflicts', 'trash',
  ];

  // Телефон — Android и iOS одинаково (PHONE_SCREENS). Только у телефона:
  // tasks, menu, project.statuses, tags, stats.
  const PHONE = [
    'projects', 'tasks', 'agent', 'agent.chat', 'stats', 'menu',
    'settings.main', 'settings.work', 'settings.account', 'settings.data', 'settings.about', 'settings.feedback',
    'project', 'project.statuses', 'project.new', 'project.settings', 'task',
    'docs', 'doc', 'notifications', 'search', 'tags', 'conflicts', 'trash', 'export',
  ];

  const toList = (ids) => ids.map((id) => ({ id, label: LABELS[id] || id }));

  const SCREENS = {
    web: toList(APP),
    desktop: toList(APP),
    android: toList(PHONE),
    ios: toList(PHONE),
  };

  const PLATFORMS = [
    { id: 'web', label: 'Веб' },
    { id: 'desktop', label: 'Десктоп' },
    { id: 'android', label: 'Android' },
    { id: 'ios', label: 'iOS' },
  ];

  /** Подпись экрана платформы; неизвестный этой платформе — null. */
  function screenLabel(platform, id) {
    const hit = (SCREENS[platform] || []).find((s) => s.id === id);
    return hit ? hit.label : null;
  }

  const api = { SCREENS, PLATFORMS, LABELS, screenLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AdminScreens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Адреса экранов — чистая логика, без DOM и без state.
 *
 * Каждый экран и открытая сущность живут в адресе после «#»: обновление
 * страницы и ссылка, отправленная другому человеку, возвращают туда же, где
 * стояли. Хэш, а не путь, потому что у веба нет сервера, который бы отдавал
 * приложение по /project/<id>, а десктоп грузит index.html с диска.
 *
 *   #/today                      «Сегодня»
 *   #/projects                   проекты
 *   #/project/<id>[/<вкладка>]   проект; вкладка — board | versions | docs,
 *                                без неё — список задач
 *   #/task/<id>                  задача
 *   #/docs                       документы
 *   #/doc/<id>                   документ
 *   #/stats[/<режим>]            статистика (бывшее «Время»); режим — day |
 *                                week | month | agenda
 *   #/settings[/<раздел>]        настройки; раздел — main | work | account |
 *                                data | about | feedback, без него — список
 *                                разделов
 *
 * Старое имя #/time разбирается как #/stats: ссылки, отправленные до
 * переименования, продолжают работать, а адрес заменяется на новый.
 *
 * Внутри приложения у экрана прежние имена вида: home, projects, project,
 * task, docs, time, settings — в адресе же человеческие. Всё, что не
 * разобралось (пусто, мусор, неизвестный экран, нет id), — «Сегодня»: это
 * экран по умолчанию, и пустой страницы по кривой ссылке не бывает.
 *
 * Есть ли сущность с таким id, ядро не знает — это решает приложение.
 */
(function (global) {
  const HOME = 'home';

  /** Имя в адресе → вид экрана. */
  const SCREENS = {
    today: 'home',
    projects: 'projects',
    project: 'project',
    task: 'task',
    docs: 'docs',
    doc: 'docs',
    stats: 'time',
    time: 'time', // старое имя «Статистики»
    settings: 'settings',
  };

  /** Вид экрана → имя в адресе. */
  const NAMES = {
    home: 'today',
    projects: 'projects',
    project: 'project',
    task: 'task',
    docs: 'docs',
    time: 'stats',
    settings: 'settings',
  };

  /** Вкладки проекта; первая — по умолчанию, в адресе её нет. */
  const ROUTE_PROJECT_TABS = ['list', 'board', 'versions', 'docs'];
  const ROUTE_TIME_MODES = ['day', 'week', 'month', 'agenda'];
  /** Разделы настроек (17 октября 2026): каждый — своя страница, тот же
   *  набор и порядок, что в меню телефона. */
  const ROUTE_SETTINGS_SECTIONS = ['main', 'work', 'account', 'data', 'about', 'feedback'];

  /** Вход в аккаунт возвращает человека на страницу с токенами в хэше
   *  (#access_token=…, #error_description=…): их разбирает клиент базы, и
   *  затирать такой хэш адресом экрана нельзя. */
  const isAuthHash = (hash) => /^#.*(access_token|refresh_token|error_code|error_description)=/.test(String(hash || ''));

  /** Сегмент адреса → строка, или null, если он пуст или закодирован криво. */
  function segment(raw) {
    if (!raw) return null;
    try {
      const s = decodeURIComponent(raw);
      return s || null;
    } catch {
      return null;
    }
  }

  /** «project/abc/board» → маршрут или null: пустое, неизвестный экран, нет
   *  id там, где он обязателен. */
  function parsePath(path) {
    const parts = String(path || '').split('/').filter((p) => p !== '');
    const name = (parts[0] || '').toLowerCase();
    if (!name || !Object.prototype.hasOwnProperty.call(SCREENS, name)) return null;
    const view = SCREENS[name];
    if (view === 'project') {
      const id = segment(parts[1]);
      if (!id) return null;
      return { view, id, tab: ROUTE_PROJECT_TABS.includes(parts[2]) ? parts[2] : 'list' };
    }
    if (view === 'task') {
      const id = segment(parts[1]);
      return id ? { view, id } : null;
    }
    if (view === 'docs') {
      // «#/doc/<id>» — документ, «#/docs» — раздел, документ в нём — открытый.
      if (name === 'doc') {
        const id = segment(parts[1]);
        return id ? { view, id } : null;
      }
      return { view };
    }
    if (view === 'time') return ROUTE_TIME_MODES.includes(parts[1]) ? { view, mode: parts[1] } : { view };
    // Незнакомый раздел — список разделов: сами настройки есть всегда.
    if (view === 'settings') {
      const section = (parts[1] || '').toLowerCase();
      return ROUTE_SETTINGS_SECTIONS.includes(section) ? { view, section } : { view };
    }
    return { view };
  }

  /** Хэш адресной строки → маршрут. Всегда отдаёт маршрут: что не
   *  разобралось — «Сегодня». */
  function parseRoute(hash) {
    const s = String(hash || '').replace(/^#/, '').split('?')[0];
    return parsePath(s) || { view: HOME };
  }

  /** Маршрут → хэш. Идентификаторы кодируются целиком: в них бывает что
   *  угодно, в том числе «/», «#» и «%». */
  function buildRoute(route) {
    const r = route || {};
    const name = NAMES[r.view] || NAMES[HOME];
    const id = r.id ? encodeURIComponent(r.id) : '';
    if (r.view === 'project') {
      if (!id) return '#/projects';
      return `#/project/${id}${r.tab && r.tab !== 'list' && ROUTE_PROJECT_TABS.includes(r.tab) ? `/${r.tab}` : ''}`;
    }
    if (r.view === 'task') return id ? `#/task/${id}` : '#/today';
    if (r.view === 'docs') return id ? `#/doc/${id}` : '#/docs';
    if (r.view === 'time') return ROUTE_TIME_MODES.includes(r.mode) ? `#/stats/${r.mode}` : '#/stats';
    if (r.view === 'settings') return ROUTE_SETTINGS_SECTIONS.includes(r.section) ? `#/settings/${r.section}` : '#/settings';
    return `#/${name}`;
  }

  /** Какой это экран, без вкладки и режима: смена экрана — новая запись в
   *  истории браузера, смена вкладки проекта или режима внутри экрана — нет.
   *  Раздел настроек — свой экран: из него «назад» ведёт в список разделов. */
  function routeKey(route) {
    const r = route || {};
    const sub = r.view === 'settings' && ROUTE_SETTINGS_SECTIONS.includes(r.section) ? r.section : (r.id || '');
    return `${r.view || HOME}:${sub}`;
  }

  /** Ссылка, которую можно отправить: адрес приложения без прежнего хэша и
   *  маршрут за ним. */
  function routeLink(base, route) {
    return String(base || '').split('#')[0] + buildRoute(route);
  }

  /** lancible://project/<id>, lancible://task/<id>, lancible://doc/<id> — ссылка,
   *  с которой открывается десктоп. Маршрут или null: вход через Google
   *  (lancible://auth-callback?code=…) и неизвестные пути маршрутом не
   *  являются, их обрабатывает или игнорирует вызывающий. */
  function deepLinkRoute(url) {
    const m = /^lancible:(?:\/\/)?([^?#]*)/i.exec(String(url || '').trim());
    return m ? parsePath(m[1]) : null;
  }

  const api = { parseRoute, buildRoute, routeKey, routeLink, deepLinkRoute, isAuthHash, ROUTE_PROJECT_TABS, ROUTE_TIME_MODES, ROUTE_SETTINGS_SECTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

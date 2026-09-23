/* Лента обновлений Lancible.
 *
 * Один и тот же массив читают две страницы: blog.html — вся лента целиком, с
 * фильтром по типу записи и ссылкой на каждую запись; index.html — три
 * свежие записи и кнопка «Все записи» на blog.html. Достаточно дописать
 * запись сюда, обе страницы подхватят её сами.
 *
 * Как добавить запись:
 *   1. Допиши новый объект В НАЧАЛО массива — порядок в файле = порядок на странице.
 *   2. Заполни оба языка (ru и en) — лента переключается тумблером RU/EN.
 *   3. Закоммить и задеплой лендинг. Никакой сборки не нужно, это обычный скрипт.
 *
 * Что сюда писать: то, что пользователь реально заметит — новая платформа,
 * релиз, заметная возможность, крупное улучшение. Мелкие правки, багфиксы и
 * внутренние изменения сюда НЕ ПОПАДАЮТ: для них есть история коммитов.
 *
 * Поля записи:
 *   date    — 'ГГГГ-ММ-ДД', дата выхода. Форматируется на странице автоматически.
 *             Она же даёт записи ссылку вида blog.html#p-2026-09-18; если в
 *             этот день уже есть запись, вторая получит #p-2026-09-18-2.
 *   tag     — 'release' | 'feature' | 'improvement' (подписи — в BLOG_TAGS, в обеих страницах).
 *   version — необязательно. Строка вида '0.1.0' или 'mobile 1.0.1', показывается под датой.
 *   title   — { ru, en }: одна строка, без точки в конце.
 *   body    — { ru, en }: массив абзацев. Каждый элемент — отдельный абзац.
 */
window.LANCIBLE_POSTS = [
  {
    date: '2026-09-23',
    tag: 'feature',
    version: '0.3.0',
    title: {
      ru: 'Календарь, повторяющиеся задачи, версии на доске и светлая тема заново',
      en: 'A calendar, repeating tasks, versions on the board and a rebuilt light theme',
    },
    body: {
      ru: [
        'У Lancible появился календарь — отдельная страница с часовой сеткой, как в привычных календарях. Записи времени и дедлайны лежат на ней блоками: зону можно выделить мышью и завести задачу прямо там, блок — перетащить на другой день или растянуть за нижний край, и время в задаче пересчитается само. Проекты слева работают как календари: галочка прячет их записи с сетки. Режимов пять — день, четыре дня, неделя, месяц и расписание списком, — и переключаются они цифрами и буквами с клавиатуры.',
        'Задачи научились повторяться: каждые N дней, недель, месяцев или лет, по выбранным дням недели, по числу месяца или по дню недели в нём — «каждый второй вторник». Серию можно оборвать после N повторений или по дате. Закрыли задачу — она возвращается со следующим сроком; если попросить, прежняя останется в списке выполненной, со своим временем. Будущие повторения видно на календаре призраками.',
        'На доске появились версии: дорожка на версию, внутри — привычные столбцы статусов. Версию можно отметить выпущенной с датой, перетащить задачу между дорожками и отобрать задачи по версии — в списке, в статистике и в выгрузке. Статистика и календарь съехались в одну страницу: сверху четыре показателя, под ними календарь месяца, справа — день по проектам.',
        'Светлая тема переделана: страница и шапка стали белыми, серым помечена только левая панель. Тексты набраны Gravity, а Basique Pro остался фирменной нотой на логотипе, заголовках и крупных числах. Заодно починилась сетка календаря, которой из-за пропущенного цвета в палитре не было видно вовсе.',
      ],
      en: [
        'Lancible now has a calendar — its own page with an hour grid, the kind you are used to. Time entries and deadlines sit on it as blocks: drag out an area and a task starts right there, drag a block to another day or pull its bottom edge, and the task’s time recalculates itself. Projects on the left work as calendars: a checkbox hides their entries. There are five views — day, four days, week, month and a schedule list — and they switch from the keyboard.',
        'Tasks can repeat: every N days, weeks, months or years, on chosen weekdays, on a day of the month or on a weekday within it — “every second Tuesday”. A series can end after N times or on a date. Close a task and it comes back with the next due date; ask for it and the finished one stays in the list with its own time. Upcoming repeats show on the calendar as ghosts.',
        'The board gained versions: a lane per version, with the usual status columns inside. A version can be marked released with a date, tasks drag between lanes, and you can filter by version — in the list, in the statistics and in the export. Statistics and the calendar merged into one page: four figures on top, the month calendar below, and the day broken down by project on the right.',
        'The light theme is rebuilt: page and header are white now, and only the left panel is grey. Text is set in Gravity, while Basique Pro stays as the signature on the logo, headings and large numbers. The calendar grid got fixed along the way — a colour missing from the palette had been hiding it entirely.',
      ],
    },
  },
  {
    date: '2026-09-20',
    tag: 'improvement',
    version: '0.2.2 · mobile 1.1.1',
    title: {
      ru: 'Обновление прямо из приложения, переделанная шапка и понятные параметры задачи',
      en: 'Updates without leaving the app, a rebuilt header and clearer task settings',
    },
    body: {
      ru: [
        'За новой версией больше не нужно ходить на сайт. На компьютере она скачивается сама в фоне, а кнопка предлагает установить её, когда вам удобно: установка перезапускает приложение, и делать это внезапно посреди работы неправильно. На Android приложение скачивает файл у себя и передаёт системному установщику. На iOS так сделать нельзя — установка вне App Store и TestFlight закрыта самой системой.',
        'Шапка собрана заново: логотип у левого края, за ним поиск, сразу следом колокольчик. Она стала одной полосой во всю ширину окна и больше не переламывается, когда сворачивается боковая панель. На Windows и macOS кнопка входа из неё убрана — аккаунт живёт на странице настроек.',
        'Ставка и дедлайн в задаче собраны в одну карточку с выровненными подписями, а пустой дедлайн теперь предлагает его поставить, вместо того чтобы сообщать, что он не задан. Выбор периода для выгрузки стал таким же, как в мобильном приложении: семь вариантов и календарь прямо в окне, без всплывающих поверх него. Закрепить проект можно с самой карточки. В настройках появились ссылки на сайт и этот блог, а мобильные приложения на запуске показывают заготовку экрана вместо крутящегося кружка.',
      ],
      en: [
        'Getting a new version no longer means a trip to the site. On desktop it downloads itself in the background and the button offers to install it when you are ready: installing restarts the app, and doing that mid-task is not something to spring on anyone. On Android the app downloads the file itself and hands it to the system installer. iOS cannot work this way — installing outside the App Store and TestFlight is closed off by the OS.',
        'The header is rebuilt: logo at the left edge, then the search field, then the bell right beside it. It is one bar across the window now and no longer breaks apart when the side panel collapses. On Windows and macOS the sign-in button is gone from it, since the account lives on the settings page.',
        'A task’s rate and deadline now share one card with aligned labels, and an empty deadline offers to set one instead of reporting that none is set. The export period picker matches the phone app: seven choices and a calendar inside the dialog rather than popping up over it. Projects can be pinned from the card itself. Settings gained links to the site and to this blog, and the mobile apps now show the shape of the screen while loading instead of a spinner.',
      ],
    },
  },
  {
    date: '2026-09-19',
    tag: 'improvement',
    version: '0.2.1',
    title: {
      ru: 'Починили шапку на телефоне, строку дедлайна и обновление приложения',
      en: 'Fixes for the phone header, the deadline row and in-app updates',
    },
    body: {
      ru: [
        'В веб-версии на узком экране логотип уезжал в правый верхний угол и обрезался, а строка поиска налезала на содержимое. Шапка перебрана: слева логотип, дальше поиск, справа колокольчик.',
        'Строка дедлайна не помещалась, когда у задачи наступал срок: кнопка напоминания ломалась пополам и уезжала за край панели. Теперь она переносится на вторую строку и остаётся на виду.',
        'Главное под капотом: приложение для компьютера искало обновления по неверному адресу и не нашло бы их никогда. Адрес исправлен, но старые копии об этом не узнают — версию 0.2.1 нужно один раз скачать вручную, дальше обновления будут приходить сами.',
      ],
      en: [
        'On a narrow screen the web version threw the logo into the top-right corner, clipped, and let the search bar spill over the content. The header is rebuilt: logo, then search, then the bell.',
        'The deadline row could not fit once a task came due: the reminder button broke across two lines and slid past the edge of the panel. It now wraps onto a second line and stays in view.',
        'The important one is under the hood: the desktop app was looking for updates at the wrong address and would never have found any. The address is fixed, but copies already installed cannot be told about it, so 0.2.1 has to be downloaded by hand once. Updates arrive on their own from then on.',
      ],
    },
  },
  {
    date: '2026-09-18',
    tag: 'release',
    version: '0.2.0 · mobile 1.1.0',
    title: {
      ru: 'Дедлайны, напоминания и уведомления на всех платформах',
      en: 'Deadlines, reminders and notifications on every platform',
    },
    body: {
      ru: [
        'У задач появился дедлайн: дата, время и напоминание — в момент срока, за 15 минут, за час, за 3 часа, за день или в своё время. Перенесёте дедлайн — напоминание переедет вместе с ним.',
        'Рядом с поиском поселился колокольчик: в нём просроченные задачи, те, чей срок наступит в ближайшие сутки, и сработавшие напоминания. Системные уведомления приходят и на компьютер, и на телефон; на телефоне они планируются заранее, поэтому срабатывают, даже когда приложение закрыто.',
        'На компьютере и в вебе появились отдельные страницы настроек и статистики, выгрузка в Excel из календаря и изнутри проекта, выбор периода выгрузки, настройки аккаунта и 16 цветов проектов вместо восьми. Светлая тема стала заметно контрастнее.',
      ],
      en: [
        'Tasks now have a deadline: date, time and a reminder — at the deadline, or 15 minutes, an hour, 3 hours or a day before, or at a time you pick. Move the deadline and the reminder moves with it.',
        'A bell sits next to the search field, holding overdue tasks, anything due within a day, and reminders that have fired. System notifications arrive on desktop and phone alike; on the phone they are scheduled ahead of time, so they fire even when the app is closed.',
        'Desktop and web gained separate settings and stats pages, Excel export from the calendar and from inside a project, an export period picker, account settings, and 16 project colours instead of eight. The light theme is considerably more legible.',
      ],
    },
  },
  {
    date: '2026-09-17',
    tag: 'feature',
    title: {
      ru: 'Появился сайт со всеми загрузками',
      en: 'A site with every download in one place',
    },
    body: {
      ru: [
        'Теперь у Lancible есть своя страница: с неё можно скачать версию для Windows или macOS, забрать сборку для Android и открыть веб-версию — больше не нужно искать нужный файл в GitHub Releases.',
        'Здесь же — честный статус проекта и эта лента обновлений: что уже вышло и над чем идёт работа.',
      ],
      en: [
        'Lancible has its own page now: download the Windows or macOS build, grab the Android app, or open the web version — no more digging through GitHub Releases for the right file.',
        'The same page carries an honest project status and this update feed: what has shipped and what is being worked on.',
      ],
    },
  },
  {
    date: '2026-09-16',
    tag: 'release',
    version: 'mobile 1.0.1',
    title: {
      ru: 'Мобильное приложение для Android',
      en: 'The Android app is here',
    },
    body: {
      ru: [
        'Lancible приехал в карман: таймер, проекты, задачи, календарь и выгрузка — всё то же самое, что и на компьютере, с тем же тёмным и светлым оформлением.',
        'Записи времени синхронизируются с десктопом и вебом через аккаунт, а расхождения между устройствами теперь разрешаются корректно — правка с телефона больше не затирает то, что было записано на компьютере.',
      ],
      en: [
        'Lancible fits in your pocket now: timer, projects, tasks, calendar and exports — the same things you get on the desktop, with the same dark and light themes.',
        'Time entries sync with desktop and web through your account, and clashes between devices are resolved properly — an edit on your phone no longer overwrites what you logged on the computer.',
      ],
    },
  },
  {
    date: '2026-09-16',
    tag: 'release',
    version: '0.1.0',
    title: {
      ru: 'Первый релиз для Windows и macOS',
      en: 'First release for Windows and macOS',
    },
    body: {
      ru: [
        'Установщик .exe для Windows 10 и 11 и сборка для macOS, в которой Intel и Apple Silicon лежат одним файлом — выбирать разрядность не нужно.',
        'Обновления ставятся в один клик: приложение само проверяет новую версию, скачивает её в фоне и предлагает перезапуститься.',
      ],
      en: [
        'An .exe installer for Windows 10 and 11, plus a macOS build that ships Intel and Apple Silicon in a single file — nothing to pick between.',
        'Updates install in one click: the app checks for a new version, downloads it in the background and offers to restart.',
      ],
    },
  },
  {
    date: '2026-09-11',
    tag: 'feature',
    title: {
      ru: 'Веб-версия — работает прямо в браузере',
      en: 'Web version — runs straight in the browser',
    },
    body: {
      ru: [
        'Тот же интерфейс, что и в десктопном приложении, но без установки: открыли ссылку и запустили таймер.',
        'Вёрстку подстроили под телефон и планшет, так что веб-версией спокойно можно пользоваться и с маленького экрана.',
      ],
      en: [
        'The same interface as the desktop app, with nothing to install: open the link and start the timer.',
        'The layout adapts to phones and tablets, so the web version works fine on a small screen too.',
      ],
    },
  },
  {
    date: '2026-09-11',
    tag: 'feature',
    title: {
      ru: 'Аккаунты и синхронизация между устройствами',
      en: 'Accounts and cross-device sync',
    },
    body: {
      ru: [
        'Появился вход по почте и через Google. После входа проекты, задачи и записи времени уезжают в облако и подтягиваются на всех устройствах, где выполнен вход.',
        'Без аккаунта всё продолжает работать локально — регистрация не обязательна, данные никуда не денутся.',
      ],
      en: [
        'Email and Google sign-in are available. Once you sign in, projects, tasks and time entries move to the cloud and follow you to every device you sign in on.',
        'Without an account everything keeps working locally — signing up is optional and your data stays put.',
      ],
    },
  },
];

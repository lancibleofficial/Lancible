/* Лента обновлений Lancible для раздела «Блог» на лендинге.
 *
 * Как добавить запись:
 *   1. Допиши новый объект В НАЧАЛО массива — порядок в файле = порядок на странице.
 *   2. Заполни оба языка (ru и en) — раздел переключается тумблером RU/EN.
 *   3. Закоммить и задеплой лендинг. Никакой сборки не нужно, это обычный скрипт.
 *
 * Что сюда писать: то, что пользователь реально заметит — новая платформа,
 * релиз, заметная возможность, крупное улучшение. Мелкие правки, багфиксы и
 * внутренние изменения сюда НЕ ПОПАДАЮТ: для них есть история коммитов.
 *
 * Поля записи:
 *   date    — 'ГГГГ-ММ-ДД', дата выхода. Форматируется на странице автоматически.
 *   tag     — 'release' | 'feature' | 'improvement' (подписи — в BLOG_TAGS в index.html).
 *   version — необязательно. Строка вида '0.1.0' или 'mobile 1.0.1', показывается под датой.
 *   title   — { ru, en }: одна строка, без точки в конце.
 *   body    — { ru, en }: массив абзацев. Каждый элемент — отдельный абзац.
 */
window.LANCIBLE_POSTS = [
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

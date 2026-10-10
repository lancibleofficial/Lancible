/* Лента обновлений Lancible.
 *
 * Один и тот же массив читают две страницы: blog.html — вся лента целиком, с
 * фильтром по типу записи и ссылкой на каждую запись; index.html — три
 * свежие записи и кнопка «Все записи» на blog.html. Достаточно дописать
 * запись сюда, обе страницы подхватят её сами.
 *
 * Как добавить запись:
 *   1. Допиши новый объект В НАЧАЛО массива — порядок в файле = порядок на странице.
 *   2. Заполни оба языка (ru и en) — язык ленты общий с сайтом (landing/i18n.js).
 *      Языков у сайта четыре; записи пишутся на двух, а украинскому и
 *      казахскому посетителю лента показывает английский.
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
 *   tag     — 'release' | 'feature' | 'improvement' (подписи — blog.tag_* в landing/strings.js).
 *   version — необязательно. Строка вида '0.1.0' или 'mobile 1.0.1', показывается под датой.
 *   title   — { ru, en }: одна строка, без точки в конце.
 *   body    — { ru, en }: массив абзацев. Каждый элемент — отдельный абзац.
 */
window.LANCIBLE_POSTS = [
  {
    date: '2026-10-10',
    tag: 'release',
    version: '0.4.3',
    title: {
      ru: 'Обновления приходят сами и качаются за секунды',
      en: 'Updates arrive on their own and download in seconds',
    },
    body: {
      ru: [
        'Lancible на компьютере теперь проверяет обновления раз в час, пока открыт. Раньше он делал это только при запуске, и если приложение не закрывали сутками, новая версия до него не доходила.',
        'Установщики и обновления теперь раздаются с серверов Cloudflare. У части пользователей скачивание с прежнего места растягивалось на час, теперь оно занимает секунды.',
        'В Настройках на компьютере и в браузере видна версия Lancible, а на компьютере рядом с ней есть кнопка «Проверить обновления».',
      ],
      en: [
        'Lancible on the computer now checks for updates every hour while it is open. Before, it only checked at launch, so if the app stayed open for days, a new version never reached it.',
        'Installers and updates are now served from Cloudflare. For some people downloads from the old location took up to an hour; now they take seconds.',
        'Settings on the computer and in the browser show the Lancible version, and on the computer there is a “Check for updates” button next to it.',
      ],
    },
  },
  {
    date: '2026-10-10',
    tag: 'release',
    version: '0.4.2',
    title: {
      ru: 'Удаление аккаунта — одним шагом на сервере',
      en: 'Account deletion in one step on the server',
    },
    body: {
      ru: [
        'На компьютере и в браузере удаление аккаунта теперь делает сервер, одним действием: стирает картинки из заметок и сам аккаунт. Раньше приложение делало это по шагам, и обрыв связи посередине мог оставить дело наполовину. Теперь аккаунт либо удалён целиком, либо остаётся, а картинки, которые успели стереться, возвращаются в облако с вашего устройства.',
        'Если картинки стереть не удалось, приложение так и скажет — аккаунт не удалён именно поэтому, — а не общее «проверьте соединение».',
        'В браузере всё уже работает, версия 0.4.2 для Windows и macOS придёт обновлением сама. Телефон перейдёт на новый способ в следующем обновлении.',
      ],
      en: [
        'On the computer and in the browser, deleting your account is now done by the server in a single step: it erases the images in your notes and the account itself. Before, the app did this step by step, and a dropped connection halfway could leave things half-done. Now the account is either deleted completely or stays, and any images that were already erased go back to the cloud from your device.',
        'If the images could not be erased, the app says exactly that — the account was not deleted for this reason — instead of a generic “check your connection”.',
        'It already works in the browser; version 0.4.2 for Windows and macOS arrives as an update on its own. The phone switches to the new way in its next update.',
      ],
    },
  },
  {
    date: '2026-10-10',
    tag: 'release',
    version: '0.4.1 · mobile 1.2.2',
    title: {
      ru: 'Картинки с телефона уходят в облако, а удаление аккаунта стирает и их',
      en: 'Phone images reach the cloud, and deleting your account erases them too',
    },
    body: {
      ru: [
        'Картинки, вставленные в заметки на телефоне, теперь выгружаются в облако и видны на компьютере и в браузере. Раньше с телефона они не уходили ни в одной версии: вход не доходил до редактора, и картинка оставалась только на устройстве.',
        'Удаление аккаунта теперь стирает и картинки из заметок — на телефоне, на компьютере и в браузере. Окно подтверждения прямо называет, что удалится. Если стереть картинки не вышло, аккаунт остаётся на месте, а картинки возвращаются в облако — ничего не теряется наполовину.',
        'Логотип теперь набран тем же шрифтом Onest, что и весь интерфейс. Казахский перевод обращается на «сіз». Мы обновили Условия использования и Политику конфиденциальности — при следующем входе приложение попросит принять новую редакцию. В новых версиях принятое в одном приложении больше не переспрашивается в другом.',
        'Версия 0.4.1 для Windows и macOS придёт обновлением сама. На телефоне с версией 1.2.1 обновление ставится из меню приложения; с 1.2.0 и раньше — один раз вручную, скачав APK на главной странице сайта.',
      ],
      en: [
        'Images you paste into notes on your phone are now uploaded to the cloud and show up on your computer and in the browser. Before, they never left the phone in any version: sign-in did not reach the editor, so the image stayed on the device.',
        'Deleting your account now erases the images in your notes as well — on the phone, on the computer and in the browser. The confirmation dialog says plainly what will be deleted. If erasing the images fails, the account stays and the images go back to the cloud, so nothing is left half-deleted.',
        'The logo is now set in Onest, the same font as the rest of the interface. The Kazakh translation addresses you formally («сіз»). We have updated the Terms of Service and the Privacy Policy: next time you sign in, the app will ask you to accept the new version. In the new versions, what you accept in one app is no longer asked again in another.',
        'Version 0.4.1 for Windows and macOS arrives as an update on its own. On a phone with 1.2.1 the update installs from the app menu; with 1.2.0 or earlier, install it by hand once by downloading the APK from the home page of the site.',
      ],
    },
  },
  {
    date: '2026-10-10',
    tag: 'release',
    version: 'mobile 1.2.1',
    title: {
      ru: 'Телефон 1.2.1: обновление из приложения снова работает',
      en: 'Phone 1.2.1: in-app updates work again',
    },
    body: {
      ru: [
        'В версиях 1.1.1 и 1.2.0 кнопка обновления в меню не скачивала новую версию, а уводила в браузер. В 1.2.1 загрузка снова идёт внутри приложения: файл сверяется по размеру, и недокачанный не попадает в установщик. Если что-то пойдёт не так, приложение покажет причину и предложит повторить или скачать в браузере.',
        'Если у вас 1.1.1 или 1.2.0, поставьте 1.2.1 один раз вручную: скачайте APK на главной странице сайта. Дальше обновления снова будут приходить прямо в приложении.',
      ],
      en: [
        'In versions 1.1.1 and 1.2.0 the update button in the menu did not download the new version and sent you to the browser instead. In 1.2.1 the download happens inside the app again: the file is checked against its expected size, and an incomplete one never reaches the installer. If something goes wrong, the app shows the reason and offers to retry or download in the browser.',
        'If you are on 1.1.1 or 1.2.0, install 1.2.1 by hand once: download the APK from the home page of the site. After that, updates arrive in the app again.',
      ],
    },
  },
  {
    date: '2026-10-09',
    tag: 'improvement',
    title: {
      ru: 'Сайт говорит на вашем языке и запоминает выбор',
      en: 'The site speaks your language and remembers your choice',
    },
    body: {
      ru: [
        'Раньше язык на сайте был не один, а два: правовые документы помнили свой, лента обновлений — свой. Английский, выбранный в ленте, не доходил до шапки, а смена языка договора возвращала ленту к русскому. Теперь выбор один на весь сайт: сделали его в одном месте — он действует и на главной, и в блоге, и в документах, и в окне о cookie.',
        'Язык определяется сам, по настройкам браузера: русский, украинский и казахский посетитель получает свой, остальные — английский. Поменять вручную можно в подвале любой страницы, выбор запомнится. У правовых документов остался отдельный переключатель на все четыре языка — там, где все четыре перевода и есть.',
      ],
      en: [
        'The site used to keep two languages instead of one: the legal documents remembered theirs and the update feed remembered its own. English picked in the feed never reached the header, and switching the language of an agreement sent the feed back to Russian. Now the choice covers the whole site: make it once and it holds on the home page, in the blog, in the documents and in the cookie dialog.',
        'The language is detected from your browser: Russian, Ukrainian and Kazakh visitors get their own, everyone else gets English. You can change it by hand in the footer of any page and the choice is remembered. The legal documents keep a switch of their own with all four languages — that is where all four translations live.',
      ],
    },
  },
  {
    date: '2026-10-09',
    tag: 'release',
    version: '0.4.0 · mobile 1.2.0',
    title: {
      ru: 'Телефон заново, одни иконки на всех платформах и вход без письма на почту',
      en: 'A rebuilt phone app, one icon set everywhere and sign-up without an email',
    },
    body: {
      ru: [
        'Приложение для телефона сделано заново — под телефон, а не копией веба. Вкладок пять: Проекты, Задачи, Сегодня, Цифры и Меню. Проекты листаются колодой карточек: в карточке время, деньги, шкала выполненного и задачи, новая задача записывается строкой прямо под шкалой, а «+» у края колоды создаёт проект. «Задачи» собирают всё по дедлайнам, свайп справа налево закрепляет задачу. «Сегодня» показывает день сеткой по часам или списком, «Цифры» — календарь и числа по дням, в «Меню» — профиль, теги, ставка, валюта, язык, тема и уведомления.',
        'Страница задачи — название, теги и заметки сверху, таймер в шторке снизу: её можно вытянуть до сведений и истории записей, а «Выполнено» всегда под рукой. Дедлайн выбирается календарём и барабанами часов и минут, выбор тега и валюты открывается внутри того же окна, у каждого окна есть крестик. Экраны сменяются пролистыванием, а на iPhone с iOS 26 шапки и панель вкладок — на системном жидком стекле, идущая задача видна в капсуле над вкладками.',
        'Иконки везде теперь одни — набор Solar: на телефоне, на компьютере и в браузере. На iPhone ими нарисованы даже системная панель вкладок, кнопки шапки и стрелка «назад».',
        'Версия 0.4.0 для Windows и macOS приносит всё, что раньше появилось в браузере: новый облик, собственный редактор текста с рисованием пером и раздел «Документы». Регистрация стала проще: почта и пароль — и вы сразу внутри, без письма с подтверждением; войти в другой аккаунт можно в любой момент.',
      ],
      en: [
        'The phone app is rebuilt for the phone instead of copying the web. There are five tabs: Projects, Tasks, Today, Figures and Menu. Projects flip as a deck of cards: each card shows time, money, a progress bar and tasks, a new task is typed right under the bar, and the “+” at the edge of the deck creates a project. Tasks gathers everything by deadline, and a right-to-left swipe pins a task. Today shows the day as an hourly grid or a list, Figures shows a calendar and numbers by day, and Menu holds the profile, tags, rate, currency, language, theme and notifications.',
        'A task page has the title, tags and notes on top and the timer in a sheet at the bottom: pull it up for details and the entry history, while Done stays within reach. A deadline is picked with a calendar and hour and minute wheels, tag and currency pickers open inside the same sheet, and every sheet has a close button. Screens slide from one to the next, and on an iPhone with iOS 26 the headers and the tab bar sit on the system Liquid Glass, with the running task in a capsule above the tabs.',
        'There is now one icon set everywhere — Solar: on the phone, on desktop and in the browser. On an iPhone even the system tab bar, the header buttons and the back arrow use it.',
        'Version 0.4.0 for Windows and macOS brings everything that appeared in the browser earlier: the new look, our own text editor with pen drawing and the Documents section. Signing up is simpler: an email and a password and you are in, no confirmation letter; switching to another account works at any time.',
      ],
    },
  },
  {
    date: '2026-10-07',
    tag: 'feature',
    title: {
      ru: 'Свой редактор текста, рисование пером и раздел «Документы»',
      en: 'Our own text editor, pen drawing and a Documents section',
    },
    body: {
      ru: [
        'Заметки задач теперь пишутся в собственном редакторе Lancible — одинаковом на компьютере, в браузере и на телефоне. Заголовки, списки и чек-листы, цитаты и выноски, цвет и маркер, размер и шрифт выделенного текста, ссылки, поиск с заменой и оглавление. Таблицы правятся шестерёнкой прямо на разделителе строк и столбцов, из таблицы одним нажатием получается график, к тексту можно оставлять комментарии. Картинки встают отдельно, в ряд или с обтеканием текстом. Markdown вставляется как оформленный текст, а документ выгружается в Markdown, HTML и на печать.',
        'Для планшета и стилуса — два режима рисования: холст между абзацами и пометки от руки прямо поверх текста, которые держатся за свой абзац. Ручка, карандаш, маркер, фигуры, ластик целиком или по кусочку, лассо, прозрачность, последние цвета и учёт нажима. Можно рисовать только стилусом, а пальцем листать, или наоборот. Отмена общая для текста и штрихов, а Ctrl+Shift+D переключает рисование и набор.',
        'Появился раздел «Документы» — для текста, который не задача: бриф, договор, черновик статьи. Документ может быть общим или принадлежать проекту: тогда он виден на вкладке «Документы» в самом проекте и под проектом в левом меню. Шапка задачи стала чище: в ней осталось одно название, а теги и удаление переехали в свойства. Закреплённые проекты собраны в левом меню группой «Быстрый доступ».',
      ],
      en: [
        'Task notes are now written in Lancible’s own editor — the same on desktop, in the browser and on the phone. Headings, lists and checklists, quotes and callouts, text colour and highlighter, size and font for selected text, links, find and replace and an outline. Tables are edited with a gear right on the divider between rows and columns, a table turns into a chart in one click, and text can carry comments. Images sit on their own line, in a row or with text wrapping around them. Markdown pastes as formatted text, and a document exports to Markdown, HTML or print.',
        'For tablets and styluses there are two drawing modes: a canvas between paragraphs and handwritten notes right over the text that stay attached to their paragraph. Pen, pencil, marker, shapes, an eraser for whole strokes or parts of them, a lasso, opacity, recent colours and pressure. You can draw with the stylus only and scroll with a finger, or the other way round. Undo is shared between text and strokes, and Ctrl+Shift+D switches between drawing and typing.',
        'There is a new Documents section for text that is not a task: a brief, a contract, a draft article. A document can be shared or belong to a project — then it shows on the project’s Documents tab and under the project in the left menu. The task header is cleaner: only the title remains there, while tags and deletion moved into the properties. Pinned projects are gathered in the left menu as a Quick access group.',
      ],
    },
  },
  {
    date: '2026-10-07',
    tag: 'improvement',
    title: {
      ru: 'Новый облик: панели-острова, страница задачи и один раздел «Время»',
      en: 'A new look: island panels, a task page and a single “Time” section',
    },
    body: {
      ru: [
        'Lancible на компьютере и в браузере выглядит иначе. Всё содержимое лежит отдельными островами на спокойной земле: без рамок, теней и градиентов, с небольшими скруглениями и воздухом между блоками. Зелёный остался только там, где он нужен, — на главной кнопке экрана, идущем таймере и сегодняшнем дне. Левая панель сворачивается до значков, а идущая задача видна капсулой в шапке на любом экране.',
        'Разделов четыре. «Сегодня» показывает день: полосу записей по часам, цифры за день, неделю и месяц, три недавних проекта, дедлайны и справа идущую задачу с недавними. «Проекты» — карточки с временем, деньгами и прогрессом и таблица недавних задач. Задача открывается своей страницей: по центру название, теги и редактор во всю высоту, справа таймер и свойства; история записей — на той же правой панели по вкладке.',
        'Календарь и статистика съехались в один раздел «Время»: день, четыре дня, неделя, месяц и расписание переключаются в одной шапке, фильтр по проекту заменил галочки слева, период по-прежнему выбирается прямо на сетке месяца, а цифры и панель дня можно спрятать, чтобы сетка заняла всю ширину. В браузере на телефоне всё то же самое складывается столбиком с плашкой навигации снизу.',
        'Заодно на сайте появились документы: политика конфиденциальности, условия использования, возврат, cookies и реквизиты — на четырёх языках. При регистрации приложение спрашивает согласие и подтверждение возраста, а аккаунт можно удалить из настроек вместе с данными.',
      ],
      en: [
        'Lancible looks different on desktop and in the browser. Everything sits as separate islands on a calm ground: no borders, shadows or gradients, small rounded corners and air between blocks. Green stays only where it matters — the screen’s main button, the running timer and today’s date. The left panel collapses to icons, and the running task shows as a capsule in the header on every screen.',
        'There are four sections. “Today” shows the day: a strip of entries by hour, figures for the day, week and month, three recent projects, deadlines, and on the right the running task with recent ones. “Projects” is cards with time, money and progress plus a table of recent tasks. A task opens as its own page: title, tags and a full-height editor in the middle, the timer and properties on the right; the entry history lives on the same right panel under a tab.',
        'The calendar and statistics merged into one “Time” section: day, four days, week, month and schedule switch in one header, a project filter replaces the checkboxes on the left, a period is still picked right on the month grid, and the figures and the day panel can be hidden so the grid takes the full width. In the browser on a phone the same screens stack into a column with a navigation bar at the bottom.',
        'The site also gained its documents: the privacy policy, terms of use, refunds, cookies and company details — in four languages. Signing up now asks for consent and an age confirmation, and an account can be deleted from the settings together with its data.',
      ],
    },
  },
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

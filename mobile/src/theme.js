// Палитра — те же значения, что в src/renderer/styles.css (тёмная и светлая
// темы). В отличие от раунда 1 (только тёмная, статичный объект), тема теперь
// реально переключаема (settings.theme: system/light/dark) — поэтому вместо
// статичного экспорта `colors` используем хук useColors(), который читает
// текущий выбор из useAppStore и, для "system", реальную системную тему
// через useColorScheme(). Экраны вызывают его внутри компонента и строят
// стили через makeStyles(colors) при каждом рендере — обычная для
// динамически тематизируемых RN-приложений цена (без этого пришлось бы либо
// плодить .dark/.light суффиксы в каждом StyleSheet, либо тянуть тяжёлую
// стороннюю тему-библиотеку ради одного экрана настроек).
import { useColorScheme } from 'react-native';
import { useAppStore } from './store/useAppStore';

// Палитры — те же, что на десктопе и в вебе после редизайна «острова»
// 7 октября 2026 (src/renderer/styles.css, «Палитра»): содержимое лежит
// островами на земле, без обводок и теней. Земля (bg) — самое тёмное или
// самое серое; остров (panel) — ступень над ней; поле внутри острова
// (panel2) — ещё ступень; raise — нажатие и выбранное. Линии (border,
// borderSoft) — полупрозрачные: разделители внутри острова, а не рамки.
// Свои у телефона только оттенок danger на тёмной (ярче, на маленьком экране
// приглушённый красный выцветал) и несколько токенов, которых нет на
// десктопе: accentMuted, inputBg, textOnColor, scrim.
const dark = {
  bg: '#111215', panel: '#1a1b1f', panel2: '#232428', raise: '#2a2b31',
  border: 'rgba(255,255,255,0.06)', borderStrong: '#3a3c44',
  text: '#f2f3f5', textDim: '#aeb1ba',
  accent: '#69d345', accentHover: '#7add58', accentText: '#0d1a07', accentMuted: 'rgba(105,211,69,0.16)',
  // Акцент как текст и иконка — свой токен: на тёмном он совпадает с
  // заливкой, на белом неоновый зелёный буквами не читается.
  accentInk: '#69d345',
  danger: '#ff5c50',
  // Фон выбранного таба (сегменты «Свойства/История», режимы «Времени») —
  // ступень светлее дорожки, как на десктопе.
  tabActiveBg: '#2a2b31',
  // Фон полей ввода (там, где пользователь печатает).
  inputBg: '#232428',

  // Третья ступень цвета текста: подписи дней, счётчики, мелкие пометки.
  textFaint: '#8f929c',
  // Значки без своего цвета.
  icon: '#979ba5',
  // Внутренняя линейка: сетка календаря, тонкие разделители.
  borderSoft: 'rgba(255,255,255,0.05)',
  // Столбец доски — поле внутри острова, карточка в нём ещё светлее.
  boardCol: '#232428', boardCard: '#2a2b31',
  // Подложка выбранного дня и строки.
  sel: 'rgba(105,211,69,0.10)',
  // Плавающее поверх страницы (плашка идущей задачи): ступень над
  // карточками, чтобы не сливаться с ними, и мягкая тень.
  floating: '#232428', shadow: 'rgba(0,0,0,0.45)',

  // Белое поверх насыщенной заливки: цифра в значке, бегунок тумблера, фраза
  // пасхалки колоды. (Опасная кнопка белого не берёт: она серая, panel2, с
  // красным danger-текстом.) Затемнение под шторкой. Красная подложка просроченного
  // срока — приглушённый цвет это основной цвет своей темы с прозрачностью
  // (держит tests/unit/mobile-core.test.js).
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(255,92,80,0.18)',

  // Дорожка переключателя (components/Switch.js): кружок у него белый в обоих
  // положениях, а белый на неоновом accent — 1.9 : 1, кружок тонет. Поэтому
  // вкл — свой зелёный того же тона, на ступень глубже: белый на нём 3.3 : 1.
  // Выкл — тёмная дорожка (= panel2), белый на ней 15 : 1.
  switchOn: '#47a126', switchOff: '#232428',

  // Сценки пустых экранов (components/ArtScene.js, формы — core/illustrations.js):
  // подложка, лист, линии. Те же значения, что --art-plate, --art-sheet и
  // --art-ink на десктопе; пятно акцента сценки — accent, галочка на нём —
  // accentText. Подложка отличается и от земли, и от острова: сценка одна
  // на любом фоне.
  artPlate: '#232428', artSheet: '#34363e', artInk: '#4c4f58',

  // Пасхалка у правого края колоды «Проектов» (screens/ProjectsScreen.js,
  // PhraseCard): последнюю карточку оттянули очень далеко — плашка с фразой
  // становится пурпурной, а приглушённые искры (components/DeckSparks.js) —
  // жёлтыми. Текст на пурпуре — textOnColor: белый на нём не ниже 4.5 : 1.
  eggPlate: '#7c4bd6', eggSpark: '#ffd23f',
};

// Светлая — серая земля и белые острова, как на десктопе: белые предметы
// на серой странице видны без рамок.
const light = {
  bg: '#eceef1', panel: '#ffffff', panel2: '#f1f2f4', raise: '#e6e8ec',
  border: 'rgba(10,10,12,0.07)', borderStrong: '#9d9da5',
  text: '#0a0a0c', textDim: '#45454d',
  accent: '#63c841', accentHover: '#56b337', accentText: '#0d1a07', accentMuted: 'rgba(99,200,65,0.16)',
  accentInk: '#1f7a12',
  danger: '#c22a1d',
  tabActiveBg: '#ffffff',
  inputBg: '#f1f2f4',
  textFaint: '#6a6a73',
  icon: '#55555d',
  borderSoft: 'rgba(10,10,12,0.06)',
  boardCol: '#f1f2f4', boardCard: '#ffffff',
  sel: 'rgba(99,200,65,0.14)',
  floating: '#ffffff', shadow: 'rgba(16,18,24,0.10)',
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(194,42,29,0.18)',
  // Переключатель: белый кружок на светлой panel2 пропал бы (1.1 : 1) —
  // выкл-дорожка здесь серая, белый на ней 3.5 : 1; вкл — тот же глубокий
  // зелёный, чуть темнее для белых островов (3.6 : 1).
  switchOn: '#439924', switchOff: '#878890',
  // Белый лист на белом острове без подложки пропал бы — подложка серее.
  artPlate: '#e3e5e9', artSheet: '#ffffff', artInk: '#c9ccd3',
  // Пасхалка колоды — как на тёмной: плашка пурпурная в обеих темах.
  eggPlate: '#7c4bd6', eggSpark: '#ffd23f',
};

// Экспорт по умолчанию (для мест вроде StatusBar/навигационной темы, которым
// хук недоступен) — держим равным тёмной, пока не решим на этапе App.js.
export const colors = dark;

export function resolveTheme(themeSetting, systemScheme) {
  const mode = themeSetting === 'system' ? (systemScheme || 'dark') : themeSetting;
  return mode === 'light' ? 'light' : 'dark';
}

export function useColors() {
  const themeSetting = useAppStore((s) => s.settings.theme);
  const systemScheme = useColorScheme();
  return resolveTheme(themeSetting, systemScheme) === 'light' ? light : dark;
}

export function useThemeMode() {
  const themeSetting = useAppStore((s) => s.settings.theme);
  const systemScheme = useColorScheme();
  return resolveTheme(themeSetting, systemScheme);
}

// Редактор текста (src/editor/) живёт в WebView и красится CSS-переменными
// с теми же именами, что в src/renderer/styles.css. Значения — отсюда: у
// телефона свой источник токенов (DESIGN.md). Оттенки --led-c-* и заливки
// маркера --led-hl-* — те же, что на десктопе: документ хранит имя цвета,
// и «жёлтый маркер» должен быть одним жёлтым на всех устройствах.
const editorHues = {
  dark: {
    gray: '#9aa0aa', red: '#ff7b72', orange: '#ffa657', yellow: '#f2cc60', green: '#7ee787',
    teal: '#56d4c4', blue: '#79b8ff', purple: '#c297ff', pink: '#ff8fc7',
  },
  light: {
    gray: '#5f6670', red: '#c8281e', orange: '#b04a00', yellow: '#8a6100', green: '#1a7f37',
    teal: '#0b7369', blue: '#0a64c8', purple: '#7c4bd6', pink: '#b8337f',
  },
};
const editorHighlights = {
  dark: {
    gray: 'rgba(154,160,170,0.24)', red: 'rgba(255,123,114,0.26)', orange: 'rgba(255,166,87,0.26)',
    yellow: 'rgba(242,204,96,0.3)', green: 'rgba(126,231,135,0.22)', teal: 'rgba(86,212,196,0.22)',
    blue: 'rgba(121,184,255,0.24)', purple: 'rgba(194,151,255,0.24)', pink: 'rgba(255,143,199,0.24)',
  },
  light: {
    gray: '#e5e7ea', red: '#ffdcd7', orange: '#ffe3c6', yellow: '#fff0a6', green: '#d5f3d3',
    teal: '#ccefea', blue: '#d9e9ff', purple: '#e9defe', pink: '#ffdcee',
  },
};
const editorShadows = {
  dark: { pop: '0 10px 28px rgba(0,0,0,0.5)', modal: '0 16px 44px rgba(0,0,0,0.55)', codeBg: '#0f1012' },
  light: { pop: '0 8px 24px rgba(9,9,11,0.16)', modal: '0 18px 48px rgba(9,9,11,0.22)', codeBg: '#232428' },
};

/** CSS-переменные для редактора в WebView: :root { --bg: …; … }. */
export function editorCssVars(mode) {
  const c = mode === 'light' ? light : dark;
  const m = mode === 'light' ? 'light' : 'dark';
  const sh = editorShadows[m];
  const vars = {
    '--bg': c.bg, '--panel': c.panel, '--panel-2': c.panel2, '--raise': c.raise,
    '--line': c.border, '--border': c.border, '--border-soft': c.borderSoft, '--border-strong': c.borderStrong,
    '--text': c.text, '--text-dim': c.textDim, '--text-faint': c.textFaint, '--icon': c.icon,
    '--accent': c.accent, '--accent-hover': c.accentHover, '--accent-text': c.accentText, '--accent-ink': c.accentInk,
    '--link': c.accentInk, '--danger': c.danger, '--text-on-color': c.textOnColor, '--scrim': c.scrim,
    '--code-bg': sh.codeBg, '--tab-active-bg': c.tabActiveBg, '--nav-active-bg': c.panel2, '--sel': c.sel,
    '--shadow-pop': sh.pop, '--shadow-modal': sh.modal,
    '--ease': 'cubic-bezier(0.22, 0.61, 0.36, 1)', '--radius': '14px', '--radius-sm': '10px',
    '--font-ui': "'Onest', -apple-system, Roboto, 'Segoe UI', sans-serif", '--font-display': 'var(--font-ui)', '--fw-text': '400',
    // Бумага страницы PDF (src/editor/pdfpage.js): лист белый и чернила тёмные в
    // обеих темах — это страница документа, а не панель приложения. Без них
    // замазка в тёмной теме была бы тёмной (запасные --panel/--text).
    '--led-paper': '#ffffff', '--led-paper-ink': '#1d1f22',
  };
  for (const [k, v] of Object.entries(editorHues[m])) vars[`--led-c-${k}`] = v;
  for (const [k, v] of Object.entries(editorHighlights[m])) vars[`--led-hl-${k}`] = v;
  return `:root{color-scheme:${m};${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;
}

/** Цвета, которые человек выбирает в нативной панели редактора
 *  (components/EditorToolbar.js): кружки цвета текста, маркера и пера. Те же
 *  значения, что уходят в WebView переменными --led-c-* и --led-hl-*, — кружок
 *  в панели и буква в тексте одного цвета. «ink» — цвет текста темы: у пера
 *  это «как текст». */
export function editorSwatches(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  const c = m === 'light' ? light : dark;
  return { hues: { ink: c.text, ...editorHues[m] }, highlights: editorHighlights[m] };
}

/** Тень плавающего поверх страницы — плашки идущей задачи (TimerMiniPlayer) и
 *  острова панели редактора (EditorToolbar): boxShadow, равномерно размытая со
 *  всех сторон, а не elevation (системная тень Android темнела к середине
 *  нижнего края). Цвет — shadow своей темы, поверхность под ней — floating. */
export const floatingShadow = (c) => [{ offsetX: 0, offsetY: 4, blurRadius: 18, spreadDistance: 0, color: c.shadow }];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Зазор между островами — тот же, что на десктопе (--gap 12).
export const gap = spacing.md;

// Боковое поле страницы — одно на все экраны и шапки: от края экрана до
// островов, заголовка и кнопок шапки (TabHeader, AppHeader, DetailHeader),
// а в листах — до полей и кнопок. 11 октября 2026: было два числа сразу —
// 12 у вкладок (острова) и 16 у шапок, страницы проекта, уведомлений и
// листов, и экраны расходились на 4 dp; теперь поле одно и уже обоих. Свои
// числа в экранах не прописывают, берут этот токен (держит
// mobile/tests/screenPadding.test.js).
export const screenPadding = 10;

// Кастомный таббар (MainTabBar.js) не сообщает React Navigation свою
// реальную высоту через её внутренний height-callback context (это делает
// только штатный BottomTabBar) — экраны внутри таббара добавляют этот запас
// поверх insets.bottom сами, чтобы контент не оказывался под панелью.
export const tabBarClearance = 108;

// Единая высота для ЛЮБОЙ растянутой на всю ширину кнопки-действия
// (PrimaryButton, «Войти через Google», квадратные «+» и «удалить» в строке
// с полем) — маленькие пилюли-переключатели (таббар, "Сегодня", свотчи цвета)
// сюда не относятся, у них своя логика. 11 октября 2026: было 52 и 10 —
// кнопки в листах выходили крупнее полей рядом; 48 всё ещё выше 44 pt, а 14
// — то же скругление, что у островов, и кнопка с ними одной породы. Другой
// высоты у главной кнопки быть не должно: свою не прописывают, берут этот
// токен (держит mobile/tests/buttons.test.js).
export const buttonHeight = 48;

// Малая кнопка — PrimaryButton size="sm": ниже на 12, шрифт на ступень мельче.
// Нужна там, где две кнопки стоят рядом в карточке и большие её давят (вход и
// «Создать аккаунт» гостя в меню). Остальные кнопки приложения — обычные;
// зона касания малой добирается до 44 pt hitSlop-ом, а не высотой.
export const buttonHeightSm = 36;

// Сегментный переключатель (components/Segmented.js) — одна высота везде:
// вкладки страницы проекта и её отбор «Все · Активные · Готово», режимы
// «Цифр», вкладки шита задачи. Чуть ниже главной кнопки и не ниже 44 pt под
// палец. Держит mobile/tests/liquid.test.js. Сегменты живут только на
// экранах: в нижних листах выбор вида — строки с галочкой (ChoiceList).
export const segmentHeight = 44;

// Подпись сегмента — 14, на ступень мельче текста интерфейса (12 октября
// 2026; было fontSize.md = 16): табы читались крупнее заголовков островов
// под ними. Не мелочь 12.5, как до 11 октября: подпись — та же ступень, что
// названия строк настроек (fontSize.sm). Держит mobile/tests/liquid.test.js.
export const segmentFontSize = 14;

// Скругления — как у десктопа после «островов»: остров 14 (lg), поле 10 (md),
// мелкие фишки 8 (sm), шторки 20 (xl).
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 };

// Скругление главной кнопки — на ступень круглее поля: кнопка читается
// нажимаемой, а не одним из полей формы.
export const buttonRadius = radius.lg;

// Кнопка старта таймера (▶/■) — скруглённый квадрат. Раньше это были кружки,
// а у списка проекта и страницы задачи — свои 6 и 18. Размер у каждой свой
// (38 в строке, 46 на «Сегодня», 58 на странице задачи), а скругление одно:
// токен, а не число, чтобы кружок не вернулся (держит
// mobile/tests/taskControls.test.js). 12 октября — 12 вместо 8 (sm): кнопка
// мягче и ближе к главным кнопкам (buttonRadius 14), но всё ещё квадрат.
export const taskControlRadius = 12;

// Галочка «выполнено» у задачи (24 в строке, 22 в списке проекта) — того же
// вида квадрат, но мельче, и скругление у неё своё, пропорциональное: 8 на
// 24 — та же доля стороны (⅓), что 12 у кнопки 38 рядом. С 12 галочка 24
// стала бы кругом.
export const taskCheckRadius = radius.sm;

// Переключатель в стиле Material 3 (components/Switch.js), размеры в pt: дорожка
// 52×32, кружок в выкл-положении 16, во вкл — 24, под пальцем — 28. Системный
// SwitchCompat Android рисует старый вид (зелёная дорожка, крупный белый
// кружок), нативного MaterialSwitch в RN нет, поэтому рисуем сами.
export const switchSize = { width: 52, height: 32, thumbOff: 16, thumbOn: 24, thumbPressed: 28, border: 2 };

export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 };

// Телефон набран одной гарнитурой — Onest (решение 9 октября 2026: Basique
// Pro ушла с телефона совсем). В Onest есть казахские буквы и знаки
// ₽ ₸ ₴ ₺. Начертания — отдельные файлы, поэтому "жирность" — это выбор
// СЕМЕЙСТВА, а не числовой fontWeight (см. AppText.js: fontWeight рядом с
// кастомным fontFamily на Android тихо откатывает на системный шрифт).
// fontFamily ниже — для мест, где семейство нужно прописать явно, минуя
// автоподбор AppText/AppTextInput по fontWeight.
//
// Четыре ступени: light/regular/bold/black.
export const fontFamily = {
  light: 'Onest-Light', regular: 'Onest-Regular',
  bold: 'Onest-Medium', black: 'Onest-Bold',
};

/** Заголовки экранов и крупные числа — тот же Onest, на ступень плотнее
 *  текста: bold здесь — Bold, а не Medium. */
export const displayFamily = {
  light: 'Onest-Light', regular: 'Onest-Medium',
  bold: 'Onest-Bold', black: 'Onest-Bold',
};

// Именованные текстовые пресеты — то же назначение, что h1/h2/body/caption в
// вебе. Не обязательны (обычные style-объекты с fontFamily по-прежнему
// работают через AppText), но собирают повторяющиеся комбинации
// размер+начертание в одном месте вместо того, чтобы держать их в уме на
// каждом экране. Использовать как `[typography.h1, {color: colors.text}]`.
export const typography = {
  h1: { fontFamily: fontFamily.black, fontSize: fontSize.xl },
  h2: { fontFamily: fontFamily.bold, fontSize: fontSize.lg },
  // Заголовок шторки и экрана — фирменным шрифтом, как .modal-title на десктопе.
  title: { fontFamily: displayFamily.bold, fontSize: fontSize.lg },
  body: { fontFamily: fontFamily.regular, fontSize: fontSize.md },
  bodyBold: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
  caption: { fontFamily: fontFamily.regular, fontSize: fontSize.sm },
  label: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  button: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
  // Подзаголовок острова и тихая подпись справа от него — .island-title и
  // .island-note десктопа.
  islandTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.sm },
  islandNote: { fontFamily: fontFamily.regular, fontSize: fontSize.xs },
};

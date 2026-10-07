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
  accent: '#87ff65', accentHover: '#aceb98', accentText: '#16220e', accentMuted: 'rgba(135,255,101,0.16)',
  // Акцент как текст и иконка — свой токен: на тёмном он совпадает с
  // заливкой, на белом неоновый зелёный буквами не читается.
  accentInk: '#87ff65',
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
  sel: 'rgba(135,255,101,0.10)',

  // Белое поверх насыщенной заливки: текст опасной кнопки, цифра в значке,
  // бегунок тумблера. Затемнение под шторкой. Красная подложка просроченного
  // срока — приглушённый цвет это основной цвет своей темы с прозрачностью
  // (держит tests/unit/mobile-core.test.js).
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(255,92,80,0.18)',
};

// Светлая — серая земля и белые острова, как на десктопе: белые предметы
// на серой странице видны без рамок.
const light = {
  bg: '#eceef1', panel: '#ffffff', panel2: '#f1f2f4', raise: '#e6e8ec',
  border: 'rgba(10,10,12,0.07)', borderStrong: '#9d9da5',
  text: '#0a0a0c', textDim: '#45454d',
  accent: '#62d841', accentHover: '#52c932', accentText: '#0d1a07', accentMuted: 'rgba(98,216,65,0.16)',
  accentInk: '#157308',
  danger: '#c22a1d',
  tabActiveBg: '#ffffff',
  inputBg: '#f1f2f4',
  textFaint: '#6a6a73',
  icon: '#55555d',
  borderSoft: 'rgba(10,10,12,0.06)',
  boardCol: '#f1f2f4', boardCard: '#ffffff',
  sel: 'rgba(98,216,65,0.14)',
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(194,42,29,0.18)',
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
  };
  for (const [k, v] of Object.entries(editorHues[m])) vars[`--led-c-${k}`] = v;
  for (const [k, v] of Object.entries(editorHighlights[m])) vars[`--led-hl-${k}`] = v;
  return `:root{color-scheme:${m};${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Зазор между островами и поле страницы — те же, что на десктопе (--gap 12).
export const gap = spacing.md;

// Кастомный таббар (MainTabBar.js) не сообщает React Navigation свою
// реальную высоту через её внутренний height-callback context (это делает
// только штатный BottomTabBar) — экраны внутри таббара добавляют этот запас
// поверх insets.bottom сами, чтобы контент не оказывался под панелью.
export const tabBarClearance = 108;

// Единая высота для ЛЮБОЙ растянутой на всю ширину кнопки-действия
// (PrimaryButton уже на неё завязан) — маленькие пилюли-переключатели
// (таббар, "Сегодня", свотчи цвета) сюда не относятся, у них своя логика.
export const buttonHeight = 52;

// Скругления — как у десктопа после «островов»: остров 14 (lg), поле и
// кнопка 10 (md), мелкие фишки 8 (sm), шторки 20 (xl).
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 };

export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 };

// Basique Pro хранится 4 отдельными файлами по начертанию (Light/Regular/
// Bold/Black), а не одним variable-font, поэтому "жирность" — это всегда
// выбор СЕМЕЙСТВА, а не числовой fontWeight (см. AppText.js: fontWeight
// рядом с кастомным fontFamily на Android приводит к тихому откату на
// системный шрифт). fontFamily ниже — для мест, где семейство нужно
// прописать явно, минуя автоподбор AppText/AppTextInput по fontWeight.
// Две семьи. Onest набирает интерфейс — тот же шрифт, что на десктопе и в
// вебе; в нём есть казахские буквы и знаки ₽ ₸ ₴ ₺. Basique Pro остаётся
// там, где нужна фирменная нота: лого, заголовки экранов, крупные числа.
//
// Четыре ступени — те же, что у Basique: light/regular/bold/black.
export const fontFamily = {
  light: 'Onest-Light', regular: 'Onest-Regular',
  bold: 'Onest-Medium', black: 'Onest-Bold',
};

/** Фирменная семья — для лого, заголовков экранов и крупных чисел. */
export const displayFamily = {
  light: 'BasiquePro-Light', regular: 'BasiquePro-Regular',
  bold: 'BasiquePro-Bold', black: 'BasiquePro-Black',
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

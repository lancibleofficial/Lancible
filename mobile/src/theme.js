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

const dark = {
  bg: '#2a2b2e', panel: '#313236', panel2: '#3b3c42',
  border: '#4a4b53', borderStrong: '#5a5a66',
  text: '#ecedef', textDim: '#9a9ba4',
  accent: '#87ff65', accentHover: '#aceb98', accentText: '#16220e', accentMuted: 'rgba(135,255,101,0.16)',
  danger: '#ef7a72',
  // Фон ВЫБРАННОГО таба (Заметки/История, Месяц/Неделя/День и т.п.) —
  // раньше был accentMuted (зеленоватая подложка), но на светлой теме такой
  // тон плохо читался. Нейтральный фон: тот же графит, что на общем фоне
  // приложения (на тёмной теме это и есть bg) — активный текст поверх него
  // всё ещё accent (зелёный), контраст в обеих темах достаточный.
  tabActiveBg: '#2a2b2e',
};

const light = {
  bg: '#f6f7f3', panel: '#ffffff', panel2: '#eef1ea',
  border: '#e1e6da', borderStrong: '#c7cdba',
  text: '#14160f', textDim: '#5c6152',
  accent: '#7ae65b', accentHover: '#68c44d', accentText: '#16220e', accentMuted: 'rgba(122,230,91,0.18)',
  danger: '#d13a2c',
  tabActiveBg: '#ffffff',
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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Кастомный таббар (MainTabBar.js) не сообщает React Navigation свою
// реальную высоту через её внутренний height-callback context (это делает
// только штатный BottomTabBar) — экраны внутри таббара добавляют этот запас
// поверх insets.bottom сами, чтобы контент не оказывался под панелью.
export const tabBarClearance = 96;

// Единая высота для ЛЮБОЙ растянутой на всю ширину кнопки-действия
// (PrimaryButton уже на неё завязан) — маленькие пилюли-переключатели
// (таббар, "Сегодня", свотчи цвета) сюда не относятся, у них своя логика.
export const buttonHeight = 52;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 };

// Basique Pro хранится 4 отдельными файлами по начертанию (Light/Regular/
// Bold/Black), а не одним variable-font, поэтому "жирность" — это всегда
// выбор СЕМЕЙСТВА, а не числовой fontWeight (см. AppText.js: fontWeight
// рядом с кастомным fontFamily на Android приводит к тихому откату на
// системный шрифт). fontFamily ниже — для мест, где семейство нужно
// прописать явно, минуя автоподбор AppText/AppTextInput по fontWeight.
export const fontFamily = {
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
  body: { fontFamily: fontFamily.regular, fontSize: fontSize.md },
  bodyBold: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
  caption: { fontFamily: fontFamily.regular, fontSize: fontSize.sm },
  label: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  button: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
};

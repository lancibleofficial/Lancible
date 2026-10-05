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

// Нейтральная шкала темы: холоднее (B-канал растёт быстрее R/G с каждой
// ступенью, разрыв B-R шире, чем в первой попытке — 10/13/16/20/24 вместо
// 7/10/13/16/20 — так, что это заметно, а не едва отличимо) и с большим
// разбросом между ступенями, чем в исходной палитре (там было 2a2b2e..
// 5a5a66, разброс ~48-56) — больше контраста между уровнями поверхностей
// (bg/panel/panel2/border), а не только ярче. Это касается именно
// нейтральных "серых", а не acc/danger — их трогать не просили.
const dark = {
  bg: '#1e2028', panel: '#262933', panel2: '#323542',
  border: '#424656', borderStrong: '#565b6e',
  text: '#eef0f4', textDim: '#9598a8',
  accent: '#87ff65', accentHover: '#aceb98', accentText: '#16220e', accentMuted: 'rgba(135,255,101,0.16)',
  // Ярче/насыщеннее прежнего приглушённого #ef7a72 — тот выглядел "выцветшим"
  // на тёмном фоне.
  danger: '#ff5c50',
  // Фон ВЫБРАННОГО таба (Заметки/История, Месяц/Неделя/День и т.п.) —
  // раньше был accentMuted (зеленоватая подложка), но на светлой теме такой
  // тон плохо читался. Нейтральный фон: тот же графит, что на общем фоне
  // приложения (на тёмной теме это и есть bg) — активный текст поверх него
  // всё ещё accent (зелёный), контраст в обеих темах достаточный.
  tabActiveBg: '#1e2028',
  // Фон реальных полей ввода (там, где пользователь печатает) — на тёмной
  // теме без изменений, равен panel2, см. комментарий у light.inputBg ниже.
  inputBg: '#323542',

  textFaint: '#74767f',
  borderSoft: '#3a3b43',
  boardCol: '#1f2023', boardCard: '#262933',

  // Белое поверх насыщенной заливки: текст опасной кнопки, цифра в значке,
  // бегунок тумблера. Затемнение под шторкой. Красная подложка просроченного
  // срока. Значения те же, что были прописаны в компонентах, и одни на обе
  // темы — переезд в тему ничего не меняет на экране.
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(255,92,80,0.18)',
};

// Светлая тема 0.3.0 — та же палитра, что на десктопе и в вебе.
//
// Прежняя строилась наоборот: фон серый (#e7ecf1), поверхности поверх него
// белые. Теперь белая страница, а серым помечено то, что на ней лежит:
// поля ввода, углубления, столбцы доски. Разница между bg и panel
// специально маленькая — «еле виден», как и просили; карточку держит не
// заливка, а рамка.
const light = {
  bg: '#ffffff', panel: '#f6f7f9', panel2: '#eceef2',
  border: '#d9dee6', borderStrong: '#b6bdc8',
  text: '#10141a', textDim: '#5a626e',
  accent: '#7ae65b', accentHover: '#68c44d', accentText: '#16220e', accentMuted: 'rgba(122,230,91,0.18)',
  danger: '#d13a2c',
  tabActiveBg: '#ffffff',
  // Отдельный (более светлый, чем panel2) токен ТОЛЬКО для реальных полей
  // ввода (текстовые инпуты, трек тумблера темы) — panel2 сам по себе
  // остался прежним, потому что используется много где ещё (таб-строки,
  // бейджи, свотч-боксы), а осветлять нужно было именно инпуты, не всё
  // подряд, что было темнее panel (белого). Первая попытка (#e2e8ee) всё
  // ещё читалась как "слишком тёмная" на белых шитах — взят более светлый
  // шаг, ближе к белому panel, но всё ещё отличимый от него.
  inputBg: '#eceef2',

  // Третья ступень цвета текста: подписи дней, счётчики, мелкие пометки.
  textFaint: '#949ba7',
  // Внутренняя линейка: сетка календаря, разделители внутри карточек.
  // Тише border — она режет плоскость, а не очерчивает предмет.
  borderSoft: '#e4e8ee',
  // Столбец доски — углубление, карточка в нём поднимается до белого.
  boardCol: '#f4f6f9', boardCard: '#ffffff',

  // См. тёмную тему. dangerMuted здесь — подложка от тёмного danger, как было
  // и до переезда; подобрать свою под светлый danger — отдельная правка вида.
  textOnColor: '#fff',
  scrim: 'rgba(0,0,0,0.5)',
  dangerMuted: 'rgba(255,92,80,0.18)',
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
export const tabBarClearance = 108;

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
// Две семьи. Gravity набирает интерфейс: у него ровнее строчные на мелком
// кегле, а телефон — это сплошь мелкий кегль. Basique Pro остаётся там, где
// нужна фирменная нота: лого, заголовки экранов, крупные числа.
//
// У Gravity нет 500 и 600 — есть Light, Book, Regular и Bold. Раскладываем
// их по тем же четырём ступеням, что и Basique: light/regular/bold/black.
export const fontFamily = {
  light: 'Gravity-Light', regular: 'Gravity-Book',
  bold: 'Gravity-Regular', black: 'Gravity-Bold',
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
  body: { fontFamily: fontFamily.regular, fontSize: fontSize.md },
  bodyBold: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
  caption: { fontFamily: fontFamily.regular, fontSize: fontSize.sm },
  label: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  button: { fontFamily: fontFamily.bold, fontSize: fontSize.md },
};

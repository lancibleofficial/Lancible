// Обёртка над RN Text, проставляющая шрифт приложения по умолчанию.
//
// Почему не глобальный патч: в этой версии React Native (0.86, новый
// синтаксис `component`) Text — обычная функция, а не класс, у неё нет
// Text.render для монки-патча (это работало в старых RN, где Text был
// class-компонентом) — первая попытка (src/lib/globalFont.js) поэтому молча
// не сработала. React 19 к тому же убрал defaultProps у функциональных
// компонентов, так что и это не вариант. Единственный надёжный путь — свой
// компонент, импортируемый вместо 'react-native' Text везде в приложении.
//
// Второй нюанс, из-за которого шрифт всё равно не был виден местами: если в
// style одновременно есть кастомный fontFamily И числовой/строковый
// fontWeight, Android пытается сам подобрать нужное начертание под пару
// (family, weight) через системный Typeface — и поскольку "Basique Pro Bold"
// не зарегистрирован в системе как весовой вариант семейства "Basique Pro"
// (у нас 4 отдельных файла, а не один variable-font), система не находит
// соответствие и тихо откатывается на системный шрифт. Поэтому здесь не
// просто добавляется fontFamily, а ПОЛНОСТЬЮ убирается fontWeight из
// итогового стиля — используется явно только семейство нужного начертания.
//
// Про iOS: там шрифт регистрируется в CoreText под своим ВНУТРЕННИМ
// PostScript-именем, а не под ключом из useFonts. В исходных .ttf все
// четыре начертания несли одно и то же PostScript-имя ("Basique") и один
// weight class (400) — CoreText считал их одним шрифтом, и любой из
// ключей ниже резолвился в то начертание, которое загрузилось первым.
// Файлы в assets/fonts пересобраны с уникальными PostScript-именами
// (BasiquePro-Light/-Regular/-Bold/-Black) и весами 300/400/700/900;
// ключи ниже — ровно эти PostScript-имена: expo-font по ним же и мапит
// алиас, а RN на iOS резолвит такое имя напрямую в один файл, минуя подбор
// по весу внутри семейства.
import { Children, forwardRef } from 'react';
import { Text as RNText, StyleSheet } from 'react-native';

// Текст набирает Onest, Basique Pro остался фирменной нотой: лого,
// заголовки экранов, крупные числа (theme.displayFamily).
//
// У Onest пять начертаний в приложении: Light, Regular, Medium, SemiBold,
// Bold. Раскладка по весу — на ступень тише номинала начиная с 700: жирный
// на маленьком экране быстро становится тяжёлым, поэтому 700 — это
// SemiBold, а Bold достаётся только 800 и 900.
export const FAMILY_BY_WEIGHT = {
  100: 'Onest-Light', 200: 'Onest-Light', 300: 'Onest-Light',
  400: 'Onest-Regular', normal: 'Onest-Regular',
  500: 'Onest-Medium', 600: 'Onest-SemiBold',
  700: 'Onest-SemiBold', bold: 'Onest-SemiBold',
  800: 'Onest-Bold', 900: 'Onest-Bold',
};
export const DEFAULT_FAMILY = 'Onest-Regular';

// В Basique Pro нет знаков валют ₽ ₸ ₴ ₺ (проверено по файлам в
// assets/fonts), а набираются ею как раз крупные суммы. Без подмены Android
// берёт системный шрифт, а iOS — случайный с засечками. Такие символы
// оборачиваются во вложенный Text с Onest того же веса: в нём все четыре
// знака есть, и сумма читается одной гарнитурой с остальным текстом.
// Сам Onest подмен не требует.
const MISSING_GLYPHS = /([₽₸₴₺])/;
const GLYPH_FALLBACK = {
  'BasiquePro-Light': 'Onest-Light', 'BasiquePro-Regular': 'Onest-Medium',
  'BasiquePro-Bold': 'Onest-Bold', 'BasiquePro-Black': 'Onest-Bold',
};

function withGlyphFallback(children, family) {
  const fallback = GLYPH_FALLBACK[family];
  if (!fallback) return children;
  return Children.map(children, (child) => {
    if (typeof child !== 'string' || !MISSING_GLYPHS.test(child)) return child;
    return child.split(MISSING_GLYPHS).map((part, i) => (
      MISSING_GLYPHS.test(part) ? <RNText key={i} style={{ fontFamily: fallback }}>{part}</RNText> : part
    ));
  });
}

const Text = forwardRef(({ style, children, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || DEFAULT_FAMILY;
  return (
    <RNText ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined, fontStyle: flat.fontStyle === 'italic' ? 'italic' : 'normal' }]}>
      {withGlyphFallback(children, family)}
    </RNText>
  );
});

export default Text;

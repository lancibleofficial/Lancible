// Обёртка над RN Text, проставляющая Basique Pro по умолчанию.
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
import { Text as RNText, StyleSheet, Platform } from 'react-native';

// Начертания сдвинуты на одну ступень вниз относительно номинального веса
// (800/900→Black было слишком жирно на глаз, теперь это уровень Bold, и т.д.
// по цепочке) — по просьбе "уменьшить жирность текста на одно значение
// ниже" по всему приложению. Ниже Light сдвигать некуда — там потолок.
const FAMILY_BY_WEIGHT = {
  100: 'BasiquePro-Light', 200: 'BasiquePro-Light', 300: 'BasiquePro-Light',
  400: 'BasiquePro-Light', normal: 'BasiquePro-Light',
  500: 'BasiquePro-Light', 600: 'BasiquePro-Regular',
  700: 'BasiquePro-Regular', bold: 'BasiquePro-Regular',
  800: 'BasiquePro-Bold', 900: 'BasiquePro-Bold',
};

// В Basique Pro нет глифов ₽ ₸ ₴ ₺ (проверено по cmap всех четырёх файлов;
// $ € £ ¥ есть). Без явного фолбэка iOS сам подставлял для них случайный
// шрифт с засечками, что выглядело чужеродно рядом с цифрами. Такие символы
// оборачиваются во вложенный Text с системным шрифтом (SF на iOS, Roboto на
// Android) того же визуального веса — ближайший по духу гротеск из
// гарантированно доступных.
const MISSING_GLYPHS = /([₽₸₴₺])/;
const FALLBACK_FAMILY = Platform.select({ ios: 'System', default: 'sans-serif' });
const FALLBACK_WEIGHT = {
  'BasiquePro-Light': '300', 'BasiquePro-Regular': '500', 'BasiquePro-Bold': '700', 'BasiquePro-Black': '900',
};

function withGlyphFallback(children, family) {
  const fallbackStyle = { fontFamily: FALLBACK_FAMILY, fontWeight: FALLBACK_WEIGHT[family] || '400' };
  return Children.map(children, (child) => {
    if (typeof child !== 'string' || !MISSING_GLYPHS.test(child)) return child;
    return child.split(MISSING_GLYPHS).map((part, i) => (
      MISSING_GLYPHS.test(part) ? <RNText key={i} style={fallbackStyle}>{part}</RNText> : part
    ));
  });
}

const Text = forwardRef(({ style, children, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'BasiquePro-Light';
  return (
    <RNText ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined, fontStyle: flat.fontStyle === 'italic' ? 'italic' : 'normal' }]}>
      {withGlyphFallback(children, family)}
    </RNText>
  );
});

export default Text;

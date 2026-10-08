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
// fontWeight, Android пытается сам подобрать начертание под пару
// (family, weight) через системный Typeface — а начертания у нас отдельные
// файлы, не variable-font, и система тихо откатывается на системный шрифт.
// Поэтому здесь не просто добавляется fontFamily, а ПОЛНОСТЬЮ убирается
// fontWeight из итогового стиля — работает только семейство начертания.
//
// Про iOS: шрифт регистрируется в CoreText под ВНУТРЕННИМ PostScript-именем
// файла. Ключи ниже — ровно эти имена (Onest-Regular, Onest-Bold…), и RN
// резолвит такое имя прямо в один файл, минуя подбор по весу.
import { forwardRef } from 'react';
import { Text as RNText, StyleSheet } from 'react-native';

// Весь телефон набран Onest — и текст, и заголовки (theme.displayFamily).
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

const Text = forwardRef(({ style, children, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || DEFAULT_FAMILY;
  return (
    <RNText ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined, fontStyle: flat.fontStyle === 'italic' ? 'italic' : 'normal' }]}>
      {children}
    </RNText>
  );
});

export default Text;

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
// (family, weight) через системный Typeface — и поскольку "BasiquePro-Bold"
// не зарегистрирован в системе как весовой вариант семейства "BasiquePro"
// (у нас 4 отдельных файла, а не один variable-font), система не находит
// соответствие и тихо откатывается на системный шрифт. Поэтому здесь не
// просто добавляется fontFamily, а ПОЛНОСТЬЮ убирается fontWeight из
// итогового стиля — используется явно только семейство нужного начертания.
import { forwardRef } from 'react';
import { Text as RNText, StyleSheet } from 'react-native';

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

const Text = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'BasiquePro-Light';
  return <RNText ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined, fontStyle: flat.fontStyle === 'italic' ? 'italic' : 'normal' }]} />;
});

export default Text;

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
// Названия семейств ниже — РЕАЛЬНЫЕ внутренние имена из name-таблицы каждого
// .ttf (проверено через System.Drawing.Text.PrivateFontCollection), не
// произвольный ключ вида "BasiquePro-Bold": на iOS fontFamily резолвится
// против имени, под которым шрифт зарегистрирован в CoreText, а не против
// строки, которой его загрузили в useFonts — несовпадение объясняло, почему
// на iOS все начертания выглядели одинаково, хотя тот же код с любым
// произвольным ключом работал на Android без проблем.
import { forwardRef } from 'react';
import { Text as RNText, StyleSheet } from 'react-native';

// Начертания сдвинуты на одну ступень вниз относительно номинального веса
// (800/900→Black было слишком жирно на глаз, теперь это уровень Bold, и т.д.
// по цепочке) — по просьбе "уменьшить жирность текста на одно значение
// ниже" по всему приложению. Ниже Light сдвигать некуда — там потолок.
const FAMILY_BY_WEIGHT = {
  100: 'Basique Pro Light', 200: 'Basique Pro Light', 300: 'Basique Pro Light',
  400: 'Basique Pro Light', normal: 'Basique Pro Light',
  500: 'Basique Pro Light', 600: 'Basique Pro',
  700: 'Basique Pro', bold: 'Basique Pro',
  800: 'Basique Pro Bold', 900: 'Basique Pro Bold',
};

const Text = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'Basique Pro Light';
  return <RNText ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined, fontStyle: flat.fontStyle === 'italic' ? 'italic' : 'normal' }]} />;
});

export default Text;

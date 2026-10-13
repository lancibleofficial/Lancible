// Список выбора в листе — один на все листы: язык, валюта, проект, версия,
// «Напомнить», статус карточки, теги, период и проекты экспорта.
//
// До 11 октября 2026 у каждого листа был свой список: пункт — серая плашка,
// выбранный — зелёная заливка строки. Плашек столько же, сколько пунктов, и
// список читался столбиком одинаковых кнопок. Теперь подложка одна на весь
// список (panel2, скругление острова), строки лежат на ней без своих
// подложек и делятся волосяной линией с отступом слева, как списки iOS;
// выбранный пункт — галочка акцентом (accentInk) и подпись жирнее, без
// заливки; нажатие — лёгкая подсветка строки (raise).
//
// Один выбор — value; несколько — multi и selected (массив значений): тогда
// строка — флажок для чтения с экрана, а не переключатель. Пункт может
// нести цветную точку (проект, статус, тег), тихую подпись справа (note) или
// значок слева (icon) — у действия вроде «Создать тег» или «Старт таймера»
// выбора нет, и галочки у него не бывает.
//
// С 12 октября 2026 ChoiceList — и выбор вида в листе («До начала · До
// дедлайна · Один раз · Повторять», «Не повторяется · Каждый день · …
// Настроить…», «Войти · Создать аккаунт»): сегментов в листах нет. Пункт,
// который сейчас выбрать нельзя, — disabled: тише остальных, не нажимается
// («Добавьте время работы или дедлайн» в напоминании).
//
// Высота строки — buttonHeight: строки идут подряд, и соседняя не должна
// ловить палец, нацеленный сюда. Держит mobile/tests/choiceList.test.js.
import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize, buttonHeight } from '../theme';

/**
 * @param {Array<{value, label: string, color?: string, note?: string,
 *   icon?: string, iconColor?: string, testID?: string, disabled?: boolean}>} options
 * @param {*} [value] — выбранное, если выбор один
 * @param {Array} [selected] — выбранные, если их несколько (multi)
 * @param {boolean} [multi]
 * @param {function} onSelect — значение нажатого пункта
 */
export default function ChoiceList({ options, value, selected, multi = false, onSelect, style, testID = 'choice-list' }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const isOn = (v) => (multi ? (selected || []).includes(v) : v === value);
  return (
    <View style={[styles.list, style]} testID={testID}>
      {options.map((opt, i) => (
        <ChoiceRow
          key={String(opt.value)}
          opt={opt}
          first={i === 0}
          on={!opt.icon && !opt.disabled && isOn(opt.value)}
          multi={multi}
          onPress={opt.disabled ? undefined : () => onSelect(opt.value)}
          styles={styles}
          colors={colors}
          testID={testID}
        />
      ))}
    </View>
  );
}

/** Строка списка. Подсветка нажатия — своим состоянием по pressIn/pressOut,
 *  а не стилем-функцией Pressable: так она одна и та же на устройстве и в
 *  тесте. */
function ChoiceRow({ opt, first, on, multi, onPress, styles, colors, testID }) {
  const [down, setDown] = useState(false);
  const off = !!opt.disabled;
  const a11y = opt.icon ? { accessibilityRole: 'button' }
    : multi ? { accessibilityRole: 'checkbox', accessibilityState: { checked: on, disabled: off } }
      : { accessibilityRole: 'radio', accessibilityState: { selected: on, disabled: off } };
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      style={[styles.row, down && styles.rowPressed]}
      testID={opt.testID || `${testID}-row`}
      {...a11y}
    >
      {!first ? <View style={styles.line} testID={`${testID}-line`} /> : null}
      {opt.color ? <View style={[styles.dot, { backgroundColor: opt.color }]} /> : null}
      {opt.icon ? <Icon name={opt.icon} size={16} color={opt.iconColor || colors.textDim} /> : null}
      <Text style={[styles.label, on && styles.labelOn, off && styles.labelOff]} numberOfLines={1}>{opt.label}</Text>
      {opt.note ? <Text style={styles.note} numberOfLines={1}>{opt.note}</Text> : null}
      {on ? <Icon name="check" size={16} color={colors.accentInk} /> : null}
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // overflow: hidden — подсветка крайней строки повторяет скругление списка.
  list: { backgroundColor: colors.panel2, borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: buttonHeight, paddingHorizontal: spacing.md,
  },
  rowPressed: { backgroundColor: colors.raise },
  // Линия между строками — с отступом слева, до края справа; лежит поверх
  // строки, поэтому подсветка нажатия её не прячет.
  line: {
    position: 'absolute', top: 0, left: spacing.md, right: 0,
    height: StyleSheet.hairlineWidth, backgroundColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 3 },
  label: { flex: 1, color: colors.text, fontSize: fontSize.md },
  labelOn: { fontWeight: '600' },
  labelOff: { color: colors.textFaint },
  note: { color: colors.textFaint, fontSize: fontSize.xs, maxWidth: 130 },
});

// Кирпичи нижних листов. Начались как детали повтора и напоминания, но
// теперь это общий набор на все листы (DESIGN.md, «Нижние листы»): каждый
// лист берёт отсюда подписи, подсказки, сводки и квадраты дней, а не заводит
// свои копии с другим видом. Строки и острова — в Island.js (SettingRow,
// RowGroup, ExpandRow), список-выбор с галочкой — ChoiceList.js.
//   • Block — подпись группы или поля над ним, как «Период» в экспорте:
//     textDim, мелко, без заглавных;
//   • Hint — тихая подсказка под полем или островом: textFaint, мелко;
//   • InfoRow — спокойная серая строка-сводка, как у «Дедлайна»;
//   • дни недели и числа месяца — квадраты на подложке panel2, как ячейки
//     календаря и столбцы времени.
// Сегментов здесь нет (12 октября 2026): в листах выбор вида — строки с
// галочкой (ChoiceList), сегменты остались только на экранах.
import { useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Неделя начинается с понедельника — как во всём приложении.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Поле или ряд с подписью над ним — как «Период» и «Проекты» в экспорте.
 *  Без подписи — просто стопка с тем же шагом (группа строк без названия). */
export function Block({ label, children }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.block}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

/** Подсказка под полем или островом: «Пусто — общая из настроек…», «Каждый
 *  раз в списке останется…». Одна на все листы — своих «hint» листы не
 *  заводят. */
export function Hint({ children, danger, testID }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={[styles.hint, danger && styles.hintDanger]} testID={testID}>{children}</Text>;
}

/** Спокойная строка-сводка на подложке panel2 — вид сводки «Дедлайна».
 *  @param text главная строка (testID — на ней, у строки — `${testID}-row`);
 *  @param sub мелкая под ней
 *  @param danger текст красным — сводка говорит об ошибке («Проверьте дату и
 *    время»), а не о значении */
export function InfoRow({ text, sub, icon = 'clock', danger, testID }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.info} testID={testID ? `${testID}-row` : undefined}>
      <Icon name={icon} size={14} color={danger ? colors.danger : colors.textDim} />
      <View style={styles.infoBody}>
        <Text style={[styles.infoText, danger && styles.infoDanger]} testID={testID}>{text}</Text>
        {sub ? <Text style={styles.infoSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** Ряд из семи квадратов с подписью внутри. */
function Square({ label, on, onPress, styles, testID }) {
  return (
    <Pressable onPress={onPress} style={[styles.day, on && styles.dayOn]} testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <Text style={[styles.dayText, on && styles.dayTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Дни недели — выбрать несколько. @param value массив номеров (0 — вс). */
export function WeekdayChips({ lang, value, onToggle, testID = 'weekday-chips' }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.days} testID={testID}>
      {WEEKDAYS.map((d) => (
        <Square key={d} label={t(lang, WEEKDAY_KEY[d])} on={value.includes(d)} onPress={() => onToggle(d)} styles={styles} testID={`${testID}-${d}`} />
      ))}
    </View>
  );
}

/** Число месяца — выбрать одно, 1…31. Последний ряд добивается пустыми
 *  местами, чтобы квадраты остались той же ширины. */
export function MonthDayChips({ value, onPick, testID = 'monthday-chips' }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows = [];
  for (let i = 0; i < MONTH_DAYS.length; i += 7) rows.push(MONTH_DAYS.slice(i, i + 7));
  return (
    <View style={styles.grid} testID={testID}>
      {rows.map((row) => (
        <View key={row[0]} style={styles.days}>
          {row.map((d) => <Square key={d} label={String(d)} on={value === d} onPress={() => onPick(d)} styles={styles} testID={`${testID}-${d}`} />)}
          {Array.from({ length: 7 - row.length }, (_, i) => <View key={`pad${i}`} style={styles.pad} />)}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // Подпись над полем: тот же вид и отступы, что у «Период» в экспорте и
  // «Название» в проекте; между подписью и полем — spacing.sm.
  block: { gap: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.xs, marginTop: spacing.xs },
  // Подсказка — тише подписи, в несколько строк.
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  hintDanger: { color: colors.danger },

  // Сводка — вид сводки «Дедлайна» (DueSheet): panel2, значок textDim.
  info: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  infoBody: { flex: 1 },
  infoText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  infoDanger: { color: colors.danger },
  infoSub: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 2 },

  // Дни недели — ряд квадратов на panel2, как ячейки календаря; выбранный —
  // залит акцентом, как выбранные часы и минуты в поле времени.
  days: { flexDirection: 'row', gap: spacing.xs },
  grid: { gap: spacing.xs },
  pad: { flex: 1, aspectRatio: 1 },
  day: {
    flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, backgroundColor: colors.panel2,
  },
  dayOn: { backgroundColor: colors.accent },
  dayText: { color: colors.text, fontSize: fontSize.sm },
  dayTextOn: { color: colors.accentText, fontWeight: '700' },
});

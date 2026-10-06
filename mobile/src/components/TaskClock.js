// Время задачи и заработанное рядом — строка в карточке таймера.
//
// Сумма стоит справа от времени, по нижнему краю цифр, без подписи: рядом
// с часами она читается сама. Показывать ли её, решает ядро
// (earnedShown) — то же правило, что на десктопе: есть ставка или уже есть
// заработанное. Вынесено из экрана задачи, чтобы строку можно было
// проверить тестом, не поднимая весь экран с редактором.
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { fmtClock, fmtMoney, earnedOf, earnedShown } from '../lib/format';
import { useColors, spacing, fontSize, displayFamily } from '../theme';

export default function TaskClock({ task, elapsedMs }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const lang = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const earned = earnedOf(task, hourlyRate, activeTimer);
  return (
    <View style={styles.line}>
      <Text style={styles.clock}>{fmtClock(elapsedMs)}</Text>
      {earnedShown(task, hourlyRate, earned) ? (
        <Text style={styles.earned}>{fmtMoney(earned, lang, currency)}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, flexShrink: 1 },
  clock: { color: colors.text, fontSize: 26, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  earned: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

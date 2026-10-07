// Время задачи и заработанное — строки в острове таймера.
//
// Сумма стоит под временем, по его левому краю, мельче: как на странице
// задачи десктопа после «островов». Показывать ли её, решает ядро
// (earnedShown) — то же правило, что на десктопе: есть ставка или уже есть
// заработанное. Ставка считается с учётом ставки проекта (useRates), валюта
// — проекта (currencyOf). Вынесено из экрана задачи, чтобы строку можно
// было проверить тестом, не поднимая весь экран с редактором.
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore, getProject } from '../store/useAppStore';
import { fmtClock, fmtMoney, earnedOf, earnedShown, effectiveRate, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import { useRates, currencyOf } from '../hooks/useRates';
import { useColors, spacing, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

export default function TaskClock({ task, elapsedMs }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const settings = useAppStore((s) => s.settings);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const rates = useRates();
  const lang = settings.lang;
  const currency = currencyOf(getProject(projects, task.projectId), settings);
  const earned = earnedOf(task, rates, activeTimer);
  const rate = effectiveRate(task, rates);
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  return (
    <View style={styles.block}>
      <Text style={styles.clock}>{fmtClock(elapsedMs)}</Text>
      <View style={styles.line}>
        {earnedShown(task, rates, earned) ? (
          <Text style={styles.earned}>{fmtMoney(earned, lang, currency)}</Text>
        ) : null}
        <Text style={styles.rate} numberOfLines={1}>
          {rate ? `${moneyFmt(lang).format(rate)} ${sym}${t(lang, 'rate.per_hour')}` : t(lang, 'money.no_rate')}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  block: { flex: 1, minWidth: 0 },
  clock: { color: colors.text, fontSize: 26, lineHeight: 30, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 2 },
  earned: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  rate: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
});

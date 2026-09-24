// Карточка задачи на доске. Порт .board-card из веба: полоса цвета статуса
// слева, название в две строки, под ним время и срок.
//
// Вынесена отдельным мемоизированным компонентом не ради порядка, а ради
// прокрутки: на доске легко оказывается полторы сотни карточек, и пока
// идёт таймер, перерисовываться раз в секунду должна ровно одна из них — та,
// по которой он идёт. Поэтому счётчик живёт во вложенном RunningTime со
// своим тикером, а сама карточка перерисовывается только когда меняется
// задача.
import { memo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useTicker } from '../hooks/useTicker';
import { fmtDur, taskElapsedMs } from '../lib/format';
import { dueState, dueShort } from '../lib/due';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

/** Живое время идущей задачи. Тикер здесь, а не в карточке: перерисовка раз
 *  в секунду касается одной строки, а не всей сетки. */
function RunningTime({ task, startedAt, lang, style }) {
  useTicker(true);
  const ms = (task.totalMs || 0) + (Date.now() - new Date(startedAt).getTime());
  return <Text style={style}>{fmtDur(ms, lang)}</Text>;
}

function BoardCard({ task, color, runningSince, lang, onPress, onLongPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const due = dueState(task);

  return (
    <Pressable
      style={[styles.card, { borderLeftColor: color }]}
      onPress={() => onPress(task.id)}
      onLongPress={() => onLongPress(task.id)}
    >
      <Text style={[styles.title, task.done && styles.titleDone, !task.title && styles.titleEmpty]} numberOfLines={2}>
        {task.title || t(lang, 'task.no_name')}
      </Text>
      <View style={styles.foot}>
        <Icon name="clock" size={10} color={colors.textDim} />
        {runningSince
          ? <RunningTime task={task} startedAt={runningSince} lang={lang} style={styles.time} />
          : <Text style={styles.time}>{fmtDur(taskElapsedMs(task, null), lang)}</Text>}
        <View style={styles.spacer} />
        {due ? (
          <Text style={[styles.due, due === 'overdue' && styles.dueOverdue]} numberOfLines={1}>
            {dueShort(task, lang)}
          </Text>
        ) : null}
        {runningSince ? <View style={styles.running} /> : null}
      </View>
    </Pressable>
  );
}

// Сравниваем по тому, что карточка реально показывает. Ссылка на задачу
// меняется при любой правке её полей, поэтому этого достаточно — а вот
// перерисовку от тика таймера соседей это отсекает.
export default memo(BoardCard);

const makeStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.boardCard, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
  },
  title: { color: colors.text, fontSize: fontSize.sm, lineHeight: 19 },
  titleDone: { color: colors.textDim, textDecorationLine: 'line-through' },
  titleEmpty: { color: colors.textFaint },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  time: { color: colors.textDim, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  // Распорка, а не marginLeft: 'auto' у срока: срока может не быть, и
  // тогда точка таймера прижалась бы к времени вместо правого края.
  spacer: { flex: 1, minWidth: spacing.xs },
  due: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
  dueOverdue: { color: colors.danger },
  // Точка идущего таймера — крайняя справа, как на карточках «Главной».
  running: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, marginLeft: spacing.xs },
});

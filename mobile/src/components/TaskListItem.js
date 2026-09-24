import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { getStatus } from '../lib/statuses';
import { fmtShort, taskElapsedMs } from '../lib/format';
import { dueState, dueShort } from '../lib/due';
import { useTicker } from '../hooks/useTicker';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Таймер запускается/останавливается только из TaskDetailScreen — в списке
// только индикация, что задача сейчас в работе (см. фидбек: кнопка "старт"
// в списке лишняя, путает с открытием задачи).
//
// Кнопки-пина тут тоже нет: закрепление переехало на свайп влево (SwipeRow),
// как у проектов на Главной. Строка списка — это про задачу, а не про
// панель управления ею.
export default function TaskListItem({ task, onPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const statuses = useAppStore((s) => s.statuses);
  const isRunning = activeTimer && activeTimer.taskId === task.id;

  useTicker(!!isRunning);

  const ds = dueState(task);
  const status = getStatus(statuses, task.statusId);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Pressable hitSlop={10} onPress={() => toggleTaskDone(task.id)} style={[styles.checkbox, task.done && styles.checkboxOn]}>
        {task.done ? <Icon name="check" size={13} color={colors.accentText} /> : null}
      </Pressable>

      <View style={styles.mid}>
        <Text style={[styles.title, task.done && styles.titleDone]} numberOfLines={1}>
          {task.title || t(lang, 'task.no_name')}
        </Text>
        <View style={styles.timeRow}>
          {/* Статус первым: по нему и видно, на какой стадии задача, —
              срок и время только уточняют. */}
          {status ? (
            <View style={styles.statusChip}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={styles.statusText} numberOfLines={1}>{status.name}</Text>
            </View>
          ) : null}
          {ds ? (
            <View style={[styles.dueBadge, styles[ds] || null]}>
              <Text style={[styles.dueText, styles[ds + 'Text'] || null]}>{dueShort(task, lang)}</Text>
            </View>
          ) : null}
          {isRunning ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.time, isRunning && styles.timeRunning]}>{fmtShort(taskElapsedMs(task, activeTimer), lang)}</Text>
        </View>
      </View>

    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // Ни скругления, ни нижнего отступа: и то и другое держит строка
  // свайпа снаружи (SwipeRow) — иначе у открытой строки между карточкой
  // и кнопкой остаётся вырез от угла, а кнопка вылезает ниже карточки.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, padding: spacing.md,
  },
  pressed: { opacity: 0.8 },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, backgroundColor: colors.panel2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent },
  mid: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  titleDone: { color: colors.textDim, textDecorationLine: 'line-through' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 },
  statusDot: { width: 8, height: 8, borderRadius: 2 },
  statusText: { color: colors.textDim, fontSize: 11 },
  // Тот же цветовой код, что в десктопной версии: красный — просрочено,
  // акцент — в пределах суток, нейтральный — дальше.
  dueBadge: { backgroundColor: colors.panel2, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  dueText: { color: colors.textDim, fontSize: 11 },
  soon: { backgroundColor: colors.accentMuted },
  soonText: { color: colors.accentHover },
  overdue: { backgroundColor: 'rgba(255,92,80,0.18)' },
  overdueText: { color: colors.danger },
  later: {},
  laterText: {},
  time: { color: colors.textDim, fontSize: fontSize.xs },
  timeRunning: { color: colors.accent, fontWeight: '700' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});

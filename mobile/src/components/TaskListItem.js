import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { fmtDateShort } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';
import Views from '../core/views.js';

// Строка задачи в списке проекта — строка внутри острова списка, без
// своей подложки: галочка, название, под ним тихая мета (версия, точки
// тегов, повтор, дедлайн), справа время. Таймер запускается только из
// задачи — в списке только индикация, что задача сейчас в работе.
//
// Что показать в строке, решает ядро (src/core/views.js, taskRowView) —
// то же правило, что у десктопа. Раньше строка решала сама и разошлась с
// десктопом молча: не показывала ни версию, ни значок повторения.
// showStatus=false — в списке, сгруппированном по статусам: там статус
// уже в заголовке группы, в строке он был бы повтором.
export default function TaskListItem({ task, onPress, showStatus = true }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const tags = useAppStore((s) => s.tags);

  const v = Views.taskRowView(task, {
    statuses,
    versions,
    tags,
    selectedId: null,
    activeTimer,
    now: Date.now(),
    lang,
    t: (key, vars) => t(lang, key, vars),
    fmtDateShort: (date) => fmtDateShort(date, lang),
  });

  useTicker(v.running);

  return (
    <Tap onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Tap
        hitSlop={10}
        onPress={() => toggleTaskDone(task.id)}
        style={[styles.checkbox, v.done && styles.checkboxOn]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: v.done }}
        accessibilityLabel={t(lang, 'task.mark_done')}
      >
        {v.done ? <Icon name="check" size={12} color={colors.accentText} /> : null}
      </Tap>

      <View style={styles.mid}>
        <Text style={[styles.title, v.done && styles.titleDone]} numberOfLines={1}>
          {v.title}
        </Text>
        {(v.version || v.tags.length || v.repeat || v.due || (showStatus && v.status)) ? (
          <View style={styles.meta}>
            {showStatus && v.status ? (
              <View style={styles.status}>
                <View style={[styles.statusDot, { backgroundColor: v.status.color }]} />
                <Text style={styles.statusText} numberOfLines={1}>{v.status.name}</Text>
              </View>
            ) : null}
            {v.tags.length ? (
              <View style={styles.tagDots}>
                {v.tags.map((tg, i) => <View key={i} style={[styles.tagDot, { backgroundColor: tg.color }]} />)}
              </View>
            ) : null}
            {v.version ? (
              <View style={styles.versionChip}>
                <Text style={[styles.versionText, v.version.released && styles.versionReleased]} numberOfLines={1}>
                  {v.version.name}
                </Text>
              </View>
            ) : null}
            {v.repeat ? <Text style={styles.repeatMark}>↻</Text> : null}
            {v.due ? (
              <Text style={[styles.due, styles[`due_${v.due.state}`] || null]} numberOfLines={1}>{v.due.text}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {v.running ? <View style={styles.liveDot} /> : null}
      <Text style={[styles.time, v.running && styles.timeRunning]}>{v.time}</Text>
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 1 },
  pressed: { opacity: 0.75 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: colors.panel2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent },
  mid: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120 },
  statusDot: { width: 7, height: 7, borderRadius: 2 },
  statusText: { color: colors.textDim, fontSize: 11, flexShrink: 1 },
  tagDots: { flexDirection: 'row', gap: 3 },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  // Версия и значок повторения — с десктопа (.task-version,
  // .task-repeat-mark) теми же токенами: плашка panel2, текст textDim, у
  // выпущенной версии и у значка — textFaint.
  versionChip: { backgroundColor: colors.panel2, borderRadius: radius.sm, paddingHorizontal: 6, height: 16, justifyContent: 'center', maxWidth: 110 },
  versionText: { color: colors.textDim, fontSize: 11, lineHeight: 14 },
  versionReleased: { color: colors.textFaint },
  repeatMark: { color: colors.textFaint, fontSize: 11 },
  // Тот же цветовой код, что на десктопе: красный — просрочено, акцент —
  // в пределах суток, нейтральный — дальше.
  due: { color: colors.textFaint, fontSize: 11, flexShrink: 1 },
  due_soon: { color: colors.accentInk },
  due_overdue: { color: colors.danger },
  time: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  timeRunning: { color: colors.accentInk },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});

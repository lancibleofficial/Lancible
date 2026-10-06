import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { fmtDateShort } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';
import Views from '../core/views.js';

// Таймер запускается/останавливается только из TaskDetailScreen — в списке
// только индикация, что задача сейчас в работе (см. фидбек: кнопка "старт"
// в списке лишняя, путает с открытием задачи).
//
// Кнопки-пина тут тоже нет: закрепление переехало на свайп влево (SwipeRow),
// как у проектов на Главной. Строка списка — это про задачу, а не про
// панель управления ею.
//
// Что показать в строке, решает ядро (src/core/views.js, taskRowView) —
// то же правило, что у десктопа. Раньше строка решала сама и разошлась с
// десктопом молча: не показывала ни версию, ни значок повторения.
export default function TaskListItem({ task, onPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);

  const v = Views.taskRowView(task, {
    statuses,
    versions,
    selectedId: null,
    activeTimer,
    now: Date.now(),
    lang,
    t: (key, vars) => t(lang, key, vars),
    fmtDateShort: (date) => fmtDateShort(date, lang),
    // Подписи по наведению у телефона нет — значку повторения она не нужна.
  });

  useTicker(v.running);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Pressable hitSlop={10} onPress={() => toggleTaskDone(task.id)} style={[styles.checkbox, v.done && styles.checkboxOn]}>
        {v.done ? <Icon name="check" size={13} color={colors.accentText} /> : null}
      </Pressable>

      <View style={styles.mid}>
        <Text style={[styles.title, v.done && styles.titleDone]} numberOfLines={1}>
          {v.title}
        </Text>
        <View style={styles.timeRow}>
          {v.status ? (
            <View style={styles.statusChip}>
              <View style={[styles.statusDot, { backgroundColor: v.status.color }]} />
              <Text style={styles.statusText} numberOfLines={1}>{v.status.name}</Text>
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
            <View style={[styles.dueBadge, styles[v.due.state] || null]}>
              <Text style={[styles.dueText, styles[v.due.state + 'Text'] || null]}>{v.due.text}</Text>
            </View>
          ) : null}
          {v.running ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.time, v.running && styles.timeRunning]}>{v.time}</Text>
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
  // Версия и значок повторения — с десктопа (.task-version,
  // .task-repeat-mark) теми же токенами: плашка panel2, текст textDim, у
  // выпущенной версии и у значка — textFaint.
  versionChip: { backgroundColor: colors.panel2, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 1, maxWidth: 120 },
  versionText: { color: colors.textDim, fontSize: 11, fontWeight: '500' },
  versionReleased: { color: colors.textFaint },
  repeatMark: { color: colors.textFaint, fontSize: 11 },
  // Тот же цветовой код, что в десктопной версии: красный — просрочено,
  // акцент — в пределах суток, нейтральный — дальше.
  dueBadge: { backgroundColor: colors.panel2, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  dueText: { color: colors.textDim, fontSize: 11 },
  soon: { backgroundColor: colors.accentMuted },
  soonText: { color: colors.accentInk },
  overdue: { backgroundColor: colors.dangerMuted },
  overdueText: { color: colors.danger },
  later: {},
  laterText: {},
  time: { color: colors.textDim, fontSize: fontSize.xs },
  timeRunning: { color: colors.accentInk, fontWeight: '700' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});

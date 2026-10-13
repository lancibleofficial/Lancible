import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { fmtDateShort } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import { TagBadgeFit } from './TagBadge';
import TagPickerSheet from './TagPickerSheet';
import { LiquidCheck } from './Liquid';
import PinMark from './PinMark';
import RunningClock from './RunningClock';
import { tagsOf } from '../lib/tags';
import { rowStatus, isCancelled } from '../lib/statuses';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, taskCheckRadius } from '../theme';
import { t } from '../lib/i18n';
import Views from '../core/views.js';

// Минимальная высота строки списка проекта. До 11 октября 2026 строка была по
// содержимому (около 43 с названием и 52 с метой) — под бейджи тегов места не
// оставалось. Теперь не ниже 56 даже без меты, а с тегами строка растёт на
// высоту их ряда. Держит mobile/tests/TaskListItem.test.js.
export const TASK_ROW_MIN_H = 56;

// Строка задачи в списке проекта — строка внутри острова списка, без
// своей подложки: галочка, название, под ним тихая мета (версия, повтор,
// дедлайн), ещё ниже теги бейджами, справа время. Таймер запускается только из
// задачи — в списке только индикация, что задача сейчас в работе.
//
// Теги внутри проекта видны всегда (раньше — точками, цвет без подписи).
// Бейджи идут одной строкой: сколько влезло — столько и показано, остальные
// сворачиваются в «+N» (TagBadgeFit), а нажатие на «+N» открывает лист со всеми
// тегами задачи, где их можно снять и добавить. Строка при этом не открывается.
//
// Что показать в строке, решает ядро (src/core/views.js, taskRowView) —
// то же правило, что у десктопа. Раньше строка решала сама и разошлась с
// десктопом молча: не показывала ни версию, ни значок повторения.
// showStatus=false — в списке, сгруппированном по статусам: там статус
// уже в заголовке группы, в строке он был бы повтором.
//
// Пока идёт таймер, в мете на месте статуса стоят живые часы (RunningClock — свой
// тикер на один Text). Отмеченная задача показывает вместо цветного статуса
// серое «выполнено» (rowStatus) — то же правило, что у строки ленты (TaskRow).
//
// Галочка наливается акцентом с «попом» и брызгами (LiquidCheck). Закрепили
// свайпом — у названия втыкается булавка (PinMark) и гаснет: закреплённые на
// странице проекта и так в своей группе; keepPin — оставлять её.
//
// Отменённая задача: вместо галочки серый крестик (нажатие возвращает её в
// работу), название серое без зачёркивания, в мете — серое «Отменено», срока
// нет — то же правило, что у TaskRow.
//
// onToggleDone(task, change, closed) — как у TaskRow: экран решает, когда
// правка и двинется ли строка (страница проекта держит строку на месте, пока
// налив играет); checked — показать галочку отмеченной, пока в строку ещё
// приходит задача до отметки.
export default function TaskListItem({ task, onPress, showStatus = true, keepPin = false, onToggleDone, checked }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const reopenTask = useAppStore((s) => s.reopenTask);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const tags = useAppStore((s) => s.tags);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const taskTags = tagsOf(tags, task.tagIds || []);

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

  // Секундные часы тикают сами (RunningClock); строке нужна только минутная
  // сводка справа (v.time), её обновляем реже, чем раз в секунду.
  useTicker(v.running, 15000);
  const done = v.done || !!checked;
  const cancelled = isCancelled(task, statuses);
  const status = rowStatus(statuses, task, done, lang);
  // Закрытая — выполненная или отменённая — срока не показывает (у выполненной
  // его гасит ядро, у отменённой — здесь).
  const due = cancelled || (checked && !v.done) ? null : v.due;
  // Нажатие на галочку отмечает задачу, на крестик — возвращает в работу.
  const onCheck = () => {
    const change = () => (cancelled ? reopenTask(task.id) : toggleTaskDone(task.id));
    if (onToggleDone) onToggleDone(task, change, v.done || cancelled);
    else change();
  };

  return (
    <Tap
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`task-row-${task.id}`}
      accessibilityValue={task.pinnedAt ? { text: t(lang, 'tasks.pinned_mark') } : undefined}
    >
      <LiquidCheck
        checked={done}
        cancelled={cancelled}
        kickId={task.id}
        hitSlop={10}
        onPress={onCheck}
        style={styles.checkbox}
        iconSize={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={t(lang, cancelled ? 'task.reopen' : 'task.mark_done')}
      />

      <View style={styles.mid}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, done && styles.titleDone, cancelled && styles.titleCancelled]} numberOfLines={1}>
            {v.title}
          </Text>
          <PinMark pinnedAt={task.pinnedAt} keep={keepPin} size={11} style={styles.pin} />
        </View>
        {(v.running || v.version || v.repeat || due || (showStatus && status)) ? (
          <View style={styles.meta}>
            {v.running ? (
              <RunningClock task={task} activeTimer={activeTimer} style={styles.clock} testID={`task-clock-${task.id}`} />
            ) : showStatus && status ? (
              <View style={styles.status} testID={`task-status-${task.id}`}>
                <View style={[styles.statusDot, status.done && styles.statusDotDone, status.color ? { backgroundColor: status.color } : null]} testID={`task-dot-${task.id}`} />
                <Text style={[styles.statusText, status.done && styles.statusTextDone]} numberOfLines={1}>{status.name}</Text>
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
            {due ? (
              <Text style={[styles.due, styles[`due_${due.state}`] || null]} numberOfLines={1}>{due.text}</Text>
            ) : null}
          </View>
        ) : null}
        <TagBadgeFit
          tags={taskTags}
          onMore={() => openSheet(
            <TagPickerSheet
              title={t(lang, 'tag.task_title')}
              value={task.tagIds || []}
              projectId={task.projectId}
              onChange={(ids) => setTaskTags(task.id, ids)}
            />,
          )}
          moreLabel={t(lang, 'tag.more_a11y', { n: taskTags.length })}
          style={styles.tags}
          testID={`task-tags-${task.id}`}
        />
      </View>

      {v.running ? <View style={styles.liveDot} /> : null}
      <Text style={[styles.time, v.running && styles.timeRunning]}>{v.time}</Text>
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TASK_ROW_MIN_H, paddingVertical: spacing.sm + 2 },
  pressed: { opacity: 0.75 },
  // Не отмечена — panel2; отмеченную наливает акцентом LiquidCheck.
  checkbox: {
    width: 22, height: 22, borderRadius: taskCheckRadius, backgroundColor: colors.panel2,
    alignItems: 'center', justifyContent: 'center',
  },
  mid: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexShrink: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  pin: { marginTop: 1 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  // Отменённая — серое название без зачёркивания: так она не похожа на выполненную.
  titleCancelled: { color: colors.textFaint },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120 },
  statusDot: { width: 7, height: 7, borderRadius: 2 },
  statusText: { color: colors.textDim, fontSize: 11, flexShrink: 1 },
  // Отмеченная: серые и точка, и подпись — не зелёный цвет «готово» проекта.
  statusDotDone: { backgroundColor: colors.textFaint },
  statusTextDone: { color: colors.textFaint },
  // Часы идущей задачи — на месте статуса; цифры одной ширины, чтобы не дрожали.
  clock: { color: colors.accentInk, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // Ряд тегов — под названием и метой, с отступом: бейджи не липнут к тексту.
  tags: { marginTop: 3 },
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

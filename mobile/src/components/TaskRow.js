// Строка задачи в колоде проектов, в ленте «Задачи» и на «Сегодня» (макет
// B2): галочка (тап — выполнено), название, под ним тихая мета — только
// статус и срок, справа кнопка плей/стоп. Галочка и кнопка — скруглённые
// квадраты (taskCheckRadius и taskControlRadius). В ленте — ещё плашка
// проекта. Запуск и остановка — жидко: акцент наливается в кнопку и стекает
// (LiquidButton); отметка — так же в галочку, с «попом» и брызгами
// (LiquidCheck). Закреплённая — с булавкой у названия (PinMark).
//
// 12 октября мета сжата до статуса и срока: «закреплена» стала булавкой, версия
// и набранное время ушли на страницу задачи, а вместе с ними по ошибке ушло и
// время идущей задачи («убрать лишний текст», а не сами часы). Часы вернулись:
// пока таймер идёт, они стоят в мете НА МЕСТЕ статуса (RunningClock — свой
// тикер, строка не перерисовывается), срок остаётся.
//
// Отмеченная задача (и та, что только что отмечена галочкой) показывает в мете
// серое «выполнено» вместо цветного статуса (rowStatus в lib/statuses.js).
//
// Отменённая (вид статуса «отменено») — вместо галочки серый крестик того же
// квадрата (LiquidCheck, cancelled): нажатие возвращает её в работу. В мете —
// серое «Отменено», название серое, но не зачёркнутое (зачёркнуто только
// выполненное), срока нет.
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import { LiquidButton, LiquidCheck } from './Liquid';
import PinMark from './PinMark';
import RunningClock from './RunningClock';
import { useAppStore, getProject } from '../store/useAppStore';
import { dueShort, dueState } from '../lib/due';
import { rowStatus, isCancelled } from '../lib/statuses';
import { badgeColors } from '../lib/tags';
import { useColors, useThemeMode, spacing, taskControlRadius, taskCheckRadius } from '../theme';
import { t } from '../lib/i18n';

/**
 * Мета под названием: часы (идёт таймер) или статус, и срок, больше ничего.
 * Срок красный — просрочен, акцентный — в пределах суток, тихий — дальше
 * (тот же код, что у списка проекта и на десктопе). Часы — запись без текста
 * ({ key: 'timer' }): их рисует RunningClock, потому что текст у них меняется
 * каждую секунду.
 * @param done    задача отмечена (в сторе или галочкой, до записи в стор):
 *                статус — серое «выполнено», срока нет
 * @param running по задаче идёт таймер
 */
export function taskRowMeta(task, { statuses, colors, lang, done = !!task.done, running = false }) {
  const meta = [];
  const status = running ? null : rowStatus(statuses, task, done, lang);
  if (running) {
    meta.push({ key: 'timer', color: colors.accentInk, bold: true });
  } else if (status) {
    meta.push({ key: 'status', text: status.name, color: status.done ? colors.textFaint : colors.textDim, dot: status.done ? colors.textFaint : status.color });
  }
  // Закрытая — выполненная или отменённая — срока не показывает.
  const due = done || isCancelled(task, statuses) ? null : dueState(task);
  if (due) meta.push({ key: 'due', text: dueShort(task, lang), color: due === 'overdue' ? colors.danger : due === 'soon' ? colors.accentInk : colors.textFaint, bold: due !== 'later' });
  return meta;
}

/**
 * @param onToggleDone своя обработка галочки: (task, change, closed) — change
 *                     делает правку (отметить или вернуть в работу), closed —
 *                     задача сейчас закрыта (выполнена или отменена), то есть
 *                     нажатие её открывает. Экран решает, когда правка и
 *                     двинется ли строка (useOrderHold: markNow / moveSoon)
 * @param checked      показать галочку, пока в строку ещё приходит задача до
 *                     отметки (экран держит строку на месте, пока налив играет)
 * @param hidePinned   булавка не остаётся у названия, а только втыкается и
 *                     гаснет (в ленте закреплённые — в своём разделе)
 */
export default function TaskRow({ task, onPress, showProject = false, first = false, compact = false, onToggleDone, checked, hidePinned = false }) {
  const colors = useColors();
  const mode = useThemeMode();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const reopenTask = useAppStore((s) => s.reopenTask);

  const running = !!activeTimer && activeTimer.taskId === task.id;
  const project = getProject(projects, task.projectId);
  const done = !!task.done || !!checked;
  const cancelled = isCancelled(task, statuses);
  const meta = taskRowMeta(task, { statuses, colors, lang, done, running });
  // Нажатие на галочку отмечает задачу, на крестик — возвращает в работу.
  const onCheck = () => {
    const change = () => (cancelled ? reopenTask(task.id) : toggleTaskDone(task.id));
    if (onToggleDone) onToggleDone(task, change, !!task.done || cancelled);
    else change();
  };
  // Плашка проекта красится как бейдж тега (lib/tags.js, badgeColors).
  const badge = showProject && project ? badgeColors(project.color || colors.accent, colors.text, mode) : null;

  return (
    <Tap
      onPress={onPress}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, !first && styles.rowBorder, running && styles.rowRunning, pressed && styles.pressed]}
      accessibilityRole="button"
      // Закреплённость — словами для чтения с экрана: на глаз её говорит булавка.
      accessibilityValue={task.pinnedAt ? { text: t(lang, 'tasks.pinned_mark') } : undefined}
    >
      <LiquidCheck
        checked={done}
        cancelled={cancelled}
        kickId={task.id}
        hitSlop={10}
        onPress={onCheck}
        style={styles.circ}
        iconSize={11}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={t(lang, cancelled ? 'task.reopen' : 'task.mark_done')}
      />
      <View style={styles.mid}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, done && styles.titleDone, cancelled && styles.titleCancelled]} numberOfLines={2}>{task.title || t(lang, 'task.no_name')}</Text>
          <PinMark pinnedAt={task.pinnedAt} keep={!hidePinned} style={styles.pin} />
        </View>
        {badge || meta.length ? (
          <View style={styles.meta} testID={`task-meta-${task.id}`}>
            {badge ? (
              <View style={[styles.tag, { backgroundColor: badge.bg }]} testID={`task-project-${task.id}`}>
                <Text style={[styles.tagText, { color: badge.ink }]} numberOfLines={1}>{project.name}</Text>
              </View>
            ) : null}
            {meta.map((m, i) => (
              <View key={m.key} style={styles.metaItem}>
                {i > 0 || badge ? <Text style={styles.metaSep}>·</Text> : null}
                {m.dot ? <View style={[styles.metaDot, { backgroundColor: m.dot }]} testID={`task-dot-${task.id}`} /> : null}
                {m.key === 'timer'
                  ? <RunningClock task={task} activeTimer={activeTimer} style={[styles.metaText, styles.metaClock, { color: m.color }, m.bold && styles.metaBold]} testID={`task-clock-${task.id}`} />
                  : <Text style={[styles.metaText, { color: m.color }, m.bold && styles.metaBold]} numberOfLines={1}>{m.text}</Text>}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <LiquidButton
        on={running}
        kickId={task.id}
        hitSlop={8}
        onPress={() => (running ? stopTimer() : startTimer(task.id))}
        style={styles.play}
        iconSize={12}
        accessibilityRole="button"
        accessibilityLabel={t(lang, running ? 'timer.stop' : 'timer.start')}
      />
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: 10, paddingHorizontal: spacing.md },
  rowCompact: { minHeight: 60 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowRunning: { backgroundColor: colors.accentMuted },
  pressed: { opacity: 0.75 },
  // Не отмечена — рамка; отмеченную наливает акцентом LiquidCheck.
  circ: { width: 24, height: 24, borderRadius: taskCheckRadius, borderWidth: 2, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  // Булавка — сразу за названием, по первой строке.
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  title: { flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  pin: { marginTop: 4 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  // Отменённая — серое название без зачёркивания: так она не похожа на выполненную.
  titleCancelled: { color: colors.textFaint },
  meta: { flexDirection: 'row', alignItems: 'center', columnGap: 5, rowGap: 3, marginTop: 4, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  metaSep: { color: colors.textFaint, fontSize: 12 },
  metaDot: { width: 7, height: 7, borderRadius: 3 },
  metaText: { fontSize: 12, flexShrink: 1 },
  metaBold: { fontWeight: '600' },
  // Цифры одной ширины: часы тикают, и строка не должна подрагивать.
  metaClock: { fontVariant: ['tabular-nums'] },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, maxWidth: 140 },
  tagText: { fontSize: 11, fontWeight: '700' },
  // Стоит — panel2; идёт — налит акцентом (это рисует LiquidButton).
  play: { width: 38, height: 38, borderRadius: taskControlRadius, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
});

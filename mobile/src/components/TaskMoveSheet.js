// Что можно сделать с карточкой доски, не открывая задачу: переложить в
// другой статус и включить/выключить таймер.
//
// Отдельный лист, а не PickerSheet, по двум причинам: у статусов есть цвет,
// и он тут не украшение — по нему колонки и узнают; и рядом с выбором стоит
// действие таймера, которого у выбора одного из списка быть не может.
import { View, StyleSheet } from 'react-native';
import ChoiceList from './ChoiceList';
import { Block } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import { orderedStatuses } from '../lib/statuses';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing } from '../theme';
import { t } from '../lib/i18n';

export default function TaskMoveSheet({ taskId }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const task = useAppStore((s) => s.tasks.find((t2) => t2.id === taskId));
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const lang = useAppStore((s) => s.settings.lang);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  // Название задачи — заголовок в общей шапке листа (в одну строку).
  useSheetHeader(task ? (task.title || t(lang, 'task.no_name')) : '');

  // Задачу могли удалить с другого устройства, пока лист открыт.
  if (!task) return null;

  const running = !!activeTimer && activeTimer.taskId === task.id;
  const columns = orderedStatuses(statuses, task.projectId);

  return (
    <View style={styles.wrap}>
      <Block label={t(lang, 'board.move_to')}>
        <ChoiceList
          options={columns.map((st) => ({ value: st.id, label: st.name, color: st.color }))}
          value={task.statusId}
          onSelect={(id) => { setTaskStatus(task.id, id); closeSheet(); }}
          testID="move-list"
        />
      </Block>

      {/* Таймер — действие, а не выбор: своим списком из одной строки ниже. */}
      <ChoiceList
        options={[{
          value: 'timer',
          label: t(lang, running ? 'timer.stop' : 'timer.start'),
          icon: running ? 'pause' : 'play',
          iconColor: running ? colors.danger : colors.accentInk,
        }]}
        onSelect={() => { if (running) stopTimer(); else startTimer(task.id); closeSheet(); }}
        style={styles.timer}
        testID="move-timer"
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  timer: { marginTop: spacing.sm },
});

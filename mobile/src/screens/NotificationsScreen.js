// Вкладка «Уведомления»: та же лента, что была нижним листом, — просроченные
// дедлайны, ближайшие и сработавшие напоминания. Своей вкладкой она на виду:
// бейдж на вкладке считается из тех же задач (lib/due.js), отдельного
// хранилища у ленты нет; прочитанным всё становится, когда вкладку открыли.
import { useEffect } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandRow } from '../components/Island';
import EmptyState from '../components/EmptyState';
import { useAppStore, getProject } from '../store/useAppStore';
import { notificationFeed, dueShort } from '../lib/due';
import { fmtWhen } from '../lib/format';
import { rangeText } from '../lib/slotText';
import { reminderLabel } from '../lib/reminderText';
import Reminders from '../core/reminders.js';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, screenPadding, fontSize, gap } from '../theme';
import { t } from '../lib/i18n';
import { pushTask } from '../navigation/openTask';

export default function NotificationsScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets, useBottomClearance());
  const lang = useAppStore((s) => s.settings.lang);
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const markNotifSeen = useAppStore((s) => s.markNotifSeen);
  const openProject = useAppStore((s) => s.openProject);
  const focused = useIsFocused();

  const feed = notificationFeed(tasks, seenAt);
  const overdue = feed.filter((n) => n.kind === 'overdue').length;

  // Открыли вкладку — всё прочитано. Не при каждом рендере: иначе новое
  // уведомление, пришедшее, пока вкладка открыта, не успело бы побыть
  // непрочитанным.
  useEffect(() => { if (focused) markNotifSeen(); }, [focused]);

  function onOpen(task) {
    openProject(task.projectId);
    pushTask(navigation, task.id);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={[{ key: 'feed' }]}
        keyExtractor={(x) => x.key}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <Island>
            <IslandHead
              title={t(lang, 'notif.due_title')}
              note={overdue ? t(lang, 'home.overdue_n', { n: overdue }) : ''}
            />
            {/* Лента пуста — без кнопки: срок ставят в задаче, а не здесь. */}
            {feed.length === 0 ? <EmptyState art="bell" title={t(lang, 'notif.empty')} text={t(lang, 'empty.notif_text')} /> : null}
            {feed.map((n, i) => {
              const project = getProject(projects, n.task.projectId);
              // Подпись под названием у напоминания — оно само словами («За 15
              // мин до начала», «Каждый день в 09:00»), у дедлайна — «Просрочена»
              // и «Скоро дедлайн». «Один раз» — просто «Напоминание»: его время
              // и так справа.
              const found = n.reminderId ? Reminders.remindersOf(n.task).find((r) => r.id === n.reminderId) : null;
              const rem = found && found.kind !== 'at' ? found : null;
              // Справа: у вхождения «времени работы» — его часы, у напоминания
              // без дедлайна — когда сработало, у дедлайнов — срок, как и было.
              const when = n.kind === 'slot' ? rangeText(n.due, n.end)
                : n.due === null ? fmtWhen(new Date(n.at).toISOString(), lang)
                  : dueShort(n.task, lang);
              return (
                <IslandRow key={n.key} first={i === 0} onPress={() => onOpen(n.task)}>
                  <View style={styles.main}>
                    <Text style={styles.name} numberOfLines={1}>{n.task.title || t(lang, 'task.no_name')}</Text>
                    <View style={styles.subRow}>
                      <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
                      <Text style={styles.sub} numberOfLines={1}>
                        {`${project ? project.name : ''} · ${rem ? reminderLabel(rem, lang) : t(lang, `notif.${n.kind}`)}`}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.when, n.kind === 'overdue' && styles.whenOverdue, n.unread && styles.whenUnread]}>
                    {when}
                  </Text>
                  <Icon name="chevron-right" size={13} color={colors.textFaint} />
                </IslandRow>
              );
            })}
          </Island>
        )}
      />
    </View>
  );
}

const makeStyles = (colors, insets, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Сверху 4: шапка стека ниже шапки вкладки на столько (AppHeader — 48, вкладка — 52).
  content: { paddingHorizontal: screenPadding, paddingTop: spacing.xs, paddingBottom: insets.bottom + clearance, gap },
  main: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 2 },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
  when: { color: colors.textDim, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  whenOverdue: { color: colors.danger },
  whenUnread: { fontWeight: '700' },
});

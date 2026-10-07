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
import Island, { IslandHead, IslandRow, IslandEmpty } from '../components/Island';
import { useAppStore, getProject } from '../store/useAppStore';
import { notificationFeed, dueShort } from '../lib/due';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, typography, gap } from '../theme';
import { t } from '../lib/i18n';

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
    navigation.navigate('TaskDetail', { taskId: task.id });
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageHead}>
        <Text style={styles.pageTitle}>{t(lang, 'notif.title')}</Text>
      </View>
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
            {feed.length === 0 ? <IslandEmpty>{t(lang, 'notif.empty')}</IslandEmpty> : null}
            {feed.map((n, i) => {
              const project = getProject(projects, n.task.projectId);
              return (
                <IslandRow key={`${n.task.id}-${n.kind}`} first={i === 0} onPress={() => onOpen(n.task)}>
                  <View style={styles.main}>
                    <Text style={styles.name} numberOfLines={1}>{n.task.title || t(lang, 'task.no_name')}</Text>
                    <View style={styles.subRow}>
                      <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
                      <Text style={styles.sub} numberOfLines={1}>
                        {`${project ? project.name : ''} · ${t(lang, `notif.${n.kind}`)}`}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.when, n.kind === 'overdue' && styles.whenOverdue, n.unread && styles.whenUnread]}>
                    {dueShort(n.task, lang)}
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
  pageHead: { paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg + spacing.xs, paddingBottom: spacing.sm },
  pageTitle: { ...typography.title, color: colors.text },
  content: { paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + clearance, gap },
  main: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 2 },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
  when: { color: colors.textDim, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  whenOverdue: { color: colors.danger },
  whenUnread: { fontWeight: '700' },
  radiusFix: { borderRadius: radius.md },
});

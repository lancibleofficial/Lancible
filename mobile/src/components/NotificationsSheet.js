import { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useAppStore, getProject } from '../store/useAppStore';
import { notificationFeed, dueShort } from '../lib/due';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Лента уведомлений. Открытие листа само отмечает всё прочитанным — как на
// десктопе: отдельная кнопка «прочитано» там есть, но здесь лист и так
// закрывается жестом, и лишний элемент управления в нём только мешал бы.
// navigation приходит пропом, а не из useNavigation(): лист рендерится в
// BottomSheet, который в App.js стоит РЯДОМ с NavigationContainer, а не
// внутри него, поэтому навигационного контекста здесь нет. Кнопка, которая
// открывает лист, живёт в шапке — то есть внутри навигатора — и передаёт
// свой объект сюда.
export default function NotificationsSheet({ navigation }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const markNotifSeen = useAppStore((s) => s.markNotifSeen);
  const openProject = useAppStore((s) => s.openProject);

  const feed = notificationFeed(tasks, seenAt);

  useEffect(() => { markNotifSeen(); }, []);

  function onOpen(task) {
    closeSheet();
    openProject(task.projectId);
    navigation.navigate('Home', { screen: 'Project', params: { projectId: task.projectId } });
    navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId: task.id } });
  }

  return (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
      <Text style={styles.title}>{t(lang, 'notif.title')}</Text>
      {feed.length === 0 ? <Text style={styles.empty}>{t(lang, 'notif.empty')}</Text> : null}
      {feed.map((n) => {
        const project = getProject(projects, n.task.projectId);
        return (
          <Pressable key={n.task.id} onPress={() => onOpen(n.task)} style={[styles.row, n.unread && styles.rowUnread]}>
            <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
            <View style={styles.main}>
              <Text style={styles.name} numberOfLines={1}>{n.task.title || t(lang, 'task.no_name')}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {`${t(lang, `notif.${n.kind}`)} · ${project ? project.name : ''}`}
              </Text>
            </View>
            <View style={[styles.when, n.kind === 'overdue' && styles.whenOverdue, n.kind === 'soon' && styles.whenSoon]}>
              <Text style={[styles.whenText, n.kind === 'overdue' && styles.whenTextOverdue, n.kind === 'soon' && styles.whenTextSoon]}>
                {dueShort(n.task, lang)}
              </Text>
            </View>
            <Icon name="chevron-right" size={13} color={colors.textDim} />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.xs },
  empty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowUnread: { backgroundColor: colors.accentMuted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  main: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sub: { color: colors.textDim, fontSize: fontSize.xs },
  when: { backgroundColor: colors.panel, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  whenOverdue: { backgroundColor: 'rgba(255,92,80,0.18)' },
  whenSoon: { backgroundColor: colors.accentMuted },
  whenText: { color: colors.textDim, fontSize: 11 },
  whenTextOverdue: { color: colors.danger },
  whenTextSoon: { color: colors.accentHover },
});

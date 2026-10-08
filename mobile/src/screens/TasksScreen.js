// «Задачи» — лента по срочности из всех проектов (макет B2): Сейчас ·
// Сегодня · Завтра · На неделе · Позже · Без срока. Чипы проектов сверху
// отбирают, поле под ними заводит задачу в выбранный проект, свайп строки
// справа налево закрепляет. Группы считает lib/inbox.js.
import { useMemo, useState } from 'react';
import { View, ScrollView, FlatList, StyleSheet } from 'react-native';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import Island, { IslandEmpty } from '../components/Island';
import TaskRow from '../components/TaskRow';
import SwipeRow from '../components/SwipeRow';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import PickerSheet from '../components/PickerSheet';
import { useAppStore, tasksOf } from '../store/useAppStore';
import { inboxGroups } from '../lib/inbox';
import { defaultStatusId } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { openSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius } from '../theme';
import { t } from '../lib/i18n';

const GROUP_KEY = { now: 'tasks.now', today: 'tasks.today', tomorrow: 'tasks.tomorrow', week: 'tasks.week', later: 'tasks.later', nodue: 'tasks.nodue', done: 'tasks.done_group' };

export default function TasksScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = useMemo(() => makeStyles(colors, clearance), [colors, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const lang = useAppStore((s) => s.settings.lang);
  const quickAddProjectId = useAppStore((s) => s.ui.quickAddProjectId);
  const setQuickAddProject = useAppStore((s) => s.setQuickAddProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  useTicker(!!activeTimer);

  const [filter, setFilter] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState('');

  const shown = useMemo(() => (filter === 'all' ? tasks : tasksOf(tasks, filter)), [tasks, filter]);
  const groups = useMemo(
    () => inboxGroups(shown, { now: Date.now(), activeTimer, showDone }),
    [shown, activeTimer, showDone],
  );
  const openCount = shown.filter((task) => !task.done).length;
  // Лента — один виртуальный список: заголовки групп и строки подряд. Сто
  // семьдесят строк разом, каждая со своим жестом, монтировались секундами
  // и тормозили переход на вкладку; список рисует только видимое.
  const items = useMemo(() => {
    const out = [];
    for (const g of groups) {
      out.push({ type: 'head', key: `h-${g.key}`, group: g.key });
      g.tasks.forEach((task, i) => out.push({ type: 'task', key: task.id, task, first: i === 0 }));
    }
    return out;
  }, [groups]);

  // Проект новой задачи: отобранный, иначе тот, куда заводили прошлую,
  // иначе первый.
  const targetProject = projects.find((p) => p.id === filter)
    || projects.find((p) => p.id === quickAddProjectId)
    || projects[0] || null;

  function submit() {
    const title = draft.trim();
    if (!title || !targetProject) return;
    createTaskInStatus(targetProject.id, defaultStatusId(statuses, targetProject.id, false), null, title);
    setQuickAddProject(targetProject.id);
    setDraft('');
  }

  function pickTargetProject() {
    openSheet(
      <PickerSheet
        title={t(lang, 'board.pick_project')}
        value={targetProject ? targetProject.id : null}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        onSelect={(id) => setQuickAddProject(id)}
      />,
    );
  }

  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.tasks')} count={openCount || null}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} />
        <NotificationsButton navigation={navigation} />
      </TabHeader>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <Tap onPress={() => setFilter('all')} style={[styles.chip, filter === 'all' && styles.chipOn]}>
          <Text style={[styles.chipText, filter === 'all' && styles.chipTextOn]}>{t(lang, 'filter.all')}</Text>
        </Tap>
        {projects.map((p) => {
          const n = tasksOf(tasks, p.id).filter((task) => !task.done).length;
          return (
            <Tap key={p.id} onPress={() => setFilter(p.id)} style={[styles.chip, filter === p.id && styles.chipOn]}>
              <View style={[styles.dot, { backgroundColor: p.color }]} />
              <Text style={[styles.chipText, filter === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
              {n ? <Text style={styles.chipCount}>{n}</Text> : null}
            </Tap>
          );
        })}
        <Tap onPress={() => setShowDone((v) => !v)} style={[styles.chip, showDone && styles.chipOn]} accessibilityRole="switch" accessibilityState={{ checked: showDone }} accessibilityLabel={t(lang, 'tasks.show_done')}>
          <Icon name="list-check" size={15} color={showDone ? colors.text : colors.textDim} />
        </Tap>
      </ScrollView>

      <View style={styles.qa}>
        <Icon name="plus" size={14} color={colors.textFaint} />
        <TextInput
          style={styles.qaInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={t(lang, 'tasks.new_ph')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          editable={!!targetProject}
          accessibilityLabel={t(lang, 'tasks.new_ph')}
        />
        {targetProject ? (
          <Tap onPress={pickTargetProject} style={styles.qaProject} hitSlop={6} accessibilityLabel={t(lang, 'board.pick_project')}>
            <View style={[styles.dot, { backgroundColor: targetProject.color }]} />
            <Text style={styles.qaProjectText} numberOfLines={1}>{targetProject.name}</Text>
            <Icon name="chevron-down" size={10} color={colors.textFaint} />
          </Tap>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={<Island><IslandEmpty>{t(lang, 'tasks.empty')}</IslandEmpty></Island>}
        renderItem={({ item, index }) => {
          const last = index === items.length - 1;
          if (item.type === 'head') {
            return (
              <View style={[styles.item, index === 0 && styles.itemTop, last && styles.itemBottom]}>
                <Text style={[styles.group, item.group === 'now' && styles.groupNow]}>{t(lang, GROUP_KEY[item.group])}</Text>
              </View>
            );
          }
          const { task } = item;
          return (
            <View style={[styles.item, last && styles.itemBottom]}>
              <SwipeRow label={t(lang, task.pinnedAt ? 'pin.unpin' : 'pin.pin')} onAction={() => togglePinTask(task.id)}>
                <View style={styles.rowBg}>
                  <TaskRow task={task} first={item.first} showProject={filter === 'all'} onPress={() => openTask(task.id)} />
                </View>
              </SwipeRow>
            </View>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Горизонтальная прокрутка на Android не растит высоту под нижний отступ
  // содержимого — воздух до поля задачи держит сама полоса.
  chipsBar: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.md },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.panel },
  chipOn: { backgroundColor: colors.raise },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '500', maxWidth: 120 },
  chipTextOn: { color: colors.text, fontWeight: '600' },
  chipCount: { color: colors.textFaint, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm, height: 44, paddingLeft: 10, paddingRight: 6, borderRadius: 13, backgroundColor: colors.panel },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaProject: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.panel2, maxWidth: 130 },
  qaProjectText: { color: colors.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: clearance },
  // Остров ленты собран из элементов списка: фон у каждого, скругления —
  // у первого и последнего.
  item: { backgroundColor: colors.panel, overflow: 'hidden' },
  itemTop: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  itemBottom: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 3 },
  groupNow: { color: colors.accentInk },
  rowBg: { backgroundColor: colors.panel },
});

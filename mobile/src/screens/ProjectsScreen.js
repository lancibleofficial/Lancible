// «Проекты» — колода (макет B2): проекты листаются вбок карточками, в
// карточке — итоги, поле новой задачи и первые задачи. Перед первой
// карточкой стоит карточка «+»: тянешь первую вправо — она выезжает слева,
// отпустил на ней — открывается лист создания проекта.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import TaskRow from '../components/TaskRow';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import NewProjectSheet from '../components/NewProjectSheet';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney } from '../lib/format';
import { dueShort } from '../lib/due';
import { defaultStatusId } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

// Край следующей карточки виден: по нему понятно, что колода продолжается.
const PEEK = 58;
const GAP = 10;
const ROWS = 6;

/** Порядок задач в карточке: идущая, закреплённые, невыполненные по
 *  дедлайну и свежести; выполненные не показываются. */
export function cardTasks(tasks, activeTimer) {
  const dueMs = (task) => (task.dueAt ? new Date(task.dueAt).getTime() : Infinity);
  const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  const rank = (task) => (activeTimer && activeTimer.taskId === task.id ? 0 : task.pinnedAt ? 1 : 2);
  return tasks.filter((task) => !task.done)
    .sort((a, b) => rank(a) - rank(b) || dueMs(a) - dueMs(b) || updMs(b) - updMs(a));
}

export default function ProjectsScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const clearance = useBottomClearance();
  const cardW = width - PEEK;
  const styles = useMemo(() => makeStyles(colors, insets, cardW, clearance), [colors, insets, cardW, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const openProject = useAppStore((s) => s.openProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const startTimer = useAppStore((s) => s.startTimer);
  const rates = useRates();
  const lang = settings.lang;
  useTicker(!!activeTimer);

  const listRef = useRef(null);
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState({});
  const step = cardW + GAP;

  // Закреплённые первыми, как в рейле веба.
  const ordered = useMemo(() => {
    const pinned = projects.filter((p) => p.pinnedAt).sort((a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt));
    return [...pinned, ...projects.filter((p) => !p.pinnedAt)];
  }, [projects]);
  const data = useMemo(() => [{ id: '__new__' }, ...ordered], [ordered]);

  function openProjectScreen(id) { openProject(id); navigation.navigate('Project', { projectId: id }); }
  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });

  const sheetOpen = useRef(false);
  function openNewProject() {
    if (sheetOpen.current) return;
    sheetOpen.current = true;
    const back = () => {
      sheetOpen.current = false;
      closeSheet();
      if (listRef.current && ordered.length) listRef.current.scrollToOffset({ offset: step, animated: true });
    };
    openSheet(
      <NewProjectSheet
        onCancel={back}
        onCreated={(project) => { sheetOpen.current = false; closeSheet(); openProjectScreen(project.id); }}
      />,
    );
  }

  // Остановились на карточке «+» — открываем лист. Создание — это и есть
  // то, зачем на неё тянут; второй тап был бы лишним.
  const onMomentumEnd = useCallback((e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / step);
    setPage(index);
    if (index === 0 && ordered.length) openNewProject();
  }, [step, ordered.length]);

  function submitDraft(project, start) {
    const title = (drafts[project.id] || '').trim();
    if (!title) return;
    const task = createTaskInStatus(project.id, defaultStatusId(statuses, project.id, false), null, title);
    setDrafts((d) => ({ ...d, [project.id]: '' }));
    if (start) startTimer(task.id);
  }

  const renderCard = ({ item: project }) => {
    if (project.id === '__new__') {
      return (
        <Pressable style={[styles.card, styles.newCard]} onPress={openNewProject} accessibilityRole="button" accessibilityLabel={t(lang, 'deck.new_project')}>
          <View style={styles.plus}><Icon name="plus" size={28} color={colors.text} /></View>
          {ordered.length === 0 ? <Text style={styles.newHint}>{t(lang, 'deck.new_hint')}</Text> : null}
        </Pressable>
      );
    }
    const own = tasksOf(tasks, project.id);
    const done = own.filter((task) => task.done).length;
    const active = own.filter((task) => !task.done && task.statusId && statuses.some((st) => st.id === task.statusId && st.kind === 'progress')).length;
    const list = cardTasks(own, activeTimer);
    const nextDue = own.filter((task) => !task.done && task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
    const pct = own.length ? Math.round((done / own.length) * 100) : 0;
    const sub = [
      t(lang, 'deck.tasks_summary', { n: own.length, active }),
      nextDue ? t(lang, 'deck.deadline', { when: dueShort(nextDue, lang) }) : null,
      project.rate ? t(lang, 'deck.own_rate', { rate: `${fmtMoney(project.rate, lang, currencyOf(project, settings))}${t(lang, 'rate.per_hour')}` }) : null,
    ].filter(Boolean).join(' · ');
    return (
      <View style={styles.card}>
        <Pressable style={styles.cardHead} onPress={() => openProjectScreen(project.id)} accessibilityRole="button">
          <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
          </View>
          <Icon name="chevron-right" size={14} color={colors.textFaint} />
        </Pressable>
        <View style={styles.kpis}>
          <Text style={styles.kpiTime}>{fmtDur(projectMs(tasks, project.id, activeTimer), lang)}</Text>
          <Text style={styles.kpiMoney}>{fmtMoney(projectMoney(tasks, project.id, rates, activeTimer), lang, currencyOf(project, settings))}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.kpiDone}>{t(lang, 'deck.done_of', { done, total: own.length })}</Text>
        </View>
        <View style={styles.bar}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: project.color || colors.accent }]} /></View>

        <View style={styles.qa}>
          <Icon name="plus" size={14} color={colors.textFaint} />
          <TextInput
            style={styles.qaInput}
            value={drafts[project.id] || ''}
            onChangeText={(v) => setDrafts((d) => ({ ...d, [project.id]: v }))}
            placeholder={t(lang, 'tasks.new_ph')}
            placeholderTextColor={colors.textFaint}
            returnKeyType="done"
            onSubmitEditing={() => submitDraft(project, false)}
            accessibilityLabel={t(lang, 'tasks.new_ph')}
          />
          <Pressable hitSlop={6} onPress={() => submitDraft(project, true)} style={styles.qaGo} accessibilityRole="button" accessibilityLabel={t(lang, 'agenda.create_btn')}>
            <Icon name="play" size={11} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.rows}>
          {list.length === 0 ? <Text style={styles.empty}>{t(lang, 'deck.no_tasks')}</Text> : null}
          {list.slice(0, ROWS).map((task, i) => (
            <TaskRow key={task.id} task={task} first={i === 0} compact onPress={() => openTask(task.id)} />
          ))}
          <Pressable style={styles.more} onPress={() => openProjectScreen(project.id)} accessibilityRole="button">
            <Text style={styles.moreText} numberOfLines={1}>
              {done || list.length > ROWS ? t(lang, 'deck.more', { n: done + Math.max(0, list.length - ROWS) }) : t(lang, 'deck.open')}
            </Text>
            <Icon name="chevron-right" size={12} color={colors.textFaint} />
          </Pressable>
        </View>
      </View>
    );
  };

  // На первой карточке проекта, а не на «+», при каждом заходе.
  useEffect(() => {
    if (!listRef.current || !ordered.length) return;
    const id = setTimeout(() => listRef.current && listRef.current.scrollToOffset({ offset: step, animated: false }), 0);
    return () => clearTimeout(id);
  }, [step, ordered.length > 0]);

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.projects')} count={ordered.length || null}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} />
        <NotificationsButton navigation={navigation} />
      </TabHeader>

      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(p) => p.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={styles.deck}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        getItemLayout={(_, index) => ({ length: step, offset: step * index, index })}
        initialScrollIndex={ordered.length ? 1 : 0}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={renderCard}
        keyboardShouldPersistTaps="handled"
      />

      {ordered.length > 1 ? (
        <View style={styles.dots}>
          {ordered.map((p, i) => <View key={p.id} style={[styles.dotI, page === i + 1 && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors, insets, cardW, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  deck: { paddingHorizontal: spacing.lg, paddingTop: 2, paddingBottom: spacing.sm },
  card: { width: cardW, backgroundColor: colors.panel, borderRadius: 18, overflow: 'hidden', alignSelf: 'stretch' },
  newCard: { backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', gap: spacing.md, minHeight: 320 },
  plus: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  newHint: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: spacing.md, paddingBottom: 6 },
  dot: { width: 11, height: 11, borderRadius: 4 },
  name: { color: colors.text, fontSize: 17, fontFamily: displayFamily.bold },
  sub: { color: colors.textFaint, fontSize: 11.5, marginTop: 1 },
  kpis: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  kpiTime: { color: colors.text, fontSize: 19, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  kpiMoney: { color: colors.textDim, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  kpiDone: { color: colors.textFaint, fontSize: 11.5 },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.panel2, marginHorizontal: spacing.md, marginBottom: spacing.sm + 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 10, height: 42, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  rows: { marginTop: 6, flex: 1 },
  empty: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing.lg },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md },
  moreText: { color: colors.textDim, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingTop: 2, paddingBottom: clearance - spacing.xl },
  dotI: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.raise },
  dotOn: { width: 16, backgroundColor: colors.accent },
});

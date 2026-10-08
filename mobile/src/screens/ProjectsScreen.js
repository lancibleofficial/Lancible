// «Проекты» — колода (макет B2): проекты листаются вбок карточками, карточка
// во всю высоту до точек пагинации, внутри — итоги, поле новой задачи и
// список задач со своей прокруткой.
//
// Идущая задача не прыгает наверх, пока таймер идёт: порядок в карточке
// замораживается на входе на экран (nextPinTop). Остановили — задача
// пружиной уезжает на своё место по свежести; ушли и вернулись — идущая
// уже первая.
//
// Колода едет на своём жесте, а не на прокрутке списка: так у неё настоящие
// пружины. Отпустил — карточка встаёт на место с лёгким перелётом. Слева от
// первой карточки спрятана узкая карточка «+»: тянешь первую вправо — «+»
// выезжает, за порогом заливается акцентом и щёлкает хаптика. Отпустил за
// порогом — открывается лист нового проекта, а колода пружиной
// возвращается на место. Не дотянул — просто возвращается.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, Extrapolation, runOnJS, LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import TaskRow from '../components/TaskRow';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import NewProjectSheet from '../components/NewProjectSheet';
import { rubberBand } from '../components/SwipeRow';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney } from '../lib/format';
import { dueShort } from '../lib/due';
import { defaultStatusId } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

// Край следующей карточки виден: по нему понятно, что колода продолжается.
const PEEK = 40;
const GAP = 10;
const PLUS_W = 84;
// Карточка «+» уходит далеко влево: её левого края не видно, сколько ни тяни.
const PLUS_TAIL = 600;
/** Насколько вытянуть «+», чтобы отпускание создало проект. */
export const PULL_TRIGGER = 70;
// Пружина колоды: быстрая, с небольшим перелётом.
const SNAP = { damping: 19, stiffness: 190, mass: 0.9 };

/** Порядок задач в карточке: идущая, закреплённые, невыполненные по
 *  дедлайну и свежести; выполненные не показываются. */
export function cardTasks(tasks, activeTimer) {
  const dueMs = (task) => (task.dueAt ? new Date(task.dueAt).getTime() : Infinity);
  const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  const rank = (task) => (activeTimer && activeTimer.taskId === task.id ? 0 : task.pinnedAt ? 1 : 2);
  return tasks.filter((task) => !task.done)
    .sort((a, b) => rank(a) - rank(b) || dueMs(a) - dueMs(b) || updMs(b) - updMs(a));
}

/** Какая задача стоит в карточках первой как идущая. Берётся на входе на
 *  экран и держится, пока её таймер идёт; остановили или запустили
 *  другую — первой не стоит никто (новая идущая не прыгает наверх до
 *  следующего входа). */
export function nextPinTop(pinTop, activeTimer) {
  if (!pinTop) return null;
  return activeTimer && activeTimer.taskId === pinTop ? pinTop : null;
}

/** Куда встать колоде после отпускания: по положению с поправкой на
 *  скорость, не дальше соседней с той, с которой начали, и в пределах
 *  колоды. x — сдвиг полосы (страница p стоит при x = -p·step). */
export function deckTarget(x, vx, step, fromPage, count) {
  'worklet';
  const projected = Math.round(-(x + vx * 0.12) / step);
  const near = Math.max(fromPage - 1, Math.min(fromPage + 1, projected));
  return Math.max(0, Math.min(count - 1, near));
}

export default function ProjectsScreen({ navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const cardW = width - spacing.lg - PEEK;
  const step = cardW + GAP;
  const styles = useMemo(() => makeStyles(colors, cardW), [colors, cardW]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const openProject = useAppStore((s) => s.openProject);
  const lang = useAppStore((s) => s.settings.lang);
  useTicker(!!activeTimer);

  // Закреплённые первыми, как в рейле веба.
  const ordered = useMemo(() => {
    const pinned = projects.filter((p) => p.pinnedAt).sort((a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt));
    return [...pinned, ...projects.filter((p) => !p.pinnedAt)];
  }, [projects]);
  const count = ordered.length;

  const [page, setPage] = useState(0);
  const [pinTop, setPinTop] = useState(() => (activeTimer ? activeTimer.taskId : null));
  // Вход на экран (и возврат с задачи или другой вкладки) — идущая первой.
  useEffect(() => {
    if (!navigation.addListener) return undefined;
    return navigation.addListener('focus', () => {
      const timer = useAppStore.getState().activeTimer;
      setPinTop(timer ? timer.taskId : null);
    });
  }, [navigation]);
  // Пока экран открыт: остановили — задача уезжает на своё место.
  useEffect(() => { setPinTop((p) => nextPinTop(p, activeTimer)); }, [activeTimer ? activeTimer.taskId : null]);
  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const startPage = useSharedValue(0);
  const pageSV = useSharedValue(0);
  const armed = useSharedValue(0);

  // Проект удалили — колода не должна стоять за последней карточкой.
  useEffect(() => {
    if (count && page > count - 1) {
      const p = count - 1;
      pageSV.value = p;
      setPage(p);
      x.value = withSpring(-p * step, SNAP);
    }
  }, [count]);
  // Поменялась ширина (поворот) — встать ровно на свою страницу.
  useEffect(() => { x.value = -pageSV.value * step; }, [step]);

  function openProjectScreen(id) { openProject(id); navigation.navigate('Project', { projectId: id }); }
  const openTask = useCallback((taskId) => navigation.navigate('TaskDetail', { taskId }), [navigation]);

  // Без защёлки «лист уже открыт»: лист закрывают и мимо onCancel (тап по
  // подложке, свайп вниз), и защёлка оставалась взведённой — после первой
  // отмены рывок больше ничего не открывал.
  const openNewProject = useCallback(() => {
    const done = () => closeSheet();
    openSheet(
      <NewProjectSheet
        onCancel={done}
        onCreated={(project) => { done(); openProjectScreen(project.id); }}
      />,
    );
  }, []);
  const buzz = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, []);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => { startX.value = x.value; startPage.value = pageSV.value; })
    .onUpdate((e) => {
      const minX = -Math.max(0, count - 1) * step;
      let nx = startX.value + e.translationX;
      if (nx > 0) nx = rubberBand(nx * 0.8, PULL_TRIGGER * 1.25);
      else if (nx < minX) nx = minX - (minX - nx) * 0.3;
      x.value = nx;
      const on = nx >= PULL_TRIGGER ? 1 : 0;
      if (on !== armed.value) { armed.value = on; runOnJS(buzz)(); }
    })
    .onEnd((e) => {
      const fire = armed.value === 1;
      armed.value = 0;
      const target = fire ? 0 : deckTarget(x.value, e.velocityX, step, startPage.value, Math.max(1, count));
      pageSV.value = target;
      x.value = withSpring(-target * step, { ...SNAP, velocity: e.velocityX });
      runOnJS(setPage)(target);
      if (fire) runOnJS(openNewProject)();
    });

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const plusFill = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 120 }) }));
  const plusIcon = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(armed.value ? 1.15 : interpolate(x.value, [0, PULL_TRIGGER], [0.7, 1], Extrapolation.CLAMP), { damping: 11, stiffness: 300 }) },
      { rotate: `${interpolate(x.value, [0, PULL_TRIGGER], [-90, 0], Extrapolation.CLAMP)}deg` },
    ],
  }));

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.projects')} count={count || null}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} />
        <NotificationsButton navigation={navigation} />
      </TabHeader>

      {count === 0 ? (
        <View style={styles.emptyWrap}>
          <Tap style={[styles.card, styles.emptyCard]} onPress={openNewProject} accessibilityRole="button" accessibilityLabel={t(lang, 'deck.new_project')}>
            <View style={styles.plusBig}><Icon name="plus" size={28} color={colors.text} /></View>
            <Text style={styles.newHint}>{t(lang, 'deck.new_hint')}</Text>
          </Tap>
        </View>
      ) : (
        <GestureDetector gesture={pan}>
          <View style={styles.deck} collapsable={false}>
            <Animated.View style={[styles.strip, stripStyle]}>
              <View style={styles.plusCard} accessibilityLabel={t(lang, 'deck.new_project')}>
                <Animated.View style={[StyleSheet.absoluteFill, styles.plusOn, plusFill]} />
                <View style={styles.plusBody}>
                  <Animated.View style={plusIcon}>
                    <Icon name="plus" size={26} color={colors.text} />
                    <Animated.View style={[styles.plusOver, plusFill]}><Icon name="plus" size={26} color={colors.accentText} /></Animated.View>
                  </Animated.View>
                  <View>
                    <Text style={styles.plusText} numberOfLines={2}>{t(lang, 'deck.new_project')}</Text>
                    <Animated.View style={[styles.plusOver, plusFill]}>
                      <Text style={[styles.plusText, { color: colors.accentText }]} numberOfLines={2}>{t(lang, 'deck.new_project')}</Text>
                    </Animated.View>
                  </View>
                </View>
              </View>
              {ordered.map((project, i) => (Math.abs(i - page) <= 1 ? (
                <ProjectCard
                  key={project.id}
                  project={project}
                  pinTop={pinTop}
                  styles={styles}
                  onOpen={() => openProjectScreen(project.id)}
                  onOpenTask={openTask}
                />
              ) : <View key={project.id} style={styles.slot} />))}
            </Animated.View>
          </View>
        </GestureDetector>
      )}

      {count > 0 ? (
        <View style={styles.dots}>
          {ordered.map((p, i) => <View key={p.id} style={[styles.dotI, page === i && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

/** Карточка проекта: шапка, числа, поле новой задачи, задачи со своей
 *  прокруткой, внизу — переход на страницу проекта. */
function ProjectCard({ project, pinTop, styles, onOpen, onOpenTask }) {
  const colors = useColors();
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const rates = useRates();
  const lang = settings.lang;
  const [draft, setDraft] = useState('');
  // Остановленная задача на время переезда наверх — поверх соседей: без
  // этого строки на пересечении просвечивали друг сквозь друга.
  const [rising, setRising] = useState(null);
  const runningId = activeTimer ? activeTimer.taskId : null;
  const prevRunning = useRef(runningId);
  useEffect(() => {
    const prev = prevRunning.current;
    prevRunning.current = runningId;
    if (!prev || prev === runningId) return undefined;
    setRising(prev);
    const id = setTimeout(() => setRising(null), 900);
    return () => clearTimeout(id);
  }, [runningId]);

  const own = tasksOf(tasks, project.id);
  const done = own.filter((task) => task.done).length;
  const active = own.filter((task) => !task.done && task.statusId && statuses.some((st) => st.id === task.statusId && st.kind === 'progress')).length;
  const list = cardTasks(own, pinTop ? { taskId: pinTop } : null);
  const nextDue = own.filter((task) => !task.done && task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  const pct = own.length ? Math.round((done / own.length) * 100) : 0;
  const sub = [
    t(lang, 'deck.tasks_summary', { n: own.length, active }),
    nextDue ? t(lang, 'deck.deadline', { when: dueShort(nextDue, lang) }) : null,
    project.rate ? t(lang, 'deck.own_rate', { rate: `${fmtMoney(project.rate, lang, currencyOf(project, settings))}${t(lang, 'rate.per_hour')}` }) : null,
  ].filter(Boolean).join(' · ');

  /** Завести задачу и сразу открыть её страницу. */
  function submit() {
    const title = draft.trim();
    if (!title) return;
    const task = createTaskInStatus(project.id, defaultStatusId(statuses, project.id, false), null, title);
    setDraft('');
    onOpenTask(task.id);
  }

  return (
    <View style={styles.card}>
      <Tap style={styles.cardHead} onPress={onOpen} accessibilityRole="button">
        <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
        </View>
        <Icon name="chevron-right" size={14} color={colors.textFaint} />
      </Tap>
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
          value={draft}
          onChangeText={setDraft}
          placeholder={t(lang, 'tasks.new_ph')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel={t(lang, 'tasks.new_ph')}
        />
        <Tap scale={0.92} hitSlop={6} onPress={submit} style={[styles.qaGo, draft.trim() && styles.qaGoOn]} accessibilityRole="button" accessibilityLabel={t(lang, 'agenda.create_btn')}>
          <Text style={[styles.qaGoText, draft.trim() && styles.qaGoTextOn]}>{t(lang, 'agenda.create_btn')}</Text>
        </Tap>
      </View>

      <Animated.FlatList
        style={styles.rows}
        // Остановленная задача уезжает на своё место пружиной.
        itemLayoutAnimation={LinearTransition.springify().damping(18).stiffness(170)}
        CellRendererComponentStyle={({ item }) => ({ backgroundColor: colors.panel, zIndex: item.id === rising ? 2 : 1 })}
        // Прокрутка от gesture-handler: договаривается с жестом колоды.
        renderScrollComponent={(props) => <GHScrollView {...props} />}
        data={list}
        keyExtractor={(task) => task.id}
        renderItem={({ item, index }) => <TaskRow task={item} first={index === 0} compact onPress={() => onOpenTask(item.id)} />}
        ListEmptyComponent={<Text style={styles.empty}>{t(lang, 'deck.no_tasks')}</Text>}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={5}
      />
      <Tap style={styles.more} onPress={onOpen} accessibilityRole="button">
        <Text style={styles.moreText} numberOfLines={1}>{done ? t(lang, 'deck.more', { n: done }) : t(lang, 'deck.open')}</Text>
        <Icon name="chevron-right" size={12} color={colors.textFaint} />
      </Tap>
    </View>
  );
}

const makeStyles = (colors, cardW) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  deck: { flex: 1, paddingTop: 2 },
  strip: { flex: 1, flexDirection: 'row', paddingLeft: spacing.lg },
  slot: { width: cardW, marginRight: GAP },
  card: { width: cardW, marginRight: GAP, backgroundColor: colors.panel, borderRadius: 18, overflow: 'hidden' },
  plusCard: {
    position: 'absolute', top: 0, bottom: 0, left: spacing.lg - GAP - PLUS_W - PLUS_TAIL, width: PLUS_W + PLUS_TAIL,
    borderTopRightRadius: 18, borderBottomRightRadius: 18, backgroundColor: colors.panel2, overflow: 'hidden',
  },
  plusOn: { backgroundColor: colors.accent },
  plusBody: { position: 'absolute', top: 0, bottom: 0, right: 0, width: PLUS_W, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: 6 },
  plusOver: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  plusText: { color: colors.textDim, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  emptyWrap: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  emptyCard: { flex: 1, width: '100%', marginRight: 0, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  plusBig: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
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
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 10, marginBottom: 4, height: 42, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { height: 30, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  qaGoOn: { backgroundColor: colors.accent },
  qaGoText: { color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  qaGoTextOn: { color: colors.accentText },
  rows: { flex: 1 },
  empty: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing.lg },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md },
  moreText: { color: colors.textDim, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, height: 26 },
  dotI: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.raise },
  dotOn: { width: 18, backgroundColor: colors.accent },
});

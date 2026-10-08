// «Проекты» — колода (макет B2): проекты листаются вбок карточками, карточка
// во всю высоту до точек пагинации. В карточке: название, «✓ 3/9» и
// ближайший дедлайн его цветом, теги проекта, часы и деньги, задачи со
// своей прокруткой, внизу — поле новой задачи и «Перейти в проект».
//
// Порядок задач — по последнему изменению, свежая сверху. Запущенная задача
// при этом не прыгает: запуск таймера задачу не меняет, а первой идущая
// стоит только на входе на экран (nextPinTop). Остановили — у задачи
// свежая отметка, и она плавно уезжает наверх.
//
// Колода едет на своём жесте, а не на прокрутке списка: так у неё настоящие
// пружины. По краям колоды спрятаны карточки «+», уходящие далеко за край
// экрана: тянешь первую карточку вправо или последнюю влево — «+» выезжает
// на резинке, за порогом заливается акцентом и щёлкает хаптика. Отпустил за
// порогом — лист нового проекта, колода пружиной встаёт на место.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, interpolateColor, Extrapolation, runOnJS,
  LinearTransition, Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import TaskRow from '../components/TaskRow';
import { TagBadgeRow } from '../components/TagBadge';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import NewProjectSheet from '../components/NewProjectSheet';
import { rubberBand } from '../components/SwipeRow';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney } from '../lib/format';
import { dueShort, dueState } from '../lib/due';
import { tagsOf } from '../lib/tags';
import { defaultStatusId } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

// Край следующей карточки виден: по нему понятно, что колода продолжается.
const PEEK = 40;
const GAP = 10;
const PLUS_W = 84;
// Карточки «+» уходят далеко за край экрана: их внешнего края не видно,
// сколько ни тяни.
const PLUS_TAIL = 600;
/** Насколько вытянуть «+», чтобы отпускание создало проект. */
export const PULL_TRIGGER = 70;
// Пружина колоды: быстрая, с небольшим перелётом.
const SNAP = { damping: 19, stiffness: 190, mass: 0.9 };
// Точки пагинации: не больше шести, крайние меньше, если за ними есть ещё.
export const MAX_DOTS = 6;
const DOT_SLOT = 14;
// Переезд задачи наверх — спокойный ease out, без пружины.
const REORDER = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));

/** Порядок задач в карточке: идущая (если её закрепили первой на входе),
 *  дальше — по последнему изменению, свежая сверху; выполненные не
 *  показываются. */
export function cardTasks(tasks, pinTop) {
  const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  const top = pinTop && pinTop.taskId;
  return tasks.filter((task) => !task.done)
    .sort((a, b) => (b.id === top) - (a.id === top) || updMs(b) - updMs(a));
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

/** Окно точек пагинации: с какой точки (дробно) начинается видимая шестёрка
 *  при положении колоды p. Текущая держится посередине окна. */
export function dotsWindow(p, count) {
  'worklet';
  if (count <= MAX_DOTS) return 0;
  return Math.min(count - MAX_DOTS, Math.max(0, p - (MAX_DOTS / 2 - 0.5)));
}

/** Кусочно-линейная по трём точкам, с обрезкой по краям. Своя, а не
 *  interpolate из reanimated: функция чистая и проверяется в Node, где
 *  reanimated подменён пустышками. */
function piecewise(v, x0, x1, x2, y0, y1, y2) {
  'worklet';
  if (v <= x0) return y0;
  if (v >= x2) return y2;
  if (v <= x1) return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  return y1 + ((v - x1) / (x2 - x1)) * (y2 - y1);
}

/** Размер точки i у края окна: у края, за которым есть ещё точки, точка
 *  меньше; уходя за край — исчезает. 1 — полный размер. */
export function dotScale(i, p, count) {
  'worklet';
  if (count <= MAX_DOTS) return 1;
  const rel = i - dotsWindow(p, count);
  let s = 1;
  if (i > 0) s = Math.min(s, piecewise(rel, -1, 0, 1, 0, 0.55, 1));
  if (i < count - 1) s = Math.min(s, piecewise(rel, MAX_DOTS - 2, MAX_DOTS - 1, MAX_DOTS, 1, 0.55, 0));
  return s;
}

export default function ProjectsScreen({ navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const cardW = width - spacing.lg - PEEK;
  const step = cardW + GAP;
  // На iOS панель вкладок нативная и лежит поверх экрана (на iOS 26 ещё и
  // плавает): без отступа низ карточки и точки уходили под неё. На Android
  // панель занимает место в раскладке сама.
  const clearance = useBottomClearance();
  const bottomPad = Platform.OS === 'ios' ? clearance : 0;
  const styles = useMemo(() => makeStyles(colors, cardW), [colors, cardW]);
  const projects = useAppStore((s) => s.projects);
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
  const armedL = useSharedValue(0);
  const armedR = useSharedValue(0);

  const goTo = useCallback((p) => {
    pageSV.value = p;
    setPage(p);
    x.value = withSpring(-p * step, SNAP);
  }, [step]);
  // Проект удалили — колода не должна стоять за последней карточкой.
  useEffect(() => { if (count && page > count - 1) goTo(count - 1); }, [count]);
  // Поменялась ширина (поворот) — встать ровно на свою страницу.
  useEffect(() => { x.value = -pageSV.value * step; }, [step]);

  function openProjectScreen(id) { openProject(id); navigation.navigate('Project', { projectId: id }); }
  const openTask = useCallback((taskId) => navigation.navigate('TaskDetail', { taskId }), [navigation]);

  // Без защёлки «лист уже открыт»: лист закрывают и мимо onCancel (тап по
  // подложке, свайп вниз), и защёлка оставалась взведённой — после первой
  // отмены рывок больше ничего не открывал.
  const openNewProject = useCallback(() => {
    openSheet(
      <NewProjectSheet
        onCancel={closeSheet}
        onCreated={(project) => { closeSheet(); openProjectScreen(project.id); }}
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
      else if (nx < minX) nx = minX - rubberBand((minX - nx) * 0.8, PULL_TRIGGER * 1.25);
      x.value = nx;
      const l = nx >= PULL_TRIGGER ? 1 : 0;
      const r = minX - nx >= PULL_TRIGGER ? 1 : 0;
      if (l !== armedL.value) { armedL.value = l; runOnJS(buzz)(); }
      if (r !== armedR.value) { armedR.value = r; runOnJS(buzz)(); }
    })
    .onEnd((e) => {
      const fire = armedL.value === 1 || armedR.value === 1;
      const target = armedL.value === 1 ? 0
        : armedR.value === 1 ? Math.max(0, count - 1)
          : deckTarget(x.value, e.velocityX, step, startPage.value, Math.max(1, count));
      armedL.value = 0;
      armedR.value = 0;
      pageSV.value = target;
      x.value = withSpring(-target * step, { ...SNAP, velocity: e.velocityX });
      runOnJS(setPage)(target);
      if (fire) runOnJS(openNewProject)();
    });

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
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
              <PlusCard side="left" x={x} armed={armedL} count={count} step={step} width={width} styles={styles} lang={lang} />
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
              <PlusCard side="right" x={x} armed={armedR} count={count} step={step} width={width} styles={styles} lang={lang} />
            </Animated.View>
          </View>
        </GestureDetector>
      )}

      {count > 0 ? <Dots x={x} step={step} count={count} onGo={goTo} styles={styles} lang={lang} /> : null}
    </View>
  );
}

/** Карточка «+» на краю колоды. Уходит далеко за край экрана; плюс и
 *  подпись стоят посередине видимой части и едут вместе с ней. За порогом
 *  карточка заливается акцентом, плюс и подпись темнеют. */
function PlusCard({ side, x, armed, count, step, width, styles, lang }) {
  const colors = useColors();
  const left = side === 'left';
  const fill = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 120 }) }));
  const body = useAnimatedStyle(() => {
    // Видимая ширина карточки на экране.
    const w = left ? spacing.lg - GAP + x.value : width - (spacing.lg + count * step + x.value);
    const shift = left ? Math.min(0, (PLUS_W - w) / 2) : Math.max(0, (w - PLUS_W) / 2);
    const pull = left ? x.value : -(count - 1) * step - x.value;
    return {
      opacity: interpolate(pull, [0, PULL_TRIGGER * 0.5], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateX: shift }],
    };
  });
  const icon = useAnimatedStyle(() => {
    const pull = left ? x.value : -(count - 1) * step - x.value;
    return {
      transform: [
        { scale: withSpring(armed.value ? 1.15 : interpolate(pull, [0, PULL_TRIGGER], [0.7, 1], Extrapolation.CLAMP), { damping: 11, stiffness: 300 }) },
        { rotate: `${interpolate(pull, [0, PULL_TRIGGER], [left ? -90 : 90, 0], Extrapolation.CLAMP)}deg` },
      ],
    };
  });
  const label = t(lang, 'deck.new_project');
  return (
    <View
      style={[styles.plusCard, left ? styles.plusLeft : [styles.plusRight, { left: spacing.lg + count * step }]]}
      accessibilityLabel={label}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.plusOn, fill]} />
      <Animated.View style={[styles.plusBody, left ? { right: 0 } : { left: 0 }, body]}>
        <Animated.View style={icon}>
          <Icon name="plus" size={26} color={colors.text} />
          <Animated.View style={[styles.plusOver, fill]}><Icon name="plus" size={26} color={colors.accentText} /></Animated.View>
        </Animated.View>
        <View>
          <Text style={styles.plusText} numberOfLines={2}>{label}</Text>
          <Animated.View style={[styles.plusOver, fill]}>
            <Text style={[styles.plusText, { color: colors.accentText }]} numberOfLines={2}>{label}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

/** Точки пагинации. Текущая — вытянутая и акцентная, перетекает за колодой
 *  непрерывно, пока её тянут. Больше шести проектов — видно шесть точек,
 *  крайняя у невидимых меньше и растёт, когда к ней подъезжают; появляется
 *  следующая. Тап по точке — к этому проекту. */
function Dots({ x, step, count, onGo, styles, lang }) {
  const visible = Math.min(count, MAX_DOTS);
  const row = useAnimatedStyle(() => {
    const p = Math.min(count - 1, Math.max(0, -x.value / step));
    return { transform: [{ translateX: -dotsWindow(p, count) * DOT_SLOT }] };
  });
  return (
    <View style={styles.dots}>
      <View style={[styles.dotsWindow, { width: visible * DOT_SLOT }]}>
        <Animated.View style={[styles.dotsRow, row]}>
          {Array.from({ length: count }, (_, i) => (
            <Dot key={i} i={i} x={x} step={step} count={count} onGo={onGo} styles={styles} lang={lang} />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

function Dot({ i, x, step, count, onGo, styles, lang }) {
  const colors = useColors();
  const dot = useAnimatedStyle(() => {
    const p = Math.min(count - 1, Math.max(0, -x.value / step));
    const d = Math.min(1, Math.abs(p - i));
    return {
      width: interpolate(d, [0, 1], [18, 6], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(d, [0, 1], [colors.accent, colors.raise]),
      transform: [{ scale: dotScale(i, p, count) }],
    };
  });
  return (
    <Pressable onPress={() => onGo(i)} style={styles.dotSlot} accessibilityRole="button" accessibilityLabel={`${t(lang, 'nav.projects')} ${i + 1}`}>
      <Animated.View style={[styles.dot6, dot]} />
    </Pressable>
  );
}

/** Карточка проекта: шапка, теги, числа, задачи со своей прокруткой,
 *  поле новой задачи, переход на страницу проекта. */
function ProjectCard({ project, pinTop, styles, onOpen, onOpenTask }) {
  const colors = useColors();
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const allTags = useAppStore((s) => s.tags);
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
    const id = setTimeout(() => setRising(null), 600);
    return () => clearTimeout(id);
  }, [runningId]);

  const own = tasksOf(tasks, project.id);
  const done = own.filter((task) => task.done).length;
  const list = cardTasks(own, pinTop ? { taskId: pinTop } : null);
  const nextDue = own.filter((task) => !task.done && task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  const due = nextDue ? dueState(nextDue) : null;
  const dueColor = due === 'overdue' ? colors.danger : due === 'soon' ? colors.warn : colors.textDim;
  const tags = tagsOf(allTags, project.tagIds || []);
  const pct = own.length ? Math.round((done / own.length) * 100) : 0;

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
          <View style={styles.subRow}>
            <Icon name="check" size={12} color={colors.textFaint} />
            <Text style={styles.sub}>{`${done}/${own.length}`}</Text>
            {nextDue ? <Text style={[styles.sub, styles.subDue, { color: dueColor }]} numberOfLines={1}>{`· ${dueShort(nextDue, lang)}`}</Text> : null}
          </View>
        </View>
        <Icon name="chevron-right" size={14} color={colors.textFaint} />
      </Tap>

      {tags.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={styles.tagsBar} contentContainerStyle={styles.tags}>
          <TagBadgeRow tags={tags} style={styles.tagsRow} />
        </ScrollView>
      ) : null}

      <View style={styles.kpis}>
        <Text style={styles.kpiTime}>{fmtDur(projectMs(tasks, project.id, activeTimer), lang)}</Text>
        <Text style={styles.kpiMoney}>{fmtMoney(projectMoney(tasks, project.id, rates, activeTimer), lang, currencyOf(project, settings))}</Text>
      </View>
      <View style={styles.bar}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: project.color || colors.accent }]} /></View>

      <Animated.FlatList
        style={styles.rows}
        // Остановленная задача уезжает наверх спокойным ease out.
        itemLayoutAnimation={REORDER}
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
      <Tap style={styles.more} onPress={onOpen} accessibilityRole="button">
        <Text style={styles.moreText} numberOfLines={1}>{t(lang, 'deck.open')}</Text>
        <Icon name="chevron-right" size={12} color={colors.textFaint} />
      </Tap>
    </View>
  );
}

const QA_H = 42;
const QA_BTN_H = 30;
// Отступ кнопки «Создать» справа — тот же, что сверху и снизу.
const QA_INSET = (QA_H - QA_BTN_H) / 2;

const makeStyles = (colors, cardW) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  deck: { flex: 1, paddingTop: 2 },
  strip: { flex: 1, flexDirection: 'row', paddingLeft: spacing.lg },
  slot: { width: cardW, marginRight: GAP },
  card: { width: cardW, marginRight: GAP, backgroundColor: colors.panel, borderRadius: 18, overflow: 'hidden' },
  plusCard: { position: 'absolute', top: 0, bottom: 0, width: PLUS_W + PLUS_TAIL, backgroundColor: colors.panel2, overflow: 'hidden' },
  plusLeft: { left: spacing.lg - GAP - PLUS_W - PLUS_TAIL, borderTopRightRadius: 18, borderBottomRightRadius: 18 },
  plusRight: { borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  plusOn: { backgroundColor: colors.accent },
  plusBody: { position: 'absolute', top: 0, bottom: 0, width: PLUS_W, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: 6 },
  plusOver: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  plusText: { color: colors.textDim, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  emptyWrap: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  emptyCard: { flex: 1, width: '100%', marginRight: 0, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  plusBig: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  newHint: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: spacing.md, paddingBottom: 6 },
  dot: { width: 11, height: 11, borderRadius: 4 },
  name: { color: colors.text, fontSize: 17, fontFamily: displayFamily.bold },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  subDue: { fontWeight: '600', flexShrink: 1 },
  tagsBar: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.sm },
  tags: { paddingHorizontal: spacing.md },
  tagsRow: { flexWrap: 'nowrap' },
  kpis: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  kpiTime: { color: colors.text, fontSize: 19, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  kpiMoney: { color: colors.textDim, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.panel2, marginHorizontal: spacing.md, marginBottom: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  rows: { flex: 1 },
  empty: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing.lg },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 10, marginVertical: spacing.sm, height: QA_H, paddingLeft: 10, paddingRight: QA_INSET, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { height: QA_BTN_H, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  qaGoOn: { backgroundColor: colors.accent },
  qaGoText: { color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  qaGoTextOn: { color: colors.accentText },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md },
  moreText: { color: colors.textDim, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dots: { height: 26, alignItems: 'center', justifyContent: 'center' },
  dotsWindow: { height: 26, overflow: 'hidden' },
  dotsRow: { flexDirection: 'row', height: 26 },
  dotSlot: { width: DOT_SLOT, height: 26, alignItems: 'center', justifyContent: 'center' },
  dot6: { height: 6, borderRadius: 3 },
});

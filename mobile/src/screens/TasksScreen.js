// «Задачи» — лента из всех проектов (макет B2): Сейчас · Закреплённые ·
// Незакреплённые · Выполнено. Три чипа-выпадашки сверху отбирают — «Проект»
// (несколько), «Дедлайн» (один), «Статус» (несколько, по виду статуса: у
// проектов статусы свои); каждый открывает лист (FilterSheet), отметки
// применяются сразу и сходятся по «и». Поле под чипами заводит задачу в
// выбранный проект (выбран ровно один — в него), свайп строки справа налево
// закрепляет. Разделы считает lib/inbox.js, он же отбирает (filterInbox).
//
// Выполненные есть в ленте всегда — разделом под подписью «Выполнено», серыми
// и зачёркнутыми, а самым последним, под ними, — «Отменённые» (серый крестик
// вместо галочки, название серое без зачёркивания); спрятать их можно только
// отбором по статусу. Галочка: задача отмечается в тот же миг (шкалы и счётчики
// не ждут), а строка остаётся на месте, пока играет налив (LiquidCheck), и
// потом плавно едет в «Выполнено» (hold.markNow); снятая и отменённая, которую
// вернули в работу, едут обратно (moveSoon, как закрепление свайпом).
//
// Запуск таймера задачу не двигает: идущая уходит в «Сейчас» только когда
// экран открывают заново, а на самом экране стоит на месте, пока её не
// остановят; остановили — она плавно (MOVE) возвращается в свой раздел.
// Заморозку и переезд ведёт hooks/useOrderHold.js.
import { useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import NewProjectSheet from '../components/NewProjectSheet';
import TaskRow from '../components/TaskRow';
import SwipeRow from '../components/SwipeRow';
import FilterSheet from '../components/FilterSheet';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import PickerSheet from '../components/PickerSheet';
import { useAppStore } from '../store/useAppStore';
import { inboxGroups, filterInbox, DUE_FILTERS } from '../lib/inbox';
import { defaultStatusId, STATUS_KINDS } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { useOrderHold } from '../hooks/useOrderHold';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, screenPadding, radius } from '../theme';
import { t } from '../lib/i18n';
import { pushTask } from '../navigation/openTask';

// «Закреплённые» — готовая строка с главной (её же берёт колода проекта).
const GROUP_KEY = { now: 'tasks.now', pinned: 'home.pinned', unpinned: 'tasks.unpinned', done: 'tasks.done_group', cancelled: 'tasks.cancelled_group' };
const DUE_KEY = { any: 'tasks.due_any', overdue: 'tasks.due_overdue', today: 'tasks.due_today', week: 'tasks.due_week', none: 'tasks.due_none' };
const NO_DUE_FILTER = 'any';

/** Текст чипа с несколькими значениями: ничего — подпись фильтра, одно — оно
 *  само, несколько — первое и «+ сколько ещё» («Сайт +2»). */
function multiChipText(names, fallback) {
  if (!names.length) return fallback;
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

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
  const hold = useOrderHold(navigation);

  // Отбор живёт в состоянии экрана и между запусками не хранится.
  const [projectIds, setProjectIds] = useState([]);
  const [due, setDue] = useState(NO_DUE_FILTER);
  const [kinds, setKinds] = useState([]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  // Удалённый проект из отбора выпадает сам.
  const picked = useMemo(() => projects.filter((p) => projectIds.includes(p.id)), [projects, projectIds]);
  const single = picked.length === 1 ? picked[0] : null;
  const filtered = picked.length > 0 || due !== NO_DUE_FILTER || kinds.length > 0;

  // Отобранные задачи, какими их показывать: пока налив отмеченной играет,
  // она стоит прежней — на своём месте (hold.view); в сторе она уже отмечена.
  const filterOpts = { projectIds: picked.map((p) => p.id), due, kinds, statuses, now: Date.now() };
  const shownTasks = hold.view(tasks);
  const shown = useMemo(
    () => filterInbox(shownTasks, filterOpts),
    [shownTasks, picked, due, kinds, statuses],
  );
  // Пока заморозка идёт, разделы считаются без таймера: идущая остаётся в
  // своём разделе, а не прыгает в «Сейчас». Выполненные и отменённые — всегда.
  const groups = useMemo(
    () => inboxGroups(shown, { activeTimer: hold.frozen ? null : activeTimer, showDone: true, statuses }),
    [shown, activeTimer, hold.frozen, statuses],
  );
  // Счётчик в шапке не ждёт налива: он считает задачи, как они лежат в сторе.
  const openCount = (hold.holding ? filterInbox(tasks, filterOpts) : shown).filter((task) => !task.done).length;
  // Внутри раздела строки держат тот порядок, что был на экране, пока
  // заморозка идёт: правка задачи (и пришедшая с синхронизацией тоже) не
  // поднимает её, пока таймер не остановят.
  const ranked = hold.rows('feed', groups.flatMap((g) => g.tasks));
  const rankKey = ranked.map((task) => task.id).join('|');
  // Лента — один виртуальный список: заголовки групп и строки подряд. Сто
  // семьдесят строк разом, каждая со своим жестом, монтировались секундами
  // и тормозили переход на вкладку; список рисует только видимое.
  const items = useMemo(() => {
    const rank = new Map(ranked.map((task, i) => [task.id, i]));
    const out = [];
    for (const g of groups) {
      out.push({ type: 'head', key: `h-${g.key}`, group: g.key });
      [...g.tasks].sort((a, b) => rank.get(a.id) - rank.get(b.id))
        .forEach((task, i) => out.push({ type: 'task', key: task.id, task, group: g.key, first: i === 0 }));
    }
    return out;
  }, [groups, rankKey]);
  const rowState = useMemo(() => ({ held: hold.holding, single: !!single }), [hold.holding, single]);

  // Проект новой задачи: отобранный (ровно один), иначе тот, куда заводили
  // прошлую, иначе первый.
  const targetProject = single
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

  // --- фильтры: каждый чип открывает свой лист ---
  // Фильтр по виду, а не по статусу проекта: подписи — переведённые названия
  // видов (имена статусов по умолчанию английские и у каждого проекта свои).
  const statusLabel = (kind) => t(lang, `status.kind_${kind}`);

  function openProjectFilter() {
    openSheet(
      <FilterSheet
        title={t(lang, 'filter.project')}
        multi
        options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
        value={picked.map((p) => p.id)}
        empty={[]}
        onChange={setProjectIds}
      />,
    );
  }

  function openDueFilter() {
    openSheet(
      <FilterSheet
        title={t(lang, 'due.label')}
        options={DUE_FILTERS.map((mode) => ({ value: mode, label: t(lang, DUE_KEY[mode]) }))}
        value={due}
        empty={NO_DUE_FILTER}
        onChange={setDue}
      />,
    );
  }

  function openStatusFilter() {
    openSheet(
      <FilterSheet
        title={t(lang, 'task.status_label')}
        multi
        options={STATUS_KINDS.map((kind) => ({ value: kind, label: statusLabel(kind) }))}
        value={kinds}
        empty={[]}
        onChange={setKinds}
      />,
    );
  }

  const resetFilters = () => { setProjectIds([]); setDue(NO_DUE_FILTER); setKinds([]); };

  // Галочка. Отметить: задача отмечается сразу (шкалы и счётчики не ждут), а
  // строка стоит на месте, пока налив виден до конца, и потом плавно едет в
  // «Выполнено» (hold.markNow). Снять галочку или вернуть в работу отменённую:
  // сразу — галочка стекает, строка едет обратно (moveSoon, как закрепление).
  // Без жидкости («уменьшение движения», iOS 26+) ждать нечего.
  function toggleDone(task, change, closed) {
    if (closed) hold.moveSoon(change, task.id);
    else hold.markNow(change, task);
  }

  // Задача — поверх ленты, «назад» сюда же (navigation/openTask.js).
  const openTask = (taskId) => pushTask(navigation, taskId);
  const openNewProject = () => openSheet(<NewProjectSheet onCancel={closeSheet} onCreated={closeSheet} />);

  // Пустая лента — четыре разных случая, и у каждого своё действие: нет ни
  // одного проекта (задаче некуда лечь — сначала проект), отбор ничего не
  // оставил (сбросить его), задач просто нет (написать первую — кнопка ставит
  // курсор в поле над лентой).
  let empty = null;
  if (!projects.length) {
    empty = (
      <EmptyState
        art="projects"
        title={t(lang, 'empty.need_project')}
        text={t(lang, 'empty.need_project_text')}
        actionLabel={t(lang, 'deck.new_project')}
        actionIcon="plus"
        onAction={openNewProject}
        primary
      />
    );
  } else if (filtered && tasks.length) {
    empty = (
      <EmptyState
        art="filter"
        title={t(lang, 'empty.filter_title')}
        text={t(lang, 'tasks.filter_empty_text')}
        actionLabel={t(lang, 'tasks.filter_reset')}
        onAction={resetFilters}
      />
    );
  } else {
    empty = (
      <EmptyState
        art="tasks"
        title={t(lang, 'deck.no_tasks')}
        text={t(lang, 'empty.tasks_text')}
        actionLabel={t(lang, 'empty.new_task')}
        onAction={() => inputRef.current && inputRef.current.focus()}
      />
    );
  }

  return (
    <View style={styles.container} testID="tasks-screen">
      <TabHeader title={t(lang, 'nav.tasks')} count={openCount || null}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} />
        <NotificationsButton navigation={navigation} />
      </TabHeader>

      <View style={styles.chips} testID="tasks-filters">
        <FilterChip
          testID="tasks-filter-project"
          label={multiChipText(picked.map((p) => p.name), t(lang, 'filter.project'))}
          active={picked.length > 0}
          onPress={openProjectFilter}
          styles={styles}
          colors={colors}
        />
        <FilterChip
          testID="tasks-filter-due"
          label={due === NO_DUE_FILTER ? t(lang, 'due.label') : t(lang, DUE_KEY[due])}
          active={due !== NO_DUE_FILTER}
          onPress={openDueFilter}
          styles={styles}
          colors={colors}
        />
        <FilterChip
          testID="tasks-filter-status"
          label={multiChipText(STATUS_KINDS.filter((k) => kinds.includes(k)).map(statusLabel), t(lang, 'task.status_label'))}
          active={kinds.length > 0}
          onPress={openStatusFilter}
          styles={styles}
          colors={colors}
        />
        {/* Хоть один отбор включён — в конце ряда «Сбросить» (12 октября
            2026): снять всё одним касанием, не открывая три листа. */}
        {filtered ? (
          <Tap
            testID="tasks-filter-reset"
            onPress={resetFilters}
            style={[styles.chip, styles.chipReset]}
            accessibilityRole="button"
            accessibilityLabel={t(lang, 'tasks.filter_reset')}
          >
            <Icon name="x" size={10} color={colors.textDim} />
            <Text style={styles.chipText} numberOfLines={1}>{t(lang, 'tasks.filter_reset')}</Text>
          </Tap>
        ) : null}
      </View>

      <View style={styles.qa}>
        <Icon name="plus" size={14} color={colors.textFaint} />
        <TextInput
          ref={inputRef}
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

      <Animated.FlatList
        testID="tasks-list"
        data={items}
        extraData={rowState}
        keyExtractor={(item) => item.key}
        // Остановленная задача едет в свой раздел, соседи подвигаются; на
        // время переезда она поверх соседей (у строк сплошная заливка).
        // Отмеченная и снятая — так же (moveSoon).
        itemLayoutAnimation={hold.layout}
        CellRendererComponentStyle={({ item }) => ({ zIndex: item.task && item.task.id === hold.rising ? 2 : 1 })}
        contentContainerStyle={[styles.content, !items.length && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
        renderItem={({ item, index }) => {
          const last = index === items.length - 1;
          if (item.type === 'head') {
            return (
              <View style={[styles.item, index === 0 && styles.itemTop, last && styles.itemBottom]} testID={`tasks-group-${item.group}`}>
                <Text style={[styles.group, item.group === 'now' && styles.groupNow]}>{t(lang, GROUP_KEY[item.group])}</Text>
              </View>
            );
          }
          const { task, group } = item;
          return (
            <View style={[styles.item, last && styles.itemBottom]}>
              {/* Закрепление переставляет строку между разделами — плавно: сначала
                  layout переезда, потом сама правка (useOrderHold, moveSoon). */}
              <SwipeRow label={t(lang, task.pinnedAt ? 'pin.unpin' : 'pin.pin')} onAction={() => hold.moveSoon(() => togglePinTask(task.id), task.id)}>
                <View style={styles.rowBg}>
                  {/* Раздел «Закреплённые» сам говорит о закреплении — булавка у названия
                      только втыкается и гаснет; в «Выполненных» и «Отменённых» раздел
                      этого не говорит, там она остаётся. */}
                  <TaskRow
                    task={task}
                    first={item.first}
                    showProject={!single}
                    hidePinned={group !== 'done' && group !== 'cancelled'}
                    checked={hold.marked(task.id)}
                    onToggleDone={toggleDone}
                    onPress={() => openTask(task.id)}
                  />
                </View>
              </SwipeRow>
            </View>
          );
        }}
      />
    </View>
  );
}

/** Чип-выпадашка фильтра: подпись и шеврон. Отбор включён — акцентная рамка
 *  (selected у доступности — для чтения с экрана и для тестов). */
function FilterChip({ label, active, onPress, styles, colors, testID }) {
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
      <Icon name="chevron-down" size={10} color={active ? colors.accentInk : colors.textFaint} />
    </Tap>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  // Страница — во всю высоту вкладки и не выше. Без flex: 1 корень рос по
  // содержимому: лента выходила за низ страницы под панель вкладок и не
  // прокручивалась — последние строки было не достать (круг 21; стиль пропал
  // 13 октября вместе с полосой чипов, а ссылка на него осталась). Страница
  // ограничена — ограничена и лента, и её нижний отступ (clearance) работает.
  container: { flex: 1, backgroundColor: colors.bg },
  // Три чипа в ряд без прокрутки: длинное имя проекта сжимается многоточием,
  // а не выталкивает остальные за край.
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: screenPadding, marginBottom: spacing.md },
  // Рамка есть всегда (в цвет подложки), включённому меняется только цвет —
  // чип не прыгает по размеру.
  chip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: colors.panel, backgroundColor: colors.panel },
  chipOn: { borderColor: colors.accent },
  // «Сбросить» не ужимается: короткое слово, которое должно читаться целиком.
  chipReset: { flexShrink: 0 },
  chipText: { flexShrink: 1, color: colors.textDim, fontSize: 13, fontWeight: '500' },
  chipTextOn: { color: colors.text, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 3 },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: screenPadding, marginBottom: spacing.sm, height: 44, paddingLeft: 10, paddingRight: 6, borderRadius: 13, backgroundColor: colors.panel },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaProject: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.panel2, maxWidth: 130 },
  qaProjectText: { color: colors.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  content: { paddingHorizontal: screenPadding, paddingBottom: clearance },
  // Пустая лента — пустой экран посередине оставшегося места, чуть выше центра.
  contentEmpty: { flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', paddingBottom: spacing.xxl },
  // Остров ленты собран из элементов списка: фон у каждого, скругления —
  // у первого и последнего.
  item: { backgroundColor: colors.panel, overflow: 'hidden' },
  itemTop: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  itemBottom: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 3 },
  groupNow: { color: colors.accentInk },
  rowBg: { backgroundColor: colors.panel },
});

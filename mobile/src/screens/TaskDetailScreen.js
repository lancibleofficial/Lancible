// Страница задачи (макет B2): сверху заголовок, теги и заметки, снизу
// всегда виден шит с таймером и заработком. Шит тянется вверх и показывает две вкладки: «Сведения» и
// «История» (записи по дням, «Запись вручную», внизу закреплён «Экспорт
// истории»).
//
// «Сведения» (12 октября 2026) — по трём правилам настроек телефона
// (DESIGN.md, «Настройки на телефоне: одна логика»): быстрый выбор из
// короткого списка — чипами на месте (статус, версия; теги — бейджами и
// «+ теги»); всё, у чего свои параметры, — строкой «название · значение ›»
// на острове, тап открывает лист этой настройки; строки сгруппированы по
// вопросу: «Когда» (дедлайн, время работы, повторение), «Напоминания»,
// «Ещё» (ставка).
//
// Заметки пишутся прямо здесь (12 октября 2026): живой редактор, касание —
// курсор и клавиатура. Поле заметок тянется до низа видимой страницы
// (notesMinHeight), длинный текст растит его дальше, прокручивает страница;
// касание пустого места под текстом — курсор в конец. Курсор над клавиатурой
// держит onCaret. Пока клавиатура открыта, шит с таймером уходит вниз, а над
// клавиатурой — нативная панель редактора (EditorToolbar); закрылась — панель
// уходит вниз под шит, и шит возвращается. Полноэкранного режима у заметок
// нет с 13 октября 2026: всё — здесь. См. DESIGN.md, «Редактор на телефоне».
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import Tap from '../components/Tap';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, runOnJS, interpolate } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KEYBOARD_NATIVE, useReanimatedKeyboardAnimation } from '../lib/keyboard';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import DocEditor from '../components/DocEditor';
import EditorToolbar, { SavedDot, TOOLBAR_HEIGHT } from '../components/EditorToolbar';
import { useEditorSession } from '../hooks/useEditorSession';
import Icon from '../components/Icon';
import DetailHeader, { DetailButton } from '../components/DetailHeader';
import { LiquidButton } from '../components/Liquid';
import Segmented from '../components/Segmented';
import { IOS_NATIVE_HEADER } from '../navigation/nativeHeader';
import PrimaryButton from '../components/PrimaryButton';
import EmptyState from '../components/EmptyState';
import MenuSheet from '../components/MenuSheet';
import DueSheet from '../components/DueSheet';
import TagPickerSheet from '../components/TagPickerSheet';
import RepeatSheet from '../components/RepeatSheet';
import SlotSheet from '../components/SlotSheet';
import SlotListSheet from '../components/SlotListSheet';
import ReminderSheet from '../components/ReminderSheet';
import RateSheet from '../components/RateSheet';
import SessionSheet from '../components/SessionSheet';
import Chip from '../components/Chip';
import { SettingRow, RowGroup } from '../components/Island';
import { Block } from '../components/RepeatControls';
import { TagBadgeRow } from '../components/TagBadge';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtClock, fmtMoney, fmtShort, fmtWhen, fmtDateShort, earnedOf, earnedShown, effectiveRate, sessionMoney, capFirst, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import { buildTaskSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { orderedStatuses } from '../lib/statuses';
import { tagsOf } from '../lib/tags';
import { dueShort, dueState } from '../lib/due';
import { isPresetRule, REPEAT_PRESETS, hm } from '../lib/sessions';
import { slotsSummary } from '../lib/slotText';
import { reminderLabel } from '../lib/reminderText';
import { dayKey } from '../lib/calendarMath';
import Repeat from '../core/repeat.js';
import Slots from '../core/slots.js';
import Reminders from '../core/reminders.js';
import Versions from '../core/versions.js';
import CoreMoney from '../core/money.js';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily, buttonHeight, buttonRadius, taskControlRadius } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
// Свёрнутый шит: ручка и таймер 58 с полями. Вкладки ниже — их видно,
// когда шит тянут вверх.
const SHEET_COLLAPSED = 130;
const SPRING = { damping: 19, stiffness: 230, mass: 0.9 };
// Воздух между сфокусированным полем шита и верхом клавиатуры — тот же, что
// у нижнего листа (FIELD_GAP в components/BottomSheet.js).
export const PANEL_FIELD_GAP = spacing.md;
// Воздух между курсором заметок и панелью редактора над клавиатурой.
export const CARET_GAP = spacing.lg;

/** На сколько докрутить страницу, чтобы курсор заметок встал между верхом
 *  видимой части и панелью над клавиатурой: > 0 — вниз, < 0 — вверх, 0 —
 *  курсор и так виден. Всё — в координатах окна: boxTop — верх WebView,
 *  caret — курсор от верха страницы WebView, kbTop — верх клавиатуры,
 *  viewTop — верх видимой части под шапкой. */
export function caretShift({ boxTop, caret, kbTop, viewTop }) {
  const below = boxTop + caret.bottom + CARET_GAP - (kbTop - TOOLBAR_HEIGHT);
  if (below > 0) return below;
  const above = viewTop - (boxTop + caret.top - CARET_GAP);
  return above > 0 ? -above : 0;
}

/** Наименьшая высота поля заметок (13 октября 2026): от его верха до низа
 *  видимой страницы — до панели над клавиатурой, пока она открыта; до
 *  панели пера над системной панелью, пока рисуют; до свёрнутого шита с
 *  таймером без них. Снизу ещё воздух spacing.lg — тот же запас, что у
 *  страницы (paddingBottom), так что короткий текст страницу не листает.
 *  viewH — высота прокрутки, top — верх поля в ней, sheetH — свёрнутый шит
 *  с системной панелью, insetBottom — системная панель. */
export function notesMinHeight({ viewH, top, kbHeight = 0, inkOn = false, sheetH = 0, insetBottom = 0 }) {
  if (!viewH) return 0;
  const below = kbHeight > 0 ? kbHeight + TOOLBAR_HEIGHT
    : inkOn ? insetBottom + TOOLBAR_HEIGHT
      : sheetH;
  return Math.max(0, Math.floor(viewH - top - below - spacing.lg));
}

/** Шит возвращается после того, как панель ушла вниз с клавиатурой. Android
 *  сообщает о закрытии в конце её хода (keyboardDidHide) — ждать незачем;
 *  iOS — в начале (keyboardWillHide), и шит ждёт, пока клавиатура съедет. */
export const SHEET_RETURN_DELAY = Platform.OS === 'ios' ? 250 : 0;

export default function TaskDetailScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, insets), [colors, insets]);
  const { taskId } = route.params;
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const LANG = settings.lang;
  const locale = LOCALE_MAP[LANG] || 'ru-RU';
  const updateTask = useAppStore((s) => s.updateTask);
  const setTaskDue = useAppStore((s) => s.setTaskDue);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const setTaskDone = useAppStore((s) => s.setTaskDone);
  const allTags = useAppStore((s) => s.tags);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const showToast = useAppStore((s) => s.showToast);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const setTaskVersion = useAppStore((s) => s.setTaskVersion);
  const setTaskRepeat = useAppStore((s) => s.setTaskRepeat);
  const rates = useRates();

  const task = getTask(tasks, taskId);
  const project = getProject(projects, task ? task.projectId : null);
  const currency = currencyOf(project, settings);
  const taskTags = tagsOf(allTags, task ? task.tagIds : []);
  const own = task ? orderedStatuses(statuses, task.projectId) : [];
  const projectVersions = task ? Versions.versionsOf(versions, task.projectId) : [];
  const dueTone = task ? dueState(task) : null;
  const isRunning = !!activeTimer && activeTimer.taskId === taskId;
  useTicker(isRunning);

  const [tab, setTab] = useState('details');
  const [title, setTitle] = useState(task ? task.title : '');
  const titleTimer = useRef(null);
  // Набранное название, ещё не ушедшее в задачу (таймер 400 мс).
  const titlePending = useRef(null);
  /** Название — в задачу сейчас, не дожидаясь таймера: уходя со страницы и
   *  размонтируясь (раньше таймер на размонтировании просто гасился, и
   *  набранное перед «назад» терялось). Удалённую задачу не трогает. */
  const flushTitle = () => {
    clearTimeout(titleTimer.current);
    titleTimer.current = null;
    const v = titlePending.current;
    titlePending.current = null;
    if (v == null) return;
    const st = useAppStore.getState();
    if (getTask(st.tasks, taskId)) st.updateTask(taskId, { title: v });
  };
  useEffect(() => flushTitle, []);

  // --- шит: два положения, тянется за верхнюю часть ---
  // С нативной шапкой (iOS 26+) экран начинается под ней: шит меряется от
  // высоты своей области, а не окна.
  const [areaH, setAreaH] = useState(screenH);
  const sheetTop = IOS_NATIVE_HEADER ? spacing.sm : insets.top + 48;
  const sheetH = Math.max(SHEET_COLLAPSED + 200, (IOS_NATIVE_HEADER ? areaH : screenH) - sheetTop);
  // Свёрнутый шит — ровно его верхняя часть (ручка, таймер, вкладки). Высота
  // меряется, а не прибита: с прибитой из-под вкладок выглядывало тело.
  const [headH, setHeadH] = useState(SHEET_COLLAPSED);
  const collapsedY = sheetH - headH - insets.bottom;
  const y = useSharedValue(collapsedY);
  const startY = useSharedValue(collapsedY);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!expanded) y.value = collapsedY; }, [collapsedY]);
  const snapTo = (open) => {
    y.value = withSpring(open ? 0 : collapsedY, SPRING);
    setExpanded(open);
  };
  const pan = useMemo(() => Gesture.Pan()
    .onStart(() => { startY.value = y.value; })
    .onUpdate((e) => { y.value = Math.min(collapsedY, Math.max(0, startY.value + e.translationY)); })
    .onEnd((e) => {
      const open = e.velocityY < -300 ? true : e.velocityY > 300 ? false : y.value < collapsedY / 2;
      y.value = withSpring(open ? 0 : collapsedY, SPRING);
      runOnJS(setExpanded)(open);
    }), [collapsedY]);
  // --- заметки: живой редактор (hooks/useEditorSession.js) ---
  const scrollRef = useRef(null);
  // Высота прокрутки и верх поля заметок в ней — для notesMinHeight.
  const [viewH, setViewH] = useState(0);
  const [notesTop, setNotesTop] = useState(0);
  const scrollY = useRef(0);
  const editorBox = useRef(null);
  const lastCaret = useRef(null);
  const session = useEditorSession('task', taskId, { onCaret: (c) => { lastCaret.current = c; keepCaret(); } });
  const keyboard = session.keyboard;
  const keyboardRef = useRef(keyboard);
  keyboardRef.current = keyboard;

  /** Курсор заметок над клавиатурой и панелью: страница докручивается, если
   *  курсор ушёл под них или выше видимой части. Курсор приходит в пикселях
   *  страницы WebView, клавиатура — верхом в координатах окна. */
  function keepCaret() {
    const c = lastCaret.current;
    const kb = keyboardRef.current;
    const box = editorBox.current;
    if (!c || !kb.shown || kb.top == null || !box || !box.measureInWindow) return;
    box.measureInWindow((_x, top) => {
      const shift = caretShift({ boxTop: top, caret: c, kbTop: kb.top, viewTop: insets.top + 48 });
      if (shift) scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + shift), animated: true });
    });
  }
  // Клавиатура встала (или сменила высоту) после того, как пришёл курсор.
  useEffect(() => { if (keyboard.shown) keepCaret(); }, [keyboard.shown, keyboard.top]);

  // Уходя со страницы — набранное сразу в задачу: заметки (и страницу просим
  // отдать задержанное) и название. Экран, отрисованный вне навигатора
  // (тесты, превью), событий не шлёт.
  useEffect(() => (navigation.addListener
    ? navigation.addListener('blur', () => { session.flush(); flushTitle(); })
    : undefined), [navigation]);

  // Клавиатура открыта (или включено перо) — шит с таймером уходит вниз и
  // возвращается, когда она закрылась (решение 12 октября 2026): над
  // клавиатурой встаёт панель редактора, и места под текст больше. С кадрами
  // клавиатуры (lib/keyboard.js) шит уходит вместе с ней; без них — своим
  // ходом по событию. Возвращается — после клавиатуры: пока она открыта
  // (keyboard.shown), шит держится внизу, а панель редактора едет вниз с
  // клавиатурой и уходит под шит — шит отрисован поверх неё (13 октября
  // 2026; раньше панель стояла сверху и на миг закрывала таймер). Раскрытый
  // шит не уходит: его поля — его дело.
  const kbFrames = useReanimatedKeyboardAnimation();
  const hideOn = !expanded && (keyboard.shown || session.inkOn);
  const hide = useSharedValue(hideOn ? 1 : 0);
  useEffect(() => {
    hide.value = hideOn ? withTiming(1, { duration: 220 }) : withDelay(SHEET_RETURN_DELAY, withTiming(0, { duration: 220 }));
  }, [hideOn]);
  // Поле заметок — до низа видимой страницы; страница снизу оставляет место
  // под свёрнутый шит, а пока шит внизу — только воздух.
  const sheetCollapsedH = headH + insets.bottom;
  const notesMin = notesMinHeight({
    viewH, top: notesTop, kbHeight: keyboard.shown ? keyboard.height : 0, inkOn: session.inkOn, sheetH: sheetCollapsedH, insetBottom: insets.bottom,
  });
  const hideDist = headH + insets.bottom + spacing.lg;
  const sheetStyle = useAnimatedStyle(() => {
    const p = expanded ? 0 : Math.max(hide.value, KEYBOARD_NATIVE ? kbFrames.progress.value : 0);
    return { transform: [{ translateY: y.value + p * hideDist }] };
  }, [expanded, hideDist]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, collapsedY], [0.5, 0]) }));
  const bodyStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, collapsedY * 0.5, collapsedY], [1, 1, 0]) }));
  // Вкладки проявляются, как только шит начали тянуть вверх.
  const tabsStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [collapsedY * 0.7, collapsedY], [1, 0], 'clamp') }));
  const openTab = (key) => { setTab(key); if (!expanded) snapTo(true); };

  function onExport() {
    if (!task) return;
    runExport(
      `${project ? project.name : t(LANG, 'export.project_fallback')} — ${task.title || t(LANG, 'export.task_fallback')} — ${new Date().toISOString().slice(0, 10)}`,
      buildTaskSheets(task, project, LANG, currency, rates),
      LANG,
      showToast,
    );
  }
  /** Проект задачи. Если пришли с его страницы — назад, а не второй такой
   *  же экран в стек. */
  function onOpenProject() {
    if (!project) return;
    const state = navigation.getState();
    const prev = state.routes[state.index - 1];
    if (prev && prev.name === 'Project' && prev.params && prev.params.projectId === project.id) { navigation.goBack(); return; }
    navigation.navigate('Project', { projectId: project.id });
  }
  function onDelete() {
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
      message: task && task.title ? t(LANG, 'confirm.delete_task_named', { name: task.title }) : t(LANG, 'confirm.delete_task'),
      actions: [
        { label: t(LANG, 'task.delete_title'), destructive: true, onPress: () => { deleteTask(taskId); navigation.goBack(); } },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
  }
  function onOpenMenu() {
    openSheet(
      <MenuSheet
        title={(task && task.title) || t(LANG, 'task.no_name')}
        items={[
          { key: 'project', icon: 'folder', label: t(LANG, 'task.open_project'), onPress: onOpenProject },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onExport },
          { key: 'delete', icon: 'trash', label: t(LANG, 'task.delete_title'), danger: true, separated: true, onPress: onDelete },
        ]}
      />,
    );
  }
  function onTitleChange(v) {
    setTitle(v);
    titlePending.current = v;
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(flushTitle, 400);
  }
  function onOpenDue() {
    openSheet(
      <DueSheet
        task={task}
        lang={LANG}
        onApply={(patch) => { setTaskDue(taskId, patch); closeSheet(); }}
        onClear={() => { setTaskDue(taskId, { dueAt: null }); closeSheet(); }}
      />,
    );
  }
  function onOpenTags() {
    openSheet(<TagPickerSheet value={task.tagIds || []} projectId={task.projectId} onChange={(ids) => setTaskTags(taskId, ids)} />);
  }
  // Повтор не требует дедлайна: считать можно от дедлайна, от разового
  // времени работы, а без них — от дня закрытия (core/slots.js, planTaskRoll).
  function onOpenRepeat() {
    openSheet(
      <RepeatSheet lang={LANG} anchorAt={Slots.rollAnchor(task)} rule={task.repeat} onApply={(rule) => setTaskRepeat(taskId, rule)} onClear={() => setTaskRepeat(taskId, null)} />,
    );
  }
  // Время работы: отрезков нет — сразу лист нового отрезка; есть — их список
  // (там каждый правится и добавляется новый).
  function onOpenSlots() {
    if (Slots.slotsOf(task).length) openSheet(<SlotListSheet taskId={taskId} />);
    else openSheet(<SlotSheet taskId={taskId} />);
  }
  // Ставка правится в своём листе (на панели — только значение словами):
  // пустое поле — ставка не своя, серым — та, по которой считается.
  function onOpenRate() {
    openSheet(
      <RateSheet
        lang={LANG}
        title={t(LANG, 'task.rate_label')}
        initialValue={task.rate}
        placeholder={String(CoreMoney.baseRate(task, rates) || 0)}
        unit={`${CURRENCY_SYMBOLS[currency] || currency}${t(LANG, 'rate.per_hour')}`}
        hint={t(LANG, 'task.rate_hint')}
        nullable
        onSave={(n) => updateTask(taskId, { rate: n })}
      />,
    );
  }
  function onDeleteSession(index) {
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
      message: t(LANG, 'session.delete_title'),
      actions: [
        { label: t(LANG, 'common.delete'), destructive: true, onPress: () => deleteSession(taskId, index) },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
  }

  if (!task) return null;

  const elapsedMs = isRunning ? Date.now() - new Date(activeTimer.startedAt).getTime() + (task.totalMs || 0) : (task.totalMs || 0);
  const runMs = isRunning ? Date.now() - new Date(activeTimer.startedAt).getTime() : 0;
  const earned = earnedOf(task, rates, activeTimer);
  const rateNow = effectiveRate(task, rates);
  const baseRate = CoreMoney.baseRate(task, rates);
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  const repeatDesc = Repeat.describeRepeat(task.repeat);
  const repeatText = repeatDesc
    ? capFirst(t(LANG, repeatDesc.key, { ...repeatDesc.vars, days: (repeatDesc.vars.days || []).map((d) => t(LANG, WEEKDAY_KEY[d])).join(', ') }))
    : '';
  const repeatPreset = task.repeat ? REPEAT_PRESETS.find((p) => isPresetRule(task.repeat, p.freq, p.weekdays)) : null;
  const slots = Slots.slotsOf(task);
  const reminders = Reminders.remindersOf(task);
  const anchorMissing = (r) => r.kind === 'before' && (r.anchor === 'start' ? !slots.length : !task.dueAt);

  // Значения строк «Сведений» — словами, как в «Меню»: что настроено сейчас.
  const perHour = (n) => `${fmtMoney(n, LANG, currency)}${t(LANG, 'rate.per_hour')}`;
  const dueValue = task.dueAt ? `${dueShort(task, LANG)}, ${hm(task.dueAt)}` : t(LANG, 'due.none');
  const slotsValue = slots.length ? slotsSummary(slots, LANG, Slots.slotRule(task)) : t(LANG, 'slot.none');
  const repeatValue = !task.repeat ? t(LANG, 'repeat.none') : repeatPreset ? t(LANG, `repeat.${repeatPreset.key}`) : repeatText;
  // Повторяющаяся задача без дат закрыта и ждёт своего дня — подстрокой.
  const returnsText = task.done && task.repeat && task.reopenAt ? t(LANG, 'repeat.returns', { date: fmtDateShort(task.reopenAt, LANG) }) : '';
  const hasValue = (v) => v !== null && v !== undefined && v !== '';
  const rateValue = hasValue(task.rate) ? perHour(Number(task.rate))
    : project && hasValue(project.rate) ? t(LANG, 'task.rate_project', { rate: perHour(baseRate) })
      : baseRate ? t(LANG, 'rate.shared', { rate: perHour(baseRate) })
        : t(LANG, 'rate.none');

  // История по дням, свежее сверху.
  const sessions = [...(task.sessions || [])].map((s, i) => ({ s, i })).sort((a, b) => new Date(b.s.start) - new Date(a.s.start));
  const totalMoney = sessions.reduce((a, { s }) => a + sessionMoney(s, task, rates), 0) + (isRunning ? earned - sessions.reduce((a, { s }) => a + sessionMoney(s, task, rates), 0) : 0);
  const historyDays = [];
  for (const row of sessions) {
    const key = dayKey(row.s.start);
    let g = historyDays.find((x) => x.key === key);
    if (!g) { g = { key, label: capFirst(fmtWhen(row.s.start, LANG).split(' ')[0] === 'сегодня' ? t(LANG, 'calendar.today') : new Date(row.s.start).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })), rows: [] }; historyDays.push(g); }
    g.rows.push(row);
  }

  const timerBlock = (
    <View style={styles.timerRow}>
      <LiquidButton
        on={isRunning}
        kickId={taskId}
        style={styles.timerBtn}
        iconSize={22}
        onPress={() => (isRunning ? stopTimer() : startTimer(taskId))}
        accessibilityRole="button"
        accessibilityLabel={t(LANG, isRunning ? 'timer.stop' : 'timer.start')}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.clock}>{fmtClock(isRunning ? runMs : elapsedMs)}</Text>
        <View style={styles.earnRow}>
          {earnedShown(task, rates, earned) ? <Text style={styles.earned}>{fmtMoney(earned, LANG, currency)}</Text> : null}
          <Text style={styles.earnSub} numberOfLines={1}>
            {[rateNow ? `${moneyFmt(LANG).format(rateNow)} ${sym}${t(LANG, 'rate.per_hour')}` : t(LANG, 'money.no_rate'), isRunning ? t(LANG, 'task.total_label', { time: fmtShort(elapsedMs, LANG) }) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container} onLayout={IOS_NATIVE_HEADER ? (e) => setAreaH(Math.round(e.nativeEvent.layout.height)) : undefined}>
      <DetailHeader
        onBack={() => navigation.goBack()}
        backLabel={t(LANG, 'common.back')}
        color={project ? project.color : null}
        title={project ? project.name : ''}
        sub={own.length && task.statusId ? (own.find((s) => s.id === task.statusId) || {}).name || '' : ''}
        onTitle={onOpenProject}
        running={isRunning}
        runSince={isRunning ? new Date(activeTimer.startedAt).getTime() : null}
        right={(
          <>
            <DetailButton icon="check" on={task.done} onPress={() => setTaskDone(taskId, !task.done)} label={t(LANG, task.done ? 'task.reopen' : 'task.mark_done')} />
            <DetailButton icon="kebab" onPress={onOpenMenu} label={t(LANG, 'project.opts')} />
          </>
        )}
      />

      {/* Страница прокручивается вместе с заметками: снизу место под
          клавиатуру и панель редактора (KeyboardAwareScrollView), а курсор над
          ними держит keepCaret. С пером палец рисует, а не листает. */}
      <KeyboardAwareScrollView
        ref={scrollRef}
        onLayout={(e) => setViewH(Math.round(e.nativeEvent.layout.height))}
        contentContainerStyle={[styles.body, { paddingBottom: (hideOn ? 0 : sheetCollapsedH) + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        extraKeyboardSpace={TOOLBAR_HEIGHT}
        scrollEnabled={!session.inkOn}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        testID="task-scroll"
      >
        <TextInput
          style={[styles.title, task.done && styles.titleDone]}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t(LANG, 'task.title_ph')}
          placeholderTextColor={colors.textFaint}
          multiline
        />
        <View style={styles.tagsRow}>
          {taskTags.length ? <TagBadgeRow tags={taskTags} onRemove={(tagId) => setTaskTags(taskId, (task.tagIds || []).filter((x) => x !== tagId))} /> : null}
          <Tap style={styles.tagAdd} onPress={onOpenTags} hitSlop={6} accessibilityLabel={t(LANG, 'tag.pick')}>
            <Icon name="plus" size={10} color={colors.textFaint} />
            <Text style={styles.tagAddText}>{t(LANG, 'tag.pick').toLowerCase()}</Text>
          </Tap>
          {/* «Сохранено» — тихой точкой в конце строки тегов. */}
          <SavedDot lang={LANG} saved={session.saved} style={styles.savedDot} />
        </View>
        <View ref={editorBox} collapsable={false} style={styles.notes} onLayout={(e) => setNotesTop(Math.round(e.nativeEvent.layout.y))} testID="task-notes">
          <DocEditor {...session.editorProps} live minHeight={notesMin} placeholder={t(LANG, 'editor.empty')} />
        </View>
      </KeyboardAwareScrollView>

      {/* Панель редактора — над клавиатурой. Отрисована до шита: шит поверх
          неё, и, уезжая вниз с закрывающейся клавиатурой, панель уходит под
          шит, а не закрывает таймер. */}
      <EditorToolbar {...session.toolbarProps} />

      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents={expanded ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => snapTo(false)} accessibilityLabel={t(LANG, 'common.back')} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { height: sheetH }, sheetStyle]} testID="task-sheet">
        <GestureDetector gesture={pan}>
          <View collapsable={false} style={styles.sheetHead} onLayout={(e) => setHeadH(Math.round(e.nativeEvent.layout.height))}>
            <View style={styles.handle} />
            {timerBlock}
          </View>
        </GestureDetector>
        {/* Вкладки — ниже свёрнутой части: пока шит свёрнут, их не видно. */}
        {/* Пока шит свёрнут, выбранной вкладки нет — нет и подложки. */}
        <Animated.View style={[styles.segWrap, tabsStyle]}>
          <Segmented
            items={[{ key: 'details', label: t(LANG, 'task.details') }, { key: 'history', label: t(LANG, 'task.history_n', { n: sessions.length }) }]}
            value={expanded ? tab : null}
            onChange={openTab}
            style={styles.seg}
            textStyle={styles.segText}
          />
        </Animated.View>

        {/* Клавиатура. Шит — не Modal, а вид в окне приложения, и окно под
            клавиатуру не ужимается (edge-to-edge, KeyboardProvider в App.js):
            поле «Ставка» внизу «Сведений» оставалось под ней. Прокрутка —
            KeyboardAwareScrollView из react-native-keyboard-controller: снизу
            она добавляет место на высоту клавиатуры и вместе с её ходом, кадр
            за кадром, докручивает сфокусированное поле, чтобы оно стояло над
            клавиатурой с воздухом PANEL_FIELD_GAP. Шит, его ручка и
            положения не меняются; «Выполнено» под клавиатурой — как подвал
            любой страницы. См. DESIGN.md, «Шит задачи и клавиатура». */}
        <KeyboardAwareScrollView bottomOffset={PANEL_FIELD_GAP} style={[{ flex: 1 }, bodyStyle]} contentContainerStyle={styles.sheetBody} scrollEnabled={expanded} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} testID="task-sheet-scroll">
          {tab === 'details' ? (
            <View style={styles.details} testID="task-details">
              {/* Быстрый выбор из короткого списка — чипами на месте. */}
              <Block label={t(LANG, 'task.status_label')}>
                <View style={styles.chips} testID="task-statuses">
                  {own.map((s) => <Chip key={s.id} label={s.name} dot={s.color} on={task.statusId === s.id} onPress={() => setTaskStatus(taskId, s.id)} />)}
                </View>
              </Block>

              {projectVersions.length ? (
                <Block label={t(LANG, 'version.label')}>
                  <View style={styles.chips} testID="task-versions">
                    <Chip label={t(LANG, 'version.none')} on={!task.versionId} onPress={() => setTaskVersion(taskId, null)} />
                    {projectVersions.map((v) => <Chip key={v.id} label={v.name} on={task.versionId === v.id} onPress={() => setTaskVersion(taskId, v.id)} />)}
                  </View>
                </Block>
              ) : null}

              {/* Теги — бейджами с крестиками и «+ теги», как под названием. */}
              <Block label={t(LANG, 'tag.pick')}>
                <View style={styles.chips} testID="task-tags">
                  {taskTags.length ? <TagBadgeRow tags={taskTags} onRemove={(tagId) => setTaskTags(taskId, (task.tagIds || []).filter((x) => x !== tagId))} /> : null}
                  <Chip label={`+ ${t(LANG, 'tag.pick').toLowerCase()}`} onPress={onOpenTags} accessibilityLabel={t(LANG, 'tag.pick')} testID="task-tag-add" />
                </View>
              </Block>

              {/* Всё, у чего свои параметры, — строкой «название · значение ›»;
                  тап открывает лист этой настройки. Время работы — отдельное
                  от дедлайна понятие: когда этим заниматься, отрезков может
                  быть несколько (в строке — первый и «+N»). Срок дедлайна
                  жирным и цветом своего состояния, как в строках задач:
                  просрочен — danger, в пределах суток — accentInk. */}
              <RowGroup label={t(LANG, 'task.group_when')} testID="task-when">
                <SettingRow
                  icon="calendar"
                  label={t(LANG, 'due.label')}
                  value={dueValue}
                  valueStyle={task.dueAt ? [styles.dueSet, dueTone === 'overdue' && styles.dueOverdue, dueTone === 'soon' && styles.dueSoon] : null}
                  onPress={onOpenDue}
                  testID="task-due-row"
                  valueTestID="task-due-value"
                />
                <SettingRow icon="clock" label={t(LANG, 'slot.label')} value={slotsValue} onPress={onOpenSlots} testID="task-slots" valueTestID="task-slots-value" />
                <SettingRow
                  icon="refresh"
                  label={t(LANG, 'repeat.label')}
                  value={repeatValue}
                  sub={returnsText}
                  onPress={onOpenRepeat}
                  testID="task-repeat"
                  valueTestID="task-repeat-value"
                  subTestID="task-returns"
                />
              </RowGroup>

              {/* Напоминания: строка на каждое — тап правит его. «До начала»
                  срабатывает перед каждым вхождением времени работы, «до
                  дедлайна» едет за дедлайном. Строка, чьего якоря у задачи уже
                  нет, тише: она ждёт, пока якорь появится. */}
              <RowGroup label={t(LANG, 'remind.label')} testID="task-reminders">
                {reminders.map((r) => (
                  <SettingRow
                    key={r.id}
                    icon="bell"
                    label={reminderLabel(r, LANG)}
                    dim={anchorMissing(r)}
                    onPress={() => openSheet(<ReminderSheet taskId={taskId} reminderId={r.id} />)}
                    testID={`task-reminder-${r.id}`}
                  />
                ))}
                <SettingRow icon="plus" label={t(LANG, 'remind.add')} chevron={false} onPress={() => openSheet(<ReminderSheet taskId={taskId} />)} testID="task-reminder-add" />
              </RowGroup>

              {/* Ставка: на панели — значение словами; правится в листе. Не
                  своя — «как у проекта — …» или «общая — …». */}
              <RowGroup label={t(LANG, 'task.group_more')} testID="task-more">
                <SettingRow icon="wallet" label={t(LANG, 'task.rate_label')} value={rateValue} onPress={onOpenRate} testID="task-rate-row" valueTestID="task-rate-value" />
              </RowGroup>
            </View>
          ) : (
            <>
              <View style={styles.histHead}>
                <Text style={styles.histCount}>{t(LANG, 'task.records_n', { n: sessions.length })}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.histNum}>{fmtShort(elapsedMs, LANG)}</Text>
                {earnedShown(task, rates, earned) ? <Text style={[styles.histNum, { color: colors.textDim }]}>{fmtMoney(totalMoney, LANG, currency)}</Text> : null}
              </View>
              {isRunning ? (
                <View style={[styles.hrow, styles.hrowRun]}>
                  <Text style={styles.hTime}>{hm(activeTimer.startedAt)} – <Text style={{ color: colors.accentInk }}>{t(LANG, 'tasks.now').toLowerCase()}</Text></Text>
                  <Text style={styles.hNote} numberOfLines={1}>{t(LANG, 'task.running_since', { time: hm(activeTimer.startedAt) })}</Text>
                  <Text style={[styles.hDur, { color: colors.accentInk }]}>{fmtClock(runMs)}</Text>
                </View>
              ) : null}
              {/* Записей нет — маленький пустой экран без кнопки: «Запись
                  вручную» строкой прямо под ним, таймер — над вкладками. */}
              {!sessions.length && !isRunning ? (
                <EmptyState size="sm" art="timer" title={t(LANG, 'project.ps_empty')} text={t(LANG, 'empty.task_history_text')} />
              ) : null}
              {historyDays.map((g) => (
                <View key={g.key}>
                  <Text style={styles.label}>{g.label}</Text>
                  {g.rows.map(({ s, i }, j) => (
                    <Tap key={i} style={[styles.hrow, j === 0 && styles.hrowFirst]} onPress={() => openSheet(<SessionSheet task={task} index={i} />)} onLongPress={() => onDeleteSession(i)} accessibilityRole="button">
                      <Text style={styles.hTime}>{hm(s.start)} – {s.end ? hm(s.end) : '…'}</Text>
                      <Text style={styles.hNote} numberOfLines={1}>{[earnedShown(task, rates, earned) ? fmtMoney(sessionMoney(s, task, rates), LANG, currency) : null, s.manual ? t(LANG, 'task.manual_mark') : null].filter(Boolean).join(' · ')}</Text>
                      <Text style={styles.hDur}>{fmtShort(s.ms, LANG)}</Text>
                    </Tap>
                  ))}
                </View>
              ))}
              <Tap style={[styles.hrow, { justifyContent: 'center', gap: 8 }]} onPress={() => openSheet(<SessionSheet task={task} index={null} />)} accessibilityRole="button">
                <Icon name="plus" size={14} color={colors.textDim} />
                <Text style={[styles.hNote, { flex: 0, color: colors.textDim, fontWeight: '600' }]}>{t(LANG, 'task.add_manual')}</Text>
              </Tap>
            </>
          )}
        </KeyboardAwareScrollView>

        {/* Низ закреплён: прокручивается только содержимое вкладки. */}
        {expanded && tab === 'details' ? (
          <View style={[styles.sheetFoot, styles.actions]}>
            <PrimaryButton variant={task.done ? 'ghost' : 'primary'} icon="check" title={t(LANG, task.done ? 'task.reopen' : 'task.mark_done')} onPress={() => setTaskDone(taskId, !task.done)} style={{ flex: 1 }} shrinkText />
            <Tap scale={0.9} style={styles.deleteBtn} onPress={onDelete} accessibilityRole="button" accessibilityLabel={t(LANG, 'task.delete_title')}>
              <Icon name="trash" size={18} color={colors.danger} />
            </Tap>
          </View>
        ) : null}
        {expanded && tab === 'history' ? (
          <View style={styles.sheetFoot}>
            <PrimaryButton title={t(LANG, 'task.export_history')} variant="ghost" icon="download" onPress={onExport} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: screenPadding, paddingTop: 4 },
  title: { color: colors.text, fontSize: 22, fontFamily: displayFamily.bold, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 4, lineHeight: 28 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  tagsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 6, paddingBottom: 4 },
  tagAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 9, borderRadius: 999, backgroundColor: colors.panel },
  tagAddText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  // Точка «сохранено» — в конце строки тегов, справа.
  savedDot: { marginLeft: 'auto' },
  // Заметки: верх поля — его верх в прокрутке (onLayout), поэтому отступ —
  // полем снаружи, а не внутри.
  notes: { marginTop: spacing.sm },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  // Воздух: от ручки до таймера и от таймера до низа свёрнутого шита.
  sheetHead: { paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: spacing.lg },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.raise, alignSelf: 'center', marginBottom: spacing.lg },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Стоит — panel2; идёт — налит акцентом (это рисует LiquidButton).
  timerBtn: { width: 58, height: 58, borderRadius: taskControlRadius, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  clock: { color: colors.text, fontSize: 30, lineHeight: 34, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  earnRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  earned: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  earnSub: { color: colors.textFaint, fontSize: 12, flexShrink: 1 },
  // Вкладки шита — общий Segmented: дорожка panel2, подписи тише обычного.
  segWrap: { marginHorizontal: screenPadding },
  seg: { backgroundColor: colors.panel2 },
  segText: { color: colors.textFaint },
  sheetBody: { paddingHorizontal: screenPadding, paddingTop: 6, paddingBottom: spacing.lg },
  // Подпись дня в «Истории».
  label: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 12, paddingBottom: 6 },
  // «Сведения»: блоки с подписью (Block) друг под другом, как в листах.
  details: { gap: spacing.md, paddingTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  // Срок в строке «Дедлайн» — жирным, цвет по состоянию, как в строках задач:
  // просрочен — danger, в пределах суток — accentInk, дальше — textDim.
  // Прежде здесь брался токен warn — в палитре его нет, и срок рисовался
  // чёрным системным цветом.
  dueSet: { color: colors.textDim, fontWeight: '700' },
  dueOverdue: { color: colors.danger },
  dueSoon: { color: colors.accentInk },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deleteBtn: { width: buttonHeight, height: buttonHeight, borderRadius: buttonRadius, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  histHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: 10 },
  histCount: { color: colors.textDim, fontSize: 13 },
  histNum: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  hrowFirst: { borderTopWidth: 0 },
  hrowRun: { backgroundColor: colors.accentMuted, marginHorizontal: -screenPadding, paddingHorizontal: screenPadding, borderTopWidth: 0, borderRadius: radius.sm, marginTop: 8 },
  hTime: { width: 96, color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  hNote: { flex: 1, color: colors.textFaint, fontSize: 12 },
  hDur: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  sheetFoot: { paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.panel },
});

// Страница задачи (макет B2): сверху заголовок, теги и содержимое заметок
// (тап — редактор на весь экран), снизу всегда виден шит с таймером и
// заработком. Шит тянется вверх и показывает две вкладки: «Сведения»
// (статус, версия, дедлайн, повторение, теги, проект, ставка) и «История»
// (записи по дням, «Запись вручную», внизу закреплён «Экспорт истории»).
//
// Заметки пишутся в полноэкранном редакторе (EditorScreen): там у
// редактора вся высота, своя прокрутка и рисование пером без спора с
// прокруткой страницы. Здесь — предпросмотр.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Switch, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS, interpolate } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import DocEditor from '../components/DocEditor';
import DocCore from '../core/doc.js';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import MenuSheet from '../components/MenuSheet';
import DueSheet from '../components/DueSheet';
import TagPickerSheet from '../components/TagPickerSheet';
import RepeatSheet from '../components/RepeatSheet';
import SessionSheet from '../components/SessionSheet';
import { TagBadgeRow } from '../components/TagBadge';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtClock, fmtMoney, fmtShort, fmtWhen, earnedOf, earnedShown, effectiveRate, parseNum, sessionMoney, capFirst, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import { buildTaskSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { orderedStatuses } from '../lib/statuses';
import { tagsOf } from '../lib/tags';
import { dueShort } from '../lib/due';
import { presetRule, isPresetRule, REPEAT_PRESETS, hm } from '../lib/sessions';
import { dayKey } from '../lib/calendarMath';
import Repeat from '../core/repeat.js';
import Versions from '../core/versions.js';
import CoreMoney from '../core/money.js';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
// Свёрнутый шит: ручка, таймер 58, переключатель вкладок.
const SHEET_COLLAPSED = 158;
const SPRING = { damping: 26, stiffness: 260, mass: 0.8, overshootClamping: true };

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
  const togglePinTask = useAppStore((s) => s.togglePinTask);
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
  const isRunning = !!activeTimer && activeTimer.taskId === taskId;
  useTicker(isRunning);

  const [tab, setTab] = useState('details');
  const [title, setTitle] = useState(task ? task.title : '');
  const [rateText, setRateText] = useState(task && task.rate != null ? String(task.rate) : '');
  const titleTimer = useRef(null);
  useEffect(() => () => clearTimeout(titleTimer.current), []);

  // --- шит: два положения, тянется за верхнюю часть ---
  const sheetTop = insets.top + 48;
  const sheetH = Math.max(SHEET_COLLAPSED + 200, screenH - sheetTop);
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
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, collapsedY], [0.5, 0]) }));
  const bodyStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, collapsedY * 0.5, collapsedY], [1, 1, 0]) }));
  const openTab = (key) => { setTab(key); if (!expanded) snapTo(true); };

  function openEditor() { navigation.navigate('Editor', { kind: 'task', id: taskId }); }
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
          { key: 'project', icon: 'cards', label: t(LANG, 'task.open_project'), onPress: onOpenProject },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onExport },
          { key: 'delete', icon: 'trash', label: t(LANG, 'task.delete_title'), danger: true, separated: true, onPress: onDelete },
        ]}
      />,
    );
  }
  function onTitleChange(v) {
    setTitle(v);
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => updateTask(taskId, { title: v }), 400);
  }
  function onRateChange(v) {
    setRateText(v);
    updateTask(taskId, { rate: v.trim() === '' ? null : parseNum(v) });
  }
  function onOpenDue() {
    openSheet(
      <DueSheet
        task={task}
        lang={LANG}
        onApply={(patch) => { setTaskDue(taskId, patch); closeSheet(); }}
        onClear={() => { setTaskDue(taskId, { dueAt: null, remindAt: null, remindOffsetMin: null }); closeSheet(); }}
      />,
    );
  }
  function onOpenTags() {
    openSheet(<TagPickerSheet value={task.tagIds || []} projectId={task.projectId} onChange={(ids) => setTaskTags(taskId, ids)} />);
  }
  function onCustomRepeat() {
    if (!task.dueAt) { showToast(t(LANG, 'repeat.needs_due')); return; }
    openSheet(
      <RepeatSheet lang={LANG} dueAt={task.dueAt} rule={task.repeat} onApply={(rule) => setTaskRepeat(taskId, rule)} onClear={() => setTaskRepeat(taskId, null)} />,
    );
  }
  function onPreset(p) {
    if (!task.dueAt) { showToast(t(LANG, 'repeat.needs_due')); return; }
    setTaskRepeat(taskId, p ? presetRule(p.freq, p.weekdays) : null);
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
  const notesEmpty = DocCore.isDocEmpty(DocCore.readNotes(task.notes));
  const rateSource = task.rate != null ? 'task.rate_own' : (project && project.rate != null && project.rate !== '') ? 'task.rate_by_project' : 'task.rate_default';
  const repeatDesc = Repeat.describeRepeat(task.repeat);
  const repeatText = repeatDesc
    ? capFirst(t(LANG, repeatDesc.key, { ...repeatDesc.vars, days: (repeatDesc.vars.days || []).map((d) => t(LANG, WEEKDAY_KEY[d])).join(', ') }))
    : '';
  const isCustomRepeat = !!task.repeat && !REPEAT_PRESETS.some((p) => isPresetRule(task.repeat, p.freq, p.weekdays));

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
      <Pressable
        style={[styles.timerBtn, isRunning && styles.timerBtnOn]}
        onPress={() => (isRunning ? stopTimer() : startTimer(taskId))}
        accessibilityRole="button"
        accessibilityLabel={t(LANG, isRunning ? 'timer.stop' : 'timer.start')}
      >
        <Icon name={isRunning ? 'stop' : 'play'} size={22} color={isRunning ? colors.accentText : colors.text} />
      </Pressable>
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

  const chip = (label, on, onPress, dot) => (
    <Pressable key={label} onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()} style={styles.hbtn} accessibilityLabel={t(LANG, 'common.back')}>
          <Icon name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Pressable style={styles.crumb} onPress={onOpenProject} hitSlop={6}>
          {project ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
          <Text style={styles.crumbText} numberOfLines={1}>{project ? project.name : ''}</Text>
          {own.length && task.statusId ? <Text style={styles.crumbFaint} numberOfLines={1}>› {(own.find((s) => s.id === task.statusId) || {}).name || ''}</Text> : null}
        </Pressable>
        <Pressable hitSlop={6} onPress={() => setTaskDone(taskId, !task.done)} style={[styles.hbtn, task.done && styles.hbtnOn]} accessibilityRole="button" accessibilityLabel={t(LANG, task.done ? 'task.reopen' : 'task.mark_done')}>
          <Icon name="check" size={17} color={task.done ? colors.accentText : colors.textDim} />
        </Pressable>
        <Pressable hitSlop={6} onPress={onOpenMenu} style={styles.hbtn} accessibilityLabel={t(LANG, 'project.opts')}>
          <Icon name="kebab" size={17} color={colors.textDim} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: headH + insets.bottom + spacing.lg }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput
          style={[styles.title, task.done && styles.titleDone]}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t(LANG, 'task.title_ph')}
          placeholderTextColor={colors.textFaint}
          multiline
        />
        <View style={styles.tagsRow}>
          {taskTags.length ? <TagBadgeRow tags={taskTags} onRemove={(tag) => setTaskTags(taskId, (task.tagIds || []).filter((x) => x !== tag.id))} /> : null}
          <Pressable style={styles.tagAdd} onPress={onOpenTags} hitSlop={6} accessibilityLabel={t(LANG, 'tag.pick')}>
            <Icon name="plus" size={10} color={colors.textFaint} />
            <Text style={styles.tagAddText}>{t(LANG, 'tag.pick').toLowerCase()}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.notes} onPress={openEditor} accessibilityRole="button" accessibilityLabel={t(LANG, 'editor.open')}>
          {notesEmpty
            ? <Text style={styles.notesEmpty}>{t(LANG, 'editor.empty')}</Text>
            : <DocEditor preview content={DocCore.readNotes(task.notes)} lang={LANG} onOpen={openEditor} />}
          {notesEmpty ? null : <Text style={styles.tapHint}>{t(LANG, 'task.tap_to_edit')}</Text>}
        </Pressable>
      </ScrollView>

      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents={expanded ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => snapTo(false)} accessibilityLabel={t(LANG, 'common.back')} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { height: sheetH }, sheetStyle]}>
        <GestureDetector gesture={pan}>
          <View collapsable={false} style={styles.sheetHead} onLayout={(e) => setHeadH(Math.round(e.nativeEvent.layout.height))}>
            <View style={styles.handle} />
            {timerBlock}
            <View style={styles.seg}>
              {[['details', t(LANG, 'task.details')], ['history', t(LANG, 'task.history_n', { n: sessions.length })]].map(([key, label]) => (
                <Pressable key={key} onPress={() => openTab(key)} style={[styles.segBtn, expanded && tab === key && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: expanded && tab === key }}>
                  <Text style={[styles.segText, expanded && tab === key && styles.segTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </GestureDetector>

        <Animated.ScrollView style={[{ flex: 1 }, bodyStyle]} contentContainerStyle={styles.sheetBody} scrollEnabled={expanded} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {tab === 'details' ? (
            <>
              <Text style={styles.label}>{t(LANG, 'task.status_label')}</Text>
              <View style={styles.chips}>{own.map((s) => chip(s.name, task.statusId === s.id, () => setTaskStatus(taskId, s.id), s.color))}</View>

              {projectVersions.length ? (
                <>
                  <Text style={styles.label}>{t(LANG, 'version.label')}</Text>
                  <View style={styles.chips}>
                    {chip(t(LANG, 'version.none'), !task.versionId, () => setTaskVersion(taskId, null))}
                    {projectVersions.map((v) => chip(v.name, task.versionId === v.id, () => setTaskVersion(taskId, v.id)))}
                  </View>
                </>
              ) : null}

              <View style={styles.rows}>
                <Pressable style={[styles.row, styles.rowFirst]} onPress={onOpenDue} accessibilityRole="button">
                  <Icon name="calendar" size={17} color={colors.textDim} />
                  <Text style={styles.rowK}>{t(LANG, 'due.label')}</Text>
                  <Text style={[styles.rowV, task.dueAt && styles.rowVWarn]} numberOfLines={1}>{task.dueAt ? `${dueShort(task, LANG)}, ${hm(task.dueAt)}` : t(LANG, 'due.none')}</Text>
                  <Icon name="chevron-right" size={12} color={colors.textFaint} />
                </Pressable>
                {task.dueAt ? (
                  <View style={styles.row}>
                    <Icon name="bell" size={17} color={colors.textDim} />
                    <Text style={styles.rowK}>{t(LANG, 'task.remind_hour')}</Text>
                    <Switch
                      value={task.remindOffsetMin === 60}
                      onValueChange={(v) => setTaskDue(taskId, { remindOffsetMin: v ? 60 : null })}
                      trackColor={{ false: colors.raise, true: colors.accent }} ios_backgroundColor={colors.raise} thumbColor={colors.textOnColor}
                      accessibilityLabel={t(LANG, 'task.remind_hour')}
                    />
                  </View>
                ) : null}
              </View>

              <Text style={styles.label}>{t(LANG, 'repeat.label')}</Text>
              <View style={styles.chips}>
                {chip(t(LANG, 'repeat.none'), !task.repeat, () => onPreset(null))}
                {REPEAT_PRESETS.map((p) => chip(t(LANG, `repeat.${p.key}`), isPresetRule(task.repeat, p.freq, p.weekdays), () => onPreset(p)))}
                {chip(isCustomRepeat ? repeatText : t(LANG, 'repeat.custom'), isCustomRepeat, onCustomRepeat)}
              </View>

              <Text style={styles.label}>{t(LANG, 'tag.pick')}</Text>
              <View style={styles.chips}>
                {taskTags.length ? <TagBadgeRow tags={taskTags} onRemove={(tag) => setTaskTags(taskId, (task.tagIds || []).filter((x) => x !== tag.id))} /> : null}
                <Pressable style={styles.chip} onPress={onOpenTags}><Text style={styles.chipText}>+ {t(LANG, 'tag.pick').toLowerCase()}</Text></Pressable>
              </View>

              <View style={styles.rows}>
                <Pressable style={[styles.row, styles.rowFirst]} onPress={onOpenProject} accessibilityRole="button">
                  <Icon name="cards" size={17} color={colors.textDim} />
                  <Text style={styles.rowK}>{t(LANG, 'board.pick_project')}</Text>
                  {project ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
                  <Text style={styles.rowV} numberOfLines={1}>{project ? project.name : ''}</Text>
                  <Icon name="chevron-right" size={12} color={colors.textFaint} />
                </Pressable>
                <View style={styles.row}>
                  <Icon name="wallet" size={17} color={colors.textDim} />
                  <Text style={styles.rowK}>{t(LANG, 'task.rate_label')}</Text>
                  <TextInput
                    style={styles.rateInput}
                    value={rateText}
                    onChangeText={onRateChange}
                    keyboardType="decimal-pad"
                    placeholder={String(baseRate || 0)}
                    placeholderTextColor={colors.textFaint}
                    accessibilityLabel={t(LANG, 'task.rate_label')}
                  />
                  <Text style={styles.rowV}>{sym}{t(LANG, 'rate.per_hour')} · {t(LANG, rateSource)}</Text>
                </View>
                <View style={styles.row}>
                  <Icon name="pin" size={17} color={colors.textDim} />
                  <Text style={styles.rowK}>{t(LANG, 'task.pin_top')}</Text>
                  <Switch
                    value={!!task.pinnedAt}
                    onValueChange={() => togglePinTask(taskId)}
                    trackColor={{ false: colors.raise, true: colors.accent }} ios_backgroundColor={colors.raise} thumbColor={colors.textOnColor}
                    accessibilityLabel={t(LANG, 'task.pin_top')}
                  />
                </View>
              </View>

              <View style={styles.actions}>
                <PrimaryButton compact variant="ghost" icon={task.done ? undefined : 'check'} title={t(LANG, task.done ? 'task.reopen' : 'task.mark_done')} onPress={() => setTaskDone(taskId, !task.done)} style={{ flex: 1 }} shrinkText />
                <PrimaryButton compact variant="danger" icon="trash" title={t(LANG, 'task.delete_title')} onPress={onDelete} shrinkText />
              </View>
            </>
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
              {historyDays.map((g) => (
                <View key={g.key}>
                  <Text style={styles.label}>{g.label}</Text>
                  {g.rows.map(({ s, i }, j) => (
                    <Pressable key={i} style={[styles.hrow, j === 0 && styles.hrowFirst]} onPress={() => openSheet(<SessionSheet task={task} index={i} />)} onLongPress={() => onDeleteSession(i)} accessibilityRole="button">
                      <Text style={styles.hTime}>{hm(s.start)} – {s.end ? hm(s.end) : '…'}</Text>
                      <Text style={styles.hNote} numberOfLines={1}>{[earnedShown(task, rates, earned) ? fmtMoney(sessionMoney(s, task, rates), LANG, currency) : null, s.manual ? t(LANG, 'task.manual_mark') : null].filter(Boolean).join(' · ')}</Text>
                      <Text style={styles.hDur}>{fmtShort(s.ms, LANG)}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
              <Pressable style={[styles.hrow, { justifyContent: 'center', gap: 8 }]} onPress={() => openSheet(<SessionSheet task={task} index={null} />)} accessibilityRole="button">
                <Icon name="plus" size={14} color={colors.textDim} />
                <Text style={[styles.hNote, { flex: 0, color: colors.textDim, fontWeight: '600' }]}>{t(LANG, 'task.add_manual')}</Text>
              </Pressable>
            </>
          )}
        </Animated.ScrollView>

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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  hbtn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  hbtnOn: { backgroundColor: colors.accent },
  crumb: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  crumbText: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  crumbFaint: { color: colors.textFaint, fontSize: 13, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  body: { paddingHorizontal: spacing.lg, paddingTop: 4 },
  title: { color: colors.text, fontSize: 22, fontFamily: displayFamily.bold, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 4, lineHeight: 28 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  tagsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 6, paddingBottom: 4 },
  tagAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 9, borderRadius: 999, backgroundColor: colors.panel },
  tagAddText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  notes: { paddingTop: 6 },
  notesEmpty: { color: colors.textDim, fontSize: 15, lineHeight: 22 },
  tapHint: { color: colors.textFaint, fontSize: 12.5, marginTop: spacing.sm },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetHead: { paddingHorizontal: spacing.md, paddingTop: 8 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.raise, alignSelf: 'center', marginBottom: 10 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timerBtn: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  timerBtnOn: { backgroundColor: colors.accent },
  clock: { color: colors.text, fontSize: 30, lineHeight: 34, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  earnRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  earned: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  earnSub: { color: colors.textFaint, fontSize: 12, flexShrink: 1 },
  seg: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: radius.md, backgroundColor: colors.panel2, marginTop: 12 },
  segBtn: { flex: 1, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segOn: { backgroundColor: colors.raise },
  segText: { color: colors.textFaint, fontSize: 12.5, fontWeight: '500' },
  segTextOn: { color: colors.text, fontWeight: '600' },
  sheetBody: { paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: insets.bottom + spacing.xxl },
  label: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 12, paddingBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.panel2 },
  chipOn: { backgroundColor: colors.raise },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '500', maxWidth: 200 },
  chipTextOn: { color: colors.text, fontWeight: '600' },
  rows: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowFirst: { borderTopWidth: 0 },
  rowK: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  rowV: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  rowVWarn: { color: colors.warn, fontWeight: '700' },
  rateInput: { width: 84, textAlign: 'right', color: colors.text, fontSize: fontSize.sm, backgroundColor: colors.panel2, borderWidth: 0, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 8 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  histHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: 10 },
  histCount: { color: colors.textDim, fontSize: 13 },
  histNum: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  hrowFirst: { borderTopWidth: 0 },
  hrowRun: { backgroundColor: colors.accentMuted, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, borderTopWidth: 0, borderRadius: radius.sm, marginTop: 8 },
  hTime: { width: 96, color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  hNote: { flex: 1, color: colors.textFaint, fontSize: 12 },
  hDur: { color: colors.text, fontSize: fontSize.sm, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  sheetFoot: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.panel },
});

// Страница задачи — три острова, как на десктопе после «островов»:
// название, теги и заметки; таймер с квадратной кнопкой; свойства и история
// в одном острове с вкладками — переключается только он.
//
// Заметки пишутся в полноэкранном редакторе (EditorScreen): там у
// редактора вся высота, своя прокрутка и рисование пером без спора с
// прокруткой страницы. Здесь — предпросмотр, касание открывает редактор.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import DocEditor from '../components/DocEditor';
import DocCore from '../core/doc.js';
import Island, { IslandRow } from '../components/Island';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { fmtClock, fmtMoney, fmtWhen, fmtShort, earnedOf, earnedShown, effectiveRate, parseNum, sessionMoney, capFirst, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import { useRates, currencyOf } from '../hooks/useRates';
import TaskClock from '../components/TaskClock';
import { buildTaskSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import MenuSheet from '../components/MenuSheet';
import PrimaryButton from '../components/PrimaryButton';
import { openSheet, closeSheet } from '../store/useSheetStore';
import DueSheet from '../components/DueSheet';
import TagPickerSheet from '../components/TagPickerSheet';
import PickerSheet from '../components/PickerSheet';
import RepeatSheet from '../components/RepeatSheet';
import SessionSheet from '../components/SessionSheet';
import { orderedStatuses, getStatus } from '../lib/statuses';
import Repeat from '../core/repeat.js';
import Versions from '../core/versions.js';
import CoreMoney from '../core/money.js';
import { TagBadgeRow } from '../components/TagBadge';
import { tagsOf } from '../lib/tags';
import { dueShort, remindKey, REMIND_LABEL } from '../lib/due';
import { presetRule, isPresetRule, REPEAT_PRESETS, hm } from '../lib/sessions';
import { useTicker } from '../hooks/useTicker';
import Icon from '../components/Icon';
import { useColors, spacing, radius, fontSize, typography, displayFamily, gap } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

// Дни недели в подписи правила: 0 — воскресенье, как в Date.getDay().
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

export default function TaskDetailScreen({ route, navigation }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { taskId } = route.params;
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const LANG = settings.lang;
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
  const status = task ? getStatus(statuses, task.statusId) : null;
  const projectVersions = task ? Versions.versionsOf(versions, task.projectId) : [];
  const version = task ? Versions.getVersion(versions, task.versionId) : null;
  // Правило словами и ближайший срок — чтобы не открывать лист ради
  // вопроса «а как оно сейчас настроено».
  const repeatDesc = task ? Repeat.describeRepeat(task.repeat) : null;
  const repeatSummary = repeatDesc
    ? capFirst(t(LANG, repeatDesc.key, {
      ...repeatDesc.vars,
      days: (repeatDesc.vars.days || []).map((d) => t(LANG, WEEKDAY_KEY[d])).join(', '),
    }))
    : '';
  const repeatNext = (() => {
    if (!task || !task.repeat || !task.dueAt) return '';
    const base = new Date(task.dueAt).getTime();
    const next = Repeat.upcomingDue(task.repeat, base, base + 400 * 86400000, 1)[0];
    if (!next) return t(LANG, 'repeat.series_done');
    return t(LANG, 'repeat.next', { date: new Date(next).toLocaleDateString(LOCALE_MAP[LANG] || 'ru-RU', { day: 'numeric', month: 'short' }) });
  })();
  const isRunning = !!activeTimer && activeTimer.taskId === taskId;
  useTicker(isRunning);

  const [tab, setTab] = useState('props');
  const [title, setTitle] = useState(task ? task.title : '');
  const [rateText, setRateText] = useState(task && task.rate != null ? String(task.rate) : '');
  const titleTimer = useRef(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  function openEditor() {
    navigation.navigate('Editor', { kind: 'task', id: taskId });
  }

  function onExport() {
    if (!task) return;
    runExport(
      `${project ? project.name : t(LANG, 'export.project_fallback')} — ${task.title || t(LANG, 'export.task_fallback')} — ${new Date().toISOString().slice(0, 10)}`,
      buildTaskSheets(task, project, LANG, currency, rates),
      LANG,
      showToast,
    );
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable hitSlop={6} onPress={onOpenMenu} style={styles.menuBtn} accessibilityLabel={t(LANG, 'project.opts')}>
          <Icon name="kebab" size={18} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, task, colors, LANG]);

  function onOpenMenu() {
    openSheet(
      <MenuSheet
        title={(task && task.title) || t(LANG, 'task.no_name')}
        items={[
          { key: 'project', icon: 'grid', label: t(LANG, 'task.open_project'), onPress: onOpenProject },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onExport },
          { key: 'delete', icon: 'trash', label: t(LANG, 'task.delete_title'), danger: true, separated: true, onPress: onDelete },
        ]}
      />,
    );
  }

  /** Открыть проект задачи. Если мы пришли с его же страницы, возвращаемся
   *  назад, а не кладём в стек второй такой же экран: иначе «назад» потом
   *  проводит через ту же страницу дважды. */
  function onOpenProject() {
    if (!project) return;
    const state = navigation.getState();
    const prev = state.routes[state.index - 1];
    if (prev && prev.name === 'Project' && prev.params && prev.params.projectId === project.id) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Project', { projectId: project.id });
  }

  function onDelete() {
    const msg = task && task.title
      ? t(LANG, 'confirm.delete_task_named', { name: task.title })
      : t(LANG, 'confirm.delete_task');
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
      message: msg,
      actions: [
        { label: t(LANG, 'task.delete_title'), destructive: true, onPress: () => { deleteTask(taskId); navigation.goBack(); } },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
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
    openSheet(
      <TagPickerSheet
        value={task.tagIds || []}
        projectId={task.projectId}
        onChange={(ids) => setTaskTags(taskId, ids)}
      />,
    );
  }

  function onOpenStatus() {
    const own = orderedStatuses(statuses, task.projectId);
    if (!own.length) return;
    openSheet(
      <PickerSheet
        title={t(LANG, 'task.status_label')}
        value={task.statusId}
        options={own.map((s) => ({ value: s.id, label: s.name }))}
        onSelect={(id) => setTaskStatus(taskId, id)}
      />,
    );
  }

  function onOpenVersion() {
    openSheet(
      <PickerSheet
        title={t(LANG, 'version.label')}
        value={task.versionId || ''}
        options={[
          { value: '', label: t(LANG, 'version.none') },
          ...projectVersions.map((v) => ({ value: v.id, label: v.name })),
        ]}
        onSelect={(id) => setTaskVersion(taskId, id || null)}
      />,
    );
  }

  /** Повторение — сперва пресеты, как в меню на десктопе; «Настроить…»
   *  открывает полный лист. */
  function onOpenRepeat() {
    // Повторение считается от дедлайна — предлагать его раньше было бы
    // обманом: возвращаться задаче некуда.
    if (!task.dueAt) { showToast(t(LANG, 'repeat.needs_due')); return; }
    const items = [
      { key: 'none', icon: !task.repeat ? 'check' : undefined, label: t(LANG, 'repeat.none'), onPress: () => setTaskRepeat(taskId, null) },
      ...REPEAT_PRESETS.map((p) => ({
        key: p.key,
        icon: isPresetRule(task.repeat, p.freq, p.weekdays) ? 'check' : undefined,
        label: t(LANG, `repeat.${p.key}`),
        onPress: () => setTaskRepeat(taskId, presetRule(p.freq, p.weekdays)),
      })),
      {
        key: 'custom', icon: 'settings', label: t(LANG, 'repeat.custom'), separated: true,
        onPress: () => openSheet(
          <RepeatSheet
            lang={LANG}
            dueAt={task.dueAt}
            rule={task.repeat}
            onApply={(rule) => setTaskRepeat(taskId, rule)}
            onClear={() => setTaskRepeat(taskId, null)}
          />,
        ),
      },
    ];
    openSheet(<MenuSheet title={t(LANG, 'repeat.label')} items={items} />);
  }

  function onAddSession() {
    openSheet(<SessionSheet task={task} index={null} />);
  }
  function onEditSession(index) {
    openSheet(<SessionSheet task={task} index={index} />);
  }

  useEffect(() => () => { clearTimeout(titleTimer.current); }, []);

  if (!task) return null;

  const elapsedMs = isRunning ? Date.now() - new Date(activeTimer.startedAt).getTime() + (task.totalMs || 0) : (task.totalMs || 0);
  const earned = earnedOf(task, rates, activeTimer);
  const rateNow = effectiveRate(task, rates);
  const baseRate = CoreMoney.baseRate(task, rates);
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  const sessions = [...(task.sessions || [])].map((s, i) => ({ s, i })).sort((a, b) => new Date(b.s.start) - new Date(a.s.start));
  const notesEmpty = DocCore.isDocEmpty(DocCore.readNotes(task.notes));

  // На Android KeyboardAvoidingView зависит от того, как ОС резайзит окно
  // (windowSoftInputMode) — под Expo Go этот манифест не наш. Считаем сами:
  // высота клавиатуры уже отслеживается выше, используем её напрямую как
  // paddingBottom прокрутки, пока открыты свойства с полем ставки.
  const isIOS = Platform.OS === 'ios';
  const androidKeyboardOffset = !isIOS && tab === 'props' ? keyboardHeight : 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={isIOS ? 'padding' : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, androidKeyboardOffset ? { paddingBottom: androidKeyboardOffset } : null]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Остров 1: из какого проекта задача, название, теги, заметки. */}
        <Island>
          {project ? (
            <Pressable style={styles.crumb} onPress={onOpenProject} hitSlop={6}>
              <View style={[styles.crumbDot, { backgroundColor: project.color }]} />
              <Text style={styles.crumbName} numberOfLines={1}>{project.name}</Text>
              <Icon name="chevron-right" size={11} color={colors.textFaint} />
            </Pressable>
          ) : null}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={onTitleChange}
            placeholder={t(LANG, 'task.title_ph')}
            placeholderTextColor={colors.textFaint}
            multiline
          />
          <View style={styles.tagsRow}>
            {taskTags.length ? (
              <TagBadgeRow tags={taskTags} onRemove={(tag) => setTaskTags(taskId, (task.tagIds || []).filter((x) => x !== tag.id))} />
            ) : null}
            <Pressable style={styles.tagAdd} onPress={onOpenTags} hitSlop={6} accessibilityLabel={t(LANG, 'tag.pick')}>
              <Icon name="plus" size={11} color={colors.textDim} />
              {taskTags.length ? null : <Text style={styles.tagAddText}>{t(LANG, 'tag.pick')}</Text>}
            </Pressable>
          </View>
          <View style={styles.notes}>
            {notesEmpty ? (
              <Pressable style={styles.notesEmpty} onPress={openEditor}>
                <Text style={styles.notesEmptyText}>{t(LANG, 'editor.empty')}</Text>
              </Pressable>
            ) : (
              <DocEditor preview content={DocCore.readNotes(task.notes)} lang={LANG} onOpen={openEditor} />
            )}
            <Pressable style={styles.openEditor} onPress={openEditor}>
              <Text style={styles.openEditorText}>{t(LANG, 'editor.open')}</Text>
              <Icon name="chevron-right" size={12} color={colors.accentInk} />
            </Pressable>
          </View>
        </Island>

        {/* Остров 2: таймер. Квадратная кнопка — старт, в работе — стоп. */}
        <Island>
          <View style={styles.timerRow}>
            <Pressable
              style={[styles.timerBtn, isRunning && styles.timerBtnOn]}
              onPress={() => (isRunning ? stopTimer() : startTimer(taskId))}
              accessibilityRole="button"
              accessibilityLabel={t(LANG, isRunning ? 'timer.stop' : 'timer.start')}
            >
              <Icon name={isRunning ? 'stop' : 'play'} size={18} color={isRunning ? colors.accentText : colors.text} />
            </Pressable>
            <TaskClock task={task} elapsedMs={elapsedMs} />
          </View>
          <Text style={styles.timerSub} numberOfLines={1}>
            {isRunning
              ? t(LANG, 'timer.recording', { time: fmtClock(Date.now() - new Date(activeTimer.startedAt).getTime()) })
              : t(LANG, 'timer.sub_default')}
          </Text>
        </Island>

        {/* Остров 3: свойства и история — переключается только он. */}
        <Island>
          <View style={styles.tabRow}>
            {['props', 'history'].map((key) => (
              <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                  {t(LANG, key === 'props' ? 'task.props' : 'tabs.history')}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'props' ? (
            <View>
              <IslandRow first onPress={onOpenStatus}>
                <Text style={styles.propLabel}>{t(LANG, 'task.status_label')}</Text>
                <View style={{ flex: 1 }} />
                {status ? (
                  <View style={styles.statusValue}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={styles.propValue} numberOfLines={1}>{status.name}</Text>
                  </View>
                ) : <Text style={styles.propNone}>{t(LANG, 'due.none')}</Text>}
                <Icon name="chevron-right" size={12} color={colors.textFaint} />
              </IslandRow>

              {/* Версия принадлежит проекту, поэтому строки нет, пока у него
                  не заведено ни одной. */}
              {projectVersions.length ? (
                <IslandRow onPress={onOpenVersion}>
                  <Text style={styles.propLabel}>{t(LANG, 'version.label')}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={version ? styles.propValue : styles.propNone} numberOfLines={1}>
                    {version ? version.name : t(LANG, 'version.none')}
                  </Text>
                  <Icon name="chevron-right" size={12} color={colors.textFaint} />
                </IslandRow>
              ) : null}

              {/* Ставка: своя у задачи, иначе проекта или общая — подсказка
                  говорит, какая. Под строкой — расчёт, как на десктопе. */}
              <IslandRow style={styles.rateRow}>
                <View style={styles.rateMain}>
                  <Text style={styles.propLabel}>{t(LANG, 'task.rate_label')}</Text>
                  <View style={{ flex: 1 }} />
                  <TextInput
                    style={styles.rateInput}
                    value={rateText}
                    onChangeText={onRateChange}
                    keyboardType="decimal-pad"
                    placeholder={String(baseRate || 0)}
                    placeholderTextColor={colors.textFaint}
                  />
                  <Text style={styles.rateUnit}>{sym}{t(LANG, 'rate.per_hour')}</Text>
                </View>
                <Text style={styles.calc} numberOfLines={1}>
                  {earnedShown(task, rates, earned)
                    ? `${t(LANG, 'money.calc', { time: fmtShort(elapsedMs, LANG), rate: moneyFmt(LANG).format(rateNow), cur: sym })} ${fmtMoney(earned, LANG, currency)}`
                    : (task.rate == null && project && project.rate != null && project.rate !== '')
                      ? t(LANG, 'money.project_rate')
                      : t(LANG, 'money.no_rate')}
                </Text>
              </IslandRow>

              <IslandRow onPress={onOpenDue}>
                <View style={styles.propMain}>
                  <Text style={styles.propLabel}>{t(LANG, 'due.label')}</Text>
                  {task.dueAt ? <Text style={styles.propSub}>{t(LANG, REMIND_LABEL[remindKey(task)])}</Text> : null}
                </View>
                {task.dueAt ? (
                  <Text style={styles.propValue}>{`${dueShort(task, LANG)}, ${hm(task.dueAt)}`}</Text>
                ) : (
                  <Text style={styles.propNone}>{t(LANG, 'due.none')}</Text>
                )}
                <Icon name="chevron-right" size={12} color={colors.textFaint} />
              </IslandRow>

              {/* Повторение — последним: оно про будущее задачи, а не про
                  то, чем она является сейчас. Без дедлайна строка тихая. */}
              <IslandRow onPress={onOpenRepeat}>
                <View style={styles.propMain}>
                  <Text style={styles.propLabel}>{t(LANG, 'repeat.label')}</Text>
                  {repeatNext ? <Text style={styles.propSub}>{repeatNext}</Text> : null}
                </View>
                <Text style={task.repeat ? styles.propValue : styles.propNone} numberOfLines={1}>
                  {repeatSummary || t(LANG, 'repeat.none')}
                </Text>
                <Icon name="chevron-right" size={12} color={colors.textFaint} />
              </IslandRow>

              <View style={styles.actions}>
                <PrimaryButton
                  compact
                  variant="ghost"
                  icon={task.done ? undefined : 'check'}
                  title={t(LANG, task.done ? 'task.reopen' : 'task.mark_done')}
                  onPress={() => setTaskDone(taskId, !task.done)}
                  style={styles.actionBtn}
                  shrinkText
                />
                <PrimaryButton
                  compact
                  variant="danger"
                  icon="trash"
                  title={t(LANG, 'common.delete')}
                  onPress={onDelete}
                  style={styles.actionBtn}
                  shrinkText
                />
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.historyHead}>
                <Text style={styles.historyCount}>{t(LANG, 'history.count', { n: sessions.length })}</Text>
                <View style={{ flex: 1 }} />
                <Pressable style={styles.addBtn} onPress={onAddSession} hitSlop={6} accessibilityRole="button">
                  <Icon name="plus" size={12} color={colors.accentText} />
                  <Text style={styles.addBtnText}>{t(LANG, 'history.add_short')}</Text>
                </Pressable>
              </View>
              {sessions.length === 0 ? <Text style={styles.historyEmpty}>{t(LANG, 'history.empty')}</Text> : null}
              {sessions.map(({ s, i }, k) => (
                <IslandRow key={`${s.start}-${i}`} first={k === 0} onPress={() => onEditSession(i)}>
                  <View style={styles.sessionMain}>
                    <Text style={styles.sessionWhen} numberOfLines={1}>
                      {fmtWhen(s.start, LANG)}{s.recovered ? t(LANG, 'session.recovered') : s.manual ? t(LANG, 'session.manual') : ''}
                    </Text>
                    <Text style={styles.sessionMoney}>{fmtMoney(sessionMoney(s, task, rates), LANG, currency)}</Text>
                  </View>
                  <Text style={styles.sessionDur}>{fmtClock(s.ms)}</Text>
                  <Pressable hitSlop={10} onPress={() => onDeleteSession(i)} style={styles.sessionDel} accessibilityLabel={t(LANG, 'session.delete_title')}>
                    <Icon name="x" size={13} color={colors.textFaint} />
                  </Pressable>
                </IslandRow>
              ))}
              {sessions.length ? (
                <PrimaryButton compact variant="ghost" icon="download" title={t(LANG, 'export.short')} onPress={onExport} style={styles.excelBtn} />
              ) : null}
            </View>
          )}
        </Island>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xl, gap },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  crumb: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 24 },
  crumbDot: { width: 8, height: 8, borderRadius: 2 },
  crumbName: { color: colors.textDim, fontSize: fontSize.sm, flexShrink: 1 },
  titleInput: { color: colors.text, fontSize: fontSize.lg, fontFamily: displayFamily.bold, paddingVertical: spacing.xs, paddingHorizontal: 0, backgroundColor: 'transparent' },
  tagsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  tagAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.panel2,
  },
  tagAddText: { color: colors.textDim, fontSize: fontSize.xs },
  notes: { marginTop: spacing.md, gap: spacing.sm },
  notesEmpty: { paddingVertical: spacing.lg, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.panel2 },
  notesEmptyText: { color: colors.textFaint, fontSize: fontSize.sm, textAlign: 'center' },
  openEditor: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: radius.md, backgroundColor: colors.panel2 },
  openEditorText: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '600' },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timerBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  timerBtnOn: { backgroundColor: colors.accent },
  timerSub: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  tabRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 3, marginBottom: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  tabTextActive: { color: colors.text },

  propMain: { flex: 1, minWidth: 0, gap: 1 },
  propLabel: { color: colors.textDim, fontSize: fontSize.sm },
  propSub: { color: colors.textFaint, fontSize: fontSize.xs },
  propValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  propNone: { color: colors.textFaint, fontSize: fontSize.sm },
  statusValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 2 },
  rateRow: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs },
  rateMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rateInput: {
    width: 88, textAlign: 'right', backgroundColor: colors.inputBg, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: fontSize.sm,
  },
  rateUnit: { color: colors.textFaint, fontSize: fontSize.xs },
  calc: { color: colors.textFaint, fontSize: fontSize.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionBtn: { flex: 1, width: undefined },

  historyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  historyCount: { color: colors.textFaint, fontSize: fontSize.xs },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.accent },
  addBtnText: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '700' },
  historyEmpty: { color: colors.textFaint, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.lg },
  sessionMain: { flex: 1, minWidth: 0, gap: 2 },
  sessionWhen: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sessionMoney: { color: colors.textFaint, fontSize: fontSize.xs },
  sessionDur: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sessionDel: { paddingLeft: spacing.xs },
  excelBtn: { marginTop: spacing.md },
});

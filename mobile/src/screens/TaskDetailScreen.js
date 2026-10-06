import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import RichTextEditor, { LinkPromptSheet } from '../components/RichTextEditor';
import EditorToolbar from '../components/EditorToolbar';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { fmtClock, fmtMoney, fmtWhen, earnedOf, parseNum, sessionMoney, capFirst } from '../lib/format';
import TaskClock from '../components/TaskClock';
import { buildTaskSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import MenuSheet from '../components/MenuSheet';
import { openSheet, closeSheet } from '../store/useSheetStore';
import DueSheet from '../components/DueSheet';
import TagPickerSheet from '../components/TagPickerSheet';
import PickerSheet from '../components/PickerSheet';
import RepeatSheet from '../components/RepeatSheet';
import { orderedStatuses, getStatus } from '../lib/statuses';
import Repeat from '../core/repeat.js';
import Versions from '../core/versions.js';
import { TagBadgeRow } from '../components/TagBadge';
import { tagsOf } from '../lib/tags';
import { dueShort, remindKey, REMIND_LABEL } from '../lib/due';
import { useTicker } from '../hooks/useTicker';
import Icon from '../components/Icon';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
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
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const LANG = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTaskDue = useAppStore((s) => s.setTaskDue);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const allTags = useAppStore((s) => s.tags);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const showToast = useAppStore((s) => s.showToast);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const setTaskVersion = useAppStore((s) => s.setTaskVersion);
  const setTaskRepeat = useAppStore((s) => s.setTaskRepeat);

  const task = getTask(tasks, taskId);
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
  const isRunning = activeTimer && activeTimer.taskId === taskId;
  useTicker(!!isRunning);

  const [tab, setTab] = useState('notes');
  const [title, setTitle] = useState(task ? task.title : '');
  const [rateText, setRateText] = useState(task && task.rate != null ? String(task.rate) : '');
  const [format, setFormat] = useState({});
  const titleTimer = useRef(null);
  const notesTimer = useRef(null);
  const editorRef = useRef(null);

  // Автопрокрутка страницы, чтобы курсор в заметках не уезжал под клавиатуру
  // (сам WebView этого не умеет — RN не видит, что происходит внутри него).
  // scrollY/editorY/scrollViewH — три числа, из которых считаем, перекрывает
  // ли клавиатура текущую позицию каретки, и на сколько доскроллить.
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const editorYRef = useRef(0);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  function onCaret({ bottom }) {
    if (!keyboardHeight || !scrollViewHeight) return;
    const visibleBottom = scrollViewHeight - keyboardHeight;
    const caretBottomInScroll = editorYRef.current + bottom - scrollYRef.current;
    const overflow = caretBottomInScroll - visibleBottom;
    if (overflow > 0) {
      scrollRef.current?.scrollTo({ y: scrollYRef.current + overflow + spacing.md, animated: true });
    }
  }

  function onToolbarCommand(item) {
    if (item.type === 'link') {
      openSheet(
        <LinkPromptSheet lang={LANG} initialValue={format.link} onConfirm={(url) => editorRef.current?.send({ type: 'link', value: url })} />,
      );
      return;
    }
    editorRef.current?.send(item);
  }

  function onExport() {
    if (!task) return;
    const project = getProject(projects, task.projectId);
    runExport(
      `${project ? project.name : t(LANG, 'export.project_fallback')} — ${task.title || t(LANG, 'export.task_fallback')} — ${new Date().toISOString().slice(0, 10)}`,
      buildTaskSheets(task, project, LANG, currency, hourlyRate),
      LANG,
      showToast,
    );
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable hitSlop={6} onPress={onOpenMenu} style={styles.menuBtn}>
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
          {
            key: 'pin',
            icon: 'pin',
            label: t(LANG, task && task.pinnedAt ? 'pin.unpin' : 'pin.pin'),
            onPress: () => togglePinTask(taskId),
          },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onExport },
          {
            key: 'delete',
            icon: 'trash',
            label: t(LANG, 'task.delete_title'),
            danger: true,
            separated: true,
            onPress: onDelete,
          },
        ]}
      />,
    );
  }

  const project = getProject(projects, task ? task.projectId : null);

  /** Открыть проект задачи. Если мы пришли с его же страницы, возвращаемся
   *  назад, а не кладём в стек второй такой же экран: иначе «назад» потом
   *  проводит через ту же страницу дважды. Предыдущий экран смотрим в
   *  состоянии навигатора — параметры маршрута об этом не знают. */
  function onOpenProject() {
    if (!project) return;
    const state = navigation.getState();
    const prev = state.routes[state.index - 1];
    if (prev && prev.name === 'Project' && prev.params && prev.params.projectId === project.id) {
      navigation.goBack();
      return;
    }
    // В стеке доски экрана проекта нет вовсе — там он живёт в «Главной».
    if (state.routes.some((r) => r.name === 'Project')
      || state.routeNames.includes('Project')) {
      navigation.navigate('Project', { projectId: project.id });
      return;
    }
    navigation.navigate('Home', { screen: 'Project', params: { projectId: project.id } });
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
  function onNotesChange(ops) {
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => updateTask(taskId, { notes: ops }), 400);
  }
  function onRateChange(v) {
    setRateText(v);
    updateTask(taskId, { rate: v.trim() === '' ? null : parseNum(v) });
  }

  function onDeleteSession(index) {
    if (!task) return;
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
      message: t(LANG, 'session.delete_title'),
      actions: [
        {
          label: t(LANG, 'project.delete'), destructive: true,
          onPress: () => {
            const removed = task.sessions[index];
            const sessions = task.sessions.filter((_, i) => i !== index);
            updateTask(taskId, { sessions, totalMs: Math.max(0, (task.totalMs || 0) - removed.ms) });
          },
        },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
  }

  const fmtHm = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

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
    const own = Versions.versionsOf(versions, task.projectId);
    openSheet(
      <PickerSheet
        title={t(LANG, 'version.label')}
        value={task.versionId || ''}
        options={[
          { value: '', label: t(LANG, 'version.none') },
          ...own.map((v) => ({ value: v.id, label: v.name })),
        ]}
        onSelect={(id) => setTaskVersion(taskId, id || null)}
      />,
    );
  }

  function onOpenRepeat() {
    // Повторение считается от дедлайна — предлагать его раньше было бы
    // обманом: возвращаться задаче некуда.
    if (!task.dueAt) { showToast(t(LANG, 'repeat.needs_due')); return; }
    openSheet(
      <RepeatSheet
        lang={LANG}
        dueAt={task.dueAt}
        rule={task.repeat}
        onApply={(rule) => setTaskRepeat(taskId, rule)}
        onClear={() => setTaskRepeat(taskId, null)}
      />,
    );
  }

  useEffect(() => () => { clearTimeout(titleTimer.current); clearTimeout(notesTimer.current); }, []);

  if (!task) return null;

  const elapsedMs = isRunning ? Date.now() - new Date(activeTimer.startedAt).getTime() + (task.totalMs || 0) : (task.totalMs || 0);
  const earned = earnedOf(task, hourlyRate, activeTimer);
  const sessions = [...(task.sessions || [])].map((s, i) => ({ s, i })).sort((a, b) => new Date(b.s.start) - new Date(a.s.start));

  // На Android и KeyboardAvoidingView behavior="height", и "padding" зависят
  // от того, как ОС резайзит окно (windowSoftInputMode) — а под Expo Go этот
  // манифест не наш, приложение грузится в чужой контейнер (см. историю
  // правок этого файла: два предыдущих захода на "height" не сработали на
  // реальном устройстве, хотя выглядели корректно и даже проверялись на
  // эмуляторе). Вместо попытки угадать поведение автоматического режима —
  // считаем сами: keyboardHeight уже отслеживается ниже (Keyboard.addListener)
  // для автопрокрутки каретки, используем то же число напрямую как
  // marginBottom тулбара и paddingBottom скролла на Android. Это не зависит
  // ни от какого manifest/resize-режима — просто сдвигает контент на
  // измеренную высоту клавиатуры, минуя автоматику совсем.
  const isIOS = Platform.OS === 'ios';
  const androidKeyboardOffset = !isIOS && tab === 'notes' ? keyboardHeight : 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={isIOS ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, androidKeyboardOffset ? { paddingBottom: androidKeyboardOffset } : null]}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setScrollViewHeight(e.nativeEvent.layout.height)}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        <View style={styles.header}>
          {/* Из какого проекта задача — первое, что нужно знать, открыв её
              из поиска или мини-плеера: там контекста не было вовсе. */}
          {project ? (
            <Pressable style={styles.projectRow} onPress={onOpenProject}>
              <View style={[styles.projectDot, { backgroundColor: project.color }]} />
              <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
              <Icon name="chevron-right" size={12} color={colors.textDim} />
            </Pressable>
          ) : null}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={onTitleChange}
            placeholder={t(LANG, 'task.title_ph')}
            placeholderTextColor={colors.textDim}
          />

          <View style={styles.timerCard}>
            <TaskClock task={task} elapsedMs={elapsedMs} />
            <Pressable
              style={[styles.timerBtn, isRunning && styles.timerBtnOn]}
              onPress={() => (isRunning ? stopTimer() : startTimer(taskId))}
            >
              <Icon name={isRunning ? 'pause' : 'play'} size={20} color={isRunning ? colors.accentText : colors.text} />
            </Pressable>
          </View>

          {/* Ставка, срок и теги переехали во вкладку «Настройки» — как на
              десктопе. Над вкладками остаётся то, ради чего задачу открывают:
              название и таймер. */}
          <View style={styles.tabRow}>
            <Pressable style={[styles.tab, tab === 'notes' && styles.tabActive]} onPress={() => setTab('notes')}>
              <Text style={[styles.tabText, tab === 'notes' && styles.tabTextActive]}>{t(LANG, 'tabs.notes')}</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'settings' && styles.tabActive]} onPress={() => setTab('settings')}>
              <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>{t(LANG, 'tabs.settings')}</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'history' && styles.tabActive]} onPress={() => setTab('history')}>
              <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>{t(LANG, 'tabs.history')}</Text>
            </Pressable>
          </View>
        </View>

        {tab === 'notes' ? (
          <View onLayout={(e) => { editorYRef.current = e.nativeEvent.layout.y; }}>
            <RichTextEditor
              ref={editorRef}
              value={task.notes}
              onChange={onNotesChange}
              onFormatChange={setFormat}
              onCaret={onCaret}
              placeholder={t(LANG, 'editor.placeholder')}
              lang={LANG}
            />
          </View>
        ) : tab === 'settings' ? (
          <View style={styles.settingsPanel}>
            <View style={styles.splitRow}>
              <View style={styles.splitHalf}>
                <Text style={styles.label}>{t(LANG, 'task.rate_label')}</Text>
                <TextInput
                  style={styles.input}
                  value={rateText}
                  onChangeText={onRateChange}
                  keyboardType="decimal-pad"
                  placeholder={String(hourlyRate || 0)}
                  placeholderTextColor={colors.textDim}
                />
              </View>
              {/* Заработано стоит рядом со ставкой, а не отдельно: это её
                  результат, и врозь они читаются хуже. */}
              <View style={styles.splitHalf}>
                <Text style={styles.label}>{t(LANG, 'task.earned_label')}</Text>
                <View style={styles.earnedBox}>
                  <Text style={styles.earnedValue}>{fmtMoney(earned, LANG, currency)}</Text>
                </View>
              </View>
            </View>

            <Pressable style={styles.dueRow} onPress={onOpenDue}>
              <Icon name="clock" size={15} color={colors.textDim} />
              <View style={styles.dueMain}>
                <Text style={styles.dueLabel}>{t(LANG, 'due.label')}</Text>
                {task.dueAt ? (
                  <Text style={styles.dueRemind}>{t(LANG, REMIND_LABEL[remindKey(task)])}</Text>
                ) : null}
              </View>
              {task.dueAt ? (
                <Text style={styles.dueValue}>{`${dueShort(task, LANG)}, ${fmtHm(task.dueAt)}`}</Text>
              ) : (
                <Text style={styles.dueNone}>{t(LANG, 'due.none')}</Text>
              )}
              <Icon name="chevron-right" size={14} color={colors.textDim} />
            </Pressable>

            {/* Теги задачи. Строка устроена как строка срока: подпись слева,
                значение справа, тап открывает лист выбора. Бейджи переносятся
                по строкам — их может быть больше, чем влезает в ширину. */}
            <Pressable style={styles.dueRow} onPress={onOpenTags}>
              <Icon name="pin" size={15} color={colors.textDim} />
              <View style={styles.dueMain}>
                <Text style={styles.dueLabel}>{t(LANG, 'tag.pick')}</Text>
              </View>
              {taskTags.length ? (
                <TagBadgeRow tags={taskTags} style={styles.tagRowValue} />
              ) : (
                <Text style={styles.dueNone}>{t(LANG, 'tag.not_set')}</Text>
              )}
              <Icon name="chevron-right" size={14} color={colors.textDim} />
            </Pressable>

            {/* Статус задачи. Он же столбец на доске — менять его можно и
                отсюда, не открывая доску. */}
            <Pressable style={styles.dueRow} onPress={onOpenStatus}>
              <Icon name="check" size={15} color={colors.textDim} />
              <View style={styles.dueMain}>
                <Text style={styles.dueLabel}>{t(LANG, 'task.status_label')}</Text>
              </View>
              {status ? (
                <View style={styles.statusValue}>
                  <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                  <Text style={styles.dueValue}>{status.name}</Text>
                </View>
              ) : (
                <Text style={styles.dueNone}>{t(LANG, 'due.none')}</Text>
              )}
              <Icon name="chevron-right" size={14} color={colors.textDim} />
            </Pressable>

            {/* Версия принадлежит проекту, поэтому строки нет, пока у него
                не заведено ни одной. */}
            {projectVersions.length ? (
              <Pressable style={styles.dueRow} onPress={onOpenVersion}>
                <Icon name="list-ordered" size={15} color={colors.textDim} />
                <View style={styles.dueMain}>
                  <Text style={styles.dueLabel}>{t(LANG, 'version.label')}</Text>
                </View>
                <Text style={version ? styles.dueValue : styles.dueNone}>
                  {version ? version.name : t(LANG, 'version.none')}
                </Text>
                <Icon name="chevron-right" size={14} color={colors.textDim} />
              </Pressable>
            ) : null}

            {/* Повторение — последним: оно про будущее задачи, а не про
                то, чем она является сейчас. */}
            <Pressable style={styles.dueRow} onPress={onOpenRepeat}>
              <Icon name="clock" size={15} color={colors.textDim} />
              <View style={styles.dueMain}>
                <Text style={styles.dueLabel}>{t(LANG, 'repeat.label')}</Text>
                {repeatNext ? <Text style={styles.dueRemind}>{repeatNext}</Text> : null}
              </View>
              <Text style={task.repeat ? styles.dueValue : styles.dueNone} numberOfLines={1}>
                {repeatSummary || t(LANG, 'repeat.none')}
              </Text>
              <Icon name="chevron-right" size={14} color={colors.textDim} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.historyScroll}>
            {sessions.length === 0 ? <Text style={styles.historyEmpty}>{t(LANG, 'history.empty')}</Text> : null}
            {sessions.map(({ s, i }) => (
              <View key={i} style={styles.sessionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionWhen}>{fmtWhen(s.start, LANG)}{s.recovered ? t(LANG, 'session.recovered') : s.manual ? t(LANG, 'session.manual') : ''}</Text>
                  <Text style={styles.sessionMoney}>{fmtMoney(sessionMoney(s, task, hourlyRate), LANG, currency)}</Text>
                </View>
                <Text style={styles.sessionDur}>{fmtClock(s.ms)}</Text>
                <Pressable hitSlop={10} onPress={() => onDeleteSession(i)} style={{ paddingLeft: spacing.sm }}>
                  <Icon name="x" size={14} color={colors.textDim} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {tab === 'notes' ? (
        <View style={androidKeyboardOffset ? { marginBottom: androidKeyboardOffset } : null}>
          <EditorToolbar format={format} onCommand={onToolbarCommand} colors={colors} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Высота 44 — не для красоты: строка узкая, а промахиваться по ней
  // означает уехать в чужой проект.
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 44,
  },
  projectDot: { width: 8, height: 8, borderRadius: 3 },
  projectName: { color: colors.textDim, fontSize: fontSize.sm },
  // marginBottom меньше, чем зазор между остальными блоками ниже (timerCard/
  // splitRow/tabRow держат spacing.lg сами) — раньше был общий gap на .header,
  // одинаковый везде; тут именно название-таймер должен быть теснее.
  titleInput: { color: colors.text, ...typography.title, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  timerCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg,
  },
  timerBtn: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.panel2,
    alignItems: 'center', justifyContent: 'center',
  },
  timerBtnOn: { backgroundColor: colors.accent },
  label: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.panel, borderRadius: radius.md, minHeight: 48,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
    textAlignVertical: 'center',
  },
  splitRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  splitHalf: { flex: 1, gap: spacing.xs },
  // Та же геометрия, что у поля ставки слева (minHeight 48, тот же
  // горизонтальный паддинг), сумма прижата к левому краю и отцентрована по
  // вертикали контейнером, а не текстовыми свойствами — textAlignVertical
  // работает только на Android.
  earnedBox: {
    backgroundColor: colors.panel, borderRadius: radius.md, minHeight: 48,
    paddingHorizontal: spacing.md, justifyContent: 'center',
  },
  earnedValue: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: '700' },
  dueRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.lg,
  },
  dueMain: { flex: 1 },
  dueLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  dueRemind: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 1 },
  dueValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  // Бейджи выравниваются вправо, как и остальные значения в этих строках,
  // и переносятся: их может быть больше, чем влезает в одну строку.
  tagRowValue: { flex: 1, justifyContent: "flex-end" },
  statusValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 3 },
  dueNone: { color: colors.textDim, fontSize: fontSize.sm },
  tabRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  // См. комментарий у modeTextActive в CalendarScreen.js — тот же принцип.
  tabTextActive: { color: colors.text },
  // Те же поля и отступы, что были над вкладками, — переехал только адрес.
  // Воздух между полосой вкладок и первой подписью: без него подпись
  // «Ставка в час» прилипала к вкладкам. На десктопе исправлено тем же.
  settingsPanel: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  historyScroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  historyEmpty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.lg },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md,
  },
  sessionWhen: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sessionMoney: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 2 },
  sessionDur: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

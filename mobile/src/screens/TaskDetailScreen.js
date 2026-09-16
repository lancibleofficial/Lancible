import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import RichTextEditor, { LinkPromptSheet } from '../components/RichTextEditor';
import EditorToolbar from '../components/EditorToolbar';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { fmtClock, fmtMoney, fmtWhen, earnedOf, parseNum, sessionMoney } from '../lib/format';
import { buildTaskSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import { openSheet } from '../store/useSheetStore';
import { useTicker } from '../hooks/useTicker';
import Icon from '../components/Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

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
  const deleteTask = useAppStore((s) => s.deleteTask);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const showToast = useAppStore((s) => s.showToast);

  const task = getTask(tasks, taskId);
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
        <View style={styles.headerActions}>
          <Pressable hitSlop={10} onPress={onExport} style={styles.headerIconBtn}>
            <Icon name="download" size={20} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={10} onPress={() => togglePinTask(taskId)} style={styles.headerIconBtn}>
            <Icon name="pin" size={20} color={task && task.pinnedAt ? colors.accent : colors.text} />
          </Pressable>
          <Pressable hitSlop={10} onPress={onDelete} style={styles.headerIconBtnLast}>
            <Icon name="trash" size={20} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, task, colors]);

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
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={onTitleChange}
            placeholder={t(LANG, 'task.title_ph')}
            placeholderTextColor={colors.textDim}
          />

          <View style={styles.timerCard}>
            <Text style={styles.clock}>{fmtClock(elapsedMs)}</Text>
            <Pressable
              style={[styles.timerBtn, isRunning && styles.timerBtnOn]}
              onPress={() => (isRunning ? stopTimer() : startTimer(taskId))}
            >
              <Icon name={isRunning ? 'pause' : 'play'} size={20} color={isRunning ? colors.accentText : colors.text} />
            </Pressable>
          </View>

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
            <View style={styles.splitHalf}>
              <Text style={styles.label}>{t(LANG, 'task.earned_label')}</Text>
              <Text style={styles.earnedValue}>{fmtMoney(earned, LANG, currency)}</Text>
            </View>
          </View>

          <View style={styles.tabRow}>
            <Pressable style={[styles.tab, tab === 'notes' && styles.tabActive]} onPress={() => setTab('notes')}>
              <Text style={[styles.tabText, tab === 'notes' && styles.tabTextActive]}>{t(LANG, 'tabs.notes')}</Text>
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
  headerActions: { flexDirection: 'row' },
  headerIconBtn: { paddingHorizontal: spacing.sm },
  // paddingRight:0 — см. подробный комментарий в HomeScreen.js: этот экран
  // тоже внутри HomeStack (native-stack), у которого свой встроенный отступ
  // у последней иконки хедера, эквивалентный spacing.lg на вкладках без
  // вложенного стека.
  headerIconBtnLast: { paddingLeft: spacing.sm, paddingRight: 0 },
  // marginBottom меньше, чем зазор между остальными блоками ниже (timerCard/
  // splitRow/tabRow держат spacing.lg сами) — раньше был общий gap на .header,
  // одинаковый везде; тут именно название-таймер должен быть теснее.
  titleInput: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', paddingVertical: spacing.sm, marginBottom: spacing.xs },
  timerCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg,
  },
  clock: { color: colors.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerBtn: {
    width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.panel2,
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
  earnedValue: {
    backgroundColor: colors.panel, borderRadius: radius.md, minHeight: 48,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.accent, fontSize: fontSize.md, fontWeight: '700',
    textAlignVertical: 'center',
  },
  tabRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  // См. комментарий у modeTextActive в CalendarScreen.js — тот же принцип.
  tabTextActive: { color: colors.text },
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

import { useContext, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import TextInput from '../components/AppTextInput';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import DocEditor from '../components/DocEditor';
import DetailHeader from '../components/DetailHeader';
import { HeaderHeightContext } from '@react-navigation/elements';
import { IOS_NATIVE_HEADER } from '../navigation/nativeHeader';
import { useTicker } from '../hooks/useTicker';
import { openSheet } from '../store/useSheetStore';
import PickerSheet from '../components/PickerSheet';
import { useAppStore, getTask } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { useEditorAuth, editorUser } from '../hooks/useEditorAuth';
import DocCore from '../core/doc.js';
import { useColors, spacing, radius, typography } from '../theme';
import { t } from '../lib/i18n';

// Полноэкранный редактор: заметки задачи (kind: 'task') или документ
// (kind: 'doc'). Сам редактор — DocEditor (WebView со сборкой src/editor/);
// здесь — шапка, сохранение в стор и клавиатура.
//
// Сохраняем с задержкой 300 мс, а уходя с экрана — сразу: иначе последние
// буквы, набранные перед «назад», не доезжали бы до задачи.
export default function EditorScreen({ route, navigation }) {
  const { kind, id } = route.params;
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const editorSettings = useAppStore((s) => s.settings.editor);
  const setSettings = useAppStore((s) => s.setSettings);
  const updateTask = useAppStore((s) => s.updateTask);
  const updateDocument = useAppStore((s) => s.updateDocument);
  const showToast = useAppStore((s) => s.showToast);
  const projects = useAppStore((s) => s.projects);
  const task = useAppStore((s) => (kind === 'task' ? getTask(s.tasks, id) : null));
  const doc = useAppStore((s) => (kind === 'doc' ? (s.documents || []).find((d) => d.id === id) : null));
  const profile = useAuthStore((s) => s.user);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const headerH = useContext(HeaderHeightContext) || 0;
  const isRunning = kind === 'task' && !!activeTimer && activeTimer.taskId === id;
  useTicker(isRunning);
  const auth = useEditorAuth();
  // Картинки, стёртые из облака неудавшимся удалением аккаунта: редактор
  // ставит их обратно в очередь на выгрузку (lib/auth.js: deleteAccount).
  const assetRequeue = useAppStore((s) => s.assetRequeue);
  const clearAssetRequeue = useAppStore((s) => s.clearAssetRequeue);

  // Содержимое берётся один раз при открытии: дальше хозяин текста —
  // редактор, а стор только записывает за ним.
  const [initial] = useState(() => (kind === 'task'
    ? DocCore.readNotes(task ? task.notes : null)
    : DocCore.readNotes(doc ? doc.body : null)));
  const [title, setTitle] = useState(doc ? doc.title || '' : '');
  const pending = useRef(null);
  const timer = useRef(null);

  function save() {
    clearTimeout(timer.current);
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    if (kind === 'task') updateTask(id, { notes: DocCore.writeNotes(c) });
    else updateDocument(id, { body: DocCore.normalizeContainer(c) });
  }
  function onChange(c) {
    pending.current = c;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 300);
  }
  useEffect(() => navigation.addListener('beforeRemove', save), [navigation]);
  useEffect(() => () => save(), []);

  function onTitle(v) {
    setTitle(v);
    updateDocument(id, { title: v });
  }

  function pickProject() {
    const options = [{ value: '', label: t(lang, 'docs.no_project') }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
    openSheet(
      <PickerSheet
        title={t(lang, 'docs.project')}
        options={options}
        value={doc ? doc.projectId || '' : ''}
        onSelect={(v) => updateDocument(id, { projectId: v || null })}
      />,
    );
  }

  if (kind === 'task' ? !task : !doc) return null;
  const projectId = kind === 'task' ? task.projectId : doc.projectId;
  const project = projectId ? projects.find((p) => p.id === projectId) : null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={IOS_NATIVE_HEADER ? headerH : 0}>
      <DetailHeader
        onBack={() => navigation.goBack()}
        backLabel={t(lang, 'common.back')}
        color={project ? project.color : null}
        title={kind === 'task' ? (project ? project.name : '') : t(lang, 'docs.title')}
        sub={kind === 'task' ? (task.title || t(lang, 'task.no_name')) : ''}
        running={isRunning}
        runSince={isRunning ? new Date(activeTimer.startedAt).getTime() : null}
      />
      {kind === 'doc' ? (
        <View style={styles.docHead}>
          <TextInput
            style={styles.title}
            value={title}
            onChangeText={onTitle}
            placeholder={DocCore.docTitleGuess(initial.doc) || t(lang, 'docs.title_ph')}
            placeholderTextColor={colors.textFaint}
          />
          <Pressable style={styles.projectChip} onPress={pickProject} hitSlop={6}>
            {project ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
            <Text style={styles.projectText} numberOfLines={1}>{project ? project.name : t(lang, 'docs.no_project')}</Text>
            <Icon name="chevron-down" size={12} color={colors.textDim} />
          </Pressable>
        </View>
      ) : null}
      <DocEditor
        content={initial}
        onChange={onChange}
        lang={lang}
        user={editorUser(auth, profile && (profile.name || profile.email))}
        settings={editorSettings || {}}
        onSettings={(patch) => setSettings({ editor: { ...(useAppStore.getState().settings.editor || {}), ...patch } })}
        auth={auth}
        placeholder={kind === 'doc' ? t(lang, 'editor.placeholder') : undefined}
        onToast={showToast}
        requeue={assetRequeue}
        onRequeued={clearAssetRequeue}
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: { ...typography.title, flex: 1, color: colors.text, paddingVertical: spacing.xs, backgroundColor: 'transparent', borderWidth: 0 },
  projectChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.panel2 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  projectText: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
});

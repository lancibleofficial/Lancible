import { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Reanimated from 'react-native-reanimated';
import TextInput from '../components/AppTextInput';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import DocEditor from '../components/DocEditor';
import DetailHeader from '../components/DetailHeader';
import EditorToolbar, { SavedDot, useEditorInset } from '../components/EditorToolbar';
import { useEditorSession } from '../hooks/useEditorSession';
import { openSheet } from '../store/useSheetStore';
import PickerSheet from '../components/PickerSheet';
import { useAppStore } from '../store/useAppStore';
import DocCore from '../core/doc.js';
import { useColors, spacing, screenPadding, radius, typography } from '../theme';
import { t } from '../lib/i18n';

// Редактор документа (из «Документов»): DocEditor (WebView со сборкой
// src/editor/) на весь экран, панель — нативная (EditorToolbar) над
// клавиатурой; сохранение, панель и мост — hooks/useEditorSession.js.
//
// Заметки задачи сюда больше не приходят (13 октября 2026): они пишутся только
// на странице задачи, живым редактором, — кнопки «Во весь экран» нет.
//
// Сохраняем с задержкой 300 мс, а уходя с экрана — сразу: иначе последние
// буквы, набранные перед «назад», не доезжали бы до документа.
export default function EditorScreen({ route, navigation }) {
  const { id } = route.params;
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const updateDocument = useAppStore((s) => s.updateDocument);
  const projects = useAppStore((s) => s.projects);
  const doc = useAppStore((s) => (s.documents || []).find((d) => d.id === id));

  const session = useEditorSession('doc', id);
  const inset = useEditorInset(session.toolbarProps.visible);
  useEffect(() => navigation.addListener('beforeRemove', session.flush), [navigation]);

  const [title, setTitle] = useState(doc ? doc.title || '' : '');
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

  if (!doc) return null;
  const project = doc.projectId ? projects.find((p) => p.id === doc.projectId) : null;

  return (
    <View style={styles.container}>
      <DetailHeader
        onBack={() => navigation.goBack()}
        backLabel={t(lang, 'common.back')}
        color={project ? project.color : null}
        title={t(lang, 'docs.title')}
        sub=""
      />
      <View style={styles.docHead}>
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={onTitle}
          placeholder={DocCore.docTitleGuess(session.editorProps.content.doc) || t(lang, 'docs.title_ph')}
          placeholderTextColor={colors.textFaint}
        />
        <Pressable style={styles.projectChip} onPress={pickProject} hitSlop={6}>
          {project ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
          <Text style={styles.projectText} numberOfLines={1}>{project ? project.name : t(lang, 'docs.no_project')}</Text>
          <Icon name="chevron-down" size={12} color={colors.textDim} />
        </Pressable>
        <SavedDot lang={lang} saved={session.saved} />
      </View>
      <Reanimated.View style={[styles.body, inset]}>
        <DocEditor {...session.editorProps} placeholder={t(lang, 'editor.placeholder')} />
      </Reanimated.View>
      <EditorToolbar {...session.toolbarProps} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: { ...typography.title, flex: 1, color: colors.text, paddingVertical: spacing.xs, backgroundColor: 'transparent', borderWidth: 0 },
  projectChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.panel2 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  projectText: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
});

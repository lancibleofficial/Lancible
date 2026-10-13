import { useLayoutEffect, useState } from 'react';
import { View, FlatList, ScrollView, StyleSheet } from 'react-native';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import EmptyState from '../components/EmptyState';
import DocumentList from '../components/DocumentList';
import { useAppStore } from '../store/useAppStore';
import DocCore from '../core/doc.js';
import { useColors, spacing, screenPadding, radius } from '../theme';
import { t } from '../lib/i18n';
import { leftTitleOptions } from '../navigation/nativeHeader';

// Раздел «Документы» на телефоне: тексты отдельно от задач — те же, что на
// десктопе и в вебе (state.documents, ездят в синхронизации). Список с
// поиском; открытие — полноэкранный редактор (EditorScreen).
// С projectId в параметрах (кнопка «Документы» в шапке страницы проекта) —
// только документы этого проекта, и новый документ сразу кладётся в него.
// Строки — components/DocumentList.js.
export default function DocumentsScreen({ navigation, route }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const documents = useAppStore((s) => s.documents || []);
  const projects = useAppStore((s) => s.projects);
  const createDocument = useAppStore((s) => s.createDocument);
  const [query, setQuery] = useState('');

  const projectId = (route && route.params && route.params.projectId) || null;
  const project = projectId ? projects.find((p) => p.id === projectId) : null;
  const own = projectId ? documents.filter((d) => d.projectId === projectId) : documents;
  const list = DocCore.searchDocuments(DocCore.sortDocuments(own), query);

  useLayoutEffect(() => {
    navigation.setOptions(leftTitleOptions(project ? `${t(lang, 'docs.title')} · ${project.name}` : t(lang, 'docs.title')));
  }, [navigation, project, lang]);

  function open(id) { navigation.navigate('Editor', { id }); }
  function onNew() { open(createDocument(projectId)); }

  // Документов нет совсем (в разделе или в проекте) — пустой экран по
  // центру с той же «Новый документ», а поиск и кнопка внизу на это время
  // прячутся: искать нечего, а акцентная кнопка на экране одна.
  if (!own.length) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.emptyWrap} showsVerticalScrollIndicator={false}>
          <EmptyState
            art="docs"
            title={project ? t(lang, 'empty.project_docs') : t(lang, 'docs.empty_list')}
            text={project ? t(lang, 'empty.project_docs_text') : t(lang, 'docs.empty_hint')}
            actionLabel={t(lang, 'docs.new')}
            actionIcon="plus"
            onAction={onNew}
            primary
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.textDim} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t(lang, 'docs.search_ph')}
          placeholderTextColor={colors.textFaint}
        />
      </View>
      <FlatList
        data={[{ key: 'list' }]}
        keyExtractor={(x) => x.key}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={null}
        renderItem={() => (list.length ? <DocumentList documents={list} onOpen={open} /> : (
          <EmptyState size="sm" art="search" title={t(lang, 'docs.nothing_found')} text={t(lang, 'empty.search_text')} />
        ))}
      />
      <View style={styles.footer}>
        <PrimaryButton title={t(lang, 'docs.new')} onPress={onNew} />
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: screenPadding, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 44, borderRadius: radius.md, backgroundColor: colors.panel },
  search: { flex: 1, color: colors.text, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  listContent: { paddingHorizontal: screenPadding, paddingVertical: spacing.lg, flexGrow: 1 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  footer: { paddingHorizontal: screenPadding, paddingBottom: spacing.lg, paddingTop: spacing.sm },
});

import { useLayoutEffect, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import DocumentList from '../components/DocumentList';
import { useAppStore } from '../store/useAppStore';
import DocCore from '../core/doc.js';
import { useColors, spacing, radius, typography } from '../theme';
import { t } from '../lib/i18n';
import { leftTitleOptions } from '../navigation/nativeHeader';

// Раздел «Документы» на телефоне: тексты отдельно от задач — те же, что на
// десктопе и в вебе (state.documents, ездят в синхронизации). Список с
// поиском; открытие — полноэкранный редактор (EditorScreen).
// С projectId в параметрах (меню проекта, круг 5) — только документы этого
// проекта, и новый документ сразу кладётся в него. Строки — общие
// (components/DocumentList.js) с вкладкой «Документы» на странице проекта.
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

  function open(id) { navigation.navigate('Editor', { kind: 'doc', id }); }
  function onNew() { open(createDocument(projectId)); }

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
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{documents.length ? t(lang, 'docs.nothing_found') : t(lang, 'docs.empty_list')}</Text>
            {documents.length ? null : <Text style={styles.emptyHint}>{t(lang, 'docs.empty_hint')}</Text>}
          </View>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 44, borderRadius: radius.md, backgroundColor: colors.panel },
  search: { flex: 1, color: colors.text, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  empty: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyTitle: { ...typography.body, color: colors.textDim },
  emptyHint: { ...typography.caption, color: colors.textFaint, textAlign: 'center' },
  footer: { padding: spacing.lg, paddingTop: spacing.sm },
});

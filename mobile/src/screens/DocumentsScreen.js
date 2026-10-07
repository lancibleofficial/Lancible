import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import MenuSheet from '../components/MenuSheet';
import { openSheet } from '../store/useSheetStore';
import { confirmSheet } from '../lib/dialogs';
import { useAppStore } from '../store/useAppStore';
import DocCore from '../core/doc.js';
import { useColors, spacing, radius, typography } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

// Раздел «Документы» на телефоне: тексты отдельно от задач — те же, что на
// десктопе и в вебе (state.documents, ездят в синхронизации). Список с
// поиском; открытие — полноэкранный редактор (EditorScreen).
export default function DocumentsScreen({ navigation }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const documents = useAppStore((s) => s.documents || []);
  const projects = useAppStore((s) => s.projects);
  const createDocument = useAppStore((s) => s.createDocument);
  const deleteDocument = useAppStore((s) => s.deleteDocument);
  const togglePinDocument = useAppStore((s) => s.togglePinDocument);
  const [query, setQuery] = useState('');

  const list = DocCore.searchDocuments(DocCore.sortDocuments(documents), query);
  const titleOf = (d) => d.title || DocCore.docTitleGuess(DocCore.readNotes(d.body).doc) || t(lang, 'docs.untitled');

  function open(id) { navigation.navigate('Editor', { kind: 'doc', id }); }
  function onNew() { open(createDocument(null)); }

  function onMore(d) {
    openSheet(
      <MenuSheet
        items={[
          { key: 'pin', label: d.pinnedAt ? t(lang, 'docs.unpin') : t(lang, 'docs.pin'), icon: 'pin', onPress: () => togglePinDocument(d.id) },
          {
            key: 'delete', label: t(lang, 'docs.delete'), icon: 'trash', danger: true, separated: true,
            onPress: () => confirmSheet({
              title: t(lang, 'docs.delete'),
              message: t(lang, 'docs.delete_confirm', { name: titleOf(d) }),
              actions: [
                { label: t(lang, 'docs.delete'), destructive: true, onPress: () => deleteDocument(d.id) },
                { label: t(lang, 'common.cancel'), cancel: true },
              ],
            }),
          },
        ]}
      />,
    );
  }

  const when = (iso) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(LOCALE_MAP[lang] || 'ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { day: 'numeric', month: 'short' });
  };

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
        data={list}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{documents.length ? t(lang, 'docs.nothing_found') : t(lang, 'docs.empty_list')}</Text>
            {documents.length ? null : <Text style={styles.emptyHint}>{t(lang, 'docs.empty_hint')}</Text>}
          </View>
        )}
        renderItem={({ item: d }) => {
          const p = d.projectId ? projects.find((x) => x.id === d.projectId) : null;
          const words = DocCore.docStats(DocCore.readNotes(d.body).doc).words;
          return (
            <Pressable style={styles.row} onPress={() => open(d.id)} onLongPress={() => onMore(d)}>
              <Icon name="doc" size={18} color={colors.textDim} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>{titleOf(d)}</Text>
                <View style={styles.rowMeta}>
                  {p ? <View style={[styles.dot, { backgroundColor: p.color }]} /> : null}
                  <Text style={styles.rowMetaText} numberOfLines={1}>
                    {p ? `${p.name} · ` : ''}{t(lang, 'docs.words_n', { n: words })} · {when(d.updatedAt)}
                  </Text>
                </View>
              </View>
              {d.pinnedAt ? <Icon name="pin" size={14} color={colors.textFaint} /> : null}
              <Pressable hitSlop={10} onPress={() => onMore(d)} style={styles.more}>
                <Icon name="kebab" size={16} color={colors.textDim} />
              </Pressable>
            </Pressable>
          );
        }}
      />
      <View style={styles.footer}>
        <PrimaryButton title={t(lang, 'docs.new')} onPress={onNew} />
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 44, borderRadius: radius.md, backgroundColor: colors.inputBg },
  search: { flex: 1, color: colors.text, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  listContent: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.panel },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMetaText: { ...typography.caption, color: colors.textFaint, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  more: { padding: spacing.xs },
  empty: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyTitle: { ...typography.body, color: colors.textDim },
  emptyHint: { ...typography.caption, color: colors.textFaint, textAlign: 'center' },
  footer: { padding: spacing.lg, paddingTop: spacing.sm },
});

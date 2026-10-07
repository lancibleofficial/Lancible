// Список документов — строки одного вида для раздела «Документы» и для
// вкладки «Документы» на странице проекта. Открытие — полноэкранный
// редактор (EditorScreen), долгое нажатие и ⋮ — меню.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import MenuSheet from './MenuSheet';
import { IslandRow } from './Island';
import { openSheet } from '../store/useSheetStore';
import { confirmSheet } from '../lib/dialogs';
import { useAppStore } from '../store/useAppStore';
import DocCore from '../core/doc.js';
import { useColors, spacing, typography } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

export function docTitle(d, lang) {
  return d.title || DocCore.docTitleGuess(DocCore.readNotes(d.body).doc) || t(lang, 'docs.untitled');
}

/** @param documents — уже отобранные и отсортированные; @param onOpen(id). */
export default function DocumentList({ documents, onOpen, flat = false }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const deleteDocument = useAppStore((s) => s.deleteDocument);
  const togglePinDocument = useAppStore((s) => s.togglePinDocument);

  function onMore(d) {
    openSheet(
      <MenuSheet
        items={[
          { key: 'pin', label: d.pinnedAt ? t(lang, 'docs.unpin') : t(lang, 'docs.pin'), icon: 'pin', onPress: () => togglePinDocument(d.id) },
          {
            key: 'delete', label: t(lang, 'docs.delete'), icon: 'trash', danger: true, separated: true,
            onPress: () => confirmSheet({
              title: t(lang, 'docs.delete'),
              message: t(lang, 'docs.delete_confirm', { name: docTitle(d, lang) }),
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
    <View style={flat ? null : styles.list}>
      {documents.map((d, i) => {
        const p = d.projectId ? projects.find((x) => x.id === d.projectId) : null;
        const words = DocCore.docStats(DocCore.readNotes(d.body).doc).words;
        const body = (
          <>
            <Icon name="doc" size={18} color={colors.textDim} />
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{docTitle(d, lang)}</Text>
              <View style={styles.rowMeta}>
                {p && !flat ? <View style={[styles.dot, { backgroundColor: p.color }]} /> : null}
                <Text style={styles.rowMetaText} numberOfLines={1}>
                  {p && !flat ? `${p.name} · ` : ''}{t(lang, 'docs.words_n', { n: words })} · {when(d.updatedAt)}
                </Text>
              </View>
            </View>
            {d.pinnedAt ? <Icon name="pin" size={14} color={colors.textFaint} /> : null}
            <Pressable hitSlop={10} onPress={() => onMore(d)} style={styles.more} accessibilityLabel={t(lang, 'project.opts')}>
              <Icon name="kebab" size={16} color={colors.textDim} />
            </Pressable>
          </>
        );
        return flat ? (
          <IslandRow key={d.id} first={i === 0} onPress={() => onOpen(d.id)} onLongPress={() => onMore(d)}>{body}</IslandRow>
        ) : (
          <Pressable key={d.id} style={styles.row} onPress={() => onOpen(d.id)} onLongPress={() => onMore(d)}>{body}</Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 14, backgroundColor: colors.panel },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMetaText: { ...typography.caption, color: colors.textFaint, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  more: { padding: spacing.xs },
});

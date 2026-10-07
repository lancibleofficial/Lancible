// Общие теги — отдельный экран из «Меню». Теги проекта правятся в его
// настройках; здесь только те, что видны во всех проектах.
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Island, { IslandRow, IslandEmpty } from '../components/Island';
import Icon from '../components/Icon';
import TagEditSheet from '../components/TagEditSheet';
import { useAppStore } from '../store/useAppStore';
import { tagUsage, isGlobalTag } from '../lib/tags';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing, fontSize, gap } from '../theme';
import { t } from '../lib/i18n';

export default function TagsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const lang = useAppStore((s) => s.settings.lang);
  const tags = useAppStore((s) => s.tags);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const global = tags.filter(isGlobalTag);

  /** Подпись об использовании. Нулевые части в строку не попадают:
   *  «задач: 0» — это не сведения, а шум. */
  function usageLabel(tagId) {
    const u = tagUsage(projects, tasks, tagId);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    return parts.length ? parts.join(' · ') : t(lang, 'tag.unused');
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Island>
        <Text style={styles.hint}>{t(lang, 'tag.empty_hint')}</Text>
        {global.length === 0 ? <IslandEmpty>{t(lang, 'tag.none_yet')}</IslandEmpty> : null}
        {global.map((tag, i) => (
          <IslandRow key={tag.id} first={i === 0} onPress={() => openSheet(<TagEditSheet tag={tag} />)}>
            <View style={[styles.swatch, { backgroundColor: tag.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{tag.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{usageLabel(tag.id)}</Text>
            </View>
            <Icon name="chevron-right" size={13} color={colors.textFaint} />
          </IslandRow>
        ))}
        <IslandRow first={global.length === 0} onPress={() => openSheet(<TagEditSheet />)}>
          <Icon name="plus" size={14} color={colors.accentInk} />
          <Text style={[styles.name, { color: colors.accentInk }]}>{t(lang, 'tag.add')}</Text>
        </IslandRow>
      </Island>
    </ScrollView>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17, paddingBottom: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 5 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 1 },
});

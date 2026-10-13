// Общие теги — отдельный экран из «Меню». Теги проекта правятся в его
// настройках; здесь только те, что видны во всех проектах.
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Island, { IslandRow } from '../components/Island';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import TagEditSheet from '../components/TagEditSheet';
import { useAppStore } from '../store/useAppStore';
import { tagUsage, isGlobalTag } from '../lib/tags';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing, screenPadding, fontSize, gap } from '../theme';
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

  // Общих тегов нет — пустой экран с подсказкой и «Новый тег»; строка «+
  // Новый тег» под списком на это время не нужна, действие одно.
  if (global.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.emptyWrap} showsVerticalScrollIndicator={false}>
        <EmptyState
          art="tags"
          title={t(lang, 'tag.none_yet')}
          text={t(lang, 'tag.empty_hint')}
          actionLabel={t(lang, 'tag.add')}
          actionIcon="plus"
          onAction={() => openSheet(<TagEditSheet />)}
          primary
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Island>
        <Text style={styles.hint}>{t(lang, 'tag.empty_hint')}</Text>
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
        <IslandRow onPress={() => openSheet(<TagEditSheet />)}>
          <Icon name="plus" size={14} color={colors.accentInk} />
          <Text style={[styles.name, { color: colors.accentInk }]}>{t(lang, 'tag.add')}</Text>
        </IslandRow>
      </Island>
    </ScrollView>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: screenPadding, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl * 2 },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17, paddingBottom: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 5 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 1 },
});

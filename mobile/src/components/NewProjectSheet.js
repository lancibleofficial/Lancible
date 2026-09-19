import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import { useAppStore } from '../store/useAppStore';
import { PALETTE } from '../lib/migrate';
import { tagsOf } from '../lib/tags';
import TagPickerSheet from './TagPickerSheet';
import { TagBadgeRow } from './TagBadge';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import { openSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';

export default function NewProjectSheet({ onCreated, onCancel, initial }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const [name, setName] = useState((initial && initial.name) || '');
  const [description, setDescription] = useState((initial && initial.description) || '');
  const [color, setColor] = useState((initial && initial.color) || PALETTE[projects.length % PALETTE.length]);
  const [tagIds, setTagIds] = useState((initial && initial.tagIds) || []);
  const allTags = useAppStore((s) => s.tags);
  const projectTags = tagsOf(allTags, tagIds);

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const project = createProject({ name: trimmed, description: description.trim(), color, tagIds });
    onCreated(project);
  }

  // Лист в приложении один, поэтому пикер закрывает собой это окно. Чтобы
  // набранные название и описание не пропали, по «Готово» открываем себя же
  // заново с теми же полями и новым набором тегов.
  function onOpenTags() {
    const draft = { name, description, color };
    openSheet(
      <TagPickerSheet
        value={tagIds}
        onChange={() => {}}
        onDone={(ids) => openSheet(
          <NewProjectSheet initial={{ ...draft, tagIds: ids }} onCreated={onCreated} onCancel={onCancel} />,
        )}
      />,
    );
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'home.create')} onPress={onSave} disabled={!name.trim()} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [name, description, color, lang]);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, 'project.new_title')}</Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={t(lang, 'project.new_title')}
        placeholderTextColor={colors.textDim}
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder={t(lang, 'tabs.notes')}
        placeholderTextColor={colors.textDim}
        multiline
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
        {PALETTE.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatchRing, color === c && styles.swatchRingSel]}>
            <View style={[styles.swatch, { backgroundColor: c }]} />
          </Pressable>
        ))}
      </ScrollView>

      <Pressable style={styles.tagsRow} onPress={onOpenTags}>
        {projectTags.length
          ? <TagBadgeRow tags={projectTags} />
          : <Text style={styles.tagsEmpty}>{t(lang, 'tag.pick')}</Text>}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  tagsRow: { minHeight: 32, justifyContent: "center" },
  tagsEmpty: { color: colors.textDim, fontSize: fontSize.sm },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  swatchRow: { flexDirection: 'row', gap: spacing.xs / 2, paddingVertical: spacing.xs, paddingRight: spacing.md },
  swatchRing: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  swatchRingSel: { backgroundColor: colors.bg },
  swatch: { width: 34, height: 34, borderRadius: radius.sm },
});

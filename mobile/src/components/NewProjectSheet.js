import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import { useAppStore } from '../store/useAppStore';
import { PALETTE } from '../lib/migrate';
import { tagsOf } from '../lib/tags';
import TagPickerSheet from './TagPickerSheet';
import VersionsEditor from './VersionsEditor';
import { TagBadgeRow } from './TagBadge';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import { openSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

/** Окно проекта: создание и правка одним листом.
 *
 *  @param {object} [project] — правим существующий. В этом режиме внизу
 *    появляется список версий: версия принадлежит проекту, и держать её
 *    в отдельном окне значило бы прятать половину свойств проекта во
 *    второе место.
 *  @param {object} [initial] — черновик полей (см. onOpenTags). */
export default function NewProjectSheet({ onCreated, onCancel, initial, project }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const updateProject = useAppStore((s) => s.updateProject);
  // Черновик перебивает сохранённое: он приходит, когда лист открывают
  // заново после выбора тегов, и набранное к этому моменту дороже.
  const base = initial || project || {};
  const [name, setName] = useState(base.name || '');
  const [description, setDescription] = useState(base.description || '');
  const [color, setColor] = useState(base.color || PALETTE[projects.length % PALETTE.length]);
  const [tagIds, setTagIds] = useState(base.tagIds || []);
  const allTags = useAppStore((s) => s.tags);
  const projectTags = tagsOf(allTags, tagIds);

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (project) {
      updateProject(project.id, { name: trimmed, description: description.trim(), color, tagIds });
      onCreated(project);
      return;
    }
    onCreated(createProject({ name: trimmed, description: description.trim(), color, tagIds }));
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
          <NewProjectSheet
            project={project}
            initial={{ ...draft, tagIds: ids }}
            onCreated={onCreated}
            onCancel={onCancel}
          />,
        )}
      />,
    );
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, project ? 'common.save' : 'home.create')} onPress={onSave} disabled={!name.trim()} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [name, description, color, lang]);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, project ? 'project.edit_title' : 'project.new_title')}</Text>

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

      {project ? <VersionsEditor projectId={project.id} lang={lang} /> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, ...typography.title, marginBottom: spacing.sm },
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

import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useAppStore } from '../store/useAppStore';
import { PALETTE } from '../lib/migrate';
import { nameTaken, tagUsage } from '../lib/tags';
import { t } from '../lib/i18n';
import { confirmSheet } from '../lib/dialogs';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';

/** Создание и правка тега. Эмодзи-иконки здесь пока нет — она отложена, и
 *  когда появится, встанет в этот же лист третьим полем.
 *  @param {object} [tag] — правим существующий или заводим новый
 *  @param {string} [presetName] — имя, набранное в пикере
 *  @param {function} [onSaved] — что сделать с созданным тегом */
export default function TagEditSheet({ tag, presetName, onSaved }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const tags = useAppStore((s) => s.tags);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);

  const [name, setName] = useState(tag ? tag.name : (presetName || ''));
  const [color, setColor] = useState(tag ? tag.color : PALETTE[tags.length % PALETTE.length]);
  const [error, setError] = useState(null);

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Два тега с одинаковым именем на глаз не различить — отказываем с
    // объяснением, а не заводим молча второй.
    if (nameTaken(tags, trimmed, tag ? tag.id : null)) {
      setError(t(lang, 'tag.name_taken'));
      return;
    }
    if (tag) {
      updateTag(tag.id, { name: trimmed, color });
      closeSheet();
    } else {
      const made = createTag({ name: trimmed, color });
      closeSheet();
      if (onSaved) onSaved(made);
    }
  }

  function onDelete() {
    const u = tagUsage(projects, tasks, tag.id);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    const message = parts.length
      ? t(lang, 'tag.delete_used', { name: tag.name, n: parts.join(' · ') })
      : t(lang, 'tag.delete_confirm', { name: tag.name });
    confirmSheet({
      title: t(lang, 'common.delete'),
      message,
      actions: [
        { label: t(lang, 'common.delete'), destructive: true, onPress: () => { deleteTag(tag.id); closeSheet(); } },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={onSave} disabled={!name.trim()} />
        {tag ? <PrimaryButton title={t(lang, 'common.delete')} variant="danger" onPress={onDelete} /> : null}
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={closeSheet} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [name, color, lang, tags]);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, tag ? 'tag.dialog_edit' : 'tag.dialog_new')}</Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(v) => { setName(v); setError(null); }}
        placeholder={t(lang, 'tag.name_ph')}
        placeholderTextColor={colors.textDim}
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>{t(lang, 'tag.color_label')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
        {PALETTE.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatchRing, color === c && styles.swatchRingSel]}>
            <View style={[styles.swatch, { backgroundColor: c }]} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.sm, marginTop: spacing.xs },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: -spacing.sm },
  swatchRow: { flexDirection: 'row', gap: spacing.xs / 2, paddingVertical: spacing.xs, paddingRight: spacing.md },
  swatchRing: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  swatchRingSel: { backgroundColor: colors.bg },
  swatch: { width: 34, height: 34, borderRadius: radius.sm },
});

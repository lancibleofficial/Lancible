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
import { useColors, spacing, radius, fontSize, typography } from '../theme';

/** Создание и правка тега. Эмодзи-иконки здесь пока нет — она отложена, и
 *  когда появится, встанет в этот же лист третьим полем.
 *  @param {object} [tag] — правим существующий или заводим новый
 *  @param {string} [presetName] — имя, набранное в пикере
 *  @param {string} [projectId] — новый тег будет тегом этого проекта;
 *    без него — общий. Имя занято только в своей области видимости.
 *  @param {function} [onSaved] — что сделать с созданным тегом */
/** @param embedded внутри другого листа (настройки проекта): без своего
 *  заголовка и низа листа, кнопки — в содержимом; по готовности — onDone,
 *  а удаление подтверждается вторым нажатием, а не листом поверх. */
export default function TagEditSheet({ tag, presetName, projectId, onSaved, embedded, onDone }) {
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const finish = () => (embedded ? onDone && onDone() : closeSheet());

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Два тега с одинаковым именем на глаз не различить — отказываем с
    // объяснением, а не заводим молча второй.
    const scope = tag ? tag.projectId : projectId;
    if (nameTaken(tags, trimmed, tag ? tag.id : null, scope || null)) {
      setError(t(lang, 'tag.name_taken'));
      return;
    }
    if (tag) {
      updateTag(tag.id, { name: trimmed, color });
      finish();
    } else {
      const made = createTag({ name: trimmed, color, projectId: projectId || null });
      finish();
      if (onSaved) onSaved(made);
    }
  }

  function deleteMessage() {
    const u = tagUsage(projects, tasks, tag.id);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    return parts.length
      ? t(lang, 'tag.delete_used', { name: tag.name, n: parts.join(' · ') })
      : t(lang, 'tag.delete_confirm', { name: tag.name });
  }

  function onDelete() {
    if (embedded) {
      if (!confirmDelete) { setConfirmDelete(true); return; }
      deleteTag(tag.id);
      finish();
      return;
    }
    confirmSheet({
      title: t(lang, 'common.delete'),
      message: deleteMessage(),
      actions: [
        { label: t(lang, 'common.delete'), destructive: true, onPress: () => { deleteTag(tag.id); closeSheet(); } },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  useEffect(() => {
    if (embedded) return undefined;
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
      {embedded ? null : <Text style={styles.title}>{t(lang, tag ? 'tag.dialog_edit' : projectId ? 'tag.project_add' : 'tag.dialog_new')}</Text>}

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

      {embedded ? (
        <View style={styles.inlineActions}>
          {confirmDelete ? <Text style={styles.error}>{deleteMessage()}</Text> : null}
          <PrimaryButton title={t(lang, 'common.save')} onPress={onSave} disabled={!name.trim()} />
          {tag ? <PrimaryButton title={t(lang, 'common.delete')} variant="danger" onPress={onDelete} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  inlineActions: { gap: spacing.sm, marginTop: spacing.sm },
  title: { color: colors.text, ...typography.title, marginBottom: spacing.sm },
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

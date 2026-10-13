import { useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import ActionSheetContent from './ActionSheetContent';
import SheetPage, { usePageMotion } from './SheetPage';
import { Block, Hint } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import { PALETTE } from '../lib/migrate';
import { nameTaken, tagUsage } from '../lib/tags';
import { t } from '../lib/i18n';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, radius } from '../theme';

/** Создание и правка тега. Эмодзи-иконки здесь пока нет — она отложена, и
 *  когда появится, встанет в этот же лист третьим полем.
 *  @param {object} [tag] — правим существующий или заводим новый
 *  @param {string} [presetName] — имя, набранное в пикере
 *  @param {string} [projectId] — новый тег будет тегом этого проекта;
 *    без него — общий. Имя занято только в своей области видимости.
 *  @param {function} [onSaved] — что сделать с созданным тегом */
/** @param embedded страница внутри другого листа (настройки проекта, выбор
 *  меток): без своего заголовка (его ставит тот, кто держит страницу); кнопки —
 *  тем же подвалом, по готовности — onDone, а удаление подтверждается вторым
 *  нажатием, а не страницей глубже.
 *
 *  Сам по себе лист подтверждает удаление страницей этого же листа со
 *  стрелкой «назад» (12 октября 2026; раньше — лист поверх, и правка тега
 *  пропадала вместе с ним). */
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
  const confirmPage = !embedded && confirmDelete;
  const motion = usePageMotion(confirmPage ? 1 : 0);
  // Фокус на имени — только при открытии, а не при возврате с подтверждения.
  const focusName = useRef(true);
  useEffect(() => { focusName.current = false; }, []);
  useSheetHeader(
    embedded ? null : t(lang, confirmPage ? 'common.delete_q' : tag ? 'tag.dialog_edit' : projectId ? 'tag.project_add' : 'tag.dialog_new'),
    confirmPage ? () => setConfirmDelete(false) : null,
  );
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
    if (!confirmDelete) { setConfirmDelete(true); return; }
    deleteTag(tag.id);
    finish();
  }

  // Подвал: «Сохранить», у существующего — «Удалить» (danger), у самостоятельного
  // листа — серая «Отмена». У страницы подтверждения подвал свой.
  useEffect(() => {
    if (confirmPage) return undefined;
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={onSave} disabled={!name.trim()} />
        {tag ? <PrimaryButton title={t(lang, 'common.delete')} variant="danger" onPress={onDelete} /> : null}
        {embedded ? null : <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={closeSheet} />}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [name, color, lang, tags, confirmDelete]);

  if (confirmPage) {
    return (
      <SheetPage key="confirm" motion={motion}>
        <ActionSheetContent
          embedded
          message={deleteMessage()}
          onCancel={() => setConfirmDelete(false)}
          actions={[
            { label: t(lang, 'common.delete'), destructive: true, onPress: () => deleteTag(tag.id) },
            { label: t(lang, 'common.cancel'), cancel: true },
          ]}
        />
      </SheetPage>
    );
  }

  return (
    <SheetPage key="main" motion={motion} style={styles.content} testID={embedded ? 'tag-edit' : undefined}>
      <Field
        value={name}
        onChangeText={(v) => { setName(v); setError(null); }}
        placeholder={t(lang, 'tag.name_ph')}
        invalid={!!error}
        autoFocus={focusName.current}
      />
      {error ? <Hint danger>{error}</Hint> : null}

      <Block label={t(lang, 'tag.color_label')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
          {PALETTE.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatchRing, color === c && styles.swatchRingSel]}>
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          ))}
        </ScrollView>
      </Block>

      {/* Встроенный: второе нажатие «Удалить» удаляет — объяснение над подвалом. */}
      {embedded && confirmDelete ? <Hint danger testID="tag-delete-confirm">{deleteMessage()}</Hint> : null}
    </SheetPage>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  swatchRow: { flexDirection: 'row', gap: spacing.xs / 2, paddingVertical: spacing.xs, paddingRight: spacing.md },
  swatchRing: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  swatchRingSel: { backgroundColor: colors.bg },
  swatch: { width: 34, height: 34, borderRadius: radius.sm },
});

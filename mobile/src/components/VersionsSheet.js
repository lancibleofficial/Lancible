// Версии проекта: завести, переименовать, отметить выпущенной, удалить.
//
// Версия принадлежит проекту, в отличие от тега, который общий на всё
// приложение. Порядок и разбивку «в работе / выпущено» считает
// src/core/versions.js — побайтная копия десктопного файла.
import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import PrimaryButton from './PrimaryButton';
import Versions from '../core/versions.js';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

export default function VersionsSheet({ projectId, lang }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const versions = useAppStore((s) => s.versions);
  const tasks = useAppStore((s) => s.tasks);
  const createVersion = useAppStore((s) => s.createVersion);
  const renameVersion = useAppStore((s) => s.renameVersion);
  const toggleVersionReleased = useAppStore((s) => s.toggleVersionReleased);
  const deleteVersion = useAppStore((s) => s.deleteVersion);

  const [draft, setDraft] = useState('');
  const own = Versions.versionsOf(versions, projectId);
  const locale = LOCALE_MAP[lang] || 'ru-RU';

  const taken = Versions.versionNameTaken(versions, projectId, draft, null);
  const canAdd = !!draft.trim() && !taken;

  useEffect(() => {
    setSheetFooter(<PrimaryButton title={t(lang, 'common.done')} onPress={closeSheet} />);
  }, [lang]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t(lang, 'version.label')}</Text>

      {own.length === 0 ? <Text style={styles.empty}>{t(lang, 'version.empty_hint')}</Text> : null}

      {own.map((v) => {
        const used = Versions.versionUsage(tasks, v.id);
        return (
          <View key={v.id} style={styles.row}>
            <TextInput
              style={styles.name}
              defaultValue={v.name}
              onEndEditing={(e) => renameVersion(v.id, e.nativeEvent.text)}
              placeholder={t(lang, 'version.name_ph')}
              placeholderTextColor={colors.textDim}
            />
            {/* Выпущенная версия помечена датой, а не только галочкой: «когда»
                здесь важнее, чем «да». */}
            <Pressable
              onPress={() => toggleVersionReleased(v.id)}
              style={[styles.released, v.releasedAt && styles.releasedOn]}
            >
              <Text style={[styles.releasedText, v.releasedAt && styles.releasedTextOn]}>
                {v.releasedAt
                  ? new Date(v.releasedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
                  : t(lang, 'version.mark_released')}
              </Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => deleteVersion(v.id)} style={styles.del}>
              <Icon name="trash" size={15} color={used ? colors.danger : colors.textDim} />
            </Pressable>
          </View>
        );
      })}

      <View style={styles.addRow}>
        <TextInput
          style={[styles.name, taken && styles.nameBad]}
          value={draft}
          onChangeText={setDraft}
          placeholder={t(lang, 'version.name_ph')}
          placeholderTextColor={colors.textDim}
          onSubmitEditing={() => { if (canAdd) { createVersion(projectId, draft); setDraft(''); } }}
        />
        <PrimaryButton
          icon="plus"
          disabled={!canAdd}
          onPress={() => { createVersion(projectId, draft); setDraft(''); }}
        />
      </View>
      {taken ? <Text style={styles.bad}>{t(lang, 'version.name_taken')}</Text> : null}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  scroll: { maxHeight: 440 },
  content: { gap: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  empty: { color: colors.textDim, fontSize: fontSize.sm, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  name: {
    flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text, fontSize: fontSize.md,
  },
  nameBad: { borderColor: colors.danger },
  bad: { color: colors.danger, fontSize: fontSize.xs },
  released: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  releasedOn: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  releasedText: { color: colors.textDim, fontSize: fontSize.xs },
  releasedTextOn: { color: colors.text },
  del: { padding: spacing.xs },
});

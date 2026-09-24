// Версии проекта: завести, переименовать, отметить выпущенной, удалить.
//
// Версия принадлежит проекту, в отличие от тега, который общий на всё
// приложение. Порядок и разбивку «в работе / выпущено» считает
// src/core/versions.js — побайтная копия десктопного файла.
//
// Не лист, а кусок листа: версии правятся внутри окна проекта, рядом с его
// названием и цветом. Отдельным окном они были только потому, что окна
// проекта на телефоне не существовало.
import { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import PrimaryButton from './PrimaryButton';
import Versions from '../core/versions.js';
import { useAppStore } from '../store/useAppStore';
import { useColors, spacing, radius, fontSize, buttonHeight } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

export default function VersionsEditor({ projectId, lang }) {
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

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t(lang, 'version.label')}</Text>

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
          style={styles.addBtn}
          onPress={() => { createVersion(projectId, draft); setDraft(''); }}
        />
      </View>
      {taken ? <Text style={styles.bad}>{t(lang, 'version.name_taken')}</Text> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.sm, marginTop: spacing.xs },
  empty: { color: colors.textDim, fontSize: fontSize.sm, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  name: {
    flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text, fontSize: fontSize.md,
  },
  nameBad: { borderColor: colors.danger },
  // PrimaryButton по умолчанию width: 100% — в строке это отнимает всю
  // ширину у поля. Квадрат по высоте кнопки.
  addBtn: { width: buttonHeight, height: buttonHeight, paddingHorizontal: 0 },
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

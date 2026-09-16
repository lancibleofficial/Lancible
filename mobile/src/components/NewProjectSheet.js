import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import { useAppStore } from '../store/useAppStore';
import { PALETTE } from '../lib/migrate';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';

export default function NewProjectSheet({ onCreated, onCancel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PALETTE[projects.length % PALETTE.length]);

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const project = createProject({ name: trimmed, description: description.trim(), color });
    onCreated(project);
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
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  swatchRow: { flexDirection: 'row', gap: spacing.xs / 2, paddingVertical: spacing.xs, paddingRight: spacing.md },
  swatchRing: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  swatchRingSel: { backgroundColor: colors.bg },
  swatch: { width: 34, height: 34, borderRadius: radius.sm },
});

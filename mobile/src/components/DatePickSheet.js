// Лист выбора дня: свой мини-календарь (MiniDatePicker), без системного.
import { View } from 'react-native';
import Text from './AppText';
import MiniDatePicker from './MiniDatePicker';
import { useAppStore } from '../store/useAppStore';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, typography } from '../theme';

/** @param valueKey — выбранный день 'YYYY-MM-DD'; @param onPick(key). */
export default function DatePickSheet({ title, valueKey, onPick }) {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
      <MiniDatePicker lang={lang} valueKey={valueKey} onPick={(key) => { closeSheet(); onPick(key); }} />
    </View>
  );
}

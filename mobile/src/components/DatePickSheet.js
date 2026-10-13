// Лист выбора дня: свой мини-календарь (MiniDatePicker), без системного.
import { View } from 'react-native';
import MiniDatePicker from './MiniDatePicker';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';

/** @param valueKey — выбранный день 'YYYY-MM-DD'; @param onPick(key). */
export default function DatePickSheet({ title, valueKey, onPick }) {
  const lang = useAppStore((s) => s.settings.lang);
  useSheetHeader(title);
  return (
    <View style={{ gap: spacing.md }}>
      <MiniDatePicker lang={lang} valueKey={valueKey} onPick={(key) => { closeSheet(); onPick(key); }} />
    </View>
  );
}

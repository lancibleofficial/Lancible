import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/useAppStore';
import { useColors, spacing, radius, fontSize } from '../theme';

export default function Toast() {
  const message = useAppStore((s) => s.toastMessage);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = makeStyles(colors);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  bubble: { backgroundColor: colors.panel2, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { color: colors.text, fontSize: fontSize.sm },
});

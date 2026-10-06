import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/useAppStore';
import { useColors, spacing, radius, fontSize } from '../theme';

// Тост может нести одно действие — «Открыть» у только что созданной задачи.
// Оно не обязано быть нажатым: тост всё равно уедет через пару секунд, и без
// нажатия ничего не потеряется. Поэтому кнопка тут, а не в отдельном диалоге.
export default function Toast() {
  const message = useAppStore((s) => s.toastMessage);
  const action = useAppStore((s) => s.toastAction);
  const hideToast = useAppStore((s) => s.hideToast);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = makeStyles(colors);
  if (!message) return null;
  return (
    // Без действия тост не ловит касания вовсе: он перекрывает шапку, и
    // глотать нажатия по ней ради надписи было бы нечестно.
    <View pointerEvents={action ? 'box-none' : 'none'} style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{message}</Text>
        {action ? (
          <Pressable
            hitSlop={10}
            onPress={() => { hideToast(); action.onPress(); }}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    maxWidth: '92%',
    backgroundColor: colors.panel2, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: fontSize.sm },
  action: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '700' },
});

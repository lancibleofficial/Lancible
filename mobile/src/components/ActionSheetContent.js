import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, fontSize } from '../theme';

// Содержимое нижнего листа для меню/подтверждений — замена Alert.alert(...)
// (см. lib/dialogs.js). actions: [{label, onPress, destructive?, cancel?}].
export default function ActionSheetContent({ title, message, actions }) {
  const colors = useColors();
  const styles = makeStyles(colors);

  useEffect(() => {
    setSheetFooter(
      <>
        {actions.map((a, i) => (
          <PrimaryButton
            key={i}
            title={a.label}
            variant={a.destructive ? 'danger' : a.cancel ? 'ghost' : 'primary'}
            onPress={() => { closeSheet(); if (a.onPress) a.onPress(); }}
          />
        ))}
      </>,
    );
    return () => setSheetFooter(null);
  }, [actions]);

  if (!title && !message) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  message: { color: colors.textDim, fontSize: fontSize.sm },
});

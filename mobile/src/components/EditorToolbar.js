import { Pressable, ScrollView, View, StyleSheet } from 'react-native';
import Icon from './Icon';
import Text from './AppText';
import { spacing, radius } from '../theme';

// Вынесен из RichTextEditor.js — живёт СНАРУЖИ ScrollView экрана задачи, как
// сосед последним в KeyboardAvoidingView (см. TaskDetailScreen.js), чтобы
// прилипать к клавиатуре, а не прокручиваться вместе с текстом.
export const TOOLBAR_ITEMS = [
  { type: 'toggle', key: 'bold', label: 'B', bold: true },
  { type: 'toggle', key: 'italic', label: 'I', italic: true },
  { type: 'toggle', key: 'underline', label: 'U', underline: true },
  { type: 'toggle', key: 'strike', label: 'S', strike: true },
  { sep: true },
  { type: 'header', value: 1, label: 'H1' },
  { type: 'header', value: 2, label: 'H2' },
  { type: 'header', value: 3, label: 'H3' },
  { sep: true },
  { type: 'list', value: 'bullet', icon: 'list-bullet' },
  { type: 'list', value: 'ordered', icon: 'list-ordered' },
  { type: 'list', value: 'checked', icon: 'list-check' },
  { type: 'indent', dir: -1, icon: 'indent-dec' },
  { type: 'indent', dir: 1, icon: 'indent-inc' },
  { sep: true },
  { type: 'toggle', key: 'blockquote', icon: 'blockquote' },
  { type: 'toggle', key: 'code-block', icon: 'code' },
  { type: 'link', icon: 'link' },
  { type: 'clean', icon: 'eraser' },
];

function isActive(item, format) {
  if (item.type === 'toggle') return !!format[item.key];
  if (item.type === 'list') return format.list === item.value;
  if (item.type === 'header') return format.header === item.value;
  return false;
}

export default function EditorToolbar({ format, onCommand, colors }) {
  const styles = makeStyles(colors);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent} keyboardShouldPersistTaps="always">
      {TOOLBAR_ITEMS.map((item, i) => {
        if (item.sep) return <View key={`sep${i}`} style={styles.sep} />;
        const active = isActive(item, format);
        return (
          <Pressable key={i} onPress={() => onCommand(item)} style={[styles.btn, active && styles.btnActive]}>
            {item.icon ? (
              <Icon name={item.icon} size={17} color={active ? colors.accent : colors.text} />
            ) : (
              <Text style={[styles.btnLabel, item.bold && styles.bold, item.italic && styles.italic, item.underline && styles.underline, item.strike && styles.strike, active && { color: colors.accent }]}>
                {item.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  toolbar: { flexGrow: 0, backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  toolbarContent: { paddingHorizontal: spacing.sm, alignItems: 'center', gap: 2 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  btn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  btnActive: { backgroundColor: colors.accentMuted },
  btnLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  bold: { fontWeight: '900' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
});

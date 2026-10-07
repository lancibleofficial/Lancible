// Шапка корневой вкладки: заголовок слева, справа квадратные кнопки
// действий (поиск, уведомления с бейджем, своё). Компактная, как на
// макете B2: заголовок 22, кнопки 36.
//
// Навигационная шапка на вкладках выключена, поэтому отступ под статус-бар
// берётся здесь.
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import { useAppStore } from '../store/useAppStore';
import { notificationFeed } from '../lib/due';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

/** Кнопка шапки: квадрат 36 с иконкой, при badge — красный счётчик. */
export function HeaderButton({ icon, label, onPress, badge, accent, testID }) {
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.btn, accent && styles.btnAccent]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon name={icon} size={18} color={accent ? colors.accentText : colors.textDim} />
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </Pressable>
  );
}

/** Колокольчик с числом непрочитанных — одна на все вкладки. */
export function NotificationsButton({ navigation }) {
  const lang = useAppStore((s) => s.settings.lang);
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;
  return (
    <HeaderButton
      icon="bell"
      label={t(lang, 'notif.title')}
      badge={unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null}
      onPress={() => navigation.navigate('Notifications')}
    />
  );
}

export default function TabHeader({ title, count, children }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>
        {title}{count != null ? <Text style={styles.count}> {count}</Text> : null}
      </Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg,
  },
  title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 22, fontFamily: displayFamily.bold },
  count: { color: colors.textFaint, fontSize: 15, fontFamily: displayFamily.regular },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  btnAccent: { backgroundColor: colors.accent },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.textOnColor, fontSize: 10, lineHeight: 13, fontWeight: '700' },
});

import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import NotificationsSheet from './NotificationsSheet';
import { useAppStore } from '../store/useAppStore';
import { notificationFeed } from '../lib/due';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing } from '../theme';

// Колокольчик в шапке — справа от поиска на всех экранах. Счётчик считается
// из самих задач (lib/due.js), отдельного хранилища у ленты нет; прочитанным
// всё становится в момент открытия листа.
export default function NotifButton() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;

  return (
    <Pressable hitSlop={10} style={styles.btn} onPress={() => openSheet(<NotificationsSheet />)}>
      <Icon name="bell" size={20} color={colors.text} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  btn: { paddingLeft: spacing.md },
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 15, height: 15, borderRadius: 999, paddingHorizontal: 3,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, lineHeight: 12 },
});

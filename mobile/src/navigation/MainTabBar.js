import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import TimerMiniPlayer from '../components/TimerMiniPlayer';
import { useAppStore } from '../store/useAppStore';
import { notificationFeed } from '../lib/due';
import { useColors, spacing } from '../theme';

// Вкладки — те же разделы, что в рейле веба, плюс уведомления пятой:
// Сегодня · Проекты · Время · Уведомления · Меню.
const ICON_NAMES = { Home: 'home', Projects: 'grid', Time: 'clock', Notifications: 'bell', Menu: 'menu' };

// Плоский таббар — остров у нижнего края: пять равных вкладок с подписями
// под значками, без тени и линии. Создание переехало в шапку.
//
// Скрывается на экранах деталей (там tabBarStyle:{display:'none'}) — этот
// флаг React Navigation сама прокидывает наверх из вложенного стека в
// descriptors фокусной вкладки, независимо от того, штатный это рендер
// таббара или кастомный, как здесь. Вместе с баром прячется и мини-плеер:
// он часть этой же панели.
export default function MainTabBar({ state, navigation, descriptors }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;

  const focusedRoute = state.routes[state.index];
  const focusedOptions = descriptors[focusedRoute.key].options;
  if (focusedOptions.tabBarStyle && focusedOptions.tabBarStyle.display === 'none') {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <TimerMiniPlayer
        onOpen={(taskId) => navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId } })}
      />
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const color = isFocused ? colors.accentInk : colors.textDim;
          const label = descriptors[route.key].options.tabBarLabel ?? route.name;
          const badge = route.name === 'Notifications' && unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null;
          return (
            <Pressable
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              style={styles.tabItem}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <View style={[styles.iconSlot, isFocused && styles.iconSlotOn]}>
                <Icon name={ICON_NAMES[route.name]} size={20} color={color} />
                {badge ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  // Обёртка ничем не залита: под мини-плеером должен просвечивать контент,
  // иначе полоса выглядела бы вторым баром, а не островом над ним.
  wrap: { gap: spacing.sm },
  bar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: colors.panel,
    paddingTop: spacing.sm, paddingBottom: spacing.sm + insets.bottom,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2, paddingBottom: spacing.xs },
  // Выбранная вкладка — пилюля второй ступени под значком, как
  // .nav-item.active в рейле.
  iconSlot: { width: 48, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconSlotOn: { backgroundColor: colors.accentMuted },
  tabLabel: { fontSize: 10, fontWeight: '600' },
  badge: {
    position: 'absolute', top: 1, right: 6,
    minWidth: 15, height: 15, borderRadius: 999, paddingHorizontal: 3,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.textOnColor, fontSize: 9, lineHeight: 12 },
});

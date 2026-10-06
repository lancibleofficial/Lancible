import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import TimerMiniPlayer from '../components/TimerMiniPlayer';
import { useColors, spacing, fontSize } from '../theme';

const ICON_NAMES = { Home: 'home', Board: 'board', Calendar: 'calendar', Stats: 'chart', Menu: 'menu' };

// Обычный таббар: пять равных табов с подписями под иконками. Выпирающей
// кнопки «+» по центру больше нет — создание переехало в шапку.
//
// Скрывается на экране задачи и проекта (там tabBarStyle:{display:'none'}) —
// этот флаг React Navigation сама прокидывает наверх из вложенного стека в
// descriptors фокусной вкладки, независимо от того, штатный это рендер
// таббара или кастомный, как здесь. Вместе с баром прячется и мини-плеер:
// он часть этой же панели.
export default function MainTabBar({ state, navigation, descriptors }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);

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
          return (
            <Pressable
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              style={styles.tabItem}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <Icon name={ICON_NAMES[route.name]} size={20} color={color} />
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
  // иначе полоса выглядела бы вторым баром, а не карточкой над ним.
  wrap: { gap: spacing.sm },
  bar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: colors.panel,
    paddingTop: spacing.md, paddingBottom: spacing.sm + insets.bottom,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: -2 },
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2, paddingBottom: spacing.sm },
  tabLabel: { fontSize: 10, fontWeight: '600' },
});

import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import { useColors, spacing, radius, fontSize } from '../theme';

const ICON_NAMES = { Home: 'home', Stats: 'chart', Calendar: 'calendar', Settings: 'settings' };
const CENTER_BTN_SIZE = 60;
const CENTER_BTN_LIFT = 22;

// Обычный нативный таббар с подписями под иконками; единственная кастомная
// деталь — квадратная со скруглением кнопка "+" по центру, чуть выпирающая
// над панелью (отрицательный marginTop поднимает её верхнюю часть над
// верхним краем бара — сам бар от этого не режет её, overflow не задан).
// Скрывается на экране задачи (TaskDetail ставит tabBarStyle:{display:'none'}
// через setOptions) — этот флаг React Navigation сама прокидывает наверх из
// вложенного стека в descriptors фокусной вкладки, независимо от того,
// штатный это рендер таббара или кастомный, как здесь.
export default function MainTabBar({ state, navigation, descriptors }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);

  const focusedRoute = state.routes[state.index];
  const focusedOptions = descriptors[focusedRoute.key].options;
  if (focusedOptions.tabBarStyle && focusedOptions.tabBarStyle.display === 'none') {
    return null;
  }

  function onCreatePress() {
    navigation.navigate('Home', { screen: 'HomeMain', params: { openCreate: true } });
  }

  function renderTab(index) {
    const route = state.routes[index];
    const isFocused = state.index === index;
    const color = isFocused ? colors.accent : colors.textDim;
    const label = descriptors[route.key].options.tabBarLabel ?? route.name;
    return (
      <Pressable key={route.key} onPress={() => navigation.navigate(route.name)} style={styles.tabItem}>
        <Icon name={ICON_NAMES[route.name]} size={20} color={color} />
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.bar}>
      {renderTab(0)}
      {renderTab(1)}
      <View style={styles.centerSlot}>
        <Pressable style={styles.centerBtn} onPress={onCreatePress}>
          <Icon name="plus" size={26} color={colors.accentText} />
        </Pressable>
      </View>
      {renderTab(2)}
      {renderTab(3)}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: colors.panel,
    paddingTop: spacing.sm, paddingBottom: spacing.xs + insets.bottom,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: -2 },
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2, paddingBottom: spacing.xs },
  tabLabel: { fontSize: 10, fontWeight: '600' },
  centerSlot: { flex: 1, alignItems: 'center' },
  centerBtn: {
    width: CENTER_BTN_SIZE, height: CENTER_BTN_SIZE, borderRadius: radius.lg,
    marginTop: -CENTER_BTN_LIFT,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: colors.panel,
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
});

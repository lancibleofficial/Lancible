import { useEffect, useState } from 'react';
import { View, StyleSheet, Keyboard } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withSpring } from 'react-native-reanimated';
import Tap from '../components/Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import TimerMiniPlayer from '../components/TimerMiniPlayer';
import { useColors, spacing } from '../theme';

// Пять вкладок макета B2: Проекты · Задачи · Сегодня · Цифры · Меню.
// Внутренние имена Home и Menu прежние — на них ссылаются переходы.
const ICON_NAMES = { Projects: 'cards', Tasks: 'inbox', Home: 'clock', Stats: 'chart', Menu: 'menu' };

/** Иконка вкладки: став активной, подпрыгивает на пружине. */
function TabIcon({ focused, name, color, styles }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (focused) s.value = withSequence(withSpring(1.18, { damping: 9, stiffness: 340, mass: 0.7 }), withSpring(1, { damping: 14, stiffness: 260 }));
  }, [focused]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={[styles.iconSlot, focused && styles.iconSlotOn, anim]}>
      <Icon name={name} size={20} color={color} />
    </Animated.View>
  );
}

// Плоский таббар у нижнего края, над ним — плашка идущей задачи.
//
// Скрывается на экранах деталей (там tabBarStyle:{display:'none'}) — этот
// флаг React Navigation сама прокидывает наверх из вложенного стека в
// descriptors фокусной вкладки. Вместе с баром прячется и плашка.
export default function MainTabBar({ state, navigation, descriptors }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);

  // Пока открыта клавиатура, панели нет: Android ужимает окно, и поле новой
  // задачи внизу карточки иначе оказывалось зажатым между панелью и
  // клавиатурой.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const focusedRoute = state.routes[state.index];
  const focusedOptions = descriptors[focusedRoute.key].options;
  if (keyboard || (focusedOptions.tabBarStyle && focusedOptions.tabBarStyle.display === 'none')) {
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
          const color = isFocused ? colors.accentInk : colors.textFaint;
          const label = descriptors[route.key].options.tabBarLabel ?? route.name;
          return (
            <Tap
              key={route.key}
              scale={0.9}
              onPress={() => navigation.navigate(route.name)}
              style={styles.tabItem}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <TabIcon focused={isFocused} name={ICON_NAMES[route.name]} color={color} styles={styles} />
              <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{label}</Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  // Обёртка ничем не залита: под плашкой должен просвечивать контент.
  wrap: { gap: spacing.sm },
  bar: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingTop: spacing.sm, paddingBottom: spacing.sm + insets.bottom,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3, paddingBottom: spacing.xs },
  iconSlot: { width: 46, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconSlotOn: { backgroundColor: colors.accentMuted },
  tabLabel: { fontSize: 10.5, fontWeight: '600' },
});

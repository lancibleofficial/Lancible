import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Keyboard } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withSpring, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import Tap from '../components/Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import TimerMiniPlayer, { useRunningTask, MINI_PLAYER_HEIGHT } from '../components/TimerMiniPlayer';
import { useColors, spacing } from '../theme';

// Пять вкладок макета B2: Проекты · Задачи · Сегодня · Цифры · Меню.
// Внутренние имена Home и Menu прежние — на них ссылаются переходы.
const ICON_NAMES = { Projects: 'folder', Tasks: 'tasks', Home: 'today', Stats: 'chart', Menu: 'menu' };

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

// Уезд и возврат панели: ease out, в такт переходу вглубь.
const SLIDE = { duration: 260, easing: Easing.out(Easing.cubic) };

// Плоский таббар у нижнего края, над ним — плашка идущей задачи. Плашка
// лежит поверх страницы, а не над ней в раскладке: страница не сжимается,
// когда таймер запускают и останавливают. Для этого блок плашки уходит вверх
// отрицательным отступом — в раскладке остаётся только высота самой панели.
// Плашка при этом внутри обёртки, и нажатия до неё доходят.
//
// Скрывается на экранах деталей (там tabBarStyle:{display:'none'}) — этот
// флаг React Navigation сама прокидывает наверх из вложенного стека в
// descriptors фокусной вкладки. Вместе с баром прячется и плашка.
//
// На экран деталей панель не пропадает разом, а уезжает вниз, пока экран
// въезжает: место под ней сразу отдаётся экрану, а сама она на время ухода
// лежит поверх него. Обратно выезжает снизу уже на своём месте.
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
  const onDetails = !!(focusedOptions.tabBarStyle && focusedOptions.tabBarStyle.display === 'none');
  const running = !!useRunningTask();
  const hidden = keyboard || onDetails;

  // Сдвиг вниз; пока панель спрятана, он равен её высоте — так при
  // возврате она выезжает снизу без мигания на месте.
  const ty = useSharedValue(0);
  const height = useRef(0);
  const [leaving, setLeaving] = useState(false);
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current === hidden) return;
    wasHidden.current = hidden;
    if (!hidden) {
      ty.value = withTiming(0, SLIDE);
    } else if (keyboard) {
      // Под клавиатуру — сразу: Android уже ужал окно.
      ty.value = height.current;
    } else {
      setLeaving(true);
      ty.value = withTiming(height.current, SLIDE, (done) => { if (done) runOnJS(setLeaving)(false); });
    }
  }, [hidden]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  if (hidden && !leaving) return null;

  return (
    <Animated.View
      style={[styles.wrap, running ? styles.overPage : null, hidden ? styles.leaving : null, slide]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      onLayout={(e) => { if (!hidden) height.current = e.nativeEvent.layout.height; }}
    >
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
    </Animated.View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  // Обёртка ничем не залита: под плашкой должен просвечивать контент.
  wrap: { gap: spacing.sm },
  // Плашка с зазором до панели — поверх страницы, а не в её раскладке.
  overPage: { marginTop: -(MINI_PLAYER_HEIGHT + spacing.sm) },
  // Уходя, панель лежит поверх экрана деталей: место под ней уже его.
  leaving: { position: 'absolute', left: 0, right: 0, bottom: 0 },
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

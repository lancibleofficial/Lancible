import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Keyboard } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import Tap from '../components/Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import TimerMiniPlayer, { useRunningTask, MINI_PLAYER_HEIGHT } from '../components/TimerMiniPlayer';
import { useLiquidEnabled, useLiquidGlide, useLiquidPresence } from '../components/Liquid';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { LIQUID, TAB_POP_KICK } from '../lib/liquid';
import { useColors, spacing } from '../theme';

// Пять вкладок макета B2: Проекты · Задачи · Сегодня · Цифры · Меню.
// Внутренние имена Home и Menu прежние — на них ссылаются переходы.
const ICON_NAMES = { Projects: 'folder', Tasks: 'tasks', Home: 'today', Stats: 'chart', Menu: 'menu' };

// Место под иконку вкладки и плашка активной — одного размера.
const SLOT_W = 46;
const SLOT_H = 28;

/** Иконка вкладки. Только что выбранная подпрыгивает толчком (pop общий —
 *  его толкает панель, один раз на смену вкладки). */
function TabIcon({ focused, name, color, styles, pop }) {
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: focused ? pop.value : 1 }] }));
  return (
    <Animated.View style={[styles.iconSlot, anim]}>
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

  // Плашка идущей задачи появляется и уходит каплей. Держим её здесь: место
  // над панелью (overPage) живёт, пока она стекает обратно, а не пропадает
  // вместе с таймером.
  const mini = useLiquidPresence(running, useLiquidEnabled());

  // Плашка активной вкладки — одна на панель. При выборе вкладки она
  // переезжает под новую жидко (вытягивается и догоняет хвост, упруго
  // встаёт), а иконка подпрыгивает толчком — один раз на смену вкладки.
  // Ни перерисовка, ни нажатие на открытую вкладку, ни первая отрисовка (и
  // возврат панели с экрана деталей) ничего не играют.
  //
  // Раньше иконка подпрыгивала withSequence из двух пружин: вторая («назад
  // к 1») ждала, пока первая успокоится по энергии, — ~1,4 с при видимых
  // 0,5, и через секунду иконка сжималась второй раз. Плюс подскок на
  // первой отрисовке. Теперь толчок — одна пружина (lib/liquid.js).
  const reduced = useReduceMotion();
  const glide = useLiquidGlide(!reduced);
  const pop = useSharedValue(1);
  const barW = useRef(0);
  const shownIndex = useRef(state.index);
  const slotOf = (i) => {
    const w = barW.current / state.routes.length;
    return { x: i * w + (w - SLOT_W) / 2, y: spacing.sm, w: SLOT_W, h: SLOT_H };
  };
  useEffect(() => {
    if (shownIndex.current === state.index) return;
    shownIndex.current = state.index;
    if (!barW.current) return;
    glide.to(slotOf(state.index), true);
    if (!reduced) pop.value = withSpring(1, { ...LIQUID.pop, velocity: TAB_POP_KICK });
  }, [state.index]);
  const onBarLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - barW.current) < 0.5) return;
    barW.current = w;
    // Ширина известна впервые или сменилась — плашка встаёт сразу.
    glide.to(slotOf(shownIndex.current), false);
  };

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
      style={[styles.wrap, mini.mounted ? styles.overPage : null, hidden ? styles.leaving : null, slide]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      onLayout={(e) => { if (!hidden) height.current = e.nativeEvent.layout.height; }}
    >
      <TimerMiniPlayer
        presence={mini}
        onOpen={(taskId) => navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId } })}
      />
      <View style={styles.bar} onLayout={onBarLayout} testID="tab-bar">
        <Animated.View pointerEvents="none" style={[styles.plate, glide.style]} testID="tab-bar-plate" />
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
              <TabIcon focused={isFocused} name={ICON_NAMES[route.name]} color={color} styles={styles} pop={pop} />
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
  iconSlot: { width: SLOT_W, height: SLOT_H, alignItems: 'center', justifyContent: 'center' },
  // Плашка активной вкладки — под иконками; место и путь — от useLiquidGlide.
  plate: { position: 'absolute', left: 0, borderRadius: SLOT_H / 2, backgroundColor: colors.accentMuted },
  tabLabel: { fontSize: 10.5, fontWeight: '600' },
});

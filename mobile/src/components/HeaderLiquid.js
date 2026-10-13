// Жидкое движение шапки (числа и формы — lib/headerLiquid.js, карта —
// DESIGN.md, «Телефон» → «Жидкое движение» → «Шапка»):
//
// - LiquidPress — нажатие круглых кнопок шапки: пока палец на кнопке, она
//   сплющена, отпустили — одна быстрая пружина с толчком (~0,2 с) надувает её
//   чуть выше покоя и возвращает. Вместо Tap: тот просто сжимает;
// - LiquidTitle — название новой вкладки проявляется каплей: плоское набухает
//   до формы, ~0,2 с. Первое название приложения и возврат с экрана деталей
//   стоят сразу;
// - HeaderActions — кнопки общей шапки: ушедшие стягиваются в каплю, пришедшие
//   набухают из неё, оставшиеся (лупа и колокольчик у «Проектов» и «Задач»)
//   не двигаются — их место и сам экземпляр те же, колокольчик не теряет звон.
//
// «Уменьшение движения» и iOS 26+ (liquidAllowed) — без движения, всё сразу.
// Ничто здесь не держит переход: уходящая кнопка лишь дотекает у края шапки.
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { useLiquidEnabled } from './Liquid';
import { LIQUID } from '../lib/liquid';
import { HEADER_LIQUID, PRESS_SQUASH, PRESS_KICK, dropIn, buttonDrop, slotSig, reconcileSlots } from '../lib/headerLiquid';
import { spacing } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Сторона кнопки шапки: пока кнопку не измерили, места берутся по ней. */
const BTN = 36;

/**
 * Нажимаемое с жидким откликом — для круглых кнопок шапки (HeaderButton,
 * DetailButton, BackButton). Принимает всё, что принимает Pressable.
 * Зона нажатия (hitSlop) — вокруг неподвижной кнопки, а не сплющенной.
 */
export function LiquidPress({ style, onPressIn, onPressOut, disabled, children, ...rest }) {
  const enabled = useLiquidEnabled();
  const jx = useSharedValue(1);
  const jy = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleX: jx.value }, { scaleY: jy.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, anim]}
      onPressIn={(e) => {
        if (enabled && !disabled) {
          jx.value = withTiming(PRESS_SQUASH.x, HEADER_LIQUID.squash);
          jy.value = withTiming(PRESS_SQUASH.y, HEADER_LIQUID.squash);
        }
        if (onPressIn) onPressIn(e);
      }}
      onPressOut={(e) => {
        if (enabled) {
          jx.value = withSpring(1, { ...HEADER_LIQUID.release, velocity: -PRESS_KICK });
          jy.value = withSpring(1, { ...HEADER_LIQUID.release, velocity: PRESS_KICK });
        }
        if (onPressOut) onPressOut(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Название вкладки (и число рядом). Если оно встало на место после смены
 * вкладки — проявляется каплей; иначе (первое в приложении, возврат с деталей,
 * без движения) стоит сразу. Решается один раз, при появлении: перерисовка
 * названия той же вкладки (число сменилось) ничего не играет.
 * @param tab   вкладка, чьё это название
 * @param shown ref хоста: вкладка, чьё название стояло последним
 */
export function LiquidTitle({ tab, shown, style, children }) {
  const enabled = useLiquidEnabled();
  const [play] = useState(() => enabled && shown.current != null && shown.current !== tab);
  const q = useSharedValue(play ? 0 : 1);
  useLayoutEffect(() => { shown.current = tab; }, []);
  useEffect(() => {
    if (play) q.value = withTiming(1, HEADER_LIQUID.title);
  }, []);
  const anim = useAnimatedStyle(() => {
    const d = dropIn(q.value);
    return { opacity: d.o, transform: [{ scaleX: d.sx }, { scaleY: d.sy }] };
  });
  // Капля растёт от левого края: название прижато к нему.
  return <Animated.View style={[style, styles.fromLeft, anim]} testID="header-title">{children}</Animated.View>;
}

/**
 * Есть ли кнопка на экране и где она между каплей и собой. То же, что
 * useLiquidPresence (components/Liquid.js): пришла — пружина 0 → 1, ушла — p
 * стекает 1 → 0 и только потом mounted = false, — но стекает быстрее
 * (HEADER_LIQUID.drain): кнопки старой вкладки не должны долго стоять рядом с
 * новыми.
 */
function useButtonPresence(visible, enabled) {
  const [mounted, setMounted] = useState(visible);
  const p = useSharedValue(visible ? 1 : 0);
  const was = useRef(visible);
  useEffect(() => {
    if (was.current === visible) return;
    was.current = visible;
    if (visible) {
      setMounted(true);
      if (enabled) {
        p.value = 0;
        p.value = withSpring(1, LIQUID.swell);
      } else {
        p.value = 1;
      }
    } else if (enabled) {
      p.value = withTiming(0, HEADER_LIQUID.drain, (done) => { if (done) runOnJS(setMounted)(false); });
    } else {
      p.value = 0;
      setMounted(false);
    }
  }, [visible]);
  return { mounted: mounted || visible, p };
}

/** Последняя измеренная ширина кнопки: кнопка, встающая на место сразу (возврат
 *  с экрана деталей), не мигает первым кадром в чужую ширину. */
const lastWidth = new Map();
const widthKey = (sig) => `${sig.icon}|${sig.label}|${sig.a11y}|${sig.testID}`;

/** Место одной кнопки: ширина места идёт за каплей (соседи отъезжают вслед),
 *  сама кнопка — абсолютом в нём, чтобы мериться в свою ширину. */
function ActionSlot({ slot, enabled, onGone }) {
  // Пришедшая кнопка начинает невидимой каплей и в первом же эффекте
  // «появляется» — иначе пресенс принял бы её за стоявшую всегда.
  const [on, setOn] = useState(!(slot.entering && enabled));
  useEffect(() => { if (!on) setOn(true); }, []);
  const shown = useButtonPresence(on && slot.visible, enabled);
  const key = widthKey(slot.sig);
  const width = useSharedValue(lastWidth.get(key) || BTN);
  const height = useSharedValue(BTN);
  useEffect(() => {
    if (!slot.visible && !shown.mounted) onGone(slot.id);
  }, [slot.visible, shown.mounted]);

  const place = useAnimatedStyle(() => {
    const d = buttonDrop(shown.p.value, width.value, height.value, spacing.sm);
    return { width: d.slotW, height: height.value, marginRight: d.mr };
  });
  const body = useAnimatedStyle(() => {
    const d = buttonDrop(shown.p.value, width.value, height.value, spacing.sm);
    return { opacity: d.o, transform: [{ translateX: d.dx }, { scaleX: d.sx }, { scaleY: d.sy }] };
  });
  if (!shown.mounted) return null;

  return (
    <Animated.View
      style={place}
      testID="header-slot"
      pointerEvents={slot.visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!slot.visible}
      importantForAccessibility={slot.visible ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View
        testID="header-slot-body"
        style={[styles.body, body]}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          width.value = w;
          height.value = h;
          lastWidth.set(key, w);
        }}
      >
        {slot.el}
      </Animated.View>
    </Animated.View>
  );
}

// Ключ у всех один: toArray даёт ключ по номеру в наборе, и кнопка, оставшаяся
// на соседней вкладке под другим номером, пересоздавалась бы.
const toSlots = (items) => Children.toArray(items).filter(isValidElement).map((el) => ({ el: cloneElement(el, { key: 'item' }), sig: slotSig(el) }));

/**
 * Кнопки общей шапки. Живёт одним экземпляром на все вкладки: при смене
 * набора сверяет места (reconcileSlots) — кнопка, оставшаяся на соседней
 * вкладке, не пересоздаётся и не двигается, уходящие стекают, пришедшие
 * набухают. Первый набор (шапка встала на место сразу) — без движения.
 * @param tab   вкладка, которой принадлежит набор
 * @param items кнопки (элементы) — spec.children хоста
 * @param style раскладка ряда (TabHeader: actions)
 */
export function HeaderActions({ tab, items, style }) {
  const enabled = useLiquidEnabled();
  const ids = useRef(0);
  const makeId = () => { ids.current += 1; return ids.current; };
  const [slots, setSlots] = useState(() => toSlots(items).map((n) => ({ id: makeId(), ...n, visible: true, entering: false })));
  const built = useRef({ tab, items });
  // До отрисовки: прежние места не успевают показаться с новым набором.
  useLayoutEffect(() => {
    // Шапка вкладки ещё строится (items нет): кнопки прежней вкладки стоят, а
    // не стекают, чтобы тут же набухнуть снова, — их сверит настоящий набор.
    if (items == null) return;
    if (built.current.tab === tab && built.current.items === items) return;
    const switched = built.current.tab !== tab;
    built.current = { tab, items };
    setSlots((prev) => reconcileSlots(prev, toSlots(items), switched, makeId));
  }, [tab, items]);
  const gone = (id) => setSlots((all) => all.filter((s) => s.id !== id || s.visible));
  return (
    <View style={style} pointerEvents={items == null ? 'none' : 'box-none'}>
      {slots.map((s) => <ActionSlot key={s.id} slot={s} enabled={enabled} onGone={gone} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  fromLeft: { transformOrigin: 'left center' },
  // Кнопка — абсолютом: меряется в свою ширину, а не в ширину места.
  body: { position: 'absolute', left: 0, top: 0 },
});

// Жидкое движение — общие детали (числа и формы — lib/liquid.js, карта —
// DESIGN.md, «Телефон» → «Жидкое движение»):
//
// - useLiquidGlide — подложка выбранного переезжает под новое место,
//   вытягиваясь в сторону движения и догоняя хвост, с упругой остановкой:
//   сегментные вкладки (Segmented) и плашка активной вкладки панели (MainTabBar);
// - useLiquidPresence + useMorphStyles — капля набухает в плашку и стекает
//   обратно: бейдж таймера в шапке задачи (DetailHeader) и плашка идущей
//   задачи (TimerMiniPlayer);
// - LiquidButton — кнопка старта: акцент наливается в скруглённый квадрат,
//   форма вздрагивает, «■» выпрыгивает; при остановке акцент стекает;
// - LiquidCheck — галочка «выполнено»: тот же налив, быстрее, в конце «поп»
//   и брызги-капли; отмена — акцент стекает без брызг. У отменённой задачи
//   на её месте серый крестик (LiquidCross): два штриха прорисовываются и
//   стираются, без брызг.
// - LiquidDrops (+ useDropsBurst) — брызги-капли: общая деталь галочки и шкалы.
// Шкалы прогресса — components/ProgressBar.js (на тех же числах); дойдя до
// 100 % они делают «поп» и брызгают теми же каплями.
//
// Первая отрисовка — без движения: всё встаёт на место сразу. «Уменьшение
// движения» — тоже сразу. На iOS 26+ капля, налив и плашка не играют
// (liquidAllowed): там шапка и плашка нативные, на стекле.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, runOnJS } from 'react-native-reanimated';
import Tap from './Tap';
import Icon from './Icon';
import { useReduceMotion } from '../hooks/useReduceMotion';
import {
  LIQUID, JELLY_DELAY, JELLY_KICK, POP_FROM, POP_DELAY, FILL_SCALE, CHECK_POP_KICK, CHECK_POP_DELAY, CHECK_DROPS,
  CROSS_POP_KICK, CROSS_POP_DELAY,
  liquidAllowed, liquidSpan, liquidMorph, pourFill, crossDraw, dropAt, noteKick, freshKick, fillFrom,
} from '../lib/liquid';
import { useColors } from '../theme';

/** Играет ли жидкость здесь и сейчас: не iOS 26+ и не «уменьшение движения». */
export function useLiquidEnabled() {
  const reduced = useReduceMotion();
  return !reduced && liquidAllowed();
}

/**
 * Подложка выбранного. to(rect, animate) — поставить под место
 * {x, y, w, h} (координаты в родителе подложки): с анимацией — переезд с
 * растяжением, без — сразу. hide() — убрать (выбора нет). Пока ни разу не
 * поставлена, подложки не видно.
 * @param enabled можно ли двигаться (иначе любое to — сразу)
 */
export function useLiquidGlide(enabled) {
  const fx = useSharedValue(0);
  const fw = useSharedValue(0);
  const tx = useSharedValue(0);
  const tw = useSharedValue(0);
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const p = useSharedValue(1);
  const shown = useSharedValue(0);
  const placed = useRef(false);

  const style = useAnimatedStyle(() => {
    const s = liquidSpan({ x: fx.value, w: fw.value }, { x: tx.value, w: tw.value }, p.value);
    return {
      opacity: shown.value,
      top: top.value,
      height: height.value,
      width: s.w,
      transform: [{ translateX: s.x }, { scaleY: s.sy }],
    };
  });

  function to(rect, animate) {
    if (animate && enabled && placed.current) {
      // С того места, где подложка сейчас, — даже если она ещё в пути.
      const now = liquidSpan({ x: fx.value, w: fw.value }, { x: tx.value, w: tw.value }, p.value);
      fx.value = now.x;
      fw.value = now.w;
      tx.value = rect.x;
      tw.value = rect.w;
      p.value = 0;
      p.value = withSpring(1, LIQUID.glide);
    } else {
      fx.value = rect.x;
      fw.value = rect.w;
      tx.value = rect.x;
      tw.value = rect.w;
      p.value = 1;
    }
    top.value = rect.y;
    height.value = rect.h;
    shown.value = 1;
    placed.current = true;
  }

  function hide() {
    shown.value = 0;
  }

  return { style, to, hide };
}

/**
 * Есть ли элемент на экране и где он между каплей и плашкой. Появился —
 * mounted сразу, p пружиной 0 → 1; пропал — p стекает 1 → 0, и только
 * потом mounted = false. Что было при первой отрисовке — стоит сразу.
 * @param visible должен ли элемент быть
 * @param enabled можно ли двигаться (иначе — сразу)
 */
export function useLiquidPresence(visible, enabled) {
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
      p.value = withTiming(0, LIQUID.drain, (done) => { if (done) runOnJS(setMounted)(false); });
    } else {
      p.value = 0;
      setMounted(false);
    }
  }, [visible]);
  return { mounted: mounted || visible, visible, p };
}

/**
 * Стили капли-плашки: plate — подложка (у левого края, по высоте по
 * центру), content — содержимое (проявляется, когда плашка почти дотянулась),
 * slot — ширина места в раскладке (бейдж двигает соседей вслед за каплей).
 * @param p       прогресс из useLiquidPresence
 * @param width   ширина плашки — shared value (меряется onLayout);
 *                fill — плашка во всю ширину родителя, пока стоит
 * @param height  высота плашки; radius — её скругление в покое
 * @param gap     зазор до соседа в раскладке: пока капля меньше своей
 *                высоты, зазор подбирается вместе с ней — сосед не прыгает
 */
export function useMorphStyles(p, width, height, radius, { fill = false, gap = 0 } = {}) {
  const plate = useAnimatedStyle(() => {
    const m = liquidMorph(p.value, width.value, height, radius);
    const rest = p.value === 1;
    return {
      width: rest && fill ? '100%' : m.w,
      height: m.h,
      top: (height - m.h) / 2,
      borderRadius: m.r,
    };
  });
  const content = useAnimatedStyle(() => ({ opacity: liquidMorph(p.value, width.value, height, radius).content }));
  const slot = useAnimatedStyle(() => {
    const m = liquidMorph(p.value, width.value, height, radius);
    return { width: Math.min(m.w, width.value || m.w), marginRight: -gap * (1 - Math.min(1, m.w / height)) };
  });
  return { plate, content, slot };
}

/**
 * Кнопка старта таймера задачи (▶/■) с наливом. Размер, скругление и
 * подложку «стоит» берёт из style (там же — taskControlRadius, его держит
 * taskControls.test.js); налитая — акцент.
 * @param on         идёт ли таймер этой задачи
 * @param kickId     id задачи: перерисованная посреди налива кнопка его
 *                   подхватывает (lib/liquid.js, noteKick/freshKick)
 * @param kickOnPress вздрогнуть на нажатие, даже если «идёт» не меняется
 *                   («Сегодня»: после старта на месте кнопки другая задача)
 * @param iconSize   размер значка; iconColor — его цвет, пока стоит
 */
export function LiquidButton({ on = false, onPress, style, iconSize = 12, iconColor, kickId, kickOnPress = false, ...rest }) {
  const colors = useColors();
  const enabled = useLiquidEnabled();
  const box = StyleSheet.flatten(style) || {};
  const { backgroundColor, ...frame } = box;
  const base = backgroundColor || colors.panel2;
  const size = box.width || 38;
  const radius = box.borderRadius || 0;
  const side = size * FILL_SCALE;

  // Перерисованная посреди налива кнопка с первого же кадра стоит там, откуда
  // налив начинается, — иначе мелькнула бы уже налитой (или пустой).
  const [fresh] = useState(() => enabled && freshKick(kickId, on));
  const fill = useSharedValue(fillFrom(fresh, on));
  const jx = useSharedValue(1);
  const jy = useSharedValue(1);
  const pop = useSharedValue(1);
  const was = useRef(on);

  function shake(kick) {
    jx.value = withDelay(JELLY_DELAY, withSpring(1, { ...LIQUID.jelly, velocity: kick }));
    jy.value = withDelay(JELLY_DELAY, withSpring(1, { ...LIQUID.jelly, velocity: -kick }));
  }
  function popIn(delay) {
    pop.value = POP_FROM;
    pop.value = withDelay(delay, withSpring(1, LIQUID.pop));
  }
  function play(nowOn) {
    fill.value = withTiming(nowOn ? 1 : 0, nowOn ? LIQUID.pour : LIQUID.unpour);
    shake(nowOn ? JELLY_KICK : JELLY_KICK * 0.6);
    popIn(nowOn ? POP_DELAY : 60);
  }

  // Кнопку перерисовали заново сразу после переключения — налив с начала.
  useEffect(() => {
    if (fresh) play(on);
  }, []);

  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    noteKick(kickId, on);
    if (enabled) play(on);
    else fill.value = on ? 1 : 0;
  }, [on]);

  const shapeStyle = useAnimatedStyle(() => ({
    backgroundColor: fill.value > 0.999 ? colors.accent : base,
    transform: [{ scaleX: jx.value }, { scaleY: jy.value }],
  }));
  const blobStyle = useAnimatedStyle(() => {
    const f = pourFill(fill.value, size);
    return { opacity: fill.value > 0.001 ? 1 : 0, transform: [{ translateY: f.ty }, { rotate: `${f.rot}deg` }] };
  });
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: jx.value * pop.value }, { scaleY: jy.value * pop.value }],
  }));

  function press(e) {
    noteKick(kickId, !on);
    if (kickOnPress && enabled) { shake(JELLY_KICK); popIn(0); }
    if (onPress) onPress(e);
  }

  return (
    <Tap {...rest} onPress={press} style={frame}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }, shapeStyle]} testID="liquid-shape">
        <Animated.View
          style={[{ position: 'absolute', left: (size - side) / 2, top: 0, width: side, height: side, borderRadius: side * 0.42, backgroundColor: colors.accent }, blobStyle]}
          testID="liquid-fill"
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={iconStyle} testID="liquid-icon">
        <Icon name={on ? 'stop' : 'play'} size={iconSize} color={on ? colors.accentText : (iconColor || colors.text)} />
      </Animated.View>
    </Tap>
  );
}

/** Сколько живут брызги: от «попа» (через delay мс после отметки) до последней растаявшей капли. */
export function dropsLife(delay) {
  return delay + LIQUID.burst.duration + 60;
}

/**
 * Серия брызг — одна на галочку и на шкалу (ProgressBar). start() начинает
 * новую (id и время отметки); через life мс серия кончается, и капель в
 * дереве нет. Её рисует LiquidDrops.
 * @param life сколько живёт серия (dropsLife)
 * @returns [серия | null, start]
 */
export function useDropsBurst(life) {
  // Брызги: id серии и когда она началась (их задержка считается от отметки,
  // а не от отрисовки капель — та на телефоне запаздывает).
  const [burst, setBurst] = useState(null);
  // Брызги долетели и растаяли — их больше нет в дереве.
  useEffect(() => {
    if (!burst) return undefined;
    const id = setTimeout(() => setBurst(null), life);
    return () => clearTimeout(id);
  }, [burst]);
  const start = () => setBurst((b) => ({ id: (b ? b.id : 0) + 1, at: Date.now() }));
  return [burst, start];
}

/**
 * Галочка «выполнено» у задачи с наливом. Отметили — акцент наливается
 * снизу тем же скруглённым квадратом с поворотом, что у кнопки старта, но
 * быстрее (LIQUID.check, 260 мс); на ⅘ налива квадрат делает «поп» (толчок
 * пружины до ~1,12) и из него брызгают CHECK_DROPS капель акцента — летят в
 * стороны и тают (LIQUID.burst, 300 мс). Сняли отметку — акцент стекает
 * (LIQUID.uncheck), без «попа» и брызг. Капли есть в дереве, только пока
 * летят.
 *
 * Размер, скругление (taskCheckRadius — держит taskControls.test.js), рамку
 * и подложку «не отмечена» берёт из style места; отмеченная — акцент.
 *
 * Отменённая задача (cancelled) — на том же месте серый крестик вместо
 * галочки (LiquidCross), и это уже кнопка «вернуть в работу», а не отметка.
 * Стала отменённой, пока строка на виду (статус сменили на странице задачи или
 * на доске), — штрихи прорисовываются и квадрат делает небольшой «поп»; вернули
 * в работу — штрихи стираются, и под ними пустая галочка. Первая отрисовка и
 * «уменьшение движения» — сразу.
 * @param checked   отмечена ли
 * @param cancelled отменена ли задача
 * @param kickId    id задачи: строку, перерисованную посреди налива (уехала
 *                  в другой раздел), галочка подхватывает (noteKick/freshKick)
 * @param iconSize  размер галочки внутри
 */
export function LiquidCheck({ checked = false, cancelled = false, onPress, style, iconSize = 11, kickId, ...rest }) {
  const colors = useColors();
  const enabled = useLiquidEnabled();
  const box = StyleSheet.flatten(style) || {};
  const { backgroundColor, borderWidth = 0, borderColor, ...frame } = box;
  // Отметка и роль — у галочки; у крестика это кнопка, отметки в ней нет.
  const { accessibilityRole, accessibilityState, ...tapProps } = rest;
  const size = box.width || 24;
  const radius = box.borderRadius || 0;
  const side = size * FILL_SCALE;
  const key = kickId != null ? `check:${kickId}` : null;

  const [fresh] = useState(() => enabled && freshKick(key, checked));
  const fill = useSharedValue(fillFrom(fresh, checked));
  const pop = useSharedValue(1);
  const cross = useSharedValue(cancelled ? 1 : 0);
  // Крестик в дереве, пока он нужен: отменена или ещё стирается.
  const [crossOn, setCrossOn] = useState(cancelled);
  const crossTimer = useRef(null);
  const [burst, startBurst] = useDropsBurst(dropsLife(CHECK_POP_DELAY));
  const was = useRef(checked);
  const wasCancelled = useRef(cancelled);

  function play(nowOn) {
    if (nowOn) {
      fill.value = withTiming(1, LIQUID.check);
      pop.value = withDelay(CHECK_POP_DELAY, withSpring(1, { ...LIQUID.pop, velocity: CHECK_POP_KICK }));
      startBurst();
    } else {
      fill.value = withTiming(0, LIQUID.uncheck);
    }
  }

  // Галочку перерисовали заново сразу после отметки (строка уехала в другую
  // группу) — налив с начала; с первого кадра она стоит там, откуда он
  // начинается, а не мелькает уже налитой.
  useEffect(() => {
    if (fresh) play(checked);
  }, []);

  useEffect(() => {
    if (was.current === checked) return;
    was.current = checked;
    noteKick(key, checked);
    if (enabled) play(checked);
    else fill.value = checked ? 1 : 0;
  }, [checked]);

  // Задачу отменили или вернули в работу, пока строка на виду.
  useEffect(() => {
    if (wasCancelled.current === cancelled) return undefined;
    wasCancelled.current = cancelled;
    clearTimeout(crossTimer.current);
    if (cancelled) setCrossOn(true);
    if (!enabled) {
      cross.value = cancelled ? 1 : 0;
      if (!cancelled) setCrossOn(false);
      return undefined;
    }
    if (cancelled) {
      cross.value = withTiming(1, LIQUID.cross);
      pop.value = withDelay(CROSS_POP_DELAY, withSpring(1, { ...LIQUID.pop, velocity: CROSS_POP_KICK }));
    } else {
      cross.value = withTiming(0, LIQUID.uncross);
      crossTimer.current = setTimeout(() => setCrossOn(false), LIQUID.uncross.duration + 40);
    }
    return undefined;
  }, [cancelled]);
  useEffect(() => () => clearTimeout(crossTimer.current), []);

  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  // Налитая до конца — сплошной акцент, и рамка под ним тоже: по краю
  // скругления не просвечивает ни подложка, ни рамка. Крестик нарисован до
  // конца — то же с его серой подложкой.
  const baseStyle = useAnimatedStyle(() => ({
    borderColor: fill.value > 0.999 ? colors.accent : cross.value > 0.999 ? colors.raise : borderColor,
  }));
  const shapeStyle = useAnimatedStyle(() => ({ backgroundColor: fill.value > 0.999 ? colors.accent : 'transparent' }));
  const blobStyle = useAnimatedStyle(() => {
    const f = pourFill(fill.value, size);
    return { opacity: fill.value > 0.001 ? 1 : 0, transform: [{ translateY: f.ty }, { rotate: `${f.rot}deg` }] };
  });
  // Галочка проявляется на второй половине налива и гаснет первой при сливе.
  const iconStyle = useAnimatedStyle(() => {
    const v = Math.min(1, Math.max(0, (fill.value - 0.5) / 0.4));
    return { opacity: v, transform: [{ scale: 0.5 + 0.5 * v }] };
  });

  function press(e) {
    noteKick(key, !checked);
    if (onPress) onPress(e);
  }

  return (
    <Tap
      {...tapProps}
      accessibilityRole={cancelled ? 'button' : accessibilityRole}
      accessibilityState={cancelled ? undefined : accessibilityState}
      onPress={press}
      style={frame}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, checkStyles.center, boxStyle]} testID="check-box">
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth, backgroundColor }, baseStyle]} testID="check-base" />
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }, shapeStyle]} testID="check-shape">
          <Animated.View
            style={[{ position: 'absolute', left: (size - side) / 2, top: 0, width: side, height: side, borderRadius: side * 0.42, backgroundColor: colors.accent }, blobStyle]}
            testID="check-fill"
          />
        </Animated.View>
        {crossOn || cancelled ? <LiquidCross progress={cross} size={size} radius={radius} iconSize={iconSize} /> : null}
        <Animated.View style={iconStyle} testID="check-icon">
          <Icon name="check" size={iconSize} color={colors.accentText} />
        </Animated.View>
      </Animated.View>
      {burst ? <LiquidDrops key={burst.id} at={burst.at} size={size} style={{ left: size / 2, top: size / 2 }} /> : null}
    </Tap>
  );
}

// Толщина штриха крестика, pt.
const CROSS_STROKE = 2;

/**
 * Серый крестик «отменено» внутри квадрата галочки: подложка проступает, два
 * штриха прорисовываются по очереди (lib/liquid.js, crossDraw) — от угла к
 * углу, как пером. Нажатий не ловит: нажимается сама галочка (LiquidCheck).
 * Цвета — токены: подложка raise, штрихи textFaint (тот же серый, что у
 * «Выполнено» в мете).
 * @param progress shared value 0…1: 0 — пусто, 1 — нарисован
 * @param size     сторона квадрата; radius — его скругление
 * @param iconSize размер значка внутри: крестик чуть меньше галочки
 */
export function LiquidCross({ progress, size, radius, iconSize = 11 }) {
  const colors = useColors();
  const len = Math.round(iconSize * 1.15);
  const base = { position: 'absolute', left: (size - len) / 2, top: (size - len) / 2, width: len, height: len, justifyContent: 'center' };
  const bar = { width: len, height: CROSS_STROKE, borderRadius: CROSS_STROKE / 2, backgroundColor: colors.textFaint };
  const fillStyle = useAnimatedStyle(() => ({ opacity: crossDraw(progress.value).fill }));
  // Штрих растёт от левого конца (до поворота): масштаб идёт от центра, и
  // сдвиг на недостающую половину длины оставляет левый конец на месте.
  const strokeA = useAnimatedStyle(() => {
    const p = crossDraw(progress.value).a;
    return { transform: [{ translateX: -(len / 2) * (1 - p) }, { scaleX: p }] };
  });
  const strokeB = useAnimatedStyle(() => {
    const p = crossDraw(progress.value).b;
    return { transform: [{ translateX: -(len / 2) * (1 - p) }, { scaleX: p }] };
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="cross-layer">
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: colors.raise }, fillStyle]} testID="cross-fill" />
      <View style={[base, { transform: [{ rotate: '45deg' }] }]}>
        <Animated.View style={[bar, strokeA]} testID="cross-stroke-a" />
      </View>
      <View style={[base, { transform: [{ rotate: '-45deg' }] }]}>
        <Animated.View style={[bar, strokeB]} testID="cross-stroke-b" />
      </View>
    </View>
  );
}

/**
 * Брызги: CHECK_DROPS капель из одной точки, один ход времени на все.
 * Общая деталь галочки и шкалы: брызгают вместе с «попом», летят в стороны и
 * тают (LIQUID.burst).
 * @param at    когда началась серия (useDropsBurst): сколько от неё уже
 *              прошло — столько меньше ждать
 * @param delay через сколько после `at` капли вылетают («поп»)
 * @param size  размер того, из чего брызжут: от него дальность разлёта
 * @param color цвет капель (по умолчанию акцент)
 * @param arc   веер вместо круга (lib/liquid.js, dropAt)
 * @param style где точка вылета — left/top (или right/top) внутри родителя
 */
export function LiquidDrops({ at, delay = CHECK_POP_DELAY, size, color, arc, style, testID = 'check-drops', dropTestID = 'check-drop' }) {
  const colors = useColors();
  const q = useSharedValue(0);
  useEffect(() => {
    q.value = withDelay(Math.max(0, delay - (Date.now() - at)), withTiming(1, LIQUID.burst));
  }, []);
  return (
    <View pointerEvents="none" style={[checkStyles.drops, style]} testID={testID}>
      {Array.from({ length: CHECK_DROPS }, (_, i) => <LiquidDrop key={i} i={i} q={q} size={size} arc={arc} backgroundColor={color || colors.accent} testID={dropTestID} />)}
    </View>
  );
}

function LiquidDrop({ i, q, size, arc, backgroundColor, testID }) {
  const d = 4.5 + (i % 3) * 0.9;
  const style = useAnimatedStyle(() => {
    const at = dropAt(i, CHECK_DROPS, q.value, size, arc);
    return { opacity: q.value > 0 ? at.o : 0, transform: [{ translateX: at.x }, { translateY: at.y }, { scale: at.s }] };
  });
  return <Animated.View style={[checkStyles.drop, { width: d, height: d, borderRadius: d / 2, left: -d / 2, top: -d / 2, backgroundColor }, style]} testID={testID} />;
}

const checkStyles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  // Точка в центре галочки; капли — от неё. Нажатий не ловит.
  drops: { position: 'absolute', width: 0, height: 0 },
  drop: { position: 'absolute' },
});

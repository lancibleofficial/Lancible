// Длинный текст в несколько строк с «Раскрыть» / «Скрыть» (описание проекта на
// его странице). Свёрнутый — ровно `lines` строк и многоточие на последней, а
// кнопка стоит на следующей строке: зелёный текст accentInk и шеврон вниз.
// Раскрытый — весь текст и под ним «Скрыть» с шевроном вверх. Помещается в
// `lines` строк — кнопки нет совсем.
//
// Сколько строк в полном тексте, знает только платформа, поэтому текст
// меряется невидимой копией без numberOfLines (onTextLayout): у видимого с
// numberOfLines iOS отдаёт только показанные строки, Android — как повезёт.
// Копия лежит под остальным, вне потока, на той же ширине, скрыта от
// скринридера и от нажатий.
//
// Раскрытие — высота обёртки едет withTiming между высотой `lines` строк и
// полной (по замеру), содержимое под ней обрезается. Пока едет, текст целый,
// без numberOfLines: иначе многоточие ломало бы ход. Сворачивая, numberOfLines
// возвращается, когда обёртка доехала, — по таймеру, а не по колбэку анимации.
// «Уменьшение движения» — без анимации, сразу.
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import Text from './AppText';
import Tap from './Tap';
import Icon from './Icon';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useColors, spacing } from '../theme';

const EXPAND_MS = 240;
const EASE = { duration: EXPAND_MS, easing: Easing.out(Easing.cubic) };

/** @param text — сам текст; @param lines — сколько строк свёрнутым;
 *  @param textStyle — стиль текста (lineHeight обязателен: от него высота);
 *  @param moreLabel и @param lessLabel — подписи кнопки. */
export default function ExpandableText({
  text, lines = 2, textStyle, moreLabel, lessLabel, style, testID = 'expandable-text',
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const reduced = useReduceMotion();
  const lineHeight = (StyleSheet.flatten(textStyle) || {}).lineHeight || 20;

  // Высоты строк полного текста, как их отдала платформа; пока не мерили — [].
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const h = useSharedValue(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const overflow = rows.length > lines;
  const sum = (list) => Math.ceil(list.reduce((a, b) => a + b, 0)) || list.length * lineHeight;
  const foldedH = sum(rows.slice(0, lines));
  const fullH = sum(rows);

  // Текст стал короче и умещается — раскрывать нечего.
  useEffect(() => {
    if (rows.length && !overflow && open) { clearTimeout(timer.current); setOpen(false); setMoving(false); }
  }, [rows.length, overflow, open]);

  const moveStyle = useAnimatedStyle(() => ({ height: h.value }));

  function toggle() {
    const next = !open;
    setOpen(next);
    clearTimeout(timer.current);
    if (reduced) { setMoving(false); return; }
    // Нажали на полпути — едем оттуда, где обёртка сейчас, а не с края.
    if (!moving) h.value = next ? foldedH : fullH;
    setMoving(true);
    h.value = withTiming(next ? fullH : foldedH, EASE);
    timer.current = setTimeout(() => setMoving(false), EXPAND_MS + 30);
  }

  const label = open ? lessLabel : moreLabel;
  return (
    <View style={style} testID={testID}>
      <Text
        style={[textStyle, styles.measure]}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines.map((l) => l.height);
          setRows((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`${testID}-measure`}
      >
        {text}
      </Text>
      <Animated.View style={[styles.clip, moving && moveStyle]}>
        <Text style={textStyle} numberOfLines={open || moving ? undefined : lines} testID={`${testID}-text`}>{text}</Text>
      </Animated.View>
      {overflow ? (
        <Tap
          onPress={toggle}
          style={styles.toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          testID={`${testID}-toggle`}
        >
          <Text style={styles.toggleText}>{label}</Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={colors.accentInk} />
        </Tap>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  clip: { overflow: 'hidden' },
  // Кнопка — на следующей строке под текстом, слева; поле нажатия шире (hitSlop).
  toggle: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 28 },
  toggleText: { color: colors.accentInk, fontSize: 13, fontWeight: '600' },
  // Невидимая копия для замера: вне потока, на той же ширине, нажатий не ловит.
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0, pointerEvents: 'none' },
});

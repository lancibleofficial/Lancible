// Сегментный переключатель — одна деталь на все места: вкладки «Сведения /
// История» на странице задачи, варианты в листе повторения (и та же разметка,
// что у режимов «Цифр» и вкладок страницы проекта). Выбранную кнопку
// красит не она сама, а одна подложка под всеми: при выборе она переезжает
// под нажатую жидко — вытягивается в сторону движения, догоняет хвост и
// упруго останавливается (useLiquidGlide, components/Liquid.js).
//
// Первая отрисовка, смена ширины и языка — подложка встаёт на место сразу,
// без перехода; «уменьшение движения» — тоже сразу. Выбора нет (value null)
// — подложки нет.
//
// Размер один на все места: высота segmentHeight (theme.js), подпись —
// segmentFontSize (14, ступень строк настроек); дорожка — во всю ширину
// строки, кнопки делят её поровну. Живёт только на экранах: в нижних листах
// сегментов нет (выбор вида там — строки с галочкой, ChoiceList).
//
// Скругление — в тон кнопкам (12 октября; было 10 у дорожки и 8 у подложки):
// дорожка — buttonRadius (14), подложка и кнопки внутри — концентрично,
// внешний радиус минус отступ и рамка дорожки (14 − 3 = 11). Место, которое
// задаёт дорожке своё скругление или отступ, получает подложку по тому же
// правилу, а не прежние 8: внутренний угол не толще и не тоньше внешнего.
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Tap from './Tap';
import Text from './AppText';
import { useLiquidGlide } from './Liquid';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useColors, segmentFontSize, segmentHeight, buttonRadius } from '../theme';

/** Отступ дорожки до подложки, если место не задало своего. */
const PAD = 3;

/** Скругление подложки и кнопок внутри дорожки: внешнее минус отступ и рамка. */
export function innerRadius(trackStyle) {
  const s = StyleSheet.flatten(trackStyle) || {};
  const outer = s.borderRadius ?? buttonRadius;
  const pad = s.padding ?? PAD;
  return Math.max(0, outer - pad - (s.borderWidth || 0));
}

/**
 * @param items         [{ key, label, disabled? }] — disabled: пункт виден, но не нажимается
 * @param value         ключ выбранного или null
 * @param onChange      (key) => …
 * @param style         дорожка (фон, поля, скругление)
 * @param itemStyle     кнопка; textStyle / activeTextStyle — подпись
 * @param pillColor     цвет подложки (по умолчанию raise); pillStyle — её скругление
 * @param fit           подпись ужимается, чтобы влезть, а не обрезается (по
 *                      умолчанию — да: длинные слова на других языках)
 * @param testID        у дорожки; у подложки — `${testID}-pill`
 */
export default function Segmented({ items, value, onChange, style, itemStyle, textStyle, activeTextStyle, pillColor, pillStyle, fit = true, testID, itemRole = 'tab' }) {
  const colors = useColors();
  const reduced = useReduceMotion();
  const glide = useLiquidGlide(!reduced);
  const rects = useRef({});
  const at = useRef(value);

  // Выбор сменился: подложка едет к новому месту (если оно уже измерено).
  useEffect(() => {
    if (at.current === value) return;
    const before = at.current;
    at.current = value;
    if (value == null) { glide.hide(); return; }
    const rect = rects.current[value];
    if (rect) glide.to(rect, before != null);
  }, [value]);

  // Кнопка меряется от края дорожки, а подложка стоит от края её рамки:
  // рамку дорожки (если место её задало, например окно входа) вычитаем.
  const border = (StyleSheet.flatten(style) || {}).borderWidth || 0;
  const inner = { borderRadius: innerRadius(style) };
  function onItemLayout(key, e) {
    const { x, y, width, height } = e.nativeEvent.layout;
    rects.current[key] = { x: x - border, y: y - border, w: width, h: height };
    // Своё место измерено впервые или сменило размер — встать сразу.
    if (key === at.current) glide.to(rects.current[key], false);
  }

  return (
    <View style={[styles.track, { backgroundColor: colors.panel }, style]} testID={testID} accessibilityRole="tablist">
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, inner, { backgroundColor: pillColor || colors.raise }, pillStyle, glide.style]}
        testID={testID ? `${testID}-pill` : undefined}
      />
      {items.map(({ key, label, disabled }) => {
        const on = key === value;
        return (
          <Tap
            key={String(key)}
            onPress={() => onChange(key)}
            onLayout={(e) => onItemLayout(key, e)}
            disabled={disabled}
            style={[styles.item, inner, itemStyle, disabled && styles.itemOff]}
            accessibilityRole={itemRole}
            accessibilityState={{ selected: on, disabled: !!disabled }}
          >
            <Text style={[styles.text, { color: colors.textDim }, textStyle, on && styles.textOn, on && { color: colors.text }, on && activeTextStyle]} numberOfLines={1} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.75 : undefined}>{label}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', height: segmentHeight, gap: 2, padding: PAD, borderRadius: buttonRadius },
  // Подложка — под кнопками, по месту выбранной; координаты — от useLiquidGlide,
  // скругление — innerRadius дорожки.
  pill: { position: 'absolute', left: 0 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  // Пункт, который сейчас выбрать нельзя: тише остальных, нажатие не доходит.
  itemOff: { opacity: 0.4 },
  text: { fontSize: segmentFontSize, fontWeight: '500' },
  textOn: { fontWeight: '600' },
});

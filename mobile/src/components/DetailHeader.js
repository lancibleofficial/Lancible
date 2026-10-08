// Шапка экранов задачи и редактора — одна на оба: квадрат «назад», крошка
// «● проект › что открыто», справа квадратные кнопки. Пока по задаче идёт
// таймер, крошка уступает место плашке с пульсирующей точкой и часами:
// с любого из этих экранов видно, что время считается.
import { Children, Fragment, isValidElement, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import Tap from './Tap';
import Pulse from './Pulse';
import { GlassBg, headerButtonRadius } from './Glass';
import { IOS_NATIVE_HEADER, useNativeOptions, nativeItems, elementSignature, leftElementItems } from '../navigation/nativeHeader';
import { fmtClock } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, radius, displayFamily } from '../theme';

/** Квадратная кнопка шапки 36×36; on — залита акцентом. */
export function DetailButton({ icon, on, onPress, label }) {
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  return (
    <Tap scale={0.9} hitSlop={6} onPress={onPress} style={[styles.btn, { borderRadius: headerButtonRadius(36, radius.md) }]} accessibilityRole="button" accessibilityLabel={label}>
      <GlassBg radius={headerButtonRadius(36, radius.md)} backgroundColor={on ? colors.accent : colors.panel} tint={on ? colors.accent : undefined} />
      <Icon name={icon} size={17} color={on ? colors.accentText : colors.textDim} />
    </Tap>
  );
}

/**
 * @param color   цвет проекта (точка в крошке)
 * @param title   проект; sub — что открыто (статус задачи, название задачи)
 * @param onTitle тап по крошке
 * @param running идёт ли таймер этой задачи; runSince — с какого момента (мс)
 * @param right   кнопки справа (DetailButton)
 */
export default function DetailHeader(props) {
  if (IOS_NATIVE_HEADER) return <NativeDetailHeader {...props} />;
  return <JsDetailHeader {...props} />;
}

/** Часы идущего таймера тикают сами: шапке не нужно перерисовываться
 *  каждую секунду. На iOS 26 это важно — каждое обновление опций нативная
 *  шапка встречает пересозданием всех кнопок, и стекло моргало. */
function RunClock({ since, style }) {
  useTicker(true);
  return <Text style={style}>{fmtClock(Math.max(0, Date.now() - (since || Date.now())))}</Text>;
}

/** Крошка «● проект › что открыто» и плашка идущего таймера. */
function Crumb({ color, title, sub, onTitle, running, runSince, styles, flex }) {
  const colors = useColors();
  return (
    <Tap style={[styles.crumb, !flex && styles.crumbNative]} onPress={onTitle} disabled={!onTitle} hitSlop={6} accessibilityRole={onTitle ? 'button' : undefined}>
      {running ? (
        <View style={styles.pill} accessibilityLiveRegion="polite">
          <Pulse color={colors.accentInk} />
          <RunClock since={runSince} style={styles.pillClock} />
        </View>
      ) : null}
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={styles.crumbText} numberOfLines={1}>{title || ''}</Text>
      {sub ? <Text style={styles.crumbFaint} numberOfLines={1}>› {sub}</Text> : null}
    </Tap>
  );
}

/** iOS 26+: «назад» — системная, кнопки справа — нативные на жидком
 *  стекле, крошка — заголовком шапки. Сам компонент ничего не рисует. */
function NativeDetailHeader({ color, title, sub, onTitle, running, runSince, right }) {
  const navigation = useNavigation();
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  const flat = isValidElement(right) && right.type === Fragment ? right.props.children : right;
  const list = Children.toArray(flat).filter(isValidElement);
  const latest = useRef(list);
  latest.current = list;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const toItem = (el) => (el.type === DetailButton
    ? { icon: el.props.icon, label: el.props.label, onPress: el.props.onPress, prominent: !!el.props.on, tint: el.props.on ? colors.accentInk : undefined }
    : null);
  const sig = [title, sub, color, running, runSince, colors.accentInk, elementSignature(list)].join('|');
  useNativeOptions(navigation, sig, () => ({
    // Крошка слева рядом с системной «назад», нашим шрифтом.
    headerTitle: '',
    headerBackVisible: true,
    unstable_headerLeftItems: () => leftElementItems(
      <Crumb color={color} title={title} sub={sub} running={running} runSince={runSince} styles={styles}
        onTitle={onTitle ? () => onTitleRef.current && onTitleRef.current() : undefined} />,
    ),
    unstable_headerRightItems: () => nativeItems(latest, toItem),
  }));
  return null;
}

function JsDetailHeader({ onBack, backLabel, color, title, sub, onTitle, running, runSince, right }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  return (
    <View style={styles.head}>
      <Tap scale={0.9} hitSlop={8} onPress={onBack} style={[styles.btn, { borderRadius: headerButtonRadius(36, radius.md) }]} accessibilityRole="button" accessibilityLabel={backLabel}>
        <GlassBg radius={headerButtonRadius(36, radius.md)} backgroundColor={colors.panel} />
        <Icon name="chevron-left" size={18} color={colors.text} />
      </Tap>
      <Crumb flex color={color} title={title} sub={sub} onTitle={onTitle} running={running} runSince={runSince} styles={styles} />
      {right}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  // Подложку даёт GlassBg: стекло на iOS 26+, заливка panel/accent ниже.
  btn: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  crumb: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  // В нативной шапке у заголовка нет ширины родителя — тянуть нечего.
  crumbNative: { flex: 0, maxWidth: 260 },
  crumbText: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  crumbFaint: { color: colors.textFaint, fontSize: 13, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.accentMuted },
  pillClock: { color: colors.accentInk, fontSize: 13, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
});

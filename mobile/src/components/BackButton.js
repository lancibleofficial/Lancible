// Стрелка «назад» в шапке экрана — квадрат 36 на подложке, как квадратные
// кнопки шапки справа (HeaderButton, DetailButton): та же заливка panel (на
// стекле iOS — само стекло), то же скругление headerButtonRadius. Одна на
// шапку стека (AppHeader) и шапку задачи (DetailHeader): голой стрелкой без
// подложки «назад» остаётся только там, где её рисует система — в нативной
// шапке iOS 26+ (navigation/nativeHeader.js), эти шапки на ней не рисуются.
// Нажатие — жидкое, как у всех кнопок шапки (LiquidPress).
import { StyleSheet } from 'react-native';
import { LiquidPress } from './HeaderLiquid';
import Icon from './Icon';
import { GlassBg, headerButtonRadius } from './Glass';
import { useColors, radius } from '../theme';

/** Сторона квадрата — как у всех кнопок шапки. */
export const BACK_SIZE = 36;

/**
 * @param onPress  вернуться
 * @param label    подпись для доступности («Назад»)
 */
export default function BackButton({ onPress, label, testID }) {
  const colors = useColors();
  const corner = headerButtonRadius(BACK_SIZE, radius.md);
  return (
    <LiquidPress hitSlop={8} onPress={onPress} style={[styles.btn, { borderRadius: corner }]} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <GlassBg radius={corner} backgroundColor={colors.panel} />
      <Icon name="chevron-left" size={18} color={colors.text} />
    </LiquidPress>
  );
}

const styles = StyleSheet.create({
  btn: { width: BACK_SIZE, height: BACK_SIZE, alignItems: 'center', justifyContent: 'center' },
});

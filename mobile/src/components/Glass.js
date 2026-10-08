// Жидкое стекло iOS 26 для верхней навигации: кнопки и чипы шапок (назад,
// поиск, колокольчик, меню, фильтр проекта) на iOS 26 и выше лежат на
// настоящем Liquid Glass — системном материале UIKit через expo-glass-effect.
// Ниже iOS 26 и на Android подложка та же, что была: заливка цветом темы.
//
// Модуль берётся лениво и под try: в Node (jest) нативной части нет, и
// импорт сверху уронил бы любой экран с шапкой.
import { Platform, View, StyleSheet } from 'react-native';
import { useThemeMode } from '../theme';

let cached;
function glassModule() {
  if (cached !== undefined) return cached;
  cached = null;
  const major = parseInt(String(Platform.Version), 10) || 0;
  if (Platform.OS !== 'ios' || major < 26) return cached;
  try {
    // eslint-disable-next-line global-require
    const m = require('expo-glass-effect');
    if (m.isLiquidGlassAvailable()) cached = m;
  } catch (e) {
    cached = null;
  }
  return cached;
}

/** Есть ли на устройстве жидкое стекло (iOS 26+). */
export function hasLiquidGlass() {
  return !!glassModule();
}

/**
 * Подложка кнопки или чипа шапки. Кладётся первым ребёнком и растягивается
 * на весь родитель.
 * @param radius   скругление — как у самой кнопки
 * @param backgroundColor заливка без стекла (Android, iOS ниже 26); не задана —
 *                 без стекла подложки нет вовсе
 * @param tint     оттенок стекла (акцентная кнопка)
 */
export function GlassBg({ radius, backgroundColor, tint }) {
  const mode = useThemeMode();
  const m = glassModule();
  if (m) {
    return (
      <m.GlassView
        isInteractive
        glassEffectStyle="regular"
        colorScheme={mode === 'light' ? 'light' : 'dark'}
        tintColor={tint}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
    );
  }
  if (!backgroundColor) return null;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor }]} />;
}

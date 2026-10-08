// Жидкое стекло iOS 26 для верхней навигации: кнопки и чипы шапок (назад,
// поиск, колокольчик, меню, фильтр проекта) на iOS 26 и выше лежат на
// настоящем Liquid Glass — системном материале UIKit через expo-glass-effect.
// Ниже iOS 26 и на Android подложка та же, что была: заливка цветом темы.
//
// Включается по наличию самого API стекла (isGlassEffectAPIAvailable —
// есть ли в системе UIGlassEffect), а не по isLiquidGlassAvailable: вторая
// смотрит ещё и в Info.plist приложения и в Expo Go на iOS 26 отвечала
// «нет» — кнопки шапки оставались залитыми, хотя панель вкладок рядом
// стеклянная.
//
// Модуль берётся лениво и под try: в Node (jest) нативной части нет, и
// импорт сверху уронил бы любой экран с шапкой. В режиме разработки на iOS
// результат проверок один раз уходит в лог Metro — по нему видно, почему
// стекла нет, если его нет.
import { createContext, useContext } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { useThemeMode } from '../theme';

// Элемент внутри нативной шапки iOS 26: стекло ему даёт система, своя
// подложка лишняя.
const InNativeHeader = createContext(false);
export function NativeHeaderScope({ children }) {
  return <InNativeHeader.Provider value>{children}</InNativeHeader.Provider>;
}

let cached;
function ask(fn, info, key) {
  try { return !!fn(); } catch (e) { info[key + 'Error'] = String((e && e.message) || e).slice(0, 160); return false; }
}
function glassModule() {
  if (cached !== undefined) return cached;
  cached = null;
  const major = parseInt(String(Platform.Version), 10) || 0;
  const info = { os: Platform.OS, version: String(Platform.Version) };
  if (Platform.OS === 'ios' && major >= 26) {
    try {
      // eslint-disable-next-line global-require
      const m = require('expo-glass-effect');
      info.api = ask(m.isGlassEffectAPIAvailable, info, 'api');
      info.design = ask(m.isLiquidGlassAvailable, info, 'design');
      if (info.api || info.design) cached = m;
    } catch (e) {
      info.error = String((e && e.message) || e);
    }
  }
  // eslint-disable-next-line no-undef
  if (Platform.OS === 'ios' && typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[glass]', JSON.stringify({ ...info, on: !!cached }));
  }
  return cached;
}

/** Есть ли на устройстве жидкое стекло (iOS 26+). */
export function hasLiquidGlass() {
  return !!glassModule();
}

/** Скругление кнопки шапки: на стекле — круг, как у системных кнопок iOS 26,
 *  без стекла — прежний скруглённый квадрат. */
export function headerButtonRadius(size, square) {
  return hasLiquidGlass() ? size / 2 : square;
}

/**
 * Подложка кнопки или чипа шапки. Кладётся первым ребёнком и растягивается
 * на весь родитель.
 * @param radius          скругление — как у самой кнопки
 * @param backgroundColor заливка без стекла (Android, iOS ниже 26); не задана —
 *                        без стекла подложки нет вовсе
 * @param tint            оттенок стекла (акцентная кнопка)
 */
export function GlassBg({ radius, backgroundColor, tint }) {
  const mode = useThemeMode();
  const inNative = useContext(InNativeHeader);
  const m = glassModule();
  if (inNative) return null;
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

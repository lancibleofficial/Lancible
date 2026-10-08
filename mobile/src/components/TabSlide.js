// Пролистывание вкладок на iOS: содержимое и заголовок шапки доезжают на
// место со стороны открытой вкладки (события — navigation/tabSlide.js).
// Старую вкладку система уже убрала, поэтому новая въезжает не на всю
// ширину, а на пятую часть, ease out. Без прозрачности: страница всегда
// видна, она только сдвинута, — иначе при смене вкладки мелькал пустой
// экран. Кнопки шапки нативные — их сменяет система вместе с вкладкой.
//
// На Android вкладки пролистывает навигатор целиком, здесь ничего не
// делается.
import { createContext, useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { subscribeTab, freshSide } from '../navigation/tabSlide';

const MOVE = { duration: 320, easing: Easing.out(Easing.cubic) };
/** Доля ширины экрана, с которой въезжает страница. */
export const PAGE_SHIFT = 0.2;
/** Сдвиг заголовка шапки, pt. */
export const TITLE_SHIFT = 24;

/** Имя вкладки для шапки: заголовок въезжает вместе со страницей. */
export const TabNameContext = createContext(null);

function useSlideIn(tab, shift) {
  const [side] = useState(() => freshSide(tab));
  const x = useSharedValue(side * shift);

  useEffect(() => {
    if (side) x.value = withTiming(0, MOVE);
    return subscribeTab(tab, (e) => {
      // Спрятанную вкладку ставим туда, откуда она въедет.
      if (e.type === 'park') { x.value = e.side * shift; return; }
      x.value = withTiming(0, MOVE);
    });
  }, [tab, shift]);

  return useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
}

function IosTabPage({ tab, children }) {
  const { width } = useWindowDimensions();
  const style = useSlideIn(tab, width * PAGE_SHIFT);
  return (
    <TabNameContext.Provider value={tab}>
      <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
    </TabNameContext.Provider>
  );
}

/** Корень вкладки: на iOS въезжает со стороны вкладки, на Android — как есть. */
export function TabPage({ tab, children }) {
  if (Platform.OS !== 'ios') return children;
  return <IosTabPage tab={tab}>{children}</IosTabPage>;
}

/** Корневой экран вкладки, завёрнутый в TabPage. */
export function withTabPage(Screen, tab) {
  function Page(props) {
    return <TabPage tab={tab}><Screen {...props} /></TabPage>;
  }
  Page.displayName = `TabPage(${tab})`;
  return Page;
}

/** Заголовок нативной шапки вкладки: въезжает вместе со страницей. */
export function TabTitleSlide({ tab, children }) {
  const style = useSlideIn(tab, TITLE_SHIFT);
  return <Animated.View style={style}>{children}</Animated.View>;
}

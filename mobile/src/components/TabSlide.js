// Пролистывание вкладок на iOS: содержимое и заголовок шапки въезжают со
// стороны открытой вкладки (события — navigation/tabSlide.js). Старую
// вкладку система уже убрала, поэтому новая въезжает не на всю ширину, а
// на треть, с проявлением, ease out. Кнопки шапки нативные — их сменяет
// система вместе с вкладкой.
//
// На Android вкладки пролистывает навигатор целиком, здесь ничего не
// делается.
import { createContext, useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { subscribeTab, freshSide } from '../navigation/tabSlide';

const MOVE = { duration: 320, easing: Easing.out(Easing.cubic) };
const SHOW = { duration: 220, easing: Easing.out(Easing.quad) };
/** Доля ширины экрана, с которой въезжает страница. */
export const PAGE_SHIFT = 0.3;
/** Сдвиг заголовка шапки, pt. */
export const TITLE_SHIFT = 24;

/** Имя вкладки для шапки: заголовок въезжает вместе со страницей. */
export const TabNameContext = createContext(null);

function useSlideIn(tab, shift) {
  const [side] = useState(() => freshSide(tab));
  const x = useSharedValue(side * shift);
  const op = useSharedValue(side ? 0 : 1);

  useEffect(() => {
    if (side) {
      x.value = withTiming(0, MOVE);
      op.value = withTiming(1, SHOW);
    }
    return subscribeTab(tab, (e) => {
      if (e.type === 'out') { op.value = 0; return; }
      x.value = e.side * shift;
      x.value = withTiming(0, MOVE);
      op.value = withTiming(1, SHOW);
    });
  }, [tab, shift]);

  return useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateX: x.value }] }));
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

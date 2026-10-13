// Пролистывание вкладок на iOS: содержимое доезжает на место со стороны
// открытой вкладки (события — navigation/tabSlide.js). Старую вкладку
// система уже убрала, поэтому новая въезжает не на всю ширину, а на пятую
// часть, ease out. Без прозрачности: страница всегда видна, она только
// сдвинута, — иначе при смене вкладки мелькал пустой экран.
//
// Шапка при смене вкладки не двигается и не гаснет — ни здесь, ни на Android:
// меняется только то, что в ней, и жидко, коротко: название каплей, лишние
// кнопки стекают, недостающие набухают (TabHeader.js, HeaderLiquid.js). У
// нативной шапки iOS 26+ кнопки и заголовок сменяет система вместе с вкладкой.
//
// Скелетон вкладки (withTabPage) грузит только содержимое страницы: шапка и
// панель вкладок готовы всегда и в нём не рисуются полосами (Skeleton.js).
//
// На Android вкладки пролистывает навигатор целиком, страница не двигается
// сама; здесь только имя вкладки для шапки.
import { createContext, useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { subscribeTab, freshSide } from '../navigation/tabSlide';

const MOVE = { duration: 320, easing: Easing.out(Easing.cubic) };
/** Доля ширины экрана, с которой въезжает страница. */
export const PAGE_SHIFT = 0.2;

/** Имя вкладки для шапки: по нему шапка знает, чьё содержимое показывать. */
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

/** Корень вкладки: на iOS въезжает со стороны вкладки, на Android — как есть;
 *  имя вкладки отдаёт шапке на обеих. */
export function TabPage({ tab, children }) {
  if (Platform.OS !== 'ios') return <TabNameContext.Provider value={tab}>{children}</TabNameContext.Provider>;
  return <IosTabPage tab={tab}>{children}</IosTabPage>;
}

/** Корневой экран вкладки, завёрнутый в TabPage. Skeleton — заглушка
 *  вкладки: при первом показе она стоит первые кадры, пока строится
 *  настоящая страница (на тяжёлой вкладке это заметное время, и переход
 *  иначе подтормаживал на пустом месте). */
export function withTabPage(Screen, tab, Skeleton) {
  function Page(props) {
    const [ready, setReady] = useState(!Skeleton);
    useEffect(() => {
      if (ready) return undefined;
      // Два кадра: заглушка успевает показаться до тяжёлой отрисовки.
      let second;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setReady(true)); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, []);
    return <TabPage tab={tab}>{ready ? <Screen {...props} /> : <Skeleton />}</TabPage>;
  }
  Page.displayName = `TabPage(${tab})`;
  return Page;
}

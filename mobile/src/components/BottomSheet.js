import { createContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSheetStore, closeSheet } from '../store/useSheetStore';
import { useAppStore } from '../store/useAppStore';
import Tap from './Tap';
import Icon from './Icon';
import { t } from '../lib/i18n';
import { HEADER_CONTENT_HEIGHT } from './AppHeader';
import { useColors, radius, spacing } from '../theme';

/** Прокрутка листа для содержимого: открыть лист сразу на нужном разделе. */
export const SheetScrollContext = createContext({ scrollTo: () => {} });

const OPEN_MS = 260;
const CLOSE_MS = 220;
const DRAG_CLOSE_DISTANCE = 100;
const DRAG_CLOSE_VELOCITY = 0.8;

// Ушли от @gorhom/bottom-sheet на голый RN Modal+Animated+PanResponder — их
// BottomSheetModal стабильно не открывался (present() отрабатывал, состояние
// внутри библиотеки менялось, но на экране ничего не появлялось), это
// известный класс багов у этой библиотеки на Android без единой надёжной
// починки. Здесь всё построено из примитивов, которые можно проверить
// чтением исходников RN, а не поведением стороннего пакета:
// - Modal с transparent — отдельное нативное окно, гарантированно поверх
//   таббара и вообще всего (в отличие от абсолютного View внутри дерева).
// - Drag-to-dismiss висит ТОЛЬКО на зоне граббера (не на всём листе), поэтому
//   обычный TextInput внутри контента никогда не конкурирует с этим жестом —
//   их области на экране просто не пересекаются.
// - Высота листа — плитка maxHeight + ScrollView внутри (а не снаружи, как
//   раньше): если контент короче maxHeight, лист просто обтекает его; если
//   длиннее — ScrollView скроллится, а footer (снизу, вне ScrollView) всегда
//   виден.
// - Клавиатура — через KeyboardAvoidingView, а не ручной расчёт её высоты:
//   лист прижат к низу через justifyContent:'flex-end', и KeyboardAvoidingView
//   просто уменьшает доступную высоту контейнера, что естественно поднимает
//   лист над клавиатурой. Первая версия считала высоту клавиатуры вручную и
//   сдвигала translateY на этот пиксель — из-за неточности расчёта нижняя
//   часть футера (акцентная кнопка) иногда оставалась под клавиатурой и не
//   ловила тапы, хотя текст кнопки (выше) — ловил.
//   На Android поведение НЕ задаётся вовсе, и это важно: окно приложения
//   там и так ужимается под клавиатуру (adjustResize), а behavior='height'
//   вычитал её высоту второй раз. Оба пересчёта приходят разными кадрами,
//   и лист успевал подняться, а потом опуститься обратно — палец,
//   нацеленный на «Создать», попадал в поле ввода или в «Готово».
export default function BottomSheet() {
  const content = useSheetStore((s) => s.content);
  const footer = useSheetStore((s) => s.footer);
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = makeStyles(colors);

  const [visible, setVisible] = useState(false);
  const [renderedContent, setRenderedContent] = useState(null);
  const [renderedFooter, setRenderedFooter] = useState(null);
  const translateY = useRef(new Animated.Value(windowHeight)).current;
  const scrollRef = useRef(null);
  const scrollApi = useRef({ scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: false }) }).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  // Уход вниз: лист ease in, подложка гаснет вместе с ним.
  function animateClose() {
    Animated.parallel([
      Animated.timing(translateY, { toValue: windowHeight, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }

  useEffect(() => {
    if (content) {
      setRenderedContent(content);
      setRenderedFooter(footer);
      setVisible(true);
      translateY.setValue(windowHeight);
      backdrop.setValue(0);
      requestAnimationFrame(() => {
        // Выезд на пружине: ease out с лёгким перелётом.
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, stiffness: 230, damping: 22, mass: 0.9 }),
          Animated.timing(backdrop, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      });
    } else if (visible) {
      animateClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    if (content) setRenderedFooter(footer);
  }, [footer, content]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DRAG_CLOSE_DISTANCE || g.vy > DRAG_CLOSE_VELOCITY) {
          animateClose();
          closeSheet();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, stiffness: 230, damping: 22, mass: 0.9 }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;

  // Раскрывается ровно до нижней границы шапки, а не на условные 90%
  // высоты экрана: прежняя доля не была ни к чему привязана и оставляла
  // произвольный зазор, который на разных экранах выглядел по-разному.
  const maxHeight = windowHeight - insets.top - HEADER_CONTENT_HEIGHT;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom || spacing.md, transform: [{ translateY }] }]}>
          {/* Шапка листа: ручка посередине (за неё тянут вниз), справа —
              крестик. Крестик у всех листов один, в общем месте. */}
          <View {...panResponder.panHandlers} style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <Tap scale={0.9} hitSlop={8} onPress={closeSheet} style={styles.close} accessibilityRole="button" accessibilityLabel={t(lang, 'common.close')}>
            <Icon name="x" size={13} color={colors.textDim} />
          </Tap>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.content, renderedFooter && styles.contentWithFooter]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <SheetScrollContext.Provider value={scrollApi}>{renderedContent}</SheetScrollContext.Provider>
          </ScrollView>
          {renderedFooter ? <View style={styles.footer}>{renderedFooter}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.panel, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  // Высота шапки — под крестик 30 с полями: заголовок листа ниже него.
  grabberZone: { alignItems: 'center', height: 46, paddingTop: spacing.sm },
  close: { position: 'absolute', top: spacing.sm + 2, right: spacing.md, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: spacing.xl },
  contentWithFooter: { paddingBottom: spacing.md },
  footer: {
    backgroundColor: colors.panel, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm,
  },
});

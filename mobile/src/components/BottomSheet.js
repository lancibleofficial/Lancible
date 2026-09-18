import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSheetStore, closeSheet } from '../store/useSheetStore';
import { HEADER_CONTENT_HEIGHT } from './AppHeader';
import { useColors, radius, spacing } from '../theme';

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
export default function BottomSheet() {
  const content = useSheetStore((s) => s.content);
  const footer = useSheetStore((s) => s.footer);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = makeStyles(colors);

  const [visible, setVisible] = useState(false);
  const [renderedContent, setRenderedContent] = useState(null);
  const [renderedFooter, setRenderedFooter] = useState(null);
  const translateY = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (content) {
      setRenderedContent(content);
      setRenderedFooter(footer);
      setVisible(true);
      translateY.setValue(windowHeight);
      requestAnimationFrame(() => {
        Animated.timing(translateY, {
          toValue: 0, duration: OPEN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }).start();
      });
    } else if (visible) {
      Animated.timing(translateY, {
        toValue: windowHeight, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(false);
      });
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
          Animated.timing(translateY, {
            toValue: windowHeight, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) setVisible(false);
          });
          closeSheet();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
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
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom || spacing.md, transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, renderedFooter && styles.contentWithFooter]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {renderedContent}
          </ScrollView>
          {renderedFooter ? <View style={styles.footer}>{renderedFooter}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.panel, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  grabberZone: { alignItems: 'center', paddingVertical: spacing.sm },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  contentWithFooter: { paddingBottom: spacing.md },
  footer: {
    backgroundColor: colors.panel, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm,
  },
});

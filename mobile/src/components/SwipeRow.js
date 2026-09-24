// Строка списка с одной кнопкой, открывающейся свайпом влево.
//
// Ничего не знает ни про проекты, ни про задачи: ей передают подпись, иконку
// и что делать по нажатию. В задаче 4 этот же компонент идёт в список задач.
//
// Конфликт с вертикальной прокруткой. ReanimatedSwipeable строит свой
// Gesture.Pan сам и наружу отдаёт ровно один рычаг — dragOffsetFromRightEdge,
// то есть мёртвую зону по горизонтали (по умолчанию 10). Порога по вертикали
// (failOffsetY) у него нет вовсе, поэтому единственное, чем тут можно
// управлять, — насколько далеко палец должен уйти вбок. Зона поднята до 24:
// за это расстояние вертикальная прокрутка успевает перехватить жест, и
// наклонная протяжка по списку кнопку не приоткрывает.
//
// «Открыта всегда одна» держится снаружи: строки кладут свои методы в общий
// реестр, и открывающаяся закрывает предыдущую. Внутри одного Swipeable
// такого знания нет — он не видит соседей.
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';

export const SWIPE_ACTION_WIDTH = 88;
// Насколько далеко палец должен уйти вбок, прежде чем это считается свайпом.
const X_SLOP = 24;

/** Реестр открытых строк. Один на всё приложение: одновременно открытая
 *  строка всё равно может быть только одна, на каком бы списке она ни была. */
const openRows = new Set();

export function closeOpenSwipeRows() {
  for (const row of openRows) row.close();
  openRows.clear();
}

const SwipeRow = forwardRef(function SwipeRow(
  { children, label, icon = 'pin', onAction, renderAction, enabled = true },
  ref,
) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const inner = useRef(null);

  useImperativeHandle(ref, () => ({
    open: () => inner.current && inner.current.openRight(),
    close: () => inner.current && inner.current.close(),
  }), []);

  const onWillOpen = useCallback(() => {
    for (const row of openRows) if (row !== inner.current) row.close();
    openRows.clear();
    if (inner.current) openRows.add(inner.current);
  }, []);

  const onClose = useCallback(() => {
    if (inner.current) openRows.delete(inner.current);
  }, []);

  const right = useCallback(() => {
    if (renderAction) return renderAction(inner.current);
    return (
      <Pressable
        style={styles.action}
        onPress={() => {
          if (inner.current) { inner.current.close(); openRows.delete(inner.current); }
          onAction();
        }}
      >
        <Icon name={icon} size={16} color={colors.accentText} />
        <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  }, [renderAction, onAction, label, icon, colors, styles]);

  return (
    <ReanimatedSwipeable
      ref={inner}
      enabled={enabled}
      friction={1.6}
      rightThreshold={SWIPE_ACTION_WIDTH / 2}
      overshootRight={false}
      dragOffsetFromRightEdge={X_SLOP}
      onSwipeableWillOpen={onWillOpen}
      onSwipeableClose={onClose}
      renderRightActions={right}
      containerStyle={styles.container}
    >
      {children}
    </ReanimatedSwipeable>
  );
});

export default SwipeRow;

const makeStyles = (colors) => StyleSheet.create({
  // Скругление на контейнере, а не на кнопке: иначе кнопка торчала бы
  // прямым углом из-под скруглённой карточки.
  container: { borderRadius: radius.lg, overflow: 'hidden' },
  action: {
    width: SWIPE_ACTION_WIDTH,
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accent,
  },
  actionText: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '700' },
});

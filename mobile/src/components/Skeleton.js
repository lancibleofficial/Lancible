import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IOS_NATIVE_HEADER } from '../navigation/nativeHeader';
import { useColors, spacing, radius } from '../theme';

// Заглушки на время загрузки. Смысл не в украшении: приложение читает данные
// из хранилища не мгновенно, а тяжёлая вкладка (171 строка задач, календарь
// статистики) строится заметное время. Спиннер ничего не говорит о том, что
// появится, и переход от него к готовому экрану выглядит как рывок.
// Скелетон повторяет будущую раскладку, поэтому содержимое как бы
// проявляется на своих местах.
//
// У каждой вкладки свой — по её нынешней раскладке (колода, инбокс, неделя,
// календарь, меню). AppSkeleton — запуск: «Проекты» и панель вкладок.
// Скелетоны вкладок показывает навигация (withTabPage), пока вкладка
// строится в первый раз, — экраны о них не знают.
//
// Пульсация вместо бегущего блика: она дешевле (одно свойство, нативный
// драйвер) и не отвлекает.
const PULSE_MS = 900;

export function Skeleton({ width, height = 14, radius: r = radius.sm, style }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: r, backgroundColor: colors.panel2, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) },
        style,
      ]}
    />
  );
}

/** Шапка вкладки: заголовок и круглые кнопки справа. На iOS 26 шапка
 *  нативная и уже стоит над экраном — своей не рисуем (кроме запуска). */
function SkHeader({ buttons = 1, wide = false, force = false }) {
  const insets = useSafeAreaInsets();
  const s = useStyles();
  if (IOS_NATIVE_HEADER && !force) return null;
  return (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
      <Skeleton width={128} height={24} />
      <View style={s.row}>
        {wide ? <Skeleton width={120} height={36} radius={18} /> : null}
        {Array.from({ length: buttons }, (_, i) => <Skeleton key={i} width={36} height={36} radius={radius.md} />)}
      </View>
    </View>
  );
}

/** Строка задачи: кружок, две строки текста, круглая кнопка. */
function SkTaskRow({ first }) {
  const s = useStyles();
  return (
    <View style={[s.taskRow, !first && s.topLine]}>
      <Skeleton width={26} height={26} radius={13} />
      <View style={s.taskText}>
        <Skeleton width="62%" height={15} />
        <Skeleton width="38%" height={11} />
      </View>
      <Skeleton width={38} height={38} radius={19} />
    </View>
  );
}

/** Остров со строками «подпись — значение». */
function SkListIsland({ rows = 3 }) {
  const s = useStyles();
  return (
    <View style={s.islandFlat}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[s.listRow, i > 0 && s.topLine]}>
          <Skeleton width={20} height={20} radius={6} />
          <Skeleton width="46%" height={14} />
          <View style={{ flex: 1 }} />
          <Skeleton width={44} height={12} />
        </View>
      ))}
    </View>
  );
}

/** «Проекты»: колода — карточка во всю высоту с краем следующей, точки. */
export function ProjectsSkeleton({ forceHeader = false }) {
  const { width } = useWindowDimensions();
  const s = useStyles();
  const cardW = width - spacing.lg - 40;
  return (
    <View style={s.page}>
      <SkHeader buttons={2} force={forceHeader} />
      <View style={s.deck}>
        <View style={[s.card, { width: cardW }]}>
          <View style={s.cardHead}>
            <Skeleton width={11} height={11} radius={4} />
            <View style={{ gap: 6 }}>
              <Skeleton width={130} height={17} />
              <Skeleton width={48} height={11} />
            </View>
          </View>
          <Skeleton width={96} height={19} style={s.inset} />
          <Skeleton width={cardW - spacing.md * 2} height={4} radius={2} style={s.inset} />
          <Skeleton width={cardW - 20} height={44} radius={radius.md} style={{ marginHorizontal: 10 }} />
          {[0, 1, 2, 3, 4, 5].map((i) => <SkTaskRow key={i} first={i === 0} />)}
        </View>
        <View style={s.peek} />
      </View>
      <View style={s.dots}>
        <Skeleton width={22} height={7} radius={4} />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={7} height={7} radius={4} />)}
      </View>
    </View>
  );
}

/** «Задачи»: чипы проектов, строка новой задачи, остров с группами. */
export function TasksSkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <SkHeader buttons={2} />
      <View style={s.gutter}>
        <View style={s.row}>
          {[52, 86, 72, 64].map((w, i) => <Skeleton key={i} width={w} height={34} radius={17} />)}
        </View>
        <Skeleton width="100%" height={48} radius={radius.lg} />
        <View style={s.islandFlat}>
          <Skeleton width={70} height={10} style={s.groupLabel} />
          {[0, 1, 2].map((i) => <SkTaskRow key={i} first={i === 0} />)}
          <Skeleton width={90} height={10} style={s.groupLabel} />
          {[0, 1, 2, 3].map((i) => <SkTaskRow key={i} first={i === 0} />)}
        </View>
      </View>
    </View>
  );
}

/** «Сегодня»: неделя столбиками, последняя задача, записи дня. */
export function TodaySkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <SkHeader buttons={3} />
      <View style={s.gutter}>
        <View style={s.island}>
          <Skeleton width={110} height={14} />
          <View style={s.bars}>
            {[34, 58, 22, 70, 46, 12, 30].map((h, i) => (
              <View key={i} style={s.barCol}>
                <Skeleton width={22} height={h} radius={6} />
                <Skeleton width={14} height={9} />
              </View>
            ))}
          </View>
        </View>
        <View style={[s.island, s.row]}>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={15} />
            <Skeleton width="36%" height={11} />
          </View>
          <Skeleton width={92} height={40} radius={radius.md} />
        </View>
        <SkListIsland rows={4} />
      </View>
    </View>
  );
}

/** «Цифры»: вкладки периода, календарь месяца, итог и три числа. */
export function StatsSkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <SkHeader buttons={1} wide />
      <View style={s.gutter}>
        <Skeleton width="100%" height={42} radius={radius.md} />
        <View style={s.island}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Skeleton width={36} height={36} radius={radius.md} />
            <Skeleton width={130} height={18} />
            <Skeleton width={36} height={36} radius={radius.md} />
          </View>
          {[0, 1, 2, 3, 4].map((r) => (
            <View key={r} style={s.calRow}>
              {[0, 1, 2, 3, 4, 5, 6].map((c) => <Skeleton key={c} width="12.5%" height={40} radius={radius.sm} />)}
            </View>
          ))}
        </View>
        <View style={s.island}>
          <Skeleton width={90} height={15} />
          <Skeleton width={150} height={30} />
        </View>
        <View style={s.row}>
          {[0, 1, 2].map((i) => <View key={i} style={[s.island, { flex: 1 }]}><Skeleton width="60%" height={18} /><Skeleton width="80%" height={11} /></View>)}
        </View>
      </View>
    </View>
  );
}

/** «Меню»: профиль, разделы списками. */
export function MenuSkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <SkHeader buttons={1} />
      <View style={s.gutter}>
        <View style={s.island}>
          <View style={s.row}>
            <Skeleton width={56} height={56} radius={28} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="40%" height={16} />
              <Skeleton width="60%" height={12} />
            </View>
          </View>
          <View style={s.row}>
            <Skeleton width="38%" height={48} radius={radius.md} />
            <Skeleton width="58%" height={48} radius={radius.md} />
          </View>
        </View>
        <SkListIsland rows={3} />
        <SkListIsland rows={3} />
      </View>
    </View>
  );
}

/** Запуск приложения: «Проекты» (первая вкладка) и панель вкладок. */
export function AppSkeleton() {
  const insets = useSafeAreaInsets();
  const s = useStyles();
  return (
    <View style={s.page}>
      <ProjectsSkeleton forceHeader />
      <View style={[s.tabBar, { paddingBottom: spacing.sm + insets.bottom }]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={s.tabItem}>
            <Skeleton width={24} height={22} radius={6} />
            <Skeleton width={44} height={9} />
          </View>
        ))}
      </View>
    </View>
  );
}

function useStyles() {
  const colors = useColors();
  return makeStyles(colors);
}

const makeStyles = (colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gutter: { paddingHorizontal: spacing.md, gap: spacing.md },
  island: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  islandFlat: { backgroundColor: colors.panel, borderRadius: radius.lg, overflow: 'hidden' },
  topLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  deck: { flex: 1, flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.lg - 2 },
  // Ширина — как у настоящей карточки (задана в разметке), высота — во всю колоду.
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, overflow: 'hidden', gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: spacing.md, paddingBottom: 0 },
  inset: { marginHorizontal: spacing.md },
  peek: { flex: 1, backgroundColor: colors.panel, borderTopLeftRadius: radius.xl, borderBottomLeftRadius: radius.xl },
  dots: { height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md },
  taskText: { flex: 1, gap: 7 },
  groupLabel: { marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 90 },
  barCol: { alignItems: 'center', gap: 6 },
  calRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tabBar: { flexDirection: 'row', backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  tabItem: { flex: 1, alignItems: 'center', gap: 5 },
});

export default Skeleton;

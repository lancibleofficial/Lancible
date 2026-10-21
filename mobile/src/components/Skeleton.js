import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { IOS_NATIVE_HEADER } from '../navigation/nativeHeader';
import MainTabBar from '../navigation/MainTabBar';
import { PendingTabHeader, TAB_TITLES } from './TabHeader';
import { useAppStore } from '../store/useAppStore';
import Text from './AppText';
import EmptyState from './EmptyState';
import PrimaryButton from './PrimaryButton';
import { t } from '../lib/i18n';
import { useColors, spacing, screenPadding, radius, fontSize, taskControlRadius, taskCheckRadius, buttonHeight } from '../theme';

// Заглушки на время загрузки. Смысл не в украшении: приложение читает данные
// из хранилища не мгновенно, а тяжёлая вкладка (171 строка задач, календарь
// статистики) строится заметное время. Спиннер ничего не говорит о том, что
// появится, и переход от него к готовому экрану выглядит как рывок.
// Скелетон повторяет будущую раскладку, поэтому содержимое как бы
// проявляется на своих местах.
//
// Грузится только содержимое страницы. Шапка (название вкладки и кнопки) и
// нижняя панель вкладок у всех экранов одни и те же, уже готовы и не
// пульсируют ни при запуске, ни при первом заходе на вкладку: заглушки
// рисуют их настоящими — название в шапке (PendingTabHeader) и саму панель
// (MainTabBar, ниже в AppSkeleton), а полосы и пульс — только в странице.
//
// У каждой вкладки свой — по её нынешней раскладке (колода, инбокс, чат,
// календарь, меню). AppSkeleton — запуск: «Проекты» и панель вкладок.
// Скелетоны вкладок показывает навигация (withTabPage), пока вкладка
// строится в первый раз, — экраны о них не знают.
//
// Пульсация вместо бегущего блика: она дешевле (одно свойство, нативный
// драйвер) и не отвлекает.
const PULSE_MS = 900;

export function Skeleton({ width, height = 14, radius: r = radius.sm, style, testID = 'skeleton' }) {
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
      testID={testID}
      style={[
        { width, height, borderRadius: r, backgroundColor: colors.panel2, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) },
        style,
      ]}
    />
  );
}

/** Шапка вкладки — настоящая, не заглушка: полос и пульса в ней нет. Под
 *  общей шапкой вкладок (TabHeader.js) она стоит на месте и сразу показывает
 *  название, кнопки приходят вместе с экраном; вне её (запуск) — то же
 *  название шапкой в странице. На iOS 26 шапка нативная и уже стоит над
 *  экраном — своей не рисуем (кроме запуска).
 *  @param tab вкладка, чьё название стоит в шапке */
function SkHeader({ tab, force = false }) {
  if (IOS_NATIVE_HEADER && !force) return null;
  return <PendingTabHeader tab={tab} />;
}

/** Строка задачи: галочка, две строки текста, кнопка старта — те же
 *  скруглённые квадраты, что в настоящей строке (TaskRow). */
function SkTaskRow({ first }) {
  const s = useStyles();
  return (
    <View style={[s.taskRow, !first && s.topLine]}>
      <Skeleton width={24} height={24} radius={taskCheckRadius} />
      <View style={s.taskText}>
        <Skeleton width="62%" height={15} />
        <Skeleton width="38%" height={11} />
      </View>
      <Skeleton width={38} height={38} radius={taskControlRadius} />
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
  const cardW = width - screenPadding - 40;
  return (
    <View style={s.page}>
      <SkHeader tab="Projects" force={forceHeader} />
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
      <SkHeader tab="Tasks" />
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

/** «Чат-бот» — список чатов (с 18 октября 2026, круг 20): острова строк —
 *  название и время, две строки превью, число сообщений. */
export function ChatSkeleton({ header = true, testID }) {
  const s = useStyles();
  // Как главный экран (круг 21): сценка, фраза и поле — серединой посередине,
  // под ними прежние чаты. Без шапки (header={false}) — страница под уже
  // готовой шапкой: так главный экран ждёт ответа, открыт ли агент
  // (lib/aiAccess.js, 21 октября 2026).
  return (
    <View style={s.page} testID={testID}>
      {header ? <SkHeader tab="Chat" /> : null}
      <View style={[s.gutter, s.chatHero]}>
        <Skeleton width={120} height={88} radius={radius.xl} />
        <Skeleton width="58%" height={20} />
        <Skeleton width="100%" height={buttonHeight} radius={radius.lg} />
      </View>
      <View style={[s.gutter, s.chatList]}>
        {[0, 1].map((i) => (
          <View key={i} style={s.chatItem}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Skeleton width="56%" height={14} />
              <Skeleton width={38} height={10} />
            </View>
            <Skeleton width="92%" height={10} />
            <Skeleton width="64%" height={10} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** «Цифры»: вкладки периода, календарь месяца, итог и три числа. */
export function StatsSkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <SkHeader tab="Stats" />
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
      <SkHeader tab="Menu" />
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

const LAUNCH_ROUTES = Object.keys(TAB_TITLES).map((name) => ({ key: name, name }));

/** Панель вкладок запуска — настоящая (MainTabBar), «Проекты» выбраны, как в
 *  первый показ. Ничего не нажимается: навигатора ещё нет. Живёт по языку из
 *  стора: до чтения хранилища это язык по умолчанию. */
function LaunchTabBar() {
  const lang = useAppStore((s) => s.settings.lang);
  const props = useMemo(() => ({
    state: { index: 0, routes: LAUNCH_ROUTES },
    descriptors: Object.fromEntries(LAUNCH_ROUTES.map((r) => [r.key, { options: { tabBarLabel: t(lang, TAB_TITLES[r.name]) } }])),
    navigation: { navigate() {} },
  }), [lang]);
  return (
    <View pointerEvents="none" testID="skeleton-tab-bar">
      <MainTabBar {...props} />
    </View>
  );
}

/** Запуск приложения: «Проекты» (первая вкладка) и панель вкладок. Шапка с
 *  названием и панель — настоящие; полосы — только в содержимом страницы. */
export function AppSkeleton() {
  const s = useStyles();
  return (
    <View style={s.page}>
      <ProjectsSkeleton forceHeader />
      <LaunchTabBar />
    </View>
  );
}

/** Смена аккаунта (17 октября 2026): пока открывается область другого
 *  аккаунта, вкладок нет — их экраны смотрели бы на чужие данные. На их месте
 *  тихая подпись «Переключаю…», а панель вкладок остаётся на месте, с
 *  «Меню» выбранным: переключают из него, и панель не мигает. */
export function SwitchingScreen() {
  const s = useStyles();
  const colors = useColors();
  const lang = useAppStore((st) => st.settings.lang);
  return (
    <View style={s.page} testID="switching-screen">
      <View style={s.switching}>
        <Text style={{ color: colors.textDim, fontSize: fontSize.sm }}>{t(lang, 'accounts.switching')}</Text>
      </View>
      <LaunchTabBar index={LAUNCH_ROUTES.findIndex((r) => r.name === 'Menu')} />
    </View>
  );
}

/** Область данных не прочиталась (19 октября 2026, useAppStore: scopeError):
 *  отказ хранилища, битая запись. Вкладок нет — их экраны показали бы пустое
 *  или чужое, а запись закрыта, чтобы нечитаемая не легла пустой. Ошибка
 *  стоит, пока человек не ответит: «Повторить» читает снова; у области
 *  аккаунта — ещё и выход к данным «Без аккаунта» (иначе с этого экрана
 *  никуда, «Меню» за ним). Слова и кнопки — общий EmptyState.
 *  @param scope — { uid }; onRetry(); onGuest() */
export function ScopeErrorScreen({ scope, onRetry, onGuest }) {
  const s = useStyles();
  const lang = useAppStore((st) => st.settings.lang);
  return (
    <View style={[s.page, s.switching]} testID="scope-error-screen">
      <EmptyState
        art="docs"
        title={t(lang, 'accounts.read_failed_title')}
        text={t(lang, 'accounts.read_failed_text')}
        actionLabel={t(lang, 'accounts.read_retry')}
        onAction={onRetry}
        primary
        testID="scope-error"
      />
      {scope && scope.uid && onGuest ? (
        <PrimaryButton title={t(lang, 'accounts.read_open_guest')} variant="ghost" onPress={onGuest} style={s.errorGuest} testID="scope-error-guest" />
      ) : null}
    </View>
  );
}

function useStyles() {
  const colors = useColors();
  return makeStyles(colors);
}

const makeStyles = (colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gutter: { paddingHorizontal: screenPadding, gap: spacing.md },
  island: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  islandFlat: { backgroundColor: colors.panel, borderRadius: radius.lg, overflow: 'hidden' },
  topLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  deck: { flex: 1, flexDirection: 'row', gap: spacing.sm, paddingLeft: screenPadding },
  // Ширина — как у настоящей карточки (задана в разметке), высота — во всю колоду.
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, overflow: 'hidden', gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: spacing.md, paddingBottom: 0 },
  inset: { marginHorizontal: spacing.md },
  peek: { flex: 1, backgroundColor: colors.panel, borderTopLeftRadius: radius.xl, borderBottomLeftRadius: radius.xl },
  dots: { height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md },
  taskText: { flex: 1, gap: 7 },
  groupLabel: { marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: screenPadding },
  chatHero: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.lg, paddingTop: spacing.sm },
  chatList: { flex: 1, paddingTop: spacing.lg, gap: spacing.sm },
  // Поля — как у острова строки (Island): lg по бокам, md + 2 сверху и снизу.
  chatItem: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, paddingVertical: spacing.md + 2, gap: 8 },
  calRow: { flexDirection: 'row', justifyContent: 'space-between' },
  switching: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorGuest: { width: 'auto', alignSelf: 'center', paddingHorizontal: spacing.xl },
});

export default Skeleton;

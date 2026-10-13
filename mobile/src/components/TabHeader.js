// Шапка корневой вкладки: заголовок слева, справа квадратные кнопки
// действий (поиск, уведомления с бейджем, своё). Компактная, как на макете
// B2: заголовок 22, кнопки 36. Колокольчик звенит, пока есть непрочитанные
// (NotificationsButton, useBellRing).
//
// Навигационная шапка на вкладках выключена, поэтому отступ под статус-бар
// берётся здесь.
//
// Шапка при смене вкладки стоит на месте и не моргает: RootHeaderHost
// (layout навигатора вкладок, см. navigation/rootHeaderLayout.js) держит
// над страницами один статичный слой фона шапки (`root-header-bg`), а
// TabHeader в экране вкладки лишь отдаёт хосту заголовок, число и кнопки и
// оставляет в странице пустое место высоты шапки. Слой фона и строка
// содержимого (`root-header-content`) — одни и те же на все вкладки, не
// гаснут и не двигаются ни на кадр. Меняется только то, что в строке, и
// жидко, коротко (components/HeaderLiquid.js): название новой вкладки
// проявляется каплей, лишние кнопки стекают в каплю, недостающие набухают из
// неё, общие у вкладок (лупа, колокольчик) стоят на месте. Нажатие кнопок —
// сплюснуть и отпустить с толчком (LiquidPress). Страница пролистывается,
// шапка — нет.
//
// Пока поверх вкладки открыты детали, общая шапка спрятана целиком (у
// деталей своя, в стеке), а экран вкладки под ними, в том числе во время
// жеста «назад», рисует свою шапку в странице, как без хоста: он не
// выезжает без шапки. Возвращаясь на вкладку, шапка и пустое место
// меняются местами в одной отрисовке — пустого кадра между ними нет.
//
// Вне хоста (экран сам по себе, в тесте) шапка рисуется в странице. На
// iOS 26+ шапка нативная — её кнопки и заголовок сменяет система.
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import { LiquidPress, LiquidTitle, HeaderActions } from './HeaderLiquid';
import { GlassBg, headerButtonRadius, NativeHeaderScope } from './Glass';
import { screenTitleStyle } from './AppHeader';
import { TabNameContext } from './TabSlide';
import { IOS_NATIVE_HEADER, useNativeOptions, nativeItems, elementSignature, leftElementItems } from '../navigation/nativeHeader';
import { useAppStore } from '../store/useAppStore';
import { notificationFeed } from '../lib/due';
import { BELL_RING, BELL_PIVOT, bellAngle, badgeKick, bellUnread, onBellRing } from '../lib/motion';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

/** Кнопка шапки: квадрат 36 с иконкой, при badge — красный счётчик.
 *  iconStyle и badgeStyle — анимированные стили значка и счётчика (звон).
 *  Нажатие — жидкое (LiquidPress). */
export function HeaderButton({ icon, label, onPress, badge, accent, testID, iconStyle, badgeStyle }) {
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  const glyph = <Icon name={icon} size={18} color={accent ? colors.accentText : colors.textDim} />;
  return (
    <LiquidPress
      onPress={onPress}
      hitSlop={6}
      style={[styles.btn, { borderRadius: headerButtonRadius(36, radius.md) }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <GlassBg radius={headerButtonRadius(36, radius.md)} backgroundColor={accent ? colors.accent : colors.panel} tint={accent ? colors.accent : undefined} />
      {iconStyle ? <Animated.View style={iconStyle} testID={testID ? `${testID}-icon` : undefined}>{glyph}</Animated.View> : glyph}
      {badge ? <Animated.View style={[styles.badge, badgeStyle]} testID={testID ? `${testID}-badge` : undefined}><Text style={styles.badgeText}>{badge}</Text></Animated.View> : null}
    </LiquidPress>
  );
}

/** Сколько непрочитанных в ленте уведомлений. */
function useUnreadCount() {
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  return notificationFeed(tasks, seenAt).filter((n) => n.unread).length;
}

/** Подпись бейджа для числа непрочитанных. */
const badgeText = (unread) => (unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null);

/** Подпись бейджа непрочитанных (нативная шапка iOS 26+). */
function useUnreadBadge() {
  return badgeText(useUnreadCount());
}

/**
 * Колокольчик звенит, пока есть непрочитанные: качается вокруг верхней точки
 * с затуханием (~1 с, bellAngle), бейдж вздрагивает (badgeKick). Три звона
 * раз в 7 с, потом тишина — до тех пор, пока непрочитанных не станет больше
 * (расписание одно на приложение — lib/motion.js). Без непрочитанных и при
 * «уменьшении движения» не двигается.
 */
function useBellRing(unread) {
  const still = useReduceMotion();
  const stillRef = useRef(still);
  stillRef.current = still;
  const t0 = useSharedValue(1);
  useEffect(() => onBellRing(() => {
    if (stillRef.current) return;
    t0.value = 0;
    t0.value = withTiming(1, BELL_RING);
  }), []);
  useEffect(() => { bellUnread(unread); }, [unread]);
  const icon = useAnimatedStyle(() => ({
    transform: [{ translateY: -BELL_PIVOT }, { rotate: `${bellAngle(t0.value)}deg` }, { translateY: BELL_PIVOT }],
  }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: badgeKick(t0.value) }] }));
  return { icon, badge };
}

/** Колокольчик с числом непрочитанных — одна на все вкладки. */
export function NotificationsButton({ navigation }) {
  const lang = useAppStore((s) => s.settings.lang);
  const unread = useUnreadCount();
  const ring = useBellRing(unread);
  return (
    <HeaderButton
      icon="bell"
      label={t(lang, 'notif.title')}
      badge={badgeText(unread)}
      iconStyle={ring.icon}
      badgeStyle={ring.badge}
      testID="notif-bell"
      onPress={() => navigation.navigate('Notifications')}
    />
  );
}

/** iOS 26+: заголовок и кнопки уходят в нативную шапку — её кнопки
 *  система кладёт на жидкое стекло. Сам компонент ничего не рисует.
 *  Колокольчик там — системная кнопка с бейджем: качать её нечем, звона нет. */
function NativeTabHeader({ title, count, children }) {
  const navigation = useNavigation();
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  const lang = useAppStore((s) => s.settings.lang);
  const badge = useUnreadBadge();
  const tab = useContext(TabNameContext);
  const list = Children.toArray(children).filter(isValidElement);
  const latest = useRef(list);
  latest.current = list;
  const toItem = (el) => {
    if (el.type === HeaderButton) {
      const p = el.props;
      return { icon: p.icon, label: p.label, onPress: p.onPress, badge: p.badge, prominent: !!p.accent, tint: p.accent ? colors.accentInk : undefined };
    }
    if (el.type === NotificationsButton) {
      return { icon: 'bell', label: t(lang, 'notif.title'), onPress: () => el.props.navigation.navigate('Notifications'), badge };
    }
    return null;
  };
  useNativeOptions(navigation, `${tab}|${title}|${count}|${lang}|${badge}|${colors.accentInk}|${colors.text}|${elementSignature(list)}`, () => ({
    title,
    // Заголовок слева нашим шрифтом и размером, как на других платформах;
    // при смене вкладки система меняет шапку целиком и сразу, без
    // растворения.
    headerTitle: '',
    unstable_headerLeftItems: () => leftElementItems(
      <View style={[styles.titleRow, styles.titleNative]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {count != null ? <Text style={styles.count}>{count}</Text> : null}
      </View>,
    ),
    unstable_headerRightItems: () => nativeItems(latest, toItem, (el) => <NativeHeaderScope>{el}</NativeHeaderScope>),
  }));
  return null;
}

export default function TabHeader({ title, count, children }) {
  const host = useContext(RootHeaderContext);
  const tab = useContext(TabNameContext);
  if (IOS_NATIVE_HEADER) return <NativeTabHeader title={title} count={count}>{children}</NativeTabHeader>;
  if (host && tab) return <HostedTabHeader host={host} tab={tab} title={title} count={count}>{children}</HostedTabHeader>;
  return <JsTabHeader title={title} count={count}>{children}</JsTabHeader>;
}

// Кнопка шапки — квадрат 36; от неё считается высота шапки.
const BTN = 36;

/** Высота шапки вкладки в покое: статус-бар, воздух сверху и снизу и кнопка.
 *  Крупный системный шрифт делает шапку выше — тогда её высоту мерит хост. */
export const headerHeight = (top) => top + spacing.sm * 2 + BTN;

// Что хост умеет для экранов: отдать содержимое шапки вкладки, убрать его и
// принять замер высоты. Сам объект не меняется за всё время жизни хоста, а
// то, что меняется (какая вкладка рисует шапку сама, замеры), лежит в
// RootHeaderLayoutContext: иначе смена их заставляла бы каждый экран
// отдавать шапку заново.
const RootHeaderContext = createContext(null);
const RootHeaderLayoutContext = createContext({ ownTab: null, heights: {}, fallback: 0 });

/** Подпись вкладки для шапки, пока строится её экран (Skeleton), и для
 *  панели вкладок запуска. Порядок — как на панели. */
export const TAB_TITLES = { Projects: 'nav.projects', Tasks: 'nav.tasks', Home: 'nav.home', Stats: 'nav.stats', Menu: 'nav.menu' };

/** Что стоит в шапке хоста, пока вкладка ещё ничего не отдала. */
const EMPTY_SPEC = { title: '', count: null, children: null };

/** Высота пустого места в странице вкладки: замер шапки этой вкладки, а пока
 *  вкладка не показывалась, — наибольший замер из уже известных. */
function useSlotHeight(tab) {
  const { heights, fallback } = useContext(RootHeaderLayoutContext);
  return heights[tab] ?? fallback;
}

/** Кнопки шапки для хоста: у каждой функции в пропсах (onPress…) стоит
 *  переходник, который в момент нажатия берёт самую свежую. Хост не
 *  перерисовывается на каждый кадр экрана, а кнопки всё равно зовут
 *  обработчик с актуальным состоянием. */
function forwardHandlers(el, latest, index) {
  const forwarded = {};
  for (const key of Object.keys(el.props)) {
    if (typeof el.props[key] !== 'function') continue;
    forwarded[key] = (...args) => {
      const now = latest.current[index];
      return now && typeof now.props[key] === 'function' ? now.props[key](...args) : undefined;
    };
  }
  return cloneElement(el, forwarded);
}

/** Шапка в экране вкладки под общей шапкой хоста. Отдаёт ей заголовок, число
 *  и кнопки — только когда в них что-то изменилось (подпись без функций), а
 *  не на каждую отрисовку экрана: экран с тикающим таймером иначе гонял бы
 *  шапку каждую секунду. В странице держит пустое место высоты шапки; пока
 *  поверх вкладки открыты детали, рисует вместо него свою шапку. */
function HostedTabHeader({ host, tab, title, count, children }) {
  const { ownTab } = useContext(RootHeaderLayoutContext);
  const slot = useSlotHeight(tab);
  const list = Children.toArray(children).filter(isValidElement);
  const latest = useRef(list);
  latest.current = list;
  const signature = `${title}|${count}|${elementSignature(list)}`;
  useLayoutEffect(() => {
    host.publish(tab, { title, count, children: list.map((el, i) => forwardHandlers(el, latest, i)) });
  }, [host, tab, signature]);
  useLayoutEffect(() => () => host.remove(tab), [host, tab]);
  if (ownTab === tab) return <JsTabHeader title={title} count={count} testID="tab-header-own">{children}</JsTabHeader>;
  return <View style={{ height: slot }} />;
}

/** Шапка вкладки, пока строится её экран. Она готова всегда и не грузится: в
 *  хосте сразу стоит название вкладки (кнопки и число придут вместе с
 *  экраном), в странице — пустое место. Без хоста (запуск, тест) рисует то
 *  же название настоящей шапкой, без полос и пульса.
 *  @param tab вкладка, если экран не внутри TabPage (запуск) */
export function PendingTabHeader({ tab: own }) {
  const host = useContext(RootHeaderContext);
  const inPage = useContext(TabNameContext);
  if (host && inPage && TAB_TITLES[inPage]) return <PendingHostedHeader host={host} tab={inPage} />;
  return <StaticTabHeader tab={own || inPage} />;
}

/** Название вкладки в странице, как рисует шапку вне хоста. */
function StaticTabHeader({ tab }) {
  const lang = useAppStore((s) => s.settings.lang);
  if (!TAB_TITLES[tab]) return null;
  return <JsTabHeader title={t(lang, TAB_TITLES[tab])} testID="skeleton-header" />;
}

function PendingHostedHeader({ host, tab }) {
  const lang = useAppStore((s) => s.settings.lang);
  const slot = useSlotHeight(tab);
  const title = t(lang, TAB_TITLES[tab]);
  // Не убирает свою запись: следом экран отдаст настоящую, а пустого кадра
  // между ними быть не должно.
  useLayoutEffect(() => { host.publish(tab, { title, count: null, children: null }); }, [host, tab, title]);
  return <View style={{ height: slot }} />;
}

/** Общая шапка корневых вкладок: layout навигатора. Лежит поверх страниц и
 *  не пролистывается. Под содержимым — один слой фона, общий для всех
 *  вкладок; на экранах деталей (hidden) шапка спрятана целиком — у них своя. */
export function RootHeaderHost({ tab, hidden, children }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [specs, setSpecs] = useState({});
  const [heights, setHeights] = useState({});
  const host = useMemo(() => ({
    publish: (name, spec) => setSpecs((all) => ({ ...all, [name]: spec })),
    remove: (name) => setSpecs((all) => {
      if (!(name in all)) return all;
      const rest = { ...all };
      delete rest[name];
      return rest;
    }),
    // Замер шапки вкладки: дробные доли не в счёт, иначе высота дрожала бы.
    // keep — вкладка уже мерена: её замер не трогаем (так её встречает смена
    // вкладки, строка содержимого одна на все и не мерится заново сама).
    measure: (name, height, keep) => setHeights((all) => {
      if (keep && all[name] != null) return all;
      return Math.abs((all[name] ?? 0) - height) < 0.5 ? all : { ...all, [name]: height };
    }),
  }), []);
  // Вкладка, чьё название стояло в шапке последним: по нему название решает,
  // проявляться ли ему каплей (LiquidTitle).
  const shown = useRef(null);
  const fallback = Math.max(headerHeight(insets.top), ...Object.values(heights));
  const layout = useMemo(() => ({ ownTab: hidden ? tab : null, heights, fallback }), [hidden, tab, heights, fallback]);
  const spec = specs[tab] || EMPTY_SPEC;
  return (
    <RootHeaderContext.Provider value={host}>
      <RootHeaderLayoutContext.Provider value={layout}>
        <View style={hostStyles.host}>
          {children}
          <View
            style={[hostStyles.overlay, { height: heights[tab] ?? fallback }, hidden && hostStyles.off]}
            pointerEvents="box-none"
            testID="root-header"
          >
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} testID="root-header-bg" />
            {!hidden ? (
              <HostedHeaderContent host={host} tab={tab} spec={spec} shown={shown} />
            ) : null}
          </View>
        </View>
      </RootHeaderLayoutContext.Provider>
    </RootHeaderContext.Provider>
  );
}

const hostStyles = StyleSheet.create({
  host: { flex: 1 },
  // Над навигатором и страницами; сама нажатий не ловит, только содержимое.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  off: { display: 'none' },
});

/** Строка содержимого общей шапки — одна на все вкладки: сменяется то, что в
 *  ней (название — каплей, кнопки — по HeaderActions), а не она сама, поэтому
 *  её высота мерится не заново при каждом появлении, а при изменении. Вкладке,
 *  которую ещё не мерили, на смене достаётся высота, что стояла до неё: если
 *  у её шапки своя, `onLayout` отдаст точную. */
function HostedHeaderContent({ host, tab, spec, shown }) {
  const last = useRef(0);
  useLayoutEffect(() => {
    if (last.current) host.measure(tab, last.current, true);
  }, [host, tab]);
  return (
    <JsTabHeader
      title={spec.title}
      count={spec.count}
      testID="root-header-content"
      liquid={{ tab, shown }}
      onLayout={(e) => {
        last.current = e.nativeEvent.layout.height;
        host.measure(tab, last.current);
      }}
    >
      {spec.children}
    </JsTabHeader>
  );
}

/** Шапка в странице. liquid — {tab, shown}: шапка общего хоста, у неё название
 *  и кнопки играют (HeaderLiquid.js); без него (свой экран, тест) — как есть. */
function JsTabHeader({ title, count, children, testID, onLayout, liquid }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const name = (
    <>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {count != null ? <Text style={styles.count}>{count}</Text> : null}
    </>
  );
  return (
    <View style={styles.wrap} testID={testID} onLayout={onLayout}>
      {liquid ? (
        <LiquidTitle key={liquid.tab} tab={liquid.tab} shown={liquid.shown} style={styles.titleRow}>{name}</LiquidTitle>
      ) : (
        <View style={styles.titleRow}>{name}</View>
      )}
      {liquid ? (
        <HeaderActions tab={liquid.tab} items={children} style={styles.actions} />
      ) : (
        <View style={styles.actions}>{children}</View>
      )}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: screenPadding,
    minHeight: headerHeight(insets.top),
  },
  // Название и число — рядом, с зазором: пробел внутри одной строки
  // жирным шрифтом почти не виден, и они слипались.
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  title: { flexShrink: 1, ...screenTitleStyle(colors) },
  // В нативной шапке у заголовка нет ширины родителя — тянуть нечего.
  titleNative: { flex: 0, maxWidth: 240 },
  count: { color: colors.textFaint, fontSize: 15, fontFamily: displayFamily.regular },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Подложку даёт GlassBg: стекло на iOS 26+, заливка panel/accent ниже.
  btn: { width: BTN, height: BTN, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.textOnColor, fontSize: 10, lineHeight: 13, fontWeight: '700' },
});

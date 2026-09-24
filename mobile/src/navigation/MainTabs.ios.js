import { View, StyleSheet, Platform } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import BoardStack from './BoardStack';
import SettingsScreen from '../screens/SettingsScreen';
import AppHeader from '../components/AppHeader';
import TimerMiniPlayer from '../components/TimerMiniPlayer';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing } from '../theme';

// iOS-only: renders through UIKit's real UITabBarController (via
// react-native-screens' native bottom-tabs integration) instead of the
// hand-built MainTabBar.js used on Android -- on a device running iOS 26
// this is what actually picks up the system's Liquid Glass tab bar material
// for free, since it IS the native component Apple itself restyled, not an
// approximation. Android keeps MainTabBar.js (see MainTabs.android.js) --
// Liquid Glass has no Android equivalent, so there is nothing to gain from
// forcing the two to stay pixel-identical here the way desktop Win/Mac do.
//
// What is and isn't controllable through the native bar:
// - Icons are the app's own Icon.js glyphs rasterised to PNG template
//   images (assets/tabs/, 24pt @1x/2x/3x) so the bar matches the rest of
//   the app instead of stock SF Symbols. iOS tints them itself.
// - Below iOS 26 the bar is made opaque in the app's panel colour with no
//   blur material, matching the Android bar; the default translucent
//   system material followed the device appearance rather than the app
//   theme and rendered as a dark slab. On iOS 26 these two props are
//   ignored by design and Liquid Glass stays.
// - The selected tab's label and icon share one tint on iOS (UITabBar's
//   tintColor covers both); they cannot be split into black text + green
//   icon natively.
//
// Мини-плеер таймера размещён двумя разными способами, и вот почему.
// Установленные @react-navigation/bottom-tabs 7.19.1 и react-native-screens
// 4.26.2 умеют нативный bottomAccessory (screenOptions -> Tabs.Host ios), но
// сам react-native-screens отдаёт его в UIKit только под флагом
// isIOS26OrHigher — на iOS 25 и ниже аксессуар просто не рисуется, молча.
// Поэтому: на iOS 26+ плеер отдан нативному таббару (UIKit сам кладёт его
// над панелью и сам ведёт при сворачивании), а ниже — своя полоса поверх,
// через проп `layout` навигатора: только там есть и state с descriptors
// (чтобы прятать плеер там же, где прячется таббар), и место снаружи
// нативного контейнера.
const Tab = createNativeBottomTabNavigator();

const IOS_MAJOR = parseInt(String(Platform.Version), 10) || 0;
const HAS_LIQUID_GLASS = IOS_MAJOR >= 26;
// Высота UITabBar в компактной раскладке — та же константа, на которой
// стоит и JS-таббар самой react-navigation. Нужна только фолбэку.
const UIKIT_TAB_BAR_H = 49;

const TAB_ICONS = {
  home: require('../../assets/tabs/home.png'),
  board: require('../../assets/tabs/board.png'),
  calendar: require('../../assets/tabs/calendar.png'),
  chart: require('../../assets/tabs/chart.png'),
  menu: require('../../assets/tabs/menu.png'),
};

function tabIcon(name) {
  return { type: 'image', source: TAB_ICONS[name] };
}

function openTask(navigation, taskId) {
  navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId } });
}

/** Фолбэк для iOS ниже 26: полоса плеера абсолютом над таббаром. Прячется
 *  вместе с таббаром — признак тот же, что и у MainTabBar.js на Android. */
function LegacyMiniPlayerLayout({ state, navigation, descriptors, children }) {
  const insets = useSafeAreaInsets();
  const focused = descriptors[state.routes[state.index].key];
  const barHidden = !!(focused && focused.options.tabBarStyle && focused.options.tabBarStyle.display === 'none');
  return (
    <View style={styles.host}>
      {children}
      {barHidden ? null : (
        <View
          style={[styles.legacy, { bottom: UIKIT_TAB_BAR_H + insets.bottom + spacing.sm }]}
          pointerEvents="box-none"
        >
          <TimerMiniPlayer onOpen={(taskId) => openTask(navigation, taskId)} />
        </View>
      )}
    </View>
  );
}

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();
  // Per-screen tabBarStyle replaces the navigator-level one wholesale (an
  // explicit undefined wipes it too), so the Home tab's show/hide branch
  // below has to hand back this same object instead of undefined -- that
  // is what left Home with the translucent default bar while every other
  // tab had the opaque panel one.
  const legacyTabBarStyle = HAS_LIQUID_GLASS ? undefined : { backgroundColor: colors.panel, shadowColor: colors.border };

  return (
    <Tab.Navigator
      layout={HAS_LIQUID_GLASS ? undefined : LegacyMiniPlayerLayout}
      screenOptions={({ navigation }) => ({
      // Поиск и уведомления живут только на Главной, в её собственной
      // шапке: на доске или в календаре искать проекты незачем, а две
      // иконки в каждой шапке съедали место у заголовка.
        header: (props) => <AppHeader {...props} />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontFamily: 'Gravity-Book', fontSize: 11 },
        tabBarStyle: legacyTabBarStyle,
        tabBarBlurEffect: HAS_LIQUID_GLASS ? undefined : 'none',
        // UIKit рисует аксессуар дважды — для развёрнутого таббара и для
        // свёрнутого — и держит на экране тот, который сейчас подходит.
        // Нам это ничего не стоит: всё состояние плеера лежит в сторе, а не
        // внутри компонента, так что обе копии показывают одно и то же.
        bottomAccessory: HAS_LIQUID_GLASS
          ? () => <TimerMiniPlayer onOpen={(taskId) => openTask(navigation, taskId)} />
          : undefined,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={({ route, navigation }) => {
          // Same nested-route hide as Android -- see the detailed comment in
          // MainTabs.android.js for why this has to be recomputed here
          // rather than left to the nested stack.
          const barHidden = ['Project', 'TaskDetail', 'ProjectStatuses'].includes(getFocusedRouteNameFromRoute(route));
          return {
            headerShown: false,
            tabBarLabel: t(lang, 'nav.home'),
            tabBarIcon: tabIcon('home'),
            tabBarStyle: barHidden ? { display: 'none' } : legacyTabBarStyle,
            // Аксессуар приходит из screenOptions и пережил бы спрятанный
            // таббар: на странице задачи у таймера уже есть свой счётчик,
            // второй под ним не нужен. Значение затирается так же, как
            // tabBarStyle выше, — своим на уровне экрана.
            bottomAccessory: barHidden || !HAS_LIQUID_GLASS
              ? undefined
              : () => <TimerMiniPlayer onOpen={(taskId) => openTask(navigation, taskId)} />,
          };
        }}
      />
      <Tab.Screen
        name="Board"
        component={BoardStack}
        options={({ route, navigation }) => {
          const barHidden = ['Project', 'TaskDetail', 'ProjectStatuses'].includes(getFocusedRouteNameFromRoute(route));
          return {
            headerShown: false,
            tabBarLabel: t(lang, 'nav.board'),
            tabBarIcon: tabIcon('board'),
            tabBarStyle: barHidden ? { display: 'none' } : legacyTabBarStyle,
            bottomAccessory: barHidden || !HAS_LIQUID_GLASS
              ? undefined
              : () => <TimerMiniPlayer onOpen={(taskId) => openTask(navigation, taskId)} />,
          };
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: t(lang, 'nav.calendar'), tabBarLabel: t(lang, 'nav.calendar'), tabBarIcon: tabIcon('calendar') }}
      />
      <Tab.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: t(lang, 'nav.stats'), tabBarLabel: t(lang, 'nav.stats'), tabBarIcon: tabIcon('chart') }}
      />
      <Tab.Screen
        name="Menu"
        component={SettingsScreen}
        options={{ title: t(lang, 'nav.menu'), tabBarLabel: t(lang, 'nav.menu'), tabBarIcon: tabIcon('menu') }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  legacy: { position: 'absolute', left: 0, right: 0 },
});

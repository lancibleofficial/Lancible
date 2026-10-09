import { View, StyleSheet, Platform } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeStack from './HomeStack';
import ProjectsStack from './ProjectsStack';
import TasksStack from './TasksStack';
import StatsStack from './StatsStack';
import MenuStack from './MenuStack';
import AppHeader from '../components/AppHeader';
import TimerMiniPlayer, { TimerAccessory, useRunningTask } from '../components/TimerMiniPlayer';
import { DETAIL_ROUTES } from './detailScreens';
import { tabFocused } from './tabSlide';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing } from '../theme';

// iOS-only: renders through UIKit's real UITabBarController (via
// react-native-screens' native bottom-tabs integration) instead of the
// hand-built MainTabBar.js used on Android -- on a device running iOS 26
// this is what actually picks up the system's Liquid Glass tab bar material
// for free, since it IS the native component Apple itself restyled, not an
// approximation. Android keeps MainTabBar.js (see MainTabs.android.js).
//
// What is and isn't controllable through the native bar:
// - Icons are the app's own Solar Bold icons (core/icons.js) rasterised
//   to PNG template images by scripts/make-ios-icons.js (assets/tabs/,
//   26pt @1x/2x/3x) so the bar matches the rest of the app instead of
//   stock SF Symbols. iOS tints them itself.
// - Below iOS 26 the bar is made opaque in the app's panel colour with no
//   blur material, matching the Android bar.
// - The selected tab's label and icon share one tint on iOS.
//
// Плашка идущей задачи размещена двумя разными способами: на iOS 26+ она
// отдана нативному таббару как bottomAccessory (UIKit сам кладёт её над
// панелью), а ниже — своя полоса поверх через проп `layout` навигатора:
// react-native-screens отдаёт аксессуар в UIKit только под флагом
// isIOS26OrHigher.
//
// Аксессуар задаётся только пока таймер идёт. UIKit рисует под него
// стеклянный слот всегда, когда он задан, — даже если плашке нечего
// показать, и над панелью висела пустая капсула.
const Tab = createNativeBottomTabNavigator();

const IOS_MAJOR = parseInt(String(Platform.Version), 10) || 0;
const HAS_LIQUID_GLASS = IOS_MAJOR >= 26;
// Высота UITabBar в компактной раскладке. Нужна только фолбэку.
const UIKIT_TAB_BAR_H = 49;

const TAB_ICONS = {
  folder: require('../../assets/tabs/folder.png'),
  tasks: require('../../assets/tabs/tasks.png'),
  today: require('../../assets/tabs/today.png'),
  chart: require('../../assets/tabs/chart.png'),
  menu: require('../../assets/tabs/menu.png'),
};

function tabIcon(name) {
  return { type: 'image', source: TAB_ICONS[name] };
}

function openTask(navigation, taskId) {
  navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId } });
}

/** Фолбэк для iOS ниже 26: плашка абсолютом над таббаром. Прячется вместе
 *  с таббаром — признак тот же, что и у MainTabBar.js на Android. */
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
  const running = !!useRunningTask();
  // Per-screen tabBarStyle replaces the navigator-level one wholesale (an
  // explicit undefined wipes it too), so every tab's show/hide branch below
  // hands back this same object instead of undefined.
  const legacyTabBarStyle = HAS_LIQUID_GLASS ? undefined : { backgroundColor: colors.panel, shadowColor: colors.border };

  const tabOptions = (labelKey, icon) => ({ route, navigation }) => {
    const barHidden = DETAIL_ROUTES.includes(getFocusedRouteNameFromRoute(route));
    return {
      headerShown: false,
      tabBarLabel: t(lang, labelKey),
      tabBarIcon: tabIcon(icon),
      tabBarStyle: barHidden ? { display: 'none' } : legacyTabBarStyle,
      // На странице задачи у таймера свой шит — вторая плашка не нужна.
      bottomAccessory: barHidden || !HAS_LIQUID_GLASS || !running
        ? undefined
        : ({ placement }) => <TimerAccessory placement={placement} onOpen={(taskId) => openTask(navigation, taskId)} />,
    };
  };

  return (
    <Tab.Navigator
      layout={HAS_LIQUID_GLASS ? undefined : LegacyMiniPlayerLayout}
      // Система переключает вкладки мгновенно — пролистывание делают сами
      // экраны вкладок (components/TabSlide.js), здесь о смене только сообщаем.
      screenListeners={({ route }) => ({
        focus: () => tabFocused(route.name),
      })}
      screenOptions={({ navigation }) => ({
        header: (props) => <AppHeader {...props} />,
        tabBarActiveTintColor: colors.accentInk,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: 'Onest-Regular', fontSize: 11 },
        tabBarStyle: legacyTabBarStyle,
        tabBarBlurEffect: HAS_LIQUID_GLASS ? undefined : 'none',
        bottomAccessory: HAS_LIQUID_GLASS && running
          ? ({ placement }) => <TimerAccessory placement={placement} onOpen={(taskId) => openTask(navigation, taskId)} />
          : undefined,
      })}
    >
      <Tab.Screen name="Projects" component={ProjectsStack} options={tabOptions('nav.projects', 'folder')} />
      <Tab.Screen name="Tasks" component={TasksStack} options={tabOptions('nav.tasks', 'tasks')} />
      <Tab.Screen name="Home" component={HomeStack} options={tabOptions('nav.home', 'today')} />
      <Tab.Screen name="Stats" component={StatsStack} options={tabOptions('nav.stats', 'chart')} />
      <Tab.Screen name="Menu" component={MenuStack} options={tabOptions('nav.menu', 'menu')} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  legacy: { position: 'absolute', left: 0, right: 0 },
});

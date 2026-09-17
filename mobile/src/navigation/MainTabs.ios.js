import { Pressable, Platform } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import SettingsScreen from '../screens/SettingsScreen';
import Icon from '../components/Icon';
import AppHeader from '../components/AppHeader';
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
// - "Create" uses the system `search` slot on iOS 26 only: there UIKit
//   renders that slot as the detached round glass button to the right of
//   the bar (the only detached-button placement the platform offers). Its
//   glass body cannot be coloured -- only the glyph can, so the "+" is
//   tinted accent via the per-item inactive tint (it is never actually
//   selected: selection is disabled and tapping it opens the
//   create-project sheet instead). On iOS 18 and below a system item keeps
//   its built-in magnifier image/title regardless of overrides, so there
//   "Create" stays an ordinary custom tab in the row.
// - Below iOS 26 the bar is made opaque in the app's panel colour with no
//   blur material, matching the Android bar; the default translucent
//   system material followed the device appearance rather than the app
//   theme and rendered as a dark slab. On iOS 26 these two props are
//   ignored by design and Liquid Glass stays.
// - The selected tab's label and icon share one tint on iOS (UITabBar's
//   tintColor covers both); they cannot be split into black text + green
//   icon natively.
const Tab = createNativeBottomTabNavigator();

const HEADER_ICON_SIZE = 20;
const IOS_MAJOR = parseInt(String(Platform.Version), 10) || 0;
const HAS_LIQUID_GLASS = IOS_MAJOR >= 26;

const TAB_ICONS = {
  home: require('../../assets/tabs/home.png'),
  chart: require('../../assets/tabs/chart.png'),
  plus: require('../../assets/tabs/plus.png'),
  calendar: require('../../assets/tabs/calendar.png'),
  settings: require('../../assets/tabs/settings.png'),
};

function SearchHeaderButton({ navigation, colors }) {
  return (
    <Pressable
      hitSlop={10}
      style={{ paddingLeft: spacing.sm }}
      onPress={() => navigation.navigate('Home', { screen: 'HomeMain', params: { openSearch: true } })}
    >
      <Icon name="search" size={HEADER_ICON_SIZE} color={colors.text} />
    </Pressable>
  );
}

function tabIcon(name) {
  return { type: 'image', source: TAB_ICONS[name] };
}

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();

  return (
    <Tab.Navigator
      screenOptions={({ navigation }) => ({
        header: (props) => <AppHeader {...props} />,
        headerRight: () => <SearchHeaderButton navigation={navigation} colors={colors} />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontFamily: 'BasiquePro-Regular', fontSize: 11 },
        tabBarStyle: HAS_LIQUID_GLASS ? undefined : { backgroundColor: colors.panel, shadowColor: colors.border },
        tabBarBlurEffect: HAS_LIQUID_GLASS ? undefined : 'none',
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={({ route }) => ({
          headerShown: false,
          tabBarLabel: t(lang, 'nav.home'),
          tabBarIcon: tabIcon('home'),
          // Same nested-route hide as Android -- see the detailed comment in
          // MainTabs.android.js for why this has to be recomputed here
          // rather than left to the nested stack.
          tabBarStyle: ['Project', 'TaskDetail'].includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined,
        })}
      />
      <Tab.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: t(lang, 'nav.stats'), tabBarLabel: t(lang, 'nav.stats'), tabBarIcon: tabIcon('chart') }}
      />
      <Tab.Screen
        name="Create"
        component={HomeStack}
        listeners={({ navigation }) => ({
          tabPress: () => navigation.navigate('Home', { screen: 'HomeMain', params: { openCreate: true } }),
        })}
        options={{
          headerShown: false,
          tabBarSystemItem: HAS_LIQUID_GLASS ? 'search' : undefined,
          tabBarLabel: t(lang, 'home.create'),
          tabBarIcon: tabIcon('plus'),
          tabBarInactiveTintColor: colors.accent,
          tabBarSelectionEnabled: false,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: t(lang, 'home.calendar_link'), tabBarLabel: t(lang, 'home.calendar_link'), tabBarIcon: tabIcon('calendar') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t(lang, 'settings.title'), tabBarLabel: t(lang, 'settings.title'), tabBarIcon: tabIcon('settings') }}
      />
    </Tab.Navigator>
  );
}

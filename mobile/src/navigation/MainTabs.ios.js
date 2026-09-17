import { Pressable } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import SettingsScreen from '../screens/SettingsScreen';
import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing, fontSize } from '../theme';

// iOS-only: renders through UIKit's real UITabBarController (via
// react-native-screens' native bottom-tabs integration) instead of the
// hand-built MainTabBar.js used on Android -- on a device running iOS 26
// this is what actually picks up the system's Liquid Glass tab bar material
// for free, since it IS the native component Apple itself restyled, not an
// approximation. Android keeps MainTabBar.js (see MainTabs.android.js) --
// Liquid Glass has no Android equivalent, so there is nothing to gain from
// forcing the two to stay pixel-identical here the way desktop Win/Mac do.
//
// Real trade-offs versus the custom bar, accepted deliberately rather than
// worked around:
// - No raised circular "+" center button -- native tab items are always
//   N equal-width slots. "Create" is a normal 5th tab, kept in the visual
//   center of the row by simple ordering, with tabBarSelectionEnabled:false
//   + a tabPress listener so tapping it opens the create-project sheet
//   instead of ever actually becoming the selected tab.
// - Icons must be SF Symbols or bundled images, not this app's custom SVG
//   Icon.js component -- used the closest stock SF Symbol per tab instead.
// - This navigator's own header always centers its title on iOS (the
//   library's docs state headerTitleAlign has no effect there) -- that's
//   the genuine native tab-root convention (Settings.app, Photos.app, etc.
//   all do this), so it's kept rather than fought. HomeStack's nested
//   Project/TaskDetail screens are a separate native-stack underneath this
//   tab and keep the left-aligned title fix applied there.
const Tab = createNativeBottomTabNavigator();

const HEADER_ICON_SIZE = 20;

function SearchHeaderButton({ navigation, colors }) {
  return (
    <Pressable
      hitSlop={10}
      style={{ paddingLeft: spacing.sm, paddingRight: spacing.lg }}
      onPress={() => navigation.navigate('Home', { screen: 'HomeMain', params: { openSearch: true } })}
    >
      <Icon name="search" size={HEADER_ICON_SIZE} color={colors.text} />
    </Pressable>
  );
}

function sfIcon(name) {
  return { type: 'sfSymbol', name };
}

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();

  return (
    <Tab.Navigator
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: 'Basique Pro', fontSize: fontSize.lg },
        headerShadowVisible: false,
        headerRight: () => <SearchHeaderButton navigation={navigation} colors={colors} />,
        tabBarActiveTintColor: colors.accent,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={({ route }) => ({
          headerShown: false,
          tabBarLabel: t(lang, 'nav.home'),
          tabBarIcon: ({ focused }) => sfIcon(focused ? 'house.fill' : 'house'),
          // Same nested-route hide as Android -- see the detailed comment in
          // MainTabs.android.js for why this has to be recomputed here
          // rather than left to the nested stack.
          tabBarStyle: ['Project', 'TaskDetail'].includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined,
        })}
      />
      <Tab.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: t(lang, 'nav.stats'), tabBarLabel: t(lang, 'nav.stats'), tabBarIcon: ({ focused }) => sfIcon(focused ? 'chart.bar.fill' : 'chart.bar') }}
      />
      <Tab.Screen
        name="Create"
        component={HomeStack}
        listeners={({ navigation }) => ({
          tabPress: () => navigation.navigate('Home', { screen: 'HomeMain', params: { openCreate: true } }),
        })}
        options={{
          headerShown: false,
          tabBarLabel: t(lang, 'home.create'),
          tabBarIcon: sfIcon('plus.circle.fill'),
          tabBarSelectionEnabled: false,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: t(lang, 'home.calendar_link'), tabBarLabel: t(lang, 'home.calendar_link'), tabBarIcon: () => sfIcon('calendar') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t(lang, 'settings.title'), tabBarLabel: t(lang, 'settings.title'), tabBarIcon: ({ focused }) => sfIcon(focused ? 'gearshape.fill' : 'gearshape') }}
      />
    </Tab.Navigator>
  );
}

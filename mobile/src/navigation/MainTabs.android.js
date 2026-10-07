import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import ProjectsStack from './ProjectsStack';
import TimeStack from './TimeStack';
import NotificationsStack from './NotificationsStack';
import MenuStack from './MenuStack';
import AppHeader from '../components/AppHeader';
import MainTabBar from './MainTabBar';
import { DETAIL_ROUTES } from './detailScreens';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';

const Tab = createBottomTabNavigator();

// Вкладки — разделы веба (Сегодня · Проекты · Время) плюс Уведомления и
// Меню. Каждая — свой стек с теми же экранами деталей, поэтому таббар
// прячется на них одинаково: вложенный стек сам по себе на родительский
// таббар не влияет, единственный документированный способ — пересчитать
// tabBarStyle родительского Tab.Screen по имени сфокусированного маршрута.
const hideOnDetails = (route) => (DETAIL_ROUTES.includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined);

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      // Шапка у корневых экранов своя — общая SearchHeader внутри самого
      // экрана (см. components/SearchHeader.js). Навигационная тут выключена
      // целиком: двух шапок подряд быть не должно.
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        animation: 'shift',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={({ route }) => ({ headerShown: false, tabBarLabel: t(lang, 'nav.home'), tabBarStyle: hideOnDetails(route) })}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsStack}
        options={({ route }) => ({ headerShown: false, tabBarLabel: t(lang, 'nav.projects'), tabBarStyle: hideOnDetails(route) })}
      />
      <Tab.Screen
        name="Time"
        component={TimeStack}
        options={({ route }) => ({ headerShown: false, tabBarLabel: t(lang, 'nav.time'), tabBarStyle: hideOnDetails(route) })}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsStack}
        options={({ route }) => ({ headerShown: false, tabBarLabel: t(lang, 'nav.notifications'), tabBarStyle: hideOnDetails(route) })}
      />
      <Tab.Screen
        name="Menu"
        component={MenuStack}
        options={({ route }) => ({ headerShown: false, tabBarLabel: t(lang, 'nav.menu'), tabBarStyle: hideOnDetails(route) })}
      />
    </Tab.Navigator>
  );
}

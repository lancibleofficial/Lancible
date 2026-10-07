import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BoardStack from './BoardStack';
import AppHeader from '../components/AppHeader';
import MainTabBar from './MainTabBar';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      // Шапка у корневых экранов своя — общая SearchHeader внутри самого
      // экрана (см. components/SearchHeader.js). Навигационная тут выключена
      // целиком: двух шапок подряд быть не должно, а заголовок вкладки и так
      // виден по таббару.
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        animation: 'shift',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={({ route }) => ({
          headerShown: false,
          tabBarLabel: t(lang, 'nav.home'),
          // Вложенный в таб стек (HomeStack) сам по себе не влияет на
          // таббар — единственный документированный способ спрятать его на
          // конкретном экране стека (Project/TaskDetail) это пересчитать
          // tabBarStyle родительского Tab.Screen по имени сфокусированного
          // вложенного роута (setOptions из самого экрана на это НЕ влияет,
          // несмотря на то что можно было бы предположить обратное).
          tabBarStyle: ['Project', 'TaskDetail', 'ProjectStatuses', 'Editor', 'Documents'].includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined,
        })}
      />
      <Tab.Screen
        name="Board"
        component={BoardStack}
        options={({ route }) => ({
          headerShown: false,
          tabBarLabel: t(lang, 'nav.board'),
          tabBarStyle: ['Project', 'TaskDetail', 'ProjectStatuses', 'Editor', 'Documents'].includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined,
        })}
      />
      <Tab.Screen name="Calendar" component={CalendarScreen} options={{ headerShown: false, tabBarLabel: t(lang, 'nav.calendar') }} />
      <Tab.Screen name="Stats" component={StatsScreen} options={{ headerShown: false, tabBarLabel: t(lang, 'nav.stats') }} />
      <Tab.Screen name="Menu" component={SettingsScreen} options={{ headerShown: false, tabBarLabel: t(lang, 'nav.menu') }} />
    </Tab.Navigator>
  );
}

import { Easing, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import ProjectsStack from './ProjectsStack';
import TasksStack from './TasksStack';
import StatsStack from './StatsStack';
import MenuStack from './MenuStack';
import AppHeader from '../components/AppHeader';
import MainTabBar from './MainTabBar';
import { DETAIL_ROUTES } from './detailScreens';
import { forSlide } from './tabSlide';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';

const Tab = createBottomTabNavigator();

// Пять вкладок макета B2: Проекты · Задачи · Сегодня · Цифры · Меню.
// Каждая — свой стек с теми же экранами деталей, поэтому таббар прячется
// на них одинаково: вложенный стек сам по себе на родительский таббар не
// влияет, единственный документированный способ — пересчитать tabBarStyle
// родительского Tab.Screen по имени сфокусированного маршрута.
// Смена вкладки — пролистывание: страницы едут во всю ширину, ease out.
const SLIDE = { animation: 'timing', config: { duration: 300, easing: Easing.out(Easing.cubic) } };

const hideOnDetails = (route) => (DETAIL_ROUTES.includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined);

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const { width } = useWindowDimensions();
  const tab = (labelKey) => ({ route }) => ({ headerShown: false, tabBarLabel: t(lang, labelKey), tabBarStyle: hideOnDetails(route) });

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      // Шапка у корневых экранов своя (components/TabHeader.js), навигационная
      // выключена целиком: двух шапок подряд быть не должно.
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        animation: 'shift',
        sceneStyleInterpolator: forSlide(width),
        transitionSpec: SLIDE,
      }}
    >
      <Tab.Screen name="Projects" component={ProjectsStack} options={tab('nav.projects')} />
      <Tab.Screen name="Tasks" component={TasksStack} options={tab('nav.tasks')} />
      <Tab.Screen name="Home" component={HomeStack} options={tab('nav.home')} />
      <Tab.Screen name="Stats" component={StatsStack} options={tab('nav.stats')} />
      <Tab.Screen name="Menu" component={MenuStack} options={tab('nav.menu')} />
    </Tab.Navigator>
  );
}

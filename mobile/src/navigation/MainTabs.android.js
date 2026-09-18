import { View, Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import SettingsScreen from '../screens/SettingsScreen';
import Icon from '../components/Icon';
import NotifButton from '../components/NotifButton';
import AppHeader from '../components/AppHeader';
import MainTabBar from './MainTabBar';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing } from '../theme';

const Tab = createBottomTabNavigator();

const HEADER_ICON_SIZE = 20;

// Иконка поиска в хедере — общая для всех табов (кроме Home, у которой
// своя версия с реально раскрывающимся полем — см. HomeScreen.js). С любой
// другой вкладки просто переключает на Home и просит её открыть поиск.
// Правый отступ даёт сам AppHeader (spacing.lg от края экрана).
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

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={({ navigation }) => ({
        header: (props) => <AppHeader {...props} />,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <SearchHeaderButton navigation={navigation} colors={colors} />
            <NotifButton />
          </View>
        ),
        animation: 'shift',
      })}
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
          tabBarStyle: ['Project', 'TaskDetail'].includes(getFocusedRouteNameFromRoute(route)) ? { display: 'none' } : undefined,
        })}
      />
      <Tab.Screen name="Stats" component={StatsScreen} options={{ title: t(lang, 'nav.stats'), tabBarLabel: t(lang, 'nav.stats') }} />
      <Tab.Screen name="Calendar" component={CalendarScreen} options={{ title: t(lang, 'home.calendar_link'), tabBarLabel: t(lang, 'home.calendar_link') }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t(lang, 'settings.title'), tabBarLabel: t(lang, 'settings.title') }} />
    </Tab.Navigator>
  );
}

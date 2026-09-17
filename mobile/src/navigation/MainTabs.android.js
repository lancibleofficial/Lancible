import { Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeStack from './HomeStack';
import StatsScreen from '../screens/StatsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import SettingsScreen from '../screens/SettingsScreen';
import Icon from '../components/Icon';
import MainTabBar from './MainTabBar';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing, fontSize } from '../theme';

const Tab = createBottomTabNavigator();

const HEADER_ICON_SIZE = 20;

// Иконка поиска в хедере — общая для всех табов (кроме Home, у которой
// своя versия с реально раскрывающимся полем — см. HomeScreen.js). С любой
// другой вкладки просто переkey на Home и просит её открыть поиск. Правый
// отступ = spacing.lg — так же, как везде в приложении отступ контента от
// края экрана (paddingLeft меньше — слева от неё в хедере ничего нет).
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

// Высота хедера у @react-navigation/elements по умолчанию фиксированная
// (64dp на Android, см. getDefaultHeaderHeight) и не зависит от размера
// заголовка — поэтому под текстом всегда оставался большой зазор вне
// зависимости от lineHeight/fontSize. Задаём высоту сами (компактнее
// материального стандарта) поверх top-inset статус-бара.
const HEADER_CONTENT_HEIGHT = 48;

export default function MainTabs() {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.bg, height: insets.top + HEADER_CONTENT_HEIGHT },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: 'Basique Pro', fontWeight: 'normal', fontSize: fontSize.lg },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerRight: () => <SearchHeaderButton navigation={navigation} colors={colors} />,
        // См. тот же комментарий в HomeStack.js — обнуляем встроенный отступ
        // хедера, чтобы единственным источником правого отступа была
        // paddingRight самих Pressable-ов, одинаково на всех вкладках.
        headerRightContainerStyle: { paddingRight: 0 },
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

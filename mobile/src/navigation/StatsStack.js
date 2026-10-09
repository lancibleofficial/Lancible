import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StatsScreen from '../screens/StatsScreen';
import { withTabPage } from '../components/TabSlide';
import { StatsSkeleton } from '../components/Skeleton';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions } from './nativeHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const StatsPage = withTabPage(StatsScreen, 'Stats', StatsSkeleton);

const Stack = createNativeStackNavigator();

/** Вкладка «Цифры»: календарь с часами по дням, период, итоги по проектам. */
export default function StatsStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        ...stackHeaderOptions(colors),
        animation: 'ios_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="StatsMain" component={StatsPage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

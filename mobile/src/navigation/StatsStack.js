import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StatsScreen from '../screens/StatsScreen';
import { useAppStore } from '../store/useAppStore';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

const Stack = createNativeStackNavigator();

/** Вкладка «Цифры»: календарь с часами по дням, период, итоги по проектам. */
export default function StatsStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        animation: 'ios_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="StatsMain" component={StatsScreen} options={{ headerShown: false }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

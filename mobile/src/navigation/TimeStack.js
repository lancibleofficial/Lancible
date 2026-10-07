import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TimeScreen from '../screens/TimeScreen';
import { useAppStore } from '../store/useAppStore';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

const Stack = createNativeStackNavigator();

/** Вкладка «Время»: календарь и статистика одним разделом. Задача с сетки
 *  открывается внутри этой же вкладки — «назад» возвращает на сетку. */
export default function TimeStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="TimeMain" component={TimeScreen} options={{ headerShown: false }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

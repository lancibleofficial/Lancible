import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import { withTabPage } from '../components/TabSlide';
import { TodaySkeleton } from '../components/Skeleton';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions } from './nativeHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const HomePage = withTabPage(HomeScreen, 'Home', TodaySkeleton);

const Stack = createNativeStackNavigator();

// Вкладка «Сегодня». Имя вкладки в навигации осталось «Home» — на него
// ссылаются переходы со всех экранов (navigate('Home', { screen: … })),
// а подпись и содержимое у неё новые.
//
// Экраны деталей (проект, задача, документы, редактор, статусы) лежат
// ВНУТРИ стека вкладки: так «назад» возвращает на «Сегодня», а таббар на
// них прячется отдельно, в MainTabs, через getFocusedRouteNameFromRoute.
export default function HomeStack() {
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
      {/* Своя шапка внутри экрана: поле поиска занимает всю ширину и
          раскрывается в отдельный режим, а общая шапка под такое не
          гнётся. Остальные экраны стека — с обычной. */}
      <Stack.Screen name="HomeMain" component={HomePage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

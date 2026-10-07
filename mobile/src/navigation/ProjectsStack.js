import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProjectsScreen from '../screens/ProjectsScreen';
import { useAppStore } from '../store/useAppStore';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

const Stack = createNativeStackNavigator();

/** Вкладка «Проекты»: карточки и недавние задачи, внутри — те же экраны
 *  деталей, что у «Сегодня». */
export default function ProjectsStack() {
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
      <Stack.Screen name="ProjectsMain" component={ProjectsScreen} options={{ headerShown: false }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

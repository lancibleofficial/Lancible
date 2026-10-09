import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProjectsScreen from '../screens/ProjectsScreen';
import { withTabPage } from '../components/TabSlide';
import { ProjectsSkeleton } from '../components/Skeleton';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions } from './nativeHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const ProjectsPage = withTabPage(ProjectsScreen, 'Projects', ProjectsSkeleton);

const Stack = createNativeStackNavigator();

/** Вкладка «Проекты»: карточки и недавние задачи, внутри — те же экраны
 *  деталей, что у «Сегодня». */
export default function ProjectsStack() {
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
      <Stack.Screen name="ProjectsMain" component={ProjectsPage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

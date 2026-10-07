import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ProjectScreen from '../screens/ProjectScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import EditorScreen from '../screens/EditorScreen';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';

const Stack = createNativeStackNavigator();

// Project и TaskDetail теперь живут ВНУТРИ таба Home (а не поверх всего
// Tab.Navigator, как раньше), чтобы при открытом проекте нижний таббар
// оставался виден — стек, вложенный ВНУТРЬ таба, по умолчанию не прячет
// родительский таббар (в отличие от стека, обёрнутого СНАРУЖИ табов, как
// было). Таббар на TaskDetail прячется отдельно, в MainTabs.js, через
// getFocusedRouteNameFromRoute — вложенный стек сам по себе не может на
// него повлиять.
export default function HomeStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Своя шапка внутри экрана: поле поиска занимает всю ширину и
          раскрывается в отдельный режим, а общая шапка под такое не
          гнётся. Остальные экраны стека — с обычной. */}
      <Stack.Screen name="HomeMain" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Project" component={ProjectScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: '' }} />
      {/* Документы и полноэкранный редактор — тоже в стеке «Главной»: из
          Меню сюда переходят через navigate('Home', { screen: 'Documents' }). */}
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: t(lang, 'docs.title') }} />
      <Stack.Screen name="Editor" component={EditorScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from '../screens/SettingsScreen';
import SettingsSectionScreen, { sectionTitle } from '../screens/SettingsSectionScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import { withTabPage } from '../components/TabSlide';
import { MenuSkeleton } from '../components/Skeleton';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions, leftTitleOptions } from './nativeHeader';
import { t } from '../lib/i18n';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const MenuPage = withTabPage(SettingsScreen, 'Menu', MenuSkeleton);

const Stack = createNativeStackNavigator();

/** Вкладка «Меню»: разделы настроек (17 октября 2026 — экраны стека, как
 *  разделы на вебе) и обратная связь; документы и редактор открываются внутри. */
export default function MenuStack() {
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
      <Stack.Screen name="MenuMain" component={MenuPage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      <Stack.Screen
        name="SettingsSection"
        component={SettingsSectionScreen}
        options={({ route }) => leftTitleOptions(t(lang, sectionTitle(route.params && route.params.section)))}
      />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={leftTitleOptions(t(lang, 'settings.section_feedback'))} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import BackButton from './BackButton';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors, spacing, screenPadding, displayFamily } from '../theme';

// Единый JS-хедер для всех навигаторов (native-stack, табы на обеих
// платформах) вместо трёх разных нативных: у нативного iOS-хедера
// (UINavigationBar) заголовок всегда по центру и headerTitleAlign
// игнорируется, у нативного Android-тулбара свои внутренние отступы, у
// JS-хедера табов — третьи. Здесь один макет: [назад-иконка] Заголовок ...
// [правые действия], всё прижато к левому краю, высота одна везде.
//
// Пропсы — то, что React Navigation передаёт в option `header`: `back`
// приходит только из стека и только когда есть куда вернуться.
// Экспортируется, потому что от неё считается максимальная высота нижнего
// листа: он раскрывается ровно до нижней границы шапки.
export const HEADER_CONTENT_HEIGHT = 48;

/** Название страницы — одно на корневые вкладки (TabHeader) и экраны стека
 *  (AppHeader, StackTitle): 22, фирменный жирный. Одна функция на всех, чтобы
 *  «Проекты» и «Уведомления» не расходились ни размером, ни начертанием. */
export const screenTitleStyle = (colors) => ({ color: colors.text, fontSize: 22, fontFamily: displayFamily.bold });

/** Заголовок экрана стека — наш шрифт и размер. На iOS 26+ он стоит в
 *  нативной шапке слева, своим элементом без стеклянной подложки. */
export function StackTitle({ text }) {
  const colors = useColors();
  return <Text style={[screenTitleStyle(colors), { maxWidth: 260 }]} numberOfLines={1}>{text}</Text>;
}

export default function AppHeader({ navigation, route, options, back }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const lang = useAppStore((s) => s.settings.lang);

  const titleText = options.title !== undefined ? options.title : route.name;
  const title = typeof options.headerTitle === 'function'
    ? options.headerTitle({ children: titleText, tintColor: colors.text })
    : typeof options.headerTitle === 'string' ? options.headerTitle : titleText;
  const right = options.headerRight ? options.headerRight({ tintColor: colors.text, canGoBack: !!back }) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row} testID="app-header-row">
        {back ? <BackButton onPress={() => navigation.goBack()} label={t(lang, 'common.back')} /> : null}
        <View style={styles.titleSlot}>
          {typeof title === 'string'
            ? <Text style={styles.title} numberOfLines={1}>{title}</Text>
            : title}
        </View>
        {right}
      </View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  wrap: { backgroundColor: colors.bg, paddingTop: insets.top },
  // Содержимое стоит на той же высоте, что в шапке вкладки (TabHeader: 8 сверху
  // и кнопка 36 — центр на 26): верх строки 4, остальные 44 делятся пополам.
  row: {
    height: HEADER_CONTENT_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: screenPadding, paddingTop: 4,
  },
  titleSlot: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // Заголовок страницы — как у вкладок (screenTitleStyle).
  title: screenTitleStyle(colors),
});

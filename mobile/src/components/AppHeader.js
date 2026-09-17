import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, fontSize } from '../theme';

// Единый JS-хедер для всех навигаторов (native-stack, табы на обеих
// платформах) вместо трёх разных нативных: у нативного iOS-хедера
// (UINavigationBar) заголовок всегда по центру и headerTitleAlign
// игнорируется, у нативного Android-тулбара свои внутренние отступы, у
// JS-хедера табов — третьи. Здесь один макет: [назад-иконка] Заголовок ...
// [правые действия], всё прижато к левому краю, высота одна везде.
//
// Пропсы — то, что React Navigation передаёт в option `header`: `back`
// приходит только из стека и только когда есть куда вернуться.
const HEADER_CONTENT_HEIGHT = 48;

export default function AppHeader({ navigation, route, options, back }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);

  const titleText = options.title !== undefined ? options.title : route.name;
  const title = typeof options.headerTitle === 'function'
    ? options.headerTitle({ children: titleText, tintColor: colors.text })
    : typeof options.headerTitle === 'string' ? options.headerTitle : titleText;
  const right = options.headerRight ? options.headerRight({ tintColor: colors.text, canGoBack: !!back }) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {back ? (
          <Pressable hitSlop={10} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="chevron-left" size={22} color={colors.text} />
          </Pressable>
        ) : null}
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
  row: {
    height: HEADER_CONTENT_HEIGHT, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  back: { paddingRight: spacing.sm, marginLeft: -4 },
  titleSlot: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.lg, fontFamily: 'BasiquePro-Regular' },
});

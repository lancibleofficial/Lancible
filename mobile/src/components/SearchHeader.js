// Шапка всех корневых экранов: поле поиска во всю ширину, «+» и колокольчик.
//
// Одна и та же на Главной, Доске, Календаре, Статистике и в Меню — иначе
// поиск был бы «где-то там», и с любого экрана пришлось бы сначала
// вспоминать, где он живёт. Названия экрана в ней нет намеренно: какая
// вкладка открыта, и так видно по таббару, а место лучше отдать полю.
//
// Поиск целиком живёт на Главной (HomeScreen): там и режим, и результаты.
// На остальных вкладках шапка только выглядит одинаково, а по нажатию
// переключает на Главную и просит открыть поиск там — иначе один и тот же
// экран результатов пришлось бы держать в пяти местах.
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import NotifButton from './NotifButton';
import { useAppStore } from '../store/useAppStore';
import { openSheet } from '../store/useSheetStore';
import QuickTaskSheet from './QuickTaskSheet';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export const SEARCH_HEADER_HEIGHT = 44;

export default function SearchHeader({
  // Режим поиска — только на Главной. Остальные экраны этих пропсов не
  // передают и получают простую полосу, открывающую поиск на Главной.
  active = false, value, onChangeText, onCancel, inputRef,
  onOpen, navigation,
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);

  function onPress() {
    if (onOpen) { onOpen(); return; }
    navigation.navigate('Home', { screen: 'HomeMain', params: { openSearch: true } });
  }

  function openQuickTask() {
    openSheet(
      <QuickTaskSheet
        pickProject
        onOpenTask={(task) => navigation.navigate('Home', {
          screen: 'TaskDetail', params: { taskId: task.id },
        })}
      />,
    );
  }

  return (
    <View style={styles.header}>
      <Pressable style={styles.searchBox} onPress={onPress}>
        <Icon name="search" size={16} color={colors.textDim} />
        {active ? (
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={t(lang, 'search.placeholder_home')}
            placeholderTextColor={colors.textDim}
            autoFocus
            returnKeyType="search"
          />
        ) : (
          <Text style={styles.searchPlaceholder} numberOfLines={1}>
            {t(lang, 'search.placeholder_home')}
          </Text>
        )}
      </Pressable>
      {active ? (
        <Pressable onPress={onCancel} hitSlop={8} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>{t(lang, 'common.cancel')}</Text>
        </Pressable>
      ) : (
        <>
          {/* Без проектов задачу заводить некуда. */}
          {projects.length ? (
            <Pressable onPress={openQuickTask} style={styles.headerBtn} hitSlop={4}>
              <Icon name="plus" size={20} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={styles.headerBtn}><NotifButton /></View>
        </>
      )}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: insets.top + spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: SEARCH_HEADER_HEIGHT, paddingHorizontal: spacing.md,
    backgroundColor: colors.panel, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  searchPlaceholder: { flex: 1, color: colors.textDim, fontSize: fontSize.md },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { height: 44, justifyContent: 'center', paddingLeft: spacing.xs },
  cancelText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
});

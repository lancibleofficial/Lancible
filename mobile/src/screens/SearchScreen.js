// Поиск по задачам и проектам — свой экран с полем в шапке и клавиатурой
// сразу. Пустой запрос показывает недавние задачи: подсказка, что искать,
// и заодно самый частый переход.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import { GlassBg } from '../components/Glass';
import { IOS_NATIVE_HEADER, SF_SYMBOL } from '../navigation/nativeHeader';
import { useAppStore, recentTasks, getProject, tasksOf } from '../store/useAppStore';
import { getStatus } from '../lib/statuses';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, pluralForm } from '../lib/i18n';

// Нативная шапка iOS 26: поле слева, круглая «закрыть» справа. Ширина поля —
// экран минус поля шапки, кнопка и зазор между ними.
const BAR_EDGE = 16;
const BAR_BUTTON = 44;
const BAR_GAP = 12;
export function nativeFieldWidth(screenW) {
  return Math.max(160, screenW - BAR_EDGE * 2 - BAR_BUTTON - BAR_GAP);
}

export default function SearchScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { width: screenW } = useWindowDimensions();
  const inputRef = useRef(null);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const openProject = useAppStore((s) => s.openProject);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const recent = useMemo(() => recentTasks(tasks, 12, activeTimer), [tasks, activeTimer]);
  const foundProjects = useMemo(() => (q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : []), [projects, q]);
  const foundTasks = useMemo(() => (q ? tasks.filter((task) => (task.title || '').toLowerCase().includes(q)) : []), [tasks, q]);

  const rows = [];
  if (!q) {
    if (recent.length) rows.push({ key: 'h-recent', head: t(lang, 'home.recent') });
    for (const task of recent) rows.push({ key: 't-' + task.id, task });
  } else {
    if (foundProjects.length) rows.push({ key: 'h-p', head: t(lang, 'search.projects_group') });
    for (const p of foundProjects) rows.push({ key: 'p-' + p.id, project: p });
    if (foundTasks.length) rows.push({ key: 'h-t', head: t(lang, 'search.tasks_group') });
    for (const task of foundTasks) rows.push({ key: 't-' + task.id, task });
  }
  const empty = q && !rows.length;

  // Клавиатура — сразу. autoFocus срабатывает не всегда: пока экран въезжает,
  // поле может быть ещё не в окне, — поэтому ещё раз, когда переход кончился.
  useEffect(() => navigation.addListener('transitionEnd', (e) => {
    if (!(e && e.data && e.data.closing) && inputRef.current) inputRef.current.focus();
  }), [navigation]);

  // iOS 26+: поле и «закрыть» стоят в нативной шапке, система кладёт их на
  // стекло. Системная строка поиска здесь не годится: активная, она прячет
  // шапку вместе с «назад» и прыгает вверх, а закрытая — обратно вниз.
  // Поле — своё, в шапке оно не двигается; «закрыть» уводит назад.
  useLayoutEffect(() => {
    if (!IOS_NATIVE_HEADER) return;
    navigation.setOptions({
      headerTitle: '',
      headerBackVisible: false,
      unstable_headerLeftItems: () => [{
        type: 'custom',
        element: (
          <View style={[styles.nativeField, { width: nativeFieldWidth(screenW) }]}>
            <Icon name="search" size={16} color={colors.textFaint} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              onChangeText={setQuery}
              placeholder={t(lang, 'search.placeholder')}
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.accentInk}
              autoFocus
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel={t(lang, 'search.placeholder')}
            />
          </View>
        ),
      }],
      unstable_headerRightItems: () => [{
        type: 'button',
        label: '',
        accessibilityLabel: t(lang, 'common.back'),
        icon: { type: 'sfSymbol', name: SF_SYMBOL.x },
        onPress: () => navigation.goBack(),
      }],
    });
  }, [navigation, lang, colors, screenW]);

  function onProject(id) { openProject(id); navigation.navigate('Project', { projectId: id }); }
  function onTask(task) { navigation.navigate('TaskDetail', { taskId: task.id }); }

  return (
    <View style={styles.container}>
      {IOS_NATIVE_HEADER ? null : <View style={styles.head}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel={t(lang, 'common.back')}>
          <GlassBg radius={radius.md} backgroundColor={colors.panel} />
          <Icon name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.field}>
          <GlassBg radius={radius.md} backgroundColor={colors.panel} />
          <Icon name="search" size={16} color={colors.textFaint} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t(lang, 'search.placeholder')}
            placeholderTextColor={colors.textFaint}
            autoFocus
            returnKeyType="search"
            accessibilityLabel={t(lang, 'search.placeholder')}
          />
          {query ? (
            <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityLabel={t(lang, 'common.clear')}>
              <Icon name="x" size={14} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>}

      {empty ? (
        <Text style={styles.empty}>{t(lang, 'search.nothing_found')}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if (item.head) return <Text style={styles.sectionTitle}>{item.head}</Text>;
            if (item.project) {
              return (
                <Pressable style={styles.row} onPress={() => onProject(item.project.id)}>
                  <View style={[styles.dot, { backgroundColor: item.project.color }]} />
                  <Text style={styles.title} numberOfLines={1}>{item.project.name}</Text>
                  <Text style={styles.count}>{t(lang, 'search.project_sub', { n: tasksOf(tasks, item.project.id).length, plural: pluralForm(lang, tasksOf(tasks, item.project.id).length, 'plural.task') })}</Text>
                </Pressable>
              );
            }
            const project = getProject(projects, item.task.projectId);
            const status = getStatus(statuses, item.task.statusId);
            return (
              <Pressable style={styles.row} onPress={() => onTask(item.task)}>
                <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>{item.task.title || t(lang, 'task.no_name')}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {[project ? project.name : null, status ? status.name : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  back: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.md },
  // Без заливки: подложку-стекло рисует шапка.
  nativeField: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44, paddingHorizontal: spacing.md },
  input: { flex: 1, color: colors.text, fontSize: fontSize.sm, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  content: { paddingHorizontal: spacing.md, paddingBottom: insets.bottom + spacing.xl },
  sectionTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, minHeight: 52 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sub: { color: colors.textFaint, fontSize: fontSize.xs },
  count: { color: colors.textFaint, fontSize: fontSize.xs },
  empty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xxl },
});

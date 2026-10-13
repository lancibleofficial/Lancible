// Страница проекта — переделана целиком 11 октября 2026. Сверху вниз:
//   • шапка стека без заголовка: слева «назад», справа «Документы» проекта и
//     «⋮» — меню; три точки — крайние справа (название проекта и так стоит
//     на странице, второй заголовок над ним был лишним);
//   • название проекта без подложки — та же деталь, что название задачи
//     (TaskDetailScreen): 22, фирменный жирный, правится прямо на месте;
//     слева квадрат цвета проекта, под названием — описание, если есть: две
//     строки и «Раскрыть» (ExpandableText), короткое — без кнопки;
//   • теги проекта плашками, как у задачи, и «+ тег»;
//   • одна карточка с цифрами: готово из всех, время, заработок и полоса
//     прогресса — в стиле плиток «Цифр»;
//   • вкладки Список · Доска · Версии (сегменты, как в «Цифрах») и под ними
//     содержимое вкладки. «Документы» — не вкладка, а кнопка шапки.
//
// Прокрутка одна на всю страницу: шапка стека стоит, а название, теги,
// карточка, вкладки и список едут вместе. Блок вкладки растягивается до низа
// экрана — flexGrow у содержимого прокрутки и у самого блока: при двух
// задачах карточка списка всё равно доходит до низа, а пустой экран стоит
// посередине неё. Своей вертикальной прокрутки у доски нет, только
// горизонтальная по столбцам: вертикально едет страница, жесты не спорят.
//
// Отбор по версии здесь тот же, что на доске, — один на проект. Два
// независимых отбора расходились бы молча: на доске смотришь v1.0, а в
// списке задач почему-то всё. Над списком — вкладки «Все · Активные · Готово»
// и справа квадратная кнопка с иконкой фильтров (выбор версии; включённый
// отбор — акцентная иконка и точка); подписи «Все версии» на экране нет. На
// доске кнопки нет: версию выбирают на списке, доска показывает её же.
//
// Шкалы — общий ProgressBar (карточка цифр, полосы версий): натекают жидко.
// Закрепление свайпом переставляет строку между группами: заголовки и строки
// лежат одним рядом с layout переезда (useOrderHold), а правка идёт через
// hold.moveSoon — строка едет в «Закреплённые», а не перепрыгивает.
//
// Галочка меняет задачу в тот же миг: «готово из всех» и шкала не ждут налива.
// Строка при этом стоит в своей группе, пока налив играет (hold.markNow,
// hold.view), и потом уезжает в группу готовых; снятая и вернутая в работу
// отменённая едут сразу.
//
// Отменённые задачи (вид статуса «отменено») — одной группой «Отменённые» в
// самом низу списка, под всеми статусами (и закреплённые тоже). Вкладки
// «Все · Активные · Готово»: отменённая не активная и не готовая — она видна
// только под «Все» (готовыми ядро считает лишь вид «готово», а не любой
// закрывающий).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Tap from '../components/Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import NewProjectSheet from '../components/NewProjectSheet';
import PickerSheet from '../components/PickerSheet';
import MenuSheet from '../components/MenuSheet';
import QuickTaskSheet from '../components/QuickTaskSheet';
import TagPickerSheet from '../components/TagPickerSheet';
import SwipeRow from '../components/SwipeRow';
import Island, { IslandHead, IslandRow } from '../components/Island';
import EmptyState from '../components/EmptyState';
import ExpandableText from '../components/ExpandableText';
import Segmented from '../components/Segmented';
import ProgressBar from '../components/ProgressBar';
import BoardView from '../components/BoardView';
import TaskListItem from '../components/TaskListItem';
import Icon from '../components/Icon';
import { TagBadgeRow } from '../components/TagBadge';
import { HeaderButton } from '../components/TabHeader';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import { useAppStore, tasksOf, projectMs, projectMoney, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, taskElapsedMs } from '../lib/format';
import { defaultStatusId, isCancelled } from '../lib/statuses';
import { tagsOf } from '../lib/tags';
import { confirmSheet } from '../lib/dialogs';
import { IOS_NATIVE_HEADER, headerIcon } from '../navigation/nativeHeader';
import Versions from '../core/versions.js';
import Views from '../core/views.js';
import { useTicker } from '../hooks/useTicker';
import { useOrderHold } from '../hooks/useOrderHold';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, screenPadding, radius, buttonRadius, fontSize, displayFamily, gap, segmentHeight } from '../theme';
import { t } from '../lib/i18n';

const TABS = ['list', 'board', 'versions'];
const TAB_KEY = { list: 'project.tab_list', board: 'nav.board', versions: 'version.section' };
// Название сохраняется не на каждую букву, а когда палец замер, — как у задачи.
const NAME_SAVE_MS = 400;
// Высота строки отбора на списке: и вкладки «Все · Активные · Готово», и
// квадратная кнопка версии справа. Та же, что у всех сегментных вкладок.
const FILTER_H = segmentHeight;
// Описание проекта свёрнуто до двух строк; дальше — «Раскрыть».
const DESC_LINES = 2;

export default function ProjectScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { projectId } = route.params;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const allTags = useAppStore((s) => s.tags);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const boardVersion = useAppStore((s) => s.ui.boardVersion);
  const listCollapsed = useAppStore((s) => s.ui.listCollapsed);
  const setBoardVersion = useAppStore((s) => s.setBoardVersion);
  const toggleListGroup = useAppStore((s) => s.toggleListGroup);
  const settings = useAppStore((s) => s.settings);
  const LANG = settings.lang;
  const updateProject = useAppStore((s) => s.updateProject);
  const setProjectTags = useAppStore((s) => s.setProjectTags);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const rates = useRates();
  // Закрепление свайпом переставляет строку между группами — плавно (moveSoon).
  const hold = useOrderHold(navigation);

  const project = getProject(projects, projectId);
  const currency = currencyOf(project, settings);
  // Идёт таймер по задаче этого проекта — время и деньги в карточке должны
  // расти на глазах, а не после возврата на экран.
  const runningHere = !!activeTimer
    && (tasks.find((task) => task.id === activeTimer.taskId) || {}).projectId === projectId;
  useTicker(runningHere);

  const asked = route.params && route.params.tab;
  const [tab, setTab] = useState(TABS.includes(asked) ? asked : 'list');
  const [statusFilter, setStatusFilter] = useState('all');
  const [draft, setDraft] = useState('');
  const draftRef = useRef(null);
  const versionFilter = (boardVersion && boardVersion[projectId]) || 'all';
  const projectVersions = useMemo(() => Versions.versionsOf(versions, projectId), [versions, projectId]);
  // Задачи как они лежат в сторе — по ним цифры карточки; список же строится
  // по задачам, какими их показывать: пока налив отмеченной играет, она стоит
  // прежней и в своей группе (hold.view).
  const own = useMemo(() => tasksOf(tasks, projectId), [tasks, projectId]);
  const viewTasks = hold.view(tasks);
  const ownShown = useMemo(() => tasksOf(viewTasks, projectId), [viewTasks, projectId]);
  const byVersion = useMemo(
    () => Versions.filterTasks(ownShown, versions, { projectId, versionId: versionFilter }),
    [ownShown, versions, projectId, versionFilter],
  );
  const visible = useMemo(() => byVersion.filter((task) => (
    statusFilter === 'all' ? true : statusFilter === 'done' ? task.done : !task.done && !isCancelled(task, statuses)
  )), [byVersion, statusFilter, statuses]);
  const groups = useMemo(() => {
    const collapsed = (listCollapsed && listCollapsed[projectId]) || [];
    const ctx = { statuses, projectId, collapsed, activeTimer, now: Date.now() };
    const cancelled = visible.filter((task) => isCancelled(task, statuses));
    if (!cancelled.length) return Views.projectListGroups(visible, ctx);
    const rest = Views.projectListGroups(visible.filter((task) => !isCancelled(task, statuses)), ctx);
    // Отменённые — одна группа в самом низу, закреплены они или нет;
    // свежеотменённые выше.
    const at = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
    return [...rest, {
      key: 'cancelled',
      status: { name: t(LANG, 'tasks.cancelled_group'), color: colors.textFaint, kind: 'cancelled' },
      tasks: cancelled.sort((a, b) => at(b) - at(a)),
      ms: cancelled.reduce((sum, task) => sum + taskElapsedMs(task, activeTimer), 0),
      collapsed: collapsed.includes('cancelled'),
    }];
  }, [visible, statuses, projectId, listCollapsed, activeTimer, LANG, colors]);
  const versionRows = useMemo(
    () => Views.versionRows(tasks, versions, projectId, { rates, activeTimer, now: Date.now() }),
    [tasks, versions, projectId, rates, activeTimer],
  );

  // --- название: правится на месте, как у задачи ---
  // Своя копия строки, пока палец печатает; в стор уходит через паузу. Имя,
  // поменянное в другом месте (окно проекта), подхватывается, если здесь
  // ничего не ждёт сохранения. Пустым имя не сохраняется: на выходе из поля
  // возвращается прежнее — проект без имени не найти ни в колоде, ни в поиске.
  const storedName = project ? project.name : '';
  const [name, setName] = useState(storedName);
  const nameRef = useRef(name);
  nameRef.current = name;
  const pendingName = useRef(null);
  const nameTimer = useRef(null);
  useEffect(() => {
    if (pendingName.current == null && storedName !== nameRef.current) setName(storedName);
  }, [storedName]);
  // Ушли со страницы, не дождавшись паузы, — набранное всё равно сохраняется.
  useEffect(() => () => {
    clearTimeout(nameTimer.current);
    const v = pendingName.current;
    if (v != null && v.trim()) useAppStore.getState().updateProject(projectId, { name: v.trim() });
  }, [projectId]);

  function onNameChange(v) {
    const one = v.replace(/\s*\n\s*/g, ' ');
    setName(one);
    pendingName.current = one;
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      pendingName.current = null;
      if (one.trim()) updateProject(projectId, { name: one });
    }, NAME_SAVE_MS);
  }
  function onNameEnd() {
    clearTimeout(nameTimer.current);
    pendingName.current = null;
    const v = nameRef.current.trim();
    if (!v) { setName(storedName); return; }
    if (v !== storedName) updateProject(projectId, { name: v });
    if (v !== nameRef.current) setName(v);
  }

  function onDeleteProject() {
    if (!project) return;
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
      message: t(LANG, 'confirm.delete_project', { name: project.name }),
      actions: [
        { label: t(LANG, 'project.delete'), destructive: true, onPress: () => { deleteProject(project.id); navigation.goBack(); } },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
  }

  function onOpenExport() {
    // Лист экспорта сам собирает файл по периоду и проектам; отсюда — только
    // предвыбор этого проекта.
    openSheet(<ExportPeriodSheet lang={LANG} projectId={projectId} />);
  }

  function onEditProject(section) {
    openSheet(
      <NewProjectSheet
        project={project}
        section={section}
        onCancel={closeSheet}
        onCreated={closeSheet}
        onOpenStatuses={() => { closeSheet(); navigation.navigate('ProjectStatuses', { projectId }); }}
      />,
    );
  }

  function onOpenMenu() {
    openSheet(
      <MenuSheet
        title={project ? project.name : ''}
        items={[
          { key: 'task', icon: 'plus', label: t(LANG, 'project.new_task_short'), onPress: onAddTask },
          // Статусы — строкой внутри настроек проекта («Устройство проекта»),
          // отдельного пункта меню у них нет (12 октября 2026).
          { key: 'edit', icon: 'settings', label: t(LANG, 'project.menu_settings'), onPress: () => onEditProject('main') },
          {
            key: 'pin', icon: 'pin',
            label: t(LANG, project && project.pinnedAt ? 'pin.quick_remove' : 'pin.quick_add'),
            onPress: () => togglePinProject(projectId),
          },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onOpenExport },
          { key: 'delete', icon: 'trash', label: t(LANG, 'project.delete'), danger: true, separated: true, onPress: onDeleteProject },
        ]}
      />,
    );
  }

  /** Документы проекта — тот же экран «Документы», отобранный по проекту:
   *  там же поиск и «Новый документ», который ложится в этот проект. */
  const openDocs = () => navigation.navigate('Documents', { projectId });

  function onOpenTags() {
    openSheet(
      <TagPickerSheet
        value={(project && project.tagIds) || []}
        projectId={projectId}
        onChange={(ids) => setProjectTags(projectId, ids)}
      />,
    );
  }

  function onPickVersion() {
    openSheet(
      <PickerSheet
        title={t(LANG, 'version.label')}
        value={versionFilter}
        options={[
          { value: 'all', label: t(LANG, 'board.all_versions') },
          ...projectVersions.map((v) => ({ value: v.id, label: v.name })),
          { value: 'none', label: t(LANG, 'version.none') },
        ]}
        onSelect={(value) => setBoardVersion(projectId, value)}
      />,
    );
  }

  function onAddTask() {
    // Версия берётся из отбора: смотришь v1.0 — заводишь в v1.0.
    const versionId = versionFilter !== 'all' && versionFilter !== 'none' ? versionFilter : null;
    openSheet(
      <QuickTaskSheet
        projectId={projectId}
        statusId={defaultStatusId(statuses, projectId, false)}
        versionId={versionId}
        contextLabel={project ? project.name : ''}
      />,
    );
  }

  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });

  /** Строка быстрого добавления: завести задачу и сразу открыть её. */
  function submitDraft() {
    const title = draft.trim();
    if (!title) return;
    const versionId = versionFilter !== 'all' && versionFilter !== 'none' ? versionFilter : null;
    const task = createTaskInStatus(projectId, defaultStatusId(statuses, projectId, false), versionId, title);
    setDraft('');
    openTask(task.id);
  }

  // Заголовка у шапки нет (detailScreens), здесь — кнопки справа.
  useLayoutEffect(() => {
    navigation.setOptions({
      // iOS 26+: обе кнопки — нативные на жидком стекле, в том же порядке.
      unstable_headerRightItems: IOS_NATIVE_HEADER
        ? () => [
          { type: 'button', label: t(LANG, 'nav.docs'), accessibilityLabel: t(LANG, 'nav.docs'), icon: headerIcon('docs'), onPress: openDocs },
          { type: 'button', label: t(LANG, 'project.opts'), accessibilityLabel: t(LANG, 'project.opts'), icon: headerIcon('kebab'), onPress: onOpenMenu },
        ]
        : undefined,
      headerRight: () => (
        <View style={styles.headActions} testID="project-header-actions">
          <HeaderButton icon="docs" label={t(LANG, 'nav.docs')} onPress={openDocs} testID="project-docs" />
          <HeaderButton icon="kebab" label={t(LANG, 'project.opts')} onPress={onOpenMenu} testID="project-menu" />
        </View>
      ),
    });
  }, [navigation, project, colors, LANG, versionFilter]);

  if (!project) return null;

  const ms = projectMs(own, projectId, activeTimer);
  const money = projectMoney(own, projectId, rates, activeTimer);
  const doneCount = own.filter((task) => task.done).length;
  const pct = own.length ? Math.round((doneCount / own.length) * 100) : 0;
  // На «Активных» пусто не оттого, что задач нет, а оттого, что все (в пределах
  // отбора по версии) уже выполнены.
  const allDone = statusFilter === 'active' && byVersion.some((task) => task.done)
    && byVersion.every((task) => task.done || isCancelled(task, statuses));
  const projectTags = tagsOf(allTags, project.tagIds || []);
  const versionLabel = versionFilter === 'all' ? t(LANG, 'board.all_versions')
    : versionFilter === 'none' ? t(LANG, 'version.none')
      : (projectVersions.find((v) => v.id === versionFilter) || {}).name || t(LANG, 'board.all_versions');

  // Отбор по версии — квадратная кнопка с иконкой фильтров, без подписи: слов
  // «Все версии» на экране нет. Включённый отбор (не «все версии») виден
  // сразу — иконка акцентная и в углу точка; какая именно версия — в
  // accessibilityValue и в самом листе выбора.
  const versionActive = versionFilter !== 'all';
  const versionBtn = projectVersions.length ? (
    <Tap
      testID="project-version-filter"
      style={styles.versionBtn}
      onPress={onPickVersion}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t(LANG, 'project.filter_version')}
      accessibilityState={{ selected: versionActive }}
      accessibilityValue={{ text: versionLabel }}
    >
      <Icon name="tuning" size={16} color={versionActive ? colors.accentInk : colors.textDim} />
      {versionActive ? <View style={styles.versionDot} testID="project-version-filter-dot" /> : null}
    </Tap>
  ) : null;

  // Название, описание и теги — без подложки, прямо на земле страницы.
  const head = (
    <View testID="project-head">
      <View style={styles.titleRow}>
        <View style={[styles.mark, { backgroundColor: project.color || colors.accent }]} testID="project-mark" />
        <TextInput
          testID="project-name"
          style={styles.title}
          value={name}
          onChangeText={onNameChange}
          onEndEditing={onNameEnd}
          placeholder={t(LANG, 'pdlg.name_ph')}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={t(LANG, 'pdlg.name_label')}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
        />
      </View>
      {project.description ? (
        <ExpandableText
          testID="project-desc"
          style={styles.descWrap}
          textStyle={styles.desc}
          text={project.description}
          lines={DESC_LINES}
          moreLabel={t(LANG, 'project.desc_more')}
          lessLabel={t(LANG, 'project.desc_less')}
        />
      ) : null}
      <View style={styles.tagsRow} testID="project-tags">
        {projectTags.length ? (
          <TagBadgeRow tags={projectTags} onRemove={(id) => setProjectTags(projectId, (project.tagIds || []).filter((x) => x !== id))} />
        ) : null}
        <Tap style={styles.tagAdd} onPress={onOpenTags} hitSlop={6} accessibilityRole="button" accessibilityLabel={t(LANG, 'tag.pick')}>
          <Icon name="plus" size={10} color={colors.textFaint} />
          <Text style={styles.tagAddText}>{t(LANG, 'tag.pick').toLowerCase()}</Text>
        </Tap>
      </View>
    </View>
  );

  // Одна карточка с цифрами: три плитки «Цифр» в ряд и полоса готовности.
  const kpi = (
    <Island style={styles.kpi} testID="project-kpi">
      <View style={styles.kpiRow}>
        <View style={styles.kpiCell}>
          <Text style={styles.kpiNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {doneCount}<Text style={styles.kpiOf}> / {own.length}</Text>
          </Text>
          <Text style={styles.kpiLabel} numberOfLines={1}>{t(LANG, 'stats.tasks_done_short')}</Text>
        </View>
        <View style={[styles.kpiCell, styles.kpiCellNext]}>
          <Text style={styles.kpiNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{fmtDur(ms, LANG)}</Text>
          <Text style={styles.kpiLabel} numberOfLines={1}>{t(LANG, 'project.kpi_time')}</Text>
        </View>
        <View style={[styles.kpiCell, styles.kpiCellNext]}>
          <Text style={styles.kpiNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{fmtMoney(money, LANG, currency)}</Text>
          <Text style={styles.kpiLabel} numberOfLines={1}>{t(LANG, 'project.kpi_money')}</Text>
        </View>
      </View>
      {/* Шкала натекает к новому значению жидко (components/ProgressBar.js). */}
      <ProgressBar
        value={pct / 100}
        height={6}
        style={styles.bar}
        accessibilityLabel={`${t(LANG, 'project.progress')} ${pct}%`}
        testID="project-progress"
      />
    </Island>
  );

  // Вкладки — общий Segmented: подложка выбранной переезжает жидко.
  const tabs = (
    <Segmented
      items={TABS.map((key) => ({ key, label: t(LANG, TAB_KEY[key]) }))}
      value={tab}
      onChange={setTab}
      testID="project-tabs"
    />
  );

  let body;
  if (tab === 'board') {
    // Доска — во всю ширину экрана: столбцы сами держат поле от края. Кнопки
    // отбора по версии здесь нет — она только над списком; отбор общий, и
    // доска его просто держит.
    body = (
      <View style={[styles.body, styles.boardBody]} testID="project-tab-body">
        <BoardView projectId={projectId} versionFilter={versionFilter} onOpenTask={openTask} />
      </View>
    );
  } else if (tab === 'versions') {
    body = (
      <Island style={styles.body} testID="project-tab-body">
        {/* Версий нет — пустой экран с «Новой версией» (окно проекта на
            разделе «Версии»); подпись «Настроить версии…» на это время не
            нужна: действие одно. Заголовка у острова нет — его говорит
            выбранная вкладка прямо над ним. */}
        {projectVersions.length ? (
          <IslandHead title="" note={t(LANG, 'version.manage')} onPressNote={() => onEditProject('versions')} />
        ) : null}
        {projectVersions.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              art="versions"
              title={t(LANG, 'empty.versions_title')}
              text={t(LANG, 'empty.versions_text')}
              actionLabel={t(LANG, 'empty.new_version')}
              onAction={() => onEditProject('versions')}
            />
          </View>
        ) : versionRows.map((r, i) => (
          <VersionRow key={r.id || 'none'} r={r} first={i === 0} styles={styles} lang={LANG} money={fmtMoney(r.money, LANG, currency)}
            onPress={r.id ? () => { setBoardVersion(projectId, r.id); setTab('list'); } : undefined} />
        ))}
      </Island>
    );
  } else {
    body = (
      <Island style={styles.body} testID="project-tab-body">
        <View style={styles.qa}>
          <Icon name="plus" size={14} color={colors.textFaint} />
          <TextInput
            ref={draftRef}
            style={styles.qaInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={t(LANG, 'tasks.new_ph')}
            placeholderTextColor={colors.textFaint}
            returnKeyType="done"
            onSubmitEditing={submitDraft}
            accessibilityLabel={t(LANG, 'tasks.new_ph')}
          />
          <Tap scale={0.92} hitSlop={6} onPress={submitDraft} style={[styles.qaGo, draft.trim() && styles.qaGoOn]} accessibilityRole="button" accessibilityLabel={t(LANG, 'agenda.create_btn')}>
            <Text style={[styles.qaGoText, draft.trim() && styles.qaGoTextOn]}>{t(LANG, 'agenda.create_btn')}</Text>
          </Tap>
        </View>

        {own.length ? (
          <View style={styles.filterRow} testID="project-filter-row">
            <Segmented
              items={['all', 'active', 'done'].map((key) => ({ key, label: t(LANG, `filter.${key}`) }))}
              value={statusFilter}
              onChange={setStatusFilter}
              style={styles.filterSeg}
              pillColor={colors.tabActiveBg}
              itemRole="button"
              testID="project-filter-seg"
            />
            {versionBtn}
          </View>
        ) : null}

        {/* Пусто — посередине блока, который тянется до низа экрана. Три
            разных пустых экрана: задач нет совсем — «Новая задача» ставит
            курсор в строку над списком, как в «Задачах»; все задачи
            выполнены (на «Активных» ничего не осталось) — похвала и «Показать
            выполненные»; отбор ничего не оставил — снять его по статусу и
            версии. */}
        {groups.length === 0 ? (
          <View style={styles.emptyWrap} testID="project-list-empty">
            {!own.length ? (
              <EmptyState
                art="tasks"
                title={t(LANG, 'deck.no_tasks')}
                text={t(LANG, 'empty.project_tasks_text')}
                actionLabel={t(LANG, 'empty.new_task')}
                onAction={() => draftRef.current && draftRef.current.focus()}
              />
            ) : allDone ? (
              <EmptyState
                art="tasks"
                title={t(LANG, 'empty.project_done_title')}
                text={t(LANG, 'empty.project_done_text')}
                actionLabel={t(LANG, 'empty.show_done')}
                onAction={() => setStatusFilter('done')}
              />
            ) : (
              <EmptyState
                size="sm"
                art="filter"
                title={t(LANG, 'empty.filter_title')}
                text={t(LANG, 'empty.filter_text')}
                actionLabel={t(LANG, 'empty.show_all')}
                onAction={() => { setStatusFilter('all'); setBoardVersion(projectId, 'all'); }}
              />
            )}
          </View>
        ) : groups.flatMap((g, gi) => [
          // Заголовки групп и строки лежат в одном ряду, а не каждая группа в
          // своей обёртке: закреплённая задача уезжает в другую группу тем же
          // элементом (ключ — задача), и layout переезда его подвигает.
          <Animated.View key={`group-${g.key}`} layout={hold.layout}>
            <Tap
              style={[styles.group, gi === 0 && styles.groupFirst]}
              onPress={() => toggleListGroup(projectId, g.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: !g.collapsed }}
            >
              <Icon name={g.collapsed ? 'chevron-right' : 'chevron-down'} size={11} color={colors.textFaint} />
              {g.status ? <View style={[styles.groupDot, { backgroundColor: g.status.color }]} /> : <Icon name="pin" size={11} color={colors.textFaint} />}
              <Text style={styles.groupName} numberOfLines={1}>{g.status ? g.status.name : t(LANG, 'home.pinned')}</Text>
              <Text style={styles.groupCount}>{g.tasks.length}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.groupTime}>{fmtDur(g.ms, LANG)}</Text>
            </Tap>
          </Animated.View>,
          ...(g.collapsed ? [] : g.tasks.map((task) => (
            // Закрепление переставляет строку между группами — плавно: сначала
            // layout переезда, потом сама правка (useOrderHold, moveSoon).
            <Animated.View key={task.id} layout={hold.layout} style={task.id === hold.rising && styles.rowRise} testID={`project-row-${task.id}`}>
              <SwipeRow
                label={t(LANG, task.pinnedAt ? 'pin.unpin' : 'pin.pin')}
                onAction={() => hold.moveSoon(() => togglePinTask(task.id), task.id)}
              >
                <View style={styles.rowBg}>
                  <TaskListItem
                    task={task}
                    showStatus={false}
                    checked={hold.marked(task.id)}
                    // Отметка — сразу, строка стоит, пока налив играет; открывающая
                    // правка (снять галочку, вернуть отменённую) — сразу и строка едет.
                    onToggleDone={(_task, change, closed) => (closed ? change() : hold.markNow(change, task))}
                    onPress={() => openTask(task.id)}
                  />
                </View>
              </SwipeRow>
            </Animated.View>
          ))),
        ])}
      </Island>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        testID="project-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {head}
        {kpi}
        {tabs}
        {body}
      </ScrollView>
    </View>
  );
}

/** Строка версии: имя, готовые из всех, время и деньги, полоса прогресса. */
function VersionRow({ r, first, styles, lang, money, onPress }) {
  if (!r.id) {
    return (
      <IslandRow first={first}>
        <Text style={styles.pvNone} numberOfLines={1}>{t(lang, 'version.none')} — {t(lang, 'project.done_of', { done: r.done, total: r.total })}</Text>
      </IslandRow>
    );
  }
  return (
    <IslandRow first={first} onPress={onPress} style={styles.pvRow}>
      <View style={styles.pvHead}>
        <Text style={styles.pvName} numberOfLines={1}>{r.name || t(lang, 'task.no_name')}</Text>
        <Text style={styles.pvSum} numberOfLines={1}>
          {t(lang, 'project.done_of', { done: r.done, total: r.total })} · {fmtDur(r.ms, lang)}{money ? ` · ${money}` : ''}
        </Text>
      </View>
      {/* Отступ от строки с цифрами — gap у pvRow. */}
      <ProgressBar value={r.total ? r.done / r.total : 0} testID={`project-version-${r.id}`} />
    </IslandRow>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  // flexGrow: содержимое не ниже экрана — блоку вкладки есть до чего тянуться.
  content: { flexGrow: 1, paddingHorizontal: screenPadding, paddingTop: 4, paddingBottom: insets.bottom + spacing.xl, gap },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Название — как у задачи (TaskDetailScreen, styles.title): 22, фирменный
  // жирный, без подложки и рамки. Равенство держит mobile/tests/ProjectScreen.test.js.
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  // Квадрат цвета стоит на середине первой строки: 4 поля + 28/2 − 10/2.
  mark: { width: 10, height: 10, borderRadius: 3, marginTop: 13 },
  title: { flex: 1, color: colors.text, fontSize: 22, fontFamily: displayFamily.bold, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 4, lineHeight: 28 },
  descWrap: { paddingTop: 2 },
  desc: { color: colors.textDim, fontSize: fontSize.sm, lineHeight: 20 },
  tagsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 8 },
  tagAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: colors.panel },
  tagAddText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },

  // Карточка цифр: числа — как плитки «Цифр» (16, фирменный жирный), подпись
  // под ними тихая; плитки делит волосяная линия, снизу полоса готовности.
  kpi: { paddingHorizontal: 0, paddingVertical: spacing.md },
  kpiRow: { flexDirection: 'row' },
  kpiCell: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md },
  kpiCellNext: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  kpiNum: { color: colors.text, fontSize: 16, lineHeight: 22, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  kpiOf: { color: colors.textFaint, fontSize: 12 },
  kpiLabel: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  // Шкала — общий ProgressBar (дорожка panel2); здесь только поля.
  bar: { marginTop: spacing.md, marginHorizontal: spacing.md },

  // Вкладки — сегменты «Цифр»: дорожка panel на земле, выбранный — raise.

  // Блок вкладки тянется до низа экрана (см. content.flexGrow).
  body: { flexGrow: 1 },
  boardBody: { marginHorizontal: -screenPadding },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.lg },

  // Отступ кнопки «Создать» справа — тот же, что сверху и снизу: (42 − 30) / 2.
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 42, paddingLeft: 10, paddingRight: 6, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { height: 30, paddingHorizontal: 11, borderRadius: radius.sm, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  qaGoOn: { backgroundColor: colors.accent },
  qaGoText: { color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  qaGoTextOn: { color: colors.accentText },

  // Отбор: вкладки «Все · Активные · Готово» и справа квадратная кнопка версии
  // — одной высоты FILTER_H (ширина кнопки равна высоте).
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  // Вкладки отбора — общий Segmented: размер, подписи и скругления (дорожка
  // buttonRadius, подложка и кнопки внутри — концентрично) его; подложка
  // (tabActiveBg) переезжает жидко. Кнопка версии — в тон дорожке.
  filterSeg: { flex: 1, flexDirection: 'row', height: FILTER_H, backgroundColor: colors.panel2, padding: 2, gap: 2 },
  versionBtn: { width: FILTER_H, height: FILTER_H, borderRadius: buttonRadius, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  // Точка «отбор включён» в правом верхнем углу; кольцо цвета кнопки отделяет её от иконки.
  versionDot: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, borderWidth: 1.5, borderColor: colors.panel2 },

  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  groupFirst: { borderTopWidth: 0 },
  groupDot: { width: 8, height: 8, borderRadius: 2 },
  groupName: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1 },
  groupCount: { color: colors.textFaint, fontSize: fontSize.xs },
  groupTime: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  rowBg: { backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  // Едущая в другую группу строка — поверх соседей (у строк сплошная заливка).
  rowRise: { zIndex: 2 },

  pvRow: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  pvHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pvName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  pvSum: { flex: 1, textAlign: 'right', color: colors.textFaint, fontSize: fontSize.xs },
  pvNone: { color: colors.textFaint, fontSize: fontSize.xs },
});

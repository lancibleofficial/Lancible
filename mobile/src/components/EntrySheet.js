// Лист «Новая запись» — то, что на вебе делает черновик задачи с
// календаря (openTaskModal с fresh): имя новой задачи, проект, отрезок
// времени; пока имя набирается, под ним подходящие существующие задачи —
// время можно дописать к одной из них, не заводя вторую.
//
// В отличие от веба, черновик живёт в листе, а не в состоянии: задача
// появляется только по «Создать». На вебе черновик лежит в state, потому
// что окно показывает ему те же свойства, что и настоящей задаче; у
// телефона свойств в листе нет, и пустой задаче в хранилище взяться
// неоткуда — отмена ничего не чистит.
import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import PrimaryButton from './PrimaryButton';
import PickerSheet from './PickerSheet';
import MiniDatePicker from './MiniDatePicker';
import { TimeRange } from './TimeField';
import { useAppStore } from '../store/useAppStore';
import { openSheet, closeSheet, setSheetFooter } from '../store/useSheetStore';
import { defaultStatusId } from '../lib/statuses';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { hm, spanFromParts, MIN_SESSION_MS } from '../lib/sessions';
import { fmtClock } from '../lib/format';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

/** @param initial {start, end} в мс; @param projectId — проект по
 *  умолчанию (с «Времени» — отобранный); @param onDone(taskId).
 *  @param draft — состояние прежнего листа: PickerSheet проекта заменяет
 *  собой этот лист, и после выбора он открывается заново с тем же набранным. */
export default function EntrySheet({ initial, projectId: preferredId = null, onDone, draft = null }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const quickAddProjectId = useAppStore((s) => s.ui.quickAddProjectId);
  const setQuickAddProject = useAppStore((s) => s.setQuickAddProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const addSessionSpan = useAppStore((s) => s.addSessionSpan);
  const showToast = useAppStore((s) => s.showToast);

  const alive = (id) => projects.some((p) => p.id === id);
  const [projectId, setProjectId] = useState(() => {
    if (draft && alive(draft.projectId)) return draft.projectId;
    if (alive(preferredId)) return preferredId;
    if (alive(quickAddProjectId)) return quickAddProjectId;
    return (projects[0] || {}).id || null;
  });
  const startAt = new Date(initial && initial.start ? initial.start : Date.now() - 3_600_000);
  const endAt = new Date(initial && initial.end ? initial.end : Date.now());
  const [title, setTitle] = useState(draft ? draft.title : '');
  const [date, setDate] = useState(draft ? draft.date : dayKey(startAt));
  const [start, setStart] = useState(draft ? draft.start : hm(startAt));
  const [end, setEnd] = useState(draft ? draft.end : hm(endAt));
  const [pickingDate, setPickingDate] = useState(false);

  const project = projects.find((p) => p.id === projectId) || null;
  const span = spanFromParts(date, start, end);
  const valid = !!span && span.ms >= MIN_SESSION_MS;
  const canCreate = valid && !!project;

  // Подходящие существующие задачи — пять последних по правке.
  const q = title.trim().toLowerCase();
  const found = useMemo(() => (q
    ? tasks
      .filter((task) => (task.title || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 5)
    : []), [tasks, q]);

  function finish(taskId) {
    closeSheet();
    showToast(t(lang, 'agenda.new_entry'));
    if (onDone) onDone(taskId);
  }

  function create() {
    if (!canCreate) { showToast(t(lang, 'toast.invalid_interval')); return; }
    const task = createTaskInStatus(project.id, defaultStatusId(statuses, project.id, false), null, title);
    addSessionSpan(task.id, span.start.getTime(), span.end.getTime());
    setQuickAddProject(project.id);
    finish(task.id);
  }

  /** Время уходит к выбранной задаче, черновик исчезает вместе с листом. */
  function attach(task) {
    if (!valid) { showToast(t(lang, 'toast.invalid_interval')); return; }
    addSessionSpan(task.id, span.start.getTime(), span.end.getTime());
    setQuickAddProject(task.projectId);
    finish(task.id);
  }

  function pickProject() {
    const resume = (id) => openSheet(
      <EntrySheet
        initial={initial}
        onDone={onDone}
        draft={{ projectId: id, title, date, start, end }}
      />,
    );
    openSheet(
      <PickerSheet
        title={t(lang, 'board.pick_project')}
        value={projectId}
        options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
        onSelect={resume}
      />,
    );
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'agenda.create_btn')} onPress={create} disabled={!canCreate} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={closeSheet} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [title, projectId, date, start, end, canCreate, lang]);

  const dateLabel = keyToDate(date).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.kicker}>{t(lang, 'agenda.create_title')}</Text>
      <View style={styles.titleRow}>
        <View style={[styles.dot, { backgroundColor: project ? project.color : colors.textFaint }]} />
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          placeholder={t(lang, 'agenda.task_name_ph')}
          placeholderTextColor={colors.textFaint}
          autoFocus={!draft}
          returnKeyType="done"
          onSubmitEditing={create}
        />
      </View>

      {projects.length ? (
        <Pressable style={styles.projBtn} onPress={pickProject} hitSlop={6}>
          <Text style={styles.projLabel}>{t(lang, 'board.pick_project')}</Text>
          <Text style={styles.projValue} numberOfLines={1}>{project ? project.name : ''}</Text>
          <Icon name="chevron-down" size={12} color={colors.textFaint} />
        </Pressable>
      ) : <Text style={styles.noProjects}>{t(lang, 'agenda.no_projects')}</Text>}

      {found.length ? (
        <View style={styles.found}>
          <Text style={styles.foundLabel}>{t(lang, 'agenda.or_existing')}</Text>
          {found.map((task) => {
            const p = projects.find((x) => x.id === task.projectId);
            return (
              <Pressable key={task.id} style={styles.foundRow} onPress={() => attach(task)}>
                <View style={[styles.dotSm, { backgroundColor: p ? p.color : colors.textFaint }]} />
                <Text style={styles.foundName} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
                <Text style={styles.foundProj} numberOfLines={1}>{p ? p.name : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Pressable style={[styles.dateBtn, pickingDate && styles.dateBtnOpen]} onPress={() => setPickingDate((v) => !v)}>
        <Icon name="calendar" size={14} color={colors.textDim} />
        <Text style={styles.dateLabel}>{t(lang, 'sdlg.date_label')}</Text>
        <Text style={styles.dateValue}>{dateLabel}</Text>
      </Pressable>
      {pickingDate ? <MiniDatePicker lang={lang} valueKey={date} onPick={(key) => { setDate(key); setPickingDate(false); }} /> : null}

      <TimeRange
        startLabel={t(lang, 'sdlg.start_label')}
        endLabel={t(lang, 'sdlg.end_label')}
        start={start}
        end={end}
        onStart={setStart}
        onEnd={setEnd}
      />

      <Text style={[styles.duration, !valid && styles.durationBad]}>
        {span ? t(lang, 'sdlg.duration', { time: fmtClock(span.ms) }) : t(lang, 'sdlg.check_datetime')}
      </Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  kicker: { color: colors.textFaint, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 4 },
  dotSm: { width: 8, height: 8, borderRadius: 2 },
  title: { flex: 1, color: colors.text, ...typography.title, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0 },
  projBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  projLabel: { color: colors.textDim, fontSize: fontSize.sm },
  projValue: { flex: 1, textAlign: 'right', color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  noProjects: { color: colors.danger, fontSize: fontSize.sm },
  found: { gap: spacing.xs },
  foundLabel: { color: colors.textFaint, fontSize: fontSize.xs, marginBottom: 2 },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.panel2 },
  foundName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  foundProj: { color: colors.textFaint, fontSize: fontSize.xs, maxWidth: 110 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  dateBtnOpen: { backgroundColor: colors.accentMuted },
  dateLabel: { color: colors.textDim, fontSize: fontSize.sm },
  dateValue: { flex: 1, textAlign: 'right', color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  duration: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center' },
  durationBad: { color: colors.danger },
});

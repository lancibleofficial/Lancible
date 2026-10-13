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
//
// Собран из общих кирпичей (12 октября 2026): название — крупное поле
// (Field big), проект — строка острова; выбор проекта — страница этого же
// листа со стрелкой «назад» (раньше — лист поверх, и набранное приходилось
// переносить в заново открытый); дата, начало и конец — строки с выбором под
// строкой, как в «Времени работы»; длительность — сводка InfoRow.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import PickerSheet from './PickerSheet';
import ChoiceList from './ChoiceList';
import MiniDatePicker from './MiniDatePicker';
import TimeColumns from './TimeField';
import SheetPage, { usePageMotion } from './SheetPage';
import { RowGroup, SettingRow, ExpandRow } from './Island';
import { Block, Hint, InfoRow } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { defaultStatusId } from '../lib/statuses';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { hm, spanFromParts, MIN_SESSION_MS } from '../lib/sessions';
import { fmtClock, capFirst } from '../lib/format';
import { useColors, spacing } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

/** @param initial {start, end} в мс; @param projectId — проект по
 *  умолчанию (с «Времени» — отобранный); @param onDone(taskId). */
export default function EntrySheet({ initial, projectId: preferredId = null, onDone }) {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const quickAddProjectId = useAppStore((s) => s.ui.quickAddProjectId);
  const setQuickAddProject = useAppStore((s) => s.setQuickAddProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const addSessionSpan = useAppStore((s) => s.addSessionSpan);
  const showToast = useAppStore((s) => s.showToast);

  // Страница: 'main' — форма, 'project' — выбор проекта.
  const [page, setPage] = useState('main');
  const motion = usePageMotion(page === 'project' ? 1 : 0);
  useSheetHeader(
    t(lang, page === 'project' ? 'board.pick_project' : 'agenda.create_title'),
    page === 'project' ? () => setPage('main') : null,
  );

  const alive = (id) => projects.some((p) => p.id === id);
  const [projectId, setProjectId] = useState(() => {
    if (alive(preferredId)) return preferredId;
    if (alive(quickAddProjectId)) return quickAddProjectId;
    return (projects[0] || {}).id || null;
  });
  const startAt = new Date(initial && initial.start ? initial.start : Date.now() - 3_600_000);
  const endAt = new Date(initial && initial.end ? initial.end : Date.now());
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dayKey(startAt));
  const [start, setStart] = useState(hm(startAt));
  const [end, setEnd] = useState(hm(endAt));
  // Раскрытая строка: 'date', 'start' или 'end'; открыта одна.
  const [open, setOpen] = useState(null);
  // Название берёт фокус только при открытии листа, а не на каждом возврате
  // со страницы выбора проекта.
  const focusTitle = useRef(true);
  useEffect(() => { focusTitle.current = false; }, []);
  const toggle = (which) => setOpen((o) => (o === which ? null : which));

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

  // Подвал — у формы; у выбора проекта его нет (выбор возвращает к форме).
  useEffect(() => {
    if (page !== 'main') return undefined;
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'agenda.create_btn')} onPress={create} disabled={!canCreate} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={closeSheet} />
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, title, projectId, date, start, end, canCreate, lang]);

  if (page === 'project') {
    return (
      <SheetPage key="project" motion={motion}>
        <PickerSheet
          embedded
          value={projectId}
          options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
          onSelect={(id) => { setProjectId(id); setPage('main'); }}
        />
      </SheetPage>
    );
  }

  const dateLabel = capFirst(keyToDate(date).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }));

  return (
    <SheetPage key="main" motion={motion} style={styles.content}>
      <Field
        big
        value={title}
        onChangeText={setTitle}
        placeholder={t(lang, 'agenda.task_name_ph')}
        autoFocus={focusTitle.current}
        returnKeyType="done"
        onSubmitEditing={create}
        testID="entry-title"
      />

      {projects.length ? (
        <RowGroup>
          <SettingRow
            lead={<View style={[styles.dot, { backgroundColor: project ? project.color : colors.textFaint }]} />}
            label={t(lang, 'quick_add.project')}
            value={project ? project.name : ''}
            onPress={() => { setOpen(null); setPage('project'); }}
            testID="entry-project"
          />
        </RowGroup>
      ) : <Hint danger>{t(lang, 'agenda.no_projects')}</Hint>}

      {found.length ? (
        <Block label={t(lang, 'agenda.or_existing')}>
          <ChoiceList
            options={found.map((task) => {
              const p = projects.find((x) => x.id === task.projectId);
              return { value: task.id, label: task.title || t(lang, 'task.no_name'), color: p ? p.color : colors.textFaint, note: p ? p.name : undefined };
            })}
            onSelect={(id) => attach(found.find((task) => task.id === id))}
            testID="entry-found"
          />
        </Block>
      ) : null}

      <RowGroup testID="entry-rows">
        <ExpandRow icon="calendar" label={t(lang, 'sdlg.date_label')} value={dateLabel} open={open === 'date'} onToggle={() => toggle('date')} testID="entry-date">
          <MiniDatePicker lang={lang} valueKey={date} onPick={(key) => { setDate(key); setOpen(null); }} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.start_label')} value={start} open={open === 'start'} onToggle={() => toggle('start')} testID="entry-start">
          <TimeColumns value={start} onChange={setStart} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.end_label')} value={end} open={open === 'end'} onToggle={() => toggle('end')} testID="entry-end">
          <TimeColumns value={end} onChange={setEnd} />
        </ExpandRow>
      </RowGroup>

      <InfoRow
        icon="stopwatch"
        danger={!valid}
        text={span ? t(lang, 'sdlg.duration', { time: fmtClock(span.ms) }) : t(lang, 'sdlg.check_datetime')}
        testID="entry-duration"
      />
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 3 },
});

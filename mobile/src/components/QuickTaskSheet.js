// Быстрый ввод задачи: из ячейки доски и из «+» в шапке Главной.
//
// Лист не закрывается после создания: заполняя колонку или набрасывая список
// дел, задач заводят несколько подряд, и закрытие после каждой превращало бы
// это в десять одинаковых движений. Поле очищается, фокус остаётся — набрал,
// «Создать», набрал дальше. Выход — отдельной кнопкой «Готово».
//
// Пустых задач здесь не бывает: в вебе название вводят уже в редакторе,
// куда доска и перебрасывает, а на телефоне спрашивают до создания — значит
// и создавать нечего, пока поле пустое.
//
// Два режима, один компонент. С доски приходят готовые статус и версия
// ячейки, и менять их незачем — карточка и так появится там, куда нажали; где
// она появится, говорит подпись над полем (Block). Из шапки Главной ячейки
// нет: показывается строка «Проект ›», а статус берётся первый «к
// выполнению», как у любой новой задачи. Выбор проекта — страница этого же
// листа со стрелкой «назад» (12 октября 2026; раньше — лист поверх, и
// набранное название приходилось переносить в заново открытый).
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import PickerSheet from './PickerSheet';
import SheetPage, { usePageMotion } from './SheetPage';
import { RowGroup, SettingRow } from './Island';
import { Block } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import { defaultStatusId } from '../lib/statuses';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing } from '../theme';
import { t } from '../lib/i18n';

export default function QuickTaskSheet({
  projectId, statusId, versionId, contextLabel,
  // Режим «из шапки»: проект выбирается в самом листе и запоминается, а по
  // созданию показывается тост с переходом к задаче.
  pickProject = false, onOpenTask, initialTitle = '',
}) {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.statuses);
  const quickAddProjectId = useAppStore((s) => s.ui.quickAddProjectId);
  const setQuickAddProject = useAppStore((s) => s.setQuickAddProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const showToast = useAppStore((s) => s.showToast);

  // Страница: 'main' — поле, 'project' — выбор проекта (только из шапки).
  const [page, setPage] = useState('main');
  const motion = usePageMotion(page === 'project' ? 1 : 0);
  // У поля заголовка нет (подпись ячейки — над полем); у выбора — свой и «назад».
  useSheetHeader(page === 'project' ? t(lang, 'board.pick_project') : null, page === 'project' ? () => setPage('main') : null);

  // Проект последней заведённой отсюда задачи, иначе первый: задачи подряд
  // обычно летят в один и тот же проект. Выбор живёт в ui и переживает лист.
  const remembered = projects.find((p) => p.id === quickAddProjectId);
  const chosenId = pickProject ? ((remembered || projects[0] || {}).id || null) : projectId;
  const chosen = projects.find((p) => p.id === chosenId);

  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef(null);
  // Свежие значения в замыкании футера: сам футер пересобирается эффектом
  // ниже, но обработчик читает их через ref — так кнопка не зависит от того,
  // успел ли эффект отработать.
  const latest = useRef({ title: initialTitle, projectId: chosenId });
  latest.current = { title, projectId: chosenId };

  function onCreate() {
    const trimmed = latest.current.title.trim();
    const pid = latest.current.projectId;
    if (!trimmed || !pid) return;
    // С доски статус приходит готовым, из шапки — первый «к выполнению».
    const status = pickProject ? defaultStatusId(statuses, pid, false) : statusId;
    const task = createTaskInStatus(pid, status, pickProject ? null : versionId, trimmed);
    setTitle('');
    if (inputRef.current) inputRef.current.focus();
    if (!pickProject) return;
    setQuickAddProject(pid);
    const project = projects.find((p) => p.id === pid);
    showToast(
      t(lang, 'task.created_in', { name: project ? project.name : '' }),
      onOpenTask ? { label: t(lang, 'common.open'), onPress: () => { closeSheet(); onOpenTask(task); } } : null,
    );
  }

  useEffect(() => {
    if (page !== 'main') return undefined;
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'board.create')} onPress={onCreate} disabled={!title.trim() || !chosenId} />
        <PrimaryButton title={t(lang, 'common.done')} variant="ghost" onPress={closeSheet} />
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, lang, title, chosenId]);

  if (page === 'project') {
    return (
      <SheetPage key="project" motion={motion}>
        <PickerSheet
          embedded
          value={chosenId || ''}
          options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
          onSelect={(id) => { setQuickAddProject(id); setPage('main'); }}
        />
      </SheetPage>
    );
  }

  const field = (
    <Field
      ref={inputRef}
      value={title}
      onChangeText={setTitle}
      placeholder={t(lang, 'board.task_title_ph')}
      autoFocus
      returnKeyType="done"
      onSubmitEditing={onCreate}
      // Клавиатура не прячется между задачами: следующая вводится сразу.
      blurOnSubmit={false}
    />
  );

  return (
    <SheetPage key="main" motion={motion} style={styles.wrap}>
      {contextLabel ? <Block label={contextLabel}>{field}</Block> : field}
      {pickProject ? (
        <RowGroup>
          <SettingRow
            lead={<View style={[styles.dot, { backgroundColor: chosen ? chosen.color : colors.textFaint }]} />}
            label={t(lang, 'quick_add.project')}
            value={chosen ? chosen.name : ''}
            onPress={() => setPage('project')}
            testID="quick-project"
          />
        </RowGroup>
      ) : null}
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 3 },
});

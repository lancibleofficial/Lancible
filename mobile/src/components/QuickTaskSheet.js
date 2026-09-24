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
// ячейки, и менять их незачем — карточка и так появится там, куда нажали. Из
// шапки Главной ячейки нет: показывается строка выбора проекта, а статус
// берётся первый «к выполнению», как у любой новой задачи.
import { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import Icon from './Icon';
import PickerSheet from './PickerSheet';
import { useAppStore } from '../store/useAppStore';
import { defaultStatusId } from '../lib/statuses';
import { openSheet, closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function QuickTaskSheet({
  projectId, statusId, versionId, contextLabel,
  // Режим «из шапки»: проект выбирается в самом листе и запоминается, а по
  // созданию показывается тост с переходом к задаче.
  pickProject = false, onOpenTask, initialTitle = '',
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.statuses);
  const quickAddProjectId = useAppStore((s) => s.ui.quickAddProjectId);
  const setQuickAddProject = useAppStore((s) => s.setQuickAddProject);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const showToast = useAppStore((s) => s.showToast);

  // Проект последней заведённой отсюда задачи, иначе первый: задачи подряд
  // обычно летят в один и тот же проект.
  // Своего состояния у выбора нет: он живёт в ui и переживает пересоздание
  // листа, которым и делается смена проекта (см. onPickProject).
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

  // Лист в приложении один, поэтому выбор проекта закрывает собой это окно.
  // Чтобы набранное название не пропало, по выбору открываем себя же заново
  // с тем же текстом и новым проектом.
  function onPickProject() {
    const draft = latest.current.title;
    openSheet(
      <PickerSheet
        title={t(lang, 'board.pick_project')}
        value={chosenId || ''}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        onSelect={(id) => {
          setQuickAddProject(id);
          openSheet(
            <QuickTaskSheet pickProject onOpenTask={onOpenTask} initialTitle={draft} />,
          );
        }}
      />,
    );
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'board.create')} onPress={onCreate} disabled={!title.trim() || !chosenId} />
        <PrimaryButton title={t(lang, 'common.done')} variant="ghost" onPress={closeSheet} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [lang, title, chosenId]);

  return (
    <View style={styles.wrap}>
      {contextLabel ? <Text style={styles.context} numberOfLines={1}>{contextLabel}</Text> : null}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={t(lang, 'board.task_title_ph')}
        placeholderTextColor={colors.textDim}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onCreate}
        // Клавиатура не прячется между задачами: следующая вводится сразу.
        blurOnSubmit={false}
      />
      {pickProject ? (
        <Pressable style={styles.projectRow} onPress={onPickProject}>
          <Text style={styles.projectLabel}>{t(lang, 'quick_add.project')}</Text>
          <View style={[styles.dot, { backgroundColor: chosen ? chosen.color : colors.textFaint }]} />
          <Text style={styles.projectName} numberOfLines={1}>{chosen ? chosen.name : ''}</Text>
          <Icon name="chevron-right" size={12} color={colors.textDim} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm, paddingBottom: spacing.sm },
  context: { color: colors.textDim, fontSize: fontSize.sm },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.text, fontSize: fontSize.md,
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.panel2, borderRadius: radius.md,
  },
  projectLabel: { color: colors.textDim, fontSize: fontSize.sm },
  dot: { width: 10, height: 10, borderRadius: 3, marginLeft: 'auto' },
  projectName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', maxWidth: '55%' },
});

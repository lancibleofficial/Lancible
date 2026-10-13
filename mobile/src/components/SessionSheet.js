// Запись времени вручную: дата, начало, конец — одним листом, как окно
// «Добавить запись» на десктопе. Конец раньше начала — через полночь
// (lib/sessions.js, spanFromParts). Короче минуты не сохраняется, и об этом
// говорит сводка длительности.
//
// Собран из общих кирпичей (12 октября 2026): строка задачи — SettingRow на
// острове; дата, начало и конец — строки острова с выбором под строкой
// (ExpandRow), как в «Времени работы»; длительность — сводка InfoRow.
// Удаление спрашивает подтверждение страницей этого же листа, а не листом
// поверх.
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import TimeColumns from './TimeField';
import ActionSheetContent from './ActionSheetContent';
import SheetPage, { usePageMotion } from './SheetPage';
import { RowGroup, SettingRow, ExpandRow } from './Island';
import { InfoRow } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { fmtClock, capFirst } from '../lib/format';
import { spanFromParts, hm, MIN_SESSION_MS } from '../lib/sessions';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

/** @param task — чья запись; @param index — правим запись по индексу,
 *  null — новая. @param initial — { start, end } (Date или мс) для новой.
 *  @param onOpenTask — открыть задачу (с «Сегодня» и сетки); со страницы
 *    самой задачи его нет, и строка задачи — без шеврона и не нажимается. */
export default function SessionSheet({ task, index = null, initial, onSaved, onOpenTask }) {
  const lang = useAppStore((s) => s.settings.lang);
  const saveSession = useAppStore((s) => s.saveSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const showToast = useAppStore((s) => s.showToast);
  const project = useAppStore((s) => s.projects.find((p) => p.id === task.projectId)) || null;

  const existing = index != null ? (task.sessions || [])[index] : null;
  // Страница: 'main' — форма, 'confirm' — подтверждение удаления.
  const [page, setPage] = useState('main');
  const motion = usePageMotion(page === 'confirm' ? 1 : 0);
  useSheetHeader(
    t(lang, page === 'confirm' ? 'confirm.are_you_sure' : existing ? 'sdlg.edit_title' : 'sdlg.add_title'),
    page === 'confirm' ? () => setPage('main') : null,
  );
  const startAt = existing ? new Date(existing.start)
    : initial && initial.start ? new Date(initial.start) : new Date(Date.now() - 3_600_000);
  const endAt = existing ? (existing.end ? new Date(existing.end) : new Date())
    : initial && initial.end ? new Date(initial.end) : new Date();

  const [date, setDate] = useState(dayKey(startAt));
  const [start, setStart] = useState(hm(startAt));
  const [end, setEnd] = useState(hm(endAt));
  // Раскрытая строка: 'date', 'start' или 'end'; открыта одна.
  const [open, setOpen] = useState(null);
  const toggle = (which) => setOpen((o) => (o === which ? null : which));

  const span = spanFromParts(date, start, end);
  const valid = !!span && span.ms >= MIN_SESSION_MS;

  function save() {
    if (!valid) { showToast(t(lang, 'toast.invalid_interval')); return; }
    saveSession(task.id, index, { start: span.start.getTime(), end: span.end.getTime(), ms: span.ms });
    closeSheet();
    if (onSaved) onSaved();
  }

  // Внизу две кнопки: «Сохранить» и, у существующей записи, «Удалить
  // запись». «Отмены» нет — лист закрывают крестик в шапке и свайп вниз;
  // «Открыть задачу» — строка задачи под заголовком. У страницы
  // подтверждения подвал свой.
  useEffect(() => {
    if (page !== 'main') return undefined;
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!valid} />
        {existing ? <PrimaryButton title={t(lang, 'session.delete_title')} variant="danger" onPress={() => setPage('confirm')} /> : null}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, date, start, end, valid, lang]);

  if (page === 'confirm') {
    return (
      <SheetPage key="confirm" motion={motion}>
        <ActionSheetContent
          embedded
          message={t(lang, 'session.delete_title')}
          onCancel={() => setPage('main')}
          actions={[
            { label: t(lang, 'common.delete'), destructive: true, onPress: () => deleteSession(task.id, index) },
            { label: t(lang, 'common.cancel'), cancel: true },
          ]}
        />
      </SheetPage>
    );
  }

  const dateLabel = capFirst(keyToDate(date).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }));
  const taskTitle = task.title || t(lang, 'task.no_name');
  const openTask = onOpenTask ? () => { closeSheet(); onOpenTask(task.id); } : null;

  return (
    <SheetPage key="main" motion={motion} style={styles.content}>
      {/* Строка задачи: точка цвета проекта, название, справа проект; шеврон
          и нажатие — открыть задачу (если лист открыт не с её страницы). */}
      <RowGroup>
        <SettingRow
          lead={project ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
          label={taskTitle}
          value={project ? project.name : null}
          onPress={openTask || undefined}
          accessibilityLabel={openTask ? `${t(lang, 'agenda.open_task')}: ${taskTitle}` : undefined}
          testID="session-task"
        />
      </RowGroup>

      <RowGroup testID="session-rows">
        <ExpandRow icon="calendar" label={t(lang, 'sdlg.date_label')} value={dateLabel} open={open === 'date'} onToggle={() => toggle('date')} testID="session-date">
          <MiniDatePicker lang={lang} valueKey={date} onPick={(key) => { setDate(key); setOpen(null); }} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.start_label')} value={start} open={open === 'start'} onToggle={() => toggle('start')} testID="session-start">
          <TimeColumns value={start} onChange={setStart} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.end_label')} value={end} open={open === 'end'} onToggle={() => toggle('end')} testID="session-end">
          <TimeColumns value={end} onChange={setEnd} />
        </ExpandRow>
      </RowGroup>

      <InfoRow
        icon="stopwatch"
        danger={!valid}
        text={span ? t(lang, 'sdlg.duration', { time: fmtClock(span.ms) }) : t(lang, 'sdlg.check_datetime')}
        testID="session-duration"
      />
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 3 },
});

// Запись времени вручную: дата, начало, конец — одним листом, как окно
// «Добавить запись» на десктопе. Конец раньше начала — через полночь
// (lib/sessions.js, spanFromParts). Короче минуты не сохраняется, и об этом
// говорит подпись длительности.
import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import { TimeRange } from './TimeField';
import { useAppStore } from '../store/useAppStore';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { fmtClock } from '../lib/format';
import { spanFromParts, hm, MIN_SESSION_MS } from '../lib/sessions';
import { confirmSheet } from '../lib/dialogs';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

/** @param task — чья запись; @param index — правим запись по индексу,
 *  null — новая. @param initial — { start, end } (Date или мс) для новой. */
export default function SessionSheet({ task, index = null, initial, onSaved, onOpenTask }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const saveSession = useAppStore((s) => s.saveSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const showToast = useAppStore((s) => s.showToast);

  const existing = index != null ? (task.sessions || [])[index] : null;
  const startAt = existing ? new Date(existing.start)
    : initial && initial.start ? new Date(initial.start) : new Date(Date.now() - 3_600_000);
  const endAt = existing ? (existing.end ? new Date(existing.end) : new Date())
    : initial && initial.end ? new Date(initial.end) : new Date();

  const [date, setDate] = useState(dayKey(startAt));
  const [start, setStart] = useState(hm(startAt));
  const [end, setEnd] = useState(hm(endAt));
  const [pickingDate, setPickingDate] = useState(false);

  const span = spanFromParts(date, start, end);
  const valid = !!span && span.ms >= MIN_SESSION_MS;

  function save() {
    if (!valid) { showToast(t(lang, 'toast.invalid_interval')); return; }
    saveSession(task.id, index, { start: span.start.getTime(), end: span.end.getTime(), ms: span.ms });
    closeSheet();
    if (onSaved) onSaved();
  }

  function remove() {
    confirmSheet({
      title: t(lang, 'confirm.are_you_sure'),
      message: t(lang, 'session.delete_title'),
      actions: [
        { label: t(lang, 'common.delete'), destructive: true, onPress: () => deleteSession(task.id, index) },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!valid} />
        {existing ? <PrimaryButton title={t(lang, 'session.delete_title')} variant="danger" onPress={remove} /> : null}
        {onOpenTask ? <PrimaryButton title={t(lang, 'agenda.open_task')} variant="ghost" onPress={() => { closeSheet(); onOpenTask(task.id); }} /> : null}
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={closeSheet} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [date, start, end, valid, lang, onOpenTask]);

  const dateLabel = keyToDate(date).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t(lang, existing ? 'sdlg.edit_title' : 'sdlg.add_title')}</Text>
      {task.title ? <Text style={styles.task} numberOfLines={1}>{task.title}</Text> : null}

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
  title: { color: colors.text, ...typography.title },
  task: { color: colors.textDim, fontSize: fontSize.sm, marginTop: -spacing.sm },
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

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import { TimeWheels } from './WheelPicker';
import { RowGroup, ExpandRow } from './Island';
import { InfoRow } from './RepeatControls';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { capFirst } from '../lib/format';
import { setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const pad2 = (n) => String(n).padStart(2, '0');

// Дедлайн: дата и время, применяется одной кнопкой. Напоминаний здесь нет
// (с 11 октября 2026): они списком в свойствах задачи, ReminderSheet, а «до
// дедлайна» едут за ним сами.
//
// С 12 октября 2026 — две строки острова, как во всех листах с датой:
// «Дата · 18 сент. ›» раскрывает календарь под собой, «Время · 21:00 ›» —
// два барабана (TimeWheels в components/WheelPicker.js), как у таймера iOS и Samsung:
// часы и все минуты подряд, по кругу. Открыта одна строка; сегментов
// «Дата / Время» больше нет. Под строками — сводка InfoRow, внизу
// «Сохранить» и серая «Убрать дедлайн».
export default function DueSheet({ task, lang, onApply, onClear }) {
  useSheetHeader(t(lang, 'due.label'));

  const initial = task.dueAt ? new Date(task.dueAt) : (() => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return d;
  })();
  const [dateKey, setDateKey] = useState(dayKey(initial));
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());
  // Раскрытая строка: новый дедлайн начинают с даты, у заданного всё закрыто.
  const [open, setOpen] = useState(task.dueAt ? null : 'date');
  const toggle = (which) => setOpen((o) => (o === which ? null : which));

  function apply() {
    const d = keyToDate(dateKey);
    d.setHours(hour, minute, 0, 0);
    onApply({ dueAt: d.toISOString() });
  }

  useEffect(() => {
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={apply} />
        {task.dueAt ? <PrimaryButton title={t(lang, 'due.clear')} variant="ghost" onPress={onClear} /> : null}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [dateKey, hour, minute, lang]);

  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const date = keyToDate(dateKey);
  const time = `${pad2(hour)}:${pad2(minute)}`;

  return (
    <View style={{ gap: spacing.md }}>
      <RowGroup testID="due-rows">
        <ExpandRow
          icon="calendar"
          label={t(lang, 'due.date')}
          value={date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
          open={open === 'date'}
          onToggle={() => toggle('date')}
          testID="due-date"
        >
          <MiniDatePicker lang={lang} valueKey={dateKey} onPick={(key) => { setDateKey(key); setOpen(null); }} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'due.time')} value={time} open={open === 'time'} onToggle={() => toggle('time')} testID="due-time">
          <TimeWheels hour={hour} minute={minute} onHour={setHour} onMinute={setMinute} accessibilityLabel={t(lang, 'due.time')} />
        </ExpandRow>
      </RowGroup>

      <InfoRow
        icon="calendar"
        text={`${capFirst(date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${time}`}
        testID="due-summary"
      />
    </View>
  );
}

// Рабочие часы (Меню → Работа, 18 октября 2026) — когда агент ищет свободное
// время: начало, конец и дни недели. Задачам они ничего не запрещают: отрезок
// ставится на любой час любого дня (SlotSheet). Хранятся в settings.workHours
// { start: 'ЧЧ:ММ', end: 'ЧЧ:ММ', days: [0…6] } — настройка устройства, в
// облако не уходит; читает их ядро (Core.aiWorkHours: свои или умолчание
// агента, Пн–Пт 09:00–18:00).
//
// Собран из общих кирпичей: строки «Начало · 09:00 ›» и «Конец · 18:00 ›»
// раскрывают под собой барабаны (TimeWheels, как время дедлайна), открыта
// одна; дни — квадраты WeekdayChips, как в листе повторения. Конец не позже
// начала или ни одного дня — красная подсказка Hint, «Сохранить» неактивна.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import PrimaryButton from './PrimaryButton';
import { TimeWheels } from './WheelPicker';
import { RowGroup, ExpandRow } from './Island';
import { Block, Hint, WeekdayChips } from './RepeatControls';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t } from '../lib/i18n';

const pad2 = (n) => String(n).padStart(2, '0');
const parse = (hmText) => hmText.split(':').map(Number);
const join = (h, m) => `${pad2(h)}:${pad2(m)}`;
const toMin = (hmText) => { const [h, m] = parse(hmText); return h * 60 + m; };

/** @param value { start, end, days } — нынешние часы (Core.aiWorkHours);
 *  @param onSave(value) — те же поля, дни по возрастанию. */
export default function WorkHoursSheet({ lang, value, onSave }) {
  useSheetHeader(t(lang, 'settings.work_hours'));
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  const [days, setDays] = useState(value.days);
  // Раскрытая строка: 'start' или 'end'; открыта одна.
  const [open, setOpen] = useState(null);
  const toggle = (which) => setOpen((o) => (o === which ? null : which));
  const toggleDay = (d) => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]));

  const badTime = toMin(end) <= toMin(start);
  const noDays = days.length === 0;
  const valid = !badTime && !noDays;

  function save() {
    if (!valid) return;
    onSave({ start, end, days: [...days].sort((a, b) => a - b) });
    closeSheet();
  }

  useEffect(() => {
    const footer = <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!valid} />;
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [start, end, days, valid, lang]);

  const wheels = (text, onChange, label) => {
    const [h, m] = parse(text);
    return <TimeWheels hour={h} minute={m} onHour={(x) => onChange(join(x, m))} onMinute={(x) => onChange(join(h, x))} accessibilityLabel={label} />;
  };

  return (
    <View style={{ gap: spacing.md }}>
      <RowGroup testID="work-hours-rows">
        <ExpandRow icon="clock" label={t(lang, 'sdlg.start_label')} value={start} open={open === 'start'} onToggle={() => toggle('start')} testID="work-hours-start">
          {wheels(start, setStart, t(lang, 'sdlg.start_label'))}
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.end_label')} value={end} open={open === 'end'} onToggle={() => toggle('end')} testID="work-hours-end">
          {wheels(end, setEnd, t(lang, 'sdlg.end_label'))}
        </ExpandRow>
      </RowGroup>
      {badTime ? <Hint danger testID="work-hours-error">{t(lang, 'slot.end_before_start')}</Hint> : null}
      <Block label={t(lang, 'settings.work_days')}>
        <WeekdayChips lang={lang} value={days} onToggle={toggleDay} testID="work-hours-days" />
      </Block>
      {noDays ? <Hint danger testID="work-hours-days-error">{t(lang, 'settings.work_days_min')}</Hint> : null}
    </View>
  );
}

// Напоминание задачи: одно из списка «Напоминания» (core/reminders.js).
// Напоминания стакаются списком, как в Google Календаре; этот лист правит
// одно. Вид — строки с галочкой (12 октября 2026; были сегменты «До… · Один
// раз · Повторять» и под ними ещё сегменты якоря — «табы на табах»):
//   • «До начала» — за N минут, часов или дней до начала времени работы
//     (перед КАЖДЫМ вхождением каждого отрезка);
//   • «До дедлайна» — так же, до дедлайна. Видны только те якоря, что есть у
//     задачи; нет ни времени работы, ни дедлайна — вместо них тихая строка
//     «Добавьте время работы или дедлайн», она не нажимается;
//   • «Один раз» — своя дата и время, независимо ни от чего;
//   • «Повторять» — каждый день, неделю (дни) или месяц (число) и время.
// Параметры выбранного вида раскрываются под списком. N — чипами пресетов (в
// момент, 5 мин, 15 мин, 1 ч, 1 день) или своим числом в поле с единицей
// чипами «мин · ч · дн». Дата и время — строки острова, выбор раскрывается
// под строкой (ExpandRow). У существующего внизу «Удалить».
//
// Собран из общих кирпичей (ChoiceList, Chip, Field, RowGroup, ExpandRow,
// Block, Hint, WeekdayChips, MonthDayChips, PrimaryButton), своего вида у
// листа нет.
//
// Лист ничего не пересказывает: смещение считают toOffsetMin и splitOffset,
// список правит withReminders через действия стора, начало отсчёта «повторять»
// — lib/reminderRepeat.js.
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import Chip from './Chip';
import ChoiceList from './ChoiceList';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import TimeColumns from './TimeField';
import { RowGroup, ExpandRow } from './Island';
import { Block, Hint, WeekdayChips, MonthDayChips } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import Reminders from '../core/reminders.js';
import Repeat from '../core/repeat.js';
import Slots from '../core/slots.js';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { hm } from '../lib/sessions';
import { capFirst } from '../lib/format';
import { offsetText, UNIT_KEY } from '../lib/reminderText';
import { repeatStart } from '../lib/reminderRepeat';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const UNITS = ['min', 'hour', 'day'];
const FREQS = ['day', 'week', 'month'];
// «Каждый день / Каждую неделю / Каждый месяц» — те же слова, что у пресетов
// повтора задачи.
const FREQ_KEY = { day: 'repeat.daily', week: 'repeat.weekly', month: 'repeat.monthly' };
const MAX_DAYS = Reminders.REMIND_MAX_OFFSET_MIN / Reminders.REMIND_UNITS.day;

/** Момент: день ('ГГГГ-ММ-ДД') и время ('ЧЧ:ММ') → ISO. */
const isoOf = (dateKeyText, hmText) => {
  const d = keyToDate(dateKeyText);
  const [h, m] = hmText.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const sameDays = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** @param taskId — чьё напоминание; @param reminderId — правим, null — новое. */
export default function ReminderSheet({ taskId, reminderId = null }) {
  const lang = useAppStore((s) => s.settings.lang);
  const task = useAppStore((s) => s.tasks.find((x) => x.id === taskId)) || null;
  const addTaskReminder = useAppStore((s) => s.addTaskReminder);
  const updateTaskReminder = useAppStore((s) => s.updateTaskReminder);
  const removeTaskReminder = useAppStore((s) => s.removeTaskReminder);

  const existing = reminderId && task ? Reminders.remindersOf(task).find((r) => r.id === reminderId) || null : null;
  const d0 = existing ? Reminders.describeReminder(existing) : null;
  const was = (kind) => (d0 && d0.kind === kind ? d0 : null);

  // Якоря: у «до начала» — время работы, у «до дедлайна» — дедлайн. Якорь
  // самого напоминания виден всегда, даже если у задачи его уже нет (дедлайн
  // сняли): иначе открытое напоминание нельзя было бы прочитать.
  const own = existing && existing.kind === 'before' ? existing.anchor : null;
  const hasStart = !!task && Slots.slotsOf(task).length > 0;
  const hasDue = !!task && !!task.dueAt;
  const anchors = [hasStart || own === 'start' ? 'start' : null, hasDue || own === 'due' ? 'due' : null].filter(Boolean);
  const canBefore = anchors.length > 0;

  const [kind, setKind] = useState(existing ? existing.kind : (canBefore ? 'before' : 'at'));
  // До…
  const [anchor, setAnchor] = useState(own || (hasStart ? 'start' : 'due'));
  const [nText, setNText] = useState(was('before') ? String(was('before').n) : '15');
  const [unit, setUnit] = useState(was('before') ? was('before').unit : 'min');
  // Один раз: ближайший целый час — «на сейчас» ничего не напомнит.
  const [atDay, setAtDay] = useState(() => {
    if (was('at')) return dayKey(new Date(was('at').at));
    const x = new Date();
    x.setHours(x.getHours() + 1, 0, 0, 0);
    return dayKey(x);
  });
  const [atTime, setAtTime] = useState(() => {
    if (was('at')) return hm(was('at').at);
    const x = new Date();
    x.setHours(x.getHours() + 1, 0, 0, 0);
    return hm(x);
  });
  // Повторять
  const rep = was('repeat');
  const [freq, setFreq] = useState(rep && FREQS.includes(rep.freq) ? rep.freq : 'day');
  const [weekdays, setWeekdays] = useState(rep && rep.weekdays.length ? rep.weekdays : [new Date(existing && rep ? existing.start : Date.now()).getDay()]);
  const [monthDay, setMonthDay] = useState(rep && rep.monthDay ? rep.monthDay : new Date().getDate());
  const [repTime, setRepTime] = useState(rep ? rep.time : '09:00');
  // Раскрытая строка: 'date' или 'time' — выбор под ней; открыта одна.
  const [open, setOpen] = useState(null);
  const toggle = (which) => setOpen((o) => (o === which ? null : which));

  useSheetHeader(t(lang, 'notif.reminder'));

  // Смещение: поле числа и единица — один источник и для чипов, и для своего.
  const typed = nText.trim() === '' ? NaN : Number(nText);
  const offsetMin = Reminders.toOffsetMin(nText, unit);
  const tooFar = Number.isFinite(typed) && typed * Reminders.REMIND_UNITS[unit] > Reminders.REMIND_MAX_OFFSET_MIN;
  const offsetOk = offsetMin !== null && !tooFar;
  const valid = kind === 'before' ? canBefore && offsetOk : kind === 'repeat' ? freq !== 'week' || weekdays.length > 0 : true;

  /** Напоминание в виде, который принимает стор. */
  function spec() {
    if (kind === 'before') return { kind: 'before', anchor, offsetMin, unit };
    if (kind === 'at') return { kind: 'at', at: isoOf(atDay, atTime) };
    const rule = Repeat.normalizeRepeat({ freq, every: 1, weekdays: freq === 'week' ? weekdays : [] });
    // Расписание не менялось — отсчёт остаётся прежним, и отметка «уже
    // напомнили» тоже (withReminders сверяет время срабатывания).
    const same = rep && rep.freq === freq && rep.time === repTime
      && (freq !== 'week' || sameDays(rep.weekdays, weekdays))
      && (freq !== 'month' || rep.monthDay === monthDay);
    return { kind: 'repeat', rule, time: repTime, start: same ? existing.start : repeatStart(freq, monthDay, repTime) };
  }

  function save() {
    if (!valid) return;
    if (existing) updateTaskReminder(taskId, existing.id, spec());
    else addTaskReminder(taskId, spec());
    closeSheet();
  }

  function remove() {
    removeTaskReminder(taskId, existing.id);
    closeSheet();
  }

  useEffect(() => {
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!valid} />
        {existing ? <PrimaryButton title={t(lang, 'remind.delete')} variant="danger" onPress={remove} /> : null}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [kind, anchor, nText, unit, atDay, atTime, freq, weekdays, monthDay, repTime, valid, lang]);

  const toggleDay = (day) => {
    const has = weekdays.includes(day);
    // Последний день не снимается: неделя без дней — правило без смысла.
    if (has && weekdays.length === 1) return;
    setWeekdays(has ? weekdays.filter((x) => x !== day) : [...weekdays, day]);
  };

  const pickPreset = (min) => {
    const sp = Reminders.splitOffset(min);
    setNText(String(sp.n));
    setUnit(sp.unit);
  };

  // Вид и якорь — один выбор: «До начала» и «До дедлайна» — разные строки.
  const choice = kind === 'before' ? `before:${anchor}` : kind;
  const pickKind = (v) => {
    setOpen(null);
    if (v.startsWith('before:')) { setKind('before'); setAnchor(v.slice(7)); return; }
    setKind(v);
  };
  const kinds = [
    ...anchors.map((a) => ({
      value: `before:${a}`,
      label: t(lang, a === 'start' ? 'remind.anchor_start' : 'remind.anchor_due'),
      testID: `remind-kind-${a}`,
    })),
    canBefore ? null : { value: 'need', label: t(lang, 'remind.need_anchor'), disabled: true, testID: 'remind-need-anchor' },
    { value: 'at', label: t(lang, 'remind.kind_at'), testID: 'remind-kind-at' },
    { value: 'repeat', label: t(lang, 'remind.kind_repeat'), testID: 'remind-kind-repeat' },
  ].filter(Boolean);

  const dateLabel = capFirst(keyToDate(atDay).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }));
  const timeRow = (value, onChange) => (
    <ExpandRow icon="clock" label={t(lang, 'due.time')} value={value} open={open === 'time'} onToggle={() => toggle('time')} testID="remind-time">
      <TimeColumns value={value} onChange={onChange} />
    </ExpandRow>
  );

  return (
    <View style={styles.content} testID="reminder-sheet">
      <ChoiceList testID="remind-kind" options={kinds} value={choice} onSelect={pickKind} />

      {kind === 'before' ? (
        <Block label={t(lang, 'remind.how_long')}>
          <View style={styles.chips}>
            {Reminders.REMIND_PRESETS.map((min) => {
              const sp = Reminders.splitOffset(min);
              const label = min === 0 ? t(lang, anchor === 'start' ? 'remind.at_start' : 'remind.at') : offsetText(lang, sp.n, sp.unit);
              return <Chip key={min} label={label} on={offsetOk && offsetMin === min} onPress={() => pickPreset(min)} testID={`remind-preset-${min}`} />;
            })}
          </View>
          {/* Своё число и единица — одной строкой: «[ 90 ] мин · ч · дн». */}
          <View style={styles.own}>
            <Field
              style={styles.ownField}
              value={nText}
              onChangeText={(v) => setNText(v.replace(/[^0-9]/g, '').slice(0, 5))}
              keyboardType="number-pad"
              maxLength={5}
              invalid={tooFar}
              accessibilityLabel={t(lang, 'remind.how_long')}
              testID="remind-n"
            />
            <View style={styles.chips} testID="remind-unit">
              {UNITS.map((u) => <Chip key={u} label={t(lang, UNIT_KEY[u])} on={unit === u} onPress={() => setUnit(u)} testID={`remind-unit-${u}`} />)}
            </View>
          </View>
          {tooFar ? <Hint danger testID="remind-error">{t(lang, 'remind.too_far', { n: MAX_DAYS })}</Hint> : null}
        </Block>
      ) : null}

      {kind === 'at' ? (
        <RowGroup testID="remind-at">
          <ExpandRow icon="calendar" label={t(lang, 'sdlg.date_label')} value={dateLabel} open={open === 'date'} onToggle={() => toggle('date')} testID="remind-date">
            <MiniDatePicker lang={lang} valueKey={atDay} onPick={(key) => { setAtDay(key); setOpen(null); }} />
          </ExpandRow>
          {timeRow(atTime, setAtTime)}
        </RowGroup>
      ) : null}

      {kind === 'repeat' ? (
        <>
          <Block label={t(lang, 'remind.how_often')}>
            <ChoiceList
              testID="remind-freq"
              options={FREQS.map((f) => ({ value: f, label: t(lang, FREQ_KEY[f]), testID: `remind-freq-${f}` }))}
              value={freq}
              onSelect={setFreq}
            />
          </Block>
          {freq === 'week' ? (
            <Block label={t(lang, 'repeat.on_days')}>
              <WeekdayChips lang={lang} value={weekdays} onToggle={toggleDay} />
            </Block>
          ) : null}
          {freq === 'month' ? (
            <Block label={t(lang, 'repeat.month_mode_day')}>
              <MonthDayChips value={monthDay} onPick={setMonthDay} />
            </Block>
          ) : null}
          <RowGroup testID="remind-repeat-time">{timeRow(repTime, setRepTime)}</RowGroup>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  // Чипы — как в «Сведениях» задачи: переносимым рядом.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  own: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownField: { flex: 1 },
});

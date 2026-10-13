// Время работы: один отрезок задачи — когда этим заниматься. Дата, начало и
// конец строками острова (выбор раскрывается под строкой); у существующего
// отрезка внизу ещё «Удалить время». Дедлайн — срок закрытия, это другое:
// задача может иметь несколько отрезков (core/slots.js). Напоминаний у
// отрезка нет: «до начала» — общий список задачи (ReminderSheet), он
// срабатывает перед каждым вхождением каждого отрезка.
//
// Своего повтора у отрезка нет (12 октября 2026, как у события в Google
// Календаре): правило одно — у задачи (task.repeat), и каждый отрезок
// повторяется вместе с ней. Под строками — сводка «Повторяется каждую неделю
// вместе с задачей» или «Один раз», ниже строка «Повторение задачи ›»: тот
// же RepeatSheet, что у задачи, страницей внутри этого же листа со стрелкой
// «назад» — правка пишет правило задачи сразу. Нужны разные интервалы с
// разным повтором — это отдельная задача.
//
// Конец не позже начала — ошибка, а не «через полночь», как у записи времени:
// отрезок живёт в пределах суток (normalizeSlot). Еженедельное правило с днями
// считает первым вхождением только подходящий день, поэтому дата при
// сохранении двигается к ближайшему из них (lib/slotText.js, fitSlotDay).
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import TimeColumns from './TimeField';
import RepeatSheet from './RepeatSheet';
import SheetPage, { usePageMotion } from './SheetPage';
import { RowGroup, SettingRow, ExpandRow } from './Island';
import { Hint } from './RepeatControls';
import { useAppStore } from '../store/useAppStore';
import Slots from '../core/slots.js';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { hm, pad2 } from '../lib/sessions';
import { ruleText, fitSlotDay } from '../lib/slotText';
import { capFirst } from '../lib/format';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const toMin = (hmText) => {
  const [h, m] = hmText.split(':').map(Number);
  return h * 60 + m;
};

/** Момент: день ('ГГГГ-ММ-ДД') и время ('ЧЧ:ММ') → ISO. */
const isoOf = (dateKey, hmText) => {
  const d = keyToDate(dateKey);
  const [h, m] = hmText.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** @param taskId — чей отрезок; @param slotId — правим отрезок, null — новый.
 *  @param onBack — лист открыт страницей списка отрезков (SlotListSheet):
 *    стрелка «назад» в шапке и «Сохранить» / «Удалить время» возвращают к
 *    списку, а не закрывают лист. */
export default function SlotSheet({ taskId, slotId = null, onBack }) {
  const lang = useAppStore((s) => s.settings.lang);
  const task = useAppStore((s) => s.tasks.find((x) => x.id === taskId)) || null;
  const addTaskSlot = useAppStore((s) => s.addTaskSlot);
  const updateTaskSlot = useAppStore((s) => s.updateTaskSlot);
  const removeTaskSlot = useAppStore((s) => s.removeTaskSlot);
  const setTaskRepeat = useAppStore((s) => s.setTaskRepeat);

  const existing = slotId && task ? Slots.slotsOf(task).find((s) => s.id === slotId) || null : null;
  const initial = (() => {
    if (existing) return { day: dayKey(new Date(existing.start)), start: hm(existing.start), end: hm(existing.end) };
    // Новый отрезок — на ближайший целый час, час длиной; ночью — на утро.
    const h = new Date().getHours() + 1;
    const from = h <= 22 ? h : 10;
    return { day: dayKey(new Date()), start: `${pad2(from)}:00`, end: `${pad2(from + 1)}:00` };
  })();

  const [date, setDate] = useState(initial.day);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  // Раскрытая строка: 'date', 'start' или 'end'; открыта одна.
  const [open, setOpen] = useState(null);
  const toggle = (which) => setOpen((o) => (o === which ? null : which));
  // Страница внутри листа: 'main' — форма, 'repeat' — повторение задачи.
  const [page, setPage] = useState('main');
  const motion = usePageMotion(page === 'repeat' ? 1 : 0);

  // Правило, по которому отрезки повторяются сейчас (серия не кончилась), —
  // для сводки и подгонки даты; на странице правится само правило задачи.
  const rule = task ? Slots.slotRule(task) : null;
  const valid = toMin(end) > toMin(start);

  useSheetHeader(
    t(lang, page === 'repeat' ? 'repeat.dialog_title' : 'slot.label'),
    page === 'repeat' ? () => setPage('main') : onBack || null,
  );
  const finish = () => (onBack ? onBack() : closeSheet());

  function save() {
    if (!valid) return;
    // Своего повтора у отрезка нет: только дата и часы.
    const day = fitSlotDay(date, rule);
    const raw = { start: isoOf(day, start), end: isoOf(day, end) };
    if (existing) updateTaskSlot(taskId, existing.id, raw);
    else addTaskSlot(taskId, raw);
    finish();
  }

  function remove() {
    removeTaskSlot(taskId, existing.id);
    finish();
  }

  // Низ листа — у формы; у страницы повтора он свой (его ставит RepeatSheet,
  // а наш — только на форме: иначе родительский эффект затирал бы дочерний).
  useEffect(() => {
    if (page !== 'main') return undefined;
    const footer = (
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!valid} />
        {existing ? <PrimaryButton title={t(lang, 'slot.delete')} variant="danger" onPress={remove} /> : null}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, date, start, end, rule, valid, lang]);

  if (page === 'repeat') {
    return (
      <SheetPage key="repeat" motion={motion}>
        <RepeatSheet
          embedded
          lang={lang}
          anchorAt={task ? Slots.rollAnchor(task) : null}
          rule={task ? task.repeat : null}
          onApply={(r) => setTaskRepeat(taskId, r)}
          onClear={() => setTaskRepeat(taskId, null)}
          onDone={() => setPage('main')}
        />
      </SheetPage>
    );
  }

  const dateLabel = capFirst(keyToDate(date).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }));
  const ruleWords = rule ? ruleText(rule, lang) : '';

  return (
    <SheetPage key="main" motion={motion} style={styles.content}>
      <RowGroup testID="slot-rows">
        <ExpandRow icon="calendar" label={t(lang, 'sdlg.date_label')} value={dateLabel} open={open === 'date'} onToggle={() => toggle('date')} testID="slot-date">
          <MiniDatePicker lang={lang} valueKey={date} onPick={(key) => { setDate(key); setOpen(null); }} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.start_label')} value={start} open={open === 'start'} onToggle={() => toggle('start')} testID="slot-start">
          <TimeColumns value={start} onChange={setStart} />
        </ExpandRow>
        <ExpandRow icon="clock" label={t(lang, 'sdlg.end_label')} value={end} open={open === 'end'} onToggle={() => toggle('end')} testID="slot-end">
          <TimeColumns value={end} onChange={setEnd} />
        </ExpandRow>
      </RowGroup>
      {valid ? null : <Hint danger testID="slot-error">{t(lang, 'slot.end_before_start')}</Hint>}

      {/* Повтор — задачи, а не отрезка: одна строка к правилу, значение —
          словами, что отрезок едет вместе с задачей. Две строки с одной
          иконкой («Один раз» + «Повторение задачи») читались как дубль. */}
      <RowGroup testID="slot-repeat-group">
        <SettingRow
          icon="refresh"
          label={t(lang, 'repeat.dialog_title')}
          value={rule ? t(lang, 'slot.repeat_with_task', { rule: ruleWords.charAt(0).toLowerCase() + ruleWords.slice(1) }) : t(lang, 'repeat.none')}
          onPress={() => { setOpen(null); setPage('repeat'); }}
          testID="slot-task-repeat"
          valueTestID="slot-task-repeat-value"
        />
      </RowGroup>
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
});

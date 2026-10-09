import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import Icon from './Icon';
import WheelPicker from './WheelPicker';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { REMIND_PRESETS, REMIND_LABEL, remindKey } from '../lib/due';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

// Дедлайн и напоминание одним листом: дата, время и выбор напоминания. На
// десктопе это три отдельных поповера в строке задачи, но на телефоне
// открывать лист трижды подряд было бы утомительно, поэтому всё здесь, а
// применяется одной кнопкой.
//
// Время — два барабана (components/WheelPicker.js), как у таймера iOS и
// Samsung: часы и все минуты подряд, по кругу.
export default function DueSheet({ task, lang, onApply, onClear }) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const initial = task.dueAt ? new Date(task.dueAt) : (() => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return d;
  })();
  const [dateKey, setDateKey] = useState(dayKey(initial));
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());
  const [remind, setRemind] = useState(remindKey(task));
  const [tab, setTab] = useState('date');

  function apply() {
    const d = keyToDate(dateKey);
    d.setHours(hour, minute, 0, 0);
    const patch = { dueAt: d.toISOString() };
    if (remind === 'custom') {
      patch.remindOffsetMin = null;
      patch.remindAt = task.remindAt || new Date(d.getTime() - 3600000).toISOString();
    } else if (remind === 'null') {
      patch.remindOffsetMin = null;
      patch.remindAt = null;
    } else {
      patch.remindOffsetMin = Number(remind);
      patch.remindAt = null;
    }
    onApply(patch);
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'common.save')} onPress={apply} />
        {task.dueAt ? <PrimaryButton title={t(lang, 'due.clear')} variant="ghost" onPress={onClear} /> : null}
      </>,
    );
    return () => setSheetFooter(null);
  }, [dateKey, hour, minute, remind, lang]);

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t(lang, 'due.label')}</Text>

      <View style={styles.tabRow}>
        {['date', 'time', 'remind'].map((key) => (
          <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {t(lang, key === 'date' ? 'due.date' : key === 'time' ? 'due.time' : 'due.remind_at')}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summary}>
        <Icon name="clock" size={14} color={colors.textDim} />
        <Text style={styles.summaryText}>
          {`${keyToDate(dateKey).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { day: 'numeric', month: 'short' })}, ${pad2(hour)}:${pad2(minute)}`}
        </Text>
        <Text style={styles.summaryRemind}>{t(lang, REMIND_LABEL[remind])}</Text>
      </View>

      {tab === 'date' ? (
        <MiniDatePicker lang={lang} valueKey={dateKey} onPick={setDateKey} />
      ) : null}

      {tab === 'time' ? (
        <View style={styles.timeRow}>
          <WheelPicker values={HOURS} value={hour} onChange={setHour} format={pad2} accessibilityLabel={t(lang, 'due.time')} />
          <Text style={styles.timeColon}>:</Text>
          <WheelPicker values={MINUTES} value={minute} onChange={setMinute} format={pad2} accessibilityLabel={t(lang, 'due.time')} />
        </View>
      ) : null}

      {tab === 'remind' ? (
        <View style={{ gap: spacing.sm }}>
          {REMIND_PRESETS.map((preset) => {
            const key = String(preset);
            const active = key === remind;
            return (
              <Pressable key={key} onPress={() => setRemind(key)} style={[styles.option, active && styles.optionActive]}>
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{t(lang, REMIND_LABEL[key])}</Text>
                {active ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  tabRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  tabTextActive: { color: colors.text },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  summaryText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  summaryRemind: { flex: 1, textAlign: 'right', color: colors.textDim, fontSize: fontSize.xs },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  timeColon: { color: colors.text, fontSize: 24, fontWeight: '700' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  optionActive: { backgroundColor: colors.accentMuted },
  optionText: { color: colors.text, fontSize: fontSize.md },
  optionTextActive: { color: colors.text, fontWeight: '700' },
});

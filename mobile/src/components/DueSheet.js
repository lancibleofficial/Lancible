import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import Icon from './Icon';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { REMIND_PRESETS, REMIND_LABEL, remindKey } from '../lib/due';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// Дедлайн и напоминание одним листом: дата, время и выбор напоминания. На
// десктопе это три отдельных поповера в строке задачи, но на телефоне
// открывать лист трижды подряд было бы утомительно, поэтому всё здесь, а
// применяется одной кнопкой.
//
// Своего time-picker'а в проекте не было (на десктопе он есть, здесь не
// пригождался), поэтому часы и минуты — два скроллящихся столбца, как в
// tp-pop десктопа. Минуты с шагом 5: точнее для дедлайна не нужно.
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
  const [minute, setMinute] = useState(Math.round(initial.getMinutes() / 5) * 5 % 60);
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
          <ScrollView style={styles.timeCol} contentContainerStyle={styles.timeColInner} showsVerticalScrollIndicator={false}>
            {HOURS.map((h) => (
              <Pressable key={h} onPress={() => setHour(h)} style={[styles.timeCell, h === hour && styles.timeCellOn]}>
                <Text style={[styles.timeText, h === hour && styles.timeTextOn]}>{pad2(h)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={styles.timeCol} contentContainerStyle={styles.timeColInner} showsVerticalScrollIndicator={false}>
            {MINUTES.map((m) => (
              <Pressable key={m} onPress={() => setMinute(m)} style={[styles.timeCell, m === minute && styles.timeCellOn]}>
                <Text style={[styles.timeText, m === minute && styles.timeTextOn]}>{pad2(m)}</Text>
              </Pressable>
            ))}
          </ScrollView>
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
                {active ? <Icon name="check" size={14} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
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
  timeRow: { flexDirection: 'row', gap: spacing.sm, height: 190 },
  timeCol: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md },
  timeColInner: { padding: 4, gap: 2 },
  timeCell: { paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  timeCellOn: { backgroundColor: colors.accent },
  timeText: { color: colors.text, fontSize: fontSize.md, fontVariant: ['tabular-nums'] },
  timeTextOn: { color: colors.accentText, fontWeight: '700' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  optionActive: { backgroundColor: colors.accentMuted },
  optionText: { color: colors.text, fontSize: fontSize.md },
  optionTextActive: { color: colors.text, fontWeight: '700' },
});

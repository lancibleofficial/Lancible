import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import { dayKey, keyToDate, mondayOf } from '../lib/calendarMath';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

const PRESETS = [
  { value: 'all', key: 'export.period_all' },
  { value: 'month', key: 'export.period_month' },
  { value: 'week', key: 'export.period_week' },
  { value: 'day', key: 'export.period_day' },
  { value: 'custom', key: 'export.period_custom' },
];

function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

export default function ExportPeriodSheet({ lang, onConfirm, onCancel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [preset, setPreset] = useState('all');
  const now = new Date();
  const [fromKey, setFromKey] = useState(dayKey(now));
  const [toKey, setToKey] = useState(dayKey(now));
  const [editing, setEditing] = useState(null);

  function confirm() {
    let range = null;
    if (preset === 'month') {
      range = { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    } else if (preset === 'week') {
      const ws = mondayOf(now);
      range = { from: ws, to: endOfDay(new Date(ws.getTime() + 6 * 86400000)) };
    } else if (preset === 'day') {
      range = { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: endOfDay(now) };
    } else if (preset === 'custom') {
      let a = keyToDate(fromKey);
      let b = keyToDate(toKey);
      if (a > b) [a, b] = [b, a];
      range = { from: a, to: endOfDay(b) };
    }
    onConfirm(range);
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'export.title')} onPress={confirm} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [preset, fromKey, toKey, lang]);

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t(lang, 'export.title')}</Text>
      <Text style={styles.label}>{t(lang, 'export.period')}</Text>
      <View style={styles.pillRow}>
        {PRESETS.map((p) => (
          <Pressable key={p.value} onPress={() => setPreset(p.value)} style={[styles.pill, preset === p.value && styles.pillActive]}>
            <Text style={[styles.pillText, preset === p.value && styles.pillTextActive]}>{t(lang, p.key)}</Text>
          </Pressable>
        ))}
      </View>

      {preset === 'custom' ? (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.rangeRow}>
            <Pressable style={styles.rangeBtn} onPress={() => setEditing(editing === 'from' ? null : 'from')}>
              <Text style={styles.rangeLabel}>{t(lang, 'export.from')}</Text>
              <Text style={styles.rangeValue}>{fromKey}</Text>
            </Pressable>
            <Pressable style={styles.rangeBtn} onPress={() => setEditing(editing === 'to' ? null : 'to')}>
              <Text style={styles.rangeLabel}>{t(lang, 'export.to')}</Text>
              <Text style={styles.rangeValue}>{toKey}</Text>
            </Pressable>
          </View>
          {editing ? (
            <MiniDatePicker
              lang={lang}
              valueKey={editing === 'from' ? fromKey : toKey}
              onPick={(key) => { if (editing === 'from') setFromKey(key); else setToKey(key); setEditing(null); }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  label: { color: colors.textDim, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { backgroundColor: colors.panel2, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: fontSize.sm },
  pillTextActive: { color: colors.accentText, fontWeight: '700' },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeBtn: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md, padding: spacing.md },
  rangeLabel: { color: colors.textDim, fontSize: 10, textTransform: 'uppercase' },
  rangeValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: 2 },
});

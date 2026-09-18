import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import Icon from './Icon';
import { dayKey, keyToDate, mondayOf } from '../lib/calendarMath';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const PRESETS = [
  { value: 'all', key: 'export.period_all' },
  { value: 'day', key: 'export.period_day' },
  { value: 'week', key: 'export.period_week' },
  { value: 'month', key: 'export.period_month' },
  { value: 'half_year', key: 'export.period_half_year' },
  { value: 'year', key: 'export.period_year' },
  { value: 'custom', key: 'export.period_custom' },
];

function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export default function ExportPeriodSheet({ lang, onConfirm, onCancel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [preset, setPreset] = useState('all');
  const now = new Date();
  const [fromKey, setFromKey] = useState(dayKey(now));
  const [toKey, setToKey] = useState(dayKey(now));

  // Нажатие по дню: первое задаёт начало и сбрасывает конец, второе — конец.
  // Календарь при этом не закрывается, поэтому диапазон набирается двумя
  // касаниями подряд. Если второе нажатие раньше первого — границы
  // меняются местами, а не игнорируются.
  function onPickDay(key) {
    if (!fromKey || toKey) { setFromKey(key); setToKey(null); return; }
    if (key < fromKey) { setToKey(fromKey); setFromKey(key); return; }
    setToKey(key);
  }

  function rangeFor(value) {
    if (value === 'all') return null;
    if (value === 'day') return { from: startOfDay(now), to: endOfDay(now) };
    if (value === 'week') {
      const ws = mondayOf(now);
      return { from: ws, to: endOfDay(new Date(ws.getTime() + 6 * 86400000)) };
    }
    if (value === 'month') {
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    }
    if (value === 'half_year') {
      return { from: startOfDay(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to: endOfDay(now) };
    }
    if (value === 'year') {
      return { from: startOfDay(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: endOfDay(now) };
    }
    let a = keyToDate(fromKey);
    let b = keyToDate(toKey || fromKey);
    if (a > b) [a, b] = [b, a];
    return { from: a, to: endOfDay(b) };
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'export.short')} onPress={() => onConfirm(rangeFor(preset))} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [preset, fromKey, toKey, lang]);

  const fmt = (key) => (key ? keyToDate(key).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { day: 'numeric', month: 'short' }) : '—');

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>{t(lang, 'export.title')}</Text>

      {/* Список со строками, а не чипсы: вариантов стало семь, в ряд они
          переносились неровно, а вкладок на такое количество не хватает. */}
      <View style={styles.card}>
        {PRESETS.map((p, i) => {
          const active = p.value === preset;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPreset(p.value)}
              style={[styles.row, i === PRESETS.length - 1 && styles.rowLast, active && styles.rowActive]}
            >
              <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{t(lang, p.key)}</Text>
              {active ? <Icon name="check" size={15} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </View>

      {preset === 'custom' ? (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.rangeRow}>
            <View style={[styles.rangeBox, !toKey && styles.rangeBoxActive]}>
              <Text style={styles.rangeLabel}>{t(lang, 'export.from')}</Text>
              <Text style={styles.rangeValue}>{fmt(fromKey)}</Text>
            </View>
            <View style={[styles.rangeBox, !!toKey && styles.rangeBoxActive]}>
              <Text style={styles.rangeLabel}>{t(lang, 'export.to')}</Text>
              <Text style={styles.rangeValue}>{fmt(toKey)}</Text>
            </View>
          </View>
          <MiniDatePicker lang={lang} fromKey={fromKey} toKey={toKey} onPick={onPickDay} />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.xs },
  card: { backgroundColor: colors.panel2, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowActive: { backgroundColor: colors.accentMuted },
  rowLabel: { color: colors.text, fontSize: fontSize.md },
  rowLabelActive: { fontWeight: '700' },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeBox: {
    flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 2, borderColor: 'transparent',
  },
  // Подсвечена та граница, которую задаст следующее нажатие по календарю.
  rangeBoxActive: { borderColor: colors.accent },
  rangeLabel: { color: colors.textDim, fontSize: 10, textTransform: 'uppercase' },
  rangeValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: 2 },
});

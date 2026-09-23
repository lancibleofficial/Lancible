// Тонкая настройка повторения — тот же набор возможностей, что в окне на
// десктопе, но разложенный под палец: сегменты во всю ширину, дни недели
// квадратами, переключатель копий.
//
// Правило считает src/core/repeat.js — побайтная копия десктопного файла.
// Здесь только его сборка и показ: сводка внизу берётся у describeRepeat и
// upcomingDue, поэтому «каждый второй вторник месяца» можно проверить глазами,
// не закрывая лист.
import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import Repeat from '../core/repeat.js';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';
import { dayKey, keyToDate } from '../lib/calendarMath';

const FREQS = ['day', 'week', 'month', 'year'];
const UNIT_KEY = { day: 'repeat.unit_day', week: 'repeat.unit_week', month: 'repeat.unit_month', year: 'repeat.unit_year' };
// День/Неделя/Месяц берутся у календаря — те же слова уже переведены там,
// и заводить вторые ключи с тем же смыслом незачем. Отдельный ключ есть
// только у года: в календаре такого режима нет.
const FREQ_KEY = { day: 'calendar.day', week: 'calendar.week', month: 'calendar.month', year: 'repeat.freq_year' };
// Неделя начинается с понедельника — как во всём приложении.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

/** Кнопки-сегменты во всю ширину: вариантов мало, и выбор из трёх-четырёх
 *  видно целиком, не открывая список. */
function Segments({ options, value, onChange, styles, colors }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.segBtn, on && styles.segBtnOn]}>
            <Text numberOfLines={1} style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RepeatSheet({ lang, dueAt, rule: initial, onApply, onClear }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rule, setRule] = useState(() => Repeat.normalizeRepeat(initial) || Repeat.normalizeRepeat({ freq: 'week', every: 1 }));
  const [everyText, setEveryText] = useState(String(rule.every));
  const [pickingEnd, setPickingEnd] = useState(false);

  const patch = (next) => setRule((r) => Repeat.normalizeRepeat({ ...r, ...next }));

  const toggleDay = (d) => {
    const has = rule.weekdays.includes(d);
    patch({ weekdays: has ? rule.weekdays.filter((x) => x !== d) : [...rule.weekdays, d] });
  };

  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const dayKeyOf = (iso) => dayKey(new Date(iso));
  const desc = Repeat.describeRepeat(rule);
  const summary = desc
    ? t(lang, desc.key, {
      ...desc.vars,
      days: (desc.vars.days || []).map((d) => t(lang, WEEKDAY_KEY[d])).join(', '),
    })
    : '';
  // Три ближайших срока: без них правило вроде «каждый второй вторник»
  // проверить нечем.
  const upcoming = useMemo(() => {
    if (!dueAt) return [];
    const base = new Date(dueAt).getTime();
    return Repeat.upcomingDue(rule, base, base + 400 * 86400000, 3)
      .map((ms) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' }));
  }, [rule, dueAt, locale]);

  useEffect(() => {
    setSheetFooter(
      <View style={styles.footer}>
        <Pressable style={styles.footerGhost} onPress={() => { onClear(); closeSheet(); }}>
          <Text style={styles.footerGhostText}>{t(lang, 'repeat.none')}</Text>
        </Pressable>
        <PrimaryButton title={t(lang, 'common.done')} onPress={() => { onApply(rule); closeSheet(); }} style={{ flex: 1 }} />
      </View>,
    );
  }, [rule, styles, lang, onApply, onClear]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t(lang, 'repeat.dialog_title')}</Text>

      <Segments
        styles={styles}
        colors={colors}
        value={rule.freq}
        onChange={(freq) => patch({ freq })}
        options={FREQS.map((f) => ({ value: f, label: t(lang, FREQ_KEY[f]) }))}
      />

      <View style={styles.everyRow}>
        <Text style={styles.everyLabel}>{t(lang, 'repeat.every')}</Text>
        <TextInput
          style={styles.everyInput}
          value={everyText}
          onChangeText={(v) => {
            const clean = v.replace(/[^0-9]/g, '').slice(0, 3);
            setEveryText(clean);
            if (clean) patch({ every: Number(clean) });
          }}
          onBlur={() => setEveryText(String(rule.every))}
          keyboardType="number-pad"
          maxLength={3}
        />
        <Text style={styles.everyUnit}>{t(lang, UNIT_KEY[rule.freq])}</Text>
      </View>

      {rule.freq === 'week' ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>{t(lang, 'repeat.on_days')}</Text>
          <View style={styles.days}>
            {WEEKDAYS.map((d) => {
              const on = rule.weekdays.includes(d);
              return (
                <Pressable key={d} onPress={() => toggleDay(d)} style={[styles.day, on && styles.dayOn]}>
                  <Text style={[styles.dayText, on && styles.dayTextOn]}>{t(lang, WEEKDAY_KEY[d])}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {rule.freq === 'month' ? (
        <Segments
          styles={styles}
          colors={colors}
          value={rule.monthMode}
          onChange={(monthMode) => patch({ monthMode })}
          options={[
            { value: 'day', label: t(lang, 'repeat.month_mode_day') },
            { value: 'weekday', label: t(lang, 'repeat.month_mode_weekday') },
          ]}
        />
      ) : null}

      <View style={styles.block}>
        <Text style={styles.blockLabel}>{t(lang, 'repeat.from_label')}</Text>
        <Segments
          styles={styles}
          colors={colors}
          value={rule.from}
          onChange={(from) => patch({ from })}
          options={[
            { value: 'schedule', label: t(lang, 'repeat.from_schedule') },
            { value: 'done', label: t(lang, 'repeat.from_done') },
          ]}
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.blockLabel}>{t(lang, 'repeat.ends_label')}</Text>
        <Segments
          styles={styles}
          colors={colors}
          value={rule.ends.kind}
          onChange={(kind) => { setPickingEnd(false); patch({ ends: { ...rule.ends, kind } }); }}
          options={[
            { value: 'never', label: t(lang, 'repeat.ends_never') },
            { value: 'after', label: t(lang, 'repeat.ends_after') },
            { value: 'on', label: t(lang, 'repeat.ends_on') },
          ]}
        />

        {rule.ends.kind === 'after' ? (
          <View style={styles.everyRow}>
            <TextInput
              style={styles.everyInput}
              value={String(rule.ends.count)}
              onChangeText={(v) => {
                const n = Number(v.replace(/[^0-9]/g, '').slice(0, 3));
                patch({ ends: { ...rule.ends, count: n || 1 } });
              }}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={styles.everyUnit}>{t(lang, 'repeat.ends_times')}</Text>
          </View>
        ) : null}

        {rule.ends.kind === 'on' ? (
          <Pressable style={styles.endRow} onPress={() => setPickingEnd((v) => !v)}>
            <Icon name="clock" size={14} color={colors.textDim} />
            <Text style={styles.endValue}>
              {rule.ends.at
                ? new Date(rule.ends.at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
                : t(lang, 'due.none')}
            </Text>
            <Icon name='chevron-right' size={14} color={colors.textDim} />
          </Pressable>
        ) : null}

        {rule.ends.kind === 'on' && pickingEnd ? (
          <MiniDatePicker
            lang={lang}
            valueKey={rule.ends.at ? dayKeyOf(rule.ends.at) : null}
            onPick={(key) => {
              // Лист отдаёт ключ дня; правило хранит момент времени.
              patch({ ends: { ...rule.ends, at: keyToDate(key).toISOString() } });
              setPickingEnd(false);
            }}
          />
        ) : null}
      </View>

      {/* Переключатель копий — тот же, что у «повторять с историей» на
          десктопе: под ним объяснение, потому что выбор неочевидный. */}
      <Pressable style={styles.switchRow} onPress={() => patch({ keepHistory: !rule.keepHistory })}>
        <View style={[styles.switchTrack, rule.keepHistory && styles.switchTrackOn]}>
          <View style={[styles.switchThumb, rule.keepHistory && styles.switchThumbOn]} />
        </View>
        <View style={styles.switchText}>
          <Text style={styles.switchTitle}>{t(lang, 'repeat.keep_history')}</Text>
          <Text style={styles.switchHint}>{t(lang, 'repeat.keep_history_hint')}</Text>
        </View>
      </Pressable>

      <View style={styles.summary}>
        <Icon name="clock" size={14} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryText}>{summary}</Text>
          {upcoming.length ? <Text style={styles.summaryDates}>{upcoming.join(' · ')}</Text> : null}
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  scroll: { maxHeight: 520 },
  content: { gap: spacing.md, paddingBottom: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },

  seg: {
    flexDirection: 'row', gap: 3, padding: 3,
    backgroundColor: colors.panel2, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.tabActiveBg },
  segText: { color: colors.textDim, fontSize: fontSize.sm },
  segTextOn: { color: colors.text, fontWeight: '700' },

  everyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  everyLabel: { color: colors.textDim, fontSize: fontSize.sm, flexShrink: 1 },
  everyInput: {
    width: 64, textAlign: 'center',
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingVertical: spacing.sm, color: colors.text, fontSize: fontSize.md,
  },
  everyUnit: { color: colors.text, fontSize: fontSize.sm },

  block: { gap: spacing.xs },
  blockLabel: {
    color: colors.textFaint, fontSize: fontSize.xs,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  // Дни недели — ряд квадратов со скруглением, как на десктопе.
  days: { flexDirection: 'row', gap: 5 },
  day: {
    flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.textDim, fontSize: fontSize.xs },
  dayTextOn: { color: colors.accentText, fontWeight: '700' },

  endRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  endValue: { flex: 1, color: colors.text, fontSize: fontSize.md },

  switchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  switchTrack: {
    width: 40, height: 24, borderRadius: 12, padding: 3,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
  },
  switchTrackOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  switchThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textDim },
  switchThumbOn: { backgroundColor: colors.accentText, transform: [{ translateX: 16 }] },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { color: colors.text, fontSize: fontSize.sm },
  switchHint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },

  summary: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.accentMuted, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  summaryText: { color: colors.text, fontSize: fontSize.sm },
  summaryDates: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 2 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerGhost: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  footerGhostText: { color: colors.textDim, fontSize: fontSize.sm },
});

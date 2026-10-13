// Повторение задачи — у задачи одно правило (как у события в Google
// Календаре): оно же повторяет и каждый её отрезок «времени работы».
//
// С 12 октября 2026 лист — строки с галочкой, как список повтора в
// календарях: «Не повторяется · Каждый день · Каждую неделю · По будням ·
// Каждый месяц · Каждый год · Настроить…». «Настроить…» раскрывает под
// списком тот же набор возможностей, что окно на десктопе: «Повторять
// каждые N» (поле и единица чипами), дни недели квадратами или «по числу /
// по дню недели» строками, «Отсчёт» и «Окончание» строками, «Оставлять
// выполненные копии» — строкой с переключателем. Внизу сводка словами и
// ближайшие сроки, подвал — «Готово». Сегментов в листе нет.
//
// Собран из общих кирпичей (ChoiceList, Field, Chip, Block, Hint, InfoRow,
// WeekdayChips, RowGroup, SettingRow, ExpandRow, Switch, PrimaryButton).
// Правило считает src/core/repeat.js — побайтная копия десктопного файла:
// здесь только сборка и показ, сводка — у describeRepeat и upcomingDue.
import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { Field } from './AppTextInput';
import Chip from './Chip';
import ChoiceList from './ChoiceList';
import PrimaryButton from './PrimaryButton';
import Switch from './Switch';
import MiniDatePicker from './MiniDatePicker';
import { RowGroup, SettingRow, ExpandRow } from './Island';
import { Block, InfoRow, WeekdayChips } from './RepeatControls';
import Repeat from '../core/repeat.js';
import { presetRule, isPresetRule, REPEAT_PRESETS } from '../lib/sessions';
import { ruleText } from '../lib/slotText';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, fontSize } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';
import { dayKey, keyToDate } from '../lib/calendarMath';

const FREQS = ['day', 'week', 'month', 'year'];
const UNIT_KEY = { day: 'repeat.unit_day', week: 'repeat.unit_week', month: 'repeat.unit_month', year: 'repeat.unit_year' };

/** Какая строка выбрана у правила: пресет, «Настроить…» или «Не повторяется». */
function choiceOf(rule) {
  if (!rule) return 'none';
  const p = REPEAT_PRESETS.find((x) => isPresetRule(rule, x.freq, x.weekdays));
  return p ? p.key : 'custom';
}

/**
 * @param anchorAt от чего считать ближайшие сроки в сводке (ISO): дедлайн
 *   задачи или её разовое время работы; нет — от «сейчас». Без якоря задача
 *   возвращается от дня закрытия, поэтому «Отсчёт» не показывается.
 * @param embedded страница внутри другого листа (SlotSheet — «Повторение
 *   задачи ›»): без своего заголовка и не закрывает лист; по «Готово» зовёт
 *   onDone.
 */
export default function RepeatSheet({ lang, anchorAt, rule: initial, onApply, onClear, embedded, onDone }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useSheetHeader(embedded ? null : t(lang, 'repeat.dialog_title'));
  const finish = () => (embedded ? onDone && onDone() : closeSheet());
  const start = Repeat.normalizeRepeat(initial);
  const [choice, setChoice] = useState(() => choiceOf(start));
  // Правило «Настроить…»: начинается с того, что было, — или с недели.
  const [rule, setRule] = useState(() => start || Repeat.normalizeRepeat({ freq: 'week', every: 1 }));
  const [everyText, setEveryText] = useState(String(rule.every));
  // Раскрытая строка даты окончания.
  const [pickingEnd, setPickingEnd] = useState(false);

  const patch = (next) => setRule((r) => Repeat.normalizeRepeat({ ...r, ...next }));

  /** Правило, которое уйдёт по «Готово»: пресет — свежий (тот же, что был, —
   *  прежний, со своим счётом вхождений), «Настроить…» — собранное. */
  const result = (() => {
    if (choice === 'none') return null;
    if (choice === 'custom') return rule;
    const p = REPEAT_PRESETS.find((x) => x.key === choice);
    return start && isPresetRule(start, p.freq, p.weekdays) ? start : Repeat.normalizeRepeat(presetRule(p.freq, p.weekdays));
  })();

  function pick(next) {
    // «Настроить…» продолжает с того, что выбрано сейчас.
    if (next === 'custom' && choice !== 'custom' && result) {
      setRule(result);
      setEveryText(String(result.every));
    }
    setPickingEnd(false);
    setChoice(next);
  }

  const toggleDay = (d) => {
    const has = rule.weekdays.includes(d);
    patch({ weekdays: has ? rule.weekdays.filter((x) => x !== d) : [...rule.weekdays, d] });
  };

  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const summary = result ? ruleText(result, lang) : t(lang, 'repeat.none');
  // Три ближайших срока: без них правило вроде «каждый второй вторник»
  // проверить нечем.
  const upcoming = useMemo(() => {
    if (!result) return [];
    const base = anchorAt ? new Date(anchorAt).getTime() : Date.now();
    if (!Number.isFinite(base)) return [];
    return Repeat.upcomingDue(result, base, base + 400 * 86400000, 3)
      .map((ms) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' }));
  }, [result && JSON.stringify(result), anchorAt, locale]);

  // Подвал — одна «Готово»: «Не повторяется» — строка списка.
  useEffect(() => {
    const footer = (
      <PrimaryButton
        title={t(lang, 'common.done')}
        onPress={() => { if (result) onApply(result); else onClear(); finish(); }}
      />
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [choice, rule, lang, onApply, onClear, embedded, onDone]);

  const options = [
    { value: 'none', label: t(lang, 'repeat.none'), testID: 'repeat-none' },
    ...REPEAT_PRESETS.map((p) => ({ value: p.key, label: t(lang, `repeat.${p.key}`), testID: `repeat-${p.key}` })),
    { value: 'custom', label: t(lang, 'repeat.custom'), testID: 'repeat-custom' },
  ];

  // Своей прокрутки у листа нет: прокручивает сам BottomSheet, а подвал с
  // кнопкой стоит вне прокрутки.
  return (
    <View style={styles.content} testID="repeat-sheet">
      <ChoiceList testID="repeat-preset" options={options} value={choice} onSelect={pick} />

      {choice === 'custom' ? (
        <>
          <Block label={t(lang, 'repeat.every')}>
            <View style={styles.numberRow}>
              <Field
                style={styles.numberInput}
                value={everyText}
                onChangeText={(v) => {
                  const clean = v.replace(/[^0-9]/g, '').slice(0, 3);
                  setEveryText(clean);
                  if (clean) patch({ every: Number(clean) });
                }}
                onBlur={() => setEveryText(String(rule.every))}
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel={t(lang, 'repeat.every')}
              />
              <View style={styles.chips} testID="repeat-freq">
                {FREQS.map((f) => <Chip key={f} label={t(lang, UNIT_KEY[f])} on={rule.freq === f} onPress={() => patch({ freq: f })} testID={`repeat-freq-${f}`} />)}
              </View>
            </View>
          </Block>

          {rule.freq === 'week' ? (
            <Block label={t(lang, 'repeat.on_days')}>
              <WeekdayChips lang={lang} value={rule.weekdays} onToggle={toggleDay} />
            </Block>
          ) : null}

          {rule.freq === 'month' ? (
            <ChoiceList
              testID="repeat-month-mode"
              value={rule.monthMode}
              onSelect={(monthMode) => patch({ monthMode })}
              options={[
                { value: 'day', label: t(lang, 'repeat.month_mode_day') },
                { value: 'weekday', label: t(lang, 'repeat.month_mode_weekday') },
              ]}
            />
          ) : null}

          {/* Считать не от чего — нет ни срока, ни разового времени работы, — и
              задача вернётся от дня закрытия сама: выбирать нечего. */}
          {anchorAt ? (
            <Block label={t(lang, 'repeat.from_label')}>
              <ChoiceList
                testID="repeat-from"
                value={rule.from}
                onSelect={(from) => patch({ from })}
                options={[
                  { value: 'schedule', label: t(lang, 'repeat.from_schedule') },
                  { value: 'done', label: t(lang, 'repeat.from_done') },
                ]}
              />
            </Block>
          ) : null}

          <Block label={t(lang, 'repeat.ends_label')}>
            <ChoiceList
              testID="repeat-ends"
              value={rule.ends.kind}
              onSelect={(kind) => { setPickingEnd(kind === 'on' && !rule.ends.at); patch({ ends: { ...rule.ends, kind } }); }}
              options={[
                { value: 'never', label: t(lang, 'repeat.ends_never') },
                { value: 'after', label: t(lang, 'repeat.ends_after') },
                { value: 'on', label: t(lang, 'repeat.ends_on') },
              ]}
            />

            {rule.ends.kind === 'after' ? (
              <View style={styles.numberRow}>
                <Field
                  style={styles.numberInput}
                  value={String(rule.ends.count)}
                  onChangeText={(v) => {
                    const n = Number(v.replace(/[^0-9]/g, '').slice(0, 3));
                    patch({ ends: { ...rule.ends, count: n || 1 } });
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  accessibilityLabel={t(lang, 'repeat.ends_after')}
                />
                <Text style={styles.unit}>{t(lang, 'repeat.ends_times')}</Text>
              </View>
            ) : null}

            {rule.ends.kind === 'on' ? (
              <RowGroup testID="repeat-ends-date">
                <ExpandRow
                  icon="calendar"
                  label={t(lang, 'sdlg.date_label')}
                  value={rule.ends.at
                    ? new Date(rule.ends.at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
                    : t(lang, 'due.none')}
                  open={pickingEnd}
                  onToggle={() => setPickingEnd((v) => !v)}
                  testID="repeat-ends-at"
                >
                  <MiniDatePicker
                    lang={lang}
                    valueKey={rule.ends.at ? dayKey(new Date(rule.ends.at)) : null}
                    onPick={(key) => {
                      // Лист отдаёт ключ дня; правило хранит момент времени.
                      patch({ ends: { ...rule.ends, at: keyToDate(key).toISOString() } });
                      setPickingEnd(false);
                    }}
                  />
                </ExpandRow>
              </RowGroup>
            ) : null}
          </Block>

          {/* Копии — строка с переключателем, как в «Меню»; объяснение — под
              островом: выбор неочевидный. */}
          <RowGroup note={t(lang, 'repeat.keep_history_hint')}>
            <SettingRow
              label={t(lang, 'repeat.keep_history')}
              onPress={() => patch({ keepHistory: !rule.keepHistory })}
              chevron={false}
              testID="repeat-keep-row"
              right={(
                <Switch
                  value={!!rule.keepHistory}
                  onValueChange={(v) => patch({ keepHistory: v })}
                  accessibilityLabel={t(lang, 'repeat.keep_history')}
                />
              )}
            />
          </RowGroup>
        </>
      ) : null}

      <InfoRow icon="refresh" text={summary} sub={upcoming.join(' · ')} testID="repeat-summary" />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  // Число с единицей справа — как «Ставка» в проекте: поле общее (Field), во
  // всю оставшуюся ширину, единица — чипами или тихим словом.
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  numberInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  unit: { color: colors.textDim, fontSize: fontSize.sm },
});

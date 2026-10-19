// Лист «Экспорт в Excel» — то же окно, что на вебе (src/renderer/app.js,
// openExportPeriodDialog): период и проекты двумя полями-выпадашками, под
// ними сводка того, что уйдёт в файл. Правила — в core/export.js, побайтной
// копии файла веба: что значит период, как отмечаются проекты, сколько
// записей наберётся. Здесь — лист и сборка файла.
//
// Выпадашка на телефоне — страница внутри листа со стрелкой «назад», как
// теги и валюта в окне проекта: лист в приложении один. Период выбирается
// одним касанием и возвращает к форме; проекты — галочками, страница
// остаётся открытой («Все проекты» наверху, ниже — по строке на проект).
// Списки — общий ChoiceList.
//
// Под полем периода — точные даты; у «Всего времени» — то, что за ним
// лежит: от первой записи до последней. «Свой период…» — две строки «С» и
// «По» (ExpandRow, как дата в остальных листах); касание раскрывает под
// строкой календарь для этой границы. Границы не расходятся: «С» дальше «По»
// подтягивает её за собой, и наоборот.
//
// Выгружать нечего — «Экспорт» гаснет, а сводка (InfoRow) говорит почему.
//
// Файл лист собирает сам, как окно веба: «Всё время» — сводка по проектам
// (buildAllProjectsSheets: итоги и по листу на проект), остальные периоды —
// один лист записей (buildPeriodSheets). Один проект — в его валюте и по его
// ставкам, несколько — в основной.
//
// «Личное» (useModeFlags → Core.modeFlags): деньги в файл не идут. Лист
// передаёт построителям { money: false }, и ядро собирает таблицы сразу без
// колонок ставки и суммы.
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import PrimaryButton from './PrimaryButton';
import MiniDatePicker from './MiniDatePicker';
import ChoiceList from './ChoiceList';
import { RowGroup, ExpandRow } from './Island';
import { Block, Hint, InfoRow } from './RepeatControls';
import { SelectField } from './AppTextInput';
import { PAGE_IN_FWD, PAGE_IN_BACK, PAGE_OUT } from './BottomSheet';
import Export from '../core/export.js';
import { useAppStore, getProject } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useModeFlags } from '../hooks/useModeFlags';
import { buildPeriodSheets, buildAllProjectsSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { fmtDur } from '../lib/format';
import { closeSheet, setSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t, pluralForm, LOCALE_MAP } from '../lib/i18n';

const ALL = 'all-projects';

/** Дата для подписей листа: «1 окт.» и «1 окт. 2026». Год дописывается сам,
 *  а не берётся из toLocaleDateString: тот ставит к нему «г.», «р.», «ж.»,
 *  а у казахского ещё и в начало строки (как fmtExpDate на вебе). */
export function fmtExportDate(d, withYear, lang) {
  const day = d.toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { day: 'numeric', month: 'short' });
  if (!withYear) return day;
  return lang === 'en' ? `${day}, ${d.getFullYear()}` : `${day} ${d.getFullYear()}`;
}

/** Что уйдёт в файл: задачи выбранных проектов, границы периода и сводка.
 *  Одна функция и для сводки на листе, и для самой выгрузки — пообещать одно,
 *  а выгрузить другое лист не может.
 *  @param {{period: string, from: string, to: string, projects: string[]|null}} sel
 *  @returns {{tasks, range, summary, picked}} picked — выбранные проекты */
export function exportPlan(tasks, projects, sel, now = new Date()) {
  const chosen = Export.exportTasks(tasks, sel.projects);
  const range = Export.exportRange(sel.period, now, { from: sel.from, to: sel.to });
  return {
    tasks: chosen,
    range,
    summary: Export.exportSummary(chosen, range),
    picked: sel.projects ? projects.filter((p) => sel.projects.includes(p.id)) : projects,
  };
}

/** @param {string} lang
 *  @param {string} [projectId] — открыт со страницы проекта (или с «Цифр» с
 *    выбранным проектом): он и предвыбран. Прочие пропсы прежнего листа
 *    (onConfirm, onCancel) больше не нужны: выгрузку лист делает сам, а
 *    закрывают его крестик и свайп. */
export default function ExportPeriodSheet({ lang, projectId }) {
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const settings = useAppStore((s) => s.settings);
  const showToast = useAppStore((s) => s.showToast);
  const rates = useRates();
  const ratesMain = useRatesMain();
  const { money } = useModeFlags();

  const today = dayKey(new Date());
  const ids = projects.map((p) => p.id);
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [picked, setPicked] = useState(() => Export.normalizeExportProjects(projectId ? [projectId] : null, ids));
  // Страница листа: null — форма, 'period' или 'projects'.
  const [page, setPage] = useState(null);
  // Какую границу своего периода сейчас выбирают в календаре.
  const [editing, setEditing] = useState(null);

  const plan = useMemo(
    () => exportPlan(tasks, projects, { period, from, to, projects: picked }),
    [tasks, projects, period, from, to, picked],
  );
  const { range, summary } = plan;

  const back = () => setPage(null);
  useSheetHeader(
    !page ? t(lang, 'export.title') : t(lang, page === 'period' ? 'export.period_label' : 'export.projects_label'),
    page ? back : null,
  );

  const projectsText = Export.exportProjectsLabel(picked, projects, {
    all: t(lang, 'filter.all_projects'),
    many: (n) => t(lang, 'export.projects_n', { n, plural: pluralForm(lang, n, 'plural.project') }),
  });

  function doExport() {
    if (summary.empty) return;
    const one = plan.picked.length === 1 ? plan.picked[0] : null;
    const currency = one ? currencyOf(one, settings) : settings.currency;
    const r = one ? rates : ratesMain;
    closeSheet();
    if (!range) {
      runExport(
        `Lancible — ${picked ? projectsText : t(lang, 'export.all_projects')} — ${today}`,
        buildAllProjectsSheets(plan.picked, (id) => plan.tasks.filter((x) => x.projectId === id), lang, currency, r, { money }),
        lang,
        showToast,
      );
      return;
    }
    runExport(
      `Lancible — ${t(lang, 'export.period')}${picked ? ` — ${projectsText}` : ''} — ${dayKey(range.from)} — ${dayKey(range.to)}`,
      buildPeriodSheets(plan.tasks, (id) => getProject(projects, id), lang, currency, r, range, { money }),
      lang,
      showToast,
    );
  }

  // Обработчик кнопки читает свежий план через ref: подвал пересобирается
  // эффектом, но нажатие не должно зависеть от того, успел ли он.
  const run = useRef(doExport);
  run.current = doExport;
  useEffect(() => {
    if (page === 'period') setSheetFooter(null);
    else if (page === 'projects') setSheetFooter(<PrimaryButton title={t(lang, 'common.done')} onPress={back} />);
    else setSheetFooter(<PrimaryButton title={t(lang, 'export.short')} disabled={summary.empty} onPress={() => run.current()} />);
    return () => setSheetFooter(null);
  }, [page, summary.empty, lang]);

  // Переход между страницами — как в окне проекта: вперёд справа, назад слева.
  const depth = page ? 1 : 0;
  const prevDepth = useRef(0);
  const reduced = useReduceMotion();
  useEffect(() => { prevDepth.current = depth; }, [depth]);
  const enter = reduced || depth === prevDepth.current ? undefined : depth > prevDepth.current ? PAGE_IN_FWD : PAGE_IN_BACK;
  const leave = reduced ? undefined : PAGE_OUT;

  if (page === 'period') {
    return (
      <Animated.View key="period" entering={enter} exiting={leave} testID="sheet-page">
        <ChoiceList
          options={Export.EXPORT_PERIODS.map((p) => ({ value: p, label: t(lang, `export.period_${p}`) }))}
          value={period}
          onSelect={(p) => { setPeriod(p); setEditing(null); back(); }}
          testID="export-periods"
        />
      </Animated.View>
    );
  }

  if (page === 'projects') {
    return (
      <Animated.View key="projects" entering={enter} exiting={leave} style={styles.page} testID="sheet-page">
        <ChoiceList
          multi
          options={[{ value: ALL, label: t(lang, 'filter.all_projects') }]}
          selected={picked ? [] : [ALL]}
          onSelect={() => setPicked(null)}
          testID="export-all-projects"
        />
        {projects.length ? (
          <ChoiceList
            multi
            options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
            selected={picked || []}
            onSelect={(id) => setPicked(Export.toggleExportProject(picked, id, ids))}
            testID="export-project-list"
          />
        ) : null}
      </Animated.View>
    );
  }

  const custom = period === 'custom';
  const shown = range || Export.exportSpan(plan.tasks);
  const rangeText = shown ? Export.exportRangeLabel(shown, (d, y) => fmtExportDate(d, y, lang)) : '';
  // Границы не расходятся: дальше «По» — «С» тянет её за собой, и наоборот.
  const pickDay = (key) => {
    if (editing === 'from') { setFrom(key); if (to < key) setTo(key); } else { setTo(key); if (from > key) setFrom(key); }
    setEditing(null);
  };
  const dateRow = (which, label, key) => (
    <ExpandRow
      icon="calendar"
      label={label}
      value={fmtExportDate(keyToDate(key), true, lang)}
      open={editing === which}
      onToggle={() => setEditing((e) => (e === which ? null : which))}
      testID={`export-${which}`}
    >
      <MiniDatePicker key={which} lang={lang} valueKey={key} onPick={pickDay} />
    </ExpandRow>
  );

  return (
    <Animated.View key="form" entering={enter} exiting={leave} style={styles.page} testID="sheet-page">
      <Block label={t(lang, 'export.period_label')}>
        <SelectField label={t(lang, `export.period_${period}`)} onPress={() => setPage('period')} testID="export-period" />
        {custom ? (
          <RowGroup testID="export-dates">
            {dateRow('from', t(lang, 'export.from'), from)}
            {dateRow('to', t(lang, 'export.to'), to)}
          </RowGroup>
        ) : rangeText ? <Hint testID="export-range">{rangeText}</Hint> : null}
      </Block>

      <Block label={t(lang, 'export.projects_label')}>
        <SelectField label={projectsText} onPress={() => setPage('projects')} testID="export-projects" />
      </Block>

      <InfoRow
        icon={summary.empty ? 'info' : 'download'}
        text={summary.empty
          ? t(lang, 'export.empty')
          : t(lang, 'export.summary', { n: summary.count, plural: pluralForm(lang, summary.count, 'plural.entry'), time: fmtDur(summary.ms, lang) })}
        testID="export-summary"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.md },
});

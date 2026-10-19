// График в тексте на телефоне — нативный лист (components/ChartSheet.js)
// вместо окна редактора в WebView (17 октября 2026, протокол редактора 2).
// Редактор присылает { type: 'chart', id, spec } — id узла (bid) или null
// (новый: у курсора или под таблицей), лист отвечает ed.receive({ type:
// 'chart', id, spec }) (lib/editorBridge.js); закрыли без сохранения —
// { type: 'chart', cancel: true }.
//
// spec — { kind, title, rows }, точная форма — в шапке src/editor/host.js:
//   kind  — 'bar' | 'hbar' | 'line' | 'area' | 'pie' | 'donut' (CHART_TYPES
//           редактора, в том же порядке);
//   title — строка, '' — без названия;
//   rows  — [{ label: string, value: number }]: подписи и первый ряд.
// Чего в spec нет (легенда, подписи значений, стопка, другие ряды), редактор
// держит в узле сам, и чинит spec тоже он: здесь — только поля листа и обратно.

/** Виды графика — порядок CHART_TYPES редактора (src/editor/chart.js). */
export const CHART_KINDS = ['bar', 'hbar', 'line', 'area', 'pie', 'donut'];
/** Сколько строк данных держит лист. */
export const CHART_MAX_ROWS = 50;
// Прежнее имя вида из проекта волны 2 — редактор понимает его как 'bar'.
const ALIAS = { bars: 'bar' };

let seq = 0;
const rowKey = () => `r${(seq += 1)}`;

/** Число из поля: «1 234,5», «−3», «12.5». Не число — null. */
export function parseValue(text) {
  const s = String(text == null ? '' : text).trim().replace(/[\s  ]/g, '').replace(/[−–]/g, '-').replace(',', '.');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const valueText = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(Number(v)));

/** Пустая строка данных. */
export const emptyRow = () => ({ key: rowKey(), label: '', value: '' });

/** spec из сообщения → черновик листа { kind, title, rows: [{ key, label,
 *  value — строкой поля }] }. Без строк — три пустые. */
export function specToDraft(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const kind = ALIAS[s.kind] || s.kind;
  const rows = Array.isArray(s.rows) ? s.rows.filter((r) => r && typeof r === 'object') : [];
  return {
    kind: CHART_KINDS.includes(kind) ? kind : CHART_KINDS[0],
    title: typeof s.title === 'string' ? s.title : '',
    rows: rows.length
      ? rows.map((r) => ({ key: rowKey(), label: r.label == null ? '' : String(r.label), value: valueText(r.value) }))
      : [emptyRow(), emptyRow(), emptyRow()],
  };
}

/** Строки, которые уйдут в график: совсем пустые (ни подписи, ни числа) — нет. */
export const filledRows = (rows) => (rows || []).filter((r) => String(r.label).trim() || parseValue(r.value) != null);

/** Черновик → spec для ed.receive. Подпись без числа — 0. */
export function draftToSpec(draft) {
  return {
    kind: CHART_KINDS.includes(draft.kind) ? draft.kind : CHART_KINDS[0],
    title: String(draft.title || '').trim(),
    rows: filledRows(draft.rows).map((r) => ({ label: String(r.label).trim(), value: parseValue(r.value) ?? 0 })),
  };
}

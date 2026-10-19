// График на телефоне — нативный лист (components/ChartSheet.js, 17 октября
// 2026, протокол редактора 2). Запуск: npm run test:mobile
//
// Протокол (шапка src/editor/host.js): редактор шлёт { type: 'chart', id,
// spec } — id узла (bid) или null для нового, spec = { kind, title, rows };
// телефон открывает лист с данными, «Вставить»/«Сохранить» отвечает
// ed.receive({ type: 'chart', id, spec }), закрытый без сохранения лист —
// { type: 'chart', cancel: true }; ошибка страницы «chart: …» — тост.
// Сторона страницы — у редактора (его тесты); здесь сообщение страницы
// подменено, а проверяется, что лист открывается с данными и в ответ уходит
// правильный spec.
import { StyleSheet } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import EditorScreen from '../src/screens/EditorScreen';
import ChartSheet from '../src/components/ChartSheet';
import BottomSheet from '../src/components/BottomSheet';
import { EDITOR_BASE_URL } from '../src/components/DocEditor';
import { parseMessage, createBridge } from '../src/lib/editorBridge';
import { specToDraft, draftToSpec, parseValue, CHART_KINDS } from '../src/lib/chartSpec';
import { EDITOR_JS } from '../src/editor/editorBundle';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: React.forwardRef((props, ref) => {
      global.__web = props;
      React.useImperativeHandle(ref, () => ({ postMessage: (m) => global.__posted.push(JSON.parse(m)) }));
      return null;
    }),
  };
});

const say = (m) => act(() => global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }));
const last = (type) => global.__posted.filter((m) => m.type === type).pop();
const charts = () => global.__posted.filter((m) => m.type === 'chart');
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) });
const SPEC = { kind: 'line', title: 'Продажи', rows: [{ label: 'Янв', value: 4 }, { label: 'Фев', value: 7.5 }] };

beforeEach(() => {
  global.__posted = [];
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    documents: [{ id: 'd1', title: 'План', body: null, projectId: null, updatedAt: '2026-10-17T08:00:00.000Z' }],
    projects: [],
    toastMessage: null,
  });
});

const footer = (s) => within(s.getByTestId('sheet-footer-content'));
const editor = () => render(<EditorScreen route={{ params: { id: 'd1' } }} navigation={nav()} />);

describe('мост', () => {
  test('сообщение chart разбирается: id узла или null, spec как есть', () => {
    expect(parseMessage(JSON.stringify({ type: 'chart', id: 'n7', spec: SPEC }))).toEqual({ type: 'chart', id: 'n7', spec: SPEC });
    expect(parseMessage({ type: 'chart', id: '', spec: 'нет' })).toEqual({ type: 'chart', id: null, spec: null });
    expect(parseMessage({ type: 'chart' })).toEqual({ type: 'chart', id: null, spec: null });
  });

  test('ответы хозяина: { type: chart, id, spec } и отмена', () => {
    const sent = [];
    const b = createBridge((m) => sent.push(m));
    b.chart(null, SPEC);
    b.chart('n7', SPEC);
    b.chartCancel();
    expect(sent).toEqual([{ type: 'chart', id: null, spec: SPEC }, { type: 'chart', id: 'n7', spec: SPEC }, { type: 'chart', cancel: true }]);
  });

  test('виды листа — те же и в том же порядке, что CHART_TYPES редактора в сборке', () => {
    // В сборке массив видов лежит литералом — сверяем по нему.
    expect(CHART_KINDS).toEqual(['bar', 'hbar', 'line', 'area', 'pie', 'donut']);
    expect(EDITOR_JS).toContain(JSON.stringify(CHART_KINDS));
  });
});

describe('редактор просит график — открывается лист, ответ уходит в страницу', () => {
  test('новый (id null): лист «Новый график» с данными; «Вставить» шлёт spec с правкой', async () => {
    await editor();
    await say({ type: 'chart', id: null, spec: SPEC });
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'chart.sheet_new'));
    expect(s.getByTestId('chart-title').props.value).toBe('Продажи');
    expect(s.getByTestId('chart-kind-line').props.accessibilityState.selected).toBe(true);
    expect(s.getByTestId('chart-label-0').props.value).toBe('Янв');
    expect(s.getByTestId('chart-value-1').props.value).toBe('7.5');

    await fireEvent.press(s.getByTestId('chart-kind-donut'));
    await fireEvent.changeText(s.getByTestId('chart-value-0'), '1 200,5');
    await fireEvent.press(s.getByTestId('chart-add-row'));
    await fireEvent.changeText(s.getByTestId('chart-label-2'), 'Мар');
    await fireEvent.changeText(s.getByTestId('chart-value-2'), '−3');
    await act(async () => { fireEvent.press(footer(s).getByText(t('ru', 'chart.insert'))); });

    expect(last('chart')).toEqual({
      type: 'chart',
      id: null,
      spec: { kind: 'donut', title: 'Продажи', rows: [{ label: 'Янв', value: 1200.5 }, { label: 'Фев', value: 7.5 }, { label: 'Мар', value: -3 }] },
    });
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('правка (id узла): «Сохранить», крестик в строке убирает её, ответ — с тем же id', async () => {
    await editor();
    await say({ type: 'chart', id: 'n7', spec: SPEC });
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'chart.sheet_edit'));
    await fireEvent.press(s.getByTestId('chart-remove-0'));
    await act(async () => { fireEvent.press(footer(s).getByText(t('ru', 'common.save'))); });
    expect(last('chart')).toEqual({ type: 'chart', id: 'n7', spec: { kind: 'line', title: 'Продажи', rows: [{ label: 'Фев', value: 7.5 }] } });
  });

  test('ответ уходит один: лист, ушедший после «Сохранить», отмены не шлёт', async () => {
    await editor();
    await say({ type: 'chart', id: 'n7', spec: SPEC });
    const s = await render(<BottomSheet />);
    await act(async () => { fireEvent.press(footer(s).getByText(t('ru', 'common.save'))); });
    await s.unmount();
    expect(charts()).toHaveLength(1);
    expect(charts()[0].cancel).toBeUndefined();
  });

  test('лист ушёл без «Сохранить» (крестик, свайп) — редактору уходит отмена', async () => {
    await editor();
    await say({ type: 'chart', id: 'n7', spec: SPEC });
    const s = await render(<BottomSheet />);
    s.getByTestId('chart-sheet');
    await s.unmount();
    expect(charts()).toEqual([{ type: 'chart', cancel: true }]);
  });

  test('страница ответила «chart: …» (графика уже нет) — тост', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await editor();
    await say({ type: 'error', message: 'chart: нет графика n7' });
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'chart.failed'));
    console.error.mockRestore();
  });
});

describe('лист', () => {
  test('шесть видов строками с галочкой, порядок редактора; пусто — «Вставить» гаснет', async () => {
    openSheet(<ChartSheet lang="ru" id={null} spec={null} onSave={jest.fn()} />);
    const s = await render(<BottomSheet />);
    expect(within(s.getByTestId('chart-kinds')).getAllByRole('radio').map((r) => r.props.testID))
      .toEqual(CHART_KINDS.map((k) => `chart-kind-${k}`));
    for (const k of CHART_KINDS) within(s.getByTestId(`chart-kind-${k}`)).getByText(t('ru', `chart.kind_${k}`));
    // Без данных — три пустые строки и строка «+ Строка»; строка данных — высотой строки настройки (46).
    const row = StyleSheet.flatten(s.getByTestId('chart-row-2').props.style);
    expect(row).toMatchObject({ minHeight: 46, paddingVertical: 0 });
    expect(StyleSheet.flatten(s.getByTestId('chart-label-2').props.style).minHeight).toBe(46);
    s.getByTestId('chart-add-row');
    expect(footer(s).getByTestId('chart-save').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(s.getByTestId('chart-value-0'), '5');
    expect((footer(s).getByTestId('chart-save').props.accessibilityState || {}).disabled).toBeFalsy();
  });
});

describe('lib/chartSpec', () => {
  test('вид: прежнее «bars» — столбцы, незнакомый — столбцы; подпись без числа — 0, пустые строки не уходят', () => {
    expect(specToDraft({ kind: 'bars', rows: [{ label: 'А', value: 1 }] }).kind).toBe('bar');
    expect(specToDraft({ kind: 'radar', rows: [] }).kind).toBe('bar');
    const d = specToDraft({ kind: 'pie', title: ' Доли ', rows: [{ label: 'А', value: 1 }, { label: '', value: null }, { label: 'Б' }] });
    expect(draftToSpec(d)).toEqual({ kind: 'pie', title: 'Доли', rows: [{ label: 'А', value: 1 }, { label: 'Б', value: 0 }] });
  });

  test('parseValue: пробелы, запятая, длинный минус; не число — null', () => {
    expect(parseValue('1 234,5')).toBe(1234.5);
    expect(parseValue('−3')).toBe(-3);
    expect(parseValue('')).toBeNull();
    expect(parseValue('abc')).toBeNull();
  });
});

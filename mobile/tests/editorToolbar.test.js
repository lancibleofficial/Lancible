// Нативная панель редактора (components/EditorToolbar.js) и мост к странице
// (lib/editorBridge.js). Запуск: npm run test:mobile (из корня)
//
// Решение 12 октября 2026: одна строка над клавиатурой, кнопки 44; группы
// раскрываются на месте строки; «Перо» справа видно всегда и меняет строку
// на инструменты пера. Подсветка включённого — из format, который присылает
// редактор; кнопки не забирают фокус у текста.
//
// 13 октября 2026 (пользователь на настоящем телефоне: «неудобно»): порядок
// «отмена · Aa · H · маркированный · нумерованный · чек-лист · ссылка · фото ·
// таблица · ещё»; три списка — тремя кнопками подряд; значки — настоящие из
// словаря Solar (core/icons.js), а не буквы и стрелки на замену.
//
// Второй круг того же дня: значок нумерованного списка не читался, шеврон со
// сдвигами внутри был лишним. Нумерованный — «1.» буквами шрифта заголовков,
// как «Aa» и «H»; шеврона, группы списков и кнопок сдвига в панели нет совсем
// (сдвиг остаётся Tab / Shift+Tab в самом редакторе — на аппаратной клавиатуре).
//
// Третий круг: на экранной клавиатуре Tab нет, и вложить пункт списка нечем.
// Пока курсор в списке (format.list), в главной строке сразу после чек-листа
// встают два слова — «Вложить» и «Вынести»; вне списка их нет. Значков и
// шеврона по-прежнему нет.
//
// 19 октября 2026 (пользователь: «панель инструментов сделаем парящей со
// скруглёнными углами, но при открытой клавиатуре — над клавиатурой»):
// панель — остров. От краёв экрана — боковое поле страницы, скругление
// острова, поверхность и тень плавающего (как у плашки идущей задачи), от
// опоры — воздух TOOLBAR_GAP. Всё — токенами theme.js.
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render, fireEvent, renderHook, act, within } from '@testing-library/react-native';
import * as KeyboardLib from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EditorToolbar, {
  MAIN_ROW, LIST_TOOLS, GROUP_ROWS, INK_ROW, HUES, INK_COLORS, TOOLBAR_HEIGHT, TOOLBAR_BUTTON, TOOLBAR_HIDE_DELAY, TOOLBAR_GAP, TOOLBAR_SPACE,
  useToolbarVisible, useEditorInset,
} from '../src/components/EditorToolbar';
import { EMPTY_FORMAT, normalizeFormat, parseMessage, createBridge, sameFormat } from '../src/lib/editorBridge';
import { ICONS } from '../src/core/icons';
import { useAppStore } from '../src/store/useAppStore';
import { editorSwatches, displayFamily, useColors, floatingShadow, radius, spacing, screenPadding } from '../src/theme';
import { t } from '../src/lib/i18n';

const actions = () => ({
  exec: jest.fn(), link: jest.fn(), image: jest.fn(), exportDoc: jest.fn(),
  ink: jest.fn(), inkTool: jest.fn(), inkColor: jest.fn(), inkSize: jest.fn(),
});
const fmt = (over) => normalizeFormat({ ...EMPTY_FORMAT, focused: true, ...over });
const bar = (props = {}) => render(<EditorToolbar lang="ru" format={fmt()} actions={actions()} docked={false} {...props} />);
/** testID кнопок строки по порядку. */
const buttons = (q, group) => within(q.getByTestId(`tb-row-${group}`)).getAllByRole('button').map((n) => n.props.testID);
const selected = (q, id) => !!(q.getByTestId(id).props.accessibilityState || {}).selected;
/** Какой значок словаря нарисован в кнопке — по всем его путям. */
const iconOf = (q, id) => {
  const ds = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props && typeof n.props.d === 'string') ds.push(n.props.d);
    (n.children || []).forEach(walk);
  }(q.getByTestId(id)));
  const key = ds.join('|');
  return Object.keys(ICONS).find((k) => ICONS[k].p.map(([d]) => d).join('|') === key) || null;
};
/** Главная строка как её видно. */
const MAIN_IDS = ['tb-undo', 'tb-format', 'tb-block', 'tb-bullet', 'tb-ordered', 'tb-checklist', 'tb-link', 'tb-photo', 'tb-table', 'tb-more'];
/** Главная строка, когда курсор в списке: слова вложенности сразу после чек-листа. */
const LIST_IDS = ['tb-undo', 'tb-format', 'tb-block', 'tb-bullet', 'tb-ordered', 'tb-nest', 'tb-unnest', 'tb-checklist', 'tb-link', 'tb-photo', 'tb-table', 'tb-more'];
/** Кнопки главной строки, раскрывающие группу. */
const GROUP_OPENERS = ['tb-format', 'tb-block', 'tb-more'];

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
});

describe('главная строка', () => {
  test('порядок кнопок — как решено, «Перо» справа отдельно', async () => {
    const q = await bar();
    expect(MAIN_ROW).toEqual(['undo', 'format', 'block', 'bullet', 'ordered', 'checklist', 'link', 'photo', 'table', 'more']);
    expect(buttons(q, 'main')).toEqual(MAIN_IDS);
    q.getByTestId('tb-pen-mode');
    expect(q.getByText(t('ru', 'editor.pen'))).toBeTruthy();
  });

  test('шеврона, группы списков и значков сдвига нет нигде: ни в строке, ни в группах', async () => {
    const q = await bar();
    const gone = ['tb-list', 'tb-lists', 'tb-indent', 'tb-outdent'];
    for (const id of gone) expect(q.queryByTestId(id)).toBeNull();
    for (const opener of GROUP_OPENERS) {
      await fireEvent.press(q.getByTestId(opener));
      for (const id of gone) expect(q.queryByTestId(id)).toBeNull();
      await fireEvent.press(q.getByTestId('tb-back'));
    }
    // В коде строк тоже: ни группы списков, ни сдвигов.
    expect(Object.keys(GROUP_ROWS)).toEqual(['format', 'block', 'more']);
    for (const keys of [MAIN_ROW, ...Object.values(GROUP_ROWS)]) {
      expect(keys).not.toContain('indent');
      expect(keys).not.toContain('outdent');
      expect(keys).not.toContain('list');
    }
    // Подписи для чтения с экрана убраны вместе с кнопками, во всех четырёх языках.
    for (const lang of ['ru', 'en', 'uk', 'kk']) {
      for (const key of ['editor.tb_lists', 'editor.tb_indent', 'editor.tb_outdent']) expect(t(lang, key)).toBe(key);
    }
  });

  test('курсор в любом списке — после чек-листа встают «Вложить» и «Вынести», остальное на своих местах', async () => {
    expect(LIST_TOOLS).toEqual(['nest', 'unnest']);
    for (const list of ['bullet_list', 'ordered_list', 'task_list']) {
      const q = await bar({ format: fmt({ list }) });
      expect(buttons(q, 'main')).toEqual(LIST_IDS);
      await q.unmount();
    }
    // Слева — самое частое, как и было: порядок прежних кнопок не изменился.
    expect(LIST_IDS.filter((id) => !['tb-nest', 'tb-unnest'].includes(id))).toEqual(MAIN_IDS);
  });

  test('курсор не в списке — «Вложить» и «Вынести» не рисуются, ни в главной строке, ни в группах', async () => {
    const q = await bar({ format: fmt({ list: null }) });
    expect(buttons(q, 'main')).toEqual(MAIN_IDS);
    for (const opener of GROUP_OPENERS) {
      await fireEvent.press(q.getByTestId(opener));
      expect(q.queryByTestId('tb-nest')).toBeNull();
      expect(q.queryByTestId('tb-unnest')).toBeNull();
      await fireEvent.press(q.getByTestId('tb-back'));
    }
    // Вышли из списка — кнопки уходят сразу, а не остаются до следующего захода.
    await q.rerender(<EditorToolbar lang="ru" format={fmt({ list: 'bullet_list' })} actions={actions()} docked={false} />);
    q.getByTestId('tb-nest');
    await q.rerender(<EditorToolbar lang="ru" format={fmt({ list: null })} actions={actions()} docked={false} />);
    expect(q.queryByTestId('tb-nest')).toBeNull();
    expect(q.queryByTestId('tb-unnest')).toBeNull();
  });

  test('«Вложить» шлёт exec indent, «Вынести» — exec outdent; строка остаётся главной', async () => {
    const a = actions();
    const q = await bar({ actions: a, format: fmt({ list: 'bullet_list' }) });
    await fireEvent.press(q.getByTestId('tb-nest'));
    await fireEvent.press(q.getByTestId('tb-unnest'));
    expect(a.exec.mock.calls).toEqual([['indent', undefined], ['outdent', undefined]]);
    q.getByTestId('tb-row-main');
    // Редактор не сообщает глубину пункта, поэтому «Вынести» не гасится: команда уходит всегда.
    expect(q.getByTestId('tb-unnest').props.accessibilityState.disabled).toBe(false);
    expect(q.getByTestId('tb-nest').props.accessibilityState.disabled).toBe(false);
  });

  test('«Вложить» и «Вынести» — слова в стиле «Aa», «H» и «1.»: без значков, подписи на четырёх языках', async () => {
    const q = await bar({ format: fmt({ list: 'ordered_list' }) });
    const ref = StyleSheet.flatten(within(q.getByTestId('tb-format')).getByText('Aa').props.style);
    for (const [id, key] of [['tb-nest', 'editor.tb_nest'], ['tb-unnest', 'editor.tb_unnest']]) {
      const word = within(q.getByTestId(id)).getByText(t('ru', key));
      expect(iconOf(q, id)).toBeNull();
      const s = StyleSheet.flatten(word.props.style);
      expect(s.fontFamily).toBe(ref.fontFamily);
      expect(s.fontSize).toBe(ref.fontSize);
      expect(s.fontFamily).toBe(displayFamily.bold);
      // Слово шире 44 — кнопка растёт вширь отступами, высота та же.
      const box = StyleSheet.flatten(q.getByTestId(id).props.style);
      expect(box).toMatchObject({ minWidth: 44, height: 44 });
      expect(box.paddingHorizontal).toBeGreaterThan(0);
      expect(q.getByTestId(id).props.accessibilityLabel).toBe(t('ru', key));
      expect(q.getByTestId(id).props.focusable).toBe(false);
      expect(selected(q, id)).toBe(false);
    }
    const words = { ru: ['Вложить', 'Вынести'], en: ['Nest', 'Unnest'], uk: ['Вкласти', 'Винести'] };
    for (const [lang, [nest, unnest]] of Object.entries(words)) {
      expect(t(lang, 'editor.tb_nest')).toBe(nest);
      expect(t(lang, 'editor.tb_unnest')).toBe(unnest);
    }
    // Казахский: строка есть, не пустая и не повторяет русскую.
    for (const key of ['editor.tb_nest', 'editor.tb_unnest']) {
      expect(t('kk', key)).not.toBe(key);
      expect(t('kk', key).trim()).not.toBe('');
      expect(t('kk', key)).not.toBe(t('ru', key));
    }
  });

  test('нумерованный — «1.» буквами шрифта заголовков, как «Aa» и «H», а не значок', async () => {
    const q = await bar();
    const glyph = within(q.getByTestId('tb-ordered')).getByText('1.');
    expect(iconOf(q, 'tb-ordered')).toBeNull();
    // Тот же стиль кнопки-буквы, что у «Aa» и «H»: шрифт заголовков, жирный, 17.
    const mine = StyleSheet.flatten(glyph.props.style);
    for (const [id, text] of [['tb-format', 'Aa'], ['tb-block', 'H']]) {
      const other = StyleSheet.flatten(within(q.getByTestId(id)).getByText(text).props.style);
      expect(mine.fontFamily).toBe(other.fontFamily);
      expect(mine.fontSize).toBe(other.fontSize);
    }
    expect(mine.fontFamily).toBe(displayFamily.bold);
    expect(mine.fontSize).toBe(17);
    // Подпись для чтения с экрана — словами, а не «1.».
    expect(q.getByTestId('tb-ordered').props.accessibilityLabel).toBe(t('ru', 'editor.tb_ordered'));
    // Кнопка той же ширины 44, что и соседние: «1.» — два знака, без расширения.
    const box = StyleSheet.flatten(q.getByTestId('tb-ordered').props.style);
    expect(box).toMatchObject({ minWidth: 44, height: 44 });
    expect(box.paddingHorizontal).toBeUndefined();
  });

  test('значки — настоящие из словаря: маркированный, чек-лист, таблица', async () => {
    const q = await bar();
    expect(iconOf(q, 'tb-bullet')).toBe('list-bullet');
    expect(iconOf(q, 'tb-checklist')).toBe('checklist');
    expect(iconOf(q, 'tb-table')).toBe('table');
    await fireEvent.press(q.getByTestId('tb-block'));
    expect(iconOf(q, 'tb-quote')).toBe('quote');
    expect(iconOf(q, 'tb-codeblock')).toBe('code-block');
    await fireEvent.press(q.getByTestId('tb-back'));
    await fireEvent.press(q.getByTestId('tb-format'));
    expect(iconOf(q, 'tb-highlight')).toBe('pen-line');
  });

  test('высота строки 48, кнопки 44×44', async () => {
    const q = await bar();
    expect(StyleSheet.flatten(q.getByTestId('editor-toolbar').props.style).height).toBe(TOOLBAR_HEIGHT);
    expect(TOOLBAR_HEIGHT).toBe(48);
    expect(TOOLBAR_BUTTON).toBe(44);
    for (const k of MAIN_ROW) {
      const s = StyleSheet.flatten(q.getByTestId(`tb-${k}`).props.style);
      expect(s.minWidth).toBe(44);
      expect(s.height).toBe(44);
    }
  });

  test('кнопки не забирают фокус у текста, строка пропускает касания', async () => {
    const q = await bar();
    const all = q.getAllByRole('button');
    expect(all.length).toBe(MAIN_ROW.length + 1); // + «Перо»
    expect(all.map((n) => [n.props.testID, n.props.focusable])).toEqual(all.map((n) => [n.props.testID, false]));
    expect(q.getByTestId('tb-row-main').props.keyboardShouldPersistTaps).toBe('handled');
  });

  test('команды уходят в actions: отмена, три списка, таблица, ссылка, фото', async () => {
    const a = actions();
    const q = await bar({ actions: a, format: fmt({ canUndo: true }) });
    await fireEvent.press(q.getByTestId('tb-undo'));
    await fireEvent.press(q.getByTestId('tb-bullet'));
    await fireEvent.press(q.getByTestId('tb-ordered'));
    await fireEvent.press(q.getByTestId('tb-checklist'));
    await fireEvent.press(q.getByTestId('tb-table'));
    expect(a.exec.mock.calls).toEqual([['undo', undefined], ['bullet', undefined], ['ordered', undefined], ['tasks', undefined], ['table', undefined]]);
    // Любой из списков — сразу список, строка остаётся главной.
    q.getByTestId('tb-row-main');
    await fireEvent.press(q.getByTestId('tb-link'));
    await fireEvent.press(q.getByTestId('tb-photo'));
    expect(a.link).toHaveBeenCalled();
    expect(a.image).toHaveBeenCalled();
  });

  test('отмены нет — кнопка тусклая и не нажимается', async () => {
    const a = actions();
    const q = await bar({ actions: a, format: fmt({ canUndo: false }) });
    expect(q.getByTestId('tb-undo').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(q.getByTestId('tb-undo'));
    expect(a.exec).not.toHaveBeenCalled();
  });
});

describe('группы раскрываются на месте строки', () => {
  test('Aa → начертания и цвет; «назад» — на главную', async () => {
    const q = await bar();
    await fireEvent.press(q.getByTestId('tb-format'));
    expect(buttons(q, 'format')).toEqual(['tb-back', ...GROUP_ROWS.format.map((k) => `tb-${k}`)]);
    expect(q.queryByTestId('tb-row-main')).toBeNull();
    q.getByTestId('tb-pen-mode');
    await fireEvent.press(q.getByTestId('tb-back'));
    expect(buttons(q, 'main')).toEqual(MAIN_IDS);
  });

  test('H → текст, H1–H3, цитата, код; выбор возвращает на главную', async () => {
    const a = actions();
    const q = await bar({ actions: a });
    await fireEvent.press(q.getByTestId('tb-block'));
    expect(buttons(q, 'block')).toEqual(['tb-back', 'tb-paragraph', 'tb-h1', 'tb-h2', 'tb-h3', 'tb-quote', 'tb-codeblock']);
    await fireEvent.press(q.getByTestId('tb-h2'));
    expect(a.exec).toHaveBeenLastCalledWith('heading', 2);
    q.getByTestId('tb-row-main');
  });

  test('«⋯» → редкое: повтор, график, PDF, комментарий, найти, экспорт', async () => {
    const a = actions();
    const q = await bar({ actions: a });
    await fireEvent.press(q.getByTestId('tb-more'));
    expect(buttons(q, 'more')).toEqual(['tb-back', 'tb-redo', 'tb-chart', 'tb-pdf', 'tb-comment', 'tb-find', 'tb-export']);
    await fireEvent.press(q.getByTestId('tb-export'));
    expect(a.exportDoc).toHaveBeenCalled();
    // «PDF» (17 октября 2026) — команда редактора: файл он попросит у телефона (pdf-pick).
    await fireEvent.press(q.getByTestId('tb-more'));
    await fireEvent.press(q.getByTestId('tb-pdf'));
    expect(a.exec).toHaveBeenLastCalledWith('pdf', undefined);
    q.getByTestId('tb-row-main');
  });

  test('курсор в таблице — в «⋯» инструменты таблицы', async () => {
    const a = actions();
    const q = await bar({ actions: a, format: fmt({ inTable: true }) });
    await fireEvent.press(q.getByTestId('tb-more'));
    expect(buttons(q, 'more')).toEqual(['tb-back', 'tb-redo', 'tb-rowBelow', 'tb-colRight', 'tb-rowDel', 'tb-colDel', 'tb-tableDel', 'tb-chart', 'tb-pdf', 'tb-comment', 'tb-find', 'tb-export']);
    await fireEvent.press(q.getByTestId('tb-rowBelow'));
    expect(a.exec).toHaveBeenLastCalledWith('rowBelow', undefined);
  });

  test('цвет текста и маркер — оттенки палитры редактора, выбор уходит именем', async () => {
    const a = actions();
    const q = await bar({ actions: a });
    const sw = editorSwatches('dark');
    await fireEvent.press(q.getByTestId('tb-format'));
    await fireEvent.press(q.getByTestId('tb-color'));
    expect(buttons(q, 'color')).toEqual(['tb-back', 'tb-color-none', ...HUES.map((c) => `tb-color-${c}`)]);
    // Кружок — цвет из theme.js (editorSwatches), тот же, что у буквы в тексте.
    expect(StyleSheet.flatten(q.getByTestId('tb-color-blue').children[0].props.style).backgroundColor).toBe(sw.hues.blue);
    await fireEvent.press(q.getByTestId('tb-color-blue'));
    expect(a.exec).toHaveBeenLastCalledWith('color', 'blue');
    q.getByTestId('tb-row-format');
    await fireEvent.press(q.getByTestId('tb-highlight'));
    await fireEvent.press(q.getByTestId('tb-highlight-none'));
    expect(a.exec).toHaveBeenLastCalledWith('highlight', null);
  });
});

describe('подсветка включённого — по format из редактора', () => {
  test('жирный под курсором: «Aa» и «Ж» подсвечены, курсив — нет', async () => {
    const q = await bar({ format: fmt({ strong: true }) });
    expect(selected(q, 'tb-format')).toBe(true);
    expect(selected(q, 'tb-ordered')).toBe(false);
    await fireEvent.press(q.getByTestId('tb-format'));
    expect(selected(q, 'tb-bold')).toBe(true);
    expect(selected(q, 'tb-italic')).toBe(false);
  });

  test('каждый список под курсором — своя кнопка: маркированный, «1.», чек-лист', async () => {
    const b = await bar({ format: fmt({ list: 'bullet_list' }) });
    expect(selected(b, 'tb-bullet')).toBe(true);
    expect(selected(b, 'tb-ordered')).toBe(false);
    expect(selected(b, 'tb-checklist')).toBe(false);
    const o = await bar({ format: fmt({ list: 'ordered_list' }) });
    expect(selected(o, 'tb-bullet')).toBe(false);
    expect(selected(o, 'tb-ordered')).toBe(true);
    expect(selected(o, 'tb-checklist')).toBe(false);
    // Включённая «1.» — на подложке accentMuted, а буква другого цвета (accentInk).
    const on = StyleSheet.flatten(o.getByTestId('tb-ordered').props.style);
    const off = StyleSheet.flatten(b.getByTestId('tb-ordered').props.style);
    expect(on.backgroundColor).toBeTruthy();
    expect(off.backgroundColor).toBeUndefined();
    const lit = StyleSheet.flatten(within(o.getByTestId('tb-ordered')).getByText('1.').props.style).color;
    const dim = StyleSheet.flatten(within(b.getByTestId('tb-ordered')).getByText('1.').props.style).color;
    expect(lit).not.toBe(dim);
  });

  test('чек-лист, ссылка, заголовок — свои кнопки; «H» пишет уровень', async () => {
    const q = await bar({ format: fmt({ list: 'task_list', link: 'https://x', block: 'h2' }) });
    expect(selected(q, 'tb-checklist')).toBe(true);
    expect(selected(q, 'tb-link')).toBe(true);
    expect(selected(q, 'tb-block')).toBe(true);
    q.getByText('H2');
  });
});

describe('перо', () => {
  test('«Перо» видно всегда: на главной, в группе и в режиме пера', async () => {
    const a = actions();
    const q = await bar({ actions: a });
    await fireEvent.press(q.getByTestId('tb-block'));
    q.getByTestId('tb-pen-mode');
    await fireEvent.press(q.getByTestId('tb-pen-mode'));
    expect(a.ink).toHaveBeenCalledWith(true);
  });

  test('режим пера — строка инструментов; «Готово» и «Перо» выходят из него', async () => {
    const a = actions();
    const q = await bar({ actions: a, inkOn: true, ink: { tool: 'marker', color: 'red', size: 5 } });
    expect(buttons(q, 'ink')).toEqual(INK_ROW.map((k) => `tb-${k}`));
    expect(selected(q, 'tb-marker')).toBe(true);
    expect(selected(q, 'tb-pen')).toBe(false);
    expect(selected(q, 'tb-pen-mode')).toBe(true);
    await fireEvent.press(q.getByTestId('tb-eraser'));
    expect(a.inkTool).toHaveBeenCalledWith('eraser');
    await fireEvent.press(q.getByTestId('tb-inkUndo'));
    expect(a.exec).toHaveBeenLastCalledWith('inkUndo', undefined);
    await fireEvent.press(q.getByTestId('tb-inkDone'));
    expect(a.ink).toHaveBeenLastCalledWith(false);
    await fireEvent.press(q.getByTestId('tb-pen-mode'));
    expect(a.ink).toHaveBeenLastCalledWith(false);
  });

  test('цвет и толщина пера раскрываются на месте и возвращают в строку пера', async () => {
    const a = actions();
    const q = await bar({ actions: a, inkOn: true });
    await fireEvent.press(q.getByTestId('tb-inkColor'));
    expect(buttons(q, 'inkColor')).toEqual(['tb-back', ...INK_COLORS.map((c) => `tb-inkColor-${c}`)]);
    await fireEvent.press(q.getByTestId('tb-inkColor-teal'));
    expect(a.inkColor).toHaveBeenCalledWith('teal');
    q.getByTestId('tb-row-ink');
    await fireEvent.press(q.getByTestId('tb-inkSize'));
    await fireEvent.press(q.getByTestId('tb-inkSize-8'));
    expect(a.inkSize).toHaveBeenCalledWith(8);
  });
});

describe('видимость', () => {
  test('скрытая панель не рисуется', async () => {
    const q = await bar({ visible: false });
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
  });

  test('клавиатура сменила раскладку (на миг закрылась) — панель не мигает', async () => {
    jest.useFakeTimers();
    try {
      const { result, rerender } = await renderHook(({ want }) => useToolbarVisible(want), { initialProps: { want: true } });
      expect(result.current).toBe(true);
      await rerender({ want: false });
      await act(async () => { jest.advanceTimersByTime(TOOLBAR_HIDE_DELAY - 50); });
      await rerender({ want: true });
      await act(async () => { jest.advanceTimersByTime(TOOLBAR_HIDE_DELAY * 2); });
      expect(result.current).toBe(true);
      await rerender({ want: false });
      await act(async () => { jest.advanceTimersByTime(TOOLBAR_HIDE_DELAY + 10); });
      expect(result.current).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('панель держало одно выделение (instant) — уходит сразу, без задержки клавиатуры', async () => {
    // 18 октября 2026, протокол 4: без клавиатуры обычная строка иначе
    // мелькнула бы на 300 мс над шитом (editorContext.test.js).
    jest.useFakeTimers();
    try {
      const { result, rerender } = await renderHook(({ want, instant }) => useToolbarVisible(want, instant), { initialProps: { want: true, instant: false } });
      await rerender({ want: false, instant: true });
      expect(result.current).toBe(false);
      await rerender({ want: true, instant: false });
      expect(result.current).toBe(true);
      // Без instant — прежняя задержка.
      await rerender({ want: false, instant: false });
      expect(result.current).toBe(true);
      await act(async () => { jest.advanceTimersByTime(TOOLBAR_HIDE_DELAY + 10); });
      expect(result.current).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('парящий остров (19 октября 2026)', () => {
  const flat = (q, id) => StyleSheet.flatten(q.getByTestId(id).props.style);
  const lift = (q) => (flat(q, 'editor-toolbar-dock').transform || []).find((x) => 'translateY' in x).translateY;
  /** Клавиатура по кадрам (подмена библиотеки): высота — вниз, минусом. */
  const kbFrames = (h) => { KeyboardLib.useReanimatedKeyboardAnimation().height.value = -h; };
  afterEach(() => { kbFrames(0); useSafeAreaInsets().bottom = 0; });

  test('остров: скругление острова, поверхность и тень плавающего — токенами темы; линий нет', async () => {
    for (const theme of ['dark', 'light']) {
      await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } }); });
      const hook = await renderHook(() => useColors());
      const palette = hook.result.current;
      await hook.unmount();
      const q = await bar();
      const s = flat(q, 'editor-toolbar');
      expect(s.height).toBe(TOOLBAR_HEIGHT);
      expect(s.borderRadius).toBe(radius.lg);
      expect(s.backgroundColor).toBe(palette.floating);
      expect(s.boxShadow).toEqual(floatingShadow(palette));
      expect(s.boxShadow[0].color).toBe(palette.shadow);
      // Тень — boxShadow, не системная elevation; рамок и линии сверху нет.
      expect(s.elevation || 0).toBe(0);
      expect(s.borderWidth || 0).toBe(0);
      expect(s.borderTopWidth || 0).toBe(0);
      await q.unmount();
    }
  });

  test('строка листается внутри острова и режется его скруглением; тень на внешнем слое не срезана', async () => {
    const q = await bar();
    const outer = flat(q, 'editor-toolbar');
    const clip = flat(q, 'editor-toolbar-clip');
    expect(clip).toMatchObject({ flex: 1, flexDirection: 'row', overflow: 'hidden', borderRadius: radius.lg });
    expect(outer.overflow).not.toBe('hidden');
    const inner = within(q.getByTestId('editor-toolbar-clip'));
    expect(inner.getByTestId('tb-row-main').props.horizontal).toBe(true);
    inner.getByTestId('tb-pen-mode');
  });

  test('тень одна на всё плавающее — в theme.js; плашка идущей задачи берёт её же', () => {
    expect(floatingShadow({ shadow: 'X' })).toEqual([expect.objectContaining({ color: 'X', blurRadius: expect.any(Number), spreadDistance: 0 })]);
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'components', f), 'utf8');
    expect(read('TimerMiniPlayer.js')).toMatch(/boxShadow: floatingShadow\(colors\)/);
    // Своих чисел тени у панели нет.
    expect(read('EditorToolbar.js')).not.toMatch(/blurRadius|elevation:/);
  });

  test('в доке: от краёв экрана — боковое поле страницы, от опоры — воздух TOOLBAR_GAP', async () => {
    expect(TOOLBAR_GAP).toBe(spacing.sm);
    expect(TOOLBAR_SPACE).toBe(TOOLBAR_HEIGHT + TOOLBAR_GAP);
    const q = await render(<EditorToolbar lang="ru" format={fmt()} actions={actions()} />);
    expect(flat(q, 'editor-toolbar-dock')).toMatchObject({ position: 'absolute', left: screenPadding, right: screenPadding, bottom: 0 });
    // Ни клавиатуры, ни системной панели — у низа экрана, с воздухом.
    expect(lift(q)).toBe(-TOOLBAR_GAP);
    // Опора ниже — число (верх свёрнутого шита): над ней с тем же воздухом.
    await q.rerender(<EditorToolbar lang="ru" format={fmt()} actions={actions()} floor={130} />);
    expect(lift(q)).toBe(-(130 + TOOLBAR_GAP));
  });

  test('клавиатура открыта — остров над ней с воздухом; без неё — над системной панелью жестов', async () => {
    useSafeAreaInsets().bottom = 24;
    const q = await render(<EditorToolbar lang="ru" format={fmt()} actions={actions()} />);
    expect(lift(q)).toBe(-(24 + TOOLBAR_GAP));
    kbFrames(300);
    await q.rerender(<EditorToolbar lang="ru" format={fmt({ bold: true })} actions={actions()} />);
    expect(lift(q)).toBe(-(300 + TOOLBAR_GAP));
    // Шит выше клавиатуры не бывает, но выше — всегда то, что выше.
    await q.rerender(<EditorToolbar lang="ru" format={fmt()} actions={actions()} floor={130} />);
    expect(lift(q)).toBe(-(300 + TOOLBAR_GAP));
  });

  test('строка пера — в том же острове и на том же месте', async () => {
    const q = await render(<EditorToolbar lang="ru" format={fmt()} actions={actions()} inkOn />);
    q.getByTestId('tb-row-ink');
    within(q.getByTestId('editor-toolbar-clip')).getByTestId('tb-row-ink');
    expect(flat(q, 'editor-toolbar').borderRadius).toBe(radius.lg);
    expect(lift(q)).toBe(-TOOLBAR_GAP);
  });

  test('документ на весь экран: снизу места на клавиатуру, остров и воздух под ним', async () => {
    const shown = await renderHook(() => useEditorInset(true));
    expect(StyleSheet.flatten(shown.result.current).paddingBottom).toBe(TOOLBAR_SPACE);
    kbFrames(300);
    const typing = await renderHook(() => useEditorInset(true));
    expect(StyleSheet.flatten(typing.result.current).paddingBottom).toBe(300 + TOOLBAR_SPACE);
    const hidden = await renderHook(() => useEditorInset(false));
    expect(StyleSheet.flatten(hidden.result.current).paddingBottom).toBe(300);
  });
});

describe('мост', () => {
  test('команды хозяина — сообщения протокола', () => {
    const sent = [];
    const b = createBridge((m) => sent.push(m));
    b.exec('bold');
    b.exec('heading', 2);
    b.setLink('example.com', 'пример');
    b.insertImage({ dataUrl: 'data:image/png;base64,AA', name: 'a.png' });
    b.insertImage();
    b.ink(true);
    b.ink(false);
    b.inkTool('marker');
    b.getState();
    expect(sent).toEqual([
      { type: 'exec', name: 'bold' },
      { type: 'exec', name: 'heading', arg: 2 },
      { type: 'setLink', href: 'example.com', text: 'пример' },
      { type: 'insertImage', dataUrl: 'data:image/png;base64,AA', name: 'a.png' },
      { type: 'insertImage', cancel: true },
      { type: 'exec', name: 'annotate', arg: true },
      { type: 'exec', name: 'inkDone' },
      { type: 'exec', name: 'inkTool', arg: 'marker' },
      { type: 'getState' },
    ]);
  });

  test('сообщения страницы — в одном виде', () => {
    expect(parseMessage('не json')).toBeNull();
    expect(parseMessage(JSON.stringify({ nope: 1 }))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'height', px: 300, height: 300 }))).toEqual({ type: 'height', px: 300 });
    expect(parseMessage(JSON.stringify({ type: 'height', height: 120 }))).toEqual({ type: 'height', px: 120 });
    expect(parseMessage(JSON.stringify({ type: 'drawing', on: true }))).toEqual({ type: 'ink', on: true });
    expect(parseMessage(JSON.stringify({ type: 'ink', on: true, tool: 'pen', color: 'red', size: 3, recent: [] }))).toEqual({ type: 'ink', on: true, tool: 'pen', color: 'red', size: 3 });
    expect(parseMessage(JSON.stringify({ type: 'link', href: 'https://a', needText: true }))).toEqual({ type: 'link', href: 'https://a', needText: true });
    expect(parseMessage(JSON.stringify({ type: 'image-pick', purpose: 'replace' }))).toEqual({ type: 'image-pick', purpose: 'replace' });
    expect(parseMessage(JSON.stringify({ type: 'caret', top: 10, bottom: 30 }))).toEqual({ type: 'caret', top: 10, bottom: 30 });
    const f = parseMessage(JSON.stringify({ type: 'format', state: { strong: 1, block: 'h1', fontSize: 'l', threads: 2 } })).state;
    expect(f.strong).toBe(true);
    expect(f.block).toBe('h1');
    expect(f).not.toHaveProperty('fontSize');
    expect(sameFormat(f, { ...f })).toBe(true);
    expect(sameFormat(f, { ...f, em: true })).toBe(false);
  });

  test('масштаба текста телефон не шлёт: команды setZoom у моста нет', () => {
    // 13 октября 2026 щипок убран: мешал писать. Редактор setZoom понимает —
    // для десктопа, — но телефон его не знает.
    const b = createBridge(() => {});
    expect(b.setZoom).toBeUndefined();
  });
});

// Плашка проекта в строке задачи («Сегодня», «Задачи»: TaskRow, showProject) красится
// так же, как бейдж тега. Запуск: npm run test:mobile
//
// Бейдж тега — подложка цветом тега с прозрачностью и надпись, смешанная с цветом
// текста темы (lib/tags.js, badgeColors): на белом яркий цвет без смешивания
// нечитаем. Плашка проекта брала сам цвет проекта как цвет надписи — на светлой
// теме это выглядело плохо (контраст жёлтого на белом около 1,5), а у тегов было
// хорошо. Теперь формула одна на оба, для обеих тем.
import { StyleSheet } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import TagBadge from '../src/components/TagBadge';
import TaskRow from '../src/components/TaskRow';
import { badgeColors, badgeBg, badgeInk } from '../src/lib/tags';
import { useAppStore } from '../src/store/useAppStore';
import { useColors } from '../src/theme';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const COLORS = ['#87ff65', '#f5c451', '#5ec8f2', '#ff5c50', '#7c4bd6', '#69d345'];
const task = { id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: null, done: false, totalMs: 0, sessions: [], tagIds: [], dueAt: null, pinnedAt: null };

const setTheme = (theme) => useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme } });
const paletteOf = async (theme) => { setTheme(theme); const { result } = await renderHook(() => useColors()); return result.current; };

beforeEach(() => {
  useAppStore.setState({ statuses: [], versions: [], tags: [], tasks: [task], activeTimer: null });
});

describe.each(['dark', 'light'])('тема %s', (theme) => {
  test('badgeColors даёт то же, что считает бейдж тега: подложка 0.16, надпись с долей цвета темы', async () => {
    const palette = await paletteOf(theme);
    const share = theme === 'light' ? 0.34 : 0.62;
    for (const color of COLORS) {
      expect(badgeColors(color, palette.text, theme)).toEqual({ bg: badgeBg(color, 0.16), ink: badgeInk(color, palette.text, share) });
    }
  });

  test.each(COLORS)('цвет %s: плашка проекта и бейдж тега — одна подложка и одна надпись', async (color) => {
    await paletteOf(theme);
    useAppStore.setState({ projects: [{ id: 'p1', name: 'Сайт', color, createdAt: '2026-10-01T00:00:00.000Z' }] });

    const tag = await render(<TagBadge tag={{ id: 'g1', name: 'Срочное', color }} />);
    const tagText = tag.getByText('Срочное');
    const tagBg = flat(tagText.parent).backgroundColor;
    const tagInk = flat(tagText).color;

    const row = await render(<TaskRow task={task} showProject onPress={() => {}} />);
    const chip = row.getByTestId('task-project-t1');
    expect(flat(chip).backgroundColor).toBe(tagBg);
    expect(flat(row.getByText('Сайт')).color).toBe(tagInk);
    // Надпись — не сам цвет проекта (так она и была нечитаемой).
    expect(tagInk).not.toBe(color);
  });
});

test('светлая тема: надпись плашки темнее цвета проекта (читается на белом)', async () => {
  const light = await paletteOf('light');
  const { ink } = badgeColors('#f5c451', light.text, 'light');
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(lum(ink)).toBeLessThan(lum('#f5c451'));
  expect((1.05) / (lum(ink) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

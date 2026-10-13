// Поле ввода — одно на приложение (Field из components/AppTextInput.js). Запуск: npm run test:mobile
//
// 11 октября 2026: поля версий в окне проекта («1», «2», «3» и «Название
// версии») были со своей рамкой, скруглением 8 и ниже соседних полей, а
// квадратная «+» рядом — крупнее поля. Теперь у них вид общего поля — того же,
// что «Название» проекта выше, — а «+» квадрат той же высоты, что поле.
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import VersionsEditor from '../src/components/VersionsEditor';
import { fieldStyle } from '../src/components/AppTextInput';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors, buttonHeight, radius } from '../src/theme';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const LOOK = ['backgroundColor', 'borderRadius', 'borderWidth', 'paddingHorizontal', 'paddingVertical', 'minHeight', 'fontSize', 'color'];
const look = (node) => Object.fromEntries(LOOK.map((k) => [k, flat(node)[k]]));

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    tasks: [],
    tags: [],
    versions: ['1', '2', '3'].map((name, i) => ({ id: `v${i + 1}`, projectId: 'p1', name, order: i, releasedAt: null, createdAt: '2026-10-01T00:00:00.000Z' })),
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

describe.each(['dark', 'light'])('поля версий — общее поле (%s)', (theme) => {
  beforeEach(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } }));

  test('«1», «2», «3» и «Название версии» выглядят как «Название» проекта: без рамки, скругление поля, высота кнопки', async () => {
    const { result } = await renderHook(() => useColors());
    // С 12 октября 2026 название и версии — разные страницы настроек проекта:
    // «Название» — со страницы «Название и описание», версии — со своей.
    const project = { id: 'p1', name: 'Сайт', color: '#87ff65' };
    openSheet(<NewProjectSheet project={project} section="name" onCreated={() => {}} onCancel={() => {}} />);
    const s = await render(<BottomSheet />);
    const name = look(s.getByTestId('project-form-name'));
    expect(name).toMatchObject({ backgroundColor: result.current.inputBg, borderRadius: radius.md, minHeight: buttonHeight });
    expect(name.borderWidth).toBeUndefined();
    await s.unmount();
    useSheetStore.setState({ content: null, header: null, footer: null });
    openSheet(<NewProjectSheet project={project} section="versions" onCreated={() => {}} onCancel={() => {}} />);
    const v = await render(<BottomSheet />);
    for (const id of ['version-name-v1', 'version-name-v2', 'version-name-v3', 'version-new-name']) {
      expect({ id, ...look(v.getByTestId(id)) }).toEqual({ id, ...name });
    }
  });
});

test('«+» — квадрат высотой с поле рядом', async () => {
  const { result } = await renderHook(() => useColors());
  const s = await render(<VersionsEditor projectId="p1" lang="ru" />);
  const field = flat(s.getByTestId('version-new-name'));
  const plus = flat(s.getByTestId('primary-button'));
  expect(plus.height).toBe(field.minHeight);
  expect(plus.width).toBe(plus.height);
  // Высота однострочного поля — тот же токен, что у кнопки.
  expect(fieldStyle(result.current).minHeight).toBe(buttonHeight);
});

test('занятое имя — красная рамка поля, высота та же', async () => {
  const { result } = await renderHook(() => useColors());
  const s = await render(<VersionsEditor projectId="p1" lang="ru" />);
  await fireEvent.changeText(s.getByTestId('version-new-name'), '2');
  const f = flat(s.getByTestId('version-new-name'));
  expect(f.borderColor).toBe(result.current.danger);
  expect(f.minHeight).toBe(buttonHeight);
});

test('исходник VersionsEditor: своего вида полей нет — ни рамки, ни подложки, ни скругления', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'VersionsEditor.js'), 'utf8');
  const name = src.match(/\bname: \{([^}]*)\}/)[1];
  expect(name).not.toMatch(/borderWidth|backgroundColor|borderRadius|padding|fontSize/);
  expect(src).toMatch(/<Field\b/);
  expect(src).not.toMatch(/<TextInput\b/);
});

// Переключатель (components/Switch.js). Запуск: npm run test:mobile
//
// На iOS — системный UISwitch. На Android — настоящий MaterialSwitch из
// локального модуля modules/lancible-material-switch, а где модуля нет (Expo
// Go, jest) — свой, нарисованный в стиле Material 3: системный SwitchCompat RN
// рисует старый вид. Проверяется применение, а не пиксели: что выбирается по
// платформе и наличию модуля, что нативному виду уходят токены и значение, а
// значение назад приходит событием; что у рисованного выкл и вкл положений
// разные слои с цветами из токенов, что кружок читается на своей дорожке
// (контраст не ниже 3:1, обе темы), что доступность честная и что все
// переключатели приложения — этот компонент, а не RN Switch напрямую.
//
// Kotlin в jest не собирается (сборку проверяет Gradle), поэтому здесь же
// сверяется, что нативная часть модуля на месте и говорит с JS одними именами.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Platform, StyleSheet, processColor } from 'react-native';
import { render, renderHook, fireEvent } from '@testing-library/react-native';
import Switch from '../src/components/Switch';
import SettingsScreen from '../src/screens/SettingsScreen';
import OnboardingScreen from '../src/screens/auth/OnboardingScreen';
import RepeatSheet from '../src/components/RepeatSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useColors, switchSize } from '../src/theme';
import { ICONS } from '../src/core/icons';

// Подмена модуля из jest.setup.js: { MaterialSwitchView: null }. Тесты
// нативного варианта кладут на место null хост-элемент с именем вида.
const nativeModule = jest.requireMock('../modules/lancible-material-switch');
const MODULE_DIR = join(__dirname, '..', 'modules', 'lancible-material-switch');
const moduleFile = (...parts) => readFileSync(join(MODULE_DIR, ...parts), 'utf8');
const KOTLIN_DIR = ['android', 'src', 'main', 'java', 'com', 'lancible', 'materialswitch'];

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const noop = () => {};

// Контраст по WCAG: (L1 + 0.05) / (L2 + 0.05), цвета — #rrggbb или #rgb из
// темы (белый кружок — textOnColor '#fff').
function luminance(hex) {
  const h = hex.slice(1);
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let os;
const setOS = (name) => { os = jest.replaceProperty(Platform, 'OS', name); };
afterEach(() => { if (os) os.restore(); os = null; });

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
  useAuthStore.setState({ status: 'signedOut', user: null, signOut: jest.fn() });
});

describe('Android: свой переключатель в стиле Material 3', () => {
  beforeEach(() => setOS('android'));

  test('размер M3: дорожка 52×32; кружок 16 в выкл, 24 во вкл, 28 под пальцем', async () => {
    expect(switchSize).toMatchObject({ width: 52, height: 32, thumbOff: 16, thumbOn: 24, thumbPressed: 28 });
    const off = await render(<Switch value={false} onValueChange={noop} accessibilityLabel="Напомнить" />);
    const sw = off.getByRole('switch');
    expect(flat(sw)).toMatchObject({ width: 52, height: 32 });
    // Масштаб кружка — доля его коробки (28): 16/28 в выкл, 24/28 во вкл, 1 под пальцем.
    const scale = (screen) => flat(screen.getByTestId('switch-thumb')).transform.find((x) => x.scale !== undefined).scale;
    expect(scale(off) * 28).toBeCloseTo(16);
    await fireEvent(sw, 'pressIn');
    expect(scale(off) * 28).toBeCloseTo(28);
    await fireEvent(sw, 'pressOut');
    expect(scale(off) * 28).toBeCloseTo(16);
    await off.unmount();
    const on = await render(<Switch value onValueChange={noop} accessibilityLabel="Напомнить" />);
    expect(scale(on) * 28).toBeCloseTo(24);
  });

  test('кружок слева в выкл и справа во вкл; крупнее во вкл', async () => {
    const x = (screen) => flat(screen.getByTestId('switch-thumb')).transform.find((v) => v.translateX !== undefined).translateX + 14;
    const off = await render(<Switch value={false} onValueChange={noop} />);
    const centerOff = x(off);
    await off.unmount();
    const on = await render(<Switch value onValueChange={noop} />);
    // Центр кружка: в выкл — 16 от левого края, во вкл — 16 от правого.
    expect(centerOff).toBe(16);
    expect(x(on)).toBe(52 - 16);
  });

  test('выкл: слой «выкл» виден, «вкл» и галочка прозрачны; вкл — наоборот', async () => {
    const off = await render(<Switch value={false} onValueChange={noop} />);
    expect(flat(off.getByTestId('switch-track-on')).opacity).toBe(0);
    expect(flat(off.getByTestId('switch-thumb-on')).opacity).toBe(0);
    await off.unmount();
    const on = await render(<Switch value onValueChange={noop} />);
    expect(flat(on.getByTestId('switch-track-on')).opacity).toBe(1);
    expect(flat(on.getByTestId('switch-thumb-on')).opacity).toBe(1);
  });

  test('галочка — внутри «вкл» кружка, и только он её показывает', async () => {
    const screen = await render(<Switch value onValueChange={noop} />);
    const thumbOn = screen.getByTestId('switch-thumb-on');
    // В «выкл» кружке иконок нет, в «вкл» — одна (react-native-svg).
    expect(screen.getByTestId('switch-thumb-off').children).toHaveLength(0);
    expect(thumbOn.children).toHaveLength(1);
  });

  test.each(['dark', 'light'])('цвета — токены темы (%s), кружок читается на дорожке (≥ 3:1)', async (theme) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    const screen = await render(<Switch value onValueChange={noop} />);

    // Выкл: тёмная дорожка switchOff с контуром borderStrong, кружок белый.
    const trackOff = flat(screen.getByTestId('switch-track-off'));
    expect(trackOff.backgroundColor).toBe(c.switchOff);
    expect(trackOff.borderColor).toBe(c.borderStrong);
    expect(trackOff.borderWidth).toBe(switchSize.border);
    const thumbOff = flat(screen.getByTestId('switch-thumb-off')).backgroundColor;
    expect(thumbOff).toBe(c.textOnColor);
    expect(contrast(thumbOff, trackOff.backgroundColor)).toBeGreaterThanOrEqual(3);

    // Вкл: зелёная дорожка switchOn, кружок белый.
    const trackOn = flat(screen.getByTestId('switch-track-on')).backgroundColor;
    expect(trackOn).toBe(c.switchOn);
    const thumbOn = flat(screen.getByTestId('switch-thumb-on')).backgroundColor;
    expect(thumbOn).toBe(c.textOnColor);
    expect(contrast(thumbOn, trackOn)).toBeGreaterThanOrEqual(3);
    // Галочка на белом кружке — тёмная (accentText), читается тем же правилом.
    const walk = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); (n.children || []).forEach((x) => walk(x, out)); } return out; };
    const paths = walk(screen.getByTestId('switch-thumb-on')).filter((n) => n.type === 'RNSVGPath');
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.props.fill.payload).toBe(processColor(c.accentText));
    expect(contrast(c.accentText, thumbOn)).toBeGreaterThanOrEqual(3);
  });

  test.each(['dark', 'light'])('кружок белый в обоих положениях, дорожки — зелёная и тёмная (%s)', async (theme) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    expect(c.textOnColor.toLowerCase()).toMatch(/^#f{3}(f{3})?$/);
    // Зелёная — оттенок акцента: зелёный канал ведёт, как у accent.
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = rgb(c.switchOn);
    expect(g).toBeGreaterThan(r * 1.5);
    expect(g).toBeGreaterThan(b * 2);
    // Выкл-дорожка заметно темнее белого кружка и не зелёная.
    const [or, og, ob] = rgb(c.switchOff);
    expect(Math.max(or, og, ob) - Math.min(or, og, ob)).toBeLessThan(16);
    expect(contrast(c.textOnColor, c.switchOff)).toBeGreaterThanOrEqual(3);
    // Сам переключатель во вкл отличим от острова, на котором стоит.
    expect(contrast(c.switchOn, c.panel)).toBeGreaterThanOrEqual(3);
  });

  test('доступность: роль switch, checked в состоянии, подпись; выключенный — disabled', async () => {
    const off = await render(<Switch value={false} onValueChange={noop} accessibilityLabel="Напомнить" />);
    let sw = off.getByRole('switch', { name: 'Напомнить' });
    expect(sw.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    await off.unmount();
    const on = await render(<Switch value onValueChange={noop} accessibilityLabel="Напомнить" disabled />);
    sw = on.getByRole('switch', { name: 'Напомнить' });
    expect(sw.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  });

  test('нажатие отдаёт противоположное значение; выключенный не реагирует', async () => {
    const onValueChange = jest.fn();
    const screen = await render(<Switch value={false} onValueChange={onValueChange} accessibilityLabel="Тема" />);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onValueChange).toHaveBeenLastCalledWith(true);
    await screen.rerender(<Switch value onValueChange={onValueChange} accessibilityLabel="Тема" />);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onValueChange).toHaveBeenLastCalledWith(false);
    onValueChange.mockClear();
    await screen.rerender(<Switch value onValueChange={onValueChange} accessibilityLabel="Тема" disabled />);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('зона касания не ниже 44 pt по высоте', async () => {
    const screen = await render(<Switch value onValueChange={noop} />);
    const slop = screen.getByRole('switch').props.hitSlop;
    expect(switchSize.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });
});

describe('Android: нативный MaterialSwitch, когда модуль собран (APK)', () => {
  let view;
  beforeEach(() => {
    setOS('android');
    view = jest.replaceProperty(nativeModule, 'MaterialSwitchView', 'LancibleMaterialSwitch');
  });
  afterEach(() => view.restore());

  test('рисуется нативный вид, рисованных слоёв нет; значение и выключенность — пропами', async () => {
    const screen = await render(<Switch value onValueChange={noop} accessibilityLabel="Напомнить" testID="sw" />);
    const host = screen.getByTestId('sw');
    expect(host.type).toBe('LancibleMaterialSwitch');
    expect(host.props).toMatchObject({ value: true, disabled: false });
    expect(screen.queryByTestId('switch-track-off')).toBeNull();
    expect(screen.queryByTestId('switch-thumb')).toBeNull();
  });

  test.each(['dark', 'light'])('цвета — токены темы (%s), те же, что у рисованного', async (theme) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    const screen = await render(<Switch value={false} onValueChange={noop} testID="sw" />);
    // Вкл — зелёная дорожка, белый кружок, тёмная галочка; выкл — тёмная
    // дорожка с контуром и тот же белый кружок.
    expect(screen.getByTestId('sw').props).toMatchObject({
      trackOnColor: c.switchOn, thumbOnColor: c.textOnColor, iconColor: c.accentText,
      trackOffColor: c.switchOff, outlineOffColor: c.borderStrong, thumbOffColor: c.textOnColor,
    });
    const p = screen.getByTestId('sw').props;
    expect(contrast(p.thumbOnColor, p.trackOnColor)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.thumbOffColor, p.trackOffColor)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.iconColor, p.thumbOnColor)).toBeGreaterThanOrEqual(3);
  });

  test('новое значение приходит событием вида; само значение решает экран', async () => {
    const onValueChange = jest.fn();
    const screen = await render(<Switch value={false} onValueChange={onValueChange} testID="sw" />);
    await fireEvent(screen.getByTestId('sw'), 'valueChange', { nativeEvent: { value: true } });
    expect(onValueChange).toHaveBeenCalledWith(true);
    // Экран значение не сменил — вид остаётся выключенным: его ведёт value.
    expect(screen.getByTestId('sw').props.value).toBe(false);
    await screen.rerender(<Switch value onValueChange={onValueChange} testID="sw" />);
    expect(screen.getByTestId('sw').props.value).toBe(true);
  });

  test('доступность — на обёртке: роль switch, подпись, checked и disabled', async () => {
    const off = await render(<Switch value={false} onValueChange={noop} accessibilityLabel="Напомнить" />);
    let sw = off.getByRole('switch', { name: 'Напомнить' });
    expect(sw.type).toBe('LancibleMaterialSwitch');
    expect(sw.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    await off.unmount();
    const on = await render(<Switch value onValueChange={noop} accessibilityLabel="Напомнить" disabled />);
    sw = on.getByRole('switch', { name: 'Напомнить' });
    expect(sw.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(sw.props.disabled).toBe(true);
    // Выключенный — полупрозрачный, как рисованный.
    expect(flat(sw).opacity).toBe(0.5);
  });

  test('в раскладке 52×32, как рисованный; рамка и зона касания — 48 (M3)', async () => {
    const screen = await render(<Switch value onValueChange={noop} testID="sw" />);
    const s = flat(screen.getByTestId('sw'));
    expect(s.width).toBe(switchSize.width);
    expect(s.height).toBe(48);
    expect(s.height + 2 * s.marginVertical).toBe(switchSize.height);
  });

  test('меню: переключатели темы и напоминаний — нативные, с подписями', async () => {
    const screen = await render(<SettingsScreen navigation={{ navigate: noop }} />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    for (const sw of switches) {
      expect(sw.type).toBe('LancibleMaterialSwitch');
      expect(sw.props.accessibilityLabel).toBeTruthy();
    }
    expect(screen.queryByTestId('switch-track-off')).toBeNull();
  });
});

describe('Android без модуля (Expo Go, jest): рисованный вариант', () => {
  test('модуля нет — рисуется свой переключатель', async () => {
    setOS('android');
    expect(nativeModule.MaterialSwitchView).toBeNull();
    const screen = await render(<Switch value onValueChange={noop} testID="sw" />);
    expect(screen.getByTestId('sw').type).not.toBe('LancibleMaterialSwitch');
    expect(screen.getByTestId('switch-track-off')).toBeTruthy();
  });
});

describe('iOS: системный UISwitch', () => {
  beforeEach(() => setOS('ios'));

  test('даже с модулем в сборке — системный: модуль только для Android', async () => {
    const view = jest.replaceProperty(nativeModule, 'MaterialSwitchView', 'LancibleMaterialSwitch');
    try {
      const screen = await render(<Switch value onValueChange={noop} testID="sw" />);
      expect(screen.getByTestId('sw').type).toBe('RCTSwitch');
    } finally {
      view.restore();
    }
  });

  test('рисуется RN Switch, своих слоёв нет; цвета — токены', async () => {
    const { result } = await renderHook(() => useColors());
    const screen = await render(<Switch value onValueChange={noop} accessibilityLabel="Напомнить" testID="sw" />);
    expect(screen.queryByTestId('switch-track-off')).toBeNull();
    // Хост-элемент системного переключателя: RCTSwitch (UISwitch на iOS).
    const native = screen.getByTestId('sw');
    expect(native.type).toBe('RCTSwitch');
    expect(native.props.value).toBe(true);
    expect(native.props.onTintColor).toBe(result.current.accent);
    expect(native.props.tintColor).toBe(result.current.raise);
    expect(native.props.thumbTintColor).toBe(result.current.textOnColor);
    expect(native.props.accessibilityLabel).toBe('Напомнить');
  });

  test('значение уходит наружу как есть', async () => {
    const onValueChange = jest.fn();
    const screen = await render(<Switch value={false} onValueChange={onValueChange} testID="sw" />);
    await fireEvent(screen.getByTestId('sw'), 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});

describe('все переключатели приложения — этот компонент', () => {
  test('RN Switch подключён только в components/Switch.js', () => {
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== 'core') walk(full); } else if (name.endsWith('.js')) files.push(full);
      }
    })(join(__dirname, '..', 'src'));
    for (const file of files) {
      if (file.endsWith('components\\Switch.js') || file.endsWith('components/Switch.js')) continue;
      const src = readFileSync(file, 'utf8');
      const imports = src.match(/import\s*\{[^}]*\}\s*from 'react-native';/g) || [];
      expect({ file, native: imports.some((i) => /\bSwitch\b/.test(i)) }).toEqual({ file, native: false });
    }
  });

  test('меню: переключатели темы, напоминаний — на Android свои, с подписями', async () => {
    setOS('android');
    const screen = await render(<SettingsScreen navigation={{ navigate: noop }} />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    for (const sw of switches) {
      expect(sw.props.accessibilityLabel).toBeTruthy();
      expect(typeof sw.props.accessibilityState.checked).toBe('boolean');
    }
    expect(screen.getAllByTestId('switch-track-off')).toHaveLength(switches.length);
  });

  test('согласие: свой переключатель на Android включает «Продолжить»', async () => {
    setOS('android');
    const complete = jest.fn(async () => ({ ok: true }));
    useAuthStore.setState({ completeOnboarding: complete, signOut: jest.fn() });
    const screen = await render(<OnboardingScreen />);
    const sw = screen.getByTestId('consent-switch');
    expect(sw.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(sw);
    expect(screen.getByTestId('consent-switch').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByText('Продолжить'));
    expect(complete).toHaveBeenCalled();
  });

  test('повтор: «повторять с историей» — переключатель, и он меняет правило', async () => {
    setOS('android');
    const onApply = jest.fn();
    const screen = await render(<RepeatSheet lang="ru" anchorAt={null} rule={{ freq: 'week', interval: 1, weekdays: [1], keepHistory: false }} onApply={onApply} onClear={noop} />);
    const sw = screen.getByRole('switch');
    expect(sw.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(sw);
    expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(true);
  });
});

describe('модуль lancible-material-switch: нативная часть на месте и говорит с JS одними именами', () => {
  const kotlin = (file) => moduleFile(...KOTLIN_DIR, file);

  test('expo-module.config.json: только Android, класс модуля — тот, что в Kotlin', () => {
    const config = JSON.parse(moduleFile('expo-module.config.json'));
    expect(config.platforms).toEqual(['android']);
    expect(config.android.modules).toEqual(['com.lancible.materialswitch.LancibleMaterialSwitchModule']);
    const src = kotlin('LancibleMaterialSwitchModule.kt');
    expect(src).toMatch(/^package com\.lancible\.materialswitch$/m);
    expect(src).toMatch(/class LancibleMaterialSwitchModule : Module\(\)/);
  });

  test('build.gradle: модуль Expo с зависимостью material не старше 1.9 (в ней MaterialSwitch)', () => {
    const gradle = moduleFile('android', 'build.gradle');
    expect(gradle).toMatch(/id 'expo-module-gradle-plugin'/);
    expect(gradle).toMatch(/namespace "com\.lancible\.materialswitch"/);
    const version = gradle.match(/"com\.google\.android\.material:material:(\d+)\.(\d+)\.(\d+)"/);
    expect(version).not.toBeNull();
    const [major, minor] = version.slice(1).map(Number);
    expect(major > 1 || (major === 1 && minor >= 9)).toBe(true);
    // Вид — MaterialSwitch, а не SwitchCompat, и он в теме Material 3.
    const view = kotlin('LancibleMaterialSwitchView.kt');
    expect(view).toMatch(/: MaterialSwitch\(context\)/);
    expect(view).toMatch(/ContextThemeWrapper\(context, com\.google\.android\.material\.R\.style\.Theme_Material3_/);
  });

  test('имя модуля, событие и пропы — одни в Kotlin, index.js и Switch.js', async () => {
    const src = kotlin('LancibleMaterialSwitchModule.kt');
    const name = src.match(/Name\("(\w+)"\)/)[1];
    expect(name).toBe('LancibleMaterialSwitch');
    const index = moduleFile('index.js');
    expect(index).toContain(`requireOptionalNativeModule('${name}')`);
    expect(index).toContain(`requireNativeView('${name}')`);

    const events = [...src.matchAll(/Events\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    const colorProps = [...src.match(/COLOR_PROPS = listOf\(([\s\S]*?)\)/)[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
    const props = [...src.matchAll(/Prop\("(\w+)"\)/g)].map((m) => m[1]);
    const declared = [...events, ...props, ...colorProps].sort();

    setOS('android');
    const view = jest.replaceProperty(nativeModule, 'MaterialSwitchView', 'LancibleMaterialSwitch');
    try {
      const screen = await render(<Switch value onValueChange={noop} accessibilityLabel="Тема" testID="sw" />);
      // Всё, что уходит виду сверх общих пропов RN, Kotlin должен знать.
      const rn = ['testID', 'accessible', 'accessibilityRole', 'accessibilityLabel', 'accessibilityState', 'style'];
      const sent = Object.keys(screen.getByTestId('sw').props).filter((k) => !rn.includes(k)).sort();
      expect(sent).toEqual(declared);
    } finally {
      view.restore();
    }
  });

  test('галочка в нативном кружке — тот же путь, что check в core/icons.js', () => {
    const xml = moduleFile('android', 'src', 'main', 'res', 'drawable', 'lancible_switch_check.xml');
    const [x, y, w, h] = ICONS.check.vb.split(' ').map(Number);
    expect(xml).toMatch(new RegExp(`android:viewportWidth="${w}"`));
    expect(xml).toMatch(new RegExp(`android:viewportHeight="${h}"`));
    expect(xml).toMatch(new RegExp(`android:translateX="${-x}"`));
    expect(xml).toMatch(new RegExp(`android:translateY="${-y}"`));
    expect(ICONS.check.p).toHaveLength(1);
    expect(xml.match(/android:pathData="([^"]+)"/)[1]).toBe(ICONS.check.p[0][0]);
  });

  test('index.js: без нативной части — null, с ней — вид по имени модуля', () => {
    const load = (nativeModulePresent) => {
      let loaded;
      jest.isolateModules(() => {
        const requireNativeView = jest.fn((name) => `view:${name}`);
        jest.doMock('expo', () => ({
          requireOptionalNativeModule: jest.fn(() => (nativeModulePresent ? {} : null)),
          requireNativeView,
        }));
        loaded = { ...jest.requireActual('../modules/lancible-material-switch'), requireNativeView };
      });
      // doMock переживает isolateModules — снять, чтобы соседние тесты видели настоящий expo.
      jest.dontMock('expo');
      return loaded;
    };
    const absent = load(false);
    expect(absent.MaterialSwitchView).toBeNull();
    expect(absent.requireNativeView).not.toHaveBeenCalled();
    expect(load(true).MaterialSwitchView).toBe('view:LancibleMaterialSwitch');
  });

  test('index.js в окружении без модуля (как Expo Go) отдаёт null, а не падает', () => {
    jest.isolateModules(() => {
      expect(jest.requireActual('../modules/lancible-material-switch').MaterialSwitchView).toBeNull();
    });
  });
});

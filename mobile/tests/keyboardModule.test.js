// Обёртка клавиатуры (src/lib/keyboard.js). Запуск: npm run test:mobile
//
// 11 октября 2026 Expo Go на iOS упал на старте: «The package
// 'react-native-keyboard-controller' doesn't seem to be linked». Нативной
// части библиотеки в нём нет, а библиотека бросает уже на импорте. Теперь её
// берёт только lib/keyboard.js — в try/catch, и без нативной части отдаёт
// заглушки (их поведение — tests/keyboardFallback.test.js). Здесь: при
// библиотеке на месте (подмена из jest.setup.js, как в сборке) наружу идёт
// она сама; при падающем импорте — флаг опущен, а не исключение; и никто,
// кроме обёртки, библиотеку напрямую не импортирует — иначе падение вернётся
// через этот файл.
import fs from 'fs';
import path from 'path';
import * as lib from 'react-native-keyboard-controller';
import * as keyboard from '../src/lib/keyboard';
import { render } from '@testing-library/react-native';

const LINKING_ERROR = "The package 'react-native-keyboard-controller' doesn't seem to be linked.";

/** Обёртка, загруженная заново поверх библиотеки, чей импорт бросает. */
function loadWithoutNative() {
  let mod;
  // Подмена из jest.setup.js уже лежит в общем реестре (импорт выше), и
  // isolateModules отдал бы её, не зовя новую фабрику, — реестр сбрасывается.
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('react-native-keyboard-controller', () => { throw new Error(LINKING_ERROR); });
    mod = require('../src/lib/keyboard');
  });
  // doMock переживает isolateModules — вернуть подмену из jest.setup.js.
  jest.doMock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
  return mod;
}

test('библиотека на месте — флаг поднят, наружу идёт она сама', () => {
  expect(keyboard.KEYBOARD_NATIVE).toBe(true);
  expect(keyboard.KeyboardProvider).toBe(lib.KeyboardProvider);
  expect(keyboard.useKeyboardAnimation).toBe(lib.useKeyboardAnimation);
  expect(keyboard.useReanimatedKeyboardAnimation).toBe(lib.useReanimatedKeyboardAnimation);
  expect(keyboard.KeyboardAwareScrollView).toBe(lib.KeyboardAwareScrollView);
});

// KeyboardAvoidingView — своя обёртка на обоих путях (19 октября 2026): поправку
// на место вида (automaticOffset) считает она, а внутри — библиотечный.
test('KeyboardAvoidingView: внутри — библиотечный, свой automaticOffset ему не уходит', async () => {
  const s = await render(<keyboard.KeyboardAvoidingView behavior="padding" automaticOffset testID="kav" />);
  // Подмена библиотеки (jest.setup.js) — View: свойства видны на нём.
  expect(lib.KeyboardAvoidingView).toBeTruthy();
  const host = s.getByTestId('kav');
  s.getByTestId('keyboard-avoid-probe', { includeHiddenElements: true });
  expect(host.props.behavior).toBe('padding');
  expect(host.props.automaticOffset).toBeUndefined();
  expect(host.props.keyboardVerticalOffset).toBe(0);
});

test('импорт библиотеки бросает (Expo Go без нативной части) — флаг опущен, обёртка грузится', () => {
  const mod = loadWithoutNative();
  expect(mod.KEYBOARD_NATIVE).toBe(false);
  for (const name of ['KeyboardProvider', 'useKeyboardAnimation', 'useReanimatedKeyboardAnimation', 'KeyboardAwareScrollView', 'KeyboardAvoidingView']) {
    expect(mod[name]).toBeTruthy();
    expect(mod[name]).not.toBe(lib[name]);
  }
});

const MOBILE = path.join(__dirname, '..');
const WRAPPER = path.join(MOBILE, 'src', 'lib', 'keyboard.js');
const IMPORT = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]react-native-keyboard-controller(?:\/[^'"]*)?['"]/;

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test('библиотеку импортирует только lib/keyboard.js', () => {
  // Сама обёртка её берёт — значит, поиск видит такой импорт.
  expect(fs.readFileSync(WRAPPER, 'utf8')).toMatch(IMPORT);
  const files = [path.join(MOBILE, 'App.js'), ...sources(path.join(MOBILE, 'src'))];
  const offenders = files
    .filter((file) => file !== WRAPPER && IMPORT.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(MOBILE, file));
  expect(offenders).toEqual([]);
});

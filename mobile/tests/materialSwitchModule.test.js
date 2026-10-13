// Защита локального модуля переключателя (modules/lancible-material-switch/
// index.js). Запуск: npm run test:mobile
//
// Модуль решает, упадёт ли экран в Expo Go: requireNativeView отдаёт компонент
// и без нативной части, а ломается уже при отрисовке. Поэтому вид берётся,
// только если сам нативный модуль есть, а иначе MaterialSwitchView === null, и
// Switch.js рисует свой переключатель. jest.setup.js подменяет модуль целиком
// ({ MaterialSwitchView: null }), так что эту защиту экранные тесты не видят:
// здесь подмена снята и проверяется настоящий index.js.
jest.unmock('../modules/lancible-material-switch');

const NATIVE_NAME = 'LancibleMaterialSwitch';

/** Настоящий index.js, загруженный заново поверх подмены `expo`. */
function loadModule(expo) {
  let mod;
  jest.isolateModules(() => {
    if (expo) jest.doMock('expo', () => expo);
    else jest.dontMock('expo');
    mod = require('../modules/lancible-material-switch');
  });
  return mod;
}

test('нативного модуля нет (Expo Go) — вид null, requireNativeView не зовётся', () => {
  const expo = { requireOptionalNativeModule: jest.fn(() => null), requireNativeView: jest.fn(() => 'native-view') };
  const { MaterialSwitchView } = loadModule(expo);
  expect(MaterialSwitchView).toBeNull();
  expect(expo.requireOptionalNativeModule).toHaveBeenCalledWith(NATIVE_NAME);
  // Вид без нативной части падает уже при отрисовке — его и не берём.
  expect(expo.requireNativeView).not.toHaveBeenCalled();
});

test('нативный модуль есть (сборка APK) — вид из requireNativeView', () => {
  const view = () => null;
  const expo = { requireOptionalNativeModule: jest.fn(() => ({})), requireNativeView: jest.fn(() => view) };
  const { MaterialSwitchView } = loadModule(expo);
  expect(MaterialSwitchView).toBe(view);
  expect(expo.requireOptionalNativeModule).toHaveBeenCalledWith(NATIVE_NAME);
  expect(expo.requireNativeView).toHaveBeenCalledWith(NATIVE_NAME);
});

test('настоящий expo в jest отдаёт null: нативной части у модуля нет', () => {
  expect(loadModule(null).MaterialSwitchView).toBeNull();
});

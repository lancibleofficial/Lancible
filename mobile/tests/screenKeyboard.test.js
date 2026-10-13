// Поля экранов и клавиатура: статусы проекта и шаг после входа. Запуск: npm run test:mobile
//
// 11 октября 2026: приложение рисуется под системными панелями (edge-to-edge,
// KeyboardProvider в App.js), и окно под клавиатуру больше не ужимается. Экран
// статусов был обычным ScrollView — поле названия в нижней строке уходило под
// клавиатуру; шаг после входа держал KeyboardAvoidingView без behavior на
// Android, который рассчитывал как раз на ужатое окно. Теперь оба —
// KeyboardAwareScrollView из lib/keyboard.js: поле докручивается над
// клавиатурой с тем же воздухом, что у листов. Само правило докрутки живёт в
// библиотеке; здесь — применение: поля лежат в этой прокрутке, воздух задан,
// тапы при открытой клавиатуре — как были.
import { render, within } from '@testing-library/react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import OnboardingScreen from '../src/screens/auth/OnboardingScreen';
import ProjectStatusesScreen from '../src/screens/ProjectStatusesScreen';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAppStore } from '../src/store/useAppStore';
import { spacing } from '../src/theme';
import { t } from '../src/lib/i18n';

jest.mock('react-native-keyboard-controller', () => {
  const lib = require('react-native-keyboard-controller/jest');
  const { createElement } = require('react');
  return { ...lib, KeyboardAwareScrollView: jest.fn((props) => createElement(lib.KeyboardAwareScrollView, { testID: 'aware-scroll', ...props })) };
});

const lastProps = () => KeyboardAwareScrollView.mock.calls[KeyboardAwareScrollView.mock.calls.length - 1][0];

beforeEach(() => {
  KeyboardAwareScrollView.mockClear();
  useAuthStore.setState({ completeOnboarding: jest.fn(async () => ({ ok: true })), signOut: jest.fn() });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    tasks: [],
  });
});

test('статусы проекта: поля названий — в прокрутке, которая знает о клавиатуре', async () => {
  const s = await render(<ProjectStatusesScreen route={{ params: { projectId: 'p1' } }} />);
  expect(KeyboardAwareScrollView).toHaveBeenCalled();
  expect(lastProps().bottomOffset).toBe(spacing.md);
  // Тапы при открытой клавиатуре — как были у обычной прокрутки.
  expect(lastProps().keyboardShouldPersistTaps).toBeUndefined();
  const scroll = s.getByTestId('aware-scroll');
  // Нижняя строка — та, что уходила под клавиатуру.
  expect(within(scroll).getByDisplayValue('Готово')).toBeTruthy();
  expect(within(scroll).getByText(t('ru', 'status.add'))).toBeTruthy();
});

test('шаг после входа: поле имени — в прокрутке, которая знает о клавиатуре', async () => {
  const s = await render(<OnboardingScreen />);
  expect(KeyboardAwareScrollView).toHaveBeenCalled();
  const props = lastProps();
  expect(props.bottomOffset).toBe(spacing.md);
  // Тапы по чипам и переключателю при открытой клавиатуре проходят с первого раза.
  expect(props.keyboardShouldPersistTaps).toBe('handled');
  const scroll = s.getByTestId('aware-scroll');
  expect(within(scroll).getByText(t('ru', 'auth.name_label'), { exact: false })).toBeTruthy();
  expect(within(scroll).getByTestId('consent-switch')).toBeTruthy();
});

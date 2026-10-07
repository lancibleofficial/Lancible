// Шаг согласия на телефоне. Запуск: npm run test:mobile (из корня)
//
// Правило — когда спрашивать согласие и что записать — лежит в ядре
// (core/legal.js) и закрыто юнитами в tests/unit/legal.test.js. Здесь —
// что телефон его применяет: без согласия дальше не пройти, ссылки ведут на
// документы на языке приложения, в режиме «обновлённые условия» не
// спрашивают имя заново.
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import OnboardingScreen from '../src/screens/auth/OnboardingScreen';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAppStore } from '../src/store/useAppStore';

let complete;
beforeEach(() => {
  complete = jest.fn(async () => ({ ok: true }));
  useAuthStore.setState({ completeOnboarding: complete, signOut: jest.fn() });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
});

test('без согласия «Продолжить» ничего не сохраняет', async () => {
  const screen = await render(<OnboardingScreen />);
  await fireEvent.press(screen.getByText('Продолжить'));
  expect(complete).not.toHaveBeenCalled();
});

test('с согласием сохраняет профиль вместе с ним', async () => {
  const screen = await render(<OnboardingScreen />);
  await fireEvent(screen.getByTestId('consent-switch'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Продолжить'));
  expect(complete).toHaveBeenCalledWith('', null, { consentOnly: false, withProfile: true });
});

test('«Пропустить» пропускает имя, но не согласие', async () => {
  const screen = await render(<OnboardingScreen />);
  await fireEvent.press(screen.getByText('Пропустить'));
  expect(complete).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('consent-switch'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Пропустить'));
  expect(complete).toHaveBeenCalledWith('', null, { consentOnly: false, withProfile: false });
});

test('поля помечены необязательными, возраст — из ядра', async () => {
  const screen = await render(<OnboardingScreen />);
  expect(screen.queryByText('Как вас зовут? (необязательно)')).not.toBeNull();
  expect(screen.queryByText(/16 лет/)).not.toBeNull();
});

test('ссылки открывают документы на языке приложения', async () => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'uk' } });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const screen = await render(<OnboardingScreen />);
  await fireEvent.press(screen.getByText('Політику конфіденційності'));
  expect(open).toHaveBeenCalledWith('https://lancible.vercel.app/privacy?lang=uk');
  open.mockRestore();
});

test('обновлённые условия: без имени и «Пропустить», только согласие', async () => {
  const screen = await render(<OnboardingScreen consentOnly />);
  expect(screen.queryByText('Как вас зовут? (необязательно)')).toBeNull();
  expect(screen.queryByText('Пропустить')).toBeNull();
  await fireEvent(screen.getByTestId('consent-switch'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Принять'));
  expect(complete).toHaveBeenCalledWith('', null, { consentOnly: true, withProfile: true });
});

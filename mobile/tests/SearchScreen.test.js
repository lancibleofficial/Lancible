// Поиск (screens/SearchScreen.js), шапка на JS — Android и iOS ниже 26.
// Запуск: npm run test:mobile
//
// Клавиатура открывается сразу: autoFocus на поле и ещё раз фокус, когда
// экран доехал, — на Android autoFocus во время въезда срабатывает не всегда.
import { render, fireEvent } from '@testing-library/react-native';
import SearchScreen from '../src/screens/SearchScreen';
import { useAppStore } from '../src/store/useAppStore';

const mockFocus = jest.fn();
jest.mock('../src/components/AppTextInput', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return React.createElement(TextInput, props);
  });
});

const nav = () => {
  const listeners = {};
  return {
    listeners,
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => { delete listeners[name]; }; }),
  };
};
const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(),
});

beforeEach(() => {
  mockFocus.mockClear();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task('t1', 'Главная страница'), task('t2', 'Логи')],
    activeTimer: null,
  });
});

test('поле с автофокусом, и фокус ещё раз, когда экран доехал', async () => {
  const navigation = nav();
  const { getByPlaceholderText } = await render(<SearchScreen navigation={navigation} />);
  expect(getByPlaceholderText('Поиск задач и проектов').props.autoFocus).toBe(true);
  expect(navigation.addListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));

  navigation.listeners.transitionEnd({ data: { closing: false } });
  expect(mockFocus).toHaveBeenCalledTimes(1);
  // Уходя с экрана, клавиатуру не зовём.
  navigation.listeners.transitionEnd({ data: { closing: true } });
  expect(mockFocus).toHaveBeenCalledTimes(1);
});

test('шапка своя, системную строку поиска не просим', async () => {
  const navigation = nav();
  const { getByPlaceholderText, getByText, queryByText } = await render(<SearchScreen navigation={navigation} />);
  expect(navigation.setOptions).not.toHaveBeenCalled();
  await fireEvent.changeText(getByPlaceholderText('Поиск задач и проектов'), 'глав');
  getByText('Главная страница');
  expect(queryByText('Логи')).toBeNull();
});

// Поле чата над клавиатурой (screens/ChatThreadScreen.js, lib/keyboard.js).
// Запуск: npm run test:mobile
//
// 19 октября 2026: «поле ввода в открытом чате — над клавиатурой, когда по
// нему нажали». Причина: KeyboardAvoidingView (и библиотечный, и системный)
// считает перекрытие как «низ вида − верх клавиатуры», где низ вида — из
// onLayout, то есть от РОДИТЕЛЯ, а верх клавиатуры — от верха окна. Над
// экраном чата стоит шапка стека, и перекрытие выходило меньше на её высоту:
// поле оставалось за клавиатурой. Теперь экран ставит automaticOffset —
// библиотека берёт место вида в окне сама (viewPositionInWindow, её код),
// а системный, на котором приложение живёт без нативной части (Expo Go на
// iOS), получает сдвиг вида в окне как keyboardVerticalOffset.
//
// Здесь — системный путь: библиотеки нет (импорт бросает, как в том Expo Go),
// высота клавиатуры подменена событием, место вида в окне — замером.
import { DeviceEventEmitter, Dimensions, Platform, StyleSheet, TextInput } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import ChatThreadScreen from '../src/screens/ChatThreadScreen';
import { KEYBOARD_NATIVE, KeyboardAvoidingView } from '../src/lib/keyboard';
import { useAiChat, aiStop, aiAccount, aiNewChat } from '../src/lib/aiChat';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { spacing } from '../src/theme';
import { grantAi } from './support/aiAccess';

// Агент открыт аккаунту (RPC ai_has_access подменён — tests/support/aiAccess.js).
let aiRpc;
beforeEach(() => { aiRpc = grantAi(); });
afterEach(() => { aiRpc.mockRestore(); });

jest.mock('react-native-keyboard-controller', () => {
  throw new Error("The package 'react-native-keyboard-controller' doesn't seem to be linked.");
});
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const WINDOW = Dimensions.get('window').height;
/** Шапка стека над экраном чата. */
const HEADER = 100;
/** Клавиатура. */
const KB = 336;

let os;
let measure;
beforeEach(async () => {
  os = jest.replaceProperty(Platform, 'OS', 'ios');
  // Вид, который мерят, стоит сразу под шапкой (замер на потоке интерфейса, в координатах корня).
  measure = jest.spyOn(Reanimated, 'measure').mockReturnValue({ x: 0, y: 0, width: 390, height: WINDOW - HEADER, pageX: 0, pageY: HEADER });
  await AsyncStorage.clear();
  aiStop();
  useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [], pending: [], needAuth: false });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
  useAuthStore.setState({ status: 'signedIn', user: { id: 'u-kb', email: 'kb@example.com' } });
});
afterEach(async () => {
  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillHide', { endCoordinates: { screenY: WINDOW, height: 0, width: 390, screenX: 0 } });
    useAuthStore.setState({ status: 'signedOut', user: null });
  });
  measure.mockRestore();
  os.restore();
});

const nav = () => ({ options: {}, navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}), getState: () => ({ routes: [], index: 0 }) });
const layout = (el, height) => act(async () => { await fireEvent(el, 'layout', { persist() {}, nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }); });
const showKeyboard = () => act(async () => {
  DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { screenY: WINDOW - KB, height: KB, width: 390, screenX: 0 }, duration: 0 });
});
const padOf = (el) => StyleSheet.flatten(el.props.style).paddingBottom || 0;

test('нативной части нет — работает системный KeyboardAvoidingView', () => {
  expect(KEYBOARD_NATIVE).toBe(false);
});

test('экран чата: поле встаёт ровно над клавиатурой — снизу отступ во всю её высоту, а не меньше на шапку', async () => {
  await act(async () => { await aiAccount('u-kb'); });
  const chatId = aiNewChat();
  const s = await render(<ChatThreadScreen navigation={nav()} route={{ params: { chatId } }} />);
  await waitFor(() => s.getByTestId('chat-input'));
  const avoid = s.getByTestId('chat-avoid');
  await layout(avoid, WINDOW - HEADER);
  expect(padOf(s.getByTestId('chat-avoid'))).toBe(0);
  await showKeyboard();
  // Низ вида — низ окна: перекрыто ровно на высоту клавиатуры.
  expect(padOf(s.getByTestId('chat-avoid'))).toBe(KB);
  // Под самим полем — малый отступ: оно у верхнего края клавиатуры.
  expect(StyleSheet.flatten(s.getByTestId('chat-compose').props.style).paddingBottom).toBe(spacing.sm);
});

test('без поправки на место в окне перекрытие выходило меньше на высоту шапки — поле оставалось за клавиатурой', async () => {
  const plain = await render(
    <KeyboardAvoidingView behavior="padding" testID="plain"><TextInput /></KeyboardAvoidingView>,
  );
  await layout(plain.getByTestId('plain'), WINDOW - HEADER);
  await showKeyboard();
  expect(padOf(plain.getByTestId('plain'))).toBe(KB - HEADER);

  const fixed = await render(
    <KeyboardAvoidingView behavior="padding" automaticOffset testID="fixed"><TextInput /></KeyboardAvoidingView>,
  );
  await layout(fixed.getByTestId('fixed'), WINDOW - HEADER);
  await showKeyboard();
  expect(padOf(fixed.getByTestId('fixed'))).toBe(KB);
  // Свойства библиотеки системному не уходят.
  expect(fixed.getByTestId('fixed').props.automaticOffset).toBeUndefined();
});

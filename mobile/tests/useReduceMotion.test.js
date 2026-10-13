// «Уменьшение движения» (hooks/useReduceMotion.js). Запуск: npm run test:mobile
//
// Хук стоит в каждой кнопке, переключателе и строке ленты. Если у каждого своя
// подписка, прокрутка ленты — это десятки вызовов через мост. Поэтому система
// спрашивается один раз на модуль и слушается одним слушателем, а хуки читают
// общее значение. Проверяется счёт обращений к системе и то, что смена
// настройки доходит до всех, а не только до первого.
//
// Вопрос системе задаётся при загрузке модуля, поэтому каждый тест берёт хук
// свежим (isolateModules) — счёт ведётся с нуля. React и react-native при этом
// общие с библиотекой тестов, иначе у хука был бы свой React.
import { Text, AccessibilityInfo } from 'react-native';
import { render, act } from '@testing-library/react-native';

const mockReact = require('react');
const mockRN = require('react-native');

/** Свежий модуль хука; answer — что ответит система на вопрос при загрузке. */
function load({ answer = Promise.resolve(false), throws = false } = {}) {
  AccessibilityInfo.isReduceMotionEnabled.mockReset();
  AccessibilityInfo.addEventListener.mockClear();
  if (throws) AccessibilityInfo.isReduceMotionEnabled.mockImplementation(() => { throw new Error('нет нативной части'); });
  else AccessibilityInfo.isReduceMotionEnabled.mockReturnValue(answer);
  let mod;
  jest.isolateModules(() => {
    jest.doMock('react', () => mockReact);
    jest.doMock('react-native', () => mockRN);
    mod = require('../src/hooks/useReduceMotion');
  });
  const { useReduceMotion } = mod;
  const Probe = ({ id }) => <Text testID={`probe-${id}`}>{String(useReduceMotion())}</Text>;
  const probes = (n) => Array.from({ length: n }, (_, i) => <Probe key={i} id={i} />);
  const values = (q, n) => Array.from({ length: n }, (_, i) => q.getByTestId(`probe-${i}`).children.join(''));
  // Событие системы — то единственное, что слушает модуль.
  const emit = (on) => act(async () => {
    const [, handler] = AccessibilityInfo.addEventListener.mock.calls.find(([name]) => name === 'reduceMotionChanged');
    handler(on);
  });
  return { probes, values, emit };
}

test('N экземпляров — один вопрос системе и один слушатель, как ни монтируй', async () => {
  const { probes } = load();
  const q = await render(<>{probes(30)}</>);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.addEventListener.mock.calls[0][0]).toBe('reduceMotionChanged');

  // Листание ленты: строки то уходят, то приходят — системе всё равно один раз.
  await q.rerender(<>{probes(5)}</>);
  await q.rerender(<>{probes(40)}</>);
  await q.unmount();
  await render(<>{probes(10)}</>);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
});

test('ответ системы «включено» доходит до всех экземпляров', async () => {
  const { probes, values } = load({ answer: Promise.resolve(true) });
  const q = await render(<>{probes(12)}</>);
  await act(async () => {});
  expect(values(q, 12)).toEqual(Array(12).fill('true'));
});

test('смена настройки при открытом экране доходит до всех, туда и обратно', async () => {
  const { probes, values, emit } = load();
  const q = await render(<>{probes(12)}</>);
  expect(values(q, 12)).toEqual(Array(12).fill('false'));

  await emit(true);
  expect(values(q, 12)).toEqual(Array(12).fill('true'));

  // Экземпляр, смонтированный позже, сразу видит общее значение.
  await q.rerender(<>{probes(15)}</>);
  expect(values(q, 15)).toEqual(Array(15).fill('true'));

  await emit(false);
  expect(values(q, 15)).toEqual(Array(15).fill('false'));
});

test('событие, пришедшее раньше ответа на вопрос, ответ не затирает', async () => {
  let resolveAnswer;
  const { probes, values, emit } = load({ answer: new Promise((r) => { resolveAnswer = r; }) });
  const q = await render(<>{probes(3)}</>);
  await emit(true);
  // Старый ответ («выключено») приходит позже свежего события.
  await act(async () => { resolveAnswer(false); });
  expect(values(q, 3)).toEqual(['true', 'true', 'true']);
});

test('без нативной части хук не падает: движение остаётся включённым', async () => {
  const { probes, values } = load({ throws: true });
  const q = await render(<>{probes(2)}</>);
  expect(values(q, 2)).toEqual(['false', 'false']);
});

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

/** Клавиатура для решений в JS: открыта ли, её высота и верх (screenY, в
 *  координатах окна). Кадры хода — не здесь: их даёт lib/keyboard.js
 *  (useReanimatedKeyboardAnimation); здесь — события, которые есть всегда,
 *  и с нативной частью библиотеки, и без неё. iOS — keyboardWill*: решение
 *  принимается вместе с началом хода; Android — keyboardDid*: других там нет.
 *  @returns {{ shown: boolean, height: number, top: number|null }} */
export function useKeyboardState() {
  const [state, setState] = useState(() => {
    const m = Keyboard.isVisible && Keyboard.isVisible() && Keyboard.metrics ? Keyboard.metrics() : null;
    return m && m.height > 0 ? { shown: true, height: m.height, top: m.screenY } : { shown: false, height: 0, top: null };
  });
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = (e) => {
      const { height, screenY } = (e && e.endCoordinates) || {};
      setState(height > 0 ? { shown: true, height, top: screenY } : { shown: false, height: 0, top: null });
    };
    const hide = () => setState({ shown: false, height: 0, top: null });
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', show),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', hide),
    ];
    // Высота сменилась при открытой клавиатуре (эмодзи, подсказки). Кадр за
    // краем экрана — это уход: его ведёт keyboardWillHide.
    if (ios) {
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', (e) => {
        if (e && e.endCoordinates && e.endCoordinates.screenY < Dimensions.get('window').height) show(e);
      }));
    }
    return () => subs.forEach((s) => s.remove());
  }, []);
  return state;
}

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { KEYBOARD_NATIVE, KeyboardEvents } from '../lib/keyboard';

/** Клавиатура для решений в JS: открыта ли, её высота и верх (screenY, в
 *  координатах окна). Кадры хода — не здесь: их даёт lib/keyboard.js
 *  (useReanimatedKeyboardAnimation); здесь — события, которые есть всегда,
 *  и с нативной частью библиотеки, и без неё. iOS — keyboardWill*: решение
 *  принимается вместе с началом хода; Android — keyboardDid*: других там нет.
 *
 *  Клавиатура без высоты (17 октября 2026). Плавающая Gboard и строка над
 *  подключённой физической клавиатурой открыты, но места снизу не занимают:
 *  React Native шлёт keyboardDidShow с высотой 0 (или меньше), и раньше это
 *  читалось как «закрыта» — а кадры библиотеки (progress 1) тем временем
 *  уводили шит с таймером вниз, и под полем заметок оставалась пустая
 *  полоса в рост шита (~144 dp). Теперь «открыта ли» при нулевой высоте
 *  решает библиотека (lib/keyboard.js: KeyboardEvents): она открыта с
 *  height 0 — значит, открыта, и экран кладёт под поле только панель
 *  редактора. Высоту больше нуля и верх по-прежнему даёт React Native.
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
      if (height > 0) setState({ shown: true, height, top: screenY });
      // Высоты нет: с библиотекой решает она (ниже), без неё — закрыта.
      else if (!KEYBOARD_NATIVE) setState({ shown: false, height: 0, top: null });
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
    if (KEYBOARD_NATIVE) {
      // Конец хода по библиотеке. Высота 0 — клавиатура открыта, но плавает
      // (или это строка над физической): поле заметок — до панели над низом
      // экрана. Высота больше нуля — после такой плавающей клавиатуру снова
      // прикрепили: React Native об этом может и не сказать (видимость не
      // менялась), поэтому высоту берём отсюда; прикреплённую с самого
      // начала ведут события React Native выше — их верх точнее.
      const lib = (e) => {
        const h = Math.max(0, Number(e && e.height) || 0);
        setState((s) => {
          if (h === 0) return s.shown && s.height === 0 ? s : { shown: true, height: 0, top: Dimensions.get('window').height };
          return s.shown && s.height === 0 ? { shown: true, height: h, top: Dimensions.get('window').height - h } : s;
        });
      };
      subs.push(KeyboardEvents.addListener('keyboardDidShow', lib));
      subs.push(KeyboardEvents.addListener('keyboardDidHide', hide));
    }
    return () => subs.forEach((s) => s && s.remove && s.remove());
  }, []);
  return state;
}

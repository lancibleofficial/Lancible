// Верхняя навигация на iOS 26+ — нативная шапка iOS (UINavigationBar через
// react-native-screens). Её кнопки система сама кладёт на жидкое стекло —
// так же, как панель вкладок внизу. Работает и в Expo Go: там нет нативной
// части expo-glass-effect («Cannot find native module 'ExpoGlassEffect'» в
// логе с iPhone на iOS 26.5), а react-native-screens есть.
//
// На Android и iOS ниже 26 шапки свои, на JS (AppHeader, TabHeader,
// DetailHeader), как раньше.
//
// Экраны ничего не знают о том, какая шапка: TabHeader и DetailHeader на
// iOS 26+ ничего не рисуют, а через navigation.setOptions отдают нативной
// шапке заголовок и кнопки — те же, что нарисовали бы сами. Кнопки
// переводятся в нативные (SF Symbols, бейдж), остальное — своим элементом.
import { isValidElement, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AppHeader, { StackTitle } from '../components/AppHeader';

const IOS_MAJOR = Platform.OS === 'ios' ? (parseInt(String(Platform.Version), 10) || 0) : 0;

/** Нативная шапка со стеклом: iOS 26 и выше. */
export const IOS_NATIVE_HEADER = IOS_MAJOR >= 26;

/** Наши иконки → SF Symbols для нативных кнопок шапки. */
export const SF_SYMBOL = {
  search: 'magnifyingglass',
  bell: 'bell',
  plus: 'plus',
  calendar: 'calendar',
  panel: 'rectangle.split.2x1',
  'list-bullet': 'list.bullet',
  download: 'square.and.arrow.down',
  kebab: 'ellipsis',
  check: 'checkmark',
  menu: 'line.3.horizontal',
  x: 'xmark',
};

/** Общие настройки шапки стека: на iOS 26+ — нативная, иначе — AppHeader. */
export function stackHeaderOptions(colors) {
  if (!IOS_NATIVE_HEADER) return { header: (props) => <AppHeader {...props} /> };
  return {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: 'Onest-SemiBold', color: colors.text },
    headerBackButtonDisplayMode: 'minimal',
  };
}

/** Свой элемент слева без стеклянной подложки — так заголовок остаётся
 *  слева нашим шрифтом и размером, а не уезжает в центр системным. */
export function leftElementItems(element) {
  return [{ type: 'custom', element, hidesSharedBackground: true }];
}

/** Заголовок экрана стека: на iOS 26+ — слева своим элементом рядом с
 *  системной «назад», иначе — обычный title для AppHeader. */
export function leftTitleOptions(text) {
  if (!IOS_NATIVE_HEADER) return { title: text };
  return {
    title: text,
    headerTitle: '',
    headerBackVisible: true,
    unstable_headerLeftItems: () => leftElementItems(<StackTitle text={text} />),
  };
}

/** Подпись элемента для сравнения «изменилось ли что-то в шапке»: тип,
 *  простые пропсы и дети, без функций. */
export function elementSignature(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(elementSignature).join('|');
  if (!isValidElement(node)) return '';
  const type = typeof node.type === 'string' ? node.type : (node.type && (node.type.displayName || node.type.name)) || '?';
  const props = Object.keys(node.props || {})
    .filter((k) => k !== 'children' && typeof node.props[k] !== 'function')
    .map((k) => {
      const v = node.props[k];
      let s;
      try { s = typeof v === 'object' ? JSON.stringify(v) : String(v); } catch (e) { s = '?'; }
      return `${k}=${s}`;
    }).join(',');
  return `<${type} ${props}>${elementSignature(node.props && node.props.children)}</>`;
}

/** Передать опции нативной шапке, только когда изменилась подпись:
 *  setOptions перерисовывает навигатор, а с ним и экран, — без сравнения
 *  получился бы бесконечный круг. */
export function useNativeOptions(navigation, signature, build) {
  const buildRef = useRef(build);
  buildRef.current = build;
  const last = useRef(null);
  useLayoutEffect(() => {
    if (!navigation || last.current === signature) return;
    last.current = signature;
    navigation.setOptions(buildRef.current());
  });
}

/**
 * Элементы шапки → нативные элементы iOS.
 * @param latest   ref на массив элементов-кнопок (самый свежий): нажатие
 *                 берёт обработчик оттуда, а не тот, что был при сборке
 * @param toItem   (element) → { icon, label, onPress, badge, prominent, tint }
 *                 или null — тогда элемент уходит в шапку как есть
 * @param wrapCustom (element) → element для своего элемента
 */
export function nativeItems(latest, toItem, wrapCustom) {
  return latest.current.map((child, i) => {
    const b = toItem(child);
    if (!b) return { type: 'custom', element: wrapCustom ? wrapCustom(child) : child };
    return {
      type: 'button',
      label: b.label || '',
      accessibilityLabel: b.label,
      icon: { type: 'sfSymbol', name: SF_SYMBOL[b.icon] || 'circle' },
      onPress: () => {
        const now = latest.current[i] && toItem(latest.current[i]);
        if (now && now.onPress) now.onPress();
      },
      variant: b.prominent ? 'prominent' : 'plain',
      tintColor: b.tint,
      badge: b.badge ? { value: b.badge } : undefined,
    };
  });
}

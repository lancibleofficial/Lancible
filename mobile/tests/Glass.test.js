// Подложка кнопок верхней навигации (components/Glass.js). Запуск:
// npm run test:mobile
//
// Жидкое стекло есть только на iOS 26+, и в Node его нет. Проверяется
// обратная сторона: без стекла кнопки шапки выглядят как раньше — заливка
// цветом темы, а не прозрачная дыра. Именно это увидят Android и iOS ниже 26.
import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import { GlassBg, hasLiquidGlass } from '../src/components/Glass';
import { HeaderButton } from '../src/components/TabHeader';
import { useAppStore } from '../src/store/useAppStore';

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
});

/** Абсолютные залитые слои в отрисованном дереве — то есть подложки. */
function absoluteFills(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => absoluteFills(n, out)); return out; }
  if (typeof node !== 'object') return out;
  const style = [].concat(node.props && node.props.style ? node.props.style : [])
    .flat(Infinity).filter(Boolean).reduce((a, s) => Object.assign(a, s), {});
  if (style.position === 'absolute' && style.backgroundColor) out.push(style);
  return absoluteFills(node.children, out);
}

test('в Node стекла нет', () => {
  expect(hasLiquidGlass()).toBe(false);
});

test('без стекла подложка — заливка с тем же скруглением', async () => {
  const root = await render(<View><GlassBg radius={10} backgroundColor="#123456" /></View>);
  expect(absoluteFills(root.toJSON())).toEqual([expect.objectContaining({ backgroundColor: '#123456', borderRadius: 10 })]);
});

test('без стекла и без заливки — подложки нет вовсе', async () => {
  const root = await render(<View><GlassBg radius={10} /></View>);
  expect(absoluteFills(root.toJSON())).toEqual([]);
});

test('кнопка шапки без стекла залита, акцентная — другим цветом', async () => {
  const plain = absoluteFills((await render(<HeaderButton icon="search" label="поиск" onPress={() => {}} />)).toJSON())[0];
  const accent = absoluteFills((await render(<HeaderButton icon="plus" label="плюс" accent onPress={() => {}} />)).toJSON())[0];
  expect(plain.backgroundColor).toBeTruthy();
  expect(accent.backgroundColor).toBeTruthy();
  expect(accent.backgroundColor).not.toBe(plain.backgroundColor);
});

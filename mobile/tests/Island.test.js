// Острова (components/Island.js). Запуск: npm run test:mobile
//
// Острова не проявляются из нуля: раньше каждый въезжал с FadeInDown, и
// при открытии любой страницы она приезжала пустой и потом проявлялась —
// это выглядело морганием.
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import Island from '../src/components/Island';

function props(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => props(n, out)); return out; }
  if (typeof node === 'object') {
    out.push(node.props || {});
    props(node.children, out);
  }
  return out;
}

test('остров виден сразу, без анимации появления', async () => {
  const plain = await render(<Island><Text>сводка</Text></Island>);
  const pressable = await render(<Island onPress={() => {}}><Text>сводка</Text></Island>);
  for (const tree of [plain.toJSON(), pressable.toJSON()]) {
    const all = props(tree);
    expect(all.some((p) => 'entering' in p)).toBe(false);
    expect(all.some((p) => p.style && [].concat(p.style).some((s) => s && s.opacity === 0))).toBe(false);
  }
  plain.getByText('сводка');
});

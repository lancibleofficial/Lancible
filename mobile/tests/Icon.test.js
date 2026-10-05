// Иконка телефона. Запуск: npm run test:mobile (из корня)
//
// Откуда тест. У Icon цвет по умолчанию был прописан строкой — почти белый
// #ecedef, — и тема его не меняла. Все 79 вызовов передавали цвет сами, так
// что на экране это не всплывало, но первая же иконка без цвета оказалась бы
// белой на белом в светлой теме. Теперь по умолчанию берётся цвет текста
// текущей темы — и это проверяется здесь, а не держится на внимании.
// render в этой версии библиотеки асинхронный — отсюда await.
import { render } from '@testing-library/react-native';
import Icon from '../src/components/Icon';
import { useColors } from '../src/theme';
import { useAppStore } from '../src/store/useAppStore';

const setTheme = (theme) => useAppStore.setState((s) => ({ settings: { ...s.settings, theme } }));

/** Заливка первого контура в отрисованном дереве — то, что уйдёт на платформу. */
async function fillOf(element) {
  const { toJSON } = await render(element);
  const find = (node) => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 'RNSVGPath') return node.props.fill;
    for (const child of node.children || []) { const f = find(child); if (f !== undefined) return f; }
    return undefined;
  };
  const fill = find(toJSON());
  expect(fill).toBeDefined();
  return fill;
}

/** Цвет текста текущей темы — тем же хуком, которым его берут экраны. */
async function themeText() {
  let text;
  const Probe = () => { text = useColors().text; return null; };
  await render(<Probe />);
  return text;
}

afterEach(() => setTheme('dark'));

test.each(['light', 'dark'])('иконка без цвета берёт цвет текста темы (%s)', async (theme) => {
  setTheme(theme);
  const text = await themeText();
  expect(await fillOf(<Icon name="check" />)).toEqual(await fillOf(<Icon name="check" color={text} />));
});

test('в светлой и тёмной теме иконка без цвета разная', async () => {
  setTheme('light');
  const onLight = await fillOf(<Icon name="check" />);
  setTheme('dark');
  const onDark = await fillOf(<Icon name="check" />);
  expect(onLight).not.toEqual(onDark);
});

test('явный цвет главнее темы', async () => {
  setTheme('light');
  expect(await fillOf(<Icon name="check" color="#87ff65" />)).toEqual(await fillOf(<Icon name="check" color="#87ff65" />));
  expect(await fillOf(<Icon name="check" color="#87ff65" />)).not.toEqual(await fillOf(<Icon name="check" />));
});

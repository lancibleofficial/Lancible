// Главные кнопки действия: одна высота и одно скругление везде. Запуск: npm run test:mobile
//
// 11 октября 2026 кнопки стали чуть ниже (52 → 48) и круглее (10 → 14), и
// «чуть» держится токенами theme.js: buttonHeight и buttonRadius. Тест не
// проверяет числа на глаз, а обходит все места, где кнопка рисуется: сам
// PrimaryButton во всех вариантах, каждый лист из тех, что открываются через
// стор, и экраны с кнопками. Если у кого-то снова появится своя высота
// (style с height, `compact`), он покажет себя здесь, а не на глаз у людей.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import PrimaryButton from '../src/components/PrimaryButton';
import BottomSheet from '../src/components/BottomSheet';
import ActionSheetContent from '../src/components/ActionSheetContent';
import AuthSheet from '../src/components/AuthSheet';
import ChangePasswordSheet from '../src/components/ChangePasswordSheet';
import DueSheet from '../src/components/DueSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import QuickTaskSheet from '../src/components/QuickTaskSheet';
import RateSheet from '../src/components/RateSheet';
import RepeatSheet from '../src/components/RepeatSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import SlotSheet from '../src/components/SlotSheet';
import SessionSheet from '../src/components/SessionSheet';
import TagEditSheet from '../src/components/TagEditSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import DocumentsScreen from '../src/screens/DocumentsScreen';
import OnboardingScreen from '../src/screens/auth/OnboardingScreen';
import SettingsScreen from '../src/screens/SettingsScreen';
import VersionsEditor from '../src/components/VersionsEditor';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';
import { renderHook } from '@testing-library/react-native';
import { buttonHeight, buttonHeightSm, buttonRadius, fontSize, radius, useColors } from '../src/theme';

const noop = () => {};
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const task = {
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [],
  pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z',
};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAuthStore.setState({ status: 'signedOut', user: null, signOut: jest.fn() });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task],
    documents: [],
    activeTimer: null,
  });
});

// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

/** Контраст двух цветов #rrggbb по WCAG. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Каждая кнопка в найденном — высота и скругление ровно из токенов.
 *  @param {number} [height] — токен высоты: buttonHeight, у малой — buttonHeightSm. */
function expectTokens(buttons, height = buttonHeight) {
  for (const b of buttons) {
    const s = flat(b);
    expect(s.minHeight).toBe(height);
    expect(s.borderRadius).toBe(buttonRadius);
    // Своей фиксированной высоты нет: выше токена кнопка может стать только
    // от переноса текста (minHeight), ниже — никогда.
    if (s.height != null) expect(s.height).toBe(height);
  }
}

test('токены: скругление круглее поля, высота ниже прежних 52 и не ниже 44 pt', () => {
  expect(buttonRadius).toBeGreaterThan(radius.md);
  expect(buttonHeight).toBeLessThan(52);
  expect(buttonHeight).toBeGreaterThanOrEqual(44);
});

test('токен малой кнопки: заметно ниже обычной, но зона касания добирается до 44 pt', async () => {
  expect(buttonHeightSm).toBeLessThan(buttonHeight);
  expect(buttonHeightSm).toBeGreaterThanOrEqual(32);
  const screen = await render(<PrimaryButton title="Войти" size="sm" onPress={noop} />);
  const slop = screen.getByTestId('primary-button').props.hitSlop;
  expect(buttonHeightSm + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
});

describe('PrimaryButton во всех вариантах', () => {
  const cases = [
    ['акцентная', { title: 'Сохранить' }],
    ['ghost', { title: 'Отмена', variant: 'ghost' }],
    ['danger', { title: 'Удалить', variant: 'danger' }],
    ['с иконкой', { title: 'Готово', icon: 'check' }],
    ['только иконка', { icon: 'plus' }],
    ['с загрузкой', { title: 'Войти', loading: true }],
    ['выключенная', { title: 'Создать', disabled: true }],
    ['текст по ширине', { title: 'Очень длинная подпись кнопки', shrinkText: true }],
  ];
  test.each(cases)('%s', async (_name, props) => {
    const screen = await render(<PrimaryButton onPress={noop} {...props} />);
    expectTokens(screen.getAllByTestId('primary-button'));
  });

  test('малая кнопка size="sm" — ниже и мельче шрифт, скругление то же; обычная не меняется', async () => {
    const small = await render(<PrimaryButton title="Войти" size="sm" onPress={noop} />);
    const normal = await render(<PrimaryButton title="Войти" onPress={noop} />);
    const [sm] = small.getAllByTestId('primary-button');
    const [md] = normal.getAllByTestId('primary-button');
    expect(flat(sm).minHeight).toBe(buttonHeightSm);
    expect(flat(md).minHeight).toBe(buttonHeight);
    expect(flat(sm).borderRadius).toBe(flat(md).borderRadius);
    expect(flat(small.getByText('Войти')).fontSize).toBe(fontSize.sm);
    expect(flat(normal.getByText('Войти')).fontSize).toBe(fontSize.md);
  });

  test.each([
    ['акцентная', { title: 'Создать аккаунт' }],
    ['ghost', { title: 'Войти', variant: 'ghost' }],
    ['danger', { title: 'Удалить', variant: 'danger' }],
    ['с иконкой', { title: 'Готово', icon: 'check' }],
    ['с загрузкой', { title: 'Войти', loading: true }],
    ['выключенная', { title: 'Создать', disabled: true }],
  ])('малая кнопка, %s: высота — токен buttonHeightSm', async (_name, props) => {
    const screen = await render(<PrimaryButton size="sm" onPress={noop} {...props} />);
    expectTokens(screen.getAllByTestId('primary-button'), buttonHeightSm);
  });

  // 11 октября 2026: опасная кнопка — не акцентная. Подложка — как у
  // вторичной (ghost), подпись и значок — красные (danger); красной заливки нет.
  test.each(['dark', 'light'])('danger — серая подложка вторичной и красная подпись (%s)', async (theme) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
    const colors = (await renderHook(() => useColors())).result.current;
    const danger = await render(<PrimaryButton title="Удалить" variant="danger" onPress={noop} />);
    const ghost = await render(<PrimaryButton title="Отмена" variant="ghost" onPress={noop} />);
    const [d] = danger.getAllByTestId('primary-button');
    const [g] = ghost.getAllByTestId('primary-button');
    expect(flat(d).backgroundColor).toBe(colors.panel2);
    expect(flat(d).backgroundColor).toBe(flat(g).backgroundColor);
    expect(flat(d).backgroundColor).not.toBe(colors.danger);
    expect(flat(danger.getByText('Удалить')).color).toBe(colors.danger);
    // Красное на сером читается: не ниже 4.5 : 1.
    expect(contrast(colors.danger, colors.panel2)).toBeGreaterThanOrEqual(4.5);
  });

  test('«compact» больше не уменьшает кнопку', async () => {
    const screen = await render(<PrimaryButton title="Войти" compact onPress={noop} />);
    expectTokens(screen.getAllByTestId('primary-button'));
  });

  test('в ряд с полем — квадрат высотой с кнопку, а не своя высота', async () => {
    useAppStore.setState({ versions: [] });
    const screen = await render(<VersionsEditor projectId="p1" />);
    const [add] = screen.getAllByTestId('primary-button');
    expect(flat(add).height).toBe(buttonHeight);
    expect(flat(add).width).toBe(buttonHeight);
    expectTokens([add]);
  });
});

describe('листы: все кнопки подвала и содержимого', () => {
  const sheets = [
    ['ActionSheetContent', () => <ActionSheetContent title="Удалить?" message="Это нельзя отменить." actions={[{ label: 'Удалить', onPress: noop }, { label: 'Отмена', onPress: noop }]} />],
    ['AuthSheet', () => <AuthSheet />],
    ['ChangePasswordSheet', () => <ChangePasswordSheet />],
    ['DueSheet', () => <DueSheet task={{ ...task, dueAt: '2026-10-12T10:00:00.000Z' }} lang="ru" onApply={noop} onClear={noop} />],
    ['ExportPeriodSheet', () => <ExportPeriodSheet lang="ru" onConfirm={noop} onCancel={noop} />],
    ['NewProjectSheet', () => <NewProjectSheet onCreated={noop} onCancel={noop} />],
    // У списка настроек проекта кнопок нет (выбор сохраняется сразу); кнопка —
    // «Сохранить» на странице «Название и описание».
    ['NewProjectSheet (существующий, название)', () => <NewProjectSheet project={{ id: 'p1', name: 'Сайт', color: '#87ff65' }} section="name" onCreated={noop} onCancel={noop} onOpenStatuses={noop} />],
    ['NewProjectSheet (существующий, ставка)', () => <NewProjectSheet project={{ id: 'p1', name: 'Сайт', color: '#87ff65' }} section="rate" onCreated={noop} onCancel={noop} onOpenStatuses={noop} />],
    ['QuickTaskSheet', () => <QuickTaskSheet projectId="p1" statusId="s1" contextLabel="В работе" />],
    ['RateSheet', () => <RateSheet lang="ru" initialValue={500} onSave={noop} />],
    ['RepeatSheet', () => <RepeatSheet lang="ru" anchorAt={null} rule={null} onApply={noop} onClear={noop} />],
    ['ReminderSheet', () => <ReminderSheet taskId="t1" />],
    ['SessionSheet', () => <SessionSheet task={task} index={null} />],
    ['SlotSheet', () => <SlotSheet taskId="t1" />],
    ['TagEditSheet', () => <TagEditSheet />],
    ['TagPickerSheet', () => <TagPickerSheet value={[]} onChange={noop} onDone={noop} />],
  ];

  test.each(sheets)('%s', async (_name, make) => {
    openSheet(make());
    const screen = await render(<BottomSheet />);
    const buttons = screen.getAllByTestId('primary-button');
    expect(buttons.length).toBeGreaterThan(0);
    expectTokens(buttons);
    // Кнопка «Войти через Google» — вторичная главная кнопка того же листа.
    for (const g of screen.queryAllByTestId('google-button')) expectTokens([g]);
  });

  test('«Войти через Google» — тех же размеров, что акцентная', async () => {
    openSheet(<AuthSheet />);
    const screen = await render(<BottomSheet />);
    expectTokens([screen.getByTestId('google-button')]);
  });
});

describe('экраны', () => {
  test('согласие: «Продолжить» и «Пропустить»', async () => {
    const screen = await render(<OnboardingScreen />);
    const buttons = screen.getAllByTestId('primary-button');
    expect(buttons).toHaveLength(2);
    expectTokens(buttons);
  });

  test('документы: «Новый документ»', async () => {
    const screen = await render(<DocumentsScreen navigation={{ navigate: noop, setOptions: noop }} route={{}} />);
    expectTokens(screen.getAllByTestId('primary-button'));
  });

  test('меню: «Войти» и «Создать аккаунт» гостя — малые, одной высоты, ниже обычной кнопки', async () => {
    const screen = await render(<SettingsScreen navigation={{ navigate: noop }} />);
    const buttons = screen.getAllByTestId('primary-button');
    expect(buttons).toHaveLength(2);
    expectTokens(buttons, buttonHeightSm);
    for (const b of buttons) expect(flat(b).minHeight).toBeLessThan(buttonHeight);
    // Подписи мельче обычных кнопок.
    expect(flat(screen.getByText(t('ru', 'auth.sign_in'))).fontSize).toBe(fontSize.sm);
    expect(flat(screen.getByText(t('ru', 'auth.create_account'))).fontSize).toBe(fontSize.sm);
  });

  test('остальные кнопки приложения остались обычными: малая — у гостя в меню и у карточки агента', async () => {
    const small = [];
    for (const dir of ['components', 'screens']) {
      (function walk(d) {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (name.endsWith('.js') && /<PrimaryButton[^>]*\bsize=/.test(readFileSync(full, 'utf8'))) small.push(name);
        }
      })(join(__dirname, '..', 'src', dir));
    }
    // Карточка предложения агента: «Применить» и «Отклонить» в ряд — то, для
    // чего малая кнопка и заведена.
    expect(small).toEqual(['ChatCard.js', 'SettingsScreen.js']);
  });
});

// Исходники: кому передают style в PrimaryButton — тот не вправе в нём
// назвать высоту или скругление. Рендер выше видит кнопки на экранах, которые
// умеет открыть; этот обход — все файлы, в том числе экраны за навигацией.
describe('исходники: PrimaryButton не получает своей высоты', () => {
  const root = join(__dirname, '..', 'src');
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'core') walk(full); } else if (name.endsWith('.js')) files.push(full);
    }
  })(root);

  /** Теги <PrimaryButton …> целиком: скобки {} считаем, чтобы `=>` в
   *  обработчиках не принять за конец тега. */
  function tagsOf(src) {
    const out = [];
    for (let at = src.indexOf('<PrimaryButton'); at !== -1; at = src.indexOf('<PrimaryButton', at + 1)) {
      let depth = 0;
      let i = at;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '>' && depth === 0 && src[i - 1] !== '=') break;
      }
      out.push(src.slice(at, i + 1));
    }
    return out;
  }

  test('нет «compact» и style={{ …height… }}', () => {
    for (const file of files) {
      for (const tag of tagsOf(readFileSync(file, 'utf8'))) {
        expect({ file, tag: tag.replace(/\s+/g, ' ').slice(0, 80), compact: /\bcompact\b/.test(tag) }).toMatchObject({ compact: false });
        const inline = tag.match(/style=\{\{([^}]*)\}\}/);
        if (inline) expect({ file, style: inline[1] }).toEqual({ file, style: expect.not.stringMatching(/[hH]eight:|borderRadius:/) });
      }
    }
  });

  test('именованный style кнопки — без высоты, кроме токена buttonHeight', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const tag of tagsOf(src)) {
        const named = tag.match(/style=\{styles\.(\w+)\}/);
        if (!named) continue;
        const def = src.match(new RegExp(`\\b${named[1]}: \\{([^}]*)\\}`));
        expect({ file, name: named[1], found: !!def }).toEqual({ file, name: named[1], found: true });
        // Токен можно называть где угодно (width: buttonHeight), а ключи height/minHeight/borderRadius — только со значением из токена.
        const body = def[1].replace(/(?:min)?[hH]eight: buttonHeight/g, '').replace(/buttonHeight/g, '');
        expect({ file, name: named[1], body }).toEqual({ file, name: named[1], body: expect.not.stringMatching(/[hH]eight:|borderRadius:/) });
      }
    }
  });
});

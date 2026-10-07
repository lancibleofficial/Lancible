// Документы проекта на телефоне (круг 5). Запуск: npm run test:mobile (из корня)
//
// Из меню проекта раздел открывается с projectId: в списке только документы
// этого проекта, а «Новый документ» кладёт документ в него же.
import { render, fireEvent } from '@testing-library/react-native';
import DocumentsScreen from '../src/screens/DocumentsScreen';
import { useAppStore } from '../src/store/useAppStore';

const doc = (id, projectId, title) => ({
  id, projectId, title, pinnedAt: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z',
  body: { v: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] }, comments: [], ink: [] },
});
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    documents: [doc('d1', 'p1', 'Бриф проекта'), doc('d2', null, 'Общая заметка')],
  });
});

test('с projectId — только документы проекта, и заголовок про проект', async () => {
  const navigation = nav();
  const { getByText, queryByText } = await render(<DocumentsScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />);
  getByText('Бриф проекта');
  expect(queryByText('Общая заметка')).toBeNull();
  expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Документы · Сайт' });
});

test('без projectId — все документы', async () => {
  const { getByText } = await render(<DocumentsScreen navigation={nav()} route={{}} />);
  getByText('Бриф проекта');
  getByText('Общая заметка');
});

test('новый документ из раздела проекта — в этом проекте', async () => {
  const navigation = nav();
  const { getByText } = await render(<DocumentsScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />);
  fireEvent.press(getByText('Новый документ'));
  const created = useAppStore.getState().documents.find((d) => !['d1', 'd2'].includes(d.id));
  expect(created.projectId).toBe('p1');
  expect(navigation.navigate).toHaveBeenCalledWith('Editor', { kind: 'doc', id: created.id });
});

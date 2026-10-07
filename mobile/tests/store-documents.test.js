// Документы и заметки на телефоне. Запуск: npm run test:mobile (из корня)
//
// Формат текста — общий с десктопом (src/renderer/core/doc.js) и закрыт
// юнитами в tests/unit/doc.test.js. Здесь — что телефон этим форматом
// пользуется: документы живут в сторе и в его сохранении, у удалённого
// проекта документы становятся общими, а не пропадают.
import { useAppStore } from '../src/store/useAppStore';
import DocCore from '../src/core/doc.js';

beforeEach(() => {
  useAppStore.setState({ projects: [], tasks: [], statuses: [], tags: [], versions: [], documents: [], activeTimer: null });
});

test('новый документ — сверху списка, с пустым текстом в формате редактора', () => {
  const { createDocument } = useAppStore.getState();
  const a = createDocument(null);
  const b = createDocument(null);
  const docs = useAppStore.getState().documents;
  expect(docs.map((d) => d.id)).toEqual([b, a]);
  expect(DocCore.isDocEmpty(docs[0].body)).toBe(true);
});

test('правка документа обновляет время правки', () => {
  const { createDocument, updateDocument } = useAppStore.getState();
  const id = createDocument(null);
  const before = useAppStore.getState().documents[0].updatedAt;
  const body = DocCore.readNotes({ ops: [{ insert: 'Текст\n' }] });
  updateDocument(id, { title: 'Бриф', body });
  const d = useAppStore.getState().documents[0];
  expect(d.title).toBe('Бриф');
  expect(DocCore.docPlainText(d.body.doc)).toBe('Текст');
  expect(d.updatedAt >= before).toBe(true);
});

test('удалили проект — его документы стали общими, а не пропали', () => {
  const { createProject, createDocument, deleteProject } = useAppStore.getState();
  createProject({ name: 'Сайт' });
  const pid = useAppStore.getState().projects[0].id;
  createDocument(pid);
  deleteProject(pid);
  const docs = useAppStore.getState().documents;
  expect(docs).toHaveLength(1);
  expect(docs[0].projectId).toBe(null);
});

test('закрепление и удаление', () => {
  const { createDocument, togglePinDocument, deleteDocument } = useAppStore.getState();
  const id = createDocument(null);
  togglePinDocument(id);
  expect(useAppStore.getState().documents[0].pinnedAt).toBeTruthy();
  deleteDocument(id);
  expect(useAppStore.getState().documents).toEqual([]);
});

test('заметки задачи пишутся в формате, который читают и старые версии', () => {
  const { createProject, createTask, updateTask } = useAppStore.getState();
  createProject({ name: 'P' });
  const pid = useAppStore.getState().projects[0].id;
  const task = createTask(pid);
  const container = DocCore.readNotes({ ops: [{ insert: 'план' }, { insert: '\n', attributes: { list: 'checked' } }] });
  updateTask(task.id, { notes: DocCore.writeNotes(container) });
  const notes = useAppStore.getState().tasks.find((x) => x.id === task.id).notes;
  expect(notes.ops).toEqual([{ insert: 'план' }, { insert: '\n', attributes: { list: 'checked' } }]);
  expect(notes.lancible.doc.content[0].type).toBe('task_list');
});

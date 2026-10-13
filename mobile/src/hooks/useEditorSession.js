// Открытый редактор текста: всё, что нужно экрану вокруг DocEditor и
// нативной панели (components/EditorToolbar.js), — одним хуком на живой
// редактор страницы задачи и на редактор документа (EditorScreen).
//
// - Сохранение: с задержкой SAVE_MS после правки, а flush — сразу (уходя с
//   экрана), и страницу он просит отдать задержанное. Последние буквы,
//   набранные перед «назад», иначе не доезжали бы до задачи. saved — для
//   точки «сохранено» (SavedDot).
// - Состояние панели: format из редактора, режим пера, перо.
// - Команды панели — в мост (ref DocEditor → lib/editorBridge.js); ссылку
//   спрашивает нижний лист (LinkSheet), «Экспорт» отдаёт Markdown листом
//   «Поделиться».
import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import DocCore from '../core/doc.js';
import { useAppStore, getTask } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { openSheet } from '../store/useSheetStore';
import LinkSheet from '../components/LinkSheet';
import { useToolbarVisible } from '../components/EditorToolbar';
import { useEditorAuth, editorUser } from './useEditorAuth';
import { useKeyboardState } from './useKeyboardState';
import { EMPTY_FORMAT, sameFormat } from '../lib/editorBridge';
import { shareTextFile } from '../lib/exportRunner';
import { pickPhoto, PHOTO_TOO_BIG, PHOTO_MAX_BYTES } from '../lib/photoPicker';
import { t } from '../lib/i18n';

export const SAVE_MS = 300;

/** Содержимое из стора: заметки задачи или тело документа. */
export function readSource(kind, id) {
  const s = useAppStore.getState();
  if (kind === 'task') {
    const task = getTask(s.tasks, id);
    return DocCore.readNotes(task ? task.notes : null);
  }
  const doc = (s.documents || []).find((d) => d.id === id);
  return DocCore.readNotes(doc ? doc.body : null);
}

/** Имя файла для «Экспорта»: название документа или задачи. */
function exportName(kind, id, lang) {
  const s = useAppStore.getState();
  const item = kind === 'task' ? getTask(s.tasks, id) : (s.documents || []).find((d) => d.id === id);
  const title = (item && item.title) || (kind === 'doc' && item ? DocCore.docTitleGuess(DocCore.readNotes(item.body).doc) : '');
  return title || t(lang, kind === 'task' ? 'task.no_name' : 'docs.title');
}

/**
 * @param {'task'|'doc'} kind
 * @param {string} id
 * @param {object} [opts] onCaret({ top, bottom }) — курсор в странице.
 */
export function useEditorSession(kind, id, opts = {}) {
  const lang = useAppStore((s) => s.settings.lang);
  const editorSettings = useAppStore((s) => s.settings.editor);
  const setSettings = useAppStore((s) => s.setSettings);
  const showToast = useAppStore((s) => s.showToast);
  // Картинки, стёртые из облака неудавшимся удалением аккаунта: редактор
  // ставит их обратно в очередь на выгрузку (lib/auth.js: deleteAccount).
  const assetRequeue = useAppStore((s) => s.assetRequeue);
  const clearAssetRequeue = useAppStore((s) => s.clearAssetRequeue);
  const profile = useAuthStore((s) => s.user);
  const auth = useEditorAuth();
  const keyboard = useKeyboardState();

  const ref = useRef(null);
  // Содержимое берётся один раз при открытии: дальше хозяин текста —
  // редактор, а стор только записывает за ним.
  const [initial] = useState(() => readSource(kind, id));
  const latest = useRef(initial);
  const pending = useRef(null);
  const timer = useRef(null);
  const [saved, setSaved] = useState(true);
  const [format, setFormat] = useState(EMPTY_FORMAT);
  const [inkOn, setInkOn] = useState(false);
  const [inkPen, setInkPen] = useState(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  function save() {
    clearTimeout(timer.current);
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    const st = useAppStore.getState();
    if (kind === 'task') st.updateTask(id, { notes: DocCore.writeNotes(c) });
    else st.updateDocument(id, { body: DocCore.normalizeContainer(c) });
    setSaved(true);
  }
  function onChange(c) {
    latest.current = c;
    pending.current = c;
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_MS);
  }
  useEffect(() => () => save(), []);

  /** Уходим с экрана: полученное — в стор сразу, а страницу просим отдать
   *  то, что она ещё держит. С nativeToolbar она шлёт правку без своей
   *  задержки (src/editor/host.js: changeDelay), так что это на случай правки
   *  в пути; ответ, пришедший до размонтирования, сохранит обычный путь
   *  (таймер или save на размонтировании). */
  function leave() {
    if (ref.current && ref.current.flush) ref.current.flush();
    save();
  }

  function onSettings(patch) {
    setSettings({ editor: { ...(useAppStore.getState().settings.editor || {}), ...patch } });
  }

  function openLink({ href = '', needText = false } = {}) {
    openSheet(<LinkSheet lang={lang} href={href} needText={needText} onSave={(h, text) => ref.current && ref.current.setLink(h, text)} />);
  }

  function onExport(msg) {
    if (msg.kind === 'copy') {
      // Буфер обмена из WebView без жеста не пишется — пишет телефон.
      Clipboard.setStringAsync(msg.text)
        .then(() => showToast(t(lang, 'editor.copied')), () => showToast(t(lang, 'toast.export_failed')));
      return;
    }
    shareTextFile(msg.name || `${exportName(kind, id, lang)}.md`, msg.mime || 'text/markdown', msg.text, lang, showToast);
  }

  const actions = {
    exec: (name, arg) => ref.current && ref.current.exec(name, arg),
    // Адрес спрашивает лист, но решает редактор: он знает, есть ли
    // выделение (нужна ли подпись), и присылает link { href, needText }.
    link: () => ref.current && ref.current.exec('link'),
    image: () => ref.current && ref.current.exec('image'),
    exportDoc: () => onExport({ kind: 'md', name: `${exportName(kind, id, lang)}.md`, mime: 'text/markdown', text: DocCore.docToMarkdown(latest.current.doc) }),
    ink: (on) => {
      setInkOn(!!on);
      if (ref.current) ref.current.ink(!!on);
    },
    inkTool: (tool) => { setInkPen((p) => ({ ...(p || {}), tool })); if (ref.current) ref.current.inkTool(tool); },
    inkColor: (color) => { setInkPen((p) => ({ ...(p || {}), color })); if (ref.current) ref.current.inkColor(color); },
    inkSize: (size) => { setInkPen((p) => ({ ...(p || {}), size })); if (ref.current) ref.current.inkSize(size); },
  };

  const ink = { ...((editorSettings && editorSettings.ink) || {}), ...(inkPen || {}) };
  const toolbarVisible = useToolbarVisible(inkOn || (keyboard.shown && format.focused));

  const editorProps = {
    ref,
    content: initial,
    onChange,
    lang,
    user: editorUser(auth, profile && (profile.name || profile.email)),
    settings: editorSettings || {},
    onSettings,
    auth,
    onToast: showToast,
    requeue: assetRequeue,
    onRequeued: clearAssetRequeue,
    onFormat: (st) => setFormat((prev) => (sameFormat(prev, st) ? prev : st)),
    onCaret: (c) => optsRef.current.onCaret && optsRef.current.onCaret(c),
    onInk: (m) => {
      setInkOn(!!m.on);
      const pen = {};
      if (m.tool) pen.tool = m.tool;
      if (m.color) pen.color = m.color;
      if (m.size != null) pen.size = m.size;
      if (Object.keys(pen).length) setInkPen((p) => ({ ...(p || {}), ...pen }));
    },
    onLink: openLink,
    // Фото выбирает телефон (системный выбор файла), уменьшает и отдаёт
    // странице байтами; передумали или не вышло — страница узнаёт об этом
    // (cancel). Слишком большое и после сжатия — тост.
    onImagePick: () => {
      pickPhoto().then(
        (photo) => ref.current && ref.current.insertImage(photo || { cancel: true }),
        (err) => {
          if (PHOTO_TOO_BIG && err && err.code === PHOTO_TOO_BIG) {
            showToast(t(lang, 'editor.photo_too_big', { mb: Math.round(PHOTO_MAX_BYTES / (1024 * 1024)) }));
          } else console.error('Не удалось выбрать фото:', err);
          if (ref.current) ref.current.insertImage({ cancel: true });
        },
      );
    },
    onExport,
  };

  return {
    ref,
    editorProps,
    toolbarProps: { lang, format, inkOn, ink, actions, visible: toolbarVisible },
    format,
    inkOn,
    saved,
    keyboard,
    flush: leave,
  };
}

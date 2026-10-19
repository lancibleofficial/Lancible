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
//   «Поделиться», график правится нативным листом (ChartSheet) — редактор
//   шлёт chart { id, spec }, лист отвечает тем же сообщением.
// - PDF (протокол 3): «PDF» в редакторе — системный выбор файла
//   (lib/editorPdf.js: pickPdf) и байты странице; «Сохранить как PDF» —
//   файл в кеш и лист «Поделиться» (lib/exportRunner.js: shareBase64File).
//   PDF-модуль впрыскивает сам DocEditor.
// - Выделенное (протокол 4, 18 октября 2026): редактор шлёт context { kind,
//   state } — картинка, таблица, график, рисунок, страница или слой PDF.
//   Панель, пока есть контекст, видна и без клавиатуры и показывает
//   инструменты этого вида; «назад» снимает выделение (exec deselect).
//   Подпись и описание картинки спрашивает нижний лист ImageTextSheet и
//   отдаёт строкой (exec imageCaption / imageAlt с arg). Выделили блок —
//   картинку, график, рисунок, PDF (не таблицу: в ней пишут) — фокус из
//   текста уходит (blur): клавиатура не закрывает панель и страницу.
import { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import DocCore from '../core/doc.js';
import { useAppStore, getTask } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { openSheet, closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import LinkSheet from '../components/LinkSheet';
import ChartSheet from '../components/ChartSheet';
import MenuSheet from '../components/MenuSheet';
import PrimaryButton from '../components/PrimaryButton';
import { Field } from '../components/AppTextInput';
import { useToolbarVisible } from '../components/EditorToolbar';
import { useEditorAuth, editorUser } from './useEditorAuth';
import { useKeyboardState } from './useKeyboardState';
import { EMPTY_FORMAT, sameFormat, sameContext } from '../lib/editorBridge';
import { shareTextFile, shareBase64File } from '../lib/exportRunner';
import { pickPdf, PDF_TOO_BIG, PDF_MAX_MB } from '../lib/editorPdf';
import { registerEditorFlush } from '../lib/sync';
import { pickPhoto, PHOTO_TOO_BIG, PHOTO_MAX_BYTES } from '../lib/photoPicker';
import { t } from '../lib/i18n';
import { spacing } from '../theme';

/** Записать текст в буфер обмена. expo-clipboard — по требованию, а не
 *  импортом верхнего уровня (20 октября 2026): хук грузится на старте, и без
 *  нативной части модуля падал бы весь запуск (так в Expo Go на iPhone вышло
 *  с expo-document-picker — lib/filePicker.js). Нет модуля — отказ копирования
 *  (тост), а не запуска. */
export function copyText(text) {
  return Promise.resolve().then(() => {
    // eslint-disable-next-line global-require
    const Clipboard = require('expo-clipboard');
    return Clipboard.setStringAsync(text);
  });
}

export const SAVE_MS = 300;
/** Страховка жеста (gesture on без off — оборвалась страница или сообщение):
 *  через столько миллисекунд без off и без autoscroll прокрутка страницы
 *  возвращается сама. Не 10 с: медленный перенос вдали от края (autoscroll
 *  не идёт) длился дольше, страховка возвращала прокрутку посреди жеста, и
 *  ScrollView обрывал перенос (эмулятор, 17 октября 2026). */
export const GESTURE_TIMEOUT_MS = 30000;

/** Подпись или описание картинки: нижний лист с одним полем, как лист
 *  ссылки (LinkSheet), — поле в странице прыгало бы под клавиатурой.
 *  onSave(text) — уже без пробелов по краям; пустое снимает подпись или
 *  описание. unknown — значение есть, но редактор его не прислал (подпись:
 *  протокол 4 сообщает только hasCaption): тогда пустое поле ничего не
 *  стирает, лист просто закрывается. */
export function ImageTextSheet({ lang, title, placeholder, value: initial = '', unknown = false, onSave }) {
  useSheetHeader(title);
  const [value, setValue] = useState(initial || '');
  function save() {
    const v = value.trim();
    if (v || !unknown) onSave(v);
    closeSheet();
  }
  useEffect(() => {
    const foot = (
      <View style={altStyles.foot}>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} testID="image-text-save" />
      </View>
    );
    setSheetFooter(foot);
    return () => clearSheetFooter(foot);
  }, [value]);
  return (
    <View style={altStyles.content}>
      <Field
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        accessibilityLabel={title}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
        testID="image-text-input"
      />
    </View>
  );
}

const altStyles = StyleSheet.create({
  content: { gap: spacing.sm },
  foot: { gap: spacing.sm },
});

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

/** Поле как оно лежит в сторе: заметки задачи или тело документа. */
function rawSource(kind, id) {
  const s = useAppStore.getState();
  const item = kind === 'task' ? getTask(s.tasks, id) : (s.documents || []).find((d) => d.id === id);
  if (!item) return null;
  return (kind === 'task' ? item.notes : item.body) || null;
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
 * @param {object} [opts] onCaret({ top, bottom }) — курсор в странице;
 *  onAutoscroll(dy) — перенос картинки у края: сдвинуть страницу (живой
 *  редактор, высота по тексту); onReady() — страница редактора загрузилась;
 *  onGesture(on) — палец ведёт редактор (gesture), сразу, до отрисовки.
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
  // Картинки гостя — аккаунту, в который перенесли данные «Без аккаунта»
  // (useAuthStore: moveGuestData): отдаёт ближайшая готовая страница редактора.
  const assetAdopt = useAppStore((s) => s.assetAdopt);
  const clearAssetAdopt = useAppStore((s) => s.clearAssetAdopt);
  const profile = useAuthStore((s) => s.user);
  const auth = useEditorAuth();
  const keyboard = useKeyboardState();

  const ref = useRef(null);
  // Содержимое берётся при открытии: дальше хозяин текста — редактор, а
  // стор только записывает за ним. Кроме одного случая (17 октября 2026,
  // журнал правок): текст сменился не отсюда — пришла правка с другого
  // устройства или выбрали версию в «Другой версии». Тогда редактор
  // открывается заново с новым текстом (editorKey — ключ DocEditor у экрана),
  // даже если в нём фокус, как у веба; иначе следующая же буква молча
  // вернула бы старый текст поверх нового. Своё несохранённое при этом не
  // теряется: синхронизация перед приёмом и выбором сначала забирает его в
  // стор (registerEditorFlush) — в журнал оно уходит раньше чужого.
  const [initial, setInitial] = useState(() => readSource(kind, id));
  const [editorKey, setEditorKey] = useState(0);
  const written = useRef(rawSource(kind, id));
  const latest = useRef(initial);
  const pending = useRef(null);
  const timer = useRef(null);
  const [saved, setSaved] = useState(true);
  const [format, setFormat] = useState(EMPTY_FORMAT);
  const [inkOn, setInkOn] = useState(false);
  const [inkPen, setInkPen] = useState(null);
  // Что выделено в тексте (context, протокол 4): { kind, state } или null.
  const [context, setContextState] = useState(null);
  const contextRef = useRef(null);
  function setContext(next) {
    contextRef.current = next;
    setContextState(next);
  }
  // Палец ведёт редактор (gesture, протокол 3): долгое нажатие на ручке
  // картинки, слое PDF или ручке стрелки. Страница задачи на это время не
  // прокручивается. На каждое on редактор шлёт off; страховка — off сам по
  // себе через GESTURE_TIMEOUT_MS тишины (autoscroll продлевает), на
  // перезагрузке страницы, уходе с экрана и уходе приложения в фон.
  const [gesture, setGesture] = useState(false);
  const gestureRef = useRef(false);
  const gestureTimer = useRef(null);
  function setGestureOn(on) {
    clearTimeout(gestureTimer.current);
    gestureTimer.current = null;
    const was = gestureRef.current;
    gestureRef.current = !!on;
    setGesture(!!on);
    // Экрану — сразу, в обход отрисовки (opts.onGesture): значок масштаба
    // картинки тянут без долгого нажатия, и прокрутку страницы надо погасить
    // раньше, чем палец пройдёт порог её перехвата.
    const o = optsRef.current;
    if (was !== !!on && o && o.onGesture) o.onGesture(!!on);
    if (on) gestureTimer.current = setTimeout(() => setGestureOn(false), GESTURE_TIMEOUT_MS);
  }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active' && gestureRef.current) setGestureOn(false); });
    return () => { clearTimeout(gestureTimer.current); if (sub && sub.remove) sub.remove(); };
  }, []);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  function save() {
    clearTimeout(timer.current);
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    const st = useAppStore.getState();
    // Что пишем — запоминаем до записи: подписка ниже увидит ровно этот
    // объект и не примет свою правку за чужую.
    const value = kind === 'task' ? DocCore.writeNotes(c) : DocCore.normalizeContainer(c);
    written.current = value;
    if (kind === 'task') st.updateTask(id, { notes: value });
    else st.updateDocument(id, { body: value });
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
  useEffect(() => registerEditorFlush(() => save()), []);

  useEffect(() => useAppStore.subscribe((s, prev) => {
    if (kind === 'task' ? s.tasks === prev.tasks : s.documents === prev.documents) return;
    const raw = rawSource(kind, id);
    if (raw === written.current) return;
    // Приём из облака кладёт копии — та же правка приходит новым объектом.
    if (JSON.stringify(raw) === JSON.stringify(written.current)) { written.current = raw; return; }
    written.current = raw;
    const c = DocCore.readNotes(raw);
    latest.current = c;
    setInitial(c);
    setEditorKey((k) => k + 1);
    // Новая страница — выделения в ней нет.
    setContext(null);
  }), [kind, id]);

  /** Уходим с экрана: полученное — в стор сразу, а страницу просим отдать
   *  то, что она ещё держит. С nativeToolbar она шлёт правку без своей
   *  задержки (src/editor/host.js: changeDelay), так что это на случай правки
   *  в пути; ответ, пришедший до размонтирования, сохранит обычный путь
   *  (таймер или save на размонтировании). */
  function leave() {
    if (gestureRef.current) setGestureOn(false);
    if (ref.current && ref.current.flush) ref.current.flush();
    save();
  }

  function onSettings(patch) {
    setSettings({ editor: { ...(useAppStore.getState().settings.editor || {}), ...patch } });
  }

  function openLink({ href = '', needText = false } = {}) {
    openSheet(<LinkSheet lang={lang} href={href} needText={needText} onSave={(h, text) => ref.current && ref.current.setLink(h, text)} />);
  }

  /** График: вставка (id null) или правка узла (протокол 2, src/editor/host.js).
   *  Данные — в листе, ответ — редактору тем же сообщением с новым spec;
   *  закрыли лист без сохранения — отмена. */
  function openChart({ id = null, spec = null } = {}) {
    openSheet(
      <ChartSheet
        lang={lang}
        id={id}
        spec={spec}
        onSave={(next) => ref.current && ref.current.chart(id, next)}
        onCancel={() => ref.current && ref.current.chartCancel()}
      />,
    );
  }

  /** Ошибка страницы. Графика, который правили, уже нет в тексте (документ
   *  сменился, пока лист был открыт), — говорим тостом. */
  function onEditorError(message) {
    if (/^chart:/.test(message)) showToast(t(lang, 'chart.failed'));
  }

  function onExport(msg) {
    if (msg.kind === 'copy') {
      // Буфер обмена из WebView без жеста не пишется — пишет телефон.
      copyText(msg.text)
        .then(() => showToast(t(lang, 'editor.copied')), () => showToast(t(lang, 'toast.export_failed')));
      return;
    }
    if (msg.kind === 'pdf') {
      // Имя — как у Markdown: название задачи или документа. Редактор
      // название задачи не знает, и заметки уходили «document.pdf»
      // (эмулятор, 17 октября 2026).
      shareBase64File(`${exportName(kind, id, lang)}.pdf`, msg.mime || 'application/pdf', msg.base64, lang, showToast);
      return;
    }
    // Другой двоичный файл (картинка — «Скачать» в панели картинки,
    // imageDownload) — байтами base64, под именем, которое дал редактор.
    if (typeof msg.base64 === 'string') {
      shareBase64File(msg.name || 'image', msg.mime || 'application/octet-stream', msg.base64, lang, showToast);
      return;
    }
    shareTextFile(msg.name || `${exportName(kind, id, lang)}.md`, msg.mime || 'text/markdown', msg.text, lang, showToast);
  }

  /** «PDF» в редакторе: файл выбирает телефон, байты — странице (pdf-file).
   *  Передумали или не вышло — странице отмена; больше 20 МБ — тост. */
  function onPdfPick() {
    pickPdf().then(
      (file) => ref.current && ref.current.pdfFile(file),
      (err) => {
        if (err && err.code === PDF_TOO_BIG) showToast(t(lang, 'editor.pdf_too_big', { mb: PDF_MAX_MB }));
        else {
          console.error('Не удалось выбрать PDF:', err);
          showToast(t(lang, 'editor.pdf_failed'));
        }
        if (ref.current) ref.current.pdfFile(null);
      },
    );
  }

  const actions = {
    exec: (name, arg) => {
      // Блока больше нет — и его инструментов: панель не ждёт ответа.
      if (name === 'deleteBlock') setContext(null);
      return ref.current && ref.current.exec(name, arg);
    },
    // «Назад» в панели выделенного: выделение снимает редактор (курсор за
    // блок, клавиатура не открывается), обычная строка — сразу. Слой PDF —
    // исключение: снятый слой оставляет выделенной страницу, и её панель
    // приходит следом сообщением context — без мигания обычной строки.
    deselect: () => {
      const c = contextRef.current;
      setContext(c && c.kind === 'pdflayer' ? c : null);
      if (ref.current) ref.current.exec('deselect');
    },
    // Описание и подпись картинки — листом; ответ — exec с текстом.
    imageAlt: (alt) => openSheet(
      <ImageTextSheet
        lang={lang}
        title={t(lang, 'editor.cx_alt_title')}
        placeholder={t(lang, 'editor.cx_alt_ph')}
        value={alt}
        onSave={(v) => ref.current && ref.current.exec('imageAlt', v)}
      />,
    ),
    imageCaption: (caption, has) => openSheet(
      <ImageTextSheet
        lang={lang}
        title={t(lang, 'editor.cx_caption_title')}
        placeholder={t(lang, 'editor.cx_caption_ph')}
        value={caption}
        unknown={!!has && !caption}
        onSave={(v) => ref.current && ref.current.exec('imageCaption', v)}
      />,
    ),
    // Адрес спрашивает лист, но решает редактор: он знает, есть ли
    // выделение (нужна ли подпись), и присылает link { href, needText }.
    link: () => ref.current && ref.current.exec('link'),
    image: () => ref.current && ref.current.exec('image'),
    // «Экспорт»: лист выбора. Markdown собирает телефон из последнего текста;
    // PDF — редактор (exportPdf → export kind pdf, протокол 3).
    exportDoc: () => openSheet(
      <MenuSheet
        title={t(lang, 'editor.tb_export')}
        items={[
          { key: 'export-md', label: t(lang, 'editor.export_md'), icon: 'code', onPress: () => onExport({ kind: 'md', name: `${exportName(kind, id, lang)}.md`, mime: 'text/markdown', text: DocCore.docToMarkdown(latest.current.doc) }) },
          { key: 'export-pdf', label: t(lang, 'editor.export_pdf'), icon: 'doc', onPress: () => ref.current && ref.current.exec('exportPdf') },
        ]}
      />,
    ),
    ink: (on) => {
      setInkOn(!!on);
      if (ref.current) ref.current.ink(!!on);
    },
    inkTool: (tool) => { setInkPen((p) => ({ ...(p || {}), tool })); if (ref.current) ref.current.inkTool(tool); },
    inkColor: (color) => { setInkPen((p) => ({ ...(p || {}), color })); if (ref.current) ref.current.inkColor(color); },
    inkSize: (size) => { setInkPen((p) => ({ ...(p || {}), size })); if (ref.current) ref.current.inkSize(size); },
  };

  const ink = { ...((editorSettings && editorSettings.ink) || {}), ...(inkPen || {}) };
  // Панель: пока пишут (клавиатура и фокус в тексте), пока рисуют и пока
  // что-то выделено — тогда и без клавиатуры. Держалась она одним
  // выделением, и его сняли — уходит сразу: задержка нужна клавиатуре,
  // сменившей раскладку, а без клавиатуры обычная строка мелькнула бы на
  // 300 мс над шитом.
  const typing = keyboard.shown && format.focused;
  const wantBar = inkOn || !!context || typing;
  const onlyContext = useRef(false);
  useEffect(() => { if (wantBar) onlyContext.current = !!context && !inkOn && !typing; });
  const toolbarVisible = useToolbarVisible(wantBar, !wantBar && onlyContext.current);

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
    adopt: assetAdopt,
    onAdopted: clearAssetAdopt,
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
    onChart: openChart,
    onError: onEditorError,
    onPdfPick,
    onAutoscroll: (m) => {
      if (gestureRef.current) setGestureOn(true);
      if (optsRef.current.onAutoscroll) optsRef.current.onAutoscroll(m.dy);
    },
    onGesture: (m) => setGestureOn(!!m.on),
    onContext: (m) => {
      const prev = contextRef.current;
      const next = m && m.kind ? { kind: m.kind, state: m.state || {} } : null;
      if (sameContext(prev, next)) return;
      setContext(next);
      // Выделили блок (не таблицу — в ней пишут): касание поставило фокус
      // в текст, и клавиатура закрыла бы полстраницы. Фокус — прочь,
      // выделение остаётся, панель встаёт у нижнего края.
      if (next && next.kind !== 'table' && (!prev || prev.kind !== next.kind) && ref.current) ref.current.blur();
    },
    // Страница (пере)загрузилась — жест, если был, оборвался вместе с ней,
    // и выделения в ней нет.
    onReady: () => {
      if (gestureRef.current) setGestureOn(false);
      setContext(null);
      if (optsRef.current.onReady) optsRef.current.onReady();
    },
  };

  return {
    ref,
    editorKey,
    editorProps,
    toolbarProps: { lang, format, inkOn, ink, context, actions, visible: toolbarVisible },
    format,
    inkOn,
    context,
    gesture,
    saved,
    keyboard,
    flush: leave,
  };
}

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import Text from './AppText';
import { closeSheet } from '../store/useSheetStore';
import AppTextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useColors, spacing } from '../theme';
import { t } from '../lib/i18n';

const QUILL_VERSION = '2.0.3';
// Разумный минимум для пустого/короткого редактора — раньше высота
// определялась родителем (flex:1 + собственный скролл WebView), теперь
// редактор сам сообщает свою реальную высоту содержимого и живёт внутри
// ScrollView экрана задачи (см. TaskDetailScreen.js) — при пустом контенте
// высота не должна схлопываться в пару строк.
const MIN_HEIGHT = 160;

// Тот же Quill, что на десктопе/вебе (см. src/renderer/app.js) — внутри
// WebView, с CDN вместо локальных vendor-файлов (WebView грузит их по сети
// точно так же, как обычная страница, никаких ограничений на хосты тут нет —
// это не веб-артефакт). Панель инструментов вынесена в EditorToolbar.js и
// живёт СНАРУЖИ этого компонента (см. TaskDetailScreen.js) — так она может
// быть отдельным соседом ScrollView, а не частью прокручиваемого контента, и
// не уезжает от клавиатуры. Таблицы и произвольный цвет текста из десктопной
// версии сюда сознательно не перенесены — на телефоне это скорее мешает, чем
// помогает (нет строки/столбца, где можно прицельно ткнуть пальцем).
function buildHtml(colors, placeholder) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link href="https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist/quill.snow.css" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:${colors.bg};}
  .ql-container.ql-snow{border:none;font-family:sans-serif;font-size:16px;}
  .ql-editor{padding:${spacing.lg}px;color:${colors.text};min-height:${MIN_HEIGHT}px;}
  .ql-editor.ql-blank::before{color:${colors.textDim};font-style:normal;left:${spacing.lg}px;right:${spacing.lg}px;}
  .ql-editor blockquote{border-left:3px solid ${colors.border};color:${colors.textDim};}
  .ql-editor pre.ql-syntax{background:${colors.panel2};color:${colors.text};border-radius:8px;}
  .ql-editor a{color:${colors.accent};}
  ::selection{background:${colors.accentMuted};}
</style>
</head><body>
<div id="editor"></div>
<script src="https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist/quill.js" onerror="document.body.style.background='#c0392b';document.body.innerHTML='<pre style=\'color:#fff;padding:16px;white-space:pre-wrap;font-size:14px\'>FAILED TO LOAD quill.js from CDN</pre>'"></script>
<script>
try {
  var quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: ${JSON.stringify(placeholder)},
    modules: { toolbar: false },
  });

  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  function currentFormat() {
    var sel = quill.getSelection();
    return sel ? quill.getFormat(sel) : {};
  }
  function reportFormat() { post({ type: 'format', format: currentFormat() }); }
  function reportHeight() { post({ type: 'height', height: document.body.scrollHeight }); }
  function reportCaret() {
    var sel = quill.getSelection();
    if (!sel) return;
    var b = quill.getBounds(sel.index, sel.length || 0);
    if (b) post({ type: 'caret', top: b.top, bottom: b.bottom });
  }

  quill.on('text-change', function () {
    post({ type: 'change', ops: quill.getContents().ops });
    reportFormat();
    reportCaret();
    // Не полагаемся только на ResizeObserver ниже — на некоторых WebView он
    // может сработать на кадр-два позже самого текста, из-за чего контент
    // кратко не помещается в ещё не выросшую высоту и мелькает собственный
    // скролл. Явный вызов сразу (плюс с небольшой задержкой — на случай,
    // если Quill ещё не успел доотрисовать DOM синхронно) убирает эту гонку.
    reportHeight();
    setTimeout(reportHeight, 50);
  });
  quill.on('selection-change', function (range) {
    if (range) { reportFormat(); reportCaret(); }
  });

  function handleMessage(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'toggle') {
      var cur = currentFormat();
      quill.format(msg.key, !cur[msg.key]);
    } else if (msg.type === 'list') {
      var cur2 = currentFormat();
      quill.format('list', cur2.list === msg.value ? false : msg.value);
    } else if (msg.type === 'header') {
      var cur3 = currentFormat();
      quill.format('header', cur3.header === msg.value ? false : msg.value);
    } else if (msg.type === 'indent') {
      var cur4 = currentFormat();
      var lvl = (cur4.indent || 0) + msg.dir;
      if (lvl < 0) lvl = 0;
      quill.format('indent', lvl || false);
    } else if (msg.type === 'link') {
      quill.format('link', msg.value || false);
    } else if (msg.type === 'clean') {
      var sel = quill.getSelection();
      if (sel) quill.removeFormat(sel.index, sel.length || 0, 'user');
    } else if (msg.type === 'setContents') {
      quill.setContents(msg.ops);
    }
    reportFormat();
  }
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);

  quill.setContents(window.__initialOps || []);
  reportHeight();
  new ResizeObserver(reportHeight).observe(document.body);
} catch (err) {
  document.body.style.background = '#c0392b';
  document.body.innerHTML = '<pre style="color:#fff;padding:16px;white-space:pre-wrap;font-size:14px">' + (err && err.stack || err) + '</pre>';
}
window.onerror = function (msg, src, line, col, err) {
  document.body.style.background = '#c0392b';
  document.body.innerHTML = '<pre style="color:#fff;padding:16px;white-space:pre-wrap;font-size:14px">' + msg + '\\n' + src + ':' + line + '</pre>';
};
</script>
</body></html>`;
}

export function LinkPromptSheet({ lang, initialValue, onConfirm }) {
  const [url, setUrl] = useState(initialValue || '');

  function save() {
    closeSheet();
    onConfirm(url.trim());
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ fontSize: 18, fontWeight: '800' }}>{t(lang, 'editor.link_title')}</Text>
      <AppTextInput
        autoFocus
        value={url}
        onChangeText={setUrl}
        placeholder="https://example.com"
        autoCapitalize="none"
        keyboardType="url"
        style={{ backgroundColor: '#0000', borderWidth: 0 }}
      />
      <PrimaryButton title={t(lang, 'common.save')} onPress={save} />
    </View>
  );
}

// forwardRef: экран задачи владеет тулбаром (см. TaskDetailScreen.js/
// EditorToolbar.js) отдельно от WebView — ему нужен способ слать команды
// ("toggle bold" и т.п.) в этот компонент напрямую, а не через проп.
const RichTextEditor = forwardRef(function RichTextEditor(
  { value, onChange, onFormatChange, onHeightChange, onCaret, placeholder, lang },
  ref,
) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const webRef = useRef(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const initialOpsRef = useRef(value);

  const html = useMemo(() => {
    const base = buildHtml(colors, placeholder);
    // Подставляем стартовый контент прямо в шаблон вместо отдельного вызова
    // postMessage после загрузки — иначе на медленной сети редактор мог бы на
    // мгновение показаться пустым до прихода первого сообщения.
    return base.replace('window.__initialOps || []', JSON.stringify(initialOpsRef.current || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.bg]);

  function send(msg) {
    webRef.current?.postMessage(JSON.stringify(msg));
  }
  useImperativeHandle(ref, () => ({ send }));

  function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'change') onChange(msg.ops);
    else if (msg.type === 'format') onFormatChange?.(msg.format || {});
    else if (msg.type === 'height') {
      const h = Math.max(MIN_HEIGHT, Math.ceil(msg.height));
      setHeight(h);
      onHeightChange?.(h);
    } else if (msg.type === 'caret') onCaret?.(msg);
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        style={[styles.webview, { height }]}
        source={{ html }}
        onMessage={onMessage}
        scrollEnabled={false}
      />
    </View>
  );
});

export default RichTextEditor;

const makeStyles = (colors) => StyleSheet.create({
  container: { width: '100%' },
  webview: { width: '100%', backgroundColor: colors.bg },
});

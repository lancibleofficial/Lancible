import { useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from './Icon';
import Text from './AppText';
import { openSheet, closeSheet, setSheetFooter } from '../store/useSheetStore';
import AppTextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useColors, spacing, radius } from '../theme';
import { t } from '../lib/i18n';

const QUILL_VERSION = '2.0.3';

// Тот же Quill, что на десктопе/вебе (см. src/renderer/app.js) — внутри
// WebView, с CDN вместо локальных vendor-файлов (WebView грузит их по сети
// точно так же, как обычная страница, никаких ограничений на хосты тут нет —
// это не веб-артефакт). Панель инструментов — НЕ штатная панель Quill (её
// кнопки рассчитаны на мышь и мелкий текст), а собственная RN-панель под
// пальцем: она шлёт команды в WebView через postMessage, а не рисует UI
// внутри страницы. Таблицы и произвольный цвет текста из десктопной версии
// сюда сознательно не перенесены — на телефоне это скорее мешает, чем
// помогает (нет строки/столбца, где можно прицельно ткнуть пальцем).
function buildHtml(colors, placeholder) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link href="https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist/quill.snow.css" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;height:100%;background:${colors.bg};}
  #editor{height:100%;}
  .ql-container.ql-snow{border:none;font-family:sans-serif;font-size:16px;}
  .ql-editor{padding:${spacing.lg}px;color:${colors.text};min-height:100%;}
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

  quill.on('text-change', function () {
    post({ type: 'change', ops: quill.getContents().ops });
    reportFormat();
  });
  quill.on('selection-change', function (range) {
    if (range) reportFormat();
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

function LinkPromptSheet({ lang, initialValue, onConfirm }) {
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

const TOOLBAR_ITEMS = [
  { type: 'toggle', key: 'bold', label: 'B', bold: true },
  { type: 'toggle', key: 'italic', label: 'I', italic: true },
  { type: 'toggle', key: 'underline', label: 'U', underline: true },
  { type: 'toggle', key: 'strike', label: 'S', strike: true },
  { sep: true },
  { type: 'header', value: 1, label: 'H1' },
  { type: 'header', value: 2, label: 'H2' },
  { type: 'header', value: 3, label: 'H3' },
  { sep: true },
  { type: 'list', value: 'bullet', icon: 'list-bullet' },
  { type: 'list', value: 'ordered', icon: 'list-ordered' },
  { type: 'list', value: 'checked', icon: 'list-check' },
  { type: 'indent', dir: -1, icon: 'indent-dec' },
  { type: 'indent', dir: 1, icon: 'indent-inc' },
  { sep: true },
  { type: 'toggle', key: 'blockquote', icon: 'blockquote' },
  { type: 'toggle', key: 'code-block', icon: 'code' },
  { type: 'link', icon: 'link' },
  { type: 'clean', icon: 'eraser' },
];

export default function RichTextEditor({ value, onChange, placeholder, lang }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const webRef = useRef(null);
  const [format, setFormat] = useState({});
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

  function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'change') onChange(msg.ops);
    else if (msg.type === 'format') setFormat(msg.format || {});
  }

  function onLinkPress() {
    openSheet(<LinkPromptSheet lang={lang} initialValue={format.link} onConfirm={(url) => send({ type: 'link', value: url })} />);
  }

  function onItemPress(item) {
    if (item.type === 'link') return onLinkPress();
    send(item);
  }

  function isActive(item) {
    if (item.type === 'toggle') return !!format[item.key];
    if (item.type === 'list') return format.list === item.value;
    if (item.type === 'header') return format.header === item.value;
    return false;
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        style={styles.webview}
        source={{ html }}
        onMessage={onMessage}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
        {TOOLBAR_ITEMS.map((item, i) => {
          if (item.sep) return <View key={`sep${i}`} style={styles.sep} />;
          const active = isActive(item);
          return (
            <Pressable key={i} onPress={() => onItemPress(item)} style={[styles.btn, active && styles.btnActive]}>
              {item.icon ? (
                <Icon name={item.icon} size={17} color={active ? colors.accent : colors.text} />
              ) : (
                <Text style={[styles.btnLabel, item.bold && styles.bold, item.italic && styles.italic, item.underline && styles.underline, item.strike && styles.strike, active && { color: colors.accent }]}>
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexGrow: 0, backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  toolbarContent: { paddingHorizontal: spacing.sm, alignItems: 'center', gap: 2 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  btn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  btnActive: { backgroundColor: colors.accentMuted },
  btnLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  bold: { fontWeight: '900' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
});

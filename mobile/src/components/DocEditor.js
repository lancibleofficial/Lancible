import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { EDITOR_CSS, EDITOR_JS } from '../editor/editorBundle';
import { editorCssVars, useColors, useThemeMode } from '../theme';

// Редактор текста на телефоне — тот же, что на десктопе и в вебе
// (src/editor/, ProseMirror), внутри WebView. Сборка лежит строкой в
// src/editor/editorBundle.js (scripts/build-editor.js): сети он не просит,
// работает без интернета.
//
// Два режима:
//  - полный (EditorScreen) — WebView на весь экран со своей прокруткой,
//    панелью, рисованием пером;
//  - предпросмотр (preview) — только чтение, высота по содержимому, касание
//    открывает полный. В заметках задачи WebView живёт внутри ScrollView
//    экрана, и рисовать или выделять текст в таком месте неудобно: жест
//    перехватывает прокрутка страницы.
//
// baseUrl — настоящий адрес, а не about:blank: у страницы без адреса нет
// своего хранилища, и картинки (IndexedDB, см. src/editor/assets.js) жили бы
// только до закрытия экрана.
const BASE_URL = 'https://lancible.vercel.app/app/';
const MIN_PREVIEW = 96;

/** JSON внутрь <script>: «</» разорвал бы тег. */
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function buildHtml(init, mode) {
  const preview = init.preview;
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>${editorCssVars(mode)}
${EDITOR_CSS}
html,body{margin:0;padding:0;background:var(--panel);color:var(--text);font-family:var(--font-ui);-webkit-text-size-adjust:100%;}
html,body,#host{height:100%;}
#host{display:flex;flex-direction:column;}
${preview ? `html,body,#host{height:auto;overflow:hidden;}
.led{height:auto;}
.led .led-scroll{overflow:visible;}
.led .led-page-wrap{padding:8px 4px 8px;}
.led .led-toolbar,.led .led-status,.led .led-tablebar{display:none;}
#tap{position:fixed;inset:0;z-index:1000;}` : ''}
</style></head><body><div id="host"></div>${preview ? '<div id="tap"></div>' : ''}
<script>${EDITOR_JS}</script>
<script>
(function(){
  var S = ${inline(init)};
  function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  window.onerror = function(msg, src, line){ post({ type: 'error', message: String(msg) + ' @' + line }); };
  var ed = LancibleEditor.create(document.getElementById('host'), {
    content: S.content,
    mobile: true,
    placeholder: S.placeholder || undefined,
    lang: function(){ return S.lang; },
    user: function(){ return S.user; },
    settings: function(){ return S.settings || {}; },
    onSettings: function(patch){ S.settings = Object.assign({}, S.settings || {}, patch); post({ type: 'settings', patch: patch }); },
    assets: LancibleEditor.createAssetStore({ remote: function(){ return S.auth; } }),
    onChange: function(c){ post({ type: 'change', content: c }); },
    toast: function(m){ post({ type: 'toast', message: m }); },
    openUrl: function(href){ post({ type: 'open', href: href }); },
    onDrawingActive: function(on){ post({ type: 'drawing', on: on }); }
  });
  window.__ed = ed;
  if (S.readOnly) ed.setEditable(false);
  if (S.auth) ed.assets.flush();
  function height(){ post({ type: 'height', height: Math.ceil(document.querySelector('.led-page').getBoundingClientRect().height + 20) }); }
  if (S.preview) {
    new ResizeObserver(height).observe(document.querySelector('.led-page'));
    height();
    document.getElementById('tap').addEventListener('click', function(){ post({ type: 'tap' }); });
  }
  function onMessage(e){
    var m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.type === 'setContent') ed.setContent(m.content);
    else if (m.type === 'auth') { S.auth = m.auth; if (m.auth) ed.assets.flush(); }
    else if (m.type === 'lang') { S.lang = m.lang; }
    else if (m.type === 'exec') ed.exec(m.name, m.arg);
    else if (m.type === 'flush') ed.flush();
    else if (m.type === 'focus') ed.focus();
  }
  document.addEventListener('message', onMessage);
  window.addEventListener('message', onMessage);
  post({ type: 'ready' });
})();
</script></body></html>`;
}

/**
 * @param {object} props
 *  content — контейнер документа (core/doc.js: readNotes);
 *  onChange(container); lang; user — { id, name } для комментариев;
 *  settings / onSettings — вид и перо (state.settings.editor);
 *  auth — { url, anonKey, accessToken, userId } для облака картинок или null;
 *  preview — режим предпросмотра; onOpen — касание в предпросмотре;
 *  onToast(message).
 */
const DocEditor = forwardRef(function DocEditor(props, ref) {
  const { content, onChange, lang, user, settings, onSettings, auth, preview, onOpen, onToast, placeholder } = props;
  const colors = useColors();
  const mode = useThemeMode();
  const webRef = useRef(null);
  const [height, setHeight] = useState(MIN_PREVIEW);
  const initRef = useRef({ content, lang, user, settings, auth, preview: !!preview, readOnly: !!preview, placeholder });
  // Предпросмотр перечитывает содержимое при каждом изменении — его правят в
  // полном редакторе, и он должен показать свежее, вернувшись на экран.
  if (preview) initRef.current = { ...initRef.current, content };

  const html = useMemo(
    () => buildHtml(initRef.current, mode),
    // Пересобирается на смену темы, а в предпросмотре — и на смену текста.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, preview ? JSON.stringify(content) : null],
  );

  const send = (msg) => webRef.current?.postMessage(JSON.stringify(msg));
  useImperativeHandle(ref, () => ({ send, flush: () => send({ type: 'flush' }) }));

  useEffect(() => { send({ type: 'auth', auth: auth || null }); }, [auth && auth.accessToken]);
  useEffect(() => { send({ type: 'lang', lang }); }, [lang]);

  function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'change') onChange && onChange(msg.content);
    else if (msg.type === 'settings') onSettings && onSettings(msg.patch);
    else if (msg.type === 'height') setHeight(Math.max(MIN_PREVIEW, msg.height));
    else if (msg.type === 'tap') onOpen && onOpen();
    else if (msg.type === 'toast') onToast && onToast(msg.message);
    else if (msg.type === 'open' && /^(https?:|mailto:)/i.test(msg.href)) Linking.openURL(msg.href);
    else if (msg.type === 'error') console.error('[editor]', msg.message);
  }

  return (
    <View style={preview ? { height } : styles.full}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: BASE_URL }}
        onMessage={onMessage}
        style={[styles.web, { backgroundColor: colors.panel }]}
        scrollEnabled={!preview}
        nestedScrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        domStorageEnabled
        javaScriptEnabled
      />
    </View>
  );
});

export default DocEditor;

const styles = StyleSheet.create({
  full: { flex: 1 },
  web: { flex: 1 },
});

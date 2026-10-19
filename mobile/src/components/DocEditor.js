import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Linking, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { EDITOR_CSS, EDITOR_JS, EDITOR_VIEWPORT } from '../editor/editorBundle';
import { editorCssVars, useColors, useThemeMode } from '../theme';
import { createBridge, inline, parseMessage } from '../lib/editorBridge';
import { loadPdfModuleText, pdfModuleScript } from '../lib/editorPdf';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { useAssetForget, dropAssetForget } from '../lib/assetForget';

// Редактор текста на телефоне — тот же, что на десктопе и в вебе
// (src/editor/, ProseMirror), внутри WebView. Сборка лежит строкой в
// src/editor/editorBundle.js (scripts/build-editor.js): сети он не просит,
// работает без интернета.
//
// Два режима:
//  - живой (live) — заметки прямо на странице задачи (12 октября 2026):
//    касание ставит курсор, клавиатура, пишем на месте. Высота WebView — по
//    содержимому (редактор присылает height, autoHeight), но не ниже
//    minHeight: поле заметок тянется до низа видимой страницы (13 октября
//    2026), и касание пустого места под текстом ставит курсор в конец (это
//    делает сам редактор, src/editor/index.js: onBlankDown). Прокручивает
//    экран задачи; курсор над клавиатурой держит экран по сообщению caret;
//  - полный (EditorScreen, документы) — WebView на весь экран со своей
//    прокруткой.
// Панель нативная (components/EditorToolbar.js): веб-панели и панели пера в
// странице нет (nativeToolbar), команды и состояние идут через мост
// (lib/editorBridge.js, протокол — src/editor/host.js). Страница не
// масштабируется (user-scalable=no), и масштаба текста нет: с 13 октября
// 2026 щипок убран — он мешал писать.
//
// PDF-модуль (17 октября 2026, протокол 3): pdf.js и pdf-lib в строку
// редактора не входят — по сообщению pdf-module этот компонент сам
// впрыскивает ассет mobile/assets/editor-pdf.txt (lib/editorPdf.js), один
// раз на загрузку страницы: смена темы пересобирает страницу — и модуль
// впрыскивается заново по следующему запросу.
//
// baseUrl — настоящий адрес, а не about:blank: у страницы без адреса нет
// своего хранилища, и картинки (IndexedDB, см. src/editor/assets.js) жили бы
// только до закрытия экрана.
export const EDITOR_BASE_URL = 'https://lancible.vercel.app/app/';
const BASE_URL = EDITOR_BASE_URL;
const EDITOR_ORIGIN = 'https://lancible.vercel.app';
const MIN_HEIGHT = 96;
/** Сколько ждать ответа впрыснутого PDF-модуля, мс (редактор ждёт столько же:
 *  src/editor/pdf.js, MODULE_WAIT_MS). */
export const PDF_MODULE_WAIT_MS = 30000;

// Окно закрыто (13 октября 2026). Страница — своя, строкой из сборки, и
// уходить с неё WebView незачем: ссылка из документа (http, https, mailto) —
// в браузер системы, прочее (javascript:, file:, intent:, data:) — никуда.
// Сообщения принимаются только от своей страницы: адрес у них разный по
// платформам — iOS даёт адрес кадра (baseUrl), Android с WebMessageListener —
// источник без пути, а старый Android (WebView без него) — getUrl() страницы,
// загруженной строкой, то есть about:blank: там отличить кадр нельзя, и
// about:blank свой.

/** Можно ли WebView грузить этот адрес. Ссылку наружу (переход всей
 *  страницы, не кадра в ней) открывает браузер системы. */
export function allowEditorLoad(req) {
  const url = String((req && req.url) || '');
  if (url === 'about:blank' || url === 'about:srcdoc' || url.startsWith(EDITOR_BASE_URL)) return true;
  if (req && req.isTopFrame !== false && /^(https?:|mailto:)/i.test(url)) {
    try {
      const p = Linking.openURL(url);
      if (p && p.catch) p.catch(() => {});
    } catch { /* открыть нечем — остаёмся на странице */ }
  }
  return false;
}

/** Сообщение пришло от страницы редактора. */
export function fromEditor(url, os = Platform.OS) {
  const u = String(url || '');
  if (u === EDITOR_ORIGIN || u.startsWith(`${EDITOR_ORIGIN}/`)) return true;
  return os === 'android' && u === 'about:blank';
}

/** Живой редактор: высота по содержимому — страница не прокручивается сама,
 *  её высоту меряет редактор (autoHeight) и подставляет телефон. Поля по
 *  бокам — у страницы задачи свои (screenPadding), у текста только воздух.
 *  WebView бывает выше текста (minHeight) — пустое место под редактором
 *  тогда занимает сам #host: касание по нему ловит редактор и ставит курсор
 *  в конец. Высота самого редактора (.led) от этого не растёт. */
const LIVE_CSS = `html,body,#host{height:auto;overflow:hidden;}
#host{min-height:100vh;}
#host .led .led-page-wrap{padding:8px 4px 16px;}`;

function buildHtml(init, mode) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="${EDITOR_VIEWPORT}">
<style>${editorCssVars(mode)}
${EDITOR_CSS}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:var(--font-ui);-webkit-text-size-adjust:100%;}
html,body,#host{height:100%;}
#host{display:flex;flex-direction:column;}
${init.live ? LIVE_CSS : ''}
</style></head><body><div id="host"></div>
<script>${EDITOR_JS}</script>
<script>
(function(){
  var S = ${inline(init)};
  function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  // «ResizeObserver loop…» — предупреждение браузера, а не поломка: после
  // вставки графика (высота страницы растёт) оно сыпалось в журнал ошибкой.
  window.onerror = function(msg, src, line){ if (/ResizeObserver loop/.test(String(msg))) return true; post({ type: 'error', message: String(msg) + ' @' + line }); };
  var ed = LancibleEditor.create(document.getElementById('host'), {
    content: S.content,
    mobile: true,
    inApp: true,
    // Протокол хозяина (src/editor/host.js, DESIGN.md «Редактор на
    // телефоне: протокол»): панель снаружи, высота по тексту, сообщения — post.
    nativeToolbar: true,
    autoHeight: !!S.live,
    post: post,
    placeholder: S.placeholder || undefined,
    lang: function(){ return S.lang; },
    user: function(){ return S.user; },
    settings: function(){ return S.settings || {}; },
    onSettings: function(patch){ S.settings = Object.assign({}, S.settings || {}, patch); post({ type: 'settings', patch: patch }); },
    // Хозяин картинки — открытая область (uid аккаунта, у гостя null), как у
    // десктопа и веба (owner: () => scopeUid), а не тот, чьё облако сейчас
    // открыто: с выключенной синхронизацией, посреди переключения или пока
    // сеанс не пришёл облака нет, и картинка без owner стала бы «гостевой»
    // навсегда (src/editor/assets.js: ownerNow).
    assets: LancibleEditor.createAssetStore({ remote: function(){ return S.auth; }, owner: function(){ return S.owner || null; } }),
    onChange: function(c){ post({ type: 'change', content: c }); },
    toast: function(m){ post({ type: 'toast', message: m }); },
    openUrl: function(href){ post({ type: 'open', href: href }); }
  });
  window.__ed = ed;
  if (S.auth) ed.assets.flush();
  function onMessage(e){
    var m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (!m || typeof m !== 'object') return;
    // Протокол редактора: exec, setContent, focus, blur,
    // insertImage, setLink, getState. Остальное — страницы.
    if (ed.receive(m)) return;
    if (m.type === 'auth') { S.auth = m.auth; if (m.auth) ed.assets.flush(); }
    else if (m.type === 'owner') { S.owner = m.owner || null; }
    else if (m.type === 'lang') { S.lang = m.lang; }
    else if (m.type === 'flush') ed.flush();
    else if (m.type === 'requeue') {
      // Картинки снова в очереди на выгрузку: удаление аккаунта стёрло их из
      // облака, а аккаунт остался. Выгрузит их flush — сейчас, если вход есть,
      // или когда придёт auth.
      ed.assets.requeue(m.ids).then(function(n){
        post({ type: 'requeued', ids: m.ids, n: n });
        if (S.auth) ed.assets.flush();
      }, function(err){ post({ type: 'error', message: 'requeue: ' + err }); });
    }
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
 *  live — живой редактор на странице (высота по содержимому);
 *  minHeight — живой: не ниже стольких точек (до низа видимой страницы);
 *  onFormat(state), onCaret({ top, bottom }), onInk({ on, tool, color, size }),
 *  onHeight(px), onImagePick({ purpose }), onLink({ href, needText }),
 *  onExport({ kind, name, mime, text, base64? }), onChart({ id, spec }), onError(message),
 *  onPdfPick(), onAutoscroll({ dy }), onGesture({ on }), onContext({ kind, state }),
 *  onReady() — сообщения моста (lib/editorBridge.js);
 *  onToast(message);
 *  requeue — id картинок, которые надо снова выгрузить в облако
 *  (стор: assetRequeue); onRequeued(ids) — редактор поставил их в очередь;
 *  adopt — id аккаунта, которому отдать картинки, вставленные без аккаунта
 *  (стор: assetAdopt), или null; onAdopted(userId) — страница его получила.
 * Сам (без пропсов) редактор знает открытую область (хозяин новых картинок,
 *  owner), отдаёт ей гостевые картинки своего документа (assets-adopt
 *  referenced) и шлёт очередь стирания картинок убранных аккаунтов
 *  (lib/assetForget.js: assets-forget → assets-forgotten).
 * ref: send(msg), flush() и команды моста (createBridge) — exec, setContent, focus, blur, getState, insertImage, setLink, chart, ink, inkTool,
 *  inkColor, inkSize, pdfFile, pdfModuleReady, viewport.
 */
const DocEditor = forwardRef(function DocEditor(props, ref) {
  const {
    content, onChange, lang, user, settings, onSettings, auth, live, minHeight = 0, onToast, placeholder, requeue, onRequeued,
    adopt, onAdopted,
    onFormat, onCaret, onInk, onHeight, onImagePick, onLink, onExport, onChart, onError, onReady,
    onPdfPick, onAutoscroll, onGesture, onContext,
  } = props;
  const colors = useColors();
  const mode = useThemeMode();
  const webRef = useRef(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  // Чья область открыта — хозяин вставленных картинок (у гостя null).
  const owner = useAppStore((s) => s.scopeUid) || null;
  // Область — аккаунт, и он вошёл: гостевые картинки открытого документа —
  // его (протокол 5). Документ этой области, значит, и картинки в нём её:
  // вставлены, пока облака не было (синхронизация выключена, сеанс не
  // пришёл, до 19 октября телефон писал им owner: null). Гостю — никогда.
  const signedUid = useAuthStore((s) => (s.status === 'signedIn' && s.user ? s.user.id : null));
  const adoptOwn = owner && signedUid === owner ? owner : null;
  // Чьи картинки стереть с устройства (аккаунт убран с телефона).
  const forgetKey = useAssetForget((s) => s.uids.join(','));
  const initRef = useRef({
    content, lang, user, settings, auth, placeholder, owner,
    live: !!live,
  });

  // Пересобирается на смену темы — с последним текстом (см. change ниже).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildHtml(initRef.current, mode), [mode]);

  const send = (msg) => webRef.current?.postMessage(JSON.stringify(msg));
  const bridge = useMemo(() => createBridge(send), []);
  // Новый документ в странице (setContent) — его гостевые картинки тоже
  // аккаунту: сообщения страница разбирает по порядку, adopt увидит уже его.
  useImperativeHandle(ref, () => ({
    send, flush: () => send({ type: 'flush' }), ...bridge,
    setContent: (content) => { bridge.setContent(content); sendAdoptOwn(); },
  }));

  // Сообщение, посланное до «ready», страница не получит: WebView ещё грузит
  // её. Поэтому всё, что может поменяться после первого рендера, страница
  // получает заново по «ready». Без этого вход терялся всегда: сессия
  // (useEditorAuth) приходит асинхронно, раньше страницы, и в облако с
  // телефона не уходило ни одной картинки.
  const ready = useRef(false);
  const latest = useRef({ auth, lang, owner, adoptOwn });
  latest.current = { auth, lang, owner, adoptOwn };

  useEffect(() => { send({ type: 'auth', auth: auth || null }); }, [auth && auth.accessToken]);
  useEffect(() => {
    initRef.current = { ...initRef.current, owner };
    send({ type: 'owner', owner });
  }, [owner]);
  useEffect(() => { send({ type: 'lang', lang }); }, [lang]);

  // Список на возврат — тоже по «ready», и пока редактор открыт — при каждой
  // его смене.
  const requeueKey = (requeue || []).join(',');
  function sendRequeue() {
    if (ready.current && requeue && requeue.length) send({ type: 'requeue', ids: requeue });
  }
  useEffect(sendRequeue, [requeueKey]);

  // Картинки гостя — аккаунту (assets-adopt, протокол 3): данные «Без
  // аккаунта» перенесли в аккаунт. Хранилище картинок у всех страниц
  // редактора общее, хватает одной: эта отдаёт, если уже готова, или по
  // своему ready; дальше стор uid снимает (onAdopted) — другим не слать.
  function sendAdopt() {
    if (!ready.current || !adopt) return;
    send({ type: 'assets-adopt', userId: adopt });
    if (onAdopted) onAdopted(adopt);
  }
  useEffect(sendAdopt, [adopt]);

  // Гостевые картинки открытого документа — аккаунту области (referenced:
  // только те, на которые документ ссылается; остальные гостевые не
  // трогаются). По ready (документ страница получает при создании) и когда
  // аккаунт вошёл, пока редактор открыт.
  function sendAdoptOwn() {
    const userId = latest.current.adoptOwn;
    if (ready.current && userId) send({ type: 'assets-adopt', userId, referenced: true });
  }
  useEffect(sendAdoptOwn, [adoptOwn]);

  // Картинки аккаунтов, убранных с телефона, — стереть (lib/assetForget.js).
  // Хранилище общее у всех страниц: шлёт каждая готовая, с очереди uid снимает
  // первый ответ. Своя область — не стирается (её туда и не ставят: открытие
  // области снимает её с очереди).
  function sendForget() {
    if (!ready.current) return;
    for (const userId of useAssetForget.getState().uids) {
      if (userId !== latest.current.owner) send({ type: 'assets-forget', userId });
    }
  }
  useEffect(sendForget, [forgetKey]);

  // PDF-модуль на этой загрузке страницы: loaded — уже исполнен (ответ
  // впрыснутой строки, pdf-module-loaded), loading — с какого времени ассет
  // читается или строка в пути; ответ редактору тогда даст она сама. Не
  // ответила за PDF_MODULE_WAIT_MS (столько ждёт и редактор) — следующий
  // запрос впрыскивает снова.
  const pdfMod = useRef({ loaded: false, loading: 0 });
  function injectPdfModule() {
    const st = pdfMod.current;
    if (st.loaded) { bridge.pdfModuleReady(); return; }
    if (st.loading && Date.now() - st.loading < PDF_MODULE_WAIT_MS) return;
    st.loading = Date.now();
    loadPdfModuleText().then(
      (text) => {
        if (!webRef.current || !webRef.current.injectJavaScript) throw new Error('WebView закрыт');
        webRef.current.injectJavaScript(pdfModuleScript(text));
      },
    ).catch((err) => {
      st.loading = 0;
      console.error('[editor] PDF-модуль:', err);
      bridge.pdfModuleReady((err && err.message) || String(err));
    });
  }

  function onMessage(e) {
    if (!fromEditor(e.nativeEvent.url)) return;
    const msg = parseMessage(e.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'change':
        // Пересборка страницы (смена темы) поднимет последнее, а не то, с
        // чем экран открывался.
        initRef.current = { ...initRef.current, content: msg.content };
        if (onChange) onChange(msg.content);
        break;
      case 'settings':
        if (onSettings) onSettings(msg.patch);
        break;
      case 'height':
        setHeight(Math.max(MIN_HEIGHT, msg.px));
        if (onHeight) onHeight(msg.px);
        break;
      case 'toast': if (onToast) onToast(msg.message); break;
      case 'open': if (/^(https?:|mailto:)/i.test(msg.href)) Linking.openURL(msg.href); break;
      case 'format': if (onFormat) onFormat(msg.state); break;
      case 'caret': if (onCaret) onCaret(msg); break;
      case 'ink': if (onInk) onInk(msg); break;
      case 'image-pick': if (onImagePick) onImagePick(msg); break;
      case 'link': if (onLink) onLink(msg); break;
      case 'export': if (onExport) onExport(msg); break;
      case 'chart': if (onChart) onChart(msg); break;
      case 'pdf-pick': if (onPdfPick) onPdfPick(msg); break;
      case 'pdf-module': injectPdfModule(); break;
      case 'pdf-module-loaded':
        pdfMod.current = { loaded: !!msg.ok, loading: 0 };
        if (!msg.ok) console.error('[editor] PDF-модуль не исполнился:', msg.error);
        break;
      case 'autoscroll': if (onAutoscroll) onAutoscroll(msg); break;
      case 'gesture': if (onGesture) onGesture(msg); break;
      // Что выделено (протокол 4): панель меняет содержимое (EditorToolbar).
      case 'context': if (onContext) onContext(msg); break;
      case 'ready':
        ready.current = true;
        // Новая загрузка страницы — модуля в ней нет.
        pdfMod.current = { loaded: false, loading: 0 };
        send({ type: 'auth', auth: latest.current.auth || null });
        send({ type: 'owner', owner: latest.current.owner });
        send({ type: 'lang', lang: latest.current.lang });
        sendRequeue();
        sendAdopt();
        sendAdoptOwn();
        sendForget();
        // Панели — всё заново: что под курсором и какое перо.
        bridge.getState();
        if (onReady) onReady();
        break;
      case 'requeued': if (onRequeued) onRequeued(msg.ids); break;
      case 'assets-forgotten': if (msg.userId) dropAssetForget(msg.userId); break;
      case 'error':
        console.error('[editor]', msg.message);
        if (onError) onError(String(msg.message || ''));
        break;
      default: break;
    }
  }

  return (
    <View collapsable={false} style={live ? { height: Math.max(height, Math.round(minHeight) || 0) } : styles.full} testID="doc-editor">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: BASE_URL }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={allowEditorLoad}
        style={[styles.web, { backgroundColor: colors.bg }]}
        scrollEnabled={!live}
        nestedScrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        setSupportMultipleWindows={false}
        setBuiltInZoomControls={false}
        allowFileAccess={false}
        domStorageEnabled
        javaScriptEnabled
        // Только в разработке: страницу редактора можно открыть в отладчике
        // (chrome://inspect на Android, Safari на iOS) — IndexedDB, консоль,
        // сеть. В выпускной сборке __DEV__ ложно, и WebView закрыт.
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
});

export default DocEditor;

const styles = StyleSheet.create({
  full: { flex: 1 },
  web: { flex: 1 },
});

// «ИИ-агент в закрытом тесте» (21 октября 2026) — вместо поля, фразы и
// списка чатов на главном экране «Чат-бота» и вместо ленты с полем в открытом
// чате, пока аккаунту не выдали доступ (lib/aiAccess.js). Деталь — общий
// пустой экран (EmptyState): сценка chat, та же, что над полем, заголовок,
// пояснение, мелкая строка про почту и «Запросить доступ».
//
// Нажатие — строка обратной связи с почтой аккаунта (aiRequestAccess, тот же
// код, что у экрана «Обратная связь»). Ушла — «Запрос отправлен», кнопка
// неактивна, и так же после перезапуска (отметка по аккаунту на устройстве).
// База отказала по частоте — строка feedback.rate; другая ошибка — общая
// строка ai.request_failed (не feedback.failed: поля тут нет, «Текст сохранён»
// был бы неправдой); кнопка тогда — «Повторить».
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import EmptyState from '../EmptyState';
import { InfoRow } from '../RepeatControls';
import { CHAT_ART } from './ChatGreeting';
import { useAiAccess, aiLoadRequest, aiRequestAccess } from '../../lib/aiAccess';
import { spacing, screenPadding } from '../../theme';
import { t } from '../../lib/i18n';

export default function ChatLocked({ lang, uid, email, clearance = 0, testID = 'chat-locked' }) {
  const s = makeStyles(clearance);
  const sent = useAiAccess((st) => !!(uid && st.sent[uid]));
  const [busy, setBusy] = useState(false);
  // Ключ строки ошибки: feedback.rate или ai.request_failed; null — нет.
  const [failed, setFailed] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { aiLoadRequest(uid); setFailed(null); }, [uid]);

  const request = async () => {
    if (busy || sent || !uid) return;
    setBusy(true);
    setFailed(null);
    const res = await aiRequestAccess({ uid, email, lang });
    if (!alive.current) return;
    setBusy(false);
    if (!res.ok) setFailed(res.rate ? 'feedback.rate' : 'ai.request_failed');
  };

  const label = sent ? t(lang, 'ai.request_sent') : failed ? t(lang, 'feedback.retry') : t(lang, 'ai.request_access');
  return (
    <ScrollView contentContainerStyle={s.center} testID={testID}>
      <EmptyState
        art={CHAT_ART}
        title={t(lang, 'ai.locked_title')}
        text={t(lang, 'ai.locked_text')}
        note={t(lang, 'ai.locked_note')}
        actionLabel={label}
        actionIcon={sent ? 'check' : undefined}
        onAction={request}
        actionDisabled={sent}
        actionLoading={busy}
        actionTestID="chat-request"
        primary
        testID="chat-locked-state"
      >
        {failed ? <View style={s.error}><InfoRow danger icon="danger" text={t(lang, failed)} testID="chat-request-error" /></View> : null}
      </EmptyState>
    </ScrollView>
  );
}

const makeStyles = (clearance) => StyleSheet.create({
  center: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: screenPadding, paddingVertical: spacing.lg, paddingBottom: clearance },
  // Строка ошибки — во всю ширину блока, как кнопка под ней.
  error: { alignSelf: 'stretch' },
});

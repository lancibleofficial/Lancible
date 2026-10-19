// Строка ленты чата: сообщение человека (остров справа, над ним — плашки
// вложений «имя · тип · размер», ChatFiles: SentFiles), ответ агента (текст
// на земле, слева), шаг инструмента и отказ (мелко, серым), ошибка
// («Повторить»; вложение, которое не пропустила функция, — тоже строкой
// здесь, под своим сообщением), карточка предложения (ChatCard). Вид — тот же, что у
// .ai-msg, .ai-step, .ai-error и .ai-card на вебе, токены — телефона.
//
// Появление (components/chat/chatMotion.js) играет, только если строка
// родилась в этом разговоре на глазах: строка из сохранённой истории, строка,
// которая уже стояла, когда лента открылась, и «уменьшение движения» —
// сразу на месте. Решение принимается один раз, при первой отрисовке строки.
import { memo, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Text from '../AppText';
import Tap from '../Tap';
import ChatText from './ChatText';
import ChatCard from './ChatCard';
import { SentFiles } from './ChatFiles';
import { AI_STEPS, isRestored } from '../../lib/aiChat';
import { fmtDateShort, fmtShort } from '../../lib/format';
import { useColors, spacing, radius, fontSize } from '../../theme';
import { t } from '../../lib/i18n';
import { mineIn, replyIn, cardIn, quietIn } from './chatMotion';

// Строки, которые уже показывались: появление второй раз не играет (лента
// могла открыться заново — после входа, после смены аккаунта).
const shown = new Set();

/** Уже стоявшие строки — без появления (лента открылась с ними). */
export function markShown(items) {
  for (const it of items) shown.add(it.id);
}

/** Какое появление у строки: entering или ничего. */
export function enteringFor(item, reduced) {
  if (reduced || shown.has(item.id) || isRestored(item.id)) return undefined;
  if (item.kind === 'msg') return item.role === 'user' ? mineIn : replyIn;
  if (item.kind === 'card') return cardIn;
  return quietIn;
}

/** «17 окт. – 31 окт.» — период, в котором искали окна. */
function rangeOf(from, to, lang) {
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return '';
  return `${fmtDateShort(from, lang)} – ${fmtDateShort(to, lang)}`;
}

function stepText(it, lang) {
  const name = AI_STEPS[it.tool];
  if (!name) return '';
  if (!it.done || it.failed) return t(lang, `ai.step_${name}`);
  return name === 'windows'
    ? t(lang, 'ai.step_windows_done', { range: rangeOf(it.from, it.to, lang) })
    : t(lang, 'ai.step_spent_done', { time: fmtShort((Number(it.minutes) || 0) * 60000) });
}

/** «Повторить» у ошибки; с retryAt (частота сообщений) — только когда
 *  время ожидания вышло. */
function Retry({ at, onRetry, lang, s }) {
  const [ready, setReady] = useState(() => !at || Date.now() >= at);
  useEffect(() => {
    if (ready) return undefined;
    const id = setTimeout(() => setReady(true), Math.max(0, at - Date.now()) + 20);
    return () => clearTimeout(id);
  }, [at, ready]);
  if (!ready) return null;
  return (
    <Tap onPress={onRetry} hitSlop={8} accessibilityRole="button" testID="chat-retry">
      <Text style={s.link}>{t(lang, 'ai.retry')}</Text>
    </Tap>
  );
}

function ChatRow({ item, lang, reduced, isLast, onRetry, onApply, onDecline, onUndo, onOpen }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const [entering] = useState(() => {
    const e = enteringFor(item, reduced);
    shown.add(item.id);
    return e;
  });

  let body = null;
  if (item.kind === 'msg' && item.role === 'user') {
    body = (
      <View style={s.mineWrap}>
        <SentFiles files={item.files} lang={lang} />
        <View style={s.mine} testID="chat-mine">
          <Text style={s.mineText} selectable>{item.text}</Text>
        </View>
      </View>
    );
  } else if (item.kind === 'msg') {
    body = <ChatText text={item.text} style={s.reply} />;
  } else if (item.kind === 'step') {
    const text = stepText(item, lang);
    if (!text) return null;
    body = <Text style={s.step} testID="chat-step">{text}</Text>;
  } else if (item.kind === 'notice') {
    body = <Text style={s.step} testID="chat-notice">{t(lang, item.key)}</Text>;
  } else if (item.kind === 'error') {
    body = (
      <View style={s.errorRow} testID="chat-error">
        <Text style={s.error}>{t(lang, item.key, item.params)}</Text>
        {item.retry ? <Retry at={item.retryAt} onRetry={onRetry} lang={lang} s={s} /> : null}
      </View>
    );
  } else if (item.kind === 'card') {
    body = (
      <ChatCard
        card={item}
        isLast={isLast}
        onApply={() => onApply(item.id)}
        onDecline={() => onDecline(item.id)}
        onUndo={() => onUndo(item.id)}
        onOpen={onOpen}
      />
    );
  }
  if (!body) return null;
  const side = item.kind === 'msg' && item.role === 'user' ? s.right : s.left;
  return (
    <Animated.View entering={entering} style={side} testID={`chat-row-${item.id}`}>
      {body}
    </Animated.View>
  );
}

export default memo(ChatRow);

const makeStyles = (colors) => StyleSheet.create({
  // Своё сообщение — остров справа, до 85 % ширины; переносы — как набраны.
  right: { alignSelf: 'flex-end', maxWidth: '85%' },
  left: { alignSelf: 'stretch' },
  mineWrap: { alignItems: 'flex-end', gap: 4 },
  mine: { backgroundColor: colors.panel, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 10 },
  mineText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  reply: { paddingHorizontal: 2 },
  step: { color: colors.textDim, fontSize: fontSize.xs, paddingHorizontal: 2 },
  errorRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 2, paddingHorizontal: 2 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  link: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '600' },
});

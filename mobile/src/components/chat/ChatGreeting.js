// Над полем главного экрана «Чат-бота» (круг 21, 19 октября 2026): сценка
// chat (core/illustrations.js — та же, что на вебе, рисует ArtScene) и фраза
// под ней — приветствие по времени суток или подталкивание
// (Core.aiGreeting: экран отдаёт уже готовую строку, каждый вход — новую).
//
// Сценка «вдыхает» при появлении и при каждой новой фразе: чуть меньше и
// ниже — пружиной на место (chatMotion.js: ART_BREATH). Прозрачности нет —
// она не проявляется из нуля, как и всё на страницах. Без движения — стоит.
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Text from '../AppText';
import ArtScene from '../ArtScene';
import { ART_BREATH, ART_SPRING } from './chatMotion';
import { useColors, spacing, typography } from '../../theme';

/** Сценка главного экрана — два облачка разговора (core/illustrations.js). */
export const CHAT_ART = 'chat';

export default function ChatGreeting({ phrase, reduced }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const p = useSharedValue(1);
  useEffect(() => {
    if (reduced) { p.value = 1; return; }
    p.value = 0;
    p.value = withSpring(1, ART_SPRING);
  }, [phrase, reduced]);
  const breath = useAnimatedStyle(() => ({
    transform: [
      { translateY: ART_BREATH.y * (1 - p.value) },
      { scale: ART_BREATH.scale + (1 - ART_BREATH.scale) * p.value },
    ],
  }));
  return (
    <View style={s.wrap} testID="chat-greeting">
      <Animated.View style={breath} testID="chat-art">
        <ArtScene name={CHAT_ART} />
      </Animated.View>
      <Text style={s.phrase} accessibilityRole="header" testID="chat-phrase">{phrase}</Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  phrase: { ...typography.title, color: colors.text, textAlign: 'center', maxWidth: 340 },
});

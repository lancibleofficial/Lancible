// «Агент думает» — три точки волной (как .ai-typing на вебе): каждая по
// очереди подпрыгивает и светлеет, потом пауза. «Уменьшение движения» —
// точки стоят.
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, cancelAnimation, Easing, FadeIn } from 'react-native-reanimated';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useAppStore } from '../../store/useAppStore';
import { useColors } from '../../theme';
import { t } from '../../lib/i18n';
import { DOTS, dotLift, CHAT_FADE } from './chatMotion';

const DOT = 7;

function Dot({ i, wave, still, color }) {
  const style = useAnimatedStyle(() => {
    const y = still ? 0 : dotLift(wave.value, i);
    return { opacity: 0.45 + 0.55 * y, transform: [{ translateY: -DOTS.rise * y }] };
  }, [still]);
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} testID="chat-typing-dot" />;
}

export default function ChatTyping() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const still = useReduceMotion();
  const wave = useSharedValue(0);
  useEffect(() => {
    if (still) { cancelAnimation(wave); wave.value = 0; return undefined; }
    wave.value = 0;
    wave.value = withRepeat(withTiming(1, { duration: DOTS.period, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(wave);
  }, [still]);
  return (
    <Animated.View
      entering={still ? undefined : FadeIn.duration(CHAT_FADE.duration)}
      style={styles.row}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={t(lang, 'ai.thinking')}
      testID="chat-typing"
    >
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => <Dot key={i} i={i} wave={wave} still={still} color={colors.textFaint} />)}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 2 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: DOT + DOTS.rise * 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});

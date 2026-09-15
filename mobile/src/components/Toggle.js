import { useEffect, useRef } from 'react';
import { Pressable, Animated, StyleSheet } from 'react-native';
import { useColors } from '../theme';

const TRACK_W = 46;
const TRACK_H = 26;
const THUMB = 20;
const PAD = 3;

// Обычный булев свитчер без иконки в бегунке (для настроек вроде
// "Синхронизация с аккаунтом") — то же визуальное решение, что и
// ThemeSwitch (свой, не системный Switch), но без привязки к теме.
export default function Toggle({ value, onValueChange }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [PAD, TRACK_W - THUMB - PAD] });
  const trackColor = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.panel2, colors.accent] });

  return (
    <Pressable onPress={() => onValueChange(!value)} hitSlop={8}>
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  track: { width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, justifyContent: 'center' },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: '#fff' },
});

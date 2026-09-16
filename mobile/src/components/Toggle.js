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
  // Два отдельных Animated.Value вместо одного: translateX (transform) может
  // идти на нативном драйвере и оставаться плавным независимо от загрузки
  // JS-потока, а backgroundColor нативным драйвером не поддерживается и
  // обязательно тянет за собой useNativeDriver:false — если гнать ОБА из
  // одного value, вся анимация (включая самое заметное — бегунок) шла бы по
  // JS-потоку и могла дёргаться. Оба стартуют одновременно с одинаковыми
  // duration, визуально это одна анимация.
  const thumbAnim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const colorAnim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    const toValue = value ? 1 : 0;
    Animated.timing(thumbAnim, { toValue, duration: 180, useNativeDriver: true }).start();
    Animated.timing(colorAnim, { toValue, duration: 180, useNativeDriver: false }).start();
  }, [value, thumbAnim, colorAnim]);

  const translateX = thumbAnim.interpolate({ inputRange: [0, 1], outputRange: [PAD, TRACK_W - THUMB - PAD] });
  const trackColor = colorAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.panel2, colors.accent] });

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

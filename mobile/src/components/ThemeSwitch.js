import { useEffect, useRef } from 'react';
import { Pressable, Animated, StyleSheet } from 'react-native';
import Icon from './Icon';
import { useColors } from '../theme';

const TRACK_W = 56;
const TRACK_H = 32;
const THUMB = 26;
const PAD = 3;

// Свой квадратный (со скруглением) свитчер вместо системного Switch — тот
// же компонент подойдёт и для iOS позже. value=false — светлая (солнце),
// value=true — тёмная (луна).
export default function ThemeSwitch({ value, onValueChange }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    // Тут анимируется только translateX (transform) — в отличие от Toggle.js
    // цвет самого трека не интерполируется из этого value, так что нативный
    // драйвер безопасен и даёт более плавный, не зависящий от загрузки
    // JS-потока бегунок.
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [PAD, TRACK_W - THUMB - PAD] });

  return (
    <Pressable onPress={() => onValueChange(!value)} style={styles.track} hitSlop={8}>
      <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]}>
        <Icon name={value ? 'moon' : 'sun'} size={14} color={colors.accentText} />
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  track: {
    width: TRACK_W, height: TRACK_H, borderRadius: 10,
    backgroundColor: colors.panel2, justifyContent: 'center',
  },
  thumb: {
    position: 'absolute', width: THUMB, height: THUMB, borderRadius: 7,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
});

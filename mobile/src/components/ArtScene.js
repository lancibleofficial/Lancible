// Сценка пустого экрана — те же формы, что на десктопе и в вебе
// (core/illustrations.js, разбор — lib/art.js), нарисованные react-native-svg.
// Цвета ни одного: краску каждой роли (подложка, лист, линии, акцент) берёт
// artPaint из токенов текущей темы — сценка сама верна обеим темам.
//
// Картинка декоративная: что пусто, говорят заголовок и текст рядом, поэтому
// скринридеру она не нужна.
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Rect, Circle, Path } from 'react-native-svg';
import { useColors } from '../theme';
import { ART_VIEWBOX, artElements, artPaint } from '../lib/art';

const SHAPE = { rect: Rect, circle: Circle, path: Path };

/** Одна форма сценки: геометрия из разметки, краска — из темы. */
export function ArtShape({ shape, colors }) {
  const C = SHAPE[shape.tag];
  return <C {...shape.attrs} {...artPaint(shape.parts, colors)} />;
}

/** Формы сценки внутри готового <Svg> — для слоёв с анимацией. */
export function ArtShapes({ shapes, colors }) {
  return shapes.map((shape, i) => <ArtShape key={i} shape={shape} colors={colors} />);
}

export default function ArtScene({ name, width = 120, height = 88, style }) {
  const colors = useColors();
  const shapes = useMemo(() => artElements(name), [name]);
  if (!shapes.length) return null;
  return (
    <View
      testID={`art-${name}`}
      style={[{ width, height }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height} viewBox={ART_VIEWBOX}>
        <ArtShapes shapes={shapes} colors={colors} />
      </Svg>
    </View>
  );
}

import Svg, { Path } from 'react-native-svg';
import { useColors } from '../theme';
import { ICONS } from '../core/icons';

// Иконки — Solar Bold из общего словаря core/icons.js: те же пути, что у
// десктопа, веба, редактора и лендинга (собирает scripts/make-solar-icons.js).
// Нативным панелям iOS нужны картинки — их рисует из того же словаря
// scripts/make-ios-icons.js в mobile/assets.

// Цвет по умолчанию — текст текущей темы. Раньше стоял почти белый #ecedef,
// и первая иконка без цвета оказалась бы белой на белом в светлой теме.
export default function Icon({ name, size = 16, color, style }) {
  const colors = useColors();
  const fill = color || colors.text;
  const icon = ICONS[name];
  if (!icon) return <Svg width={size} height={size} style={style} />;
  return (
    <Svg width={size} height={size} viewBox={icon.vb} style={style}>
      {icon.p.map(([d, evenodd], i) => (
        <Path key={i} d={d} fill={fill} fillRule={evenodd ? 'evenodd' : 'nonzero'} clipRule={evenodd ? 'evenodd' : 'nonzero'} />
      ))}
    </Svg>
  );
}

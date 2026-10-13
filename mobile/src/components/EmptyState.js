// Пустой экран — та же деталь, что .empty-state на десктопе и в вебе: сценка,
// заголовок, строка пояснения и, если действие очевидно, одна кнопка. Экран
// кладёт его на место списка и решает только, какую сценку, слова и кнопку.
//
// Четыре размера:
//   • lg — страница или большой остров: сценка 120 × 88, заголовок шрифтом
//     заголовков 20, пояснение 14;
//   • md — карточка среди других (проект без задач в колоде): та же сценка
//     90 × 66, заголовок 16, пояснение 12 — на ступень мельче lg по шкале
//     fontSize, чтобы пустота не перекрикивала шапку и строку новой задачи;
//   • sm — панель, остров среди других, лист: сценка 56 × 40, заголовок 14,
//     пояснение 13;
//   • row — строка в листе или выпадашке: маленькая сценка слева, слова справа.
//
// Кнопка: акцентная (primary) — только если другой акцентной на экране нет,
// и тогда кнопку-дубль в шапке экран прячет; иначе тихая. Высота и скругление
// — общие токены PrimaryButton, своих нет. Сценка стоит: острова на телефоне
// не проявляются при открытии страницы, и пустой экран тоже (DESIGN.md).
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import ArtScene from './ArtScene';
import PrimaryButton from './PrimaryButton';
import { useColors, spacing, typography, fontSize, displayFamily } from '../theme';

const ART = { lg: { width: 120, height: 88 }, md: { width: 90, height: 66 }, sm: { width: 56, height: 40 }, row: { width: 56, height: 40 } };

export default function EmptyState({
  art, title, text, actionLabel, onAction, primary = false, actionIcon, size = 'lg', style, testID = 'empty-state',
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const scene = art ? <ArtScene name={art} {...ART[size]} /> : null;

  if (size === 'row') {
    return (
      <View style={[s.row, style]} testID={testID}>
        {scene}
        <View style={s.rowBody}>
          {title ? <Text style={[s.smTitle, s.left]}>{title}</Text> : null}
          {text ? <Text style={[s.smText, s.left]}>{text}</Text> : null}
        </View>
      </View>
    );
  }

  const lg = size === 'lg';
  const md = size === 'md';
  const button = actionLabel && onAction ? (
    <PrimaryButton
      title={actionLabel}
      icon={actionIcon}
      variant={primary ? 'primary' : 'ghost'}
      onPress={onAction}
      style={primary && lg ? s.btnWide : s.btnFit}
    />
  ) : null;

  return (
    <View style={[lg ? s.lg : md ? s.md : s.sm, style]} testID={testID}>
      {scene}
      <View style={lg ? s.lgBody : md ? s.mdBody : s.smBody}>
        {title ? <Text style={lg ? s.lgTitle : md ? s.mdTitle : s.smTitle} accessibilityRole={lg || md ? 'header' : undefined}>{title}</Text> : null}
        {text ? <Text style={lg ? s.lgText : md ? s.mdText : s.smText}>{text}</Text> : null}
      </View>
      {button}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  lg: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 360, alignSelf: 'center' },
  lgBody: { alignItems: 'center', gap: 6 },
  lgTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  lgText: { ...typography.caption, lineHeight: 20, color: colors.textDim, textAlign: 'center' },
  md: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 360, alignSelf: 'center' },
  mdBody: { alignItems: 'center', gap: 4 },
  mdTitle: { fontFamily: displayFamily.bold, fontSize: fontSize.md, color: colors.text, textAlign: 'center' },
  mdText: { ...typography.caption, fontSize: fontSize.xs, lineHeight: 17, color: colors.textDim, textAlign: 'center' },
  sm: { alignItems: 'center', gap: 6, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, width: '100%', maxWidth: 320, alignSelf: 'center' },
  smBody: { alignItems: 'center', gap: 2 },
  smTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' },
  smText: { color: colors.textDim, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  left: { textAlign: 'left' },
  // Акцентная на большом пустом экране — во всю ширину блока, как главная
  // кнопка листа; тихая — по своей подписи.
  btnWide: { marginTop: 6 },
  btnFit: { width: 'auto', alignSelf: 'center', paddingHorizontal: spacing.xl, marginTop: 6 },
});

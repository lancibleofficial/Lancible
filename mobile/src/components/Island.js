// Остров — панель на земле: заливка panel, скругление 14, без рамки и
// тени. Та же деталь, что .island на десктопе и в вебе: всё содержимое
// экранов лежит островами, а экран подправляет только поля и отступы.
//
// IslandHead — строка «подзаголовок слева, тихая подпись или действие
// справа» (.island-head / .island-title / .island-note). IslandRow — строка
// внутри острова с линией сверху (списки записей, дедлайнов, свойств).
//
// SettingRow и RowGroup (12 октября 2026) — одна строка настройки и одна
// группа строк на «Меню», сведения задачи и настройки проекта: строка
// «значок · название · значение · шеврон», значение всегда словами; группа —
// подпись (Block) над островом. Тап по строке открывает лист именно этой
// настройки (DESIGN.md, «Настройки на телефоне: одна логика»).
//
// ExpandRow (12 октября 2026) — та же строка, но значение выбирается прямо
// под ней: «Дата · 18 сент. ›» раскрывает календарь, «Время · 21:00 ›» —
// часы. Так собраны все листы с датой и временем (дедлайн, время работы,
// запись, напоминание, экспорт): одна строка, один жест, один вид.
import { Children, cloneElement, isValidElement, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import Icon from './Icon';
import { Block, Hint } from './RepeatControls';
import { useColors, spacing, radius, typography, fontSize } from '../theme';

// Без анимации появления: страница въезжает уже собранной. Проявление
// островов с нуля при каждом открытии страницы выглядело морганием.

/** @param tone 'panel' — остров на земле (экраны); 'inset' — остров на
 *  подложке panel (нижний лист, шит задачи): ступенью выше, panel2. */
export default function Island({ children, style, padded = true, tone = 'panel', onPress, onLongPress, ...rest }) {
  const colors = useColors();
  const base = [
    { backgroundColor: tone === 'inset' ? colors.panel2 : colors.panel, borderRadius: radius.lg },
    padded ? { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 } : null,
    style,
  ];
  if (onPress || onLongPress) {
    return (
      <Tap
        onPress={onPress}
        onLongPress={onLongPress}
        style={base}
        {...rest}
      >
        {children}
      </Tap>
    );
  }
  return <View style={base} {...rest}>{children}</View>;
}

/** Шапка острова: подзаголовок и, справа, подпись или элемент. */
export function IslandHead({ title, note, right, onPressNote, style }) {
  const colors = useColors();
  const noteNode = note ? (
    onPressNote ? (
      <Tap onPress={onPressNote} hitSlop={8}>
        <Text style={[typography.islandNote, { color: colors.accentInk }]}>{note}</Text>
      </Tap>
    ) : <Text style={[typography.islandNote, { color: colors.textFaint }]} numberOfLines={1}>{note}</Text>
  ) : null;
  return (
    <View style={[styles.head, style]}>
      <Text style={[typography.islandTitle, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>{title}</Text>
      <View style={{ flex: 1, minWidth: spacing.sm }} />
      {right != null ? right : noteNode}
    </View>
  );
}

/** Строка внутри острова; у всех, кроме первой, линия сверху. */
export function IslandRow({ children, first, onPress, onLongPress, style, ...rest }) {
  const colors = useColors();
  const rowStyle = [
    styles.row,
    !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    style,
  ];
  if (onPress || onLongPress) {
    return (
      <Tap {...rest} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [rowStyle, pressed && { opacity: 0.75 }]}>
        {children}
      </Tap>
    );
  }
  return <View style={rowStyle} {...rest}>{children}</View>;
}

/** Строка настройки: значок · название · значение · шеврон. Одна на «Меню»,
 *  сведения задачи и настройки проекта — высота 46, поля spacing.md, линия
 *  между строками волосяная, значение textFaint 13, шеврон 13.
 *  @param value строка словами («не задан», «5 000 ₸/ч») или деталь (кружок
 *    цвета, бейджи); пусто — справа только шеврон
 *  @param sub подстрока под значением («Вернётся 18 окт»)
 *  @param right своя деталь справа вместо значения и шеврона (переключатель)
 *  @param lead своя деталь слева вместо значка (точка цвета тега)
 *  @param dim название тише — то, что ждёт (напоминание без якоря)
 *  @param chevron шеврон; по умолчанию — у нажимаемой строки. У строки
 *    «+ Добавить…» его нет: она не открывает настройку, а заводит новую
 *  @param valueStyle экран подправляет значение (цвет срока дедлайна)
 *  @param open строка раскрывает выбор под собой (ExpandRow): открытая —
 *    значение акцентом и шеврон вниз; для чтения с экрана — expanded */
export function SettingRow({
  icon, lead, label, value, sub, right, onPress, first, danger, dim, chevron = !!onPress,
  valueStyle, testID, valueTestID, subTestID, accessibilityLabel, open,
}) {
  const colors = useColors();
  const st = useMemo(() => makeRowStyles(colors), [colors]);
  const hasValue = value != null && value !== '';
  const expandable = open !== undefined;
  return (
    <IslandRow
      first={first}
      onPress={onPress}
      style={st.row}
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expandable ? { expanded: !!open } : undefined}
    >
      {lead || (icon ? <Icon name={icon} size={17} color={danger ? colors.danger : colors.textDim} /> : null)}
      <Text style={[st.label, danger && { color: colors.danger }, dim && st.labelDim]} numberOfLines={1}>{label}</Text>
      <View style={st.spacer} />
      {right != null ? right : (
        <View style={st.right}>
          {hasValue || sub ? (
            <View style={st.valueBox}>
              {hasValue && (typeof value === 'string' || typeof value === 'number')
                ? <Text style={[st.value, open && st.valueOpen, valueStyle]} numberOfLines={1} testID={valueTestID}>{value}</Text>
                : value}
              {sub ? <Text style={st.sub} numberOfLines={1} testID={subTestID}>{sub}</Text> : null}
            </View>
          ) : null}
          {chevron ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={open ? colors.accentInk : colors.textFaint} /> : null}
        </View>
      )}
    </IslandRow>
  );
}

/** Строка, значение которой выбирают прямо под ней: «Дата · 18 сент. ›»
 *  раскрывает календарь, «Время · 21:00 ›» — часы. Ставится в RowGroup:
 *  открытая строка заканчивает свой остров, выбор лежит под ним на подложке
 *  листа (календарь и часы — того же вида, что везде), следующие строки идут
 *  новым островом. Открыта не больше одной — это решает лист.
 *  @param open раскрыта ли; @param onToggle нажатие на строку
 *  @param children сам выбор (MiniDatePicker, TimeColumns, барабаны) */
export function ExpandRow({ open, onToggle, children, ...row }) {
  return (
    <>
      <SettingRow {...row} open={!!open} onPress={onToggle} />
      {open ? children : null}
    </>
  );
}

/** Группа строк: подпись группы (Block — textDim, мелко, обычными буквами)
 *  над островом строк. На подложке листа и шита остров — panel2 (tone
 *  'inset'). Линии сверху нет только у первой строки — её группа отмечает
 *  сама. Подписи может не быть (строки даты и времени в листе).
 *  @param note подсказка под островом (Hint)
 *  Раскрытая ExpandRow делит остров: строка — последней в своём острове, под
 *  ним её выбор, дальше — новый остров (testID у первого). */
export function RowGroup({ label, children, tone = 'inset', testID, note }) {
  const rows = Children.toArray(children).filter(isValidElement);
  const parts = [];
  let island = [];
  const close = () => {
    if (!island.length) return;
    const n = parts.filter((p) => p.island).length;
    parts.push({ island: true, rows: island, testID: n === 0 ? testID : testID && `${testID}-${n}` });
    island = [];
  };
  rows.forEach((row) => {
    if (row.type === ExpandRow && row.props.open) {
      const { open, onToggle, children: picker, ...props } = row.props;
      island.push(<SettingRow key={row.key} {...props} open onPress={onToggle} />);
      close();
      parts.push({ island: false, node: <View key={`${row.key}-pick`}>{picker}</View> });
    } else {
      island.push(row);
    }
  });
  close();
  return (
    <Block label={label}>
      {parts.map((p, i) => (p.island ? (
        <Island key={`i${i}`} tone={tone} padded={false} testID={p.testID}>
          {p.rows.map((row, j) => (j === 0 ? cloneElement(row, { first: true }) : row))}
        </Island>
      ) : p.node))}
      {note ? <Hint>{note}</Hint> : null}
    </Block>
  );
}

/** Тихая пустая подпись внутри острова (.island-empty). */
export function IslandEmpty({ children }) {
  const colors = useColors();
  return <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.sm }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
});

// Строка настройки — вид строк «Меню». Название не ужимается (оно короткое и
// говорит, что это за строка), ужимается значение — с многоточием.
const makeRowStyles = (colors) => StyleSheet.create({
  row: { paddingHorizontal: spacing.md, minHeight: 46, gap: spacing.md },
  label: { flexShrink: 0, maxWidth: '62%', color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  labelDim: { color: colors.textFaint },
  spacer: { flex: 1, minWidth: spacing.sm },
  right: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueBox: { flexShrink: 1, minWidth: 0, alignItems: 'flex-end' },
  value: { color: colors.textFaint, fontSize: 13, textAlign: 'right' },
  valueOpen: { color: colors.accentInk, fontWeight: '600' },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'right', marginTop: 1 },
});

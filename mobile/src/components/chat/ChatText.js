// Текст агента — только текстом, как на вебе (aiTextHtml): абзацы — по пустой
// строке, строки «- …» — списком, звёздочки выделения снимаются. Никакой
// разметки из ответа на экран не попадает.
import { View, StyleSheet } from 'react-native';
import Text from '../AppText';
import { useColors, spacing } from '../../theme';

const BOLD = /\*\*(.+?)\*\*/g;

/** Текст модели → блоки: {type: 'p', lines} | {type: 'ul', items}. */
export function chatBlocks(text) {
  const out = [];
  for (const block of String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let para = [];
    let list = [];
    const flushPara = () => { if (para.length) out.push({ type: 'p', lines: para }); para = []; };
    const flushList = () => { if (list.length) out.push({ type: 'ul', items: list }); list = []; };
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const item = line.match(/^\s*- (.*)$/);
      if (item) { flushPara(); list.push(item[1].replace(BOLD, '$1')); } else { flushList(); para.push(line.replace(BOLD, '$1')); }
    }
    flushPara();
    flushList();
  }
  return out;
}

export default function ChatText({ text, style }) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <View style={[s.wrap, style]}>
      {chatBlocks(text).map((b, i) => (b.type === 'p' ? (
        <Text key={i} style={s.p}>{b.lines.join('\n')}</Text>
      ) : (
        <View key={i} style={s.ul}>
          {b.items.map((item, j) => (
            <View key={j} style={s.li}>
              <Text style={s.bullet}>•</Text>
              <Text style={s.liText}>{item}</Text>
            </View>
          ))}
        </View>
      )))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  p: { color: colors.text, fontSize: 15, lineHeight: 21 },
  ul: { gap: 4 },
  li: { flexDirection: 'row', gap: spacing.sm, paddingLeft: 2 },
  bullet: { color: colors.textDim, fontSize: 15, lineHeight: 21 },
  liText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 21 },
});

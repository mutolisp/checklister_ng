/**
 * A table cell that honours the `*italic*` markers report text carries.
 *
 * Scientific names arrive from the model already segmented — genus, species
 * and infraspecific epithets marked italic, rank tokens and authors left
 * upright (see `scientificNameSegments.ts`). Rendering the raw string would
 * print literal asterisks; rendering it all italic would be wrong for the
 * vernacular name and the author.
 */
import { Text, type TextProps } from 'react-native';

type Props = { text: string } & TextProps;

/** Split on paired asterisks; an unpaired one stays literal, which is what
 *  the naturalised-species marker relies on elsewhere in the app. */
function segments(text: string): Array<{ text: string; italic: boolean }> {
  const out: Array<{ text: string; italic: boolean }> = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), italic: false });
    out.push({ text: m[1], italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), italic: false });
  return out;
}

export function RichCell({ text, ...props }: Props) {
  if (!text.includes('*')) return <Text {...props}>{text}</Text>;
  return (
    <Text {...props}>
      {segments(text).map((s, i) =>
        s.italic ? (
          <Text key={i} className="italic">
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}

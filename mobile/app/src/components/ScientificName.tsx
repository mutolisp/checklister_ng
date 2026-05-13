import { Text, type TextProps } from 'react-native';

/**
 * Render a scientific name with correct italic semantics:
 *   - genus, species, epithets, subordinate epithets → italic
 *   - rank abbreviations (var., subsp., ssp., f., fo., ×) → NOT italic
 *   - author and any trailing text → NOT italic
 *
 * For animals (ICZN), the whole name string up to the author block is italic.
 *
 * Pass `name` (typically `simple_name`, no author) and optional `author` to
 * append the author block (always non-italic).
 */

type Props = {
  name: string;
  author?: string;
  kingdom?: string;
  nomenclature?: string;
  italicClassName?: string;
} & TextProps;

const RANK_RE = /\s(var\.|subsp\.|ssp\.|f\.|fo\.|×)\s/;

type Segment = { text: string; italic: boolean };

function isAnimal(kingdom: string, nomenclature: string): boolean {
  if (nomenclature && nomenclature.toUpperCase() === 'ICZN') return true;
  return kingdom === 'Animalia';
}

function parseSegments(name: string, animal: boolean): Segment[] {
  const trimmed = (name || '').trim();
  if (!trimmed) return [];

  if (animal) {
    const m = trimmed.match(/^([A-Z][a-z]+(?:\s+[a-z-]+)+)(.*)/);
    if (!m) return [{ text: trimmed, italic: true }];
    const segs: Segment[] = [{ text: m[1], italic: true }];
    if (m[2]) segs.push({ text: m[2], italic: false });
    return segs;
  }

  const head = trimmed.match(/^([A-Z][a-z-]+\s+[a-z-]+)/);
  if (!head) return [{ text: trimmed, italic: true }];
  const segs: Segment[] = [{ text: head[1], italic: true }];
  let remaining = trimmed.slice(head[1].length);

  while (remaining.length > 0) {
    const m = remaining.match(RANK_RE);
    if (!m || m.index === undefined) {
      if (remaining) segs.push({ text: remaining, italic: false });
      break;
    }
    const before = remaining.slice(0, m.index);
    if (before) segs.push({ text: before, italic: false });
    segs.push({ text: m[0], italic: false });
    remaining = remaining.slice(m.index + m[0].length);

    const epi = remaining.match(/^([a-z-]+)/);
    if (epi) {
      segs.push({ text: epi[1], italic: true });
      remaining = remaining.slice(epi[1].length);
    }
  }

  return segs;
}

export function ScientificName({
  name,
  author,
  kingdom = '',
  nomenclature = '',
  italicClassName = 'italic',
  ...textProps
}: Props) {
  const animal = isAnimal(kingdom, nomenclature);
  const segments = parseSegments(name, animal);

  return (
    <Text {...textProps}>
      {segments.map((s, i) =>
        s.italic ? (
          <Text key={i} className={italicClassName}>
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
      {author ? <Text>{` ${author}`}</Text> : null}
    </Text>
  );
}

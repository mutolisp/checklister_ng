import { Text, type TextProps } from 'react-native';

/**
 * Render a scientific name with correct italic semantics:
 *   - genus, species, epithets, subordinate epithets → italic
 *   - rank abbreviations (var., subsp., ssp., f., fo., ×) → NOT italic
 *   - author and any trailing text → NOT italic
 *   - family, order, class, phylum, kingdom (and any other high rank) → NOT italic
 *
 * For animals (ICZN), the binomial / trinomial up to the author block is
 * italic; rank tokens still break italics.
 *
 * Pass `name` (typically `simple_name`, no author) and optional `author` to
 * append the author block (always non-italic). Pass `rank` when you have it —
 * single-word names like "Lycopodiaceae" can only be classified correctly
 * with explicit rank since the parser otherwise can't tell a Family from a
 * Genus.
 */

type Props = {
  name: string;
  author?: string;
  kingdom?: string;
  nomenclature?: string;
  rank?: string;
  italicClassName?: string;
} & TextProps;

const RANK_RE = /\s(var\.|subsp\.|ssp\.|f\.|fo\.|×)\s/;

/** Ranks at family level and above never get italic latin. */
const NON_ITALIC_RANKS = new Set([
  'Family', 'Superfamily', 'Subfamily', 'Epifamily', 'Tribe', 'Subtribe',
  'Order', 'Superorder', 'Suborder', 'Infraorder', 'Section', 'Subsection',
  'Class', 'Superclass', 'Subclass', 'Infraclass', 'Megaclass',
  'Phylum', 'Superphylum', 'Subphylum', 'Infraphylum',
  'Kingdom', 'Superkingdom', 'Subkingdom', 'Infrakingdom',
  'Realm', 'Unranked',
]);

/** Suffix heuristic to catch a family-or-higher rank when `rank` prop is
 *  not provided. ICN: family -aceae / order -ales / class -opsida /
 *  phylum -phyta / -mycota. ICZN: family -idae / superfamily -oidea. */
const FAMILY_SUFFIX_RE = /(aceae|ales|opsida|phyta|mycota|idae|inae|oidea|virae|viridae|virales|viricetes|viricota)$/;

type Segment = { text: string; italic: boolean };

function isAnimal(kingdom: string, nomenclature: string): boolean {
  if (nomenclature && nomenclature.toUpperCase() === 'ICZN') return true;
  return kingdom === 'Animalia';
}

function isHighRank(rank: string, name: string): boolean {
  if (rank && NON_ITALIC_RANKS.has(rank)) return true;
  if (!rank) {
    // No rank info — fall back to suffix heuristic on the bare token.
    const single = name.trim();
    if (!single.includes(' ') && FAMILY_SUFFIX_RE.test(single)) return true;
  }
  return false;
}

function parseSegments(name: string, animal: boolean, highRank: boolean): Segment[] {
  const trimmed = (name || '').trim();
  if (!trimmed) return [];

  if (highRank) return [{ text: trimmed, italic: false }];

  if (animal) {
    const m = trimmed.match(/^([A-Z][a-z]+(?:\s+[a-z-]+)+)(.*)/);
    if (!m) return [{ text: trimmed, italic: false }];
    const segs: Segment[] = [{ text: m[1], italic: true }];
    if (m[2]) segs.push({ text: m[2], italic: false });
    return segs;
  }

  const head = trimmed.match(/^([A-Z][a-z-]+\s+[a-z-]+)/);
  if (!head) return [{ text: trimmed, italic: false }];
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
  rank = '',
  italicClassName = 'italic',
  ...textProps
}: Props) {
  const animal = isAnimal(kingdom, nomenclature);
  const highRank = isHighRank(rank, name);
  const segments = parseSegments(name, animal, highRank);

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

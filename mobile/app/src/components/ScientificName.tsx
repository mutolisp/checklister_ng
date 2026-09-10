import { Text, type TextProps } from 'react-native';
import { scientificNameSegments } from '~/lib/scientificNameSegments';

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

export function ScientificName({
  name,
  author,
  kingdom = '',
  nomenclature = '',
  rank = '',
  italicClassName = 'italic',
  ...textProps
}: Props) {
  const segments = scientificNameSegments(name, { kingdom, nomenclature, rank });

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

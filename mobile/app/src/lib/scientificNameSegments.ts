/**
 * Scientific-name italic segmentation — the app's single definition of what
 * gets italicised, shared by the RN component and by the report renderers.
 *
 * The rule (unchanged, extracted verbatim from `ScientificName.tsx`):
 *   - genus, species and infraspecific epithets → italic
 *   - rank abbreviations (var., subsp., ssp., f., fo., ×) → upright
 *   - author and any trailing text → upright
 *   - family and above → upright in full
 *
 * Pure module, so `reportHtml.ts` / `reportDocx.ts` / `check:report` can use it
 * under Node. The component keeps rendering; only the parsing moved, so there
 * is no second definition to drift.
 */

export type NameSegment = { text: string; italic: boolean };

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


export function scientificNameSegments(
  name: string,
  opts: { kingdom?: string; nomenclature?: string; rank?: string } = {},
): NameSegment[] {
  const animal = isAnimal(opts.kingdom ?? '', opts.nomenclature ?? '');
  const highRank = isHighRank(opts.rank ?? '', name);
  return parseSegments(name, animal, highRank);
}

/**
 * Segments → the `*italic*` markdown the report tables carry. Escapes any
 * literal asterisk already in the text so a name can never be misread as a
 * marker (`parseRuns` in docx.ts leaves an unpaired `*` alone, which is what
 * the naturalised-species marker relies on).
 */
export function scientificNameMd(
  name: string,
  opts: { author?: string; kingdom?: string; nomenclature?: string; rank?: string } = {},
): string {
  const segs = scientificNameSegments(name, opts);
  const body = segs.map((s) => (s.italic ? `*${s.text}*` : s.text)).join('');
  return opts.author ? `${body} ${opts.author}` : body;
}

/** Drop italic markers — for renderers that cannot style part of a string,
 *  notably DrawingML chart category labels. */
export function stripNameMd(s: string): string {
  return s.replace(/\*([^*]+)\*/g, '$1');
}

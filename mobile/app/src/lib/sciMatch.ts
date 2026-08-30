/**
 * Resolve a foreign scientific name (GBIF / iNaturalist) to one of our taxon
 * identities.
 *
 * The rule that keeps the app coherent: **a species present in a bundled
 * checklist always keeps its local id**. Only names that match nothing locally
 * become external 'g…' taxa. Otherwise the same organism would carry two
 * identities and every record, export and statistic would split.
 *
 * Matching is by (name, kingdom, family) with author as the last resort, NOT by
 * name alone. Measured against the shipped DB: 72 genus names and 2 species
 * names are cross-kingdom homonyms (Acmella, Ficus, Breynia … are both plants
 * and animals), and iNaturalist's species_counts returns *leaf* taxa — often a
 * genus when the identification is coarse — so the genus case is the common
 * one. Adding kingdom+family still leaves 52 species names ambiguous within
 * TaiCOL (e.g. Selaginella japonica Miq. vs Moore ex W.R.McNab, two different
 * plants); those are separated only by author.
 *
 * When ambiguity survives we do NOT pick one. Silently choosing the first row
 * is the worst outcome available: the user would record a different organism
 * and never find out.
 */
import { getTaicolDb } from '~/db/init';

export type SciCandidate = {
  taxon_id: string;
  simple_name: string;
  name_author: string;
  common_name_c: string;
  rank: string;
  kingdom: string;
  family: string;
  /** Chinese family name. Carried so an imported row can render 殼斗科 rather
   *  than bare Fagaceae — `favorite_taxa` is denormalised for offline display,
   *  so whatever is not stored at import time is simply never shown. */
  family_c: string;
  /** Which bundled checklist it came from. */
  source: 'taicol' | 'jp';
};

export type SciQuery = {
  /** Canonical name — WITHOUT author. GBIF's `canonicalName` / iNat's
   *  `taxon.name` are already in this form; `scientificName` is not. */
  name: string;
  kingdom?: string;
  family?: string;
  /** Used only to break a tie between otherwise identical candidates. */
  author?: string;
};

export type SciMatch =
  | {
      kind: 'matched';
      taxon_id: string;
      candidate: SciCandidate;
      /** Set when the incoming name is not the accepted one — it matched a
       *  synonym / misapplied row that resolved to this taxon. Surface it: the
       *  user searched one name and got another. */
      via?: { name: string; status: string };
    }
  | { kind: 'ambiguous'; candidates: SciCandidate[] }
  | { kind: 'unmatched' };

/** Infraspecific rank markers vary between sources (`subsp.` / `ssp.` / `var.`
 *  / `f.`). Collapse them to the TaiCOL spelling before comparing. */
const RANK_MARKERS: [RegExp, string][] = [
  [/\bssp\.?\s+/gi, 'subsp. '],
  [/\bsubspecies\s+/gi, 'subsp. '],
  [/\bsubsp\.?\s+/gi, 'subsp. '],
  [/\bvar\.?\s+/gi, 'var. '],
  [/\bvariety\s+/gi, 'var. '],
  [/\bforma\s+/gi, 'f. '],
  [/\bfo\.?\s+/gi, 'f. '],
  [/\bf\.?\s+/gi, 'f. '],
];

/**
 * The spellings to look up, so the lookup can use the index on `simple_name`.
 *
 * Anything in parentheses is dropped first — GBIF canonical names can still
 * carry a subgenus, e.g. `Acer (Palmata) palmatum`.
 *
 * This exists instead of the obvious `WHERE LOWER(simple_name) = ?` because
 * SQLite cannot serve a function-of-column comparison from a plain index: that
 * form SCANs all 269,824 rows of `taicol_names` — measured at 67 ms per name,
 * i.e. ~34 s for one 500-species area query, and far worse on a phone. Matching
 * against a handful of literal spellings instead SEARCHes the index at 0.09 ms
 * per name (774x), and was verified to return identical results on 600 real
 * iNaturalist names from Yangmingshan, Kenting and Kinabalu.
 *
 * The spellings cover how the sources and TaiCOL actually differ: GBIF/iNat
 * send properly capitalised binomials, TaiCOL stores the same convention, and
 * hybrids appear with either `×` or a plain `x`.
 */
export function nameVariants(name: string): string[] {
  let s = (name ?? '').replace(/\([^)]*\)/g, ' ');
  for (const [re, to] of RANK_MARKERS) s = s.replace(re, to);
  s = s.trim().replace(/\s+/g, ' ');
  if (!s) return [];
  const lower = s.toLowerCase();
  const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
  const out: string[] = [];
  const push = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  push(s);
  push(titled);
  push(lower);
  for (const v of [s, titled]) {
    if (v.includes(' x ')) push(v.replace(/ x /g, ' × '));
    if (v.includes(' × ')) push(v.replace(/ × /g, ' x '));
  }
  return out;
}

const CAND_COLS = `taxon_id, simple_name, name_author, common_name_c, rank, kingdom, family, family_c`;

function queryTable(tbl: string, source: 'taicol' | 'jp', variants: string[]): SciCandidate[] {
  const ph = variants.map(() => '?').join(',');
  const res = getTaicolDb().executeSync(
    `SELECT ${CAND_COLS} FROM ${tbl}
      WHERE simple_name IN (${ph}) AND usage_status LIKE '%accepted%'
        AND taxon_id IS NOT NULL AND taxon_id != ''`,
    variants,
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    taxon_id: (r.taxon_id as string) ?? '',
    simple_name: (r.simple_name as string) ?? '',
    name_author: (r.name_author as string) ?? '',
    common_name_c: (r.common_name_c as string) ?? '',
    rank: (r.rank as string) ?? '',
    kingdom: (r.kingdom as string) ?? '',
    family: (r.family as string) ?? '',
    family_c: (r.family_c as string) ?? '',
    source,
  }));
}

/** Rows whose name matches but which are not the accepted name, resolved
 *  forward to the accepted row via their taxon_id. Mirrors what `searchSpecies`
 *  already does for the main search box. */
function querySynonyms(
  tbl: string,
  source: 'taicol' | 'jp',
  variants: string[],
): { accepted: SciCandidate; matchedName: string; status: string }[] {
  const db = getTaicolDb();
  const ph = variants.map(() => '?').join(',');
  const hits = db.executeSync(
    `SELECT taxon_id, simple_name, usage_status FROM ${tbl}
      WHERE simple_name IN (${ph}) AND taxon_id IS NOT NULL AND taxon_id != ''`,
    variants,
  );
  const rows = (hits.rows ?? []) as Record<string, unknown>[];
  const out: { accepted: SciCandidate; matchedName: string; status: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const tid = (r.taxon_id as string) ?? '';
    if (!tid || seen.has(tid)) continue;
    seen.add(tid);
    const acc = db.executeSync(
      `SELECT ${CAND_COLS} FROM ${tbl}
        WHERE taxon_id = ? AND usage_status LIKE '%accepted%' LIMIT 1`,
      [tid],
    );
    const a = ((acc.rows ?? []) as Record<string, unknown>[])[0];
    if (!a) continue;
    out.push({
      accepted: {
        taxon_id: (a.taxon_id as string) ?? '',
        simple_name: (a.simple_name as string) ?? '',
        name_author: (a.name_author as string) ?? '',
        common_name_c: (a.common_name_c as string) ?? '',
        rank: (a.rank as string) ?? '',
        kingdom: (a.kingdom as string) ?? '',
        family: (a.family as string) ?? '',
        family_c: (a.family_c as string) ?? '',
        source,
      },
      matchedName: (r.simple_name as string) ?? '',
      status: (r.usage_status as string) ?? '',
    });
  }
  return out;
}

/** Narrow by a field only when doing so leaves something — a source that omits
 *  kingdom/family must not filter every candidate away. */
function narrow(
  cands: SciCandidate[],
  value: string | undefined,
  pick: (c: SciCandidate) => string,
): SciCandidate[] {
  if (!value || cands.length <= 1) return cands;
  const want = value.trim().toLowerCase();
  const kept = cands.filter((c) => pick(c).trim().toLowerCase() === want);
  return kept.length > 0 ? kept : cands;
}

/**
 * Three-stage resolution: TaiCOL, then jp_names, then give up (the caller mints
 * an external taxon). Never returns a JP match when TaiCOL has one.
 */
export function matchScientificName(q: SciQuery): SciMatch {
  const variants = nameVariants(q.name);
  if (variants.length === 0) return { kind: 'unmatched' };

  for (const [tbl, source] of [
    ['taicol_names', 'taicol'],
    ['jp_names', 'jp'],
  ] as const) {
    let cands = queryTable(tbl, source, variants);

    // Nothing accepted under this name — try the synonym / misapplied rows and
    // follow their taxon_id to the accepted name. Without this a species the
    // checklist DOES know (e.g. iNaturalist's "Symplocos paniculata", misapplied
    // for TaiCOL's Symplocos chinensis 灰木) would be minted as an external
    // taxon, breaking the rule that local species keep local ids.
    let via: { name: string; status: string } | undefined;
    if (cands.length === 0) {
      const syn = querySynonyms(tbl, source, variants);
      if (syn.length > 0) {
        cands = syn.map((x) => x.accepted);
        via = { name: syn[0].matchedName, status: syn[0].status };
      }
    }
    if (cands.length === 0) continue;

    cands = narrow(cands, q.kingdom, (c) => c.kingdom);
    cands = narrow(cands, q.family, (c) => c.family);
    cands = narrow(cands, q.author, (c) => c.name_author);

    // Same taxon_id repeated (several name rows for one taxon) is not ambiguity.
    const distinct = new Map(cands.map((c) => [c.taxon_id, c]));
    if (distinct.size === 1) {
      const only = [...distinct.values()][0];
      return { kind: 'matched', taxon_id: only.taxon_id, candidate: only, via };
    }
    return { kind: 'ambiguous', candidates: [...distinct.values()] };
  }
  return { kind: 'unmatched' };
}

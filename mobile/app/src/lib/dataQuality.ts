/**
 * Data-quality audit: what a reader needs in order to judge whether the
 * numbers above it mean anything.
 *
 * Every index in the report rests on assumptions the records may not satisfy —
 * that quantities exist, that they share a unit, that a "species" is a species
 * rather than a genus-level placeholder. None of that is visible from a
 * Shannon index, so it is stated separately and plainly.
 *
 * This section reports; it does not judge. A genus-level record is normal in
 * the field and is not an error — but it does inflate richness, so the count
 * belongs on the page.
 *
 * Pure module — no DB / expo / `~/i18n` imports.
 */
import { speciesKey, type DiversityRecord } from './diversity';
import { kindForType, type QuantityKind } from './dwcAbundanceCore';
import { ZH_TO_EN } from './rankColors';
import type { ReportRecord } from './reportStats';

/** Ranks at or below species: a record at one of these identifies an actual
 *  species (or an infraspecific taxon of one). Anything above is a placeholder
 *  as far as richness is concerned. */
const SPECIES_LEVEL = new Set(['species', 'subspecies', 'variety', 'form']);

/** Normalise a rank label to its canonical English key. TaiCOL gives English,
 *  the Japanese list gives Traditional Chinese; `ZH_TO_EN` is the app's one
 *  mapping and is shared with the rank chips. */
export function normaliseRank(rank: string | null | undefined): string {
  const trimmed = (rank ?? '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (SPECIES_LEVEL.has(lower) || lower === 'genus' || lower === 'family') return lower;
  const mapped = ZH_TO_EN[trimmed];
  return mapped ?? lower;
}

export type QualityIssue =
  | { code: 'no-abundance'; records: number; species: number }
  | { code: 'genus-only'; species: number; examples: string[] }
  | { code: 'above-genus'; species: number; examples: string[] }
  | { code: 'rank-unknown'; species: number }
  | { code: 'mixed-units'; records: number; kinds: QuantityKind[] }
  | { code: 'unparseable'; records: number; examples: string[] }
  | { code: 'singletons'; species: number }
  | { code: 'doubletons'; species: number }
  | { code: 'no-layer'; records: number }
  | { code: 'no-subplot'; records: number };

export type DataQuality = {
  totalRecords: number;
  totalSpecies: number;
  issues: QualityIssue[];
};

const MAX_EXAMPLES = 3;

function nameOf(r: ReportRecord): string {
  return r.used_scientific_name || r.simple_name || r.taxon_id;
}

/**
 * @param hasSubplots whether the plot is divided at all. Without subplots a
 *   missing `subplot_id` is the normal state, not a gap, so the issue is only
 *   raised for plots that ARE divided.
 * @param hasLayers likewise for stratified plots.
 */
export function dataQuality(
  records: ReportRecord[],
  ctx: { hasSubplots?: boolean; hasLayers?: boolean } = {},
): DataQuality {
  const species = new Map<string, ReportRecord[]>();
  for (const r of records) {
    const k = speciesKey(r);
    const cur = species.get(k);
    if (cur) cur.push(r);
    else species.set(k, [r]);
  }

  const issues: QualityIssue[] = [];

  // ── quantities ──
  const kinds = new Set<QuantityKind>();
  let unquantified = 0;
  let unparseable = 0;
  const badExamples: string[] = [];
  for (const r of records) {
    const q = r.organism_quantity;
    if (q == null || q === '') {
      unquantified += 1;
      continue;
    }
    const kind = kindForType(r.organism_quantity_type);
    kinds.add(kind);
    // DBH is a JSON array and BB is a code; neither is expected to parse as a
    // bare number, so only the numeric kinds are checked here.
    if ((kind === 'count' || kind === 'percent') && !Number.isFinite(Number(q))) {
      unparseable += 1;
      if (badExamples.length < MAX_EXAMPLES) badExamples.push(`${nameOf(r)}: ${q}`);
    }
  }
  if (unquantified > 0) {
    const speciesAffected = [...species.values()].filter((rs) =>
      rs.every((r) => r.organism_quantity == null || r.organism_quantity === ''),
    ).length;
    issues.push({ code: 'no-abundance', records: unquantified, species: speciesAffected });
  }
  if (kinds.size > 1) {
    issues.push({ code: 'mixed-units', records: records.length, kinds: [...kinds].sort() });
  }
  if (unparseable > 0) {
    issues.push({ code: 'unparseable', records: unparseable, examples: badExamples });
  }

  // ── taxonomic resolution ──
  const genusOnly: string[] = [];
  const aboveGenus: string[] = [];
  let unknownRank = 0;
  for (const [, rs] of species) {
    const rank = normaliseRank(rs[0].rank);
    if (rank === '') {
      unknownRank += 1;
    } else if (rank === 'genus') {
      genusOnly.push(nameOf(rs[0]));
    } else if (!SPECIES_LEVEL.has(rank)) {
      aboveGenus.push(nameOf(rs[0]));
    }
  }
  if (genusOnly.length > 0) {
    issues.push({
      code: 'genus-only',
      species: genusOnly.length,
      examples: genusOnly.slice(0, MAX_EXAMPLES),
    });
  }
  if (aboveGenus.length > 0) {
    issues.push({
      code: 'above-genus',
      species: aboveGenus.length,
      examples: aboveGenus.slice(0, MAX_EXAMPLES),
    });
  }
  if (unknownRank > 0) issues.push({ code: 'rank-unknown', species: unknownRank });

  // ── rarity, which is what every Chao estimate rests on ──
  const counts = countsPerSpecies(records);
  if (counts) {
    const f1 = counts.filter((c) => c === 1).length;
    const f2 = counts.filter((c) => c === 2).length;
    if (f1 > 0) issues.push({ code: 'singletons', species: f1 });
    if (f2 > 0) issues.push({ code: 'doubletons', species: f2 });
  }

  // ── structural gaps ──
  if (ctx.hasLayers) {
    const n = records.filter((r) => !(r.layer ?? '').trim()).length;
    if (n > 0) issues.push({ code: 'no-layer', records: n });
  }
  if (ctx.hasSubplots) {
    const n = records.filter((r) => r.subplot_id == null).length;
    if (n > 0) issues.push({ code: 'no-subplot', records: n });
  }

  return { totalRecords: records.length, totalSpecies: species.size, issues };
}

/** Individuals per species; null unless every quantified record is a count,
 *  since singleton/doubleton counts are meaningless for cover data. */
function countsPerSpecies(records: DiversityRecord[]): number[] | null {
  const byKey = new Map<string, number>();
  let any = false;
  for (const r of records) {
    const q = r.organism_quantity;
    if (q == null || q === '') continue;
    if (kindForType(r.organism_quantity_type) !== 'count') return null;
    const n = Number(q);
    if (!Number.isFinite(n)) return null;
    any = true;
    byKey.set(speciesKey(r), (byKey.get(speciesKey(r)) ?? 0) + n);
  }
  return any ? [...byKey.values()] : null;
}

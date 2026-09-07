/**
 * In-survey diversity indices and sampling-effort estimators for one plot.
 *
 * Pure module (imports only the other pure abundance helpers) so
 * `scripts/check-diversity.mjs` can assert on it under Node — same contract
 * as vegMatrix.ts. UI: src/components/PlotDiversityCard.tsx.
 *
 * Formulas — verified against primary sources on 2026-09-10, do NOT edit from
 * memory (see Update_log entry of the same date for the provenance chain):
 *  - Shannon H′ = −Σ pᵢ·ln(pᵢ); Simpson concentration D = Σ pᵢ²; reported as
 *    1−D and 1/D. Hill-number equivalents: exp(H′) (q=1), 1/D (q=2)
 *    [vegan `diversity()` docs; Chao, Gotelli, Hsieh et al. 2014,
 *    Ecological Monographs 84:45–67, doi:10.1890/13-0133.1].
 *  - Chao1 (abundance/individual counts): Ŝ = S₀ + f1²/(2·f2); when f2 = 0
 *    the bias-corrected form S₀ + f1(f1−1)/(2(f2+1)). f1/f2 = number of
 *    species with exactly 1 / 2 individuals. NO (N−1)/N small-sample factor
 *    for the abundance version [Chao 1984; vegan `estimateR` docs].
 *  - Chao2 (incidence across sampling units = subplots): Ŝ = S₀ +
 *    (q1²/(2·q2))·(N−1)/N; q2 = 0 → S₀ + (q1(q1−1)/(2(q2+1)))·(N−1)/N,
 *    N = number of units [Chao 1987; vegan `specpool` docs].
 *  - Both Chao estimators are LOWER BOUNDS of true richness
 *    [Chao et al. 2014]. Sample coverage (Good–Turing): C = 1 − f1/n
 *    [Chao et al. 2014: "one minus the proportion of singletons"].
 *  - Pielou evenness J′ = H′/ln(S) [vegan `diversity()` docs, Examples:
 *    `J <- H/log(S)`]. Sørensen = 2C/(A+B); Jaccard = C/(A+B−C) — matches
 *    the desktop compareUtils implementations.
 *  - Dominance. Berger–Parker d = max(pᵢ), the share of the most abundant
 *    species; its Hill equivalent is 1/d — vegan `renyi()` docs state the
 *    Hill number at scale ∞ is "1/ \max(p_i)". (The index is named after
 *    Berger & Parker 1970, Science 168:1345–1347, doi:10.1126/science.
 *    168.3937.1345 — attribution only; that paper was NOT read here, the
 *    formula rests on the vegan documentation.) Simpson concentration D
 *    doubles as the "concentration of dominance".
 *  - Relative frequency = (subplots occupied)/(subplots sampled), the
 *    frequency component of the Importance Value Index [IVI = relative
 *    frequency + relative density + relative dominance, Curtis & McIntosh
 *    1951, doi:10.2307/1931725, quoted verbatim in two independent OA
 *    papers]. The app reports the components it can actually derive and
 *    deliberately does NOT sum a two-component surrogate as "IVI": one
 *    record carries one quantity, so density and dominance are never both
 *    available from the same survey pass.
 *
 * Numericisation deliberately reuses `aggregateCell` from vegMatrix.ts so the
 * live card and the exported matrices can never disagree: BB → cover midpoint
 * (the settled BB_COVER_PCT table), % cover → value, individuals → count,
 * DBH → total basal area; per-species aggregation across layers/subplots =
 * the merged-matrix rules (BB/percent max, count sum, DBH stems add).
 */
import { kindForType, type QuantityKind } from './dwcAbundanceCore';
import { aggregateCell } from './vegMatrix';

export type DiversityRecord = {
  taxon_id: string;
  used_scientific_name?: string | null;
  organism_quantity: string | null;
  organism_quantity_type: string | null;
  subplot_id?: number | null;
};

/** Same composite identity as the export chain (v28 convention): the same
 *  taxon recorded under two names is two deliberate taxonomic opinions.
 *  Exported so the UI can map a returned key back to a display name. */
export function speciesKey(r: DiversityRecord): string {
  return `${r.taxon_id}|${r.used_scientific_name ?? ''}`;
}

function groupBySpecies(records: DiversityRecord[]): Map<string, DiversityRecord[]> {
  const m = new Map<string, DiversityRecord[]>();
  for (const r of records) {
    const k = speciesKey(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export type DiversityBasis = 'BB' | 'percent' | 'count' | 'DBH' | 'custom' | 'mixed' | 'none';

export type DominantSpecies = {
  /** Composite species key — map back to a name via `speciesKey`. */
  key: string;
  /** Aggregated value under the plot's basis (cover %, count, basal area…). */
  value: number;
  /** value / Σvalues — the species' relative abundance pᵢ. */
  share: number;
};

export type DiversityResult = {
  /** Distinct species (composite key), regardless of quantifiability. */
  richness: number;
  /** Nats. Null when fewer than 1 species carries a usable value. */
  shannonH: number | null;
  /** exp(H′) — Hill q=1, in effective species. */
  shannonDiversity: number | null;
  /** Simpson concentration D = Σ pᵢ². */
  simpsonD: number | null;
  /** 1 − D. */
  simpson1mD: number | null;
  /** 1/D — Hill q=2, in effective species. */
  invSimpson: number | null;
  /** Pielou evenness J′ = H′/ln(S). Null when S < 2 (undefined) or H′ null. */
  pielouJ: number | null;
  /** Berger–Parker dominance d = max(pᵢ): the most abundant species' share
   *  of the total. Null when nothing is quantified. Hill ∞ = 1/d. */
  bergerParker: number | null;
  /** Species ordered by share, descending (the plot's dominants). */
  dominants: DominantSpecies[];
  /** What the proportions are based on; 'mixed' flags cross-unit weighting. */
  basis: DiversityBasis;
  /** Some quantities failed to parse or kinds were mixed inside a species. */
  lossy: boolean;
};

export function computeDiversity(records: DiversityRecord[]): DiversityResult {
  const bySpecies = groupBySpecies(records);
  const kinds = new Set<QuantityKind>();
  for (const r of records) {
    if (r.organism_quantity != null && r.organism_quantity !== '') {
      kinds.add(kindForType(r.organism_quantity_type));
    }
  }
  const valued: Array<{ key: string; value: number }> = [];
  let lossy = false;
  for (const [key, recs] of bySpecies) {
    const agg = aggregateCell(recs, 'cover');
    if (agg.lossy) lossy = true;
    if (agg.num != null && agg.num > 0) valued.push({ key, value: agg.num });
  }
  const values = valued.map((v) => v.value);
  const basis: DiversityBasis =
    kinds.size === 0 ? 'none' : kinds.size === 1 ? ([...kinds][0] as DiversityBasis) : 'mixed';
  if (basis === 'mixed') lossy = true;

  const total = values.reduce((a, b) => a + b, 0);
  let shannonH: number | null = null;
  let simpsonD: number | null = null;
  if (values.length > 0 && total > 0) {
    let h = 0;
    let d = 0;
    for (const v of values) {
      const p = v / total;
      h -= p * Math.log(p);
      d += p * p;
    }
    shannonH = h;
    simpsonD = d;
  }
  const dominants: DominantSpecies[] =
    total > 0
      ? [...valued]
          .sort((a, b) => b.value - a.value)
          .map((v) => ({ key: v.key, value: v.value, share: v.value / total }))
      : [];

  return {
    richness: bySpecies.size,
    shannonH,
    shannonDiversity: shannonH != null ? Math.exp(shannonH) : null,
    simpsonD,
    simpson1mD: simpsonD != null ? 1 - simpsonD : null,
    invSimpson: simpsonD != null && simpsonD > 0 ? 1 / simpsonD : null,
    pielouJ:
      shannonH != null && values.length >= 2 ? shannonH / Math.log(values.length) : null,
    bergerParker: dominants.length > 0 ? dominants[0].share : null,
    dominants,
    basis,
    lossy,
  };
}

/**
 * Relative frequency per species = subplots occupied / subplots sampled —
 * the frequency component of the Importance Value Index (Curtis & McIntosh
 * 1951). Empty map when fewer than 2 units, where frequency carries no
 * information. Records outside `subplotIds` (or with a null subplot) are
 * ignored, exactly as in `chao2`.
 */
export function relativeFrequency(
  records: DiversityRecord[],
  subplotIds: number[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (subplotIds.length < 2) return out;
  const unitSet = new Set(subplotIds);
  const occupied = new Map<string, Set<number>>();
  for (const r of records) {
    if (r.subplot_id == null || !unitSet.has(r.subplot_id)) continue;
    const k = speciesKey(r);
    const set = occupied.get(k);
    if (set) set.add(r.subplot_id);
    else occupied.set(k, new Set([r.subplot_id]));
  }
  for (const [k, units] of occupied) out.set(k, units.size / subplotIds.length);
  return out;
}

export type Chao1Result =
  | { applicable: false; reason: 'no-counts' | 'empty' }
  | {
      applicable: true;
      estimate: number;
      sObs: number;
      f1: number;
      f2: number;
      n: number;
      biasCorrected: boolean;
      /** Good–Turing sample coverage C = 1 − f1/n. */
      coverage: number;
      /** S₀ / Ŝ — how much of the (lower-bound) estimate is already seen. */
      completeness: number;
    };

/**
 * Abundance-based richness estimate. Only meaningful when EVERY quantified
 * record is an individuals count — cover/BB/DBH have no notion of a
 * "singleton individual", so mixing makes f1 meaningless and the whole
 * estimator is reported inapplicable instead of silently wrong.
 */
export function chao1(records: DiversityRecord[]): Chao1Result {
  const quantified = records.filter(
    (r) => r.organism_quantity != null && r.organism_quantity !== '',
  );
  if (quantified.length === 0) return { applicable: false, reason: 'empty' };
  if (quantified.some((r) => kindForType(r.organism_quantity_type) !== 'count')) {
    return { applicable: false, reason: 'no-counts' };
  }
  const bySpecies = groupBySpecies(quantified);
  let f1 = 0;
  let f2 = 0;
  let n = 0;
  let sObs = 0;
  for (const recs of bySpecies.values()) {
    let sum = 0;
    for (const r of recs) {
      const v = Number(r.organism_quantity);
      if (Number.isFinite(v)) sum += v;
    }
    const count = Math.round(sum);
    if (count <= 0) continue;
    sObs += 1;
    n += count;
    if (count === 1) f1 += 1;
    else if (count === 2) f2 += 1;
  }
  if (sObs === 0 || n === 0) return { applicable: false, reason: 'empty' };
  const biasCorrected = f2 === 0;
  const estimate = biasCorrected
    ? sObs + (f1 * (f1 - 1)) / (2 * (f2 + 1))
    : sObs + (f1 * f1) / (2 * f2);
  return {
    applicable: true,
    estimate,
    sObs,
    f1,
    f2,
    n,
    biasCorrected,
    coverage: 1 - f1 / n,
    completeness: sObs / estimate,
  };
}

export type Chao2Result =
  | { applicable: false; reason: 'need-subplots' | 'empty' }
  | {
      applicable: true;
      estimate: number;
      sObs: number;
      q1: number;
      q2: number;
      /** Number of sampling units (subplots). */
      unitCount: number;
      biasCorrected: boolean;
      completeness: number;
    };

/**
 * Incidence-based richness estimate over the plot's subplots (小區) as
 * sampling units. Needs ≥2 units; records not assigned to a subplot carry no
 * incidence information and are ignored here.
 */
export function chao2(records: DiversityRecord[], subplotIds: number[]): Chao2Result {
  const unitCount = subplotIds.length;
  if (unitCount < 2) return { applicable: false, reason: 'need-subplots' };
  const unitSet = new Set(subplotIds);
  // species key → set of subplots it occurs in
  const incidence = new Map<string, Set<number>>();
  for (const r of records) {
    if (r.subplot_id == null || !unitSet.has(r.subplot_id)) continue;
    const k = speciesKey(r);
    const set = incidence.get(k);
    if (set) set.add(r.subplot_id);
    else incidence.set(k, new Set([r.subplot_id]));
  }
  const sObs = incidence.size;
  if (sObs === 0) return { applicable: false, reason: 'empty' };
  let q1 = 0;
  let q2 = 0;
  for (const units of incidence.values()) {
    if (units.size === 1) q1 += 1;
    else if (units.size === 2) q2 += 1;
  }
  const smallSample = (unitCount - 1) / unitCount;
  const biasCorrected = q2 === 0;
  const estimate = biasCorrected
    ? sObs + ((q1 * (q1 - 1)) / (2 * (q2 + 1))) * smallSample
    : sObs + ((q1 * q1) / (2 * q2)) * smallSample;
  return {
    applicable: true,
    estimate,
    sObs,
    q1,
    q2,
    unitCount,
    biasCorrected,
    completeness: sObs / estimate,
  };
}

export type BetaSimilarity = {
  /** Sørensen = 2C/(A+B). */
  sorensen: number;
  /** Jaccard = C/(A+B−C). */
  jaccard: number;
  /** Species in both plots (C). */
  shared: number;
  /** Species only in the first / second plot. */
  onlyA: number;
  onlyB: number;
  sA: number;
  sB: number;
};

/**
 * Pairwise β similarity between two record sets, presence-based on the same
 * v28 composite species key the whole stats/matrix chain uses. Empty sets
 * yield 0 for both indices (no shared composition to speak of).
 */
export function betaSimilarity(a: DiversityRecord[], b: DiversityRecord[]): BetaSimilarity {
  const setOf = (records: DiversityRecord[]) => new Set(records.map(speciesKey));
  const sa = setOf(a);
  const sb = setOf(b);
  let shared = 0;
  for (const k of sa) if (sb.has(k)) shared += 1;
  const total = sa.size + sb.size;
  const union = total - shared;
  return {
    sorensen: total === 0 ? 0 : (2 * shared) / total,
    jaccard: union === 0 ? 0 : shared / union,
    shared,
    onlyA: sa.size - shared,
    onlyB: sb.size - shared,
    sA: sa.size,
    sB: sb.size,
  };
}
